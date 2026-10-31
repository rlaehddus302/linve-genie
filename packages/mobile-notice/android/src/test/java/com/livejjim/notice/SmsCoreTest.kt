// 문자 직접 받기 순수 규칙 (SMS4) — 수신기·저장소 같은 id, 긴 문자 잇기, 따라잡기 자리, 알림 길 겹치기
package com.livejjim.notice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsCoreTest {
  private val sentAt = 1_761_800_000_000L

  @Test
  fun receiverAndStoreGiveSameId() {
    // 수신기: 받은 시각 = 지금, 문자 센터 시각 = sentAt · 저장소: date = 몇 초 뒤 기록, date_sent = 같은 sentAt
    val fromReceiver = SmsCore.toMessage(SmsCore.joinParts("+821012345678", listOf("3번 ", "찜이요"), sentAt + 1_000L, sentAt))!!
    val fromStore = SmsCore.toMessage(SmsRow("sms", 41L, "010-1234-5678", "3번 찜이요", sentAt + 3_000L, sentAt))!!
    assertEquals(fromReceiver.id, fromStore.id)
    assertEquals("SMS", fromStore.channel)
    assertEquals("3번 찜이요", fromStore.text)
    assertEquals(sentAt + 3_000L, fromStore.receivedAt)
    assertNull(fromStore.title)
    assertEquals(32, fromStore.id.length)
  }

  @Test
  fun differentMinuteOrTextIsNewMessage() {
    val a = SmsCore.toMessage(SmsRow("sms", 1L, "01012345678", "3번", sentAt, sentAt))!!
    val laterMinute = SmsCore.toMessage(SmsRow("sms", 2L, "01012345678", "3번", sentAt + 60_000L, sentAt + 60_000L))!!
    val otherText = SmsCore.toMessage(SmsRow("sms", 3L, "01012345678", "4번", sentAt, sentAt))!!
    val otherSender = SmsCore.toMessage(SmsRow("sms", 4L, "01099998888", "3번", sentAt, sentAt))!!
    assertNotEquals(a.id, laterMinute.id)
    assertNotEquals(a.id, otherText.id)
    assertNotEquals(a.id, otherSender.id)
  }

  @Test
  fun senderKeyIgnoresFormatting() {
    assertEquals(SmsCore.senderKey("010-1234-5678"), SmsCore.senderKey("01012345678"))
    assertEquals("01012345678", SmsCore.senderKey("+82 10 1234 5678"))
    assertEquals("01012345678", SmsCore.senderKey("+82 010-1234-5678"))
    assertEquals("국민은행", SmsCore.senderKey("국민은행"))
    assertEquals("", SmsCore.senderKey(null))
  }

  @Test
  fun emptyBodyIsSkippedAndLongBodyIsCut() {
    assertNull(SmsCore.toMessage(SmsRow("sms", 1L, "01012345678", "  \n ", sentAt, sentAt)))
    assertNull(SmsCore.toMessage(SmsRow("mms", 1L, "01012345678", null, sentAt, 0L)))
    val long = "가".repeat(1_500)
    assertEquals(NoticeContract.TEXT_MAX_CHARS, SmsCore.toMessage(SmsRow("sms", 1L, "01012345678", long, sentAt, sentAt))!!.text.length)
  }

  @Test
  fun mmsWithoutSentTimeUsesReceivedTime() {
    val m = SmsCore.toMessage(SmsRow("mms", 9L, "01012345678", "사진 보냈어요 5번", SmsCore.mmsSecondsToMs(1_761_800_000L), 0L))!!
    assertEquals(1_761_800_000_000L, m.receivedAt)
    assertEquals(SmsCore.messageIdOf("01012345678", "사진 보냈어요 5번", 1_761_800_000_000L), m.id)
  }

  @Test
  fun catchUpIsLast24HoursOnly() {
    assertEquals(sentAt - 24L * 3_600_000L, SmsCore.oldestAllowedMs(sentAt))
  }

  @Test
  fun cursorOnlyMovesForward() {
    val start = SmsCursor(10L, 5L)
    val rows = listOf(SmsRow("sms", 12L, null, "a", sentAt, 0L), SmsRow("sms", 11L, null, "b", sentAt, 0L), SmsRow("mms", 4L, null, "c", sentAt, 0L), SmsRow("mms", 7L, null, "d", sentAt, 0L))
    assertEquals(SmsCursor(12L, 7L), SmsCore.nextCursor(start, rows))
    assertEquals(start, SmsCore.nextCursor(start, emptyList()))
  }

  @Test
  fun recentBodiesMatchNoticeWithinThreeMinutes() {
    val recent = RecentBodies(max = 3)
    val hash = SmsCore.bodyHash("3번 찜이요")
    recent.add(hash, sentAt)
    assertTrue(recent.matches(SmsCore.bodyHash("3번  찜이요"), sentAt + 120_000L))
    assertFalse(recent.matches(hash, sentAt + 4 * 60_000L))
    assertFalse(recent.matches(SmsCore.bodyHash("4번 찜이요"), sentAt))
    // 저장·불러오기, 오래된 것부터 버리기
    recent.add(SmsCore.bodyHash("b"), sentAt)
    recent.add(SmsCore.bodyHash("c"), sentAt)
    recent.add(SmsCore.bodyHash("d"), sentAt)
    val copy = RecentBodies(max = 3)
    copy.load(recent.serialize())
    assertFalse(copy.matches(hash, sentAt))
    assertTrue(copy.matches(SmsCore.bodyHash("d"), sentAt))
  }
}
