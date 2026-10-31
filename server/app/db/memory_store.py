import os
import re
import json
import sqlite3
import time
from pathlib import Path
from contextlib import contextmanager
from typing import List, Dict, Any, Optional

import chromadb
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


class MemoryStore:
    def __init__(self, sqlite_path: Path = SQLITE_PATH, chroma_dir: Path = CHROMA_DIR):
        self.sqlite_path = sqlite_path
        self.chroma_dir = chroma_dir
        self._canonical_keywords: Dict[str, List[str]] = {}
        self._init_sqlite()
        self._init_chroma()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.sqlite_path)
        try:
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
            metadata={"description": "Makise Kurisu digitized memories and user-learned facts"}
        )
        self.exemplars_collection = self.chroma_client.get_or_create_collection(
            name="kurisu_exemplars",
            metadata={"description": "Fine-tuning dialogue exemplars for Dynamic Few-Shot prompting"}
        )

    def seed_exemplars(self, dataset_path: Path):
        """
        Seeds dialogue exemplars from the fine-tuning dataset into ChromaDB.
        """
        if not dataset_path.exists():
            return

        with open(dataset_path, "r", encoding="utf-8") as f:
            total_lines = sum(1 for line in f if line.strip())

        count = self.exemplars_collection.count()
        if count >= total_lines:
            return

        ids = []
        documents = []
        metadatas = []

        with open(dataset_path, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    msgs = data.get("messages", [])
                    user_text = next((m["content"] for m in msgs if m["role"] == "user"), "")
                    asst_text = next((m["content"] for m in msgs if m["role"] == "assistant"), "")
                    if user_text and asst_text:
                        ex_id = f"ex_{idx}"
                        ids.append(ex_id)
                        documents.append(user_text)
                        metadatas.append({
                            "user": user_text,
                            "assistant": asst_text
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

    def search_exemplars(self, query: str, n_results: int = 2, max_distance: float = EXEMPLAR_MAX_DISTANCE) -> List[Dict[str, str]]:
        """
        Retrieves the most semantically relevant dialog turns from the fine-tuning dataset
        within max_distance.
        """
        count = self.exemplars_collection.count()
        if count == 0:
            return []

        limit = min(n_results, count)
        results = self.exemplars_collection.query(
            query_texts=[query],
            n_results=limit
        )

        matched: List[Dict[str, str]] = []
        if results and results.get("metadatas") and len(results["metadatas"]) > 0:
            metas = results["metadatas"][0]
            distances = results["distances"][0] if results.get("distances") else []
            for i, meta in enumerate(metas):
                dist = distances[i] if i < len(distances) else 999.0
                if dist <= max_distance:
                    matched.append({
                        "user": meta.get("user", ""),
                        "assistant": meta.get("assistant", "")
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

        with self._conn() as conn:
            cursor = conn.cursor()
            for mem in memories:
                mem_id = mem["id"]
                cursor.execute("SELECT id FROM memories WHERE id = ?", (mem_id,))
                if not cursor.fetchone():
                    cursor.execute(
                        "INSERT INTO memories (id, category, title, content, emotional_weight, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            mem_id,
                            mem.get("category", "biography"),
                            mem["title"],
                            mem["content"],
                            mem.get("emotionalWeight", "Factual"),
                            mem.get("source", "canonical"),
                            time.time()
                        )
                    )
            conn.commit()
            cursor.execute("SELECT COUNT(*) FROM memories")
            sqlite_count = cursor.fetchone()[0]

        if self.collection.count() != sqlite_count:
            self.rebuild_index(memories)

    def _query_memory_group(self, query: str, where_filter: Dict[str, Any], group_limit: int, max_distance: float) -> List[Dict[str, Any]]:
        if group_limit <= 0:
            return []
        group_ids = (self.collection.get(where=where_filter, include=[]) or {}).get("ids") or []
        if not group_ids:
            return []

        results = self.collection.query(
            query_texts=[query],
            n_results=min(group_limit, len(group_ids)),
            where=where_filter
        )

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

        kurisu_matches = self._query_memory_group(query, {"source": {"$ne": "learned"}}, max_kurisu, max_distance)
        learned_matches = self._query_memory_group(query, {"source": "learned"}, max_learned, max_distance)

        combined = kurisu_matches + learned_matches
        combined.sort(key=lambda m: m["distance"])
        return combined

    def get_learned_context(self, query: str, limit: int = 12) -> List[Dict[str, Any]]:
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
        extra = [
            m
            for m in self._query_memory_group(query, {"source": "learned"}, 2, MEMORY_MAX_DISTANCE)
            if m["id"] not in seen
        ]
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
                    learned_ids = (self.collection.get(where={"source": "learned"}, include=[]) or {}).get("ids") or []
                    if learned_ids:
                        q = self.collection.query(
                            query_texts=[doc_text],
                            n_results=1,
                            where={"source": "learned"}
                        )
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

        self.collection.upsert(
            ids=[mem_id],
            documents=[doc_text],
            metadatas=[{
                "title": clean_title,
                "category": clean_category,
                "emotional_weight": clean_emotion,
                "source": clean_source,
                "raw_content": clean_content
            }]
        )

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

# Global singleton instance
memory_store = MemoryStore()
