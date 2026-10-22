// O3 다육 회귀 (test-domain, AC-O3-30 (1), CMT-07): 옵션 없는 수량 1만 있는 무작위 판매(STRICT 방송 셋 — 같은 날 둘 + 다음 날 하나,
// 취소·직접 배정·합치기·입금·가격 바꾸기·문자찜·HTML/수식 모양 닉네임·빈 품종·9999번·0원·99,999,000원)의 결과가
// O3 전(BASE 커밋 src)과 같다: 상품 라벨 데이터·내용 키·그림 해시, 포장 라벨 데이터(label-data·packing 두 경로)·내용 키·쪽마다 그림 해시,
// 한 사람·전원 확인서 데이터, 판매대장 행과 열 값. 고정값 fixtures/base-strict.json은 gen-base.ts로 BASE src에서 만들었다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as labelData from '../../../apps/server/src/label-data.ts'
import * as packing from '../../../apps/server/src/packing.ts'
import * as documents from '@livejjim/documents'
import * as label from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { STRICT_SEEDS, play, snapshot, strictScenario, type Mods } from './scenarios.ts'

const BASE = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'base-strict.json'), 'utf8')) as Record<string, unknown>
const mods: Mods = { labelData, packing, label, documents, env: createNodeRenderEnv() }

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
    it(`씨앗 ${String(seed)}`, () => {
      const now = JSON.parse(JSON.stringify(snapshot(play(strictScenario(seed)).state, mods))) as unknown
      expect(now).toEqual(BASE[String(seed)])
    })
  }

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
