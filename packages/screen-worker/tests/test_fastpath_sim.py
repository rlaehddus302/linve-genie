# 빠른 길 재현(sw.fastpath_sim)의 규칙 시험. 방송 사례를 닉네임 없는 지어낸 짧은 줄로 옮겼다(D-RECOG-01·03).
import collections
import json
import os
import tempfile
import unittest

from sw import fastpath_sim as F


def run(lines, screen=()):
    """lines = [(시작 초, 끝 초, 글)], screen = [(초, [(번호, 글자 높이)…])] → 상품 기록"""
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "transcript.jsonl"), "w", encoding="utf-8") as f:
            for s, e, x in lines:
                f.write(json.dumps({"start_sec": s, "end_sec": e, "text": x}, ensure_ascii=False) + "\n")
        with open(os.path.join(d, "screen.jsonl"), "w", encoding="utf-8") as f:
            for sec, toks in screen:
                f.write(json.dumps({"sec": sec, "t": [[no, 0.1 * (k + 1), 0.3, 0.1, h] for k, (no, h) in enumerate(toks)]}) + "\n")
        state = {"recs": {}, "run": 0, "band": None, "confirmed": [], "prices": [], "stats": collections.Counter()}
        F.simulate(d, state, {})
        return state["recs"]


class NumberFirstTest(unittest.TestCase):
    def test_number_alone_goes_up_without_a_price(self):
        recs = run([(1.0, 2.0, "자 12번 갑니다")])
        r = recs[12]
        self.assertEqual((r["t"], r["state"], r["price"]), (3, "판매 중", None))     # 줄이 끝난 다음 초에, 가격 없이

    def test_price_heard_later_is_attached_then_agreed_by_two_lines(self):
        recs = run([(1.0, 2.0, "자 12번 갑니다"), (5.0, 6.0, "12번 3만원"), (9.0, 10.0, "12번 3만원 갑니다")])
        r = recs[12]
        self.assertEqual((r["price"], r["price_state"], r["price_first_t"]), (30000, "맞음", 7))

    def test_price_without_a_number_goes_to_the_open_product(self):
        recs = run([(1.0, 2.0, "자 12번 갑니다"), (4.0, 5.0, "3만원 갑니다")])
        self.assertEqual((recs[12]["price"], recs[12]["price_state"]), (30000, "들림"))    # 한 번 들린 값은 맞음이 아니다

    def test_ten_times_pair_asks_the_seller(self):
        recs = run([(1.0, 2.0, "12번 2만원"), (4.0, 5.0, "12번 20만원")])
        self.assertIn("열 배", recs[12]["card"])
        self.assertNotEqual(recs[12]["price_state"], "맞음")


class TagTest(unittest.TestCase):
    def test_tag_alone_goes_up_and_is_withdrawn_without_a_second_evidence(self):
        recs = run([], [(s, [(15, 0.1)]) for s in range(0, 8)])
        self.assertEqual((recs[15]["src"], recs[15]["state"], recs[15]["t"]), ("딱지만", "거둠", 4))

    def test_tag_then_speech_is_agreed(self):
        recs = run([(6.0, 7.0, "15번 5만원")], [(s, [(15, 0.1)]) for s in range(0, 8)])
        self.assertEqual((recs[15]["state"], recs[15]["why_ok"], recs[15]["price"]), ("판매 중", "딱지 + 말", 50000))

    def test_shelf_full_of_tags_puts_nothing_up(self):
        shelf = [(21, 0.1), (22, 0.09), (23, 0.09), (24, 0.09), (25, 0.09)]
        self.assertEqual(run([], [(s, shelf) for s in range(0, 8)]), {})

    def test_ear_pair_follows_the_screen(self):
        recs = run([(4.0, 5.0, "33번 갑니다")], [(s, [(34, 0.1)]) for s in range(0, 10)])
        self.assertEqual(recs[34]["state"], "판매 중")
        self.assertEqual(recs[33]["state"], "거둠")                                   # 귀가 헷갈리는 3·4: 말한 번호는 거둔다


class AmountTest(unittest.TestCase):
    def test_cues(self):
        self.assertEqual(F.amounts("5만원 빼 드릴게요", 10000, set()), [])
        self.assertEqual(F.amounts("아까 90 갔죠", 10000, set()), [])
        self.assertEqual(F.amounts("자 이거 20 갑니다", 10000, set()), [(200000, "now")])
        self.assertEqual(F.amounts("2만원씩 갑니다", 10000, set()), [(20000, "per")])
        self.assertEqual(F.amounts("자 요거 5 갑니다", 10000, set()), [(50000, "now")])    # 한 자리 수는 "갑니다"가 붙을 때만


if __name__ == "__main__":
    unittest.main()
