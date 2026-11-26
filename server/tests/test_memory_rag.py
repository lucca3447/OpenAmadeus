import json
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from app.db.memory_store import MemoryStore
from app.services.emotion_service import parse_tags


class TestMemoryRAG(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(prefix="amadeus_test_rag_", ignore_cleanup_errors=True)
        tmp_path = Path(cls._tmp.name)
        cls.store = MemoryStore(
            sqlite_path=tmp_path / "amadeus_test.db",
            chroma_dir=tmp_path / "memory_db",
        )

        kurisu_path = SERVER_DIR / "personas" / "kurisu.json"
        with open(kurisu_path, "r", encoding="utf-8") as f:
            cls.persona_data = json.load(f)
        cls.store.seed_canonical_memories(cls.persona_data["memories"])

        ex_path = SERVER_DIR / "training" / "kurisu_finetuning_dataset_enhanced.jsonl"
        cls.store.seed_exemplars(ex_path)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_01_greeting_returns_zero_and_science_returns_canonical(self):
        greeting_matches = self.store.search_memories("Boa noite! Até amanhã.")
        self.assertEqual(greeting_matches, [])

        ood_matches = self.store.search_memories("Qual a capital da Austrália?")
        self.assertEqual(ood_matches, [])

        science_matches = self.store.search_memories(
            "Como funciona a sua pesquisa de digitalizar memórias e sinapses no Amadeus?"
        )
        self.assertGreaterEqual(len(science_matches), 1)
        self.assertEqual(science_matches[0]["id"], "mem_01")

    def test_02_custom_memory_is_retrieved_in_kurisu_group(self):
        created = self.store.add_memory(
            category="research",
            title="Protocolo Quântico de Calibração",
            content="O protocolo de calibração harmônica usa ressonância de fase 4 nos sensores.",
            emotional_weight="Factual",
            source="custom",
        )
        try:
            matches = self.store.search_memories("Como funciona o protocolo de calibração harmônica de fase 4?")
            matched_ids = [m["id"] for m in matches]
            self.assertIn(created["id"], matched_ids)
        finally:
            self.store.delete_memory(created["id"])

    def test_03_semantic_upsert_and_clear_learned(self):
        self.store.clear_learned_memories()

        m1 = self.store.add_memory(
            category="user",
            title="Cidade do Operador",
            content="O operador mora em São Paulo.",
            emotional_weight="Simpatia",
            source="learned",
        )
        # Update same topic with different wording and title -> non-destructive bitemporal supersede
        m2 = self.store.add_memory(
            category="user",
            title="Moradia do Operador",
            content="O operador mudou-se e agora mora em Campinas.",
            emotional_weight="Curiosidade",
            source="learned",
        )
        self.assertNotEqual(m1["id"], m2["id"])
        self.assertEqual(m2.get("supersedes"), m1["id"])

        # Add an unrelated user fact
        m3 = self.store.add_memory(
            category="user",
            title="Animal de Estimação",
            content="Tem um gato preto chamado Schrödinger.",
            emotional_weight="Afeto",
            source="learned",
        )
        self.assertNotEqual(m1["id"], m3["id"])

        all_learned = [m for m in self.store.get_all_memories() if m["source"] == "learned"]
        self.assertEqual(len(all_learned), 2)
        updated = next(m for m in all_learned if m["id"] == m2["id"])
        self.assertIn("Campinas", updated["content"])

        all_with_hist = [m for m in self.store.get_all_memories(include_history=True) if m["source"] == "learned"]
        self.assertEqual(len(all_with_hist), 3)
        old_m1 = next(m for m in all_with_hist if m["id"] == m1["id"])
        self.assertIsNotNone(old_m1["validTo"])
        self.assertEqual(old_m1["supersededBy"], m2["id"])

        deleted_count = self.store.clear_learned_memories()
        self.assertEqual(deleted_count, 2)
        self.assertEqual([m for m in self.store.get_all_memories(include_history=True) if m["source"] == "learned"], [])

    def test_04_sanitization_and_length_bounds(self):
        long_content = "Linha 1\nLinha 2\r\n" + ("A" * 350)
        mem = self.store.add_memory(
            category="anecdote",
            title="Título\nCom Quebra",
            content=long_content,
            emotional_weight="Neutro",
            source="custom",
        )
        try:
            self.assertNotIn("\n", mem["title"])
            self.assertNotIn("\n", mem["content"])
            self.assertNotIn("\r", mem["content"])
            self.assertEqual(len(mem["content"]), 280)
        finally:
            self.store.delete_memory(mem["id"])

        with self.assertRaises(ValueError):
            self.store.add_memory("user", "   ", "conteúdo válido", "Factual", "learned")

    def test_05_exemplar_distance_cutoff(self):
        rel = self.store.search_exemplars("A viagem no tempo existe de verdade?")
        self.assertGreaterEqual(len(rel), 1)

        irrel = self.store.search_exemplars("Boa tarde.")
        self.assertEqual(irrel, [])

    def test_06_endpoint_clear_and_crud_wiring(self):
        from unittest.mock import patch
        import app.api.v1.endpoints.memory as mem_ep
        from app.schemas.memory import AddMemoryRequest

        with patch.object(mem_ep, "memory_store", self.store):
            created = mem_ep.create_memory(
                AddMemoryRequest(
                    title="Fato via Endpoint",
                    category="user",
                    content="Operador gosta de café expresso.",
                    emotionalWeight="Simpatia",
                    source="learned",
                )
            )
            self.assertIn("id", created)
            all_mems = mem_ep.get_memories()
            self.assertTrue(any(m["id"] == created["id"] for m in all_mems))

            cleared = mem_ep.clear_learned_memories()
            self.assertEqual(cleared["deletedCount"], 1)
            self.assertFalse(any(m["id"] == created["id"] for m in mem_ep.get_memories()))

    def test_07_rebuild_index_restores_chroma_from_sqlite(self):
        sqlite_total = len(self.store.get_all_memories())
        all_ids = (self.store.collection.get(include=[]) or {}).get("ids") or []
        if all_ids:
            self.store.collection.delete(ids=all_ids)
        self.assertEqual(self.store.collection.count(), 0)

        rebuilt = self.store.rebuild_index(self.persona_data["memories"])
        self.assertEqual(rebuilt, sqlite_total)
        self.assertEqual(self.store.collection.count(), sqlite_total)

        matches = self.store.search_memories("Como funciona a sua pesquisa de digitalizar memórias e sinapses no Amadeus?")
        self.assertGreaterEqual(len(matches), 1)
        self.assertEqual(matches[0]["id"], "mem_01")

    def test_08_remember_tag_formats_and_sqlite_wal(self):
        with self.store._conn() as conn:
            mode = conn.execute("PRAGMA journal_mode;").fetchone()[0]
            self.assertEqual(mode.lower(), "wal")

        # 1. Standard 3 fields
        _, _, l1 = parse_tags("Certo! <!--remember: Café | Gosta de café sem açúcar | Simpatia -->")
        self.assertIsNotNone(l1)
        self.assertEqual(l1.title, "Café")
        self.assertEqual(l1.content, "Gosta de café sem açúcar")
        self.assertEqual(l1.emotionalWeight, "Simpatia")

        # 2. Only 2 fields (no emotion field)
        _, _, l2 = parse_tags("Entendi. <!-- remember : Linguagem | Usa Python e TypeScript -->")
        self.assertIsNotNone(l2)
        self.assertEqual(l2.title, "Linguagem")
        self.assertEqual(l2.content, "Usa Python e TypeScript")
        self.assertEqual(l2.emotionalWeight, "Factual")

        # 3. Extra pipe inside content (4 fields -> middle joined)
        _, _, l3 = parse_tags("Anotado. <!--remember: Stack | Frontend: React | Backend: FastAPI | Curiosidade-->")
        self.assertIsNotNone(l3)
        self.assertEqual(l3.title, "Stack")
        self.assertEqual(l3.content, "Frontend: React | Backend: FastAPI")
        self.assertEqual(l3.emotionalWeight, "Curiosidade")

        # 4. Template placeholder rejected
        _, _, l4 = parse_tags("Olá! <!--remember: título curto | fato memorizado | sentimento-->")
        self.assertIsNone(l4)

        # 5. Malformed tag without colon and closed with >> is stripped from dialogue and meta-testing noise is rejected
        clean5, _, l5 = parse_tags(
            "O que exatamente você espera que eu lembre? <!--remember operador testou a capacidade de memória em sessões diferentes|testou a capacidade de memória persistente|Curiosidade>>"
        )
        self.assertNotIn("<!--", clean5)
        self.assertNotIn(">>", clean5)
        self.assertIsNone(l5)

        # 6. Malformed tag without colon + >> but with a valid personal fact still parses and strips cleanly
        clean6, _, l6 = parse_tags("Anotado! <!--remember Cidade do Operador|O operador mora em Santa Bárbara, Bahia|Curiosidade>>")
        self.assertEqual(clean6, "Anotado!")
        self.assertIsNotNone(l6)
        self.assertEqual(l6.title, "Cidade do Operador")

    def test_09_rolling_context_summary_and_db_history_resolution(self):
        from app.services.llm.orchestrator import LLMOrchestrator

        orch = LLMOrchestrator()
        sess_id = self.store.create_session()
        self.store.save_message(sess_id, sender="user", content="Oi, meu nome é João.")
        self.store.save_message(sess_id, sender="amadeus", content="Olá João, aqui é a Kurisu.")

        from unittest.mock import patch
        import app.services.llm.orchestrator as orch_mod
        with patch.object(orch_mod, "memory_store", self.store):
            turns = orch._resolve_history_turns(sess_id, [])
            self.assertEqual(len(turns), 2)
            self.assertEqual(turns[0]["role"], "user")
            self.assertEqual(turns[1]["role"], "assistant")

        self.assertEqual(self.store.get_session_context_summary(sess_id), "")
        self.store.update_session_context_summary(sess_id, "Operador apresentou-se como João e iniciou conversa no laboratório.")
        self.assertIn("João", self.store.get_session_context_summary(sess_id))

    def test_10_get_learned_context_cross_session_recall(self):
        self.store.clear_learned_memories()
        sb = self.store.add_memory(
            category="user",
            title="Localização",
            content="Santa Bárbara, Bahia",
            emotional_weight="Curiosidade",
            source="learned",
        )
        # Even when query is 1st-person ("onde eu moro?") with distance > 1.00,
        # get_learned_context returns the operator profile without duplicates.
        ctx = self.store.get_learned_context("onde eu moro?", limit=8)
        ids = [m["id"] for m in ctx]
        self.assertIn(sb["id"], ids)
        self.assertEqual(len(ids), len(set(ids)))

        # Verify limit cap when distinct unrelated learned facts are added afterwards
        for title, content in [
            ("Animal de Estimação", "Tem um gato preto chamado Schrödinger."),
            ("Instrumento Musical", "Toca violão clássico desde criança."),
            ("Gastronomia", "Adora comer lámen apimentado no jantar."),
            ("Esporte", "Pratica natação todas as manhãs de sábado."),
        ]:
            self.store.add_memory("user", title, content, "Factual", "learned")

        capped = self.store.get_learned_context("onde eu moro?", limit=3)
        self.assertEqual(len(capped), 3)
        self.assertNotIn(sb["id"], [m["id"] for m in capped])
        self.store.clear_learned_memories()

    def test_11_end_of_call_close_session_and_lorebook(self):
        from app.services.llm.orchestrator import match_lorebook

        # 1. Deterministic Lorebook matches all 5 canonical targets and ignores greetings
        self.assertEqual(match_lorebook("Bom dia, tudo bem?"), [])
        hits = match_lorebook(
            "Me explique como o IBN 5100, o SERN, o Prof. Leskinen e um Kerr Black Hole se conectam na Operação Skuld."
        )
        hit_ids = {h["id"] for h in hits}
        self.assertEqual(hit_ids, {"lore_ibn5100", "lore_sern", "lore_leskinen", "lore_kerr", "lore_skuld"})

        # 2. Single-pass close_session summary + lazy auto-summarize on next session
        s1 = self.store.create_session()
        self.store.save_message(s1, sender="user", content="Vamos revisar o código do PhoneWave hoje.")
        self.store.save_message(s1, sender="amadeus", content="Certo, já abri os logs dos sensores.", emotion="analytical")
        summary = self.store.close_session(s1)
        self.assertIn("PhoneWave", summary)
        self.assertIn("analytical", summary)
        self.assertEqual(self.store.get_session_context_summary(s1), summary)
        s1_meta = next(s for s in self.store.list_sessions() if s["id"] == s1)
        self.assertIsNotNone(s1_meta["endedAt"])

        # 3. Unclosed session is automatically summarized when a new session starts
        s2 = self.store.create_session()
        self.store.save_message(s2, sender="user", content="Testando estabilização do buraco negro de Kerr.")
        self.store.save_message(s2, sender="amadeus", content="A singularidade em anel exige um lifter.", emotion="thinking")
        s3 = self.store.create_session()
        ep = self.store.get_temporal_and_episodic_context(s3, is_system_event=True)
        self.assertIn("Kerr", ep["lastSessionTopic"])
        self.assertIn("singularidade em anel", ep["lastSessionTopic"])

    def test_12_connection_scope_reentrancy_and_row_factory(self):
        memory_store_mod = sys.modules["app.db.memory_store"]
        with tempfile.TemporaryDirectory(prefix="amadeus_test_scope_", ignore_cleanup_errors=True) as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = MemoryStore(sqlite_path=tmp_path / "scope.db", chroma_dir=tmp_path / "memory_db")

            with patch.object(memory_store_mod.sqlite3, "connect", wraps=sqlite3.connect) as connect_spy:
                with store.connection_scope() as outer_conn:
                    sid = store.create_session()
                    with store.connection_scope() as inner_conn:
                        self.assertIs(outer_conn, inner_conn)
                        store.save_message(sid, sender="user", content="Olá Kurisu")
                        msgs = store.get_session_messages(sid)
                        self.assertEqual(len(msgs), 1)
                        self.assertIsNone(outer_conn.row_factory)
                        self.assertEqual(store.get_session_context_summary(sid), "")
                        store.get_temporal_and_episodic_context(sid)

                        with self.assertRaises(RuntimeError):
                            with store._conn() as tx_conn:
                                tx_conn.execute(
                                    "INSERT INTO sessions (id, started_at) VALUES (?, ?)",
                                    ("sess_rolled_back", 1.0),
                                )
                                raise RuntimeError("force rollback")

                    sessions = store.list_sessions()
                    self.assertFalse(any(s["id"] == "sess_rolled_back" for s in sessions))
                    self.assertTrue(any(s["id"] == sid for s in sessions))

                self.assertEqual(connect_spy.call_count, 1)
                self.assertIsNone(getattr(store._local, "conn", None))

    def test_13_query_memory_group_without_collection_get(self):
        self.store.clear_learned_memories()
        with patch.object(self.store.collection, "get", side_effect=AssertionError("collection.get should not be called")):
            matches_zero = self.store.search_memories("Como funciona a sua pesquisa de digitalizar memórias no Amadeus?")
            self.assertGreaterEqual(len(matches_zero), 1)
            self.assertEqual(matches_zero[0]["id"], "mem_01")

        self.store.add_memory("user", "Cidade Natal", "O operador mora em Recife.", source="learned")
        try:
            self.store._embed_cache.clear()
            with patch.object(self.store.collection, "get", side_effect=AssertionError("collection.get should not be called")):
                matches_one = self.store.search_memories("Em qual cidade o operador mora?")
                self.assertGreaterEqual(len(matches_one), 1)
        finally:
            self.store.clear_learned_memories()

    def test_14_add_memory_reuses_single_embedding(self):
        with tempfile.TemporaryDirectory(prefix="amadeus_test_add_embed_", ignore_cleanup_errors=True) as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = MemoryStore(sqlite_path=tmp_path / "add_embed.db", chroma_dir=tmp_path / "memory_db")
            store.add_memory("user", "Cidade do Operador", "O operador mora em São Paulo.", source="learned")

            orig_ef = store.embedding_fn
            embed_calls = 0

            def counting_ef(texts):
                nonlocal embed_calls
                embed_calls += 1
                return orig_ef(texts)

            store._embed_cache.clear()
            with patch.object(store, "embedding_fn", side_effect=counting_ef):
                updated = store.add_memory("user", "Moradia Atual", "O operador mudou-se e agora mora em Campinas.", source="learned")
            self.assertEqual(embed_calls, 1)
            matches = store.search_memories("Onde o operador mora atualmente em Campinas?")
            self.assertTrue(any(m["id"] == updated["id"] for m in matches))

    def test_15_embed_query_releases_lock_during_inference(self):
        with tempfile.TemporaryDirectory(prefix="amadeus_test_lock_", ignore_cleanup_errors=True) as tmp_dir:
            tmp_path = Path(tmp_dir)
            barrier = threading.Barrier(2, timeout=2.0)

            def concurrent_ef(texts):
                barrier.wait()
                return [[0.1, 0.2, 0.3, 0.4] for _ in texts]

            store = MemoryStore(
                sqlite_path=tmp_path / "lock.db",
                chroma_dir=tmp_path / "memory_db",
            )

            results = {}
            errors = []

            def run_query(name: str, q: str):
                try:
                    results[name] = store._embed_query(q)
                except Exception as exc:
                    errors.append(exc)

            with patch.object(store, "embedding_fn", side_effect=concurrent_ef):
                t1 = threading.Thread(target=run_query, args=("t1", "query alpha"))
                t2 = threading.Thread(target=run_query, args=("t2", "query beta"))
                t1.start()
                t2.start()
                t1.join(timeout=3.0)
                t2.join(timeout=3.0)

            self.assertEqual(errors, [])
            self.assertEqual(results.get("t1"), [0.1, 0.2, 0.3, 0.4])
            self.assertEqual(results.get("t2"), [0.1, 0.2, 0.3, 0.4])
            self.assertIn("query alpha", store._embed_cache)
            self.assertIn("query beta", store._embed_cache)

    def test_16_persistent_ef_matches_default_and_handles_batch(self):
        import numpy as np
        from chromadb.utils.embedding_functions.onnx_mini_lm_l6_v2 import ONNXMiniLM_L6_V2
        from app.db.memory_store import _PersistentDefaultEF

        ef = _PersistentDefaultEF()
        self.assertEqual(ef.name(), "default")

        q = "Como funciona a digitalização de memórias no Amadeus?"
        v_fast = np.array(ef([q])[0], dtype=np.float32)
        v_ref = np.array(ONNXMiniLM_L6_V2()([q])[0], dtype=np.float32)
        self.assertLess(float(np.max(np.abs(v_fast - v_ref))), 1e-5)

        batch = ef(["Oi", "Texto significativamente mais longo sobre física teórica e buracos negros de Kerr."])
        self.assertEqual(len(batch), 2)
        self.assertEqual(len(batch[0]), len(v_ref))
        self.assertEqual(len(batch[1]), len(v_ref))

        long_text = " ".join(["neurociência", "sinapse", "paradoxo", "kerr", "amadeus"] * 70)
        self.assertEqual(len(ef._single_tokenizer.encode(long_text).ids), 256)
        v_long = np.array(ef([long_text])[0], dtype=np.float32)
        v_long_ref = np.array(ONNXMiniLM_L6_V2()([long_text])[0], dtype=np.float32)
        self.assertEqual(len(v_long), len(v_ref))
        self.assertTrue(bool(np.all(np.isfinite(v_long))))
        self.assertLess(float(np.max(np.abs(v_long - v_long_ref))), 1e-5)


if __name__ == "__main__":
    unittest.main()
