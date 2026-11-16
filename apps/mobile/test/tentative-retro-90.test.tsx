// 확인 중(임시 등록) 상품 (11월 12일 라이브 복기 5.3·6.3, 개선 계획표 A2·C2, 계약서 docs/retro/tentative-contract.md 3절):
// - D-RETRO-90: 상품 목록의 "확인 중" 줄, 방송 화면 확인 카드 — 번호·금액 후보를 좌우 단추로 한 번 탭 확정, 후보가 없으면 [거두기 | 이대로 확정]
// - D-RETRO-91: 상품 자세히·수정창 — [판매 시작]·[상품 삭제] 자리에 확정·거두기, 수정창 저장은 [이 값으로 확정]
// - D-RETRO-92: 확인 중 상품이 있는 번호를 상품 추가에서 치면 친 값으로 확정
// 단추 둘은 늘 한 줄 — 부정이 왼쪽, 긍정이 오른쪽. 후보끼리는 지금 값(일꾼이 따른 쪽)이 오른쪽 (절대 규칙 8).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TENTATIVE_REASONS } from '@livejjim/core'
import type { Changes, FullView, Product } from '@livejjim/web/src/api/types.ts'
import { describe, expect, it } from 'vitest'
import { fromFull } from '../src/lib/scope-data.ts'
import { REASON_UNKNOWN, TENTATIVE_TAG, confirmEvent, isTentative, needsPrice, otherNumbers, otherPrices, reasonLine, tentativeAttention, tentativeProducts, waitingAt, withdrawEvent } from '../src/lib/tentative.ts'
import { PRICE_WAITING, priceWords } from '../src/lib/words.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ConsoleContext, type ConsoleApi } from '../src/screens/console/context.ts'
import { ASK_ADD, ASK_CONFIRM_HELD, CONFIRM_HELD, heldWords } from '../src/screens/console/ProductAdd.tsx'
import { EDIT_CONFIRM, EDIT_DONE, PRICE_NEEDED } from '../src/screens/console/ProductEdit.tsx'
import { ASK_PRICE, ASK_WHICH_NUMBER, ASK_WHICH_PRICE, CARD_GUARD_MS, CONFIRM_AS_IS, PICK_NUMBER_AGAIN, TENTATIVE_EDIT, TENTATIVE_REGION, TentativeCards, WITHDRAW, WITHDRAW_ASK, WITHDRAW_CLOSE, WITHDRAW_NOTE, WRITE_PRICE, WRITE_PRICE_ABOVE, numberTaken } from '../src/screens/console/TentativeCard.tsx'
import { BuyerNames } from '../src/lib/derive.ts'
import { makeWorld } from './screen-support.tsx'
import { buyer, changes, claim, flush, fullView, product } from './support.ts'

type World = ReturnType<typeof makeWorld>
type Mark = NonNullable<Product['tentative']>

const mark = (patch: Partial<Mark> = {}): Mark => ({ by: 'WORKER', reasons: ['NUMBER_SINGLE_SOURCE'], candidates: { no: [], price: [], name: [] }, seq: 4, at: '2026-10-29T11:00:00.000Z', ...patch })
/** 확인 중 상품: 상태는 공개 전이고 확인 중 표시가 붙는다 */
const held = (no: number, tentative: Partial<Mark> = {}, patch: Partial<Product> = {}) => product(no, { status: 'READY', tentative: mark(tentative), ...patch })
const waiting = (id: string, no: number, buyerId: string, seq: number) => claim(id, no, buyerId, { status: 'PENDING', productId: null, price: null, amount: null, confirmVersion: null, seq })
const slot = (no: number, claims: string[], buyers: string[]) => ({ product: `b1/${String(no)}`, broadcast: 'b1', no, buyers, claims })

function worldWith(view: Partial<FullView>): World {
  const world = makeWorld({ products: view.products ?? [] })
  world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=true)?$/, () => ({ body: fullView({ seq: world.seq, ...view }) }))
  return world
}
/** 쓰기 뒤 따라잡기 — 지금까지 보낸 이벤트로 바뀐 것을 돌려준다 */
const follow = (world: World, patch: (events: readonly Record<string, unknown>[]) => Partial<Changes> = () => ({})) =>
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, world.seq > 5 ? patch(world.events.map((event) => event.body ?? {})) : {}) }))
const removedOnly = (keys: string[]): Changes['removed'] => ({ broadcasts: [], products: keys, claims: [], pending: [], buyers: [], settlements: [], effects: [], cancelRequests: [] })
/** 서버가 "바뀐 것 없음"으로 답하는 쓰기 */
const refuse = (world: World, unchanged: (body: Record<string, unknown>) => boolean) =>
  world.server.on('POST', /^\/api\/events/, (call) => {
    world.events.push(call)
    world.seq += 1
    return { body: { date: '2026-10-29', rehearsal: false, seq: world.seq, type: String(call.body?.type), changed: !unchanged(call.body ?? {}), effects: [] } }
  })
async function open(world: World) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
}
const card = () => screen.getByRole('region', { name: TENTATIVE_REGION })
const bigButtons = (root: HTMLElement) => within(root).getAllByRole('button').map((button) => button.textContent)
/** 두 단추가 같은 줄(좌우)에 있고 왼쪽이 먼저다 */
function expectSideBySide(left: HTMLElement, right: HTMLElement) {
  const row = left.parentElement?.parentElement
  expect(row).toBeTruthy()
  expect(right.parentElement?.parentElement).toBe(row)
  expect(getComputedStyle(row!).flexDirection).toBe('row')
  expect(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}
const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

/** 334번(색금 20,000원)이 번호 후보 333·334로 확인 중이고, 333번으로 찜 둘이 기다린다 — 복기 5.3 */
const MISMATCH: Partial<FullView> = {
  products: [held(334, { reasons: ['NUMBER_MISMATCH', 'PRICE_SINGLE_SOURCE'], candidates: { no: [334, 333], price: [20_000], name: ['색금'] } }, { name: '색금', price: 20_000 })],
  claims: [waiting('c1', 333, 'u1', 12), waiting('c2', 333, 'u2', 13)],
  pending: [slot(333, ['c1', 'c2'], ['u1', 'u2'])],
  buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희')],
}

describe('확인 중 상품의 낱말 (D-RETRO-90)', () => {
  it('까닭 낱말은 쉬운 문장으로만 — 코어가 아는 낱말 모두에 문장이 있고 영어 낱말이 그대로 나가지 않는다', () => {
    for (const word of Object.values(TENTATIVE_REASONS)) {
      const line = reasonLine({ by: 'WORKER', reasons: [word] })
      expect(line, word).not.toBe(REASON_UNKNOWN)
      expect(line, word).not.toMatch(/[A-Z_]{3,}/)
    }
    expect(reasonLine({ by: 'WORKER', reasons: ['NUMBER_MISMATCH'] })).toBe('말한 번호와 번호표가 달라요')
    expect(reasonLine({ by: 'WORKER', reasons: ['PRICE_DISAGREE'] })).toBe('가격이 두 가지로 들렸어요')
    // 번호만 들려 가격 없이 올린 것 (D-RECOG-31)
    expect(reasonLine({ by: 'WORKER', reasons: ['PRICE_MISSING', 'NAME_UNSURE'] })).toBe('가격을 아직 못 들었어요 · 품종을 확인해 주세요')
    // 둘까지, 값이 갈린 것이 앞
    expect(reasonLine({ by: 'WORKER', reasons: ['PRICE_SINGLE_SOURCE', 'NAME_UNSURE', 'NUMBER_MISMATCH'] })).toBe('말한 번호와 번호표가 달라요 · 가격을 한 번만 확인했어요')
  })

  it('모르는 낱말(일꾼이 새로 더한 것)은 "확인이 필요해요", 다른 계정에서 온 것은 그렇게 적고 기다리는 찜은 수로 따로 보이므로 뺀다', () => {
    expect(reasonLine({ by: 'WORKER', reasons: ['SOMETHING_NEW'] })).toBe('확인이 필요해요')
    expect(reasonLine({ by: 'WORKER', reasons: [] })).toBe('확인이 필요해요')
    expect(reasonLine({ by: 'WORKER', reasons: ['SOMETHING_NEW', 'PRICE_DISAGREE'] })).toBe('가격이 두 가지로 들렸어요')
    expect(reasonLine({ by: 'SYNC', reasons: ['OTHER_ACCOUNT', 'PENDING_CLAIMS'] })).toBe('다른 계정에서 넣은 상품이에요')
    expect(reasonLine({ by: 'SYNC', reasons: ['NUMBER_MISMATCH'] })).toBe('다른 계정에서 넣은 상품이에요 · 말한 번호와 번호표가 달라요')
    expect(reasonLine({ by: 'WORKER', reasons: ['PENDING_CLAIMS'] })).toBe('기다리는 손님이 있어요')
  })

  it('후보는 지금 값을 빼고 겹치지 않게 셋까지, 확인 중 상품은 먼저 올라온 것부터', () => {
    const item = held(334, { candidates: { no: [334, 333, 333, 0, 335, 336, 337], price: [20_000, 200_000, 20_000], name: [] } }, { price: 20_000 })
    expect(otherNumbers(item)).toEqual([333, 335, 336])
    expect(otherPrices(item)).toEqual([200_000])
    expect(otherNumbers(product(5))).toEqual([])
    const data = fromFull(fullView({
      products: [held(20, { seq: 9 }), held(10, { seq: 7 }), product(30), product(40, { tentative: mark(), status: 'OPEN' }), held(50, { seq: 1 }, { broadcast: 'b2', key: 'b2/50' })],
      pending: [slot(10, ['c1', 'c2'], ['u1', 'u2'])],
    }))
    expect(tentativeProducts(data, 'b1').map((item2) => item2.no)).toEqual([10, 20])
    expect(waitingAt(data, 'b1', 10)).toBe(2)
    expect(waitingAt(data, 'b1', 20)).toBe(0)
    expect(isTentative(product(30))).toBe(false)
    expect(tentativeAttention(held(10), 2)).toEqual({ who: '확인 중', what: '· 기다리는 찜 2건 · 눌러서 확정하기' })
    expect(tentativeAttention(held(10), 0)).toEqual({ who: '확인 중', what: '· 눌러서 확정하기' })
    expect(tentativeAttention(product(30), 3)).toBeNull()
  })

  it('확정은 판매자가 본 값 그대로 — 옮길 번호만 to로, 가격·품종은 본 값을 적는다. 거두기는 번호만', () => {
    const item = held(334, {}, { name: '색금', price: 20_000 })
    expect(confirmEvent(item)).toEqual({ type: 'product.confirm', b: 'b1', no: 334, price: 20_000, name: '색금' })
    expect(confirmEvent(item, { no: 333 })).toEqual({ type: 'product.confirm', b: 'b1', no: 334, to: 333, price: 20_000, name: '색금' })
    expect(confirmEvent(item, { no: 334, price: 200_000 })).toEqual({ type: 'product.confirm', b: 'b1', no: 334, price: 200_000, name: '색금' })
    expect(confirmEvent(held(7, {}, { name: ' ' }))).toEqual({ type: 'product.confirm', b: 'b1', no: 7, price: 10_000 })
    expect(withdrawEvent(item)).toEqual({ type: 'product.withdraw', b: 'b1', no: 334 })
  })
})

describe('상품 목록의 확인 중 표시 (D-RETRO-90)', () => {
  it('확인 중 상품 줄에 "확인 중"과 기다리는 찜 수가 보이고, 영어 상태값·까닭 낱말은 화면 어디에도 없다', async () => {
    await open(worldWith({ ...MISMATCH, claims: [...(MISMATCH.claims ?? []), waiting('c3', 334, 'u1', 14)], pending: [...(MISMATCH.pending ?? []), slot(334, ['c3'], ['u1'])] }))
    const row = within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 334번' })
    // D-UX4-207로 바뀐 기대 (사용자 "확인 중 눌러서 확정하기 이런 말 뜨는데 그런거 빨갛게 띄우지 말고, ... 애니메이션으로 넣어줘"; 옛 D-RETRO-90: 주황 글 "확인 중 · 기다리는 찜 1건 · 눌러서 확정하기"):
    // 줄에는 글 대신 … 점 셋, 읽어 주기는 그 문장 그대로. 주황 바탕도 없다
    expect(within(row).queryByText(TENTATIVE_TAG)).toBeNull()
    expect(within(row).getByRole('img', { name: `${TENTATIVE_TAG} · 기다리는 찜 1건 · 눌러서 확정하기` })).toBeTruthy()
    expect(getComputedStyle(within(row).getByTestId('product-row-fill')).backgroundColor).toBe('rgb(255, 255, 255)')
    const all = screen.getByTestId('console-screen').textContent ?? ''
    for (const raw of ['tentative', 'TENTATIVE', 'READY', 'NUMBER_MISMATCH', 'PRICE_SINGLE_SOURCE', 'WORKER', 'SYNC', '임시']) expect(all, raw).not.toContain(raw)
  })

  it('손으로 올린 공개 전 상품(확인 중 표시 없음)은 지금 그대로 — 줄에 표시가 없고 자세히에 [판매 시작]이 있어 product.open을 보낸다', async () => {
    const world = worldWith({ products: [product(15, { status: 'READY' })] })
    follow(world)
    await open(world)
    expect(screen.queryByRole('region', { name: TENTATIVE_REGION })).toBeNull()
    const row = within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 15번' })
    expect(within(row).queryByText(TENTATIVE_TAG)).toBeNull()
    fireEvent.click(row)
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '판매 시작 — 15번' }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.open', b: 'b1', no: 15 })
    expect(within(detail).getByRole('button', { name: '상품 삭제 — 15번' })).toBeTruthy()
  })
})

describe('방송 화면 확인 카드 (D-RETRO-90, 개선 계획표 C2)', () => {
  it('번호 후보가 둘이면 좌우 단추로 — 지금 번호가 오른쪽, 번호마다 기다리는 찜 수. 다른 번호를 한 번 누르면 그 번호로 확정을 보낸다', async () => {
    const world = worldWith(MISMATCH)
    follow(world, () => ({ products: [product(333, { id: 'p334', name: '색금', price: 20_000 })], removed: removedOnly(['b1/334']) }))
    await open(world)
    const box = card()
    expect(within(box).getByText(TENTATIVE_TAG)).toBeTruthy()
    expect(within(box).getByTestId('tentative-values').textContent).toBe('334번 색금 20,000원')
    expect(within(box).getByRole('note').textContent).toBe('말한 번호와 번호표가 달라요 · 가격을 한 번만 확인했어요')
    expect(within(box).getByText(ASK_WHICH_NUMBER)).toBeTruthy()
    const left = within(box).getByRole('button', { name: '333번으로 확정' })
    const right = within(box).getByRole('button', { name: '334번으로 확정' })
    expect(left.textContent).toBe('333번 · 찜 2건')
    expect(right.textContent).toBe('334번')
    expectSideBySide(left, right)
    // 닉네임은 그리지 않는다
    expect(box.textContent).not.toContain('홍길동')
    // 탭 바·목록보다 아래(화면 아래쪽)
    expect(screen.getByTestId('console-list').compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(left)
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 334, to: 333, price: 20_000, name: '색금' })
    await waitFor(() => expect(screen.queryByRole('region', { name: TENTATIVE_REGION })).toBeNull())
  })

  it('지금 번호(오른쪽)를 누르면 번호를 옮기지 않고 확정한다', async () => {
    const world = worldWith(MISMATCH)
    follow(world, () => ({ products: [product(334, { name: '색금', price: 20_000 })] }))
    await open(world)
    fireEvent.click(within(card()).getByRole('button', { name: '334번으로 확정' }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 334, price: 20_000, name: '색금' })
    await waitFor(() => expect(screen.queryByRole('region', { name: TENTATIVE_REGION })).toBeNull())
  })

  it('금액 후보가 둘이면 같은 방식 — 지금 값이 오른쪽, 한 번 누르면 그 금액으로 확정', async () => {
    const world = worldWith({ products: [held(305, { reasons: ['PRICE_DISAGREE'], candidates: { no: [305], price: [35_000, 350_000], name: [] } }, { name: '', price: 35_000 })] })
    follow(world, () => ({ products: [product(305, { name: '', price: 350_000 })] }))
    await open(world)
    const box = card()
    expect(within(box).getByTestId('tentative-values').textContent).toBe('305번 35,000원')
    expect(within(box).getByText(ASK_WHICH_PRICE)).toBeTruthy()
    const left = within(box).getByRole('button', { name: '350,000원으로 확정' })
    const right = within(box).getByRole('button', { name: '35,000원으로 확정' })
    expectSideBySide(left, right)
    fireEvent.click(left)
    await waitFor(() => expect(world.events).toHaveLength(1))
    // 품종이 비어 있으면 적지 않는다
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 305, price: 350_000 })
  })

  it('번호와 금액이 둘 다 갈리면 번호 → 금액 차례로 묻고 한 번에 보낸다 — 탭 둘, 요청 하나. [번호 다시]로 되돌아간다', async () => {
    const world = worldWith({ products: [held(334, { reasons: ['NUMBER_MISMATCH', 'PRICE_DISAGREE'], candidates: { no: [334, 333], price: [20_000, 200_000], name: [] } }, { name: '색금', price: 20_000 })] })
    follow(world, () => ({ products: [product(333, { id: 'p334', name: '색금', price: 200_000 })], removed: removedOnly(['b1/334']) }))
    await open(world)
    const box = card()
    expect(within(box).getByText(ASK_WHICH_NUMBER)).toBeTruthy()
    fireEvent.click(within(box).getByRole('button', { name: '333번 고르기' }))
    // 번호만 골랐을 때는 아무것도 보내지 않는다
    expect(world.events).toHaveLength(0)
    expect(within(box).getByText(ASK_WHICH_PRICE)).toBeTruthy()
    expect(within(box).getByTestId('tentative-values').textContent).toBe('333번 색금 20,000원')
    fireEvent.click(within(box).getByRole('button', { name: PICK_NUMBER_AGAIN }))
    expect(within(box).getByText(ASK_WHICH_NUMBER)).toBeTruthy()
    fireEvent.click(within(box).getByRole('button', { name: '333번 고르기' }))
    expectSideBySide(within(box).getByRole('button', { name: '200,000원으로 확정' }), within(box).getByRole('button', { name: '20,000원으로 확정' }))
    fireEvent.click(within(box).getByRole('button', { name: '200,000원으로 확정' }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 334, to: 333, price: 200_000, name: '색금' })
  })

  it('후보가 없으면 왼쪽 [거두기] · 오른쪽 [이대로 확정] 한 줄', async () => {
    const world = worldWith({ products: [held(313, { by: 'SYNC', reasons: ['OTHER_ACCOUNT', 'PENDING_CLAIMS'], candidates: { no: [313], price: [10_000], name: ['빅뱅'] } }, { name: '빅뱅', price: 10_000 })], claims: [waiting('c1', 313, 'u1', 12)], pending: [slot(313, ['c1'], ['u1'])], buyers: [buyer('u1', '홍길동')] })
    follow(world, () => ({ products: [product(313, { name: '빅뱅', price: 10_000 })] }))
    await open(world)
    const box = card()
    expect(within(box).getByRole('note').textContent).toBe('다른 계정에서 넣은 상품이에요 · 기다리는 찜 1건')
    const withdraw = within(box).getByRole('button', { name: `${WITHDRAW} — 313번` })
    const go = within(box).getByRole('button', { name: `${CONFIRM_AS_IS} — 313번` })
    expect(withdraw.textContent).toBe('거두기')
    expect(go.textContent).toBe('이대로 확정')
    expectSideBySide(withdraw, go)
    expect(within(box).queryByText(ASK_WHICH_NUMBER)).toBeNull()
    fireEvent.click(go)
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 313, price: 10_000, name: '빅뱅' })
  })

  it('[거두기]는 먼저 묻는다 — 왼쪽 [닫기] · 오른쪽 [거두기]. [닫기]면 아무것도 보내지 않고, [거두기]면 product.withdraw를 보낸다', async () => {
    const world = worldWith({ products: [held(313, {}, { name: '빅뱅', price: 10_000 })] })
    follow(world, () => ({ removed: removedOnly(['b1/313']) }))
    await open(world)
    fireEvent.click(within(card()).getByRole('button', { name: `${WITHDRAW} — 313번` }))
    const ask = await screen.findByRole('alertdialog', { name: WITHDRAW_ASK })
    expect(WITHDRAW_ASK).toBe('이 상품을 거둘까요?')
    expect(ask.textContent).toContain(`313번 빅뱅 10,000원\n${WITHDRAW_NOTE}`)
    expect(WITHDRAW_NOTE).toBe('기다리는 찜은 그대로 남아요.')
    expect(bigButtons(ask)).toEqual([WITHDRAW_CLOSE, WITHDRAW])
    expectSideBySide(within(ask).getByRole('button', { name: WITHDRAW_CLOSE }), within(ask).getByRole('button', { name: WITHDRAW }))
    fireEvent.click(within(ask).getByRole('button', { name: WITHDRAW_CLOSE }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(world.events).toHaveLength(0)
    fireEvent.click(within(card()).getByRole('button', { name: `${WITHDRAW} — 313번` }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: WITHDRAW_ASK })).getByRole('button', { name: WITHDRAW }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.withdraw', b: 'b1', no: 313 })
    await waitFor(() => expect(screen.queryByRole('region', { name: TENTATIVE_REGION })).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('후보가 있는 카드의 [거두기]는 머리의 작은 단추 — [거두기] 왼쪽 · [고치기] 오른쪽 한 줄', async () => {
    await open(worldWith(MISMATCH))
    const box = card()
    const withdraw = within(box).getByRole('button', { name: `${WITHDRAW} — 334번` })
    const edit = within(box).getByRole('button', { name: `${TENTATIVE_EDIT} — 334번` })
    expect(withdraw.parentElement).toBe(edit.parentElement)
    expect(getComputedStyle(withdraw.parentElement!).flexDirection).toBe('row')
    expect(withdraw.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('서버가 "바뀐 것 없음"이면(그사이 일꾼·다른 기기가 확정) 잘못 글 없이 카드를 닫고 따라잡은 상태를 보인다', async () => {
    const world = worldWith({ products: [held(313, {}, { name: '빅뱅', price: 10_000 })] })
    refuse(world, () => true)
    // 그사이 다른 쪽이 30,000원으로 확정했다
    follow(world, () => ({ products: [product(313, { name: '빅뱅', price: 30_000 })] }))
    await open(world)
    fireEvent.click(within(card()).getByRole('button', { name: `${CONFIRM_AS_IS} — 313번` }))
    await waitFor(() => expect(screen.queryByRole('region', { name: TENTATIVE_REGION })).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
    const row = within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 313번' })
    expect(within(row).getByText('30,000원')).toBeTruthy()
    expect(within(row).queryByText(TENTATIVE_TAG)).toBeNull()
  })

  it('바뀐 것이 없는데 아직 확인 중이면(옮길 번호에 그사이 상품이 생김) 그 까닭을 알리고 카드를 그대로 둔다', async () => {
    const world = worldWith(MISMATCH)
    refuse(world, () => true)
    follow(world, () => ({ products: [product(333, { name: '수박색금', price: 50_000 })] }))
    await open(world)
    fireEvent.click(within(card()).getByRole('button', { name: '333번으로 확정' }))
    expect((await within(card()).findByRole('alert')).textContent).toBe(numberTaken(333))
    expect(numberTaken(333)).toBe('333번에는 이미 상품이 있어요. 다른 번호를 고르거나 고쳐 주세요.')
    expect(world.events).toHaveLength(1)
    // 이미 상품이 있는 번호를 다시 누르면 보내지 않고 바로 알린다
    fireEvent.click(within(card()).getByRole('button', { name: '333번으로 확정' }))
    await flush()
    expect(world.events).toHaveLength(1)
  })

  it('여럿이면 먼저 올라온 것부터 한 번에 한 장 — "외 1개", 확정하면 다음 것이 같은 자리에 뜬다', async () => {
    const world = worldWith({ products: [held(20, { seq: 9 }, { name: '나중' }), held(10, { seq: 7 }, { name: '먼저' })] })
    follow(world, () => ({ products: [product(10, { name: '먼저' })] }))
    await open(world)
    expect(screen.getAllByRole('region', { name: TENTATIVE_REGION })).toHaveLength(1)
    expect(within(card()).getByTestId('tentative-values').textContent).toBe('10번 먼저 10,000원')
    expect(within(card()).getByText('외 1개')).toBeTruthy()
    fireEvent.click(within(card()).getByRole('button', { name: `${CONFIRM_AS_IS} — 10번` }))
    await waitFor(() => expect(within(card()).getByTestId('tentative-values').textContent).toBe('20번 나중 10,000원'))
    expect(within(card()).queryByText('외 1개')).toBeNull()
    expect(world.events).toHaveLength(1)
  })

  it('끝난 라이브에는 카드를 띄우지 않는다', async () => {
    const world = worldWith({ products: [held(313)] })
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
    await waitFor(() => expect(world.source()).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    expect(screen.queryByRole('region', { name: TENTATIVE_REGION })).toBeNull()
  })

  it('카드가 뜬 직후에는 누름을 받지 않는다 — 다른 것을 누르려던 손가락이 방금 뜬 카드를 확정하지 않게', async () => {
    expect(CARD_GUARD_MS).toBeGreaterThanOrEqual(400)
    const data = fromFull(fullView({ products: [held(313)] }))
    const sent: unknown[] = []
    const api: ConsoleApi = { b: 'b1', data, names: new BuyerNames(data.buyers, data.claims), ended: false, sealed: false, command: async (event) => { sent.push(event); return { date: '2026-10-29', rehearsal: false, seq: 6, type: String(event.type), changed: true, effects: [] } }, select: () => {}, selected: null, labelWords: new Map() }
    const opened: string[] = []
    const { rerender } = render(<ConsoleContext.Provider value={api}><TentativeCards onEdit={(key) => opened.push(key)} bottom={0} guardMs={60_000} /></ConsoleContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: `${CONFIRM_AS_IS} — 313번` }))
    fireEvent.click(screen.getByRole('button', { name: `${WITHDRAW} — 313번` }))
    fireEvent.click(screen.getByRole('button', { name: `${TENTATIVE_EDIT} — 313번` }))
    await flush()
    expect(sent).toHaveLength(0)
    expect(opened).toHaveLength(0)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // 시간이 지난 뒤(여기서는 기다리는 시간 0)에는 받는다
    rerender(<ConsoleContext.Provider value={api}><TentativeCards onEdit={(key) => opened.push(key)} bottom={0} guardMs={0} /></ConsoleContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: `${CONFIRM_AS_IS} — 313번` }))
    await waitFor(() => expect(sent).toHaveLength(1))
  })
})

describe('확인 중 상품의 자세히·수정창 (D-RETRO-91)', () => {
  async function openDetail(world: World, no: number) {
    await open(world)
    fireEvent.click(within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: `상품 자세히 — ${String(no)}번` }))
    return screen.findByRole('group', { name: '상품 자세히' })
  }

  it('자세히에는 [판매 시작]·[상품 삭제] 대신 카드와 같은 확정·거두기 — [이대로 확정]은 product.confirm을 보내고 창을 닫는다', async () => {
    const world = worldWith({ products: [held(313, {}, { name: '빅뱅', price: 10_000 })] })
    follow(world, () => ({ products: [product(313, { name: '빅뱅', price: 10_000 })] }))
    const detail = await openDetail(world, 313)
    expect(within(detail).queryByRole('button', { name: '판매 시작 — 313번' })).toBeNull()
    expect(within(detail).queryByRole('button', { name: '상품 삭제 — 313번' })).toBeNull()
    const withdraw = within(detail).getByRole('button', { name: `${WITHDRAW} — 313번` })
    const go = within(detail).getByRole('button', { name: `${CONFIRM_AS_IS} — 313번` })
    expectSideBySide(withdraw, go)
    fireEvent.click(go)
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 313, price: 10_000, name: '빅뱅' })
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
  })

  it('카드의 [고치기]로 수정창을 열어 가격을 고치면 단추가 [이 값으로 확정] — 값을 먼저 고치고 그다음 확정을 보낸다 (적용 범위 물음 없음)', async () => {
    const world = worldWith({ products: [held(305, { reasons: ['PRICE_OUT_OF_RANGE'] }, { name: '금', price: 35_000 })], claims: [waiting('c1', 305, 'u1', 12)], pending: [slot(305, ['c1'], ['u1'])], buyers: [buyer('u1', '홍길동')] })
    follow(world, (events) => (events.some((event) => event.type === 'product.confirm') ? { products: [product(305, { name: '금', price: 350_000 })] } : { products: [held(305, { reasons: ['PRICE_OUT_OF_RANGE'] }, { name: '금', price: 350_000 })] }))
    await open(world)
    fireEvent.click(within(card()).getByRole('button', { name: `${TENTATIVE_EDIT} — 305번` }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '가격 고치기' }))
    typePad('350000')
    expect(screen.queryByRole('button', { name: EDIT_DONE })).toBeNull()
    expect(EDIT_CONFIRM).toBe('이 값으로 확정')
    fireEvent.click(screen.getByRole('button', { name: EDIT_CONFIRM }))
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '305', priceText: '350000원' })
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 305 })
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
    await waitFor(() => expect(screen.queryByRole('region', { name: TENTATIVE_REGION })).toBeNull())
  })

  it('수정창에서 아무것도 고치지 않고 [이 값으로 확정]을 눌러도 확정을 보낸다', async () => {
    const world = worldWith({ products: [held(123, {}, { name: '수박색금', price: 50_000 })] })
    follow(world, () => ({ products: [product(123, { name: '수박색금', price: 50_000 })] }))
    const detail = await openDetail(world, 123)
    fireEvent.click(within(detail).getByRole('button', { name: '가격 고치기' }))
    fireEvent.click(screen.getByRole('button', { name: EDIT_CONFIRM }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 123 })
    await waitFor(() => expect(screen.queryByTestId('product-sheet')).toBeNull())
  })

  it('번호를 고치면 번호를 바꾼 뒤 새 번호로 확정한다', async () => {
    const world = worldWith({ products: [held(123, {}, { name: '수박색금', price: 50_000 })] })
    follow(world, (events) => (events.some((event) => event.type === 'product.confirm') ? { products: [product(333, { id: 'p123', name: '수박색금', price: 50_000 })], removed: removedOnly(['b1/123']) } : { products: [held(333, {}, { id: 'p123', name: '수박색금', price: 50_000 })], removed: removedOnly(['b1/123']) }))
    const detail = await openDetail(world, 123)
    fireEvent.click(within(detail).getByRole('button', { name: '번호 고치기' }))
    typePad('333')
    fireEvent.click(screen.getByRole('button', { name: EDIT_CONFIRM }))
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.renumber', b: 'b1', from: 123, to: 333 })
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 333 })
  })

  it('끝난 라이브에 남은 확인 중 상품도 라이브 기록의 자세히에서 확정·거둘 수 있다 — 기다리던 찜을 뒤에 정리할 수 있게', async () => {
    const world = worldWith({ products: [held(313, {}, { name: '빅뱅', price: 10_000 })], claims: [waiting('c1', 313, 'u1', 12)], pending: [slot(313, ['c1'], ['u1'])], buyers: [buyer('u1', '홍길동')] })
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ id: 'b1', date: '2026-10-29', title: '저녁 방송', rehearsal: false, ended: true, endedAt: '2026-10-29T13:00:00.000Z' }] } }))
    follow(world, () => ({ products: [product(313, { name: '빅뱅', price: 10_000 })] }))
    // 끝난 라이브는 정산 내역서가 먼저 뜬다 — [라이브 기록]으로 상품 목록을 연다
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await waitFor(() => expect(world.sources.length).toBeGreaterThan(0))
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    fireEvent.click(await screen.findByRole('button', { name: '라이브 기록' }))
    // 끝난 라이브에는 방송 화면 카드를 띄우지 않는다 — 상품 줄에서 연다
    expect(screen.queryByRole('region', { name: TENTATIVE_REGION })).toBeNull()
    fireEvent.click(within(await screen.findByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 313번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    expect(within(detail).getByRole('button', { name: `${WITHDRAW} — 313번` })).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: `${CONFIRM_AS_IS} — 313번` }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 313, price: 10_000, name: '빅뱅' })
  })

  it('확인 중이 아닌 상품의 수정창은 그대로 [확인]이고 확정을 보내지 않는다', async () => {
    const world = worldWith({ products: [product(15, { price: 20_000 })] })
    follow(world)
    const detail = await openDetail(world, 15)
    fireEvent.click(within(detail).getByRole('button', { name: '가격 고치기' }))
    typePad('10000')
    expect(screen.queryByRole('button', { name: EDIT_CONFIRM })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: EDIT_DONE }))
    await waitFor(() => expect(world.events).toHaveLength(1))
    await flush()
    expect(world.events.map((event) => event.body?.type)).toEqual(['product.update'])
  })
})

describe('확인 중 상품이 있는 번호를 상품 추가에서 치면 (D-RETRO-92)', () => {
  it('"이미 있어요"로 막지 않고 친 값으로 확정한다 — 값을 고친 뒤 확정을 보낸다', async () => {
    const world = worldWith({ products: [held(313, { by: 'SYNC', reasons: ['OTHER_ACCOUNT', 'PENDING_CLAIMS'] }, { name: '빅뱅', price: 10_000 })] })
    follow(world, (events) => (events.some((event) => event.type === 'product.confirm') ? { products: [product(313, { name: '빅뱅', price: 30_000 })] } : {}))
    await open(world)
    fireEvent.click(screen.getByTestId('add-product'))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    typePad('313')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    expect(within(page).queryByRole('alert')).toBeNull()
    typePad('30000')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    expect(within(page).getByText(ASK_CONFIRM_HELD)).toBeTruthy()
    expect(within(page).queryByText(ASK_ADD)).toBeNull()
    expect(within(page).getByRole('note').textContent).toBe('확인 중인 313번은 지금 빅뱅 10,000원이에요.')
    expect(heldWords({ no: 5, name: '', price: 1_000 })).toBe('확인 중인 5번은 지금 1,000원이에요.')
    fireEvent.click(within(page).getByRole('button', { name: CONFIRM_HELD }))
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '313', priceText: '30000원' })
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 313 })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull())
  })
})

describe('가격 없는 확인 중 — "N번"만 듣고 올라온 상품 (D-RECOG-22·27)', () => {
  /** 356번이 가격 없이 확인 중이고, 356번으로 찜 하나가 기다린다 */
  const BARE: Partial<FullView> = {
    products: [held(356, { reasons: ['PRICE_SINGLE_SOURCE'] }, { name: '', price: null })],
    claims: [waiting('c1', 356, 'u1', 12)],
    pending: [slot(356, ['c1'], ['u1'])],
    buyers: [buyer('u1', '홍길동')],
  }

  it('낱말: 가격이 빈 상품은 "가격 듣는 중"이고 0원이 아니다. 확정 요청에 가격을 적지 않으며, 금액 후보는 모두 고를 거리다', () => {
    const bare = held(356, { candidates: { no: [], price: [20_000, 25_000], name: [] } }, { name: '', price: null })
    expect(needsPrice(bare)).toBe(true)
    expect(needsPrice(held(1))).toBe(false)
    expect(priceWords(null)).toBe(PRICE_WAITING)
    expect(PRICE_WAITING).toBe('가격 듣는 중')
    expect(priceWords(20_000)).toBe('20,000원')
    expect(otherPrices(bare)).toEqual([20_000, 25_000])
    expect(confirmEvent(bare)).toEqual({ type: 'product.confirm', b: 'b1', no: 356 })
    expect(confirmEvent(bare, { price: 25_000 })).toEqual({ type: 'product.confirm', b: 'b1', no: 356, price: 25_000 })
    expect(heldWords({ no: 356, name: '', price: null })).toBe('확인 중인 356번은 지금 가격을 듣는 중이에요.')
  })

  it('상품 목록 줄·확인 카드에 "가격 듣는 중"이 보이고 그 상품을 0원으로 적지 않는다 (매출 합계 "0원"은 판 것이 없어서다)', async () => {
    await open(worldWith(BARE))
    const row = within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 356번' })
    // D-UX4-207로 바뀐 기대 (사용자 "... 애니메이션으로"; 옛 D-RECOG-22: 줄에 흐린 글 "가격 듣는 중"): 줄의 빈 가격은 … 점 셋, 읽어 주기는 "가격 듣는 중". 확인 카드는 글 그대로
    expect(within(row).getByRole('img', { name: PRICE_WAITING })).toBeTruthy()
    expect(card().textContent).toContain(PRICE_WAITING)
    for (const text of [row.textContent ?? '', card().textContent ?? '']) expect(text).not.toMatch(/(^|[^0-9,])0원/)
  })

  it('확인 카드: 금액 후보가 없으면 "가격이 얼마예요?" — 왼쪽 [거두기] · 오른쪽 [가격 적기] 한 줄, [이대로 확정]은 없다. [가격 적기]는 수정창의 가격 칸을 연다', async () => {
    const world = worldWith(BARE)
    await open(world)
    const box = card()
    expect(within(box).getByTestId('tentative-values').textContent).toBe(`356번 ${PRICE_WAITING}`)
    expect(within(box).getByText(ASK_PRICE)).toBeTruthy()
    expect(within(box).queryByRole('button', { name: `${CONFIRM_AS_IS} — 356번` })).toBeNull()
    const withdraw = within(box).getByRole('button', { name: `${WITHDRAW} — 356번` })
    const write = within(box).getByRole('button', { name: `${WRITE_PRICE} — 356번` })
    expect(write.textContent).toBe(WRITE_PRICE)
    expectSideBySide(withdraw, write)
    fireEvent.click(write)
    // D-RECOG-29: 자세히 대신 수정창의 가격 칸(숫자판)이 바로 열린다 (옛 기대: 자세히 묶음 '상품 자세히'가 보임 — D-RECOG-27)
    expect(await screen.findByTestId('product-edit')).toBeTruthy()
    expect(world.events).toHaveLength(0)
  })

  it('확인 카드 [가격 적기]: 수정창을 열며 가격 칸 숫자판이 바로 뜬다 — 칸을 또 누르지 않고 적어 확정한다 (D-RECOG-29)', async () => {
    const world = worldWith(BARE)
    follow(world, (events) => (events.some((event) => event.type === 'product.confirm') ? { products: [product(356, { name: '', price: 20_000 })] } : { products: [held(356, { reasons: ['PRICE_SINGLE_SOURCE'] }, { name: '', price: 20_000 })] }))
    await open(world)
    fireEvent.click(within(card()).getByRole('button', { name: `${WRITE_PRICE} — 356번` }))
    // 가격 칸이 열려 있다: 숫자판이 보이고 고치는 칸은 가격("가격 듣는 중"을 묻는다, 번호 "356번"이 아니다) — 칸을 또 누르지 않는다
    await screen.findByRole('group', { name: '숫자판' })
    const editor = screen.getByTestId('product-edit')
    expect(within(editor).getByText(PRICE_WAITING)).toBeTruthy()
    expect(within(editor).queryByText('356번')).toBeNull()
    expect(screen.queryByText(PRICE_NEEDED)).toBeNull()
    typePad('20000')
    fireEvent.click(screen.getByRole('button', { name: EDIT_CONFIRM }))
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '356', priceText: '20000원' })
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 356 })
  })

  it('상품 목록에서 연 수정창은 칸을 저절로 열지 않는다 (D-RECOG-29는 [가격 적기]만)', async () => {
    await open(worldWith(BARE))
    fireEvent.click(within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 356번' }))
    await screen.findByRole('group', { name: '상품 자세히' })
    expect(screen.queryByRole('group', { name: '숫자판' })).toBeNull()
    expect(screen.queryByTestId('product-edit')).toBeNull()
  })

  it('확인 카드: 금액 후보가 있으면 후보 단추만(지금 값 단추 없음) — 누르면 그 금액으로 확정', async () => {
    const world = worldWith({ ...BARE, products: [held(356, { reasons: ['PRICE_DISAGREE'], candidates: { no: [], price: [20_000, 25_000], name: [] } }, { name: '색금', price: null })] })
    follow(world, () => ({ products: [product(356, { name: '색금', price: 25_000 })] }))
    await open(world)
    const box = card()
    expect(within(box).getByText(ASK_WHICH_PRICE)).toBeTruthy()
    const left = within(box).getByRole('button', { name: '20,000원으로 확정' })
    const right = within(box).getByRole('button', { name: '25,000원으로 확정' })
    expectSideBySide(left, right)
    expect(within(box).getAllByRole('button', { name: /원으로 확정$/ })).toHaveLength(2)
    fireEvent.click(right)
    await waitFor(() => expect(world.events).toHaveLength(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 356, price: 25_000, name: '색금' })
  })

  it('수정창: 가격을 적지 않고 [이 값으로 확정]을 누르면 보내지 않고 가격 칸을 열어 "가격을 적어 주세요"를 보인다. 가격을 적으면 고친 뒤 확정한다', async () => {
    const world = worldWith(BARE)
    follow(world, (events) => (events.some((event) => event.type === 'product.confirm') ? { products: [product(356, { name: '', price: 20_000 })] } : { products: [held(356, { reasons: ['PRICE_SINGLE_SOURCE'] }, { name: '', price: 20_000 })] }))
    await open(world)
    fireEvent.click(within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 356번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    // 자세히의 확인 칸: 가격 칸을 눌러 적으라고 알리고 거두기만 — 가격 없이 확정하는 단추는 없다
    expect(within(detail).getByText(WRITE_PRICE_ABOVE)).toBeTruthy()
    expect(within(detail).queryByRole('button', { name: `${CONFIRM_AS_IS} — 356번` })).toBeNull()
    fireEvent.click(within(detail).getByRole('button', { name: '번호 고치기' }))
    fireEvent.click(screen.getByRole('button', { name: EDIT_CONFIRM }))
    await flush()
    expect(world.events).toHaveLength(0)
    expect(screen.getByText(PRICE_NEEDED)).toBeTruthy()
    typePad('20000')
    fireEvent.click(screen.getByRole('button', { name: EDIT_CONFIRM }))
    await waitFor(() => expect(world.events).toHaveLength(2))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '356', priceText: '20000원' })
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'product.confirm', b: 'b1', no: 356 })
  })
})
