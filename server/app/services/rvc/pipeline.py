import io
import numpy as np
import scipy.signal as sig
import soundfile as sf
import torch
import torch.nn.functional as F
import torchaudio

_HP_SOS_16K = sig.butter(5, 48.0, btype="highpass", fs=16000, output="sos")


def _rms_envelope(wav_np: np.ndarray, sr: int, target_len: int) -> np.ndarray:
    t = torch.from_numpy(wav_np).float().pow(2).view(1, 1, -1)
    win = min(max(1, sr // 20), t.shape[-1])
    hop = max(1, sr // 100)
    pad_l = win // 2
    pad_r = win - 1 - pad_l
    rms = torch.sqrt(F.avg_pool1d(F.pad(t, (pad_l, pad_r)), kernel_size=win, stride=hop) + 1e-12)
    return F.interpolate(rms, size=target_len, mode="linear", align_corners=False).squeeze().numpy()


def _smooth_f0(f0: np.ndarray) -> np.ndarray:
    out = np.array(f0, dtype=np.float32, copy=True)
    n = len(out)
    if n < 3:
        return out
    for i in range(1, n - 1):
        if out[i] <= 0.0 and out[i - 1] > 0.0 and out[i + 1] > 0.0:
            if abs(out[i - 1] - out[i + 1]) / max(out[i - 1], out[i + 1]) < 0.20:
                out[i] = 0.5 * (out[i - 1] + out[i + 1])
    voiced = out > 0.0
    idx = np.flatnonzero(np.diff(np.pad(voiced.view(np.int8), (1, 1), constant_values=0)))
    for s, e in zip(idx[0::2], idx[1::2]):
        if e - s >= 3:
            seg = out[s:e]
            p1 = np.pad(seg, 1, mode="edge")
            med = np.median(np.stack([p1[:-2], p1[1:-1], p1[2:]]), axis=0)
            p2 = np.pad(med, 1, mode="edge")
            out[s:e] = 0.25 * p2[:-2] + 0.5 * p2[1:-1] + 0.25 * p2[2:]
    return out

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

        # 3. Load Kurisu Voice Model (run generator in FP32 to avoid ResBlock1 FP16 accumulation noise)
        ckpt = torch.load(model_path, map_location="cpu", weights_only=False)
        self.net_g = SynthesizerTrnMs768NSFsid(*ckpt["config"], is_half=False)
        self.net_g.load_state_dict(ckpt["weight"], strict=False)
        self.net_g.eval()
        self.net_g.remove_weight_norm()
        self.net_g = self.net_g.to(device)

        # 4. Load Timbre Feature Index
        self.index = PureTorchIndex(index_path, device=device, is_half=is_half)

        raw_sr = ckpt.get("sr") or (ckpt["config"][-1] if ckpt.get("config") else 40000)
        self.tgt_sr = int(raw_sr) if isinstance(raw_sr, (int, float)) and int(raw_sr) >= 8000 else 40000

    def convert_audio(
        self,
        audio_bytes: bytes,
        pitch_shift: int = 0,
        index_rate: float = 0.75,
        protect: float = 0.33,
        rms_mix_rate: float = 0.25,
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

        # Strip DC offset / sub-48 Hz rumble before F0 and feature extraction
        if len(audio) > 36:
            audio = sig.sosfiltfilt(_HP_SOS_16K, audio.astype(np.float64)).astype(np.float32)

        # 1. RMVPE pitch extraction + 1-frame dropout bridging / spike smoothing
        f0 = _smooth_f0(self.rmvpe.infer_from_audio(audio))

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
        protect = max(0.0, min(0.5, float(protect)))
        audio_tensor = torch.from_numpy(audio).float().unsqueeze(0).to(self.device)
        with torch.no_grad():
            feats = self.hubert.extract_features(audio_tensor, output_layer=12)[0]
            feats0 = feats.clone() if (protect < 0.5 and index_rate > 0 and self.index.vectors is not None) else None

            # 3. Timbre Index retrieval + 50 Hz temporal delta smoothing
            if index_rate > 0 and self.index.vectors is not None:
                feats = self.index.query(feats, index_rate=index_rate)
                if feats0 is not None and feats.shape[1] >= 3:
                    delta = (feats - feats0).permute(0, 2, 1)
                    delta = F.avg_pool1d(F.pad(delta, (1, 1), mode="replicate"), kernel_size=3, stride=1)
                    feats = feats0 + delta.permute(0, 2, 1)

            # 4. Interpolate 50 Hz -> 100 Hz smoothly
            feats = F.interpolate(feats.permute(0, 2, 1), scale_factor=2, mode="linear", align_corners=False).permute(0, 2, 1)
            if feats0 is not None:
                feats0 = F.interpolate(feats0.permute(0, 2, 1), scale_factor=2, mode="linear", align_corners=False).permute(0, 2, 1)

        # 5. Length alignment + smooth voiceless consonant protection
        p_len = min(feats.shape[1], len(f0_coarse))
        feats = feats[:, :p_len]
        pitch = torch.from_numpy(f0_coarse[:p_len]).unsqueeze(0).to(self.device)
        pitchf = torch.from_numpy(f0[:p_len]).unsqueeze(0).to(self.device).float()
        if feats0 is not None:
            pitchff = pitchf.clone()
            pitchff[pitchf > 0] = 1.0
            pitchff[pitchf < 1] = float(protect)
            if p_len >= 3:
                smooth_ff = F.avg_pool1d(
                    F.pad(pitchff.unsqueeze(1), (1, 1), mode="replicate"),
                    kernel_size=3,
                    stride=1,
                ).squeeze(1)
                pitchff = torch.maximum(pitchff, smooth_ff)
            pitchff = pitchff.unsqueeze(-1)
            feats = feats * pitchff + feats0[:, :p_len] * (1.0 - pitchff)

        feats = feats.float()
        p_len_t = torch.tensor([p_len], device=self.device).long()
        sid = torch.tensor([0], device=self.device).long()

        # 6. Neural Synthesis
        with torch.no_grad():
            out_tensor = self.net_g.infer(feats, p_len_t, pitch, pitchf, sid)[0][0, 0]
            out_audio = out_tensor.cpu().float().numpy()

        # 7. RMS envelope matching to curb vocoder breath/tail noise in pauses
        if rms_mix_rate < 1.0 and len(out_audio) > 0 and len(audio) > 0:
            rms1 = np.maximum(_rms_envelope(audio, 16000, len(out_audio)), 1e-4)
            rms2 = np.maximum(_rms_envelope(out_audio, self.tgt_sr, len(out_audio)), 1e-3)
            out_audio = out_audio * np.clip(np.power(rms1 / rms2, 1.0 - rms_mix_rate), 0.0, 2.0)

        # Normalize audio peak to avoid clipping
        max_val = np.max(np.abs(out_audio))
        if max_val > 0.98:
            out_audio = out_audio / max_val * 0.98

        # Export to in-memory WAV
        out_buf = io.BytesIO()
        sf.write(out_buf, out_audio, self.tgt_sr, format="WAV")
        return out_buf.getvalue()
