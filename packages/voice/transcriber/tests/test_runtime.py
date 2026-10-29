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
