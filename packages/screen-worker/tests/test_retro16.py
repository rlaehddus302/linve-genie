# 2026-11-16 방송(@bit_succulent_farm) 판매자 의견 복기(D-RETRO16-04~11) 시험.
# 줄은 그날 사례를 본떠 지어낸 것이다(손님 이름·실제 기록 없음). LLM·서버는 가짜 — 실제 LLM·서버는 부르지 않는다.
import unittest
from unittest.mock import patch

from sw import reg_rules, variety
from test_llm_live_safe import Stage, row


# D-RECOG-43(2026-11-17): 품종 고르기 기본이 시장 방식(market)이 됐다. 이 파일의 시험은 가게 장부 방식(shop — LLM_NAME_MODE=shop으로 되돌릴 때의 길)을 본다.
_SHOP_MODE = patch("sw.llm_live.NAME_MODE", "shop")


def setUpModule():
    _SHOP_MODE.start()


def tearDownModule():
    _SHOP_MODE.stop()


def tiny_dictionary(*names):
    """전국 사전 대신 이름 몇 개만 든 사전(소리 접기의 '하나뿐일 때만'을 보려고)"""
    d = object.__new__(variety.Dictionary)
    d.names = {variety.norm(n): n for n in names}
    d.keys = list(d.names)
    d.jkeys = [variety.jamo(k) for k in d.keys]
    return d


class HeardFormsTest(unittest.TestCase):
    """판매자 의견 1·3~6: 받아쓰기가 이름·옵션을 틀리게 적은 모양"""

    @classmethod
    def setUpClass(cls):
        cls.dic = variety.Dictionary(seller=True, clean=True)

    def shop(self, raw):
        name, pat, form, *_ = variety.shop_name(raw, variety.Ledger(), self.dic)
        return variety.join_parts(name, pat), form

    def test_name_in_the_dictionary_is_found_when_one_vowel_is_heard_wrong(self):
        # 186번 "포르트나 분채": 사전에 포르투나가 있는데 자모 비율 87.5점이 88점 문턱에 걸려 포르트나로 올라갔다(D-RETRO16-04)
        self.assertEqual(self.shop("포르트나 분채"), ("포르투나 분채", ""))          # 분채는 옵션 — 이름에 남고 띄어 쓴다(D-DICT-OPT-01)
        self.assertEqual(self.shop("포르트나"), ("포르투나", ""))
        # 판매자 "킹레드를 킨렌드, 킨레드 로 인식함" — 받침 ㅇ·ㄴ
        for heard in ("킨렌드", "킨레드", "킹랜드"):
            self.assertEqual(self.shop(heard), ("킹레드", ""), heard)
        self.assertEqual(variety.canon("공룡포", self.dic), ("곤룡포", True))

    def test_sound_folding_picks_only_when_one_name_fits(self):
        two = tiny_dictionary("포르투나", "포루투나")                 # 접으면 둘 다 같다 — 고르지 않는다
        self.assertEqual(variety.canon("포르트나", two), ("포르트나", False))
        one = tiny_dictionary("포르투나", "킹레드")
        self.assertEqual(variety.canon("포르트나", one), ("포르투나", True))
        self.assertEqual(variety.canon("미소찜", tiny_dictionary("미스진")), ("미소찜", False))   # 접는 소리는 ㅡ·ㅜ, 받침 ㅇ·ㄴ뿐
        # 받아쓰기 낱말을 셀 때는 접지 않는다(옆 말이 사전 이름으로 세어지지 않게)
        self.assertEqual(variety.said_counts([(0, "포르트나 6천원")], one), {})

    def test_baekgeum_written_as_a_hundred(self):
        # 427번 "쿠스 100금 4,000원" → 쿠스100금으로 등록, 판매자 "숫자 백금으로 적히네요"(D-RETRO16-06)
        self.assertEqual(variety.split_parts("쿠스 100금")[:2], ("쿠스", "백금"))
        self.assertEqual(variety.split_parts("쿠스100금")[:2], ("쿠스", "백금"))
        self.assertEqual(variety.split_parts("100금")[:2], ("", "백금"))
        self.assertEqual(self.shop("쿠스 100금"), ("쿠스 백금", ""))                   # 보내는 이름은 "품종 옵션"(D-DICT-OPT-01)
        self.assertEqual(self.shop("퍼플 100금")[0], "퍼플 백금")
        self.assertEqual(variety.tidy("쿠스 100금"), "쿠스 백금")
        self.assertEqual(variety.split_parts("1,100금")[:2], ("1100", "금"))            # 다른 수는 그대로
        # 금액은 그대로: "100금"은 원래 금액으로 읽지 않고, "100"만 말한 것은 지금처럼 금액이다
        self.assertEqual(reg_rules.spoken_amounts("427번 쿠스 100금 4,000원입니다", 10000, exclude={427}), ({4000}, set()))
        self.assertEqual(reg_rules.spoken_amounts("100 갑니다", 10000), (set(), {1000000}))

    def test_nokgeum_written_as_high(self):
        # 484번 "요 높금 SP 484원" → 높금SP로 등록(D-RETRO16-07)
        for heard in ("높금SP", "높금 SP", "녹음 SP", "녹음 NSP", "녹금 SP"):
            self.assertEqual(variety.split_parts(heard)[:2], ("", "녹금SP"), heard)
            self.assertEqual(variety.join_parts(*variety.split_parts(heard)[:2]), "SP 녹금", heard)   # SP가 품종, 녹금은 옵션(D-DICT-OPT-01·D-DICT-SP-02)
        self.assertEqual(variety.split_parts("높금")[:2], ("", "녹금"))
        self.assertEqual(variety.pattern_said([(0, "요 높금 SP 484원")])["녹금"], 1)

    def test_sp_written_with_a_letter_in_front(self):
        # 판매자 "SP를 ASP, LSP, NSP 로 인식함"(D-RETRO16-05) — 442번 LSP, 161번 N.SP 철학, 437번 UISP, 앤스피쳐라
        for heard in ("LSP", "ASP", "NSP", "N.SP", "lsp", "UISP", "UI는 LSP", "에이스피", "앤스피", "엔스피"):
            self.assertEqual(variety.split_parts(heard)[:2], ("", "SP"), heard)
        self.assertEqual(variety.split_parts("LSP색금")[:2], ("", "SP색금"))
        self.assertEqual(variety.split_parts("N.SP 철학")[:2], ("", "SP철화"))
        self.assertEqual(variety.split_parts("앤스피쳐라")[:2], ("", "SP철화"))
        self.assertEqual(variety.split_parts("SP분체"), ("", "SP분채", "", ""))           # 분채도 옵션(D-DICT-OPT-01)
        self.assertEqual(variety.split_parts("ASP 분채"), ("", "SP분채", "", ""))
        for keep in ("RASP", "TNSP", "카엔스피나", "SPY"):                                  # 다른 말에 붙은 글자는 그대로
            self.assertEqual(variety.split_parts(keep)[1], "", keep)
        self.assertEqual(variety.pattern_said([(0, "442번 LSP 분채")])["SP"], 1)

    def test_cristata_and_pot_written_wrong(self):
        # 철화 → 철학·처라·쳐라·절하, 분채 → 분체·문채(D-RETRO16-08)
        self.assertEqual(variety.split_parts("레인보우 철학")[:2], ("레인보우", "철화"))
        self.assertEqual(variety.split_parts("진달래처라")[:2], ("진달래", "철화"))
        self.assertEqual(variety.split_parts("까르띠에 쳐라")[:2], ("까르띠에", "철화"))
        self.assertEqual(variety.split_parts("슈빌문채"), ("슈빌", "분채", "", ""))       # 분채도 옵션(D-DICT-OPT-01)
        self.assertEqual(variety.split_parts("철학")[:2], ("", "철화"))

    def test_this_one_is_not_part_of_the_name(self):
        # 408번 "뿌리 보감 유아이도"(= 이 아이도) → 뿌리보감유아이도로 등록됐다
        self.assertEqual(variety.split_parts("뿌리 보감 유아이도")[0], "뿌리보감")
        self.assertEqual(variety.split_parts("유아이")[0], "")


class BareWordTest(unittest.TestCase):
    """판매자 의견 7: "그냥 옵션만 말하면 상품명으로 안 적는 문제"(D-RETRO16-09)"""

    def pick(self, names, lines=()):
        return variety.pick_shop(names, list(lines), variety.Dictionary(seller=True, clean=True), variety.Ledger())

    def test_product_sold_by_its_form_or_as_a_pot_gets_that_word_as_its_name(self):
        # 4·26번 "26번 분채 만원" — LLM 답은 '분채'뿐이라 이름이 비었다. 164·196번 "164번 화분 6,000원"(화분을 판다)도
        self.assertEqual(self.pick(["분채", "분채"])[0], "분채")
        self.assertEqual(self.pick(["화분"])[0], "화분")
        self.assertEqual(self.pick(["백금"])[0], "백금")                                    # 무늬 말만 말한 상품은 지금처럼 그 말
        self.assertEqual(self.pick(["분채", "녹금"])[0], "녹금")                            # 무늬 말이 있으면 무늬 말
        self.assertEqual(self.pick(["분채", "포르투나 분채"])[0], "포르투나 분채")          # 품종이 있으면 품종(분채는 옵션으로 남는다, D-DICT-OPT-01)
        self.assertEqual(variety.split_parts("아토방 화분")[0], "아토방화분")              # 다른 말 옆의 화분은 이름의 일부

    def test_a_bare_word_name_is_filled_like_a_blank(self):
        def ask(now, name, now_rank=0, **extra):
            return variety.should_rename(now, name, dict({"votes": 2, "rank": 0, "source": "LLM", "tally": {}}, **extra), now_rank)
        self.assertTrue(ask("분채", "오미색금", votes=2))                                   # 파는 꼴 말뿐 ← 이름(빈칸처럼)
        self.assertFalse(ask("분채", "오미색금", votes=1))
        self.assertTrue(ask("분채", "포르투나", votes=1, rank=1))
        self.assertFalse(ask("포르투나", "분채", 1, votes=5, source="파는 꼴 말"))          # 이름 → 파는 꼴 말: 바꾸지 않는다
        self.assertFalse(ask("SP", "분채", 0, votes=5, source="파는 꼴 말"))
        self.assertTrue(ask("", "분채", votes=2, source="파는 꼴 말"))
        self.assertFalse(ask("", "분채", votes=1, source="파는 꼴 말"))

    def test_registered_with_the_form_word(self):
        st = Stage(self)
        st.show(0, 30, 26)
        st.say(0, "26번 분채 만원입니다", row(0, 26, 10000, "분채", no_from="말+화면"))
        self.assertEqual(st.posted, [(26, 10000, "분채")])


class NameAgainTest(unittest.TestCase):
    """판매자 의견 8: "품명이 잘못 등록되어서 호스트가 다시 말해줘도 안 고치고 그대로임"(D-RETRO16-10)"""

    def test_a_later_clear_statement_of_the_name_fixes_it(self):
        # 195번: "대철화"로 올라간 뒤 판매자가 "195번 대비철화 6천원"을 다시 말했다. 그 줄은 새 번호·새 금액이 없어 묻지 않았다(SKIP_SETTLED)
        st = Stage(self)
        st.show(0, 60, 195)
        st.say(0, "자 이거 대철화 6천원 195번", row(0, 195, 6000, "대철화", no_from="말+화면"))
        self.assertEqual(st.posted, [(195, 6000, "대철화")])
        asked = len(st.asked)
        st.say(20, "195번 대비철화 6천원", row(1, 195, 6000, "대비철화", no_from="말+화면"))
        self.assertEqual(len(st.asked), asked + 1)                                     # 이름을 다시 말한 줄은 묻는다
        st.poster.rename.assert_not_called()                                           # 한 번은 처음 말과 비긴다 — 그대로
        st.say(30, "195번 대비철화요 6천원", row(2, 195, 6000, "대비철화", no_from="말+화면"))
        self.assertEqual(len(st.asked), asked + 2)
        self.assertEqual([c.args[1:3] for c in st.poster.rename.call_args_list], [(195, "대비 철화")])   # "품종 옵션"(D-DICT-OPT-01)
        self.assertEqual(st.worker.names[195]["now"], "대비 철화")

    def test_lines_that_only_repeat_the_same_name_or_thank_a_buyer_are_not_asked(self):
        st = Stage(self)
        st.show(0, 60, 157)
        st.say(0, "157번 킹레드 2000원", row(0, 157, 2000, "킹레드", no_from="말+화면"))
        asked = len(st.asked)
        st.say(10, "157번 킹레드 2000원입니다", row(1, 157, 2000, "킹레드", no_from="말+화면"))
        st.say(20, "157번 은희님 감사합니다", row(2, 157, 2000, "킹레드", no_from="말+화면"))
        self.assertEqual(len(st.asked), asked)

    def test_a_shorter_name_does_not_replace_a_fuller_one(self):
        # 65번 "레오파드 찐 실버"가 뒤 답 "레오파드"(사전 이름) 한 번에 레오파드로 바뀌었다
        def ask(now, name, now_rank=0, **extra):
            return variety.should_rename(now, name, dict({"votes": 2, "rank": 0, "source": "LLM", "tally": {}}, **extra), now_rank)
        self.assertFalse(ask("레오파드찐실버", "레오파드", 0, votes=2, rank=1, tally={"레오파드찐실버": 1}))
        self.assertFalse(ask("가르시아산만금", "가르시아", 0, votes=1, rank=1, tally={"가르시아산만금": 1}))
        self.assertTrue(ask("홍진", "홍진이", 0, votes=2, tally={"홍진": 1}))               # 늘어난 이름은 지금처럼
        self.assertTrue(ask("오미세구", "오미색금", 0, votes=6, tally={"오미세구": 2}))      # 앞이 같아도 무늬 말을 바로잡은 이름은 바꾼다(176번)

    def test_pattern_words_grow_but_are_not_cut_out_of_a_name(self):
        def ask(now, name, now_rank=0, **extra):
            return variety.should_rename(now, name, dict({"votes": 2, "rank": 0, "source": "무늬 말", "tally": {}}, **extra), now_rank)
        self.assertTrue(ask("SP", "SP철화"))                                            # 161번 "N.SP 철학": SP로 올라간 뒤 철화가 더 들림
        self.assertFalse(ask("SP", "SP철화", votes=1))
        self.assertFalse(ask("킹레드SP변이", "SP"))                                      # 89번 "89번 SP와의 5,000원": 이미 든 무늬 말로 줄이지 않는다
        self.assertFalse(ask("NSP철학", "철화"))

    def test_a_name_said_again_twice_with_the_number_beats_a_dictionary_name(self):
        def ask(now, name, now_rank=0, **extra):
            return variety.should_rename(now, name, dict({"votes": 4, "rank": 0, "source": "LLM", "tally": {"연꽃": 2}}, **extra), now_rank)
        self.assertFalse(ask("연꽃", "여운꽃", 1))
        self.assertFalse(ask("연꽃", "여운꽃", 1, again=1))
        self.assertTrue(ask("연꽃", "여운꽃", 1, again=2))

    def test_a_corrected_pattern_word_counts_as_said_with_the_number(self):
        # 176번 "176번 오미세구 6천원": 받아쓰기 그대로 적은 답만 두 번으로 세면 색금으로 바로잡은 답(오미세금)이 비겨 오미세구로 남았다
        st = Stage(self)
        st.show(0, 60, 176)
        st.say(0, "좋은 분께 갔으면 좋겠다는 마음에 176번 오미세구 6천원", row(0, 176, 6000, "오미세구", no_from="말+화면"))
        said = lambda name: st.worker._said_again(176, {"line": 0, "variety": name})
        self.assertTrue(said("오미세구"))
        self.assertTrue(said("오미세금"))                                                # 품종 부분(오미)을 그 줄에서 말했다
        self.assertFalse(said("오묘설금"))
        self.assertFalse(said("킹레드"))

    def test_a_name_the_seller_fixed_is_left_alone(self):
        # 서버가 판매자가 고친 이름이라 그대로 두었다(SELLER_NAMED) — 그 번호는 더 묻지도 고치지도 않는다
        st = Stage(self)
        st.poster.rename.side_effect = lambda vid, no, name, n, on_result=None: on_result(
            {"ok": True, "changed": False, "broadcasts": [{"changed": False, "skip": "SELLER_NAMED"}]})
        st.show(0, 90, 195)
        st.say(0, "자 이거 대철화 6천원 195번", row(0, 195, 6000, "대철화", no_from="말+화면"))
        st.say(20, "195번 대비철화 6천원", row(1, 195, 6000, "대비철화", no_from="말+화면"))
        st.say(25, "195번 대비철화요 6천원", row(2, 195, 6000, "대비철화", no_from="말+화면"))
        self.assertEqual(st.poster.rename.call_count, 1)
        st.wait(1)
        self.assertTrue(st.worker.names[195]["seller"])
        self.assertEqual([e["skips"] for e in st.kinds("LLM이름손뗌")], [["SELLER_NAMED"]])
        asked = len(st.asked)
        st.say(40, "195번 대비철화 6천원", row(3, 195, 6000, "대비철화", no_from="말+화면"))
        st.say(50, "195번 대비철화요 6천원", row(4, 195, 6000, "대비철화", no_from="말+화면"))
        self.assertEqual(len(st.asked), asked)
        self.assertEqual(st.poster.rename.call_count, 1)


class ReusedNumberTest(unittest.TestCase):
    """판매자 의견 2: 428번 — 링구아스(8,000원)로 올린 번호표를 판매자가 다른 상품(설록, 3,000원)에 겹쳐 썼다(D-RETRO16-11)"""

    def test_another_product_on_a_used_number_does_not_change_the_first_one(self):
        st = Stage(self)
        st.show(0, 30, 428)
        st.say(0, "요아이 428번 링구아스 8,000원에 갈게요", row(0, 428, 8000, "링구아스", no_from="말+화면"))
        self.assertEqual(st.posted, [(428, 8000, "링구아스")])
        st.show(60, 120, 428)
        st.say(70, "설룩 428번 설룩 3천원 가보겠습니다", row(1, 428, 3000, "설록", conf="high", no_from="말+화면"))
        st.say(80, "428번 설룩 3천원", row(2, 428, 3000, "설록", conf="high", no_from="말+화면"))
        st.poster.rename.assert_not_called()                                           # 찜이 있을 수 있는 첫 상품의 이름은 그대로
        self.assertEqual(st.worker.names[428]["now"], "링구아스")
        other = st.kinds("LLM같은번호다른상품")
        self.assertEqual([(e["no"], e["sent_name"], e["sent_price"], e["name"], e["price"]) for e in other], [(428, "링구아스", 8000, "설록", 3000)])

    def test_similar_sounding_name_with_a_new_price_is_the_same_product(self):
        # 101번 산비 5,000원 → 다시 소개 "선비 군생" 4,700원, 450번 한연말 → "유아의 환영 마리아": 받아쓰기가 다르게 적은 같은 상품
        self.assertTrue(variety.sounds_alike("산비", "선비 군생"))
        self.assertTrue(variety.sounds_alike("한연말", "유아의 환영 마리아"))
        self.assertEqual(variety.split_parts("유아의 환영 마리아")[0], "환영마리아")          # "요 아이의"는 이름이 아니다
        for a, b in (("링구아스", "설록"), ("진달래변이", "까르띠에 철화"), ("산만금", "데뷔철화"), ("", "설록")):
            self.assertFalse(variety.sounds_alike(a, b), (a, b))
        st = Stage(self)
        st.show(0, 30, 101)
        st.say(0, "101번 산비 5,000원", row(0, 101, 5000, "산비", no_from="말+화면"))
        st.show(60, 120, 101)
        st.say(70, "101번 선비 군생 4,700원", row(1, 101, 4700, "선비 군생", conf="high", no_from="말+화면"))
        self.assertEqual(st.kinds("LLM같은번호다른상품"), [])


if __name__ == "__main__":
    unittest.main()
