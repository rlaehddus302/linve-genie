# 라이브 LLM 등록의 품종 고르기(D-SCR-15) 시험. 받아쓴 줄은 2026-11-12 방송의 틀린 모양을 본떠 지어냈다(손님 이름은 모두 지어낸 것).
import unittest

from sw import variety as V


class PickNameTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dic = V.Dictionary(seller=True)

    def test_seller_names_are_only_in_the_live_dictionary(self):
        old = V.Dictionary()
        self.assertNotIn("세검", old.names)                    # 옛 규칙 길의 사전은 그대로(지난 시험 점수가 바뀌지 않게)
        self.assertEqual(self.dic.names["세검"], "색금")
        self.assertEqual(self.dic.names["상광"], "삼광")
        self.assertIn("블랙스완", self.dic.names)
        self.assertNotIn("세검", V.Dictionary(seller=True, exclude_src="xhv-E5HEWUw").names)   # 그 방송에서만 나온 이름은 뺄 수 있다

    def test_tidy_and_canon(self):
        for raw, name, known in (
            ("세검", "색금", True),
            ("새 끔", "색금", True),
            ("상광색금", "삼광색금", True),
            ("삼강색금", "삼광색금", True),
            ("찐노", "찐녹", True),
            ("창노금", "창녹금", True),
            ("로라클론 4개", "로라클론", True),
            ("자 팔색조 색금", "팔색조 색금", True),
            ("청개구리 녹금", "청개구리녹금", True),              # 앞 이름은 사전과 맞추고 뒤에 붙은 말은 그대로 붙인다
            ("녹음에지는", "녹음에지는", False),
        ):
            with self.subTest(raw=raw):
                self.assertEqual(V.canon(V.tidy(raw), self.dic), (name, known))

    def test_words_that_are_not_varieties(self):
        for word in ("제곱", "재고", "통채", "20개", "서비스", "감사합니다", "○○님", "한 개"):
            with self.subTest(word=word):
                self.assertIsNotNone(V.not_a_name(V.tidy(word)))
        self.assertIsNone(V.not_a_name("팔색조"))
        self.assertEqual(V.not_a_name("달빛정원", {"달빛정원"}), "손님 닉네임")
        self.assertEqual(V.not_a_name("초록이네", {"초록이내"}), "손님 닉네임")   # 받아쓰기가 조금 달라도

    def test_same_name_from_llm_and_dictionary(self):
        lines = [(0, "자 이거는 세금 최상급입니다"), (5, "222번 자 130에 드립니다")]
        self.assertEqual(V.pick_name(["세검", "새검"], lines, self.dic), ("색금", "LLM과 사전이 같음"))

    def test_llm_name_in_dictionary_wins_over_other_words(self):
        lines = [(0, "자 이거는 블랙스완인데 색금이 살짝 들었어요 색금"), (4, "385번 30만원")]
        self.assertEqual(V.pick_name(["블랙스완"], lines, self.dic)[0], "블랙스완")

    def test_dictionary_name_said_twice_fills_an_unknown_llm_name(self):
        lines = [(0, "녹금의 제왕 신호등이에요"), (4, "308번 녹금의 제왕 5만원")]
        name, why = V.pick_name(["녹음에지는"], lines, self.dic)
        self.assertEqual(name, "녹금의 제왕")
        self.assertIn("2번", why)

    def test_unknown_name_is_left_empty(self):
        # 틀린 이름보다 빈 이름: LLM 이름이 사전에 없고, 사전 이름도 받아쓰기에 한 번뿐이면 비운다
        self.assertEqual(V.pick_name(["마인데마"], [(0, "자 이거 마인데마 3만원")], self.dic), ("", "모름"))
        self.assertEqual(V.pick_name(["녹음에지는"], [(0, "308번 녹금의 제왕 5만원")], self.dic), ("", "모름"))
        self.assertEqual(V.pick_name([], [(0, "자 이거 3만원")], self.dic), ("", "모름"))

    def test_buyer_nickname_is_never_a_variety(self):
        lines = [(0, "달빛정원님 잡으셨습니다 감사합니다"), (3, "자 요거 2만원"), (6, "달빛정원님 또 오셨네")]
        self.assertEqual(V.pick_name(["달빛정원"], lines, self.dic)[0], "")
        # 채팅 닉네임 목록을 받으면 '님' 없이 적힌 것도 거른다
        self.assertEqual(V.pick_name(["초록이네"], [(0, "초록이네 2만원")], self.dic, nicks={"초록이네"})[0], "")

    def test_majority_of_llm_names_in_the_product(self):
        lines = [(0, "자 팔색조 2만원"), (4, "372번")]
        self.assertEqual(V.pick_name(["제곱", "팔색조", "팔색조", "손톱"], lines, self.dic)[0], "팔색조")

    def test_said_counts_once_per_line_and_longest_match(self):
        count = V.said_counts([(0, "팔색조 색금 팔색조 색금 이거 진짜 예뻐요"), (5, "팔색조 색금 25만원")], self.dic)
        self.assertEqual(count["팔색조 색금"], 2)
        self.assertNotIn("색금", count)


if __name__ == "__main__":
    unittest.main()
