"""Provider streaming primitives for /chat/stream (v0.2.2).

Each generator yields ("model", name) once the provider accepted a candidate, then
("delta", text) per token chunk. Candidate fallback only happens BEFORE the first token.
"""
import json
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx

from app.core.config import API_BASE_GEMINI
from app.services.llm.gemini import GeminiError

Event = Tuple[str, Any]


def _collect_chunk_tool_calls(
    chunk: Dict[str, Any],
    openai_acc: Dict[int, Dict[str, str]],
    gemini_acc: List[Dict[str, Any]],
) -> bool:
    found = False
    choices = chunk.get("choices")
    if isinstance(choices, list) and choices:
        delta = (choices[0] or {}).get("delta") or {}
        for item in delta.get("tool_calls") or []:
            if not isinstance(item, dict):
                continue
            found = True
            idx = int(item.get("index") or 0)
            slot = openai_acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
            if item.get("id") and not slot["id"]:
                slot["id"] = str(item["id"])
            fn = item.get("function") or {}
            if isinstance(fn, dict):
                if fn.get("name") and not slot["name"]:
                    slot["name"] = str(fn["name"])
                if fn.get("arguments") is not None:
                    slot["arguments"] += str(fn["arguments"])

    parts = (((chunk.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
    for part in parts:
        if not isinstance(part, dict) or part.get("thought"):
            continue
        fc = part.get("functionCall")
        if isinstance(fc, dict) and fc.get("name"):
            found = True
            raw_args = fc.get("args")
            call_id = f"call_{len(gemini_acc)}"
            if isinstance(raw_args, dict):
                gemini_acc.append(
                    {"id": call_id, "name": str(fc["name"]), "arguments": raw_args, "parse_error": None}
                )
            elif isinstance(raw_args, str):
                stripped = raw_args.strip()
                try:
                    obj = json.loads(stripped) if stripped else {}
                    if isinstance(obj, dict):
                        gemini_acc.append(
                            {"id": call_id, "name": str(fc["name"]), "arguments": obj, "parse_error": None}
                        )
                    else:
                        gemini_acc.append(
                            {
                                "id": call_id,
                                "name": str(fc["name"]),
                                "arguments": {},
                                "parse_error": "Tool arguments JSON must be an object.",
                                "raw_arguments": raw_args,
                            }
                        )
                except json.JSONDecodeError as exc:
                    gemini_acc.append(
                        {
                            "id": call_id,
                            "name": str(fc["name"]),
                            "arguments": {},
                            "parse_error": f"Malformed JSON arguments: {exc.msg}",
                            "raw_arguments": raw_args,
                        }
                    )
            else:
                gemini_acc.append(
                    {
                        "id": call_id,
                        "name": str(fc["name"]),
                        "arguments": {},
                        "parse_error": None if raw_args is None else "Tool arguments must be a JSON object.",
                    }
                )
    return found


def _finalize_collected_tool_calls(
    openai_acc: Dict[int, Dict[str, str]],
    gemini_acc: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    calls: List[Dict[str, Any]] = []
    for idx in sorted(openai_acc):
        slot = openai_acc[idx]
        if not slot["name"]:
            continue
        raw_args = slot["arguments"].strip()
        call_id = slot["id"] or f"call_{idx}"
        if not raw_args:
            calls.append({"id": call_id, "name": slot["name"], "arguments": {}, "parse_error": None})
            continue
        try:
            obj = json.loads(raw_args)
            if isinstance(obj, dict):
                calls.append({"id": call_id, "name": slot["name"], "arguments": obj, "parse_error": None})
            else:
                calls.append(
                    {
                        "id": call_id,
                        "name": slot["name"],
                        "arguments": {},
                        "parse_error": "Tool arguments JSON must be an object.",
                        "raw_arguments": raw_args,
                    }
                )
        except json.JSONDecodeError as exc:
            calls.append(
                {
                    "id": call_id,
                    "name": slot["name"],
                    "arguments": {},
                    "parse_error": f"Malformed JSON arguments: {exc.msg}",
                    "raw_arguments": raw_args,
                }
            )
    calls.extend(gemini_acc)
    return calls


async def _sse_data(res: httpx.Response) -> AsyncIterator[dict]:
    async for line in res.aiter_lines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            yield json.loads(payload)
        except json.JSONDecodeError:
            continue


async def stream_candidates(
    client: httpx.AsyncClient,
    url_for,
    headers: Dict[str, str],
    body_for,
    candidates: List[str],
    allow_fallback: bool,
    retry_codes: Tuple[int, ...],
    delta_of,
    label: str,
    *,
    collect_tool_calls: bool = False,
) -> AsyncIterator[Event]:
    """Generic candidate loop: POST streaming request per model, extract text with delta_of(chunk)."""
    last_err: Optional[GeminiError] = None
    for model in candidates:
        started = False
        openai_tc_acc: Dict[int, Dict[str, str]] = {}
        gemini_fc_acc: List[Dict[str, Any]] = []
        try:
            async with client.stream("POST", url_for(model), headers=headers, json=body_for(model)) as res:
                if res.status_code != 200:
                    err_body = (await res.aread()).decode("utf-8", "ignore")
                    err = GeminiError(res.status_code, f"[{label} • {model}] {err_body}")
                    if allow_fallback and res.status_code in retry_codes:
                        last_err = err
                        yield ("fallback", f"{model}:{res.status_code}")
                        continue
                    raise err
                async for chunk in _sse_data(res):
                    if collect_tool_calls and _collect_chunk_tool_calls(chunk, openai_tc_acc, gemini_fc_acc):
                        if not started:
                            started = True
                            yield ("model", model)
                    text = delta_of(chunk)
                    if not text:
                        continue
                    if not started:
                        started = True
                        yield ("model", model)
                    yield ("delta", text)
            collected_tools = (
                _finalize_collected_tool_calls(openai_tc_acc, gemini_fc_acc)
                if collect_tool_calls
                else []
            )
            if collected_tools:
                yield ("tool_calls", collected_tools)
                return
            if started:
                return
            last_err = GeminiError(502, f"[{label} • {model}] Resposta vazia.")
            if not allow_fallback:
                raise last_err
            yield ("fallback", f"{model}:empty")
        except httpx.HTTPError as e:
            if started:
                raise GeminiError(0, f"Conexão com o provedor interrompida: {e}")
            last_err = GeminiError(0, f"Sem conexão com o provedor: {e}")
            if not allow_fallback:
                raise last_err
            yield ("fallback", f"{model}:network")
    if last_err:
        raise last_err
    raise GeminiError(502, f"[{label}] Nenhum modelo candidato disponível.")


def openai_delta(chunk: Dict[str, Any]) -> str:
    choice = (chunk.get("choices") or [{}])[0]
    content = (choice.get("delta") or {}).get("content")
    return content if isinstance(content, str) else ""


def gemini_delta(chunk: Dict[str, Any]) -> str:
    parts = (((chunk.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or []
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


def gemini_stream_url(model: str) -> str:
    return f"{API_BASE_GEMINI}/models/{model}:streamGenerateContent?alt=sse"
