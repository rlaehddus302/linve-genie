// 화면 주소 (AC-S06-01, D-094): `/`·`/broadcasts/<id>`·`/sms`·`/buyers`·`/settlements` — 날짜·리허설·구매자는 검색값.
import { describe, expect, it } from 'vitest'
import { menuOf, parseRoute, routePath, type Route } from '../src/lib/router.ts'

describe('주소 ↔ 화면', () => {
  it.each<[string, string, Route]>([
    ['/', '', { name: 'home' }],
    ['/broadcasts/b_1', '', { name: 'console', id: 'b_1' }],
    ['/sms', '', { name: 'sms' }],
    ['/sms/', '', { name: 'sms' }],
    ['/buyers', '', { name: 'buyers', rehearsal: false }],
    ['/buyers', '?date=2026-10-18&buyer=UC_A', { name: 'buyers', date: '2026-10-18', rehearsal: false, buyer: 'UC_A' }],
    ['/settlements', '?date=2026-10-18&rehearsal=true', { name: 'settlements', date: '2026-10-18', rehearsal: true }],
    ['/settlements', '?date=어제&buyer=', { name: 'settlements', rehearsal: false }],
    ['/없는/주소', '', { name: 'home' }],
    // 요금 (N5, AC-N5-50): 휴대폰 결제 창이 돌아온 주소의 결제 ID만 읽는다
    ['/billing', '', { name: 'billing' }],
    ['/billing/', '?paymentId=pay_AB12-x&code=FAILURE&message=%EC%8B%A4%ED%8C%A8', { name: 'billing', paymentId: 'pay_AB12-x' }],
    ['/billing', '?paymentId=%3Cscript%3E', { name: 'billing' }],
  ])('%s%s', (path, search, route) => {
    expect(parseRoute(path, search)).toEqual(route)
  })

  it('새로고침·북마크해도 같은 화면 (주소 → 화면 → 주소)', () => {
    for (const url of ['/', '/broadcasts/b%2F1', '/sms', '/billing', '/billing?paymentId=pay_1', '/buyers?date=2026-10-18&buyer=UC_A', '/settlements?date=2026-10-18&rehearsal=true&buyer=sms%3Ar1']) {
      const [path, query] = url.split('?')
      expect(routePath(parseRoute(path ?? '', query === undefined ? '' : `?${query}`))).toBe(url)
    }
  })

  it('메뉴: 콘솔은 "방송"에 속한다', () => {
    expect(menuOf({ name: 'console', id: 'b1' })).toBe('broadcasts')
    expect(menuOf({ name: 'home' })).toBe('broadcasts')
    expect(menuOf({ name: 'sms' })).toBe('sms')
    expect(menuOf({ name: 'buyers', rehearsal: false })).toBe('buyers')
    expect(menuOf({ name: 'settlements', rehearsal: true })).toBe('settlements')
    expect(menuOf({ name: 'billing' })).toBe('billing')
  })
})

describe('설정의 라벨 칸 주소 (PL1B U-PL1B-06)', () => {
  it('/settings/labels ↔ 설정 화면 라벨 칸, 메뉴는 "설정"', () => {
    const route = parseRoute('/settings/labels', '')
    expect(route).toEqual({ name: 'settings', section: 'labels' })
    expect(routePath(route)).toBe('/settings/labels')
    expect(menuOf(route)).toBe(menuOf({ name: 'settings' }))
  })
})
