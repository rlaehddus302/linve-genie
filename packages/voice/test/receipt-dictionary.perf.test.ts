// AC-V3-100 (e) 영수증 거래명으로 늘린 기본 사전의 성능 (D-V3-115): AC-P2-07과 같은 기준을 사전 4,000개(기본 사전 전부 + 판매 이력 꼴 이름)로.
// 토큰 20개 문장 p99 50ms 이하, 300글자 문장 한 번 500ms 이하(준비 구간 제외, Node). 걸린 시간을 재므로 D-902대로 게이트 밖 — `pnpm perf`.
import { describe, expect, it } from 'vitest'
import { DEFAULT_DICTIONARY, extractVoice, prepareDictionary, readSegments } from '../src/index.ts'
import { hardSentences, seededDictionary } from './sample-dictionary.ts'

const percentile = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number
}

describe('AC-V3-100 (e) 사전 4,000개 성능', () => {
  const names = seededDictionary(4000, 20261028)

  it('사전은 4,000개이고 기본 사전(영수증 거래명 포함)을 모두 품는다', () => {
    expect(names).toHaveLength(4000)
    const all = new Set(names)
    for (const name of DEFAULT_DICTIONARY) expect(all.has(name), name).toBe(true)
  })

  it('토큰 20개 문장 · 이름 목록 그대로(사전 정리 포함) → p99 50ms 이하', () => {
    const sentences = hardSentences(200, 7)
    for (const text of sentences.slice(0, 20)) extractVoice(text, { dictionary: names })
    const times: number[] = []
    for (const text of sentences) {
      const started = performance.now()
      extractVoice(text, { dictionary: names })
      times.push(performance.now() - started)
    }
    expect(percentile(times, 99)).toBeLessThanOrEqual(50)
  })

  it('토큰 20개 문장 · 준비한 사전(방송 중 쓰는 길) → 추출·조각 읽기 p99 50ms 이하', () => {
    const prepared = prepareDictionary(names)
    const sentences = hardSentences(300, 11)
    for (const text of sentences.slice(0, 30)) {
      extractVoice(text, { dictionary: prepared })
      readSegments(text, { dictionary: prepared, final: true })
    }
    const extract: number[] = []
    const segments: number[] = []
    for (const text of sentences) {
      let started = performance.now()
      extractVoice(text, { dictionary: prepared })
      extract.push(performance.now() - started)
      started = performance.now()
      readSegments(text, { dictionary: prepared, final: true })
      segments.push(performance.now() - started)
    }
    expect(percentile(extract, 99)).toBeLessThanOrEqual(50)
    expect(percentile(segments, 99)).toBeLessThanOrEqual(50)
  })

  it('300글자 문장 → 한 번 500ms 이하', () => {
    const tokens = ['핑크푸릴', '나', '울', '벨', '루', '자', '이', '거']
    let text = '15번'
    let i = 0
    while ([...`${text} ${tokens[i % tokens.length] as string}`].length <= 300) text = `${text} ${tokens[i++ % tokens.length] as string}`
    expect([...text].length).toBeGreaterThan(290)
    extractVoice(text, { dictionary: names })
    const started = performance.now()
    extractVoice(text, { dictionary: names })
    expect(performance.now() - started).toBeLessThanOrEqual(500)
  })
})
