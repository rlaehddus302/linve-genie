// AC-P2-08 골든 러너 연결 (D-209): 러너 계약이 suite voice-extract를 알고, 러너·어댑터가 packages/voice 추출기를 부른다.
// 일부러 틀린 추출기(고유어 번호·천원 단위·사전 밖 말·음절 유사도)가 실제 골든에서 각각 불일치로 실패하는지 본다.
// 코어 영역 시험 코드다(dev-device가 최소로 더함 — harness/sprints/P2/dev-notes.md). 코어 src는 음성 패키지에 기대지 않는다.
import { NotImplementedError, parseAmount, parseKoreanNumber, type SettingsOverride } from '@livejjim/core'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { prepareDictionary } from '../../../voice/src/dictionary.ts'
import { extractVoice, readingForms, type VoiceExtraction } from '../../../voice/src/extract.ts'
import { realCore } from './core-adapter.ts'
import { createFakeCore } from './fake-core.ts'
import { runGoldenSources } from './runner.ts'
import { run, suiteDoc } from './test-helpers.ts'
import type { GoldenCore, ParserItemResult } from './types.ts'

const GOLDEN_DIR = fileURLToPath(new URL('../../../../tests/golden', import.meta.url))
const VOICE_FILE = 'parser/voice-extract.yaml'

type Extractor = (text: string, settings: SettingsOverride, dictionary: readonly string[]) => unknown
const real: Extractor = (text, settings, dictionary) => extractVoice(text, { maxNumber: settings['claim.maxNumber'], dictionary })
const withExtractor = (voiceExtract: Extractor): GoldenCore => ({ ...realCore, parser: { ...realCore.parser, voiceExtract } })

/**
 * 실제 골든의 voice-extract 파일만 돌린다 (다른 suite·시나리오는 voiceExtract를 부르지 않는다 — 전체 골든 합계는 core-adapter.test.ts가 본다).
 * 같은 프로젝트의 시간 재는 시험(engine-timing)과 겹쳐 돌므로 전체 골든을 되풀이해 돌리지 않는다.
 */
function voiceItems(core: GoldenCore): { readonly items: ParserItemResult[]; readonly readErrors: number } {
  const report = runGoldenSources({
    files: [{ path: VOICE_FILE, text: readFileSync(`${GOLDEN_DIR}/${VOICE_FILE}`, 'utf8') }],
    allowlist: { path: 'known-unimplemented.yaml', text: null },
    core,
    goldenLabel: 'tests/golden',
  })
  const items = report.items.filter((item): item is ParserItemResult => item.kind === 'parser' && item.suite === 'voice-extract')
  return { items, readErrors: report.readErrors.length }
}

const mismatches = (core: GoldenCore): string[] =>
  voiceItems(core)
    .items.filter((item) => item.status !== 'pass')
    .map((item) => `${item.status}:${item.input}`)

describe('AC-P2-08 러너가 voice-extract를 안다', () => {
  // I4(AC-I4-95): 끊어 말한 번호 12사례(D-I4-01)가 더해져 69 → 81 (골든이 늘어서 하는 교체 — 약화 아님, harness/sprints/I4/dev-notes.md)
  // V3(D-V3-22 (c)): 원 가격 줄·자리 읽기·'번' 없는 번호·실제 방송 사례가 더해져 81 → 179 (골든이 늘어서 하는 교체 — 약화 아님)
  it('실제 추출기로 voice-extract 179사례가 모두 통과하고 파일은 parser/voice-extract.yaml', () => {
    const { items, readErrors } = voiceItems(realCore)
    expect(readErrors).toBe(0)
    expect(items).toHaveLength(179)
    expect(items.every((item) => item.status === 'pass' && item.file === VOICE_FILE)).toBe(true)
  })

  it('러너는 사례마다 maxNumber 설정과 사전 사본을 넘긴다 — 추출기가 사전을 바꿔도 다음 사례에 번지지 않는다', () => {
    const calls: { text: string; settings: SettingsOverride; dictionary: readonly string[] }[] = []
    const core = createFakeCore({
      parser: {
        voiceExtract: (text, settings, dictionary) => {
          calls.push({ text, settings, dictionary: [...dictionary] })
          ;(dictionary as string[]).push('바뀐 이름')
          return { no: null, name: null, price: null, confidence: 'LOW' }
        },
      },
    })
    const report = run(
      suiteDoc('voice-extract', [
        { in: '하나', out: { confidence: 'LOW' } },
        { in: '둘', out: { confidence: 'LOW' } },
      ], { maxNumber: 50, dictionary: ['라울', '핑크 프릴'] }),
      { core },
    )
    expect(report.totals.pass).toBe(2)
    expect(calls).toEqual([
      { text: '하나', settings: { 'claim.maxNumber': 50 }, dictionary: ['라울', '핑크 프릴'] },
      { text: '둘', settings: { 'claim.maxNumber': 50 }, dictionary: ['라울', '핑크 프릴'] },
    ])
  })

  it('사전을 적지 않으면 빈 목록, maxNumber를 적지 않으면 설정 없음(추출기 기본 999)', () => {
    const seen: unknown[] = []
    const core = createFakeCore({ parser: { voiceExtract: (_t, settings, dictionary) => (seen.push([settings, dictionary]), { no: null, name: null, price: null, confidence: 'LOW' }) } })
    run(suiteDoc('voice-extract', [{ in: 'x', out: { confidence: 'LOW' } }]), { core })
    expect(seen).toEqual([[{}, []]])
  })

  it('비교: 네 값이 모두 같아야 통과 — 적지 않은 no·name·price는 null, 다른 키가 있거나 키가 빠지면 불일치', () => {
    const results: Record<string, unknown> = {
      exact: { no: 15, name: '라울', price: 5000, confidence: 'HIGH' },
      nulls: { no: null, name: null, price: null, confidence: 'LOW' },
      extra: { no: null, name: null, price: null, confidence: 'LOW', score: 0.3 },
      missing: { no: null, name: null, confidence: 'LOW' },
      undefinedValue: { no: undefined, name: null, price: null, confidence: 'LOW' },
      wrongConfidence: { no: 15, name: '라울', price: 5000, confidence: 'LOW' },
      notObject: 'LOW',
    }
    const core = createFakeCore({ parser: { voiceExtract: (text) => results[text] } })
    const cases = [
      { in: 'exact', out: { no: 15, name: '라울', price: 5000, confidence: 'HIGH' } },
      { in: 'nulls', out: { confidence: 'LOW' } },
      { in: 'nulls', out: { no: null, name: null, price: null, confidence: 'LOW' } },
      { in: 'extra', out: { confidence: 'LOW' } },
      { in: 'missing', out: { confidence: 'LOW' } },
      { in: 'undefinedValue', out: { confidence: 'LOW' } },
      { in: 'wrongConfidence', out: { no: 15, name: '라울', price: 5000, confidence: 'HIGH' } },
      { in: 'notObject', out: { confidence: 'LOW' } },
    ]
    const report = run(suiteDoc('voice-extract', cases), { core })
    expect(report.items.map((item) => item.status)).toEqual(['pass', 'pass', 'pass', 'mismatch', 'mismatch', 'mismatch', 'mismatch', 'mismatch'])
    const problemPaths = report.items.map((item) => item.problems.map((p) => p.path))
    expect(problemPaths.slice(3)).toEqual([['out.score'], ['out.price'], ['out.no'], ['out.confidence'], ['out']])
  })

  it('미구현을 알리는 추출기는 미구현 — 허용 목록 suite 이름에 voice-extract를 쓸 수 있다', () => {
    const core = createFakeCore({
      parser: {
        voiceExtract: () => {
          throw new NotImplementedError('음성 추출')
        },
      },
    })
    const text = suiteDoc('voice-extract', [{ in: '15번', out: { no: 15, confidence: 'LOW' } }])
    expect(run(text, { core }).totals.notImplementedDisallowed).toBe(1)
    const allowed = run(text, { core, allowlist: 'sprint: P2\nsuites: [voice-extract]\n' })
    expect(allowed.readErrors).toEqual([])
    expect(allowed.totals.notImplementedAllowed).toBe(1)
    expect(allowed.ok).toBe(true)
  })
})

// ── 일부러 틀린 추출기 ───────────────────────────────────────────────────

const words = (text: string): string[] => text.trim().split(/\s+/).filter((w) => w !== '')

/** 번호에 고유어를 받는 추출기: `한 번`·`열다섯 번`을 번호로 읽는다 (R-15 그대로 — D-202 ①) */
const nativeNumbers: Extractor = (text, settings, dictionary) => {
  const result = real(text, settings, dictionary) as VoiceExtraction
  if (result.no !== null) return result
  const tokens = words(text)
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (tokens[i + 1] !== '번') continue
    const value = parseKoreanNumber(tokens[i] as string)
    if (value !== null) return { ...result, no: value }
  }
  return result
}

/** 가격을 천원 단위로 읽는 추출기: 숫자만 있는 말을 price.unit=THOUSAND로 읽는다 (D-202 ①) */
const thousandUnit: Extractor = (text, settings, dictionary) => {
  const result = real(text, settings, dictionary) as VoiceExtraction
  if (result.price !== null) return result
  for (const token of words(text)) {
    if (!/^[0-9]+$/.test(token)) continue
    const value = parseAmount(token, { 'price.unit': 'THOUSAND' })
    if (value !== null && value >= 100) return { ...result, price: value }
  }
  return result
}

/** 사전 밖 말을 품종으로 넣는 추출기: 품종을 못 찾으면 번호·금액이 아닌 첫 말을 품종으로 (D-203 ①) */
const outsideWords: Extractor = (text, settings, dictionary) => {
  const result = real(text, settings, dictionary) as VoiceExtraction
  if (result.name !== null) return result
  const word = words(text).find((token) => !/[0-9번원만천백십]/.test(token))
  return word === undefined ? result : { ...result, name: word }
}

/** 음절 편집 거리 */
function syllableDistance(a: string, b: string): number {
  const x = [...a]
  const y = [...b]
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const next = [i]
    for (let j = 1; j <= y.length; j++) next[j] = Math.min((prev[j] as number) + 1, (next[j - 1] as number) + 1, (prev[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1))
    prev = next
  }
  return prev[y.length] as number
}

/** 유사도를 음절 단위로 재는 추출기 (D-203 ①): 1 − 음절 거리 ÷ 긴 쪽 음절 수 ≥ 0.8 */
const syllableSimilarity: Extractor = (text, settings, dictionary) => {
  const result = real(text, settings, dictionary) as VoiceExtraction
  const entries = prepareDictionary(dictionary).entries
  const tokens = words(text)
  let best: { name: string; score: number; exact: boolean } | null = null
  for (let s = 0; s < tokens.length; s++) {
    for (let e = s; e < Math.min(tokens.length, s + 4); e++) {
      for (const form of readingForms(tokens[e] as string)) {
        const window = tokens.slice(s, e).join('') + form
        for (const entry of entries) {
          const length = Math.max([...window].length, [...entry.key].length)
          const distance = syllableDistance(window, entry.key)
          if (distance * 5 > length) continue
          const score = 1 - distance / length
          if (best === null || score > best.score) best = { name: entry.name, score, exact: distance === 0 }
        }
      }
    }
  }
  const name = best?.name ?? null
  const confidence = result.no !== null && result.price !== null && name !== null && best?.exact === true ? 'HIGH' : 'LOW'
  return { ...result, name, confidence }
}

describe('AC-P2-08 일부러 틀린 추출기는 골든에서 불일치로 실패한다', () => {
  it.each([
    ['번호에 고유어를 받는 것', nativeNumbers, ['mismatch:한 번 더 보여 드릴게요', 'mismatch:열다섯 번 핑크프릴 만원']],
    ['가격을 천원 단위로 읽는 것', thousandUnit, ['mismatch:15번 핑크프릴 10']],
    ['사전 밖 말을 품종으로 넣는 것', outsideWords, ['mismatch:15번 벨루 만원', 'mismatch:15번 로나 만원']],
    ['유사도를 음절 단위로 재는 것', syllableSimilarity, ['mismatch:15번 핑크푸릴 만원', 'mismatch:15번 나울 오천 원']],
  ] as const)('%s', (_label, extractor, expectedFailures) => {
    const failures = mismatches(withExtractor(extractor))
    expect(failures.length).toBeGreaterThan(0)
    for (const failure of expectedFailures) expect(failures).toContain(failure)
  })

  it('실제 추출기는 불일치가 없다', () => {
    expect(mismatches(withExtractor(real))).toEqual([])
  })
})
