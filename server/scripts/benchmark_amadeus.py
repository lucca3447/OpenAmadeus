#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenAmadeus Companion — Unified Latency & Functioning Benchmark Suite
=====================================================================
Modes:
  --offline : Deterministic local suite (zero API cost). Tests /api/health,
              ChromaDB RAG latency & hit rate, offline /api/chat & /api/chat/stream,
              trilingual/canonical JP SentenceStream integrity, and /api/metrics.
  --live    : End-to-end live benchmark against a running backend (or --in-process ASGI)
              plus optional remote/local Qwen3-TTS worker (--qwen-url). Measures:
              - Cold vs. Warm LLM latency breakdown (RAG, Model Discovery, Fallbacks,
                TTFT, 1st Sentence, Total) across PT/EN/JA + canonicalVoice
              - TTS streaming & WAV latency (Ping, Handshake, TTFB/TTFA, Total, Speed x)
                and DSP acoustic anomalies (active speech, gaps, F0 pitch, tail RMS)
              - Barge-in / mid-stream abort resilience
              - Exports JSON + Markdown reports to server/data/benchmarks/
"""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Dict, List, Optional

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

SCRIPT_DIR = Path(__file__).resolve().parent
SERVER_DIR = SCRIPT_DIR.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import httpx
from app.services.metrics import percentile
from compare_local_remote import evaluate_single_result, get_audio_info

RAG_PROBES = [
    ("Como funciona a sua pesquisa de digitalizar memórias no Amadeus?", "mem_01"),
    ("Como é trabalhar com a Maho Hiyajo e o Professor Leskinen?", "mem_02"),
    ("Você costuma entrar no fórum @channel e responder Nullpo?", "mem_03"),
    ("Qual é a sua bebida favorita no laboratório?", "mem_07"),
    ("O que é o computador retrô IBN 5100?", "mem_19"),
    ("O que é o fenômeno Reading Steiner?", "mem_20"),
]

LIVE_LLM_TURNS = [
    {"label": "1_cold_pt", "lang": "pt", "canonical": False, "message": "Kurisu, explique em duas frases curtas o que é o sistema Amadeus."},
    {"label": "2_warm_pt", "lang": "pt", "canonical": False, "message": "E o que você acha de Dr. Pepper? Responda rápido em duas frases."},
    {"label": "3_warm_en", "lang": "en", "canonical": False, "message": "Briefly explain Kerr black holes in two short sentences."},
    {"label": "4_warm_ja", "lang": "ja", "canonical": False, "message": "タイムマシンの可能性について二文で短く答えて。"},
    {"label": "5_canonical_jp", "lang": "pt", "canonical": True, "message": "Christina, minha assistente! Responda em duas frases curtas."},
]

LIVE_TTS_CASES = [
    {
        "id": "pt_stream_short",
        "lang": "pt",
        "emotion": "tsundere",
        "stream": True,
        "text": "Quem você está chamando de assistente? Preste atenção nos dados do experimento.",
        "min_active_s": 2.5,
    },
    {
        "id": "en_stream_short",
        "lang": "en",
        "emotion": "analytical",
        "stream": True,
        "text": "Statistically speaking, your hypothesis lacks empirical evidence.",
        "min_active_s": 2.0,
    },
    {
        "id": "ja_stream_short",
        "lang": "ja",
        "emotion": "annoyed",
        "stream": True,
        "text": "誰が助手よ！実験データをちゃんと確認しなさい。",
        "min_active_s": 1.8,
    },
    {
        "id": "pt_wav_full",
        "lang": "pt",
        "emotion": "neutral",
        "stream": False,
        "text": "Verificação completa do módulo de síntese vocal em modo arquivo WAV.",
        "min_active_s": 2.5,
    },
]


def _summary_stats(vals: List[float]) -> Dict[str, Optional[float]]:
    if not vals:
        return {"count": 0, "min": None, "p50": None, "p95": None, "max": None, "avg": None}
    return {
        "count": len(vals),
        "min": round(min(vals), 1),
        "p50": percentile(vals, 50),
        "p95": percentile(vals, 95),
        "max": round(max(vals), 1),
        "avg": round(sum(vals) / len(vals), 1),
    }


def _read_sse_stream(client: Any, url: str, payload: dict) -> Dict[str, Any]:
    t0 = time.perf_counter()
    first_event_ms = None
    first_sentence_ms = None
    events: List[dict] = []
    status_code = 0
    with client.stream("POST", url, json=payload, timeout=60.0) as res:
        status_code = res.status_code
        if status_code != 200:
            body = res.read().decode("utf-8", errors="ignore")
            return {"ok": False, "status_code": status_code, "error": body[:200], "total_ms": round((time.perf_counter() - t0) * 1000.0, 1)}
        buf = ""
        for chunk in res.iter_text():
            buf += chunk
            while "\n\n" in buf:
                block, buf = buf.split("\n\n", 1)
                for line in block.splitlines():
                    if not line.startswith("data:"):
                        continue
                    ev = json.loads(line[5:])
                    now_ms = round((time.perf_counter() - t0) * 1000.0, 1)
                    if first_event_ms is None:
                        first_event_ms = now_ms
                    if ev.get("event") == "sentence" and first_sentence_ms is None:
                        first_sentence_ms = now_ms
                    events.append(ev)
    total_ms = round((time.perf_counter() - t0) * 1000.0, 1)
    done_ev = next((e for e in reversed(events) if e.get("event") == "done"), None)
    done_resp = (done_ev or {}).get("response") or {}
    sent_evs = [e for e in events if e.get("event") == "sentence"]
    leaked_tags = any("<!--" in (e.get("text") or "") for e in sent_evs) or ("<!--" in (done_resp.get("response") or ""))
    return {
        "ok": status_code == 200 and not done_resp.get("error") and len(sent_evs) > 0,
        "status_code": status_code,
        "error": done_resp.get("error"),
        "events_count": len(events),
        "sentences_count": len(sent_evs),
        "ja_sentences": sum(1 for e in sent_evs if e.get("ttsText")),
        "leaked_tags": leaked_tags,
        "first_event_ms": first_event_ms,
        "first_sentence_ms": first_sentence_ms,
        "total_ms": total_ms,
        "model": done_resp.get("model"),
        "metrics": done_resp.get("metrics"),
    }


def _cleanup_sessions(memory_store: Any, created_ids: List[str]) -> None:
    if not created_ids:
        return
    with memory_store._conn() as conn:
        for sid in created_ids:
            conn.execute("DELETE FROM messages WHERE session_id = ?", (sid,))
            conn.execute("DELETE FROM sessions WHERE id = ?", (sid,))
        conn.commit()


def run_offline_suite(runs: int = 3) -> Dict[str, Any]:
    from fastapi.testclient import TestClient
    from main import app
    from app.db.memory_store import memory_store
    from app.services.llm.sentence_stream import SentenceStream
    from app.services.metrics import metrics_registry

    created_sessions: List[str] = []
    report: Dict[str, Any] = {
        "mode": "offline",
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "checks": {},
    }

    with TestClient(app) as client:
        metrics_registry.reset()
        warmup_ms = memory_store.warmup_embeddings()
        try:
            # 1. Health latency
            health_ms: List[float] = []
            health_data = {}
            for _ in range(runs):
                t0 = time.perf_counter()
                res = client.get("/api/health")
                health_ms.append((time.perf_counter() - t0) * 1000.0)
                assert res.status_code == 200
                health_data = res.json()
            report["checks"]["health"] = {
                "pass": health_data.get("status") == "online",
                "latency_ms": _summary_stats(health_ms),
                "chromaCount": health_data.get("chromaCount"),
                "exemplarsCount": health_data.get("exemplarsCount"),
                "totalMemories": health_data.get("totalMemories"),
            }

            # 2. RAG retrieval speed & top-1 hit rate (explicit cache miss vs LRU cache hit)
            memory_store._embed_cache.clear()
            cold_query_ms: List[float] = []
            hits = 0
            for query, expected_id in RAG_PROBES:
                t0 = time.perf_counter()
                matches = memory_store.search_memories(query, max_kurisu=2, max_learned=2)
                cold_query_ms.append((time.perf_counter() - t0) * 1000.0)
                if matches and matches[0]["id"] == expected_id:
                    hits += 1

            cached_ms: List[float] = []
            for query, _expected_id in RAG_PROBES:
                t0 = time.perf_counter()
                memory_store.search_memories(query, max_kurisu=2, max_learned=2)
                cached_ms.append((time.perf_counter() - t0) * 1000.0)

            report["checks"]["rag"] = {
                "pass": hits >= max(1, len(RAG_PROBES) - 1),
                "top1_hits": f"{hits}/{len(RAG_PROBES)}",
                "hit_rate": round(hits / len(RAG_PROBES), 3),
                "onnx_warmup_ms": warmup_ms,
                "rag_cold_query_ms": _summary_stats(cold_query_ms),
                "rag_cached_ms": _summary_stats(cached_ms),
                "latency_ms": _summary_stats(cold_query_ms),
            }

            # 3. Offline /api/chat and /api/chat/stream contract & latency (unique uncached utterances per run)
            chat_ms: List[float] = []
            stream_ms: List[float] = []
            stream_ok = True
            for i in range(runs):
                sid = memory_store.create_session()
                created_sessions.append(sid)

                memory_store._embed_cache.clear()
                chat_msg = f"Olá Kurisu, analise os registros do IBN 5100 na rodada {i + 1}."
                t0 = time.perf_counter()
                r = client.post("/api/chat", json={"message": chat_msg, "sessionId": sid, "selectedModel": "offline"})
                chat_ms.append((time.perf_counter() - t0) * 1000.0)
                body = r.json()
                if r.status_code != 200 or not isinstance(body.get("metrics"), dict):
                    stream_ok = False

                memory_store._embed_cache.clear()
                stream_msg = f"Explique a teoria de digitalização de memórias do laboratório no turno {i + 1}."
                sse_res = _read_sse_stream(
                    client,
                    "/api/chat/stream",
                    {"message": stream_msg, "sessionId": sid, "selectedModel": "offline", "canonicalVoice": True},
                )
                stream_ms.append(sse_res["total_ms"])
                if not sse_res["ok"] or sse_res["leaked_tags"] or not sse_res.get("metrics"):
                    stream_ok = False

            report["checks"]["chat_offline"] = {
                "pass": stream_ok,
                "chat_ms": _summary_stats(chat_ms),
                "stream_ms": _summary_stats(stream_ms),
            }

            # 4. SentenceStream trilingual + canonical JP check
            splitter = SentenceStream()
            sample = (
                "<!--emotion:annoyed,pose:crossed_arms--> "
                "<!--ja:私の名前は紅莉栖よ！助手じゃない！--> Meu nome é Kurisu! Não sou sua assistente! "
                "<!--ja:ちゃんと聞きなさい。--> Preste atenção agora."
            )
            evs = splitter.feed(sample) + splitter.flush()
            ja_count = sum(1 for k, _ in evs if k == "ja")
            sent_count = sum(1 for k, _ in evs if k == "sentence")
            dir_count = sum(1 for k, _ in evs if k == "directive")
            report["checks"]["sentence_stream"] = {
                "pass": dir_count == 1 and ja_count == 2 and sent_count == 2,
                "directives": dir_count,
                "ja_tags": ja_count,
                "sentences": sent_count,
            }

            # 5. /api/metrics endpoint check
            m_snap = client.get("/api/metrics").json()
            report["checks"]["metrics_api"] = {
                "pass": m_snap["counters"]["chat_total"] == runs * 2 and m_snap["chat"]["total_ms"]["p50"] is not None,
                "chat_total": m_snap["counters"]["chat_total"],
                "chat_p50_ms": m_snap["chat"]["total_ms"]["p50"],
                "rag_p50_ms": m_snap["chat"]["rag_ms"]["p50"],
            }
        finally:
            _cleanup_sessions(memory_store, created_sessions)

    return report


def run_live_suite(
    base_url: str,
    qwen_url: Optional[str],
    api_key: Optional[str],
    in_process: bool = False,
    skip_llm: bool = False,
    skip_tts: bool = False,
) -> Dict[str, Any]:
    created_sessions: List[str] = []
    memory_store_ref = None
    ctx_manager = None

    if in_process:
        from fastapi.testclient import TestClient
        from main import app
        from app.db.memory_store import memory_store
        ctx_manager = TestClient(app)
        client: Any = ctx_manager.__enter__()
        memory_store_ref = memory_store
        url_prefix = ""
    else:
        client = httpx.Client(timeout=90.0)
        url_prefix = base_url.rstrip("/")

    report: Dict[str, Any] = {
        "mode": "live",
        "target": "in-process" if in_process else base_url,
        "qwen_url": qwen_url,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "checks": {},
    }

    try:
        # Reset metrics for clean baseline
        try:
            client.post(f"{url_prefix}/api/metrics/reset", timeout=5.0)
        except Exception:
            pass

        # 1. Subsystems health & Qwen ping
        t0 = time.perf_counter()
        h_res = client.get(f"{url_prefix}/api/health", timeout=6.0)
        health_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        health_json = h_res.json() if h_res.status_code == 200 else {}

        qwen_ping = None
        if qwen_url:
            p_res = client.post(f"{url_prefix}/api/voice/ping", json={"remoteUrl": qwen_url}, timeout=10.0)
            qwen_ping = p_res.json() if p_res.status_code == 200 else {"status": "error", "error": f"HTTP {p_res.status_code}"}

        report["checks"]["subsystems"] = {
            "pass": h_res.status_code == 200 and (qwen_ping is None or qwen_ping.get("status") == "ready"),
            "health_ms": health_ms,
            "system": health_json.get("system"),
            "chromaCount": health_json.get("chromaCount"),
            "qwen_ping": qwen_ping,
        }

        # 2. LLM Cold vs Warm Benchmark
        if not skip_llm:
            s_res = client.post(f"{url_prefix}/api/sessions/new", timeout=6.0)
            sid = s_res.json().get("sessionId") if s_res.status_code == 200 else None
            if sid:
                created_sessions.append(sid)

            llm_rows = []
            for turn in LIVE_LLM_TURNS:
                payload: Dict[str, Any] = {
                    "message": turn["message"],
                    "sessionId": sid,
                    "lang": turn["lang"],
                    "canonicalVoice": turn["canonical"],
                }
                if api_key:
                    payload["apiKey"] = api_key
                res = _read_sse_stream(client, f"{url_prefix}/api/chat/stream", payload)
                m = res.get("metrics") or {}
                llm_rows.append({
                    "label": turn["label"],
                    "lang": turn["lang"],
                    "canonical": turn["canonical"],
                    "ok": res["ok"],
                    "error": res.get("error"),
                    "model": res.get("model"),
                    "cold_start": m.get("cold_start"),
                    "rag_ms": m.get("rag_ms"),
                    "model_discovery_ms": m.get("model_discovery_ms"),
                    "llm_fallback_attempts": m.get("llm_fallback_attempts"),
                    "llm_ttft_ms": m.get("llm_ttft_ms"),
                    "llm_first_sentence_ms": m.get("llm_first_sentence_ms"),
                    "llm_total_ms": m.get("llm_total_ms"),
                    "client_first_sentence_ms": res.get("first_sentence_ms"),
                    "total_ms": res.get("total_ms"),
                    "sentences": res.get("sentences_count"),
                    "ja_sentences": res.get("ja_sentences"),
                    "leaked_tags": res.get("leaked_tags"),
                })

            cold_rows = [r for r in llm_rows if r.get("cold_start")]
            warm_rows = [r for r in llm_rows if r.get("cold_start") is False and r["ok"]]
            report["checks"]["llm_cold_vs_warm"] = {
                "pass": all(r["ok"] and not r["leaked_tags"] for r in llm_rows),
                "turns": llm_rows,
                "cold_total_ms": cold_rows[0]["total_ms"] if cold_rows else None,
                "cold_discovery_ms": cold_rows[0]["model_discovery_ms"] if cold_rows else None,
                "warm_first_sentence_ms": _summary_stats([r["llm_first_sentence_ms"] for r in warm_rows if r.get("llm_first_sentence_ms") is not None]),
                "warm_discovery_ms": _summary_stats([r["model_discovery_ms"] for r in warm_rows if r.get("model_discovery_ms") is not None]),
                "warm_total_ms": _summary_stats([r["total_ms"] for r in warm_rows if r.get("total_ms") is not None]),
            }

        # 3. TTS Streaming & WAV + DSP Acoustic Benchmark
        if not skip_tts:
            tts_rows = []
            for case in LIVE_TTS_CASES:
                payload = {
                    "text": case["text"],
                    "lang": case["lang"],
                    "engine": "qwen3",
                    "qwenMode": "remote" if qwen_url else "local",
                    "qwenRemoteUrl": qwen_url,
                    "emotion": case["emotion"],
                    "stream": case["stream"],
                    "allowTtsFallback": False,
                }
                t0 = time.perf_counter()
                ttfb_ms = None
                chunks: List[bytes] = []
                headers: Dict[str, str] = {}
                err_text = None
                status_code = 0
                try:
                    with client.stream("POST", f"{url_prefix}/api/tts", json=payload, timeout=90.0) as res:
                        status_code = res.status_code
                        headers = {k.lower(): v for k, v in res.headers.items()}
                        if status_code != 200:
                            err_text = res.read().decode("utf-8", errors="ignore")[:180]
                        else:
                            for chunk in res.iter_bytes():
                                if not chunk:
                                    continue
                                if ttfb_ms is None:
                                    ttfb_ms = round((time.perf_counter() - t0) * 1000.0, 1)
                                chunks.append(chunk)
                except Exception as ex:
                    err_text = str(ex)[:180]

                total_ms = round((time.perf_counter() - t0) * 1000.0, 1)
                raw_bytes = b"".join(chunks)
                if status_code == 200 and len(raw_bytes) > 500:
                    # In-process TestClient buffers StreamingResponse before yielding; pull true server-side ttfb_ms from /api/metrics
                    if in_process and case["stream"]:
                        try:
                            m_last = (client.get(f"{url_prefix}/api/metrics").json().get("tts") or {}).get("last") or {}
                            if m_last.get("ttfb_ms") is not None:
                                ttfb_ms = m_last["ttfb_ms"]
                        except Exception:
                            pass
                    dsp = get_audio_info(raw_bytes, is_stream=case["stream"])
                    speed_x = round(dsp["duration_s"] / (total_ms / 1000.0), 2) if total_ms > 0 else 0.0
                    issues = evaluate_single_result({"ok": True, **dsp}, case["min_active_s"])
                    tts_rows.append({
                        "id": case["id"],
                        "lang": case["lang"],
                        "stream": case["stream"],
                        "ok": True,
                        "engine_used": headers.get("x-tts-engine"),
                        "fallback_used": headers.get("x-tts-fallback") == "true",
                        "handshake_ms": float(headers["x-tts-handshake-ms"]) if headers.get("x-tts-handshake-ms") else None,
                        "ttfb_ms": ttfb_ms,
                        "total_ms": total_ms,
                        "speed_x": speed_x,
                        "issues": issues,
                        **dsp,
                    })
                else:
                    tts_rows.append({
                        "id": case["id"],
                        "lang": case["lang"],
                        "stream": case["stream"],
                        "ok": False,
                        "error": err_text or f"HTTP {status_code}",
                        "total_ms": total_ms,
                    })

            ok_stream = [r for r in tts_rows if r["ok"] and r["stream"]]
            report["checks"]["tts_benchmark"] = {
                "pass": all(r["ok"] for r in tts_rows),
                "cases": tts_rows,
                "stream_ttfb_ms": _summary_stats([r["ttfb_ms"] for r in ok_stream if r.get("ttfb_ms") is not None]),
                "stream_speed_x": _summary_stats([r["speed_x"] for r in ok_stream if r.get("speed_x") is not None]),
            }

            # 4. Barge-in / Mid-stream Abort Resilience Test
            abort_ok = False
            abort_recovery_ms = None
            try:
                abort_payload = {
                    "text": "Este é um teste de interrupção imediata para validar o cancelamento limpo durante o streaming de voz.",
                    "lang": "pt",
                    "engine": "qwen3",
                    "qwenMode": "remote" if qwen_url else "local",
                    "qwenRemoteUrl": qwen_url,
                    "emotion": "neutral",
                    "stream": True,
                    "allowTtsFallback": False,
                }
                with client.stream("POST", f"{url_prefix}/api/tts", json=abort_payload, timeout=30.0) as res:
                    if res.status_code == 200:
                        for chunk in res.iter_bytes():
                            if chunk:
                                break  # Simulate user barge-in right after first chunk
                # Verify worker recovers immediately on next health ping
                t_rec = time.perf_counter()
                rec_res = client.post(f"{url_prefix}/api/voice/ping", json={"remoteUrl": qwen_url}, timeout=10.0)
                abort_recovery_ms = round((time.perf_counter() - t_rec) * 1000.0, 1)
                abort_ok = rec_res.status_code == 200 and rec_res.json().get("status") == "ready"
            except Exception:
                abort_ok = False

            report["checks"]["barge_in_abort"] = {
                "pass": abort_ok,
                "recovery_ping_ms": abort_recovery_ms,
            }

        # Capture backend aggregated metrics snapshot
        m_res = client.get(f"{url_prefix}/api/metrics", timeout=6.0)
        if m_res.status_code == 200:
            report["backend_metrics"] = m_res.json()
    finally:
        if memory_store_ref is not None:
            _cleanup_sessions(memory_store_ref, created_sessions)
        elif created_sessions:
            for sid in created_sessions:
                try:
                    client.delete(f"{url_prefix}/api/sessions/{sid}", timeout=4.0)
                except Exception:
                    pass
        if ctx_manager is not None:
            ctx_manager.__exit__(None, None, None)
        elif not in_process:
            client.close()

    return report


def format_markdown(report: Dict[str, Any]) -> str:
    lines = [
        f"# OpenAmadeus Benchmark Report ({report['mode'].upper()})",
        f"- **Timestamp:** `{report['timestamp']}`",
    ]
    if report.get("qwen_url"):
        lines.append(f"- **Qwen3 Target:** `{report['qwen_url']}`")
    lines.append("")

    checks = report.get("checks", {})
    lines.append("## Summary")
    lines.append("| Suite | Status |")
    lines.append("|---|---|")
    for name, data in checks.items():
        status = "PASS" if data.get("pass") else "FAIL/WARN"
        lines.append(f"| `{name}` | **{status}** |")
    lines.append("")

    if "health" in checks or "rag" in checks or "chat_offline" in checks:
        lines.append("## Offline Latency & Integrity")
        lines.append("| Metric | Value | p50 (ms) | p95 (ms) |")
        lines.append("|---|---|---:|---:|")
        if "health" in checks:
            h = checks["health"]
            lines.append(f"| `/api/health` | {h.get('chromaCount')} vec / {h.get('exemplarsCount')} ex | {h['latency_ms']['p50']} | {h['latency_ms']['p95']} |")
        if "rag" in checks:
            r = checks["rag"]
            cold_stats = r.get("rag_cold_query_ms") or r["latency_ms"]
            lines.append(f"| RAG Uncached Query (cache miss) | {r['top1_hits']} ({int(r['hit_rate']*100)}%) | {cold_stats['p50']} | {cold_stats['p95']} |")
            if r.get("rag_cached_ms"):
                c_stats = r["rag_cached_ms"]
                lines.append(f"| RAG Cached Query (LRU hit) | {r['top1_hits']} ({int(r['hit_rate']*100)}%) | {c_stats['p50']} | {c_stats['p95']} |")
        if "chat_offline" in checks:
            c = checks["chat_offline"]
            lines.append(f"| `/api/chat` (offline) | - | {c['chat_ms']['p50']} | {c['chat_ms']['p95']} |")
            lines.append(f"| `/api/chat/stream` (offline) | - | {c['stream_ms']['p50']} | {c['stream_ms']['p95']} |")
        lines.append("")

    if "subsystems" in checks:
        s = checks["subsystems"]
        qp = s.get("qwen_ping") or {}
        lines.append("## Subsystems & Worker Probe")
        lines.append(f"- **Backend `/api/health`:** `{s.get('health_ms')} ms` (`{s.get('system')}`, ChromaDB: `{s.get('chromaCount')}`)")
        if qp:
            lines.append(
                f"- **Qwen3 Worker:** status=`{qp.get('status')}` | ping=`{qp.get('ping_ms')} ms` "
                f"| device=`{qp.get('device')}` | VRAM=`{qp.get('vram_allocated_mb')} MB`"
            )
        lines.append("")

    if "llm_cold_vs_warm" in checks:
        lines.append("## LLM Cold vs Warm Breakdown")
        lines.append("| Turn | Lang | Cold | RAG (ms) | Discovery (ms) | Fallbacks | TTFT (ms) | 1st Sent (ms) | Total (ms) | Model |")
        lines.append("|---|---|---|---:|---:|---:|---:|---:|---:|---|")
        for r in checks["llm_cold_vs_warm"]["turns"]:
            lines.append(
                f"| {r['label']} | {r['lang']} | {'YES' if r.get('cold_start') else 'no'} "
                f"| {r.get('rag_ms') or '-'} | {r.get('model_discovery_ms') if r.get('model_discovery_ms') is not None else '-'} "
                f"| {r.get('llm_fallback_attempts') or 0} | {r.get('llm_ttft_ms') or '-'} "
                f"| {r.get('llm_first_sentence_ms') or '-'} | {r.get('total_ms') or '-'} | `{r.get('model') or r.get('error')}` |"
            )
        lines.append("")

    if "tts_benchmark" in checks:
        lines.append("## TTS Latency & Acoustic DSP")
        lines.append("| Case | Stream | Engine | Handshake (ms) | TTFB/TTFA (ms) | Total (ms) | Dur (s) | Speed | F0 med/p95 | Gap (s) | Issues |")
        lines.append("|---|---|---|---:|---:|---:|---:|---:|---|---:|---|")
        for r in checks["tts_benchmark"]["cases"]:
            if r["ok"]:
                issues = ", ".join(r.get("issues") or []) or "OK"
                lines.append(
                    f"| {r['id']} | {r['stream']} | {r.get('engine_used') or '-'} | {r.get('handshake_ms') or '-'} "
                    f"| {r.get('ttfb_ms') or '-'} | {r.get('total_ms') or '-'} | {r.get('duration_s')} "
                    f"| {r.get('speed_x')}x | {r.get('med_f0')}/{r.get('p95_f0')}Hz | {r.get('max_gap_s')} | {issues} |"
                )
            else:
                lines.append(f"| {r['id']} | {r['stream']} | - | - | - | {r.get('total_ms')} | - | - | - | - | ERROR: {r.get('error')} |")
        lines.append("")

    return "\n".join(lines)


def save_report(report: Dict[str, Any]) -> tuple[Path, Path]:
    out_dir = SERVER_DIR / "data" / "benchmarks"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = out_dir / f"report_{report['mode']}_{stamp}.json"
    md_path = out_dir / f"report_{report['mode']}_{stamp}.md"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    md_path.write_text(format_markdown(report), encoding="utf-8")
    return json_path, md_path


def print_console_report(report: Dict[str, Any]) -> None:
    print("=" * 100)
    print(f" OpenAmadeus Benchmark Report — Mode: {report['mode'].upper()} ({report['timestamp']})")
    print("=" * 100)
    for name, data in report.get("checks", {}).items():
        badge = "[PASS]" if data.get("pass") else "[FAIL]"
        print(f" {badge} {name}")
    print("-" * 100)
    print(format_markdown(report))


def main() -> int:
    parser = argparse.ArgumentParser(description="OpenAmadeus Unified Latency & Functioning Benchmark Suite")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--offline", action="store_true", help="Run deterministic offline benchmark (default)")
    mode.add_argument("--live", action="store_true", help="Run live E2E benchmark against running backend/LLM/TTS")
    parser.add_argument("--base-url", type=str, default="http://127.0.0.1:8000", help="Backend API base URL for --live")
    parser.add_argument("--in-process", action="store_true", help="Run --live via FastAPI TestClient in-process (no uvicorn needed)")
    parser.add_argument("--qwen-url", type=str, default=None, help="Remote/local Qwen3-TTS worker URL (e.g. Colab trycloudflare URL)")
    parser.add_argument("--api-key", type=str, default=None, help="Optional LLM API key override (defaults to server/.env)")
    parser.add_argument("--runs", type=int, default=3, help="Iterations for --offline latency percentiles")
    parser.add_argument("--skip-llm", action="store_true", help="Skip LLM turns in --live mode")
    parser.add_argument("--skip-tts", action="store_true", help="Skip TTS cases in --live mode")
    args = parser.parse_args()

    if args.live:
        report = run_live_suite(
            base_url=args.base_url,
            qwen_url=args.qwen_url,
            api_key=args.api_key,
            in_process=args.in_process,
            skip_llm=args.skip_llm,
            skip_tts=args.skip_tts,
        )
    else:
        report = run_offline_suite(runs=max(1, args.runs))

    print_console_report(report)
    json_path, md_path = save_report(report)
    print(f"\n[SAVED] JSON: {json_path}")
    print(f"[SAVED] MD:   {md_path}")

    all_passed = all(c.get("pass") for c in report.get("checks", {}).values())
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
