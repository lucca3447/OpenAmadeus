#!/usr/bin/env python3
"""Minimal zero-dependency stdio MCP server confined to AMADEUS_DATA_DIR/lab_notes."""

import json
import os
from pathlib import Path
import re
import sys
from typing import Any, Dict, Tuple

SERVER_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path((os.environ.get("AMADEUS_DATA_DIR") or "").strip() or str(SERVER_DIR / "data"))
NOTES_DIR = DATA_DIR / "lab_notes"

_SAFE_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,60}\.md$")
_MAX_NOTE_BYTES = 16_384

TOOLS = [
    {
        "name": "list_lab_notes",
        "description": "List markdown research notes stored in the Amadeus lab_notes directory.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "read_lab_note",
        "description": "Read a markdown note from the Amadeus lab_notes directory by filename (e.g. 'kerr_notes.md').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Markdown filename ending in .md (no directory paths).",
                }
            },
            "required": ["filename"],
        },
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "write_lab_note",
        "description": "Create or overwrite a markdown note inside the Amadeus lab_notes directory.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Markdown filename ending in .md (no directory paths).",
                },
                "content": {
                    "type": "string",
                    "description": "Markdown body text to save.",
                },
            },
            "required": ["filename", "content"],
        },
        "annotations": {"readOnlyHint": False},
    },
]


def _resolve_note_path(filename: Any) -> Tuple[bool, Any]:
    if not isinstance(filename, str):
        return False, "filename must be a string."
    clean = filename.strip()
    if ".." in clean or "/" in clean or "\\" in clean or "\x00" in clean or not _SAFE_NAME_RE.match(clean):
        return False, "Invalid filename. Use a plain '.md' filename without directories."
    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    root = NOTES_DIR.resolve()
    target = (root / clean).resolve()
    if not target.is_relative_to(root) or target.parent != root:
        return False, "Path traversal blocked."
    return True, target


def _handle_tool_call(name: str, args: Dict[str, Any]) -> Tuple[str, bool]:
    if name == "list_lab_notes":
        if not NOTES_DIR.exists():
            return "No lab notes found.", False
        files = sorted(p.name for p in NOTES_DIR.iterdir() if p.is_file() and p.suffix == ".md")
        return ("\n".join(files) if files else "No lab notes found."), False

    if name == "read_lab_note":
        ok, target = _resolve_note_path(args.get("filename"))
        if not ok:
            return str(target), True
        if not target.exists():
            return f"Note '{target.name}' does not exist.", True
        return target.read_text(encoding="utf-8")[:_MAX_NOTE_BYTES], False

    if name == "write_lab_note":
        ok, target = _resolve_note_path(args.get("filename"))
        if not ok:
            return str(target), True
        content = args.get("content")
        if not isinstance(content, str):
            return "content must be a string.", True
        trimmed = content[:_MAX_NOTE_BYTES]
        target.write_text(trimmed, encoding="utf-8")
        return f"Saved '{target.name}' ({len(trimmed)} chars).", False

    return f"Unknown tool '{name}'.", True


def _write_json(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> None:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            _write_json({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
            continue

        if not isinstance(msg, dict):
            continue
        req_id = msg.get("id")
        method = msg.get("method")
        params = msg.get("params") or {}

        # Notifications carry no id and expect no reply
        if req_id is None:
            continue

        if method == "initialize":
            _write_json({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "amadeus-lab-notes", "version": "0.1.0"},
                },
            })
        elif method == "ping":
            _write_json({"jsonrpc": "2.0", "id": req_id, "result": {}})
        elif method == "tools/list":
            _write_json({"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}})
        elif method == "tools/call":
            tool_name = str(params.get("name") or "")
            args = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
            text, is_error = _handle_tool_call(tool_name, args)
            _write_json({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": text}],
                    "isError": is_error,
                },
            })
        else:
            _write_json({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            })


if __name__ == "__main__":
    main()
