// 판매자 의견 2026-11-17 세 가지:
// - D-CLAIMADD-03 찜 넣기 [닉네임으로 보이기] — D-CLAIMADD-05(사용자 지시 2026-11-18)로 스위치가 없어졌다: 최근 채팅 손님을 고르면 늘 sms named
// - D-DUPNO-01 이미 있는 번호 묻기 → D-DUPNO-02(사용자 지시 2026-11-17)로 바꿈: 치는 순간 칸 아래 빨간 "이미 등록된 번호예요.", [다음] 흐림
// - D-BUYERSUM-01 라이브 중 손님별 합계 (찜 기록 탭 "손님별 합계 ›" → 손님마다 개수·합계, 찾기·정렬·펼치기)
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resetFeedView } from '../src/lib/feed-view.ts'
import { fromFull } from '../src/lib/scope-data.ts'
import { BuyerNames } from '../src/lib/derive.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { isChatBuyer } from '../src/screens/console/ClaimAdd.tsx'
import { smsClaimEvent } from '../src/screens/console/claim-actions.ts'
import { NO_TAKEN } from '../src/screens/console/ProductAdd.tsx'
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

const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

// ── D-CLAIMADD-03 ───────────────────────────────────────────────

describe('찜 넣기 채팅 손님은 닉네임으로 (D-CLAIMADD-03 → 05)', () => {
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

  // 스펙 변경 (D-CLAIMADD-05, 사용자 지시 2026-11-18 "닉네임으로 보이기 온오프는 왜 있어야 하는지 이해가 안돼. 그냥 둘 중에 하나잖아"):
  // 옛 기대는 스위치 [닉네임으로 보이기](기본 꺼짐) — 끈 채 최근 채팅 손님을 누르면 named 없음, 켜면 named: true, 채팅 손님을 고를 길이 없으면 스위치 없음.
  // 이제 스위치가 없고, 채팅 손님 줄을 누르면 늘 named: true. 이름 없이 넣으려면 맨 위 [문자찜].
  it('스위치가 없다 — 최근 채팅 손님을 누르면 named: true로 그 손님 찜을 넣는다', async () => {
    const world = makeWorld({ products: [product(26)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/messages/, () => ({ body: { date: '2026-10-29', rehearsal: false, seq: 7, more: false, messages: [message(1, 'u8', '26번 저요, 예쁘네요')] } }))
    await open(world, PATCH)
    const form = await openAdd()
    await within(form).findByRole('group', { name: '최근 채팅 손님' })
    expect(within(form).queryByRole('switch')).toBeNull()
    expect(form.textContent).not.toContain('닉네임으로 보이기')
    fireEvent.click(within(form).getByRole('button', { name: '이두리 손님으로 26번에 찜 넣기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', no: 26, buyer: 'u8', named: true })
  }, SLOW)
})

// ── D-DUPNO-02 ──────────────────────────────────────────────────

// 스펙 변경 (D-DUPNO-02, 사용자 지시 2026-11-17 "다음 버튼 누르기 전에 곧바로 아래에 빨간 글씨로 이미 등록된 번호에요"):
// 옛 기대는 [다음]에서 "26번이 이미 있어요 (핑크프릴 · 8,000원) / 같은 물건으로 하나 더 올릴까요?" [아니요 | 하나 더 올리기] → 재고 +1 (D-DUPNO-01).
// 같은 물건 더 팔기는 그 상품의 [같은 물건 더 팔기](D-STK-02)에 그대로 있다.
describe('이미 있는 번호는 치는 순간 빨간 글 (D-DUPNO-02)', () => {
  const SOLD = {
    products: [product(26, { name: '핑크프릴', price: 8_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] })],
    claims: [claim('c1', 26, 'u1'), claim('c2', 26, 'u2', { status: 'WAITLISTED', seq: 11 })],
    buyers: [buyer('u1', '홍길동'), buyer('u2', '김철수')],
  } satisfies Parameters<typeof changes>[2]

  it('대기 손님이 있는 판매 완료 번호도 묻지 않는다 — 빨간 "이미 등록된 번호예요.", [다음] 흐림, 숫자판은 그대로, 보내지 않는다', async () => {
    const world = makeWorld({ products: [product(26)] })
    await open(world, SOLD)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    typePad('26')
    expect(within(page).getByText(NO_TAKEN)).toBeTruthy()
    expect(within(page).getByRole('button', { name: '다음' }).getAttribute('aria-disabled')).toBe('true')
    expect(within(page).getByRole('group', { name: '숫자판' })).toBeTruthy()
    expect(within(page).queryByRole('button', { name: /하나 더 올리기/ })).toBeNull()
    expect(within(page).queryByTestId('dup-number')).toBeNull()
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    typePad('7')
    expect(within(page).queryByText(NO_TAKEN)).toBeNull()
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
    fireEvent.click(await screen.findByRole('button', { name: '찜' }) /* D-UX4-210 탭 이름 찜 기록 → 찜 */)
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
