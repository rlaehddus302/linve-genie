# 조각 매개변수 고르기 (APP1, 게이트 밖 측정 도구) — 녹음 wav 하나로 말 앞뒤 여유·20초 자를 틈 범위를 견준다.
# 일꾼과 똑같이 자른다: 흐름 처음부터 512표본(32ms) 창마다 silero 확률을 구해 Segmenter에 넣는다(끝 남은 창은 버림).
#   probs      : silero 확률을 한 번만 구해 파일(float32)로 둔다. 확률은 소리에만 달려 매개변수와 상관없다.  (onnxruntime 필요)
#   sweep      : 확률 파일로 매개변수 조합마다 조각만 잘라 셈을 견준다 — 받아쓰기 없이 몇 초.          (표준 라이브러리만)
#   transcribe : 한 조합으로 잘라 진짜 모델로 받아쓰고 asr.json(from-whisper.mjs가 읽는 모양)을 쓴다. (모델 필요)
#                --cache 파일에 (시작, 끝) 표본마다 글을 모아 두어 같은 조각은 다시 받아쓰지 않는다.
# 받아쓴 글은 개인정보라 화면에 찍지 않는다(셈만). asr.json·캐시는 부른 사람이 준 곳(.live-replay 아래)에만 쓴다.
#
#   python3 -B -m livegenie_transcriber.tune probs <wav> <probs.f32>
#   python3 -B -m livegenie_transcriber.tune sweep <wav> <probs.f32> [--pre 0,100,200] [--post 0,100,200] [--lookback 0,2000,5000]
#   python3 -B -m livegenie_transcriber.tune transcribe <wav> <probs.f32> <asr.json> [--pre 0] [--post 0] [--lookback 0] [--cache <파일>] [--model cohere] [--device auto]
from __future__ import annotations

import json
import os
import sys
import time
import wave
from array import array
from dataclasses import dataclass
from typing import Callable, Dict, Iterator, List, Optional, Sequence, Tuple

from .segmenter import BYTES_PER_SAMPLE, SAMPLE_RATE, SPEECH_THRESHOLD, Segment, Segmenter

WINDOW = 512  # 일꾼의 silero 창(runtime.SILERO_WINDOW)과 같다
WINDOW_BYTES = WINDOW * BYTES_PER_SAMPLE


@dataclass(frozen=True)
class Params:
    pre_roll_ms: int = 0
    post_roll_ms: int = 0
    cut_lookback_ms: int = 0

    def label(self) -> str:
        return f"앞{self.pre_roll_ms}·뒤{self.post_roll_ms}·틈{self.cut_lookback_ms}"


@dataclass(frozen=True)
class Report:
    """조합 하나로 자른 셈. 받아쓰기 없이 견줄 수 있는 것만"""

    params: Params
    segments: int
    audio_ms: int
    forced_cuts: int
    cuts_in_speech: int
    longest_ms: int


def open_wav(path: str) -> wave.Wave_read:
    reader = wave.open(path, "rb")
    if reader.getframerate() != SAMPLE_RATE or reader.getnchannels() != 1 or reader.getsampwidth() != BYTES_PER_SAMPLE:
        reader.close()
        raise ValueError("16kHz 모노 16비트 wav가 아니에요")
    return reader


def windows(path: str) -> Iterator[bytes]:
    """wav 처음부터 512표본 창. 끝에 남은 짧은 창은 버린다(일꾼도 창이 다 찰 때까지 기다린다)"""
    reader = open_wav(path)
    try:
        while True:
            block = reader.readframes(WINDOW * 1024)
            if not block:
                return
            usable = len(block) - len(block) % WINDOW_BYTES
            for offset in range(0, usable, WINDOW_BYTES):
                yield block[offset : offset + WINDOW_BYTES]
            if usable < len(block):
                return
    finally:
        reader.close()


def read_probs(path: str) -> array:
    probs = array("f")
    with open(path, "rb") as handle:
        probs.frombytes(handle.read())
    if sys.byteorder != "little":
        probs.byteswap()
    return probs


def write_probs(path: str, probs: array) -> None:
    out = array("f", probs)
    if sys.byteorder != "little":
        out.byteswap()
    with open(path, "wb") as handle:
        handle.write(out.tobytes())


def cut(probs: Sequence[float], frames: Iterator[bytes], params: Params) -> List[Segment]:
    """창마다 확률과 소리를 Segmenter에 넣어 끝난 조각들 (끝에서 말하던 중인 조각은 일꾼처럼 내지 않는다)"""
    segmenter = Segmenter(pre_roll_ms=params.pre_roll_ms, post_roll_ms=params.post_roll_ms, cut_lookback_ms=params.cut_lookback_ms)
    out: List[Segment] = []
    for probability, pcm in zip(probs, frames):
        out.extend(segmenter.push(probability, pcm))
    return out


def report(segments: Sequence[Segment], probs: Sequence[float], params: Params) -> Report:
    """억지 자르기 = 앞 조각 끝과 다음 조각 처음이 붙어 있는 곳(쉼에서 끊으면 사이에 버린 쉼이 남는다).
    말 가운데 자르기 = 억지 자르기 중 자른 자리 바로 앞 창이 말(확률 0.5 이상)인 것 — 낱말이 두 조각으로 갈린다"""
    forced = 0
    in_speech = 0
    for before, after in zip(segments, segments[1:]):
        if before.end_sample != after.start_sample:
            continue
        forced += 1
        index = (before.end_sample - 1) // WINDOW
        if 0 <= index < len(probs) and probs[index] >= SPEECH_THRESHOLD:
            in_speech += 1
    return Report(
        params=params,
        segments=len(segments),
        audio_ms=sum(s.end_ms - s.start_ms for s in segments),
        forced_cuts=forced,
        cuts_in_speech=in_speech,
        longest_ms=max((s.end_ms - s.start_ms for s in segments), default=0),
    )


def grid(pre: Sequence[int], post: Sequence[int], lookback: Sequence[int]) -> List[Params]:
    return [Params(a, b, c) for a in pre for b in post for c in lookback]


def asr_document(segments: Sequence[Segment], texts: Sequence[str], engine: str, audio_seconds: float) -> Dict[str, object]:
    """stream.mjs가 쓰는 asr.json과 같은 모양. 빈 글은 일꾼처럼 내지 않는다"""
    return {
        "engine": engine,
        "audioSeconds": audio_seconds,
        "from": 0,
        "speed": None,
        "transcription": [
            {"offsets": {"from": s.start_ms, "to": s.end_ms}, "text": text}
            for s, text in zip(segments, texts)
            if text.strip()
        ],
    }


def transcribe_all(
    segments: Sequence[Segment],
    transcribe: Callable[[bytes], str],
    cache: Dict[str, str],
    progress: Optional[Callable[[int, int, int], None]] = None,
) -> List[str]:
    """조각마다 글. 캐시에 같은 (시작, 끝) 조각이 있으면 다시 받아쓰지 않는다. 캐시는 그 자리에서 채운다"""
    texts: List[str] = []
    fresh = 0
    for index, segment in enumerate(segments):
        key = f"{segment.start_sample}:{segment.end_sample}"
        text = cache.get(key)
        if text is None:
            text = str(transcribe(segment.pcm) or "").strip()
            cache[key] = text
            fresh += 1
        texts.append(text)
        if progress is not None:
            progress(index + 1, len(segments), fresh)
    return texts


# 명령 -------------------------------------------------------------------


def _ints(text: str) -> List[int]:
    values = [int(part) for part in text.split(",") if part.strip()]
    if not values or any(v < 0 for v in values):
        raise ValueError("0 이상의 정수를 쉼표로 적어 주세요")
    return values


def _options(argv: Sequence[str], names: Sequence[str]) -> Tuple[List[str], Dict[str, str]]:
    positional: List[str] = []
    values: Dict[str, str] = {}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg.startswith("--"):
            if arg not in names or i + 1 >= len(argv):
                raise ValueError(f"모르는 설정이거나 값이 없어요: {arg}")
            values[arg] = argv[i + 1]
            i += 2
        else:
            positional.append(arg)
            i += 1
    return positional, values


def _log(text: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {text}", file=sys.stderr, flush=True)


def command_probs(wav_path: str, out_path: str) -> None:
    from .config import Config, MODELS
    from .runtime import load_vad_factory

    config = Config(server="", worker_url="", token_file=None, model="cohere", model_id=MODELS["cohere"], max_streams=1, device="cpu", vad_model=None)
    vad = load_vad_factory(config)()
    probs = array("f")
    for index, pcm in enumerate(windows(wav_path)):
        probs.append(vad.probability(pcm))
        if index % 50_000 == 0 and index:
            _log(f"확률 {index * WINDOW // SAMPLE_RATE}초까지")
    write_probs(out_path, probs)
    _log(f"창 {len(probs)}개 ({len(probs) * WINDOW // SAMPLE_RATE}초) 확률을 썼어요")


def command_sweep(wav_path: str, probs_path: str, values: Dict[str, str]) -> None:
    probs = read_probs(probs_path)
    rows = []
    for params in grid(_ints(values.get("--pre", "0")), _ints(values.get("--post", "0")), _ints(values.get("--lookback", "0"))):
        rows.append(report(cut(probs, windows(wav_path), params), probs, params))
    print("조합\t조각\t받아쓸 소리(초)\t억지 자르기\t말 가운데 자르기\t가장 긴 조각(ms)")
    for row in rows:
        print(f"{row.params.label()}\t{row.segments}\t{row.audio_ms // 1000}\t{row.forced_cuts}\t{row.cuts_in_speech}\t{row.longest_ms}")


def command_transcribe(wav_path: str, probs_path: str, out_path: str, values: Dict[str, str]) -> None:
    from .config import MODELS, Config
    from .runtime import load_transcriber

    params = Params(int(values.get("--pre", "0")), int(values.get("--post", "0")), int(values.get("--lookback", "0")))
    model = values.get("--model", "cohere")
    if model not in MODELS:
        raise ValueError("--model은 cohere 또는 whisper")
    probs = read_probs(probs_path)
    segments = cut(probs, windows(wav_path), params)
    _log(f"{params.label()}: 조각 {len(segments)}개")
    cache_path = values.get("--cache")
    cache: Dict[str, str] = {}
    if cache_path and os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as handle:
            cache = json.load(handle)
    config = Config(server="", worker_url="", token_file=None, model=model, model_id=MODELS[model], max_streams=1, device=values.get("--device", "auto"), vad_model=None)
    transcribe = load_transcriber(config)
    started = time.monotonic()

    def save_cache() -> None:
        if cache_path:
            tmp = f"{cache_path}.tmp"
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump(cache, handle, ensure_ascii=False)
            os.replace(tmp, cache_path)

    def progress(done: int, total: int, fresh: int) -> None:
        if done % 200 == 0 or done == total:
            _log(f"받아쓰기 {done}/{total} (새로 {fresh}, {int(time.monotonic() - started)}초)")
        if fresh and fresh % 200 == 0:
            save_cache()

    texts = transcribe_all(segments, transcribe, cache, progress)
    save_cache()
    with wave.open(wav_path, "rb") as reader:
        seconds = reader.getnframes() / SAMPLE_RATE
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump(asr_document(segments, texts, f"livegenie-{model}-{params.label()}", seconds), handle, ensure_ascii=False)
    _log(f"asr.json을 썼어요 (조각 {len(segments)}개)")


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    names = ("--pre", "--post", "--lookback", "--cache", "--model", "--device")
    try:
        positional, values = _options(args, names)
        if positional[:1] == ["probs"] and len(positional) == 3:
            command_probs(positional[1], positional[2])
        elif positional[:1] == ["sweep"] and len(positional) == 3:
            command_sweep(positional[1], positional[2], values)
        elif positional[:1] == ["transcribe"] and len(positional) == 4:
            command_transcribe(positional[1], positional[2], positional[3], values)
        else:
            print("쓰는 법: python3 -B -m livegenie_transcriber.tune probs|sweep|transcribe … (파일 머리 설명을 보세요)", file=sys.stderr)
            return 2
    except (ValueError, OSError) as error:
        print(f"멈췄어요: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
