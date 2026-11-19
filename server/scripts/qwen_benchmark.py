import os
import sys
import time
import asyncio
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

try:
    sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
except Exception:
    pass

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from app.services.qwen_tts.qwen_manager import QwenTTSManager
from app.services.voice_service import clean_speech_text

async def run_benchmark():
    print("=" * 60)
    print(" [BENCHMARK] Qwen3-TTS Acoustic Benchmark & Continuous Prosody Test")
    print("=" * 60)

    print("\n[Step 0] Ensuring Qwen3-TTS worker is online and model is loaded in GPU...")
    t0_warmup = time.time()
    is_ready = await QwenTTSManager.ensure_worker(max_wait_sec=150.0)
    if not is_ready:
        print("[FAIL] Qwen3-TTS worker failed to initialize.")
        return False
    print(f"[OK] Worker resident and ready (warmup took {time.time() - t0_warmup:.2f}s)")

    # Reference utterance from user test
    reference_text = "Não precisa me envergonhar assim... Lucca seu idiota"
    cleaned = clean_speech_text(reference_text)
    print(f"\n[Test 1] Input text: \"{reference_text}\"")
    print(f"         Cleaned speech: \"{cleaned}\"")

    t0 = time.time()
    audio = await QwenTTSManager.synthesize(
        text=cleaned,
        emotion="tsundere"
    )
    t_elapsed = time.time() - t0

    if not audio:
        print(f"[FAIL] Synthesis returned None after {t_elapsed:.2f}s (worker may be loading or offline).")
        return False

    audio_size_kb = len(audio) / 1024
    print(f"[SUCCESS] Audio generated in {t_elapsed:.2f}s! Size: {audio_size_kb:.1f} KB")

    out_file = SERVER_DIR / "data" / "benchmark_kurisu_tsundere.wav"
    with open(out_file, "wb") as f:
        f.write(audio)
    print(f"[SAVED] {out_file}")

    # Utterance 2: Multi-phrase test with natural pauses
    test_phrase_2 = "O que você está olhando com essa cara presunçosa?! Eu sou uma pesquisadora em Viktor Chondria, não tire conclusões precipitadas!"
    cleaned_2 = clean_speech_text(test_phrase_2)
    print(f"\n[Test 2] Multi-phrase text: \"{test_phrase_2}\"")
    t0_2 = time.time()
    audio2 = await QwenTTSManager.synthesize(
        text=cleaned_2,
        emotion="tsundere"
    )
    t2_elapsed = time.time() - t0_2

    if not audio2:
        print(f"[FAIL] Utterance 2 returned None after {t2_elapsed:.2f}s.")
        return False

    print(f"[SUCCESS] Utterance 2 generated in {t2_elapsed:.2f}s! Size: {len(audio2)/1024:.1f} KB")
    out_file2 = SERVER_DIR / "data" / "benchmark_kurisu_multiphrase.wav"
    with open(out_file2, "wb") as f:
        f.write(audio2)
    print(f"[SAVED] {out_file2}")

    print("\n" + "=" * 60)
    print(" [ALL BENCHMARKS COMPLETED SUCCESSFULLY]")
    print("=" * 60)
    return True


if __name__ == "__main__":
    success = asyncio.run(run_benchmark())
    if not success:
        sys.exit(1)
