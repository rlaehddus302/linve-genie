// 앞 말 맥락의 품종 (사용자 요구 V3: "최근 1분 맥락 파악해서 종자가 뭔지 알아낼 수 있을까? 바이칼, 바이칼녹금이라고 했는데 그냥 녹금으로 등록했더라").
// 등록할 번호 앞에 들린 말(앞 상품의 번호·가격 뒤 ~ 이 번호 앞, 1분 안)에서 사전 품종을 세어 이름만 고른다 — 번호·가격은 건드리지 않는다.
// 사전 밖 낱말은 쓰지 않는다(D-V3-37 — 추측은 등록 품종이 아니다). 순수 함수: 넘긴 값만 보고 예외를 던지지 않는다.
import { readSentence, readingForms, tokenize, type ExtractOptions } from './extract.ts'
import { isWindowFiller } from './words.ts'

/** 이름 없이 맥락만으로 고를 때 필요한 들린 횟수 (품은 이름을 더한 점수) */
export const CONTEXT_VARIETY_MIN = 2

const compact = (name: string): string => name.split(' ').join('')

/** 맞춘 창이 첫 토큰(그대로 또는 끝말 뗀 모양 — `바이칼녹금이에요`)에서 시작하는가 */
const startsAtFirst = (window: string | null, first: string): boolean => window !== null && readingForms(first).some((form) => window.startsWith(form) || form.startsWith(window))

/** 글 하나에서 사전 품종을 앞에서부터 (창 1~4토큰, 다른 이름이 되는 가장 긴 맞춤, 군말·숫자에서 끊김) */
export function varietiesIn(text: unknown, options: ExtractOptions = {}): string[] {
  try {
    const tokens = tokenize(text)
    if (tokens === null) return []
    const found: string[] = []
    let k = 0
    while (k < tokens.length) {
      let best: { end: number; name: string } | null = null
      for (let j = k; j < tokens.length && j < k + 4; j++) {
        const piece = tokens.slice(k, j + 1)
        if (piece.some((token) => isWindowFiller(token) || /[0-9]/.test(token))) break
        const reading = readSentence(piece.join(' '), { dictionary: options.dictionary ?? [] })
        // 더 긴 창은 다른(더 긴) 이름일 때만 — 같은 이름을 되풀이한 `몰디브 몰디브`는 두 번으로 센다
        if (reading.extraction.name !== null && startsAtFirst(reading.nameWindow, piece[0] as string) && reading.extraction.name !== best?.name) best = { end: j, name: reading.extraction.name }
      }
      if (best === null) k++
      else {
        found.push(best.name)
        k = best.end + 1
      }
    }
    return found
  } catch {
    return []
  }
}

/**
 * 맥락 품종:
 * - name이 있으면: 맥락에 그 이름을 품은 더 긴 사전 이름(`녹금` ⊂ `바이칼녹금`)이 들렸으면 그것(가장 많이 들린 것, 같으면 긴 것). 없으면 name 그대로.
 * - name이 없으면: 점수(그 이름 횟수 + 그 이름이 품은 다른 이름 횟수)가 2 이상인 가장 높은 이름. 같은 점수에 서로 품지 않는 이름이 둘이면 null(애매).
 */
export function varietyFromContext(input: { readonly name: string | null; readonly context: readonly string[]; readonly dictionary?: ExtractOptions['dictionary'] }): string | null {
  try {
    const name = typeof input.name === 'string' && input.name.trim() !== '' ? input.name : null
    const counts = new Map<string, number>()
    for (const text of Array.isArray(input.context) ? input.context : []) {
      for (const found of varietiesIn(text, { dictionary: input.dictionary ?? [] })) counts.set(found, (counts.get(found) ?? 0) + 1)
    }
    const names = [...counts.keys()]
    const contains = (a: string, b: string): boolean => a !== b && compact(a).includes(compact(b))
    const longer = (a: string, b: string): number => compact(b).length - compact(a).length
    if (name !== null) {
      const wider = names.filter((item) => contains(item, name)).sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || longer(a, b))
      return wider[0] ?? name
    }
    const score = (a: string): number => (counts.get(a) ?? 0) + names.filter((b) => contains(a, b)).reduce((sum, b) => sum + (counts.get(b) ?? 0), 0)
    const ranked = names.filter((a) => score(a) >= CONTEXT_VARIETY_MIN).sort((a, b) => score(b) - score(a) || longer(a, b))
    const top = ranked[0]
    if (top === undefined) return null
    const rival = ranked.find((other) => other !== top && score(other) === score(top) && !contains(top, other) && !contains(other, top))
    return rival === undefined ? top : null
  } catch {
    return typeof input?.name === 'string' ? input.name : null
  }
}
