import os
from typing import Optional, Dict, Any

# Flag to toggle between acoustic English instruct steering and pure pre-trained weights.
# Default is "false" because starrydark/Kurisu_Qwen3_TTS is a 12Hz Base SFT model (spk_id=3000)
# that was not trained with CustomVoice instruct system prompts.
QWEN_USE_EMOTION_INSTRUCT = os.environ.get("QWEN_USE_EMOTION_INSTRUCT", "false").lower() in ("1", "true", "yes")

# Acoustic ground-truth targets derived from Asami Imai's canonical Steins;Gate voicelines
EMOTION_ACOUSTIC_TARGETS: Dict[str, Dict[str, Any]] = {
    # 1. Registro Grave / Firme (220 - 275 Hz)
    "stern": {"f0_hz": 221.2, "f0_range": (213.1, 477.6), "rms": 0.109, "file": "kurisu_0179.wav"},
    "thinking": {"f0_hz": 248.7, "f0_range": (202.5, 393.4), "rms": 0.101, "file": "kurisu_2060.wav"},
    "worried": {"f0_hz": 268.2, "f0_range": (195.4, 321.3), "rms": 0.077, "file": "kurisu_1478.wav"},
    "disdain": {"f0_hz": 269.7, "f0_range": (239.3, 353.5), "rms": 0.091, "file": "kurisu_2693.wav"},
    "serious": {"f0_hz": 271.2, "f0_range": (192.7, 352.9), "rms": 0.152, "file": "kurisu_2927.wav"},
    "smug": {"f0_hz": 280.7, "f0_range": (199.4, 300.0), "rms": 0.081, "file": "kurisu_0186.wav"},
    # 2. Registro Médio / Conversacional (285 - 330 Hz)
    "sad": {"f0_hz": 289.2, "f0_range": (261.3, 389.0), "rms": 0.034, "file": "kurisu_4493.wav"},
    "analytical": {"f0_hz": 303.8, "f0_range": (247.0, 372.7), "rms": 0.035, "file": "kurisu_0973.wav"},
    "smile": {"f0_hz": 313.7, "f0_range": (269.8, 362.1), "rms": 0.132, "file": "kurisu_1218.wav"},
    "neutral": {"f0_hz": 327.1, "f0_range": (236.3, 374.7), "rms": 0.092, "file": "kurisu_0189.wav"},
    # 3. Registro Agudo / Expressivo (340 - 435 Hz)
    "look_side": {"f0_hz": 345.4, "f0_range": (256.1, 565.0), "rms": 0.147, "file": "kurisu_0352.wav"},
    "eyes_closed": {"f0_hz": 350.4, "f0_range": (259.5, 510.9), "rms": 0.036, "file": "kurisu_0699.wav"},
    "desperate": {"f0_hz": 354.4, "f0_range": (204.5, 533.4), "rms": 0.215, "file": "kurisu_2728.wav"},
    "happy": {"f0_hz": 362.3, "f0_range": (216.4, 407.1), "rms": 0.157, "file": "kurisu_2955.wav"},
    "puzzled": {"f0_hz": 368.1, "f0_range": (258.4, 460.2), "rms": 0.094, "file": "kurisu_0831.wav"},
    "flustered": {"f0_hz": 369.3, "f0_range": (263.8, 421.4), "rms": 0.066, "file": "kurisu_1474.wav"},
    "tsundere": {"f0_hz": 372.5, "f0_range": (295.0, 440.0), "rms": 0.145, "file": "kurisu_1406.wav"},
    "blushing": {"f0_hz": 413.8, "f0_range": (218.8, 454.6), "rms": 0.053, "file": "kurisu_4314.wav"},
    "wink": {"f0_hz": 424.8, "f0_range": (309.5, 427.8), "rms": 0.033, "file": "kurisu_4624.wav"},
    "annoyed": {"f0_hz": 432.4, "f0_range": (300.7, 567.4), "rms": 0.162, "file": "kurisu_0221.wav"},
    # 4. Registro Extremo / Falsete Emocional (> 500 Hz)
    "holding_back_tears": {"f0_hz": 513.4, "f0_range": (287.1, 585.4), "rms": 0.167, "file": "kurisu_0656.wav"},
}

# Calibrated English instructions following official 7-dimension guidance:
# Concise (10-20 words), anchored at mid-low pitch to prevent high F0 (>500Hz) screeching,
# with restrained delivery and distinct emotional baselines.
EMOTION_INSTRUCT_MAP: Dict[str, Optional[str]] = {
    "neutral": None,
    "tsundere": "Mid pitch, defensive, slightly annoyed and reluctant, sharp articulate diction.",
    "flustered": "Mid-low pitch, embarrassed and defensive, restrained tsundere delivery, articulate diction.",
    "blushing": "Mid-low pitch, shy and subdued, soft articulate diction.",
    "serious": "Mid-low pitch, composed, firm and rational, steady pace.",
    "analytical": "Mid-low pitch, academic, precise articulation, rational tone.",
    "thinking": "Mid-low pitch, thoughtful and reflective, measured pace.",
    "stern": "Low pitch, authoritative and strict, controlled pace.",
    "annoyed": "Mid pitch, exasperated, irritated, crisp and cutting delivery.",
    "smug": "Mid pitch, confident, slightly mocking and teasing, self-assured.",
    "disdain": "Mid-low pitch, cold, aloof and dismissive, dry tone.",
    "smile": "Mid pitch, subtle smile, slightly amused, articulate tsundere delivery.",
    "happy": "Mid pitch, bright and pleased, lively but restrained pace.",
    "wink": "Mid pitch, playful, conspiratorial and teasing.",
    "puzzled": "Mid pitch, curious, slightly confused, inquisitive inflection.",
    "worried": "Mid-low pitch, tense, concerned and cautious delivery.",
    "sad": "Mid-low pitch, quiet, melancholic and subdued, slow pace.",
    "holding_back_tears": "Mid-low pitch, emotionally strained, choked up, slow restrained pace.",
    "desperate": "Mid pitch, anxious, urgent and distressed, tense delivery.",
    "look_side": "Mid-low pitch, evasive, looking away, slightly defensive.",
    "eyes_closed": "Mid-low pitch, tranquil, serene, relaxed and quiet delivery.",
}


def resolve_acoustic_instruct(emotion: Optional[str] = None, custom_instruct: Optional[str] = None) -> Optional[str]:
    """
    Resolves acoustic instruction for Qwen3-TTS:
    1. Explicit custom_instruct takes absolute precedence.
    2. If QWEN_USE_EMOTION_INSTRUCT is disabled (env/flag), returns None for pure weights.
    3. Resolves concise English prompt mapped to canonical 21 emotions.
    """
    if custom_instruct:
        return custom_instruct

    if not QWEN_USE_EMOTION_INSTRUCT:
        return None

    if not emotion:
        return EMOTION_INSTRUCT_MAP.get("neutral")

    clean_emotion = emotion.lower().strip()
    return EMOTION_INSTRUCT_MAP.get(clean_emotion, EMOTION_INSTRUCT_MAP.get("neutral"))
