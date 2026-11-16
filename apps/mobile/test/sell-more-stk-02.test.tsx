// 같은 물건 더 팔기 (D-STK-02, 사용자 지시 2026-11-16 "동일 상품 번호에 여러 개가 있을 수 있다 … 두 명 이상이 찜하면 그 뒷사람들은 라벨을 뽑지 못한다 …
// 그 뒷사람도 라벨 뽑을 수 있도록"). 앱은 판정하지 않는다 — 엔진의 재고 변경(R-10, ORD-11)만 보낸다: 재고 +1 → 엔진이 대기 1순위를 확정(선착순 그대로)하고
// 그 손님의 라벨·감사 효과가 나온다. 묻는 팝업에 찜이 될 손님 이름을 보이고, 보내기 직전에 그 손님이 여전히 대기 1번인지 다시 본다.
// 단추 둘은 한 줄 — 부정(닫기) 왼쪽, 긍정(더 팔기) 오른쪽 (절대 규칙 8).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { SELL_MORE_CHANGED, sellFewerStock, sellMore, sellMoreDescription, sellMorePlan, stockWords } from '../src/screens/console/claim-actions.ts'
import type { ConsoleApi } from '../src/screens/console/context.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { BuyerNames } from '../src/lib/derive.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, changes, claim, flush, fullView, product } from './support.ts'

const SLOW = 60_000

/** 15번 재고 1 — 1등 홍길동, 대기 김영희·박철수 (같은 물건이 하나 더 있는데 뒷사람이 라벨을 못 뽑는 상황) */
const full = (patch: Partial<Product> = {}) =>
  product(15, { name: '핑크프릴', price: 35_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2', 'u3'], waitlistClaims: ['c2', 'c3'], confirmedUnits: 1, ...patch })

describe('같은 물건 더 팔기 방법 (D-STK-02)', () => {
  it('자리가 찼으면 재고 +1, 찜이 될 손님은 대기 1번', () => {
    expect(sellMorePlan(full())).toEqual({ stock: 2, next: 'u2' })
    expect(sellMorePlan(full({ stock: 2, winners: ['u1', 'u2'], winnerClaims: ['c1', 'c2'], waitlist: ['u3'], waitlistClaims: ['c3'], confirmedUnits: 2 }))).toEqual({ stock: 3, next: 'u3' })
  })

  it('대기가 없으면 다음에 찜하는 손님 몫 — 찜이 없을 때 미리 늘려 둘 수도 있다', () => {
    expect(sellMorePlan(full({ waitlist: [], waitlistClaims: [] }))).toEqual({ stock: 2, next: null })
    expect(sellMorePlan(product(15))).toEqual({ stock: 2, next: null })
  })

  it('하지 않는다: 옵션 상품 · 판매 종료 · 확인 중 · 가격 없음 · 겹침 · 자리가 빈 승계 결정 필요 · 상한 999', () => {
    expect(sellMorePlan(full({ hasOptions: true }))).toBeNull()
    expect(sellMorePlan(full({ status: 'CLOSED' }))).toBeNull()
    expect(sellMorePlan(full({ status: 'READY', tentative: { by: 'WORKER', reasons: ['NUMBER_SINGLE_SOURCE'], candidates: { no: [], price: [], name: [] }, seq: 1, at: '2026-10-29T11:00:00.000Z' } }))).toBeNull()
    expect(sellMorePlan(full({ price: null }))).toBeNull()
    expect(sellMorePlan(full({ conflict: true }))).toBeNull()
    // 1등이 빠져 자리가 비었고 대기 손님이 있다 — "누가 살지 정하기"·"찜으로 올리기"가 먼저
    expect(sellMorePlan(full({ status: 'OPEN', winners: [], winnerClaims: [], awaitingSuccession: true, confirmedUnits: 0 }))).toBeNull()
    expect(sellMorePlan(full({ stock: 999 }))).toBeNull()
  })

  it('하나 덜 팔기는 재고 2 이상이고 빈 자리가 있을 때만 (확정 수보다 적게 줄이지 않는다)', () => {
    expect(sellFewerStock(full())).toBeNull()
    expect(sellFewerStock(full({ stock: 2 }))).toBe(1)
    expect(sellFewerStock(full({ stock: 2, winners: ['u1', 'u2'], winnerClaims: ['c1', 'c2'], confirmedUnits: 2 }))).toBeNull()
    expect(sellFewerStock(full({ stock: 2, hasOptions: true }))).toBeNull()
  })

  it('남은 개수 말은 재고 2 이상만, 팝업 설명은 찜이 될 손님과 판매 개수', () => {
    expect(stockWords(full())).toBeNull()
    expect(stockWords(full({ stock: 3 }))).toBe('같은 물건 3개 중 2개 남음')
    expect(sellMoreDescription('김영희', 2)).toBe('대기 1번 김영희 님도 찜이 되어 라벨을 뽑을 수 있어요.\n이 번호는 같은 물건 2개를 팔아요.')
    expect(sellMoreDescription(null, 2)).toBe('다음에 찜하는 손님도 찜이 돼요.\n이 번호는 같은 물건 2개를 팔아요.')
  })

  it('보내기 직전 대기 1번이 바뀌었으면 보내지 않는다 — 다른 손님이 조용히 찜이 되지 않게', async () => {
    const sent: Record<string, unknown>[] = []
    const apiWith = (shown: Product): ConsoleApi => {
      const data = fromFull(fullView({ products: [shown], buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희'), buyer('u3', '박철수')] }))
      return {
        b: 'b1', data, names: new BuyerNames(data.buyers, data.claims), ended: false, sealed: false, select: () => {}, selected: null, labelWords: new Map(),
        command: async (event) => {
          sent.push({ ...event })
          return { date: '2026-10-29', rehearsal: false, seq: 9, type: String(event.type), changed: true, effects: [] }
        },
      }
    }
    // 그사이 김영희가 찜을 지워 박철수가 대기 1번
    await expect(sellMore(apiWith(full({ waitlist: ['u3'], waitlistClaims: ['c3'] })), full(), 'u2')).rejects.toThrow(SELL_MORE_CHANGED)
    expect(sent).toEqual([])
    await sellMore(apiWith(full()), full(), 'u2')
    expect(sent).toEqual([{ type: 'product.update', b: 'b1', no: 15, stock: 2 }])
  })
})

type World = ReturnType<typeof makeWorld>

async function open(world: World, patch: Parameters<typeof changes>[2]) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5$/, () => ({ body: changes(5, 7, patch) }))
  await act(async () => {
    world.source().emit('change', { date: '2026-10-29', rehearsal: false, seq: 7, type: 'chat' })
    await flush()
  })
  world.seq = 7
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=([7-9]|\d\d)$/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1]), world.seq, {}) }))
}

const SAMPLE = {
  products: [full()],
  claims: [
    claim('c1', 15, 'u1', { rankTime: '2026-10-29T11:00:01.000Z' }),
    claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11, rankTime: '2026-10-29T11:00:02.000Z' }),
    claim('c3', 15, 'u3', { status: 'WAITLISTED', seq: 12, rankTime: '2026-10-29T11:00:03.000Z' }),
  ],
  buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희'), buyer('u3', '박철수')],
} satisfies Parameters<typeof changes>[2]

describe('화면 (D-STK-02)', () => {
  it('상품 자세히 [같은 물건 더 팔기] → "같은 물건을 하나 더 팔까요?" 대기 1번 이름 [닫기 | 더 팔기] → 재고 2를 보낸다. [닫기]면 아무것도 보내지 않는다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, SAMPLE)
    fireEvent.click(within(await screen.findByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 15번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    // 재고 1이면 남은 개수 말·[하나 덜 팔기]는 없다
    expect(within(detail).queryByTestId('stock-left')).toBeNull()
    expect(within(detail).queryByTestId('sell-fewer')).toBeNull()
    fireEvent.click(within(detail).getByRole('button', { name: '같은 물건 더 팔기 — 15번' }))
    let ask = await screen.findByRole('alertdialog', { name: '같은 물건을 하나 더 팔까요?' })
    expect(within(ask).getByText(/^대기 1번 김영희 님도 찜이 되어 라벨을 뽑을 수 있어요\.\s+이 번호는 같은 물건 2개를 팔아요\.$/)).toBeTruthy()
    expect(within(ask).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['닫기', '더 팔기'])
    fireEvent.click(within(ask).getByRole('button', { name: '닫기' }))
    await act(async () => { await flush() })
    expect(world.events.length).toBe(0)
    fireEvent.click(within(detail).getByRole('button', { name: '같은 물건 더 팔기 — 15번' }))
    ask = await screen.findByRole('alertdialog', { name: '같은 물건을 하나 더 팔까요?' })
    fireEvent.click(within(ask).getByRole('button', { name: '더 팔기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String) as unknown, type: 'product.update', b: 'b1', no: 15, stock: 2 })
  }, SLOW)

  it('재고 2 이상이면 "같은 물건 3개 중 1개 남음"과 [하나 덜 팔기](재고 −1)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, { ...SAMPLE, products: [full({ stock: 3, status: 'OPEN', winners: ['u1', 'u2'], winnerClaims: ['c1', 'c2'], waitlist: [], waitlistClaims: [], confirmedUnits: 2 })], claims: [claim('c1', 15, 'u1'), claim('c2', 15, 'u2')] })
    fireEvent.click(within(await screen.findByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 15번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    expect(within(detail).getByTestId('stock-left').textContent).toBe('같은 물건 3개 중 1개 남음')
    fireEvent.click(within(detail).getByRole('button', { name: '하나 덜 팔기 — 15번' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String) as unknown, type: 'product.update', b: 'b1', no: 15, stock: 2 })
  }, SLOW)

  it('찜 기록의 대기 1번 손님 [이 손님에게도 팔기] → 재고 2. 대기 2번 손님에게는 없다(앞 손님이 먼저 찜이 되므로)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, SAMPLE)
    fireEvent.click(await screen.findByRole('button', { name: '찜 기록' }))
    const list = await screen.findByRole('list', { name: '찜 기록' })
    fireEvent.click(within(list).getByRole('button', { name: /^15 대기 2/ }))
    let menu = await screen.findByRole('group', { name: '찜 메뉴' })
    expect(within(menu).queryByRole('button', { name: '이 손님에게도 팔기' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(list).getByRole('button', { name: /^15 대기 1/ }))
    menu = await screen.findByRole('group', { name: '찜 메뉴' })
    fireEvent.click(within(menu).getByRole('button', { name: '이 손님에게도 팔기' }))
    const ask = await screen.findByRole('alertdialog', { name: '15번 같은 물건을 하나 더 팔까요?' })
    expect(within(ask).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['닫기', '더 팔기'])
    fireEvent.click(within(ask).getByRole('button', { name: '더 팔기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String) as unknown, type: 'product.update', b: 'b1', no: 15, stock: 2 })
  }, SLOW)
})
