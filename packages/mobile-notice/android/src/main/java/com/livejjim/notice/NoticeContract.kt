// 서버 입구 약속 (가정) — 안드로이드 쪽 한 곳 (SMS3). TS src/contract.ts·아이폰 ios/NoticeCore.swift와 같은 값이어야 한다(구조 시험이 잠근다).
// spec/sms-deposit-intake가 나오면 세 파일만 맞춘다. 경로는 JS가 붙여 넘기므로(noticeIntakeUrl) 여기에는 없다.
// 순수 Kotlin(JVM 단위 시험) — 안드로이드 API를 쓰지 않는다.
package com.livejjim.notice

object NoticeContract {
  /** 봉투 칸 — 이 순서로 JSON을 만든다 */
  val ENVELOPE_FIELDS = listOf("kindHint", "sourceType", "source", "body", "receivedAtMs", "sentAtMs", "deviceId", "localId")
  const val BODY_MAX_CHARS = 2000
  const val SOURCE_MAX_CHARS = 200
  /** WorkManager 지수 물러서기 시작값 */
  const val RETRY_INITIAL_DELAY_MS = 30_000L
  const val CONTENT_TYPE = "application/json"
  /** 기기 토큰 모양 (RFC 6750 b64token, 16~512자) */
  val TOKEN_PATTERN = Regex("^[A-Za-z0-9._~+/-]{16,512}=*$")
  val DEVICE_ID_PATTERN = Regex("^[A-Za-z0-9._:-]{1,128}$")
  private val LOOPBACK = listOf("http://localhost:", "http://localhost/", "http://127.0.0.1:", "http://127.0.0.1/", "http://10.0.2.2:", "http://10.0.2.2/")

  /** 토큰이 실리므로 https만. 개발용 루프백만 http (JS noticeIntakeUrl이 먼저 거른다 — 여기는 한 번 더) */
  fun isAllowedEndpoint(endpoint: String): Boolean {
    if (endpoint.any { it.isWhitespace() || it.code < 0x20 }) return false
    if (endpoint.startsWith("https://") && endpoint.length > "https://".length) return !endpoint.substringAfter("https://").substringBefore('/').contains('@')
    return LOOPBACK.any { endpoint.startsWith(it) }
  }

  fun bearer(token: String): String = "Bearer $token"

  /** 서버 답 → 할 일: accepted · duplicate · rejected · token · retry (src/contract.ts classifyIntakeResponse와 같다) */
  fun classify(status: Int?): String {
    if (status == null) return "retry"
    if (status in 200..299) return "accepted"
    if (status == 409) return "duplicate"
    if (status == 401 || status == 403) return "token"
    if (status == 408 || status == 425 || status == 429) return "retry"
    if (status in 400..499) return "rejected"
    return "retry"
  }

  /** 봉투 JSON (칸 순서 = ENVELOPE_FIELDS) */
  fun envelopeJson(candidate: NoticeCandidate, sentAtMs: Long, deviceId: String): String {
    val sb = StringBuilder(candidate.body.length + 256)
    sb.append('{')
    sb.append("\"kindHint\":").append(quote(candidate.kindHint)).append(',')
    sb.append("\"sourceType\":").append(quote(candidate.sourceType)).append(',')
    sb.append("\"source\":").append(quote(candidate.source)).append(',')
    sb.append("\"body\":").append(quote(candidate.body)).append(',')
    sb.append("\"receivedAtMs\":").append(candidate.receivedAtMs).append(',')
    sb.append("\"sentAtMs\":").append(sentAtMs).append(',')
    sb.append("\"deviceId\":").append(quote(deviceId)).append(',')
    sb.append("\"localId\":").append(quote(candidate.localId))
    sb.append('}')
    return sb.toString()
  }

  /** 대기열 한 건 (암호화 전 글) — 봉투에서 sentAtMs·deviceId를 뺀 것 */
  fun candidateJson(candidate: NoticeCandidate): String =
    "{\"kindHint\":${quote(candidate.kindHint)},\"sourceType\":${quote(candidate.sourceType)},\"source\":${quote(candidate.source)},\"body\":${quote(candidate.body)},\"receivedAtMs\":${candidate.receivedAtMs},\"localId\":${quote(candidate.localId)}}"

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
