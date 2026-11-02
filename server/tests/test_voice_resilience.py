import sys
import unittest
import asyncio
from pathlib import Path
from unittest.mock import patch, AsyncMock, MagicMock
import httpx

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from app.services.qwen_tts.qwen_manager import QwenTTSManager
from app.services.rvc.rvc_manager import RVCManager
from app.services.voice_service import synthesize_speech


class TestVoicePipelineResilience(unittest.IsolatedAsyncioTestCase):
    async def test_qwen_stream_handshake_failure_raises_synchronously(self):
        """
        Validates that synthesize_stream raises RuntimeError synchronously
        if the worker connection fails or times out, BEFORE returning a generator to Starlette.
        """
        mock_client = MagicMock()
        mock_client.build_request.return_value = MagicMock()
        mock_client.send = AsyncMock(side_effect=httpx.ReadTimeout("Colab read timeout after 90s"))

        with patch.object(QwenTTSManager, "get_client", return_value=mock_client), \
             patch.object(QwenTTSManager, "is_remote_url", return_value=True):
            
            with self.assertRaises(RuntimeError) as ctx:
                await QwenTTSManager.synthesize_stream(
                    text="Teste de resiliência de áudio",
                    qwen_mode="remote",
                    qwen_remote_url="https://icq-locked-iowa-temple.trycloudflare.com",
                )
            self.assertIn("stream handshake failed", str(ctx.exception))
            self.assertIn("Colab read timeout", str(ctx.exception))

    async def test_voice_service_cascades_to_fallback_on_qwen_stream_error(self):
        """
        Validates that synthesize_speech catches the synchronous streaming handshake failure
        and cascades cleanly to Kokoro + RVC without raising unhandled HTTP 500.
        """
        mock_wav = b"RIFFmockwavcontent"
        
        with patch("app.services.voice_service.QwenTTSManager.synthesize_stream", new_callable=AsyncMock) as mock_qwen, \
             patch("app.services.voice_service.KokoroTTSManager.synthesize", new_callable=AsyncMock, return_value=mock_wav), \
             patch("app.services.voice_service.RVCManager.convert", new_callable=AsyncMock, return_value=mock_wav):
            
            mock_qwen.side_effect = RuntimeError("Qwen3 worker stream handshake failed")
            
            content_type, stream_gen = await synthesize_speech(
                text="Teste de fallback automático",
                stream=True,
                qwen_mode="remote",
                qwen_remote_url="https://icq-locked-iowa-temple.trycloudflare.com",
                allowed_fallbacks=["kokoro", "edge_rvc"],
            )

            self.assertEqual(content_type, "audio/wav")
            chunks = []
            async for chunk in stream_gen:
                chunks.append(chunk)
            full_audio = b"".join(chunks)
            self.assertEqual(full_audio, mock_wav)

    async def test_rvc_ensure_worker_concurrency_lock(self):
        """
        Validates that concurrent callers to RVCManager.ensure_worker()
        are serialized by _spawn_lock, calling start_worker_process at most once.
        """
        spawn_counter = 0

        def fake_start():
            nonlocal spawn_counter
            spawn_counter += 1
            return True

        async def fake_healthy():
            return spawn_counter > 0

        with patch.object(RVCManager, "start_worker_process", side_effect=fake_start), \
             patch.object(RVCManager, "is_worker_healthy", side_effect=fake_healthy):
            
            results = await asyncio.gather(
                RVCManager.ensure_worker(max_wait_sec=1.0),
                RVCManager.ensure_worker(max_wait_sec=1.0),
                RVCManager.ensure_worker(max_wait_sec=1.0),
            )

            self.assertTrue(all(results))
            self.assertEqual(spawn_counter, 1)

    async def test_qwen_worker_streaming_generator_resilience(self):
        """
        Validates that qwen_worker.synthesize_stream's pcm_generator:
        1. Properly streams chunks under _gpu_lock.
        2. Drains model generator on GeneratorExit (client abort) without leaving _gpu_lock held.
        3. Allows consecutive stream requests to complete without deadlock.
        """
        import numpy as np
        from app.services.qwen_tts import qwen_worker

        class MockModel:
            def __init__(self):
                self.drained = False

            def generate_custom_voice_streaming(self, **kwargs):
                self.drained = False
                for _ in range(5):
                    chunk = np.zeros(2400, dtype=np.float32)
                    yield chunk, 24000, None
                self.drained = True

        mock_model = MockModel()
        orig_model = qwen_worker.model
        orig_backend = qwen_worker.active_backend
        try:
            qwen_worker.model = mock_model
            qwen_worker.active_backend = "faster"

            req = qwen_worker.SynthesizeRequest(text="Teste de geração resiliente 1.")
            resp = qwen_worker.synthesize_stream(req)
            gen = resp.body_iterator

            chunk1 = await anext(gen)
            self.assertGreater(len(chunk1), 0)
            chunk2 = await anext(gen)
            self.assertGreater(len(chunk2), 0)
            await gen.aclose()

            self.assertFalse(qwen_worker._gpu_lock.locked())
            self.assertTrue(mock_model.drained)

            req2 = qwen_worker.SynthesizeRequest(text="Teste de geração resiliente 2.")
            resp2 = qwen_worker.synthesize_stream(req2)
            all_chunks = []
            async for c in resp2.body_iterator:
                all_chunks.append(c)
            self.assertEqual(len(all_chunks), 5)
            self.assertFalse(qwen_worker._gpu_lock.locked())
        finally:
            qwen_worker.model = orig_model
            qwen_worker.active_backend = orig_backend



if __name__ == "__main__":
    unittest.main()
