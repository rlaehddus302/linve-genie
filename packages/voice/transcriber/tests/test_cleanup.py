"""D-V3-126 받아쓰기 헛소리 거르기 — 실방송 2026-11-06 화면에 보인 글"""
import unittest

from livegenie_transcriber.cleanup import clean_text


class CleanupTest(unittest.TestCase):
    def test_live_hallucinations_are_dropped(self):
        self.assertEqual(clean_text("다-" * 200), "")
        self.assertEqual(clean_text("うわ!"), "")
        self.assertEqual(clean_text("네 네 네 네 네 네 네"), "")

    def test_repeat_is_cut_but_sales_words_stay(self):
        self.assertEqual(clean_text("자 청개구리금 다-다-다-다-다-다- 7만원 153번"), "자 청개구리금 7만원 153번")
        self.assertEqual(clean_text("金이 잘 들었습니다"), "이 잘 들었습니다")

    def test_normal_sales_talk_is_unchanged(self):
        for text in ["자 청개구리금 자 요아이", "153번 청개구리금 7만원", "18번 18만원", "자 자 자 이거 보세요", "11번 11만 원", "감사합니다."]:
            self.assertEqual(clean_text(text), text)

    def test_non_text_is_empty(self):
        self.assertEqual(clean_text(None), "")  # type: ignore[arg-type]
        self.assertEqual(clean_text("!?…"), "")


if __name__ == "__main__":
    unittest.main()
