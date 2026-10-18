// 속성 테스트용 표준 읽기 (AC-S01-21, AC-S01-30). 구현과 따로, 규칙 문장대로 숫자 → 글자를 만든다.

const SINO = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'] as const
const SMALL_UNITS = [
  [1000, '천'],
  [100, '백'],
  [10, '십'],
] as const
const NATIVE_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'] as const
const NATIVE_ONES = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉'] as const

const at = (list: readonly string[], index: number): string => list[index] ?? ''

/** 1..9999의 표준 한자어 읽기. 십·백·천 앞 `일`은 생략한다(`천이백`, `십오`). */
export function sinoBelowMan(n: number): string {
  let out = ''
  let rest = n
  for (const [size, unit] of SMALL_UNITS) {
    const digit = Math.floor(rest / size)
    rest %= size
    if (digit > 0) out += `${digit === 1 ? '' : at(SINO, digit)}${unit}`
  }
  return out + at(SINO, rest)
}

/** 1..99,999,999의 표준 한자어 읽기. 1만은 `만`, 11만은 `십일만`. */
export function sinoReading(n: number): string {
  const man = Math.floor(n / 10000)
  const below = n % 10000
  const head = man === 0 ? '' : man === 1 ? '만' : `${sinoBelowMan(man)}만`
  return head + (below === 0 ? '' : sinoBelowMan(below))
}

/** 1..99의 고유어 읽기 (`열다섯`, `스물`, `아흔아홉`) */
export function nativeReading(n: number): string {
  return at(NATIVE_TENS, Math.floor(n / 10)) + at(NATIVE_ONES, n % 10)
}

/** 천 단위 쉼표 묶음 (`1,000,000`). toLocaleString은 실행 환경 언어에 따라 달라 쓰지 않는다. */
export function withCommas(n: number): string {
  const digits = String(n)
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return out
}
