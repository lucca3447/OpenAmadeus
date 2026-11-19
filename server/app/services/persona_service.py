import json
import re
from fastapi import HTTPException
from app.core.config import PERSONAS_DIR

_SAFE_PERSONA_ID = re.compile(r"^[a-zA-Z0-9_-]+$")


def load_persona(persona_id: str) -> dict:
    if not _SAFE_PERSONA_ID.fullmatch(persona_id or ""):
        raise HTTPException(status_code=400, detail="Invalid persona id.")
    base_dir = PERSONAS_DIR.resolve()
    file_path = (base_dir / f"{persona_id}.json").resolve()
    if not file_path.is_relative_to(base_dir):
        raise HTTPException(status_code=400, detail="Invalid persona path.")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Persona '{persona_id}' not found.")
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)
