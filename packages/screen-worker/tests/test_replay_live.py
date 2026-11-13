# 재현 도구(D-SCR-17) 시험: 지어낸 작은 실행 폴더를 흘려 고치기 전·후 로직의 수치를 견준다. 실제 방송 기록·LLM은 쓰지 않는다.
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from sw import replay_live

DAY0 = 1_000_000_000          # 그날 0시(벽시계 초) — 아무 값
T0 = 11 * 3600                # 방송 0초 = 11:00:00쯤


def write(path, rows):
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def make_run(base):
    """372번 번호표가 일부만 읽혀 '2'가 두 장 스쳤고, 가격을 말한 줄에는 번호가 없었다. LLM은 처음에 2번, 6초 뒤 372번으로 답했다"""
    run = base / "testvideo01-20261112_110000"
    run.mkdir()
    write(run / "transcript.jsonl", [
        {"start_sec": 0.0, "end_sec": 3.0, "text": "8만원 갑니다 8만원"},
        {"start_sec": 5.0, "end_sec": 8.0, "text": "372번 팔색조"},
    ])
    write(run / "screen.jsonl", [{"sec": s, "t": [[2, .4, .4, .1, .1]] if s in (1, 2) else [[372, .4, .4, .1, .1]]} for s in range(0, 30)])
    user0 = "L0 [0:00:00] (화면: 372 크게 2초, 2 크게 2초) 8만원 갑니다 8만원"
    write(run / "llm_live.jsonl", [
        {"upto": 0, "why": "숫자", "user": user0, "at": "11:00:12", "sec": 6.9,
         "answer": json.dumps({"line": 0, "no": 2, "no_from": "화면", "price": 80000, "name": "팔색조", "confidence": "high"}, ensure_ascii=False)},
        {"upto": 1, "why": "숫자", "user": user0 + "\nL1 [0:00:05] (화면: 372 크게 5초) 372번 팔색조", "at": "11:00:18", "sec": 7.0,
         "answer": json.dumps({"line": 0, "no": 372, "no_from": "말+화면", "price": 80000, "name": "팔색조", "confidence": "high"}, ensure_ascii=False)},
    ])
    # 그날 일꾼이 남긴 등록 기록 하나: 줄을 읽은 시각과 보낸 시각으로 벽시계를 맞춘다
    write(run / "events.jsonl", [{"kind": "LLM등록", "no": 2, "price": 80000, "sent": True, "line": 0, "line_end_sec": 3.0,
                                  "line_seen_wall": DAY0 + T0 + 5.0, "sent_wall": DAY0 + T0 + 12.0, "at": "11:00:12", "wait_sec": 7.0}])
    truth = base / "products.json"
    truth.write_text(json.dumps({"products": [
        {"no": 372, "name": "팔색조", "price": 80000, "phase": "SELLING", "sold": True},
        {"no": 2, "name": "팔색조", "price": 80000, "phase": "CLOSED", "sold": False},
    ]}, ensure_ascii=False), encoding="utf-8")
    return run, truth


class ReplayTest(unittest.TestCase):
    def test_times_are_taken_from_the_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            run, _ = make_run(Path(tmp))
            data = replay_live.load_run(str(run))
            self.assertEqual(data["seen"][0], T0 + 5.0)                      # 기록에 있는 줄은 그 시각 그대로
            self.assertLessEqual(data["seen"][1], T0 + 18 - 7.0)             # 그 줄을 넣은 물음보다 늦게 읽혔을 수 없다
            self.assertEqual([at for at, _ in data["calls"]], [T0 + 12.5, T0 + 18.5])
            self.assertAlmostEqual(data["wall0"], T0 + 5.0 - 3.0 - replay_live.STT_MIN)

    def test_before_and_after_are_compared_on_the_same_answers(self):
        with tempfile.TemporaryDirectory() as tmp:
            run, truth = make_run(Path(tmp))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                scores = replay_live.main([str(run), "--truth", str(truth), "--detail", str(Path(tmp) / "detail.csv"), "--events", str(Path(tmp) / "events")])
            before, after = scores["고치기 전"], scores["고친 뒤"]
            # 고치기 전: 첫 답(2번)으로 바로 보냈다. 고친 뒤: 화면 근거가 없는 2번은 보내지 않고 372번만
            self.assertEqual(before["보낸 등록 수"], 2)
            self.assertEqual(before["_bad"], [2])
            self.assertEqual(after["보낸 등록 수"], 1)
            self.assertEqual(after["_bad"], [])
            for s in (before, after):
                self.assertEqual(s["정답 번호 중 등록된 수"], "1/1")
                self.assertEqual(s["첫 등록 금액이 정답과 다른 수"], 0)
                self.assertEqual(s["첫 등록 품종이 정답과 같은 수"], "1/1")
                self.assertEqual(s["LLM 호출 수(기록)"], 2)
            self.assertEqual(before["줄 도착→보냄 지연(초) 가운데값"], 14.0)   # 372번: 줄을 읽고(11:00:05) 둘째 답이 온 뒤(11:00:19)
            self.assertEqual(after["줄 도착→보냄 지연(초) 가운데값"], 14.0)
            self.assertIn("고친 뒤", out.getvalue())
            self.assertIn("372", (Path(tmp) / "detail.csv").read_text(encoding="utf-8-sig"))
            kinds = [json.loads(line)["kind"] for line in (Path(tmp) / "events" / "고친 뒤.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(kinds.count("서버:send"), 1)

    def test_wrong_numbers_left_in_the_truth_list(self):
        # 정답 목록에 남아 있지만 틀린 번호(판매자가 지우지 않은 것)는 --wrong 으로 알려 준다
        with tempfile.TemporaryDirectory() as tmp:
            run, truth = make_run(Path(tmp))
            data = json.loads(truth.read_text(encoding="utf-8"))
            data["products"][1]["phase"] = "SELLING"
            truth.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                plain = replay_live.main([str(run), "--truth", str(truth), "--mode", "before"])
                marked = replay_live.main([str(run), "--truth", str(truth), "--mode", "before", "--wrong", "2"])
            self.assertEqual(plain["고치기 전"]["_bad"], [])
            self.assertEqual(marked["고치기 전"]["_bad"], [2])

    def test_logic_can_be_loaded_from_another_file_or_switched_by_env(self):
        # 고치기 전 판: 옛 llm_live.py 파일을 주거나(--logic), 같은 파일을 LLM_REG_SAFE=0 으로 읽는다
        old = replay_live.load_logic(None, {"LLM_REG_SAFE": "0"}, "test_old")
        new = replay_live.load_logic(replay_live.os.path.join(replay_live.HERE, "llm_live.py"), {"LLM_REG_SAFE": "1"}, "test_new")
        self.assertFalse(old.SAFE)
        self.assertTrue(new.SAFE)
        self.assertIsNot(old.LlmRegister, new.LlmRegister)


if __name__ == "__main__":
    unittest.main()
