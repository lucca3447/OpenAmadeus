"""Bounded MCP tool-calling loop, policy enforcement, and HITL approval builder."""

import asyncio
import json
import time
from typing import Any, Dict, List, Optional, Tuple
import httpx

from app.core.config import MCP_MAX_TOOL_STEPS, MCP_TOOL_TIMEOUT_SEC, OPENROUTER_FREE_MODELS
from app.db.memory_store import memory_store
from app.schemas.tools import ToolCallRequest, ToolExecutionEvent
from app.services.emotion_service import is_scratchpad_or_reasoning, strip_thinking_tags
from app.services.llm.gemini import (
    GeminiError,
    build_gemini_generation_config,
    gemini_request,
    get_candidate_models,
    is_gemini_retryable_400,
)
from app.services.llm.groq import get_groq_candidate_models
from app.services.mcp.mcp_client import MCPRegistry, mcp_registry
from app.services.metrics import MetricsRegistry, metrics_registry


def _tools_metrics_state() -> Dict[str, int]:
    snap = mcp_registry.state_snapshot()
    try:
        pending = memory_store.count_pending_tool_approvals()
    except Exception:
        pending = 0
    snap["pending_approvals"] = pending
    return snap


metrics_registry.set_tools_state_provider(_tools_metrics_state)


def build_approval_prompt_reply(
    pending_approvals: List[Dict[str, Any]],
    lang: str = "pt",
    *,
    with_tag: bool = True,
) -> str:
    lc = (lang or "pt").strip().lower()[:2]
    names = ", ".join(a.get("tool_name", "tool") for a in pending_approvals)
    ids = ", ".join(a.get("id", "") for a in pending_approvals if a.get("id"))
    if lc == "en":
        text = (
            f"Hold on — executing `{names}` modifies external state, so I won't proceed blindly. "
            f"Confirm approval ({ids}) via the tools panel or `/api/tools/approvals/{pending_approvals[0]['id']}/approve`."
        )
    elif lc == "ja":
        text = (
            f"ちょっと待って。`{names}` の実行は外部状態を変更するから、無断では進めないわ。"
            f"承認ID（{ids}）を許可してから続けましょう。"
        )
    else:
        text = (
            f"Espera aí — executar `{names}` altera estado externo, então não vou rodar isso no escuro. "
            f"Confirme a aprovação ({ids}) antes que eu execute."
        )
    if with_tag:
        return f"<!--emotion:serious,pose:crossed_arms,camera:medium--> {text}"
    return text


def _normalize_tool_call(raw: Any, fallback_idx: int) -> ToolCallRequest:
    if isinstance(raw, ToolCallRequest):
        return raw
    if isinstance(raw, dict):
        return ToolCallRequest(
            id=str(raw.get("id") or f"call_{fallback_idx}"),
            name=str(raw.get("name") or ""),
            arguments=raw.get("arguments") if isinstance(raw.get("arguments"), dict) else {},
            parse_error=raw.get("parse_error"),
            raw_arguments=raw.get("raw_arguments"),
        )
    return ToolCallRequest(id=f"call_{fallback_idx}", name="", parse_error="Invalid tool call payload.")


async def execute_tool_batch(
    tool_calls: List[Any],
    session_id: Optional[str],
    registry: MCPRegistry = mcp_registry,
    store: Any = memory_store,
    metrics: MetricsRegistry = metrics_registry,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Enforces fail-closed policy and schema validation on every model-emitted tool call."""
    llm_results: List[Dict[str, Any]] = []
    tool_events: List[Dict[str, Any]] = []
    pending_approvals: List[Dict[str, Any]] = []

    for idx, raw_tc in enumerate(tool_calls):
        tc = _normalize_tool_call(raw_tc, idx)
        spec = registry.get_tool(tc.name)
        server_id = spec.server_id if spec else "unknown"
        mcp_name = spec.mcp_name if spec else tc.name
        risk = spec.risk_level if spec else "blocked"

        if tc.parse_error:
            ev = ToolExecutionEvent(
                tool_name=tc.name,
                server_id=server_id,
                mcp_name=mcp_name,
                risk_level=risk,
                status="invalid_args",
                error=tc.parse_error,
            ).model_dump()
            metrics.record_tool_event(ev)
            tool_events.append(ev)
            llm_results.append({"id": tc.id, "name": tc.name, "content": f"[TOOL_ERROR] {tc.parse_error}"})
            continue

        if spec is None or spec.risk_level == "blocked":
            err = f"Tool '{tc.name}' is blocked by local policy or not registered."
            ev = ToolExecutionEvent(
                tool_name=tc.name,
                server_id=server_id,
                mcp_name=mcp_name,
                risk_level="blocked",
                status="blocked",
                error=err,
            ).model_dump()
            metrics.record_tool_event(ev)
            tool_events.append(ev)
            llm_results.append({"id": tc.id, "name": tc.name, "content": f"[TOOL_ERROR] {err}"})
            continue

        valid, val_err = registry.validate_arguments(spec, tc.arguments)
        if not valid:
            ev = ToolExecutionEvent(
                tool_name=spec.full_name,
                server_id=spec.server_id,
                mcp_name=spec.mcp_name,
                risk_level=spec.risk_level,
                status="invalid_args",
                error=val_err,
            ).model_dump()
            metrics.record_tool_event(ev)
            tool_events.append(ev)
            llm_results.append({"id": tc.id, "name": spec.full_name, "content": f"[TOOL_ERROR] {val_err}"})
            continue

        if spec.risk_level == "read_only":
            res = await registry.call_tool(spec.full_name, tc.arguments, timeout_sec=MCP_TOOL_TIMEOUT_SEC)
            ev = ToolExecutionEvent(
                tool_name=spec.full_name,
                server_id=spec.server_id,
                mcp_name=spec.mcp_name,
                risk_level=spec.risk_level,
                status=res["status"],
                latency_ms=res["latency_ms"],
                preview=res["raw_preview"],
                error=res["error"],
            ).model_dump()
            metrics.record_tool_event(ev)
            tool_events.append(ev)
            llm_results.append({"id": tc.id, "name": spec.full_name, "content": res["output"]})
            continue

        # Mutating tool: fail-closed HITL pause — never execute automatically
        # shortcut: mutating tool pauses turn cleanly and records outcome on approval; resume mid-loop generation only if multi-step post-approval chaining is needed.
        def _create_approval() -> Dict[str, Any]:
            with store.connection_scope():
                return store.create_tool_approval(
                    session_id=session_id,
                    server_id=spec.server_id,
                    tool_name=spec.full_name,
                    mcp_name=spec.mcp_name,
                    arguments=tc.arguments,
                    risk_level=spec.risk_level,
                )

        approval = await asyncio.to_thread(_create_approval)
        ev = ToolExecutionEvent(
            tool_name=spec.full_name,
            server_id=spec.server_id,
            mcp_name=spec.mcp_name,
            risk_level=spec.risk_level,
            status="approval_required",
            approval_id=approval["id"],
        ).model_dump()
        metrics.record_tool_event(ev)
        tool_events.append(ev)
        pending_approvals.append(approval)
        llm_results.append(
            {
                "id": tc.id,
                "name": spec.full_name,
                "content": f"[APPROVAL_REQUIRED id={approval['id']}] Operator confirmation required.",
            }
        )

    return llm_results, tool_events, pending_approvals


def append_openai_tool_exchange(
    messages: List[Dict[str, Any]],
    assistant_text: str,
    raw_tool_calls: List[Dict[str, Any]],
    llm_results: List[Dict[str, Any]],
) -> None:
    messages.append(
        {
            "role": "assistant",
            "content": assistant_text or None,
            "tool_calls": [
                {
                    "id": tc["id"],
                    "type": "function",
                    "function": {
                        "name": tc["name"],
                        "arguments": json.dumps(tc.get("arguments") or {}, ensure_ascii=False),
                    },
                }
                for tc in raw_tool_calls
            ],
        }
    )
    for res in llm_results:
        messages.append(
            {
                "role": "tool",
                "tool_call_id": res["id"],
                "content": res["content"],
            }
        )


def append_gemini_tool_exchange(
    contents: List[Dict[str, Any]],
    assistant_text: str,
    raw_tool_calls: List[Dict[str, Any]],
    llm_results: List[Dict[str, Any]],
) -> None:
    model_parts: List[Dict[str, Any]] = []
    if assistant_text:
        model_parts.append({"text": assistant_text})
    for tc in raw_tool_calls:
        fc_part: Dict[str, Any] = {"functionCall": {"name": tc["name"], "args": tc.get("arguments") or {}}}
        if tc.get("thought_signature"):
            fc_part["thoughtSignature"] = tc["thought_signature"]
        model_parts.append(fc_part)
    contents.append({"role": "model", "parts": model_parts})
    contents.append(
        {
            "role": "user",
            "parts": [
                {
                    "functionResponse": {
                        "name": res["name"],
                        "response": {"result": res["content"]},
                    }
                }
                for res in llm_results
            ],
        }
    )


def _extract_openai_tool_calls(choice_msg: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for idx, item in enumerate(choice_msg.get("tool_calls") or []):
        if not isinstance(item, dict):
            continue
        fn = item.get("function") or {}
        name = str(fn.get("name") or "")
        raw_args = fn.get("arguments")
        call_id = str(item.get("id") or f"call_{idx}")
        if isinstance(raw_args, dict):
            out.append({"id": call_id, "name": name, "arguments": raw_args, "parse_error": None})
        elif isinstance(raw_args, str):
            stripped = raw_args.strip()
            try:
                obj = json.loads(stripped) if stripped else {}
                if isinstance(obj, dict):
                    out.append({"id": call_id, "name": name, "arguments": obj, "parse_error": None})
                else:
                    out.append({"id": call_id, "name": name, "arguments": {}, "parse_error": "Tool arguments JSON must be an object."})
            except json.JSONDecodeError as exc:
                out.append({"id": call_id, "name": name, "arguments": {}, "parse_error": f"Malformed JSON arguments: {exc.msg}"})
        else:
            out.append({"id": call_id, "name": name, "arguments": {}, "parse_error": None})
    return out


def _extract_gemini_function_calls(parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for part in parts:
        if not isinstance(part, dict) or part.get("thought"):
            continue
        fc = part.get("functionCall")
        if isinstance(fc, dict) and fc.get("name"):
            raw_args = fc.get("args")
            entry: Dict[str, Any] = {
                "id": f"call_{len(out)}",
                "name": str(fc["name"]),
                "arguments": raw_args if isinstance(raw_args, dict) else {},
                "parse_error": None if (raw_args is None or isinstance(raw_args, dict)) else "Tool arguments must be an object.",
            }
            thought_sig = part.get("thoughtSignature")
            if isinstance(thought_sig, str) and thought_sig:
                entry["thought_signature"] = thought_sig
            out.append(entry)
    return out


async def run_non_streaming_tool_loop(
    *,
    client: httpx.AsyncClient,
    provider: str,
    api_key: str,
    system_prompt: str,
    messages_or_contents: List[Dict[str, Any]],
    candidates: List[str],
    allow_fallback: bool,
    session_id: Optional[str],
    lang: str,
    model_discovery_ms: float = 0.0,
    max_steps: int = MCP_MAX_TOOL_STEPS,
    registry: MCPRegistry = mcp_registry,
    store: Any = memory_store,
    metrics: MetricsRegistry = metrics_registry,
) -> Tuple[str, str, str, int, float, float, List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Runs bounded tool-calling loop for /api/chat across Groq, OpenRouter, and Gemini."""
    is_groq = provider == "groq"
    is_openrouter = provider == "openrouter"
    openai_tools = registry.to_openai_tools()
    gemini_decls = registry.to_gemini_declarations()

    fallback_attempts = 0
    tool_events: List[Dict[str, Any]] = []
    pending_approvals: List[Dict[str, Any]] = []
    used_model = ""
    selected_gemini_model = ""
    locked_candidate: Optional[str] = None
    t_llm0 = time.perf_counter()

    for step in range(max_steps + 1):
        include_tools = step < max_steps
        step_candidates = [locked_candidate] if locked_candidate else candidates
        last_err: Optional[GeminiError] = None
        step_text = ""
        step_tool_calls: List[Dict[str, Any]] = []

        for candidate in step_candidates:
            try:
                if is_groq or is_openrouter:
                    url = (
                        "https://api.groq.com/openai/v1/chat/completions"
                        if is_groq
                        else "https://openrouter.ai/api/v1/chat/completions"
                    )
                    headers = {
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    }
                    if is_openrouter:
                        headers["HTTP-Referer"] = "http://localhost:5173"
                        headers["X-Title"] = "OpenAmadeus"
                    body: Dict[str, Any] = {
                        "model": candidate,
                        "messages": messages_or_contents,
                        "temperature": 0.85,
                        "max_tokens": 2048,
                        "presence_penalty": 0.4,
                        "frequency_penalty": 0.4,
                    }
                    if is_openrouter:
                        body["include_reasoning"] = False
                    if include_tools and openai_tools:
                        body["tools"] = openai_tools
                        body["tool_choice"] = "auto"

                    res = await client.post(url, headers=headers, json=body)
                    if res.status_code != 200:
                        err_body = res.text
                        if not allow_fallback:
                            raise GeminiError(res.status_code, f"[MODO FIXO • {candidate}] {err_body}")
                        is_retryable = (
                            res.status_code in (400, 404, 429, 502, 503)
                            or "decommissioned" in err_body.lower()
                            or "rate_limit" in err_body.lower()
                            or "rate limit" in err_body.lower()
                        )
                        if is_retryable:
                            fallback_attempts += 1
                            last_err = GeminiError(res.status_code, err_body)
                            continue
                        raise GeminiError(res.status_code, err_body)

                    data = res.json()
                    choice_msg = (data.get("choices") or [{}])[0].get("message") or {}
                    step_tool_calls = _extract_openai_tool_calls(choice_msg) if include_tools else []
                    raw_content = choice_msg.get("content")
                    step_text = strip_thinking_tags(raw_content if isinstance(raw_content, str) else "")

                    if not step_tool_calls and (not step_text or is_scratchpad_or_reasoning(step_text)):
                        if not allow_fallback:
                            raise GeminiError(502, f"[MODO FIXO • {candidate}] Resposta vazia ou raciocínio interno.")
                        fallback_attempts += 1
                        continue

                    locked_candidate = candidate
                    used_model = f"{candidate} (Groq LPU)" if is_groq else f"{candidate.replace(':free', '')} (OpenRouter)"
                    last_err = None
                    break
                else:
                    payload: Dict[str, Any] = {
                        "contents": messages_or_contents,
                        "systemInstruction": {"parts": [{"text": system_prompt}]},
                        "generationConfig": build_gemini_generation_config(candidate),
                    }
                    if include_tools and gemini_decls:
                        payload["tools"] = [{"functionDeclarations": gemini_decls}]
                    try:
                        data = await gemini_request(
                            client, "POST", f"models/{candidate}:generateContent", api_key, payload
                        )
                    except GeminiError as exc:
                        last_err = exc
                        if allow_fallback and (
                            exc.code in (0, 404, 429, 503) or is_gemini_retryable_400(exc.code, exc.message)
                        ):
                            fallback_attempts += 1
                            continue
                        raise

                    cand = (data.get("candidates") or [{}])[0]
                    parts = (cand.get("content") or {}).get("parts") or []
                    step_tool_calls = _extract_gemini_function_calls(parts) if include_tools else []
                    step_text = "".join(
                        p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought")
                    ).strip()
                    if not step_tool_calls and not step_text:
                        if not allow_fallback:
                            raise GeminiError(502, f"[MODO FIXO GEMINI • {candidate}] Resposta vazia.")
                        fallback_attempts += 1
                        continue

                    locked_candidate = candidate
                    selected_gemini_model = candidate
                    used_model = candidate
                    last_err = None
                    break
            except GeminiError as exc:
                last_err = exc
                is_retryable_err = exc.code in (0, 404, 429, 502, 503) or (
                    exc.code == 400 if (is_groq or is_openrouter) else is_gemini_retryable_400(exc.code, exc.message)
                )
                if allow_fallback and is_retryable_err:
                    fallback_attempts += 1
                    continue
                raise

        if last_err and not step_text and not step_tool_calls:
            raise last_err

        if not step_tool_calls:
            llm_total_ms = (time.perf_counter() - t_llm0) * 1000.0
            return (
                step_text,
                used_model,
                selected_gemini_model,
                fallback_attempts,
                model_discovery_ms,
                llm_total_ms,
                tool_events,
                pending_approvals,
            )

        llm_results, batch_events, batch_approvals = await execute_tool_batch(
            step_tool_calls, session_id, registry=registry, store=store, metrics=metrics
        )
        tool_events.extend(batch_events)
        if batch_approvals:
            pending_approvals.extend(batch_approvals)
            confirm_reply = build_approval_prompt_reply(batch_approvals, lang=lang, with_tag=True)
            llm_total_ms = (time.perf_counter() - t_llm0) * 1000.0
            return (
                confirm_reply,
                used_model,
                selected_gemini_model,
                fallback_attempts,
                model_discovery_ms,
                llm_total_ms,
                tool_events,
                pending_approvals,
            )

        if is_groq or is_openrouter:
            append_openai_tool_exchange(messages_or_contents, step_text, step_tool_calls, llm_results)
        else:
            append_gemini_tool_exchange(messages_or_contents, step_text, step_tool_calls, llm_results)

        if step + 1 == max_steps:
            metrics.record_tool_loop_limit()

    llm_total_ms = (time.perf_counter() - t_llm0) * 1000.0
    return (
        step_text or "Concluí a verificação das ferramentas.",
        used_model,
        selected_gemini_model,
        fallback_attempts,
        model_discovery_ms,
        llm_total_ms,
        tool_events,
        pending_approvals,
    )
