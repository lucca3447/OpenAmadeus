import os
import sys
from typing import Dict, List, Optional
import torch
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import Response

# Ensure path to rvc package is available
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.abspath(os.path.join(CURRENT_DIR, "..", "..", ".."))
WEIGHTS_DIR = os.path.join(SERVER_DIR, "weights")

if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from app.services.rvc.pipeline import KurisuRVCPipeline

app = FastAPI(title="Amadeus RVC Neural Voice Worker", version="0.2.2")

_pipelines: Dict[str, KurisuRVCPipeline] = {}
_default_model_name = "KurisuRVCv147"


def find_model_files(model_name: str) -> tuple[Optional[str], Optional[str]]:
    """Locates matching .pth and optional .index for a requested model name."""
    clean_name = os.path.splitext(model_name)[0]
    
    # 1. Search in weights/<model_dir> or weights/kurisu_rvc/
    candidate_dirs = [
        os.path.join(WEIGHTS_DIR, clean_name),
        os.path.join(WEIGHTS_DIR, "kurisu_rvc"),
        WEIGHTS_DIR,
    ]
    
    found_pth = None
    found_index = None
    
    for c_dir in candidate_dirs:
        if not os.path.isdir(c_dir):
            continue
        for fname in os.listdir(c_dir):
            f_base, f_ext = os.path.splitext(fname)
            if f_ext.lower() == ".pth" and (f_base == clean_name or clean_name in f_base):
                found_pth = os.path.join(c_dir, fname)
            elif f_ext.lower() == ".index" and (f_base == clean_name or clean_name in f_base):
                found_index = os.path.join(c_dir, fname)
        if found_pth:
            break
            
    return found_pth, found_index


def get_pipeline(model_name: Optional[str] = None) -> KurisuRVCPipeline:
    global _pipelines
    target_name = (model_name or _default_model_name).strip()
    
    if target_name in _pipelines:
        return _pipelines[target_name]
        
    hubert_path = os.path.join(WEIGHTS_DIR, "models", "hubert_base.pt")
    rmvpe_path = os.path.join(WEIGHTS_DIR, "models", "rmvpe.pt")
    
    pth_path, index_path = find_model_files(target_name)
    if not pth_path:
        # Fallback to default Kurisu model
        pth_path, index_path = find_model_files(_default_model_name)
        if not pth_path:
            raise FileNotFoundError(f"Model {target_name} not found in {WEIGHTS_DIR}")
            
    print(f"[RVC Worker] Loading RVC pipeline for '{target_name}': {pth_path} (index: {index_path})")
    pipe = KurisuRVCPipeline(
        hubert_path=hubert_path,
        rmvpe_path=rmvpe_path,
        model_path=pth_path,
        index_path=index_path,
        device="cuda" if torch.cuda.is_available() else "cpu",
        is_half=True if torch.cuda.is_available() else False,
    )
    _pipelines[target_name] = pipe
    return pipe


@app.on_event("startup")
def startup_event():
    try:
        get_pipeline(_default_model_name)
        print(f"[RVC Worker] Default pipeline '{_default_model_name}' loaded successfully!")
    except Exception as e:
        print(f"[RVC Worker] Startup note: {e}")


@app.get("/health")
def health_check():
    vram = torch.cuda.memory_allocated() / (1024**2) if torch.cuda.is_available() else 0
    return {
        "status": "ready" if len(_pipelines) > 0 else "initializing",
        "active_models": list(_pipelines.keys()),
        "cuda_available": torch.cuda.is_available(),
        "vram_allocated_mb": round(vram, 2),
    }


@app.get("/models")
def list_models() -> List[str]:
    models = []
    if os.path.isdir(WEIGHTS_DIR):
        for root, _, files in os.walk(WEIGHTS_DIR):
            for f in files:
                if f.endswith(".pth") and not f.startswith("hubert") and not f.startswith("rmvpe"):
                    models.append(os.path.splitext(f)[0])
    return sorted(list(set(models)))


@app.post("/convert")
async def convert_voice(
    request: Request,
    pitch_shift: int = 0,
    index_rate: float = 0.75,
    model_name: Optional[str] = None,
):
    try:
        pipeline = get_pipeline(model_name)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"RVC pipeline initialization error: {str(e)}")

    try:
        content = await request.body()
        if not content:
            raise HTTPException(status_code=400, detail="Empty audio payload")

        out_wav = pipeline.convert_audio(
            audio_bytes=content,
            pitch_shift=pitch_shift,
            index_rate=index_rate,
        )
        return Response(content=out_wav, media_type="audio/wav")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Voice conversion failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)

