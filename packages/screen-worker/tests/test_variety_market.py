# 품종 고르기 시장 방식(D-RECOG-43, 나누기 D-RECOG-44) 시험. 받아쓴 줄과 손님 이름은 지어낸 것이다.
import unittest

from sw import llm_live, variety, variety_market as M
from test_llm_live_safe import Stage, row


def pick(names, lines=(), dic=None, **kw):
    name, why, strong, unsure, extra = M.pick_market(names, list(lines), dic or PickTest.dic, **kw)
    return name, unsure, extra["source"]


class PickTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dic = variety.Dictionary(market=True)

    def test_market_dictionary_has_names_written_forms_and_variants(self):
        self.assertGreater(len(self.dic.names), 10000)
        self.assertEqual(variety.canon("먼로철화", self.dic), ("먼로철화", True))       # 붙어 팔린 꼴
        self.assertEqual(variety.canon("노란풍선", self.dic), ("노랑풍선", True))       # 철자 변형 → 흔한 이름
        self.assertEqual(variety.canon("몰디부", self.dic), ("몰디브", True))           # 받아쓰기 모양 → 사전 이름(자모 88점)

    def test_tie_goes_to_the_earlier_answer(self):
        # 같은 표면 먼저 나온 이름 — 뒤 답에는 다음 상품 이야기가 섞인다
        self.assertEqual(pick(["녹두금", "녹두장군"])[0], "녹두 금")
        self.assertEqual(pick(["녹두장군", "녹두금"])[0], "녹두장군")
        self.assertEqual(pick(["녹두장군", "녹두금", "녹두금"])[0], "녹두 금")          # 표가 다르면 많은 쪽          # 표가 다르면 많은 쪽

    def test_dictionary_name_is_not_unsure_but_an_unknown_name_is(self):
        self.assertEqual(pick(["몰디브"]), ("몰디브", False, "LLM"))
        self.assertEqual(pick(["가나다라마바"]), ("가나다라마바", True, "LLM"))           # 사전에 없는 이름만 확인 중

    def test_unknown_unheard_name_is_switched_to_the_dictionary_name_heard(self):
        lines = [(1, "자 이번엔 레옹입니다 레옹 예쁘죠"), (2, "레옹 오천원")]
        self.assertEqual(pick(["쿼카쿼카"], lines), ("레옹", False, "받아쓰기"))
        self.assertEqual(pick(["몰디브"], lines)[0], "몰디브")                          # 사전에 있는 LLM 이름은 그대로(들리지 않아도 이름이 바뀌는 건 진짜 품종이 들릴 때만)

    def test_pattern_words_are_fixed_and_pattern_only_products_keep_the_pattern(self):
        self.assertEqual(pick(["몰디브 노금"])[0], "몰디브 녹금")
        self.assertEqual(pick(["색금", "몰디브", "색금"]), ("색금", False, "무늬 말"))
        self.assertEqual(pick(["몰디브", "색금"])[0], "몰디브")                         # 무늬 말뿐 답과 이름 답이 같은 표면 먼저 나온 쪽
        self.assertEqual(pick(["색금", "몰디브"])[0], "색금")

    def test_split_votes_on_the_variety_and_keeps_options_said_by_half(self):
        # 품종·옵션으로 나눠 품종끼리 센다(D-RECOG-44): "먼로 철화"와 "먼로"는 같은 품종 표
        self.assertEqual(pick(["먼로 철화", "레옹", "먼로"])[0], "먼로 철화")
        self.assertEqual(pick(["먼로 철화", "먼로", "먼로"])[0], "먼로")                # 옵션은 그 품종 답의 절반 넘게 붙여야
        self.assertEqual(pick(["SP몰디브색금"])[0], "몰디브 SP 색금")                   # 앞에 붙인 SP는 떼고 품종을 맞춘다
        self.assertEqual(pick(["창록금"])[0], "창 녹금")                                 # 창록 → 창녹, 창과 무늬를 따로
        self.assertEqual(pick(["색금창"])[0], "창 색금")
        self.assertEqual(pick(["SP색금"])[0], "SP 색금")                                 # 품종 이름이 없으면 SP가 품종
        self.assertEqual(pick(["몰디브 생금"])[0], "몰디브 색금")                         # 생금·설금 → 색금(D-RECOG-45)
        self.assertEqual(pick(["소믈리에 설금 무지"])[0], "소믈리에 색금 무지")
        self.assertEqual(pick(["실생금"])[0], "실생 금")                                  # 실생 뒤는 그대로

    def test_split_can_be_turned_off(self):
        old = M.SPLIT
        M.SPLIT = False
        try:
            self.assertEqual(pick(["몰디브 노금"])[0], "몰디브녹금")
            self.assertEqual(pick(["먼로", "레옹", "먼로 철화"])[0], "먼로")                 # 통째로: 세 이름이 한 표씩, 먼저 나온 답
        finally:
            M.SPLIT = old

    def test_customer_names_shape_words_and_denied_names_are_dropped(self):
        lines = [(1, "두루미맘님 감사합니다"), (2, "두루미맘님 이거 예쁘죠 몰디브")]
        self.assertEqual(pick(["두루미맘", "두루미맘", "몰디브"], lines)[0], "몰디브")
        self.assertEqual(pick(["청수"])[0], "")                                          # 모양 말
        lines = [(1, "이거 레옹 아니고요 몰디브예요"), (2, "몰디브 만원")]
        self.assertEqual(pick(["레옹", "레옹", "몰디브"], lines)[0], "몰디브")
        trs = [(0, "쿼카엄마님 반가워요"), (5, "쿼카엄마님 또 오셨네")]                      # 앞에서 두 번 넘게 "○○님"으로 부른 손님
        self.assertEqual(pick(["쿼카엄마", "몰디브"], [(30, "몰디브 만원")], trs=trs, t0=30)[0], "몰디브")

    def test_dictionary_name_is_not_taken_for_a_customer(self):
        lines = [(1, "별빛님 감사합니다"), (2, "별빛님 몰디브")]
        self.assertEqual(pick(["별빛", "몰디브"], lines)[0], "별빛")                     # 사전에 있는 이름은 손님 이름으로 보지 않는다(막기)

    def test_rename_rules(self):
        self.assertTrue(M.should_rename("", "몰디브", {"votes": 1, "rank": 1}))           # 빈칸은 채운다
        self.assertTrue(M.should_rename("몰디브", "레옹", {"votes": 2, "rank": 1}, 1))
        self.assertFalse(M.should_rename("몰디브", "레옹", {"votes": 1, "rank": 1}, 1))   # 한 번 나온 이름으로는 안 바꾼다
        self.assertFalse(M.should_rename("몰디브", "가나다라", {"votes": 3, "rank": 0}, 1))   # 사전 이름을 모르는 이름으로 안 바꾼다


class WorkerTest(unittest.TestCase):
    def test_market_is_the_default_and_registers_the_dictionary_name(self):
        self.assertEqual(llm_live.NAME_MODE, "market")
        if llm_live.BACKEND == "claude" and "LLM_REG_MODEL" not in __import__("os").environ:
            self.assertEqual(llm_live.MODEL, "opus")                                       # 등록 모델 Opus(D-RECOG-45)
        st = Stage(self)
        st.show(0, 9, 10)
        st.say(0, "10번 몰디부 만원", row(0, 10, 10000, "몰디부", no_from="말+화면"))
        self.assertEqual(st.posted, [(10, 10000, "몰디브")])


if __name__ == "__main__":
    unittest.main()
