// 연락처 번호 고르기 (D-SMS-CONTACT): 서로 다른 한국 휴대폰 번호가 딱 하나일 때만
package com.livejjim.notice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ContactPickTest {
  @Test
  fun 휴대폰_번호_하나면_숫자만() {
    assertEquals("01012345678", ContactPick.mobile(listOf("010-1234-5678")))
    assertEquals("01012345678", ContactPick.mobile(listOf("+82 10-1234-5678", "010 1234 5678")))
    assertEquals("01012345678", ContactPick.mobile(listOf("02-123-4567", "010-1234-5678")))
  }

  @Test
  fun 없거나_둘이면_바꾸지_않는다() {
    assertNull(ContactPick.mobile(emptyList()))
    assertNull(ContactPick.mobile(listOf("02-123-4567", "1588-1234")))
    assertNull(ContactPick.mobile(listOf("010-1234-5678", "010-9999-8888")))
  }
}
