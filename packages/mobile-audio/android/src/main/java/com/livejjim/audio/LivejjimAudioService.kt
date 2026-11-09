// 마이크 포그라운드 서비스 (APP-02, D-APP-11): 고정 알림 "라이브지니 · 음성 인식 중 · 눌러서 돌아가기"를 띄우고
// AudioRecord(16kHz 모노 PCM16)로 100ms = 3,200바이트 틀을 읽어 AudioFrameBus로 넘긴다.
// - 알림에는 끄기 단추가 없다(실수로 끄지 않게). 누르면 앱으로 돌아간다.
// - 전화 등으로 마이크를 뺏기면(읽기 오류·조용해짐 알림) INTERRUPTED를 알리고 1초마다 다시 잡는다. 잡히면 LISTENING.
// - 소리는 파일·로그에 남기지 않는다(D-APP-03). 로그에는 셈만.
package com.livejjim.audio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class LivejjimAudioService : Service() {
  companion object {
    const val ACTION_START = "com.livejjim.audio.START"
    const val ACTION_STOP = "com.livejjim.audio.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_FRAME_MS = "frameMs"
    const val CHANNEL_ID = "livejjim_listening"
    const val CHANNEL_NAME = "음성 인식 중"
    const val NOTIFICATION_ID = 7101
  }

  private var recorder: PcmRecorder? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopRecording()
        stopForegroundCompat()
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "라이브지니"
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "음성 인식 중 · 눌러서 돌아가기"
        val frameMs = intent?.getIntExtra(EXTRA_FRAME_MS, 100) ?: 100
        startInForeground(buildNotification(title, text))
        startRecording(frameMs)
        return START_STICKY
      }
    }
  }

  override fun onDestroy() {
    stopRecording()
    super.onDestroy()
  }

  private fun startInForeground(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
  }

  private fun buildNotification(title: String, text: String): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
        setSound(null, null)
      }
      manager.createNotificationChannel(channel)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
    val tap = if (launch == null) null else PendingIntent.getActivity(this, 0, launch, flags)
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(tap)
      // 끄기 동작을 두지 않는다 — 눌러서 돌아가기만 (APP-02)
      .build()
  }

  private fun startRecording(frameMs: Int) {
    if (recorder != null) return
    val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    recorder = PcmRecorder(audioManager, frameMs, object : PcmRecorder.Sink {
      override fun onFrame(pcm: ByteArray, capturedAtMs: Long) {
        AudioFrameBus.listener?.onFrame(pcm, capturedAtMs)
      }
      override fun onState(state: String, reason: String?) {
        AudioFrameBus.listener?.onState(state, reason)
      }
    }).also { it.start() }
  }

  private fun stopRecording() {
    recorder?.stop()
    recorder = null
    AudioFrameBus.listener?.onState("OFF", null)
  }
}

/**
 * AudioRecord 읽기 실. 16kHz 모노 PCM16, 틀마다 frameMs × 32바이트(100ms = 3,200). 마지막 자투리는 보내지 않는다.
 * 읽기 오류(-3 등)·조용해짐(다른 앱이 마이크를 가짐)이면 INTERRUPTED → 1초마다 다시 열기.
 */
class PcmRecorder(private val audioManager: AudioManager, frameMs: Int, private val sink: Sink) {
  interface Sink {
    fun onFrame(pcm: ByteArray, capturedAtMs: Long)
    fun onState(state: String, reason: String?)
  }

  companion object {
    const val SAMPLE_RATE = 16000
    const val BYTES_PER_MS = 32
    const val RETRY_MS = 1000L
  }

  private val frameBytes = frameMs * BYTES_PER_MS
  @Volatile private var running = false
  private var thread: Thread? = null
  private var record: AudioRecord? = null
  @Volatile private var silenced = false
  private var frames = 0L

  private val silenceCallback = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) object : AudioManager.AudioRecordingCallback() {
    override fun onRecordingConfigChanged(configs: MutableList<android.media.AudioRecordingConfiguration>) {
      val mine = record?.audioSessionId ?: return
      val now = configs.any { it.clientAudioSessionId == mine && it.isClientSilenced }
      if (now != silenced) {
        silenced = now
        sink.onState(if (now) "INTERRUPTED" else "LISTENING", null)
      }
    }
  } else null

  fun start() {
    if (running) return
    running = true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && silenceCallback != null) {
      audioManager.registerAudioRecordingCallback(silenceCallback, null)
    }
    thread = Thread({ loop() }, "livejjim-pcm").also { it.start() }
  }

  fun stop() {
    running = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && silenceCallback != null) {
      audioManager.unregisterAudioRecordingCallback(silenceCallback)
    }
    thread?.interrupt()
    thread = null
    release()
    android.util.Log.i("LivejjimAudio", "녹음 끝: 틀 $frames 개")
  }

  private fun open(): AudioRecord? {
    val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minBuffer <= 0) return null
    val buffer = maxOf(minBuffer, frameBytes * 4)
    return try {
      val r = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, buffer)
      if (r.state != AudioRecord.STATE_INITIALIZED) {
        r.release()
        null
      } else r
    } catch (_: Exception) {
      null
    }
  }

  private fun release() {
    val r = record
    record = null
    try {
      r?.stop()
    } catch (_: Exception) {
    }
    r?.release()
  }

  private fun loop() {
    val frame = ByteArray(frameBytes)
    var interrupted = false
    while (running) {
      var r = record
      if (r == null) {
        r = open()
        if (r == null) {
          if (!interrupted) {
            interrupted = true
            sink.onState("INTERRUPTED", null)
          }
          try {
            Thread.sleep(RETRY_MS)
          } catch (_: InterruptedException) {
            return
          }
          continue
        }
        record = r
        try {
          r.startRecording()
        } catch (_: Exception) {
          release()
          continue
        }
        if (r.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
          release()
          continue
        }
        interrupted = false
        sink.onState("LISTENING", null)
      }
      var filled = 0
      var failed = false
      while (running && filled < frameBytes) {
        val n = r.read(frame, filled, frameBytes - filled)
        if (n < 0) {
          failed = true
          break
        }
        filled += n
      }
      if (!running) return
      if (failed) {
        release()
        if (!interrupted) {
          interrupted = true
          sink.onState("INTERRUPTED", null)
        }
        try {
          Thread.sleep(RETRY_MS)
        } catch (_: InterruptedException) {
          return
        }
        continue
      }
      // 틀의 첫 표본 시각 = 지금 − 틀 길이 (벽시계 — 서버 말 끝 시각 셈과 같은 눈금)
      val capturedAt = System.currentTimeMillis() - frameBytes / BYTES_PER_MS
      frames++
      sink.onFrame(frame.copyOf(), capturedAt)
    }
  }
}
