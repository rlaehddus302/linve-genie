// 서버로 보내기 — 안드로이드 전송은 이 파일 한 곳 (SPEC ORD-13 C-04, AC-SMS3-27). 요청 모양·서버 답 처리는 NoticeContract.
// - 받은 차례대로 20건씩 POST(Authorization: Bearer). 200이면 묶음을 지우고 결과(SAVED·DUPLICATE·IGNORED)를 세고, 응답 filters를 저장한다.
// - 400(모양)이면 서버가 아무것도 처리하지 않았다 — 묶음을 한 건씩 다시 보내 틀린 한 건만 버린다.
// - 401이면 멈추고 대기열을 지킨다("받기 토큰을 다시 넣어 주세요"). 429면 1분 동안 보내지 않고 1분 뒤 같은 id로 다시.
// - 연결 실패·5xx는 멈추고 WorkManager에 다시 보내기를 맡긴다(인터넷 연결 조건 + 지수 물러서기). 재부팅 뒤에도 WorkManager가 이어서 돈다.
// - 대기열이 비었고 filters를 아직 받지 못했으면(또는 켤 때·토큰을 넣을 때) 0건 요청으로 filters만 받는다.
// - 리다이렉트는 따라가지 않는다(토큰이 다른 곳으로 가지 않게). 토큰·본문·번호는 로그에 남기지 않는다(C-07).
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
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock

internal data class DrainResult(val sent: Int, val pending: Int, val stoppedBy: String?)

internal data class PostResult(val status: Int?, val body: String)

internal object NoticeSender {
  private const val CONNECT_TIMEOUT_MS = 10_000
  private const val READ_TIMEOUT_MS = 15_000
  /** 응답 본문은 이만큼만 읽는다 (결과 20건 + filters) */
  private const val RESPONSE_MAX_BYTES = 256 * 1024
  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "livejjim-notice-send") }
  private val draining = ReentrantLock()

  /** 지금 보내 보고, 못 보낸 것이 남으면 WorkManager에 맡긴다. fetchFilters면 대기열이 비어도 filters를 새로 받는다 */
  fun kick(context: Context, fetchFilters: Boolean = false) {
    val app = context.applicationContext
    executor.execute {
      try {
        schedule(app, drain(app, fetchFilters) { false })
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
      "BUSY" -> {
        val wait = (NoticeStore.get(context).notBeforeMs() - System.currentTimeMillis()).coerceIn(0L, NoticeContract.TOO_MANY_WAIT_MS)
        NoticeUploadWorker.enqueue(context, wait)
      }
    }
  }

  /** 대기열을 받은 차례대로 20건씩 보낸다. 한 번에 한 곳만 보낸다(잠금) */
  fun drain(context: Context, fetchFilters: Boolean, isStopped: () -> Boolean): DrainResult {
    val store = NoticeStore.get(context)
    draining.lock()
    try {
      val config = store.token() ?: return DrainResult(0, store.pendingCount(), "NO_TOKEN")
      if (store.isTokenRejected()) return DrainResult(0, store.pendingCount(), "TOKEN")
      if (System.currentTimeMillis() < store.notBeforeMs()) return DrainResult(0, store.pendingCount(), "BUSY")
      var sent = 0
      var single = false
      var askedFilters = false
      while (true) {
        if (isStopped()) return DrainResult(sent, store.pendingCount(), "NETWORK")
        val files = store.pendingFiles().take(if (single) 1 else NoticeContract.BATCH_MAX)
        val batch = ArrayList<Pair<File, InboxMessage>>()
        for (file in files) store.read(file)?.let { batch.add(file to it) }
        if (files.isNotEmpty() && batch.isEmpty()) {
          // 풀지 못한 파일만 있었다 — 지워졌으면 다음 묶음, 지우지 못했으면 멈춘다(끝없이 돌지 않게)
          if (files.any { it.exists() }) break
          continue
        }
        if (batch.isEmpty()) {
          if (askedFilters || !(fetchFilters || store.filters() == null)) break
          askedFilters = true
        }
        val reply = post(config.endpoint, config.token, NoticeContract.requestJson(config.deviceName, batch.map { it.second }))
        when (NoticeContract.classify(reply.status)) {
          "done" -> {
            val response = NoticeContract.parseResponse(reply.body)
            response.filters?.let { store.setFilters(it) }
            val now = System.currentTimeMillis()
            for ((file, message) in batch) {
              store.remove(file)
              when (response.results[message.id]) {
                "DUPLICATE" -> store.bump("duplicates")
                "IGNORED" -> store.bump("ignored")
                else -> {
                  store.bump("sent")
                  sent++
                }
              }
            }
            if (batch.isNotEmpty()) store.markSent(now) else store.setLastError(null)
          }
          "bad" -> {
            if (batch.size > 1) {
              single = true
            } else if (batch.size == 1) {
              store.remove(batch[0].first)
              store.bump("rejected")
            }
          }
          "token" -> {
            store.setTokenRejected()
            return DrainResult(sent, store.pendingCount(), "TOKEN")
          }
          "wait" -> {
            store.setNotBeforeMs(System.currentTimeMillis() + NoticeContract.TOO_MANY_WAIT_MS)
            store.setLastError("BUSY")
            return DrainResult(sent, store.pendingCount(), "BUSY")
          }
          else -> {
            val why = if (reply.status == null) "NETWORK" else "SERVER"
            store.setLastError(why)
            return DrainResult(sent, store.pendingCount(), why)
          }
        }
        NoticeBus.changed(context)
      }
      store.setLastError(null)
      return DrainResult(sent, store.pendingCount(), null)
    } finally {
      draining.unlock()
      NoticeBus.changed(context)
    }
  }

  /** POST 한 번 → 상태 번호·본문(2xx만), 연결 실패는 null */
  private fun post(endpoint: String, token: String, json: String): PostResult {
    if (!NoticeContract.isAllowedEndpoint(endpoint)) return PostResult(null, "")
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
      val body = try {
        (if (code >= 400) connection.errorStream else connection.inputStream)?.use { stream ->
          val out = java.io.ByteArrayOutputStream()
          val buffer = ByteArray(8192)
          while (true) {
            val n = stream.read(buffer)
            if (n < 0) break
            if (out.size() + n <= RESPONSE_MAX_BYTES) out.write(buffer, 0, n)
          }
          if (code in 200..299) String(out.toByteArray(), Charsets.UTF_8) else ""
        } ?: ""
      } catch (_: IOException) {
        ""
      }
      PostResult(code, body)
    } catch (_: IOException) {
      PostResult(null, "")
    } catch (_: SecurityException) {
      PostResult(null, "")
    } finally {
      connection?.disconnect()
    }
  }
}

/** 다시 보내기 — 인터넷이 연결되면 돈다. 앱이 꺼져 있어도·재부팅 뒤에도 WorkManager가 이어 돈다 */
class NoticeUploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val result = NoticeSender.drain(applicationContext, false) { isStopped }
    return when (result.stoppedBy) {
      // BUSY(429)도 물러서기(30초부터)로 다시 — 1분이 지나기 전이면 drain이 보내지 않고 다시 BUSY
      "NETWORK", "SERVER", "BUSY" -> Result.retry()
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
