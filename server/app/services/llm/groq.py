import re
from typing import List
import httpx
from app.core.config import GROQ_FALLBACK_MODELS

async def get_groq_candidate_models(client: httpx.AsyncClient, api_key: str) -> List[str]:
    """
    Queries Groq's /openai/v1/models endpoint using the user's API key to find
    which models are currently active, avoiding decommissioned models.
    """
    try:
        res = await client.get(
            "https://api.groq.com/openai/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15.0
        )
        if res.status_code == 200:
            data = res.json()
            models = [
                m["id"] for m in data.get("data", [])
                if isinstance(m.get("id"), str)
                and m.get("active", True) is not False
                and not re.search(r"whisper|tts|audio|embed|guard", m["id"], re.IGNORECASE)
            ]
            if models:
                def score_groq(m: str) -> int:
                    score = 0
                    if "llama-3.3-70b" in m: score += 160
                    elif "70b" in m: score += 110
                    elif "120b" in m: score += 100
                    elif "27b" in m or "32b" in m: score += 85
                    elif "20b" in m: score += 70
                    elif "8b" in m: score += 50
                    if "llama" in m: score += 30
                    if "versatile" in m: score += 20
                    if "qwen" in m: score += 20
                    if "gpt-oss" in m: score += 10
                    if "instant" in m: score += 10
                    return score

                models.sort(key=score_groq, reverse=True)
                print(f"[Amadeus Core] Groq active models discovered: {models[:6]}")
                return models
    except Exception as e:
        print(f"[Amadeus Core] Could not fetch Groq models list: {e}")

    # Fallback if discovery failed
    return list(GROQ_FALLBACK_MODELS)
