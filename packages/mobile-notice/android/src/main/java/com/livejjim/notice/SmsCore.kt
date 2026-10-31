// 문자 직접 받기의 순수 규칙 (SMS4, D-SMS4-01~) — 안드로이드 API를 쓰지 않는 순수 Kotlin(JVM 단위 시험이 그대로 돈다).
// 문자 저장소(Telephony.Sms·Mms) 한 줄·새 문자 수신(SMS_RECEIVED) 한 통 → 서버로 보낼 메시지(C-04, channel "SMS").
// - 메시지 id = 내용 열쇠: SHA-256("android.telephony" ␟ 보낸 번호(숫자만) ␟ 문자 센터 시각(분 단위) ␟ 정리한 본문) 앞 16바이트.
//   수신기와 저장소가 같은 문자를 따로 읽어도 같은 id → 기기 "본 id"가 한 번만 넣는다. 서버도 같은 id 24시간·같은 내용 60초로 한 번 더 막는다(D-SMS3-08).
// - 따라잡기: 마지막으로 읽은 줄 번호(_id) 다음부터. 처음 연동할 때·오래 꺼져 있었을 때 모두 최근 24시간만(과거 문자를 통째로 보내지 않는다).
// - 알림 길(기본 문자 앱 알림)과 겹치기: 저장소·수신기로 넣은 본문 지문을 잠깐 기억해, 같은 본문의 문자 알림은 보내지 않는다(RCS 알림만 남는다).
// 본문·번호는 로그에 남기지 않는다. 지문(해시)만 기기 안에 둔다.
package com.livejjim.notice

import java.security.MessageDigest

/** 저장소 한 줄 또는 수신 한 통 (kind: sms · mms). 시각은 밀리초 */
data class SmsRow(
  val kind: String,
  /** 저장소 줄 번호(_id). 수신기에서 온 것은 0 */
  val rowId: Long,
  val address: String?,
  val body: String?,
  /** 휴대폰이 받은 시각 */
  val dateMs: Long,
  /** 문자 센터 시각(보낸 시각). 모르면 0 */
  val dateSentMs: Long,
)

/** 마지막으로 읽은 저장소 줄 번호 (문자·멀티미디어 문자 따로). 처음이면 둘 다 0 */
data class SmsCursor(val smsId: Long, val mmsId: Long)

object SmsCore {
  const val SOURCE = "android.telephony"
  /** 처음 연동·오래 꺼졌던 뒤 따라잡는 범위 — 24시간 (서버는 24시간 넘은 문자를 서버 시각으로 바꿔 새 문자처럼 넣는다 D-SMS3-30 — 그래서 더 오래된 것은 보내지 않는다) */
  const val CATCH_UP_MS = 24L * 60L * 60L * 1000L
  /** 한 번에 읽는 줄 수 (남으면 다음 차례에 이어서) */
  const val SCAN_LIMIT = 200
  /** 알림 길과 겹치기 판단 범위 — 받은 시각 앞뒤 3분 */
  const val NOTICE_MATCH_MS = 3L * 60L * 1000L
  /** 기억하는 본문 지문 수 */
  const val RECENT_MAX = 300

  private fun hex16(input: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
    val sb = StringBuilder(32)
    for (i in 0 until 16) sb.append(String.format("%02x", digest[i].toInt() and 0xff))
    return sb.toString()
  }

  /** 보낸 곳 (C-04 from): 번호 모양이면 그 글(앞뒤 빈칸만 뺌), 아니면 이름 글. 200자까지 */
  fun senderOf(address: String?): String? = NoticeExtractor.senderOf(address, null)

  /** 열쇠용 보낸 곳: 번호면 숫자만(하이픈·빈칸 차이를 없애고 +82는 0으로), 아니면 영문 소문자로 */
  fun senderKey(from: String?): String {
    if (from == null) return ""
    val phone = NoticeExtractor.phoneLike(from) ?: return NoticeFilter.lowerAscii(NoticeExtractor.trimJs(from))
    val digits = phone.filter { it in '0'..'9' }
    return if (phone.startsWith("+82") && digits.length > 2) "0" + digits.substring(2).trimStart('0') else digits
  }

  /** 본문 정리: 줄바꿈 맞추기·앞뒤 빈칸 빼기·1,000자까지 (알림 길과 같은 정리) */
  fun normalizeText(body: String?): String = NoticeExtractor.cutUtf16(NoticeExtractor.clean(body), NoticeContract.TEXT_MAX_CHARS)

  /** 본문 지문 — 알림 길과 겹치기에만 쓴다 (빈칸 차이는 무시) */
  fun bodyHash(text: String): String = hex16("body\u001f" + text.filter { !NoticeExtractor.isJsSpace(it) })

  /** 메시지 id = 내용 열쇠 (보낸 번호·본문·문자 센터 시각 분 단위) */
  fun messageIdOf(from: String?, text: String, keyTimeMs: Long): String {
    val minute = Math.floorDiv(keyTimeMs, 60_000L)
    return hex16("$SOURCE\u001f${senderKey(from)}\u001f$minute\u001f$text")
  }

  /** 한 줄 → 보낼 메시지 (본문이 비면 null). 받은 시각은 휴대폰이 받은 시각, 열쇠 시각은 문자 센터 시각(없으면 받은 시각) */
  fun toMessage(row: SmsRow): InboxMessage? {
    val text = normalizeText(row.body)
    if (text.isEmpty()) return null
    val receivedAt = if (row.dateMs > 0) row.dateMs else row.dateSentMs
    if (receivedAt <= 0) return null
    val keyTime = if (row.dateSentMs > 0) row.dateSentMs else receivedAt
    val from = senderOf(row.address)
    return InboxMessage(messageIdOf(from, text, keyTime), "SMS", from, null, text, receivedAt)
  }

  /** 수신기가 받은 여러 조각(긴 문자) → 한 줄. 조각 순서대로 잇는다 */
  fun joinParts(address: String?, parts: List<String?>, nowMs: Long, sentMs: Long): SmsRow =
    SmsRow("sms", 0L, address, parts.joinToString("") { it ?: "" }, nowMs, sentMs)

  /** 이번에 읽을 가장 이른 받은 시각 — 언제나 지금부터 24시간 전까지만 */
  fun oldestAllowedMs(nowMs: Long): Long = nowMs - CATCH_UP_MS

  /** 읽은 줄들로 다음 자리 (줄 번호는 늘기만 한다) */
  fun nextCursor(cursor: SmsCursor, rows: List<SmsRow>): SmsCursor {
    var sms = cursor.smsId
    var mms = cursor.mmsId
    for (row in rows) {
      if (row.kind == "sms" && row.rowId > sms) sms = row.rowId
      if (row.kind == "mms" && row.rowId > mms) mms = row.rowId
    }
    return SmsCursor(sms, mms)
  }

  /** 멀티미디어 문자 시각은 초 단위로 저장된다 → 밀리초 */
  fun mmsSecondsToMs(seconds: Long): Long = if (seconds in 1 until 100_000_000_000L) seconds * 1000L else seconds
}

/** 저장소·수신기로 넣은 본문 지문 (알림 길과 겹치기 막기). 오래된 것부터 버린다 */
class RecentBodies(private val max: Int = SmsCore.RECENT_MAX) {
  private val entries = ArrayList<Pair<String, Long>>()

  @Synchronized
  fun add(hash: String, atMs: Long) {
    entries.add(hash to atMs)
    while (entries.size > max) entries.removeAt(0)
  }

  /** 같은 지문이 받은 시각 앞뒤 3분 안에 있나 */
  @Synchronized
  fun matches(hash: String, atMs: Long, windowMs: Long = SmsCore.NOTICE_MATCH_MS): Boolean =
    entries.any { it.first == hash && kotlin.math.abs(it.second - atMs) <= windowMs }

  @Synchronized
  fun serialize(): String = entries.joinToString("\n") { "${it.first} ${it.second}" }

  @Synchronized
  fun load(text: String) {
    entries.clear()
    for (line in text.split('\n')) {
      val parts = line.split(' ')
      if (parts.size != 2 || parts[0].length != 32) continue
      val at = parts[1].toLongOrNull() ?: continue
      entries.add(parts[0] to at)
    }
    while (entries.size > max) entries.removeAt(0)
  }
}
