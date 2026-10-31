# 조각 매개변수 고르기 도구(tune.py): 일꾼과 같은 자르기·셈·캐시·asr.json 모양 (모델·silero 없이 돈다)
from __future__ import annotations

import io
import json
import os
import shutil
import tempfile
import unittest
import wave
from array import array
from contextlib import redirect_stdout

from livegenie_transcriber import tune
from livegenie_transcriber.segmenter import Segment, Segmenter

from helpers import silence, tone


def write_wav(path, pcm):
    with wave.open(path, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16000)
        writer.writeframes(pcm)


def timeline_pcm(timeline):
    """[(ms, 말인가)...] → 소리와 512표본 창마다 확률(말 0.9, 쉼 0.05)"""
    pcm = b"".join(tone(ms * 16) if speech else silence(ms * 16) for ms, speech in timeline)
    probs = []
    for offset in range(0, len(pcm) - len(pcm) % 1024, 1024):
        probs.append(0.9 if any(pcm[offset : offset + 1024]) else 0.05)
    return pcm, probs


class TuneTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.wav = os.path.join(self.dir, "a.wav")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_windows_are_512_samples_and_drop_short_tail(self):
        write_wav(self.wav, silence(512 * 3 + 100))
        frames = list(tune.windows(self.wav))
        self.assertEqual(len(frames), 3)
        self.assertTrue(all(len(frame) == 1024 for frame in frames))

    def test_rejects_non_16k_wav(self):
        with wave.open(self.wav, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(8000)
            writer.writeframes(silence(100))
        with self.assertRaises(ValueError):
            list(tune.windows(self.wav))

    def test_cut_matches_worker_segmenter(self):
        pcm, probs = timeline_pcm([(1000, False), (2000, True), (500, False), (1500, True), (1000, False)])
        write_wav(self.wav, pcm)
        params = tune.Params(200, 100, 3000)
        segmenter = Segmenter(pre_roll_ms=200, post_roll_ms=100, cut_lookback_ms=3000)
        want = []
        for probability, frame in zip(probs, tune.windows(self.wav)):
            want.extend(segmenter.push(probability, frame))
        self.assertEqual(tune.cut(probs, tune.windows(self.wav), params), want)
        self.assertEqual(len(want), 2)

    def test_report_counts_forced_cuts_in_speech(self):
        pcm, probs = timeline_pcm([(500, False), (45000, True), (1000, False)])
        write_wav(self.wav, pcm)
        params = tune.Params()
        segments = tune.cut(probs, tune.windows(self.wav), params)
        row = tune.report(segments, probs, params)
        self.assertEqual(row.segments, 3)
        self.assertEqual(row.forced_cuts, 2)
        self.assertEqual(row.cuts_in_speech, 2)
        self.assertEqual(row.longest_ms, 20000)

    def test_report_pause_cuts_are_not_forced(self):
        pcm, probs = timeline_pcm([(500, False), (1000, True), (600, False), (1000, True), (1000, False)])
        write_wav(self.wav, pcm)
        params = tune.Params(0, 200, 0)
        row = tune.report(tune.cut(probs, tune.windows(self.wav), params), probs, params)
        self.assertEqual((row.segments, row.forced_cuts, row.cuts_in_speech), (2, 0, 0))

    def test_lookback_moves_forced_cut_out_of_speech(self):
        pcm, probs = timeline_pcm([(500, False), (18000, True), (250, False), (5000, True), (1000, False)])
        write_wav(self.wav, pcm)
        rows = [tune.report(tune.cut(probs, tune.windows(self.wav), p), probs, p) for p in tune.grid([0], [0], [0, 3000])]
        self.assertEqual([(r.forced_cuts, r.cuts_in_speech) for r in rows], [(1, 1), (1, 0)])

    def test_transcribe_all_uses_cache(self):
        segments = [Segment(0, 16000, tone(16000)), Segment(32000, 40000, tone(8000))]
        calls = []

        def model(pcm):
            calls.append(len(pcm))
            return f" 글{len(calls)} "

        cache = {}
        self.assertEqual(tune.transcribe_all(segments, model, cache), ["글1", "글2"])
        self.assertEqual(tune.transcribe_all(segments, model, cache), ["글1", "글2"])
        self.assertEqual(len(calls), 2)
        self.assertEqual(sorted(cache), ["0:16000", "32000:40000"])

    def test_asr_document_matches_stream_shape_and_drops_empty_text(self):
        segments = [Segment(0, 16000, b""), Segment(32000, 40000, b"")]
        document = tune.asr_document(segments, ["십삼 번", " "], "livegenie-cohere", 3.0)
        self.assertEqual(document["transcription"], [{"offsets": {"from": 0, "to": 1000}, "text": "십삼 번"}])
        self.assertEqual(document["audioSeconds"], 3.0)

    def test_probs_round_trip(self):
        path = os.path.join(self.dir, "p.f32")
        tune.write_probs(path, array("f", [0.25, 0.5, 1.0]))
        self.assertEqual(list(tune.read_probs(path)), [0.25, 0.5, 1.0])

    def test_sweep_command_prints_one_row_per_combination(self):
        pcm, probs = timeline_pcm([(500, False), (25000, True), (1000, False)])
        write_wav(self.wav, pcm)
        path = os.path.join(self.dir, "p.f32")
        tune.write_probs(path, array("f", probs))
        out = io.StringIO()
        with redirect_stdout(out):
            code = tune.main(["sweep", self.wav, path, "--pre", "0,200", "--lookback", "0,3000"])
        self.assertEqual(code, 0)
        lines = out.getvalue().strip().splitlines()
        self.assertEqual(len(lines), 1 + 4)

    def test_bad_arguments_exit_2(self):
        self.assertEqual(tune.main(["sweep"]), 2)
        self.assertEqual(tune.main(["sweep", self.wav, "p", "--pre", "-1"]), 2)


if __name__ == "__main__":
    unittest.main()
