# 라이브 LLM 등록 안전 규칙(D-SCR-12~14)의 순수 함수 시험. 2026-11-12 방송 사례를 닉네임 없는 지어낸 짧은 줄로 옮겼다.
import unittest

from sw import reg_rules as R


class BandTest(unittest.TestCase):
    def test_band_follows_the_numbers_of_this_broadcast(self):
        self.assertIsNone(R.band_of([377, 330, 327]))                       # 아직 모른다 — 번호대로 거르지 않는다
        self.assertTrue(R.in_band(27, None))
        band = R.band_of([377, 330, 327, 385, 393, 425, 426, 333, 357, 372, 388, 365])
        self.assertEqual(band["digits"], 3)
        for no in (339, 245, 432):
            self.assertTrue(R.in_band(no, band), no)
        for no in (2, 38, 7, 27, 123, 800):                                  # 일부만 읽힌 번호표·번호대 밖
            self.assertFalse(R.in_band(no, band), no)

    def test_band_does_not_assume_three_digits(self):
        # 1번부터 차례로 파는 판매자: 한두 자리가 섞여 흔한 자릿수를 정하지 않고, 99 다음의 세 자리도 범위로 받아들인다
        band = R.band_of(list(range(70, 100)))
        self.assertEqual(band["digits"], 2)
        self.assertTrue(R.in_band(100, band))
        self.assertFalse(R.in_band(7, band))
        mixed = R.band_of([5, 6, 7, 8, 9, 10, 11, 12])
        self.assertIsNone(mixed["digits"])
        self.assertTrue(R.in_band(13, mixed))

    def test_partial_reads_are_not_number_evidence(self):
        band = R.band_of([377, 330, 327, 385, 393, 425, 426, 333])
        # 372번 번호표가 18장 읽히는 동안 '2'가 2장, '72'가 1장 읽혔다 — 가격을 말한 줄에 번호는 없었다
        cand = {s: [372] for s in range(100, 118)}
        cand[104], cand[105], cand[110] = [372, 2], [2], [72]
        secs = range(95, 121)
        self.assertEqual(R.full_frames(2, secs, cand, band), 0)
        self.assertFalse(R.number_evidence(2, False, secs, cand, band)[0])
        self.assertTrue(R.number_evidence(372, False, secs, cand, band)[0])
        # 번호대 안 번호라도 화면에 한 장만 스친 것(앞 상품 번호표)은 근거가 아니다
        cand[111] = [372, 325]
        ok, why = R.number_evidence(325, False, secs, cand, band)
        self.assertFalse(ok)
        self.assertIn("1장", why)

    def test_spoken_number_needs_the_band_or_the_screen(self):
        band = R.band_of([377, 330, 327, 385, 393, 425, 426, 333])
        none = {}
        self.assertTrue(R.number_evidence(316, True, range(0, 10), none, band)[0])       # 말했고 번호대 안 — 화면에 안 잡혀도 인정
        self.assertFalse(R.number_evidence(27, True, range(0, 10), none, band)[0])       # "27번 …"으로 받아썼지만(377이 잘림) 번호대 밖
        shown = {s: [27] for s in range(0, 5)}
        self.assertTrue(R.number_evidence(27, True, range(0, 10), shown, band)[0])       # 번호대 밖이어도 온전히 5장 보이면 인정
        self.assertFalse(R.number_evidence(27, True, range(0, 4), shown, band)[0])       # 4장으로는 아직

    def test_spoken_numbers_reads_beon_and_bare_numbers(self):
        self.assertEqual(R.spoken_numbers(["자 316 20만원 갑니다"]), {316})
        self.assertIn(377, R.spoken_numbers(["삼백칠십칠번 녹금"]))


class PairTest(unittest.TestCase):
    def test_digit_pair(self):
        self.assertEqual(R.digit_pair(333, 334), "34")
        self.assertEqual(R.digit_pair(212, 222), "12")
        self.assertEqual(R.digit_pair(153, 353), "13")
        self.assertIsNone(R.digit_pair(333, 344))
        self.assertIsNone(R.digit_pair(33, 334))
        self.assertIsNone(R.digit_pair(334, 334))

    def test_verdict_by_kind_of_pair(self):
        # 어제 방송에서 판정할 수 있던 한 자리 차이 4건: 모두 화면이 맞았다
        for said, screen in ((333, 334), (334, 344), (212, 222)):
            self.assertEqual(R.pair_verdict(said, screen, 2, 3), "화면", (said, screen))    # 귀로 헷갈리는 쌍(삼/사, 일/이)
        self.assertEqual(R.pair_verdict(153, 353, 3, 3), "화면")                          # 그 밖의 쌍: 번호표가 충분히 보였다
        self.assertEqual(R.pair_verdict(153, 353, 2, 3), "기다림")                        # 아직 덜 보였다 — 보내지 않고 기다린다
        for said, screen in ((389, 339), (318, 319), (368, 388)):                         # 눈으로 헷갈리는 쌍: 말한 번호
            self.assertEqual(R.pair_verdict(said, screen, 10, 3), "말", (said, screen))
        self.assertEqual(R.pair_verdict(311, 317, 2, 3), "기다림")                        # 1↔7: 눈으로도 귀로도 헷갈린다
        self.assertEqual(R.pair_verdict(311, 317, 5, 3), "화면")
        self.assertIsNone(R.pair_verdict(333, 421, 9, 3))


class PriceTest(unittest.TestCase):
    def test_unit_setting(self):
        self.assertEqual(R.unit_of(None), 10000)
        self.assertEqual(R.unit_of("만"), 10000)
        self.assertEqual(R.unit_of("천"), 1000)
        self.assertIsNone(R.unit_of("없음"))
        self.assertEqual(R.unit_of("모르는 값"), 10000)

    def test_spoken_amounts(self):
        for text, explicit, short in (
            ("자 요거 35", set(), {350000}),
            ("305번 삼십오 왕색금", set(), {350000}),
            ("30!", set(), {300000}),
            ("자 130에 드립니다", set(), {1300000}),
            ("150을 받고 싶어 했는데 230까지", set(), {2300000}),          # '150을'은 조사가 달라 읽지 않는다
            ("15 갑니다 15", set(), {150000}),
            ("이거 25에 드릴게요 30하던거", set(), {250000}),
            ("크기 상관없이 갑니다 5만원", {50000}, set()),
            ("삼만 오천 원", {35000}, set()),
            ("35 번이구요", set(), set()),
            ("35 개에 20 센티", set(), set()),
            ("되고 225", set(), set()),                                     # 10으로 안 떨어지는 세 자리는 번호일 수 있다
            ("자 2 3 5 5 7cm", set(), set()),
            ("홍상생술 3금입니다", set(), set()),
        ):
            with self.subTest(text=text):
                self.assertEqual(R.spoken_amounts(text, 10000), (explicit, short))
        self.assertEqual(R.spoken_amounts("자 요거 35", 1000), (set(), {35000}))
        self.assertEqual(R.spoken_amounts("자 요거 35", None), (set(), set()))
        self.assertEqual(R.spoken_amounts("자 330 갑니다", 10000, exclude={330}), (set(), set()))   # 화면에 보인 번호는 금액이 아니다

    def test_magnitude_conflict(self):
        self.assertEqual(R.magnitude_conflict(35000, {350000}), 350000)
        self.assertEqual(R.magnitude_conflict(70000, {700000, 30000}), 700000)
        self.assertEqual(R.magnitude_conflict(13000, {1300000}), 1300000)
        self.assertIsNone(R.magnitude_conflict(30000, {300000, 30000}))     # "30만원짜리 3만원에": 말한 금액과 같으면 충돌이 아니다
        self.assertIsNone(R.magnitude_conflict(50000, {20000}))

    def test_price_needs_the_spoken_amount_or_two_answers(self):
        # 판매자가 단위까지 말한 금액과 같으면 첫 답으로 바로
        self.assertEqual(R.price_choice({50000: 1}, {50000}, set(), [])[0], 50000)
        # 말한 금액과 못 맞추면 답 두 번
        self.assertEqual(R.price_choice({70000: 1}, set(), set(), [])[:2], (None, "답이 한 번뿐"))
        self.assertEqual(R.price_choice({70000: 2}, set(), set(), [])[0], 70000)
        self.assertEqual(R.price_choice({70000: 1, 60000: 1}, set(), set(), [])[:2], (None, "답이 갈림"))
        self.assertEqual(R.price_choice({70000: 2, 60000: 2}, set(), set(), [])[0], None)
        self.assertEqual(R.price_choice({70000: 3, 60000: 1}, set(), set(), [])[0], 70000)

    def test_yesterdays_unit_mistakes_are_not_sent(self):
        # 305번 "자 요거 35": 답 20번 중 14번이 35,000 — 몇 번을 같게 답해도 받아쓴 수(35 → 350,000)와 10배 다르면 보내지 않는다
        price, why, blocked = R.price_choice({35000: 8}, set(), {350000}, [])
        self.assertIsNone(price)
        self.assertIn("10배", why)
        # 350,000 답이 한 번이라도 오면 규칙과 같으므로 그 값으로
        self.assertEqual(R.price_choice({35000: 8, 350000: 1}, set(), {350000}, [])[0], 350000)
        # 222번 "30!"(130이 잘림) → "자 130에": 30,000도 130,000도 막히고 1,300,000만 통과
        said = {300000, 1300000}
        self.assertIsNone(R.price_choice({30000: 1, 130000: 4}, set(), said, [])[0])
        self.assertEqual(R.price_choice({30000: 1, 130000: 4, 1300000: 1}, set(), said, [])[0], 1300000)

    def test_out_of_range_price_is_held(self):
        sent = [10000, 20000, 30000, 50000, 20000, 10000, 30000, 70000, 50000, 20000]
        self.assertFalse(R.out_of_range(350000, sent))
        self.assertTrue(R.out_of_range(700000, sent))
        self.assertTrue(R.out_of_range(1000, sent))
        self.assertFalse(R.out_of_range(700000, sent[:5]))                  # 아직 보낸 것이 적으면 따지지 않는다
        # 가격대를 벗어난 값은 답이 여러 번 같아도, 단위를 뺀 수와 맞아도 보내지 않는다 — 판매자가 단위까지 말했을 때만
        self.assertIsNone(R.price_choice({700000: 3}, set(), {700000}, sent)[0])
        self.assertEqual(R.price_choice({700000: 1}, {700000}, set(), sent)[0], 700000)


if __name__ == "__main__":
    unittest.main()
