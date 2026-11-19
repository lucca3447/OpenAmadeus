import sys
import unittest
import asyncio
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from app.schemas.voice import TTSRequest
from app.services.rvc.rvc_manager import RVCManager


class TestRVC(unittest.TestCase):
    def test_tts_request_rvc_fields(self):
        # Test snake_case inputs
        req1 = TTSRequest(text="Olá Okabe", use_rvc=True, rvc_pitch=2, rvc_index_rate=0.85, rvc_model="KurisuRVCv147")
        self.assertTrue(req1.use_rvc)
        self.assertEqual(req1.rvc_pitch, 2)
        self.assertEqual(req1.rvc_index_rate, 0.85)
        self.assertEqual(req1.rvc_model, "KurisuRVCv147")

        # Test camelCase inputs (from frontend JSON)
        req2 = TTSRequest.model_validate({
            "text": "Baka!",
            "useRvc": True,
            "rvcPitch": -1,
            "rvcIndexRate": 0.6,
            "rvcModel": "KurisuRVCv147"
        })
        self.assertTrue(req2.use_rvc)
        self.assertEqual(req2.rvc_pitch, -1)
        self.assertEqual(req2.rvc_index_rate, 0.6)
        self.assertEqual(req2.rvc_model, "KurisuRVCv147")

    def test_rvc_list_available_models(self):
        models = RVCManager.list_available_models()
        self.assertIsInstance(models, list)
        self.assertIn("KurisuRVCv147", models)

    def test_rvc_manager_offline_fallback(self):
        # When worker is offline, convert should return None cleanly without spawning a real GPU worker
        from unittest.mock import AsyncMock, patch
        with patch.object(RVCManager, "is_worker_healthy", new_callable=AsyncMock, return_value=False), \
             patch.object(RVCManager, "ensure_worker", new_callable=AsyncMock, return_value=False):
            result = asyncio.run(RVCManager.convert(b"fake_wav_data", pitch_shift=0, index_rate=0.75))
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()

