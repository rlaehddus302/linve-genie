// 알림 → 봉투 후보 · 기기 안 거르기 (SMS3) — 안드로이드 API를 쓰지 않는 순수 Kotlin(JVM 단위 시험이 그대로 돈다).
// TS 본(src/extract.ts·src/rules.ts)과 같은 규칙이다. 공용 사례 test-vectors/notice-vectors.json을 세 쪽이 같이 읽는다.
// 1) 묶음 요약·계속 떠 있는 알림은 버린다.
// 2) 메시지 스타일이면 메시지마다 시각·보낸 사람·본문. 내가 보낸 메시지는 뺀다.
// 3) 아니면 TITLE(보낸 사람·은행 알림 제목) / BIG_TEXT(없으면 TEXT)로 한 건.
// 4) 판매자가 켜기 1시간 전보다 오래된 메시지는 보내지 않는다(대화 기록이 통째로 가지 않게).
package com.livejjim.notice

import java.io.ByteArrayOutputStream
import java.security.MessageDigest

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

data class NoticeCandidate(
  val kindHint: String,
  val sourceType: String,
  val source: String,
  val body: String,
  val receivedAtMs: Long,
  val localId: String,
)

data class ExtractResult(val candidates: List<NoticeCandidate>, val skipped: String?, val tooOld: Int)

object NoticeExtractor {
  /** 문자 앱 — 삼성 메시지·구글 메시지 (src/packages.ts SMS_PACKAGES와 같다) */
  val SMS_PACKAGES = listOf("com.samsung.android.messaging", "com.google.android.apps.messaging")
  /** 개인 대화가 섞이는 메신저 — 은행 앱으로 고를 수 없다 (src/packages.ts BLOCKED_PACKAGES와 같다) */
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
  val PACKAGE_NAME = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")
  const val BANK_PACKAGES_MAX = 20
  const val HISTORY_GRACE_MS = 60L * 60L * 1000L
  const val UNKNOWN_SENDER = "모름"
  const val IOS_SHORTCUT_SOURCE_APP = "ios.shortcut.messages"

  fun isSmsPackage(packageName: String): Boolean = SMS_PACKAGES.contains(packageName)

  fun clean(value: String?): String = (value ?: "").replace("\r\n", "\n").replace('\r', '\n').trim()

  /** UTF-16 단위로 자른다. 짝 대리 문자 가운데서 잘리면 앞쪽 반을 뺀다 */
  fun cutUtf16(value: String, max: Int): String {
    if (value.length <= max) return value
    val head = value.substring(0, max)
    return if (head.isNotEmpty() && Character.isHighSurrogate(head[head.length - 1])) head.substring(0, head.length - 1) else head
  }

  /** 전화번호처럼 생긴 글 → 숫자만(앞 + 유지). 아니면 null */
  fun phoneDigits(value: String): String? {
    val trimmed = value.trim()
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
    val bytes = out.toByteArray()
    val decoder = Charsets.UTF_8.newDecoder()
    return try {
      decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString()
    } catch (_: java.nio.charset.CharacterCodingException) {
      null
    }
  }

  /** 보낸 사람: tel: 주소 → 번호, 번호 모양 이름 → 숫자, 아니면 이름 그대로 */
  fun senderOf(name: String?, uri: String?): String {
    if (uri != null && uri.lowercase().startsWith("tel:")) {
      val raw = uri.substring(4)
      val decoded = percentDecode(raw) ?: raw
      phoneDigits(decoded)?.let { return it }
    }
    val n = clean(name)
    if (n.isEmpty()) return UNKNOWN_SENDER
    return phoneDigits(n) ?: cutUtf16(n, NoticeContract.SOURCE_MAX_CHARS)
  }

  /** 같은 알림 두 번 막기 열쇠: SHA-256(패키지 ␟ 보낸 곳 ␟ 받은 시각 ␟ 본문) 앞 16바이트 16진 */
  fun localIdOf(packageName: String, source: String, receivedAtMs: Long, body: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest("$packageName\u001f$source\u001f$receivedAtMs\u001f$body".toByteArray(Charsets.UTF_8))
    val sb = StringBuilder(32)
    for (i in 0 until 16) sb.append(String.format("%02x", digest[i].toInt() and 0xff))
    return sb.toString()
  }

  private fun candidate(packageName: String, kindHint: String, source: String, body: String, receivedAtMs: Long): NoticeCandidate {
    val sourceType = if (kindHint == "sms") "sms_number" else "app_package"
    val finalSource = if (kindHint == "sms") source else packageName
    val finalBody = cutUtf16(body, NoticeContract.BODY_MAX_CHARS)
    return NoticeCandidate(kindHint, sourceType, finalSource, finalBody, receivedAtMs, localIdOf(packageName, finalSource, receivedAtMs, finalBody))
  }

  /** 아이폰 단축어와 같은 모양 (시험용 — 안드로이드는 쓰지 않는다) */
  fun shortcutCandidate(sender: String, body: String, kind: String, nowMs: Long): NoticeCandidate? {
    val cleaned = cutUtf16(clean(body), NoticeContract.BODY_MAX_CHARS)
    if (cleaned.isEmpty()) return null
    val source = senderOf(sender, null)
    val bucket = Math.floorDiv(nowMs, 60_000L) * 60_000L
    return NoticeCandidate(kind, "sms_number", source, cleaned, nowMs, localIdOf(IOS_SHORTCUT_SOURCE_APP, source, bucket, cleaned))
  }

  /** 날것 알림 → 봉투 후보들. enabledAtMs = 판매자가 켠 시각 */
  fun extract(raw: RawNotice, enabledAtMs: Long): ExtractResult {
    if (raw.groupSummary) return ExtractResult(emptyList(), "SUMMARY", 0)
    if (raw.ongoing) return ExtractResult(emptyList(), "ONGOING", 0)
    val kindHint = if (isSmsPackage(raw.packageName)) "sms" else "bank"
    val oldest = enabledAtMs - HISTORY_GRACE_MS
    val out = ArrayList<NoticeCandidate>()
    var tooOld = 0

    val messages = raw.messages
    if (messages != null && messages.isNotEmpty()) {
      for (message in messages) {
        if (message.fromUser) continue
        val text = clean(message.text)
        if (text.isEmpty()) continue
        val at = if (message.timestampMs > 0) message.timestampMs else if (raw.whenMs > 0) raw.whenMs else raw.postTimeMs
        if (at < oldest) {
          tooOld++
          continue
        }
        val source = if (kindHint == "sms") senderOf(message.senderName ?: raw.title, message.senderUri) else raw.packageName
        out.add(candidate(raw.packageName, kindHint, source, text, at))
      }
      return ExtractResult(out, if (out.isEmpty() && tooOld == 0) "EMPTY" else null, tooOld)
    }

    val title = clean(raw.title)
    val big = clean(raw.bigText)
    val text = if (big.isNotEmpty()) big else clean(raw.text)
    val at = if (raw.whenMs > 0) raw.whenMs else raw.postTimeMs
    if (text.isEmpty() && (kindHint == "sms" || title.isEmpty())) return ExtractResult(emptyList(), "EMPTY", 0)
    if (at < oldest) return ExtractResult(emptyList(), null, 1)
    if (kindHint == "sms") {
      out.add(candidate(raw.packageName, "sms", senderOf(title, null), text, at))
    } else {
      // 은행 알림은 제목에 금액·이름이 있을 때가 많다 — 제목과 본문을 한 줄씩 (본문이 제목으로 시작하면 본문만)
      val body = when {
        title.isEmpty() -> text
        text.isEmpty() -> title
        text.startsWith(title) -> text
        else -> "$title\n$text"
      }
      out.add(candidate(raw.packageName, "bank", raw.packageName, body, at))
    }
    return ExtractResult(out, null, 0)
  }
}

data class FilterRule(val id: String, val field: String, val op: String, val value: String, val kinds: List<String>?)

/** 기기 안 거르기 — 인증번호·광고. 규칙 목록은 서버가 내려줄 자리(setFilterRules)만 있고, 없으면 기본 규칙 */
object NoticeFilter {
  val DEFAULT_RULES = listOf(
    FilterRule("otp-ko", "body", "contains", "인증번호", null),
    FilterRule("otp-ko-code", "body", "contains", "인증코드", null),
    FilterRule("otp-ko-confirm", "body", "contains", "확인코드", null),
    FilterRule("otp-ko-auth", "body", "contains", "본인확인", null),
    FilterRule("otp-en", "body", "contains", "verification code", null),
    FilterRule("ad-mark", "body", "contains", "(광고)", null),
    FilterRule("ad-optout", "body", "contains", "무료수신거부", null),
    FilterRule("ad-optout-short", "body", "contains", "무료거부", null),
  )
  const val RULES_MAX = 200
  const val VALUE_MAX = 100
  private val RULE_ID = Regex("^[A-Za-z0-9_-]{1,64}$")

  /** 비교용 글: 모든 빈칸을 빼고 영문자만 소문자로 (빈칸 = JS의 \s와 같은 문자들) */
  fun normalize(text: String): String {
    val sb = StringBuilder(text.length)
    var i = 0
    while (i < text.length) {
      val cp = text.codePointAt(i)
      i += Character.charCount(cp)
      val space = cp == 0xFEFF || Character.isSpaceChar(cp) || (Character.isWhitespace(cp) && cp !in 0x1C..0x1F)
      if (space) continue
      if (cp in 'A'.code..'Z'.code) sb.append((cp + 32).toChar()) else sb.appendCodePoint(cp)
    }
    return sb.toString()
  }

  fun match(rules: List<FilterRule>, kindHint: String, source: String, body: String): String? {
    val b = normalize(body)
    val s = normalize(source)
    for (rule in rules) {
      if (rule.kinds != null && !rule.kinds.contains(kindHint)) continue
      val needle = normalize(rule.value)
      if (needle.isEmpty()) continue
      val text = if (rule.field == "body") b else s
      val hit = if (rule.op == "contains") text.contains(needle) else text.startsWith(needle)
      if (hit) return rule.id
    }
    return null
  }

  /** 서버 규칙 JSON 배열 글 → 규칙. 하나라도 틀리면 null(기본 규칙을 쓴다) */
  fun parse(json: String): List<FilterRule>? {
    val array = try {
      org.json.JSONArray(json)
    } catch (_: Exception) {
      return null
    }
    if (array.length() > RULES_MAX) return null
    val out = ArrayList<FilterRule>()
    for (i in 0 until array.length()) {
      val item = array.optJSONObject(i) ?: return null
      val id = item.opt("id") as? String ?: return null
      val field = item.opt("field") as? String ?: return null
      val op = item.opt("op") as? String ?: return null
      val value = item.opt("value") as? String ?: return null
      if (!RULE_ID.matches(id)) return null
      if (field != "body" && field != "source") return null
      if (op != "contains" && op != "startsWith") return null
      if (normalize(value).isEmpty() || value.length > VALUE_MAX) return null
      var kinds: List<String>? = null
      if (item.has("kinds")) {
        val k = item.optJSONArray("kinds") ?: return null
        if (k.length() == 0) return null
        val list = ArrayList<String>()
        for (j in 0 until k.length()) {
          val kind = k.opt(j) as? String ?: return null
          if (kind != "sms" && kind != "bank") return null
          if (!list.contains(kind)) list.add(kind)
        }
        kinds = list
      }
      out.add(FilterRule(id, field, op, value, kinds))
    }
    return out
  }
}
