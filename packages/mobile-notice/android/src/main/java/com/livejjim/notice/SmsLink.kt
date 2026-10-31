// 문자 직접 받기 (SMS4, D-SMS4-01~) — 판매자 휴대폰의 문자 저장소(Telephony.Sms·Mms)와 새 문자 수신(SMS_RECEIVED)에서 손님 문자를 읽어
// 알림 받기와 같은 암호화 대기열(NoticeStore)에 넣고 같은 보내기(NoticeSender)로 서버에 보낸다.
// - 빌드 스위치 LIVEGENIE_SMS=on 일 때만 READ_SMS·RECEIVE_SMS 권한과 수신기가 매니페스트에 남는다(기본 off — Play SMS 권한 정책).
//   매니페스트에 권한이 없으면 available=false: 아무것도 읽지 않는다.
// - 도는 조건: 휴대폰 알림 받기가 켜짐 + 문자 연동을 켬 + 문자 읽기 권한 허용.
// - 따라잡기(앱 열 때·재부팅·알림 읽기 서비스가 붙을 때·저장소가 바뀔 때·문자 수신 뒤): 마지막 줄 번호 다음부터, 최근 24시간만.
// - RCS: 공개 저장소(content://sms·mms)에 없는 RCS(삼성 메시지 content://im/chat 같은 비공개 제공자)는 읽지 않는다 — 기본 문자 앱 알림 길이 맡는다.
// 본문·번호는 로그에 남기지 않는다. 대기열 파일은 Keystore로 암호화된다(NoticeStore).
package com.livejjim.notice

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.database.Cursor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Telephony
import androidx.core.content.ContextCompat
import java.io.File
import java.util.concurrent.Executors

internal object SmsLink {
  private const val PREFS = "livejjim_sms"
  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "livejjim-sms") }
  private val scanLock = Any()
  private val recent = RecentBodies()
  @Volatile private var recentLoaded = false

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private fun recentFile(context: Context) = File(File(context.applicationContext.noBackupFilesDir, "livejjim-notice"), "sms-bodies.txt")

  /** 이 빌드에 문자 권한이 들어 있나 (LIVEGENIE_SMS=on 빌드만) */
  fun available(context: Context): Boolean = try {
    val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
    val requested = info.requestedPermissions?.toList() ?: emptyList()
    requested.contains(Manifest.permission.READ_SMS) && requested.contains(Manifest.permission.RECEIVE_SMS)
  } catch (_: Exception) {
    false
  }

  fun granted(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED

  fun isEnabled(context: Context): Boolean = prefs(context).getBoolean("enabled", false)

  fun setEnabled(context: Context, on: Boolean) {
    prefs(context).edit().putBoolean("enabled", on).apply()
  }

  /** 지금 읽고 보내도 되나 */
  fun active(context: Context): Boolean =
    isEnabled(context) && NoticeStore.get(context).isEnabled() && available(context) && granted(context)

  fun cursor(context: Context): SmsCursor {
    val p = prefs(context)
    return SmsCursor(p.getLong("smsId", 0L), p.getLong("mmsId", 0L))
  }

  private fun saveCursor(context: Context, cursor: SmsCursor, nowMs: Long) {
    prefs(context).edit().putLong("smsId", cursor.smsId).putLong("mmsId", cursor.mmsId).putLong("lastScanAtMs", nowMs).apply()
  }

  fun stateMap(context: Context): Map<String, Any> {
    val map = mutableMapOf<String, Any>(
      "available" to available(context),
      "permission" to if (granted(context)) "granted" else "needed",
      "enabled" to isEnabled(context),
      "active" to active(context),
      // RCS는 공개 저장소에 없다 — 기본 문자 앱 알림(알림 읽기)으로만 받는다
      "rcs" to "notification",
    )
    prefs(context).getLong("lastScanAtMs", 0L).takeIf { it > 0 }?.let { map["lastScanAtMs"] = it.toDouble() }
    return map
  }

  // ── 본문 지문 (알림 길과 겹치기) ──
  private fun ensureRecent(context: Context) {
    if (recentLoaded) return
    synchronized(recent) {
      if (recentLoaded) return
      val file = recentFile(context)
      if (file.exists()) {
        try {
          recent.load(file.readText())
        } catch (_: Exception) {
          // 깨진 파일은 무시 (서버가 한 번 더 막는다)
        }
      }
      recentLoaded = true
    }
  }

  private fun remember(context: Context, message: InboxMessage) {
    ensureRecent(context)
    recent.add(SmsCore.bodyHash(message.text), message.receivedAt)
    try {
      val file = recentFile(context)
      file.parentFile?.mkdirs()
      file.writeText(recent.serialize())
    } catch (_: Exception) {
      // 기억하지 못해도 서버가 같은 내용 60초로 막는다
    }
  }

  /** 기본 문자 앱 알림에서 온 문자가 이미 저장소·수신기로 들어간 것인가 (같은 본문, 앞뒤 3분) */
  fun alreadyTaken(context: Context, message: InboxMessage): Boolean {
    if (message.channel != "SMS" || !active(context)) return false
    // 알림이 저장소 읽기보다 먼저 올 수 있다 — 한 번 읽고 본다
    scanBlocking(context)
    ensureRecent(context)
    return recent.matches(SmsCore.bodyHash(message.text), message.receivedAt)
  }

  /** 한 건 넣기 — 거르기(skipWords, 은행 대표번호는 거르지 않음) → 대기열. 넣었으면 true */
  private fun offer(context: Context, message: InboxMessage, nowMs: Long): Boolean {
    val store = NoticeStore.get(context)
    // 수신기·저장소가 같은 문자를 함께 읽는 것은 정상 — 건수는 한 번만 센다
    ensureRecent(context)
    val again = recent.matches(SmsCore.bodyHash(message.text), message.receivedAt)
    remember(context, message)
    if (NoticeFilter.skipWordFor(message.channel, message.from, message.text, store.filters()) != null) {
      if (!again) store.bump("filtered")
      return false
    }
    return store.enqueue(message, nowMs, countDuplicate = false) == "queued"
  }

  /** 새 문자 수신 (수신기) */
  fun onReceived(context: Context, row: SmsRow) {
    val app = context.applicationContext
    executor.execute {
      try {
        if (!active(app)) return@execute
        val now = System.currentTimeMillis()
        val message = SmsCore.toMessage(row) ?: return@execute
        if (offer(app, message, now)) {
          NoticeBus.changed(app)
          NoticeSender.kick(app)
        }
      } catch (_: Exception) {
        // 내용은 기록하지 않는다
      }
    }
  }

  /** 뒤에서 따라잡기 */
  fun scanLater(context: Context) {
    val app = context.applicationContext
    executor.execute {
      try {
        if (scanBlocking(app) > 0) {
          NoticeBus.changed(app)
          NoticeSender.kick(app)
        }
      } catch (_: Exception) {
        // 다음 차례에 다시
      }
    }
  }

  /** 저장소에서 마지막 자리 다음 문자를 읽어 넣는다. 넣은 건수 */
  fun scanBlocking(context: Context): Int {
    if (!active(context)) return 0
    synchronized(scanLock) {
      val now = System.currentTimeMillis()
      val start = cursor(context)
      val oldest = SmsCore.oldestAllowedMs(now)
      val rows = ArrayList<SmsRow>()
      rows.addAll(readSms(context, start.smsId, oldest))
      rows.addAll(readMms(context, start.mmsId, oldest))
      var queued = 0
      for (row in rows.sortedBy { it.dateMs }) {
        val message = SmsCore.toMessage(row) ?: continue
        if (offer(context, message, now)) queued++
      }
      var next = SmsCore.nextCursor(start, rows)
      // 처음이면(자리 0) 24시간보다 오래된 줄도 지나간 것으로 둔다 — 이번에 다 읽었을 때만(남았으면 다음 차례에 이어서)
      val smsRows = rows.count { it.kind == "sms" }
      val mmsRows = rows.count { it.kind == "mms" }
      if (start.smsId == 0L && smsRows < SmsCore.SCAN_LIMIT) next = next.copy(smsId = maxOf(next.smsId, maxId(context, Telephony.Sms.Inbox.CONTENT_URI)))
      if (start.mmsId == 0L && mmsRows < SmsCore.SCAN_LIMIT) next = next.copy(mmsId = maxOf(next.mmsId, maxId(context, Telephony.Mms.Inbox.CONTENT_URI)))
      saveCursor(context, next, now)
      return queued
    }
  }

  private fun maxId(context: Context, uri: Uri): Long = try {
    context.contentResolver.query(uri, arrayOf("_id"), null, null, "_id DESC")?.use { c -> if (c.moveToFirst()) c.getLong(0) else 0L } ?: 0L
  } catch (_: Exception) {
    0L
  }

  private fun Cursor.str(name: String): String? {
    val i = getColumnIndex(name)
    return if (i < 0 || isNull(i)) null else getString(i)
  }

  private fun Cursor.long(name: String): Long {
    val i = getColumnIndex(name)
    return if (i < 0 || isNull(i)) 0L else getLong(i)
  }

  /** 받은 문자(SMS·긴 문자 LMS — 저장소에는 이어 붙인 한 줄) */
  private fun readSms(context: Context, afterId: Long, oldestMs: Long): List<SmsRow> {
    val out = ArrayList<SmsRow>()
    try {
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf("_id", Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.DATE_SENT),
        "_id > ? AND ${Telephony.Sms.DATE} >= ?",
        arrayOf(afterId.toString(), oldestMs.toString()),
        "_id ASC",
      )?.use { c ->
        while (out.size < SmsCore.SCAN_LIMIT && c.moveToNext()) {
          out.add(SmsRow("sms", c.long("_id"), c.str(Telephony.Sms.ADDRESS), c.str(Telephony.Sms.BODY), c.long(Telephony.Sms.DATE), c.long(Telephony.Sms.DATE_SENT)))
        }
      }
    } catch (_: Exception) {
      // 권한이 막혔거나 저장소가 없는 기기
    }
    return out
  }

  /** 받은 멀티미디어 문자(MMS) — 글 조각(text/plain)만, 보낸 번호는 addr 표의 FROM(137) */
  private fun readMms(context: Context, afterId: Long, oldestMs: Long): List<SmsRow> {
    val out = ArrayList<SmsRow>()
    try {
      context.contentResolver.query(
        Telephony.Mms.Inbox.CONTENT_URI,
        arrayOf("_id", Telephony.Mms.DATE, Telephony.Mms.DATE_SENT),
        "_id > ? AND ${Telephony.Mms.DATE} >= ?",
        arrayOf(afterId.toString(), (oldestMs / 1000L).toString()),
        "_id ASC",
      )?.use { c ->
        while (out.size < SmsCore.SCAN_LIMIT && c.moveToNext()) {
          val id = c.long("_id")
          out.add(SmsRow("mms", id, mmsFrom(context, id), mmsText(context, id), SmsCore.mmsSecondsToMs(c.long(Telephony.Mms.DATE)), SmsCore.mmsSecondsToMs(c.long(Telephony.Mms.DATE_SENT))))
        }
      }
    } catch (_: Exception) {
      // 권한이 막혔거나 저장소가 없는 기기
    }
    return out
  }

  private fun mmsFrom(context: Context, id: Long): String? = try {
    context.contentResolver.query(Uri.parse("content://mms/$id/addr"), arrayOf(Telephony.Mms.Addr.ADDRESS, Telephony.Mms.Addr.TYPE), "${Telephony.Mms.Addr.TYPE} = 137", null, null)?.use { c ->
      if (c.moveToFirst()) c.str(Telephony.Mms.Addr.ADDRESS) else null
    }
  } catch (_: Exception) {
    null
  }

  private fun mmsText(context: Context, id: Long): String? {
    val parts = ArrayList<String>()
    try {
      context.contentResolver.query(Uri.parse("content://mms/part"), arrayOf("_id", Telephony.Mms.Part.CONTENT_TYPE, Telephony.Mms.Part.TEXT, Telephony.Mms.Part._DATA), "${Telephony.Mms.Part.MSG_ID} = ?", arrayOf(id.toString()), "_id ASC")?.use { c ->
        while (c.moveToNext()) {
          if (c.str(Telephony.Mms.Part.CONTENT_TYPE) != "text/plain") continue
          val inline = c.str(Telephony.Mms.Part.TEXT)
          val text = if (c.str(Telephony.Mms.Part._DATA) != null) readPart(context, c.long("_id")) ?: inline else inline
          if (!text.isNullOrEmpty()) parts.add(text)
        }
      }
    } catch (_: Exception) {
      return null
    }
    return if (parts.isEmpty()) null else parts.joinToString("\n")
  }

  private fun readPart(context: Context, partId: Long): String? = try {
    context.contentResolver.openInputStream(Uri.parse("content://mms/part/$partId"))?.use { input ->
      // 서버는 1,000자까지만 받는다 — 크게 읽지 않는다
      val bytes = input.readNBytesCompat(16 * 1024)
      String(bytes, Charsets.UTF_8)
    }
  } catch (_: Exception) {
    null
  }

  private fun java.io.InputStream.readNBytesCompat(max: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(4096)
    while (out.size() < max) {
      val n = read(buf, 0, minOf(buf.size, max - out.size()))
      if (n < 0) break
      out.write(buf, 0, n)
    }
    return out.toByteArray()
  }

  // ── 저장소 바뀜 지켜보기 (알림 읽기 서비스가 붙어 있는 동안) ──
  private var observer: ContentObserver? = null

  fun watch(context: Context) {
    if (observer != null || !active(context)) return
    val app = context.applicationContext
    val handler = Handler(Looper.getMainLooper())
    val pending = Runnable { scanLater(app) }
    val next = object : ContentObserver(handler) {
      override fun onChange(selfChange: Boolean) {
        // 여러 번 바뀌어도 2초에 한 번
        handler.removeCallbacks(pending)
        handler.postDelayed(pending, 2_000L)
      }
    }
    try {
      app.contentResolver.registerContentObserver(Uri.parse("content://mms-sms/"), true, next)
      observer = next
    } catch (_: Exception) {
      observer = null
    }
  }

  fun unwatch(context: Context) {
    val current = observer ?: return
    try {
      context.applicationContext.contentResolver.unregisterContentObserver(current)
    } catch (_: Exception) {
      // 이미 풀림
    }
    observer = null
  }
}

/** 새 문자 수신 (SMS_RECEIVED — 기본 문자 앱이 아니어도 받는 알림 방송). 긴 문자 조각은 한 방송에 함께 온다 */
class SmsReceivedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val parts = try {
      Telephony.Sms.Intents.getMessagesFromIntent(intent)?.filterNotNull() ?: emptyList()
    } catch (_: Exception) {
      emptyList()
    }
    if (parts.isEmpty()) return
    val first = parts[0]
    val row = SmsCore.joinParts(first.displayOriginatingAddress ?: first.originatingAddress, parts.map { it.displayMessageBody ?: it.messageBody }, System.currentTimeMillis(), first.timestampMillis)
    SmsLink.onReceived(context, row)
    // 기본 문자 앱이 저장소에 쓴 뒤 따라잡기(놓친 것·멀티미디어 문자)
    SmsLink.scanLater(context)
  }
}
