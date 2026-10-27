import os
from pathlib import Path
from typing import List

# Base Directories
CORE_DIR = Path(__file__).resolve().parent
APP_DIR = CORE_DIR.parent
SERVER_DIR = APP_DIR.parent

DATA_DIR = Path(os.environ.get("AMADEUS_DATA_DIR", str(SERVER_DIR / "data")))
PERSONAS_DIR = SERVER_DIR / "personas"
WEIGHTS_DIR = SERVER_DIR / "weights"
TRAINING_DIR = SERVER_DIR / "training"

# Runtime Database Paths
SQLITE_PATH = DATA_DIR / "amadeus.db"
CHROMA_DIR = DATA_DIR / "memory_db"

# Vector Retrieval Distance Thresholds (L2 squared in Chroma default space; lower = closer)
MEMORY_MAX_DISTANCE: float = 1.00
EXEMPLAR_MAX_DISTANCE: float = 0.65
UPSERT_MAX_DISTANCE: float = 0.75

# Ensure runtime directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
PERSONAS_DIR.mkdir(parents=True, exist_ok=True)
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
TRAINING_DIR.mkdir(parents=True, exist_ok=True)

# System Meta
APP_TITLE = "Amadeus System Core API"
APP_VERSION = "0.1.0"
APP_DESCRIPTION = "Cognitive memory with SQLite & ChromaDB, persona simulation, and neural speech synthesis for Amadeus."

# LLM Config
API_BASE_GEMINI = "https://generativelanguage.googleapis.com/v1beta"
MAX_HISTORY_MESSAGES = 20

PREFERRED_GEMINI_MODELS: List[str] = [
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-3.8-flash",
    "gemini-flash-latest"
]

OPENROUTER_FREE_MODELS: List[str] = [
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "liquid/lfm-2.5-2.6b:free",
    "poolside/laguna-s-2.1:free",
    "dots-studio/dots-3-note-preview:free",
    "nvidia/nemotron-3.5-lightning:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
]

GROQ_FALLBACK_MODELS: List[str] = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant"
]
