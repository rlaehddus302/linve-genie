// AC-V3-101 엑스플랜트 유통명으로 넓힌 기본 사전 (VOC-03·R-17 5, D-V3-121).
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
const start = file.varieties.findIndex((item) => item.source === 'xplant')
// 엑스플랜트 이름 뒤에는 심폴 유통명이 이어진다(D-V3-122, v3-simpol-dictionary.test.ts) — 엑스플랜트 이름은 그 앞까지
const simpol = file.varieties.findIndex((item) => item.source === 'simpol')
const added = file.varieties.slice(start, simpol === -1 ? undefined : simpol)
const before = file.varieties.slice(0, start)
const DICT = prepareVoiceDictionary()
const nameOf = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => p.name)

describe('AC-V3-101 엑스플랜트 유통명 사전 (D-V3-121)', () => {
  it('(a) 거른 이름 869개를 데이터 끝(영수증 이름 다음)에 별칭 없이, 출처 표시 source: "xplant"', () => {
    expect(start).toBeGreaterThan(0)
    expect(added).toHaveLength(869)
    expect(before.at(-1)?.receipt).toBe(true)
    for (const item of added) {
      expect(item.source, item.name).toBe('xplant')
      expect(item.receipt, item.name).toBeUndefined()
      expect(item.aliases, item.name).toEqual([])
    }
    for (const item of before) expect(item.source, item.name).toBeUndefined()
    for (const name of ['빌로붐', '마우가니', '위트버젠스', '구갑룡', '토스카넬리', '멕시코야생마리아']) expect(added.map((item) => item.name)).toContain(name)
    expect(readFileSync(new URL('../src/default-dictionary.ts', import.meta.url), 'utf8')).toContain('엑스플랜트 유통명')
    expect(DEFAULT_VARIETIES).toHaveLength(file.varieties.length)
  })

  it('(b) 공백 뺀 2글자 이하·흔한 낱말·사람 이름·속 이름·판매 문구, 그 앞 이름(손으로 고른 이름·영수증 이름)의 더 긴 이름 앞부분은 없다', () => {
    for (const item of added) expect([...compact(item.name)].length, item.name).toBeGreaterThanOrEqual(3)
    const names = new Set(added.map((item) => compact(item.name)))
    for (const word of ['루비', '미파', '홍등', '실루엣', '사과꽃', '아이보리', '크리스마스', '도로시', '신데렐라', '코노피튬', '교배종', '씨들링', '중고화분', '몬스테라', '피델리오'])
      expect(names.has(word), word).toBe(false)
    const keys = before.flatMap((item) => [item.name, ...item.aliases]).map((form) => compact(form).toLowerCase())
    for (const item of added) {
      const key = compact(item.name).toLowerCase()
      expect(keys.some((other) => other !== key && other.startsWith(key)), item.name).toBe(false)
    }
  })

  it('(c) 모두 exactOnly — 공백만 다른 모양으로 맞고, 한 자모 다른 모양·0.8로는 맞지 않는다', () => {
    for (const item of added) expect(item.exactOnly, item.name).toBe(true)
    for (const item of DEFAULT_VARIETIES.slice(start, start + added.length)) expect(item.exactOnly, item.name).toBe(true)
    for (const item of added) expect(DEFAULT_EXACT_ONLY.has(item.name), item.name).toBe(false)
    expect(nameOf('10번 토스카넬리 5만 원')).toEqual(['토스카넬리'])
    expect(nameOf('10번 토스카 넬리 5만 원')).toEqual(['토스카넬리'])
    expect(nameOf('10번 토스카넬라 5만 원')).toEqual([null])
    expect(extractVoice('15번 토스카넬리 5만 원', { dictionary: DICT }).name).toBe('토스카넬리')
    expect(extractVoice('15번 토스카넬라 5만 원', { dictionary: DICT }).name).toBeNull()
  })

  it('(d) 이번 방송 상품 이름이 엑스플랜트 이름이면 이력 자리에서도 exactOnly (D-V3-116 (마)와 같게)', () => {
    const now = prepareVoiceDictionary({ history: ['토스카넬리'], current: ['토스카넬리'] })
    expect(extractVoice('16번 토스카넬라 5만 원', { dictionary: now }).name).toBeNull()
    expect(extractVoice('16번 토스카넬리 5만 원', { dictionary: now }).name).toBe('토스카넬리')
  })
})
