import unittest

from sw import bench_stt_live as B


def line(start, end, text, conf=0.9):
    return {"start_sec": start, "end_sec": end, "text": text, "conf": conf}


class RunClockTest(unittest.TestCase):
    def test_folder_name_gives_korean_start_time(self):
        self.assertEqual(B.folder_start_sec("xhv-E5HEWUw-20261112_105438"), 10 * 3600 + 54 * 60 + 38)
        self.assertIsNone(B.folder_start_sec("bossfinal_flK4emzquko"))

    def test_coarse_offset_uses_the_fastest_line(self):
        regs = [{"line_seen_wall": 1000 + 130 + 50 + 2.5, "line_end_sec": 50}, {"line_seen_wall": 1000 + 130 + 90 + 1.0, "line_end_sec": 90},
                {"line_end_sec": 10}]
        self.assertAlmostEqual(B.coarse_offset(regs, 1000), 131.0)
        self.assertIsNone(B.coarse_offset([], 1000))

    def test_align_offset_finds_the_shift_by_text(self):
        said = ["자 이거 삼백이십육 번 색금 이십만 원", "청개구리 큰 거 나갑니다 여러분", "빅뱅 좋아하시는 분들 보세요", "손톱 두 개 묶어서 드릴게요",
                "팔색조 예쁘게 물들었죠 진짜", "이거는 녹금 종자로 쓰셔도 돼요", "창녹금 귀한 거 하나 나갑니다", "찐녹 마지막 하나 남았어요"]
        ref = [(10.0 * i, t) for i, t in enumerate(said)]
        # 영상 쪽은 117.3초 밀려 있고 조각 시작이 조금씩 다르다. 같은 말이 한참 뒤에 또 나와도(되풀이) 가까운 쪽을 고른다
        new = [(117.3 + 10.0 * i + (0.2 if i % 2 else -0.1), t + ".") for i, t in enumerate(said)]
        new += [(117.3 + 10.0 * i + 400, t) for i, t in enumerate(said[:3])]
        off, support, pairs = B.align_offset(ref, new, coarse=125.0, slack=60)
        self.assertAlmostEqual(off, 117.3, delta=0.3)
        self.assertEqual((support, pairs), (8, 8))

    def test_align_offset_refuses_thin_evidence(self):
        ref = [(0.0, "자 이거 삼백이십육 번 색금 이십만 원"), (5.0, "네")]
        off, support, _ = B.align_offset(ref, [(100.0, "자 이거 삼백이십육 번 색금 이십만 원")], coarse=100.0)
        self.assertIsNone(off)
        self.assertEqual(support, 1)


class WindowScoreTest(unittest.TestCase):
    truth = {326: {"no": 326, "name": "색금", "price": 200000, "phase": "SELLING"},
             316: {"no": 316, "name": "청개구리", "price": 300000, "phase": "SELLING"},
             7: {"no": 7, "name": "창노금", "price": 50000, "phase": "CLOSED"},
             305: {"no": 305, "name": "", "price": 350000, "phase": "SELLING"}}

    def test_windows_shift_to_video_time_and_skip_ghosts(self):
        runs = [("r1", [{"no": 326, "start_sec": 100.0}, {"no": 7, "start_sec": 150.0}, {"no": 999, "start_sec": 160.0}]),
                ("r2", [{"no": 316, "start_sec": 30.0}, {"no": 326, "start_sec": 40.0}]),
                ("r3", [{"no": 305, "start_sec": 5.0}])]
        ws = B.intro_windows(runs, {"r1": 120.0, "r2": 1270.0}, self.truth, pre=20, post=40)
        self.assertEqual([(w["no"], w["t"], w["t0"], w["t1"]) for w in ws], [(326, 220.0, 200.0, 260.0), (316, 1300.0, 1280.0, 1340.0)])

    def test_hits(self):
        self.assertTrue(B.name_hit("자 색 금 최상급", "색금"))
        self.assertFalse(B.name_hit("세금 최상급", "색금"))
        self.assertFalse(B.name_hit("아무 말", ""))
        self.assertTrue(B.number_hit("삼백이십육번 나갑니다", 326))
        self.assertFalse(B.number_hit("326 나갑니다", 326))
        self.assertTrue(B.number_loose("326 나갑니다", 326))
        self.assertFalse(B.number_loose("1326 나갑니다", 326))
        self.assertFalse(B.number_loose("326,000원", 326))
        self.assertTrue(B.price_hit("이십만 원에 드릴게요", 200000))
        self.assertFalse(B.price_hit("20까지 드릴게요", 200000))
        self.assertTrue(B.price_loose("20까지 드릴게요", 200000))
        # 어제 사고: "130"이 "30!"으로 잘리면 어느 쪽으로도 맞지 않는다
        self.assertFalse(B.price_loose("30!", 1300000))

    def test_score_counts_per_product_window(self):
        ws = [{"no": 326, "name": "색금", "price": 200000, "t": 100, "t0": 80, "t1": 140},
              {"no": 316, "name": "청개구리", "price": 300000, "t": 300, "t0": 280, "t1": 340},
              {"no": 305, "name": "", "price": 350000, "t": 500, "t0": 480, "t1": 540}]
        lines = [line(95, 99, "자 세금 326번"), line(101, 104, "20만원"), line(290, 296, "전개구리 삼백십육 번 삼십만 원"), line(700, 705, "색금 청개구리")]
        s = B.score(lines, ws)
        self.assertEqual((s["products"], s["heard"], s["named"], s["name"]), (3, 2, 2, 0))
        self.assertEqual((s["no"], s["price"], s["priced"]), (2, 2, 3))
        fixed = B.score(lines, ws, fix=lambda t: B.Corrector(["색금", "청개구리"]).correct(t)[0])
        self.assertEqual(fixed["name"], 2)
        self.assertEqual(fixed["per_name"]["색금"], [1, 1])

    def test_count_exact_does_not_count_inside_longer_names(self):
        got = B.count_exact([line(0, 1, "창녹금 하나 녹금 둘, 창 녹금")], ("녹금", "창녹금"))
        self.assertEqual(got, {"녹금": 1, "창녹금": 2})


class CorrectorTest(unittest.TestCase):
    cx = B.Corrector(["색금", "삼광", "청개구리", "찐녹", "삼광색금", "야래향"])

    def test_sound_alike_words_become_ledger_names(self):
        for heard, name in (("세금", "색금"), ("새껌", "색금"), ("새꿈", "색금"), ("상광", "삼광"), ("삼강", "삼광"), ("전개구리", "청개구리"),
                            ("찐노", "찐녹"), ("상광세금", "삼광색금"), ("야량", "야래향")):
            with self.subTest(heard=heard):
                self.assertEqual(self.cx.best(heard)[0], name)

    def test_keeps_right_and_unrelated_words(self):
        for word in ("색금", "삼광색금", "왕색금", "사과", "상관", "하나", "326", "SP"):
            with self.subTest(word=word):
                self.assertIsNone(self.cx.best(word))

    def test_correct_keeps_particles_numbers_and_joins_split_words(self):
        text, changes = self.cx.correct("자 요거는 세금이 최상급인데 326번 20만원, 세 끔 하나 더")
        self.assertEqual(text, "자 요거는 색금이 최상급인데 326번 20만원, 색금 하나 더")
        self.assertEqual([(h, n) for h, n, _ in changes], [("세금", "색금"), ("세끔", "색금")])

    def test_deny_list_blocks_common_words(self):
        cx = B.Corrector(["한자"], deny=["하나"])
        self.assertIsNone(cx.best("하나"))
        self.assertEqual(B.Corrector(["한자"]).best("하나")[0], "한자")   # 막지 않으면 흔한 말이 품종으로 바뀐다

    def test_near_forms_counts_spellings(self):
        lines = [line(0, 1, "세금 최상급 색금이에요"), line(1, 2, "자 색금 세 끔 새껌"), line(2, 3, "녹색금은 녹금이랑 달라요 세수")]
        got = B.near_forms(lines, "색금", known=["녹금", "녹색금"])
        self.assertEqual(dict(got), {"색금": 3, "세금": 1, "세끔": 1, "새껌": 1})

    def test_hint_is_names_only_within_limit(self):
        self.assertEqual(B.compose_hint(["색금", " 삼광 ", "색금", ""]), "색금, 삼광.")
        self.assertEqual(B.compose_hint([]), "")
        self.assertLessEqual(len(B.compose_hint([f"품종이름{i}" for i in range(200)])), B.HINT_CHAR_LIMIT + 1)

    def test_ledger_names_orders_by_count_and_drops_non_varieties(self):
        truth = {1: {"name": "색금", "phase": "SELLING"}, 2: {"name": "색금", "phase": "SELLING"}, 3: {"name": "삼광", "phase": "SELLING"},
                 4: {"name": "제곱", "phase": "SELLING"}, 5: {"name": "창노금", "phase": "CLOSED"}, 6: {"name": "", "phase": "SELLING"}}
        self.assertEqual(B.ledger_names(truth), ["색금", "삼광"])


class CuttingTest(unittest.TestCase):
    @staticmethod
    def probs(*spans):
        """(말인가, 초)들 → 틀마다의 말 확률"""
        out = []
        for speech, sec in spans:
            out += [0.9 if speech else 0.01] * round(sec * B.SR / B.FRAME)
        return out

    def test_longer_pause_setting_joins_short_pieces(self):
        p = self.probs((False, 1.0), (True, 1.0), (False, 0.6), (True, 1.0), (False, 2.0), (True, 0.5), (False, 2.0))
        short = B.cut_pause(p, 400)
        long = B.cut_pause(p, 800)
        self.assertEqual(len(short), 3)
        self.assertEqual(len(long), 2)
        # 앞뒤 여유 0.2초, 조각은 쉼을 다 들은 뒤에야 나온다(말 끝 + 쉼 길이)
        a, b, emit = short[0]
        self.assertAlmostEqual(a, 0.8, delta=0.05)
        self.assertAlmostEqual(b, 2.2, delta=0.05)
        self.assertAlmostEqual(emit, 2.0 + 0.4, delta=0.05)
        self.assertAlmostEqual(long[0][1], 3.6 + 0.2, delta=0.05)
        self.assertAlmostEqual(long[0][2], 3.6 + 0.8, delta=0.05)

    def test_last_piece_is_flushed_at_the_end(self):
        got = B.cut_pause(self.probs((False, 0.5), (True, 1.0)), 1200)
        self.assertEqual(len(got), 1)

    def test_slide_windows_cover_the_whole_sound(self):
        self.assertEqual(B.slide_windows(7.0, win=4.0, hop=2.0), [(0.0, 2.0), (0.0, 4.0), (2.0, 6.0), (3.0, 7.0)])

    def test_stitch_keeps_each_word_once(self):
        words = [(float(i), i + 0.8, f"w{i}", -0.1) for i in range(20)]
        results = []
        for s, e in B.slide_windows(20.0, win=8.0, hop=2.0):
            # 창 가장자리에 걸린 낱말은 틀리게 받아쓴다고 치자(잘린 소리)
            results.append((s, e, [(a, b, t if a >= s and b <= e else "잘림", lp) for a, b, t, lp in words if b > s and a < e]))
        out = B.stitch(results, hop=2.0, margin=3.0)
        self.assertEqual(" ".join(x["text"] for x in out).split(), [f"w{i}" for i in range(20)])
        # 글이 나올 수 있는 때 = 그 창의 끝: 낱말이 끝나고 margin ~ margin+hop초 뒤(마지막 창 빼고)
        for x in out[:-1]:
            self.assertGreaterEqual(x["avail_sec"] - x["end_sec"], 3.0 - 1.0)
            self.assertLessEqual(x["avail_sec"] - x["start_sec"], 3.0 + 2.0 + 1.0)

    def test_stitch_drops_empty_pieces_and_skips_empty_windows(self):
        # 창마다 맡는 곳: [0,1) · [1,3) · [3,끝). 맡지 않은 곳의 낱말과 빈 낱말은 버리고, 남는 것이 없는 창은 줄을 내지 않는다
        out = B.stitch([(0.0, 2.0, [(0.2, 0.6, " ", None), (0.7, 0.9, " 삼백", None), (1.0, 1.4, " 번", None)]),
                        (0.0, 4.0, [(0.7, 0.9, " 삼백", None), (1.0, 1.4, " 번", None)]),
                        (2.0, 6.0, [])], hop=2.0, margin=1.0)
        self.assertEqual([(x["text"], x["avail_sec"]) for x in out], [("삼백", 2.0), ("번", 4.0)])

    def test_slide_transcription_end_to_end_with_a_fake_model(self):
        import numpy as np
        # 초마다 다른 값을 넣은 가짜 소리: 가짜 모델은 조각 안의 값을 보고 '그 초의 낱말'을 낸다
        raw = b"".join(np.full(B.SR, 1000 + k, dtype="<i2").tobytes() for k in range(30))

        def fake(pcm):
            out = []
            for i in range(0, len(pcm), B.SR):
                k = round(float(pcm[i]) * 32768) - 1000
                out.append((i / B.SR, (i + B.SR) / B.SR - 0.1, f" 낱말{k}", -0.2))
            return out
        ticks = iter(range(10_000))
        lines, jobs = B.transcribe_cut(raw, fake, ("slide", 10.0, 2.0, 3.0), clock=lambda: next(ticks) * 0.5)
        self.assertEqual(" ".join(x["text"] for x in lines).split(), [f"낱말{k}" for k in range(30)])
        self.assertEqual(len(jobs), len(B.slide_windows(30.0, 10.0, 2.0)))
        self.assertTrue(all(j[2] == 0.5 for j in jobs))
        d = B.delays_of(lines, jobs, ("slide", 10.0, 2.0, 3.0))
        self.assertEqual(len(d), len(lines))
        self.assertGreater(min(d), 0)

    def test_shift_moves_a_slice_back_to_whole_sound_time(self):
        lines = [{"start_sec": 1.0, "end_sec": 2.5, "text": "삼백 번", "avail_sec": 2.9, "proc_sec": 0.3}]
        got, jobs = B.shift(lines, [(2.5, 2.9, 0.3), (None, 4.0, 0.2)], 3540.0)
        self.assertEqual((got[0]["start_sec"], got[0]["end_sec"], got[0]["avail_sec"], got[0]["proc_sec"]), (3541.0, 3542.5, 3542.9, 0.3))
        self.assertEqual(jobs, [(3542.5, 3542.9, 0.3), (None, 3544.0, 0.2)])

    def test_queue_delay_waits_for_the_previous_job(self):
        # (말 끝, 시작할 수 있는 때, 처리초): 둘째 일은 첫 일이 끝나는 3.4초까지 기다린다
        self.assertEqual([round(x, 2) for x in B.queue_delays([(1.0, 1.4, 2.0), (2.0, 2.4, 0.5), (10.0, 10.4, 0.5)])], [2.4, 1.9, 0.9])

    def test_percentile_and_cut_spec(self):
        self.assertEqual(B.pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9)
        self.assertIsNone(B.pct([], 0.5))
        self.assertEqual(B.parse_cut("pause:800"), ("pause", 800))
        self.assertEqual(B.parse_cut("slide:12:2:3"), ("slide", 12.0, 2.0, 3.0))
        with self.assertRaises(SystemExit):
            B.parse_cut("slide:12")

    def test_group_words_splits_on_gaps(self):
        words = [(0.0, 0.4, "삼백", None), (0.5, 0.9, "이십육", None), (1.0, 1.2, "번", None), (2.5, 3.0, "색금", None)]
        self.assertEqual(B.group_words(words), [(0.0, 1.2, "삼백 이십육 번", None), (2.5, 3.0, "색금", None)])


class TextStatsTest(unittest.TestCase):
    def test_by_length_buckets(self):
        lines = [line(0, 1.0, "30!", 0.4), line(2, 4.5, "999번 5만원", 0.9), line(5, 9, "326번 20만원 색금", 0.8)]
        rows = B.by_length(lines, {326}, {200000})
        self.assertEqual(rows[0][1:], (1, 1, 0, 0, 0, 0, 1))      # 1.5초 미만: 줄 1, 낮은 확신도 1, 숫자뿐인 줄 1
        self.assertEqual(rows[1][1:], (1, 0, 1, 1, 1, 1, 0))      # 없는 번호·없는 금액
        self.assertEqual(rows[2][1:], (1, 0, 1, 0, 1, 0, 0))

    def test_merge_by_gap_estimates_longer_pause_setting(self):
        # 틈 0.1초(쉼 0.5초)·틈 0.5초(쉼 0.9초)·틈 3초
        lines = [line(0.0, 1.0, "삼백이십육 번"), line(1.1, 1.6, "30!"), line(2.1, 4.0, "색금이에요"), line(7.0, 8.0, "다음")]
        self.assertEqual([m["n"] for m in B.merge_by_gap(lines, 400)], [1, 1, 1, 1])
        self.assertEqual([(m["text"], m["end_sec"]) for m in B.merge_by_gap(lines, 800)], [("삼백이십육 번 30!", 1.6), ("색금이에요", 4.0), ("다음", 8.0)])
        self.assertEqual([m["n"] for m in B.merge_by_gap(lines, 1200)], [3, 1])
        self.assertEqual([m["n"] for m in B.merge_by_gap(lines, 1200, max_sec=3.0)], [2, 1, 1])

    def test_agreement_is_100_for_same_text_and_lower_for_different(self):
        a = [line(0, 5, "삼백이십육 번 색금 이십만 원")]
        self.assertEqual(B.agreement(a, a), 100.0)
        self.assertLess(B.agreement(a, [line(0, 5, "삼백이십육 번 세금 이십만 원")]), 100.0)
        self.assertIsNone(B.agreement([], []))


if __name__ == "__main__":
    unittest.main()
