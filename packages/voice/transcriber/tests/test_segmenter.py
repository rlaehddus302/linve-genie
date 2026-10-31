# AC-APP1-01·02 (VOC-07 AC4): 쉼 0.4초에서 끊고, 쉬지 않는 말은 20초에서 끊는다
from __future__ import annotations

import unittest

from livegenie_transcriber import segmenter as segmenter_module
from livegenie_transcriber.segmenter import Segmenter, worker_segmenter

from helpers import frames_from_timeline, silence, tone


def run(frames):
    segmenter = Segmenter()
    out = []
    for probability, pcm in frames:
        out.extend(segmenter.push(probability, pcm))
    return out


class PauseTest(unittest.TestCase):
    def test_pause_400ms_splits_into_two(self):
        segments = run(frames_from_timeline([(2000, True), (400, False), (1000, True), (1000, False)]))
        self.assertEqual(len(segments), 2)
        first, second = segments
        self.assertAlmostEqual(first.start_ms, 0, delta=30)
        self.assertAlmostEqual(first.end_ms, 2000, delta=30)
        self.assertAlmostEqual(second.start_ms, 2400, delta=30)
        self.assertAlmostEqual(second.end_ms, 3400, delta=30)

    def test_pause_370ms_does_not_split(self):
        segments = run(frames_from_timeline([(2000, True), (370, False), (1000, True), (1000, False)]))
        self.assertEqual(len(segments), 1)
        self.assertAlmostEqual(segments[0].start_ms, 0, delta=30)
        self.assertAlmostEqual(segments[0].end_ms, 3370, delta=30)

    def test_segment_audio_matches_length(self):
        for segment in run(frames_from_timeline([(2000, True), (400, False), (1000, True), (1000, False)])):
            self.assertEqual(len(segment.pcm), (segment.end_sample - segment.start_sample) * 2)

    def test_trailing_silence_is_not_in_segment(self):
        segments = run(frames_from_timeline([(1000, True), (1000, False)]))
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].pcm, tone(len(segments[0].pcm) // 2))

    def test_short_pause_inside_segment_is_kept(self):
        segments = run(frames_from_timeline([(1000, True), (300, False), (1000, True), (1000, False)]))
        self.assertEqual(len(segments), 1)
        self.assertIn(silence(100), segments[0].pcm)

    def test_click_shorter_than_250ms_is_dropped(self):
        self.assertEqual(run(frames_from_timeline([(500, False), (120, True), (1000, False)])), [])

    def test_unfinished_speech_is_not_emitted(self):
        self.assertEqual(run(frames_from_timeline([(3000, True)])), [])


class MaxLengthTest(unittest.TestCase):
    def test_45s_continuous_speech_is_cut_20_20_5(self):
        segments = run(frames_from_timeline([(45000, True), (1000, False)]))
        self.assertEqual(len(segments), 3)
        lengths = [s.end_ms - s.start_ms for s in segments]
        for got, want in zip(lengths, [20000, 20000, 5000]):
            self.assertAlmostEqual(got, want, delta=30)
        self.assertAlmostEqual(segments[0].start_ms, 0, delta=30)
        self.assertAlmostEqual(segments[1].start_ms, 20000, delta=30)
        self.assertAlmostEqual(segments[2].start_ms, 40000, delta=30)
        for segment in segments:
            # 표본 수 = 길이 × 16, 20초 넘는 조각 없음
            self.assertEqual(len(segment.pcm) // 2, (segment.end_ms - segment.start_ms) * 16)
            self.assertLessEqual(segment.end_ms - segment.start_ms, 20000)

    def test_cuts_are_back_to_back_not_merged(self):
        segments = run(frames_from_timeline([(45000, True), (1000, False)]))
        for before, after in zip(segments, segments[1:]):
            self.assertEqual(before.end_sample, after.start_sample)


class OddInputTest(unittest.TestCase):
    def test_odd_bytes_and_bad_probabilities_do_not_crash(self):
        segmenter = Segmenter()
        self.assertEqual(segmenter.push(0.9, b"\x01\x02\x03"), [])
        self.assertEqual(segmenter.push(float("nan"), silence(480)), [])
        self.assertEqual(segmenter.push("말", silence(480)), [])  # type: ignore[arg-type]
        self.assertEqual(segmenter.push(0.9, b""), [])

    def test_reset_discards_unfinished_audio(self):
        segmenter = Segmenter()
        for probability, pcm in frames_from_timeline([(2000, True)]):
            segmenter.push(probability, pcm)
        segmenter.reset()
        out = []
        for probability, pcm in frames_from_timeline([(1000, False)]):
            out.extend(segmenter.push(probability, pcm))
        self.assertEqual(out, [])


def run_with(frames, **options):
    segmenter = Segmenter(**options)
    out = []
    for probability, pcm in frames:
        out.extend(segmenter.push(probability, pcm))
    return out


class RollTest(unittest.TestCase):
    """말 앞뒤 여유: VAD가 늦게 알아챈 첫 소리·말끝 소리를 조각에 넣는다"""

    def test_pre_roll_adds_sound_before_speech(self):
        segments = run_with(frames_from_timeline([(1000, False), (1000, True), (1000, False)]), pre_roll_ms=200)
        self.assertEqual(len(segments), 1)
        self.assertAlmostEqual(segments[0].start_ms, 800, delta=30)
        self.assertAlmostEqual(segments[0].end_ms, 2000, delta=30)
        self.assertTrue(segments[0].pcm.startswith(silence(160)))

    def test_post_roll_adds_start_of_pause(self):
        segments = run_with(frames_from_timeline([(500, False), (1000, True), (1000, False)]), post_roll_ms=200)
        self.assertEqual(len(segments), 1)
        self.assertAlmostEqual(segments[0].start_ms, 500, delta=30)
        self.assertAlmostEqual(segments[0].end_ms, 1700, delta=30)
        self.assertTrue(segments[0].pcm.endswith(silence(3200)))

    def test_rolls_never_overlap_neighbours(self):
        timeline = [(300, False), (1000, True), (450, False), (1000, True), (2000, False)]
        segments = run_with(frames_from_timeline(timeline), pre_roll_ms=300, post_roll_ms=300)
        self.assertEqual(len(segments), 2)
        self.assertLessEqual(segments[0].end_sample, segments[1].start_sample)
        self.assertGreaterEqual(segments[0].start_sample, 0)
        for segment in segments:
            self.assertEqual(len(segment.pcm), (segment.end_sample - segment.start_sample) * 2)

    def test_click_with_pre_roll_is_still_dropped(self):
        self.assertEqual(run_with(frames_from_timeline([(500, False), (120, True), (1000, False)]), pre_roll_ms=300), [])

    def test_rolls_keep_segments_within_20s(self):
        segments = run_with(frames_from_timeline([(1000, False), (45000, True), (1000, False)]), pre_roll_ms=300, post_roll_ms=300)
        for segment in segments:
            self.assertLessEqual(segment.end_sample - segment.start_sample, 320000)
        for before, after in zip(segments, segments[1:]):
            self.assertEqual(before.end_sample, after.start_sample)


class LookbackTest(unittest.TestCase):
    """20초가 차면 끝 몇 초 안의 숨 쉬는 틈에서 자른다 (낱말을 가르지 않게)"""

    def test_cut_moves_to_short_dip_before_20s(self):
        timeline = [(18000, True), (210, False), (5000, True), (1000, False)]
        segments = run_with(frames_from_timeline(timeline), cut_lookback_ms=3000)
        self.assertEqual(len(segments), 2)
        self.assertAlmostEqual(segments[0].end_ms, 18210, delta=30)
        self.assertEqual(segments[0].end_sample, segments[1].start_sample)

    def test_without_lookback_cut_stays_at_20s(self):
        timeline = [(18000, True), (210, False), (5000, True), (1000, False)]
        segments = run_with(frames_from_timeline(timeline))
        self.assertEqual(segments[0].end_ms - segments[0].start_ms, 20000)

    def test_dip_outside_lookback_is_ignored(self):
        timeline = [(15000, True), (210, False), (8000, True), (1000, False)]
        segments = run_with(frames_from_timeline(timeline), cut_lookback_ms=3000)
        self.assertEqual(segments[0].end_ms - segments[0].start_ms, 20000)

    def test_no_dip_cuts_exactly_at_20s(self):
        segments = run_with(frames_from_timeline([(45000, True), (1000, False)]), cut_lookback_ms=3000)
        self.assertEqual([s.end_ms - s.start_ms for s in segments][:2], [20000, 20000])


class WorkerValuesTest(unittest.TestCase):
    """일꾼 값: 재생 측정으로 고른 앞 0.2초·뒤 0.2초·틈 8초. 자르기 함수 기본은 AC-APP1-01·02 규칙(여유 없음)"""

    def test_worker_values(self):
        self.assertEqual(
            (segmenter_module.WORKER_PRE_ROLL_MS, segmenter_module.WORKER_POST_ROLL_MS, segmenter_module.WORKER_CUT_LOOKBACK_MS),
            (200, 200, 8000),
        )
        self.assertEqual((segmenter_module.PRE_ROLL_MS, segmenter_module.POST_ROLL_MS, segmenter_module.CUT_LOOKBACK_MS), (0, 0, 0))

    def test_worker_segmenter_pads_and_moves_cut_to_breath(self):
        frames = frames_from_timeline([(1000, False), (13000, True), (210, False), (9000, True), (1000, False)])
        out = []
        segmenter = worker_segmenter()
        for probability, pcm in frames:
            out.extend(segmenter.push(probability, pcm))
        self.assertEqual(len(out), 2)
        self.assertAlmostEqual(out[0].start_ms, 800, delta=30)
        # 20초가 차는 자리(19.8초)에서 8초 안의 숨 쉬는 틈(14.0~14.21초) 끝으로 옮겨 자른다
        self.assertAlmostEqual(out[0].end_ms, 14210, delta=30)
        self.assertEqual(out[0].end_sample, out[1].start_sample)
        self.assertAlmostEqual(out[1].end_ms, 23410, delta=30)


if __name__ == "__main__":
    unittest.main()
