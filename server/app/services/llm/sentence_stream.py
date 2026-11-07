"""Incremental sentence splitter for streaming LLM output (v0.2.2).

Feeds on raw token deltas and yields ("directive", raw_tag) once (the leading
<!--emotion:...--> tag) and ("sentence", text) per speakable sentence, hiding every
<!-- ... --> comment and thinking block from the spoken text.
"""
import re
from typing import List, Tuple

# shortcut: only . ! ? \n and the ellipsis split sentences; JA "。" segmentation lands in v0.3.0.
_COMMENT = re.compile(r"(?is)<!--[^>]*?>")
_THINK = re.compile(r"(?is)<(think|thought|reasoning|reflection|internal|scratchpad)>.*?</\1>")
_OPENERS = ("<!--", "<think", "<thought", "<reasoning", "<reflection", "<internal", "<scratchpad")
_BOUNDARY = re.compile(r"[.!?…]+[\"')\]]*(?=\s)|\n")
_ABBREV = {"dr", "dra", "sr", "sra", "prof", "ex", "etc", "vs", "ph", "st"}
FIRST_MIN_CHARS = 12
NEXT_MIN_CHARS = 25


def _hold_from(buf: str) -> int:
    """Index where an unfinished opener (or a partial prefix of one) starts, else len(buf)."""
    low = buf.lower()
    for op in _OPENERS:
        i = low.rfind(op[0])
        while i != -1:
            tail = low[i:]
            closed_comment = op == "<!--" and ">" in tail
            if not closed_comment and (tail.startswith(op) or op.startswith(tail)):
                return i
            i = low.rfind(op[0], 0, i)
    return len(buf)


class SentenceStream:
    def __init__(self) -> None:
        self._buf = ""
        self._pending = ""
        self._emitted = 0
        self.directive = ""

    def _is_abbrev(self, text: str, end: int) -> bool:
        m = re.search(r"([A-Za-zÀ-ÿ]+)\.$", text[:end])
        return bool(m) and m.group(1).lower() in _ABBREV

    def _drain(self, final: bool) -> List[Tuple[str, str]]:
        out: List[Tuple[str, str]] = []
        self._buf = _THINK.sub("", self._buf)
        # Emit the opening directive as soon as it closes (before sentence 1 finishes streaming)
        if not self.directive and not self._pending.strip():
            for m in list(_COMMENT.finditer(self._buf)):
                if re.search(r"emotion\s*:", m.group(0), re.I):
                    self.directive = m.group(0)
                    out.append(("directive", self.directive))
                    self._buf = self._buf[: m.start()] + self._buf[m.end() :]
                    break

        cut = _hold_from(self._buf)  # also at the end: an unclosed opener is reasoning/metadata, never speech
        ready, self._buf = self._buf[:cut], self._buf[cut:]
        self._pending += ready

        while True:
            m = next(
                (b for b in _BOUNDARY.finditer(self._pending) if not self._is_abbrev(self._pending, b.end())),
                None,
            )
            if not m:
                break
            piece = self._pending[: m.end()].strip()
            threshold = FIRST_MIN_CHARS if self._emitted == 0 else NEXT_MIN_CHARS
            if len(self._clean(piece)) < threshold:
                nxt = next((b for b in _BOUNDARY.finditer(self._pending, m.end())
                            if not self._is_abbrev(self._pending, b.end())), None)
                if not nxt and not final:
                    break
                if not nxt:
                    break  # remainder flushed below
                piece = self._pending[: nxt.end()].strip()
                m = nxt
            self._pending = self._pending[m.end():]
            for cm in _COMMENT.finditer(piece):
                if re.search(r"emotion\s*:", cm.group(0), re.I):
                    self.directive = cm.group(0)
                    out.append(("directive", self.directive))
            sentence = self._clean(piece)
            if sentence:
                self._emitted += 1
                out.append(("sentence", sentence))
        if final:
            for cm in _COMMENT.finditer(self._pending):
                if re.search(r"emotion\s*:", cm.group(0), re.I):
                    self.directive = cm.group(0)
                    out.append(("directive", self.directive))
            tail = self._clean(self._pending)
            self._pending = ""
            if tail:
                self._emitted += 1
                out.append(("sentence", tail))
        return out

    @staticmethod
    def _clean(text: str) -> str:
        text = _COMMENT.sub("", text)
        text = re.sub(r"\*[^*]+\*", "", text)
        return re.sub(r"\s+", " ", text).strip()

    def feed(self, delta: str) -> List[Tuple[str, str]]:
        self._buf += delta
        return self._drain(final=False)

    def flush(self) -> List[Tuple[str, str]]:
        return self._drain(final=True)
