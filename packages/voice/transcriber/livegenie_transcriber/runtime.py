# 실행 때만 불러오는 무거운 것들 (D-APP-07·D-APP-14, D-APP1-02): silero VAD(onnxruntime), 받아쓰기 모델(transformers·torch).
# 단위 시험은 이 파일을 불러오지 않는다. 모델은 한국어로 고정한다. 소리·글을 디스크·로그에 남기지 않는다.
from __future__ import annotations

import math
import os
import sys
from typing import Any, Callable, Dict, Optional, Tuple

from .config import LANGUAGE, Config
from .segmenter import SAMPLE_RATE
from .session import Transcript

SILERO_WINDOW = 512  # 16kHz에서 32ms
SILERO_CONTEXT = 64


class MissingPackage(Exception):
    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name


def _require(name: str) -> Any:
    try:
        return __import__(name)
    except ImportError:
        raise MissingPackage(name) from None


def quiet_libraries() -> None:
    """모델 꾸러미가 밖으로 알리거나 길게 찍지 않게"""
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")


class SileroVad:
    """흐름 하나의 silero VAD 상태 (같은 onnx 세션을 흐름들이 나눠 쓴다)"""

    window = SILERO_WINDOW

    def __init__(self, session: Any, np: Any, version: int) -> None:
        self._session = session
        self._np = np
        self._version = version
        self._sr = np.array(SAMPLE_RATE, dtype=np.int64)
        if version == 5:
            self._state = np.zeros((2, 1, 128), dtype=np.float32)
            self._context = np.zeros((1, SILERO_CONTEXT), dtype=np.float32)
        else:
            self._h = np.zeros((2, 1, 64), dtype=np.float32)
            self._c = np.zeros((2, 1, 64), dtype=np.float32)

    def probability(self, pcm: bytes) -> float:
        np = self._np
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        x = samples.reshape(1, -1)
        if self._version == 5:
            joined = np.concatenate([self._context, x], axis=1)
            out, self._state = self._session.run(None, {"input": joined, "state": self._state, "sr": self._sr})
            self._context = joined[:, -SILERO_CONTEXT:]
        elif self._version == 4:
            out, self._h, self._c = self._session.run(None, {"input": x, "sr": self._sr, "h": self._h, "c": self._c})
        else:  # sherpa-onnx가 쓰는 꼴 (x, h, c — 16kHz 고정)
            out, self._h, self._c = self._session.run(None, {"x": x, "h": self._h, "c": self._c})
        return float(out.reshape(-1)[0])


def find_silero_model(path: Optional[str]) -> str:
    if path:
        return path
    try:
        from importlib.resources import files

        candidate = files("silero_vad").joinpath("data/silero_vad.onnx")
        if candidate.is_file():
            return str(candidate)
    except Exception:
        pass
    raise FileNotFoundError("silero VAD 모델 파일을 찾지 못했어요. pip install silero-vad 를 하거나 --vad-model로 파일을 알려 주세요.")


def load_vad_factory(config: Config) -> Callable[[], SileroVad]:
    np = _require("numpy")
    ort = _require("onnxruntime")
    model = find_silero_model(config.vad_model)
    options = ort.SessionOptions()
    options.inter_op_num_threads = 1
    options.intra_op_num_threads = 1
    options.log_severity_level = 3
    session = ort.InferenceSession(model, sess_options=options, providers=["CPUExecutionProvider"])
    names = {item.name for item in session.get_inputs()}
    version = 5 if "state" in names else (4 if "sr" in names else 3)
    return lambda: SileroVad(session, np, version)


def pick_device(torch: Any, wanted: str) -> str:
    if wanted != "auto":
        return wanted
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _cached_first(load: Callable[[bool], Any]) -> Any:
    """내려받아 둔 모델이 있으면 인터넷 없이 그것을 쓴다(동의가 필요한 모델도 다시 묻지 않게). 없으면 내려받는다"""
    try:
        return load(True)
    except OSError:
        return load(False)


# 위스퍼 앞 문장 한도는 224토큰 — 시작 표시 몫을 빼고 넉넉히
HINT_TOKEN_MAX = 190
# 조각 하나(8초까지)의 글 토큰 상한 — 소리 없는 조각에 힌트를 끝없이 베끼는 것을 끊는다 (D-V3-130; 8초 말은 40토큰 안팎)
MAX_NEW_TOKENS = 96


def confidence_of(log_probs: Any) -> Optional[float]:
    """토큰 로그 확률 목록 → 평균 확률 0~1 (무한·NaN은 뺀다). 토큰이 없으면 None"""
    values = []
    for value in log_probs if isinstance(log_probs, (list, tuple)) else []:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            values.append(number)
    if not values:
        return None
    return max(0.0, min(1.0, math.exp(sum(values) / len(values))))


def strip_prompt_echo(text: str, prompt: str) -> str:
    """앞 문장이 결과 앞에 그대로 붙어 오면 떼고, 결과 전체가 앞 문장의 한 토막(8글자 넘게)이면 들은 것이 아니라 베낀 것이라 비운다"""
    if not prompt:
        return text
    out = text.strip()
    if out.startswith(prompt):
        out = out[len(prompt):].strip()
    if len(out) > 8 and out in prompt:
        return ""
    return out


def load_transcriber(config: Config) -> Callable[..., str]:
    """조각 소리(PCM16 16kHz 모노) → 글, (pcm, hint). 한 번에 하나씩만 부른다(일꾼이 실행기 하나로 줄 세운다)"""
    quiet_libraries()
    np = _require("numpy")
    torch = _require("torch")
    _require("transformers")
    device = pick_device(torch, config.device)
    dtype = torch.float16 if device in ("mps", "cuda") else torch.float32

    def to_float(pcm: bytes) -> Any:
        return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0

    def sync() -> None:
        if device == "mps":
            torch.mps.synchronize()
        elif device == "cuda":
            torch.cuda.synchronize()

    if config.model == "cohere":
        from transformers import AutoProcessor, CohereAsrForConditionalGeneration

        processor = _cached_first(lambda local: AutoProcessor.from_pretrained(config.model_id, local_files_only=local))
        model = _cached_first(
            lambda local: CohereAsrForConditionalGeneration.from_pretrained(config.model_id, torch_dtype=dtype, local_files_only=local)
        ).to(device)
        model.eval()

        def transcribe(pcm: bytes, hint: str = "") -> str:
            # 코히어는 앞 문장 힌트를 받지 않는다 — 힌트는 쓰지 않는다
            inputs = processor([to_float(pcm)], sampling_rate=SAMPLE_RATE, return_tensors="pt", language=LANGUAGE)
            inputs.to(model.device, dtype=model.dtype)
            with torch.inference_mode():
                outputs = model.generate(**inputs, max_new_tokens=256)
            texts = processor.decode(outputs, skip_special_tokens=True)
            sync()
            text = texts if isinstance(texts, str) else (texts[0] if texts else "")
            return str(text or "")

    else:
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

        # 로딩 전용 옵션을 pipeline에 넘기면 transformers 5에서 generate까지
        # 전달된다. 모델/전처리기를 먼저 읽어 캐시 우선 정책을 이 경계에만 둔다.
        processor = _cached_first(lambda local: AutoProcessor.from_pretrained(config.model_id, local_files_only=local))
        model = _cached_first(
            lambda local: AutoModelForSpeechSeq2Seq.from_pretrained(config.model_id, dtype=dtype, local_files_only=local)
        )
        # 힌트(D-V3-127): 한글 수 보기 + 판매자 품종 이름을 앞 문장(prompt)으로 — 토큰 한도 안으로 자르고, 같은 힌트는 한 번만 만든다
        prompts: Dict[str, Tuple[str, Any]] = {}

        def prompt_for(hint: str) -> Tuple[str, Any]:
            cached = prompts.get(hint)
            if cached is not None:
                return cached
            tokenizer = processor.tokenizer
            ids = tokenizer(hint, add_special_tokens=False).input_ids
            text = hint if len(ids) <= HINT_TOKEN_MAX else str(tokenizer.decode(ids[:HINT_TOKEN_MAX]))
            prompt_ids = processor.get_prompt_ids(text, return_tensors="pt")
            if hasattr(prompt_ids, "to"):
                prompt_ids = prompt_ids.to(device)
            if len(prompts) >= 16:
                prompts.clear()
            prompts[hint] = (text, prompt_ids)
            return prompts[hint]

        # 확신도(D-V3-130): pipeline 대신 generate를 바로 불러 토큰 확률을 받는다(정적 캐시 — 맥 mps에서 동적 캐시는 scores와 함께 못 돈다).
        # 이 길이 막히면(다른 transformers·장치) 예전 pipeline 길로 돌아가고 확신도는 없다.
        scored = model.to(device) if hasattr(model, "to") else model
        if hasattr(scored, "eval"):
            scored.eval()

        def transcribe_scored(pcm: bytes, hint: str = "") -> Transcript:
            generate_kwargs: Dict[str, Any] = {
                "language": "korean", "task": "transcribe", "return_dict_in_generate": True, "output_scores": True,
                "cache_implementation": "static", "max_new_tokens": MAX_NEW_TOKENS,
            }
            used = ""
            if hint:
                used, prompt_ids = prompt_for(hint)
                generate_kwargs["prompt_ids"] = prompt_ids
            features = processor.feature_extractor(to_float(pcm), sampling_rate=SAMPLE_RATE, return_tensors="pt").input_features
            features = features.to(device, dtype=dtype)
            with torch.inference_mode():
                out = scored.generate(features, **generate_kwargs)
            text = str(processor.batch_decode(out.sequences, skip_special_tokens=True)[0])
            rows = scored.compute_transition_scores(out.sequences, out.scores, normalize_logits=True)
            conf = confidence_of(rows[0].tolist())
            sync()
            return Transcript(strip_prompt_echo(text, used), conf)

        recognizer: Any = None

        def transcribe_plain(pcm: bytes, hint: str = "") -> Transcript:
            nonlocal recognizer
            if recognizer is None:
                recognizer = pipeline(
                    "automatic-speech-recognition", model=model, tokenizer=processor.tokenizer,
                    feature_extractor=processor.feature_extractor, dtype=dtype, device=device,
                )
            generate_kwargs: Dict[str, Any] = {"language": "korean", "task": "transcribe"}
            used = ""
            if hint:
                used, prompt_ids = prompt_for(hint)
                generate_kwargs["prompt_ids"] = prompt_ids
            result = recognizer({"raw": to_float(pcm), "sampling_rate": SAMPLE_RATE}, generate_kwargs=generate_kwargs)
            sync()
            text = str(result.get("text", "") if isinstance(result, dict) else "")
            return Transcript(strip_prompt_echo(text, used), None)

        chosen: Dict[str, Callable[..., Transcript]] = {}

        def transcribe(pcm: bytes, hint: str = "") -> Transcript:
            run = chosen.get("run")
            if run is None:
                try:
                    produced = transcribe_scored(pcm, hint)
                    chosen["run"] = transcribe_scored
                    return produced
                except Exception as error:  # noqa: BLE001 — 어떤 까닭이든 예전 길로
                    sys.stderr.write(f"확신도 길을 못 써서 예전 길로 돌아가요: {type(error).__name__}\n")
                    chosen["run"] = transcribe_plain
                    return transcribe_plain(pcm, hint)
            return run(pcm, hint)

    # 처음 한 번은 느리다 — 조용한 1초로 미리 데운다
    transcribe(bytes(SAMPLE_RATE * 2))
    return transcribe
