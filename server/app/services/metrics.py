"""
Lightweight in-memory runtime metrics collector for OpenAmadeus.
Tracks rolling chat/LLM and TTS latency breakdowns, cold vs. warm starts,
fallbacks, errors, and barge-in aborts without external dependencies.
"""
from collections import deque
import math
import time
from typing import Any, Callable, Deque, Dict, List, Optional

WINDOW_SIZE = 50


def _round_opt(val: Optional[float], digits: int = 1) -> Optional[float]:
    if val is None or not math.isfinite(val):
        return None
    return round(float(val), digits)


def percentile(values: List[float], p: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 1)
    k = (len(ordered) - 1) * (p / 100.0)
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return round(ordered[int(k)], 1)
    return round(ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo), 1)


def _summarize_series(events: List[Dict[str, Any]], key: str) -> Dict[str, Optional[float]]:
    vals = [float(e[key]) for e in events if isinstance(e.get(key), (int, float)) and math.isfinite(e[key])]
    if not vals:
        return {"count": 0, "avg": None, "p50": None, "p95": None, "min": None, "max": None}
    return {
        "count": len(vals),
        "avg": round(sum(vals) / len(vals), 1),
        "p50": percentile(vals, 50),
        "p95": percentile(vals, 95),
        "min": round(min(vals), 1),
        "max": round(max(vals), 1),
    }


class MetricsRegistry:
    def __init__(self, maxlen: int = WINDOW_SIZE):
        self._maxlen = maxlen
        self._cognitive_state_provider: Optional[Callable[[], Dict[str, Any]]] = None
        self.reset()

    def set_cognitive_state_provider(
        self, provider: Optional[Callable[[], Dict[str, Any]]]
    ) -> None:
        self._cognitive_state_provider = provider

    def reset(self) -> None:
        self.started_at = time.time()
        self._chat: Deque[Dict[str, Any]] = deque(maxlen=self._maxlen)
        self._tts: Deque[Dict[str, Any]] = deque(maxlen=self._maxlen)
        self._cognitive: Deque[Dict[str, Any]] = deque(maxlen=self._maxlen)
        self._seen_llm_keys: set[str] = set()
        self.counters: Dict[str, int] = {
            "chat_total": 0,
            "chat_errors": 0,
            "chat_aborts": 0,
            "llm_fallbacks": 0,
            "tts_total": 0,
            "tts_errors": 0,
            "tts_aborts": 0,
            "tts_fallbacks": 0,
        }
        self.cognitive_counters: Dict[str, int] = {
            "jobs_enqueued": 0,
            "jobs_coalesced": 0,
            "jobs_dropped_full": 0,
            "jobs_completed": 0,
            "jobs_skipped_noop": 0,
            "jobs_failed": 0,
            "schema_retries": 0,
            "provider_failovers": 0,
        }

    def mark_llm_cold_start(self, provider_key: str) -> bool:
        """Returns True the first time this provider/key is observed since boot/reset."""
        if not provider_key:
            return False
        if provider_key in self._seen_llm_keys:
            return False
        self._seen_llm_keys.add(provider_key)
        return True

    def record_chat(self, event: Dict[str, Any]) -> Dict[str, Any]:
        clean = {
            "ts": round(time.time(), 3),
            "status": event.get("status", "ok"),
            "provider": event.get("provider") or "offline",
            "model": event.get("model") or "",
            "stream": bool(event.get("stream", False)),
            "cold_start": bool(event.get("cold_start", False)),
            "rag_ms": _round_opt(event.get("rag_ms")),
            "model_discovery_ms": _round_opt(event.get("model_discovery_ms")),
            "llm_fallback_attempts": int(event.get("llm_fallback_attempts") or 0),
            "llm_ttft_ms": _round_opt(event.get("llm_ttft_ms")),
            "llm_first_sentence_ms": _round_opt(event.get("llm_first_sentence_ms")),
            "llm_total_ms": _round_opt(event.get("llm_total_ms")),
            "total_ms": _round_opt(event.get("total_ms")),
            "sentences_count": int(event.get("sentences_count") or 0),
            "recalled_count": int(event.get("recalled_count") or 0),
            "canonical_ja_tags": int(event.get("canonical_ja_tags") or 0),
            "lang": event.get("lang") or "pt",
        }
        self._chat.append(clean)
        self.counters["chat_total"] += 1
        if clean["status"] == "error":
            self.counters["chat_errors"] += 1
        elif clean["status"] == "aborted":
            self.counters["chat_aborts"] += 1
        if clean["llm_fallback_attempts"] > 0:
            self.counters["llm_fallbacks"] += clean["llm_fallback_attempts"]
        return clean

    def record_tts(self, event: Dict[str, Any]) -> Dict[str, Any]:
        clean = {
            "ts": round(time.time(), 3),
            "status": event.get("status", "ok"),
            "requested_engine": event.get("requested_engine") or "qwen3",
            "engine_used": event.get("engine_used") or "unknown",
            "mode": event.get("mode") or "unknown",
            "stream": bool(event.get("stream", False)),
            "fallback_used": bool(event.get("fallback_used", False)),
            "fallback_chain": list(event.get("fallback_chain") or []),
            "handshake_ms": _round_opt(event.get("handshake_ms")),
            "ttfb_ms": _round_opt(event.get("ttfb_ms")),
            "total_ms": _round_opt(event.get("total_ms")),
            "bytes_sent": int(event.get("bytes_sent") or 0),
            "audio_duration_s": _round_opt(event.get("audio_duration_s"), 2),
            "realtime_speed_x": _round_opt(event.get("realtime_speed_x"), 2),
            "chars": int(event.get("chars") or 0),
            "lang": event.get("lang") or "pt",
            "aborted": bool(event.get("aborted", False)),
        }
        self._tts.append(clean)
        self.counters["tts_total"] += 1
        if clean["status"] == "error":
            self.counters["tts_errors"] += 1
        if clean["aborted"]:
            self.counters["tts_aborts"] += 1
        if clean["fallback_used"]:
            self.counters["tts_fallbacks"] += 1
        return clean

    def record_cognitive_enqueue(self, coalesced: bool = False, dropped: bool = False) -> None:
        if coalesced:
            self.cognitive_counters["jobs_coalesced"] += 1
        elif dropped:
            self.cognitive_counters["jobs_dropped_full"] += 1
        else:
            self.cognitive_counters["jobs_enqueued"] += 1

    def record_cognitive_job(self, event: Dict[str, Any]) -> Dict[str, Any]:
        clean = {
            "ts": round(time.time(), 3),
            "session_id": event.get("session_id") or "",
            "reason": event.get("reason") or "hangup",
            "status": event.get("status") or "ok",
            "provider": event.get("provider") or "offline",
            "model": event.get("model") or "",
            "latency_ms": _round_opt(event.get("latency_ms")),
            "schema_retries": int(event.get("schema_retries") or 0),
            "failovers": int(event.get("failovers") or 0),
            "facts_saved": int(event.get("facts_saved") or 0),
            "core_blocks_updated": int(event.get("core_blocks_updated") or 0),
            "error": event.get("error"),
        }
        self._cognitive.append(clean)
        if clean["status"] == "ok":
            self.cognitive_counters["jobs_completed"] += 1
        elif clean["status"] == "noop":
            self.cognitive_counters["jobs_skipped_noop"] += 1
        elif clean["status"] == "error":
            self.cognitive_counters["jobs_failed"] += 1
        self.cognitive_counters["schema_retries"] += clean["schema_retries"]
        self.cognitive_counters["provider_failovers"] += clean["failovers"]
        return clean

    def snapshot(self) -> Dict[str, Any]:
        chat_list = list(self._chat)
        tts_list = list(self._tts)
        cog_list = list(self._cognitive)
        chat_ok = [e for e in chat_list if e["status"] == "ok"]
        tts_ok = [e for e in tts_list if e["status"] == "ok" and not e["aborted"]]
        cog_ok = [e for e in cog_list if e["status"] == "ok"]

        cog_state: Dict[str, Any] = {}
        if self._cognitive_state_provider is not None:
            try:
                cog_state = self._cognitive_state_provider() or {}
            except Exception:
                cog_state = {}

        cold_chats = [e for e in chat_ok if e["cold_start"] and e.get("total_ms") is not None]
        warm_chats = [e for e in chat_ok if not e["cold_start"] and e.get("total_ms") is not None]

        engines_count: Dict[str, int] = {}
        for e in tts_list:
            eng = e["engine_used"]
            engines_count[eng] = engines_count.get(eng, 0) + 1

        chat_total = self.counters["chat_total"]
        tts_total = self.counters["tts_total"]

        return {
            "uptimeSeconds": round(time.time() - self.started_at, 1),
            "windowSize": self._maxlen,
            "counters": {
                **self.counters,
                "chat_error_rate": round(self.counters["chat_errors"] / chat_total, 4) if chat_total else 0.0,
                "tts_fallback_rate": round(self.counters["tts_fallbacks"] / tts_total, 4) if tts_total else 0.0,
            },
            "chat": {
                "last": chat_list[-1] if chat_list else None,
                "rag_ms": _summarize_series(chat_ok, "rag_ms"),
                "model_discovery_ms": _summarize_series(chat_ok, "model_discovery_ms"),
                "llm_ttft_ms": _summarize_series(chat_ok, "llm_ttft_ms"),
                "llm_first_sentence_ms": _summarize_series(chat_ok, "llm_first_sentence_ms"),
                "llm_total_ms": _summarize_series(chat_ok, "llm_total_ms"),
                "total_ms": _summarize_series(chat_ok, "total_ms"),
                "cold_vs_warm": {
                    "cold_count": len(cold_chats),
                    "cold_avg_total_ms": _round_opt(sum(e["total_ms"] for e in cold_chats) / len(cold_chats)) if cold_chats else None,
                    "cold_avg_discovery_ms": _round_opt(
                        sum((e["model_discovery_ms"] or 0.0) for e in cold_chats) / len(cold_chats)
                    ) if cold_chats else None,
                    "warm_count": len(warm_chats),
                    "warm_avg_total_ms": _round_opt(sum(e["total_ms"] for e in warm_chats) / len(warm_chats)) if warm_chats else None,
                    "warm_avg_discovery_ms": _round_opt(
                        sum((e["model_discovery_ms"] or 0.0) for e in warm_chats) / len(warm_chats)
                    ) if warm_chats else None,
                },
            },
            "tts": {
                "last": tts_list[-1] if tts_list else None,
                "handshake_ms": _summarize_series(tts_ok, "handshake_ms"),
                "ttfb_ms": _summarize_series(tts_ok, "ttfb_ms"),
                "total_ms": _summarize_series(tts_ok, "total_ms"),
                "realtime_speed_x": _summarize_series(tts_ok, "realtime_speed_x"),
                "engines": engines_count,
            },
            "cognitive": {
                **self.cognitive_counters,
                "queue_depth": int(cog_state.get("queue_depth") or 0),
                "worker_running": bool(cog_state.get("worker_running", False)),
                "core_memory_blocks": int(cog_state.get("core_memory_blocks") or 0),
                "last": cog_list[-1] if cog_list else None,
                "bg_latency_ms": _summarize_series(cog_ok, "latency_ms"),
            },
            "recent": {
                "chat": chat_list[-10:],
                "tts": tts_list[-10:],
                "cognitive": cog_list[-10:],
            },
        }


metrics_registry = MetricsRegistry()
