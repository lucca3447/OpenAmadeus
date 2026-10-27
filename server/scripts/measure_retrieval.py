"""
Phase 0 & Phase 3 Calibration & Embedding Spike Script:
Measures real ChromaDB distances across:
1. Relevant queries (canonical + learned) vs. expected memory ID
2. Casual greetings (should NOT trigger memories)
3. Out-of-domain queries (should NOT trigger memories)
4. Exemplar queries (relevant vs. greetings)
5. Semantic upsert pairs (same fact updated vs. distinct facts)

Pass `--compare-multilingual` to benchmark `all-MiniLM-L6-v2` (Chroma ONNX default)
against `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (cosine)
including boot latency, query latency, RAM delta, hit rate, and separation margin.

Runs in an isolated temporary directory so live server/data is never touched.
"""
import json
import os
import sys
import time
import tempfile
import tracemalloc
from pathlib import Path
from typing import Any, List, Optional

SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

LABELED_MEMORIES = [
    # (category_type, query, expected_id)
    ("relevant", "Como funciona a sua pesquisa de digitalizar memórias e sinapses no Amadeus?", "mem_01"),
    ("relevant", "Como é trabalhar com a Maho Hiyajo e o Professor Leskinen na universidade?", "mem_02"),
    ("relevant", "Você costuma entrar no fórum @channel e responder Nullpo?", "mem_03"),
    ("relevant", "Como era a relação com o seu pai, o Doutor Nakabachi?", "mem_04"),
    ("relevant", "Qual é a sua bebida favorita para tomar no laboratório?", "mem_07"),
    ("relevant", "Por que você guarda aquele garfo e colher de aniversário?", "mem_08"),
    ("relevant", "O que é o computador retrô IBN 5100 e para que serve?", "mem_19"),
    ("relevant", "O que é o fenômeno Reading Steiner que o Okabe tem?", "mem_20"),
    ("relevant", "Para que servem os tubos Nixie do Medidor de Divergência e a barreira de 1%?", "mem_25"),
    ("relevant", "Descreva a sua aparência física, cor do cabelo, olhos e roupas.", "mem_36"),
    ("relevant", "Onde o operador mora e o que ele estuda?", "LEARNED_1"),
    ("relevant", "Qual é o projeto que o operador está programando?", "LEARNED_2"),
    # Greetings (expected_id = None)
    ("greeting", "Oi Kurisu!", None),
    ("greeting", "Bom dia, tudo bem com você?", None),
    ("greeting", "Boa noite! Até amanhã.", None),
    ("greeting", "Olá, está me ouvindo?", None),
    ("greeting", "E aí, tranquila?", None),
    # Out-of-domain chitchat (expected_id = None)
    ("ood", "Quanto é 25 multiplicado por 4?", None),
    ("ood", "Vai chover hoje à tarde?", None),
    ("ood", "Qual a capital da Austrália?", None),
    ("ood", "Me explica como funciona um motor a combustão.", None),
    ("ood", "Qual o melhor tempero para fazer arroz?", None),
]

EXEMPLAR_QUERIES = [
    ("relevant_ex", "Christina, minha assistente!"),
    ("relevant_ex", "Você é uma tsundere?"),
    ("relevant_ex", "A viagem no tempo existe de verdade?"),
    ("relevant_ex", "O que você acha da Mayuri?"),
    ("relevant_ex", "Fala alguma coisa romântica para mim."),
    ("irrelevant_ex", "Oi!"),
    ("irrelevant_ex", "Boa tarde."),
    ("irrelevant_ex", "Quanto é dois mais dois?"),
    ("irrelevant_ex", "Qual a previsão do tempo?"),
    ("irrelevant_ex", "Testando o microfone, um dois três."),
]

UPSERT_PAIRS = [
    # (kind, first_title, first_content, second_title, second_content)
    ("same_topic", "Curso do Operador", "Estuda engenharia de software na faculdade.", "Faculdade do Operador", "Troquei de curso e agora estudo física teórica na faculdade."),
    ("same_topic", "Cidade do Operador", "O operador mora em São Paulo.", "Moradia do Operador", "O operador mudou-se e agora mora em Campinas."),
    ("same_topic", "Idade do Operador", "O operador tem 19 anos de idade.", "Aniversário e Idade", "O operador fez aniversário e agora tem 20 anos de idade."),
    ("different_topic", "Curso do Operador", "Estuda engenharia de software na faculdade.", "Animal de Estimação", "Tem um gato preto chamado Schrödinger."),
    ("different_topic", "Cidade do Operador", "O operador mora em São Paulo.", "Comida Favorita", "Adora comer lámen apimentado no jantar."),
    ("different_topic", "Idade do Operador", "O operador tem 19 anos de idade.", "Instrumento Musical", "Toca violão clássico desde criança."),
]


def _build_multilingual_ef():
    import torch
    from transformers import AutoTokenizer, AutoModel
    from chromadb.api.types import EmbeddingFunction, Documents, Embeddings

    model_name = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModel.from_pretrained(model_name)
    model.eval()

    class MultilingualTorchEF(EmbeddingFunction[Documents]):
        def __call__(self, input: Documents) -> Embeddings:
            encoded = tokenizer(list(input), padding=True, truncation=True, max_length=256, return_tensors="pt")
            with torch.no_grad():
                out = model(**encoded)
            token_embeddings = out.last_hidden_state
            mask = encoded["attention_mask"].unsqueeze(-1).expand(token_embeddings.size()).float()
            summed = torch.sum(token_embeddings * mask, 1)
            counts = torch.clamp(mask.sum(1), min=1e-9)
            pooled = summed / counts
            normed = torch.nn.functional.normalize(pooled, p=2, dim=1)
            return normed.cpu().numpy().tolist()

    return MultilingualTorchEF()


def run_benchmark(label: str, embedding_fn: Optional[Any] = None, space: str = "l2") -> dict:
    import chromadb

    t0 = time.perf_counter()
    tracemalloc.start()

    with tempfile.TemporaryDirectory(prefix="amadeus_spike_", ignore_cleanup_errors=True) as tmp_dir:
        client = chromadb.PersistentClient(path=tmp_dir)
        col_kwargs: dict = {"name": "cortex_bench", "metadata": {"hnsw:space": space}}
        ex_kwargs: dict = {"name": "exemplars_bench", "metadata": {"hnsw:space": space}}
        if embedding_fn is not None:
            col_kwargs["embedding_function"] = embedding_fn
            ex_kwargs["embedding_function"] = embedding_fn

        col = client.create_collection(**col_kwargs)
        ex_col = client.create_collection(**ex_kwargs)

        kurisu_path = SERVER_DIR / "personas" / "kurisu.json"
        with open(kurisu_path, "r", encoding="utf-8") as f:
            persona_data = json.load(f)

        ids, docs, metas = [], [], []
        for mem in persona_data["memories"]:
            doc_text = f"{mem['title']}: {mem['content']}"
            kw = " ".join(mem.get("triggerKeywords", []))
            full_text = f"{doc_text} (keywords: {kw})" if kw else doc_text
            ids.append(mem["id"])
            docs.append(full_text)
            metas.append({"source": mem.get("source", "canonical"), "title": mem["title"], "raw_content": mem["content"]})

        ids.extend(["LEARNED_1", "LEARNED_2"])
        docs.extend([
            "Perfil de João Lucca: Mora em São Paulo e estuda engenharia de software.",
            "Projeto Atual: Está programando o sistema OpenAmadeus em Python e React.",
        ])
        metas.extend([
            {"source": "learned", "title": "Perfil de João Lucca", "raw_content": "Mora em São Paulo e estuda engenharia de software."},
            {"source": "learned", "title": "Projeto Atual", "raw_content": "Está programando o sistema OpenAmadeus em Python e React."},
        ])
        col.upsert(ids=ids, documents=docs, metadatas=metas)

        ex_path = SERVER_DIR / "training" / "kurisu_finetuning_dataset_enhanced.jsonl"
        ex_ids, ex_docs, ex_metas = [], [], []
        with open(ex_path, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                if not line.strip():
                    continue
                data = json.loads(line)
                msgs = data.get("messages", [])
                u = next((m["content"] for m in msgs if m["role"] == "user"), "")
                a = next((m["content"] for m in msgs if m["role"] == "assistant"), "")
                if u and a:
                    ex_ids.append(f"ex_{idx}")
                    ex_docs.append(u)
                    ex_metas.append({"user": u, "assistant": a})
        ex_col.upsert(ids=ex_ids, documents=ex_docs, metadatas=ex_metas)

        seed_sec = time.perf_counter() - t0

        hits = 0
        total_rel = 0
        rel_dists: List[float] = []
        noise_dists: List[float] = []
        q_start = time.perf_counter()

        for qtype, query, expected in LABELED_MEMORIES:
            k_res = col.query(query_texts=[query], n_results=2, where={"source": {"$ne": "learned"}})
            l_res = col.query(query_texts=[query], n_results=2, where={"source": "learned"})
            cand = []
            for r in (k_res, l_res):
                if r and r.get("ids") and r["ids"][0]:
                    for i, cid in enumerate(r["ids"][0]):
                        cand.append((cid, float(r["distances"][0][i])))
            cand.sort(key=lambda x: x[1])
            top1_id, d1 = cand[0] if cand else ("-", 999.0)
            if qtype == "relevant":
                total_rel += 1
                if top1_id == expected:
                    hits += 1
                rel_dists.append(d1)
            else:
                noise_dists.append(d1)

        avg_query_ms = ((time.perf_counter() - q_start) / len(LABELED_MEMORIES)) * 1000.0

        ex_rel, ex_noise = [], []
        for etype, query in EXEMPLAR_QUERIES:
            r = ex_col.query(query_texts=[query], n_results=1)
            d = float(r["distances"][0][0])
            (ex_rel if etype == "relevant_ex" else ex_noise).append(d)

        same_dists, diff_dists = [], []
        for idx, (ptype, t1, c1, t2, c2) in enumerate(UPSERT_PAIRS):
            tc_kwargs: dict = {"name": f"up_{idx}", "metadata": {"hnsw:space": space}}
            if embedding_fn is not None:
                tc_kwargs["embedding_function"] = embedding_fn
            tc = client.create_collection(**tc_kwargs)
            tc.upsert(ids=["m1"], documents=[f"{t1}: {c1}"])
            q = tc.query(query_texts=[f"{t2}: {c2}"], n_results=1)
            d = float(q["distances"][0][0])
            (same_dists if ptype == "same_topic" else diff_dists).append(d)

        _, peak_bytes = tracemalloc.get_traced_memory()
        tracemalloc.stop()

        return {
            "label": label,
            "space": space,
            "seed_sec": seed_sec,
            "avg_query_ms": avg_query_ms,
            "peak_ram_mb": peak_bytes / (1024 * 1024),
            "hits": f"{hits}/{total_rel}",
            "rel_max": max(rel_dists),
            "noise_min": min(noise_dists),
            "mem_gap": min(noise_dists) - max(rel_dists),
            "ex_rel_max": max(ex_rel),
            "ex_noise_min": min(ex_noise),
            "ex_gap": min(ex_noise) - max(ex_rel),
            "upsert_same_max": max(same_dists),
            "upsert_diff_min": min(diff_dists),
            "upsert_gap": min(diff_dists) - max(same_dists),
        }


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    if "--compare-multilingual" in sys.argv:
        print("Running Phase 3 Embedding Spike Comparison...\n")
        base_stats = run_benchmark("all-MiniLM-L6-v2 (Default ONNX)", embedding_fn=None, space="l2")
        t_load0 = time.perf_counter()
        multi_ef = _build_multilingual_ef()
        load_sec = time.perf_counter() - t_load0
        multi_stats = run_benchmark("paraphrase-multilingual-MiniLM-L12-v2 (Torch)", embedding_fn=multi_ef, space="cosine")
        multi_stats["seed_sec"] += load_sec

        print("| Metric | all-MiniLM-L6-v2 (ONNX, L2) | paraphrase-multilingual-MiniLM-L12-v2 (Torch, Cosine) |")
        print("|---|---|---|")
        for k, title in [
            ("hits", "Top-1 Hit Rate (PT-BR)"),
            ("seed_sec", "Boot + Model Load + Seed (s)"),
            ("avg_query_ms", "Avg Query Latency (ms)"),
            ("peak_ram_mb", "Python Traced Peak RAM (MB)"),
            ("rel_max", "Memory Relevant Max Dist"),
            ("noise_min", "Memory Noise Min Dist"),
            ("mem_gap", "Memory Separation Margin (NoiseMin - RelMax)"),
            ("ex_rel_max", "Exemplar Relevant Max Dist"),
            ("ex_noise_min", "Exemplar Noise Min Dist"),
            ("ex_gap", "Exemplar Separation Margin"),
            ("upsert_same_max", "Upsert Same-Topic Max Dist"),
            ("upsert_diff_min", "Upsert Diff-Topic Min Dist"),
            ("upsert_gap", "Upsert Separation Margin"),
        ]:
            v1 = base_stats[k]
            v2 = multi_stats[k]
            f1 = f"{v1:.4f}" if isinstance(v1, float) else str(v1)
            f2 = f"{v2:.4f}" if isinstance(v2, float) else str(v2)
            print(f"| {title} | {f1} | {f2} |")
        return

    with tempfile.TemporaryDirectory(prefix="amadeus_measure_", ignore_cleanup_errors=True) as tmp_dir:
        os.environ["AMADEUS_DATA_DIR"] = tmp_dir

        from app.db.memory_store import MemoryStore

        store = MemoryStore()

        kurisu_path = SERVER_DIR / "personas" / "kurisu.json"
        with open(kurisu_path, "r", encoding="utf-8") as f:
            persona_data = json.load(f)
        store.seed_canonical_memories(persona_data["memories"])

        m1 = store.add_memory("user", "Perfil de João Lucca", "Mora em São Paulo e estuda engenharia de software.", "Simpatia", "learned")
        m2 = store.add_memory("user", "Projeto Atual", "Está programando o sistema OpenAmadeus em Python e React.", "Curiosidade", "learned")
        learned_map = {"LEARNED_1": m1["id"], "LEARNED_2": m2["id"]}

        ex_path = SERVER_DIR / "training" / "kurisu_finetuning_dataset_enhanced.jsonl"
        store.seed_exemplars(ex_path)

        print("# 1. Memory Retrieval Distances (Chroma default L2 squared)")
        print("| Type | Query | Top-1 ID | Expected | Hit | Top-1 Dist | Top-2 Dist |")
        print("|---|---|---|---|---|---|---|")

        rel_dists = []
        noise_dists = []

        for qtype, query, expected in LABELED_MEMORIES:
            exp_id = learned_map.get(expected, expected)
            res = store.search_memories(query, max_distance=999.0, n_results=2)
            top1 = res[0] if res else {"id": "-", "distance": 999.0}
            top2 = res[1] if len(res) > 1 else {"id": "-", "distance": 999.0}
            hit = "YES" if (exp_id and top1["id"] == exp_id) else ("-" if exp_id is None else f"NO (got {top1['id']})")
            d1 = float(top1["distance"])
            d2 = float(top2["distance"])
            if qtype == "relevant":
                rel_dists.append(d1)
            else:
                noise_dists.append(d1)
            print(f"| {qtype} | {query} | {top1['id']} | {exp_id or '-'} | {hit} | {d1:.4f} | {d2:.4f} |")

        print("\n## Memory Summary")
        print(f"- Relevant top-1 distances: min={min(rel_dists):.4f}, median={sorted(rel_dists)[len(rel_dists)//2]:.4f}, max={max(rel_dists):.4f}")
        print(f"- Greeting/OOD top-1 distances: min={min(noise_dists):.4f}, median={sorted(noise_dists)[len(noise_dists)//2]:.4f}, max={max(noise_dists):.4f}")

        print("\n# 2. Exemplar Retrieval Distances")
        print("| Type | Query | Top-1 Dist | Matched User Turn |")
        print("|---|---|---|---|")
        ex_rel = []
        ex_noise = []
        for etype, query in EXEMPLAR_QUERIES:
            raw = store.exemplars_collection.query(query_texts=[query], n_results=1)
            d1 = float(raw["distances"][0][0])
            matched_u = raw["metadatas"][0][0].get("user", "")
            if etype == "relevant_ex":
                ex_rel.append(d1)
            else:
                ex_noise.append(d1)
            print(f"| {etype} | {query} | {d1:.4f} | {matched_u[:50]} |")

        print("\n## Exemplar Summary")
        print(f"- Relevant exemplar distances: min={min(ex_rel):.4f}, max={max(ex_rel):.4f}")
        print(f"- Irrelevant exemplar distances: min={min(ex_noise):.4f}, max={max(ex_noise):.4f}")

        print("\n# 3. Upsert Pair Distances (learned memory updates)")
        print("| Pair Type | Existing Fact | New Fact | Distance |")
        print("|---|---|---|---|")
        same_dists = []
        diff_dists = []
        for ptype, t1, c1, t2, c2 in UPSERT_PAIRS:
            tmp_col = store.chroma_client.create_collection(name=f"upsert_probe_{len(same_dists)+len(diff_dists)}")
            tmp_col.upsert(ids=["m1"], documents=[f"{t1}: {c1}"])
            q = tmp_col.query(query_texts=[f"{t2}: {c2}"], n_results=1)
            dist = float(q["distances"][0][0])
            if ptype == "same_topic":
                same_dists.append(dist)
            else:
                diff_dists.append(dist)
            print(f"| {ptype} | {t1}: {c1} | {t2}: {c2} | {dist:.4f} |")

        print("\n## Upsert Summary")
        print(f"- Same-topic update distances: min={min(same_dists):.4f}, max={max(same_dists):.4f}")
        print(f"- Different-topic distances: min={min(diff_dists):.4f}, max={max(diff_dists):.4f}")


if __name__ == "__main__":
    main()
