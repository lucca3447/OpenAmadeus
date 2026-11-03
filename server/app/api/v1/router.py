from fastapi import APIRouter
from app.api.v1.endpoints import health, chat, memory, voice, persona

api_router = APIRouter()

api_router.include_router(health.router, tags=["Health"])
api_router.include_router(chat.router, tags=["Chat"])
api_router.include_router(memory.router, tags=["Memories & Sessions"])
api_router.include_router(voice.router, tags=["Voice & TTS"])
api_router.include_router(persona.router, tags=["Personas"])
