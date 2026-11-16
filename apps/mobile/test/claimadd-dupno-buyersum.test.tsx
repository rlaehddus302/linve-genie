// 판매자 의견 2026-11-17 세 가지:
// - D-CLAIMADD-03 찜 넣기 [닉네임으로 보이기] — 기본 꺼짐(문자찜), 켜고 채팅 손님으로 넣으면 sms named
// - D-DUPNO-01 이미 있는 번호 "26번이 이미 있어요 (품종 · 가격) 같은 물건으로 하나 더 올릴까요?" [아니요 | 하나 더 올리기] — 재고 +1
// - D-BUYERSUM-01 라이브 중 손님별 합계 (찜 기록 탭 "손님별 합계 ›" → 손님마다 개수·합계, 찾기·정렬·펼치기)
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resetFeedView } from '../src/lib/feed-view.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { BuyerNames } from '../src/lib/derive.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { CLAIM_ADD_NAMED, isChatBuyer } from '../src/screens/console/ClaimAdd.tsx'
import { smsClaimEvent } from '../src/screens/console/claim-actions.ts'
import { DUP_ASK, DUP_MORE, DUP_NO, SAME_NUMBER_SHOW, dupTitle } from '../src/screens/console/ProductAdd.tsx'
import { TOTALS_PILL, TOTALS_TITLE, buyerTotals, filterTotals, totalLineText, totalsSummary } from '../src/screens/console/BuyerTotals.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, changes, claim, flush, fullView, product } from './support.ts'

const SLOW = 60_000

afterEach(() => resetFeedView())

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

/** 두 단추가 같은 줄(좌우)에 있고 왼쪽이 먼저다 (D-UX4-01) */
function expectSideBySide(left: HTMLElement, right: HTMLElement) {
  const row = left.parentElement?.parentElement
  expect(row).toBe(right.parentElement?.parentElement)
  expect(getComputedStyle(row!).flexDirection).toBe('row')
  expect(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

// ── D-CLAIMADD-03 ───────────────────────────────────────────────

describe('찜 넣기 [닉네임으로 보이기] (D-CLAIMADD-03)', () => {
  it('보낼 쓰기: 고른 손님 + named일 때만 named를 싣는다 — 이름만 적은 새 문자 손님에는 싣지 않는다', () => {
    const target = { broadcast: 'b1', no: 15 }
    expect(smsClaimEvent(target, { name: '', last4: '', buyer: 'u8', named: true })).toEqual({ type: 'sms', b: 'b1', no: 15, buyer: 'u8', named: true })
    expect(smsClaimEvent(target, { name: '', last4: '', buyer: 'u8', named: false })).toEqual({ type: 'sms', b: 'b1', no: 15, buyer: 'u8' })
    expect(smsClaimEvent(target, { name: '홍길동', last4: '', buyer: null, named: true })).toEqual({ type: 'sms', b: 'b1', no: 15, memo: '홍길동' })
  })

  it('채팅 손님만 닉네임으로 보일 수 있다', () => {
    const data = fromFull(fullView({ buyers: [buyer('u1', '홍길동'), buyer('s1', '문자찜', { kind: 'sms', phoneLast4: '0937' })] }))
    expect(isChatBuyer(data, 'u1')).toBe(true)
    expect(isChatBuyer(data, 's1')).toBe(false)
    expect(isChatBuyer(data, 'nobody')).toBe(false)
  })

  const message = (seq: number, channel: string, text: string) => ({
    id: `m${String(seq)}`, broadcast: 'b1', channel, nick: channel, text, owner: false, seq, at: '2026-10-29T11:00:00.000Z', publishedAt: '2026-10-29T11:00:00.000Z',
    ignored: false, order: false, cancel: false, orders: [], cancels: [], mentions: [], converted: [], claims: [], failed: false,
  })
  async function openAdd() {
    const list = await screen.findByRole('list', { name: '상품 목록' })
    fireEvent.click(within(list).getByRole('button', { name: '상품 자세히 — 26번' }))
    const sheet = await screen.findByTestId('product-sheet')
    fireEvent.click(within(sheet).getByRole('button', { name: '찜 넣기 — 26번' }))
    return within(sheet).findByRole('group', { name: '찜 넣기' })
  }
  const PATCH = { products: [product(26, { name: '핑크프릴', price: 8_000 })], buyers: [buyer('u8', '이두리'), buyer('s1', '문자찜', { kind: 'sms', phoneLast4: '0937' })] }

  it('기본은 꺼짐 — 최근 채팅 손님을 그대로 누르면 옛처럼 문자찜(named 없음)', async () => {
    const world = makeWorld({ products: [product(26)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/messages/, () => ({ body: { date: '2026-10-29', rehearsal: false, seq: 7, more: false, messages: [message(1, 'u8', '26번 저요, 예쁘네요')] } }))
    await open(world, PATCH)
    const form = await openAdd()
    await within(form).findByRole('group', { name: '최근 채팅 손님' })
    const toggle = within(form).getByRole('switch', { name: `${CLAIM_ADD_NAMED} — 꺼짐` })
    expect(toggle).toBeTruthy()
    expect(within(form).getByText('켜면 라벨과 감사 채팅에 "문자찜" 대신 손님 닉네임이 나와요')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: '이두리 손님으로 26번에 찜 넣기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', no: 26, buyer: 'u8' })
  }, SLOW)

  it('켜고 최근 채팅 손님을 누르면 named: true로 그 손님 찜을 넣는다', async () => {
    const world = makeWorld({ products: [product(26)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/messages/, () => ({ body: { date: '2026-10-29', rehearsal: false, seq: 7, more: false, messages: [message(1, 'u8', '26번 저요, 예쁘네요')] } }))
    await open(world, PATCH)
    const form = await openAdd()
    await within(form).findByRole('group', { name: '최근 채팅 손님' })
    fireEvent.click(within(form).getByRole('switch', { name: `${CLAIM_ADD_NAMED} — 꺼짐` }))
    expect(within(form).getByRole('switch', { name: `${CLAIM_ADD_NAMED} — 켜짐` })).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: '이두리 손님으로 26번에 찜 넣기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', no: 26, buyer: 'u8', named: true })
  }, SLOW)

  it('채팅 손님을 고를 길이 없으면(최근 채팅 없음·이름만 적음) 스위치가 없다 — 문자 손님은 늘 문자찜', async () => {
    const world = makeWorld({ products: [product(26)] })
    await open(world, PATCH)
    const form = await openAdd()
    expect(within(form).queryByRole('switch')).toBeNull()
    fireEvent.change(within(form).getByLabelText('손님 이름'), { target: { value: '김새롬' } })
    expect(within(form).queryByRole('switch')).toBeNull()
    // 이미 있는 채팅 손님 이름을 적으면 후보와 함께 스위치가 나온다
    fireEvent.change(within(form).getByLabelText('손님 이름'), { target: { value: '이두' } })
    expect(within(form).getByRole('switch', { name: `${CLAIM_ADD_NAMED} — 꺼짐` })).toBeTruthy()
  }, SLOW)
})

// ── D-DUPNO-01 ──────────────────────────────────────────────────

describe('이미 있는 번호에 같은 물건 하나 더 (D-DUPNO-01)', () => {
  it('글: "26번이 이미 있어요 (핑크프릴 · 8,000원)" — 품종이 비면 가격만', () => {
    expect(dupTitle({ no: 26, name: '핑크프릴', price: 8_000 })).toBe('26번이 이미 있어요 (핑크프릴 · 8,000원)')
    expect(dupTitle({ no: 27, name: ' ', price: 5_000 })).toBe('27번이 이미 있어요 (5,000원)')
  })

  const SOLD = {
    products: [product(26, { name: '핑크프릴', price: 8_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] })],
    claims: [claim('c1', 26, 'u1'), claim('c2', 26, 'u2', { status: 'WAITLISTED', seq: 11 })],
    buyers: [buyer('u1', '홍길동'), buyer('u2', '김철수')],
  } satisfies Parameters<typeof changes>[2]

  async function askDup(world: World) {
    await open(world, SOLD)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    typePad('26')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    return page
  }

  it('번호 칸 [다음]에서 막지 않고 묻는다 — 지금 품종·가격, 찜이 될 대기 손님, [아니요 | 하나 더 올리기]. 올리기 = 재고 +1', async () => {
    const world = makeWorld({ products: [product(26)] })
    const page = await askDup(world)
    const card = within(page).getByTestId('dup-number')
    expect(within(card).getByText('26번이 이미 있어요 (핑크프릴 · 8,000원)')).toBeTruthy()
    expect(within(card).getByText(DUP_ASK)).toBeTruthy()
    expect(within(card).getByText(/대기 1번 김철수 님도 찜이 되어 라벨을 뽑을 수 있어요\./)).toBeTruthy()
    expect(within(card).getByText(/이 번호는 같은 물건 2개를 팔아요\./)).toBeTruthy()
    expect(within(card).getByRole('button', { name: SAME_NUMBER_SHOW })).toBeTruthy()
    // 묻는 동안 [다음]·숫자판은 없다
    expect(within(page).queryByRole('button', { name: '다음' })).toBeNull()
    expect(within(page).queryByRole('group', { name: '숫자판' })).toBeNull()
    expectSideBySide(within(page).getByRole('button', { name: DUP_NO }), within(page).getByRole('button', { name: `26번에 ${DUP_MORE}` }))
    fireEvent.click(within(page).getByRole('button', { name: `26번에 ${DUP_MORE}` }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', no: 26, stock: 2 })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull())
  }, SLOW)

  it('[아니요]면 묻기를 내리고 숫자판·[다음]이 돌아온다 — 아무것도 보내지 않는다', async () => {
    const world = makeWorld({ products: [product(26)] })
    const page = await askDup(world)
    fireEvent.click(within(page).getByRole('button', { name: DUP_NO }))
    expect(within(page).queryByTestId('dup-number')).toBeNull()
    expect(within(page).getByRole('button', { name: '다음' })).toBeTruthy()
    typePad('7')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    expect(within(page).queryByTestId('dup-number')).toBeNull()
    expect(world.events.length).toBe(0)
  }, SLOW)
})

// ── D-BUYERSUM-01 ───────────────────────────────────────────────

describe('라이브 중 손님별 합계 (D-BUYERSUM-01)', () => {
  const VIEW = {
    products: [
      product(26, { name: '핑크프릴', price: 8_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'] }),
      product(27, { name: '라울', price: 5_000, status: 'SOLD', winners: ['u2'], winnerClaims: ['c2'], waitlist: ['u1'], waitlistClaims: ['c3'] }),
      product(28, { name: '채홍', price: 3_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c4'] }),
    ],
    claims: [
      claim('c1', 26, 'u1', { amount: 8_000, price: 8_000, rankTime: '2026-10-29T11:00:01.000Z' }),
      claim('c2', 27, 'u2', { amount: 5_000, price: 5_000, seq: 11, rankTime: '2026-10-29T11:00:02.000Z' }),
      claim('c3', 27, 'u1', { status: 'WAITLISTED', seq: 12, rankTime: '2026-10-29T11:00:03.000Z' }),
      claim('c4', 28, 'u1', { amount: 3_000, price: 3_000, seq: 13, rankTime: '2026-10-29T11:00:04.000Z' }),
    ],
    buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희')],
  } satisfies Parameters<typeof changes>[2]

  it('값: 찜(1등)만 손님마다 개수·합계, 대기는 넣지 않는다 — 최근순(최근 찜이 위)·이름순(한글 먼저), 찾기는 닉네임 일부나 번호', () => {
    const data = fromFull(fullView(VIEW))
    const names = new BuyerNames(data.buyers, data.claims, false)
    const recent = buyerTotals(data, names, 'b1', 'recent')
    expect(recent.map((row) => [row.name, row.qty, row.subtotal])).toEqual([['홍길동', 2, 11_000], ['김영희', 1, 5_000]])
    expect(recent[0]?.lines.map(totalLineText)).toEqual(['26번 핑크프릴', '28번 채홍'])
    expect(buyerTotals(data, names, 'b1', 'name').map((row) => row.name)).toEqual(['김영희', '홍길동'])
    expect(filterTotals(recent, '길동').map((row) => row.name)).toEqual(['홍길동'])
    expect(filterTotals(recent, '27').map((row) => row.name)).toEqual(['김영희'])
    expect(filterTotals(recent, '2').map((row) => row.name)).toEqual([])
    expect(totalsSummary(recent)).toBe('손님 2명 · 합계 16,000원')
  })

  it('찜 기록 탭의 "손님별 합계 ›"를 누르면 손님 줄이 나오고, 줄을 누르면 그 손님 상품이 펼쳐진다 — 상품 탭에는 캡슐이 없다', async () => {
    const world = makeWorld({ products: [product(26), product(27), product(28)] })
    await open(world, VIEW)
    expect(screen.queryByTestId('totals-pill')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: '찜 기록' }))
    const pill = await screen.findByTestId('totals-pill')
    expect(pill.textContent).toBe(TOTALS_PILL)
    fireEvent.click(pill)
    const page = await screen.findByRole('dialog', { name: TOTALS_TITLE })
    expect(within(page).getByTestId('totals-summary').textContent).toBe('손님 2명 · 합계 16,000원')
    const list = within(page).getByRole('list', { name: TOTALS_TITLE })
    const row = within(list).getByRole('button', { name: '홍길동 찜 2개 11,000원' })
    expect(within(list).getByRole('button', { name: '김영희 찜 1개 5,000원' })).toBeTruthy()
    expect(within(page).queryByTestId('totals-lines')).toBeNull()
    fireEvent.click(row)
    const lines = within(page).getByTestId('totals-lines')
    expect(within(lines).getByText('26번 핑크프릴')).toBeTruthy()
    expect(within(lines).getByText('8,000원')).toBeTruthy()
    expect(within(lines).getByText('28번 채홍')).toBeTruthy()
    fireEvent.click(row)
    expect(within(page).queryByTestId('totals-lines')).toBeNull()
    // 찾기: 닉네임 일부
    fireEvent.change(within(page).getByLabelText('찜 기록 찾기'), { target: { value: '영희' } })
    expect(within(page).getByTestId('totals-summary').textContent).toBe('손님 1명 · 합계 5,000원')
    expect(within(list).queryByRole('button', { name: '홍길동 찜 2개 11,000원' })).toBeNull()
  }, SLOW)
})
