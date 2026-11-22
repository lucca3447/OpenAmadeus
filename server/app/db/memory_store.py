from collections import OrderedDict
import hashlib
import os
import re
import json
import sqlite3
import threading
import time
from pathlib import Path
from contextlib import contextmanager
from typing import List, Dict, Any, Optional

import chromadb
import numpy as np
from chromadb.utils.embedding_functions import DefaultEmbeddingFunction
try:
    from chromadb.utils.embedding_functions.onnx_mini_lm_l6_v2 import ONNXMiniLM_L6_V2
except Exception:  # pragma: no cover - fallback if internal module layout changes
    ONNXMiniLM_L6_V2 = None
from app.core.config import (
    SQLITE_PATH,
    CHROMA_DIR,
    MEMORY_MAX_DISTANCE,
    EXEMPLAR_MAX_DISTANCE,
    UPSERT_MAX_DISTANCE,
)


def _sanitize_field(value: Optional[str], max_len: int) -> str:
    clean = re.sub(r"\s+", " ", (value or "").replace("\r", " ").replace("\n", " ")).strip()
    return clean[:max_len]


class _PersistentDefaultEF(DefaultEmbeddingFunction):
    """Keeps one ONNXMiniLM_L6_V2 session warm and avoids fixed-256 padding on single queries."""

    def __init__(self) -> None:
        super().__init__()
        self._onnx = ONNXMiniLM_L6_V2() if ONNXMiniLM_L6_V2 is not None else None
        self._init_lock = threading.Lock()
        self._ready = False
        self._single_tokenizer: Optional[Any] = None

    def _ensure_ready(self) -> None:
        if self._ready or self._onnx is None:
            return
        with self._init_lock:
            if self._ready:
                return
            self._onnx._download_model_if_not_exists()
            _ = self._onnx.model
            try:
                tok_path = os.path.join(
                    self._onnx.DOWNLOAD_PATH,
                    self._onnx.EXTRACTED_FOLDER_NAME,
                    "tokenizer.json",
                )
                tok = self._onnx.Tokenizer.from_file(tok_path)
                tok.enable_truncation(max_length=256)
                tok.no_padding()
                self._single_tokenizer = tok
            except Exception:
                self._single_tokenizer = None
            self._ready = True

    def __call__(self, input):
        if self._onnx is None:
            return super().__call__(input)
        self._ensure_ready()
        if len(input) == 1 and self._single_tokenizer is not None:
            enc = self._single_tokenizer.encode(input[0])
            if enc.ids:
                input_ids = np.array([enc.ids], dtype=np.int64)
                attention_mask = np.array([enc.attention_mask], dtype=np.int64)
                onnx_input = {
                    "input_ids": input_ids,
                    "attention_mask": attention_mask,
                    "token_type_ids": np.zeros_like(input_ids),
                }
                last_hidden = self._onnx.model.run(None, onnx_input)[0]
                mask_exp = np.broadcast_to(np.expand_dims(attention_mask, -1), last_hidden.shape)
                pooled = np.sum(last_hidden * mask_exp, 1) / np.clip(mask_exp.sum(1), a_min=1e-9, a_max=None)
                return self._onnx._normalize(pooled).astype(np.float32)
        return self._onnx(input)


class MemoryStore:
    def __init__(
        self,
        sqlite_path: Path = SQLITE_PATH,
        chroma_dir: Path = CHROMA_DIR,
        embedding_fn: Optional[Any] = None,
    ):
        self.sqlite_path = sqlite_path
        self.chroma_dir = chroma_dir
        self.embedding_fn = embedding_fn if embedding_fn is not None else _PersistentDefaultEF()
        self._canonical_keywords: Dict[str, List[str]] = {}
        self._local = threading.local()
        self._embed_lock = threading.Lock()
        self._embed_cache: OrderedDict[str, List[float]] = OrderedDict()
        self._init_sqlite()
        self._init_chroma()

    def _embed_query(self, query: str) -> Optional[List[float]]:
        """Computes the ChromaDB query embedding once and reuses it across memory + exemplar queries."""
        key = (query or "").strip()
        if not key or self.embedding_fn is None:
            return None
        with self._embed_lock:
            cached = self._embed_cache.get(key)
            if cached is not None:
                self._embed_cache.move_to_end(key)
                return cached
        try:
            raw = self.embedding_fn([key])
            if not raw:
                return None
            vec = raw[0]
            vec_list = vec.tolist() if hasattr(vec, "tolist") else list(vec)
        except Exception:
            return None
        with self._embed_lock:
            self._embed_cache[key] = vec_list
            self._embed_cache.move_to_end(key)
            if len(self._embed_cache) > 32:
                self._embed_cache.popitem(last=False)
        return vec_list

    def warmup_embeddings(self) -> float:
        """Primes the ONNX embedding model at server boot so Turn 1 avoids the cold-load stall."""
        t0 = time.perf_counter()
        self._embed_query("amadeus warmup")
        return round((time.perf_counter() - t0) * 1000.0, 1)

    @contextmanager
    def connection_scope(self):
        """Reuses a single SQLite connection on the current thread across a turn (reentrant)."""
        existing = getattr(self._local, "conn", None)
        created_here = existing is None
        if created_here:
            conn = sqlite3.connect(self.sqlite_path)
            conn.execute("PRAGMA busy_timeout=5000;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            self._local.conn = conn
        else:
            conn = existing
        try:
            yield conn
        finally:
            if created_here:
                self._local.conn = None
                conn.close()

    @contextmanager
    def _conn(self):
        scoped = getattr(self._local, "conn", None)
        if scoped is not None:
            prev_factory = scoped.row_factory
            try:
                with scoped:
                    yield scoped
            finally:
                scoped.row_factory = prev_factory
            return

        conn = sqlite3.connect(self.sqlite_path)
        conn.execute("PRAGMA busy_timeout=5000;")
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def _init_sqlite(self):
        with self._conn() as conn:
            cursor = conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    started_at REAL,
                    ended_at REAL,
                    summary TEXT,
                    context_summary TEXT
                )
            """)
            # Ensure context_summary column exists on pre-existing databases
            cursor.execute("PRAGMA table_info(sessions)")
            cols = {row[1] for row in cursor.fetchall()}
            if "context_summary" not in cols:
                cursor.execute("ALTER TABLE sessions ADD COLUMN context_summary TEXT")

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT,
                    sender TEXT,
                    content TEXT,
                    emotion TEXT,
                    recalled_memories TEXT,
                    timestamp REAL,
                    FOREIGN KEY (session_id) REFERENCES sessions (id)
                )
            """)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    category TEXT,
                    title TEXT,
                    content TEXT,
                    emotional_weight TEXT,
                    source TEXT,
                    created_at REAL
                )
            """)
            conn.commit()

    def _init_chroma(self):
        # Persistent ChromaDB client saving to local directory
        self.chroma_client = chromadb.PersistentClient(path=str(self.chroma_dir))
        self.collection = self.chroma_client.get_or_create_collection(
            name="amadeus_cortex",
            embedding_function=self.embedding_fn,
            metadata={"description": "Makise Kurisu digitized memories and user-learned facts"}
        )
        self.exemplars_collection = self.chroma_client.get_or_create_collection(
            name="kurisu_exemplars",
            embedding_function=self.embedding_fn,
            metadata={"description": "Fine-tuning dialogue exemplars for Dynamic Few-Shot prompting"}
        )

    def seed_exemplars(self, dataset_path: Path):
        """
        Seeds dialogue exemplars from the fine-tuning dataset into ChromaDB.
        Automatically upgrades legacy records that lack 'pose:' directives or 'lang' metadata.
        """
        if not dataset_path.exists():
            return

        raw_bytes = dataset_path.read_bytes()
        dataset_hash = hashlib.sha256(raw_bytes).hexdigest()[:12]
        lines = [line.strip() for line in raw_bytes.decode("utf-8").splitlines() if line.strip()]
        total_lines = len(lines)

        count = self.exemplars_collection.count()
        if count >= total_lines and count > 0:
            sample = self.exemplars_collection.get(ids=["ex_1"], include=["metadatas"]) or {}
            sample_metas = sample.get("metadatas") or []
            first_meta = sample_metas[0] if sample_metas else {}
            if first_meta.get("dataset_hash") == dataset_hash and first_meta.get("lang"):
                return

        ids = []
        documents = []
        metadatas = []

        for idx, line in enumerate(lines):
            try:
                data = json.loads(line)
                msgs = data.get("messages", [])
                user_text = next((m["content"] for m in msgs if m["role"] == "user"), "")
                asst_text = next((m["content"] for m in msgs if m["role"] == "assistant"), "")
                lang = (data.get("lang") or "pt").strip().lower()
                if user_text and asst_text:
                    ex_id = f"ex_{idx}"
                    ids.append(ex_id)
                    documents.append(user_text)
                    metadatas.append({
                        "user": user_text,
                        "assistant": asst_text,
                        "lang": lang,
                        "dataset_hash": dataset_hash,
                    })
            except Exception as e:
                print(f"[Amadeus Core] Error parsing exemplar line {idx}: {e}")

        if ids:
            self.exemplars_collection.upsert(
                ids=ids,
                documents=documents,
                metadatas=metadatas
            )
            print(f"[Amadeus Core] ChromaDB seeded with {len(ids)} Kurisu fine-tuning exemplars.")

    def search_exemplars(
        self,
        query: str,
        n_results: int = 2,
        max_distance: float = EXEMPLAR_MAX_DISTANCE,
        lang: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        """
        Retrieves the most semantically relevant dialog turns from the fine-tuning dataset
        within max_distance, optionally filtered by language (PT/EN/JA for v0.3+).
        """
        count = self.exemplars_collection.count()
        if count == 0:
            return []

        limit = min(n_results, count)
        query_vec = self._embed_query(query)
        query_kwargs: Dict[str, Any] = (
            {"query_embeddings": [query_vec], "n_results": limit}
            if query_vec is not None
            else {"query_texts": [query], "n_results": limit}
        )
        if lang:
            query_kwargs["where"] = {"lang": lang.strip().lower()[:2]}

        try:
            results = self.exemplars_collection.query(**query_kwargs)
        except Exception:
            fallback_kwargs: Dict[str, Any] = (
                {"query_embeddings": [query_vec], "n_results": limit}
                if query_vec is not None
                else {"query_texts": [query], "n_results": limit}
            )
            results = self.exemplars_collection.query(**fallback_kwargs)

        matched: List[Dict[str, str]] = []
        if results and results.get("metadatas") and len(results["metadatas"]) > 0:
            metas = results["metadatas"][0]
            distances = results["distances"][0] if results.get("distances") else []
            for i, meta in enumerate(metas):
                dist = distances[i] if i < len(distances) else 999.0
                if dist <= max_distance:
                    matched.append({
                        "user": meta.get("user", ""),
                        "assistant": meta.get("assistant", ""),
                        "lang": meta.get("lang", "pt"),
                    })
        return matched

    def rebuild_index(self, canonical_memories: Optional[List[Dict[str, Any]]] = None) -> int:
        """
        Rebuilds the ChromaDB memory collection from SQLite (canonical, learned, and custom).
        """
        if canonical_memories:
            for mem in canonical_memories:
                if mem.get("id") and mem.get("triggerKeywords"):
                    self._canonical_keywords[mem["id"]] = mem["triggerKeywords"]

        with self._conn() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT id, category, title, content, emotional_weight, source FROM memories")
            rows = cursor.fetchall()

        existing_ids = (self.collection.get(include=[]) or {}).get("ids") or []
        if existing_ids:
            self.collection.delete(ids=existing_ids)

        if not rows:
            return 0

        ids = []
        documents = []
        metadatas = []
        for row in rows:
            mem_id = row["id"]
            title = row["title"]
            content = row["content"]
            doc_text = f"{title}: {content}"
            kw_list = self._canonical_keywords.get(mem_id, [])
            keywords = " ".join(kw_list)
            full_text = f"{doc_text} (keywords: {keywords})" if keywords else doc_text

            ids.append(mem_id)
            documents.append(full_text)
            metadatas.append({
                "title": title,
                "category": row["category"] or "biography",
                "emotional_weight": row["emotional_weight"] or "Factual",
                "source": row["source"] or "canonical",
                "raw_content": content
            })

        self.collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
        return len(ids)

    def seed_canonical_memories(self, memories: List[Dict[str, Any]]):
        """
        Seeds canonical memories into SQLite if missing, and synchronizes ChromaDB
        via rebuild_index() whenever vector count diverges from SQLite count.
        """
        for mem in memories:
            if mem.get("id") and mem.get("triggerKeywords"):
                self._canonical_keywords[mem["id"]] = mem["triggerKeywords"]

        changed_memories: List[Dict[str, Any]] = []
        with self._conn() as conn:
            cursor = conn.cursor()
            for mem in memories:
                mem_id = mem["id"]
                emo_weight = mem.get("emotionalWeight", "Factual")
                cursor.execute("SELECT title, content, emotional_weight FROM memories WHERE id = ?", (mem_id,))
                row = cursor.fetchone()
                if not row:
                    cursor.execute(
                        "INSERT INTO memories (id, category, title, content, emotional_weight, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            mem_id,
                            mem.get("category", "biography"),
                            mem["title"],
                            mem["content"],
                            emo_weight,
                            mem.get("source", "canonical"),
                            time.time()
                        )
                    )
                    changed_memories.append(mem)
                elif (row[0], row[1], row[2]) != (mem["title"], mem["content"], emo_weight):
                    cursor.execute(
                        "UPDATE memories SET title = ?, content = ?, emotional_weight = ? WHERE id = ?",
                        (mem["title"], mem["content"], emo_weight, mem_id)
                    )
                    changed_memories.append(mem)
            conn.commit()
            cursor.execute("SELECT COUNT(*) FROM memories")
            sqlite_count = cursor.fetchone()[0]

        if self.collection.count() != sqlite_count:
            self.rebuild_index(memories)
        elif changed_memories:
            ids = [m["id"] for m in changed_memories]
            documents = [
                f"{m['title']}: {m['content']} (keywords: {' '.join(self._canonical_keywords.get(m['id'], []))})"
                if self._canonical_keywords.get(m["id"])
                else f"{m['title']}: {m['content']}"
                for m in changed_memories
            ]
            metadatas = [
                {
                    "title": m["title"],
                    "category": m.get("category", "biography"),
                    "emotional_weight": m.get("emotionalWeight", "Factual"),
                    "source": m.get("source", "canonical"),
                    "raw_content": m["content"],
                }
                for m in changed_memories
            ]
            self.collection.upsert(ids=ids, documents=documents, metadatas=metadatas)

    def _query_memory_group(
        self,
        query: str,
        where_filter: Dict[str, Any],
        group_limit: int,
        max_distance: float,
        query_embedding: Optional[List[float]] = None,
    ) -> List[Dict[str, Any]]:
        if group_limit <= 0:
            return []

        q_kwargs: Dict[str, Any] = {
            "n_results": group_limit,
            "where": where_filter,
        }
        if query_embedding is not None:
            q_kwargs["query_embeddings"] = [query_embedding]
        else:
            q_kwargs["query_texts"] = [query]
        try:
            results = self.collection.query(**q_kwargs)
        except Exception:
            return []

        matched: List[Dict[str, Any]] = []
        if results and results.get("ids") and len(results["ids"]) > 0:
            ids = results["ids"][0]
            metadatas = results["metadatas"][0] if results.get("metadatas") else []
            distances = results["distances"][0] if results.get("distances") else []

            for i, mem_id in enumerate(ids):
                dist = distances[i] if i < len(distances) else 999.0
                if dist > max_distance:
                    continue
                meta = metadatas[i] if i < len(metadatas) else {}
                matched.append({
                    "id": mem_id,
                    "title": meta.get("title", ""),
                    "category": meta.get("category", "biography"),
                    "content": meta.get("raw_content", ""),
                    "emotionalWeight": meta.get("emotional_weight", "Factual"),
                    "source": meta.get("source", "canonical"),
                    "distance": dist
                })
        return matched

    def search_memories(
        self,
        query: str,
        max_kurisu: int = 2,
        max_learned: int = 2,
        max_distance: float = MEMORY_MAX_DISTANCE,
        n_results: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Performs stratified semantic vector search in ChromaDB:
        - Up to max_kurisu from source != 'learned' (canonical + custom)
        - Up to max_learned from source == 'learned'
        Discards any result with distance > max_distance.
        """
        if self.collection.count() == 0:
            return []

        if n_results is not None:
            max_kurisu = n_results
            max_learned = n_results

        query_vec = self._embed_query(query)
        kurisu_matches = self._query_memory_group(query, {"source": {"$ne": "learned"}}, max_kurisu, max_distance, query_embedding=query_vec)
        learned_matches = self._query_memory_group(query, {"source": "learned"}, max_learned, max_distance, query_embedding=query_vec)

        combined = kurisu_matches + learned_matches
        combined.sort(key=lambda m: m["distance"])
        return combined

    def get_learned_context(
        self,
        query: str,
        limit: int = 12,
        precomputed_learned: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Operator profile: returns up to `limit` most recent learned facts from SQLite
        plus any semantic learned matches within MEMORY_MAX_DISTANCE, deduplicated.
        """
        # shortcut: recência pura até limit=12 + top-2 semântico; revisar se passar de ~50 fatos aprendidos.
        with self._conn() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT id, category, title, content, emotional_weight FROM memories "
                "WHERE source = 'learned' ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        recent = [
            {
                "id": r["id"],
                "title": _sanitize_field(r["title"], 80),
                "content": _sanitize_field(r["content"], 280),
                "emotionalWeight": _sanitize_field(r["emotional_weight"], 80) or "Factual",
                "source": "learned",
            }
            for r in rows
            if r["title"] and r["content"]
        ]
        seen = {m["id"] for m in recent}
        semantic_learned = (
            precomputed_learned
            if precomputed_learned is not None
            else self._query_memory_group(query, {"source": "learned"}, 2, MEMORY_MAX_DISTANCE, query_embedding=self._embed_query(query))
        )
        extra = [m for m in semantic_learned if m["id"] not in seen]
        return recent + extra

    def add_memory(self, category: str, title: str, content: str, emotional_weight: str = "Factual", source: str = "learned") -> Dict[str, Any]:
        """
        Adds or updates (semantic upsert for source='learned') a memory in both SQLite and ChromaDB.
        Sanitizes and bounds inputs at the storage trust boundary.
        """
        clean_category = _sanitize_field(category, 40) or "user"
        clean_title = _sanitize_field(title, 80)
        clean_content = _sanitize_field(content, 280)
        clean_emotion = _sanitize_field(emotional_weight, 80) or "Factual"
        clean_source = _sanitize_field(source, 40) or "learned"

        if not clean_title or not clean_content:
            raise ValueError("Memory title and content must not be empty.")

        now = time.time()
        doc_text = f"{clean_title}: {clean_content}"
        doc_vec = self._embed_query(doc_text)
        mem_id: Optional[str] = None

        with self._conn() as conn:
            cursor = conn.cursor()
            if clean_source == "learned":
                cursor.execute(
                    "SELECT id FROM memories WHERE source = 'learned' AND LOWER(TRIM(title)) = ? LIMIT 1",
                    (clean_title.lower(),)
                )
                row = cursor.fetchone()
                if row:
                    mem_id = row[0]
                else:
                    cursor.execute("SELECT 1 FROM memories WHERE source = 'learned' LIMIT 1")
                    if cursor.fetchone() is not None:
                        q_kwargs: Dict[str, Any] = {"n_results": 1, "where": {"source": "learned"}}
                        if doc_vec is not None:
                            q_kwargs["query_embeddings"] = [doc_vec]
                        else:
                            q_kwargs["query_texts"] = [doc_text]
                        q = self.collection.query(**q_kwargs)
                        if (
                            q
                            and q.get("ids")
                            and q["ids"][0]
                            and q.get("distances")
                            and q["distances"][0][0] <= UPSERT_MAX_DISTANCE
                        ):
                            mem_id = q["ids"][0][0]

            if mem_id:
                cursor.execute(
                    "UPDATE memories SET category = ?, title = ?, content = ?, emotional_weight = ?, created_at = ? WHERE id = ?",
                    (clean_category, clean_title, clean_content, clean_emotion, now, mem_id)
                )
            else:
                mem_id = f"mem_{clean_source}_{int(now)}_{os.urandom(2).hex()}"
                cursor.execute(
                    "INSERT INTO memories (id, category, title, content, emotional_weight, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (mem_id, clean_category, clean_title, clean_content, clean_emotion, clean_source, now)
                )
            conn.commit()

        upsert_kwargs: Dict[str, Any] = {
            "ids": [mem_id],
            "documents": [doc_text],
            "metadatas": [{
                "title": clean_title,
                "category": clean_category,
                "emotional_weight": clean_emotion,
                "source": clean_source,
                "raw_content": clean_content
            }],
        }
        if doc_vec is not None:
            upsert_kwargs["embeddings"] = [doc_vec]
        self.collection.upsert(**upsert_kwargs)

        return {
            "id": mem_id,
            "category": clean_category,
            "title": clean_title,
            "content": clean_content,
            "emotionalWeight": clean_emotion,
            "source": clean_source,
            "createdAt": now
        }

    def clear_learned_memories(self) -> int:
        with self._conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM memories WHERE source = 'learned'")
            ids = [r[0] for r in cursor.fetchall()]
            if ids:
                cursor.execute("DELETE FROM memories WHERE source = 'learned'")
                conn.commit()
        if ids:
            try:
                self.collection.delete(ids=ids)
            except Exception:
                pass
        return len(ids)

    def delete_memory(self, memory_id: str) -> bool:
        with self._conn() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
            conn.commit()

        try:
            self.collection.delete(ids=[memory_id])
        except Exception:
            pass
        return True

    def get_counts(self) -> tuple[int, int]:
        with self._conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM memories")
            total_memories = int(cursor.fetchone()[0])
            cursor.execute("SELECT COUNT(*) FROM sessions")
            total_sessions = int(cursor.fetchone()[0])
            return total_memories, total_sessions

    def get_all_memories(self) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM memories ORDER BY created_at ASC")
            rows = cursor.fetchall()
            return [
                {
                    "id": row["id"],
                    "category": row["category"],
                    "title": row["title"],
                    "content": row["content"],
                    "emotionalWeight": row["emotional_weight"],
                    "source": row["source"],
                    "createdAt": row["created_at"]
                }
                for row in rows
            ]

    # --- SQLite Sessions & History ---
    def create_session(self) -> str:
        session_id = f"sess_{int(time.time())}_{os.urandom(3).hex()}"
        with self._conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO sessions (id, started_at) VALUES (?, ?)",
                (session_id, time.time())
            )
            conn.commit()
        return session_id

    def get_session_context_summary(self, session_id: str) -> str:
        with self._conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT context_summary FROM sessions WHERE id = ?", (session_id,))
            row = cursor.fetchone()
            return (row[0] or "") if row else ""

    def update_session_context_summary(self, session_id: str, context_summary: str) -> None:
        clean = _sanitize_field(context_summary, 600)
        if not clean:
            return
        with self._conn() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE sessions SET context_summary = ? WHERE id = ?", (clean, session_id))
            conn.commit()

    def close_session(self, session_id: str) -> str:
        """Single-pass episodic summary upon call hangup / session close (zero per-turn LLM overhead)."""
        if not session_id:
            return ""
        msgs = self.get_session_messages(session_id)
        user_turns = [
            _sanitize_field(m["content"], 140)
            for m in msgs
            if m.get("sender") == "user" and not m.get("content", "").startswith("[")
        ]
        amadeus_turns = [m for m in msgs if m.get("sender") != "user" and m.get("content")]
        summary = ""
        if user_turns:
            topics = " / ".join(dict.fromkeys([user_turns[0], *user_turns[-2:]]))
            last_ai = _sanitize_field(amadeus_turns[-1]["content"], 180) if amadeus_turns else ""
            last_emo = amadeus_turns[-1].get("emotion", "neutral") if amadeus_turns else "neutral"
            summary = _sanitize_field(
                f"{topics} — Kurisu ({last_emo}): {last_ai}",
                600,
            )
        now = time.time()
        with self._conn() as conn:
            conn.execute(
                "UPDATE sessions SET ended_at = ?, context_summary = COALESCE(NULLIF(?, ''), context_summary) WHERE id = ?",
                (now, summary, session_id),
            )
            conn.commit()
        return summary

    def save_message(self, session_id: str, sender: str, content: str, emotion: Optional[str] = None, recalled: Optional[List[str]] = None) -> str:
        msg_id = f"msg_{int(time.time() * 1000)}_{os.urandom(2).hex()}"
        with self._conn() as conn:
            cursor = conn.cursor()
            # Ensure session exists
            cursor.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
            if not cursor.fetchone():
                cursor.execute("INSERT INTO sessions (id, started_at) VALUES (?, ?)", (session_id, time.time()))

            if sender == "user":
                clean_summary = content.strip()[:60] + ("..." if len(content.strip()) > 60 else "")
                cursor.execute(
                    "UPDATE sessions SET summary = ? WHERE id = ? AND (summary IS NULL OR summary = '')",
                    (clean_summary, session_id)
                )

            cursor.execute(
                "INSERT INTO messages (id, session_id, sender, content, emotion, recalled_memories, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (msg_id, session_id, sender, content, emotion or "neutral", json.dumps(recalled or []), time.time())
            )
            conn.commit()
        return msg_id

    def delete_session(self, session_id: str) -> bool:
        with self._conn() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            conn.commit()
        return True

    def get_session_messages(self, session_id: str) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,))
            rows = cursor.fetchall()
            return [
                {
                    "id": row["id"],
                    "sender": row["sender"],
                    "content": row["content"],
                    "emotion": row["emotion"],
                    "recalledMemories": json.loads(row["recalled_memories"] or "[]"),
                    "timestamp": int(row["timestamp"] * 1000)
                }
                for row in rows
            ]

    def list_sessions(self) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("""
                SELECT s.id, s.started_at, s.ended_at, s.summary, s.context_summary, COUNT(m.id) as message_count
                FROM sessions s
                LEFT JOIN messages m ON s.id = m.session_id
                GROUP BY s.id
                ORDER BY s.started_at DESC
            """)
            rows = cursor.fetchall()
            return [
                {
                    "id": row["id"],
                    "startedAt": int(row["started_at"] * 1000) if row["started_at"] else 0,
                    "endedAt": int(row["ended_at"] * 1000) if row["ended_at"] else None,
                    "summary": row["summary"],
                    "contextSummary": row["context_summary"],
                    "messageCount": row["message_count"]
                }
                for row in rows
            ]

    def get_temporal_and_episodic_context(self, current_session_id: str, is_system_event: bool = False) -> Dict[str, Any]:
        """
        Returns elapsed seconds since the operator's previous message and the summary
        of the most recent prior session for cross-session continuity.
        """
        now = time.time()
        with self._conn() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT timestamp, session_id FROM messages WHERE sender = 'user' ORDER BY timestamp DESC LIMIT 2"
            )
            user_rows = cursor.fetchall()
            if is_system_event:
                prev_row = user_rows[0] if len(user_rows) >= 1 else None
            else:
                prev_row = user_rows[1] if len(user_rows) >= 2 else None
            gap_seconds = max(0.0, now - float(prev_row["timestamp"])) if prev_row and prev_row["timestamp"] else None

            cursor.execute(
                """
                SELECT id, context_summary, summary FROM sessions
                WHERE id != ? AND (context_summary IS NOT NULL OR summary IS NOT NULL)
                ORDER BY started_at DESC LIMIT 1
                """,
                (current_session_id or "",),
            )
            sess_row = cursor.fetchone()

        if sess_row and not sess_row["context_summary"]:
            auto_summary = self.close_session(sess_row["id"])
            last_topic = (auto_summary or sess_row["summary"] or "").strip()
        else:
            last_topic = (sess_row["context_summary"] or sess_row["summary"] or "").strip() if sess_row else ""

        return {"gapSeconds": gap_seconds, "lastSessionTopic": last_topic}

# Global singleton instance
memory_store = MemoryStore()
