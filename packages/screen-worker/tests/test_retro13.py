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


class NameAskTest(unittest.TestCase):
    """D-SCR-37: 상품마다 한 번 품종만 묻기. LLM은 가짜 — 묻는 글과 답을 시험이 쥔다"""

    def stage(self, ledger, answers, **kw):
        """answers = {번호: 답(dict)} — 그 번호를 물으면 그 답을 준다"""
        ledger_file(self, ledger)
        self.asked = []

        def fake(user):
            no = int(user.split("\n")[0].split(":")[1])
            self.asked.append((no, user))
            return json.dumps(answers.get(no) or {"name": "", "pattern": "", "quote": "", "in_ledger": False, "confidence": "low"}, ensure_ascii=False)
        for target, value in (("sw.llm_live.NAME_ASK", True), ("sw.llm_live.NAME_ASK_SYNC", True), ("sw.llm_live.ask_name", fake)):
            p = patch(target, value)
            p.start()
            self.addCleanup(p.stop)
        return Stage(self, **kw)

    def test_a_name_filled_by_the_question_can_still_be_fixed_by_later_register_answers(self):
        # 빈칸을 묻기 답(모르는 이름)으로 채운 뒤에도, 등록 답이 장부 이름을 거듭 내면 그 이름으로 바꾼다 — 이름으로 채운 것은 굳히지 않는다
        st = self.stage(["킹스톤"], {83: {"name": "모즈", "pattern": "", "quote": "", "in_ledger": False, "confidence": "high"}})
        st.show(0, 90, 83)
        st.say(0, "83번 6만원", row(0, 83, 60000, None, no_from="말+화면"))
        st.say(30, "83번 6만원 갑니다", row(1, 83, 60000, None, no_from="말+화면"))
        self.assertEqual(st.worker.names[83]["now"], "모즈")
        asked = len(st.asked)
        st.say(40, "83번 6만원", row(2, 83, 60000, "킹스턴", no_from="말+화면"))
        self.assertGreater(len(st.asked), asked)                                 # 이름 없이 올라간 번호는 묻기로 채운 뒤에도 전처럼 계속 묻는다
        st.say(44, "83번 6만원", row(3, 83, 60000, "킹스턴", no_from="말+화면"))
        self.assertEqual(st.worker.names[83]["now"], "킹스톤")

    def test_a_product_put_up_by_an_earlier_run_is_not_asked_about(self):
        # 일꾼이 다시 켜진 뒤 앞 실행이 올린 번호를 다시 보내면, 서버에 남은 이름을 모르므로 묻지도 덮어쓰지도 않는다(11-12 방송 326번)
        st = self.stage(["유아독존"], {326: {"name": "유아독존", "pattern": "", "quote": "", "in_ledger": True, "confidence": "high"}},
                        prior=[{"no": 326, "price": 30000, "name": "녹금종자"}])
        st.show(300, 330, 326)
        st.say(300, "아까 326번 다시 갑니다 326번 3만원", row(0, 326, 30000, None, no_from="말+화면"))
        st.say(340, "자 다음 갑니다", None)
        self.assertEqual(self.asked, [])
        st.poster.rename.assert_not_called()

    def test_another_products_price_is_still_told_apart_after_the_name_became_a_pattern_word(self):
        # 묻기로 이름이 무늬 말이 된 상품도, 등록 답들이 가리키던 이름으로 "앞 번호표가 남은 답"(금액·품종이 둘 다 다름)을 가린다
        st = self.stage(["오색글래머", "킹스톤"], {430: {"name": "", "pattern": "색금", "quote": "", "in_ledger": False, "confidence": "high"}})
        st.show(0, 200, 430)
        st.say(0, "430번 6만원", row(0, 430, 60000, None, no_from="말+화면"))
        st.say(10, "430번 오색글래머 6만원", row(1, 430, 60000, "오색글래머", no_from="말+화면"))
        st.say(30, "430번 6만원 갑니다", row(2, 430, 60000, "오색글래머", no_from="말+화면"))
        self.assertEqual(st.worker.names[430]["now"], "색금")
        self.assertEqual(st.worker._differs({"no": 430, "price": 50000, "variety": "킹스톤"}), "둘 다")

    def test_product_sold_by_its_pattern_word_only_loses_the_wrong_name(self):
        # 57번: 판매자는 "찐녹"이라고만 했는데 등록 답은 받아쓰기의 엉뚱한 말을 품종으로 적었다. 품종만 물으면 "이름 없이 찐녹"이라고 답한다
        st = self.stage(["킹스톤"], {57: {"name": "", "pattern": "찐녹", "quote": "이거 찐녹이네", "in_ledger": False, "confidence": "high"}})
        st.show(0, 60, 57)
        st.say(0, "57번 40만원 대신찐로 갑니다", row(0, 57, 400000, "대신찐로", no_from="말+화면"))
        self.assertEqual(st.posted, [(57, 400000, "대신찐로")])
        self.assertEqual(self.asked, [])                                        # 받아쓰기가 그 상품 뒤 25초까지 모이기 전에는 묻지 않는다
        st.say(30, "자 다음 갑니다", None)
        self.assertEqual([no for no, _ in self.asked], [57])
        self.assertEqual(st.poster.rename.call_args.args[1:3], (57, "찐녹"))
        st.say(40, "57번 40만원 대신찐로", row(2, 57, 400000, "대신찐로", no_from="말+화면"))
        st.say(44, "57번 40만원 대신찐로", row(3, 57, 400000, "대신찐로", no_from="말+화면"))
        self.assertEqual(st.worker.names[57]["now"], "찐녹")                     # 묻기로 정한 이름은 뒤 답으로 되돌리지 않는다
        self.assertEqual(len(self.asked), 1)                                    # 상품마다 한 번만 묻는다

    def test_blank_is_filled_and_an_unknown_name_is_fixed_to_the_ledger(self):
        st = self.stage(["맥라이징", "천나비"], {248: {"name": "맥라이징", "pattern": "", "quote": "", "in_ledger": True, "confidence": "high"},
                                              33: {"name": "천나비", "pattern": "금", "quote": "", "in_ledger": True, "confidence": "high"}})
        st.show(0, 9, 248)
        st.say(0, "248번 5만원", row(0, 248, 50000, None, no_from="말+화면"))
        st.show(40, 49, 33)
        st.say(40, "33번 찬나비 30만원", row(1, 33, 300000, "찬나비금", no_from="말+화면"))
        st.say(80, "자 다음 갑니다", None)
        renamed = [c.args[1:3] for c in st.poster.rename.call_args_list]
        self.assertIn((248, "맥라이징"), renamed)
        self.assertEqual(st.worker.names[33]["now"], "천나비금")

    def test_a_name_gathered_from_the_register_answers_is_not_replaced_by_another_name(self):
        # 이름과 이름이 다를 때는 등록 답을 모은 쪽을 둔다(131번: 토스카나색금 → 가우디색금으로 바꾸면 틀린다)
        st = self.stage(["토스카나", "가우디"], {131: {"name": "가우디", "pattern": "색금", "quote": "", "in_ledger": True, "confidence": "high"}})
        st.show(0, 9, 131)
        st.say(0, "131번 토스카나 세금 5만원", row(0, 131, 50000, "토스카나 색금", no_from="말+화면"))
        st.say(40, "자 다음 갑니다", None)
        self.assertEqual(len(self.asked), 1)
        st.poster.rename.assert_not_called()
        self.assertEqual([e["applied"] for e in st.kinds("LLM품종묻기")], [False])

    def test_the_question_hides_customer_names_and_marks_the_lines_with_the_number(self):
        from sw import llm_b4
        text = variety.ask_prompt(83, [(725, "자 6만원 갑니다 킹스톤"), (730, "83번 6만원 별빛님 감사합니다")], variety.Ledger(names=["쿠스", "색금"]), llm_b4.mask)
        self.assertEqual(text.split("\n")[:2], ["상품 번호: 83", "가게 장부: 쿠스"])       # 무늬 말뿐인 장부 이름은 싣지 않는다
        self.assertIn("*L1 [0:12:10] 83번 6만원 ○○님 감사합니다", text)
        self.assertNotIn("별빛", text)

    def test_when_the_answer_is_used(self):
        self.assertEqual(variety.ask_name_of({"name": "", "pattern": "종자 색금", "confidence": "high"}), ("종자색금", "무늬"))
        self.assertEqual(variety.ask_name_of({"name": "", "pattern": "색금", "confidence": "high"}, variety.Ledger(habits={"색금": "SP"})), ("SP", "무늬"))
        self.assertEqual(variety.ask_name_of({"name": "", "pattern": "금", "confidence": "high"}), ("", None))
        self.assertEqual(variety.ask_name_of({"name": "청수", "pattern": "", "confidence": "high"}), ("", None))
        self.assertEqual(variety.ask_name_of({"name": "셀브로", "pattern": "색금", "confidence": "high"}, variety.Ledger(names=["쉘브르"])), ("쉘브르색금", "장부"))
        self.assertTrue(variety.use_ask("", "모름", True))                        # 빈칸은 채운다
        self.assertFalse(variety.use_ask("", "모름", False))
        self.assertTrue(variety.use_ask("넘버원", "무늬", True, 2))                # 이름 없이 무늬 말로만 판 상품이라는 확실한 답
        self.assertFalse(variety.use_ask("넘버원", "무늬", False, 2))
        self.assertFalse(variety.use_ask("색금", "장부", True))                    # 지금이 무늬 말이면 둔다
        self.assertTrue(variety.use_ask("참나비", "장부", True, 0))                # 모르는 이름 → 장부 이름
        self.assertFalse(variety.use_ask("토스카나", "장부", True, 2))             # 이름과 이름이 다르면 지금 것


class CleanDictionaryTest(unittest.TestCase):
    """D-SCR-38: 품종과 옵션을 따로 본 품종 사전(sw/clean_dict.py → data/varieties_clean.json)"""

    def test_name_is_split_into_variety_options_forms_and_kinds(self):
        from sw import clean_dict
        self.assertEqual(clean_dict.split("몰디브색금무지"), ("몰디브", ["색금", "무지"], [], []))
        self.assertEqual(clean_dict.split("청개구리금 철화"), ("청개구리", ["금", "철화"], [], []))
        self.assertEqual(clean_dict.split("쿠스백금"), ("쿠스", ["백금"], [], []))
        self.assertEqual(clean_dict.split("아리엘 분채"), ("아리엘", [], ["분채"], []))
        self.assertEqual(clean_dict.split("먼로쌍두"), ("먼로", [], ["쌍두"], []))
        self.assertEqual(clean_dict.split("블루엘프특가"), ("블루엘프", [], [], []))
        self.assertEqual(clean_dict.split("SP아리아골드"), ("아리아골드", [], [], ["SP"]))
        self.assertEqual(clean_dict.split("SP창녹금"), ("", ["창녹금"], [], ["SP"]))          # 품종 없이 옵션뿐
        self.assertEqual(clean_dict.split("수입색금SP"), ("", ["색금"], [], ["SP", "수입"]))
        self.assertEqual(clean_dict.split("SP"), ("", [], [], ["SP"]))                       # SP는 옵션이 아니라 "품종 없음" 표시
        for read in ("에스피색금", "에스피 색금"):                                            # 한글로 읽어 적은 에스피는 SP로 합친다(D-DICT-SP-01)
            self.assertEqual(clean_dict.split(read), clean_dict.split("SP색금"), read)
        self.assertEqual(clean_dict.split("에스피"), clean_dict.split("SP"))
        self.assertEqual(clean_dict.split("에스피아리아골드"), ("아리아골드", [], [], ["SP"]))
        self.assertEqual(variety.split_parts("에스피 색금"), variety.split_parts("SP색금"))   # 방송 중 이름을 쪼갤 때도 같다
        self.assertEqual(variety.split_parts("에스피 금")[:2], ("", "SP금"))
        self.assertEqual(variety.split_parts("에스피")[:2], ("", "SP"))
        self.assertEqual(variety.split_parts("카에스피나")[0], "카에스피나")                 # 이름 가운데 든 글자는 건드리지 않는다
        # 2026-11-16 방송: 받아쓰기가 SP를 NSP·ASP·엔스피로 적어 3·7·14·484번이 "NSP"로 등록됐다(D-RETRO16-02)
        for read in ("NSP", "NSP 분채", "ASP", "엔스피", "nsp"):
            self.assertEqual(variety.split_parts(read)[:2], ("", "SP"), read)
        for keep in ("RASP", "TNSP", "카엔스피나"):                                          # 다른 말에 붙은 글자는 그대로
            self.assertEqual(variety.split_parts(keep)[1], "", keep)
        # 27번 "슈빌셋금 분채로 7000원" — 셋금은 색금, 분채(화분째)는 파는 꼴이라 이름에서 뗀다(D-RETRO16-01)
        self.assertEqual(variety.split_parts("슈빌셋금분채"), ("슈빌", "색금", "분채", ""))
        self.assertEqual(variety.split_parts("데뷔철화 분채"), ("데뷔", "철화", "분채", ""))
        self.assertEqual(variety.tidy("선셋금"), "선셋금")                                 # 사전 품종 선셋(금)은 그대로
        self.assertEqual(variety.tidy("썬셋금"), "썬셋금")
        self.assertEqual(variety.ask_name_of({"name": "", "pattern": "에스피", "confidence": "high"}), ("SP", "무늬"))
        for whole in ("황금사", "소금", "청수박", "녹금의 제왕", "마리아"):                    # 한 글자만 남게는 떼지 않는다 / 끝이 옵션 말이 아닌 이름
            self.assertEqual(clean_dict.split(whole)[1:], ([], [], []), whole)

    def test_cleaned_dictionary_has_varieties_only(self):
        from sw import clean_dict
        varieties, removed = clean_dict.build()
        names = {variety.norm(v["name"]) for v in varieties}
        self.assertIn("몰디브", names)
        self.assertIn("녹금의 제왕", {v["name"] for v in varieties})                         # 띄어 적은 이름은 띄어 적은 대로
        self.assertNotIn("몰디브색금", names)                                               # 옵션은 품종에 붙여 적는다
        maldives = next(v for v in varieties if v["name"] == "몰디브")
        self.assertIn("색금", maldives["options"])
        self.assertIn("손으로 만든 기본 사전", maldives["sources"])
        self.assertIn("지난 판매 영수증", maldives["sources"])
        for junk in ("다육방송", "다육판매영상", "배송비", "선인장", "SP색금", "녹금", "SP", "이벵"):
            self.assertNotIn(junk, names, junk)
        self.assertFalse([n for n in names if "님" in n])                                   # 손님을 부른 말이 없다
        self.assertFalse([v["name"] for v in varieties if "에스피" in v["name"] or any("에스피" in w for w in v["written"])])   # 에스피는 SP로 합쳤다(D-DICT-SP-01)
        gone = {r["name"]: r["why"] for r in removed}
        self.assertEqual(gone["SP색금"], "품종 없이 옵션·갈래뿐")
        self.assertEqual(gone["이벵"], "품종이 아닌 말")
        maek = next(v for v in varieties if v["name"] == "맥라이징")
        self.assertIn("창", maek["kinds"])                                                  # "창맥라이징"은 옵션 창 + 품종 맥라이징

    def test_generated_file_is_up_to_date_and_read_by_the_shop_mode(self):
        from sw import clean_dict
        varieties, removed = clean_dict.build()
        with open(Path(clean_dict.DATA) / "varieties_clean.json", encoding="utf-8") as f:
            on_disk = json.load(f)
        self.assertEqual(on_disk["varieties"], varieties)                                   # 원본 사전을 고쳤으면 python -m sw.clean_dict로 다시 만든다
        self.assertEqual(on_disk["removed"], removed)
        dic = variety.Dictionary(seller=True, clean=True)
        self.assertEqual(dic.names.get("몰디브"), "몰디브")
        self.assertEqual(dic.names.get("쿠스백금"), "쿠스백금")                               # 사전에 적혀 있던 그대로의 이름도 알아본다
        self.assertEqual(dic.names.get("삼강"), "삼광")                                      # 틀리게 들리는 모양은 품종으로
        self.assertNotIn("다육방송", dic.names)
        self.assertNotIn("SP색금", dic.names)
        old = variety.Dictionary(seller=True)
        self.assertIn(variety.norm("몰디브색금"), old.names)                                 # 옛 길(clean=False)은 정리 전 사전 그대로


class DynamicHintTest(unittest.TestCase):
    """D-SCR-39: 받아쓰기 힌트를 조각마다 다르게(시험 도구 sw/bench_stt_live.py). 모델은 가짜"""

    def test_candidates_are_the_ledger_names_that_sound_like_what_was_written(self):
        from sw import bench_stt_live as B
        ledger = variety.Ledger(names=["쉘브르", "킹스톤", "황소", "아웃사이드", "청개구리"])
        self.assertEqual(B.hint_candidates("자 104번 셀브로 3만원 킹스턴이 좋네요", ledger), ["킹스톤", "쉘브르"])
        self.assertEqual(B.hint_candidates("자 이거 3만원 빨리 잡아요", ledger), [])
        self.assertEqual(B.hint_candidates("황새가 날아가네 황소로 갈게요", ledger), ["황소"])       # 두 글자 품종은 소리가 같을 때만

    def test_a_piece_is_transcribed_again_only_when_it_has_candidates(self):
        from sw import bench_stt_live as B
        calls = []

        def stt(pcm, hint=None):
            calls.append(hint)
            if hint is None:
                return [(0, 1, pcm, None)]
            return [(0, 1, pcm.replace("셀브로", "쉘브르") if "쉘브르" in hint else pcm, None)]
        stats = {}
        run = B.hint_dynamic(stt, variety.Ledger(names=["쉘브르", "킹스톤"]), ["색금"], stats)
        self.assertEqual(run("104번 셀브로 3만원")[0][2], "104번 쉘브르 3만원")
        self.assertEqual(calls, [None, "쉘브르, 색금."])
        self.assertEqual(run("자 이거 3만원")[0][2], "자 이거 3만원")                                 # 후보가 없으면 한 번만
        self.assertEqual(stats, {"segments": 2, "again": 1})

    def test_text_that_only_copies_the_hint_is_thrown_away(self):
        from sw import bench_stt_live as B
        stt = lambda pcm, hint=None: [(0, 1, "셀브로" if hint is None else "쉘브르, 색금.", None)]
        stats = {}
        run = B.hint_dynamic(stt, variety.Ledger(names=["쉘브르"]), ["색금"], stats)
        self.assertEqual(run("소리")[0][2], "셀브로")
        self.assertEqual(stats["echo"], 1)


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


class ProductTriggerTest(unittest.TestCase):
    """D-SCR-40: 숫자가 들린 줄마다 60초를 묻지 않고 상품 구간마다 묻는다"""

    def stage(self):
        p = patch("sw.llm_live.TRIGGER", "product")
        p.start()
        self.addCleanup(p.stop)
        return Stage(self)

    @staticmethod
    def lines_of(user):
        return [int(x.split(" ")[0][1:]) for x in user.split("\n")]

    def test_a_product_is_asked_when_its_price_is_heard_and_once_more_when_the_next_one_starts(self):
        st = self.stage()
        st.say(0, "자 이거 예쁘죠 라비홍이에요")
        st.say(5, "37번 갑니다")
        self.assertEqual(st.asked, [])                                          # 번호만 들렸다 — 아직 묻지 않는다
        st.say(10, "5만원", row(2, 37, 50000, "라비홍", no_from="말"))
        self.assertEqual([self.lines_of(u) for u in st.asked], [[0, 1, 2]])     # 번호 앞에 말한 품종도 넣는다
        st.say(14, "5만원이에요 오만원")
        st.say(20, "잎이 통통하죠")
        self.assertEqual(len(st.asked), 1)                                      # 같은 금액을 다시 말한 것은 새로 알 것이 아니다
        st.say(30, "40번 갑니다")
        self.assertEqual(self.lines_of(st.asked[1]), [0, 1, 2, 3, 4])           # 다음 상품이 시작되면 앞 구간 전체를 한 번 더 — 다음 상품의 줄은 넣지 않는다
        st.say(35, "3만원")
        self.assertEqual(self.lines_of(st.asked[2]), [4, 5, 6])                 # 새 구간은 번호를 말한 줄 앞 15초부터(14초 줄은 16초 앞이라 뺀다)

    def test_a_changed_price_in_the_same_product_is_asked_again(self):
        st = self.stage()
        st.say(0, "37번 5만원", row(0, 37, 50000, None, no_from="말"))
        st.say(8, "아니다 4만원에 드릴게요")
        self.assertEqual(len(st.asked), 2)

    def test_flickering_tags_on_the_shelf_do_not_open_a_product_each_time(self):
        st = self.stage()
        st.show(0, 9, 37)
        st.say(5, "자 이거 5만원")                                              # 말하지 않은 번호: 번호표 37이 5초 넘게 크게 보여 구간을 연다
        st.show(10, 11, 38)
        st.say(10, "옆에 있는 거 말고요", end=11)                                # 38은 2초만 스쳤다 — 열지 않는다
        st.show(12, 19, 37)
        st.say(15, "이거 이거")
        st.show(20, 29, 38)
        st.say(25, "이건 다른 거예요")                                          # 38이 이어서 크게 보인다 — 연다
        st.show(30, 39, 37)
        st.say(35, "다시 이거")                                                 # 한 번 연 번호는 5분 안에 번호표만으로 다시 열지 않는다
        segs = [(e["no"], e["by"]) for e in st.kinds("LLM구간")]
        self.assertEqual(segs, [(37, "번호표"), (38, "번호표")])

    def test_a_new_price_long_after_without_a_number_opens_its_own_segment(self):
        st = self.stage()
        p = patch("sw.llm_live.SEG_DRIFT", 20)
        p.start()
        self.addCleanup(p.stop)
        st.say(0, "37번 5만원", row(0, 37, 50000, None, no_from="말"))
        st.say(10, "잎이 통통하죠")
        st.say(40, "이거는 3만원")                                             # 37을 올린 지 40초 — 번호 없이 다음 상품으로 넘어갔다
        self.assertEqual([self.lines_of(u) for u in st.asked], [[0], [0, 1], [2]])   # 37 구간은 앞에서 끝내고, 새 금액은 37의 줄 없이 묻는다
        st.say(45, "40번이에요")
        self.assertEqual(self.lines_of(st.asked[3]), [2, 3])                    # 번호가 들리면 번호 없던 구간과 합쳐 묻는다
        self.assertEqual([(e["no"], e["by"]) for e in st.kinds("LLM구간")], [(37, "말"), (None, "새 금액"), (40, "말")])

    def test_the_new_price_rule_is_off_by_default(self):
        st = self.stage()
        st.say(0, "37번 5만원", row(0, 37, 50000, None, no_from="말"))
        st.say(40, "이거는 3만원")
        self.assertEqual([(e["no"], e["by"]) for e in st.kinds("LLM구간")], [(37, "말")])

    def test_the_line_trigger_stays_the_default(self):
        self.assertEqual(llm_live.TRIGGER if "LLM_TRIGGER" not in __import__("os").environ else "line", "line")


if __name__ == "__main__":
    unittest.main()
