import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.llm.sentence_stream import SentenceStream, extract_ja_tts, split_ja_sentences
from app.services.offline_simulator import offline_simulator
from app.services.voice_service import resolve_qwen_language
from app.services.qwen_tts.qwen_worker import sanitize_for_qwen, prepare_worker_segments


def run(chunks):
    s = SentenceStream()
    ev = []
    for c in chunks:
        ev += s.feed(c)
    ev += s.flush()
    return ev, s


def sentences(ev):
    return [t for k, t in ev if k == "sentence"]


class TestSentenceStream(unittest.TestCase):
    def test_leading_directive_split_across_tokens(self):
        ev, s = run(["<!--emo", "tion:smug,pose:crossed_arms,camera:medium", "--> Francamente, isso é óbvio. ", "Agora escute com atenção."])
        self.assertEqual(ev[0][0], "directive")
        self.assertIn("emotion:smug", s.directive)
        self.assertEqual(sentences(ev), ["Francamente, isso é óbvio.", "Agora escute com atenção."])

    def test_no_tag_text_leaks(self):
        ev, _ = run(["Olá, operador! ", "Tudo certo? <!--remember:Nome|João|Factual-->", " <!--emotion:happy-->"])
        self.assertTrue(all("<!--" not in t and "-->" not in t for t in sentences(ev)))

    def test_abbreviation_and_decimal_do_not_split(self):
        ev, _ = run(["O Dr. Okabe mediu 3.14 metros de fio. Depois saiu correndo do laboratório."])
        self.assertEqual(sentences(ev)[0], "O Dr. Okabe mediu 3.14 metros de fio.")

    def test_short_sentences_are_merged(self):
        ev, _ = run(["Certo. ", "Sim. ", "Isso é uma frase bem maior que o mínimo. ", "Fim."])
        out = sentences(ev)
        self.assertEqual(out[0], "Certo. Sim.")  # both under the 12-char first threshold
        self.assertIn("Isso é uma frase bem maior que o mínimo.", out)

    def test_first_sentence_is_emitted_before_stream_ends(self):
        s = SentenceStream()
        ev = s.feed("Olha só, isso funciona. E o resto ainda ")
        self.assertEqual(sentences(ev), ["Olha só, isso funciona."])

    def test_unclosed_thinking_block_is_dropped(self):
        ev, _ = run(["<think>planejando a resposta", " ainda pensando"])
        self.assertEqual(sentences(ev), [])

    def test_closed_thinking_block_hidden(self):
        ev, _ = run(["<think>x</think>Resposta final aqui, sem pensar."])
        self.assertEqual(sentences(ev), ["Resposta final aqui, sem pensar."])

    def test_flush_emits_unterminated_tail(self):
        ev, _ = run(["Frase sem pontuação final"])
        self.assertEqual(sentences(ev), ["Frase sem pontuação final"])

    def test_mid_speech_directive_emitted_before_second_sentence(self):
        ev, _ = run([
            "<!--emotion:thinking,pose:default,camera:closeup--> Primeira frase explicando o conceito básico. ",
            "<!--emotion:analytical,pose:crossed_arms,camera:medium--> Segunda frase aprofundando a matemática da métrica.",
        ])
        self.assertEqual([k for k, _ in ev], ["directive", "sentence", "directive", "sentence"])
        self.assertIn("pose:default", ev[0][1])
        self.assertIn("pose:crossed_arms", ev[2][1])

    def test_japanese_punctuation_splits_without_spaces(self):
        ev, _ = run(["<!--emotion:annoyed,pose:crossed_arms,camera:medium--> クリスティーナって呼ぶな！私は牧瀬紅莉栖よ。"])
        self.assertEqual(sentences(ev), ["クリスティーナって呼ぶな！", "私は牧瀬紅莉栖よ。"])

    def test_canonical_ja_tag_emitted_and_stripped_from_subtitle(self):
        raw = (
            "<!--emotion:wink,pose:default,camera:closeup--> "
            "<!--ja:冗談よ、そんなに怒らないで。--> Brincadeira, não precisa ficar tão bravo. "
            "<!--ja:さあ、次の実験を始めましょう。--> Agora vamos começar o próximo experimento."
        )
        ev, _ = run([raw])
        self.assertEqual(
            ev,
            [
                ("directive", "<!--emotion:wink,pose:default,camera:closeup-->"),
                ("ja", "冗談よ、そんなに怒らないで。"),
                ("sentence", "Brincadeira, não precisa ficar tão bravo."),
                ("ja", "さあ、次の実験を始めましょう。"),
                ("sentence", "Agora vamos começar o próximo experimento."),
            ],
        )
        self.assertEqual(extract_ja_tts(raw), "冗談よ、そんなに怒らないで。 さあ、次の実験を始めましょう。")

    def test_qwen_language_resolution_and_sanitizer(self):
        self.assertEqual(resolve_qwen_language("pt-BR", "Olá"), "Portuguese")
        self.assertEqual(resolve_qwen_language("en-US", "Hello"), "English")
        self.assertEqual(resolve_qwen_language("pt-BR", "こんにちは！"), "Japanese")
        self.assertEqual(sanitize_for_qwen("Relatório!", language="Portuguese"), "Relatório.")
        self.assertEqual(sanitize_for_qwen("Wait a second!", language="English"), "Wait a second!")
        self.assertEqual(sanitize_for_qwen("クリスティーナって呼ぶな！", language="Japanese"), "クリスティーナって呼ぶな！")
        self.assertEqual(
            prepare_worker_segments("クリスティーナって呼ぶな！私は牧瀬紅莉栖よ。", max_single_pass_chars=8, language="Japanese"),
            ["クリスティーナって呼ぶな！", "私は牧瀬紅莉栖よ。"],
        )

    def test_split_ja_sentences(self):
        text = "私の名前は紅莉栖よ！助手じゃないわ！コードを書きなさい。"
        parts = split_ja_sentences(text)
        self.assertEqual(parts, ["私の名前は紅莉栖よ！", "助手じゃないわ！", "コードを書きなさい。"])

        single = "ほら、あなたのコードが世界を変えるわ"
        self.assertEqual(split_ja_sentences(single), ["ほら、あなたのコードが世界を変えるわ"])
        self.assertEqual(split_ja_sentences(""), [])

    def test_offline_simulator_trilingual_responses(self):
        pt_res, _, _ = offline_simulator("Olá", {}, [], lang="pt")
        en_res, _, _ = offline_simulator("Hello", {}, [], lang="en")
        ja_res, _, _ = offline_simulator("こんにちは", {}, [], lang="ja")
        self.assertIn("Kurisu", pt_res)
        self.assertIn("Kurisu", en_res)
        self.assertTrue("牧瀬紅莉栖" in ja_res or "アマデウス" in ja_res)

    def test_trilingual_prompts_lorebook_and_canonical_exemplar_filter(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        from app.services.llm.orchestrator import _build_system_event_prompt, match_lorebook, LLMOrchestrator

        en_ev = _build_system_event_prompt("idle_stage_2", [{"role": "user", "content": "hi"}], None, "", lang="en", canonical_voice=True)
        self.assertIn("SYSTEM EVENT", en_ev)
        self.assertIn("<!--ja:", en_ev)
        self.assertTrue(en_ev.index("<!--emotion:annoyed") > 0)

        ja_ev = _build_system_event_prompt("call_greeting", [], None, "", lang="ja")
        self.assertIn("システムイベント", ja_ev)

        self.assertTrue(any(m["id"] == "lore_sern" for m in match_lorebook("Tell me about the Z-Report")))
        self.assertTrue(any(m["id"] == "lore_kerr" for m in match_lorebook("カーブラックホールについて")))

        orch = LLMOrchestrator()
        fake_ex = [{"user": "hi", "assistant": "Hello without ja tag", "lang": "en"}]
        req = SimpleNamespace(lang="en", canonicalVoice=True)
        with patch("app.services.llm.orchestrator.memory_store.get_learned_context", return_value=[]), \
             patch("app.services.llm.orchestrator.memory_store.search_exemplars", return_value=fake_ex):
            prompt = orch._build_system_prompt(req, {"systemPrompt": "Base", "languageProfiles": {"en": "EN"}}, [], "hi", [], "", None, "")
        self.assertIn("[LANGUAGE ANCHOR]", prompt)
        self.assertNotIn("Hello without ja tag", prompt)

    def test_trilingual_emotion_and_tts_cleaning(self):
        from app.services.emotion_service import parse_tags, sanitize_repetitive_openers, infer_sentence_shift
        from app.services.voice_service import clean_text_for_tts

        _, _, mem_en = parse_tags("<!--emotion:happy--> Ok <!--remember:Short Title|Fact in Full Sentence|Sentiment-->")
        self.assertIsNone(mem_en)
        self.assertEqual(sanitize_repetitive_openers("Don't get me wrong, but I'm right."), "I'm right.")
        self.assertEqual(sanitize_repetitive_openers("勘違いしないでよね、ただの科学よ。"), "ただの科学よ。")
        self.assertEqual(infer_sentence_shift("本当にそれでいいの？", 1, "analytical", "crossed_arms", "medium")["pose"], "default")
        self.assertEqual(infer_sentence_shift("Frankly, that is absurd.", 1, "neutral", "default", "closeup")["emotion"], "eyes_closed")

        ja_clean = clean_text_for_tts("えっと……本当に？！？", lang="ja")
        self.assertIn("...", ja_clean)
        self.assertNotIn(", ", ja_clean)
        self.assertTrue(ja_clean.endswith("？"))
        en_clean = clean_text_for_tts("Hmm... wait, D-do not look!", lang="en")
        self.assertFalse(en_clean.lower().startswith("hmm"))
        self.assertIn("Do not look", en_clean)

    def test_persona_data_clean_and_qwen_default_id(self):
        import json
        root = Path(__file__).resolve().parent.parent.parent
        kurisu_json_data = json.loads((root / "server" / "personas" / "kurisu.json").read_text(encoding="utf-8"))
        kurisu_ts = (root / "src" / "data" / "personas" / "kurisu.ts").read_text(encoding="utf-8")
        dataset = (root / "server" / "training" / "kurisu_finetuning_dataset_enhanced.jsonl").read_text(encoding="utf-8")
        memories = kurisu_json_data["memories"]
        memories_blob = json.dumps(memories, ensure_ascii=False)
        for forbidden in ("Dame da koitsu", "wktk", "Maho-senpai"):
            self.assertNotIn(forbidden, memories_blob)
            self.assertNotIn(forbidden, dataset)
        self.assertNotIn("wktk", kurisu_ts)
        self.assertNotIn("Maho-senpai", kurisu_ts)
        self.assertNotIn("Dame da koitsu, hayaku", kurisu_ts)
        self.assertEqual(len(memories), 36)
        self.assertTrue(all(any(ord(ch) > 0x3000 for kw in m["triggerKeywords"] for ch in kw) for m in memories))

        worker_src = (root / "server" / "app" / "services" / "qwen_tts" / "qwen_worker.py").read_text(encoding="utf-8")
        self.assertIn("lucca3447/Makise_Kurisu_Qwen3_TTS_PTBR_added", worker_src)


if __name__ == "__main__":
    unittest.main()
