from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.llm.orchestrator import orchestrator

router = APIRouter()

@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    return await orchestrator.handle_chat(req)

@router.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    # Starlette cancels the generator on client disconnect (barge-in), which closes the provider stream.
    return StreamingResponse(
        orchestrator.stream_chat_sse(req),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
