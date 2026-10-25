// 음성 번호 옮기기 말 (SPEC VOC-04·PRD-06, DOMAIN_RULES R-24, D-V3-58·D-V3-66). 사례: tests/golden/voice-register/renumber.json.
// "아까 65번은 61번이야" · "65번 아니 61번" · (등록 뒤) "아니 61번" → { from, to } (from null = 방금 등록한 번호). 순수 함수, 예외 없음.
// 번호는 R-17 3 번호 표시 그대로 읽는다 — 띄어 쓴 `번`(`65 번은`)·앞 수와 합치기(`6 5번은`·`육십 오번은`), 겹쳐 비우는 꼴이면 null (D-V3-66).
import { analyzeSentence, listNumberMarkers, tokenize, type NumberMarker } from './extract.ts'
import { CORRECTION_MARKERS, isWindowFiller } from './words.ts'

export interface Renumber {
  readonly from: number | null
  readonly to: number
}

const LEAD_WORDS = new Set(['아까', '방금', '그'])
/** ⓐ A번 뒤 끝말 · B번 뒤 끝말 */
const TOPIC_ENDINGS = new Set(['은', '는'])
const TAIL_ENDINGS = new Set(['', '이야', '이에요', '예요', '입니다', '이요', '요'])
const BEON = '번'

const isCorrection = (token: string): boolean => CORRECTION_MARKERS.includes(token) || token === '말고' || token === '정정'

/** R-24: 조각 글 하나 → { from, to } 또는 null */
export function readRenumber(text: unknown, options: { readonly maxNumber?: number } = {}): Renumber | null {
  try {
    const all = tokenize(text)
    if (all === null || all.length === 0) return null
    const max = typeof options?.maxNumber === 'number' && Number.isSafeInteger(options.maxNumber) && options.maxNumber >= 1 ? options.maxNumber : 999
    // 1. 가격 묶음·원 가격 줄이 있으면 null (값이 있는 말은 등록·고치기로 읽는다)
    const analysis = analyzeSentence(all.join(' '), { maxNumber: 9999 })
    if (analysis.heardPrices.length > 0 || analysis.wonLines > 0) return null
    // 군말을 뺀 토큰 (정정 표시는 남긴다)
    const kept = all.filter((token) => isCorrection(token) || !isWindowFiller(token))
    // 끝 토큰의 B번 뒤 끝말(`61번이야` — R-17 2 끝말 밖의 `이야` 포함)은 떼고 번호를 읽는다
    const lastToken = kept[kept.length - 1] ?? ''
    const tail = [...TAIL_ENDINGS].filter((ending) => ending !== '').sort((a, b) => b.length - a.length).find((ending) => lastToken.endsWith(BEON + ending))
    const tokens = tail === undefined ? kept : [...kept.slice(0, -1), lastToken.slice(0, -tail.length)]
    const tailEnding = tail ?? ''
    const markers = listNumberMarkers(tokens)
    if (markers.some((marker) => marker.split)) return null
    const inRange = (n: number): boolean => n >= 1 && n <= max
    /** 표시 마지막 토큰의 '번' 뒤 글 (`번은` → 은) */
    const suffix = (marker: NumberMarker): string => {
      const token = tokens[marker.last] as string
      return token.slice(token.lastIndexOf(BEON) + BEON.length)
    }
    const markerAt = (start: number): NumberMarker | undefined => markers.find((marker) => marker.start === start)
    // ⓐ [아까|방금|그]? A번은|는 B번[이야…]?
    const lead = LEAD_WORDS.has(tokens[0] ?? '') ? 1 : 0
    const a1 = markerAt(lead)
    if (a1 !== undefined && TOPIC_ENDINGS.has(suffix(a1))) {
      const a2 = markerAt(a1.last + 1)
      if (a2 === undefined || a2.last !== tokens.length - 1 || suffix(a2) !== '') return null
      return a1.value !== a2.value && inRange(a1.value) && inRange(a2.value) ? { from: a1.value, to: a2.value } : null
    }
    // ⓑ A번 (아니|말고|정정)+ B번 · ⓒ (아니|말고|정정)+ B번
    let i = 0
    let from: number | null = null
    const first = markerAt(0)
    if (first !== undefined) {
      if (suffix(first) !== '') return null
      from = first.value
      i = first.last + 1
    }
    let corrections = 0
    while (i < tokens.length && isCorrection(tokens[i] as string)) {
      i++
      corrections++
    }
    const target = markerAt(i)
    if (corrections === 0 || target === undefined || target.last !== tokens.length - 1 || suffix(target) !== '' || tailEnding !== '') return null
    if (!inRange(target.value) || (from !== null && (from === target.value || !inRange(from)))) return null
    return { from, to: target.value }
  } catch {
    return null
  }
}
