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
        "uptimeSeconds": round(time.time() - metrics_registry.started_at, 1),
    }


@router.get("/metrics")
def get_metrics():
    return metrics_registry.snapshot()


@router.post("/metrics/reset")
def reset_metrics():
    metrics_registry.reset()
    return {"ok": True}
