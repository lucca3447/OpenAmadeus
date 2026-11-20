import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import APP_TITLE, APP_VERSION, APP_DESCRIPTION
from app.core.lifespan import lifespan
from app.api.v1.router import api_router

app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    description=APP_DESCRIPTION,
    lifespan=lifespan
)

DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://tauri.localhost,tauri://localhost"
allowed_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Audio-Format",
        "X-Sample-Rate",
        "X-TTS-Engine",
        "X-TTS-Fallback",
        "X-TTS-Mode",
        "X-TTS-Handshake-Ms",
    ],
)

# Primary API endpoints prefixed with /api
app.include_router(api_router, prefix="/api")

# Root fallback route mapping for complete backward compatibility
app.include_router(api_router)

if __name__ == "__main__":
    host = os.environ.get("AMADEUS_HOST", "127.0.0.1")
    uvicorn.run("main:app", host=host, port=8000, reload=True)
