import os
import sys
import subprocess
import asyncio
from typing import Optional
import httpx

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(CURRENT_DIR, "..", "..", ".."))
RVC_PYTHON = os.path.join(SERVER_DIR, "rvc_env", "Scripts", "python.exe")
WORKER_SCRIPT = os.path.join(CURRENT_DIR, "rvc_worker.py")
WORKER_URL = "http://127.0.0.1:8001"

_worker_process: Optional[subprocess.Popen] = None
_spawn_lock: Optional[asyncio.Lock] = None


def _get_spawn_lock() -> asyncio.Lock:
    global _spawn_lock
    if _spawn_lock is None:
        _spawn_lock = asyncio.Lock()
    return _spawn_lock


class RVCManager:
    @classmethod
    async def is_worker_healthy(cls) -> bool:
        try:
            async with httpx.AsyncClient(timeout=0.8) as client:
                res = await client.get(f"{WORKER_URL}/health")
                if res.status_code == 200:
                    data = res.json()
                    return data.get("status") == "ready"
        except Exception:
            pass
        return False

    @classmethod
    def start_worker_process(cls) -> bool:
        global _worker_process
        if not os.path.exists(RVC_PYTHON) or not os.path.exists(WORKER_SCRIPT):
            print(f"[RVC Manager] Cannot start worker: python or script missing ({RVC_PYTHON})")
            return False

        try:
            print("[RVC Manager] Launching background RVC worker on port 8001...")
            # On Windows, DETACHED_PROCESS flag allows worker to run independently
            creationflags = 0
            if sys.platform == "win32":
                creationflags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP

            _worker_process = subprocess.Popen(
                [RVC_PYTHON, WORKER_SCRIPT],
                cwd=CURRENT_DIR,
                creationflags=creationflags,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except Exception as e:
            print(f"[RVC Manager] Error spawning worker process: {e}")
            return False

    @classmethod
    async def ensure_worker(cls, max_wait_sec: float = 8.0) -> bool:
        if await cls.is_worker_healthy():
            return True

        async with _get_spawn_lock():
            # Re-check under lock in case another coroutine just started the worker
            if await cls.is_worker_healthy():
                return True

            if not cls.start_worker_process():
                return False

            # Poll until worker is ready or timeout expires
            start_time = asyncio.get_event_loop().time()
            while asyncio.get_event_loop().time() - start_time < max_wait_sec:
                await asyncio.sleep(0.5)
                if await cls.is_worker_healthy():
                    print("[RVC Manager] RVC Worker is online and healthy!")
                    return True

            print("[RVC Manager] Worker did not report ready within timeout.")
            return False

    @classmethod
    def list_available_models(cls) -> list[str]:
        weights_dir = os.path.join(SERVER_DIR, "weights")
        models = []
        if os.path.isdir(weights_dir):
            for root, _, files in os.walk(weights_dir):
                for f in files:
                    if f.endswith(".pth") and not f.startswith("hubert") and not f.startswith("rmvpe"):
                        models.append(os.path.splitext(f)[0])
        res = sorted(list(set(models)))
        return res if res else ["KurisuRVCv147"]

    @classmethod
    async def convert(
        cls,
        audio_bytes: bytes,
        pitch_shift: int = 0,
        index_rate: float = 0.75,
        model_name: Optional[str] = "KurisuRVCv147",
    ) -> Optional[bytes]:
        is_healthy = await cls.is_worker_healthy()
        if not is_healthy:
            is_healthy = await cls.ensure_worker(max_wait_sec=10.0)

        if not is_healthy:
            print("[RVC Manager] Worker is offline; falling back to direct Edge-TTS audio.")
            return None

        params = {
            "pitch_shift": pitch_shift,
            "index_rate": index_rate,
        }
        if model_name:
            params["model_name"] = model_name

        try:
            async with httpx.AsyncClient(timeout=35.0) as client:
                res = await client.post(
                    f"{WORKER_URL}/convert",
                    content=audio_bytes,
                    params=params,
                    headers={"Content-Type": "application/octet-stream"},
                )
                if res.status_code == 200:
                    return res.content
                print(f"[RVC Manager] Worker conversion error ({res.status_code}): {res.text}")
                return None
        except Exception as e:
            print(f"[RVC Manager] Exception during voice conversion request: {e}")
            return None

