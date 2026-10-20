// AC-P2-07 추출 성능: 토큰 20개 이하 문장·사전 3,000개에서 한 번이 p99 50ms 이하(준비 구간 제외, Node).
// 300글자 문장·사전 3,000개에서 한 번이 500ms 이하. 사전은 고정 시드로 만든다(같은 시험 = 같은 사전).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DICTIONARY, editDistance, extractVoice, jamoOf, normalizeDictionary, prepareDictionary, readingForms } from '../src/index.ts'

const SYLLABLES = [...'가나다라마바사아자차카타파하핑크프릴울루벨엘블레티지금방복랑왕비뇌신천사의눈물로황블랙린스보월미인홍옥청을녀심']

/** 고정 시드로 만든 3,000개 사전 (2~6글자, 가끔 띄어 씀) + 기본 사전 */
function seededDictionary(size: number, seed: number): string[] {
  const names = fc.sample(
    fc.array(fc.constantFrom(...SYLLABLES), { minLength: 2, maxLength: 6 }).map((chars) => (chars.length > 4 ? `${chars.slice(0, 3).join('')} ${chars.slice(3).join('')}` : chars.join(''))),
    { numRuns: size * 2, seed },
  )
  return normalizeDictionary([...DEFAULT_DICTIONARY, ...names]).slice(0, size)
}

/** 사전에 정확히 같은 이름이 없는 20토큰 문장 (거리 계산을 모두 하는 느린 쪽) */
function hardSentences(count: number, seed: number): string[] {
  const filler = ['자', '이거', '진짜', '예뻐요', '보세요', '다음', '거', '핑크푸릴이랑', '라울', '나울', '벨루', '만오천', '원에', '15번', '드릴게요', '금이에요', '방울복랑', '하나', '남았어요', '빨리']
  return fc.sample(fc.array(fc.constantFrom(...filler), { minLength: 20, maxLength: 20 }).map((tokens) => tokens.join(' ')), { numRuns: count, seed })
}

const percentile = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number
}

describe('AC-P2-07 추출 성능', () => {
  const names = seededDictionary(3000, 20261020)

  it('사전 3,000개가 만들어진다', () => {
    expect(names).toHaveLength(3000)
  })

  it('토큰 20개 문장 · 사전 3,000개(이름 목록 그대로 넘김 — 사전 정리 포함) → p99 50ms 이하', () => {
    const sentences = hardSentences(200, 7)
    // 준비 구간: JIT가 데워질 때까지 돌리고 재지 않는다
    for (const text of sentences.slice(0, 20)) extractVoice(text, { dictionary: names })
    const times: number[] = []
    for (const text of sentences) {
      const started = performance.now()
      extractVoice(text, { dictionary: names })
      times.push(performance.now() - started)
    }
    expect(percentile(times, 99)).toBeLessThanOrEqual(50)
  })

  it('준비한 사전으로는 더 빠르다 (방송 중 쓰는 길) → p99 50ms 이하', () => {
    const prepared = prepareDictionary(names)
    const sentences = hardSentences(300, 11)
    for (const text of sentences.slice(0, 30)) extractVoice(text, { dictionary: prepared })
    const times: number[] = []
    for (const text of sentences) {
      const started = performance.now()
      extractVoice(text, { dictionary: prepared })
      times.push(performance.now() - started)
    }
    expect(percentile(times, 99)).toBeLessThanOrEqual(50)
  })

  it('300글자 문장 · 사전 3,000개 → 한 번 500ms 이하', () => {
    const tokens = ['핑크푸릴', '나', '울', '벨', '루', '자', '이', '거']
    let text = '15번'
    let i = 0
    while ([...`${text} ${tokens[i % tokens.length] as string}`].length <= 300) text = `${text} ${tokens[i++ % tokens.length] as string}`
    expect([...text].length).toBeLessThanOrEqual(300)
    expect([...text].length).toBeGreaterThan(290)
    extractVoice(text, { dictionary: names })
    const started = performance.now()
    extractVoice(text, { dictionary: names })
    expect(performance.now() - started).toBeLessThanOrEqual(500)
  })

  it('빨리 거른 결과(정확히 같은 이름 먼저·길이 거르기·비트 병렬)는 모든 창·이름 짝을 다 계산한 결과와 같다', () => {
    const small = seededDictionary(300, 3)
    const entries = normalizeDictionary(small).map((name) => ({ name, key: name.split(' ').join(''), jamo: jamoOf(name) }))
    // 번호·가격이 없는 문장 — 모든 토큰이 창에 들어간다
    const words = ['핑크푸릴', '나울', '벨루', '자', '이거', '라울이랑', '금이에요', '방울', '복랑', '핑크', '프릴', '블루엘푸', '레티지야', '십이', '지권', '로나']
    const sentences = fc.sample(fc.array(fc.constantFrom(...words), { minLength: 1, maxLength: 8 }).map((t) => t.join(' ')), { numRuns: 150, seed: 99 })
    for (const text of sentences) {
      const tokens = text.split(' ')
      let best: { d: number; l: number } | null = null
      let names: typeof entries = []
      for (let s = 0; s < tokens.length; s++) {
        for (let e = s; e < Math.min(tokens.length, s + 4); e++) {
          for (const form of readingForms(tokens[e] as string)) {
            const w = jamoOf(tokens.slice(s, e).join('') + form)
            for (const entry of entries) {
              const d = editDistance(w, entry.jamo)
              const l = Math.max(w.length, entry.jamo.length)
              if (l === 0 || d * 5 > l) continue
              const order = best === null ? 1 : (l - d) * best.l - (best.l - best.d) * l
              if (order > 0) {
                best = { d, l }
                names = []
              }
              if (order >= 0 && !names.includes(entry)) names.push(entry)
            }
          }
        }
      }
      const container = names.find((a) => names.every((b) => a.key.includes(b.key)))
      expect(extractVoice(text, { dictionary: small }).name, text).toBe(container?.name ?? null)
    }
  })
})
