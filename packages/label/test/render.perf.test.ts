// 렌더 속도 (AC-P1-16, AC-N1-15 — D-902): 걸린 시간을 재는 시험이라 pnpm verify(정확성)에서 빼고 pnpm perf가 돌린다.
// 30장이 모두 만들어지는지 같은 정확성 단언은 render.test.ts에 남겼다. 기준(30장 합계 6초 이내)은 P1 그대로다.
import { describe, expect, it } from 'vitest'
import { defaultTemplate, renderProductLabel } from '../src/index.ts'
import { SAMPLE_PRODUCT, nodeEnv, thirtyLabelData } from './helpers.ts'

describe('렌더 속도 (AC-P1-16)', () => {
  it('서로 다른 상품 라벨 30장 렌더 합계 6초 이내 (글꼴 등록 제외)', () => {
    const env = nodeEnv()
    const t = { ...defaultTemplate('product'), shopName: '다육농장' }
    const started = performance.now()
    for (let i = 0; i < 30; i++) expect(renderProductLabel(env, t, thirtyLabelData(i)).ok).toBe(true)
    expect(performance.now() - started).toBeLessThan(6000)
  })

  it('1만 자 품종·닉네임도 라벨이 5초 안에 나온다', () => {
    const env = nodeEnv()
    const huge = '가'.repeat(10_000)
    const started = performance.now()
    const r = renderProductLabel(env, { ...defaultTemplate('product'), shopName: huge }, { ...SAMPLE_PRODUCT, name: huge, buyer: { kind: 'youtube', name: `${huge} ${huge}` } })
    expect(performance.now() - started).toBeLessThan(5000)
    expect(r.ok).toBe(true)
  })
})
