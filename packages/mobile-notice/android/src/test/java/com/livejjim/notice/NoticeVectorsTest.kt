// 공용 사례(test-vectors/notice-vectors.json)를 Kotlin 본이 그대로 내는지 — TS(test/vectors.test.ts)·Swift(ios/Tests)와 같은 파일을 읽는다.
// 안드로이드 API 없이 JVM에서 돈다: ./gradlew :packages:mobile-notice:android:testDebugUnitTest (SDK가 있는 곳)
package com.livejjim.notice

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NoticeVectorsTest {
  private val vectors: JSONObject = JSONObject(File(System.getProperty("notice.vectors")!!).readText(Charsets.UTF_8))

  private fun items(key: String): List<JSONObject> {
    val array: JSONArray = vectors.getJSONArray(key)
    return (0 until array.length()).map { array.getJSONObject(it) }
  }

  private fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else getString(key)

  @Test
  fun localId() {
    for (v in items("localId")) {
      assertEquals(v.getString("localId"), NoticeExtractor.localIdOf(v.getString("packageName"), v.getString("source"), v.getLong("receivedAtMs"), v.getString("body")))
    }
  }

  @Test
  fun phone() {
    for (v in items("phone")) assertEquals(v.getString("input"), v.stringOrNull("output"), NoticeExtractor.phoneDigits(v.getString("input")))
  }

  @Test
  fun sender() {
    for (v in items("sender")) assertEquals(v.toString(), v.getString("output"), NoticeExtractor.senderOf(v.stringOrNull("name"), v.stringOrNull("uri")))
  }

  @Test
  fun normalize() {
    for (v in items("normalize")) assertEquals(v.getString("input"), v.getString("output"), NoticeFilter.normalize(v.getString("input")))
  }

  @Test
  fun cut() {
    for (v in items("cut")) assertEquals(v.toString(), v.getString("output"), NoticeExtractor.cutUtf16(v.getString("input"), v.getInt("max")))
  }

  @Test
  fun filter() {
    for (v in items("filter")) {
      val rules = if (v.isNull("rules")) NoticeFilter.DEFAULT_RULES else NoticeFilter.parse(v.getJSONArray("rules").toString())
      assertNotNull(v.toString(), rules)
      assertEquals(v.toString(), v.stringOrNull("rule"), NoticeFilter.match(rules!!, v.getString("kindHint"), v.getString("source"), v.getString("body")))
    }
  }

  @Test
  fun classify() {
    for (v in items("classify")) assertEquals(v.toString(), v.getString("action"), NoticeContract.classify(if (v.isNull("status")) null else v.getInt("status")))
  }

  @Test
  fun extract() {
    for (v in items("extract")) {
      val raw = v.getJSONObject("raw")
      val messages = if (raw.isNull("messages")) null else raw.getJSONArray("messages").let { array ->
        (0 until array.length()).map {
          val m = array.getJSONObject(it)
          RawMessage(m.getLong("timestampMs"), m.stringOrNull("senderName"), m.stringOrNull("senderUri"), m.stringOrNull("text"), m.getBoolean("fromUser"))
        }
      }
      val notice = RawNotice(
        raw.getString("packageName"), raw.getLong("whenMs"), raw.getLong("postTimeMs"),
        raw.stringOrNull("title"), raw.stringOrNull("text"), raw.stringOrNull("bigText"),
        messages, raw.getBoolean("groupSummary"), raw.getBoolean("ongoing"),
      )
      val result = NoticeExtractor.extract(notice, v.getLong("enabledAtMs"))
      val name = v.getString("name")
      assertEquals(name, v.stringOrNull("skipped"), result.skipped)
      assertEquals(name, v.getInt("tooOld"), result.tooOld)
      val want = v.getJSONArray("candidates")
      assertEquals(name, want.length(), result.candidates.size)
      for (i in 0 until want.length()) assertEquals(name, candidateOf(want.getJSONObject(i)), result.candidates[i])
    }
  }

  @Test
  fun shortcut() {
    for (v in items("shortcut")) {
      val input = v.getJSONObject("input")
      val got = NoticeExtractor.shortcutCandidate(input.getString("sender"), input.getString("body"), input.getString("kind"), v.getLong("nowMs"))
      assertEquals(v.toString(), if (v.isNull("candidate")) null else candidateOf(v.getJSONObject("candidate")), got)
    }
  }

  @Test
  fun envelope() {
    val v = vectors.getJSONObject("envelope")
    val json = NoticeContract.envelopeJson(candidateOf(v.getJSONObject("candidate")), v.getLong("sentAtMs"), v.getString("deviceId"))
    // 칸 순서와 이스케이프까지 TS 사례와 같다
    val want = v.getJSONObject("json")
    val got = JSONObject(json)
    // org.json은 칸 순서를 보존하지 않으므로 글에서 칸 이름이 나온 자리로 순서를 본다
    val positions = NoticeContract.ENVELOPE_FIELDS.map { json.indexOf("\"$it\":") }
    assertTrue(positions.all { it >= 0 })
    assertEquals(positions.sorted(), positions)
    for (field in NoticeContract.ENVELOPE_FIELDS) assertEquals(field, want.get(field), got.get(field))
    assertTrue(json.contains("\\\"35,000원\\\""))
  }

  @Test
  fun endpoint() {
    assertTrue(NoticeContract.isAllowedEndpoint("https://livejjim.example/api/inbox/messages"))
    assertTrue(NoticeContract.isAllowedEndpoint("http://10.0.2.2:3000/api/inbox/messages"))
    assertTrue(!NoticeContract.isAllowedEndpoint("http://livejjim.example/api/inbox/messages"))
    assertTrue(!NoticeContract.isAllowedEndpoint("https://user:pw@livejjim.example/api/inbox/messages"))
    assertTrue(!NoticeContract.isAllowedEndpoint("https://livejjim.example/a b"))
    assertNull(null as String?)
  }

  private fun candidateOf(o: JSONObject) = NoticeCandidate(
    o.getString("kindHint"), o.getString("sourceType"), o.getString("source"), o.getString("body"), o.getLong("receivedAtMs"), o.getString("localId"),
  )
}
