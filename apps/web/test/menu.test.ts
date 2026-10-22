// 메뉴 정의 한 곳 (D-NAV-01, AC-NAV-01·02·08·09): 막대 앞 네 칸 → 더보기 목록 → "설정"(늘 마지막), 보조자는 한 칸
import { describe, expect, it } from 'vitest'
import { menuAll, menuLayout, menuName, type MenuInput } from '../src/lib/menu.ts'
import { routePath } from '../src/lib/router.ts'

const input = (patch: Partial<MenuInput> = {}): MenuInput => ({ route: { name: 'home' }, assistant: false, labels: true, review: null, ...patch })
const names = (items: ReturnType<typeof menuAll>) => items.map(menuName)

describe('메뉴 정의 (D-NAV-01)', () => {
  it('막대는 라벨 켬·끔, 확인 필요 수와 상관없이 앞 네 칸 그대로 — "방송"·"문자찜 입력"·"구매자"·"정산"', () => {
    for (const labels of [true, false]) {
      for (const review of [null, 0, 3, 1234]) {
        expect(names(menuLayout(input({ labels, review })).bar)).toEqual(['방송', '문자찜 입력', '구매자', '정산'])
      }
    }
  })

  it('더보기 목록은 PC 순서 그대로 — "입금 확인 N"·"포장"·"라벨"(켜짐일 때만)·"설정". 켜짐 = 꺼짐 + 1', () => {
    expect(names(menuLayout(input({ review: 1234 })).more)).toEqual(['입금 확인 1234', '포장', '라벨', '택배', '설정'])
    expect(names(menuLayout(input({ labels: false, review: 0 })).more)).toEqual(['입금 확인', '포장', '택배', '설정'])
    expect(menuLayout(input()).more.map((item) => routePath(item.to))).toEqual(['/deposits', '/packing', '/labels', '/parcels', '/settings'])
  })

  it('PC는 막대 + 목록을 한 줄로, "설정"은 늘 마지막(새 메뉴는 그 바로 앞에 들어간다)', () => {
    const all = menuAll(menuLayout(input({ review: 3 })))
    expect(names(all)).toEqual(['방송', '문자찜 입력', '구매자', '정산', '입금 확인 3', '포장', '라벨', '택배', '설정'])
    expect(all.at(-1)?.key).toBe('settings')
    expect(all.filter((item) => item.key === 'settings')).toHaveLength(1)
  })

  it('구매자·정산 사이는 고른 날짜·리허설을 잇고, 포장은 실제 날짜만 잇는다', () => {
    const real = menuLayout(input({ route: { name: 'buyers', date: '2026-10-18', rehearsal: false } }))
    expect(real.bar.map((item) => routePath(item.to))).toEqual(['/', '/sms', '/buyers?date=2026-10-18', '/settlements?date=2026-10-18'])
    expect(routePath(real.more[1]!.to)).toBe('/packing?date=2026-10-18')
    const rehearsal = menuLayout(input({ route: { name: 'settlements', date: '2026-10-18', rehearsal: true } }))
    expect(routePath(rehearsal.more[1]!.to)).toBe('/packing')
  })

  it('요금 기능이 켜지면 "요금"은 더보기 목록 끝("설정" 바로 앞)·PC도 "설정" 앞, 막대 네 칸은 그대로 (N5 AC-N5-50, AC-NAV-09)', () => {
    const on = menuLayout(input({ billing: true, review: 3 }))
    expect(names(on.bar)).toEqual(['방송', '문자찜 입력', '구매자', '정산'])
    expect(names(on.more)).toEqual(['입금 확인 3', '포장', '라벨', '요금', '택배', '설정'])
    expect(routePath(on.more.at(-3)!.to)).toBe('/billing')
    expect(names(menuAll(on))).toEqual(['방송', '문자찜 입력', '구매자', '정산', '입금 확인 3', '포장', '라벨', '요금', '택배', '설정'])
    expect(names(menuLayout(input({ billing: true, labels: false })).more)).toEqual(['입금 확인', '포장', '요금', '택배', '설정'])
    expect(names(menuLayout(input({ billing: false })).more)).toEqual(['입금 확인', '포장', '라벨', '택배', '설정'])
    expect(menuLayout(input({ assistant: true, billing: true }))).toEqual({ bar: [{ key: 'sms', label: '문자찜 입력', to: { name: 'sms' } }], more: [] })
  })

  it('보조자는 "문자찜 입력" 한 칸, 더보기 목록 없음', () => {
    const layout = menuLayout(input({ assistant: true, review: 3 }))
    expect(names(layout.bar)).toEqual(['문자찜 입력'])
    expect(layout.more).toEqual([])
  })
})
