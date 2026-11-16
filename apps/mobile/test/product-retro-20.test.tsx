// 11월 12일 라이브 복기(docs/retro/2026-11-12-live-retro.md 6.2·9.4)에서 나온 상품 수정·추가 고침 (개선 계획표 A1·A9·F5):
// - D-RETRO-20 (A1): 가격을 고칠 때 확정된 찜이 있으면 저장 전에 한 번 묻는다 — [새 찜부터 | 찜한 손님도]. 옛: 묻지 않고 보내 "새 찜부터"가 됐다
// - D-RETRO-21 (A9): 번호를 바꾸면 그 번호의 찜이 사라진다고 먼저 묻는다 — [그대로 두기 | 바꾸기]. 지운 번호 자리는 "지운 번호예요. 이 번호로 다시 쓸까요?"
// - D-RETRO-22 (F5): 이미 있는 번호면 그 상품의 품종·가격을 같이 보여 주고 [닫기 | 그 상품 보기]
// 단추 둘은 늘 한 줄 — 부정이 왼쪽, 긍정이 오른쪽 (절대 규칙 8).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { FullView } from '@livejjim/web/src/api/types.ts'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { DUP_MORE, SAME_NUMBER_CLOSE, SAME_NUMBER_SHOW, sameNumberWords } from '../src/screens/console/ProductAdd.tsx'
import { REPRINT_HINT } from '../src/screens/console/ProductBoard.tsx'
import { EDIT_DONE, PRICE_SCOPE_ALL, PRICE_SCOPE_NEW, RENUMBER_GO, RENUMBER_KEEP, REUSE_ASK, REUSE_GO, claimedBuyers, priceScopeAsk, renumberAsk, renumberLoses, reuseNote } from '../src/screens/console/ProductEdit.tsx'
import { fromFull } from '../src/lib/scope-data.ts'
import { makeWorld, openSearchField } from './screen-support.tsx'
import { buyer, changes, claim, flush, fullView, product } from './support.ts'

type World = ReturnType<typeof makeWorld>

/** 상품뿐 아니라 찜·손님도 있는 세상 */
function worldWith(view: Partial<FullView>): World {
  const world = makeWorld({ products: view.products ?? [] })
  world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=true)?$/, () => ({ body: fullView({ seq: world.seq, ...view }) }))
  return world
}

async function open(world: World) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
}
/** 쓰기 뒤 따라잡기 — patch가 있으면 첫 쓰기 뒤부터 그 변경을 준다 */
const followWrites = (world: World, patch: Parameters<typeof changes>[2] = {}) =>
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, world.seq > 5 ? patch : {}) }))
/** 서버가 "바뀐 것 없음"으로 답하는 쓰기 (같은 번호가 이미 있을 때의 엔진) — unchanged가 참인 요청만 */
const refuseWrites = (world: World, unchanged: (body: Record<string, unknown>) => boolean) =>
  world.server.on('POST', /^\/api\/events/, (call) => {
    world.events.push(call)
    world.seq += 1
    return { body: { date: '2026-10-29', rehearsal: false, seq: world.seq, type: String(call.body?.type), changed: !unchanged(call.body ?? {}), effects: [] } }
  })
const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}
async function openDetail(world: World, no: number) {
  await open(world)
  fireEvent.click(within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: `상품 자세히 — ${String(no)}번` }))
  return screen.findByRole('group', { name: '상품 자세히' })
}
async function editField(world: World, no: number, field: '번호' | '가격', digits: string) {
  const detail = await openDetail(world, no)
  fireEvent.click(within(detail).getByRole('button', { name: `${field} 고치기` }))
  typePad(digits)
  fireEvent.click(screen.getByRole('button', { name: EDIT_DONE }))
}
const buttonNames = (root: HTMLElement) => within(root).getAllByRole('button').map((button) => button.getAttribute('aria-label'))
/** 두 단추가 같은 줄(좌우)에 있고 왼쪽이 먼저다 */
function expectSideBySide(left: HTMLElement, right: HTMLElement) {
  const row = left.parentElement?.parentElement
  expect(row).toBeTruthy()
  expect(right.parentElement?.parentElement).toBe(row)
  expect(getComputedStyle(row!).flexDirection).toBe('row')
  expect(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

const CLAIMED = {
  products: [product(15, { name: '손톱', price: 20_000, winners: ['u1'], winnerClaims: ['c1'] })],
  claims: [claim('c1', 15, 'u1', { price: 20_000, amount: 20_000 })],
  buyers: [buyer('u1', '홍길동')],
}

describe('가격 적용 범위 묻기 (D-RETRO-20, 개선 계획표 A1)', () => {
  it('확정된 찜이 있는 상품의 가격을 고치면 저장 전에 한 번 묻고, [찜한 손님도]면 그 찜에도 적용하게 보낸다', async () => {
    const world = worldWith(CLAIMED)
    followWrites(world)
    await editField(world, 15, '가격', '10000')
    const ask = await screen.findByRole('alertdialog', { name: priceScopeAsk(1) })
    expect(priceScopeAsk(1)).toBe('이미 찜한 손님 1명에게도 새 가격을 적용할까요?')
    expect(within(ask).getByText('15번 손톱 · 20,000원 → 10,000원')).toBeTruthy()
    // 부정(새 찜부터)이 왼쪽, 긍정(찜한 손님도)이 오른쪽 — 한 줄
    expect(buttonNames(ask)).toEqual([PRICE_SCOPE_NEW, PRICE_SCOPE_ALL])
    expectSideBySide(within(ask).getByRole('button', { name: PRICE_SCOPE_NEW }), within(ask).getByRole('button', { name: PRICE_SCOPE_ALL }))
    // 묻는 동안에는 아무것도 보내지 않는다
    expect(world.events).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: PRICE_SCOPE_ALL }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '15', priceText: '10000원', applyTo: 'UNPAID_CLAIMS' })
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('[새 찜부터]면 새 찜부터 적용하게 보낸다', async () => {
    const world = worldWith(CLAIMED)
    followWrites(world)
    await editField(world, 15, '가격', '10000')
    const ask = await screen.findByRole('alertdialog', { name: priceScopeAsk(1) })
    fireEvent.click(within(ask).getByRole('button', { name: PRICE_SCOPE_NEW }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '15', priceText: '10000원', applyTo: 'NEW_ONLY' })
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
  })

  it('물음 바깥을 누르면 아무것도 저장하지 않고 친 값 그대로 고치는 칸에 남는다 — 왼쪽 단추도 저장이라 바깥 누름과 같지 않다', async () => {
    const world = worldWith(CLAIMED)
    followWrites(world)
    await editField(world, 15, '가격', '10000')
    await screen.findByRole('alertdialog', { name: priceScopeAsk(1) })
    fireEvent.click(screen.getByRole('button', { name: '팝업 닫기' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await flush()
    expect(world.events).toHaveLength(0)
    expect(within(screen.getByTestId('product-edit')).getByRole('status', { name: '가격 10,000원' })).toBeTruthy()
    // 다시 [확인]을 누르면 다시 묻는다
    fireEvent.click(screen.getByRole('button', { name: EDIT_DONE }))
    expect(await screen.findByRole('alertdialog', { name: priceScopeAsk(1) })).toBeTruthy()
  })

  it('확정된 찜이 없으면 묻지 않고 바로 저장한다 (적용 범위를 싣지 않는다)', async () => {
    const world = worldWith({ products: [product(15, { price: 20_000, waitlist: [], winners: [] })] })
    followWrites(world)
    await editField(world, 15, '가격', '10000')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '15', priceText: '10000원' })
  })

  it('물을 손님 수는 확정된 찜의 손님 — 같은 손님은 한 번, 옵션 상품은 변형을 합친다', () => {
    expect(claimedBuyers(product(1))).toBe(0)
    expect(claimedBuyers(product(1, { stock: 3, winners: ['u1', 'u2', 'u1'], winnerClaims: ['c1', 'c2', 'c3'] }))).toBe(2)
  })

  it('번호와 가격을 같이 고칠 때 새 번호에서 기다리던 찜이 확정되면, 번호를 바꾼 뒤 그 손님에게도 적용할지 묻는다', async () => {
    const world = worldWith({ products: [product(15, { name: '손톱', price: 20_000 })] })
    // 번호를 바꾸는 순간 21번에서 기다리던 찜이 옛 가격으로 확정된다 (엔진 R-10)
    followWrites(world, {
      products: [product(21, { id: 'p15', name: '손톱', price: 20_000, winners: ['u9'], winnerClaims: ['c9'] })],
      claims: [claim('c9', 21, 'u9', { price: 20_000, amount: 20_000 })],
      buyers: [buyer('u9', '기다린손님')],
      removed: { broadcasts: [], products: ['b1/15'], claims: [], pending: [], buyers: [], settlements: [], effects: [], cancelRequests: [] },
    })
    const detail = await openDetail(world, 15)
    fireEvent.click(within(detail).getByRole('button', { name: '가격 고치기' }))
    typePad('10000')
    fireEvent.click(screen.getByRole('button', { name: '번호 고치기' }))
    typePad('21')
    fireEvent.click(screen.getByRole('button', { name: EDIT_DONE }))
    const ask = await screen.findByRole('alertdialog', { name: priceScopeAsk(1) })
    expect(within(ask).getByText('21번 손톱 · 20,000원 → 10,000원')).toBeTruthy()
    expect(world.events.map((event) => event.body?.type)).toEqual(['product.renumber'])
    fireEvent.click(within(ask).getByRole('button', { name: PRICE_SCOPE_ALL }))
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '21', priceText: '10000원', applyTo: 'UNPAID_CLAIMS' })
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
  })

  it('이미 뽑은 라벨이 있는 찜에 새 가격을 적용하면 창을 닫지 않고 자세히로 돌아가 "라벨 다시 인쇄"가 바로 보인다', async () => {
    const world = worldWith(CLAIMED)
    followWrites(world)
    const label = (reprintNeeded: boolean) => ({
      key: 'c1@1', claim: 'c1', version: 1, broadcast: 'b1', no: 15, buyerId: 'u1', buyer: { kind: 'youtube', name: '홍길동' },
      date: '2026-10-29', kind: 'product', state: reprintNeeded ? 'REPRINT_NEEDED' : 'PRINTED', word: reprintNeeded ? '재출력 필요' : '라벨 출력됨',
      voided: false, discard: 0, reprintNeeded, printed: 1, history: [], winner: true, data: null, canPrint: false, canReprint: true,
    })
    // 서버는 가격이 바뀐 뒤 그 라벨을 "재출력 필요"로 준다
    world.server.on('GET', /^\/api\/print\/labels/, () => ({ body: { date: '2026-10-29', labels: [label(world.events.length > 0)] } }))
    world.services.labels.start()
    const detail = await openDetail(world, 15)
    expect(await within(detail).findByRole('button', { name: '홍길동 · 라벨 다시 인쇄' })).toBeTruthy()
    // 값이 그대로일 때는 알리지 않는다
    expect(screen.queryByText(REPRINT_HINT)).toBeNull()
    fireEvent.click(within(detail).getByRole('button', { name: '가격 고치기' }))
    typePad('10000')
    fireEvent.click(screen.getByRole('button', { name: EDIT_DONE }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: priceScopeAsk(1) })).getByRole('button', { name: PRICE_SCOPE_ALL }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    // 창은 그대로 — 자세히로 돌아가 다시 인쇄 줄과 알림이 보인다
    expect(await screen.findByText(REPRINT_HINT, undefined, { timeout: 3000 })).toBeTruthy()
    const after = screen.getByRole('group', { name: '상품 자세히' })
    expect(within(after).getByRole('button', { name: '홍길동 · 라벨 다시 인쇄' })).toBeTruthy()
    expect(screen.queryByTestId('product-edit')).toBeNull()
    world.services.labels.stop()
  })
})

describe('번호 바꾸기 경고 (D-RETRO-21, 개선 계획표 A9)', () => {
  const WITH_CLAIMS = {
    products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] })],
    claims: [
      claim('c1', 15, 'u1'),
      claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11 }),
      // 보류 찜은 옛 번호에 그대로 남는다 — 사라지는 수에 넣지 않는다
      claim('c3', 15, 'u3', { status: 'PENDING', seq: 12 }),
      claim('c4', 15, 'u4', { status: 'CANCELLED', seq: 13 }),
    ],
    buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희'), buyer('u3', '박철수'), buyer('u4', '이민수')],
  }

  it('사라지는 찜은 엔진이 거절하는 확정·대기·겹침 찜만 센다', () => {
    const data = fromFull(fullView({ ...WITH_CLAIMS, claims: [...WITH_CLAIMS.claims, claim('c5', 15, 'u4', { status: 'CONFLICT', seq: 14 }), claim('c6', 16, 'u1')] }))
    expect(renumberLoses(data, WITH_CLAIMS.products[0]!)).toBe(3)
    expect(renumberLoses(fromFull(fullView({ products: [product(16)] })), product(16))).toBe(0)
  })

  it('찜이 있는 번호를 바꾸면 먼저 묻고, [그대로 두기]면 보내지 않고 번호 칸에 남으며, [바꾸기]면 번호를 바꾼다', async () => {
    const world = worldWith(WITH_CLAIMS)
    followWrites(world)
    await editField(world, 15, '번호', '21')
    const ask = await screen.findByRole('alertdialog', { name: renumberAsk(2) })
    expect(renumberAsk(2)).toBe('번호를 바꾸면 이 번호의 찜 2건이 사라져요. 바꿀까요?')
    expect(within(ask).getByText('15번 → 21번')).toBeTruthy()
    expect(buttonNames(ask)).toEqual([RENUMBER_KEEP, RENUMBER_GO])
    expectSideBySide(within(ask).getByRole('button', { name: RENUMBER_KEEP }), within(ask).getByRole('button', { name: RENUMBER_GO }))
    fireEvent.click(within(ask).getByRole('button', { name: RENUMBER_KEEP }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await flush()
    expect(world.events).toHaveLength(0)
    expect(within(screen.getByTestId('product-edit')).getByRole('status', { name: '번호 21번' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: EDIT_DONE }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: renumberAsk(2) })).getByRole('button', { name: RENUMBER_GO }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.renumber', b: 'b1', from: 15, to: 21 })
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
  })

  it('물음 바깥을 누르면 [그대로 두기]와 같다 — 보내지 않는다', async () => {
    const world = worldWith(WITH_CLAIMS)
    followWrites(world)
    await editField(world, 15, '번호', '21')
    await screen.findByRole('alertdialog', { name: renumberAsk(2) })
    fireEvent.click(screen.getByRole('button', { name: '팝업 닫기' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await flush()
    expect(world.events).toHaveLength(0)
    expect(screen.getByTestId('product-edit')).toBeTruthy()
  })

  it('지운 번호 자리로 바꾸면 "지운 번호예요. 이 번호로 다시 쓸까요?"를 묻고, [다시 쓰기]면 그 자리를 다시 쓰게 보낸다', async () => {
    const world = worldWith({ products: [product(123, { name: '수박색금', price: 50_000 }), product(333, { status: 'CLOSED' })] })
    followWrites(world)
    await editField(world, 123, '번호', '333')
    const ask = await screen.findByRole('alertdialog', { name: REUSE_ASK })
    expect(within(ask).getByText('123번 → 333번')).toBeTruthy()
    expect(buttonNames(ask)).toEqual([RENUMBER_KEEP, REUSE_GO])
    fireEvent.click(within(ask).getByRole('button', { name: REUSE_GO }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.renumber', b: 'b1', from: 123, to: 333, reuseClosed: true })
  })

  it('지운 번호 자리로 바꾸는데 [그대로 두기]면 보내지 않는다', async () => {
    const world = worldWith({ products: [product(123), product(333, { status: 'CLOSED' })] })
    followWrites(world)
    await editField(world, 123, '번호', '333')
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: REUSE_ASK })).getByRole('button', { name: RENUMBER_KEEP }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await flush()
    expect(world.events).toHaveLength(0)
  })

  it('찜도 있고 지운 번호 자리이기도 하면 한 번에 묻는다', async () => {
    const world = worldWith({ products: [product(15, { winners: ['u1'], winnerClaims: ['c1'] }), product(21, { status: 'CLOSED' })], claims: [claim('c1', 15, 'u1')], buyers: [buyer('u1', '홍길동')] })
    followWrites(world)
    await editField(world, 15, '번호', '21')
    const ask = await screen.findByRole('alertdialog', { name: renumberAsk(1) })
    expect(ask.textContent).toContain(reuseNote(21))
    fireEvent.click(within(ask).getByRole('button', { name: RENUMBER_GO }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toMatchObject({ type: 'product.renumber', from: 15, to: 21, reuseClosed: true })
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('앱이 몰랐던 지운 번호라 서버가 바꾸지 않으면, 따라잡은 뒤 다시 쓸지 묻고 [다시 쓰기]로 푼다', async () => {
    const world = worldWith({ products: [product(123)] })
    followWrites(world, { products: [product(333, { status: 'CLOSED' })] })
    refuseWrites(world, (body) => body.type === 'product.renumber' && body.reuseClosed !== true)
    await editField(world, 123, '번호', '333')
    const ask = await screen.findByRole('alertdialog', { name: REUSE_ASK })
    expect(world.events).toHaveLength(1)
    fireEvent.click(within(ask).getByRole('button', { name: REUSE_GO }))
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.renumber', b: 'b1', from: 123, to: 333, reuseClosed: true })
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
  })
})

describe('이미 있는 번호 안내 (D-RETRO-22, 개선 계획표 F5)', () => {
  it('글: 그 번호에 지금 있는 상품의 품종과 가격 — 품종이 비면 가격만', () => {
    expect(sameNumberWords({ no: 333, name: '수박색금', price: 50_000 })).toBe('지금 333번은 수박색금 50,000원이에요.')
    expect(sameNumberWords({ no: 334, name: '  ', price: 70_000 })).toBe('지금 334번은 70,000원이에요.')
  })

  it('수정: 이미 있는 번호로 바꾸려 하면 그 상품의 품종·가격과 [닫기 | 그 상품 보기]를 보이고, [그 상품 보기]면 그 상품 자세히로 간다', async () => {
    const world = worldWith({ products: [product(123, { name: '오색글래머', price: 40_000 }), product(333, { name: '수박색금', price: 50_000 })] })
    followWrites(world)
    await editField(world, 123, '번호', '333')
    const edit = screen.getByTestId('product-edit')
    expect(within(edit).getByText('333번은 이미 있어요.')).toBeTruthy()
    expect(within(edit).getByText('지금 333번은 수박색금 50,000원이에요.')).toBeTruthy()
    // [확인] 자리에 단추 둘이 한 줄로
    expect(within(edit).queryByRole('button', { name: EDIT_DONE })).toBeNull()
    expectSideBySide(within(edit).getByRole('button', { name: SAME_NUMBER_CLOSE }), within(edit).getByRole('button', { name: SAME_NUMBER_SHOW }))
    fireEvent.click(within(edit).getByRole('button', { name: SAME_NUMBER_SHOW }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    expect(within(detail).getByRole('button', { name: '번호 고치기' }).textContent).toBe('333번')
    expect(within(detail).getByRole('button', { name: '품종 고치기' }).textContent).toBe('수박색금')
    expect(screen.queryByTestId('product-edit')).toBeNull()
    expect(world.events).toHaveLength(0)
  })

  it('수정: [그 상품 보기]는 번호 검색을 풀어 상품 목록에 그 줄이 보이게 한다', async () => {
    const world = worldWith({ products: [product(123), product(333, { name: '수박색금', price: 50_000 })] })
    followWrites(world)
    await open(world)
    const rows = () => within(screen.getByRole('list', { name: '상품 목록' })).getAllByRole('button').map((row) => row.getAttribute('aria-label'))
    // D-UX4-201: 찾기 칸은 머리 돋보기를 눌러 연다(옛: 늘 보임)
    fireEvent.focus(openSearchField('상품 번호 검색'))
    typePad('12')
    // D-UX4-143으로 바뀐 기대 (옛: [검색]을 눌러 숫자판을 닫음): [검색]은 없어졌다 — 칸 밖(목록)을 눌러 숫자판을 닫는다
    fireEvent.pointerUp(screen.getByRole('list', { name: '상품 목록' }))
    expect(rows()).toEqual(['상품 자세히 — 123번'])
    fireEvent.click(screen.getByRole('button', { name: '상품 자세히 — 123번' }))
    fireEvent.click(within(await screen.findByRole('group', { name: '상품 자세히' })).getByRole('button', { name: '번호 고치기' }))
    typePad('333')
    fireEvent.click(screen.getByRole('button', { name: EDIT_DONE }))
    fireEvent.click(screen.getByRole('button', { name: SAME_NUMBER_SHOW }))
    await waitFor(() => expect(rows()).toContain('상품 자세히 — 333번'))
    // D-UX4-201: 찾는 글을 풀면 칸도 접힌다(옛: 빈 칸이 남음)
    expect(screen.queryByLabelText<HTMLInputElement>('상품 번호 검색')?.value ?? '').toBe('')
    expect(within(await screen.findByRole('group', { name: '상품 자세히' })).getByRole('button', { name: '번호 고치기' }).textContent).toBe('333번')
  })

  it('수정: [닫기]면 안내를 내리고 [확인]이 돌아오며, 다른 번호를 쳐도 돌아온다', async () => {
    const world = worldWith({ products: [product(123), product(333, { name: '수박색금', price: 50_000 })] })
    followWrites(world)
    await editField(world, 123, '번호', '333')
    const edit = screen.getByTestId('product-edit')
    fireEvent.click(within(edit).getByRole('button', { name: SAME_NUMBER_CLOSE }))
    expect(within(edit).queryByText('지금 333번은 수박색금 50,000원이에요.')).toBeNull()
    expect(within(edit).getByRole('button', { name: EDIT_DONE })).toBeTruthy()
    fireEvent.click(within(edit).getByRole('button', { name: EDIT_DONE }))
    expect(within(edit).getByRole('button', { name: SAME_NUMBER_SHOW })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('group', { name: '숫자판' })).getByRole('button', { name: '지우기' }))
    expect(within(edit).queryByRole('button', { name: SAME_NUMBER_SHOW })).toBeNull()
    expect(within(edit).getByRole('button', { name: EDIT_DONE })).toBeTruthy()
    expect(world.events).toHaveLength(0)
  })

  it('수정: 그사이 다른 쪽에서 그 번호를 올려 서버가 바꾸지 않으면, 따라잡은 그 상품을 같이 보인다', async () => {
    const world = worldWith({ products: [product(123)] })
    followWrites(world, { products: [product(333, { name: '수박색금', price: 50_000 })] })
    refuseWrites(world, (body) => body.type === 'product.renumber')
    await editField(world, 123, '번호', '333')
    const edit = screen.getByTestId('product-edit')
    expect(await within(edit).findByText('333번은 이미 있어요.')).toBeTruthy()
    expect(within(edit).getByText('지금 333번은 수박색금 50,000원이에요.')).toBeTruthy()
    expect(within(edit).getByRole('button', { name: SAME_NUMBER_SHOW })).toBeTruthy()
    expect(world.events).toHaveLength(1)
  })

  // D-DUPNO-01 (사용자 지시 2026-11-17 "중복 번호일 경우 등록이 안 되는 게 아니라 … 해당 번호로 등록할까요?"): 같은 물건을 더 올릴 수 있는 번호는 막지 않고 묻는다.
  // 그래서 옛 [닫기 | 그 상품 보기] 안내는 더 올릴 수 없는 번호(여기서는 999개를 파는 번호 — STOCK_MAX)에서만 본다. 묻는 쪽은 아래 D-DUPNO-01 묶음.
  it('추가: 더 올릴 수 없는 이미 있는 번호면 그 상품의 품종·가격과 [닫기 | 그 상품 보기]를 보이고, [그 상품 보기]면 추가 화면을 닫고 그 상품 자세히를 연다', async () => {
    const world = worldWith({ products: [product(289, { name: '로라클론', price: 60_000, stock: 999 }), product(15)] })
    followWrites(world)
    await open(world)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    typePad('289')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    expect(within(page).getByText('289번은 이미 있어요. 다른 번호를 적어 주세요.')).toBeTruthy()
    expect(within(page).getByText('지금 289번은 로라클론 60,000원이에요.')).toBeTruthy()
    expect(within(page).queryByRole('button', { name: '다음' })).toBeNull()
    expect(within(page).queryByRole('button', { name: DUP_MORE })).toBeNull()
    expectSideBySide(within(page).getByRole('button', { name: SAME_NUMBER_CLOSE }), within(page).getByRole('button', { name: SAME_NUMBER_SHOW }))
    fireEvent.click(within(page).getByRole('button', { name: SAME_NUMBER_SHOW }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull())
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    expect(within(detail).getByRole('button', { name: '번호 고치기' }).textContent).toBe('289번')
    expect(within(detail).getByRole('button', { name: '가격 고치기' }).textContent).toBe('60,000원')
    expect(world.events).toHaveLength(0)
  })

  it('추가: 더 올릴 수 없는 번호의 [닫기]나 다른 번호를 치면 [다음]이 돌아온다', async () => {
    const world = worldWith({ products: [product(15, { name: '핑크프릴', stock: 999 })] })
    await open(world)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    typePad('15')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    fireEvent.click(within(page).getByRole('button', { name: SAME_NUMBER_CLOSE }))
    expect(within(page).queryByRole('button', { name: SAME_NUMBER_SHOW })).toBeNull()
    expect(within(page).getByRole('button', { name: '다음' })).toBeTruthy()
    typePad('1')
    expect(within(page).queryByText('지금 15번은 핑크프릴 10,000원이에요.')).toBeNull()
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    expect(within(page).queryByText('151번은 이미 있어요. 다른 번호를 적어 주세요.')).toBeNull()
  })

  it('추가: [추가하기]를 누른 사이 다른 쪽에서 같은 번호를 올렸으면, 따라잡은 그 상품과 [닫기 | 그 상품 보기]를 보인다', async () => {
    const world = worldWith({ products: [product(15)] })
    followWrites(world, { products: [product(269, { name: '일월금', price: 30_000 })] })
    refuseWrites(world, (body) => body.type === 'product.register')
    await open(world)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    typePad('269')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    typePad('35000')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    fireEvent.click(within(page).getByRole('button', { name: '추가하기' }))
    expect(await within(page).findByText('269번은 이미 있어요. 다른 번호로 다시 해 주세요.')).toBeTruthy()
    expect(within(page).getByText('지금 269번은 일월금 30,000원이에요.')).toBeTruthy()
    expect(within(page).queryByRole('button', { name: '추가하기' })).toBeNull()
    expectSideBySide(within(page).getByRole('button', { name: SAME_NUMBER_CLOSE }), within(page).getByRole('button', { name: SAME_NUMBER_SHOW }))
    expect(world.events).toHaveLength(1)
  })
})
