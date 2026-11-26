"""Pluggable temporal memory backend interface (0-infra SQLite bitemporal default + optional Graphiti HTTP bridge)."""

import ipaddress
import os
from typing import Any, Dict, List, Optional, Protocol
from urllib.parse import urlparse

import httpx

from app.core.config import GRAPH_RECALL_TIMEOUT_SEC
from app.db.memory_store import MemoryStore


class TemporalMemoryBackend(Protocol):
    """Unified interface for bitemporal fact persistence and point-in-time retrieval."""

    name: str

    def search(
        self,
        query: str,
        *,
        limit: int = 4,
        as_of: Optional[float] = None,
    ) -> List[Dict[str, Any]]: ...

    def record_fact(
        self,
        *,
        category: str,
        title: str,
        content: str,
        emotional_weight: str = "Factual",
        source: str = "learned",
        confidence: float = 0.85,
    ) -> Dict[str, Any]: ...

    def health(self) -> Dict[str, Any]: ...


class SQLiteBitemporalBackend:
    """Default 0-infra backend backed by SQLite Bitemporal + FTS5 + ChromaDB Hybrid RRF."""

    name = "sqlite"

    def __init__(self, store: MemoryStore) -> None:
        self._store = store

    def search(
        self,
        query: str,
        *,
        limit: int = 4,
        as_of: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        half = max(1, (int(limit) + 1) // 2)
        return self._store.search_memories(
            query,
            max_kurisu=half,
            max_learned=half,
            as_of=as_of,
        )[:limit]

    def record_fact(
        self,
        *,
        category: str,
        title: str,
        content: str,
        emotional_weight: str = "Factual",
        source: str = "learned",
        confidence: float = 0.85,
    ) -> Dict[str, Any]:
        return self._store.add_memory(
            category=category,
            title=title,
            content=content,
            emotional_weight=emotional_weight,
            source=source,
            confidence=confidence,
        )

    def health(self) -> Dict[str, Any]:
        total_memories, _ = self._store.get_counts()
        return {"backend": self.name, "ok": True, "activeMemories": total_memories}


def _validate_graph_url(url: str) -> str:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc or not parsed.hostname:
        raise ValueError(f"Invalid graph URL: {url!r}")
    host = parsed.hostname.lower()
    if host in ("metadata.google.internal", "metadata"):
        raise ValueError("Blocked metadata host for graph backend")
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
        if ip.is_link_local or ip.is_unspecified:
            raise ValueError(f"Blocked link-local/unspecified graph host: {host}")
    except ValueError:
        pass
    return parsed.geturl().rstrip("/")


class GraphitiHttpBackend:
    """Optional external Graphiti (FalkorDB/Neo4j) HTTP adapter with hard voice-path timeout & SQLite fail-open."""

    name = "graphiti"

    def __init__(
        self,
        url: str,
        fallback: SQLiteBitemporalBackend,
        *,
        timeout_sec: float = GRAPH_RECALL_TIMEOUT_SEC,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self._url = _validate_graph_url(url)
        self.fallback = fallback
        self._timeout_sec = max(0.05, float(timeout_sec))
        self._client = client
        self._last_error: Optional[str] = None

    def _http(self) -> httpx.Client:
        return self._client if self._client is not None else httpx.Client(timeout=self._timeout_sec)

    def search(
        self,
        query: str,
        *,
        limit: int = 4,
        as_of: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        payload: Dict[str, Any] = {"query": query, "limit": int(limit)}
        if as_of is not None:
            payload["as_of"] = float(as_of)

        own_client = self._client is None
        client = self._http()
        try:
            res = client.post(f"{self._url}/search", json=payload, timeout=self._timeout_sec)
            res.raise_for_status()
            data = res.json()
            items = data.get("results") if isinstance(data, dict) else None
            if isinstance(items, list):
                self._last_error = None
                return items[:limit]
            self._last_error = "Invalid Graphiti response shape"
        except Exception as exc:
            self._last_error = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        finally:
            if own_client:
                client.close()

        return self.fallback.search(query, limit=limit, as_of=as_of)

    def record_fact(
        self,
        *,
        category: str,
        title: str,
        content: str,
        emotional_weight: str = "Factual",
        source: str = "learned",
        confidence: float = 0.85,
    ) -> Dict[str, Any]:
        # Always persist locally in SQLite bitemporal store, then best-effort mirror to external graph.
        saved = self.fallback.record_fact(
            category=category,
            title=title,
            content=content,
            emotional_weight=emotional_weight,
            source=source,
            confidence=confidence,
        )
        own_client = self._client is None
        client = self._http()
        try:
            res = client.post(
                f"{self._url}/episodes",
                json={
                    "id": saved["id"],
                    "title": title,
                    "content": content,
                    "category": category,
                    "confidence": confidence,
                    "valid_from": saved.get("validFrom"),
                },
                timeout=self._timeout_sec,
            )
            res.raise_for_status()
            self._last_error = None
        except Exception as exc:
            self._last_error = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        finally:
            if own_client:
                client.close()
        return saved

    def health(self) -> Dict[str, Any]:
        base = self.fallback.health()
        return {
            **base,
            "backend": self.name,
            "url": self._url,
            "timeoutSec": self._timeout_sec,
            "degradedToSqlite": self._last_error is not None,
            "lastError": self._last_error,
        }


def build_temporal_backend(store: MemoryStore) -> TemporalMemoryBackend:
    """Factory reading AMADEUS_GRAPH_BACKEND (sqlite default | graphiti) and AMADEUS_GRAPH_URL."""
    sqlite_backend = SQLiteBitemporalBackend(store)
    kind = (os.environ.get("AMADEUS_GRAPH_BACKEND") or "sqlite").strip().lower()
    url = (os.environ.get("AMADEUS_GRAPH_URL") or "").strip()
    if kind == "graphiti" and url:
        return GraphitiHttpBackend(url=url, fallback=sqlite_backend)
    return sqlite_backend
