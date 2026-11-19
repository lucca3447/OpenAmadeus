import os
import sys
import time
import asyncio
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

from app.services.qwen_tts.qwen_manager import QwenTTSManager

async def test_synthesis():
    print("[Test] Testing QwenTTSManager end-to-end synthesis...")
    t0 = time.time()
    
    # Utterance 1: Worker spawn & cold load
    print("\n[Utterance 1] Synthesizing first audio (worker spawn + GPU load)...")
    audio1 = await QwenTTSManager.synthesize(
        text="Não me olhe desse jeito, Okabe!",
        emotion="tsundere"
    )
    t1 = time.time() - t0
    
    if audio1 is None:
        print(f"[FAIL] Audio 1 returned None after {t1:.1f}s.")
        return False
    
    print(f"[SUCCESS] Audio 1 received! Size: {len(audio1)} bytes ({t1:.1f}s)")
    test_out = SERVER_DIR / "data" / "e2e_qwen_test1.wav"
    with open(test_out, "wb") as f:
        f.write(audio1)
    print(f"Saved: {test_out}")
    
    # Utterance 2: Warm resident GPU test
    print("\n[Utterance 2] Synthesizing second audio (warm GPU resident)...")
    t0_warm = time.time()
    audio2 = await QwenTTSManager.synthesize(
        text="Eu só estava checando se o laboratório estava em ordem, idiota.",
        emotion="tsundere"
    )
    t2 = time.time() - t0_warm
    
    if audio2 is None:
        print(f"[FAIL] Audio 2 returned None after {t2:.1f}s.")
        return False
        
    print(f"[SUCCESS] Audio 2 received! Size: {len(audio2)} bytes ({t2:.2f}s) - Warm resident inference!")
    test_out2 = SERVER_DIR / "data" / "e2e_qwen_test2.wav"
    with open(test_out2, "wb") as f:
        f.write(audio2)
    print(f"Saved: {test_out2}")
    return True

if __name__ == "__main__":
    success = asyncio.run(test_synthesis())
    if not success:
        sys.exit(1)
    print("\n[ALL TESTS PASSED] Kurisu Qwen3-TTS is fully operational!")
