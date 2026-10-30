// 서버로 보내기 — 안드로이드 전송은 이 파일 한 곳 (SMS3). 봉투 모양·서버 답 처리는 NoticeContract.
// - 받은 차례대로 한 건씩 POST(Authorization: Bearer). 2xx·409는 지우고, 그 밖의 4xx는 버리고 건수만, 401·403은 멈추고 대기열을 지킨다.
// - 연결 실패·5xx·429는 멈추고 WorkManager에 다시 보내기를 맡긴다(인터넷 연결 조건 + 지수 물러서기). 재부팅 뒤에도 WorkManager가 이어서 돈다.
// - 리다이렉트는 따라가지 않는다(토큰이 다른 곳으로 가지 않게). 토큰·본문·번호는 로그에 남기지 않는다.
package com.livejjim.notice

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock

internal data class DrainResult(val sent: Int, val pending: Int, val stoppedBy: String?)

internal object NoticeSender {
  private const val CONNECT_TIMEOUT_MS = 10_000
  private const val READ_TIMEOUT_MS = 15_000
  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "livejjim-notice-send") }
  private val draining = ReentrantLock()

  /** 지금 보내 보고, 못 보낸 것이 남으면 WorkManager에 맡긴다 */
  fun kick(context: Context) {
    val app = context.applicationContext
    executor.execute {
      try {
        schedule(app, drain(app) { false })
      } catch (_: Exception) {
        NoticeUploadWorker.enqueue(app, NoticeContract.RETRY_INITIAL_DELAY_MS)
      }
    }
  }

  /** 다시 보낼 까닭이면 WorkManager에 */
  fun schedule(context: Context, result: DrainResult) {
    when (result.stoppedBy) {
      "NETWORK" -> NoticeUploadWorker.enqueue(context, 0L)
      "SERVER" -> NoticeUploadWorker.enqueue(context, NoticeContract.RETRY_INITIAL_DELAY_MS)
    }
  }

  /** 대기열을 받은 차례대로 보낸다. 한 번에 한 곳만 보낸다(잠금) */
  fun drain(context: Context, isStopped: () -> Boolean): DrainResult {
    val store = NoticeStore.get(context)
    draining.lock()
    try {
      val config = store.token() ?: return DrainResult(0, store.pendingCount(), "NO_TOKEN")
      if (store.isTokenRejected()) return DrainResult(0, store.pendingCount(), "TOKEN")
      var sent = 0
      while (true) {
        val files = store.pendingFiles()
        if (files.isEmpty()) break
        for (file in files) {
          if (isStopped()) return DrainResult(sent, store.pendingCount(), "NETWORK")
          val candidate = store.read(file) ?: continue
          val now = System.currentTimeMillis()
          val status = post(config.endpoint, config.token, NoticeContract.envelopeJson(candidate, now, config.deviceId))
          when (NoticeContract.classify(status)) {
            "accepted" -> {
              store.remove(file)
              store.bump("sent")
              store.markSent(now)
              sent++
            }
            "duplicate" -> {
              store.remove(file)
              store.markSent(now)
            }
            "rejected" -> {
              store.remove(file)
              store.bump("rejected")
            }
            "token" -> {
              store.setTokenRejected()
              return DrainResult(sent, store.pendingCount(), "TOKEN")
            }
            else -> {
              val why = if (status == null) "NETWORK" else "SERVER"
              store.setLastError(why)
              return DrainResult(sent, store.pendingCount(), why)
            }
          }
          NoticeBus.changed(context)
        }
      }
      store.setLastError(null)
      return DrainResult(sent, 0, null)
    } finally {
      draining.unlock()
      NoticeBus.changed(context)
    }
  }

  /** POST 한 번 → 상태 번호, 연결 실패는 null */
  private fun post(endpoint: String, token: String, json: String): Int? {
    if (!NoticeContract.isAllowedEndpoint(endpoint)) return null
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        instanceFollowRedirects = false
        useCaches = false
        doOutput = true
        setRequestProperty("Authorization", NoticeContract.bearer(token))
        setRequestProperty("Content-Type", NoticeContract.CONTENT_TYPE)
        setRequestProperty("Accept", NoticeContract.CONTENT_TYPE)
      }
      val bytes = json.toByteArray(Charsets.UTF_8)
      connection.setFixedLengthStreamingMode(bytes.size)
      connection.outputStream.use { it.write(bytes) }
      val code = connection.responseCode
      // 답 본문은 읽어 버린다(연결 재사용) — 내용은 쓰지 않는다
      try {
        (if (code >= 400) connection.errorStream else connection.inputStream)?.use { stream -> while (stream.read() != -1) Unit }
      } catch (_: IOException) {
        // 본문 없음
      }
      code
    } catch (_: IOException) {
      null
    } catch (_: SecurityException) {
      null
    } finally {
      connection?.disconnect()
    }
  }
}

/** 다시 보내기 — 인터넷이 연결되면 돈다. 앱이 꺼져 있어도·재부팅 뒤에도 WorkManager가 이어 돈다 */
class NoticeUploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val result = NoticeSender.drain(applicationContext) { isStopped }
    return when (result.stoppedBy) {
      "NETWORK", "SERVER" -> Result.retry()
      else -> Result.success()
    }
  }

  companion object {
    const val UNIQUE_NAME = "livejjim-notice-upload"

    fun enqueue(context: Context, delayMs: Long) {
      val request = OneTimeWorkRequest.Builder(NoticeUploadWorker::class.java)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, NoticeContract.RETRY_INITIAL_DELAY_MS, TimeUnit.MILLISECONDS)
        .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
        .build()
      WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.REPLACE, request)
    }
  }
}

/** 재부팅·앱 갱신 뒤 이어받기: 남은 대기열을 WorkManager에, 알림 읽기 서비스는 다시 붙여 달라고 */
class NoticeBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    val store = NoticeStore.get(context)
    if (store.pendingCount() > 0) NoticeUploadWorker.enqueue(context, 0L)
    if (store.isEnabled() && NoticeAccess.isGranted(context) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      NotificationListenerService.requestRebind(ComponentName(context, NoticeListenerService::class.java))
    }
  }
}
