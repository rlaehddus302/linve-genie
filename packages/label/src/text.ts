// 글 다듬기와 표시 형식 (LABEL_RULES L-2·L-3·L-4, D-P1-03·04).
// 실행 환경의 언어·시간대 설정을 읽지 않는다(toLocale*·Intl.Collator·Date 없음, AC-P1-03·15).
import { formatWon } from '@livejjim/core'

const CONTROL_OR_SEPARATOR = /[\p{Cc}\u2028\u2029]/gu
const FORMAT_CHARS = /\p{Cf}/gu
const SPACES = /\p{Zs}+/gu

/**
 * 글 다듬기 (L-2) — 가게 이름·품종·닉네임·방송 제목. 차례대로:
 * 1. NFC로 합친다 2. 제어 문자(`\p{Cc}`)·줄/문단 구분자는 공백으로 3. 서식 문자(`\p{Cf}`)는 지운다
 * 4. 이어진 공백(`\p{Zs}`)은 보통 공백 하나로, 앞뒤 공백은 지운다. 이모지는 지우지 않는다.
 */
export function trimLabelText(value: string): string {
  return value
    .normalize('NFC')
    .replace(CONTROL_OR_SEPARATOR, ' ')
    .replace(FORMAT_CHARS, '')
    .replace(SPACES, ' ')
    .replace(/^ +| +$/g, '')
}

/** 다듬어 빈 닉네임 (L-2) */
export const NO_NAME = '이름 없음'
/** 다듬어 빈 방송 제목 (L-2) */
export const NO_TITLE = '제목 없음'
/** 문자찜 구매자는 언제나 이 글 (L-3, R-11) */
export const SMS_BUYER = '문자찜'

// 실행 환경 언어와 상관없이 같은 결과: 보이는 글자 나누기는 언어 맞춤이 없는 규칙이라 'und'로 고정한다.
// 앱(React Native Hermes)에는 Intl.Segmenter가 없어 모듈을 읽자마자 `new`가 터졌다(APP2 안드로이드 실행에서 처음 드러남).
// 그래서 처음 쓸 때 만들고, 없으면 아래 대체 규칙으로 나눈다.
interface GraphemeSegmenter {
  segment(value: string): Iterable<{ segment: string }>
}
let graphemeSegmenter: GraphemeSegmenter | null | undefined

function segmenter(): GraphemeSegmenter | null {
  if (graphemeSegmenter === undefined) {
    const Segmenter = (Intl as { Segmenter?: new (locale: string, options: { granularity: 'grapheme' }) => GraphemeSegmenter }).Segmenter
    graphemeSegmenter = typeof Segmenter === 'function' ? new Segmenter('und', { granularity: 'grapheme' }) : null
  }
  return graphemeSegmenter
}

// 대체 규칙(Intl.Segmenter 없는 실행 환경): 앞 글자에 붙는 것 — 결합 부호·변형 선택자·피부색·태그·ZWJ 다음 글자·국기 짝·한글 자모 이음
const MARK = /^\p{M}$/u
const between = (c: number, low: number, high: number): boolean => c >= low && c <= high
const isExtend = (cur: string, c: number): boolean =>
  MARK.test(cur) || c === 0x200d || between(c, 0xfe00, 0xfe0f) || between(c, 0x1f3fb, 0x1f3ff) || between(c, 0xe0020, 0xe007f)
const isRegional = (value: string): boolean => between(value.codePointAt(0) ?? 0, 0x1f1e6, 0x1f1ff)
const isJamoL = (c: number): boolean => c >= 0x1100 && c <= 0x115f
const isJamoV = (c: number): boolean => c >= 0x1160 && c <= 0x11a7
const isJamoT = (c: number): boolean => c >= 0x11a8 && c <= 0x11ff
const isSyllable = (c: number): boolean => c >= 0xac00 && c <= 0xd7a3
const isLvSyllable = (c: number): boolean => isSyllable(c) && (c - 0xac00) % 28 === 0

function joinsPrevious(prev: string, prevCode: number, cur: string, curCode: number, regionalRun: number): boolean {
  if (isExtend(cur, curCode)) return true
  if (prev === '‍') return true
  if (isRegional(prev) && isRegional(cur)) return regionalRun % 2 === 1
  if (isJamoL(prevCode) && (isJamoL(curCode) || isJamoV(curCode) || isSyllable(curCode))) return true
  if ((isJamoV(prevCode) || isLvSyllable(prevCode)) && (isJamoV(curCode) || isJamoT(curCode))) return true
  if ((isJamoT(prevCode) || (isSyllable(prevCode) && !isLvSyllable(prevCode))) && isJamoT(curCode)) return true
  return false
}

function splitGraphemesFallback(value: string): string[] {
  const out: string[] = []
  let prev = ''
  let prevCode = -1
  let regionalRun = 0
  for (const cur of value) {
    const curCode = cur.codePointAt(0) ?? 0
    if (out.length > 0 && joinsPrevious(prev, prevCode, cur, curCode, regionalRun)) out[out.length - 1] += cur
    else out.push(cur)
    regionalRun = isRegional(cur) ? regionalRun + 1 : 0
    prev = cur
    prevCode = curCode
  }
  return out
}

/** 보이는 글자(자소 묶음) 단위로 나눈다. 말줄임표·두 줄 나누기가 이모지·결합 문자를 가르지 않게 (L-5) */
export function splitGraphemes(value: string): string[] {
  const native = segmenter()
  if (native === null) return splitGraphemesFallback(value)
  const out: string[] = []
  for (const part of native.segment(value)) out.push(part.segment)
  return out
}

/** 시험용: Intl.Segmenter 없는 실행 환경의 대체 나누기 */
export const splitGraphemesWithoutIntl = splitGraphemesFallback

/** 세 자리 쉼표 (0 이상 안전한 정수) */
export function groupDigits(value: number): string {
  const digits = String(value)
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ','
    out += digits[i]
  }
  return out
}

export const PRICE_STYLES = ['THOUSAND', 'WON', 'TEN_THOUSAND'] as const
export type PriceStyle = (typeof PRICE_STYLES)[number]

/**
 * 상품 라벨 가격 표기 (L-3, D-007).
 * THOUSAND: 1,000의 배수이고 0보다 크면 `N 천원`(N은 세 자리 쉼표), 아니면 원 표기. WON: 언제나 원 표기 = 코어 formatWon.
 * TEN_THOUSAND (D-UX4-07): 1,000의 배수이고 0보다 크면 만·천 단위 — `30만원`, `3만 5천원`, `8천원`(만 자리는 세 자리 쉼표), 아니면 원 표기.
 */
export function formatLabelPrice(price: number, style: PriceStyle): string {
  if (style === 'THOUSAND' && price > 0 && price % 1000 === 0) return `${groupDigits(price / 1000)} 천원`
  if (style === 'TEN_THOUSAND' && price > 0 && price % 1000 === 0) {
    const man = Math.floor(price / 10000)
    const cheon = (price % 10000) / 1000
    if (man === 0) return `${String(cheon)}천원`
    return cheon === 0 ? `${groupDigits(man)}만원` : `${groupDigits(man)}만 ${String(cheon)}천원`
  }
  return formatWon(price)
}

/** 상품 라벨 가격 자리 (L-3, O3 D-O3-02): 수량 2 이상이면 `{수량}개 {가격 표기}` — 가격은 찜 금액 */
export function formatLabelPriceWithQty(price: number, style: PriceStyle, qty: number): string {
  const text = formatLabelPrice(price, style)
  return qty >= 2 ? `${String(qty)}개 ${text}` : text
}

/** 포장 라벨 옵션 항목 글 (L-4, O3 D-O3-03): `{번호}[ {옵션 글}][ ×{수량}]` — 옵션 글은 다듬은 것, 수량은 2 이상일 때만 */
export function formatPackingEntry(no: number, variant: string | null, qty: number): string {
  return `${String(no)}${variant === null ? '' : ` ${variant}`}${qty >= 2 ? ` ×${String(qty)}` : ''}`
}

/** 날짜 `YYYY-MM-DD`가 있는 날짜인지 */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
  return day <= days
}

/** `2026-10-08` → `26.10.08` (L-3). 시각·시간대를 읽지 않고 글자만 바꾼다 */
export function formatLabelDate(date: string): string {
  return `${date.slice(2, 4)}.${date.slice(5, 7)}.${date.slice(8, 10)}`
}
