import os
import sys
import subprocess
import asyncio
from typing import Optional, Tuple, AsyncGenerator
import httpx

from .emotion_mapper import resolve_acoustic_instruct

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(CURRENT_DIR, "..", "..", ".."))

# Candidate virtual environments with qwen-tts and torch+cu124 installed
CANDIDATE_PYTHONS = [
    os.path.join(SERVER_DIR, "qwen_env", "Scripts", "python.exe"),
    os.path.join(SERVER_DIR, "qwen_env", "bin", "python"),
    r"C:\codigos\qwentsskurisu\qwen_env\Scripts\python.exe",
    os.path.join(SERVER_DIR, "venv", "Scripts", "python.exe"),
    os.path.join(SERVER_DIR, "venv", "bin", "python"),
]

import socket

DEFAULT_WORKER_PORT = 8005
WORKER_PORT = int(os.environ.get("QWEN_WORKER_PORT", str(DEFAULT_WORKER_PORT)))
WORKER_SCRIPT = os.path.join(CURRENT_DIR, "qwen_worker.py")
WORKER_URL = f"http://127.0.0.1:{WORKER_PORT}"

_worker_process: Optional[subprocess.Popen] = None
_spawn_lock = asyncio.Lock()
_client: Optional[httpx.AsyncClient] = None


def is_port_in_use(port: Optional[int] = None) -> bool:
    target_port = port if port is not None else WORKER_PORT
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            return s.connect_ex(('127.0.0.1', target_port)) == 0
    except Exception:
        return False


def kill_process_on_port(port: Optional[int] = None):
    """Kills any stale/orphaned process binding the target port to prevent EADDRINUSE collisions."""
    target_port = port if port is not None else WORKER_PORT
    if sys.platform != "win32":
        return
    try:
        cmd = f'netstat -ano | findstr :{target_port}'
        out = subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL)
        for line in out.strip().splitlines():
            if "LISTENING" in line:
                parts = line.strip().split()
                pid = parts[-1]
                if pid and pid != "0":
                    subprocess.run(f'taskkill /F /PID {pid}', shell=True, capture_output=True)
                    print(f"[Qwen3 Manager] Terminated stale process on port {target_port} (PID {pid}).")
    except Exception:
        pass


class QwenTTSManager:
    @classmethod
    def get_client(cls) -> httpx.AsyncClient:
        global _client
        if _client is None or _client.is_closed:
            _client = httpx.AsyncClient(
                timeout=httpx.Timeout(90.0, connect=5.0, read=90.0),
                limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
            )
        return _client

    @classmethod
    def get_python_executable(cls) -> Optional[str]:
        for candidate in CANDIDATE_PYTHONS:
            if os.path.exists(candidate):
                return candidate
        return None

    @classmethod
    def resolve_target_url(
        cls,
        qwen_mode: Optional[str] = None,
        custom_url: Optional[str] = None,
    ) -> str:
        """
        Resolves the target Qwen worker URL:
        1. Explicit custom_url (from request or frontend settings)
        2. Environment variable QWEN_REMOTE_URL (if mode is remote or auto)
        3. Local loopback default (http://127.0.0.1:8005)
        """
        if custom_url and custom_url.strip():
            url = custom_url.strip().rstrip("/")
            if url.startswith("http://") or url.startswith("https://"):
                return url

        mode = (qwen_mode or os.environ.get("QWEN_MODE", "remote")).lower()
        if mode in ("remote", "auto"):
            env_remote = os.environ.get("QWEN_REMOTE_URL", "").strip().rstrip("/")
            if env_remote and (env_remote.startswith("http://") or env_remote.startswith("https://")):
                return env_remote

        return f"http://127.0.0.1:{WORKER_PORT}"

    @classmethod
    def is_remote_url(cls, url: str) -> bool:
        norm = url.lower()
        return not ("127.0.0.1" in norm or "localhost" in norm)

    @classmethod
    async def ping_worker(cls, target_url: Optional[str] = None) -> dict:
        """
        Probes the target worker /health endpoint, returning status, device telemetry,
        and latency in milliseconds.
        """
        url = (target_url or cls.resolve_target_url()).rstrip("/")
        import time
        t0 = time.perf_counter()
        try:
            client = cls.get_client()
            res = await client.get(f"{url}/health", timeout=4.0)
            ping_ms = round((time.perf_counter() - t0) * 1000, 1)
            if res.status_code == 200:
                data = res.json()
                return {
                    "status": data.get("status", "unknown"),
                    "device": data.get("device", "unknown"),
                    "vram_allocated_mb": data.get("vram_allocated_mb"),
                    "ping_ms": ping_ms,
                    "url": url,
                    "mode": "remote" if cls.is_remote_url(url) else "local",
                    "error": None,
                }
            return {
                "status": "error",
                "device": None,
                "vram_allocated_mb": None,
                "ping_ms": ping_ms,
                "url": url,
                "mode": "remote" if cls.is_remote_url(url) else "local",
                "error": f"HTTP {res.status_code}: {res.text[:100]}",
            }
        except Exception as e:
            ping_ms = round((time.perf_counter() - t0) * 1000, 1)
            return {
                "status": "offline",
                "device": None,
                "vram_allocated_mb": None,
                "ping_ms": ping_ms,
                "url": url,
                "mode": "remote" if cls.is_remote_url(url) else "local",
                "error": str(e),
            }

    @classmethod
    async def is_worker_healthy(cls, target_url: Optional[str] = None) -> bool:
        url = (target_url or cls.resolve_target_url()).rstrip("/")
        timeout_sec = 4.0 if cls.is_remote_url(url) else 1.5
        try:
            client = cls.get_client()
            res = await client.get(f"{url}/health", timeout=timeout_sec)
            if res.status_code == 200:
                data = res.json()
                return data.get("status") == "ready"
        except Exception:
            pass
        return False

    @classmethod
    def start_worker_process(cls) -> bool:
        global _worker_process

        if _worker_process is not None and _worker_process.poll() is None:
            return True

        py_exe = cls.get_python_executable()
        if not py_exe or not os.path.exists(WORKER_SCRIPT):
            print(f"[Qwen3 Manager] Cannot start worker: python binary ({py_exe}) or script not found.")
            return False

        try:
            print(f"[Qwen3 Manager] Spawning Qwen3 background worker via {py_exe} on port {WORKER_PORT}...")
            creationflags = 0
            if sys.platform == "win32":
                creationflags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP

            log_file = os.path.join(SERVER_DIR, "data", "qwen_worker.log")
            os.makedirs(os.path.dirname(log_file), exist_ok=True)
            log_handle = open(log_file, "a", encoding="utf-8")

            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            env["QWEN_WORKER_PORT"] = str(WORKER_PORT)
            env["HF_HUB_OFFLINE"] = "1"
            env["TRANSFORMERS_OFFLINE"] = "1"

            _worker_process = subprocess.Popen(
                [py_exe, WORKER_SCRIPT],
                cwd=CURRENT_DIR,
                creationflags=creationflags,
                stdout=log_handle,
                stderr=log_handle,
                env=env,
            )
            return True
        except Exception as e:
            print(f"[Qwen3 Manager] Error spawning worker: {e}")
            return False

    @classmethod
    async def get_worker_status(cls, target_url: Optional[str] = None) -> Optional[str]:
        url = (target_url or cls.resolve_target_url()).rstrip("/")
        timeout_sec = 4.0 if cls.is_remote_url(url) else 2.0
        try:
            client = cls.get_client()
            res = await client.get(f"{url}/health", timeout=timeout_sec)
            if res.status_code == 200:
                data = res.json()
                return data.get("status")
        except Exception:
            pass
        return None

    @classmethod
    async def ensure_worker(cls, max_wait_sec: float = 150.0, target_url: Optional[str] = None) -> bool:
        url = target_url or cls.resolve_target_url()
        # If targeting a remote server, do not attempt to spawn local subprocesses
        if cls.is_remote_url(url):
            return await cls.is_worker_healthy(url)

        if await cls.is_worker_healthy(url):
            return True

        async with _spawn_lock:
            if await cls.is_worker_healthy(url):
                return True

            # If target worker port is occupied but unreachable/unhealthy, clean up stale zombie process
            if is_port_in_use(WORKER_PORT):
                status = await cls.get_worker_status(url)
                if status != "ready" and status != "initializing":
                    print(f"[Qwen3 Manager] Port {WORKER_PORT} occupied by unresponsive process. Clearing stale port...")
                    kill_process_on_port(WORKER_PORT)
                    await asyncio.sleep(0.5)

            if not cls.start_worker_process():
                return False

            print("[Qwen3 Manager] Waiting for local model to load into GPU memory...")
            start_time = asyncio.get_event_loop().time()
            while asyncio.get_event_loop().time() - start_time < max_wait_sec:
                await asyncio.sleep(1.0)
                status = await cls.get_worker_status(url)
                if status == "ready":
                    print("[Qwen3 Manager] Qwen3 Worker is ready and resident in GPU memory!")
                    return True
                if status and status.startswith("error:"):
                    print(f"[Qwen3 Manager] Worker reported initialization failure: {status}")
                    return False

            print("[Qwen3 Manager] Timeout waiting for local Qwen3 Worker initialization.")
            return False

    @classmethod
    async def synthesize(
        cls,
        text: str,
        emotion: Optional[str] = None,
        custom_instruct: Optional[str] = None,
        language: str = "Portuguese",
        qwen_mode: Optional[str] = "remote",
        qwen_remote_url: Optional[str] = None,
    ) -> Optional[bytes]:
        """
        Synthesizes speech using the Qwen3-TTS worker (either remote Colab/tunnel or local GPU).
        Returns WAV audio bytes, or None if worker is offline or fails (allowing graceful fallback).
        """
        target_url = cls.resolve_target_url(qwen_mode=qwen_mode, custom_url=qwen_remote_url)
        is_remote = cls.is_remote_url(target_url)

        print(f"[Qwen3 Manager] Selected target: {target_url} (mode: {'remote' if is_remote else 'local'})")

        if is_remote:
            # Remote check with quick probe
            is_healthy = await cls.is_worker_healthy(target_url)
            if not is_healthy:
                print(f"[Qwen3 Manager] Remote worker at {target_url} is unreachable or not ready.")
                return None
        else:
            # Local worker management
            is_healthy = await cls.ensure_worker(max_wait_sec=150.0, target_url=target_url)
            if not is_healthy:
                print("[Qwen3 Manager] Local worker offline or initialization timed out.")
                return None

        # Resolve emotional and acoustic environment prompt
        instruct = resolve_acoustic_instruct(emotion=emotion, custom_instruct=custom_instruct)

        try:
            print(f"[Qwen3 Manager] Dispatching synthesis to {target_url} (chars: {len(text)})...")
            client = cls.get_client()
            res = await client.post(
                f"{target_url}/synthesize",
                json={
                    "text": text,
                    "language": language or "Portuguese",
                    "instruct": instruct,
                    "temperature": 0.65,
                    "top_p": 0.90,
                    "repetition_penalty": 1.05,
                    "max_new_tokens": 2048,
                },
                timeout=90.0,
            )
            if res.status_code == 200:
                return res.content
            print(f"[Qwen3 Manager] Worker at {target_url} returned error {res.status_code}: {res.text[:150]}")
        except httpx.TimeoutException:
            print(f"[Qwen3 Manager] Synthesis timed out after 90s at {target_url} (utterance: {len(text)} chars).")
        except Exception as e:
            print(f"[Qwen3 Manager] Communication error with {target_url}: {e}")

        return None

    @classmethod
    async def synthesize_stream(
        cls,
        text: str,
        emotion: Optional[str] = None,
        custom_instruct: Optional[str] = None,
        language: str = "Portuguese",
        qwen_mode: Optional[str] = "remote",
        qwen_remote_url: Optional[str] = None,
    ) -> Tuple[str, AsyncGenerator[bytes, None]]:
        """
        Synthesizes speech using streaming chunked transfer from Qwen3-TTS worker.
        Yields raw PCM16 (audio/L16;rate=24000) chunks as they are generated by CUDA graphs.
        """
        target_url = cls.resolve_target_url(qwen_mode=qwen_mode, custom_url=qwen_remote_url)
        is_remote = cls.is_remote_url(target_url)

        print(f"[Qwen3 Manager] Selected streaming target: {target_url} (mode: {'remote' if is_remote else 'local'})")

        if is_remote:
            is_healthy = await cls.is_worker_healthy(target_url)
            if not is_healthy:
                raise RuntimeError(f"Remote Qwen3 worker at {target_url} is unreachable or not ready.")
        else:
            is_healthy = await cls.ensure_worker(max_wait_sec=150.0, target_url=target_url)
            if not is_healthy:
                raise RuntimeError("Local Qwen3 worker offline or initialization timed out.")

        instruct = resolve_acoustic_instruct(emotion=emotion, custom_instruct=custom_instruct)
        client = cls.get_client()

        async def _stream_generator() -> AsyncGenerator[bytes, None]:
            req = client.build_request(
                "POST",
                f"{target_url}/synthesize_stream",
                json={
                    "text": text,
                    "language": language or "Portuguese",
                    "instruct": instruct,
                    "temperature": 0.65,
                    "top_p": 0.90,
                    "repetition_penalty": 1.05,
                    "max_new_tokens": 2048,
                },
                timeout=httpx.Timeout(90.0, connect=5.0, read=90.0),
            )
            res = await client.send(req, stream=True)
            if res.status_code != 200:
                body = await res.aread()
                await res.aclose()
                raise RuntimeError(f"Worker streaming error {res.status_code}: {body.decode('utf-8', errors='ignore')}")

            try:
                async for chunk in res.aiter_bytes():
                    if chunk:
                        yield chunk
            finally:
                await res.aclose()

        return "audio/L16;rate=24000", _stream_generator()


