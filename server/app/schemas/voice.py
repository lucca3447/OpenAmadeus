from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict

class TTSRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    text: str
    engine: Optional[str] = "qwen3"  # "qwen3", "kokoro", "edge_rvc", "edge"
    qwen_mode: Optional[str] = Field("remote", alias="qwenMode")  # "remote", "local", "auto"
    qwen_remote_url: Optional[str] = Field(None, alias="qwenRemoteUrl")
    emotion: Optional[str] = None
    instruct: Optional[str] = None
    voice: Optional[str] = "pt-BR-FranciscaNeural"
    rate: Optional[str] = "+5%"
    pitch: Optional[str] = "+15Hz"
    use_rvc: Optional[bool] = Field(False, alias="useRvc")
    rvc_model: Optional[str] = Field("KurisuRVCv147", alias="rvcModel")
    rvc_pitch: Optional[int] = Field(0, alias="rvcPitch")
    rvc_index_rate: Optional[float] = Field(0.75, alias="rvcIndexRate")
    stream: Optional[bool] = False


class QwenPingRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    remote_url: Optional[str] = Field(None, alias="remoteUrl")


class QwenWorkerStatus(BaseModel):
    status: str  # "ready", "initializing", "offline", "error"
    device: Optional[str] = None
    vram_allocated_mb: Optional[float] = None
    ping_ms: Optional[float] = None
    mode: str = "remote"  # "remote" or "local"
    url: Optional[str] = None
    error: Optional[str] = None


class VoiceEngineStatus(BaseModel):
    qwen_remote: QwenWorkerStatus
    qwen_local: QwenWorkerStatus
    kokoro_available: bool
    rvc_available: bool
    rvc_models: List[str]
    active_engine: str



