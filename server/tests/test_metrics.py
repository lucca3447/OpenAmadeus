import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

import httpx
from fastapi.testclient import TestClient
from main import app
from app.db.memory_store import MemoryStore, memory_store
from app.services.metrics import MetricsRegistry, metrics_registry, percentile
from app.services.llm import orchestrator as orch_module
from app.services.qwen_tts.qwen_manager import QwenTTSManager

REAL_ASYNC_CLIENT = httpx.AsyncClient
KEY = "gsk_metrics0001"


def _sse(*deltas):
    lines = [f"data: {json.dumps({'choices': [{'delta': {'content': d}}]})}\n\n" for d in deltas]
    return ("".join(lines) + "data: [DONE]\n\n").encode()


def _mock_groq(chat_handler):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "llama-a-70b"}, {"id": "llama-b-70b"}]})
        return chat_handler(request)

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return REAL_ASYNC_CLIENT(*args, **kwargs)

    return patch.object(orch_module.httpx, "AsyncClient", factory)


def _read_sse_events(client, payload):
    events = []
    with client.stream("POST", "/api/chat/stream", json=payload) as res:
        assert res.status_code == 200
        for block in res.iter_text():
            for part in block.split("\n\n"):
                for line in part.splitlines():
                    if line.startswith("data:"):
                        events.append(json.loads(line[5:]))
    return events


class TestMetrics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls._initial_sessions = set(r["id"] for r in memory_store.list_sessions())

    @classmethod
    def tearDownClass(cls):
        created = set(r["id"] for r in memory_store.list_sessions()) - cls._initial_sessions
        if created:
            with memory_store._conn() as conn:
                for sid in created:
                    conn.execute("DELETE FROM messages WHERE session_id = ?", (sid,))
                    conn.execute("DELETE FROM sessions WHERE id = ?", (sid,))
                conn.commit()

    def setUp(self):
        metrics_registry.reset()

    def test_01_registry_percentiles_and_cold_vs_warm(self):
        reg = MetricsRegistry(maxlen=10)
        self.assertEqual(percentile([10.0, 20.0, 30.0, 40.0, 50.0], 50), 30.0)
        self.assertEqual(percentile([10.0, 20.0, 30.0, 40.0, 50.0], 95), 48.0)

        self.assertTrue(reg.mark_llm_cold_start("groq:abcd"))
        self.assertFalse(reg.mark_llm_cold_start("groq:abcd"))

        reg.record_chat({"status": "ok", "cold_start": True, "model_discovery_ms": 420.0, "total_ms": 1500.0, "rag_ms": 20.0})
        reg.record_chat({"status": "ok", "cold_start": False, "model_discovery_ms": 110.0, "total_ms": 500.0, "rag_ms": 15.0})
        reg.record_chat({"status": "error", "cold_start": False, "llm_fallback_attempts": 2, "total_ms": 300.0})

        snap = reg.snapshot()
        self.assertEqual(snap["counters"]["chat_total"], 3)
        self.assertEqual(snap["counters"]["chat_errors"], 1)
        self.assertEqual(snap["counters"]["llm_fallbacks"], 2)
        self.assertEqual(snap["chat"]["cold_vs_warm"]["cold_count"], 1)
        self.assertEqual(snap["chat"]["cold_vs_warm"]["cold_avg_total_ms"], 1500.0)
        self.assertEqual(snap["chat"]["cold_vs_warm"]["warm_count"], 1)
        self.assertEqual(snap["chat"]["cold_vs_warm"]["warm_avg_total_ms"], 500.0)

    def test_02_metrics_endpoints_and_reset(self):
        res = self.client.get("/api/metrics")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("counters", data)
        self.assertIn("chat", data)
        self.assertIn("tts", data)
        self.assertEqual(data["counters"]["chat_total"], 0)

        sid = memory_store.create_session()
        chat_res = self.client.post("/api/chat", json={"message": "Olá Kurisu", "sessionId": sid, "selectedModel": "offline"})
        self.assertEqual(chat_res.status_code, 200)
        body = chat_res.json()
        self.assertIsInstance(body.get("metrics"), dict)
        self.assertGreaterEqual(body["metrics"]["rag_ms"], 0.0)
        self.assertGreaterEqual(body["metrics"]["total_ms"], 0.0)

        snap = self.client.get("/api/metrics").json()
        self.assertEqual(snap["counters"]["chat_total"], 1)

        reset_res = self.client.post("/api/metrics/reset")
        self.assertEqual(reset_res.status_code, 200)
        self.assertEqual(self.client.get("/api/metrics").json()["counters"]["chat_total"], 0)

    def test_03_chat_stream_metrics_cold_warm_and_fallback_attempts(self):
        calls = []

        def chat_handler(request):
            model = json.loads(request.content)["model"]
            calls.append(model)
            if len(calls) == 1:
                return httpx.Response(429, text="rate_limit")
            return httpx.Response(
                200,
                content=_sse(
                    "<!--emotion:smug--> ",
                    "<!--ja:問題ないわ。--> Sem problemas, operador. ",
                    "Tudo funcionando.",
                ),
            )

        sid = memory_store.create_session()
        with _mock_groq(chat_handler):
            ev1 = _read_sse_events(self.client, {"message": "Teste 1", "apiKey": KEY, "sessionId": sid, "canonicalVoice": True})
            ev2 = _read_sse_events(self.client, {"message": "Teste 2", "apiKey": KEY, "sessionId": sid})

        m1 = ev1[-1]["response"]["metrics"]
        m2 = ev2[-1]["response"]["metrics"]
        self.assertTrue(m1["cold_start"])
        self.assertFalse(m2["cold_start"])
        self.assertEqual(m1["llm_fallback_attempts"], 1)
        self.assertEqual(m2["llm_fallback_attempts"], 0)
        self.assertGreaterEqual(m1["model_discovery_ms"], 0.0)
        self.assertIsNotNone(m1["llm_ttft_ms"])
        self.assertIsNotNone(m1["llm_first_sentence_ms"])
        self.assertEqual(m1["canonical_ja_tags"], 1)

        snap = self.client.get("/api/metrics").json()
        self.assertEqual(snap["counters"]["chat_total"], 2)
        self.assertEqual(snap["counters"]["llm_fallbacks"], 1)
        self.assertEqual(snap["chat"]["cold_vs_warm"]["cold_count"], 1)
        self.assertEqual(snap["chat"]["cold_vs_warm"]["warm_count"], 1)

    def test_04_tts_headers_and_stream_metrics(self):
        pcm_chunk = b"\x00\x01" * 24000  # 1.0s of 24kHz PCM16 mono

        async def fake_stream(**kwargs):
            async def _gen():
                yield pcm_chunk[:24000]
                yield pcm_chunk[24000:]
            return "audio/L16;rate=24000", _gen()

        with patch.object(QwenTTSManager, "synthesize_stream", side_effect=fake_stream):
            res = self.client.post(
                "/api/tts",
                json={"text": "Teste de métricas de voz.", "engine": "qwen3", "qwenMode": "remote", "stream": True},
            )
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.headers.get("x-tts-engine"), "qwen3")
            self.assertEqual(res.headers.get("x-tts-fallback"), "false")
            self.assertEqual(res.headers.get("x-tts-mode"), "remote")
            self.assertIsNotNone(res.headers.get("x-tts-handshake-ms"))
            self.assertEqual(len(res.content), len(pcm_chunk))

        snap = self.client.get("/api/metrics").json()
        self.assertEqual(snap["counters"]["tts_total"], 1)
        self.assertEqual(snap["counters"]["tts_fallbacks"], 0)
        last_tts = snap["tts"]["last"]
        self.assertEqual(last_tts["engine_used"], "qwen3")
        self.assertEqual(last_tts["audio_duration_s"], 1.0)
        self.assertIsNotNone(last_tts["ttfb_ms"])
        self.assertIsNotNone(last_tts["realtime_speed_x"])

    def test_05_model_discovery_cache_and_single_embedding_reuse(self):
        from app.services.llm.groq import clear_groq_model_cache

        clear_groq_model_cache()
        models_calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal models_calls
            if request.url.path.endswith("/models"):
                models_calls += 1
                return httpx.Response(200, json={"data": [{"id": "llama-a-70b"}]})
            return httpx.Response(200, content=_sse("<!--emotion:neutral--> Resposta rápida."))

        def factory(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(handler)
            return REAL_ASYNC_CLIENT(*args, **kwargs)

        sid = memory_store.create_session()
        with patch.object(orch_module.httpx, "AsyncClient", factory):
            _read_sse_events(self.client, {"message": "Turno 1 cache", "apiKey": "gsk_cache0001", "sessionId": sid})
            _read_sse_events(self.client, {"message": "Turno 2 cache", "apiKey": "gsk_cache0001", "sessionId": sid})
        self.assertEqual(models_calls, 1)

        # Verify embedding is computed only once across search_memories + get_learned_context + search_exemplars
        # Uses an isolated temporary store so CI environments with empty server/data/ still exercise real queries.
        with tempfile.TemporaryDirectory(prefix="amadeus_test_metrics_", ignore_cleanup_errors=True) as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = MemoryStore(sqlite_path=tmp_path / "metrics.db", chroma_dir=tmp_path / "memory_db")
            store.add_memory("research", "Curvas Temporais", "Equações de Kerr e paradoxo.", source="canonical")
            store.add_memory("user", "Estudo", "Pesquisa física teórica.", source="learned")
            store.exemplars_collection.upsert(
                ids=["ex_1"],
                documents=["Curvas temporais"],
                metadatas=[{"user": "Curvas temporais", "assistant": "Kerr.", "lang": "pt"}],
            )

            orig_ef = store.collection._embedding_function
            embed_calls = 0

            def counting_ef(texts):
                nonlocal embed_calls
                embed_calls += 1
                return orig_ef(texts)

            store._embed_cache.clear()
            with patch.object(store.collection, "_embedding_function", side_effect=counting_ef):
                q = "Pesquisa sobre curvas temporais fechadas"
                mems = store.search_memories(q, max_kurisu=2, max_learned=2)
                store.get_learned_context(q, precomputed_learned=[m for m in mems if m.get("source") == "learned"])
                store.search_exemplars(q, n_results=1, lang="pt")
            self.assertEqual(embed_calls, 1)


if __name__ == "__main__":
    unittest.main()
