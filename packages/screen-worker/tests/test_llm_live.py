import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from sw.llm_b6 import rows_of
from sw.llm_live import LlmRegister, conflicting_tag


class RegistrationTest(unittest.TestCase):
    def test_spoken_price_uses_the_quoted_selling_price_line(self):
        for text, quote, model_price, expected in (
            ("자 요거 35", "35", 35000, 350000),
            ("305번 삼십오", "삼십오", 35000, 350000),
            ("삼십 오까지", "삼십 오", 35000, 350000),
            ("삼만 오천 원", None, 35000, 35000),
            ("35,000원", "35", 35000, 35000),
            ("35 번이구요", "35", 35000, 35000),
            ("35 개에 삼만 오천 원", "35", 35000, 35000),
            ("3.5만원", "5", 35000, 35000),
            ("예전 35 오늘은 3만원", "35", 30000, 30000),
            ("305번", "35", 35000, 35000),
        ):
            with self.subTest(text=text):
                transcript = [(63, 265.43, text), (65, 269, "왕색금 305번")]
                answer = {"line": 65, "no": 305, "price": model_price, "price_short": quote, "price_line": 63}
                self.assertEqual(rows_of(json.dumps(answer), transcript)[0]["price"], expected)

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

    def test_reoffered_price_is_fixed_after_two_sure_answers(self):
        # D-SCR-09: 393 손톱 2만원으로 보낸 뒤 30분 뒤 "393번 손톱 만원" — 확실한 답 두 번이면 금액 고치기 한 번
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            poster = Mock()
            worker = LlmRegister(tmp, poster, "xhv-E5HEWUw", lambda _: None)
            self.addCleanup(worker.log.close)
            self.addCleanup(worker.ex.shutdown)

            def scene(line, sec, price, confidence="high", shown=393):
                with (root / "screen.jsonl").open("a", encoding="utf-8") as log:
                    for t in range(sec, sec + 5):
                        print(json.dumps({"sec": t, "t": [[shown, .4, .4, .1, .1]]}), file=log)
                with (root / "transcript.jsonl").open("a", encoding="utf-8") as log:
                    print(json.dumps({"start_sec": sec, "end_sec": sec + 4, "text": f"393번 {price}원"}), file=log)
                answer = json.dumps({"line": line, "no": 393, "price": price, "variety": "손톱", "confidence": confidence})
                with patch("sw.llm_b6.ask", return_value=answer):
                    worker.tick()
                    for *_, future in worker.flying:
                        future.result()
                    worker.tick()

            scene(0, 0, 20000)
            scene(1, 1800, 10000)
            self.assertEqual(poster.reprice.call_count, 0)            # 한 번으로는 안 바꾼다
            scene(2, 1805, 10000, "low")
            scene(3, 1810, 10000, shown=328)                          # 화면에 다른 번호면 세지 않는다
            self.assertEqual(poster.reprice.call_count, 0)
            scene(4, 1815, 10000)
            scene(5, 1820, 10000)
            worker.finish()
            self.assertEqual([c.args[1:3] for c in poster.reprice.call_args_list], [(393, 10000)])
            # 새 장면 재등록도 나가지만 서버에 이미 있는 번호라 무시된다(R-2) — 금액은 금액 고치기로 바뀐다
            self.assertEqual([c.args[0]["price"] for c in poster.send.call_args_list], [20000, 10000])

    def test_weak_or_shared_screen_evidence_is_not_a_conflict(self):
        self.assertIsNone(conflicting_tag(333, 0, 4, {}, {}))
        self.assertIsNone(conflicting_tag(333, 0, 4, {}, {0: 334, 1: 334}))
        self.assertIsNone(conflicting_tag(333, 0, 4, {2: [333, 334]}, dict.fromkeys(range(5), 334)))
