import os
import time
from fastapi import APIRouter
from app.db.memory_store import memory_store
from app.services.voice_service import check_edge_tts_available
from app.services.metrics import metrics_registry
from app.core.config import APP_VERSION

router = APIRouter()

@router.get("/health")
def health():
    total_memories, total_sessions = memory_store.get_counts()
    configured = {
        "groq": bool(os.environ.get("GROQ_API_KEY", "").strip()),
        "openrouter": bool(os.environ.get("OPENROUTER_API_KEY", "").strip()),
        "gemini": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
    }
    active_llm_provider = next(
        (name for name in ("groq", "openrouter", "gemini") if configured[name]),
        "offline",
    )
    return {
        "status": "online",
        "system": f"AMADEUS OS v{APP_VERSION}",
        "database": "SQLite (amadeus.db)",
        "vectorStore": "ChromaDB (./data/memory_db)",
        "chromaCount": memory_store.collection.count(),
        "exemplarsCount": memory_store.exemplars_collection.count(),
        "totalMemories": total_memories,
        "totalSessions": total_sessions,
        "edgeTtsAvailable": check_edge_tts_available(),
        "configuredProviders": configured,
        "activeLlmProvider": active_llm_provider,
        "uptimeSeconds": round(time.time() - metrics_registry.started_at, 1),
    }


@router.get("/metrics")
def get_metrics():
    return metrics_registry.snapshot()


@router.post("/metrics/reset")
def reset_metrics():
    metrics_registry.reset()
    return {"ok": True}
