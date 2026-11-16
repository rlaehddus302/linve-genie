// 라이브 합치기 (D-MERGE-LIVE-01~04, 판매자 요청 2026-11-17 "하루에 1차, 2차 이렇게 끊어서 방송하는 경우도 있기 때문에 나중에 정산할 때 정보가 파편화됨")
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { BroadcastItem } from '@livejjim/web/src/api/types.ts'
import { broadcastSales, statementRows } from '../src/lib/broadcast-sales.ts'
import { clearCached } from '../src/lib/cached-get.ts'
import { markBuyerSent, sentBuyers } from '../src/lib/statement-info.ts'
import {
  EARLIER_TITLE, MERGE_OTHER_DAY, earlierSent, markScopeSent, mergedNote, siblingsNote, statementScope, toggleMergePick, type BroadcastGroup,
} from '../src/lib/broadcast-groups.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { sendGroups } from '../src/screens/console/statement-send.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { AllBroadcastsScreen, MERGED_DONE } from '../src/screens/BroadcastList.tsx'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST, BROADCAST_VIEW, buyer, claim, fullView, product } from './support.ts'

const DAY = '2026-10-29'
const item = (id: string, patch: Partial<BroadcastItem> = {}): BroadcastItem => ({ ...BROADCAST, id, ended: true, endedAt: '2026-10-29T12:00:00.000Z', ...patch })
const GROUP: BroadcastGroup = { id: 'g1', date: DAY, broadcasts: ['b1', 'b2'] }

/** 1차(b1)·2차(b2) 모두 12번을 판 날 — 손님 A는 두 라이브에서, 손님 B는 2차에서만 */
function twoLives() {
  const products = [product(12, { name: '창금', price: 30000 }), { ...product(12, { name: '왕색금', price: 50000 }), key: 'b2/12', id: 'q12', broadcast: 'b2' }]
  const claims = [
    claim('c1', 12, 'A', { amount: 30000 }),
    { ...claim('c2', 12, 'A', { amount: 50000 }), product: 'b2/12', key: 'b2/12', productId: 'q12', broadcast: 'b2' },
    { ...claim('c3', 13, 'B', { amount: 20000 }), product: 'b2/13', key: 'b2/13', productId: 'q13', broadcast: 'b2' },
  ]
  const extra = { ...product(13, { name: '방울복랑', price: 20000 }), key: 'b2/13', id: 'q13', broadcast: 'b2' }
  return fullView({
    broadcasts: [{ ...BROADCAST_VIEW, ended: true, endedAt: '2026-10-29T12:00:00.000Z' }, { ...BROADCAST_VIEW, id: 'b2', title: '밤 방송', ended: true, endedAt: '2026-10-29T14:00:00.000Z' }],
    products: [...products, extra], claims, buyers: [buyer('A', '가을여행'), buyer('B', '나오미다육')],
  })
}

beforeEach(() => clearCached())

describe('합친 정산서 셈 (순수 함수)', () => {
  it('합친 라이브는 같은 손님을 한 주문으로 모으고, 번호가 같은 상품은 1차·2차로 따로 둔다', () => {
    const data = fromFull(twoLives())
    const single = broadcastSales(data.claims, data.products, 'b1')
    expect(single.total).toBe(30000)
    expect(single.lines[0]!.round).toBeUndefined()
    const merged = broadcastSales(data.claims, data.products, ['b1', 'b2'])
    expect(merged.total).toBe(100000)
    expect(merged.buyers).toBe(2)
    expect(merged.orders.find((order) => order.id === 'A')).toMatchObject({ qty: 2, subtotal: 80000 })
    expect(merged.lines.map((line) => [line.round, line.no, line.name])).toEqual([['1차', 12, '창금'], ['2차', 12, '왕색금'], ['2차', 13, '방울복랑']])
    expect(statementRows(merged, 'products', (id) => id).map((row) => row.round)).toEqual(['1차', '2차', '2차'])
  })

  it('정산서 범위: 묶인 라이브는 묶음 전체, 묶음을 받기 전에는 보내기를 막는다', () => {
    expect(statementScope(null, 'b1')).toMatchObject({ broadcasts: ['b1'], ready: false })
    expect(statementScope([], 'b1')).toMatchObject({ key: 'b1', broadcasts: ['b1'], lead: 'b1', group: null, ready: true })
    expect(statementScope([GROUP], 'b2')).toMatchObject({ key: 'group:g1:b1+b2', broadcasts: ['b1', 'b2'], lead: 'b1', ready: true })
  })

  it('고르기: 끝난 라이브만, 다른 날을 누르면 그 줄 하나로 새로 고른다', () => {
    const items = [item('b1'), item('b2'), item('b3', { date: '2026-10-30' }), item('b4', { ended: false })]
    expect(toggleMergePick(items, [], 'b1').picked).toEqual(['b1'])
    expect(toggleMergePick(items, ['b1'], 'b2').picked).toEqual(['b1', 'b2'])
    expect(toggleMergePick(items, ['b1', 'b2'], 'b1').picked).toEqual(['b2'])
    expect(toggleMergePick(items, ['b1', 'b2'], 'b3')).toEqual({ picked: ['b3'], otherDay: true })
    expect(toggleMergePick(items, ['b1'], 'b4').picked).toEqual(['b1'])
  })

  it('먼저 받은 정산서: 합치기 전에 1차 정산서를 받은 손님은 합친 정산서에서 "먼저 받음", 커진 묶음·나눈 뒤에도 알린다', () => {
    markBuyerSent('b1', 'A')
    const merged = statementScope([GROUP], 'b1')
    expect(earlierSent(merged)).toEqual(['A'])
    // 합친 정산서를 B에게 보냄 → 이 정산서에서는 "보냄", 1차 하나만의 정산서에서는 "먼저 받음"
    markScopeSent(merged, 'B')
    expect(sentBuyers(merged.key)).toEqual(['B'])
    expect(earlierSent(merged)).toEqual(['A'])
    expect(earlierSent(statementScope([], 'b2'))).toEqual(['B'])
    // 3차를 더해 묶음 모습이 바뀌면 B도 "먼저 받음"(1·2차만 받았다)
    const grown = statementScope([{ ...GROUP, broadcasts: ['b1', 'b2', 'b3'] }], 'b1')
    expect(sentBuyers(grown.key)).toEqual([])
    expect([...earlierSent(grown)].sort()).toEqual(['A', 'B'])
    // 모두에게 보내기 차례에서 빼고 따로 묶는다
    const rows = [{ key: 'A', no: null, label: 'A', money: 1, qty: 1 }, { key: 'C', no: null, label: 'C', money: 1, qty: 1 }]
    const groups = sendGroups(rows, null, true, earlierSent(merged))
    expect(groups.sendable.map((row) => row.key)).toEqual(['C'])
    expect(groups.blocked).toEqual([{ reason: 'earlier', rows: [rows[0]] }])
  })
})

describe('정산서 화면', () => {
  function world(groups: BroadcastGroup[]) {
    const w = makeWorld()
    w.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [item('b1'), item('b2', { endedAt: '2026-10-29T14:00:00.000Z' })] } }))
    w.server.on('GET', /^\/api\/days\/2026-10-29$/, () => ({ body: twoLives() }))
    w.server.on('GET', /\/order-shop$/, () => ({ body: { name: '용용다육' } }))
    w.server.on('GET', /^\/api\/broadcast-groups$/, () => ({ body: { groups } }))
    return w
  }

  it('합친 라이브면 2차 손님 줄까지 한 정산서에 보이고, [나누기]를 확인하면 묶음을 나눈다', async () => {
    const w = world([GROUP])
    let split = 0
    w.server.on('POST', /^\/api\/broadcast-groups\/g1\/split$/, () => { split++; return { body: { ok: true } } })
    render(w.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await screen.findByText(mergedNote(2))
    expect(screen.getByText('1차 · 2차를 합친 정산서예요')).toBeTruthy()
    // 구매자별: A는 두 라이브 합계 80,000원 한 줄
    expect(screen.getByRole('button', { name: /^가을여행 정산서 · 80,000원 · 2개/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^나오미다육 정산서 · 20,000원/ })).toBeTruthy()
    expect(screen.getByTestId('statement-total').textContent).toContain('100,000원')
    // 상품별: 같은 12번이 1차·2차로 나뉜다
    fireEvent.click(screen.getByRole('button', { name: '상품별' }))
    const list = screen.getByRole('list', { name: '상품별 정산' })
    expect(within(list).getByText('1차 12번')).toBeTruthy()
    expect(within(list).getByText('2차 12번')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '나누기' }))
    const ask = await screen.findByRole('dialog', { name: '합친 라이브를 나눌까요?' })
    // 단추는 좌우: 왼쪽 취소 · 오른쪽 나누기
    const buttons = within(ask).getAllByRole('button').map((button) => button.textContent)
    expect(buttons.indexOf('취소')).toBeLessThan(buttons.indexOf('나누기'))
    w.server.on('GET', /^\/api\/broadcast-groups$/, () => ({ body: { groups: [] } }))
    fireEvent.click(within(ask).getByRole('button', { name: '나누기' }))
    await waitFor(() => expect(split).toBe(1))
    await waitFor(() => expect(screen.queryByText(mergedNote(2))).toBeNull())
    expect(w.server.callsTo('POST', /split$/)[0]!.body).toMatchObject({ requestId: expect.any(String) })
  })

  it('합치지 않았으면 이 라이브만 보이고, 같은 날 라이브가 더 있다고 알려 [합치기]로 바로 합친다', async () => {
    const w = world([])
    w.server.on('POST', /^\/api\/broadcast-groups$/, () => ({ body: { group: GROUP } }))
    render(w.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await screen.findByText(siblingsNote(1))
    expect(screen.getByRole('button', { name: /^가을여행 정산서 · 30,000원 · 1개/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /나오미다육 정산서/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '합치기' }))
    const sheet = await screen.findByRole('dialog', { name: '라이브 합치기' })
    // 같은 날 라이브가 미리 골라져 있다
    expect(within(sheet).getAllByRole('checkbox').map((box) => box.getAttribute('aria-checked'))).toEqual(['true', 'true'])
    w.server.on('GET', /^\/api\/broadcast-groups$/, () => ({ body: { groups: [GROUP] } }))
    fireEvent.click(within(sheet).getByRole('button', { name: '2개 합치기' }))
    await screen.findByText(mergedNote(2))
    expect(w.server.callsTo('POST', /^\/api\/broadcast-groups$/)[0]!.body).toMatchObject({ broadcasts: ['b1', 'b2'] })
    expect(screen.getByRole('button', { name: /^가을여행 정산서 · 80,000원/ })).toBeTruthy()
  })

  it('합치기 전에 1차 정산서를 받은 손님은 합친 정산서에서 "먼저 받은 정산서가 있어요"로 알린다', async () => {
    markBuyerSent('b1', 'A')
    const w = world([GROUP])
    render(w.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    fireEvent.click(await screen.findByRole('button', { name: /^가을여행 정산서/ }))
    expect((await screen.findByTestId('statement-earlier')).textContent).toContain(EARLIER_TITLE)
  })
})

describe('지난 라이브 [합치기]', () => {
  it('같은 날 라이브를 골라 합치고, 다른 날을 고르면 까닭을 알린다. 합친 줄에는 "합침 · 1차" 꼬리표', async () => {
    const w = makeWorld()
    const items = [item('b1'), item('b2'), item('b3', { date: '2026-10-30' })]
    w.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: items } }))
    w.server.on('GET', /^\/api\/broadcast-groups$/, () => ({ body: { groups: [] } }))
    w.server.on('POST', /^\/api\/broadcast-groups$/, () => ({ body: { group: GROUP } }))
    render(w.wrap(<AllBroadcastsScreen onOpen={() => {}} onBack={() => {}} now={Date.parse('2026-10-31T00:00:00Z')} />))
    fireEvent.click(await screen.findByRole('button', { name: '합치기' }))
    const sheet = await screen.findByRole('dialog', { name: '라이브 합치기' })
    const confirm = () => within(sheet).getByRole('button', { name: /합치기$/ })
    fireEvent.click(within(sheet).getByTestId('merge-pick-b1'))
    fireEvent.click(within(sheet).getByTestId('merge-pick-b3'))
    expect(within(sheet).getByText(MERGE_OTHER_DAY)).toBeTruthy()
    expect(within(sheet).getByTestId('merge-pick-b3').getAttribute('aria-checked')).toBe('true')
    expect(within(sheet).getByTestId('merge-pick-b1').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(sheet).getByTestId('merge-pick-b1'))
    fireEvent.click(within(sheet).getByTestId('merge-pick-b2'))
    expect(confirm().textContent).toBe('2개 합치기')
    w.server.on('GET', /^\/api\/broadcast-groups$/, () => ({ body: { groups: [GROUP] } }))
    fireEvent.click(confirm())
    await screen.findByText(MERGED_DONE)
    expect(w.server.callsTo('POST', /^\/api\/broadcast-groups$/)[0]!.body).toMatchObject({ broadcasts: ['b1', 'b2'] })
    await waitFor(() => expect(screen.getByTestId('merged-b1').textContent).toBe('합침 · 1차'))
    expect(screen.getByTestId('merged-b2').textContent).toBe('합침 · 2차')
    expect(screen.queryByTestId('merged-b3')).toBeNull()
  })
})
