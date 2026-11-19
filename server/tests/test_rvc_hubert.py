import importlib
import importlib.util
import io
import pickle
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
try:
    import soundfile as sf
    import torch
except ImportError as _imp_err:
    raise unittest.SkipTest(f"Optional GPU/RVC audio deps not installed: {_imp_err}")

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from app.services.rvc.lib.hubert import (
    JAPANESE_HUBERT_ID,
    FairseqFinder,
    HubertWrapper,
    register_fairseq_interceptor,
)
from app.services.rvc.lib.index_reader import PureTorchIndex
from app.services.rvc.pipeline import KurisuRVCPipeline, _smooth_f0
from app.services.rvc.rvc_worker import find_model_files


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

    def test_pure_torch_index_roundtrip_custom_nlist(self):
        rng = np.random.default_rng(7)
        vecs = rng.normal(size=(32, 768)).astype(np.float32)
        with tempfile.TemporaryDirectory() as tmpdir:
            idx_path = str(Path(tmpdir) / "custom.index")
            PureTorchIndex.save_ilar_index(vecs, idx_path, nlist=12)

            index = PureTorchIndex(idx_path, device="cpu", is_half=False)
            self.assertIsNotNone(index.vectors)
            self.assertEqual(tuple(index.vectors.shape), (32, 768))

            query_feats = torch.from_numpy(vecs[:4]).unsqueeze(0).clone()
            blended = index.query(query_feats, index_rate=0.9, k=1)
            self.assertEqual(tuple(blended.shape), (1, 4, 768))
            self.assertTrue(torch.allclose(blended, query_feats, atol=1e-4))

    def test_fairseq_finder_python313_find_spec(self):
        saved_meta = list(sys.meta_path)
        saved_mods = {k: sys.modules.pop(k) for k in list(sys.modules) if k == "fairseq" or k.startswith("fairseq.")}
        try:
            class LegacyFairseqFinder:
                pass

            LegacyFairseqFinder.__name__ = "FairseqFinder"
            sys.meta_path[:] = [LegacyFairseqFinder()] + [
                f for f in saved_meta if not isinstance(f, FairseqFinder)
            ]

            register_fairseq_interceptor()
            self.assertFalse(any(type(f).__name__ == "FairseqFinder" and not hasattr(f, "find_spec") for f in sys.meta_path))

            spec = importlib.util.find_spec("fairseq.data.dictionary")
            self.assertIsNotNone(spec)
            self.assertIsInstance(spec.loader, FairseqFinder)

            sub_spec = importlib.util.find_spec("fairseq.models.hubert")
            self.assertIsNotNone(sub_spec)

            dict_mod = importlib.import_module("fairseq.data.dictionary")
            dummy_inst = dict_mod.Dictionary()
            dummy_inst.symbols = ["a", "b"]
            restored = pickle.loads(pickle.dumps(dummy_inst))
            self.assertEqual(restored.symbols, ["a", "b"])

            with self.assertRaises(AttributeError):
                getattr(dict_mod, "__wrapped__")
        finally:
            sys.meta_path[:] = saved_meta
            for k in [k for k in list(sys.modules) if k == "fairseq" or k.startswith("fairseq.")]:
                sys.modules.pop(k, None)
            sys.modules.update(saved_mods)

    def test_pure_torch_index_is_half_zero_distance_no_nan(self):
        rng = np.random.default_rng(11)
        vecs = (rng.normal(size=(16, 768)) * 2.0).astype(np.float32)
        with tempfile.TemporaryDirectory() as tmpdir:
            idx_path = str(Path(tmpdir) / "fp16_safe.index")
            PureTorchIndex.save_ilar_index(vecs, idx_path, nlist=4)

            idx32 = PureTorchIndex(idx_path, device="cpu", is_half=False)
            idx16 = PureTorchIndex(idx_path, device="cpu", is_half=True)
            q_fp32 = torch.from_numpy(vecs[:4]).unsqueeze(0).clone()
            out32 = idx32.query(q_fp32, index_rate=0.8, k=8)
            out16_from_f32 = idx16.query(q_fp32, index_rate=0.8, k=8)
            out16_from_f16 = idx16.query(q_fp32.half(), index_rate=0.8, k=8)

            self.assertFalse(torch.isnan(out16_from_f32).any())
            self.assertFalse(torch.isinf(out16_from_f32).any())
            self.assertFalse(torch.isnan(out16_from_f16).any())
            self.assertFalse(torch.isinf(out16_from_f16).any())
            self.assertEqual(out16_from_f16.dtype, torch.float16)
            self.assertTrue(torch.allclose(out32, out16_from_f32, atol=1e-5))
            self.assertTrue(torch.allclose(out32, out16_from_f16.float(), atol=2e-2))

    def test_convert_audio_protect_and_rms_envelope(self):
        raw_feats = torch.zeros(1, 5, 768, dtype=torch.float32)
        indexed_feats = torch.ones(1, 5, 768, dtype=torch.float32) * 10.0

        fake_hubert = MagicMock()
        fake_hubert.extract_features.return_value = [raw_feats.clone()]

        f0 = np.array([0.0, 0.0, 250.0, 250.0, 0.0, 0.0, 250.0, 250.0, 0.0, 0.0], dtype=np.float32)
        fake_rmvpe = MagicMock()
        fake_rmvpe.infer_from_audio.return_value = f0

        fake_index = MagicMock()
        fake_index.vectors = torch.ones(4, 768)
        fake_index.query.return_value = indexed_feats.clone()

        captured = {}

        def fake_infer(feats, p_len, pitch, pitchf, sid, max_len=None):
            captured["feats"] = feats.clone()
            wav = torch.ones(1, 1, int(p_len.item()) * 400) * 0.2
            return (wav, None, None)

        fake_net_g = MagicMock()
        fake_net_g.to.return_value = fake_net_g
        fake_net_g.eval.return_value = fake_net_g
        fake_net_g.infer.side_effect = fake_infer

        with (
            patch("app.services.rvc.pipeline.HubertWrapper", return_value=fake_hubert),
            patch("app.services.rvc.pipeline.RMVPE", return_value=fake_rmvpe),
            patch("app.services.rvc.pipeline.PureTorchIndex", return_value=fake_index),
            patch("app.services.rvc.pipeline.SynthesizerTrnMs768NSFsid", return_value=fake_net_g),
            patch("app.services.rvc.pipeline.torch.load", return_value={"config": [1] * 18, "weight": {}}),
        ):
            pipe = KurisuRVCPipeline("hubert.pt", "rmvpe.pt", "model.pth", "model.index", device="cpu", is_half=False)
            in_buf = io.BytesIO()
            t = np.linspace(0, 0.1, 1600, endpoint=False, dtype=np.float32)
            sf.write(in_buf, 0.3 * np.sin(2 * np.pi * 240.0 * t), 16000, format="WAV")

            out_bytes = pipe.convert_audio(in_buf.getvalue(), pitch_shift=0, index_rate=0.35, protect=0.33)

        self.assertEqual(captured["feats"].dtype, torch.float32)
        self.assertAlmostEqual(float(captured["feats"][0, 0, 0]), 3.3, places=4)
        self.assertAlmostEqual(float(captured["feats"][0, 1, 0]), (3.3 + 3.3 + 10.0) / 3.0, places=4)
        self.assertAlmostEqual(float(captured["feats"][0, 2, 0]), 10.0, places=4)
        out_y, out_sr = sf.read(io.BytesIO(out_bytes), dtype="float32")
        self.assertEqual(out_sr, 40000)
        self.assertGreater(len(out_y), 0)

    def test_smooth_f0_bridges_single_frame_dropout_and_removes_spike(self):
        bridged = _smooth_f0(np.array([0.0, 240.0, 0.0, 242.0, 240.0, 0.0], dtype=np.float32))
        self.assertEqual(float(bridged[0]), 0.0)
        self.assertEqual(float(bridged[-1]), 0.0)
        self.assertAlmostEqual(float(bridged[2]), 240.75, places=4)

        spiked = _smooth_f0(np.array([0.0, 240.0, 310.0, 240.0, 0.0], dtype=np.float32))
        self.assertTrue(np.allclose(spiked, [0.0, 240.0, 240.0, 240.0, 0.0], atol=1e-4))

    def test_pipeline_reads_tgt_sr_from_checkpoint_config(self):
        with (
            patch("app.services.rvc.pipeline.HubertWrapper", return_value=MagicMock()),
            patch("app.services.rvc.pipeline.RMVPE", return_value=MagicMock()),
            patch("app.services.rvc.pipeline.PureTorchIndex", return_value=MagicMock()),
            patch("app.services.rvc.pipeline.SynthesizerTrnMs768NSFsid", return_value=MagicMock()),
            patch("app.services.rvc.pipeline.torch.load", return_value={"config": [1] * 17 + [48000], "weight": {}}),
        ):
            pipe = KurisuRVCPipeline("hubert.pt", "rmvpe.pt", "model.pth", "model.index", device="cpu", is_half=False)
        self.assertEqual(pipe.tgt_sr, 48000)

    def test_titan_index_nlist_3195_if_present(self):
        titan_idx = SERVER_DIR / "weights" / "KurisuTITAN100e" / "KurisuTITAN100e.index"
        if not titan_idx.exists():
            self.skipTest("KurisuTITAN100e.index not present")
        idx = PureTorchIndex(str(titan_idx), device="cpu", is_half=False)
        self.assertIsNotNone(idx.vectors)
        self.assertEqual(tuple(idx.vectors.shape), (124633, 768))

    def test_find_model_files_blocks_path_traversal(self):
        for bad_name in ("../../evil", "../models/hubert_base", "sub/model", r"..\evil"):
            self.assertEqual(find_model_files(bad_name), (None, None))


if __name__ == "__main__":
    unittest.main()
