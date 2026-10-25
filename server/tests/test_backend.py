import sys
import unittest
from pathlib import Path

# Add server directory to sys.path
SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from fastapi.testclient import TestClient
from main import app
from app.db.memory_store import memory_store

class TestAmadeusBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_01_health_endpoint(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("status"), "online")
        self.assertIn("AMADEUS OS", data.get("system", ""))
        self.assertIn("totalMemories", data)
        self.assertIn("totalSessions", data)

    def test_02_personas_endpoint(self):
        response = self.client.get("/api/personas/kurisu")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("id"), "kurisu")
        self.assertEqual(data.get("name"), "Makise Kurisu")
        self.assertIn("memories", data)

    def test_03_memories_crud(self):
        # 1. Create custom memory
        payload = {
            "title": "Teste Automatizado de Memória",
            "category": "research",
            "content": "Verificando persistência semântica no córtex modular.",
            "emotionalWeight": "Científico",
            "source": "custom"
        }
        res_create = self.client.post("/api/memories", json=payload)
        self.assertEqual(res_create.status_code, 200)
        created_data = res_create.json()
        memory_id = created_data.get("id")
        self.assertTrue(bool(memory_id))

        # 2. Get memories and verify it exists
        res_list = self.client.get("/api/memories")
        self.assertEqual(res_list.status_code, 200)
        memories = res_list.json()
        found = any(m["id"] == memory_id for m in memories)
        self.assertTrue(found)

        # 3. Delete memory
        res_delete = self.client.delete(f"/api/memories/{memory_id}")
        self.assertEqual(res_delete.status_code, 200)
        self.assertTrue(res_delete.json().get("ok"))

    def test_04_sessions_lifecycle(self):
        # 1. Create new session
        res_session = self.client.post("/api/sessions/new")
        self.assertEqual(res_session.status_code, 200)
        session_id = res_session.json().get("sessionId")
        self.assertTrue(bool(session_id))

        # 2. List sessions
        res_list = self.client.get("/api/sessions")
        self.assertEqual(res_list.status_code, 200)
        sessions = res_list.json()
        self.assertTrue(any(s["id"] == session_id for s in sessions))

        # 3. Check session messages initially empty
        res_msgs = self.client.get(f"/api/sessions/{session_id}/messages")
        self.assertEqual(res_msgs.status_code, 200)
        self.assertIsInstance(res_msgs.json(), list)

    def test_05_chat_offline_simulator_greetings(self):
        payload = {
            "message": "Olá Kurisu!",
            "personaId": "kurisu",
            "history": []
        }
        res = self.client.post("/api/chat", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("Olá", data.get("response", ""))
        self.assertEqual(data.get("emotion"), "smile")
        self.assertEqual(data.get("model"), "Simulador Local (ChromaDB + SQLite)")
        self.assertTrue(bool(data.get("sessionId")))

    def test_06_chat_offline_simulator_easter_egg(self):
        payload = {
            "message": "Nullpo!",
            "personaId": "kurisu"
        }
        res = self.client.post("/api/chat", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("Gah!", data.get("response", ""))
        self.assertEqual(data.get("emotion"), "flustered")

    def test_07_chat_offline_simulator_science(self):
        payload = {
            "message": "Você acha viável construir uma máquina de viagem no tempo?",
            "personaId": "kurisu"
        }
        res = self.client.post("/api/chat", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("emotion"), "thinking")
        self.assertIn("viola", data.get("response", ""))

    def test_08_backward_compatibility_root_routes(self):
        # Verify routes mounted without /api prefix also respond identically
        res_health = self.client.get("/health")
        self.assertEqual(res_health.status_code, 200)
        self.assertEqual(res_health.json().get("status"), "online")

    def test_09_divergence_endpoint(self):
        response = self.client.get("/api/divergence")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("divergence", data)
        self.assertIn("worldline", data)
        self.assertIn("source", data)
        self.assertIn("timestamp", data)

    def test_10_emotion_service_rules(self):
        from app.services.emotion_service import parse_tags
        # Compliment / blushing test
        clean, emotion, _ = parse_tags("O-obrigada pelo elogio... você é gentil demais.", user_message="Você é muito fofa e bonita!")
        self.assertEqual(emotion, "flustered")

        # Cockroach test
        clean_c, emotion_c, _ = parse_tags("Tem uma barata no chão!", user_message="Olha aquela barata voadora!")
        self.assertEqual(emotion_c, "desperate")

        # Stuttering detection in assistant text
        clean_s, emotion_s, _ = parse_tags("N-não é como se eu quisesse isso!")
        self.assertEqual(emotion_s, "flustered")

    def test_11_offline_simulator_no_baka_and_cockroach(self):
        # Cockroach panic test
        payload = {
            "message": "Socorro, tem uma barata enorme vindo aqui!",
            "personaId": "kurisu"
        }
        res = self.client.post("/api/chat", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("emotion"), "desperate")
        self.assertTrue(any(w in data.get("response", "").lower() for w in ["barata", "mata", "tire"]))

        # Ensure no "baka" exists across offline simulator responses
        from app.services.offline_simulator import offline_simulator
        sample_triggers = [
            "Olá", "Nullpo", "Dr Pepper", "Garfo", "Barata", "Okabe", 
            "Christina", "Divergência", "Promessa", "Você é linda", "Sorria", "Brava"
        ]
        for trig in sample_triggers:
            resp, emo, _ = offline_simulator(trig, {"name": "Makise Kurisu"}, [])
            self.assertNotIn("baka", resp.lower(), f"Found 'baka' in trigger '{trig}': {resp}")

    def test_12_anti_repetition_sanitizer(self):
        from app.services.emotion_service import sanitize_repetitive_openers, parse_tags
        # 1. Direct sanitizer check
        t1 = "Não me entenda mal, mas ver você assim me incomoda..."
        self.assertEqual(sanitize_repetitive_openers(t1), "Ver você assim me incomoda...")

        t2 = "N-não me entenda mal! Confiança cega não substitui testes."
        self.assertEqual(sanitize_repetitive_openers(t2), "Confiança cega não substitui testes.")

        t3 = "Não me entenda mal: eu gosto de ciência de verdade."
        self.assertEqual(sanitize_repetitive_openers(t3), "Eu gosto de ciência de verdade.")

        # 2. Check within parse_tags with emotion
        raw_msg = "Não me entenda mal, mas mexer nas minhas sinapses é perigoso! <!--emotion:tsundere-->"
        clean_text, emo, _ = parse_tags(raw_msg)
        self.assertEqual(clean_text, "Mexer nas minhas sinapses é perigoso!")
        self.assertEqual(emo, "tsundere")

    def test_13_canonical_physical_appearance(self):
        # 1. Offline Simulator physical description
        payload = {
            "message": "Pode descrever sua aparência física, trate isso como um debugging",
            "personaId": "kurisu"
        }
        res = self.client.post("/api/chat", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        resp = data.get("response", "").lower()
        self.assertIn("1,65", resp)
        self.assertIn("ruivo", resp)
        self.assertIn("violeta", resp)

        # 2. Check persona memory mem_36 exists
        res_p = self.client.get("/api/personas/kurisu")
        self.assertEqual(res_p.status_code, 200)
        mems = res_p.json().get("memories", [])
        mem_36 = next((m for m in mems if m.get("id") == "mem_36"), None)
        self.assertIsNotNone(mem_36)
        self.assertIn("ruivo", mem_36.get("content", "").lower())

    def test_14_directive_parser_and_comment_isolation(self):
        from app.services.emotion_service import parse_tags, infer_pose_and_camera

        # 1. Composite directive tag: emotion, pose, camera in a single tag
        composite_raw = "Não faça perguntas tão óbvias! <!--emotion:tsundere,pose:crossed_arms,camera:medium-->"
        clean, emo, _ = parse_tags(composite_raw)
        pose, cam = infer_pose_and_camera(composite_raw, emo)
        self.assertEqual(clean, "Não faça perguntas tão óbvias!")
        self.assertEqual(emo, "tsundere")
        self.assertEqual(pose, "crossed_arms")
        self.assertEqual(cam, "medium")

        # 2. Separate directive tags
        separate_raw = "Aqui estão os dados. <!--emotion:analytical--> <!--pose:crossed_arms--> <!--camera:closeup-->"
        clean_sep, emo_sep, _ = parse_tags(separate_raw)
        pose_sep, cam_sep = infer_pose_and_camera(separate_raw, emo_sep)
        self.assertEqual(clean_sep, "Aqui estão os dados.")
        self.assertEqual(emo_sep, "analytical")
        self.assertEqual(pose_sep, "crossed_arms")
        self.assertEqual(cam_sep, "closeup")

        # 3. Natural dialogue mentioning camera: or pose: outside comments
        natural_raw = "Minha camera: Sony HD. Qual sua pose: braços cruzados?"
        clean_nat, emo_nat, _ = parse_tags(natural_raw)
        pose_nat, cam_nat = infer_pose_and_camera(natural_raw, emo_nat)
        self.assertEqual(clean_nat, "Minha camera: Sony HD. Qual sua pose: braços cruzados?")
        self.assertEqual(pose_nat, "default")
        self.assertEqual(cam_nat, "closeup")

if __name__ == "__main__":
    unittest.main()


