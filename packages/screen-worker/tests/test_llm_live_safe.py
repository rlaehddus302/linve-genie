# 라이브 LLM 등록 안전 규칙(D-SCR-12~16)을 일꾼 로직에 흘려 보는 시험.
# 2026-11-12 방송 사례를 지어낸 짧은 줄로 옮겼다(손님 이름·실제 기록 없음). LLM은 부르지 않는다 — 답을 손으로 넣는다.
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from sw import llm_live
from sw.llm_live import LlmRegister
from sw.replay_live import FakeTime


class Stage:
    """가짜 시계 위에서 받아쓰기 줄·화면·LLM 답을 차례로 넣는 무대"""

    def __init__(self, case, **kw):
        self.case = case
        self.tmp = tempfile.TemporaryDirectory()
        case.addCleanup(self.tmp.cleanup)
        self.root = Path(kw.pop("out", self.tmp.name))
        self.root.mkdir(parents=True, exist_ok=True)
        self.clock = FakeTime()
        self.clock.now = 1000.0
        clock = patch("sw.llm_live.time", self.clock)
        clock.start()
        case.addCleanup(clock.stop)
        self.poster, self.events = Mock(), []
        self.out, self.asked = "", []                        # LLM이 다음에 할 답, 지금까지 물은 글
        llm = patch("sw.llm_b6.ask", self._ask)              # 시험 내내 가짜 LLM — 실제 codex는 절대 부르지 않는다
        llm.start()
        case.addCleanup(llm.stop)
        self.worker = LlmRegister(str(self.root), self.poster, "testvideo01", self.events.append, **kw)
        case.addCleanup(self.worker.log.close)
        case.addCleanup(self.worker.ex.shutdown)
        self.lines = 0

    def _ask(self, user, *a, **kw):
        self.asked.append(user)
        return self.out

    def _append(self, name, record):
        with (self.root / name).open("a", encoding="utf-8") as f:
            print(json.dumps(record, ensure_ascii=False), file=f)

    def show(self, start, end, *numbers):
        """start~end초(끝 포함)에 이 번호들이 화면에 읽혔다. 첫 번호가 가장 큰 번호표"""
        for sec in range(start, end + 1):
            self._append("screen.jsonl", {"sec": sec, "t": [[n, .4, .4, .1, .12 - .02 * k] for k, n in enumerate(numbers)]})

    def say(self, start, text, *answers, end=None):
        """받아쓴 줄 하나가 들어오고, 일꾼이 물으면 LLM이 answers(상품마다 dict)로 답한다. answers가 없으면 빈 답"""
        line = self.lines
        self.lines += 1
        self._append("transcript.jsonl", {"start_sec": start, "end_sec": end if end is not None else start + 3, "text": text})
        self.out = "\n".join(json.dumps(a, ensure_ascii=False) for a in answers)
        self.worker.tick()                                   # 줄을 읽힌다(화면 읽기가 그 줄 끝까지 와 있으면 바로 묻는다)
        self.clock.now += llm_live.SCREEN_WAIT               # 아니면 이만큼 지나서 이벤트를 본다
        self.answer(*answers)
        return line

    def answer(self, *answers):
        """일꾼이 한 번 돌고(물을 것이 있으면 묻고) 그 답을 받는다"""
        self.out = "\n".join(json.dumps(a, ensure_ascii=False) for a in answers)
        for _ in range(3):                                   # 묻기로 정하기 → 묻기 → 답 받기가 한 번씩 돌 때마다 이어진다
            self.worker.tick()
            for *_, future in list(self.worker.flying):
                future.result()
        self.worker.tick()
        self.out = ""

    def wait(self, sec):
        self.clock.now += sec
        self.worker.tick()
        for *_, future in list(self.worker.flying):
            future.result()
        self.worker.tick()

    @property
    def posted(self):
        return [(c.args[0]["no"], c.args[0]["price"], c.args[0].get("name", "")) for c in self.poster.send.call_args_list]

    def kinds(self, kind):
        return [e for e in self.events if e["kind"] == kind]


def row(line, no, price, name=None, conf="high", no_from="화면"):
    return {"line": line, "no": no, "no_from": no_from, "price": price, "name": name, "confidence": conf, "why": ""}


class NumberRuleTest(unittest.TestCase):
    def test_partly_read_tag_is_not_registered(self):
        # 372번 번호표가 일부만 읽혀 '2'가 두 장 스쳤고, 가격을 말한 줄에는 번호가 없었다(없는 번호 15건의 모양)
        st = Stage(self)
        st.show(0, 3, 372)
        st.show(4, 5, 2)
        st.show(6, 20, 372)
        a = st.say(4, "8만원 갑니다 8만원", row(0, 2, 80000, "팔색조"))
        self.assertEqual(st.posted, [])
        st.wait(llm_live.PRICE_WAIT + 1)
        self.assertEqual([(e["no"], e["why"][:8]) for e in st.kinds("LLM번호보류")], [(2, "화면 근거 부족")])
        self.assertEqual(st.kinds("LLM확인요청"), [])                      # 번호 근거가 없는 것은 판매자에게 묻지 않는다
        st.say(9, "372번 팔색조", row(a, 372, 80000, "팔색조", no_from="말+화면"))
        self.assertEqual(st.posted, [(372, 80000, "팔색조")])

    def test_number_of_the_previous_product_is_not_registered(self):
        # 번호표를 바꿔 들기 전에 가격을 말했고 화면에 앞 상품 번호(325)가 한 장 스쳤다 — LLM은 "확실"이라고 답했다
        st = Stage(self)
        st.show(0, 0, 325)
        st.show(1, 12, 385)
        a = st.say(0, "자 이거는 30만원 갑니다", row(0, 325, 300000, "블랙스완"))
        self.assertEqual(st.posted, [])
        st.say(5, "385번 블랙스완", row(a, 385, 300000, "블랙스완", no_from="말+화면"))
        self.assertEqual(st.posted, [(385, 300000, "블랙스완")])

    def test_spoken_number_in_band_does_not_wait_for_the_screen(self):
        st = Stage(self)
        st.say(0, "자 316 20만원 갑니다", row(0, 316, 200000, None, no_from="말"))
        self.assertEqual(st.posted, [(316, 200000, "")])
        self.assertEqual(st.kinds("LLM등록")[0]["why_no"], "말한 번호")

    def test_number_outside_the_band_needs_more_frames(self):
        # 이 방송은 300번대를 판다(앞선 실행에서 이어받음). "27번"으로 받아쓴 번호(377이 잘림)는 화면에 온전히 5장 보이기 전에는 보내지 않는다
        prior = [{"no": n, "price": 30000, "name": ""} for n in (377, 330, 327, 385, 393, 425)]
        st = Stage(self, prior=prior)
        st.show(0, 12, 371)
        st.say(0, "27번 한자 5만원", row(0, 27, 50000, "한자", no_from="말"))
        self.assertEqual(st.posted, [])
        st.wait(llm_live.PRICE_WAIT + 1)
        self.assertIn("번호대 밖", st.kinds("LLM번호보류")[0]["why"])

    def test_restarted_worker_does_not_resend_a_known_number_from_a_stale_tag(self):
        # 다시 켠 일꾼: 앞선 실행이 325번 환엽 지젤 3만원을 보냈다. 그 번호표가 계속 보이는 채로 다음 상품 가격을 말했다
        prior = [{"no": 325, "price": 30000, "name": "환엽 지젤"}]
        st = Stage(self, prior=prior)
        st.show(0, 30, 325)
        st.say(5, "자 이거는 30만원 블랙스완", row(0, 325, 300000, "블랙스완"))
        st.say(9, "30만원 블랙스완 갑니다", row(1, 325, 300000, "블랙스완"))
        self.assertEqual(st.posted, [])
        held = st.kinds("LLM앞번호표보류")
        self.assertEqual((held[0]["no"], held[0]["price"], held[0]["sent_price"]), (325, 300000, 30000))
        # 판매자가 그 번호를 다시 부르면(실제로 다시 내놓음) 예전처럼 다시 보낸다 — 금액은 금액 고치기(D-SCR-09)가 맞춘다
        st.say(20, "325번 2만원에 다시 드릴게요", row(2, 325, 20000, "환엽 지젤", no_from="말+화면"))
        self.assertEqual(st.posted, [(325, 20000, "환엽 지젤")])

    def test_prior_runs_are_read_from_sibling_folders(self):
        with tempfile.TemporaryDirectory() as base:
            old = Path(base) / "testvideo01-20261112_105438"
            old.mkdir()
            events = [
                {"kind": "LLM등록", "no": 325, "price": 30000, "name": "환엽 지젤", "sent": True},
                {"kind": "LLM등록", "no": 429, "price": 30000, "name": None, "sent": True},
                {"kind": "LLM등록", "no": 22, "price": 15000, "name": None, "sent": False, "skip": "금액 모름"},
                {"kind": "LLM번호바로잡기", "from": 429, "to": 371, "drop": False},
                {"kind": "LLM금액고치기", "no": 325, "from": 30000, "to": 20000},
            ]
            (old / "events.jsonl").write_text("\n".join(json.dumps(e, ensure_ascii=False) for e in events) + "\n", encoding="utf-8")
            other = Path(base) / "othervideo1-20261112_105438"
            other.mkdir()
            (other / "events.jsonl").write_text(json.dumps({"kind": "LLM등록", "no": 999, "price": 1000, "sent": True}) + "\n", encoding="utf-8")
            now = str(Path(base) / "testvideo01-20261112_111346")
            got = {d["no"]: d for d in llm_live.prior_sent(now, "testvideo01")}
            self.assertEqual(sorted(got), [325, 371])
            self.assertEqual((got[325]["price"], got[325]["fixes"]), (20000, 1))
            st = Stage(self, out=now)
            self.assertEqual(sorted(st.worker.sent), [325, 371])
            self.assertEqual(st.worker.prices[325]["fixes"], 1)             # 금액 고치기 요청 번호가 앞선 실행과 겹치지 않게 이어 센다


class PairRuleTest(unittest.TestCase):
    def test_heard_333_while_the_tag_says_334(self):
        # 귀로 헷갈리는 쌍(삼/사): 화면 번호를 따른다 — 334는 이미 보냈으니 333은 새로 등록되지 않는다
        st = Stage(self)
        st.show(0, 14, 334)
        st.say(0, "요거는 7만원 334번", row(0, 334, 70000, None, no_from="말+화면"))
        st.say(6, "333번 진짜 예쁜데 7만원", row(1, 333, 70000, "오색글래머", conf="low", no_from="말"))
        self.assertEqual(st.posted, [(334, 70000, "")])
        self.assertEqual([(e["said"], e["screen"], e["pair"], e["to"]) for e in st.kinds("LLM번호쌍판정")], [(333, 334, "3↔4", 334)])
        # 뒤에 진짜 333번 번호표가 나오면 등록한다
        st.show(100, 110, 333)
        st.say(100, "333번 수박색금 5만원", row(2, 333, 50000, "수박색금", no_from="말+화면"))
        self.assertEqual(st.posted[-1], (333, 50000, "수박색금"))

    def test_eye_confusable_pair_follows_the_spoken_number(self):
        # 눈으로 헷갈리는 쌍(8↔3): 번호표 읽기가 틀렸을 가능성이 크다 — LLM이 화면 번호(339)로 답해도 말한 번호(389)로
        st = Stage(self)
        st.show(0, 9, 339)
        st.say(0, "389번 삼광색금 27만원", row(0, 339, 270000, "삼광색금"))
        self.assertEqual(st.posted, [(389, 270000, "삼광색금")])
        self.assertEqual(st.kinds("LLM번호쌍판정")[0]["to"], 389)

    def test_other_pairs_wait_for_enough_frames(self):
        # 그 밖의 쌍(1↔3): 번호표가 FIX_FRAMES장 보이기 전에는 보내지 않고 기다렸다가, 충분히 보이면 화면 번호로
        st = Stage(self)
        st.show(0, 1, 353)
        st.say(0, "153번 청개구리 25만원", row(0, 153, 250000, "청개구리", no_from="말"), end=1)
        self.assertEqual(st.posted, [])
        st.show(2, 8, 353)
        st.wait(1)
        self.assertEqual(st.posted, [(353, 250000, "청개구리")])
        self.assertTrue(st.kinds("LLM번호쌍판정")[0]["waited"])

    def test_next_number_called_while_the_last_tag_is_still_up(self):
        # 번호를 차례로 파는 판매자: 421번(2만원)을 보낸 뒤 번호표를 든 채 "422번 3만원" — 한 자리 차이지만 금액이 다른 새 상품이다
        st = Stage(self)
        st.show(0, 30, 421)
        st.say(0, "421번 2만원", row(0, 421, 20000, None, no_from="말+화면"))
        st.say(8, "422번 3만원", row(1, 422, 30000, None, no_from="말"))
        self.assertEqual(st.posted, [(421, 20000, ""), (422, 30000, "")])
        self.assertEqual(st.kinds("LLM번호쌍판정"), [])

    def test_both_tags_visible_is_not_a_conflict(self):
        st = Stage(self)
        st.show(0, 9, 334, 333)
        st.say(0, "333번 7만원", row(0, 333, 70000, None, no_from="말"))
        self.assertEqual(st.posted, [(333, 70000, "")])
        self.assertEqual(st.kinds("LLM번호쌍판정"), [])


class PriceRuleTest(unittest.TestCase):
    def test_price_without_unit_waits_for_a_matching_answer(self):
        # 305번 "자 요거 35": LLM이 35,000으로 여러 번 답해도 보내지 않고, 350,000 답이 오면 그때 보낸다
        st = Stage(self)
        st.show(0, 60, 305)
        a = st.say(0, "자 요거 35", row(0, 305, 35000, "왕색금"))
        st.say(4, "305번 왕색금 예쁘죠", row(a, 305, 35000, "왕색금", no_from="말+화면"))
        st.say(8, "왕색금 이런 건 만 개에 하나 없어요", row(a, 305, 35000, "왕색금", no_from="말+화면"))
        self.assertEqual(st.posted, [])
        st.wait(llm_live.PRICE_WAIT + 1)
        ask = st.kinds("LLM확인요청")
        self.assertEqual((ask[0]["no"], ask[0]["prices"], ask[0]["said"]), (305, {"35000": 3}, [350000]))
        self.assertIn("10배", ask[0]["why"])
        self.assertEqual(st.posted, [])                                    # 상한을 채워도 보내지 않는다
        st.say(40, "자 305번 35 왕색금", row(3, 305, 350000, "왕색금", no_from="말+화면"))
        self.assertEqual(st.posted, [(305, 350000, "왕색금")])
        self.assertTrue(st.kinds("LLM등록")[0]["flagged"])

    def test_cut_off_price_is_not_sent(self):
        # 222번: 받아쓰기가 "130"을 "30!"으로 잘랐다. 30,000 → 130,000(여러 번) → 1,300,000 순으로 답이 왔다
        st = Stage(self)
        st.show(0, 60, 222)
        a = st.say(0, "30!", row(0, 222, 30000, "세검"))
        b = st.say(3, "222번 자 130에 드립니다", row(1, 222, 130000, "새검", no_from="말+화면"))
        st.say(7, "오늘 첫 상품입니다 만족하실 거예요", row(b, 222, 130000, "새검", no_from="말+화면"))
        self.assertEqual(st.posted, [])
        st.say(11, "자 130 에 갑니다", row(b, 222, 1300000, "색금", no_from="말+화면"))
        self.assertEqual(st.posted, [(222, 1300000, "색금")])
        self.assertEqual(a, 0)

    def test_price_not_in_the_transcript_needs_two_answers(self):
        st = Stage(self)
        st.show(0, 40, 407)
        a = st.say(0, "407번 빅뱅금 칠시", row(0, 407, 70000, "빅뱅금", no_from="말+화면"))
        self.assertEqual(st.posted, [])
        st.say(5, "빅뱅금 진짜 만족하실 거예요", row(a, 407, 70000, "빅뱅금", no_from="말+화면"))
        self.assertEqual(st.posted, [(407, 70000, "빅뱅금")])
        self.assertEqual(st.kinds("LLM등록")[0]["why_price"], "같은 답 2번")

    def test_split_answers_become_a_confirm_request(self):
        st = Stage(self)
        st.show(0, 40, 363)
        a = st.say(0, "363번 좋은 하루 만오", row(0, 363, 10000, None, no_from="말+화면"))
        st.say(5, "자 이것도 만족하실 겁니다", row(a, 363, 15000, None, no_from="말+화면"))
        st.wait(llm_live.PRICE_WAIT + 1)
        self.assertEqual(st.posted, [])
        self.assertEqual([(e["no"], e["why"]) for e in st.kinds("LLM확인요청")], [(363, "답이 갈림")])

    def test_single_answer_is_asked_once_more(self):
        # 답이 한 번뿐이고 날아가 있는 물음이 없으면 같은 창을 한 번 더 묻는다(상품마다 한 번)
        st = Stage(self)
        st.show(0, 40, 407)
        st.say(0, "407번 빅뱅금 칠시", row(0, 407, 70000, "빅뱅금", no_from="말+화면"))
        self.assertEqual(len(st.asked), 1)
        st.clock.now += llm_live.CONFIRM_AFTER + 1
        st.answer(row(0, 407, 70000, "빅뱅금", no_from="말+화면"))
        self.assertEqual(len(st.asked), 2)
        self.assertEqual(st.asked[0], st.asked[1])
        self.assertEqual(st.worker.confirm_calls, 1)
        self.assertEqual(st.posted, [(407, 70000, "빅뱅금")])

    def test_finish_does_not_send_what_was_not_settled(self):
        st = Stage(self)
        st.show(0, 40, 407)
        st.say(0, "407번 빅뱅금 칠시", row(0, 407, 70000, "빅뱅금", no_from="말+화면"))
        st.worker.finish()
        self.assertEqual(st.posted, [])
        self.assertEqual([(e["no"], e["why"]) for e in st.kinds("LLM확인요청")], [(407, "답이 한 번뿐")])

    def test_reoffered_price_still_goes_through_reprice(self):
        # D-SCR-09는 그대로: 같은 번호를 다시 내놓으면 확실한 답 두 번으로 금액 고치기
        st = Stage(self)
        st.show(0, 10, 393)
        st.say(0, "393번 손톱 2만원", row(0, 393, 20000, "손톱", no_from="말+화면"))
        st.show(1800, 1830, 393)
        st.say(1800, "393번 손톱 만원에 선물 가격", row(1, 393, 10000, "손톱", no_from="말+화면"))
        st.say(1805, "393번 만원", row(2, 393, 10000, "손톱", no_from="말+화면"))
        self.assertEqual([c.args[1:3] for c in st.poster.reprice.call_args_list], [(393, 10000)])

    def test_right_price_is_not_repriced_to_a_tenth(self):
        # 305번을 350,000으로 맞게 보낸 뒤에도 LLM은 같은 줄을 두고 35,000("확실")을 되풀이했다 — 금액 고치기가 되돌리면 안 된다
        st = Stage(self)
        st.show(0, 60, 305)
        st.say(0, "305번 왕색금 35만원", row(0, 305, 350000, "왕색금", no_from="말+화면"))
        a = st.say(5, "자 305번 35", row(1, 305, 35000, "왕색금", no_from="말+화면"))
        st.say(9, "305번 35 왕색금", row(a, 305, 35000, "왕색금", no_from="말+화면"))
        st.say(13, "305번 35", row(a, 305, 35000, "왕색금", no_from="말+화면"))
        self.assertEqual(st.posted, [(305, 350000, "왕색금")])
        st.poster.reprice.assert_not_called()

    def test_price_of_the_next_product_does_not_reprice_the_tag_still_up(self):
        # 379번 손톱 2만원을 보낸 뒤 번호표를 든 채 다음 상품 값을 말했다 — 번호를 다시 부르지도 번호표가 다시 나타나지도 않았으니 금액을 고치지 않는다
        st = Stage(self)
        st.show(0, 60, 379)
        st.say(0, "379번 손톱 2만원", row(0, 379, 20000, "손톱", no_from="말+화면"))
        st.say(8, "자 이거는 10만원", row(1, 379, 100000, None))
        st.say(12, "10만원 갑니다", row(2, 379, 100000, None))
        st.say(16, "자 10만원", row(3, 379, 100000, None))
        st.poster.reprice.assert_not_called()
        self.assertEqual(st.posted, [(379, 20000, "손톱")])


class NameAndCallTest(unittest.TestCase):
    def test_name_is_fixed_only_to_a_dictionary_name(self):
        # 이름 고치기(D-SCR-07)도 사전을 거친다: 확실하다는 답이 여러 번이어도 사전에 없는 이름으로는 고치지 않는다
        st = Stage(self)
        st.show(0, 60, 426)
        st.say(0, "426번 35만원", row(0, 426, 350000, None, no_from="말+화면"))
        a = st.say(5, "426번 창입성 세금", row(1, 426, 350000, "창입성 색금", no_from="말+화면"))
        st.say(9, "426번 예쁘죠", row(a, 426, 350000, "창입성 색금", no_from="말+화면"))
        st.say(13, "426번 보세요", row(a, 426, 350000, "창입성 색금", no_from="말+화면"))
        st.poster.rename.assert_not_called()
        b = st.say(17, "426번 창녹색금", row(4, 426, 350000, "창녹색금", no_from="말+화면"))
        st.say(21, "426번 창녹색금 35만원", row(b, 426, 350000, "창녹색금", no_from="말+화면"))
        st.say(25, "426번 창녹색금", row(b, 426, 350000, "창녹색금", no_from="말+화면"))
        self.assertEqual([c.args[1:3] for c in st.poster.rename.call_args_list], [(426, "창녹색금")])

    def test_name_agreed_by_llm_and_dictionary_is_not_changed_later(self):
        # 411번 팔색조 색금: LLM과 사전이 같아 굳은 이름 — 뒤에 "팔색조"라는 확실한 답이 여러 번 와도 바꾸지 않는다
        st = Stage(self)
        st.show(0, 60, 411)
        st.say(0, "411번 팔색조 색금 25만원", row(0, 411, 250000, "팔색조 색금", no_from="말+화면"))
        self.assertTrue(st.kinds("LLM등록")[0]["why_name"].startswith("LLM과 사전이 같음"))
        for k, sec in enumerate((70, 74, 78, 82)):                           # 번호를 다시 불러 물음이 나가게 한다
            st.say(sec, "411번 팔색조 30만원 갔던 거", row(k + 1, 411, 250000, "팔색조", no_from="말+화면"))
        self.assertGreater(len(st.asked), 1)
        st.poster.rename.assert_not_called()

    def test_name_is_checked_against_the_dictionary(self):
        st = Stage(self)
        st.show(0, 9, 222)
        st.say(0, "222번 세금 최상급 130만원", row(0, 222, 1300000, "세검", no_from="말+화면"))
        st.show(20, 29, 307)
        st.say(20, "307번 제곱 만원", row(1, 307, 10000, "제곱", no_from="말+화면"))
        st.show(40, 49, 236)
        st.say(40, "236번 만원 달빛정원님 잡으셨습니다", row(2, 236, 10000, "달빛정원", no_from="말+화면"))
        st.show(60, 69, 308)
        st.say(60, "308번 녹음에지는 5만원", row(3, 308, 50000, "녹음에지는", no_from="말+화면"))
        self.assertEqual(st.posted, [(222, 1300000, "색금"), (307, 10000, ""), (236, 10000, ""), (308, 50000, "")])

    def test_settled_number_is_not_asked_again(self):
        st = Stage(self)
        st.show(0, 40, 377)
        st.say(0, "377번 녹금 5만원", row(0, 377, 50000, "녹금", no_from="말+화면"))
        self.assertEqual(len(st.asked), 1)
        st.say(5, "만족하실 거예요 원래 이런 색이에요")                     # '만'·'원'이 있지만 번호도 금액도 아니다
        st.say(9, "377 잡으셨습니다 감사합니다")
        self.assertEqual(len(st.asked), 1)
        self.assertEqual(st.worker.skipped, {1, 2})
        st.say(13, "자 다음은 3만원")                                       # 금액을 말했다 — 다음 상품일 수 있으니 묻는다
        self.assertEqual(len(st.asked), 2)

    def test_old_logic_switch_sends_the_first_answer(self):
        # LLM_REG_SAFE=0(되돌리기·재현 비교): 2026-11-12 방송 때처럼 첫 답으로 바로 보낸다
        st = Stage(self, safe=False)
        st.show(0, 3, 372)
        st.show(4, 5, 2)
        st.say(4, "8만원 갑니다 8만원", row(0, 2, 80000, "팔색조"))
        self.assertEqual(st.posted, [(2, 80000, "팔색조")])


if __name__ == "__main__":
    unittest.main()
