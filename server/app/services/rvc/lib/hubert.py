import os
import sys
import types
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchaudio
import torchaudio.models.wav2vec2.utils.import_fairseq as imp

JAPANESE_HUBERT_ID = "yky-h/japanese-hubert-base"


class DummyModule(types.ModuleType):
    def __getattr__(self, name):
        class DummyClass:
            def __init__(self, *args, **kwargs):
                pass
            def __setstate__(self, state):
                if isinstance(state, dict):
                    self.__dict__.update(state)
        return DummyClass


class FairseqFinder:
    def find_module(self, fullname, path=None):
        if fullname.startswith("fairseq"):
            return self
        return None

    def load_module(self, fullname):
        if fullname in sys.modules:
            return sys.modules[fullname]
        mod = DummyModule(fullname)
        sys.modules[fullname] = mod
        return mod


def register_fairseq_interceptor():
    if not any(isinstance(f, FairseqFinder) for f in sys.meta_path):
        sys.meta_path.insert(0, FairseqFinder())


class HubertWrapper(nn.Module):
    def __init__(self, model_path: str, is_half: bool = False, device: str = "cuda"):
        super().__init__()
        self.device = device
        self.is_half = is_half
        self.final_proj = None
        self.is_hf = not (model_path or "").lower().endswith((".pt", ".pth")) or os.path.isdir(model_path or "")

        if self.is_hf:
            from transformers import AutoModel
            repo_or_dir = model_path or JAPANESE_HUBERT_ID
            try:
                self.model = AutoModel.from_pretrained(repo_or_dir, local_files_only=True)
            except Exception:
                self.model = AutoModel.from_pretrained(repo_or_dir)
            self.model.eval()
        else:
            register_fairseq_interceptor()
            ckpt = torch.load(model_path, map_location="cpu", weights_only=False)
            converted = imp._convert_state_dict(ckpt["model"])

            self.model = torchaudio.models.hubert_base()
            self.model.load_state_dict(converted, strict=False)
            self.model.eval()

            if "final_proj.weight" in ckpt["model"]:
                w = ckpt["model"]["final_proj.weight"]
                b = ckpt["model"]["final_proj.bias"]
                self.final_proj = nn.Linear(w.shape[1], w.shape[0])
                self.final_proj.weight.data.copy_(w)
                self.final_proj.bias.data.copy_(b)
                self.final_proj.eval()

        if is_half:
            self.model = self.model.half()
            if self.final_proj is not None:
                self.final_proj = self.final_proj.half()

        self.model = self.model.to(device)
        if self.final_proj is not None:
            self.final_proj = self.final_proj.to(device)

    def extract_features(self, source, padding_mask=None, output_layer=12):
        with torch.no_grad():
            if self.is_hf:
                wav = F.layer_norm(source.float(), source.shape[-1:])
                wav = wav.half() if self.is_half else wav
                out = self.model(wav.to(self.device), output_hidden_states=True)
                hs = out.hidden_states
                return [hs[output_layer] if output_layer < len(hs) else out.last_hidden_state]

            wav = source.half() if self.is_half else source.float()
            feats_list, _ = self.model.extract_features(wav.to(self.device), num_layers=output_layer)
            return [feats_list[output_layer - 1]]
