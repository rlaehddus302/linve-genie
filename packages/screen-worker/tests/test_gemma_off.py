# 맥 LLM(Gemma)은 그 답을 쓰는 규칙 등록에서만 띄운다(D-SCR-GEMMA-01).
import unittest
from types import SimpleNamespace

from sw import __main__ as main


class GemmaOffTest(unittest.TestCase):
    def test_llm_register_does_not_start_gemma(self):
        # 운영(sw.serve → --post)은 늘 LLM 등록 길이고 Gemma 답을 서버로 보내지 않는다
        self.assertFalse(main.wants_gemma(SimpleNamespace(no_llm=False, register="llm", gemma=False)))
        self.assertFalse(main.wants_gemma(SimpleNamespace(no_llm=False, register="llm")))

    def test_rule_register_keeps_gemma(self):
        # 예전 규칙 등록은 Gemma로 금액을 확인하고 품종을 뽑는다
        self.assertTrue(main.wants_gemma(SimpleNamespace(no_llm=False, register="rule", gemma=False)))

    def test_gemma_flag_turns_it_on_for_comparison(self):
        self.assertTrue(main.wants_gemma(SimpleNamespace(no_llm=False, register="llm", gemma=True)))

    def test_no_llm_wins(self):
        self.assertFalse(main.wants_gemma(SimpleNamespace(no_llm=True, register="rule", gemma=True)))


if __name__ == "__main__":
    unittest.main()
