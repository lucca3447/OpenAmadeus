import asyncio
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

import httpx
from fastapi.testclient import TestClient

from main import app
from app.db.memory_store import MemoryStore, memory_store
from app.schemas.chat import ChatRequest
from app.schemas.cognitive import CoreMemoryPatch, ExtractedFact, SleepTimeConsolidation
from app.services.cognitive_worker import CognitiveWorker, cognitive_worker
from app.services.llm import background as bg_module
from app.services.llm import orchestrator as orch_module
from app.services.llm.background import complete_background, sanitize_gemini_schema
from app.services.metrics import MetricsRegistry, metrics_registry

REAL_ASYNC_CLIENT = httpx.AsyncClient

_FORBIDDEN_GEMINI_KEYS = {
    "$defs",
    "definitions",
    "$ref",
    "additionalProperties",
    "title",
    "default",
    "examples",
    "anyOf",
    "oneOf",
    "allOf",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "pattern",
    "const",
}


def _walk_schema_nodes(node, visitor):
    if not isinstance(node, dict):
        return
    visitor(node)
    props = node.get("properties")
    if isinstance(props, dict):
        for prop_schema in props.values():
            _walk_schema_nodes(prop_schema, visitor)
    if isinstance(node.get("items"), dict):
        _walk_schema_nodes(node["items"], visitor)


class TestGeminiSchemaSanitizer(unittest.TestCase):
    def test_01_sanitize_sleep_time_schema_removes_unsupported_keys_and_preserves_structure(self):
        raw = SleepTimeConsolidation.model_json_schema()
        sanitized = sanitize_gemini_schema(raw)

        found_forbidden = []
        object_nodes = []

        def check_node(node):
            for k in node:
                if k in _FORBIDDEN_GEMINI_KEYS:
                    found_forbidden.append(k)
            if node.get("type") == "OBJECT":
                object_nodes.append(node)
                props = node.get("properties")
                self.assertIsInstance(props, dict)
                self.assertGreater(len(props), 0)
                for req in node.get("required", []):
                    self.assertIn(req, props)

        _walk_schema_nodes(sanitized, check_node)
        self.assertEqual(found_forbidden, [])
        self.assertGreaterEqual(len(object_nodes), 3)

        patch_props = sanitized["properties"]["core_memory_updates"]["properties"]
        for key in ("operator_profile", "current_projects", "preferences", "open_loops"):
            self.assertEqual(patch_props[key]["type"], "STRING")
            self.assertTrue(patch_props[key]["nullable"])

        facts_schema = sanitized["properties"]["facts"]
        self.assertEqual(facts_schema["type"], "ARRAY")
        self.assertEqual(facts_schema["items"]["type"], "OBJECT")
        self.assertEqual(facts_schema["items"]["properties"]["category"]["enum"], [
            "user", "research", "relationship", "anecdote", "biography"
        ])


class TestBackgroundRunner(unittest.IsolatedAsyncioTestCase):
    def _mock_transport(self, handler):
        def factory(*args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(handler)
            return REAL_ASYNC_CLIENT(*args, **kwargs)

        return patch.object(bg_module.httpx, "AsyncClient", factory)

    async def test_01_gemini_happy_path_and_thought_filtering(self):
        captured = {}
        valid_payload = {
            "session_summary": "Debate sobre design de agentes e memória.",
            "core_memory_updates": {"current_projects": "OpenAmadeus Cognitive Core"},
            "facts": [
                {
                    "title": "Foco de Estudo",
                    "content": "Preparando entrevistas de engenharia de IA.",
                    "category": "user",
                    "confidence": 0.92,
                    "emotional_weight": "Determinação",
                }
            ],
        }

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["body"] = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {"thought": True, "text": "internal scratchpad"},
                                    {"text": json.dumps(valid_payload)},
                                ]
                            }
                        }
                    ]
                },
            )

        env = {
            "AMADEUS_BG_PROVIDER": "auto",
            "GEMINI_API_KEY": "gem_test_key",
            "GROQ_API_KEY": "gsk_test_key",
        }
        with patch.dict(os.environ, env, clear=False), self._mock_transport(handler):
            res = await complete_background("Consolidate session", SleepTimeConsolidation)

        self.assertIsNotNone(res.data)
        self.assertEqual(res.provider, "gemini")
        self.assertEqual(res.schema_retries, 0)
        self.assertEqual(res.failovers, 0)
        self.assertEqual(
            captured["body"]["generationConfig"]["responseMimeType"],
            "application/json",
        )
        self.assertIn("responseSchema", captured["body"]["generationConfig"])
        self.assertEqual(
            res.data.core_memory_updates.current_projects,
            "OpenAmadeus Cognitive Core",
        )
        self.assertEqual(len(res.data.facts), 1)

    async def test_02_schema_validation_retry_recovers_on_second_attempt(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            calls.append(body)
            if len(calls) == 1:
                text = "{not-valid-json"
            else:
                text = "```json\n" + json.dumps({
                    "session_summary": "Resumo corrigido após erro de schema.",
                    "core_memory_updates": {"preferences": "Prefere respostas diretas."},
                    "facts": [],
                }) + "\n```"
            return httpx.Response(
                200,
                json={"candidates": [{"content": {"parts": [{"text": text}]}}]},
            )

        env = {"AMADEUS_BG_PROVIDER": "gemini", "GEMINI_API_KEY": "gem_retry_key"}
        with patch.dict(os.environ, env, clear=False), self._mock_transport(handler):
            res = await complete_background("Consolidate", SleepTimeConsolidation, max_retries=1)

        self.assertEqual(len(calls), 2)
        self.assertIsNotNone(res.data)
        self.assertEqual(res.schema_retries, 1)
        self.assertEqual(res.failovers, 0)
        self.assertEqual(res.data.core_memory_updates.preferences, "Prefere respostas diretas.")
        self.assertIn("failed validation", calls[1]["contents"][-1]["parts"][0]["text"])

    async def test_03_gemini_failure_fails_over_to_groq(self):
        seen_hosts = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen_hosts.append(request.url.host)
            if "googleapis.com" in request.url.host:
                return httpx.Response(429, text="quota exceeded")
            body = json.loads(request.content)
            self.assertEqual(body["response_format"], {"type": "json_object"})
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps({
                                    "session_summary": "Consolidado via Groq failover.",
                                    "core_memory_updates": {"open_loops": "Revisar fatia 1"},
                                    "facts": [],
                                })
                            }
                        }
                    ]
                },
            )

        env = {
            "AMADEUS_BG_PROVIDER": "auto",
            "GEMINI_API_KEY": "gem_429_key",
            "GROQ_API_KEY": "gsk_ok_key",
        }
        with patch.dict(os.environ, env, clear=False), self._mock_transport(handler):
            res = await complete_background("Consolidate", SleepTimeConsolidation)

        self.assertIsNotNone(res.data)
        self.assertEqual(res.provider, "groq")
        self.assertEqual(res.failovers, 1)
        self.assertEqual(len(seen_hosts), 2)
        self.assertEqual(res.data.core_memory_updates.open_loops, "Revisar fatia 1")

    async def test_04_offline_and_total_failure_degrade_safely(self):
        http_calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal http_calls
            http_calls += 1
            return httpx.Response(500, text="server error")

        env_offline = {"AMADEUS_BG_PROVIDER": "auto", "GEMINI_API_KEY": "", "GROQ_API_KEY": ""}
        with patch.dict(os.environ, env_offline, clear=False), self._mock_transport(handler):
            res_off = await complete_background("Consolidate", SleepTimeConsolidation)

        self.assertIsNone(res_off.data)
        self.assertEqual(res_off.provider, "offline")
        self.assertEqual(http_calls, 0)

        env_fail = {
            "AMADEUS_BG_PROVIDER": "auto",
            "GEMINI_API_KEY": "gem_fail",
            "GROQ_API_KEY": "gsk_fail",
        }
        with patch.dict(os.environ, env_fail, clear=False), self._mock_transport(handler):
            res_fail = await complete_background("Consolidate", SleepTimeConsolidation)

        self.assertIsNone(res_fail.data)
        self.assertIsNotNone(res_fail.error)
        self.assertEqual(res_fail.failovers, 1)


class TestCognitiveCoreAndWorker(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="amadeus_test_cog_", ignore_cleanup_errors=True)
        tmp_path = Path(self._tmp.name)
        self.sqlite_path = tmp_path / "cog.db"
        self.chroma_dir = tmp_path / "chroma"
        self.store = MemoryStore(sqlite_path=self.sqlite_path, chroma_dir=self.chroma_dir)
        self.metrics = MetricsRegistry(maxlen=20)

    def tearDown(self):
        self._tmp.cleanup()

    def test_01_core_memory_ram_cache_persistence_sanitization_and_preservation(self):
        self.assertEqual(self.store.get_core_memory_snapshot(), {})
        self.assertEqual(self.store.format_core_memory_block("pt"), "")

        dirty_profile = "Operador:\nLucca\x07\t" + ("X" * 450)
        snap1 = self.store.apply_core_memory_patch({
            "operator_profile": dirty_profile,
            "current_projects": "OpenAmadeus v0.4.0",
            "unknown_key": "ignored",
        })
        self.assertEqual(set(snap1.keys()), {"operator_profile", "current_projects"})
        self.assertEqual(len(snap1["operator_profile"]["content"]), 400)
        self.assertNotIn("\n", snap1["operator_profile"]["content"])
        self.assertNotIn("\x07", snap1["operator_profile"]["content"])
        self.assertEqual(snap1["operator_profile"]["version"], 1)

        # Empty/None values never overwrite valid Core Memory blocks
        snap2 = self.store.apply_core_memory_patch({
            "operator_profile": "",
            "current_projects": "OpenAmadeus Cognitive Core",
            "preferences": None,
        })
        self.assertEqual(snap2["operator_profile"]["version"], 1)
        self.assertEqual(snap2["current_projects"]["version"], 2)
        self.assertEqual(snap2["current_projects"]["content"], "OpenAmadeus Cognitive Core")

        # Hot-path read must be strictly RAM-only (zero SQLite I/O)
        with patch.object(self.store, "_conn", side_effect=AssertionError("SQLite accessed on hot path")):
            ram_snap = self.store.get_core_memory_snapshot()
            formatted = self.store.format_core_memory_block("pt")
        self.assertEqual(ram_snap["current_projects"]["content"], "OpenAmadeus Cognitive Core")
        self.assertTrue(formatted.startswith("[CORE MEMORY"))

        # Re-hydrates from SQLite on new MemoryStore instance
        reloaded = MemoryStore(sqlite_path=self.sqlite_path, chroma_dir=self.chroma_dir)
        self.assertEqual(reloaded.get_core_memory_snapshot()["current_projects"]["version"], 2)

    async def test_02_worker_sleep_time_runs_sqlite_off_event_loop_with_connection_scope(self):
        sid = self.store.create_session()
        self.store.save_message(sid, "user", "Estou preparando minhas entrevistas de Engenharia de IA.")
        self.store.save_message(sid, "amadeus", "Então revise arquitetura de agentes e memória com calma.")

        loop_thread_id = threading.get_ident()
        observed_threads = []
        observed_scoped = []

        orig_get_state = self.store.get_session_consolidation_state
        orig_apply_patch = self.store.apply_core_memory_patch
        orig_add_memory = self.store.add_memory
        orig_mark = self.store.mark_session_consolidated

        def wrap(fn):
            def inner(*args, **kwargs):
                observed_threads.append(threading.get_ident())
                observed_scoped.append(getattr(self.store._local, "conn", None) is not None)
                return fn(*args, **kwargs)
            return inner

        async def fake_complete(prompt, response_model, **kwargs):
            return bg_module.BackgroundResult(
                data=SleepTimeConsolidation(
                    session_summary="Operador focando em entrevistas de IA e memória.",
                    core_memory_updates=CoreMemoryPatch(
                        operator_profile="Candidato a estágio em Engenharia de IA.",
                        open_loops="Treinar casos de design de agentes.",
                    ),
                    facts=[
                        ExtractedFact(
                            title="Entrevista Blip",
                            content="Fase 2 focada em design de agentes em dezembro.",
                            category="user",
                            confidence=0.9,
                        ),
                        ExtractedFact(
                            title="Fato Incerto",
                            content="Talvez goste de chá verde.",
                            category="user",
                            confidence=0.4,
                        ),
                    ],
                ),
                provider="gemini",
                model="gemini-2.5-flash-lite",
                latency_ms=42.0,
                schema_retries=0,
                failovers=0,
            )

        worker = CognitiveWorker(
            store=self.store,
            metrics=self.metrics,
            complete_fn=fake_complete,
        )

        with patch.object(self.store, "get_session_consolidation_state", side_effect=wrap(orig_get_state)), \
             patch.object(self.store, "apply_core_memory_patch", side_effect=wrap(orig_apply_patch)), \
             patch.object(self.store, "add_memory", side_effect=wrap(orig_add_memory)), \
             patch.object(self.store, "mark_session_consolidated", side_effect=wrap(orig_mark)):
            ev = await worker.process_session(sid, reason="hangup")

        self.assertEqual(ev["status"], "ok")
        self.assertEqual(ev["facts_saved"], 1)
        self.assertEqual(ev["core_blocks_updated"], 2)
        self.assertGreaterEqual(len(observed_threads), 4)
        self.assertTrue(all(tid != loop_thread_id for tid in observed_threads))
        self.assertTrue(all(observed_scoped))

        learned = [m for m in self.store.get_all_memories() if m["source"] == "learned"]
        self.assertEqual(len(learned), 1)
        self.assertEqual(learned[0]["title"], "Entrevista Blip")

        core = self.store.get_core_memory_snapshot()
        self.assertIn("operator_profile", core)
        self.assertIn("open_loops", core)
        state = self.store.get_session_consolidation_state(sid)
        self.assertIsNotNone(state["consolidatedAt"])
        self.assertEqual(state["lastConsolidatedMsgId"], state["latestMsgId"])

    async def test_03_worker_coalescing_idempotency_idle_sweep_and_clean_stop(self):
        s_idle = self.store.create_session()
        self.store.save_message(s_idle, "user", "Mensagem antiga 1")
        self.store.save_message(s_idle, "amadeus", "Resposta antiga 1")

        s_active = self.store.create_session()
        self.store.save_message(s_active, "user", "Mensagem recente 1")
        self.store.save_message(s_active, "amadeus", "Resposta recente 1")

        # Backdate s_idle messages beyond idle_seconds threshold
        old_ts = time.time() - 600.0
        with self.store._conn() as conn:
            conn.execute("UPDATE messages SET timestamp = ? WHERE session_id = ?", (old_ts, s_idle))
            conn.commit()

        llm_calls = 0
        processed_evt = asyncio.Event()

        async def slow_complete(prompt, response_model, **kwargs):
            nonlocal llm_calls
            llm_calls += 1
            await asyncio.sleep(0.05)
            processed_evt.set()
            return bg_module.BackgroundResult(
                data=SleepTimeConsolidation(
                    session_summary="Sessão antiga consolidada.",
                    core_memory_updates=CoreMemoryPatch(preferences="Prefere Python e FastAPI."),
                    facts=[],
                ),
                provider="groq",
                model="llama-3.1-8b-instant",
                latency_ms=50.0,
                schema_retries=0,
                failovers=0,
            )

        worker = CognitiveWorker(
            store=self.store,
            metrics=self.metrics,
            complete_fn=slow_complete,
            idle_seconds=300.0,
            sweep_interval_sec=60.0,
        )
        worker.start()
        try:
            idle_queued = await worker.run_idle_sweep_once()
            self.assertEqual(idle_queued, 1)
            # Duplicate hangup for same queued session must coalesce into 1 LLM call
            self.assertFalse(worker.enqueue_session(s_idle, reason="hangup"))

            await asyncio.wait_for(processed_evt.wait(), timeout=2.0)
            await asyncio.wait_for(worker._queue.join(), timeout=2.0)
            self.assertEqual(llm_calls, 1)

            # Re-processing with no new messages must be idempotent noop
            noop_ev = await worker.process_session(s_idle, reason="hangup")
            self.assertEqual(noop_ev["status"], "noop")
            self.assertEqual(llm_calls, 1)

            # Idle sweep now finds nothing
            self.assertEqual(await worker.run_idle_sweep_once(), 0)

            snap = self.metrics.snapshot()
            self.assertEqual(snap["cognitive"]["jobs_enqueued"], 1)
            self.assertEqual(snap["cognitive"]["jobs_coalesced"], 1)
            self.assertEqual(snap["cognitive"]["jobs_completed"], 1)
            self.assertEqual(snap["cognitive"]["jobs_skipped_noop"], 1)
            self.assertTrue(snap["cognitive"]["worker_running"])
        finally:
            await worker.stop()

        self.assertFalse(worker._running)
        self.assertIsNone(worker._worker_task)
        self.assertIsNone(worker._idle_task)


class TestPromptOrderingAndEndpoints(unittest.TestCase):
    def test_01_kv_prefix_cache_core_memory_order_and_fallback(self):
        persona = {
            "systemPrompt": "BASE_SYSTEM_PROMPT",
            "languageProfiles": {"pt": "PT_LANG_PROFILE", "en": "EN_LANG_PROFILE"},
            "canonicalVoicePrompt": "CANONICAL_VOICE_PROMPT",
        }
        semantic_matches = [
            {
                "id": "mem_01",
                "title": "Digitalização",
                "content": "Mapeamento sináptico em Viktor Chondria.",
                "emotionalWeight": "Factual",
                "source": "canonical",
            }
        ]
        history = [
            {"role": "user", "content": "Olá"},
            {"role": "assistant", "content": "Olá."},
        ]

        # 1. Core Memory populated -> sits at end of static KV prefix, BEFORE dynamic blocks; skips get_learned_context
        with patch.object(memory_store, "get_core_memory_snapshot", return_value={"operator_profile": {"content": "Lucca"}, "current_projects": {"content": "Amadeus"}}), \
             patch.object(memory_store, "format_core_memory_block", side_effect=lambda lc: f"[CORE MEMORY {lc}]:\n- operator_profile: Lucca"), \
             patch.object(memory_store, "get_learned_context", side_effect=AssertionError("should bypass get_learned_context when Core Memory is populated")), \
             patch.object(memory_store, "search_exemplars", return_value=[]):
            pt_prompt = orch_module.orchestrator._build_system_prompt(
                ChatRequest(message="Explique", lang="pt", canonicalVoice=True),
                persona, semantic_matches, "Explique", history, "Resumo prévio.", 120.0, "Tópico anterior",
            )
            en_prompt = orch_module.orchestrator._build_system_prompt(
                ChatRequest(message="Explain", lang="en", canonicalVoice=False),
                persona, semantic_matches, "Explain", history, "Prior summary.", 120.0, "Prev topic",
            )

        self.assertLess(pt_prompt.index("BASE_SYSTEM_PROMPT"), pt_prompt.index("PT_LANG_PROFILE"))
        self.assertLess(pt_prompt.index("PT_LANG_PROFILE"), pt_prompt.index("CANONICAL_VOICE_PROMPT"))
        self.assertLess(pt_prompt.index("CANONICAL_VOICE_PROMPT"), pt_prompt.index("[CORE MEMORY pt]"))
        self.assertLess(pt_prompt.index("[CORE MEMORY pt]"), pt_prompt.index("MEMÓRIAS DIGITALIZADAS"))
        self.assertLess(pt_prompt.index("MEMÓRIAS DIGITALIZADAS"), pt_prompt.index("RESUMO DO CONTEXTO ANTERIOR"))
        self.assertLess(pt_prompt.index("RESUMO DO CONTEXTO ANTERIOR"), pt_prompt.index("[TELEMETRIA DA CHAMADA AMADEUS]"))
        self.assertIn("Confiança (LabMem)", pt_prompt)

        self.assertLess(en_prompt.index("BASE_SYSTEM_PROMPT"), en_prompt.index("EN_LANG_PROFILE"))
        self.assertLess(en_prompt.index("EN_LANG_PROFILE"), en_prompt.index("[LANGUAGE ANCHOR]"))
        self.assertLess(en_prompt.index("[LANGUAGE ANCHOR]"), en_prompt.index("[CORE MEMORY en]"))
        self.assertLess(en_prompt.index("[CORE MEMORY en]"), en_prompt.index("MEMÓRIAS DIGITALIZADAS"))
        self.assertLess(en_prompt.index("MEMÓRIAS DIGITALIZADAS"), en_prompt.index("[AMADEUS CALL TELEMETRY]"))

        # 2. Core Memory empty -> falls back seamlessly to get_learned_context()
        fallback_facts = [{"id": "mem_f1", "title": "Café", "content": "Toma café preto sem açúcar."}]
        with patch.object(memory_store, "get_core_memory_snapshot", return_value={}), \
             patch.object(memory_store, "format_core_memory_block", return_value=""), \
             patch.object(memory_store, "get_learned_context", return_value=fallback_facts) as mock_learned, \
             patch.object(memory_store, "search_exemplars", return_value=[]):
            fb_prompt = orch_module.orchestrator._build_system_prompt(
                ChatRequest(message="Oi", lang="pt"),
                persona, semantic_matches, "Oi", history, "", None, "",
            )
        mock_learned.assert_called_once()
        self.assertNotIn("[CORE MEMORY", fb_prompt)
        self.assertIn("Toma café preto sem açúcar.", fb_prompt)

    def test_02_endpoints_and_lifespan_lifecycle(self):
        metrics_registry.reset()
        sid = memory_store.create_session()
        try:
            with patch.dict(os.environ, {"AMADEUS_BG_PROVIDER": "off"}, clear=False):
                with TestClient(app) as client:
                    cm_res = client.get("/api/core-memory")
                    self.assertEqual(cm_res.status_code, 200)
                    self.assertIn("blocks", cm_res.json())

                    m_res = client.get("/api/metrics")
                    self.assertEqual(m_res.status_code, 200)
                    cog = m_res.json().get("cognitive")
                    self.assertIsInstance(cog, dict)
                    self.assertTrue(cog["worker_running"])

                    close_res = client.post(f"/api/sessions/{sid}/close")
                    self.assertEqual(close_res.status_code, 200)
                    body = close_res.json()
                    self.assertTrue(body["ok"])
                    self.assertTrue(body["consolidationQueued"])

                self.assertFalse(cognitive_worker._running)
        finally:
            memory_store.delete_session(sid)


if __name__ == "__main__":
    unittest.main()
