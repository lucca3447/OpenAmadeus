from typing import Optional
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.schemas.voice import TTSRequest, QwenPingRequest, QwenWorkerStatus, VoiceEngineStatus
from app.services.voice_service import synthesize_speech
from app.services.qwen_tts.qwen_manager import QwenTTSManager
from app.services.kokoro_tts.kokoro_manager import KokoroTTSManager
from app.services.rvc.rvc_manager import RVCManager

router = APIRouter()

@router.post("/tts")
async def text_to_speech(req: TTSRequest):
    content_type, audio_stream = await synthesize_speech(
        text=req.text,
        voice=req.voice or "pt-BR-FranciscaNeural",
        rate=req.rate or "+5%",
        pitch=req.pitch or "+15Hz",
        use_rvc=bool(req.use_rvc),
        rvc_model=req.rvc_model or "KurisuRVCv147",
        rvc_pitch=req.rvc_pitch or 0,
        rvc_index_rate=req.rvc_index_rate if req.rvc_index_rate is not None else 0.75,
        engine=req.engine or "qwen3",
        qwen_mode=req.qwen_mode or "remote",
        qwen_remote_url=req.qwen_remote_url,
        emotion=req.emotion,
        instruct=req.instruct,
        stream=bool(req.stream),
    )
    headers = {
        "X-Accel-Buffering": "no",
        "Cache-Control": "no-cache",
    }
    if "L16" in content_type:
        headers["X-Audio-Format"] = "pcm_s16le"
        headers["X-Sample-Rate"] = "24000"

    return StreamingResponse(audio_stream, media_type=content_type, headers=headers)


@router.post("/voice/ping", response_model=QwenWorkerStatus)
@router.post("/ping", response_model=QwenWorkerStatus)
async def ping_qwen_endpoint(req: QwenPingRequest):
    """
    Pings the Qwen-TTS worker (remote or local) and returns latency, status and hardware info.
    """
    return await QwenTTSManager.ping_worker(target_url=req.remote_url)


@router.get("/voice/status", response_model=VoiceEngineStatus)
@router.get("/status", response_model=VoiceEngineStatus)
async def get_voice_status(remote_url: Optional[str] = None):
    """
    Returns full diagnostics of all audio sub-engines:
    - Remote Qwen-TTS status
    - Local Qwen-TTS status
    - Kokoro-TTS local availability
    - RVC available models
    """
    target_remote = remote_url or QwenTTSManager.resolve_target_url(qwen_mode="remote")
    remote_status = await QwenTTSManager.ping_worker(target_url=target_remote)
    local_status = await QwenTTSManager.ping_worker(target_url="http://127.0.0.1:8005")

    kokoro_ok = KokoroTTSManager.is_available()
    rvc_models = RVCManager.list_available_models()
    rvc_ok = len(rvc_models) > 0

    active = "edge_rvc"
    if remote_status.get("status") == "ready" or local_status.get("status") == "ready":
        active = "qwen3"
    elif kokoro_ok:
        active = "kokoro"

    return VoiceEngineStatus(
        qwen_remote=remote_status,
        qwen_local=local_status,
        kokoro_available=kokoro_ok,
        rvc_available=rvc_ok,
        rvc_models=rvc_models,
        active_engine=active,
    )


@router.get("/voice/models")
@router.get("/models")
async def get_voice_models():
    """Returns available RVC voice timbre models discovered in server/weights/"""
    return {
        "rvc_models": RVCManager.list_available_models(),
        "kokoro_voices": ["pf_dora"],
        "edge_voices": ["pt-BR-FranciscaNeural", "pt-BR-ThalitaNeural", "ja-JP-NanamiNeural"]
    }

