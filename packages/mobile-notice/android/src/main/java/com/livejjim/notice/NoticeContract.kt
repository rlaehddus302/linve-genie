// 서버 받는 입구 약속 — 안드로이드 쪽 한 곳 (SPEC ORD-13 C-04, SMS3). TS src/contract.ts·아이폰 ios/NoticeContract.swift와 같은 값이어야 한다(공용 사례가 잠근다).
// 요청 { device, messages: [{ id, channel, from, title, text, receivedAt }] } (0~20건), 응답 200 { results: [{ id, status }], filters: { skipWords, bankApps } }.
// 경로는 JS가 붙여 넘기므로(noticeIntakeUrl) 여기에는 없다. 순수 Kotlin + org.json(JVM 단위 시험) — 안드로이드 API를 쓰지 않는다.
package com.livejjim.notice

import org.json.JSONObject

/** 요청의 메시지 한 건 (C-04). from·title은 없으면 null, receivedAt은 밀리초 */
data class InboxMessage(
  val id: String,
  val channel: String,
  val from: String?,
  val title: String?,
  val text: String,
  val receivedAt: Long,
)

/** 200 응답에서 읽은 것 — results: id → SAVED·DUPLICATE·IGNORED, filters: 모양이 맞을 때만 */
data class InboxResponse(val results: Map<String, String>, val filters: NoticeFilters?)

object NoticeContract {
  /** 메시지 칸 — 이 순서로 JSON을 만든다 */
  val MESSAGE_FIELDS = listOf("id", "channel", "from", "title", "text", "receivedAt")
  val RESULT_STATUSES = listOf("SAVED", "DUPLICATE", "IGNORED")
  const val TEXT_MAX_CHARS = 1000
  const val FROM_MAX_CHARS = 200
  const val TITLE_MAX_CHARS = 200
  const val DEVICE_NAME_MAX_CHARS = 30
  const val BATCH_MAX = 20
  const val QUEUE_MAX = 200
  /** 429 뒤 기다림 */
  const val TOO_MANY_WAIT_MS = 60_000L
  /** WorkManager 지수 물러서기 시작값 */
  const val RETRY_INITIAL_DELAY_MS = 30_000L
  const val CONTENT_TYPE = "application/json"
  /** 받기 토큰 모양 (RFC 6750 b64token, 16~512자) */
  val TOKEN_PATTERN = Regex("^[A-Za-z0-9._~+/-]{16,512}=*$")
  private val LOOPBACK = listOf("http://localhost:", "http://localhost/", "http://127.0.0.1:", "http://127.0.0.1/", "http://10.0.2.2:", "http://10.0.2.2/")

  /** 기기 이름: 제어 문자 없이, 앞뒤 빈칸을 뺀 1~30자 (JS cleanDeviceName과 같다) */
  fun cleanDeviceName(value: String): String? {
    if (value.any { it.code < 0x20 || it.code == 0x7f }) return null
    val trimmed = NoticeExtractor.trimJs(value)
    if (trimmed.isEmpty() || trimmed.length > DEVICE_NAME_MAX_CHARS) return null
    return trimmed
  }

  /** 토큰이 실리므로 https만. 개발용 루프백만 http (JS noticeIntakeUrl이 먼저 거른다 — 여기는 한 번 더) */
  fun isAllowedEndpoint(endpoint: String): Boolean {
    if (endpoint.any { it.isWhitespace() || it.code < 0x20 }) return false
    if (endpoint.startsWith("https://") && endpoint.length > "https://".length) return !endpoint.substringAfter("https://").substringBefore('/').contains('@')
    return LOOPBACK.any { endpoint.startsWith(it) }
  }

  fun bearer(token: String): String = "Bearer $token"

  /** 서버 답 → 할 일: done · bad · token · wait · retry (src/contract.ts classifyIntakeResponse와 같다) */
  fun classify(status: Int?): String {
    if (status == null) return "retry"
    if (status in 200..299) return "done"
    if (status == 401 || status == 403) return "token"
    if (status == 429) return "wait"
    if (status == 408 || status == 425) return "retry"
    if (status in 400..499) return "bad"
    return "retry"
  }

  /** 메시지 한 건 JSON (칸 순서 = MESSAGE_FIELDS). 대기열에도 이 글을 암호화해 둔다 */
  fun messageJson(m: InboxMessage): String {
    val sb = StringBuilder(m.text.length + 160)
    sb.append("{\"id\":").append(quote(m.id))
    sb.append(",\"channel\":").append(quote(m.channel))
    sb.append(",\"from\":").append(m.from?.let { quote(it) } ?: "null")
    sb.append(",\"title\":").append(m.title?.let { quote(it) } ?: "null")
    sb.append(",\"text\":").append(quote(m.text))
    sb.append(",\"receivedAt\":").append(m.receivedAt)
    sb.append('}')
    return sb.toString()
  }

  /** 요청 본문 JSON */
  fun requestJson(device: String, messages: List<InboxMessage>): String =
    "{\"device\":${quote(device)},\"messages\":[${messages.joinToString(",") { messageJson(it) }}]}"

  /** 대기열 글 → 메시지. 틀리면 null */
  fun messageOf(json: String): InboxMessage? = try {
    val o = JSONObject(json)
    val channel = o.getString("channel")
    if (channel != "SMS" && channel != "APP") null
    else InboxMessage(
      o.getString("id"),
      channel,
      if (o.isNull("from")) null else o.getString("from"),
      if (o.isNull("title")) null else o.getString("title"),
      o.getString("text"),
      o.getLong("receivedAt"),
    )
  } catch (_: Exception) {
    null
  }

  /** 200 응답 본문 읽기. JSON이 아니면 빈 결과 */
  fun parseResponse(body: String): InboxResponse {
    val o = try {
      JSONObject(body)
    } catch (_: Exception) {
      return InboxResponse(emptyMap(), null)
    }
    val results = LinkedHashMap<String, String>()
    val array = o.optJSONArray("results")
    if (array != null) {
      for (i in 0 until array.length()) {
        val item = array.optJSONObject(i) ?: continue
        val id = item.opt("id") as? String ?: continue
        val status = item.opt("status") as? String ?: continue
        if (RESULT_STATUSES.contains(status)) results[id] = status
      }
    }
    return InboxResponse(results, NoticeFilter.parse(o.opt("filters")))
  }

  fun quote(value: String): String {
    val sb = StringBuilder(value.length + 2)
    sb.append('"')
    for (c in value) {
      when (c) {
        '"' -> sb.append("\\\"")
        '\\' -> sb.append("\\\\")
        '\n' -> sb.append("\\n")
        '\r' -> sb.append("\\r")
        '\t' -> sb.append("\\t")
        '\b' -> sb.append("\\b")
        '\u000C' -> sb.append("\\f")
        ' ' -> sb.append("\\u2028")
        ' ' -> sb.append("\\u2029")
        else -> if (c.code < 0x20) sb.append(String.format("\\u%04x", c.code)) else sb.append(c)
      }
    }
    sb.append('"')
    return sb.toString()
  }
}
