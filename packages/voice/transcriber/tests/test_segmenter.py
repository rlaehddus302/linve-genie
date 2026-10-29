# AC-APP1-01·02 (VOC-07 AC4): 쉼 0.4초에서 끊고, 쉬지 않는 말은 20초에서 끊는다
from __future__ import annotations

import unittest

from livegenie_transcriber.segmenter import Segmenter

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


if __name__ == "__main__":
    unittest.main()
