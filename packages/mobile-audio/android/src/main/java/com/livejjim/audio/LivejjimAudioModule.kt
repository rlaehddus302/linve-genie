// 라이브지니 앱 마이크 모듈 (Expo Modules API, 이름 LivejjimAudio — APP-02).
// JS에 보이는 것: start(options) · stop() · getPermission() · requestPermission() · 사건 "frame"(pcm base64, capturedAtMs) · "state".
// 소리는 포그라운드 서비스(LivejjimAudioService)가 잡아 이 모듈의 사건으로만 넘긴다 — 파일·로그에 남기지 않는다(D-APP-03).
package com.livejjim.audio

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class StartOptions : Record {
  @Field val sampleRate: Int = 16000
  @Field val frameMs: Int = 100
  @Field val notificationTitle: String = "라이브지니"
  @Field val notificationText: String = "음성 듣는 중 · 눌러서 돌아가기"
}

class PermissionDeniedException : CodedException("E_PERMISSION_DENIED", "마이크 사용이 막혀 있어요", null)
class UnsupportedRateException(rate: Int) : CodedException("E_UNSUPPORTED", "표본률 $rate 은 받지 않는다 (16000만)", null)
class NoMicrophoneException : CodedException("E_NO_MICROPHONE", "마이크를 찾지 못했어요", null)

class LivejjimAudioModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext) { "React context 없음" }

  override fun definition() = ModuleDefinition {
    Name("LivejjimAudio")
    Events("frame", "state")

    OnCreate {
      AudioFrameBus.listener = object : AudioFrameBus.Listener {
        override fun onFrame(pcm: ByteArray, capturedAtMs: Long) {
          // base64로 넘긴다 (Expo 사건 payload의 바이트 지원 여부와 상관없이 같은 길)
          sendEvent("frame", mapOf("pcm" to Base64.encodeToString(pcm, Base64.NO_WRAP), "capturedAtMs" to capturedAtMs))
        }
        override fun onState(state: String, reason: String?) {
          sendEvent("state", if (reason == null) mapOf("state" to state) else mapOf("state" to state, "reason" to reason))
        }
      }
    }

    OnDestroy {
      AudioFrameBus.listener = null
      stopService()
    }

    AsyncFunction("getPermission") { promise: Promise ->
      promise.resolve(permissionMap())
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      val manager = appContext.permissions
      if (manager == null) {
        promise.resolve(permissionMap())
        return@AsyncFunction
      }
      val wanted = mutableListOf(Manifest.permission.RECORD_AUDIO)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) wanted.add(Manifest.permission.POST_NOTIFICATIONS)
      manager.askForPermissions({ _ -> promise.resolve(permissionMap()) }, *wanted.toTypedArray())
    }

    AsyncFunction("start") { options: StartOptions, promise: Promise ->
      if (options.sampleRate != PcmRecorder.SAMPLE_RATE) throw UnsupportedRateException(options.sampleRate)
      if (!hasRecordPermission()) throw PermissionDeniedException()
      if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE)) throw NoMicrophoneException()
      val intent = Intent(context, LivejjimAudioService::class.java).apply {
        action = LivejjimAudioService.ACTION_START
        putExtra(LivejjimAudioService.EXTRA_TITLE, options.notificationTitle)
        putExtra(LivejjimAudioService.EXTRA_TEXT, options.notificationText)
        putExtra(LivejjimAudioService.EXTRA_FRAME_MS, options.frameMs)
      }
      ContextCompat.startForegroundService(context, intent)
      promise.resolve(null)
    }

    AsyncFunction("stop") { promise: Promise ->
      stopService()
      promise.resolve(null)
    }
  }

  private fun stopService() {
    val ctx = appContext.reactContext ?: return
    ctx.startService(Intent(ctx, LivejjimAudioService::class.java).apply { action = LivejjimAudioService.ACTION_STOP })
  }

  private fun hasRecordPermission(): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  private fun permissionMap(): Map<String, Any> {
    val granted = hasRecordPermission()
    val manager: Permissions? = appContext.permissions
    val status = when {
      granted -> "granted"
      manager == null -> "undetermined"
      else -> "denied"
    }
    val activity = appContext.currentActivity
    val canAskAgain = granted || activity == null || activity.shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO) || !PermissionMemory.asked(context)
    return mapOf("status" to status, "granted" to granted, "canAskAgain" to canAskAgain)
  }
}

/** 한 번이라도 물었는지 (거절 뒤 "다시 묻지 않음"을 알아보려고) */
object PermissionMemory {
  private const val PREFS = "livejjim_audio"
  private const val KEY = "asked_record_audio"
  fun asked(context: android.content.Context): Boolean = context.getSharedPreferences(PREFS, 0).getBoolean(KEY, false)
  fun markAsked(context: android.content.Context) {
    context.getSharedPreferences(PREFS, 0).edit().putBoolean(KEY, true).apply()
  }
}

/** 서비스 → 모듈 다리. 소리 바이트는 메모리에서 바로 넘기고 어디에도 두지 않는다 */
object AudioFrameBus {
  interface Listener {
    fun onFrame(pcm: ByteArray, capturedAtMs: Long)
    fun onState(state: String, reason: String?)
  }
  @Volatile var listener: Listener? = null
}
