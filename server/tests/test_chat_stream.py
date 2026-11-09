import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from fastapi.testclient import TestClient
from main import app
from app.db.memory_store import memory_store
from app.services.llm import orchestrator as orch_module

REAL_ASYNC_CLIENT = httpx.AsyncClient
KEY = "gsk_test0000abcd"


def sse(*deltas):
    lines = [f"data: {json.dumps({'choices': [{'delta': {'content': d}}]})}\n\n" for d in deltas]
    return ("".join(lines) + "data: [DONE]\n\n").encode()


class Broken(httpx.AsyncByteStream):
    def __init__(self, head: bytes):
        self.head = head

    async def __aiter__(self):
        yield self.head
        raise httpx.ReadError("rede caiu")


def mock_groq(chat_handler):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "llama-a-70b"}, {"id": "llama-b-70b"}]})
        return chat_handler(request)

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return REAL_ASYNC_CLIENT(*args, **kwargs)

    return patch.object(orch_module.httpx, "AsyncClient", factory)


def read_events(client, payload):
    events = []
    with client.stream("POST", "/api/chat/stream", json=payload) as res:
        assert res.status_code == 200
        for block in res.iter_text():
            for part in block.split("\n\n"):
                for line in part.splitlines():
                    if line.startswith("data:"):
                        events.append(json.loads(line[5:]))
    return events


class TestChatStream(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls._initial_sessions = set(r["id"] for r in memory_store.list_sessions())

    @classmethod
    def tearDownClass(cls):
        created = set(r["id"] for r in memory_store.list_sessions()) - cls._initial_sessions
        if created:
            with memory_store._conn() as conn:
                for sid in created:
                    conn.execute("DELETE FROM messages WHERE session_id = ?", (sid,))
                    conn.execute("DELETE FROM sessions WHERE id = ?", (sid,))
                conn.commit()

    def payload(self, **extra):
        sid = memory_store.create_session()
        return {"message": "Explique o paradoxo do avô.", "apiKey": KEY, "sessionId": sid, **extra}

    def test_event_order_and_clean_done(self):
        body = sse("<!--emotion:smug,pose:crossed_arms,camera:medium--> Francamente, isso é óbvio. ",
                   "Agora escute com atenção, operador.")
        with mock_groq(lambda r: httpx.Response(200, content=body)):
            ev = read_events(self.client, self.payload())
        names = [e["event"] for e in ev]
        self.assertEqual(names[0], "meta")
        self.assertEqual(ev[0]["emotion"], "smug")
        self.assertEqual(ev[0]["pose"], "crossed_arms")
        self.assertEqual(names[-1], "done")
        self.assertEqual(names.count("meta"), 1)
        self.assertGreaterEqual(names.count("sentence"), 2)
        done = ev[-1]["response"]
        self.assertNotIn("<!--", done["response"])
        self.assertEqual(done["emotion"], "smug")

    def test_model_fallback_before_first_token(self):
        calls = []

        def chat(request):
            model = json.loads(request.content)["model"]
            calls.append(model)
            if len(calls) == 1:
                return httpx.Response(429, text="rate_limit")
            return httpx.Response(200, content=sse("<!--emotion:happy--> Funcionou no segundo modelo, veja só."))

        with mock_groq(chat):
            ev = read_events(self.client, self.payload())
        self.assertEqual(len(calls), 2)
        self.assertEqual(ev[-1]["event"], "done")
        self.assertIn("sentence", [e["event"] for e in ev])

    def test_error_before_any_sentence_returns_done_with_error(self):
        with mock_groq(lambda r: httpx.Response(401, text="invalid key")):
            ev = read_events(self.client, self.payload(allowModelFallback=False))
        self.assertEqual([e["event"] for e in ev], ["done"])
        self.assertTrue(ev[0]["response"]["error"])

    def test_cut_stream_keeps_spoken_sentences_without_done(self):
        head = sse("<!--emotion:annoyed--> Primeira frase completa e audível. Segunda frase também completa. ")
        head = head.replace(b"data: [DONE]\n\n", b"")
        req = self.payload()
        with mock_groq(lambda r: httpx.Response(200, stream=Broken(head))):
            ev = read_events(self.client, req)
        names = [e["event"] for e in ev]
        self.assertIn("sentence", names)
        self.assertEqual(names[-1], "error")
        self.assertNotIn("done", names)
        saved = [m for m in memory_store.get_session_messages(req["sessionId"]) if m["sender"] == "amadeus"]
        self.assertEqual(len(saved), 1)
        self.assertIn("Primeira frase", saved[0]["content"])

    def test_offline_without_key_emits_single_sentence_and_done(self):
        ev = read_events(self.client, {"message": "oi", "sessionId": memory_store.create_session()})
        names = [e["event"] for e in ev]
        self.assertEqual(names[0], "meta")
        self.assertEqual(names.count("sentence"), 1)
        self.assertEqual(names[-1], "done")


if __name__ == "__main__":
    unittest.main()
