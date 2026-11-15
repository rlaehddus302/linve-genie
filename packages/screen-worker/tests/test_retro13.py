# 2026-11-13 방송 복기 뒤 규칙(D-SCR-23~32, 개선 단계표 A·B단계) 시험.
# 줄은 그날 사례를 본떠 지어낸 것이다(손님 이름·실제 기록 없음). LLM·서버는 가짜 — 실제 codex·서버는 부르지 않는다.
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from sw import llm_live, post, variety
from test_llm_live_safe import Stage, row
from test_tentative import Http, PosterCase, caps


def ledger_file(case, names, habits=None):
    tmp = tempfile.TemporaryDirectory()
    case.addCleanup(tmp.cleanup)
    path = Path(tmp.name) / "ledger.json"
    path.write_text(json.dumps({"names": [{"name": n} for n in names], "habits": habits or {}}, ensure_ascii=False), encoding="utf-8")
    p = patch("sw.llm_live.SHOP_LEDGER", str(path))
    p.start()
    case.addCleanup(p.stop)


class RepriceTest(unittest.TestCase):
    def test_price_far_from_the_registered_one_is_asked_not_fixed(self):
        # 189번: 500만 원으로 맞게 등록된 뒤 "오백 갑니다"가 "5500원 갑니다"로 받아써졌다 — 900분의 1로 고치지 않는다(D-SCR-24)
        st = Stage(self)
        st.show(0, 120, 189)
        st.say(0, "189번 재고는 500만원", row(0, 189, 5000000, None, no_from="말+화면"))
        self.assertEqual(st.posted, [(189, 5000000, "")])
        st.say(20, "자 5500원 갑니다 189번", row(1, 189, 5500, None, no_from="말+화면"))
        st.say(24, "189번 5500원", row(2, 189, 5500, None, no_from="말+화면"))
        st.poster.reprice.assert_not_called()
        cards = st.kinds("LLM가격확인카드")
        self.assertEqual([(c["no"], c["from"], c["to"]) for c in cards], [(189, 5000000, 5500)])
        self.assertIn("배 넘게", cards[0]["why"])

    def test_price_heard_after_the_next_product_is_asked_not_fixed(self):
        # 36번(3만 원) 뒤에 50번이 올라왔다. 그 뒤 "36번 … 10만원"(50번 값)이 두 번 들려도 저절로 고치지 않는다(D-SCR-24)
        st = Stage(self)
        st.show(0, 20, 36)
        st.say(0, "36번 홍경 3만원", row(0, 36, 30000, "홍경", no_from="말+화면"))
        st.show(30, 50, 50)
        st.say(30, "50번 녹금 10만원", row(1, 50, 100000, "녹금", no_from="말+화면"))
        st.show(100, 130, 36)
        st.say(100, "36번 빨리 데리고 가구요 10만원", row(2, 36, 100000, "홍경", no_from="말+화면"))
        st.say(104, "36번 10만원 가려요", row(3, 36, 100000, "홍경", no_from="말+화면"))
        st.poster.reprice.assert_not_called()
        cards = st.kinds("LLM가격확인카드")
        self.assertEqual([(c["no"], c["from"], c["to"]) for c in cards], [(36, 30000, 100000)])
        self.assertIn("50번", cards[0]["why"])

    def test_price_said_again_for_the_latest_product_is_still_fixed(self):
        # 26번: "23"으로 들렸다가 곧 "24만원"을 거듭 말했다 — 아직 그 상품 차례라 지금처럼 고친다
        st = Stage(self)
        st.show(0, 60, 26)
        st.say(0, "26번 23만원", row(0, 26, 230000, None, no_from="말+화면"))
        st.say(10, "26번 24만원", row(1, 26, 240000, None, no_from="말+화면"))
        st.say(14, "26번 24만원 갑니다", row(2, 26, 240000, None, no_from="말+화면"))
        self.assertEqual([c.args[1:3] for c in st.poster.reprice.call_args_list], [(26, 240000)])

    def test_a_lower_price_said_once_is_asked(self):
        # 83번: 6만 원 뒤 "83번 재고 5만원"을 한 번만 말했다 — 같은 답 2번을 기다리다 놓치지 않고 물을 것을 남긴다(D-SCR-25)
        st = Stage(self)
        st.show(0, 60, 83)
        st.say(0, "83번 6만원", row(0, 83, 60000, None, no_from="말+화면"))
        st.say(20, "83번 재고 5만원", row(1, 83, 50000, None, no_from="말+화면"))
        st.poster.reprice.assert_not_called()
        self.assertEqual([(c["no"], c["from"], c["to"]) for c in st.kinds("LLM가격확인카드")], [(83, 60000, 50000)])


    def test_a_price_in_a_line_without_the_number_is_not_asked(self):
        # 334번 번호표가 남아 있는 동안 다음 상품 값("요거 3만원")을 말했다 — 번호를 말하지 않은 줄로는 고치지도 묻지도 않는다(D-SCR-25)
        st = Stage(self)
        st.show(0, 60, 334)
        st.say(0, "334번 7만원", row(0, 334, 70000, None, no_from="말+화면"))
        st.say(20, "환엽 지젤인데 요거 3만원", row(1, 334, 30000, None))
        st.say(24, "요거 3만원 갑니다", row(2, 334, 30000, None))
        st.poster.reprice.assert_not_called()
        self.assertEqual(st.kinds("LLM가격확인카드"), [])


class NoPriceTest(unittest.TestCase):
    def test_tag_only_product_is_put_up_as_tentative_with_the_only_amount_said(self):
        # 124번: 판매자가 번호를 말하지 않았고 번호표만 오래 보였다. 그동안 말한 금액이 하나면 확인 중으로 올린다(D-SCR-27)
        from test_tentative import TStage
        st = TStage(self)
        st.show(0, 40, 124)
        st.say(5, "금휘금 이거 예쁘죠")
        st.say(12, "자 이거 15만원 갑니다")
        st.show(60, 62, 125)                                 # 번호표가 치워진 뒤에 본다
        st.wait(20)
        ups = [b for kind, _, b in st.srv.calls if kind == "tentative"]
        self.assertEqual([(b["no"], b["price"]) for b in ups], [(124, 150000)])
        self.assertEqual([e["no"] for e in st.kinds("LLM규칙후보")], [124])


class TenTimesTest(unittest.TestCase):
    def test_two_amounts_ten_times_apart_are_not_settled(self):
        # 241번: 한 상품에 "30"과 "300"이 같이 들렸다 — 단위를 말하지 않았으면 어느 쪽인지 정하지 않는다(D-SCR-26)
        st = Stage(self)
        st.show(0, 30, 241)
        st.say(0, "241번 깨비 30 300", row(0, 241, 300000, "깨비", no_from="말+화면"))
        self.assertEqual(st.posted, [])
        st.wait(llm_live.PRICE_WAIT + 1)
        ask = st.kinds("LLM확인요청")
        self.assertEqual([e["no"] for e in ask], [241])
        self.assertIn("같이 들림", ask[0]["why"])

    def test_ten_times_the_registered_price_said_later_is_asked(self):
        # 241번: 2만 원으로 등록된 뒤 "241번 제곱 20"이 들렸다 — 20만 원으로 바로 고치지는 않고 물을 것을 남긴다(D-SCR-26)
        st = Stage(self)
        st.show(0, 60, 241)
        st.say(0, "241번 깨비 2만원", row(0, 241, 20000, "깨비", no_from="말+화면"))
        st.say(10, "자 241번 제곱 20", row(1, 241, 200000, "깨비", no_from="말+화면"))
        st.poster.reprice.assert_not_called()
        self.assertEqual([(c["no"], c["from"], c["to"]) for c in st.kinds("LLM가격확인카드")], [(241, 20000, 200000)])

    def test_an_amount_said_with_its_unit_is_settled(self):
        st = Stage(self)
        st.show(0, 30, 241)
        st.say(0, "241번 깨비 30만원 300", row(0, 241, 300000, "깨비", no_from="말+화면"))
        self.assertEqual([(no, price) for no, price, _ in st.posted], [(241, 300000)])


class RenumberTest(unittest.TestCase):
    def test_number_said_twice_with_its_price_is_not_moved(self):
        # 6번: "6번 60만원"을 두 번 말했다. 64초 뒤 다음 상품의 번호표 17이 보여도 6번을 17번으로 옮기지 않는다(D-SCR-23)
        st = Stage(self)
        st.say(0, "6번 60만원", row(0, 6, 600000, None, no_from="말"))
        st.say(5, "6번 종자 60만원", row(1, 6, 600000, "종자", no_from="말"))
        self.assertEqual([(no, price) for no, price, _ in st.posted], [(6, 600000)])
        st.show(20, 40, 17)
        st.wait(5)
        st.poster.renumber.assert_not_called()
        self.assertEqual([(e["no"], e["screen_no"]) for e in st.kinds("LLM번호그대로")], [(6, 17)])

    def test_number_said_once_is_still_moved_to_the_tag_on_screen(self):
        # 107번: 받아쓰기가 "107번 3만원"으로 한 번 적었고 화면에는 167번만 보였다 — 지금처럼 167번으로 옮긴다
        st = Stage(self)
        st.say(0, "107번 3만원", row(0, 107, 30000, None, no_from="말"))
        st.show(2, 30, 167)
        st.wait(5)
        self.assertEqual([c.args[1:3] for c in st.poster.renumber.call_args_list], [(107, 167)])


class WithdrawCueTest(unittest.TestCase):
    def test_seller_taking_the_tag_off_is_asked_about_the_product_being_introduced(self):
        # 153번: "손톱 2만원" 직후 "번호 떼". 그 말이 들릴 때 153번은 아직 등록 전이고 앞 상품 140번만 올라가 있었다 —
        # 조금 기다렸다가 그 말 직전에 소개를 시작한 상품(153번)에 묻는다. 앞 상품(140번)에 붙이지 않는다(D-SCR-28)
        st = Stage(self)
        st.show(0, 20, 140)
        st.say(0, "140번 5만원", row(0, 140, 50000, None, no_from="말+화면"))
        st.show(100, 160, 153)
        st.say(100, "153번 손톱 2만원")                                     # LLM 답이 아직 없다
        st.say(105, "아니 이거 샤샤예요 번호 떼 번호 떼")
        self.assertEqual(st.kinds("LLM거두기확인카드"), [])
        st.say(110, "153번 손톱 2만원 맞죠", row(1, 153, 20000, "손톱", no_from="말+화면"))
        st.say(140, "자 다음 갑니다")
        self.assertEqual([e["no"] for e in st.kinds("LLM거두기확인카드")], [153])


class ShopNameTest(unittest.TestCase):
    def test_a_name_missing_from_every_list_is_sent_as_unsure(self):
        # 175번 슬로건: LLM이 맞게 적었는데 사전에 없다고 버리지 않는다 — 확인 중 품종으로 보낸다(D-SCR-29·30)
        ledger_file(self, [])
        st = Stage(self)
        st.show(0, 30, 175)
        st.say(0, "175번 슬로건 50만원", row(0, 175, 500000, "슬로건", no_from="말+화면"))
        self.assertEqual(st.posted, [(175, 500000, "슬로건")])
        self.assertTrue(st.kinds("LLM등록")[0]["name_unsure"])

    def test_spelling_is_fixed_to_the_shop_ledger(self):
        # 셀브로 → 쉘브르, 테라로사 색금은 "색금"으로 줄이지 않는다(D-SCR-29·31)
        ledger_file(self, ["쉘브르", "테라로사", "은갈치", "퍼플"])
        st = Stage(self)
        st.show(0, 9, 104)
        st.say(0, "104번 셀브로 3만원", row(0, 104, 30000, "셀브로", no_from="말+화면"))
        st.show(20, 29, 158)
        st.say(20, "158번 테라로사 세금 5만원", row(1, 158, 50000, "테라로사 색금", no_from="말+화면"))
        st.show(40, 49, 266)
        st.say(40, "266번 은갈치 퍼플 3만원", row(2, 266, 30000, "은갈치퍼플", no_from="말+화면"))
        self.assertEqual(st.posted, [(104, 30000, "쉘브르"), (158, 50000, "테라로사색금"), (266, 30000, "은갈치")])
        self.assertEqual([e["name_unsure"] for e in st.kinds("LLM등록")], [False, False, False])

    def test_words_that_are_not_varieties_are_still_dropped(self):
        ledger_file(self, [])
        st = Stage(self)
        st.show(0, 9, 307)
        st.say(0, "307번 제곱 만원", row(0, 307, 10000, "제곱", no_from="말+화면"))
        st.show(20, 29, 236)
        st.say(20, "236번 만원 달빛정원님 잡으셨습니다", row(1, 236, 10000, "달빛정원", no_from="말+화면"))
        self.assertEqual(st.posted, [(307, 10000, ""), (236, 10000, "")])

    def test_pattern_word_alone_follows_the_shop_habit(self):
        # 125번: 이름 없이 "색금"만 말했다. 이 가게는 그런 상품을 SP로 적는다(D-SCR-32)
        ledger_file(self, [], {"색금": "SP"})
        st = Stage(self)
        st.show(0, 9, 125)
        st.say(0, "125번 세금 3만원", row(0, 125, 30000, "색금", no_from="말+화면"))
        self.assertEqual(st.posted, [(125, 30000, "SP")])

    def test_count_is_kept_apart_from_the_name(self):
        ledger_file(self, ["채홍"])
        st = Stage(self)
        st.show(0, 9, 66)
        st.say(0, "66번 채용 3개 3만원", row(0, 66, 30000, "채용 3개", no_from="말+화면"))
        self.assertEqual(st.posted, [(66, 30000, "채홍")])
        self.assertEqual(st.kinds("LLM등록")[0]["qty"], "3개")


class RepickTest(unittest.TestCase):
    """D-SCR-34 ~ 36: 장부 이름을 받아쓰기에서 찾기, 보낸 뒤 답까지 모아 다시 고르기, 손님 이름·모양 말 거르기 (줄은 그날 사례를 본떠 지어낸 것)"""

    def test_blank_filled_with_a_wrong_word_is_still_fixed_to_the_ledger_name(self):
        # 83번: 처음에는 이름 없이 올라갔고, 뒤 답이 "모즈" 두 번·"킹스톤" 네 번이었다. 옛 방식은 먼저 두 번 나온 모즈로 채우고 더 고치지 않았다
        ledger_file(self, ["킹스톤", "쿠스"])
        st = Stage(self)
        st.show(0, 60, 83)
        st.say(0, "83번 6만원", row(0, 83, 60000, None, no_from="말+화면"))
        self.assertEqual(st.posted, [(83, 60000, "")])
        st.say(6, "모즈 좋네요 83번", row(1, 83, 60000, "모즈", no_from="말+화면"))
        st.say(9, "83번 6만원 모즈", row(2, 83, 60000, "모즈", no_from="말+화면"))
        for k, sec in enumerate((12, 15, 18, 21)):
            st.say(sec, "83번 6만원", row(3 + k, 83, 60000, "킹스턴", no_from="말+화면"))
        self.assertEqual(st.kinds("LLM이름고치기")[-1]["to"], "킹스톤")
        self.assertNotIn("name_unsure", st.kinds("LLM이름고치기")[-1])

    def test_name_on_the_server_is_kept_when_the_product_is_offered_again_without_a_name(self):
        # 13번: 레다색금으로 올라간 뒤 판매자가 다시 내놓았고 그때 LLM은 "색금"만 적었다. 서버는 다시 보낸 등록을 무시하므로(R-2) 이름은 레다색금 그대로여야 한다
        ledger_file(self, ["레다", "킹스톤"])
        st = Stage(self)
        st.show(0, 9, 13)
        st.say(0, "13번 레다 색금 20만원", row(0, 13, 200000, "레다 색금", no_from="말+화면"))
        st.show(20, 29, 14)
        st.say(20, "14번 킹스톤 5만원", row(1, 14, 50000, "킹스톤", no_from="말+화면"))
        st.show(300, 330, 13)
        st.say(300, "아까 13번 다시 갑니다 13번 20만원", row(2, 13, 200000, None, no_from="말+화면"))
        st.say(306, "13번 색금 20만원", row(3, 13, 200000, "색금", no_from="말+화면"))
        st.say(310, "13번 색금 20만원 갑니다", row(4, 13, 200000, "색금", no_from="말+화면"))
        self.assertEqual(st.worker.names[13]["now"], "레다색금")
        self.assertEqual([e for e in st.kinds("LLM이름고치기") if e["no"] == 13], [])

    def test_blank_name_on_the_server_is_filled_when_the_product_is_offered_again_with_a_name(self):
        # 처음에는 이름 없이 올라갔다. 다시 내놓을 때 고른 이름은 등록으로는 서버에 닿지 않으므로(R-2) 이름 고치기로 채운다
        ledger_file(self, ["킹스톤"])
        st = Stage(self)
        st.show(0, 9, 31)
        st.say(0, "31번 40만원", row(0, 31, 400000, None, no_from="말+화면"))
        st.show(20, 29, 14)
        st.say(20, "14번 5만원", row(1, 14, 50000, None, no_from="말+화면"))
        st.show(300, 330, 31)
        st.say(300, "아까 31번 다시 갑니다 킹스톤 31번 40만원", row(2, 31, 400000, "킹스톤", no_from="말+화면"))
        self.assertEqual(st.worker.names[31]["now"], "킹스톤")
        st.poster.rename.assert_called_once()
        self.assertEqual(st.poster.rename.call_args.args[1:3], (31, "킹스톤"))

    def test_a_name_the_seller_denies_is_not_counted(self):
        # 41번: "요거는 아베 아니죠", "아베가 아니고 교배종" — 아니라고 한 이름을 받아쓰기에 두 번 나왔다고 품종으로 적었다
        lines = [(0, "자 요거는 아베 아니죠"), (3, "41번 5만원 아베가 아니고 교배종 같은데")]
        self.assertEqual(variety.denied("아베", lines), 2)
        ledger = variety.Ledger(names=["아베", "황소"])
        self.assertEqual(variety.ledger_said(lines + [(6, "청사 아니야 황소야 황소로 갈게")], ledger), {"황소": 1})
        self.assertEqual(variety.pick_shop([], lines, variety.Dictionary(seller=False), variety.Ledger())[0], "")

    def test_two_letter_words_are_matched_strictly(self):
        ledger = variety.Ledger(names=["채홍", "쿠스", "열애"])
        self.assertEqual(ledger.near("청송")[0], None)                          # 248번: "청송"(청수)이 채홍으로 맞춰졌다
        self.assertEqual([ledger.near(x)[0] for x in ("채용", "구스", "열혜")], ["채홍", "쿠스", "열애"])

    def test_ledger_name_said_twice_is_used_when_the_llm_wrote_none(self):
        # 46번: LLM은 이름을 적지 않았는데 판매자는 "아웃사이드"를 두 번 말했다 — 장부에 있는 이름이라 그대로 쓴다
        ledger_file(self, ["아웃사이드", "황소"])
        st = Stage(self)
        st.show(0, 30, 46)
        st.say(0, "자 이거 아웃사이드 3만원", None)
        st.say(4, "46번 아웃사이드라 카드 3만원", row(1, 46, 30000, None, no_from="말+화면"))
        self.assertEqual(st.posted, [(46, 30000, "아웃사이드")])
        self.assertFalse(st.kinds("LLM등록")[0].get("name_unsure"))

    def test_customer_called_with_a_title_or_thanked_is_not_a_variety(self):
        # "별빛사장님", "모래시계 감사합니다": 손님 이름이다(지어낸 이름). 품종 칸에 넣지 않는다
        self.assertEqual(variety.nicknames([(0, "별빛사장님 잡았다 모래시계 감사합니다 79번 감사드립니다 정말 감사합니다")]), {"별빛사장", "별빛", "모래시계"})
        ledger_file(self, [])
        st = Stage(self)
        st.show(0, 9, 159)
        st.say(0, "159번 5만원 별빛사장님 감사드리고요", row(0, 159, 50000, "별빛", no_from="말+화면"))
        st.show(20, 29, 118)
        st.say(20, "118번 10만원 모래시계 감사합니다", row(1, 118, 100000, "모래시계", no_from="말+화면"))
        self.assertEqual(st.posted, [(159, 50000, ""), (118, 100000, "")])

    def test_customer_called_twice_earlier_in_the_broadcast_is_not_a_variety(self):
        # 앞에서 두 번 "한강님"으로 불린 손님(지어낸 이름) — 그 상품 줄에 "님"이 없어도 품종으로 고르지 않는다. 장부에 있는 이름은 그대로 쓴다
        ledger_file(self, ["황소"])
        st = Stage(self)
        st.show(0, 9, 10)
        st.say(0, "10번 만원 한강님 황소님 감사합니다", row(0, 10, 10000, None, no_from="말+화면"))
        st.show(20, 29, 11)
        st.say(20, "11번 만원 한강님 황소님 잡았다", row(1, 11, 10000, None, no_from="말+화면"))
        st.show(100, 109, 172)
        st.say(100, "172번 한강 만원", row(2, 172, 10000, "한강", no_from="말+화면"))
        st.show(200, 209, 129)
        st.say(200, "129번 황소 15만원", row(3, 129, 150000, "황소", no_from="말+화면"))
        self.assertEqual(st.posted[2:], [(172, 10000, ""), (129, 150000, "황소")])

    def test_words_about_shape_are_not_varieties(self):
        for word in ("청수", "장입성", "모주", "직배"):
            self.assertEqual(variety.not_a_name(word), "품종이 아닌 말")

    def test_pattern_words_as_the_transcript_writes_them(self):
        self.assertEqual(variety.split_parts("찐노"), ("", "찐녹", "", ""))
        self.assertEqual(variety.split_parts("진농"), ("", "찐녹", "", ""))
        self.assertEqual(variety.split_parts("창록금"), ("", "창녹금", "", ""))
        self.assertEqual(variety.split_parts("연두찐농"), ("연두", "찐녹", "", ""))
        self.assertEqual(variety.pattern_said([(0, "이름 없네 SP로 갑니다"), (3, "SP로 드렸네 세금 예쁘다")]), {"SP": 2, "색금": 1})

    def test_ledger_names_found_in_the_transcript(self):
        ledger = variety.Ledger(names=["쿠스", "황소", "킹스톤", "아웃사이드", "색금", "금휘"])
        said = variety.ledger_said([(0, "46번 아웃사이드라 카드 쿠스 3만원"), (4, "황소로 갈게 황소 킹스턴이 좋네 세금")], ledger)
        self.assertEqual(said, {"아웃사이드": 1, "쿠스": 1, "황소": 1, "킹스톤": 1})                 # 무늬 말뿐인 장부 이름(색금)은 세지 않는다
        self.assertEqual(variety.ledger_said([(0, "금이 너무 예뻐요 구스 황새 좋네요")], ledger), {})  # 두 글자 이름은 글자가 같을 때만("금이"는 금휘가 아니다)
        said = variety.ledger_said([(0, "46번 아웃사이드라 카드 3만원")], ledger, no=46)
        self.assertEqual(said, {"아웃사이드": 2})                                                   # 번호 바로 옆에서 말한 이름은 두 번으로 센다

    def test_ledger_name_beats_an_unknown_word_written_more_often(self):
        ledger = variety.Ledger(names=["야래향"])
        name, why, _, unsure, extra = variety.pick_shop(["아리랑", "아리랑", "야래향"], [], None, ledger)
        self.assertEqual((name, unsure, extra["rank"]), ("야래향", False, 2))
        name, _, _, unsure, _ = variety.pick_shop(["아리랑"] * 4 + ["야래향"], [], None, ledger)
        self.assertEqual((name, unsure), ("아리랑", True))

    def test_when_a_sent_name_is_changed(self):
        def ask(now, name, now_rank=0, **extra):
            return variety.should_rename(now, name, dict({"votes": 2, "rank": 0, "source": "LLM", "tally": {}}, **extra), now_rank)
        self.assertTrue(ask("", "킹스톤", votes=1, rank=2))                                 # 빈칸 ← 장부 이름
        self.assertFalse(ask("", "모즈", votes=1))                                          # 빈칸 ← 모르는 이름 한 번
        self.assertTrue(ask("", "모즈", votes=2))
        self.assertFalse(ask("색금", "깜무쌍색금", votes=3))                                 # 무늬 말 → 모르는 이름: 바꾸지 않는다
        self.assertTrue(ask("색금", "테라로사색금", votes=2, rank=2))                         # 무늬 말 → 장부 이름
        self.assertFalse(ask("킹스톤", "모즈", 2, votes=5))                                  # 장부 이름 → 모르는 이름: 바꾸지 않는다
        self.assertTrue(ask("모즈", "킹스톤", 0, votes=2, rank=2))
        self.assertFalse(ask("창찐녹", "윤슬색금", 0, votes=1, rank=2))                       # 지금 이름이 이 답들에 없는데(다른 장면) 한 번 나온 장부 이름
        self.assertTrue(ask("모즈", "킹스톤", 0, votes=1, rank=2, tally={"모즈": 1}))         # 같은 답들 안에서 장부 이름이 모르는 이름만큼 나옴
        self.assertTrue(ask("테라로사", "테라로사색금", 2, votes=1, rank=2))                  # 같은 품종에 무늬 말이 붙음
        self.assertFalse(ask("킹스톤", "색금", 2, source="무늬 말"))                          # 장부 이름 → 무늬 말: 바꾸지 않는다
        self.assertTrue(ask("덜키산", "색금", 0, source="무늬 말"))


class LedgerTest(unittest.TestCase):
    def test_split_parts(self):
        self.assertEqual(variety.split_parts("테라로사 색금"), ("테라로사", "색금", "", ""))
        self.assertEqual(variety.split_parts("채홍 3개"), ("채홍", "", "", "3개"))
        self.assertEqual(variety.split_parts("열애 통째"), ("열애", "", "", "통째"))
        self.assertEqual(variety.split_parts("황소윗동"), ("황소", "", "윗동", ""))
        self.assertEqual(variety.split_parts("최강노금"), ("최강", "녹금", "", ""))
        self.assertEqual(variety.split_parts("세금"), ("", "색금", "", ""))
        self.assertEqual(variety.split_parts("힘줄색금"), ("", "힘줄색금", "", ""))

    def test_near_folds_sounds_the_transcript_mixes_up(self):
        L = variety.Ledger(names=["쉘브르", "라비홍", "열애", "채홍", "쿠스", "뱅갈", "에일리", "청춘", "삼광", "아웃사이더", "아웃사이드"])
        for heard, name in (("셀브로", "쉘브르"), ("라비용", "라비홍"), ("열혜", "열애"), ("채용", "채홍"), ("코스", "쿠스"), ("구스", "쿠스"), ("벵갈", "뱅갈"), ("엘리", "에일리")):
            self.assertEqual(L.near(heard)[0], name, heard)
        self.assertEqual(L.near("아웃사이드")[0], "아웃사이드")
        for heard in ("청수", "산마", "헐크", "이루기"):                     # 짧은 말은 엄하게 — 다른 품종에 붙지 않는다
            self.assertIsNone(L.near(heard)[0], heard)

    def test_name_inside_a_longer_word(self):
        L = variety.Ledger(names=["은갈치", "퍼플", "밀레", "황소"])
        self.assertEqual(L.inside("은갈치퍼플"), "은갈치")
        self.assertEqual(L.inside("밀레창"), "밀레")
        self.assertIsNone(L.inside("밀레니엄"))


class RenumberAfterRegisterTest(PosterCase, unittest.TestCase):
    def test_renumber_waits_for_the_register_answer(self):
        # 620·107번: 등록과 번호 바로잡기를 같은 순간에 보내 바로잡기가 먼저 닿았다("그런 상품 없음") — 등록 답을 본 뒤에 보낸다(D-SCR-23)
        gate = threading.Event()

        def register(body):
            gate.wait(2)
            return 200, {"ok": True, "changed": True, "broadcasts": [{"changed": True}]}

        http = Http(capabilities=(200, caps()), register=register, renumber=(200, {"ok": True, "changed": True, "broadcasts": [{"changed": True}]}))
        poster = self.poster(http)
        poster.refresh()
        rid = "screen-abcdefghijk-107-1763000361000"
        box = []
        poster.send(dict(post.make_body("abcdefghijk", 107, 30000, ""), requestId=rid), on_result=box.append)
        poster.renumber("abcdefghijk", 107, 167, rid)
        threading.Event().wait(0.3)
        self.assertNotIn("renumber", [name for name, _ in http.seen])       # 등록 답이 오기 전에는 나가지 않는다
        gate.set()
        self.wait(box)
        for _ in range(200):
            if "renumber" in [name for name, _ in http.seen]:
                break
            threading.Event().wait(0.01)
        self.assertEqual([name for name, _ in http.seen][-2:], ["register", "renumber"])

    def test_renumber_is_sent_again_when_the_product_is_not_there_yet(self):
        answers = [(200, {"ok": True, "changed": False, "broadcasts": [{"changed": False, "skip": "NO_PRODUCT"}]}),
                   (200, {"ok": True, "changed": True, "broadcasts": [{"changed": True}]})]
        http = Http(capabilities=(200, caps()), renumber=lambda body: answers.pop(0))
        poster = self.poster(http)
        poster.refresh()
        with patch.object(post, "RENUMBER_GAP", 0.05):
            poster.renumber("abcdefghijk", 620, 38, "screen-abcdefghijk-620-1")
            for _ in range(200):
                if not answers:
                    break
                threading.Event().wait(0.01)
        self.assertEqual([name for name, _ in http.seen].count("renumber"), 2)


if __name__ == "__main__":
    unittest.main()
