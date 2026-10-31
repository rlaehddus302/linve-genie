// 보내기 고리(NoticeDrain) — 공용 사례 drain(D-SMS3-21 (a)(b))을 메모리 대기열로. TS(test/vectors.test.ts 가짜 구현)·Swift(NoticeSender)와 같은 사례다.
package com.livejjim.notice

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private class MemoryPort : DrainPort {
  val queue = ArrayList<QueuedMessage>()
  var savedFilters: NoticeFilters? = null
  val counts = HashMap<String, Int>()
  var error: String? = null
  var tokenRejected = false
  var waitUntilMs = 0L
  var off = false
  var offCheckAtMs = 0L

  override fun head(limit: Int): List<QueuedMessage> = queue.take(limit)
  override fun remove(item: QueuedMessage) {
    queue.remove(item)
  }
  override fun pendingCount(): Int = queue.size
  override fun filters(): NoticeFilters? = savedFilters
  override fun setFilters(filters: NoticeFilters) {
    savedFilters = filters
  }
  override fun bump(counter: String) {
    counts[counter] = (counts[counter] ?: 0) + 1
  }
  override fun markSent(nowMs: Long) {
    error = null
  }
  override fun setLastError(value: String?) {
    error = value
  }
  override fun setTokenRejected() {
    tokenRejected = true
    error = "TOKEN"
  }
  override fun setNotBeforeMs(value: Long) {
    waitUntilMs = value
  }
  override fun inboxOff(): Boolean = off
  override fun setInboxOff(off: Boolean, checkAtMs: Long) {
    this.off = off
    offCheckAtMs = checkAtMs
  }
}

class NoticeDrainTest {
  private val vectors: JSONObject = JSONObject(File(System.getProperty("notice.vectors")!!).readText(Charsets.UTF_8))

  private fun strings(a: JSONArray): List<String> = (0 until a.length()).map { a.getString(it) }

  @Test
  fun drainVectors() {
    val serverFilters = vectors.getJSONObject("drainFilters").toString()
    val cases = vectors.getJSONArray("drain")
    for (c in 0 until cases.length()) {
      val v = cases.getJSONObject(c)
      val name = v.getString("name")
      val port = MemoryPort()
      if (v.optBoolean("startOff", false)) port.setInboxOff(true, 1_761_800_600_000L)
      for ((i, text) in strings(v.getJSONArray("queue")).withIndex()) {
        val m = NoticeExtractor.shortcutCandidate("010-1234-5678", text, 1_761_800_000_000L + i * 120_000L)!!
        port.queue.add(QueuedMessage(i, m))
      }
      val replies = v.getJSONArray("replies")
      val requests = ArrayList<Int>()
      val result = NoticeDrain.run(port, "내 갤럭시", true, { 1_761_800_600_000L }, { false }, {}) { json ->
        val messages = JSONObject(json).getJSONArray("messages")
        val texts = (0 until messages.length()).map { messages.getJSONObject(it).getString("text") }
        requests.add(texts.size)
        var status: Int? = null
        for (r in 0 until replies.length()) {
          val rule = replies.getJSONObject(r)
          if (!rule.has("ifText") || texts.contains(rule.getString("ifText"))) {
            status = rule.getInt("status")
            break
          }
        }
        if (status != 200) {
          PostResult(status, "")
        } else {
          val results = JSONArray()
          for (i in 0 until messages.length()) results.put(JSONObject().put("id", messages.getJSONObject(i).getString("id")).put("status", "SAVED"))
          PostResult(200, "{\"results\":$results,\"filters\":$serverFilters}")
        }
      }
      assertEquals(name, v.getJSONArray("requests").let { a -> (0 until a.length()).map { a.getInt(it) } }, requests)
      assertEquals(name, v.getInt("sent"), result.sent)
      assertEquals(name, v.getInt("sent"), port.counts["sent"] ?: 0)
      assertEquals(name, v.getInt("rejected"), port.counts["rejected"] ?: 0)
      assertEquals(name, v.getInt("pending"), result.pending)
      assertEquals(name, v.getInt("pending"), port.queue.size)
      assertEquals(name, if (v.isNull("stoppedBy")) null else v.getString("stoppedBy"), result.stoppedBy)
      assertEquals(name, v.getBoolean("tokenRejected"), port.tokenRejected)
      assertEquals(name, if (v.isNull("stoppedBy")) null else v.getString("stoppedBy"), port.error)
      assertEquals(name, v.getBoolean("hasFilters"), port.savedFilters != null)
      assertEquals(name, v.getBoolean("inboxOff"), port.off)
      if (port.off && !port.tokenRejected) {
        // 받기 꺼짐: 10분 동안은 묻지 않고(앱을 열 때만 바로), 10분 뒤에 다시 본다
        assertEquals(name, 1_761_800_600_000L + NoticeContract.INBOX_OFF_RECHECK_MS, port.offCheckAtMs)
        assertEquals(name, "OFF", NoticeDrain.blockedBy(true, false, port.waitUntilMs, port.offCheckAtMs - 1, port.off, port.offCheckAtMs))
        assertNull(name, NoticeDrain.blockedBy(true, false, port.waitUntilMs, port.offCheckAtMs - 1, port.off, port.offCheckAtMs, force = true))
        assertNull(name, NoticeDrain.blockedBy(true, false, port.waitUntilMs, port.offCheckAtMs, port.off, port.offCheckAtMs))
        val left = strings(v.getJSONArray("queue")).takeLast(v.getInt("pending"))
        assertEquals(name, left, port.queue.map { it.message.text })
      }
      // 멈춘 뒤에는 새 토큰 전까지 보내지 않는다 — 대기열은 그대로
      if (port.tokenRejected) {
        assertEquals(name, "TOKEN", NoticeDrain.blockedBy(true, port.tokenRejected, port.waitUntilMs, 1_761_800_600_000L))
        val left = strings(v.getJSONArray("queue")).takeLast(v.getInt("pending"))
        assertEquals(name, left, port.queue.map { it.message.text })
      }
    }
  }

  @Test
  fun blockedBy() {
    assertEquals("NO_TOKEN", NoticeDrain.blockedBy(false, false, 0L, 1L))
    assertEquals("TOKEN", NoticeDrain.blockedBy(true, true, 0L, 1L))
    assertEquals("BUSY", NoticeDrain.blockedBy(true, false, 60_001L, 60_000L))
    assertNull(NoticeDrain.blockedBy(true, false, 60_000L, 60_000L))
    assertEquals("OFF", NoticeDrain.blockedBy(true, false, 0L, 1L, true, 2L))
    assertNull(NoticeDrain.blockedBy(true, false, 0L, 1L, true, 2L, force = true))
    assertEquals("TOKEN", NoticeDrain.blockedBy(true, true, 0L, 1L, true, 2L, force = true))
  }

  @Test
  fun serverErrorKeepsSameIds() {
    val port = MemoryPort()
    for (i in 1..2) port.queue.add(QueuedMessage(i, NoticeExtractor.shortcutCandidate("010-1234-5678", "찜 ${i}번", i * 120_000L)!!))
    val ids = ArrayList<List<String>>()
    var status = 500
    val post: (String) -> PostResult = { json ->
      val messages = JSONObject(json).getJSONArray("messages")
      val batch = (0 until messages.length()).map { messages.getJSONObject(it).getString("id") }
      ids.add(batch)
      if (status != 200) PostResult(status, "") else PostResult(200, "{\"results\":[],\"filters\":{\"skipWords\":[],\"bankApps\":[]}}")
    }
    assertEquals(DrainResult(0, 2, "SERVER"), NoticeDrain.run(port, "폰", false, { 1L }, { false }, {}, post))
    status = 200
    assertEquals(DrainResult(2, 0, null), NoticeDrain.run(port, "폰", false, { 1L }, { false }, {}, post))
    assertEquals(ids[0], ids[1])
  }

  @Test
  fun stoppedWorkerKeepsQueue() {
    val port = MemoryPort()
    port.queue.add(QueuedMessage(0, NoticeExtractor.shortcutCandidate("010-1234-5678", "찜 1번", 1L)!!))
    var posted = 0
    val result = NoticeDrain.run(port, "폰", false, { 1L }, { true }, {}) { posted++; PostResult(200, "") }
    assertEquals(DrainResult(0, 1, "NETWORK"), result)
    assertEquals(0, posted)
  }
}
