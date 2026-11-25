import os
from pathlib import Path
from typing import List, Tuple
from dotenv import load_dotenv

# Base Directories
CORE_DIR = Path(__file__).resolve().parent
APP_DIR = CORE_DIR.parent
SERVER_DIR = APP_DIR.parent
load_dotenv(SERVER_DIR / ".env")

DATA_DIR = Path((os.environ.get("AMADEUS_DATA_DIR") or "").strip() or str(SERVER_DIR / "data"))
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
APP_VERSION = "0.3.3"
APP_DESCRIPTION = "Cognitive memory with SQLite & ChromaDB, persona simulation, and neural speech synthesis for Amadeus."

# LLM Config
API_BASE_GEMINI = "https://generativelanguage.googleapis.com/v1beta"
MAX_HISTORY_MESSAGES = 20

PREFERRED_GEMINI_MODELS: List[str] = [
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash-lite",
    "gemini-flash-lite-latest",
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
    "llama-3.3-70b-versatile",
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant"
]

# Cognitive Core & Sleep-Time Compute (v0.4.0)
PREFERRED_BG_GEMINI_MODELS: List[str] = [
    "gemini-flash-lite-latest",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest",
    "gemini-3.5-flash",
]

GROQ_BG_MODELS: List[str] = [
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-120b",
]

CORE_MEMORY_BLOCK_KEYS: Tuple[str, ...] = (
    "operator_profile",
    "current_projects",
    "preferences",
    "open_loops",
)
CORE_MEMORY_MAX_BLOCK_CHARS: int = 400
COGNITIVE_QUEUE_MAXSIZE: int = 32
COGNITIVE_SWEEP_INTERVAL_SEC: float = 30.0


def get_cognitive_idle_sec() -> float:
    raw = (os.environ.get("AMADEUS_IDLE_CONSOLIDATE_SEC") or "").strip()
    if not raw:
        return 300.0
    try:
        return max(5.0, float(raw))
    except ValueError:
        return 300.0


# MCP Client & Agent Tool Execution (v0.4.0)
MCP_CONFIG_PATH: Path = Path(
    (os.environ.get("AMADEUS_MCP_CONFIG") or "").strip() or str(SERVER_DIR / "mcp_servers.json")
)
LAB_NOTES_DIR: Path = DATA_DIR / "lab_notes"
MCP_MAX_TOOL_STEPS: int = 3
MCP_TOOL_TIMEOUT_SEC: float = 10.0
MCP_MAX_OUTPUT_CHARS: int = 4000
MCP_APPROVAL_TTL_SEC: float = 300.0


def get_mcp_config_path() -> Path:
    raw = (os.environ.get("AMADEUS_MCP_CONFIG") or "").strip()
    return Path(raw) if raw else (SERVER_DIR / "mcp_servers.json")


def is_mcp_enabled() -> bool:
    raw = (os.environ.get("AMADEUS_MCP_ENABLED") or "true").strip().lower()
    return raw not in ("0", "false", "no", "off")
