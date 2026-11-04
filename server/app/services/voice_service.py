import io
import re
from typing import AsyncGenerator, Tuple, Union, Optional, List
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

# Optional Edge-TTS for 100% Free Neural Speech
try:
    import edge_tts
    EDGE_TTS_AVAILABLE = True
except ImportError:
    EDGE_TTS_AVAILABLE = False

from app.services.rvc.rvc_manager import RVCManager
from app.services.qwen_tts.qwen_manager import QwenTTSManager
from app.services.kokoro_tts.kokoro_manager import KokoroTTSManager


def check_edge_tts_available() -> bool:
    global EDGE_TTS_AVAILABLE
    if not EDGE_TTS_AVAILABLE:
        try:
            import edge_tts
            EDGE_TTS_AVAILABLE = True
        except ImportError:
            EDGE_TTS_AVAILABLE = False
    return EDGE_TTS_AVAILABLE


def clean_speech_text(text: str) -> str:
    clean_text = re.sub(r"<!--[\s\S]*?(?:-->|-+>|>+|$)", "", text, flags=re.IGNORECASE)
    clean_text = re.sub(r"<!--\s*remember:[^>]*-->", "", clean_text, flags=re.IGNORECASE)
    clean_text = re.sub(r"<!--\s*pose:[^>]*-->", "", clean_text, flags=re.IGNORECASE)
    clean_text = re.sub(r"\*[^*]+\*", "", clean_text)
    clean_text = re.sub(r"[:;]-?[)(DPpOdD]", "", clean_text)
    clean_text = re.sub(r"[*_~`#\"'«»]", "", clean_text)
    # Normalize Unicode horizontal ellipsis (\u2026 '…' and \u2025 '‥')
    clean_text = re.sub(r"[…‥]", "...", clean_text)
    # Normalize excessive dots to clean triple dots
    clean_text = re.sub(r"\.{3,}", "...", clean_text)
    # Ensure proper spacing around ellipses
    clean_text = re.sub(r"\s*\.\.\.\s*", "... ", clean_text)
    clean_text = re.sub(r"\s+", " ", clean_text).strip()
    return clean_text


def clean_text_for_tts(text: str, lang: str = "pt") -> str:
    """
    Sanitizes text specifically for neural TTS (Qwen3-TTS) without altering the frontend transcript:
    - Normalizes Unicode ellipsis (\u2026 '…' and \u2025 '‥') and replaces mid-sentence '...' with ', '
      to prevent multi-second dead pauses and VN vocal sighs/groans
    - Converts interrobangs ('?!', '!?', '?!!', etc.) to a single clean '?'
    - When lang starts with 'pt', converts exclamation marks ('!', '!!', '!!!') to '.' to prevent Japanese glottal-stop
      clipping of final unstressed Portuguese syllables (e.g. 'relatório!' -> 'relató-')
    - Removes non-lexical anime hesitation vocables ('Hum', 'Hmm', 'U-um', 'Uhm') that trigger moans
    - De-stutters single-letter prefixes ('Q-quem' -> 'Quem', 'L-linda' -> 'Linda', 'N-não' -> 'Não')
    """
    clean_text = clean_speech_text(text)
    is_pt = (lang or "pt").lower().startswith("pt")
    # 1. Replace combined punctuation (?!, !?, etc.) with a single question mark
    clean_text = re.sub(r"\?+!+[!?]*|!+\?+[!?]*", "?", clean_text)
    if is_pt:
        # 2. Replace exclamation marks with '.' to prevent glottal-stop syllable truncation in PT-BR
        clean_text = re.sub(r"!+", ".", clean_text)
        clean_text = re.sub(r"([.,])\s*\.", r"\1", clean_text)

        # 3. Strip non-lexical anime hesitation vocables (U-um, U... um, Uhm, Hmm, Hum)
        # that trigger Japanese VN vocal sighs/moans ("gemidos")
        clean_text = re.sub(
            r"(?i)\b(?:[u]+(?:\s*\.{2,}\s*|-|\s+)[u]+m|[u]+h+m*|[u]+(?:\s*\.{2,}\s*|-|\s+)uh|h+u*m+)\b\s*[,;:.]*\s*",
            "",
            clean_text,
        )

    # 4. General single-letter stutters: Q-quem -> Quem, Q... quem -> Quem, L-linda -> Linda, N-não -> Não
    def _un_stutter(m: re.Match) -> str:
        prefix = m.group(1)
        word = m.group(2)
        if prefix.lower() == word[0].lower():
            return word.capitalize() if prefix.isupper() else word
        return m.group(0)

    clean_text = re.sub(r"\b([A-Za-zÀ-ÿ])(?:\s*\.{2,}\s*|-)([a-zà-ÿ]+)\b", _un_stutter, clean_text)

    # 5. Replace trailing ellipses with '.' and mid-sentence ellipses with ', '
    # to eliminate 2-3s silent gaps and breath hallucinations
    clean_text = re.sub(r"\s*\.{2,}\s*$", ".", clean_text)
    clean_text = re.sub(r"\s*\.{2,}\s*", ", ", clean_text)

    # 6. Clean redundant punctuation and normalize whitespace
    clean_text = re.sub(r",\s*,+", ",", clean_text)
    clean_text = re.sub(r"([.?!])\s*,", r"\1", clean_text)
    clean_text = re.sub(r",\s*([.?!])", r"\1", clean_text)
    clean_text = re.sub(r"^[,;:\s]+", "", clean_text)
    clean_text = re.sub(r"\s+([.,?!])", r"\1", clean_text)
    clean_text = re.sub(r"\s+", " ", clean_text).strip()

    if clean_text and clean_text[0].islower():
        clean_text = clean_text[0].upper() + clean_text[1:]

    return clean_text


async def generate_edge_tts_stream(
    text: str,
    voice: str = "pt-BR-FranciscaNeural",
    rate: str = "+5%",
    pitch: str = "+15Hz",
) -> AsyncGenerator[bytes, None]:
    if not check_edge_tts_available():
        raise HTTPException(
            status_code=503,
            detail="edge-tts não está instalado. Instale no servidor com: pip install edge-tts",
        )

    clean_text = clean_speech_text(text)
    if not clean_text:
        raise HTTPException(status_code=400, detail="Texto não pode ser vazio para síntese de voz.")

    try:
        communicate = edge_tts.Communicate(
            text=clean_text,
            voice=voice or "pt-BR-FranciscaNeural",
            rate=rate or "+5%",
            pitch=pitch or "+15Hz",
        )

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                yield chunk["data"]
    except Exception as e:
        print(f"[OpenAmadeus Core] Erro na síntese Edge-TTS: {e}")
        raise HTTPException(status_code=500, detail=f"Erro na síntese neural: {str(e)}")


async def synthesize_speech(
    text: str,
    voice: str = "pt-BR-FranciscaNeural",
    rate: str = "+5%",
    pitch: str = "+15Hz",
    use_rvc: bool = False,
    rvc_model: Optional[str] = "KurisuRVCv147",
    rvc_pitch: int = 0,
    rvc_index_rate: float = 0.75,
    engine: str = "qwen3",
    qwen_mode: Optional[str] = "remote",
    qwen_remote_url: Optional[str] = None,
    emotion: Optional[str] = None,
    instruct: Optional[str] = None,
    stream: bool = False,
    allow_fallback: bool = True,
    allowed_fallbacks: Optional[List[str]] = None,
) -> Tuple[str, AsyncGenerator[bytes, None]]:
    """
    Modular speech orchestrator with user-controlled strict mode vs. sequential fallback:
    1. Qwen3-TTS (Remote Colab URL if configured / Local if designated)
    2. Qwen3-TTS (Local loopback fallback if remote is offline and 'qwen_local' allowed)
    3. Kokoro-TTS (Lightweight 82M offline local synthesis if 'kokoro' allowed)
    4. Edge-TTS (Neural cloud fallback if 'edge_rvc' allowed)
    """
    clean_text = clean_speech_text(text)
    if not clean_text:
        raise HTTPException(status_code=400, detail="Texto não pode ser vazio para síntese de voz.")

    active_engine = (engine or "qwen3").lower()
    permitted = set(allowed_fallbacks if allowed_fallbacks is not None else ["qwen_local", "kokoro", "edge_rvc"])

    # =========================================================================
    # STEP 1: Qwen3-TTS (Primary)
    # =========================================================================
    if active_engine == "qwen3":
        qwen_text = clean_text_for_tts(text)
        primary_err = None
        print(f"[OpenAmadeus Voice] Qwen3 Synthesis (mode: {qwen_mode}, stream: {stream}, strict: {not allow_fallback}) | Emotion: '{emotion or 'neutral'}'")

        # 1.1 Complete WAV delivery
        if not stream:
            try:
                wav_bytes = await QwenTTSManager.synthesize(
                    text=qwen_text,
                    emotion=emotion,
                    custom_instruct=instruct,
                    language="Portuguese",
                    qwen_mode=qwen_mode or "remote",
                    qwen_remote_url=qwen_remote_url,
                )
                if wav_bytes:
                    async def _wav_generator():
                        yield wav_bytes
                    return "audio/wav", _wav_generator()
            except Exception as e:
                primary_err = e
                print(f"[OpenAmadeus Voice] Primary Qwen3 ({qwen_mode}) WAV error: {e}")

            if not allow_fallback:
                raise HTTPException(
                    status_code=503,
                    detail=f"[MODO ESTRITO DE VOZ] Falha no motor Qwen3-TTS ({qwen_mode}): {primary_err or 'Worker inacessível'}. Cascata de fallback desativada.",
                )

            # Local fallback for complete WAV (only if permitted)
            if qwen_mode == "remote" and "qwen_local" in permitted:
                local_url = "http://127.0.0.1:8005"
                if await QwenTTSManager.is_worker_healthy(local_url):
                    print("[OpenAmadeus Voice] Remote Qwen offline, attempting Local Qwen WAV...")
                    try:
                        local_wav = await QwenTTSManager.synthesize(
                            text=qwen_text,
                            emotion=emotion,
                            custom_instruct=instruct,
                            language="Portuguese",
                            qwen_mode="local",
                        )
                        if local_wav:
                            async def _local_wav_gen():
                                yield local_wav
                            return "audio/wav", _local_wav_gen()
                    except Exception as local_err:
                        print(f"[OpenAmadeus Voice] Local Qwen WAV fallback error: {local_err}")

        # 1.2 Streaming mode
        else:
            try:
                content_type, stream_gen = await QwenTTSManager.synthesize_stream(
                    text=qwen_text,
                    emotion=emotion,
                    custom_instruct=instruct,
                    language="Portuguese",
                    qwen_mode=qwen_mode or "remote",
                    qwen_remote_url=qwen_remote_url,
                )
                return content_type, stream_gen
            except Exception as e:
                primary_err = e
                print(f"[OpenAmadeus Voice] Primary Qwen3 ({qwen_mode}) streaming error: {e}")

            if not allow_fallback:
                raise HTTPException(
                    status_code=503,
                    detail=f"[MODO ESTRITO DE VOZ] Falha no streaming Qwen3-TTS ({qwen_mode}): {primary_err or 'Worker inacessível'}. Cascata de fallback desativada.",
                )

            if qwen_mode == "remote" and "qwen_local" in permitted:
                local_url = "http://127.0.0.1:8005"
                if await QwenTTSManager.is_worker_healthy(local_url):
                    print("[OpenAmadeus Voice] Remote Qwen offline, attempting Local Qwen stream...")
                    try:
                        content_type, local_stream_gen = await QwenTTSManager.synthesize_stream(
                            text=qwen_text,
                            emotion=emotion,
                            custom_instruct=instruct,
                            language="Portuguese",
                            qwen_mode="local",
                        )
                        return content_type, local_stream_gen
                    except Exception as local_err:
                        print(f"[OpenAmadeus Voice] Local Qwen fallback error: {local_err}")

        # Next cascade step from Qwen3
        if "kokoro" in permitted:
            print("[OpenAmadeus Voice] Qwen3 offline; cascading to Kokoro-TTS + RVC.")
            active_engine = "kokoro"
            use_rvc = True
        elif "edge_rvc" in permitted:
            print("[OpenAmadeus Voice] Qwen3 offline; cascading to Edge-TTS + RVC.")
            active_engine = "edge_rvc"
            use_rvc = True
        else:
            raise HTTPException(
                status_code=503,
                detail=f"Falha no Qwen3-TTS ({primary_err or 'offline'}) e nenhum motor secundário foi autorizado na fila de reserva.",
            )

    # =========================================================================
    # STEP 2: Kokoro-TTS (Lightweight local 82M)
    # =========================================================================
    if active_engine == "kokoro":
        kokoro_err = None
        print(f"[OpenAmadeus Voice] Kokoro-TTS Synthesis | Text: \"{clean_text}\"")
        try:
            kokoro_wav = await KokoroTTSManager.synthesize(
                text=clean_text,
                voice="pf_dora",
                speed=1.05,
            )
            if kokoro_wav:
                if use_rvc:
                    print(f"[OpenAmadeus Voice] Applying RVC model '{rvc_model}' on Kokoro audio...")
                    converted_wav = await RVCManager.convert(
                        audio_bytes=kokoro_wav,
                        pitch_shift=rvc_pitch,
                        index_rate=rvc_index_rate,
                        model_name=rvc_model or "KurisuRVCv147",
                    )
                    if converted_wav:
                        async def _kokoro_rvc_gen():
                            yield converted_wav
                        return "audio/wav", _kokoro_rvc_gen()
                    if not allow_fallback:
                        raise HTTPException(
                            status_code=503,
                            detail=f"[MODO ESTRITO DE VOZ] Conversão de timbre RVC ({rvc_model}) falhou sobre o áudio Kokoro.",
                        )
                    print("[OpenAmadeus Voice] RVC conversion failed; serving base Kokoro-TTS audio.")

                async def _kokoro_gen():
                    yield kokoro_wav
                return "audio/wav", _kokoro_gen()
        except HTTPException:
            raise
        except Exception as e:
            kokoro_err = e
            print(f"[OpenAmadeus Voice] Kokoro-TTS failed ({e}).")

        if not allow_fallback or "edge_rvc" not in permitted:
            raise HTTPException(
                status_code=503,
                detail=f"[MODO ESTRITO DE VOZ] Falha no motor Kokoro-TTS: {kokoro_err or 'Modelo indisponível'}.",
            )

        active_engine = "edge_rvc"

    # =========================================================================
    # STEP 3: Edge-TTS (Cloud Neural)
    # =========================================================================
    print(f"[OpenAmadeus Voice] Edge-TTS Synthesis (RVC: {use_rvc}) | Text: \"{clean_text}\"")
    try:
        if not use_rvc:
            return "audio/mpeg", generate_edge_tts_stream(clean_text, voice=voice, rate=rate, pitch=pitch)

        edge_chunks = []
        async for chunk in generate_edge_tts_stream(clean_text, voice=voice, rate=rate, pitch=pitch):
            edge_chunks.append(chunk)

        edge_audio_bytes = b"".join(edge_chunks)
        if not edge_audio_bytes:
            raise HTTPException(status_code=500, detail="Falha ao gerar áudio base Edge-TTS.")

        converted_wav = await RVCManager.convert(
            audio_bytes=edge_audio_bytes,
            pitch_shift=rvc_pitch,
            index_rate=rvc_index_rate,
            model_name=rvc_model or "KurisuRVCv147",
        )
        if converted_wav:
            async def _wav_gen():
                yield converted_wav
            return "audio/wav", _wav_gen()

        if not allow_fallback:
            raise HTTPException(
                status_code=503,
                detail=f"[MODO ESTRITO DE VOZ] O worker RVC ({rvc_model}) não respondeu e o fallback para voz sem timbre está bloqueado.",
            )

        async def _edge_fallback():
            yield edge_audio_bytes
        return "audio/mpeg", _edge_fallback()

    except HTTPException:
        raise
    except Exception as edge_err:
        print(f"[OpenAmadeus Voice] Edge-TTS error: {edge_err}")
        raise HTTPException(
            status_code=502,
            detail=f"Falha na síntese de voz: {str(edge_err)}"
        )
