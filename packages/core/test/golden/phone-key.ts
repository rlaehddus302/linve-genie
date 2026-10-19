// 골든 러너·테스트의 서버 흉내: 문자찜 전화번호 → phoneKey·phoneLast4 (README "규칙"의 문자찜 문단, D-061, AC-S03b-04).
// 엔진은 전화번호 원문을 받지 않는다. 서버(S04)는 판매자마다 고정한 비밀 키로 같은 일을 한다. 여기 키는 테스트 전용이다.
// - 코어 normalizePhone으로 정규화해 휴대폰 번호 모양이 아니면 전화번호 없이(필드 없음)
// - 모양이면 phoneKey = 테스트 전용 비밀 키의 HMAC-SHA256 base64url(43자 — 정규화한 번호마다 다르고 같은 번호면 같은 결정적 키, 번호 숫자를 담지 않는다),
//   phoneLast4 = 정규화한 번호의 뒤 4자리
import { createHmac } from 'node:crypto'
import { normalizePhone, phoneLast4 } from '@livejjim/core'

/** 테스트 전용 비밀 키 (실제 판매자 키와 상관없다) */
export const TEST_PHONE_SECRET = 'livejjim-golden-test-only-phone-secret'

/** 정규화한 번호 → 테스트 전용 전화번호 키 */
export function testPhoneKey(normalized: string): string {
  return createHmac('sha256', TEST_PHONE_SECRET).update(normalized).digest('base64url')
}

export interface SmsPhoneFields {
  readonly phoneKey?: string
  readonly phoneLast4?: string
}

/** 판매자가 적은 번호 그대로 → 엔진 sms 이벤트의 전화번호 필드 (휴대폰 번호 모양이 아니거나 없으면 빈 객체) */
export function smsPhoneFields(phone: string | undefined): SmsPhoneFields {
  const normalized = phone === undefined ? null : normalizePhone(phone)
  return normalized === null ? {} : { phoneKey: testPhoneKey(normalized), phoneLast4: phoneLast4(normalized) }
}
