// 알림 → 보낼 메시지 · 읽을 앱 · 기기에서 먼저 거르기 (SPEC ORD-13 C-01·C-03·C-04, SMS3) — 안드로이드 API를 쓰지 않는 순수 Kotlin(JVM 단위 시험이 그대로 돈다).
// TS 본(src/extract.ts·src/packages.ts·src/rules.ts)과 같은 규칙이다. 공용 사례 test-vectors/notice-vectors.json을 세 쪽이 같이 읽는다.
// 1) 읽을 앱: 기본 문자 앱(모르면 흔한 문자 앱 둘) → SMS, 서버 filters.bankApps → APP, 그 밖·메신저 → 내용을 열지 않는다. 목록을 받기 전에는 문자만.
// 2) 묶음 요약·계속 떠 있는 알림은 버린다.
// 3) 메시지 스타일이면 메시지마다 시각·보낸 곳·본문. 내가 보낸 메시지는 뺀다.
// 4) 아니면 문자는 TITLE(보낸 곳) / BIG_TEXT(없으면 TEXT)로 한 건, 앱 알림은 title = TITLE, text = BIG_TEXT(없으면 TEXT).
// 5) 판매자가 켜기 1시간 전보다 오래된 메시지는 보내지 않는다(대화 기록이 통째로 가지 않게).
// 6) 문자는 skipWords(영문 대소문자 무시, 들어 있나)가 든 것을 보내지 않는다 — 단 보낸 곳이 은행 대표번호(bankNumbers)면 거르지 않는다(D-SMS3-26).
//    목록 전에는 R-26 3 낱말·DP-9 1 대표번호 사본.
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

/** 서버가 주는 거르기 목록 (C-04 응답 filters). bankNumbers: 이 번호(숫자만)에서 온 문자는 skipWords로 거르지 않는다 */
data class NoticeFilters(val skipWords: List<String>, val bankApps: List<String>, val bankNumbers: List<String>)

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

  /**
   * 전화번호처럼 생긴 글인가 — 맞으면 앞뒤 빈칸만 뺀 글 그대로, 아니면 null.
   * 괄호·점·빈칸·하이픈·앞 +를 지우지 않는다: 서버가 보낸 곳 원문으로 은행 대표번호인지 본다(DP-9 1, D-DEP2-10).
   * 여기서는 tel: 주소가 번호인지 가리는 데만 쓴다.
   */
  fun phoneLike(value: String): String? {
    val trimmed = clean(value)
    if (trimmed.isEmpty() || !trimmed.all { it == '+' || it == ' ' || it == '(' || it == ')' || it == '-' || it == '.' || it in '0'..'9' }) return null
    if (trimmed.indexOf('+', 1) >= 0) return null
    val digits = trimmed.count { it in '0'..'9' }
    if (digits < 3 || digits > 20) return null
    return trimmed
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

  /** 보낸 곳(C-04 from): 글을 바꾸지 않는다(앞뒤 빈칸만 뺀다, 200자까지 — D-DEP2-10). tel: 주소가 번호면 %XX만 푼 그 글, 아니면 이름. 없으면 null */
  fun senderOf(name: String?, uri: String?): String? {
    if (uri != null && uri.lowercase().startsWith("tel:")) {
      val raw = uri.substring(4)
      val decoded = percentDecode(raw) ?: raw
      phoneLike(decoded)?.let { return cutUtf16(it, NoticeContract.FROM_MAX_CHARS) }
    }
    val n = clean(name)
    if (n.isEmpty()) return null
    return cutUtf16(n, NoticeContract.FROM_MAX_CHARS)
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
  /** 목록을 받기 전 쓰는 은행 대표번호 — DEPOSIT_RULES DP-9 1 표의 16개 (src/rules.ts DEFAULT_BANK_NUMBERS와 같다) */
  val DEFAULT_BANK_NUMBERS = listOf("15889999", "16449999", "15999999", "15778000", "15998000", "15885000", "15995000", "15881111", "15991111", "16613000", "15882100", "15662566", "15882588", "15993333", "16617654", "15221000")
  const val SKIP_WORDS_MAX = 200
  const val SKIP_WORD_MAX_CHARS = 100
  const val BANK_APPS_MAX = 100
  const val BANK_NUMBERS_MAX = 100
  private val BANK_NUMBER = Regex("^[0-9]{3,20}$")
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

  /** 보낸 곳이 은행 대표번호인가 (DP-9 1 문자 검사와 같다): 앞뒤 빈칸을 뺀 글이 ASCII 숫자·`-`·빈칸만이고 숫자만 남긴 글이 목록에 있음 */
  fun isBankNumber(from: String?, filters: NoticeFilters?): Boolean {
    if (from == null) return false
    val trimmed = NoticeExtractor.trimJs(from)
    if (trimmed.isEmpty() || !trimmed.all { it in '0'..'9' || it == '-' || it == ' ' }) return false
    val digits = trimmed.filter { it in '0'..'9' }
    return digits.isNotEmpty() && (filters?.bankNumbers ?: DEFAULT_BANK_NUMBERS).contains(digits)
  }

  /** 거를 낱말 (보내면 null) — 문자이고 보낸 곳이 은행 대표번호가 아닐 때만 skipWords를 본다. 앱 알림은 거르지 않는다 (src/rules.ts skipWordFor) */
  fun skipWordFor(channel: String, from: String?, text: String, filters: NoticeFilters?): String? {
    if (channel != "SMS") return null
    if (isBankNumber(from, filters)) return null
    return skipWordIn(text, filters)
  }

  /** 서버 filters(JSONObject) 검사 — 하나라도 틀리면 null(전에 저장한 목록을 그대로 쓴다). bankNumbers 칸이 없으면(옛 서버) 기기 사본 */
  fun parse(value: Any?): NoticeFilters? {
    val o = value as? JSONObject ?: return null
    val skip = o.opt("skipWords") as? JSONArray ?: return null
    val apps = o.opt("bankApps") as? JSONArray ?: return null
    if (skip.length() > SKIP_WORDS_MAX || apps.length() > BANK_APPS_MAX) return null
    val numbersRaw: List<Any?> = if (!o.has("bankNumbers")) DEFAULT_BANK_NUMBERS else {
      val array = o.opt("bankNumbers") as? JSONArray ?: return null
      if (array.length() > BANK_NUMBERS_MAX) return null
      (0 until array.length()).map { array.opt(it) }
    }
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
    val numbers = ArrayList<String>()
    for (item in numbersRaw) {
      val number = item as? String ?: return null
      if (!BANK_NUMBER.matches(number)) return null
      if (!numbers.contains(number)) numbers.add(number)
    }
    return NoticeFilters(words, bank, numbers)
  }

  /** 저장 글 → filters (틀리면 null) */
  fun parseJson(json: String): NoticeFilters? = try {
    parse(JSONObject(json))
  } catch (_: Exception) {
    null
  }

  fun serialize(filters: NoticeFilters): String =
    "{\"skipWords\":[${filters.skipWords.joinToString(",") { NoticeContract.quote(it) }}],\"bankApps\":[${filters.bankApps.joinToString(",") { NoticeContract.quote(it) }}],\"bankNumbers\":[${filters.bankNumbers.joinToString(",") { NoticeContract.quote(it) }}]}"
}

internal data class DrainResult(val sent: Int, val pending: Int, val stoppedBy: String?)

internal data class PostResult(val status: Int?, val body: String)

/** 대기열 한 건 — handle은 저장한 곳(안드로이드는 파일) */
internal class QueuedMessage(val handle: Any, val message: InboxMessage)

/** 보내기 고리가 대기열·저장값을 만지는 길 (안드로이드는 NoticeStore, 시험은 메모리) */
internal interface DrainPort {
  /** 받은 차례대로 앞에서 limit건. 풀지 못한 것만 있어 더 갈 수 없으면 null(끝없이 돌지 않게 멈춘다) */
  fun head(limit: Int): List<QueuedMessage>?
  fun remove(item: QueuedMessage)
  fun pendingCount(): Int
  fun filters(): NoticeFilters?
  fun setFilters(filters: NoticeFilters)
  fun bump(counter: String)
  fun markSent(nowMs: Long)
  fun setLastError(value: String?)
  fun setTokenRejected()
  fun setNotBeforeMs(value: Long)
  /** 403 받기 꺼짐 상태인가 — 참이면 대기열을 싣기 전에 0건 요청으로 먼저 본다 */
  fun inboxOff(): Boolean
  /** off면 checkAtMs부터 다시 본다. 풀리면 (false, 0) */
  fun setInboxOff(off: Boolean, checkAtMs: Long)
}

/**
 * 보내기 고리 (C-04, AC-SMS3-27, D-SMS3-21) — 안드로이드 API 없이 돈다(JVM 시험). TS fake.ts drainOnce·Swift NoticeSender.drain과 같은 처리:
 * - 2xx: 묶음을 지우고 결과(SAVED·DUPLICATE·IGNORED)를 세고 응답 filters를 저장
 * - 400·413 등 그 밖의 4xx: 여러 건이면 한 건씩 다시 보내 받지 않는 그 한 건만 버리고 "서버가 받지 않음"(rejected)으로 센다
 * - 401: 받기 토큰이 끊겼다 — 대기열은 버리지 않고 새 토큰까지 멈춘다
 * - 403: 웹에서 받기를 껐다(D-SMS3-27) — 대기열·토큰을 지키고 10분 뒤(앱을 열면 바로) 0건 요청으로 먼저 다시 본다. 200이면 모아 둔 것을 보낸다
 * - 429: 1분 동안 보내지 않는다 · 연결 실패·5xx(500 잠깐의 오류 포함, D-SMS3-31): 멈추고 나중에 같은 id로 다시
 * - 대기열이 비었고 filters가 없으면(또는 fetchFilters) 0건 요청으로 filters만 받는다
 */
internal object NoticeDrain {
  /**
   * 보내기 전에 멈출 까닭: 토큰 없음(NO_TOKEN) · 토큰이 끊김(TOKEN — 401 뒤 새 토큰 전까지) · 429 뒤 1분 전(BUSY) ·
   * 받기 꺼짐 뒤 10분 전(OFF — 앱을 열 때 force면 기다리지 않는다). 없으면 null
   */
  fun blockedBy(hasToken: Boolean, tokenRejected: Boolean, notBeforeMs: Long, nowMs: Long, inboxOff: Boolean = false, offCheckAtMs: Long = 0L, force: Boolean = false): String? = when {
    !hasToken -> "NO_TOKEN"
    tokenRejected -> "TOKEN"
    nowMs < notBeforeMs -> "BUSY"
    inboxOff && !force && nowMs < offCheckAtMs -> "OFF"
    else -> null
  }

  fun run(
    port: DrainPort,
    deviceName: String,
    fetchFilters: Boolean,
    nowMs: () -> Long,
    isStopped: () -> Boolean,
    onStep: () -> Unit,
    post: (String) -> PostResult,
  ): DrainResult {
    var sent = 0
    var single = false
    var askedFilters = false
    // 받기 꺼짐 뒤에는 대기열을 싣지 않고 0건 요청으로 먼저 본다(D-SMS3-27)
    var probe = port.inboxOff()
    while (true) {
      if (isStopped()) return DrainResult(sent, port.pendingCount(), "NETWORK")
      val batch = if (probe) emptyList() else port.head(if (single) 1 else NoticeContract.BATCH_MAX) ?: break
      if (batch.isEmpty() && !probe) {
        if (askedFilters || !(fetchFilters || port.filters() == null)) break
        askedFilters = true
      }
      val reply = post(NoticeContract.requestJson(deviceName, batch.map { it.message }))
      val action = NoticeContract.classify(reply.status)
      if (probe && (action == "done" || action == "bad")) {
        // 꺼짐이 풀렸다(서버가 403이 아닌 답을 했다) — 이제 대기열을 보낸다
        probe = false
        askedFilters = true
        port.setInboxOff(false, 0L)
      }
      when (action) {
        "done" -> {
          val response = NoticeContract.parseResponse(reply.body)
          response.filters?.let { port.setFilters(it) }
          for (item in batch) {
            port.remove(item)
            when (response.results[item.message.id]) {
              "DUPLICATE" -> port.bump("duplicates")
              "IGNORED" -> port.bump("ignored")
              else -> {
                port.bump("sent")
                sent++
              }
            }
          }
          if (batch.isNotEmpty()) port.markSent(nowMs()) else port.setLastError(null)
        }
        "bad" -> {
          if (batch.size > 1) {
            single = true
          } else if (batch.size == 1) {
            port.remove(batch[0])
            port.bump("rejected")
          }
        }
        "token" -> {
          port.setTokenRejected()
          return DrainResult(sent, port.pendingCount(), "TOKEN")
        }
        "off" -> {
          port.setInboxOff(true, nowMs() + NoticeContract.INBOX_OFF_RECHECK_MS)
          port.setLastError("OFF")
          return DrainResult(sent, port.pendingCount(), "OFF")
        }
        "wait" -> {
          port.setNotBeforeMs(nowMs() + NoticeContract.TOO_MANY_WAIT_MS)
          port.setLastError("BUSY")
          return DrainResult(sent, port.pendingCount(), "BUSY")
        }
        else -> {
          val why = if (reply.status == null) "NETWORK" else "SERVER"
          port.setLastError(why)
          return DrainResult(sent, port.pendingCount(), why)
        }
      }
      onStep()
    }
    port.setLastError(null)
    return DrainResult(sent, port.pendingCount(), null)
  }
}
