// 저장된 연락처 이름 → 휴대폰 번호 (D-SMS-CONTACT, 사용자 지시 2026-11-11 "문자찜 받았는데 상품 탭에 안 뜬다 … 번호로 받게 고쳐").
// 손님 번호를 연락처에 저장해 두면 문자 앱 알림이 번호 대신 저장한 이름만 보여 준다 → 서버는 이름만 온 문자찜을 넣지 않고
// "확인 필요(번호 없음)" 카드로 돌린다(R-26). 그래서 보낸 곳이 번호가 아니면 이 휴대폰 연락처에서 같은 이름을 찾아 번호로 바꾼다.
// - 연락처 읽기 권한이 없으면 아무 것도 하지 않는다(이름 그대로 — 지금과 같음).
// - 이름이 글자 그대로 같은 연락처의 휴대폰 번호(010·011·016·017·018·019)가 딱 하나일 때만 바꾼다. 같은 이름 연락처가 여럿이거나
//   휴대폰 번호가 둘 이상이면 바꾸지 않는다 — 엉뚱한 손님 찜이 되는 것보다 확인 필요 카드가 안전하다(AUTO).
// - 연락처 이름·번호는 로그에 남기지 않는다. 번호는 서버로 가는 문자의 보낸 곳 칸에만 들어간다(번호로 온 문자와 같은 길).
package com.livejjim.notice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract

internal object ContactNumber {
  fun granted(context: Context): Boolean =
    context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

  /** 문자 보낸 곳이 이름이면 연락처의 휴대폰 번호로 바꾼 메시지, 아니면 그대로 */
  fun resolve(context: Context, message: InboxMessage): InboxMessage {
    val from = message.from ?: return message
    if (message.channel != "SMS" || NoticeExtractor.phoneLike(from) != null || !granted(context)) return message
    val number = try {
      numberFor(context, from)
    } catch (_: Exception) {
      null
    } ?: return message
    return message.copy(from = number)
  }

  private fun numberFor(context: Context, name: String): String? {
    val found = ArrayList<String>()
    context.contentResolver.query(
      ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
      arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
      "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} = ?",
      arrayOf(name),
      null,
    )?.use { c -> while (c.moveToNext()) c.getString(0)?.let { found.add(it) } }
    return ContactPick.mobile(found)
  }
}

/** 연락처 번호들 중 휴대폰 번호 하나 고르기 (안드로이드 기기 없이 시험한다) */
object ContactPick {
  /** 숫자만 남기고 +82·82를 0으로 — 한국 휴대폰 번호(01[016789] + 7~8자리)만. 서로 다른 휴대폰 번호가 딱 하나면 그 번호(숫자만), 아니면 null */
  fun mobile(numbers: List<String>): String? {
    val mobiles = numbers.mapNotNull { normalize(it) }.toSet()
    return mobiles.singleOrNull()
  }

  fun normalize(raw: String): String? {
    var digits = raw.filter { it in '0'..'9' }
    if (raw.trim().startsWith("+82") || (digits.startsWith("82") && digits.length in 11..12)) digits = "0" + digits.removePrefix("82")
    return if (Regex("^01[016789][0-9]{7,8}$").matches(digits)) digits else null
  }
}
