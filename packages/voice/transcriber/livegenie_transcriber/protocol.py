# 일꾼 ↔ 라이브지니 서버 약속 (D-APP1-01, harness/sprints/APP1/acceptance.md "약속" 절) — 표준 라이브러리만.
#  - 일꾼 → 서버 첫 틀: {"type":"hello","maxStreams":4}
#  - 서버 → 일꾼: {"type":"open","stream":n,"hint":"…"} · {"type":"close","stream":n} (n = 1 ~ 4,294,967,295)
#    hint(D-V3-127, 없어도 됨): 받아쓰기 힌트 — 한글 수 보기 + 그 판매자 품종 이름. HINT_MAX 글자까지만 쓴다
#  - 이진 틀 = 흐름 번호 4바이트(big-endian 부호 없는 정수) + PCM16 little-endian 16kHz 모노
#  - 일꾼 → 서버: {"type":"result","stream":n,"text":"…","startMs":정수,"endMs":정수,"procMs":정수} (빈 글은 보내지 않는다)
# 받은 것이 약속과 다르면 예외를 던지지 않고 None을 돌려준다(버린다).
from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from typing import Optional, Tuple

STREAM_MIN = 1
STREAM_MAX = 4294967295
MAX_STREAMS_MIN = 1
MAX_STREAMS_MAX = 64
DEFAULT_MAX_STREAMS = 4
WORKER_PATH = "/api/voice/worker"
# 서버가 받는 글 길이 한도(D-APP1-14). 넘는 글은 서버가 버리므로 일꾼도 잘라 보내지 않고 그대로 둔다(셈만)
TEXT_MAX = 2000
# 힌트 글자 한도 — 더 길면 잘라 쓴다(모델은 토큰으로 한 번 더 자른다)
HINT_MAX = 1000


def is_stream_id(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and STREAM_MIN <= value <= STREAM_MAX


def pack_audio(stream: int, pcm: bytes) -> bytes:
    """흐름 번호 4바이트 + PCM (모의 서버·시험용). 번호가 범위 밖이면 ValueError"""
    if not is_stream_id(stream):
        raise ValueError("흐름 번호는 1 ~ 4,294,967,295")
    return struct.pack(">I", stream) + bytes(pcm)


def unpack_audio(data: object) -> Optional[Tuple[int, bytes]]:
    """이진 틀 → (흐름 번호, PCM). 4바이트보다 짧거나 0번이면 None"""
    if not isinstance(data, (bytes, bytearray, memoryview)):
        return None
    raw = bytes(data)
    if len(raw) < 4:
        return None
    stream = struct.unpack(">I", raw[:4])[0]
    if stream < STREAM_MIN:
        return None
    return stream, raw[4:]


@dataclass(frozen=True)
class ServerMessage:
    type: str  # "open" | "close"
    stream: int
    hint: str = ""


def parse_server_message(raw: object) -> Optional[ServerMessage]:
    """서버 글 틀 → open/close. 깨진 JSON·모르는 종류·틀린 번호는 None"""
    if isinstance(raw, (bytes, bytearray)):
        try:
            raw = bytes(raw).decode("utf-8")
        except UnicodeDecodeError:
            return None
    if not isinstance(raw, str):
        return None
    try:
        message = json.loads(raw)
    except (ValueError, RecursionError):
        return None
    if not isinstance(message, dict):
        return None
    kind = message.get("type")
    stream = message.get("stream")
    if kind not in ("open", "close") or not is_stream_id(stream):
        return None
    hint = message.get("hint") if kind == "open" else None
    return ServerMessage(kind, stream, hint[:HINT_MAX] if isinstance(hint, str) else "")


def hello_message(max_streams: int) -> str:
    return json.dumps({"type": "hello", "maxStreams": max_streams}, separators=(",", ":"))


def result_message(stream: int, text: str, start_ms: int, end_ms: int, proc_ms: int) -> str:
    return json.dumps(
        {"type": "result", "stream": stream, "text": text, "startMs": start_ms, "endMs": end_ms, "procMs": max(0, proc_ms)},
        ensure_ascii=False,
        separators=(",", ":"),
    )
