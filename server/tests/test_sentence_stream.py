import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.llm.sentence_stream import SentenceStream


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


if __name__ == "__main__":
    unittest.main()
