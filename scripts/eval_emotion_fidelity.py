#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenAmadeus Companion — Avaliador de Fidelidade Acústica das 21 Emoções
========================================================================
Compara gravações geradas pelo Qwen3-TTS / FasterQwen3 com o gabarito
acústico canônico extraído da dubladora oficial (Asami Imai).
"""

import argparse
import os
import sys
import wave
import numpy as np
from pathlib import Path

# Fix Windows console encoding
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = REPO_ROOT / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

try:
    from app.services.qwen_tts.emotion_mapper import (
        EMOTION_ACOUSTIC_TARGETS,
        EMOTION_INSTRUCT_MAP,
    )
except ImportError:
    # Standalone fallback if server package not directly in path
    EMOTION_ACOUSTIC_TARGETS = {}
    EMOTION_INSTRUCT_MAP = {}


def medir_wav(caminho_wav: str):
    """Calcula a mediana de F0 (Pitch) e RMS (Volume) de um arquivo WAV."""
    with wave.open(caminho_wav, "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        n = wf.getnframes()
        audio = np.frombuffer(wf.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
        if ch > 1:
            audio = audio.reshape(-1, ch).mean(axis=1)

        dur = len(audio) / sr
        rms = float(np.sqrt(np.mean(audio**2)))
        f0s = []
        min_l, max_l = int(sr / 580), int(sr / 135)
        for s in range(0, len(audio) - int(0.15 * sr), int(0.08 * sr)):
            seg = audio[s : s + int(0.15 * sr)]
            if np.sqrt(np.mean(seg**2)) > 0.025:
                corr = np.correlate(seg, seg, mode="full")[len(seg) - 1 :]
                lag = np.argmax(corr[min_l:max_l]) + min_l
                f0s.append(sr / lag)

        med_f0 = float(np.median(f0s)) if f0s else 0.0
        return dur, rms, med_f0


def calcular_fidelidade(med_f0: float, rms: float, target_f0: float, target_rms: float) -> float:
    """Calcula score percentual (0 a 100%) baseado no desvio relativo de F0 e RMS."""
    if target_f0 <= 0 or target_rms <= 0:
        return 0.0

    err_f0 = abs(med_f0 - target_f0) / target_f0
    err_rms = abs(rms - target_rms) / target_rms
    # Penalidade ponderada: 60% peso para pitch (F0), 40% peso para energia (RMS)
    total_penalty = (err_f0 * 60.0) + (err_rms * 40.0)
    score = max(0.0, 100.0 - total_penalty)
    return round(score, 1)


def print_gabarito():
    print("=" * 105)
    print(" GABARITO OFICIAL ACÚSTICO — ASAMI IMAI (MAKISE KURISU) — 21 EMOÇÕES")
    print("=" * 105)
    header = f"{'EMOÇÃO':<20} | {'ALVO F0':<12} | {'FAIXA (P10-P90)':<17} | {'ALVO RMS':<9} | {'ARQUIVO CANÔNICO'}"
    print(header)
    print("-" * 105)

    ordenados = sorted(EMOTION_ACOUSTIC_TARGETS.items(), key=lambda x: x[1]["f0_hz"])
    for emo, data in ordenados:
        f0 = f"{data['f0_hz']} Hz"
        r1, r2 = data["f0_range"]
        faixa = f"{r1}-{r2} Hz"
        rms = f"{data['rms']}"
        arq = data["file"]
        print(f"{emo:<20} | {f0:<12} | {faixa:<17} | {rms:<9} | {arq}")
    print("=" * 105)


def main():
    parser = argparse.ArgumentParser(
        description="Avaliador de Fidelidade Acústica das 21 Emoções do OpenAmadeus"
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Exibe a tabela oficial com os alvos acústicos das 21 emoções.",
    )
    parser.add_argument(
        "--file",
        type=str,
        help="Caminho para um arquivo .wav gerado para avaliação.",
    )
    parser.add_argument(
        "--emotion",
        type=str,
        help="Nome da emoção correspondente ao arquivo avaliado (ex: tsundere, blushing).",
    )
    parser.add_argument(
        "--dir",
        type=str,
        help="Diretório contendo áudios nomeados como <emocao>_*.wav para avaliação em lote.",
    )

    args = parser.parse_args()

    if args.list or (not args.file and not args.dir):
        print_gabarito()
        return 0

    if args.file and args.emotion:
        emo = args.emotion.lower().strip()
        if emo not in EMOTION_ACOUSTIC_TARGETS:
            print(f"[!] Emoção desconhecida: '{emo}'. Use uma das 21 emoções canônicas.")
            return 1
        target = EMOTION_ACOUSTIC_TARGETS[emo]
        dur, rms, f0 = medir_wav(args.file)
        score = calcular_fidelidade(f0, rms, target["f0_hz"], target["rms"])
        print("-" * 75)
        print(f"Avaliação da Emoção: '{emo.upper()}'")
        print(f"Arquivo testado:    {args.file} ({dur:.2f}s)")
        print(f"Frequência Medida:  {f0:.1f} Hz (Alvo Asami Imai: {target['f0_hz']} Hz)")
        print(f"Volume RMS Medido:  {rms:.3f} (Alvo Asami Imai: {target['rms']})")
        print(f"Fidelidade Acústica: {score}%")
        print("-" * 75)
        return 0

    if args.dir:
        dir_path = Path(args.dir)
        if not dir_path.exists():
            print(f"[!] Diretório não encontrado: {dir_path}")
            return 1
        print("=" * 95)
        print(f" Avaliação em lote de áudios em: {dir_path}")
        print("=" * 95)
        print(f"{'EMOÇÃO':<20} | {'F0 GERADO':<12} | {'F0 ALVO':<12} | {'RMS':<8} | {'FIDELIDADE'}")
        print("-" * 95)
        scores = []
        for wav_path in dir_path.glob("*.wav"):
            for emo in EMOTION_ACOUSTIC_TARGETS:
                if wav_path.name.lower().startswith(emo):
                    target = EMOTION_ACOUSTIC_TARGETS[emo]
                    dur, rms, f0 = medir_wav(str(wav_path))
                    score = calcular_fidelidade(f0, rms, target["f0_hz"], target["rms"])
                    scores.append(score)
                    f0_str = f"{f0:.1f} Hz"
                    t_f0 = f"{target['f0_hz']} Hz"
                    print(f"{emo:<20} | {f0_str:<12} | {t_f0:<12} | {rms:<8.3f} | {score}%")
                    break
        if scores:
            print("-" * 95)
            print(f"Fidelidade Média Global: {sum(scores)/len(scores):.1f}%")
        print("=" * 95)
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
