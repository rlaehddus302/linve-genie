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
