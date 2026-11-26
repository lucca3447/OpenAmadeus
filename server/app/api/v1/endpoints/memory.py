import asyncio
from typing import Annotated, Optional
from fastapi import APIRouter, Query
from app.db.memory_store import memory_store
from app.schemas.memory import AddMemoryRequest
from app.services.cognitive_worker import cognitive_worker

router = APIRouter()

@router.get("/core-memory")
def get_core_memory():
    return {"blocks": memory_store.get_core_memory_snapshot()}

@router.get("/memories")
def get_memories(
    include_history: Annotated[bool, Query()] = False,
    as_of: Annotated[Optional[float], Query()] = None,
):
    return memory_store.get_all_memories(include_history=include_history, as_of=as_of)

@router.get("/memories/{memory_id}/history")
def get_memory_history(memory_id: str):
    return {"memoryId": memory_id, "chain": memory_store.get_memory_history(memory_id)}

@router.post("/memories")
def create_memory(req: AddMemoryRequest):
    return memory_store.add_memory(
        category=req.category,
        title=req.title,
        content=req.content,
        emotional_weight=req.emotionalWeight or "Factual",
        source=req.source or "custom"
    )

@router.delete("/memories")
def clear_learned_memories():
    count = memory_store.clear_learned_memories()
    return {"ok": True, "deletedCount": count}

@router.delete("/memories/{memory_id}")
def delete_memory(memory_id: str):
    memory_store.delete_memory(memory_id)
    return {"ok": True, "deleted": memory_id}

@router.get("/sessions")
def get_sessions():
    return memory_store.list_sessions()

@router.post("/sessions/new")
def new_session():
    session_id = memory_store.create_session()
    return {"sessionId": session_id}

@router.get("/sessions/{session_id}/messages")
def get_session_messages(session_id: str):
    return memory_store.get_session_messages(session_id)

@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    memory_store.delete_session(session_id)
    return {"ok": True, "deleted": session_id}

@router.post("/sessions/{session_id}/close")
async def close_session(session_id: str):
    summary = await asyncio.to_thread(memory_store.close_session, session_id)
    enqueued = cognitive_worker.enqueue_session(session_id, reason="hangup")
    return {
        "ok": True,
        "sessionId": session_id,
        "contextSummary": summary,
        "consolidationQueued": enqueued,
    }
