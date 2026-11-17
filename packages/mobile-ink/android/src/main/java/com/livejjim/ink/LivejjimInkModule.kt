// 손글씨 읽기 (Expo Modules API, 이름 LivejjimInk — 안드로이드, D-HANDWRITE-02).
// ML Kit 손글씨 읽기(digital ink)로 품종 칸에 쓴 획을 휴대폰 안에서 읽는다 — 획은 밖으로 보내지 않는다.
// - prepare(language): 그 말의 모델이 없으면 처음 한 번 받는다(약 20MB, 구글 서버). 받았으면 바로 true.
// - recognize(strokes, width, height, language, hints): 획([x, y, t, …])을 읽어 후보 글을 그럴듯한 것부터 돌려준다.
//   hints는 아이폰 쪽에서만 쓴다(ML Kit에는 낱말 목록을 넘길 자리가 없다).
package com.livejjim.ink

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.DigitalInkRecognizer
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.Ink
import com.google.mlkit.vision.digitalink.RecognitionContext
import com.google.mlkit.vision.digitalink.WritingArea
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LivejjimInkModule : Module() {
  private val recognizers = mutableMapOf<String, DigitalInkRecognizer>()

  private fun modelOf(language: String): DigitalInkRecognitionModel? {
    val identifier = try {
      DigitalInkRecognitionModelIdentifier.fromLanguageTag(language)
    } catch (_: Exception) {
      null
    } ?: return null
    return DigitalInkRecognitionModel.builder(identifier).build()
  }

  private fun recognizerOf(language: String, model: DigitalInkRecognitionModel): DigitalInkRecognizer =
    synchronized(recognizers) {
      recognizers.getOrPut(language) { DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build()) }
    }

  override fun definition() = ModuleDefinition {
    Name("LivejjimInk")

    AsyncFunction("prepare") { language: String, promise: Promise ->
      val model = modelOf(language)
      if (model == null) {
        promise.resolve(false)
      } else {
        val manager = RemoteModelManager.getInstance()
        manager.isModelDownloaded(model)
          .addOnSuccessListener { downloaded ->
            if (downloaded) {
              promise.resolve(true)
            } else {
              manager.download(model, DownloadConditions.Builder().build())
                .addOnSuccessListener { promise.resolve(true) }
                .addOnFailureListener { promise.resolve(false) }
            }
          }
          .addOnFailureListener { promise.resolve(false) }
      }
    }

    AsyncFunction("recognize") { strokes: List<List<Double>>, width: Double, height: Double, language: String, _: List<String>, promise: Promise ->
      val model = modelOf(language)
      if (model == null) {
        promise.resolve(emptyList<String>())
      } else {
        val ink = Ink.builder()
        var any = false
        for (stroke in strokes) {
          val builder = Ink.Stroke.builder()
          var index = 0
          var points = 0
          while (index + 2 < stroke.size) {
            builder.addPoint(Ink.Point.create(stroke[index].toFloat(), stroke[index + 1].toFloat(), stroke[index + 2].toLong()))
            index += 3
            points += 1
          }
          if (points > 0) {
            ink.addStroke(builder.build())
            any = true
          }
        }
        if (!any) {
          promise.resolve(emptyList<String>())
        } else {
          val context = RecognitionContext.builder()
            .setPreContext("")
            .setWritingArea(WritingArea(width.toFloat(), height.toFloat()))
            .build()
          recognizerOf(language, model).recognize(ink.build(), context)
            .addOnSuccessListener { result -> promise.resolve(result.candidates.map { it.text }) }
            .addOnFailureListener { error -> promise.reject("ERR_INK_READ", error.message ?: "손글씨를 읽지 못했어요", error) }
        }
      }
    }

    OnDestroy {
      synchronized(recognizers) {
        recognizers.values.forEach { it.close() }
        recognizers.clear()
      }
    }
  }
}
