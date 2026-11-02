# 일꾼 설정 읽기 (D-APP-14, D-APP1-02·D-APP1-07·D-APP1-11) — 표준 라이브러리만.
# 모르는 값이면 시작하지 않고 쉬운 문장(ConfigError)으로 끝낸다. 오류 문장에 토큰 값을 넣지 않는다.
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, List, Mapping, Optional
from urllib.parse import urlsplit, urlunsplit

from .protocol import DEFAULT_MAX_STREAMS, MAX_STREAMS_MAX, MAX_STREAMS_MIN, WORKER_PATH
from .segmenter import MAX_SEGMENT_MS

MODELS: Dict[str, str] = {
    "cohere": "CohereLabs/cohere-transcribe-03-2026",
    "whisper": "openai/whisper-large-v3-turbo",
}
DEFAULT_MODEL = "cohere"
# 받아쓰기 언어는 한국어로 고정한다(설정으로 바꾸지 않는다)
LANGUAGE = "ko"
DEVICES = ("auto", "mps", "cuda", "cpu")
TOKEN_ENV = "LIVEJJIM_TRANSCRIBE_WORKER_TOKEN"

USAGE = """라이브지니 받아쓰기 일꾼

  python3 -m livegenie_transcriber --server <라이브지니 서버 주소> --token-file <일꾼 토큰 파일> [설정]

  --server <주소>        라이브지니 서버 주소 (예: https://livejjim.example.com, 연습 서버 http://localhost:7700)
  --token-file <파일>    일꾼 토큰이 든 파일 (없으면 환경변수 LIVEJJIM_TRANSCRIBE_WORKER_TOKEN)
  --model cohere|whisper 받아쓰기 모델 (기본 cohere = CohereLabs/cohere-transcribe-03-2026, whisper = large-v3-turbo)
  --max-streams <수>     동시에 받아쓰는 흐름 수 한도 1~64 (기본 4)
  --max-segment-ms <수>  쉬지 않고 이어지는 말을 자르는 길이(밀리초) 5000~20000 (기본 20000) — 짧을수록 글이 빨리 나와요
  --device auto|mps|cuda|cpu  모델을 돌릴 장치 (기본 auto)
  --vad-model <파일>     silero VAD onnx 파일 (기본: silero-vad 꾸러미 안의 파일)
"""


# 이보다 짧게 자르면 번호·가격이 자주 갈린다
MIN_SEGMENT_LIMIT_MS = 5000


class ConfigError(Exception):
    """설정이 틀림 — 쉬운 문장 하나"""


class HelpRequested(Exception):
    pass


@dataclass(frozen=True)
class Config:
    server: str
    worker_url: str
    token_file: Optional[str]
    model: str
    model_id: str
    max_streams: int
    device: str
    vad_model: Optional[str]
    max_segment_ms: int = 20000


def worker_url(server: str) -> str:
    """서버 주소 → 일꾼 웹소켓 주소 (http→ws, https→wss). 주소에 토큰을 넣지 않는다"""
    text = (server or "").strip()
    parts = urlsplit(text)
    scheme = {"http": "ws", "https": "wss", "ws": "ws", "wss": "wss"}.get(parts.scheme.lower())
    if scheme is None or not parts.netloc:
        raise ConfigError("서버 주소는 http:// 또는 https://로 시작해야 해요.")
    if parts.query or parts.fragment or "@" in parts.netloc:
        raise ConfigError("서버 주소에는 ? # @ 없이 주소만 적어 주세요.")
    path = parts.path.rstrip("/")
    if not path.endswith(WORKER_PATH):
        path = path + WORKER_PATH
    return urlunsplit((scheme, parts.netloc, path, "", ""))


def parse_args(argv: List[str], env: Optional[Mapping[str, str]] = None) -> Config:
    env = os.environ if env is None else env
    values: Dict[str, str] = {}
    names = {"--server", "--token-file", "--model", "--max-streams", "--device", "--vad-model", "--max-segment-ms"}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("-h", "--help"):
            raise HelpRequested()
        key, eq, inline = arg.partition("=")
        if key not in names:
            # 받은 글을 되풀이해 찍지 않는다 — 토큰을 잘못 붙여 넣었을 수 있다
            raise ConfigError("모르는 설정이 있어요. --help로 쓸 수 있는 설정을 보세요.")
        if eq:
            value = inline
        else:
            if i + 1 >= len(argv):
                raise ConfigError(f"{key} 뒤에 값을 적어 주세요.")
            i += 1
            value = argv[i]
        values[key] = value
        i += 1

    if "--server" not in values:
        raise ConfigError("--server로 라이브지니 서버 주소를 알려 주세요.")
    server = values["--server"]
    url = worker_url(server)

    model = values.get("--model", DEFAULT_MODEL).strip().lower()
    if model not in MODELS:
        raise ConfigError("받아쓰기 모델은 cohere 또는 whisper 중 하나로 적어 주세요.")

    raw_max = values.get("--max-streams", str(DEFAULT_MAX_STREAMS)).strip()
    if not raw_max.isdigit() or not (MAX_STREAMS_MIN <= int(raw_max) <= MAX_STREAMS_MAX):
        raise ConfigError("--max-streams는 1부터 64까지의 수로 적어 주세요.")

    raw_segment = values.get("--max-segment-ms", str(MAX_SEGMENT_MS)).strip()
    if not raw_segment.isdigit() or not (MIN_SEGMENT_LIMIT_MS <= int(raw_segment) <= MAX_SEGMENT_MS):
        raise ConfigError("--max-segment-ms는 5000부터 20000까지의 수로 적어 주세요.")

    device = values.get("--device", "auto").strip().lower()
    if device not in DEVICES:
        raise ConfigError("--device는 auto, mps, cuda, cpu 중 하나로 적어 주세요.")

    token_file = values.get("--token-file")
    if token_file is None and not env.get(TOKEN_ENV, "").strip():
        raise ConfigError("--token-file로 일꾼 토큰 파일을 알려 주세요.")

    return Config(
        server=server,
        worker_url=url,
        token_file=token_file,
        model=model,
        model_id=MODELS[model],
        max_streams=int(raw_max),
        device=device,
        vad_model=values.get("--vad-model"),
        max_segment_ms=int(raw_segment),
    )


def read_token(config: Config, env: Optional[Mapping[str, str]] = None) -> str:
    """일꾼 토큰을 읽는다(파일 우선, 없으면 환경변수). 값은 돌려주기만 하고 어디에도 찍지 않는다"""
    env = os.environ if env is None else env
    if config.token_file is not None:
        try:
            with open(config.token_file, "r", encoding="utf-8") as handle:
                token = handle.read().strip()
        except OSError:
            raise ConfigError("일꾼 토큰 파일을 읽지 못했어요. 파일 위치와 권한을 확인해 주세요.") from None
        except UnicodeDecodeError:
            raise ConfigError("일꾼 토큰 파일이 글자 파일이 아니에요.") from None
    else:
        token = env.get(TOKEN_ENV, "").strip()
    if not token:
        raise ConfigError("일꾼 토큰이 비어 있어요.")
    if any(ch.isspace() or ord(ch) < 0x21 or ord(ch) > 0x7E for ch in token):
        raise ConfigError("일꾼 토큰에 쓸 수 없는 글자가 있어요. 토큰 파일을 다시 만들어 주세요.")
    return token
