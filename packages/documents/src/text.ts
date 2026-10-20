// 글자 도구: 코드 포인트 순 비교(D-207 — Intl·localeCompare 대신), 제어 글자 빼기.

/** 코드 포인트 순 비교 (UTF-16 코드 단위 순과 다르다 — 보조 평면 글자) */
export function compareCodePoints(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i++) {
    const ca = (x[i] as string).codePointAt(0) as number
    const cb = (y[i] as string).codePointAt(0) as number
    if (ca !== cb) return ca - cb
  }
  return x.length - y.length
}

/**
 * 제어 글자(줄바꿈·탭 포함)·서식 글자(방향 표시·폭 없는 글자 등)·줄/문단 구분 글자·짝 없는 서로게이트 (D-207: 빼고 그린다).
 * 글꼴에 없는 글자는 글꼴을 알아야 하므로 DocumentFont.sanitize에서 함께 뺀다.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/gu

export function stripInvisible(text: string): string {
  return text.normalize('NFC').replace(INVISIBLE, '')
}
