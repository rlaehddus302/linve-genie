// 금액 한글 읽기 (D-UX4-23, 사용자 지시 2026-11-09 "가격 아래에는 사진처럼 한글로도 표시" — 토스 "1만 5,000원"):
// 억·만 단위로 끊고 단위 안 숫자는 쉼표를 붙인다. 0은 "0원". 정수 원만 받는다(절대 규칙 2).
const group = (value: number): string => value.toLocaleString('ko-KR')

export function koreanWon(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) return ''
  if (amount === 0) return '0원'
  const eok = Math.floor(amount / 100_000_000)
  const man = Math.floor((amount % 100_000_000) / 10_000)
  const rest = amount % 10_000
  const parts: string[] = []
  if (eok > 0) parts.push(`${group(eok)}억`)
  if (man > 0) parts.push(`${group(man)}만`)
  if (rest > 0) parts.push(group(rest))
  return `${parts.join(' ')}원`
}
