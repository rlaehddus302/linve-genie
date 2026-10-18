// 표시용 포맷 (R-13 "감사 문구", D-044). 실행 환경의 언어·시간대 설정과 무관한 순수 함수다(Intl·toLocaleString 금지, D-024).

/**
 * 정수 원을 세 자리마다 쉼표로 끊고 `원`을 붙인다: `800원`, `10,000원`, `1,000,000원`.
 * 음수는 앞에 `-`를 붙인다(조정 항목 표시용). 안전한 정수가 아니면 RangeError — 금액은 정수 원이다(CLAUDE.md 규칙 2).
 */
export function formatWon(amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`금액은 안전한 정수 원이어야 한다 (값: ${String(amount)})`)
  const digits = String(Math.abs(amount))
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return `${amount < 0 ? '-' : ''}${out}원`
}

export interface ThanksTextInput {
  /** 상품 번호 */
  readonly no: number
  /** 품종. 앞뒤 공백은 뺀다. 비어 있으면 품종과 그 뒤 공백을 뺀다 */
  readonly name: string
  /** 가격 스냅샷 (정수 원) */
  readonly price: number
  /** 확정되는 순간의 구매자 표시 이름 */
  readonly buyerName: string
}

/**
 * 감사 문구 `{번호}번 {품종} {가격} {구매자}님 구매 감사합니다` (R-13, YT-04).
 * 두 대상(LIVE_CHAT·VIDEO_COMMENT)의 문구는 같다. 글자 수 제한은 게시하는 쪽(S11)이 다룬다.
 */
export function formatThanksText({ no, name, price, buyerName }: ThanksTextInput): string {
  const variety = name.trim()
  return [`${String(no)}번`, ...(variety === '' ? [] : [variety]), formatWon(price), `${buyerName}님 구매 감사합니다`].join(' ')
}
