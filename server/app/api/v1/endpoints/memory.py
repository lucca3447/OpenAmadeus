from fastapi import APIRouter
from app.db.memory_store import memory_store
from app.schemas.memory import AddMemoryRequest

router = APIRouter()

@router.get("/memories")
def get_memories():
    return memory_store.get_all_memories()

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
