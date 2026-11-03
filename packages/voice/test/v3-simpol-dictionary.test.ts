// AC-V3-102 심폴 유통명으로 넓힌 기본 사전 (VOC-03·R-17 5, D-V3-122).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_EXACT_ONLY } from '../src/default-dictionary.ts'
import { compact, DEFAULT_VARIETIES, extractVoice, prepareVoiceDictionary, readSegments } from '../src/index.ts'

interface Entry {
  readonly name: string
  readonly aliases: readonly string[]
  readonly exactOnly?: boolean
  readonly receipt?: boolean
  readonly source?: string
}
const file = JSON.parse(readFileSync(new URL('../data/varieties.ko.json', import.meta.url), 'utf8')) as { varieties: Entry[] }
const start = file.varieties.findIndex((item) => item.source === 'simpol')
const added = file.varieties.slice(start)
const before = file.varieties.slice(0, start)
const DICT = prepareVoiceDictionary()
const nameOf = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => p.name)

describe('AC-V3-102 심폴 유통명 사전 (D-V3-122)', () => {
  it('(a) 거른 이름 128개를 데이터 끝(엑스플랜트 이름 다음)에 별칭 없이, 출처 표시 source: "simpol"', () => {
    expect(start).toBeGreaterThan(0)
    expect(added).toHaveLength(128)
    expect(before.at(-1)?.source).toBe('xplant')
    for (const item of added) {
      expect(item.source, item.name).toBe('simpol')
      expect(item.receipt, item.name).toBeUndefined()
      expect(item.aliases, item.name).toEqual([])
    }
    for (const name of ['목기린', '패리도트', '괴룡환', '헤르난데지', '귀갑난봉옥', '소인의모자']) expect(added.map((item) => item.name)).toContain(name)
    expect(readFileSync(new URL('../src/default-dictionary.ts', import.meta.url), 'utf8')).toContain('심폴 유통명')
    expect(DEFAULT_VARIETIES).toHaveLength(file.varieties.length)
  })

  it('(b) 공백 뺀 2글자 이하·다육 아닌 식물·꾸밈 말·흔한 낱말, 그 앞 이름(엑스플랜트 포함)과 같거나 그 더 긴 이름 앞부분은 없다', () => {
    for (const item of added) expect([...compact(item.name)].length, item.name).toBeGreaterThanOrEqual(3)
    const names = new Set(added.map((item) => compact(item.name)))
    for (const word of ['님의향기', '초록색꽃', '예쁜꽃', '대통령', '파리지옥', '쟈스민', '용설란', '팅거벨', '랑콤뷰티', '꽃향기독특한', '금전수', '호야', '꽃기린'])
      expect(names.has(word), word).toBe(false)
    const keys = before.flatMap((item) => [item.name, ...item.aliases]).map((form) => compact(form).toLowerCase())
    for (const item of added) {
      const key = compact(item.name).toLowerCase()
      expect(keys.some((other) => other.startsWith(key)), item.name).toBe(false)
    }
  })

  it('(c) 모두 exactOnly — 공백만 다른 모양으로 맞고, 한 자모 다른 모양·0.8로는 맞지 않는다', () => {
    for (const item of added) expect(item.exactOnly, item.name).toBe(true)
    for (const item of DEFAULT_VARIETIES.slice(start)) expect(item.exactOnly, item.name).toBe(true)
    for (const item of added) expect(DEFAULT_EXACT_ONLY.has(item.name), item.name).toBe(false)
    expect(nameOf('10번 헤르난데지 5만 원')).toEqual(['헤르난데지'])
    expect(nameOf('10번 헤르난 데지 5만 원')).toEqual(['헤르난데지'])
    expect(nameOf('10번 헤르난데즈 5만 원')).toEqual([null])
    expect(extractVoice('15번 헤르난데지 5만 원', { dictionary: DICT }).name).toBe('헤르난데지')
    expect(extractVoice('15번 헤르난데즈 5만 원', { dictionary: DICT }).name).toBeNull()
  })

  it('(d) 이번 방송 상품 이름이 심폴 이름이면 이력 자리에서도 exactOnly (D-V3-116 (마)와 같게)', () => {
    const now = prepareVoiceDictionary({ history: ['헤르난데지'], current: ['헤르난데지'] })
    expect(extractVoice('16번 헤르난데즈 5만 원', { dictionary: now }).name).toBeNull()
    expect(extractVoice('16번 헤르난데지 5만 원', { dictionary: now }).name).toBe('헤르난데지')
  })
})
