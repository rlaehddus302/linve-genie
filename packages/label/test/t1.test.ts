// AC-T1-44 (라벨 쪽): 운송장(100×150mm)은 라벨 크기가 아니다 — 라벨 패키지 크기 목록은 T1에서 그대로다(PARCEL_RULES PC-7, D-T1-10).
import { describe, expect, it } from 'vitest'
import { ALL_LABEL_SIZES, LABEL_SIZES, PACKING_LABEL_SIZES, isLabelSize } from '../src/index.ts'

describe('AC-T1-44 B1으로 운송장을 찍지 않는다 (라벨 패키지)', () => {
  it('크기 목록이 T1 전과 같다', () => {
    expect([...ALL_LABEL_SIZES]).toEqual(['50x30', '50x20', '50x40', '50x15', '50x50', 'tape12x40', 'tape15x30', 'tape15x50'])
    expect([...LABEL_SIZES]).toEqual(['50x30', '50x20', '50x40'])
    expect([...PACKING_LABEL_SIZES]).toEqual(['50x30', '50x20', '50x40', '50x50'])
  })
  it('운송장 크기는 라벨 크기로 받지 않는다', () => {
    for (const size of ['100x150', '150x100', 'waybill']) expect(isLabelSize(size)).toBe(false)
  })
})
