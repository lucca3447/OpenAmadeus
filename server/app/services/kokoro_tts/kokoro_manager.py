import asyncio
import io
import os
import sys
import threading
from typing import Optional
import numpy as np

_pipeline_instance = None
_pipeline_lock = threading.Lock()
_kokoro_import_error = None


class KokoroTTSManager:
    """
    Manages lightweight local synthesis via Kokoro-TTS (82M) in Brazilian Portuguese.
    Runs in ~80-150ms on CPU or GPU (~350MB VRAM footprint).
    """

    @classmethod
    def is_available(cls) -> bool:
        global _kokoro_import_error
        try:
            import kokoro
            return True
        except ImportError as e:
            _kokoro_import_error = str(e)
            return False

    @classmethod
    def get_pipeline(cls):
        global _pipeline_instance, _kokoro_import_error
        if _pipeline_instance is not None:
            return _pipeline_instance

        with _pipeline_lock:
            if _pipeline_instance is not None:
                return _pipeline_instance

            try:
                from kokoro import KPipeline
                # 'p' = Brazilian Portuguese
                print("[Kokoro Manager] Initializing KPipeline for Brazilian Portuguese (lang_code='p')...")
                _pipeline_instance = KPipeline(lang_code="p")
                print("[Kokoro Manager] KPipeline loaded successfully!")
                return _pipeline_instance
            except Exception as e:
                _kokoro_import_error = str(e)
                print(f"[Kokoro Manager] Failed to initialize KPipeline: {e}")
                return None

    @classmethod
    def _synthesize_sync(
        cls,
        text: str,
        voice: str = "pf_dora",
        speed: float = 1.05,
    ) -> Optional[bytes]:
        pipeline = cls.get_pipeline()
        if pipeline is None:
            return None

        import soundfile as sf

        try:
            audio_segments = []
            sample_rate = 24000

            with _pipeline_lock:
                generator = pipeline(text.strip(), voice=voice or "pf_dora", speed=speed)
                for _, _, audio in generator:
                    if audio is not None and len(audio) > 0:
                        audio_segments.append(audio)

            if not audio_segments:
                print("[Kokoro Manager] Pipeline returned no audio segments.")
                return None

            full_audio = np.concatenate(audio_segments)
            buffer = io.BytesIO()
            sf.write(buffer, full_audio, sample_rate, format="WAV", subtype="PCM_16")
            buffer.seek(0)
            return buffer.read()

        except Exception as e:
            print(f"[Kokoro Manager] Synthesis error: {e}")
            return None

    @classmethod
    async def synthesize(
        cls,
        text: str,
        voice: str = "pf_dora",
        speed: float = 1.05,
    ) -> Optional[bytes]:
        """
        Synthesizes speech into standard 24kHz WAV bytes off the asyncio event loop.
        Returns bytes on success, or None on error.
        """
        if not text or not text.strip():
            return None
        return await asyncio.to_thread(cls._synthesize_sync, text, voice, speed)
