// O3 다육 회귀 (test-domain, AC-O3-30 (1), CMT-07): 옵션 없는 수량 1만 있는 무작위 판매(STRICT 방송 셋 — 같은 날 둘 + 다음 날 하나,
// 취소·직접 배정·합치기·입금·가격 바꾸기·문자찜·HTML/수식 모양 닉네임·빈 품종·9999번·0원·99,999,000원)의 결과가
// O3 전(BASE 커밋 src)과 같다: 상품 라벨 데이터·내용 키·그림 해시, 포장 라벨 데이터(label-data·packing 두 경로)·내용 키·쪽마다 그림 해시,
// 한 사람·전원 확인서 데이터, 판매대장 행과 열 값. 고정값 fixtures/base-strict.json은 gen-base.ts로 BASE src에서 만들었다.
// D-STB-01(기본 상품 템플릿 날짜 칸 x 292→290 · 폭 88→90, 계약 교체): BASE는 지우지 않고, 지금 코드에서 그 두 값만 옛 값으로
// 되돌린 기본 템플릿(revertedLabel)으로 그리면 BASE 전부와 같아야 한다. 새 기본 템플릿으로 달라진 상품 라벨 그림 해시만
// fixtures/base-strict-stb.json(gen-stb.ts)에 새 고정값으로 더한다 — 라벨 데이터·내용 키·포장·확인서·대장 비교는 그대로다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as labelData from '../../../apps/server/src/label-data.ts'
import * as packing from '../../../apps/server/src/packing.ts'
import * as documents from '@livejjim/documents'
import * as label from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { STRICT_SEEDS, play, snapshot, strictScenario, type Mods } from './scenarios.ts'
import { revertedLabel, type StbFixture } from './stb.ts'

const BASE = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'base-strict.json'), 'utf8')) as Record<string, unknown>
const STB = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'base-strict-stb.json'), 'utf8')) as StbFixture
const mods: Mods = { labelData, packing, label, documents, env: createNodeRenderEnv() }
/** D-STB-01 전 기본 템플릿(날짜 칸 두 값만 되돌림)으로 그리는 모듈 */
const beforeStb: Mods = { ...mods, label: revertedLabel(label) }

/** 지금 기본 템플릿의 고정값: BASE에 D-STB-01로 달라진 상품 라벨 그림 해시만 바꿔 넣은 것 */
function expectedNow(seed: number): unknown {
  const base = structuredClone(BASE[String(seed)]) as { product: Record<string, { image: unknown }> }
  for (const [id, image] of Object.entries(STB[String(seed)] ?? {})) {
    const entry = base.product[id]
    if (entry === undefined) throw new Error(`씨앗 ${String(seed)}: BASE에 없는 찜 ${id}`)
    entry.image = image
  }
  return base
}

describe('AC-O3-30 (1) 다육만 있는 판매의 라벨·포장·확인서·대장은 O3 전과 같다', () => {
  it('고정값은 씨앗 40개이고 확정 찜·묶음·대장 행이 충분히 있다', () => {
    expect(Object.keys(BASE)).toHaveLength(STRICT_SEEDS.length)
    let claims = 0
    let bundles = 0
    for (const value of Object.values(BASE)) {
      const s = value as { product: object; packing: object }
      claims += Object.keys(s.product).length
      bundles += Object.keys(s.packing).length
    }
    expect(claims).toBeGreaterThan(200)
    expect(bundles).toBeGreaterThan(100)
  })

  for (const seed of STRICT_SEEDS) {
    it(`씨앗 ${String(seed)}: 옛 기본 템플릿(D-STB-01 전 날짜 칸)으로 그리면 BASE와 모두 같다`, () => {
      const before = JSON.parse(JSON.stringify(snapshot(play(strictScenario(seed)).state, beforeStb))) as unknown
      expect(before).toEqual(BASE[String(seed)])
    })
    it(`씨앗 ${String(seed)}: 지금 기본 템플릿은 BASE + D-STB-01 새 그림 해시와 같다`, () => {
      const now = JSON.parse(JSON.stringify(snapshot(play(strictScenario(seed)).state, mods))) as unknown
      expect(now).toEqual(expectedNow(seed))
    })
  }

  it('D-STB-01 새 고정값은 씨앗 40개 모두에 있고, 확정 찜의 상품 라벨 그림 해시만 바꾼다(모두 옛 값과 다른 실제 그림 해시)', () => {
    expect(Object.keys(STB).sort()).toEqual(STRICT_SEEDS.map(String).sort())
    let changed = 0
    for (const seed of STRICT_SEEDS) {
      const base = BASE[String(seed)] as { product: Record<string, { image: unknown }> }
      for (const [id, image] of Object.entries(STB[String(seed)] ?? {})) {
        expect(base.product[id], `${String(seed)} ${id}`).toBeDefined()
        expect(image).toMatch(/^[0-9a-f]{24}$/)
        expect(image).not.toBe(base.product[id]?.image)
        changed++
      }
    }
    expect(changed).toBeGreaterThan(200)
  })

  it('다육만 있는 판매에서는 상품 라벨 데이터가 다섯 칸, 포장 항목은 모두 정수, 대장 행에 옵션 칸이 없다', () => {
    for (const seed of STRICT_SEEDS) {
      const s = snapshot(play(strictScenario(seed)).state, mods)
      for (const v of Object.values(s.product) as { data: Record<string, unknown> | null }[]) {
        expect(v.data).not.toBeNull()
        expect(Object.keys(v.data ?? {}).sort()).toEqual(['buyer', 'date', 'name', 'no', 'price'])
      }
      for (const v of Object.values(s.packing) as { labelData: { data: label.PackingLabelData } }[]) {
        for (const b of v.labelData.data.broadcasts) for (const n of b.numbers) expect(typeof n).toBe('number')
      }
      const ledger = s.ledger as { rows: Record<string, unknown>[]; values: unknown[][] }
      for (const row of ledger.rows) expect(Object.hasOwn(row, 'qty') || Object.hasOwn(row, 'variant') || Object.hasOwn(row, 'unitPrice')).toBe(false)
      for (const values of ledger.values) expect(values).toHaveLength(11)
    }
  })
})
