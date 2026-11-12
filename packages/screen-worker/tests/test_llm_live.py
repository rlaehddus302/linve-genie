import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from sw.llm_live import LlmRegister, conflicting_tag


class RegistrationTest(unittest.TestCase):
    def test_conflicting_guess_is_held_until_supported(self):
        for later_tag in (False, True):
            with self.subTest(later_tag=later_tag), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                poster = Mock()
                events = []
                worker = LlmRegister(tmp, poster, "xhv-E5HEWUw", events.append)
                self.addCleanup(worker.log.close)
                self.addCleanup(worker.ex.shutdown)

                def append(name, record):
                    with (root / name).open("a", encoding="utf-8") as log:
                        print(json.dumps(record), file=log)

                def scene(line, displayed, number, confidence):
                    sec = 5 * line
                    for t in range(sec, sec + 5):
                        append("screen.jsonl", {"sec": t, "t": [[displayed, .4, .4, .1, .1]]})
                    append("transcript.jsonl", {"start_sec": sec, "end_sec": sec + 4, "text": f"{number}번"})
                    answer = json.dumps({"line": line, "no": number, "price": 70000, "confidence": confidence})
                    with patch("sw.llm_b6.ask", return_value=answer):
                        worker.tick()
                        for *_, future in worker.flying:
                            future.result()
                        worker.tick()

                scene(0, 334, 334, "high")
                scene(1, 334, 333, "low")
                self.assertEqual([r["screen_no"] for r in events if r["kind"] == "LLM번호충돌보류"], [334])
                if later_tag:
                    scene(2, 333, 333, "low")
                worker.finish()
                posted = [(call.args[0]["no"], call.args[0]["price"]) for call in poster.send.call_args_list]
                self.assertEqual(posted, [(334, 70000), (333, 70000)] if later_tag else [(334, 70000)])

    def test_weak_or_shared_screen_evidence_is_not_a_conflict(self):
        self.assertIsNone(conflicting_tag(333, 0, 4, {}, {}))
        self.assertIsNone(conflicting_tag(333, 0, 4, {}, {0: 334, 1: 334}))
        self.assertIsNone(conflicting_tag(333, 0, 4, {2: [333, 334]}, dict.fromkeys(range(5), 334)))
