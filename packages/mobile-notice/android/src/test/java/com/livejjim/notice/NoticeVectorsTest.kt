// 공용 사례(test-vectors/notice-vectors.json)를 Kotlin 본이 그대로 내는지 — TS(test/vectors.test.ts)·Swift(ios/Tests)와 같은 파일을 읽는다.
// 안드로이드 API 없이 JVM에서 돈다(NoticeContract.kt·NoticeCore.kt + org.json + junit): 앱 빌드에서는 testDebugUnitTest, 앱 없이는 두 파일만 kotlin("jvm") 틀로.
package com.livejjim.notice

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NoticeVectorsTest {
  private val vectors: JSONObject = JSONObject(File(System.getProperty("notice.vectors")!!).readText(Charsets.UTF_8))

  private fun items(key: String): List<JSONObject> {
    val array: JSONArray = vectors.getJSONArray(key)
    return (0 until array.length()).map { array.getJSONObject(it) }
  }

  private fun JSONObject.stringOrNull(key: String): String? = if (isNull(key)) null else getString(key)

  private fun filtersOf(o: JSONObject, key: String): NoticeFilters? = if (o.isNull(key)) null else NoticeFilter.parse(o.getJSONObject(key))

  @Test
  fun messageId() {
    for (v in items("messageId")) {
      assertEquals(v.toString(), v.getString("id"), NoticeExtractor.messageIdOf(v.getString("packageName"), v.stringOrNull("from"), v.getLong("receivedAt"), v.stringOrNull("title"), v.getString("text")))
    }
  }

  @Test
  fun phone() {
    for (v in items("phoneLike")) assertEquals(v.getString("input"), v.stringOrNull("output"), NoticeExtractor.phoneLike(v.getString("input")))
  }

  @Test
  fun sender() {
    for (v in items("sender")) assertEquals(v.toString(), v.stringOrNull("output"), NoticeExtractor.senderOf(v.stringOrNull("name"), v.stringOrNull("uri")))
  }

  @Test
  fun cut() {
    for (v in items("cut")) assertEquals(v.toString(), v.getString("output"), NoticeExtractor.cutUtf16(v.getString("input"), v.getInt("max")))
  }

  @Test
  fun lowerAscii() {
    for (v in items("lowerAscii")) assertEquals(v.toString(), v.getString("output"), NoticeFilter.lowerAscii(v.getString("input")))
  }

  @Test
  fun skip() {
    for (v in items("skip")) assertEquals(v.toString(), v.stringOrNull("word"), NoticeFilter.skipWordIn(v.getString("text"), filtersOf(v, "filters")))
  }

  @Test
  fun filters() {
    for (v in items("filters")) {
      val want = if (v.isNull("output")) null else v.getJSONObject("output").let { o ->
        NoticeFilters(o.getJSONArray("skipWords").let { a -> (0 until a.length()).map { a.getString(it) } }, o.getJSONArray("bankApps").let { a -> (0 until a.length()).map { a.getString(it) } })
      }
      assertEquals(v.toString(), want, NoticeFilter.parse(v.opt("input")))
      if (want != null) assertEquals(want, NoticeFilter.parseJson(NoticeFilter.serialize(want)))
    }
  }

  @Test
  fun channel() {
    for (v in items("channel")) {
      assertEquals(v.toString(), v.stringOrNull("channel"), NoticeExtractor.channelForPackage(v.getString("packageName"), v.stringOrNull("smsApp"), filtersOf(v, "filters")))
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
      val result = NoticeExtractor.extract(notice, v.getString("channel"), v.getLong("enabledAtMs"))
      val name = v.getString("name")
      assertEquals(name, v.stringOrNull("skipped"), result.skipped)
      assertEquals(name, v.getInt("tooOld"), result.tooOld)
      val want = v.getJSONArray("candidates")
      assertEquals(name, want.length(), result.candidates.size)
      for (i in 0 until want.length()) assertEquals(name, messageOf(want.getJSONObject(i)), result.candidates[i])
    }
  }

  @Test
  fun shortcut() {
    for (v in items("shortcut")) {
      val input = v.getJSONObject("input")
      val got = NoticeExtractor.shortcutCandidate(input.getString("sender"), input.getString("body"), v.getLong("nowMs"))
      assertEquals(v.toString(), if (v.isNull("candidate")) null else messageOf(v.getJSONObject("candidate")), got)
    }
  }

  @Test
  fun request() {
    val v = vectors.getJSONObject("request")
    val want = v.getJSONArray("messages")
    val messages = (0 until want.length()).map { messageOf(want.getJSONObject(it)) }
    val json = NoticeContract.requestJson(v.getString("device"), messages)
    val got = JSONObject(json)
    assertEquals(v.getString("device"), got.getString("device"))
    val gotMessages = got.getJSONArray("messages")
    assertEquals(want.length(), gotMessages.length())
    for (i in 0 until want.length()) {
      // 칸 순서: 글에서 칸 이름이 나온 자리
      val one = NoticeContract.messageJson(messages[i])
      val positions = NoticeContract.MESSAGE_FIELDS.map { one.indexOf("\"$it\":") }
      assertTrue(positions.all { it >= 0 })
      assertEquals(positions.sorted(), positions)
      assertEquals(messages[i], messageOf(gotMessages.getJSONObject(i)))
      // 대기열 글을 다시 읽으면 같다
      assertEquals(messages[i], NoticeContract.messageOf(one))
    }
    assertTrue(json.contains("\\\"35,000원\\\""))
    assertTrue(json.contains("\\u2028"))
  }

  @Test
  fun response() {
    for (v in items("response")) {
      val got = NoticeContract.parseResponse(v.getString("body"))
      val results = v.getJSONObject("results")
      assertEquals(v.toString(), results.keySet().associateWith { results.getString(it) }, got.results)
      assertEquals(v.toString(), filtersOf(v, "filters"), got.filters)
    }
  }

  @Test
  fun deviceNameAndEndpoint() {
    assertEquals("내 갤럭시 S23", NoticeContract.cleanDeviceName("  내 갤럭시 S23 "))
    assertEquals(null, NoticeContract.cleanDeviceName("가".repeat(31)))
    assertEquals(null, NoticeContract.cleanDeviceName("폰\n1"))
    assertEquals(null, NoticeContract.cleanDeviceName("   "))
    assertTrue(NoticeContract.isAllowedEndpoint("https://livejjim.example/api/inbox/messages"))
    assertTrue(NoticeContract.isAllowedEndpoint("http://10.0.2.2:3000/api/inbox/messages"))
    assertTrue(!NoticeContract.isAllowedEndpoint("http://livejjim.example/api/inbox/messages"))
    assertTrue(!NoticeContract.isAllowedEndpoint("https://user:pw@livejjim.example/api/inbox/messages"))
    assertTrue(!NoticeContract.isAllowedEndpoint("https://livejjim.example/a b"))
  }

  private fun messageOf(o: JSONObject) = InboxMessage(
    o.getString("id"), o.getString("channel"), o.stringOrNull("from"), o.stringOrNull("title"), o.getString("text"), o.getLong("receivedAt"),
  )
}
