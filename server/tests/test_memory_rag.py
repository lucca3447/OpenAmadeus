import json
import sys
import tempfile
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from app.db.memory_store import MemoryStore


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
            persona_data = json.load(f)
        cls.store.seed_canonical_memories(persona_data["memories"])

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
        # Update same topic with different wording and title
        m2 = self.store.add_memory(
            category="user",
            title="Moradia do Operador",
            content="O operador mudou-se e agora mora em Campinas.",
            emotional_weight="Curiosidade",
            source="learned",
        )
        self.assertEqual(m1["id"], m2["id"])

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
        updated = next(m for m in all_learned if m["id"] == m1["id"])
        self.assertIn("Campinas", updated["content"])

        deleted_count = self.store.clear_learned_memories()
        self.assertEqual(deleted_count, 2)
        self.assertEqual([m for m in self.store.get_all_memories() if m["source"] == "learned"], [])

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


if __name__ == "__main__":
    unittest.main()
