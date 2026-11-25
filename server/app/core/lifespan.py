import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI

from app.core.config import PERSONAS_DIR, TRAINING_DIR, SERVER_DIR
from app.db.memory_store import memory_store
from app.services.cognitive_worker import cognitive_worker
from app.services.llm.background import aclose_background_client
from app.services.mcp.mcp_client import mcp_registry

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- Startup ---
    canonical_count = 0
    kurisu_file = PERSONAS_DIR / "kurisu.json"
    if kurisu_file.exists():
        try:
            with open(kurisu_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                memories = data.get("memories", [])
                if memories:
                    memory_store.seed_canonical_memories(memories)
                    canonical_count = len(memories)
        except Exception as e:
            print(f"[Amadeus Core] Error seeding memories: {e}")

    # Seed fine-tuning exemplars for Dynamic Few-Shot prompting
    ft_candidates = [
        TRAINING_DIR / "kurisu_finetuning_dataset_enhanced.jsonl",
        TRAINING_DIR / "kurisu_finetuning_dataset.jsonl",
        SERVER_DIR / "kurisu_finetuning_pack" / "kurisu_finetuning_dataset_enhanced.jsonl",
        SERVER_DIR / "kurisu_finetuning_pack" / "kurisu_finetuning_dataset.jsonl",
    ]
    ft_pack = next((p for p in ft_candidates if p.exists()), None)
    if ft_pack:
        try:
            memory_store.seed_exemplars(ft_pack)
        except Exception as e:
            print(f"[Amadeus Core] Error seeding fine-tuning exemplars: {e}")

    try:
        all_mems = memory_store.get_all_memories()
        learned_count = sum(1 for m in all_mems if m.get("source") != "canonical")
        exemplar_count = memory_store.exemplars_collection.count()
        print(
            f"[Amadeus Core] ChromaDB + SQLite ready: {canonical_count} canonical + "
            f"{learned_count} learned memories | {exemplar_count} dialog exemplars."
        )
    except Exception as e:
        print(f"[Amadeus Core] Startup status check error: {e}")

    # Prime ONNX embeddings in the background so Turn 1 does not stall waiting for cold model load
    async def _bg_warmup() -> None:
        try:
            ms = await asyncio.to_thread(memory_store.warmup_embeddings)
            print(f"[Amadeus Core] ChromaDB ONNX embeddings warm in {ms} ms.")
        except Exception as e:
            print(f"[Amadeus Core] Embedding warmup skipped: {e}")

    warmup_task = asyncio.create_task(_bg_warmup())
    cognitive_worker.start()
    await mcp_registry.startup()

    yield

    # --- Shutdown ---
    if not warmup_task.done():
        warmup_task.cancel()
    try:
        from app.services.llm.orchestrator import orchestrator
        from app.services.qwen_tts.qwen_manager import QwenTTSManager
        from app.services.rvc.rvc_manager import RVCManager
        await mcp_registry.shutdown()
        await cognitive_worker.stop()
        await aclose_background_client()
        await orchestrator.aclose()
        await QwenTTSManager.shutdown()
        RVCManager.shutdown()
    except Exception as e:
        print(f"[Amadeus Core] Worker shutdown note: {e}")
    print("[Amadeus Core] Shutting down cleanly.")
