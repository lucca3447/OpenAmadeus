"""Strict Pydantic v2 schemas acting as the trust boundary for background cognitive LLM outputs."""

import math
import re
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import CORE_MEMORY_BLOCK_KEYS, CORE_MEMORY_MAX_BLOCK_CHARS

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]+")
_WHITESPACE_RE = re.compile(r"\s+")


def _clean_text(value: Any, max_len: int) -> str:
    if value is None or max_len <= 0:
        return ""
    text = value if isinstance(value, str) else str(value)
    text = _CONTROL_CHAR_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text[:max_len]


class CoreMemoryPatch(BaseModel):
    """Fixed-field patch for RAM-resident Core Memory blocks (Gemini responseSchema safe)."""

    model_config = ConfigDict(extra="ignore")

    operator_profile: Optional[str] = Field(
        default=None,
        description="Identity, role, background, and stable personal facts about the operator.",
    )
    current_projects: Optional[str] = Field(
        default=None,
        description="Active coding, research, study, or work projects the operator is focused on.",
    )
    preferences: Optional[str] = Field(
        default=None,
        description="Communication style, language, tools, and recurring preferences or dislikes.",
    )
    open_loops: Optional[str] = Field(
        default=None,
        description="Unresolved tasks, upcoming deadlines, or follow-ups to revisit later.",
    )

    @field_validator("operator_profile", "current_projects", "preferences", "open_loops", mode="before")
    @classmethod
    def _sanitize_block(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        cleaned = _clean_text(value, CORE_MEMORY_MAX_BLOCK_CHARS)
        return cleaned or None

    def to_non_empty_dict(self) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for key in CORE_MEMORY_BLOCK_KEYS:
            val = getattr(self, key, None)
            if val:
                out[key] = val
        return out


class ExtractedFact(BaseModel):
    """Individual durable fact distilled from a conversation session."""

    model_config = ConfigDict(extra="ignore")

    title: str = Field(..., min_length=1, max_length=80)
    content: str = Field(..., min_length=1, max_length=280)
    category: Literal["user", "research", "relationship", "anecdote", "biography"] = "user"
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)
    emotional_weight: str = Field(default="Factual", max_length=80)

    @field_validator("title", mode="before")
    @classmethod
    def _sanitize_title(cls, value: Any) -> str:
        return _clean_text(value, 80)

    @field_validator("content", mode="before")
    @classmethod
    def _sanitize_content(cls, value: Any) -> str:
        return _clean_text(value, 280)

    @field_validator("emotional_weight", mode="before")
    @classmethod
    def _sanitize_emotional_weight(cls, value: Any) -> str:
        return _clean_text(value, 80) or "Factual"

    @field_validator("confidence", mode="before")
    @classmethod
    def _clamp_confidence(cls, value: Any) -> float:
        if value is None:
            return 0.8
        if isinstance(value, bool):
            raise ValueError("confidence must be numeric")
        num = float(value)
        if not math.isfinite(num):
            raise ValueError("confidence must be finite")
        return max(0.0, min(1.0, num))


class SleepTimeConsolidation(BaseModel):
    """Structured output contract for post-call / idle sleep-time consolidation."""

    model_config = ConfigDict(extra="ignore")

    session_summary: str = Field(default="", max_length=600)
    core_memory_updates: CoreMemoryPatch = Field(default_factory=CoreMemoryPatch)
    facts: List[ExtractedFact] = Field(default_factory=list, max_length=8)

    @field_validator("session_summary", mode="before")
    @classmethod
    def _sanitize_summary(cls, value: Any) -> str:
        return _clean_text(value, 600)

    @field_validator("core_memory_updates", mode="before")
    @classmethod
    def _normalize_patch(cls, value: Any) -> Any:
        return {} if value is None else value

    @field_validator("facts", mode="before")
    @classmethod
    def _bound_facts(cls, value: Any) -> Any:
        if value is None:
            return []
        if isinstance(value, list):
            return value[:8]
        return value
