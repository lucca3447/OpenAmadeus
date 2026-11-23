"""Background structured-output LLM runner with Gemini schema sanitization and Groq failover."""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
import json
import os
import re
import time
from typing import Any, Dict, Generic, List, Optional, Set, Tuple, Type, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.core.config import (
    API_BASE_GEMINI,
    GROQ_BG_MODELS,
    PREFERRED_BG_GEMINI_MODELS,
)

T = TypeVar("T", bound=BaseModel)

_REAL_ASYNC_CLIENT = httpx.AsyncClient
_GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
_MD_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)

_GEMINI_ALLOWED_KEYS = frozenset(
    {"type", "description", "enum", "nullable", "items", "properties", "required"}
)
_GEMINI_TYPE_MAP = {
    "object": "OBJECT",
    "array": "ARRAY",
    "string": "STRING",
    "number": "NUMBER",
    "integer": "INTEGER",
    "boolean": "BOOLEAN",
}

_bg_client: Optional[httpx.AsyncClient] = None
_bg_client_loop: Optional[asyncio.AbstractEventLoop] = None


@dataclass
class BackgroundResult(Generic[T]):
    """Outcome of a single complete_background() invocation."""

    data: Optional[T]
    provider: str
    model: str
    latency_ms: float
    schema_retries: int
    failovers: int
    error: Optional[str] = None


def _resolve_ref(ref: str, defs: Dict[str, Any]) -> Dict[str, Any]:
    if ref.startswith("#/$defs/"):
        name = ref[len("#/$defs/"):]
        return dict(defs.get(name) or {})
    if ref.startswith("#/definitions/"):
        name = ref[len("#/definitions/"):]
        return dict(defs.get(name) or {})
    return {}


def _sanitize_node(
    node: Any,
    defs: Dict[str, Any],
    seen_refs: Set[str],
) -> Dict[str, Any]:
    if not isinstance(node, dict):
        return {}

    if "$ref" in node:
        ref = str(node["$ref"])
        if ref in seen_refs:
            return {"type": "STRING"}
        resolved = _resolve_ref(ref, defs)
        merged = {**resolved, **{k: v for k, v in node.items() if k != "$ref"}}
        return _sanitize_node(merged, defs, seen_refs | {ref})

    if "allOf" in node and isinstance(node["allOf"], list) and node["allOf"]:
        merged_all: Dict[str, Any] = {}
        for part in node["allOf"]:
            if isinstance(part, dict):
                merged_all.update(part)
        for k, v in node.items():
            if k != "allOf" and k not in merged_all:
                merged_all[k] = v
        return _sanitize_node(merged_all, defs, seen_refs)

    for union_key in ("anyOf", "oneOf"):
        if union_key in node and isinstance(node[union_key], list):
            branches = [b for b in node[union_key] if isinstance(b, dict)]
            is_nullable = any(b.get("type") == "null" for b in branches)
            non_null = [b for b in branches if b.get("type") != "null"]
            chosen = dict(non_null[0]) if non_null else {"type": "string"}
            if "description" in node and "description" not in chosen:
                chosen["description"] = node["description"]
            sanitized = _sanitize_node(chosen, defs, seen_refs)
            if is_nullable:
                sanitized["nullable"] = True
            return sanitized

    out: Dict[str, Any] = {}
    raw_type = node.get("type")
    if isinstance(raw_type, str):
        mapped = _GEMINI_TYPE_MAP.get(raw_type.lower())
        if mapped:
            out["type"] = mapped

    if "type" not in out:
        if "properties" in node:
            out["type"] = "OBJECT"
        elif "items" in node:
            out["type"] = "ARRAY"
        elif "enum" in node:
            out["type"] = "STRING"

    if isinstance(node.get("description"), str) and node["description"].strip():
        out["description"] = node["description"].strip()

    if isinstance(node.get("enum"), list) and node["enum"]:
        out["enum"] = list(node["enum"])

    if node.get("nullable") is True:
        out["nullable"] = True

    if "properties" in node and isinstance(node["properties"], dict):
        props: Dict[str, Any] = {}
        for key, prop_schema in node["properties"].items():
            clean_prop = _sanitize_node(prop_schema, defs, seen_refs)
            if clean_prop:
                props[key] = clean_prop
        if props:
            out["properties"] = props
            raw_req = node.get("required")
            if isinstance(raw_req, list):
                req = [r for r in raw_req if isinstance(r, str) and r in props]
                if req:
                    out["required"] = req

    if "items" in node and isinstance(node["items"], dict):
        clean_items = _sanitize_node(node["items"], defs, seen_refs)
        if clean_items:
            out["items"] = clean_items

    return {k: v for k, v in out.items() if k in _GEMINI_ALLOWED_KEYS}


def sanitize_gemini_schema(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Flattens Pydantic JSON Schema ($defs/$ref/anyOf/additionalProperties/title) for Gemini v1beta responseSchema."""
    if not isinstance(schema, dict):
        return {}
    defs: Dict[str, Any] = {}
    for defs_key in ("$defs", "definitions"):
        raw_defs = schema.get(defs_key)
        if isinstance(raw_defs, dict):
            defs.update(raw_defs)
    return _sanitize_node(schema, defs, set())


def _strip_json_fences(raw: str) -> str:
    return _MD_FENCE_RE.sub("", (raw or "").strip()).strip()


@asynccontextmanager
async def _bg_http_client(timeout_sec: float, external_client: Optional[httpx.AsyncClient] = None):
    global _bg_client, _bg_client_loop
    if external_client is not None:
        yield external_client
        return
    if httpx.AsyncClient is not _REAL_ASYNC_CLIENT:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_sec)) as client:
            yield client
        return
    loop = asyncio.get_running_loop()
    if _bg_client is None or _bg_client.is_closed or _bg_client_loop is not loop:
        if _bg_client is not None and not _bg_client.is_closed and _bg_client_loop is loop:
            await _bg_client.aclose()
        _bg_client = httpx.AsyncClient(timeout=httpx.Timeout(timeout_sec))
        _bg_client_loop = loop
    yield _bg_client


async def aclose_background_client() -> None:
    """Closes the shared background keep-alive HTTP client during server shutdown."""
    global _bg_client, _bg_client_loop
    if _bg_client is not None and not _bg_client.is_closed:
        await _bg_client.aclose()
    _bg_client = None
    _bg_client_loop = None


def _build_candidates() -> List[Tuple[str, str, str]]:
    pref = (os.environ.get("AMADEUS_BG_PROVIDER") or "auto").strip().lower()
    if pref == "off":
        return []

    gemini_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    groq_key = (os.environ.get("GROQ_API_KEY") or "").strip()
    gemini_override = (os.environ.get("AMADEUS_BG_GEMINI_MODEL") or "").strip()
    groq_override = (os.environ.get("AMADEUS_BG_GROQ_MODEL") or "").strip()

    gemini_models = [gemini_override] if gemini_override else list(PREFERRED_BG_GEMINI_MODELS)
    groq_models = [groq_override] if groq_override else list(GROQ_BG_MODELS)

    candidates: List[Tuple[str, str, str]] = []
    if pref in ("auto", "gemini") and gemini_key:
        for m in gemini_models:
            candidates.append(("gemini", gemini_key, m))
    if pref in ("auto", "groq") and groq_key:
        for m in groq_models:
            candidates.append(("groq", groq_key, m))
    return candidates


async def _call_gemini(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    system_prompt: str,
    contents: List[Dict[str, Any]],
    gemini_schema: Dict[str, Any],
    timeout_sec: float,
) -> Tuple[int, str, str]:
    url = f"{API_BASE_GEMINI}/models/{model}:generateContent"
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
    payload: Dict[str, Any] = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1024,
            "responseMimeType": "application/json",
            "responseSchema": gemini_schema,
        },
    }
    if system_prompt:
        payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}

    res = await client.post(url, headers=headers, json=payload, timeout=timeout_sec)
    if res.status_code != 200:
        return res.status_code, "", res.text[:300]

    data = res.json()
    parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
    text = "".join(
        p.get("text", "")
        for p in parts
        if isinstance(p, dict) and not p.get("thought")
    )
    return 200, text, ""


async def _call_groq(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    messages: List[Dict[str, str]],
    timeout_sec: float,
) -> Tuple[int, str, str]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1024,
        "response_format": {"type": "json_object"},
    }
    res = await client.post(_GROQ_CHAT_URL, headers=headers, json=payload, timeout=timeout_sec)
    if res.status_code != 200:
        return res.status_code, "", res.text[:300]

    data = res.json()
    content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
    return 200, str(content), ""


async def complete_background(
    prompt: str,
    response_model: Type[T],
    *,
    system_prompt: str = "",
    timeout_sec: float = 15.0,
    max_retries: int = 1,
    client: Optional[httpx.AsyncClient] = None,
) -> BackgroundResult[T]:
    """Executes a low-priority structured-output call with validation retry and provider failover."""
    t0 = time.perf_counter()
    candidates = _build_candidates()
    if not candidates:
        return BackgroundResult(
            data=None,
            provider="offline",
            model="",
            latency_ms=0.0,
            schema_retries=0,
            failovers=0,
            error="no_bg_provider",
        )

    raw_schema = response_model.model_json_schema()
    gemini_schema = sanitize_gemini_schema(raw_schema)
    compact_schema_str = json.dumps(gemini_schema, ensure_ascii=False, separators=(",", ":"))
    groq_system = (
        f"{system_prompt}\n\n" if system_prompt else ""
    ) + f"Return ONLY a valid JSON object matching this schema:\n{compact_schema_str}"

    schema_retries = 0
    failovers = 0
    last_error = "unknown"
    last_provider = candidates[0][0]
    last_model = candidates[0][2]

    async with _bg_http_client(timeout_sec, client) as http_client:
        idx = 0
        while idx < len(candidates):
            provider, api_key, model = candidates[idx]
            last_provider = provider
            last_model = model

            gemini_contents: List[Dict[str, Any]] = [
                {"role": "user", "parts": [{"text": prompt}]}
            ]
            groq_messages: List[Dict[str, str]] = [
                {"role": "system", "content": groq_system},
                {"role": "user", "content": prompt},
            ]

            http_failed_code: Optional[int] = None
            provider_done = False

            for attempt in range(max_retries + 1):
                try:
                    if provider == "gemini":
                        status, raw_text, err_body = await _call_gemini(
                            http_client, api_key, model, system_prompt,
                            gemini_contents, gemini_schema, timeout_sec,
                        )
                    else:
                        status, raw_text, err_body = await _call_groq(
                            http_client, api_key, model, groq_messages, timeout_sec,
                        )
                except Exception as exc:
                    last_error = f"{provider}:{model} request error: {exc}"
                    http_failed_code = 0
                    break

                if status != 200:
                    last_error = f"{provider}:{model} HTTP {status}: {err_body}"
                    http_failed_code = status
                    break

                cleaned = _strip_json_fences(raw_text)
                try:
                    parsed = response_model.model_validate_json(cleaned)
                    return BackgroundResult(
                        data=parsed,
                        provider=provider,
                        model=model,
                        latency_ms=round((time.perf_counter() - t0) * 1000.0, 1),
                        schema_retries=schema_retries,
                        failovers=failovers,
                    )
                except (ValidationError, json.JSONDecodeError, ValueError) as exc:
                    err_summary = str(exc).replace("\n", " ")[:280]
                    last_error = f"{provider}:{model} schema validation failed: {err_summary}"
                    if attempt < max_retries:
                        schema_retries += 1
                        feedback = (
                            f"Your previous JSON failed validation ({err_summary}). "
                            "Return ONLY corrected valid JSON matching the required schema."
                        )
                        if provider == "gemini":
                            gemini_contents.append({"role": "model", "parts": [{"text": cleaned or "{}"}]})
                            gemini_contents.append({"role": "user", "parts": [{"text": feedback}]})
                        else:
                            groq_messages.append({"role": "assistant", "content": cleaned or "{}"})
                            groq_messages.append({"role": "user", "content": feedback})
                    else:
                        provider_done = True

            # Decide next candidate: on non-404 HTTP/network failures, jump directly to next provider
            next_idx = idx + 1
            if (http_failed_code is not None and http_failed_code != 404) or provider_done:
                while next_idx < len(candidates) and candidates[next_idx][0] == provider:
                    next_idx += 1

            if next_idx < len(candidates):
                failovers += 1
            idx = next_idx

    return BackgroundResult(
        data=None,
        provider=last_provider,
        model=last_model,
        latency_ms=round((time.perf_counter() - t0) * 1000.0, 1),
        schema_retries=schema_retries,
        failovers=failovers,
        error=last_error,
    )
