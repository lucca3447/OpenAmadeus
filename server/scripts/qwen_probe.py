import os
import sys
import time
import io
import argparse
import wave
import httpx

if sys.platform == "win32":
    import codecs
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "replace")
    sys.stderr = codecs.getwriter("utf-8")(sys.stderr.buffer, "replace")

# Matrix of test variants
TEST_CASES = [
    {
        "name": "1. Original com Unicode Ellipsis (…)",
        "text": "U... um, quem… não sei se devo acreditar nesse elogio vindo de alguém que ainda me chama de… mas, se está me dizendo isso, tudo bem, não vá achando que vai me deixar sem postura.",
        "instruct": None,
        "rep_penalty": 1.05,
    },
    {
        "name": "2. Hifenizado e com Pausas Limpas (,)",
        "text": "U-um, quem, não sei se devo acreditar nesse elogio vindo de alguém que ainda me chama de, mas, se está me dizendo isso, tudo bem, não vá achando que vai me deixar sem postura.",
        "instruct": None,
        "rep_penalty": 1.0,
    },
    {
        "name": "3. Reticências Normais (...) com rep_penalty 1.0",
        "text": "U-um, quem... não sei se devo acreditar nesse elogio vindo de alguém que ainda me chama de... mas, se está me dizendo isso, tudo bem, não vá achando que vai me deixar sem postura.",
        "instruct": None,
        "rep_penalty": 1.0,
    },
    {
        "name": "4. Com Instruct em Inglês (Mid-Low Pitch)",
        "text": "U-um, quem, não sei se devo acreditar nesse elogio vindo de alguém que ainda me chama de, mas, se está me dizendo isso, tudo bem, não vá achando que vai me deixar sem postura.",
        "instruct": "Mid-low pitch, embarrassed and hesitant, restrained tsundere delivery.",
        "rep_penalty": 1.0,
    },
    {
        "name": "5. Teste de Tag Inline [serious]",
        "text": "[serious] Este é um teste estrito para checar se a tag inline é falada ou se modula a voz.",
        "instruct": None,
        "rep_penalty": 1.0,
    },
    {
        "name": "6. Calibrado Final (Hum, Reticências ... + Diction)",
        "text": "Hum, quem... não sei se devo acreditar nesse elogio vindo de alguém que ainda me chama de... mas, se está me dizendo isso, tudo bem, não vá achando que vai me deixar sem postura.",
        "instruct": "Mid-low pitch, embarrassed and defensive, restrained tsundere delivery, articulate diction.",
        "rep_penalty": 1.0,
    },
]


def get_audio_duration_wave(audio_bytes: bytes) -> float:
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate > 0:
                return round(frames / float(rate), 2)
    except Exception:
        pass
    # Fallback estimation for raw PCM16 24kHz mono (48,000 bytes/sec)
    return round(len(audio_bytes) / 48000.0, 2)


def run_probe(url: str, runs: int = 3):
    clean_url = url.strip().rstrip("/")
    print("=" * 75)
    print(f"🔬 OpenAmadeus Qwen3-TTS Sonda de Diagnóstico")
    print(f"Target URL: {clean_url} | Repetições por variante: {runs}")
    print("=" * 75)

    client = httpx.Client(timeout=90.0)

    # 1. Health check
    try:
        res = client.get(f"{clean_url}/health", timeout=5.0)
        if res.status_code == 200:
            data = res.json()
            print(f"✅ Conexão ativa! Status: {data.get('status')} | Dispositivo: {data.get('device')} | VRAM: {data.get('vram_allocated_mb')}MB")
        else:
            print(f"⚠️ Health check retornou HTTP {res.status_code}: {res.text[:100]}")
    except Exception as e:
        print(f"❌ Não foi possível conectar ao worker em {clean_url}: {e}")
        print("Certifique-se de que o worker local ou túnel do Colab está ativo.")
        return

    out_dir = os.path.join(os.path.dirname(__file__), "..", "data", "probes")
    os.makedirs(out_dir, exist_ok=True)

    print("\nExecutando matriz de testes...\n")
    results = []

    for idx, test in enumerate(TEST_CASES, 1):
        name = test["name"]
        text = test["text"]
        instruct = test["instruct"]
        rep_penalty = test["rep_penalty"]
        char_len = len(text)
        expected_min_duration = round(char_len * 0.05, 1)  # ~14-18 chars/sec em fala normal (~8-10s para 160 chars)

        durations = []
        errors = 0

        for r in range(runs):
            payload = {
                "text": text,
                "language": "Portuguese",
                "instruct": instruct,
                "temperature": 0.7,
                "top_p": 0.95,
                "repetition_penalty": rep_penalty,
            }
            try:
                t0 = time.perf_counter()
                res = client.post(f"{clean_url}/synthesize", json=payload, timeout=90.0)
                elapsed = round(time.perf_counter() - t0, 2)

                if res.status_code == 200 and len(res.content) > 1000:
                    dur = get_audio_duration_wave(res.content)
                    durations.append(dur)
                    if r == 0:
                        wav_path = os.path.join(out_dir, f"probe_var_{idx}.wav")
                        with open(wav_path, "wb") as f:
                            f.write(res.content)
                else:
                    errors += 1
            except Exception as ex:
                errors += 1

        avg_dur = round(sum(durations) / len(durations), 2) if durations else 0.0
        # If duration is significantly lower than expected minimum duration, it truncated!
        is_truncated = avg_dur < (expected_min_duration * 0.65) if avg_dur > 0 else True

        status = "⚠️ TRUNCADO" if is_truncated else "✅ COMPLETO"
        if errors > 0:
            status = f"❌ {errors} ERROS"

        results.append({
            "name": name,
            "char_len": char_len,
            "avg_dur": avg_dur,
            "expected_min": expected_min_duration,
            "status": status,
        })

    # Summary table
    print("-" * 75)
    print(f"{'Variante':<45} | {'Chars':<6} | {'Média (s)':<9} | {'Status':<10}")
    print("-" * 75)
    for res in results:
        print(f"{res['name']:<45} | {res['char_len']:<6} | {res['avg_dur']:<9} | {res['status']:<10}")
    print("-" * 75)
    print(f"\nGravações de teste salvas em: {os.path.abspath(out_dir)}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OpenAmadeus Qwen3-TTS Diagnostic Probe")
    parser.add_argument("--url", type=str, default="http://127.0.0.1:8005", help="Worker URL (e.g. Cloudflare tunnel or localhost:8005)")
    parser.add_argument("--runs", type=int, default=3, help="Number of repetitions per test case")
    args = parser.parse_args()

    run_probe(url=args.url, runs=args.runs)
