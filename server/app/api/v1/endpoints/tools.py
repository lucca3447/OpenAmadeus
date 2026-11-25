"""REST endpoints for MCP tool discovery and atomic Human-in-the-Loop (HITL) approvals."""

import asyncio
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from app.core.config import MCP_TOOL_TIMEOUT_SEC
from app.db.memory_store import memory_store
from app.schemas.tools import ApprovalDecisionResponse, PendingToolApproval
from app.services.mcp.mcp_client import mcp_registry
from app.services.metrics import metrics_registry

router = APIRouter()


@router.get("/tools")
def list_tools():
    return {
        "servers": mcp_registry.list_servers(),
        "tools": [t.model_dump() for t in mcp_registry.list_tools()],
    }


@router.get("/tools/approvals")
async def list_tool_approvals(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=30, ge=1, le=200),
):
    def _load():
        with memory_store.connection_scope():
            return memory_store.list_tool_approvals(status=status, limit=limit)

    items = await asyncio.to_thread(_load)
    return {"approvals": items}


@router.post("/tools/approvals/{approval_id}/approve", response_model=ApprovalDecisionResponse)
async def approve_tool_execution(approval_id: str):
    def _claim():
        with memory_store.connection_scope():
            return memory_store.claim_tool_approval(approval_id)

    outcome, record = await asyncio.to_thread(_claim)
    if outcome == "not_found":
        raise HTTPException(status_code=404, detail="Tool approval not found.")
    if outcome == "expired":
        raise HTTPException(status_code=410, detail="Tool approval expired.")
    if outcome != "claimed" or not record:
        raise HTTPException(status_code=409, detail=f"Tool approval already in state '{(record or {}).get('status', 'decided')}'.")

    spec = mcp_registry.get_tool(record["tool_name"])
    if spec is not None and spec.risk_level == "blocked":
        res = {
            "ok": False,
            "status": "failed",
            "output": None,
            "raw_preview": "Tool blocked by local policy.",
            "latency_ms": 0.0,
            "error": "Tool blocked by local policy.",
        }
    else:
        res = await mcp_registry.call_tool(
            record["tool_name"],
            record["arguments"],
            timeout_sec=MCP_TOOL_TIMEOUT_SEC,
        )

    final_status = "executed" if res["ok"] else "failed"

    def _finalize():
        with memory_store.connection_scope():
            updated = memory_store.finalize_tool_approval(
                approval_id,
                status=final_status,
                result_preview=res.get("raw_preview"),
                error=res.get("error"),
            )
            sid = record.get("session_id")
            if sid:
                state = memory_store.get_session_consolidation_state(sid)
                if state.get("exists"):
                    note = (
                        f"[TOOL EXECUTED: {record['tool_name']} ({final_status})] "
                        f"{res.get('raw_preview') or res.get('error') or ''}"
                    ).strip()
                    memory_store.save_message(sid, sender="system", content=note[:400])
            return updated

    finalized = await asyncio.to_thread(_finalize)
    metrics_registry.record_tool_event(
        {
            "tool_name": record["tool_name"],
            "server_id": record["server_id"],
            "risk_level": record["risk_level"],
            "status": "approved_executed" if res["ok"] else "approved_failed",
            "latency_ms": res.get("latency_ms"),
            "approval_id": approval_id,
            "error": res.get("error"),
        }
    )
    return ApprovalDecisionResponse(
        ok=bool(res["ok"]),
        approval=PendingToolApproval(**(finalized or record)),
        output=res.get("output"),
        latency_ms=res.get("latency_ms"),
    )


@router.post("/tools/approvals/{approval_id}/reject", response_model=ApprovalDecisionResponse)
async def reject_tool_execution(approval_id: str):
    def _reject():
        with memory_store.connection_scope():
            return memory_store.reject_tool_approval(approval_id)

    outcome, record = await asyncio.to_thread(_reject)
    if outcome == "not_found":
        raise HTTPException(status_code=404, detail="Tool approval not found.")
    if outcome == "expired":
        raise HTTPException(status_code=410, detail="Tool approval expired.")
    if outcome != "rejected" or not record:
        raise HTTPException(status_code=409, detail=f"Tool approval already in state '{(record or {}).get('status', 'decided')}'.")

    metrics_registry.record_tool_event(
        {
            "tool_name": record["tool_name"],
            "server_id": record["server_id"],
            "risk_level": record["risk_level"],
            "status": "rejected",
            "approval_id": approval_id,
        }
    )
    return ApprovalDecisionResponse(
        ok=True,
        approval=PendingToolApproval(**record),
    )
