// AC-V3-75 중간 결과 안정 (D-V3-71) · AC-V3-74 (d) 자동 단위 R85~R87 (D-V3-70).
import { describe, expect, it } from 'vitest'
import { interimCandidate, interimFallback, prepareVoiceDictionary, readSegments, trackInterim, type InterimSeen } from '../src/index.ts'

const DICT = prepareVoiceDictionary()
const thousand = { dictionary: DICT, priceUnit: 'THOUSAND' as const }

describe('AC-V3-75 중간 결과 안정', () => {
  it('후보: 중간 결과 "148번 280"은 최종이면 확정될 빠른 꼴 → 후보, 원 가격 짝은 후보 아님', () => {
    expect(interimCandidate('148번 280', thousand)).toEqual({ no: 148, price: 280000, name: null })
    expect(interimCandidate('148번 28만 원', thousand)).toBeNull()
    expect(interimCandidate('148번 자 회장님들', thousand)).toBeNull()
  })
  it('R89 999ms면 아직, 1,000ms면 확정', () => {
    const c = interimCandidate('148번 280', thousand)
    let seen: InterimSeen[] = []
    let r = trackInterim(seen, c, 0)
    expect(r.stable).toBeNull()
    seen = r.seen
    expect(trackInterim(seen, c, 999).stable).toBeNull()
    r = trackInterim(seen, c, 1000)
    expect(r.stable).toMatchObject({ no: 148, price: 280000, since: 0, until: 1000 })
  })
  it('R90 "148번 280"(0ms) → "148번 280만"(500ms) → 1,500ms에 2,800,000원 하나', () => {
    let seen: InterimSeen[] = []
    seen = trackInterim(seen, interimCandidate('148번 280', thousand), 0).seen
    const changed = interimCandidate('148번 280만', thousand)
    expect(changed).toEqual({ no: 148, price: 2800000, name: null })
    let r = trackInterim(seen, changed, 500)
    expect(r.stable).toBeNull()
    seen = r.seen
    expect(trackInterim(seen, changed, 1499).stable).toBeNull()
    r = trackInterim(seen, changed, 1500)
    expect(r.stable).toMatchObject({ price: 2800000 })
  })
  it('R91 800ms만 보인 후보는 최종에서 쓰지 않는다', () => {
    const c = interimCandidate('148번 280', thousand)
    let seen = trackInterim([], c, 0).seen
    seen = trackInterim(seen, c, 800).seen
    const finalPicks = readSegments('148번 자 회장님들 자국 8번 캡처 떠 주시고요 132번', { ...thousand, final: true }).picks
    expect(interimFallback(seen, finalPicks)).toBeNull()
  })
  it('R92 1,200ms 보인 후보는 최종에서 가격이 사라지면 그 후보로', () => {
    const c = interimCandidate('148번 280', thousand)
    let seen = trackInterim([], c, 0).seen
    seen = trackInterim(seen, c, 1200).seen
    const finalPicks = readSegments('148번 자 회장님들 자국 8번 캡처 떠 주시고요 132번', { ...thousand, final: true }).picks
    expect(interimFallback(seen, finalPicks)).toMatchObject({ no: 148, price: 280000 })
    // 이미 등록했거나 최종에 그 번호 가격이 있으면 쓰지 않는다
    expect(interimFallback(seen, finalPicks, [148])).toBeNull()
    expect(interimFallback(seen, readSegments('148번 30만 원', thousand).picks)).toBeNull()
  })
})

describe('AC-V3-74 (d) 자동 단위 (D-V3-70)', () => {
  const auto = { dictionary: DICT, priceUnit: 'AUTO' as const }
  it('R85 "150번 180"(최종) → 180,000원', () => {
    expect(readSegments('150번 180', { ...auto, final: true }).picks).toMatchObject([{ no: 150, price: 180000 }])
  })
  it('R86 "육십팔번 이십오"(최종) → 250,000원', () => {
    expect(readSegments('육십팔번 이십오', { ...auto, final: true }).picks).toMatchObject([{ no: 68, price: 250000 }])
  })
  it('R87 "148번 라울 280 갑니다 자" → 280,000원 (중간 결과에서도)', () => {
    expect(readSegments('148번 라울 280 갑니다 자', auto).picks).toMatchObject([{ no: 148, name: '라울', price: 280000 }])
  })
  it('단위를 붙인 말·1000 이상은 적힌 대로', () => {
    expect(readSegments('150번 6만 자', { ...auto, final: true }).picks).toMatchObject([{ price: 60000 }])
    expect(readSegments('150번 15000', { ...auto, final: true }).picks).toMatchObject([{ price: 15000 }])
  })
})
