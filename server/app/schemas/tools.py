"""Pydantic v2 contracts for MCP tool registration, policy gating, and HITL approvals."""

import re
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field

from app.services.llm.background import sanitize_gemini_schema

ToolRiskLevel = Literal["read_only", "mutating", "blocked"]

_VALID_TOOL_NAME_RE = re.compile(r"[^a-zA-Z0-9_-]+")


def build_tool_full_name(server_id: str, mcp_name: str) -> str:
    raw = f"{server_id}__{mcp_name}"
    cleaned = _VALID_TOOL_NAME_RE.sub("_", raw).strip("_")[:64]
    return cleaned or "mcp_tool"


class ToolSpec(BaseModel):
    """Registered MCP tool descriptor with fail-closed local policy classification."""

    model_config = ConfigDict(extra="ignore")

    full_name: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    server_id: str = Field(..., min_length=1, max_length=64)
    mcp_name: str = Field(..., min_length=1, max_length=64)
    description: str = Field(default="", max_length=512)
    input_schema: Dict[str, Any] = Field(default_factory=dict)
    risk_level: ToolRiskLevel = "mutating"

    def to_openai_tool(self) -> Dict[str, Any]:
        params = dict(self.input_schema or {})
        if not params or params.get("type") != "object":
            params = {"type": "object", "properties": params.get("properties") or {}}
        return {
            "type": "function",
            "function": {
                "name": self.full_name,
                "description": (self.description or self.mcp_name)[:512],
                "parameters": params,
            },
        }

    def to_gemini_declaration(self) -> Dict[str, Any]:
        decl: Dict[str, Any] = {
            "name": self.full_name,
            "description": (self.description or self.mcp_name)[:512],
        }
        clean_params = sanitize_gemini_schema(self.input_schema or {})
        # Gemini v1beta rejects OBJECT schemas that declare no properties
        if clean_params.get("properties"):
            decl["parameters"] = clean_params
        return decl


class ToolCallRequest(BaseModel):
    """Normalized model-emitted tool invocation."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default="")
    name: str = Field(..., min_length=1, max_length=128)
    arguments: Dict[str, Any] = Field(default_factory=dict)
    parse_error: Optional[str] = None
    raw_arguments: Optional[str] = None


class ToolExecutionEvent(BaseModel):
    """Telemetry/audit summary of a tool decision or execution within a turn."""

    model_config = ConfigDict(extra="ignore")

    tool_name: str
    server_id: str
    mcp_name: str
    risk_level: ToolRiskLevel
    status: Literal["executed", "approval_required", "blocked", "failed", "timeout", "invalid_args"]
    latency_ms: Optional[float] = None
    approval_id: Optional[str] = None
    preview: Optional[str] = None
    error: Optional[str] = None


class PendingToolApproval(BaseModel):
    """HITL approval token persisted in SQLite for mutating MCP tool calls."""

    model_config = ConfigDict(extra="ignore")

    id: str
    session_id: Optional[str] = None
    server_id: str
    tool_name: str
    mcp_name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    risk_level: ToolRiskLevel = "mutating"
    status: str = "pending"
    created_at: float
    expires_at: float
    decided_at: Optional[float] = None
    result_preview: Optional[str] = None
    error: Optional[str] = None


class ApprovalDecisionResponse(BaseModel):
    """Outcome of POST /api/tools/approvals/{id}/approve or /reject."""

    model_config = ConfigDict(extra="ignore")

    ok: bool
    approval: PendingToolApproval
    output: Optional[str] = None
    latency_ms: Optional[float] = None
