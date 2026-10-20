// AC-P2-07 추출의 정확성 — 성능 시험(extract.perf.test.ts, D-902)과 같은 고정 시드 사전으로 본다.
// 사전 3,000개가 만들어지는지, 빨리 거른 결과(정확히 같은 이름 먼저·길이 거르기·비트 병렬)가 모두 계산한 결과와 같은지.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { editDistance, extractVoice, jamoOf, normalizeDictionary, readingForms } from '../src/index.ts'
import { seededDictionary } from './sample-dictionary.ts'

describe('AC-P2-07 추출 — 빨리 거르기의 정확성', () => {
  const names = seededDictionary(3000, 20261020)

  it('사전 3,000개가 만들어진다', () => {
    expect(names).toHaveLength(3000)
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
