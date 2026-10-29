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
      // 꾸밈말 붙은 품종 (실방송 금화다육): 공백만 다른 맞춤인 이름의 창이 끝말 없이 끝나고 바로 다음 토큰이 '금' + 이름 말끝이면 이름 + 금
      const composed = new Set<string>()
      if (container !== undefined && best !== null && best.d === 0 && !container.key.endsWith('금')) {
        const target = jamoOf(container.key).join(',')
        for (let s = 0; s < tokens.length; s++) {
          for (let e = s; e < Math.min(tokens.length, s + 4); e++) {
            if (jamoOf(tokens.slice(s, e + 1).join('')).join(',') !== target) continue
            if (['금', '금이에요', '금에요', '금입니다', '금이요', '금이고', '금이고요', '금이구요', '금이래요', '금이라고', '금이라고요', '금인데', '금인데요', '금이죠', '금짜리', '금요', '금까지'].includes(tokens[e + 1] ?? '')) {
              const word = container.key + '금'
              composed.add(entries.find((entry) => entry.key === word)?.name ?? word)
            }
          }
        }
      }
      const expected = composed.size === 1 ? [...composed][0] : (container?.name ?? null)
      expect(extractVoice(text, { dictionary: small }).name, text).toBe(expected)
    }
  })
})
