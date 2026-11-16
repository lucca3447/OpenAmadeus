import os
import struct
import numpy as np
import torch


class PureTorchIndex:
    def __init__(self, index_path: str, device: str = "cuda", is_half: bool = True):
        self.device = device
        self.is_half = is_half
        self.vectors = None
        self.v_norm = None

        if os.path.exists(index_path):
            self._load(index_path)

    def _load(self, index_path: str):
        with open(index_path, "rb") as f:
            data = f.read()

        idx = data.find(b"ilar")
        if idx == -1 or idx + 32 > len(data):
            return

        _, nlist, code_size, _, nlist2 = struct.unpack("<4sqqiq", data[idx : idx + 32])
        bucket_count = nlist2 if 1 <= nlist2 <= 1_000_000 else (nlist if 1 <= nlist <= 1_000_000 else 781)
        feat_bytes = code_size if code_size in (1024, 3072) else 3072
        feat_dim = feat_bytes // 4

        with open(index_path, "rb") as f:
            f.seek(idx + 32)
            sizes = [struct.unpack("<q", f.read(8))[0] for _ in range(bucket_count)]

            vectors_list = []
            for s in sizes:
                if s > 0:
                    raw_codes = f.read(s * feat_bytes)
                    vecs = np.frombuffer(raw_codes, dtype=np.float32).reshape(s, feat_dim)
                    vectors_list.append(vecs)
                    f.seek(s * 8, os.SEEK_CUR)  # skip ids

            if vectors_list:
                all_vectors = np.concatenate(vectors_list, axis=0)
                # Keep index vectors in float32 to avoid FP16 distance cancellation and 1/d^2 overflow.
                self.vectors = torch.from_numpy(all_vectors).float().to(self.device)
                self.v_norm = (self.vectors**2).sum(dim=-1, keepdim=True).t()

    @staticmethod
    def save_ilar_index(vectors: np.ndarray, out_path: str, nlist: int = 781) -> str:
        vecs = np.ascontiguousarray(vectors, dtype=np.float32)
        if vecs.ndim != 2 or vecs.shape[1] not in (256, 768):
            raise ValueError(f"Expected [N, 256|768] float32 array, got {vecs.shape}")
        nlist = max(1, int(nlist))
        n_vecs, dim = vecs.shape
        out_dir = os.path.dirname(os.path.abspath(out_path))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(struct.pack("<4sqqiq", b"ilar", nlist, dim * 4, 1819047270, nlist))
            sizes = np.zeros(nlist, dtype=np.int64)
            sizes[0] = n_vecs
            f.write(sizes.tobytes())
            if n_vecs > 0:
                f.write(vecs.tobytes())
                f.write(np.arange(n_vecs, dtype=np.int64).tobytes())
        return out_path

    def query(self, feats: torch.Tensor, index_rate: float = 0.8, k: int = 8) -> torch.Tensor:
        if self.vectors is None or index_rate <= 0:
            return feats

        # feats shape: [1, T, 768]
        q = feats.squeeze(0).float().to(self.device)  # [T, 768]
        k = min(k, self.vectors.shape[0])

        q_norm = (q**2).sum(dim=-1, keepdim=True)
        # Squared Euclidean distance: ||q - v||^2 = ||q||^2 + ||v||^2 - 2 * q @ v.T
        dist = q_norm - 2 * torch.matmul(q, self.vectors.t()) + self.v_norm
        values, indices = torch.topk(dist, k=k, largest=False, dim=-1)

        # Distance-weighted interpolation (min=1e-6 safe in float32)
        weight = torch.square(1.0 / torch.clamp(values, min=1e-6))
        weight = weight / weight.sum(dim=-1, keepdim=True)  # [T, k]
        retrieved = (self.vectors[indices] * weight.unsqueeze(-1)).sum(dim=1)  # [T, 768]

        out = q * (1.0 - index_rate) + retrieved * index_rate
        return out.unsqueeze(0).to(feats.dtype)
