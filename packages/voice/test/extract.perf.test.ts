// AC-P2-07 추출 성능: 토큰 20개 이하 문장·사전 3,000개에서 한 번이 p99 50ms 이하(준비 구간 제외, Node).
// 300글자 문장·사전 3,000개에서 한 번이 500ms 이하. 사전은 고정 시드로 만든다(같은 시험 = 같은 사전).
// 걸린 시간을 재므로 D-902대로 정확성 게이트(pnpm verify) 밖이다 — `pnpm perf`로 부하 없을 때 돌린다.
// 같은 재료로 하는 정확성 단언(사전 크기, 빨리 거른 결과 = 모두 계산한 결과)은 extract-filter.test.ts에 있다.
import { describe, expect, it } from 'vitest'
import { extractVoice, prepareDictionary } from '../src/index.ts'
import { hardSentences, seededDictionary } from './sample-dictionary.ts'

const percentile = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number
}

describe('AC-P2-07 추출 성능', () => {
  const names = seededDictionary(3000, 20261020)

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
})
