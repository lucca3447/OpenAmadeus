import io
import math
import numpy as np
import soundfile as sf
import torch
import torchaudio

try:
    from .lib.hubert import HubertWrapper
    from .lib.rmvpe import RMVPE
    from .lib.models import SynthesizerTrnMs768NSFsid
    from .lib.index_reader import PureTorchIndex
except (ImportError, ValueError):
    from lib.hubert import HubertWrapper
    from lib.rmvpe import RMVPE
    from lib.models import SynthesizerTrnMs768NSFsid
    from lib.index_reader import PureTorchIndex



class KurisuRVCPipeline:
    def __init__(
        self,
        hubert_path: str,
        rmvpe_path: str,
        model_path: str,
        index_path: str,
        device: str = "cuda" if torch.cuda.is_available() else "cpu",
        is_half: bool = True if torch.cuda.is_available() else False,
    ):
        self.device = device
        self.is_half = is_half

        # 1. Load HuBERT (switch to japanese-hubert-base when checkpoint declares it)
        if model_path and hubert_path and hubert_path.lower().endswith((".pt", ".pth")):
            import os
            if os.path.exists(model_path):
                ckpt_meta = torch.load(model_path, map_location="cpu", weights_only=False)
                if "japanese-hubert" in str(ckpt_meta.get("embedder_model", "")).lower():
                    hubert_path = "yky-h/japanese-hubert-base"
        self.hubert = HubertWrapper(hubert_path, is_half=is_half, device=device)

        # 2. Load RMVPE Pitch Estimator
        self.rmvpe = RMVPE(rmvpe_path, is_half=is_half, device=device)

        # 3. Load Kurisu Voice Model
        ckpt = torch.load(model_path, map_location="cpu", weights_only=False)
        self.net_g = SynthesizerTrnMs768NSFsid(*ckpt["config"], is_half=is_half)
        self.net_g.load_state_dict(ckpt["weight"], strict=False)
        self.net_g.eval()
        if is_half:
            self.net_g = self.net_g.half()
        self.net_g = self.net_g.to(device)

        # 4. Load Timbre Feature Index
        self.index = PureTorchIndex(index_path, device=device, is_half=is_half)

        self.tgt_sr = 40000

    def convert_audio(
        self,
        audio_bytes: bytes,
        pitch_shift: int = 0,
        index_rate: float = 0.8,
    ) -> bytes:
        # Read audio from bytes
        audio_stream = io.BytesIO(audio_bytes)
        audio, in_sr = sf.read(audio_stream)

        # Convert to mono float32
        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)
        audio = audio.astype(np.float32)

        # Resample to 16000 Hz if necessary for HuBERT and RMVPE
        if in_sr != 16000:
            audio_t = torch.from_numpy(audio).unsqueeze(0)
            resampler = torchaudio.transforms.Resample(orig_freq=in_sr, new_freq=16000)
            audio = resampler(audio_t).squeeze(0).numpy()

        # 1. RMVPE pitch extraction
        f0 = self.rmvpe.infer_from_audio(audio)

        # Pitch shift
        if pitch_shift != 0:
            f0 = f0 * (2 ** (pitch_shift / 12))

        # Quantize f0 to coarse mel bins
        f0_mel_min = 1127 * np.log(1 + 50 / 700)
        f0_mel_max = 1127 * np.log(1 + 1100 / 700)
        f0_mel = 1127 * np.log(1 + f0 / 700)
        f0_mel[f0_mel > 0] = (
            (f0_mel[f0_mel > 0] - f0_mel_min) * 254 / (f0_mel_max - f0_mel_min) + 1
        )
        f0_mel[f0_mel <= 1] = 1
        f0_mel[f0_mel > 255] = 255
        f0_coarse = np.clip(np.rint(f0_mel).astype(np.int64), 1, 255)

        # 2. HuBERT semantic feature extraction
        audio_tensor = torch.from_numpy(audio).float().unsqueeze(0).to(self.device)
        with torch.no_grad():
            feats = self.hubert.extract_features(audio_tensor, output_layer=12)[0]

            # 3. Timbre Index retrieval
            if index_rate > 0 and self.index.vectors is not None:
                feats = self.index.query(feats, index_rate=index_rate)

            # 4. Interpolate 50 Hz -> 100 Hz
            feats = torch.nn.functional.interpolate(
                feats.permute(0, 2, 1), scale_factor=2
            ).permute(0, 2, 1)

        # 5. Length alignment
        p_len = min(feats.shape[1], len(f0_coarse))
        feats = feats[:, :p_len]
        if self.is_half:
            feats = feats.half()
        else:
            feats = feats.float()

        pitch = torch.from_numpy(f0_coarse[:p_len]).unsqueeze(0).to(self.device)
        pitchf = torch.from_numpy(f0[:p_len]).unsqueeze(0).to(self.device).float()
        p_len_t = torch.tensor([p_len], device=self.device).long()
        sid = torch.tensor([0], device=self.device).long()

        # 6. Neural Synthesis
        with torch.no_grad():
            out_tensor = self.net_g.infer(feats, p_len_t, pitch, pitchf, sid)[0][0, 0]
            out_audio = out_tensor.cpu().float().numpy()

        # Normalize audio peak to avoid clipping
        max_val = np.max(np.abs(out_audio))
        if max_val > 0.98:
            out_audio = out_audio / max_val * 0.98

        # Export to in-memory WAV
        out_buf = io.BytesIO()
        sf.write(out_buf, out_audio, self.tgt_sr, format="WAV")
        return out_buf.getvalue()
