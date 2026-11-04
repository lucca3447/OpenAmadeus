import json
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI

from app.core.config import PERSONAS_DIR, TRAINING_DIR, SERVER_DIR
from app.db.memory_store import memory_store

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

    yield

    # --- Shutdown ---
    print("[Amadeus Core] Shutting down cleanly.")
