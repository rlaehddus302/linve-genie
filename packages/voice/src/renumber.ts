// 음성 번호 옮기기 말 (SPEC VOC-04·PRD-06, DOMAIN_RULES R-24, D-V3-58). 사례: tests/golden/voice-register/renumber.json.
// "아까 65번은 61번이야" · "65번 아니 61번" · (등록 뒤) "아니 61번" → { from, to } (from null = 방금 등록한 번호). 순수 함수, 예외 없음.
import { analyzeSentence, listNumberMarkers, readingForms, tokenize } from './extract.ts'
import { CORRECTION_MARKERS, isWindowFiller } from './words.ts'

export interface Renumber {
  readonly from: number | null
  readonly to: number
}

const LEAD_WORDS = new Set(['아까', '방금', '그'])
/** ⓐ B번 뒤에 붙어도 되는 말 */
const TAIL_ENDINGS = ['이야', '이에요', '예요', '입니다', '이요', '요']
const TOPIC_ENDINGS = ['은', '는']
const BEON = '번'

/** R-24: 조각 글 하나 → { from, to } 또는 null */
export function readRenumber(text: unknown, options: { readonly maxNumber?: number } = {}): Renumber | null {
  try {
    const all = tokenize(text)
    if (all === null || all.length === 0) return null
    const max = typeof options?.maxNumber === 'number' && Number.isSafeInteger(options.maxNumber) && options.maxNumber >= 1 ? options.maxNumber : 999
    // 1. 가격 묶음·원 가격 줄이 있으면 null (값이 있는 말은 등록·고치기로 읽는다)
    const analysis = analyzeSentence(all.join(' '), { maxNumber: 9999 })
    if (analysis.heardPrices.length > 0 || analysis.wonLines > 0) return null
    // 군말을 뺀 토큰 (아까·방금·그는 ⓐ 앞말로 따로 본다)
    const isCorrection = (token: string): boolean => CORRECTION_MARKERS.includes(token) || token === '말고' || token === '정정'
    const tokens = all.filter((token) => isCorrection(token) || !isWindowFiller(token))
    const inRange = (n: number): boolean => n >= 1 && n <= max
    const markerValue = (token: string, endings: readonly string[]): number | null => {
      for (const ending of ['', ...endings]) {
        if (ending !== '' && !token.endsWith(ending)) continue
        const core = ending === '' ? token : token.slice(0, -ending.length)
        if (!core.endsWith(BEON)) continue
        const found = listNumberMarkers([core])
        if (found.length === 1 && !found[0]?.split) return found[0]?.value ?? null
      }
      return null
    }
    // ⓐ [아까|방금|그]? A번은|는 B번[이야…]?
    const a = LEAD_WORDS.has(tokens[0] ?? '') ? tokens.slice(1) : tokens
    if (a.length === 2) {
      const from = markerValue(a[0] as string, TOPIC_ENDINGS)
      const isTopic = TOPIC_ENDINGS.some((ending) => (a[0] as string).endsWith(BEON + ending))
      const to = markerValue(a[1] as string, TAIL_ENDINGS)
      if (from !== null && to !== null && isTopic && from !== to && inRange(from) && inRange(to)) return { from, to }
    }
    // ⓑ A번 (아니|말고|정정)+ B번 · ⓒ (아니|말고|정정)+ B번
    let i = 0
    let from: number | null = null
    if (tokens.length >= 3 && !isCorrection(tokens[0] as string)) {
      from = markerValue(tokens[0] as string, [])
      if (from === null || readingForms(tokens[0] as string)[0] !== tokens[0]) return null
      i = 1
    }
    let corrections = 0
    while (i < tokens.length - 1 && isCorrection(tokens[i] as string)) {
      i++
      corrections++
    }
    if (corrections === 0 || i !== tokens.length - 1) return null
    const to = markerValue(tokens[i] as string, [])
    if (to === null || !inRange(to) || (from !== null && (from === to || !inRange(from)))) return null
    return { from, to }
  } catch {
    return null
  }
}
