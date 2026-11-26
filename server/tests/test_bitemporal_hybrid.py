import json
import os
import sqlite3
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from main import app
from app.db.memory_store import MemoryStore, memory_store
from app.db.temporal_backend import (
    GraphitiHttpBackend,
    SQLiteBitemporalBackend,
    build_temporal_backend,
)


class TestBitemporalAndHybridRAG(unittest.TestCase):
    def test_01_legacy_sqlite_migration_backfills_bitemporal_and_fts5(self):
        with tempfile.TemporaryDirectory(prefix="amadeus_legacy_db_", ignore_cleanup_errors=True) as tmp_dir:
            tmp_path = Path(tmp_dir)
            db_path = tmp_path / "legacy.db"
            conn = sqlite3.connect(db_path)
            conn.execute(
                """
                CREATE TABLE memories (
                    id TEXT PRIMARY KEY,
                    category TEXT,
                    title TEXT,
                    content TEXT,
                    emotional_weight TEXT,
                    source TEXT,
                    created_at REAL
                )
                """
            )
            conn.execute(
                "INSERT INTO memories (id, category, title, content, emotional_weight, source, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("mem_legacy_1", "user", "Projeto Antigo", "Trabalhando no protótipo Amadeus.", "Factual", "learned", 1700000000.0),
            )
            conn.commit()
            conn.close()

            store = MemoryStore(sqlite_path=db_path, chroma_dir=tmp_path / "chroma")
            all_rows = store.get_all_memories()
            self.assertEqual(len(all_rows), 1)
            self.assertEqual(all_rows[0]["validFrom"], 1700000000.0)
            self.assertIsNone(all_rows[0]["validTo"])
            self.assertEqual(all_rows[0]["confidence"], 0.85)

            with store._conn() as c:
                fts_count = c.execute("SELECT COUNT(*) FROM memories_fts").fetchone()[0]
                self.assertEqual(fts_count, 1)

    def test_02_bitemporal_superseding_chain_reinforcement_and_as_of(self):
        with tempfile.TemporaryDirectory(prefix="amadeus_bitemporal_", ignore_cleanup_errors=True) as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = MemoryStore(sqlite_path=tmp_path / "bt.db", chroma_dir=tmp_path / "chroma")

            # Seed first fact, reinforce identically, then supersede twice
            m1 = store.add_memory("user", "Cidade do Operador", "O operador mora em São Paulo.", confidence=0.70)
            t_v1 = m1["validFrom"] + 1e-5
            time.sleep(0.002)

            m1_reinforced = store.add_memory("user", "Cidade do Operador", "O operador mora em São Paulo.", confidence=0.92)
            self.assertEqual(m1_reinforced["id"], m1["id"])
            self.assertTrue(m1_reinforced.get("reinforced"))
            self.assertEqual(m1_reinforced["accessCount"], 1)
            self.assertAlmostEqual(m1_reinforced["confidence"], 0.92, places=3)

            time.sleep(0.002)
            m2 = store.add_memory("user", "Moradia do Operador", "O operador mudou-se e agora mora em Campinas.", confidence=0.88)
            t_v2 = m2["validFrom"] + 1e-5

            time.sleep(0.002)
            m3 = store.add_memory("user", "Cidade Atual", "O operador mudou-se e agora mora em Curitiba.", confidence=0.95)
            t_v3 = m3["validFrom"] + 1e-5

            self.assertEqual(m2.get("supersedes"), m1["id"])
            self.assertEqual(m3.get("supersedes"), m2["id"])

            # Active list shows only Curitiba; full history shows all 3 versions
            active = store.get_all_memories()
            self.assertEqual([m["id"] for m in active], [m3["id"]])

            chain_from_mid = store.get_memory_history(m2["id"])
            self.assertEqual([c["id"] for c in chain_from_mid], [m1["id"], m2["id"], m3["id"]])
            self.assertIsNotNone(chain_from_mid[0]["validTo"])
            self.assertIsNotNone(chain_from_mid[1]["validTo"])
            self.assertIsNone(chain_from_mid[2]["validTo"])

            # Point-in-time queries reconstruct exact historical truth
            snap_v1 = store.get_all_memories(as_of=t_v1)
            self.assertEqual([m["id"] for m in snap_v1], [m1["id"]])
            snap_v2 = store.get_all_memories(as_of=t_v2)
            self.assertEqual([m["id"] for m in snap_v2], [m2["id"]])

            as_of_res_v1 = store.search_memories("onde o operador mora?", as_of=t_v1)
            self.assertTrue(any("São Paulo" in r["content"] for r in as_of_res_v1))
            as_of_res_v2 = store.search_memories("onde o operador mora?", as_of=t_v2)
            self.assertTrue(any("Campinas" in r["content"] for r in as_of_res_v2))
            as_of_res_v3 = store.search_memories("onde o operador mora?", as_of=t_v3)
            self.assertTrue(any("Curitiba" in r["content"] for r in as_of_res_v3))

    def test_03_hybrid_fts_rrf_rescues_lexical_gaps_and_rejects_noise(self):
        with tempfile.TemporaryDirectory(prefix="amadeus_hybrid_", ignore_cleanup_errors=True) as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = MemoryStore(sqlite_path=tmp_path / "hyb.db", chroma_dir=tmp_path / "chroma")
            kurisu_data = json.loads((SERVER_DIR / "personas" / "kurisu.json").read_text(encoding="utf-8"))
            store.seed_canonical_memories(kurisu_data["memories"])

            store.add_memory("user", "Perfil de João Lucca", "Mora em São Paulo e estuda engenharia de software.", confidence=0.85)
            l2 = store.add_memory("user", "Projeto Atual", "Está programando o sistema OpenAmadeus em Python e React.", confidence=0.90)

            # Previously missed completely by vector-only MiniLM -> FTS5+RRF rescues at Rank 1
            drink_hits = store.search_memories("Qual é a sua bebida favorita para tomar no laboratório?", max_kurisu=2, max_learned=2)
            self.assertTrue(drink_hits, "mem_07 should be rescued by Hybrid FTS5 + RRF")
            self.assertEqual(drink_hits[0]["id"], "mem_07")

            # Previously rank 2 -> FTS5+RRF promotes Projeto Atual above Perfil
            proj_hits = store.search_memories("Qual é o projeto que o operador está programando?", max_kurisu=2, max_learned=2)
            self.assertTrue(proj_hits)
            self.assertEqual(proj_hits[0]["id"], l2["id"])

            # Greetings & OOD must still return 0 results (FP rejection = 1.00)
            for noise_q in (
                "Oi Kurisu!",
                "Boa noite! Até amanhã.",
                "Quanto é 25 multiplicado por 4?",
                "Me explica como funciona um motor a combustão.",
                "Qual o melhor tempero para fazer arroz?",
            ):
                self.assertEqual(store.search_memories(noise_q), [], msg=f"Noise leaked for {noise_q!r}")

    def test_04_actr_confidence_and_recency_tie_breaker(self):
        with tempfile.TemporaryDirectory(prefix="amadeus_actr_", ignore_cleanup_errors=True) as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = MemoryStore(sqlite_path=tmp_path / "actr.db", chroma_dir=tmp_path / "chroma")

            # Add two custom memories with identical lexical salience on 'telemetria'
            low_b = store.add_memory("research", "Telemetria Alpha", "Protocolo alpha de telemetria.", source="custom", confidence=0.20)
            high_b = store.add_memory("research", "Telemetria Beta", "Protocolo beta de telemetria.", source="custom", confidence=0.98)

            hits = store.search_memories("protocolo telemetria", max_kurisu=2, max_learned=0)
            self.assertEqual(len(hits), 2)
            self.assertEqual(hits[0]["id"], high_b["id"])
            self.assertGreater(hits[0]["rrfScore"], hits[1]["rrfScore"])
            self.assertEqual(hits[1]["id"], low_b["id"])

    def test_05_temporal_backend_adapter_and_history_endpoints(self):
        # 1. Pluggable backend defaults to sqlite and fails open from unreachable Graphiti HTTP bridge
        with tempfile.TemporaryDirectory(prefix="amadeus_backend_", ignore_cleanup_errors=True) as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = MemoryStore(sqlite_path=tmp_path / "adp.db", chroma_dir=tmp_path / "chroma")
            sqlite_b = build_temporal_backend(store)
            self.assertIsInstance(sqlite_b, SQLiteBitemporalBackend)
            sqlite_b.record_fact(category="user", title="Café", content="Gosta de café preto sem açúcar.", confidence=0.9)

            def _failing_transport(req: httpx.Request) -> httpx.Response:
                raise httpx.ConnectError("bridge down", request=req)

            bad_client = httpx.Client(transport=httpx.MockTransport(_failing_transport))
            graph_b = GraphitiHttpBackend(
                "http://127.0.0.1:8088",
                fallback=sqlite_b,
                timeout_sec=0.1,
                client=bad_client,
            )
            results = graph_b.search("café preto sem açúcar", limit=2)
            self.assertGreaterEqual(len(results), 1)
            self.assertTrue(graph_b.health()["degradedToSqlite"])
            bad_client.close()

            with patch.dict(os.environ, {"AMADEUS_GRAPH_BACKEND": "graphiti", "AMADEUS_GRAPH_URL": "http://127.0.0.1:8088"}):
                built = build_temporal_backend(store)
                self.assertIsInstance(built, GraphitiHttpBackend)

        # 2. REST endpoints /api/memories?include_history=true, ?as_of= and /api/memories/{id}/history
        orig_learned = [m for m in memory_store.get_all_memories(include_history=True) if m["source"] == "learned"]
        m1 = memory_store.add_memory("user", "Ferramenta Teste Bitemporal", "Usa Jest para testes unitários.", confidence=0.80)
        time.sleep(0.002)
        t_mid = m1["validFrom"] + 1e-5
        m2 = memory_store.add_memory("user", "Ferramenta Teste Bitemporal", "Migrou para Vitest nos testes.", confidence=0.95)
        try:
            with TestClient(app) as client:
                active_res = client.get("/api/memories")
                self.assertEqual(active_res.status_code, 200)
                active_ids = {m["id"] for m in active_res.json()}
                self.assertIn(m2["id"], active_ids)
                self.assertNotIn(m1["id"], active_ids)

                hist_res = client.get("/api/memories", params={"include_history": "true"})
                self.assertEqual(hist_res.status_code, 200)
                hist_ids = {m["id"] for m in hist_res.json()}
                self.assertIn(m1["id"], hist_ids)
                self.assertIn(m2["id"], hist_ids)

                asof_res = client.get("/api/memories", params={"as_of": t_mid})
                self.assertEqual(asof_res.status_code, 200)
                asof_ids = {m["id"] for m in asof_res.json()}
                self.assertIn(m1["id"], asof_ids)
                self.assertNotIn(m2["id"], asof_ids)

                chain_res = client.get(f"/api/memories/{m1['id']}/history")
                self.assertEqual(chain_res.status_code, 200)
                chain = chain_res.json()["chain"]
                self.assertEqual([c["id"] for c in chain], [m1["id"], m2["id"]])
        finally:
            # Clean up created synthetic records without touching user's real learned facts
            orig_ids = {m["id"] for m in orig_learned}
            with memory_store._conn() as conn:
                for mid in (m1["id"], m2["id"]):
                    if mid not in orig_ids:
                        conn.execute("DELETE FROM memories WHERE id = ?", (mid,))
                        memory_store._delete_fts_ids(conn, [mid])
                conn.commit()
            try:
                memory_store.collection.delete(ids=[m2["id"]])
            except Exception:
                pass


if __name__ == "__main__":
    unittest.main()
