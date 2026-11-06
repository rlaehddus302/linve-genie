"""APP1 실제 모델 로딩에서 발견한 transformers 5 옵션 누출 회귀. 무거운 꾸러미 없이 검사한다."""
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from livegenie_transcriber.config import parse_args
from livegenie_transcriber.runtime import load_transcriber


class FloatSamples:
    def astype(self, _dtype):
        return self

    def __truediv__(self, _scale):
        return self


class WhisperLoadingTest(unittest.TestCase):
    def test_cache_options_stay_at_loading_boundary_and_korean_audio_is_transcribed(self):
        config = parse_args(["--server", "http://localhost:7700", "--token-file", "/test/token",
                             "--model", "whisper", "--device", "cpu"], {})
        processor = SimpleNamespace(tokenizer=object(), feature_extractor=object())
        model = object()
        processor_loader = Mock(side_effect=[OSError("not cached"), processor])
        model_loader = Mock(return_value=model)
        recognizer = Mock(return_value={"text": "15번 이만 원"})

        # 명시한 인자만 받는다. local_files_only/model_kwargs가 pipeline으로
        # 새면 실패한다(실제 5.21은 이를 generate로 넘겨 음성 한 조각부터 실패했다).
        def pipeline(task, *, model, tokenizer, feature_extractor, dtype, device):
            self.assertEqual(task, "automatic-speech-recognition")
            self.assertIs(model, model_loader.return_value)
            self.assertIs(tokenizer, processor.tokenizer)
            self.assertIs(feature_extractor, processor.feature_extractor)
            self.assertEqual((dtype, device), ("float32", "cpu"))
            return recognizer

        transformers = SimpleNamespace(AutoProcessor=SimpleNamespace(from_pretrained=processor_loader),
                                       AutoModelForSpeechSeq2Seq=SimpleNamespace(from_pretrained=model_loader),
                                       pipeline=pipeline)
        numpy = SimpleNamespace(frombuffer=Mock(return_value=FloatSamples()), float32="float32")
        torch = SimpleNamespace(float32="float32", float16="float16")
        modules = {"numpy": numpy, "torch": torch, "transformers": transformers}
        with patch.dict("sys.modules", modules), patch("livegenie_transcriber.runtime.quiet_libraries"):
            transcribe = load_transcriber(config)
            self.assertEqual(transcribe(bytes(3200)), "15번 이만 원")
        self.assertEqual([call.kwargs["local_files_only"] for call in processor_loader.call_args_list], [True, False])
        model_loader.assert_called_once_with(config.model_id, dtype="float32", local_files_only=True)
        self.assertEqual(recognizer.call_count, 2)  # 워밍업 한 번 + 실제 조각 한 번
        self.assertEqual(recognizer.call_args.kwargs, {"generate_kwargs": {"language": "korean", "task": "transcribe"}})
        self.assertEqual(recognizer.call_args.args[0]["sampling_rate"], 16000)


if __name__ == "__main__":
    unittest.main()


class HintPromptTest(unittest.TestCase):
    """D-V3-127: 위스퍼는 힌트를 앞 문장(prompt_ids)으로 받고, 토큰 한도로 자르며, 결과 앞에 되풀이된 앞 문장은 뗀다"""

    def test_whisper_gets_prompt_ids_and_strips_echo(self):
        from livegenie_transcriber.runtime import HINT_TOKEN_MAX, strip_prompt_echo
        config = parse_args(["--server", "http://localhost:7700", "--token-file", "/test/token", "--model", "whisper", "--device", "cpu"], {})

        class Tokenizer:
            def __call__(self, text, add_special_tokens=False):
                return SimpleNamespace(input_ids=list(range(len(text))))

            def decode(self, ids):
                return "잘림" + str(len(ids))

        prompt_calls = []
        processor = SimpleNamespace(tokenizer=Tokenizer(), feature_extractor=object(), get_prompt_ids=lambda text, return_tensors: prompt_calls.append(text) or ("ids", text))
        recognizer = Mock(return_value={"text": "이백팔번 오만 원. 녹금. 십오번 이만 원"})
        transformers = SimpleNamespace(AutoProcessor=SimpleNamespace(from_pretrained=Mock(return_value=processor)),
                                       AutoModelForSpeechSeq2Seq=SimpleNamespace(from_pretrained=Mock(return_value=object())),
                                       pipeline=lambda *a, **k: recognizer)
        numpy = SimpleNamespace(frombuffer=Mock(return_value=FloatSamples()), float32="float32")
        torch = SimpleNamespace(float32="float32", float16="float16")
        with patch.dict("sys.modules", {"numpy": numpy, "torch": torch, "transformers": transformers}), patch("livegenie_transcriber.runtime.quiet_libraries"):
            transcribe = load_transcriber(config)
            self.assertEqual(transcribe(bytes(3200), "이백팔번 오만 원. 녹금."), "십오번 이만 원")
            self.assertEqual(recognizer.call_args.kwargs["generate_kwargs"], {"language": "korean", "task": "transcribe", "prompt_ids": ("ids", "이백팔번 오만 원. 녹금.")})
            # 같은 힌트는 한 번만 만든다
            transcribe(bytes(3200), "이백팔번 오만 원. 녹금.")
            self.assertEqual(prompt_calls, ["이백팔번 오만 원. 녹금."])
            # 토큰 한도를 넘는 힌트는 잘라 쓴다
            transcribe(bytes(3200), "가" * (HINT_TOKEN_MAX + 20))
            self.assertEqual(prompt_calls[-1], f"잘림{HINT_TOKEN_MAX}")
            # 힌트 없이도 그대로
            transcribe(bytes(3200))
            self.assertNotIn("prompt_ids", recognizer.call_args.kwargs["generate_kwargs"])
        self.assertEqual(strip_prompt_echo("아사달금, 녹금.", "이백팔번 오만 원. 아사달금, 녹금."), "")
        self.assertEqual(strip_prompt_echo("오만 원", "이백팔번 오만 원."), "오만 원")
