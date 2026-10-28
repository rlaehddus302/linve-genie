// AC-V3-100 (a)~(d) 판매자 제공 판매 영수증 거래명 사전 (R-17 5, D-V3-115). 성능 (e)는 receipt-dictionary.perf.test.ts(pnpm perf).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compact, DEFAULT_VARIETIES, prepareVoiceDictionary, readSegments } from '../src/index.ts'

interface Entry {
  readonly name: string
  readonly aliases: readonly string[]
  readonly exactOnly?: boolean
}
const file = JSON.parse(readFileSync(new URL('../data/varieties.ko.json', import.meta.url), 'utf8')) as { varieties: Entry[] }
// 영수증 거래명은 데이터 끝에 이어 붙였다 — 그 앞 마지막 이름은 실방송 3회 영수증의 '황소'
const start = file.varieties.findIndex((item) => item.name === '황소') + 1
const added = file.varieties.slice(start)
const DICT = prepareVoiceDictionary()
const nameOf = (text: string) => readSegments(text, { dictionary: DICT, final: true, maxNumber: 999 }).picks.map((p) => p.name)

describe('AC-V3-100 영수증 거래명 사전 (D-V3-115)', () => {
  it('(a) 거른 이름 681개를 별칭 없이 이름으로, 출처 표기는 판매자 제공 판매 영수증 거래명', () => {
    expect(start).toBeGreaterThan(0)
    expect(added).toHaveLength(681)
    for (const item of added) expect(item.aliases, item.name).toEqual([])
    for (const name of ['SP색금', '슈빌', '보스실생', '퍼플마리아 금', '환엽마리아', '몰디브색금', '녹금철화']) expect(added.map((item) => item.name)).toContain(name)
    expect(readFileSync(new URL('../src/default-dictionary.ts', import.meta.url), 'utf8')).toContain('판매자 제공 판매 영수증 거래명')
    expect(DEFAULT_VARIETIES).toHaveLength(file.varieties.length)
  })

  it('(b) 지금 이름과 공백 뺀 모양(로마자 대소문자 무시)이 같은 것·흔한 말 하나뿐인 것·화분·크기 같은 일반 낱말은 없다', () => {
    const keys = file.varieties.map((item) => compact(item.name).toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
    const names = new Set(file.varieties.map((item) => item.name))
    for (const word of ['환엽', '돌기', '핏줄', '쪽빛', '골드빛', '골드', '크랙', '손톱', '수박', '복륜금', '군생', '특이종', '교배종', '수입종', '명품', '순수', '아래', '이름표', '접시', '망치', '사각롱분', '핀셋 소형', '색금 자구'])
      expect(names.has(word), word).toBe(false)
  })

  it('(c) 이번에 더한 공백 뺀 2글자 이름은 모두 exactOnly — 한 자모 다른 말로는 맞지 않는다', () => {
    const two = added.filter((item) => [...compact(item.name)].length === 2)
    expect(two.length).toBeGreaterThan(0)
    for (const item of two) expect(item.exactOnly, item.name).toBe(true)
    for (const item of added.filter((entry) => [...compact(entry.name)].length > 2)) expect(item.exactOnly, item.name).toBeUndefined()
    expect(nameOf('10번 슈빌 5만 원')).toEqual(['슈빌'])
    // 슈빌 ↔ 슈발(한 자모 차이)은 맞추지 않는다
    expect(nameOf('10번 슈발 5만 원')).toEqual([null])
  })

  it('긴 거래명은 들린 대로 맞는다', () => {
    expect(nameOf('10번 퍼플마리아 금 5만 원')).toEqual(['퍼플마리아 금'])
    expect(nameOf('10번 환엽마리아 5만 원')).toEqual(['환엽마리아'])
  })
})
