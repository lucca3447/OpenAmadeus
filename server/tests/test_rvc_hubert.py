import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import torch

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from app.services.rvc.lib.hubert import JAPANESE_HUBERT_ID, HubertWrapper
from app.services.rvc.pipeline import KurisuRVCPipeline


class TestRvcJapaneseHubert(unittest.TestCase):
    def test_hf_model_id_uses_transformers_and_layer_norm(self):
        fake_hidden = [torch.randn(1, 5, 768) for _ in range(13)]
        fake_model = MagicMock()
        fake_model.to.return_value = fake_model
        fake_model.eval.return_value = fake_model
        fake_model.half.return_value = fake_model
        fake_model.return_value = MagicMock(hidden_states=fake_hidden, last_hidden_state=fake_hidden[-1])

        with patch("transformers.AutoModel.from_pretrained", return_value=fake_model) as mock_load:
            wrapper = HubertWrapper(JAPANESE_HUBERT_ID, is_half=False, device="cpu")
            self.assertTrue(wrapper.is_hf)
            mock_load.assert_called_once_with(JAPANESE_HUBERT_ID, local_files_only=True)

            wav = torch.randn(1, 1600)
            feats = wrapper.extract_features(wav, output_layer=12)
            self.assertEqual(len(feats), 1)
            self.assertTrue(torch.equal(feats[0], fake_hidden[12]))

    def test_pipeline_auto_switches_hubert_when_checkpoint_declares_japanese_hubert(self):
        kurisu_pth = SERVER_DIR / "weights" / "kurisu_rvc" / "KurisuRVCv147.pth"
        if not kurisu_pth.exists():
            self.skipTest("KurisuRVCv147.pth not present in weights/")

        meta = torch.load(kurisu_pth, map_location="cpu", weights_only=False)
        self.assertIn("japanese-hubert", str(meta.get("embedder_model", "")).lower())

        seen = {}

        def fake_hubert(path, is_half=False, device="cpu"):
            seen["hubert_path"] = path
            return MagicMock()

        with (
            patch("app.services.rvc.pipeline.HubertWrapper", side_effect=fake_hubert),
            patch("app.services.rvc.pipeline.RMVPE", return_value=MagicMock()),
            patch("app.services.rvc.pipeline.PureTorchIndex", return_value=MagicMock()),
        ):
            KurisuRVCPipeline(
                hubert_path=str(SERVER_DIR / "weights" / "models" / "hubert_base.pt"),
                rmvpe_path=str(SERVER_DIR / "weights" / "models" / "rmvpe.pt"),
                model_path=str(kurisu_pth),
                index_path=str(SERVER_DIR / "weights" / "kurisu_rvc" / "KurisuRVCv147.index"),
                device="cpu",
                is_half=False,
            )

        self.assertEqual(seen.get("hubert_path"), JAPANESE_HUBERT_ID)


if __name__ == "__main__":
    unittest.main()
