// 글자 도구: 코드 포인트 순 비교(D-207 — Intl·localeCompare 대신), 제어 글자 빼기, 찍힌 구매자 이름(D-I2-04), 엑셀 글 칸 금지 글자 빼기(D-I2-03).

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

/** 구매자 이름이 비어 찍히면 쓰는 글 (D-207) */
export const NO_NAME = '(이름 없음)'

/**
 * 확인서에 실제로 찍히는 구매자 이름 (D-I2-04): 그릴 수 없는 글자·제어 글자를 뺀 뒤(sanitize — 글꼴의 DocumentFont.sanitize,
 * 글꼴이 없으면 제어·서식 글자만 빼는 stripInvisible) 공백을 한 칸으로 줄이고, 비면 "(이름 없음)". 배치(layout)와 전원 일괄 순서가 같은 함수를 쓴다
 */
export function printedName(text: string, sanitize: (text: string) => string = stripInvisible): string {
  return (
    sanitize(typeof text === 'string' ? text : '')
      .split(' ')
      .filter((part) => part !== '')
      .join(' ') || NO_NAME
  )
}

/**
 * 엑셀 글 칸에 쓸 수 없는 글자 (D-I2-03, TD-P2-003): 제어 글자 U+0000~U+001F(탭·줄바꿈·CR 포함)·U+007F~U+009F,
 * U+FFFE·U+FFFF, 짝 없는 서로게이트. XML 1.0이 받지 않는 글자가 하나라도 있으면 파일 전체가 열리지 않으므로 그 글자만 뺀다
 */
export function stripXlsxForbidden(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0xfffe || code === 0xffff) continue
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text.slice(i, i + 2)
        i++
      }
      continue // 짝 없는 앞 서로게이트
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue // 짝 없는 뒤 서로게이트
    out += text[i]
  }
  return out
}

const OPTION_CONTROL_OR_SEPARATOR = /[\p{Cc}\u2028\u2029]/gu
const OPTION_FORMAT_CHARS = /\p{Cf}/gu
const OPTION_SPACES = /\p{Zs}+/gu

/**
 * 옵션 글 다듬기 (LABEL_RULES L-2, O3 감사 D-O3-13) — 라벨 패키지 trimLabelText와 같은 차례: NFC → 제어 문자·줄/문단 구분자는 공백 →
 * 서식 문자(`\p{Cf}` — 폭 없는 공백 등)는 지움 → 이어진 공백(`\p{Zs}`)은 공백 하나, 앞뒤 공백은 지움. 확인서·판매대장의 옵션 글이 라벨의 옵션 글과 같다
 */
export function optionText(value: string): string {
  return value
    .normalize('NFC')
    .replace(OPTION_CONTROL_OR_SEPARATOR, ' ')
    .replace(OPTION_FORMAT_CHARS, '')
    .replace(OPTION_SPACES, ' ')
    .replace(/^ +| +$/g, '')
}
