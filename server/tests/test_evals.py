import asyncio
import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = SERVER_DIR / "scripts"
for p in (SERVER_DIR, SCRIPTS_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from app.services.llm.background import BackgroundResult
from run_evals import (
    EvalJudgeVerdict,
    compare_reports,
    grade_live_turns_with_judge,
    run_offline_evals,
)


class TestAutomatedEvals(unittest.TestCase):
    def test_01_offline_golden_suite_passes_all_gates(self):
        report = run_offline_evals()
        self.assertEqual(report["mode"], "offline")
        self.assertTrue(report["all_passed"], msg=f"Offline eval failed: {report['suites']}")

        suites = report["suites"]
        for name in ("rag_retrieval", "lorebook", "dialogue_hygiene", "mcp_safety", "cognitive_consolidation"):
            self.assertIn(name, suites)
            self.assertTrue(suites[name]["pass"], msg=f"Suite {name} failed: {suites[name]}")

        rag = suites["rag_retrieval"]
        self.assertGreaterEqual(rag["recall_at_k"], 0.85)
        self.assertGreaterEqual(rag["mrr"], 0.75)
        self.assertGreaterEqual(rag["false_positive_rejection"], 0.80)

    def test_02_llm_judge_structured_rubric_scoring(self):
        turns = [
            {
                "id": "pt_tsundere",
                "lang": "pt",
                "canonical": False,
                "message": "Christina, minha assistente!",
                "ok": True,
                "response": "Não me chame de assistente! Sou uma pesquisadora séria.",
                "ttsResponse": "",
            },
            {
                "id": "en_science",
                "lang": "en",
                "canonical": False,
                "message": "Explain Kerr black holes.",
                "ok": True,
                "response": "A rotating Kerr black hole has two ergospheres and a ring singularity.",
                "ttsResponse": "",
            },
        ]

        async def _mock_judge_ok(prompt, model_cls, **kwargs):
            self.assertIs(model_cls, EvalJudgeVerdict)
            verdict = EvalJudgeVerdict(
                persona_fidelity=5,
                language_compliance=5,
                grounding_and_safety=4,
                conciseness=4,
                pass_verdict=True,
                rationale="In-character and concise.",
            )
            return BackgroundResult(
                data=verdict,
                provider="gemini",
                model="gemini-flash-lite-latest",
                latency_ms=12.0,
                schema_retries=0,
                failovers=0,
            )

        summary = asyncio.run(grade_live_turns_with_judge(turns, complete_fn=_mock_judge_ok))
        self.assertEqual(summary["scored_count"], 2)
        self.assertEqual(summary["skipped_count"], 0)
        self.assertEqual(summary["avg_score"], 4.5)
        self.assertEqual(summary["pass_rate"], 1.0)

        async def _mock_judge_offline(prompt, model_cls, **kwargs):
            return BackgroundResult(
                data=None,
                provider="offline",
                model="",
                latency_ms=0.0,
                schema_retries=0,
                failovers=0,
                error="no_bg_provider",
            )

        degraded = asyncio.run(grade_live_turns_with_judge(turns, complete_fn=_mock_judge_offline))
        self.assertEqual(degraded["scored_count"], 0)
        self.assertEqual(degraded["skipped_count"], 2)
        self.assertIsNone(degraded["avg_score"])

    def test_03_baseline_compare_detects_regression(self):
        baseline = {
            "suites": {
                "rag_retrieval": {
                    "pass": True,
                    "recall_at_1": 0.90,
                    "recall_at_k": 1.00,
                    "mrr": 0.95,
                    "false_positive_rejection": 0.90,
                },
                "lorebook": {"pass": True},
            },
            "live_judge": {"avg_score": 4.4},
        }

        improved = {
            "suites": {
                "rag_retrieval": {
                    "pass": True,
                    "recall_at_1": 0.95,
                    "recall_at_k": 1.00,
                    "mrr": 0.96,
                    "false_positive_rejection": 0.90,
                },
                "lorebook": {"pass": True},
            },
            "live_judge": {"avg_score": 4.5},
        }
        cmp_ok = compare_reports(improved, baseline, tolerance=0.02)
        self.assertTrue(cmp_ok["passed"], msg=str(cmp_ok))
        self.assertEqual(cmp_ok["regressions"], [])

        regressed = {
            "suites": {
                "rag_retrieval": {
                    "pass": True,
                    "recall_at_1": 0.90,
                    "recall_at_k": 1.00,
                    "mrr": 0.89,
                    "false_positive_rejection": 0.90,
                },
                "lorebook": {"pass": False},
            },
            "live_judge": {"avg_score": 3.8},
        }
        cmp_bad = compare_reports(regressed, baseline, tolerance=0.02)
        self.assertFalse(cmp_bad["passed"])
        self.assertEqual(len(cmp_bad["regressions"]), 3)


if __name__ == "__main__":
    unittest.main()
