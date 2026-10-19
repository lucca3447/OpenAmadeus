#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OpenAmadeus Companion — Comparador Diagnóstico: Local vs Remoto (Qwen3-TTS)
===========================================================================
Executa a mesma bateria de testes acústicos e de estresse simultaneamente
ou sequencialmente no Worker Local (127.0.0.1:8005) e no Worker Remoto (Colab/Cloudflare),
gerando uma tabela comparativa lado a lado para isolar se os problemas são:
  - BUGS DE MODELO/PROMPT (ocorrem tanto local quanto online)
  - BUGS DE REDE/INFRAESTRUTURA (ocorrem apenas no ambiente online)
"""

import os
import sys
import time
import io
import wave
import json
import argparse
from typing import Optional, Dict, Any, List

try:
    import httpx
except ImportError:
    httpx = None

import urllib.request
import urllib.error

if sys.platform == "win32":
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

# Bateria de testes focada em isolar os bugs conhecidos
COMPARATIVE_TEST_CASES = [
    {
        "id": "1_curto_emocional",
        "title": "1. Frase Curta Tsundere",
        "text": "Quem você está chamando de fofa? Não diga bobagens e preste atenção no relatório!",
        "emotion": "tsundere",
        "instruct": None,
        "stream": False,
        "bug_target": "Timbre, agudos, gritos ou falsete indesejado",
        "min_active_s": 3.5,
    },
    {
        "id": "2_longo_truncamento",
        "title": "2. Frase Longa Científica (Stress de Duração)",
        "text": "Se analisarmos pelo princípio da relatividade geral e curvas temporais fechadas, as equações de Kerr permitem soluções matemáticas para a rotação de buracos de minhoca. No entanto, o colapso por flutuação quântica de vácuo ainda impede qualquer transmissão causal sem violar as leis termodinâmicas.",
        "emotion": "analytical",
        "instruct": None,
        "stream": False,
        "bug_target": "Corte de frase / max_new_tokens / timeout",
        "min_active_s": 12.0,
    },
    {
        "id": "3_hesitacao_gemidos",
        "title": "3. Hesitações e Gaguejo Anime (Hum vs Gemidos)",
        "text": "Hum, quem... não sei se devo acreditar nesse elogio vindo de alguém como você... mas se faz tanta questão, tudo bem.",
        "emotion": "flustered",
        "instruct": None,
        "stream": False,
        "bug_target": "Ruídos bizarros, suspiros vocais, pausas estranhas",
        "min_active_s": 4.0,
    },
    {
        "id": "4_streaming_estabilidade",
        "title": "4. Streaming PCM (Resistência a Pacotes e Buffer)",
        "text": "Esta é uma verificação em tempo real de streaming de pacotes de áudio.",
        "emotion": "neutral",
        "instruct": None,
        "stream": True,
        "bug_target": "Picotamento, engasgos, estalos e cortes no streaming",
        "min_active_s": 3.0,
    },
]


def get_audio_info(content: bytes, is_stream: bool = False) -> Dict[str, Any]:
    """
    Analisa o payload WAV ou PCM16 calculando métricas acústicas reais via DSP:
    - duration_s: duração total do arquivo
    - active_s: tempo real com voz ativa (descontando buracos de silêncio)
    - max_gap_s: maior pausa de silêncio interna no meio da fala
    - med_f0 / p95_f0: frequência fundamental mediana e percentil 95 (detecta falsete/gritos >500Hz)
    - tail_rms: energia nos últimos 80ms (detecta corte abrupto de palavra no final)
    """
    import numpy as np

    size_kb = round(len(content) / 1024.0, 1)
    rate = 24000
    samples = None

    try:
        if not is_stream:
            with wave.open(io.BytesIO(content), "rb") as wf:
                rate = wf.getframerate() or 24000
                raw_frames = wf.readframes(wf.getnframes())
                samples = np.frombuffer(raw_frames, dtype=np.int16).astype(np.float32) / 32768.0
    except Exception:
        samples = None

    if samples is None:
        usable = len(content) - (len(content) % 2)
        samples = np.frombuffer(content[:usable], dtype=np.int16).astype(np.float32) / 32768.0

    duration = round(len(samples) / float(rate), 2) if rate > 0 else 0.0
    if len(samples) < int(rate * 0.1):
        return {
            "size_kb": size_kb,
            "duration_s": duration,
            "active_s": duration,
            "max_gap_s": 0.0,
            "med_f0": 0.0,
            "p95_f0": 0.0,
            "tail_rms": 0.0,
        }

    # 1. Energia por janela de 50ms para medir voz ativa e buracos de silêncio internos
    win = int(rate * 0.05)
    n_wins = len(samples) // win
    trimmed = samples[: n_wins * win].reshape(n_wins, win)
    win_rms = np.sqrt(np.mean(trimmed ** 2, axis=1))
    voiced_mask = win_rms > 0.008
    active_s = round(float(np.sum(voiced_mask) * 0.05), 2)

    # Maior buraco de silêncio INTERNO (entre o primeiro e o último frame com voz)
    voiced_indices = np.where(voiced_mask)[0]
    max_gap_s = 0.0
    if len(voiced_indices) >= 2:
        interior = voiced_mask[voiced_indices[0] : voiced_indices[-1] + 1]
        cur_gap = 0
        best_gap = 0
        for is_v in interior:
            if not is_v:
                cur_gap += 1
                if cur_gap > best_gap:
                    best_gap = cur_gap
            else:
                cur_gap = 0
        max_gap_s = round(best_gap * 0.05, 2)

    # 2. RMS dos últimos 80ms para detectar corte abrupto no meio da última sílaba
    tail_len = max(1, int(rate * 0.08))
    tail_rms = round(float(np.sqrt(np.mean(samples[-tail_len:] ** 2))), 4)

    # 3. Estimativa de F0 via autocorrelação em janelas de 40ms
    f0_list = []
    f_win = int(rate * 0.04)
    f_hop = int(rate * 0.02)
    min_lag = max(1, int(rate / 750.0))
    max_lag = int(rate / 110.0)
    for start in range(0, len(samples) - f_win, f_hop):
        seg = samples[start : start + f_win]
        if np.sqrt(np.mean(seg ** 2)) < 0.025:
            continue
        seg = seg - np.mean(seg)
        corr = np.correlate(seg, seg, mode="full")[len(seg) - 1 :]
        if corr[0] <= 0 or len(corr) <= max_lag:
            continue
        search = corr[min_lag:max_lag]
        if len(search) == 0:
            continue
        peak_idx = int(np.argmax(search)) + min_lag
        if corr[peak_idx] / corr[0] >= 0.45:
            f0_list.append(rate / float(peak_idx))

    med_f0 = round(float(np.median(f0_list)), 1) if f0_list else 0.0
    p95_f0 = round(float(np.percentile(f0_list, 95)), 1) if f0_list else 0.0

    return {
        "size_kb": size_kb,
        "duration_s": duration,
        "active_s": active_s,
        "max_gap_s": max_gap_s,
        "med_f0": med_f0,
        "p95_f0": p95_f0,
        "tail_rms": tail_rms,
    }


def evaluate_single_result(res: Optional[Dict[str, Any]], min_active_s: float) -> List[str]:
    """Avalia anomalias acústicas reais em um único resultado (Local ou Remoto)."""
    if not res or not res.get("ok"):
        return [f"ERRO ({res.get('error', 'falha') if res else 'off'})"]
    issues = []
    if res.get("p95_f0", 0) > 550.0:
        issues.append(f"Grito/Falsete (p95={res['p95_f0']}Hz)")
    if res.get("max_gap_s", 0) > 1.45:
        issues.append(f"Buraco mudo ({res['max_gap_s']}s)")
    if res.get("active_s", 0) < min_active_s:
        issues.append(f"Frase truncada (voz={res['active_s']}s<{min_active_s}s)")
    elif res.get("tail_rms", 0) > 0.004:
        issues.append(f"Final cortado (tailRMS={res['tail_rms']})")
    return issues


def save_audio_file(file_path: str, raw_audio: bytes, is_stream: bool):
    """Salva áudio garantindo cabeçalho WAV válido para reprodução em qualquer player."""
    if is_stream:
        # Transforma os bytes PCM16 crus (24kHz mono) em um WAV com cabeçalho RIFF padrão
        try:
            with wave.open(file_path, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)  # 16-bit
                wf.setframerate(24000)
                wf.writeframes(raw_audio)
            return
        except Exception:
            pass
    with open(file_path, "wb") as f:
        f.write(raw_audio)


def test_endpoint(
    url: str,
    payload: dict,
    is_stream: bool,
    client: Any = None,
) -> Dict[str, Any]:
    """Envia a requisição para um worker específico e mede o tempo de resposta + métricas DSP."""
    clean_url = url.strip().rstrip("/")
    path = "/synthesize_stream" if is_stream else "/synthesize"
    endpoint = f"{clean_url}{path}"

    t0 = time.perf_counter()
    try:
        if client is not None:
            if is_stream:
                with client.stream("POST", endpoint, json=payload, timeout=90.0) as resp:
                    if resp.status_code != 200:
                        return {"ok": False, "error": f"HTTP {resp.status_code}", "time_s": 0}
                    chunks = []
                    ttfb = None
                    for chunk in resp.iter_bytes():
                        if ttfb is None:
                            ttfb = round(time.perf_counter() - t0, 2)
                        chunks.append(chunk)
                    total_time = round(time.perf_counter() - t0, 2)
                    raw_bytes = b"".join(chunks)
                    info = get_audio_info(raw_bytes, is_stream=True)
                    return {
                        "ok": True,
                        "bytes": raw_bytes,
                        "time_s": total_time,
                        "ttfb_s": ttfb or total_time,
                        **info,
                    }
            else:
                resp = client.post(endpoint, json=payload, timeout=90.0)
                total_time = round(time.perf_counter() - t0, 2)
                if resp.status_code == 200 and len(resp.content) > 500:
                    info = get_audio_info(resp.content, is_stream=False)
                    return {
                        "ok": True,
                        "bytes": resp.content,
                        "time_s": total_time,
                        **info,
                    }
                else:
                    return {"ok": False, "error": f"HTTP {resp.status_code}", "time_s": total_time}
        else:
            req_data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                endpoint,
                data=req_data,
                headers={"Content-Type": "application/json", "User-Agent": "OpenAmadeus-Probe/1.0"},
            )
            with urllib.request.urlopen(req, timeout=90.0) as resp:
                content = resp.read()
                total_time = round(time.perf_counter() - t0, 2)
                if len(content) > 500:
                    info = get_audio_info(content, is_stream=is_stream)
                    return {
                        "ok": True,
                        "bytes": content,
                        "time_s": total_time,
                        **info,
                    }
                return {"ok": False, "error": "Resposta muito curta", "time_s": total_time}
    except Exception as ex:
        total_time = round(time.perf_counter() - t0, 2)
        return {"ok": False, "error": str(ex)[:40], "time_s": total_time}


def check_health(url: str, client: Any = None) -> Dict[str, Any]:
    clean_url = url.strip().rstrip("/")
    if client is not None:
        r = client.get(f"{clean_url}/health", timeout=6.0)
        return {"status_code": r.status_code, "data": r.json() if r.status_code == 200 else None}
    else:
        req = urllib.request.Request(f"{clean_url}/health", headers={"User-Agent": "OpenAmadeus-Probe/1.0"})
        with urllib.request.urlopen(req, timeout=6.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {"status_code": resp.status, "data": data}


def run_comparison(local_url: Optional[str] = None, remote_url: Optional[str] = None):
    print("=" * 86)
    print("🔬 OpenAmadeus — Diagnóstico & Comparador Acústico: Qwen3-TTS")
    if local_url and remote_url:
        print("Modo: Comparação A/B")
        print(f"Local:  {local_url}")
        print(f"Remoto: {remote_url}")
    elif local_url:
        print("Modo: Diagnóstico LOCAL")
        print(f"Alvo:   {local_url}")
        print("Dica: Para comparar A/B com o Colab, adicione: --remote https://sua-url.trycloudflare.com")
    elif remote_url:
        print("Modo: Diagnóstico REMOTO (Colab)")
        print(f"Alvo:   {remote_url}")
    else:
        print("❌ Nenhum alvo especificado. Use --local e/ou --remote.")
        return
    print("=" * 86)

    client = httpx.Client(timeout=95.0) if httpx is not None else None

    # 1. Health checks
    print("\n[Etapa 1] Checagem de Conectividade e Hardware:")
    targets = []
    if local_url:
        targets.append(("LOCAL", local_url))
    if remote_url:
        targets.append(("REMOTO", remote_url))

    for label, u in targets:
        try:
            res = check_health(u, client)
            if res.get("status_code") == 200 and res.get("data"):
                d = res["data"]
                print(f"  ✅ {label:<7}: Ativo! Dispositivo: {d.get('device')} | VRAM: {d.get('vram_allocated_mb')} MB | Backend: {d.get('backend', 'Qwen3-TTS')}")
            else:
                print(f"  ⚠️ {label:<7}: Respondeu HTTP {res.get('status_code')}")
        except Exception as e:
            print(f"  ❌ {label:<7}: Inacessível em {u} ({e})")

    out_dir = os.path.join(os.path.dirname(__file__), "..", "data", "comparison_probes")
    os.makedirs(out_dir, exist_ok=True)

    print("\n[Etapa 2] Executando Bateria de Testes...")
    print(f"Gravações de áudio salvas em: {os.path.abspath(out_dir)}\n")

    summary_rows = []

    for test in COMPARATIVE_TEST_CASES:
        t_id = test["id"]
        t_title = test["title"]
        t_text = test["text"]
        t_instruct = test["instruct"]
        is_stream = test["stream"]
        bug_target = test["bug_target"]
        min_active_s = test.get("min_active_s", 2.5)

        payload = {
            "text": t_text,
            "language": "Portuguese",
            "instruct": t_instruct,
            "temperature": 0.65,
            "top_p": 0.90,
            "repetition_penalty": 1.05,
            "max_new_tokens": 2048,
        }

        print(f"▶ Testando: {t_title}")
        print(f"   Foco do Bug: {bug_target}")

        res_loc = None
        if local_url:
            res_loc = test_endpoint(local_url, payload, is_stream, client)
            if res_loc.get("ok"):
                loc_wav_path = os.path.join(out_dir, f"{t_id}_LOCAL.wav")
                save_audio_file(loc_wav_path, res_loc["bytes"], is_stream)

        res_rem = None
        if remote_url:
            res_rem = test_endpoint(remote_url, payload, is_stream, client)
            if res_rem.get("ok"):
                rem_wav_path = os.path.join(out_dir, f"{t_id}_REMOTE.wav")
                save_audio_file(rem_wav_path, res_rem["bytes"], is_stream)

        # Diagnóstico acústico real
        loc_issues = evaluate_single_result(res_loc, min_active_s) if local_url else []
        rem_issues = evaluate_single_result(res_rem, min_active_s) if remote_url else []

        if local_url and remote_url:
            if not loc_issues and not rem_issues:
                diag = "✅ AMBOS ESTÁVEIS (Sem cortes/gritos/pausas)"
            elif loc_issues and not rem_issues:
                diag = f"⚠️ Anomalia LOCAL: {', '.join(loc_issues)}"
            elif rem_issues and not loc_issues:
                diag = f"⚠️ Anomalia REMOTO: {', '.join(rem_issues)}"
            else:
                diag = f"❌ LOCAL [{', '.join(loc_issues)}] | REMOTO [{', '.join(rem_issues)}]"
        elif local_url:
            diag = "✅ ESTÁVEL (Sem cortes/gritos/pausas)" if not loc_issues else f"⚠️ {', '.join(loc_issues)}"
        else:
            diag = "✅ ESTÁVEL (Sem cortes/gritos/pausas)" if not rem_issues else f"⚠️ {', '.join(rem_issues)}"

        summary_rows.append({
            "title": t_title,
            "loc": res_loc,
            "rem": res_rem,
            "diag": diag,
        })

    # Imprime Tabela Resumo
    print("\n" + "=" * 120)
    if local_url and remote_url:
        print(f"{'Caso de Teste':<32} | {'LOCAL (Dur/Voz/F0/Gap)':<30} | {'REMOTO (Dur/Voz/F0/Gap)':<30} | {'Veredito Acústico'}")
        print("=" * 120)
        for row in summary_rows:
            t_name = row["title"][:32]
            loc = row["loc"]
            rem = row["rem"]
            diag = row["diag"]
            loc_str = (
                f"{loc['duration_s']}s (voz:{loc['active_s']}s F0:{int(loc['med_f0'])}Hz gap:{loc['max_gap_s']}s)"
                if loc and loc.get("ok")
                else f"ERRO: {loc.get('error') if loc else 'off'}"
            )
            rem_str = (
                f"{rem['duration_s']}s (voz:{rem['active_s']}s F0:{int(rem['med_f0'])}Hz gap:{rem['max_gap_s']}s)"
                if rem and rem.get("ok")
                else f"ERRO: {rem.get('error') if rem else 'off'}"
            )
            print(f"{t_name:<32} | {loc_str:<30} | {rem_str:<30} | {diag}")
    else:
        print(f"{'Caso de Teste':<35} | {'Duração (Voz Ativa)':<22} | {'Pitch (med/p95 F0)':<20} | {'Max Gap':<9} | {'Veredito Acústico'}")
        print("=" * 120)
        for row in summary_rows:
            r = row["loc"] if local_url else row["rem"]
            if r and r.get("ok"):
                dur_str = f"{r['duration_s']}s ({r['active_s']}s voz)"
                f0_str = f"{r['med_f0']} / {r['p95_f0']} Hz"
                gap_str = f"{r['max_gap_s']}s"
            else:
                dur_str, f0_str, gap_str = "-", "-", "-"
            print(f"{row['title'][:35]:<35} | {dur_str:<22} | {f0_str:<20} | {gap_str:<9} | {row['diag']}")

    print("=" * 120)
    print("\n💡 DICA DE OURO:")
    print("Abra a pasta dos áudios gerados no Windows Explorer para ouvir com fone de ouvido:")
    print("  explorer server\\data\\comparison_probes\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OpenAmadeus — Diagnóstico & Comparador Qwen3 Local vs Remoto")
    parser.add_argument("--local", type=str, default="http://127.0.0.1:8005", help="URL do worker local (padrão: http://127.0.0.1:8005)")
    parser.add_argument("--remote", type=str, default=None, help="URL pública do Colab/Cloudflare (ex: https://xxx.trycloudflare.com)")
    parser.add_argument("--local-only", action="store_true", help="Executa apenas no worker local ignorando remoto")
    parser.add_argument("--remote-only", action="store_true", help="Executa apenas no worker remoto ignorando local")
    args = parser.parse_args()

    target_local = None if args.remote_only else args.local
    target_remote = None if args.local_only else args.remote

    run_comparison(local_url=target_local, remote_url=target_remote)
