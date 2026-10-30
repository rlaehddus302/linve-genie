// 알림 → 보낼 메시지 · 읽을 앱 · 기기에서 먼저 거르기 (SPEC ORD-13 C-01·C-03·C-04, SMS3) — 안드로이드 API를 쓰지 않는 순수 Kotlin(JVM 단위 시험이 그대로 돈다).
// TS 본(src/extract.ts·src/packages.ts·src/rules.ts)과 같은 규칙이다. 공용 사례 test-vectors/notice-vectors.json을 세 쪽이 같이 읽는다.
// 1) 읽을 앱: 기본 문자 앱(모르면 흔한 문자 앱 둘) → SMS, 서버 filters.bankApps → APP, 그 밖·메신저 → 내용을 열지 않는다. 목록을 받기 전에는 문자만.
// 2) 묶음 요약·계속 떠 있는 알림은 버린다.
// 3) 메시지 스타일이면 메시지마다 시각·보낸 곳·본문. 내가 보낸 메시지는 뺀다.
// 4) 아니면 문자는 TITLE(보낸 곳) / BIG_TEXT(없으면 TEXT)로 한 건, 앱 알림은 title = TITLE, text = BIG_TEXT(없으면 TEXT).
// 5) 판매자가 켜기 1시간 전보다 오래된 메시지는 보내지 않는다(대화 기록이 통째로 가지 않게).
// 6) 문자는 skipWords(영문 대소문자 무시, 들어 있나)가 든 것을 보내지 않는다. 목록 전에는 R-26 3 사본.
package com.livejjim.notice

import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

data class RawMessage(
  val timestampMs: Long,
  val senderName: String?,
  val senderUri: String?,
  val text: String?,
  val fromUser: Boolean,
)

data class RawNotice(
  val packageName: String,
  val whenMs: Long,
  val postTimeMs: Long,
  val title: String?,
  val text: String?,
  val bigText: String?,
  /** 메시지 스타일이 아니면 null */
  val messages: List<RawMessage>?,
  val groupSummary: Boolean,
  val ongoing: Boolean,
)

data class ExtractResult(val candidates: List<InboxMessage>, val skipped: String?, val tooOld: Int)

/** 서버가 주는 거르기 목록 (C-04 응답 filters) */
data class NoticeFilters(val skipWords: List<String>, val bankApps: List<String>)

object NoticeExtractor {
  /** 기본 문자 앱을 모를 때 대신 보는 문자 앱 — 삼성 메시지·구글 메시지 (src/packages.ts SMS_PACKAGES와 같다) */
  val SMS_PACKAGES = listOf("com.samsung.android.messaging", "com.google.android.apps.messaging")
  /** 목록에 있어도 읽지 않는 메신저 (src/packages.ts BLOCKED_PACKAGES와 같다) */
  val BLOCKED_PACKAGES = listOf(
    "com.kakao.talk",
    "jp.naver.line.android",
    "org.telegram.messenger",
    "com.whatsapp",
    "com.facebook.orca",
    "com.instagram.android",
    "com.discord",
    "com.nhn.android.band",
  )
  const val HISTORY_GRACE_MS = 60L * 60L * 1000L
  const val IOS_SHORTCUT_SOURCE_APP = "ios.shortcut.messages"

  /** 문자로 볼 앱들: 기본 문자 앱이 있으면 그것 하나, 모르면 SMS_PACKAGES */
  fun smsPackagesFor(defaultSmsPackage: String?): List<String> =
    if (defaultSmsPackage.isNullOrEmpty()) SMS_PACKAGES else listOf(defaultSmsPackage)

  /** 패키지 이름만 보고 정한다: "SMS" · "APP" · null(열지 않음) */
  fun channelForPackage(packageName: String, defaultSmsPackage: String?, filters: NoticeFilters?): String? {
    if (BLOCKED_PACKAGES.contains(packageName)) return null
    if (smsPackagesFor(defaultSmsPackage).contains(packageName)) return "SMS"
    if (filters != null && filters.bankApps.contains(packageName)) return "APP"
    return null
  }

  /** JS의 \s와 같은 빈칸 */
  fun isJsSpace(c: Char): Boolean = c == '﻿' || Character.isSpaceChar(c) || (Character.isWhitespace(c) && c.code !in 0x1C..0x1F)

  /** JS trim과 같은 앞뒤 빈칸 빼기 */
  fun trimJs(value: String): String {
    var start = 0
    var end = value.length
    while (start < end && isJsSpace(value[start])) start++
    while (end > start && isJsSpace(value[end - 1])) end--
    return value.substring(start, end)
  }

  fun clean(value: String?): String = trimJs((value ?: "").replace("\r\n", "\n").replace('\r', '\n'))

  /** UTF-16 단위로 자른다. 짝 대리 문자 가운데서 잘리면 앞쪽 반을 뺀다 */
  fun cutUtf16(value: String, max: Int): String {
    if (value.length <= max) return value
    val head = value.substring(0, max)
    return if (head.isNotEmpty() && Character.isHighSurrogate(head[head.length - 1])) head.substring(0, head.length - 1) else head
  }

  /** 전화번호처럼 생긴 글 → 숫자만(앞 + 유지). 아니면 null */
  fun phoneDigits(value: String): String? {
    val trimmed = trimJs(value)
    if (trimmed.isEmpty() || !trimmed.all { it == '+' || it == ' ' || it == '(' || it == ')' || it == '-' || it == '.' || it in '0'..'9' }) return null
    if (trimmed.indexOf('+', 1) >= 0) return null
    val digits = trimmed.filter { it in '0'..'9' }
    if (digits.length < 3 || digits.length > 20) return null
    return if (trimmed.startsWith("+")) "+$digits" else digits
  }

  /** %XX 풀기 (UTF-8). '+'는 그대로 — JS decodeURIComponent와 같다. 틀리면 null */
  fun percentDecode(value: String): String? {
    val out = ByteArrayOutputStream()
    var i = 0
    while (i < value.length) {
      if (value[i] == '%') {
        if (i + 2 >= value.length) return null
        val hi = Character.digit(value[i + 1], 16)
        val lo = Character.digit(value[i + 2], 16)
        if (hi < 0 || lo < 0) return null
        out.write(hi * 16 + lo)
        i += 3
      } else {
        val cp = value.codePointAt(i)
        out.write(String(Character.toChars(cp)).toByteArray(Charsets.UTF_8))
        i += Character.charCount(cp)
      }
    }
    val decoder = Charsets.UTF_8.newDecoder()
    return try {
      decoder.decode(java.nio.ByteBuffer.wrap(out.toByteArray())).toString()
    } catch (_: java.nio.charset.CharacterCodingException) {
      null
    }
  }

  /** 보낸 곳: tel: 주소 → 번호, 번호 모양 이름 → 숫자, 아니면 이름 그대로. 없으면 null */
  fun senderOf(name: String?, uri: String?): String? {
    if (uri != null && uri.lowercase().startsWith("tel:")) {
      val raw = uri.substring(4)
      val decoded = percentDecode(raw) ?: raw
      phoneDigits(decoded)?.let { return it }
    }
    val n = clean(name)
    if (n.isEmpty()) return null
    return phoneDigits(n) ?: cutUtf16(n, NoticeContract.FROM_MAX_CHARS)
  }

  /** 메시지 id: SHA-256(패키지 ␟ 보낸 곳 ␟ 받은 시각 ␟ 제목 ␟ 본문) 앞 16바이트 16진. null 칸은 빈 글 */
  fun messageIdOf(packageName: String, from: String?, receivedAt: Long, title: String?, text: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest("$packageName\u001f${from ?: ""}\u001f$receivedAt\u001f${title ?: ""}\u001f$text".toByteArray(Charsets.UTF_8))
    val sb = StringBuilder(32)
    for (i in 0 until 16) sb.append(String.format("%02x", digest[i].toInt() and 0xff))
    return sb.toString()
  }

  private fun message(packageName: String, channel: String, from: String?, title: String?, text: String, receivedAt: Long): InboxMessage {
    val finalFrom = if (channel == "APP") packageName else from
    val finalTitle = if (channel == "APP" && !title.isNullOrEmpty()) cutUtf16(title, NoticeContract.TITLE_MAX_CHARS) else null
    val finalText = cutUtf16(text, NoticeContract.TEXT_MAX_CHARS)
    return InboxMessage(messageIdOf(packageName, finalFrom, receivedAt, finalTitle, finalText), channel, finalFrom, finalTitle, finalText, receivedAt)
  }

  /** 아이폰 단축어와 같은 모양 (시험용 — 안드로이드는 쓰지 않는다) */
  fun shortcutCandidate(sender: String, body: String, nowMs: Long): InboxMessage? {
    val text = cutUtf16(clean(body), NoticeContract.TEXT_MAX_CHARS)
    if (text.isEmpty()) return null
    val from = senderOf(sender, null)
    val bucket = Math.floorDiv(nowMs, 60_000L) * 60_000L
    return InboxMessage(messageIdOf(IOS_SHORTCUT_SOURCE_APP, from, bucket, null, text), "SMS", from, null, text, nowMs)
  }

  /** 날것 알림 → 보낼 메시지들. channel = channelForPackage로 정한 것, enabledAtMs = 판매자가 켠 시각 */
  fun extract(raw: RawNotice, channel: String, enabledAtMs: Long): ExtractResult {
    if (raw.groupSummary) return ExtractResult(emptyList(), "SUMMARY", 0)
    if (raw.ongoing) return ExtractResult(emptyList(), "ONGOING", 0)
    val oldest = enabledAtMs - HISTORY_GRACE_MS
    val out = ArrayList<InboxMessage>()
    var tooOld = 0

    val messages = raw.messages
    if (messages != null && messages.isNotEmpty()) {
      for (m in messages) {
        if (m.fromUser) continue
        val text = clean(m.text)
        if (text.isEmpty()) continue
        val at = if (m.timestampMs > 0) m.timestampMs else if (raw.whenMs > 0) raw.whenMs else raw.postTimeMs
        if (at < oldest) {
          tooOld++
          continue
        }
        if (channel == "SMS") out.add(message(raw.packageName, "SMS", senderOf(m.senderName ?: raw.title, m.senderUri), null, text, at))
        else out.add(message(raw.packageName, "APP", null, clean(raw.title), text, at))
      }
      return ExtractResult(out, if (out.isEmpty() && tooOld == 0) "EMPTY" else null, tooOld)
    }

    val title = clean(raw.title)
    val big = clean(raw.bigText)
    val body = if (big.isNotEmpty()) big else clean(raw.text)
    val at = if (raw.whenMs > 0) raw.whenMs else raw.postTimeMs
    if (body.isEmpty() && (channel == "SMS" || title.isEmpty())) return ExtractResult(emptyList(), "EMPTY", 0)
    if (at < oldest) return ExtractResult(emptyList(), null, 1)
    when {
      channel == "SMS" -> out.add(message(raw.packageName, "SMS", senderOf(title, null), null, body, at))
      // 제목만 있는 은행 알림 — 제목을 본문으로(같은 글을 두 칸에 싣지 않는다)
      body.isEmpty() -> out.add(message(raw.packageName, "APP", null, null, title, at))
      else -> out.add(message(raw.packageName, "APP", null, title, body, at))
    }
    return ExtractResult(out, null, 0)
  }
}

/** 기기에서 먼저 거르기 — 서버 filters (src/rules.ts와 같다) */
object NoticeFilter {
  /** 목록을 받기 전 쓰는 거를 낱말 — DOMAIN_RULES R-26 3과 같은 목록 */
  val DEFAULT_SKIP_WORDS = listOf("(광고)", "[광고]", "web발신", "국제발신", "해외발신", "인증", "승인", "결제", "택배")
  const val SKIP_WORDS_MAX = 200
  const val SKIP_WORD_MAX_CHARS = 100
  const val BANK_APPS_MAX = 100
  val PACKAGE_NAME = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")

  /** 영문 대문자(A-Z)만 소문자로 */
  fun lowerAscii(text: String): String {
    val sb = StringBuilder(text.length)
    for (c in text) sb.append(if (c in 'A'..'Z') (c.code + 32).toChar() else c)
    return sb.toString()
  }

  /** 문자 본문에 든 거를 낱말 (없으면 null). filters가 없으면 R-26 3 사본 */
  fun skipWordIn(text: String, filters: NoticeFilters?): String? {
    val haystack = lowerAscii(text)
    for (word in filters?.skipWords ?: DEFAULT_SKIP_WORDS) {
      val needle = lowerAscii(word)
      if (needle.isNotEmpty() && haystack.contains(needle)) return word
    }
    return null
  }

  /** 서버 filters(JSONObject) 검사 — 하나라도 틀리면 null(전에 저장한 목록을 그대로 쓴다) */
  fun parse(value: Any?): NoticeFilters? {
    val o = value as? JSONObject ?: return null
    val skip = o.opt("skipWords") as? JSONArray ?: return null
    val apps = o.opt("bankApps") as? JSONArray ?: return null
    if (skip.length() > SKIP_WORDS_MAX || apps.length() > BANK_APPS_MAX) return null
    val words = ArrayList<String>()
    for (i in 0 until skip.length()) {
      val word = skip.opt(i) as? String ?: return null
      if (word.isEmpty() || word.length > SKIP_WORD_MAX_CHARS) return null
      if (!words.contains(word)) words.add(word)
    }
    val bank = ArrayList<String>()
    for (i in 0 until apps.length()) {
      val app = apps.opt(i) as? String ?: return null
      if (app.length > 150 || !PACKAGE_NAME.matches(app)) return null
      if (!bank.contains(app)) bank.add(app)
    }
    return NoticeFilters(words, bank)
  }

  /** 저장 글 → filters (틀리면 null) */
  fun parseJson(json: String): NoticeFilters? = try {
    parse(JSONObject(json))
  } catch (_: Exception) {
    null
  }

  fun serialize(filters: NoticeFilters): String =
    "{\"skipWords\":[${filters.skipWords.joinToString(",") { NoticeContract.quote(it) }}],\"bankApps\":[${filters.bankApps.joinToString(",") { NoticeContract.quote(it) }}]}"
}
