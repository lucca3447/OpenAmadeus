import io
import os
import sys
import re
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
import numpy as np
try:
    import torch
    default_dtype = torch.float32
except ImportError:
    torch = None
    default_dtype = None

try:
    import soundfile as sf
except ImportError:
    sf = None

from contextlib import asynccontextmanager, ExitStack
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from typing import Optional

model = None
load_error = None
device_name = "cpu"
dtype_used = default_dtype
active_backend = "unknown"
_gpu_lock = threading.Lock()
_gpu_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="qwen_cuda")
_StopSentinel = object()
_active_gen_id = 0


def _next_or_sentinel(gen):
    try:
        return next(gen)
    except StopIteration:
        return _StopSentinel


def _close_gen_safe(gen):
    try:
        gen.close()
    except Exception:
        pass


def _enter_torch_inference():
    """Returns a context manager for torch no_grad + inference_mode when torch is installed."""
    stack = ExitStack()
    if torch is not None:
        stack.enter_context(torch.no_grad())
        stack.enter_context(torch.inference_mode())
    return stack


RAMP_LEN = 120  # 5 ms @ 24 kHz for C0 amplitude continuity across chunk seams
ramp_weights = np.linspace(1.0, 0.0, RAMP_LEN, dtype=np.float32)


def apply_boundary_continuity(chunk: np.ndarray, prev_sample: Optional[float]) -> np.ndarray:
    """
    Applies a smooth C0 continuity ramp to the first 120 samples of the current chunk
    based on the last sample of the previous chunk, eliminating amplitude jumps without
    attenuating volume to zero.
    """
    if prev_sample is None or len(chunk) < RAMP_LEN:
        return chunk
    smoothed = chunk.copy()
    delta = prev_sample - smoothed[0]
    smoothed[:RAMP_LEN] += delta * ramp_weights
    return smoothed


def sanitize_for_qwen(text: str) -> str:
    """
    Worker-level safety sanitizer for starrydark/Makise_Kurisu_Qwen3_TTS:
    - Strips HTML comments, markdown, and emotes
    - Converts interrobangs ('?!', '!?') to '?'
    - Converts exclamation marks ('!') to '.' to prevent Japanese glottal-stop syllable clipping
    - Strips non-lexical hesitation vocables ('Hum', 'Hmm', 'U-um', 'Uhm') that trigger VN sighs/moans
    - De-stutters single-letter prefixes ('Q-quem' -> 'Quem')
    - Replaces mid-sentence ellipses ('...', '…') with ', ' to prevent 2-3s silent gaps
    - Ensures terminal punctuation ('.' or '?') for clean EOS
    """
    s = re.sub(r"<!--[^>]*-->", "", text or "")
    s = re.sub(r"\*[^*]+\*", "", s)
    s = re.sub(r'''[*_~`#"'«»]''', "", s)
    s = re.sub(r"[…‥]", "...", s)
    s = re.sub(r"\?+!+[!?]*|!+\?+[!?]*", "?", s)
    s = re.sub(r"!+", ".", s)
    s = re.sub(r"([.,])\s*\.", r"\1", s)
    s = re.sub(
        r"(?i)\b(?:[u]+(?:\s*\.{2,}\s*|-|\s+)[u]+m|[u]+h+m*|[u]+(?:\s*\.{2,}\s*|-|\s+)uh|h+u*m+)\b\s*[,;:.]*\s*",
        "",
        s,
    )

    def _un_stutter(m: re.Match) -> str:
        prefix, word = m.group(1), m.group(2)
        if prefix.lower() == word[0].lower():
            return word.capitalize() if prefix.isupper() else word
        return m.group(0)

    s = re.sub(r"\b([A-Za-zÀ-ÿ])(?:\s*\.{2,}\s*|-)([a-zà-ÿ]+)\b", _un_stutter, s)
    s = re.sub(r"\s*\.{2,}\s*$", ".", s)
    s = re.sub(r"\s*\.{2,}\s*", ", ", s)
    s = re.sub(r",\s*,+", ",", s)
    s = re.sub(r"([.?!])\s*,", r"\1", s)
    s = re.sub(r",\s*([.?!])", r"\1", s)
    s = re.sub(r"^[,;:\s]+", "", s)
    s = re.sub(r"\s+([.,?!])", r"\1", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s and s[0].islower():
        s = s[0].upper() + s[1:]
    if s and s[-1] not in ".?":
        s += "."
    return s


def prepare_worker_segments(text: str, max_single_pass_chars: int = 175) -> list[str]:
    """
    Sanitizes text and splits long multi-sentence paragraphs into stable sentence segments
    to prevent attention drift, volume collapse, and premature codec EOS on long texts.
    Short utterances (<= max_single_pass_chars) remain a single segment for fluid prosody.
    """
    cleaned = sanitize_for_qwen(text)
    if not cleaned:
        return []
    if len(cleaned) <= max_single_pass_chars:
        return [cleaned]

    raw_parts = [p.strip() for p in re.split(r"(?<=[.?!])\s+", cleaned) if p.strip()]
    segments: list[str] = []
    for part in raw_parts:
        if part[-1] not in ".?":
            part += "."
        if segments and (len(segments[-1]) + 1 + len(part) <= max_single_pass_chars or len(part) < 25):
            segments[-1] = f"{segments[-1]} {part}"
        else:
            segments.append(part)
    return segments or [cleaned]


def _resolve_effective_instruct(instruct: Optional[str]) -> Optional[str]:
    """
    starrydark/Makise_Kurisu_Qwen3_TTS is a 12Hz Base SFT model (spk_id=3000) not trained with
    CustomVoice instruct system prompts. Ignore instruct unless QWEN_USE_EMOTION_INSTRUCT=true.
    """
    use_instruct = os.environ.get("QWEN_USE_EMOTION_INSTRUCT", "false").lower() in ("1", "true", "yes")
    if not use_instruct:
        return None
    return (instruct or "").strip() or None


def _resolve_model_source() -> str:
    """
    Resolves the model directory with automatic upstream sync:
    1. Local override in weights/kurisu_qwen3 or Kurisu_Qwen3_TTS
    2. Hugging Face Hub latest snapshot for starrydark/Makise_Kurisu_Qwen3_TTS (auto-syncs on startup)
    3. Offline fallback to local cached snapshots in ~/.cache/huggingface/hub/
    """
    model_id = os.environ.get("QWEN_MODEL_ID", "starrydark/Makise_Kurisu_Qwen3_TTS")
    current_file_dir = os.path.dirname(os.path.abspath(__file__))
    server_root = os.path.abspath(os.path.join(current_file_dir, "..", "..", ".."))

    for local_dir in [
        os.path.join(server_root, "weights", "kurisu_qwen3"),
        os.path.join(server_root, "Kurisu_Qwen3_TTS"),
    ]:
        if os.path.isdir(local_dir) and any(fname.endswith(".safetensors") for fname in os.listdir(local_dir)):
            print(f"[Qwen3 Worker] Found local model override: {local_dir}")
            return local_dir

    try:
        from huggingface_hub import snapshot_download
        cached = snapshot_download(model_id, ignore_patterns=["training_*", "eval/*"])
        print(f"[Qwen3 Worker] Synced model snapshot from HF Hub: {cached}")
        return cached
    except Exception as e:
        print(f"[Qwen3 Worker] Online HF sync skipped ({e}), falling back to local cache...")

    try:
        from huggingface_hub import snapshot_download
        return snapshot_download(model_id, local_files_only=True)
    except Exception:
        pass

    for hub_dir in [
        os.path.expanduser(r"~/.cache/huggingface/hub/models--starrydark--Makise_Kurisu_Qwen3_TTS/snapshots"),
        os.path.expanduser(r"~/.cache/huggingface/hub/models--starrydark--Kurisu_Qwen3_TTS/snapshots"),
    ]:
        if os.path.isdir(hub_dir):
            for snap in sorted(os.listdir(hub_dir), reverse=True):
                candidate = os.path.join(hub_dir, snap)
                if any(fname.endswith(".safetensors") for fname in os.listdir(candidate)):
                    print(f"[Qwen3 Worker] Found cached snapshot fallback: {candidate}")
                    return candidate

    return model_id


def _load_model_worker():
    global model, device_name, dtype_used, load_error, active_backend
    requested_backend = os.environ.get("QWEN_BACKEND", "auto").lower()
    print(f"[Qwen3 Worker] Background thread starting model load (requested backend: '{requested_backend}')...")

    device_name = "cuda:0" if (torch is not None and torch.cuda.is_available()) else "cpu"
    if torch is not None and torch.cuda.is_available():
        major, _ = torch.cuda.get_device_capability(0)
        dtype_used = torch.bfloat16 if major >= 8 else torch.float16
    else:
        dtype_used = default_dtype

    print(f"[Qwen3 Worker] Target device: {device_name} ({dtype_used})...")
    model_source = _resolve_model_source()
    loaded_model = None
    backend_selected = "stock"

    # 1. Attempt FasterQwen3TTS (CUDA Graphs + native streaming) if permitted
    if requested_backend in ("auto", "faster") and torch is not None and torch.cuda.is_available():
        try:
            print(f"[Qwen3 Worker] Attempting FasterQwen3TTS runtime with CUDA Graphs on '{model_source}'...")
            from faster_qwen3_tts import FasterQwen3TTS
            loaded_model = FasterQwen3TTS.from_pretrained(
                model_source,
                device=device_name,
                dtype=dtype_used,
                attn_implementation="sdpa",
                max_seq_len=2048,
            )
            if hasattr(loaded_model, "predictor_graph") and loaded_model.predictor_graph is not None:
                loaded_model.predictor_graph.temperature = 0.6
                loaded_model.predictor_graph.top_p = 0.9
                print("[Qwen3 Worker] Calibrated PredictorGraph (temperature=0.6, top_p=0.9) before warmup.")

            print("[Qwen3 Worker] Warming up Talker & Predictor CUDA Graphs...")
            loaded_model.warmup(prefill_len=100)

            print("[Qwen3 Worker] Priming Mimi audio decoder with disposable initial utterance...")
            try:
                with _gpu_lock, _enter_torch_inference():
                    warmup_gen = loaded_model.generate_custom_voice_streaming(
                        text="Oi.",
                        speaker="kurisu",
                        language="Portuguese",
                        instruct=None,
                        chunk_size=8,
                    )
                    for _ in warmup_gen:
                        pass
                print("[Qwen3 Worker] Mimi audio decoder primed and warm! First call will achieve sub-400ms TTFA.")
            except Exception as dec_err:
                print(f"[Qwen3 Worker] Mimi audio decoder priming note: {dec_err}")

            backend_selected = "faster"
            print("[Qwen3 Worker] FasterQwen3TTS runtime successfully initialized with CUDA Graphs!")
        except Exception as fast_err:
            print(f"[Qwen3 Worker] FasterQwen3TTS init failed ({fast_err}).")
            if requested_backend == "faster":
                load_error = f"FasterQwen3TTS requested but failed: {fast_err}"
                return
            print("[Qwen3 Worker] Falling back to stock Qwen3TTSModel...")

    # 2. Stock Qwen3TTSModel fallback
    if loaded_model is None and not load_error:
        try:
            from qwen_tts import Qwen3TTSModel
            print(f"[Qwen3 Worker] Loading stock Qwen3TTSModel from '{model_source}'...")
            loaded_model = Qwen3TTSModel.from_pretrained(
                model_source,
                device_map=device_name,
                dtype=dtype_used,
            )
            backend_selected = "stock"
            print("[Qwen3 Worker] Stock Qwen3TTSModel successfully loaded and resident in GPU memory!")
        except Exception as e:
            print(f"[Qwen3 Worker] Failed to load stock model: {e}")
            import traceback
            traceback.print_exc()
            load_error = str(e)
            return

    model = loaded_model
    active_backend = backend_selected


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load and capture CUDA Graphs on the dedicated _gpu_executor thread
    _gpu_executor.submit(_load_model_worker)
    yield
    print("[Qwen3 Worker] Worker shutting down cleanly.")


app = FastAPI(title="Amadeus Kurisu Qwen3-TTS Worker", version="0.2.2", lifespan=lifespan)


class SynthesizeRequest(BaseModel):
    text: str
    language: Optional[str] = "Portuguese"
    speaker: Optional[str] = "kurisu"
    instruct: Optional[str] = None
    temperature: Optional[float] = 0.90  # Padrão v3 atualizado para 0.90
    top_p: Optional[float] = 0.90
    repetition_penalty: Optional[float] = 1.05
    max_new_tokens: Optional[int] = 2048


@app.get("/health")
def health_check():
    vram = (
        torch.cuda.memory_allocated() / (1024**2)
        if (torch is not None and torch.cuda.is_available())
        else 0
    )
    if load_error:
        status = f"error: {load_error}"
    elif model is not None:
        status = "ready"
    else:
        status = "initializing"

    return {
        "status": status,
        "device": device_name,
        "cuda_available": bool(torch is not None and torch.cuda.is_available()),
        "vram_allocated_mb": round(vram, 2),
        "backend": active_backend,
    }


@app.post("/abort")
def abort_active_generation():
    """Explicitly preempts any in-flight GPU synthesis so _gpu_lock is freed immediately."""
    global _active_gen_id
    _active_gen_id += 1
    return {"status": "aborted", "active_gen_id": _active_gen_id}


@app.post("/synthesize_stream")
def synthesize_stream(req: SynthesizeRequest):
    """
    Streams raw PCM16 mono 24kHz audio chunks in real-time.
    Uses a dedicated 1-worker ThreadPoolExecutor (_gpu_executor) + async generator wrapper so that:
    1. Every CUDA Graph step and `torch.inference_mode()` runs on the exact same OS thread with zero polling sleep.
    2. On client disconnect/barge-in, the async wrapper's `finally` block explicitly calls `gen.close()` on `_gpu_executor`,
       releasing `_gpu_lock` immediately without Starlette's `iterate_in_threadpool` leak.
    """
    global model, _active_gen_id
    if model is None:
        raise HTTPException(status_code=503, detail="Qwen3-TTS Worker is still initializing.")

    segments = prepare_worker_segments(req.text or "")
    if not segments:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    effective_instruct = _resolve_effective_instruct(req.instruct)
    # Promove 0.65 legado para 0.90 (padrão oficial v3) ou respeita valores customizados
    eff_temp = 0.90 if (req.temperature is None or req.temperature <= 0.65) else float(req.temperature)
    eff_top_p = min(req.top_p if req.top_p is not None else 0.90, 0.95)
    eff_rep = max(req.repetition_penalty if req.repetition_penalty is not None else 1.05, 1.05)
    eff_max_tokens = req.max_new_tokens if req.max_new_tokens is not None else 2048

    my_id = _active_gen_id

    def pcm_generator():
        prev_sample = None
        try:
            with _gpu_lock:
                for seg_idx, seg_text in enumerate(segments):
                    if _active_gen_id != my_id:
                        break
                    if seg_idx > 0:
                        pause_chunk = np.zeros(int(24000 * 0.05), dtype=np.float32)
                        pause_chunk = apply_boundary_continuity(pause_chunk, prev_sample)
                        prev_sample = float(pause_chunk[-1])
                        yield (np.clip(pause_chunk, -1.0, 1.0) * 32767).astype(np.int16).tobytes()

                    if active_backend == "faster":
                        with _enter_torch_inference():
                            stream_gen = model.generate_custom_voice_streaming(
                                text=seg_text,
                                speaker=req.speaker or "kurisu",
                                language=req.language or "Portuguese",
                                instruct=effective_instruct,
                                chunk_size=8,
                                temperature=eff_temp,
                                top_p=eff_top_p,
                                repetition_penalty=eff_rep,
                                max_new_tokens=eff_max_tokens,
                            )
                            try:
                                for audio_chunk, sr, _ in stream_gen:
                                    if _active_gen_id != my_id:
                                        break
                                    chunk = audio_chunk.copy()
                                    chunk = apply_boundary_continuity(chunk, prev_sample)
                                    prev_sample = float(chunk[-1])
                                    pcm16 = (np.clip(chunk, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
                                    yield pcm16
                            finally:
                                try:
                                    stream_gen.close()
                                except Exception:
                                    pass
                                if torch is not None and torch.cuda.is_available():
                                    torch.cuda.synchronize()
                    else:
                        with _enter_torch_inference():
                            wavs, sr = model.generate_custom_voice(
                                text=seg_text,
                                speaker=req.speaker or "kurisu",
                                language=req.language or "Portuguese",
                                instruct=effective_instruct,
                                temperature=eff_temp,
                                top_p=eff_top_p,
                                repetition_penalty=eff_rep,
                                max_new_tokens=eff_max_tokens,
                            )
                        full_audio = wavs[0]
                        chunk_len = int(sr * 0.64)
                        for i in range(0, len(full_audio), chunk_len):
                            if _active_gen_id != my_id:
                                break
                            chunk = full_audio[i:i + chunk_len].copy()
                            chunk = apply_boundary_continuity(chunk, prev_sample)
                            prev_sample = float(chunk[-1])
                            pcm16 = (np.clip(chunk, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
                            yield pcm16
        except GeneratorExit:
            pass
        except Exception as e:
            print(f"[Qwen3 Worker] Streaming generation error: {e}")
            raise

    async def safe_async_stream():
        loop = asyncio.get_running_loop()
        gen = pcm_generator()
        try:
            while True:
                chunk = await loop.run_in_executor(_gpu_executor, _next_or_sentinel, gen)
                if chunk is _StopSentinel:
                    break
                yield chunk
        finally:
            fut = loop.run_in_executor(_gpu_executor, _close_gen_safe, gen)
            try:
                await asyncio.shield(fut)
            except asyncio.CancelledError:
                pass

    return StreamingResponse(
        safe_async_stream(),
        media_type="audio/L16;rate=24000",
        headers={
            "X-Audio-Format": "pcm_s16le",
            "X-Sample-Rate": "24000",
            "X-Backend": active_backend,
        },
    )


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    """
    Non-streaming backwards-compatible endpoint delivering complete WAV PCM16 bytes.
    Automatically segments multi-sentence paragraphs to prevent EOS truncation and volume decay.
    """
    global model, _active_gen_id
    if model is None:
        raise HTTPException(status_code=503, detail="Qwen3-TTS Worker is still initializing.")

    segments = prepare_worker_segments(req.text or "")
    if not segments:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    effective_instruct = _resolve_effective_instruct(req.instruct)
    # Promove 0.65 legado para 0.90 (padrão oficial v3) ou respeita valores customizados
    eff_temp = 0.90 if (req.temperature is None or req.temperature <= 0.65) else float(req.temperature)
    eff_top_p = min(req.top_p if req.top_p is not None else 0.90, 0.95)
    eff_rep = max(req.repetition_penalty if req.repetition_penalty is not None else 1.05, 1.05)
    eff_max_tokens = req.max_new_tokens if req.max_new_tokens is not None else 2048

    my_id = _active_gen_id

    def _run_sync():
        with _gpu_lock:
            assembled_pieces = []
            prev_sample = None
            sr = 24000

            with _enter_torch_inference():
                for seg_idx, seg_text in enumerate(segments):
                    if _active_gen_id != my_id:
                        break
                    if seg_idx > 0:
                        pause_chunk = np.zeros(int(sr * 0.05), dtype=np.float32)
                        pause_chunk = apply_boundary_continuity(pause_chunk, prev_sample)
                        prev_sample = float(pause_chunk[-1])
                        assembled_pieces.append(pause_chunk)

                    if active_backend == "faster" and hasattr(model, "generate_custom_voice_streaming"):
                        stream_gen = model.generate_custom_voice_streaming(
                            text=seg_text,
                            speaker=req.speaker or "kurisu",
                            language=req.language or "Portuguese",
                            instruct=effective_instruct,
                            chunk_size=8,
                            temperature=eff_temp,
                            top_p=eff_top_p,
                            repetition_penalty=eff_rep,
                            max_new_tokens=eff_max_tokens,
                        )
                        try:
                            for audio_chunk, sr_val, _ in stream_gen:
                                if _active_gen_id != my_id:
                                    break
                                sr = sr_val
                                chunk = audio_chunk.copy().astype(np.float32)
                                chunk = apply_boundary_continuity(chunk, prev_sample)
                                if len(chunk) > 0:
                                    prev_sample = float(chunk[-1])
                                assembled_pieces.append(chunk)
                        finally:
                            try:
                                stream_gen.close()
                            except Exception:
                                pass
                            if torch is not None and torch.cuda.is_available():
                                torch.cuda.synchronize()
                    else:
                        wavs, sr = model.generate_custom_voice(
                            text=seg_text,
                            speaker=req.speaker or "kurisu",
                            language=req.language or "Portuguese",
                            instruct=effective_instruct,
                            temperature=eff_temp,
                            top_p=eff_top_p,
                            repetition_penalty=eff_rep,
                            max_new_tokens=eff_max_tokens,
                        )
                        seg_audio = wavs[0].astype(np.float32, copy=True)
                        seg_audio = apply_boundary_continuity(seg_audio, prev_sample)
                        if len(seg_audio) > 0:
                            prev_sample = float(seg_audio[-1])
                        assembled_pieces.append(seg_audio)

            if not assembled_pieces:
                return None
            full_audio = np.concatenate(assembled_pieces) if len(assembled_pieces) > 1 else assembled_pieces[0]
            buffer = io.BytesIO()
            sf.write(buffer, full_audio, sr, format="WAV", subtype="PCM_16")
            return buffer.getvalue()

    try:
        loop = asyncio.get_running_loop()
        wav_bytes = await loop.run_in_executor(_gpu_executor, _run_sync)
        if wav_bytes is None:
            raise HTTPException(status_code=499, detail="Synthesis preempted by newer utterance.")
        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={"X-Backend": active_backend},
        )
    except HTTPException:
        raise
    except Exception as e:
        if torch is not None and hasattr(torch.cuda, "OutOfMemoryError") and isinstance(e, torch.cuda.OutOfMemoryError):
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            print(f"[Qwen3 Worker] CUDA Out Of Memory: {e}")
            raise HTTPException(status_code=507, detail="GPU memory insufficient for this utterance.")
        print(f"[Qwen3 Worker] Synthesis error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("QWEN_WORKER_PORT", "8005"))
    uvicorn.run(app, host="127.0.0.1", port=port)