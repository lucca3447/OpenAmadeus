import re
import time
from typing import List, Dict, Optional, Tuple
import httpx
from app.core.config import API_BASE_GEMINI, PREFERRED_GEMINI_MODELS

MODEL_LIST_TTL_SEC = 600.0
_gemini_usable_cache: Dict[str, Tuple[float, List[str]]] = {}


def clear_gemini_model_cache() -> None:
    _gemini_usable_cache.clear()

class GeminiError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(f"Gemini API error {code}: {message}")
        self.code = code
        self.message = message

def score_model(name: str) -> float:
    match = re.search(r"gemini-(\d+(?:\.\d+)?)", name)
    version = float(match.group(1)) if match else 0.0
    score = version * 100
    if "lite" in name:
        score -= 30
    if "preview" in name or "exp" in name:
        score -= 10
    return score

async def gemini_request(client: httpx.AsyncClient, method: str, path: str, api_key: str, body: Optional[dict] = None) -> dict:
    url = f"{API_BASE_GEMINI}/{path}"
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key
    }
    try:
        res = await client.request(method, url, headers=headers, json=body, timeout=30.0)
    except Exception as e:
        raise GeminiError(0, f"Sem conexão com a Google: {e}")

    if res.status_code != 200:
        data = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
        msg = (data.get("error") or {}).get("message") or res.text or "Erro desconhecido"
        raise GeminiError(res.status_code, msg)

    return res.json()

async def get_candidate_models(client: httpx.AsyncClient, api_key: str, model_cache: Dict[str, str], force: bool = False) -> List[str]:
    fp = api_key[-8:]
    now = time.monotonic()
    usable: Optional[List[str]] = None
    if not force and fp in _gemini_usable_cache:
        cached_at, cached_usable = _gemini_usable_cache[fp]
        if now - cached_at < MODEL_LIST_TTL_SEC:
            usable = list(cached_usable)

    if usable is None:
        data = await gemini_request(client, "GET", "models?pageSize=1000", api_key)
        usable = [
            m["name"].replace("models/", "")
            for m in data.get("models", [])
            if "generateContent" in m.get("supportedGenerationMethods", [])
            and m["name"].replace("models/", "").startswith("gemini")
            and not re.search(r"tts|image|audio|live|embedding", m["name"])
        ]
        if usable:
            _gemini_usable_cache[fp] = (now, list(usable))

    if not usable:
        raise GeminiError(404, "Nenhum modelo de chat disponível para esta chave.")

    candidates: List[str] = []
    if not force and fp in model_cache and model_cache[fp] in usable:
        candidates.append(model_cache[fp])

    for pref in PREFERRED_GEMINI_MODELS:
        if pref in usable and pref not in candidates:
            candidates.append(pref)

    flash_models = [m for m in usable if "flash" in m and m not in candidates]
    flash_models.sort(key=score_model, reverse=True)
    candidates.extend(flash_models)

    remaining = [m for m in usable if m not in candidates]
    remaining.sort(key=score_model, reverse=True)
    candidates.extend(remaining)

    return candidates
