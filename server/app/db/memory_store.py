import os
import json
import sqlite3
import time
from pathlib import Path
from contextlib import contextmanager
from typing import List, Dict, Any, Optional

import chromadb
from app.core.config import SQLITE_PATH, CHROMA_DIR

class MemoryStore:
    def __init__(self):
        self._init_sqlite()
        self._init_chroma()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(SQLITE_PATH)
        try:
            yield conn
        finally:
            conn.close()

    def _init_sqlite(self):
        with self._conn() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    started_at REAL,
                    ended_at REAL,
                    summary TEXT
                )
            """)
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
        self.chroma_client = chromadb.PersistentClient(path=str(CHROMA_DIR))
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

        count = self.exemplars_collection.count()
        if count > 0:
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

    def search_exemplars(self, query: str, n_results: int = 2) -> List[Dict[str, str]]:
        """
        Retrieves the most semantically relevant dialog turns from the fine-tuning dataset.
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
            for meta in results["metadatas"][0]:
                matched.append({
                    "user": meta.get("user", ""),
                    "assistant": meta.get("assistant", "")
                })
        return matched

    def seed_canonical_memories(self, memories: List[Dict[str, Any]]):
        """
        Seeds canonical memories into ChromaDB and SQLite if not already present.
        """
        with self._conn() as conn:
            cursor = conn.cursor()
            for mem in memories:
                mem_id = mem["id"]
                cursor.execute("SELECT id FROM memories WHERE id = ?", (mem_id,))
                if not cursor.fetchone():
                    # Insert in SQLite
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
                    # Insert in ChromaDB
                    doc_text = f"{mem['title']}: {mem['content']}"
                    keywords = " ".join(mem.get("triggerKeywords", []))
                    full_text = f"{doc_text} (keywords: {keywords})" if keywords else doc_text
                    
                    self.collection.upsert(
                        ids=[mem_id],
                        documents=[full_text],
                        metadatas=[{
                            "title": mem["title"],
                            "category": mem.get("category", "biography"),
                            "emotional_weight": mem.get("emotionalWeight", "Factual"),
                            "source": mem.get("source", "canonical"),
                            "raw_content": mem["content"]
                        }]
                    )
            conn.commit()

    def search_memories(self, query: str, n_results: int = 4) -> List[Dict[str, Any]]:
        """
        Performs semantic vector search in ChromaDB.
        """
        count = self.collection.count()
        if count == 0:
            return []

        limit = min(n_results, count)
        results = self.collection.query(
            query_texts=[query],
            n_results=limit
        )

        matched: List[Dict[str, Any]] = []
        if results and results.get("ids") and len(results["ids"]) > 0:
            ids = results["ids"][0]
            metadatas = results["metadatas"][0] if results.get("metadatas") else []
            distances = results["distances"][0] if results.get("distances") else []

            for i, mem_id in enumerate(ids):
                meta = metadatas[i] if i < len(metadatas) else {}
                dist = distances[i] if i < len(distances) else 1.0
                # Chroma uses L2 or cosine distance; lower distance = higher similarity
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

    def add_memory(self, category: str, title: str, content: str, emotional_weight: str = "Factual", source: str = "learned") -> Dict[str, Any]:
        """
        Adds a new memory to both SQLite and ChromaDB.
        """
        mem_id = f"mem_{source}_{int(time.time())}_{os.urandom(2).hex()}"
        now = time.time()

        with self._conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO memories (id, category, title, content, emotional_weight, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (mem_id, category, title, content, emotional_weight, source, now)
            )
            conn.commit()

        doc_text = f"{title}: {content}"
        self.collection.upsert(
            ids=[mem_id],
            documents=[doc_text],
            metadatas=[{
                "title": title,
                "category": category,
                "emotional_weight": emotional_weight,
                "source": source,
                "raw_content": content
            }]
        )

        return {
            "id": mem_id,
            "category": category,
            "title": title,
            "content": content,
            "emotionalWeight": emotional_weight,
            "source": source,
            "createdAt": now
        }

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
                SELECT s.id, s.started_at, s.ended_at, s.summary, COUNT(m.id) as message_count
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
                    "messageCount": row["message_count"]
                }
                for row in rows
            ]

# Global singleton instance
memory_store = MemoryStore()
