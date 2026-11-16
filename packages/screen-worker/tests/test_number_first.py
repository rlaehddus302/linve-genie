# 번호 먼저 올리기(LLM_NUMBER_FIRST, D-RECOG-30~) 시험: 빠른 길 규칙(sw.fastpath)을 라이브 일꾼에 붙인 것.
# 서버는 가짜(sw.replay_live의 FakeServer — 계약서의 답 모양 + 가격 없는 확인 중 등록), LLM도 가짜다. 줄은 지어낸 것(손님 이름·실제 기록 없음).
import unittest
from unittest.mock import patch

from sw import fastpath, llm_live, replay_live
from test_tentative import TStage


class EngineTest(unittest.TestCase):
    def test_late_line_still_counts_the_tag_frames_already_seen(self):
        # 라이브에서는 화면이 받아쓰기보다 먼저 온다: "12번"(번호대 밖이 아님, 앞 딱지 없음 → 바로 맞음)이 아닌 경우를 보려고
        # 앞 딱지가 다른 번호(40)였다가 12번 딱지가 줄이 끝난 뒤에 3번 보인 경우 — 줄이 늦게 들어와도 그 3번으로 맞음이 된다
        lines = [(1.0, 2.0, "자 이거 12번")]
        cand = {s: [40] for s in range(0, 3)}
        cand.update({s: [12] for s in range(3, 6)})
        mains = {s: v[0] for s, v in cand.items()}
        fp = fastpath.FastPath(lines, 10000)
        for t in range(0, 9):                                  # 화면을 8초까지 먼저 다 보고
            fp.screen(t, cand, mains)
        fp.line(3, 0, cand, mains)                             # 줄은 그 뒤에 들어온다(그 줄이 끝난 다음 초 = 3)
        r = fp.recs[12]
        self.assertEqual((r["state"], r["why_ok"]), ("판매 중", "딱지 3번"))
        self.assertEqual([k for k, _, _ in fp.take()][:2], ["open", "confirm"])

    def test_same_rules_as_the_stage0_replay(self):
        # 같은 순서로 넣으면 재현(sw.fastpath_sim)과 같은 기록 — 재현이 이 엔진을 그대로 쓴다
        lines = [(1.0, 2.0, "자 12번 갑니다"), (5.0, 6.0, "12번 3만원"), (9.0, 10.0, "12번 3만원 갑니다")]
        fp = fastpath.FastPath(lines, 10000)
        for t in range(0, 12):
            fp.screen(t, {}, {})
            for i, (_, e, _) in enumerate(lines):
                if int(e) + 1 == t:
                    fp.line(t, i, {}, {})
            fp.sweep(t)
        r = fp.recs[12]
        self.assertEqual((r["state"], r["price"], r["price_state"]), ("판매 중", 30000, "맞음"))


class Live(TStage):
    def kinds_of(self, kind):
        return [e for e in self.events if e["kind"] == kind]


class NumberFirstTest(unittest.TestCase):
    def setUp(self):
        p = patch.object(llm_live, "NUMBER_FIRST", True)
        p.start()
        self.addCleanup(p.stop)

    def test_number_alone_goes_up_without_a_price_and_two_lines_confirm(self):
        st = Live(self)
        st.hear(1, "자 12번 갑니다", end=2)
        st.reply()
        self.assertEqual(st.srv.kinds(), ["tentative"])
        body = st.srv.of("tentative")[0]
        self.assertIsNone(body["price"])                                   # 가격 없이(서버는 확인 중 등록에만 받는다)
        self.assertIn("PRICE_MISSING", body["tentative"]["reasons"])
        self.assertEqual((st.product(12)["state"], st.product(12)["price"]), ("임시", None))
        st.hear(5, "12번 3만원", end=6)
        st.reply()
        self.assertEqual(st.srv.of("reprice")[-1]["price"], 30000)          # 들린 값으로 채운다(확인 중 그대로)
        self.assertEqual(st.product(12)["state"], "임시")
        st.hear(9, "12번 3만원 갑니다", end=10)
        st.reply()
        self.assertEqual(st.srv.of("confirm"), [])                          # 같은 값을 두 마디에서 들었지만 품종을 고를 LLM 답을 잠깐 기다린다
        st.clock.now += llm_live.FP_LLM_WAIT
        st.reply()
        self.assertEqual(st.srv.of("confirm")[-1]["price"], 30000)          # LLM 답이 끝내 없으면 규칙 값으로 확정(LLM이 멈춘 때의 안전망)
        self.assertEqual((st.product(12)["state"], st.product(12)["price"]), ("판매", 30000))
        self.assertEqual(st.kinds_of("LLM등록")[-1]["why_price"], "같은 값을 번호와 함께 두 마디에서 들음(빠른 길)")

    def test_llm_answer_with_another_price_blocks_the_two_line_rule(self):
        st = Live(self)
        st.hear(1, "12번 3만원", end=2)
        st.reply({"line": 0, "no": 12, "no_from": "말", "price": 40000, "name": None, "confidence": "low", "why": ""})
        st.hear(5, "12번 3만원 갑니다", end=6)
        st.reply()
        self.assertEqual(st.srv.of("confirm"), [])                          # 규칙 값과 LLM 값이 다르다 — 확정하지 않고 기다린다
        self.assertEqual(st.product(12)["state"], "임시")

    def test_tag_alone_goes_up_and_is_withdrawn_after_sixty_seconds(self):
        st = Live(self)
        st.show(0, 7, 15)
        st.hear(0, "어서 오세요", end=1)
        st.reply()
        self.assertEqual(st.srv.kinds(), ["tentative"])
        self.assertEqual(st.kinds_of("LLM임시등록")[0]["fp"], "딱지만")
        st.show(8, 90)                                                     # 번호표가 내려가고 말도 없다
        st.hear(85, "네 감사합니다", end=86)
        st.reply()
        self.assertEqual(st.srv.kinds(), ["tentative", "withdraw"])
        self.assertIsNone(st.product(15))

    def test_spoken_number_with_another_tag_in_front_is_not_confirmed(self):
        # 말한 번호(107)와 앞에 든 번호표(152)가 다르고 한 자리 차이도 아니다 — LLM이 가격을 적어도 번호를 맞음으로 올리지 않는다(판매자가 고른다)
        st = Live(self)
        st.show(0, 12, 152)
        st.hear(5, "107번 3만원", end=6)
        st.reply({"line": 0, "no": 107, "no_from": "말", "price": 30000, "name": None, "confidence": "high", "why": ""})
        st.clock.now += llm_live.CONFIRM_AFTER + 1
        st.reply({"line": 0, "no": 107, "no_from": "말", "price": 30000, "name": None, "confidence": "high", "why": ""})
        self.assertEqual(st.product(107)["state"], "임시")
        self.assertEqual([b["no"] for b in st.srv.of("confirm")], [])
        self.assertEqual(st.kinds_of("LLM확인요청"), [])                    # 번호를 정하지 못했다(가격 확인 요청이 아니다)

    def test_off_by_default_keeps_the_current_way(self):
        with patch.object(llm_live, "NUMBER_FIRST", False):
            st = Live(self)
            st.hear(1, "자 12번 갑니다", end=2)
            st.reply()
            self.assertEqual(st.srv.kinds(), [])                           # 번호만으로는 올리지 않는다(지금 그대로)
            self.assertFalse(st.worker.fp)

    def test_old_server_without_tentative_does_not_use_it(self):
        st = Live(self, tentative=False)
        st.hear(1, "자 12번 갑니다", end=2)
        st.reply()
        self.assertEqual(st.srv.kinds(), [])                               # 가격 없는 등록은 확인 중 등록을 받는 서버에만


class FakeServerTest(unittest.TestCase):
    def test_price_can_be_empty_only_while_tentative(self):
        srv = replay_live.FakeServer()
        self.assertFalse(srv.apply("send", 0, {"no": 1, "price": None})["ok"])
        self.assertTrue(srv.apply("tentative", 0, {"no": 1, "price": None, "requestId": "r1"})["changed"])
        res = srv.apply("confirm", 1, {"no": 1, "rid": "r1"})
        self.assertEqual((res["changed"], res["broadcasts"][0].get("skip")), (False, "NO_PRICE"))
        srv.apply("reprice", 2, {"no": 1, "price": 30000})
        self.assertTrue(srv.apply("confirm", 3, {"no": 1, "rid": "r1"})["changed"])
        self.assertEqual((srv.products[1]["state"], srv.products[1]["price"]), ("판매", 30000))

    def test_truth_in_the_stage0_shape_allows_several_prices(self):
        import json
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "truth.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"31": {"prices": [380000, 400000], "names": ["녹색금"]}}, f, ensure_ascii=False)
            truth = replay_live.load_truth(path)
        self.assertEqual((truth[0]["no"], truth[0]["prices"], truth[0]["name"]), (31, [380000, 400000], "녹색금"))
        calls =[("tentative", 0, {"no": 31, "price": None, "requestId": "r"}), ("reprice", 1, {"no": 31, "price": 400000}),
                 ("confirm", 2, {"no": 31, "rid": "r", "to": None, "price": 400000, "name": None})]
        s = replay_live.score([{"calls": calls, "events": [], "fed": 0, "cut": 0, "confirm": 0, "recorded_calls": 0}], truth)
        self.assertEqual(s["틀린 값이 확정(판매 중)까지 간 수"], "번호 0 · 금액 0")
        self.assertEqual(s["그중 가격 없이 올린 수"], 1)


if __name__ == "__main__":
    unittest.main()
