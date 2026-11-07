"""Provider streaming primitives for /chat/stream (v0.2.2).

Each generator yields ("model", name) once the provider accepted a candidate, then
("delta", text) per token chunk. Candidate fallback only happens BEFORE the first token.
"""
import json
from typing import Any, AsyncIterator, Dict, List, Tuple

import httpx

from app.core.config import API_BASE_GEMINI
from app.services.llm.gemini import GeminiError

Event = Tuple[str, str]


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
) -> AsyncIterator[Event]:
    """Generic candidate loop: POST streaming request per model, extract text with delta_of(chunk)."""
    last_err: GeminiError | None = None
    for model in candidates:
        started = False
        try:
            async with client.stream("POST", url_for(model), headers=headers, json=body_for(model)) as res:
                if res.status_code != 200:
                    err_body = (await res.aread()).decode("utf-8", "ignore")
                    err = GeminiError(res.status_code, f"[{label} • {model}] {err_body}")
                    if allow_fallback and res.status_code in retry_codes:
                        last_err = err
                        continue
                    raise err
                async for chunk in _sse_data(res):
                    text = delta_of(chunk)
                    if not text:
                        continue
                    if not started:
                        started = True
                        yield ("model", model)
                    yield ("delta", text)
            if started:
                return
            last_err = GeminiError(502, f"[{label} • {model}] Resposta vazia.")
            if not allow_fallback:
                raise last_err
        except httpx.HTTPError as e:
            if started:
                raise GeminiError(0, f"Conexão com o provedor interrompida: {e}")
            last_err = GeminiError(0, f"Sem conexão com o provedor: {e}")
            if not allow_fallback:
                raise last_err
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
