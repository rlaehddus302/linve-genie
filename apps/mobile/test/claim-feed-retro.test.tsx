// 찜 기록 번호별 보기·정렬·작은 글자·눌러서 조치, 상품 자세히 [찜 넣기] (D-RETRO-50~54, 복기 F6·F7 — 사용자 지시 2026-11-12
// "찜 목록에서 각 번호를 누르면 내가 원하는 대로 수정 … 글자 크기를 줄여 한 화면에 더 많이 … 번호별로 누가 찜했는지 … 오름차순 … 상품을 눌러 임의로 문자찜 등록").
// 화면은 판정하지 않는다 — 엔진에 이미 있는 방송자 조치(host.promote·host.assign)와 문자찜(sms) 쓰기를 보내는지만 본다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { getFeedView, resetFeedView, setFeedView } from '../src/lib/feed-view.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { buyer, changes, claim, flush, product } from './support.ts'

// 화면 하나를 통째로 그리는 시험이라 바쁜 기계에서는 기본 5초를 넘긴다
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
  // 쓰기 뒤 따라잡기 — 바뀐 것 없이 seq만
  world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=([7-9]|\d\d)$/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1]), world.seq, {}) }))
}

const openFeed = async () => fireEvent.click(await screen.findByRole('button', { name: '찜 기록' }))
const labels = (list: HTMLElement) => within(list).getAllByRole('listitem').map((row) => row.getAttribute('aria-label'))

const SAMPLE = {
  products: [
    product(15, { name: '핑크프릴', price: 35_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] }),
    product(7, { name: '라울', price: 12_000, winners: ['u2'], winnerClaims: ['c4'] }),
  ],
  claims: [
    claim('c1', 15, 'u1', { rankTime: '2026-10-29T11:00:01.000Z' }),
    claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11, rankTime: '2026-10-29T11:00:02.000Z' }),
    claim('c3', 88, 's1', { status: 'PENDING', origin: 'sms', productId: null, seq: 12, rankTime: '2026-10-29T11:00:03.000Z' }),
    claim('c4', 7, 'u2', { seq: 13, rankTime: '2026-10-29T11:00:09.000Z' }),
  ],
  buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희'), buyer('s1', '문자찜', { kind: 'sms', phoneLast4: '0937' })],
} satisfies Parameters<typeof changes>[2]

describe('찜 기록 보기 고르기 (D-RETRO-50~52)', () => {
  it('목록 위 한 줄에 [손님별 | 번호별] · [최근순 | 이름순] · 글자 [크게 | 작게] — 기본은 손님별·최근순·크게, 번호별을 고르면 번호 오름차순 줄에 찜·대기 손님이 낱말과 함께 보이고 이 휴대폰에 기억한다', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, SAMPLE)
    await openFeed()
    const view = await screen.findByRole('group', { name: '찜 기록 보기' })
    const bar = view.parentElement as HTMLElement
    // 단추는 좌우 한 줄 (D-UX4-01) — 위아래로 쌓지 않는다
    expect(getComputedStyle(bar).flexDirection).toBe('row')
    expect(getComputedStyle(bar).flexWrap).not.toBe('wrap')
    expect(within(bar).getAllByRole('button').map((button) => `${button.getAttribute('aria-label') ?? ''}${button.getAttribute('aria-selected') === 'true' ? ' ✓' : ''}`)).toEqual(['손님별 보기 ✓', '번호별 보기', '최근순 정렬 ✓', '이름순 정렬', '글자 크게 ✓', '글자 작게'])
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['손님별', '번호별', '최근순', '이름순', '크게', '작게'])
    // 기본: 지금까지의 손님별 (가장 최근에 찜한 손님이 맨 아래)
    expect(labels(screen.getByRole('list', { name: '찜 기록' }))).toEqual(['홍길동 15 찜', '문자-0937 88 보류', '김영희 15 대기 1 · 이미 찜됨 · 1등 홍길동, 7 찜'])

    fireEvent.click(within(bar).getByRole('button', { name: '번호별 보기' }))
    const numbers = await screen.findByRole('list', { name: '번호별 찜 기록' })
    expect(screen.queryByRole('list', { name: '찜 기록' })).toBeNull()
    expect(labels(numbers)).toEqual(['7번 라울 12,000원 — 김영희 찜', '15번 핑크프릴 35,000원 — 홍길동 찜, 김영희 대기 1', '88번 아직 상품이 없어요 — 문자-0937 보류'])
    const row = within(numbers).getAllByRole('listitem')[1]!
    expect(within(row).getByText('15번')).toBeTruthy()
    expect(within(row).getByText('핑크프릴')).toBeTruthy()
    expect(within(row).getByText('35,000원')).toBeTruthy()
    // 찜은 금색·굵게, 대기는 회색·덜 굵게 (순번과 함께)
    const win = within(row).getByText('홍길동 찜')
    const wait = within(row).getByText('김영희 대기 1')
    expect(Number(getComputedStyle(win).fontWeight)).toBeGreaterThan(Number(getComputedStyle(wait).fontWeight))
    expect(getComputedStyle(win).color).not.toBe(getComputedStyle(wait).color)
    // 번호별의 정렬은 [번호순 | 최근순]
    expect(within(bar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['손님별 보기', '번호별 보기', '번호순 정렬', '최근순 정렬', '글자 크게', '글자 작게'])
    fireEvent.click(within(bar).getByRole('button', { name: '최근순 정렬' }))
    expect(labels(screen.getByRole('list', { name: '번호별 찜 기록' })).map((label) => label?.split(' ')[0])).toEqual(['15번', '88번', '7번'])
    expect(getFeedView()).toMatchObject({ mode: 'number', numberSort: 'recent' })
  }, SLOW)

  it('손님별 이름순: 이름 오름차순, 한 손님 안의 번호도 오름차순 — 최근순으로 되돌리면 지금까지와 같다', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, SAMPLE)
    await openFeed()
    fireEvent.click(await screen.findByRole('button', { name: '이름순 정렬' }))
    expect(labels(screen.getByRole('list', { name: '찜 기록' }))).toEqual(['김영희 7 찜, 15 대기 1 · 이미 찜됨 · 1등 홍길동', '문자-0937 88 보류', '홍길동 15 찜'])
    expect(getFeedView().buyerSort).toBe('name')
    fireEvent.click(screen.getByRole('button', { name: '최근순 정렬' }))
    expect(labels(screen.getByRole('list', { name: '찜 기록' }))[0]).toBe('홍길동 15 찜')
  }, SLOW)

  it('글자 작게: 꼬리표가 낮아지고(36 → 30) 글자가 작아지지만 누르는 폭은 48 이상 그대로 — 보류 찜 판은 고르기 줄 없이 늘 큰 글자', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, { ...SAMPLE, pending: [{ product: 'b1/88', broadcast: 'b1', no: 88, buyers: ['s1'], claims: ['c3'] } as never] })
    await openFeed()
    const tag = () => within(screen.getByRole('list', { name: '찜 기록' })).getByRole('button', { name: '15 찜' })
    expect(getComputedStyle(tag()).minHeight).toBe('36px')
    const largeFont = Number.parseFloat(getComputedStyle(within(tag()).getByText('15 찜')).fontSize)
    fireEvent.click(screen.getByRole('button', { name: '글자 작게' }))
    expect(getComputedStyle(tag()).minHeight).toBe('30px')
    expect(getComputedStyle(tag()).minWidth).toBe('48px')
    expect(Number.parseFloat(getComputedStyle(within(tag()).getByText('15 찜')).fontSize)).toBeLessThan(largeFont)
    expect(getFeedView().size).toBe('small')
    // 번호별도 같은 작은 꼬리표
    fireEvent.click(screen.getByRole('button', { name: '번호별 보기' }))
    const chip = within(await screen.findByRole('list', { name: '번호별 찜 기록' })).getByRole('button', { name: '홍길동 찜' })
    expect(getComputedStyle(chip).minHeight).toBe('30px')
    expect(getComputedStyle(chip).minWidth).toBe('48px')
    // 보류 찜 판: 손님별·큰 글자 그대로, 고르기 줄 없음
    fireEvent.click(screen.getByRole('button', { name: /^보류 찜 1/ }))
    const pending = await screen.findByRole('list', { name: '찜 기록' })
    expect(labels(pending)).toEqual(['문자-0937 88 보류'])
    expect(screen.getAllByRole('group', { name: '찜 기록 보기' })).toHaveLength(1)
    expect(within(pending).queryByRole('button')).toBeNull()
  }, SLOW)

  it('번호 줄의 손님이 많으면 "+n명"으로 접고, 누르면 펼쳤다가 "접기"로 다시 접는다', async () => {
    const waits = Array.from({ length: 8 }, (_, index) => `w${String(index + 1)}`)
    const world = makeWorld({ products: [product(20)] })
    setFeedView({ mode: 'number' })
    await open(world, {
      products: [product(20, { status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: waits, waitlistClaims: waits.map((id) => `c${id}`) })],
      claims: [claim('c1', 20, 'u1'), ...waits.map((id, index) => claim(`c${id}`, 20, id, { status: 'WAITLISTED', seq: 20 + index }))],
      buyers: [buyer('u1', '홍길동'), ...waits.map((id, index) => buyer(id, `손님${String(index + 1)}`))],
    })
    await openFeed()
    const row = within(await screen.findByRole('list', { name: '번호별 찜 기록' })).getByRole('listitem')
    expect(within(row).getAllByRole('button').map((button) => button.textContent)).toEqual(['홍길동 찜', '손님1 대기 1', '손님2 대기 2', '손님3 대기 3', '손님4 대기 4', '손님5 대기 5', '+3명'])
    fireEvent.click(within(row).getByRole('button', { name: '20번 손님 3명 더 보기' }))
    expect(within(row).getAllByRole('button').map((button) => button.textContent)).toEqual(['홍길동 찜', '손님1 대기 1', '손님2 대기 2', '손님3 대기 3', '손님4 대기 4', '손님5 대기 5', '손님6 대기 6', '손님7 대기 7', '손님8 대기 8', '접기'])
    fireEvent.click(within(row).getByRole('button', { name: '20번 손님 접기' }))
    expect(within(row).getAllByRole('button')).toHaveLength(7)
  }, SLOW)
})

describe('찜을 눌러 조치 (D-RETRO-53)', () => {
  const menuRows = (menu: HTMLElement) => within(menu).getAllByRole('button').map((button) => button.getAttribute('aria-label'))

  it('대기 찜(번호별 꼬리표)을 누르면 [찜으로 올리기 · 상품 보기 · 상품 고치기 · 찜 삭제] — 자리가 찼으면 "지금 찜인 손님은 대기 1번으로" 묻고 [닫기 | 올리기] 뒤 교체 배정을 보낸다', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    setFeedView({ mode: 'number' })
    await open(world, SAMPLE)
    await openFeed()
    fireEvent.click(within(await screen.findByRole('list', { name: '번호별 찜 기록' })).getByRole('button', { name: '김영희 대기 1' }))
    const menu = await screen.findByRole('group', { name: '찜 메뉴' })
    expect(screen.getByText('15번 찜')).toBeTruthy()
    expect(within(menu).getByText('김영희')).toBeTruthy()
    expect(menuRows(menu)).toEqual(['찜으로 올리기', '상품 보기', '상품 고치기', '찜 삭제'])
    fireEvent.click(within(menu).getByRole('button', { name: '찜으로 올리기' }))
    const ask = await screen.findByRole('alertdialog', { name: '15번 찜으로 올릴까요?' })
    expect(within(ask).getByText(/^김영희\s+지금 찜인 홍길동 님은 대기 1번으로 내려가요\.$/)).toBeTruthy()
    // 부정 왼쪽 · 긍정 오른쪽 (D-UX4-01)
    expect(within(ask).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['닫기', '올리기'])
    fireEvent.click(within(ask).getByRole('button', { name: '올리기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toMatchObject({ type: 'host.assign', b: 'b1', no: 15, buyer: 'u2', replace: 'u1', replaceTo: 'WAITLIST', reason: '판매자가 대기 손님을 찜으로 올렸어요' })
  }, SLOW)

  it('자리가 빈 대기 찜(손님별 꼬리표)은 승계(host.promote)를 보내고, [닫기]를 누르면 아무것도 보내지 않는다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, {
      products: [product(15, { awaitingSuccession: true, waitlist: ['u2'], waitlistClaims: ['c2'] })],
      claims: [claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11 })],
      buyers: [buyer('u2', '김영희')],
    })
    await openFeed()
    const tag = within(await screen.findByRole('list', { name: '찜 기록' })).getByRole('button', { name: '15 대기 1' })
    fireEvent.click(tag)
    fireEvent.click(within(await screen.findByRole('group', { name: '찜 메뉴' })).getByRole('button', { name: '찜으로 올리기' }))
    const ask = await screen.findByRole('alertdialog', { name: '15번 찜으로 올릴까요?' })
    expect(within(ask).getByText('김영희')).toBeTruthy()
    fireEvent.click(within(ask).getByRole('button', { name: '닫기' }))
    await act(async () => { await flush() })
    expect(world.events.length).toBe(0)
    fireEvent.click(tag)
    fireEvent.click(within(await screen.findByRole('group', { name: '찜 메뉴' })).getByRole('button', { name: '찜으로 올리기' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: '15번 찜으로 올릴까요?' })).getByRole('button', { name: '올리기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toMatchObject({ type: 'host.promote', b: 'b1', no: 15, buyer: 'u2', reason: '판매자가 대기 손님을 찜으로 올렸어요' })
    expect(world.events[0]?.body).not.toHaveProperty('replace')
  }, SLOW)

  it('취소된 찜도 누를 수 있다: [찜 되돌리기 · 상품 보기 · 상품 고치기](찜 삭제는 없다) → "15번 찜을 되돌릴까요?" [닫기 | 되돌리기] → 그 손님을 다시 배정한다. 서버가 바꾼 것이 없으면 알린다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world, {
      products: [product(15)],
      claims: [claim('c1', 15, 'u1', { status: 'CANCELLED' })],
      buyers: [buyer('u1', '홍길동')],
    })
    await openFeed()
    const tag = within(await screen.findByRole('list', { name: '찜 기록' })).getByRole('button', { name: '15 취소됨' })
    fireEvent.click(tag)
    const menu = await screen.findByRole('group', { name: '찜 메뉴' })
    expect(menuRows(menu)).toEqual(['찜 되돌리기', '상품 보기', '상품 고치기'])
    fireEvent.click(within(menu).getByRole('button', { name: '찜 되돌리기' }))
    const ask = await screen.findByRole('alertdialog', { name: '15번 찜을 되돌릴까요?' })
    expect(within(ask).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['닫기', '되돌리기'])
    fireEvent.click(within(ask).getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toMatchObject({ type: 'host.assign', b: 'b1', no: 15, buyer: 'u1', reason: '판매자가 지워진 찜을 되돌렸어요' })
    expect(world.events[0]?.body).not.toHaveProperty('replace')
    expect(screen.queryByRole('alert')).toBeNull()
    // 그사이 상태가 달라져 서버가 아무것도 바꾸지 않았다
    world.server.on('POST', /^\/api\/events/, (call) => {
      world.events.push(call)
      world.seq += 1
      return { body: { date: '2026-10-29', rehearsal: false, seq: world.seq, type: 'host.assign', changed: false, effects: [] } }
    })
    fireEvent.click(tag)
    fireEvent.click(within(await screen.findByRole('group', { name: '찜 메뉴' })).getByRole('button', { name: '찜 되돌리기' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: '15번 찜을 되돌릴까요?' })).getByRole('button', { name: '되돌리기' }))
    expect((await screen.findByRole('alert')).textContent).toContain('적용되지 않았어요. 지금 상태를 확인해 주세요.')
  }, SLOW)

  it('[상품 고치기]는 그 상품을 고치는 창을 연다 (가격·품종·번호 칸)', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, SAMPLE)
    await openFeed()
    fireEvent.click(within(await screen.findByRole('list', { name: '찜 기록' })).getByRole('button', { name: '15 찜' }))
    const menu = await screen.findByRole('group', { name: '찜 메뉴' })
    expect(menuRows(menu)).toEqual(['상품 보기', '상품 고치기', '찜 삭제'])
    fireEvent.click(within(menu).getByRole('button', { name: '상품 고치기' }))
    const sheet = await screen.findByTestId('product-sheet')
    expect(within(sheet).getByRole('button', { name: '가격 고치기' }).textContent).toBe('35,000원')
    expect(within(sheet).getByRole('button', { name: '품종 고치기' }).textContent).toBe('핑크프릴')
  }, SLOW)
})

describe('상품 자세히 [찜 넣기] (D-RETRO-54)', () => {
  async function openAdd(world: World) {
    const list = await screen.findByRole('list', { name: '상품 목록' })
    fireEvent.click(within(list).getByRole('button', { name: '상품 자세히 — 15번' }))
    const sheet = await screen.findByTestId('product-sheet')
    fireEvent.click(within(sheet).getByRole('button', { name: '찜 넣기 — 15번' }))
    void world
    return within(sheet).findByRole('group', { name: '찜 넣기' })
  }

  it('손님 이름·전화번호 끝 네 자리를 적고 [닫기 | 찜 넣기] — 문자찜 쓰기를 보내고(전화번호 전체는 없다) 결과 한 줄을 보인 뒤 칸을 닫는다', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, SAMPLE)
    const form = await openAdd(world)
    expect(within(form).getByText('15번에 찜 넣기')).toBeTruthy()
    // 칸을 연 동안 메뉴 줄(상품 삭제 등)은 숨는다
    expect(screen.queryByRole('button', { name: '상품 삭제 — 15번' })).toBeNull()
    const buttons = () => within(form).getAllByRole('button').filter((button) => ['닫기', '15번에 찜 넣기'].includes(button.getAttribute('aria-label') ?? ''))
    // 부정 왼쪽 · 긍정 오른쪽, 한 줄 (D-UX4-01)
    expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual(['닫기', '15번에 찜 넣기'])
    expect(getComputedStyle(buttons()[0]!.parentElement!.parentElement!).flexDirection).toBe('row')
    // 아무것도 적지 않으면 넣을 수 없다
    expect(buttons()[1]?.getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(within(form).getByLabelText('손님 이름'), { target: { value: '박하나' } })
    // 끝 네 자리 칸은 숫자 네 개만 — 전화번호 전체를 붙여도 남지 않는다
    fireEvent.change(within(form).getByLabelText('전화번호 끝 네 자리'), { target: { value: '010-1234-5678' } })
    expect((within(form).getByLabelText('전화번호 끝 네 자리') as HTMLInputElement).value).toBe('0101')
    fireEvent.change(within(form).getByLabelText('전화번호 끝 네 자리'), { target: { value: '56' } })
    fireEvent.click(buttons()[1]!)
    expect(await within(form).findByText('끝 네 자리는 숫자 네 개로 적어 주세요.')).toBeTruthy()
    expect(world.events.length).toBe(0)
    fireEvent.change(within(form).getByLabelText('전화번호 끝 네 자리'), { target: { value: '5678' } })
    // 넣은 뒤 따라잡기: 새 문자 손님이 대기 2번으로 들어왔다
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=7$/, () => ({
      body: changes(7, 8, {
        products: [product(15, { name: '핑크프릴', price: 35_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2', 's9'], waitlistClaims: ['c2', 'c9'] })],
        claims: [claim('c9', 15, 's9', { status: 'WAITLISTED', origin: 'sms', seq: 8 })],
        buyers: [buyer('s9', '문자찜(박하나)', { kind: 'sms', phoneLast4: '5678' })],
      }),
    }))
    fireEvent.click(buttons()[1]!)
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', no: 15, memo: '박하나', last4: '5678' })
    const sheet = screen.getByTestId('product-sheet')
    expect(await within(sheet).findByText('넣었어요 — 문자-5678 · 대기 2')).toBeTruthy()
    expect(within(sheet).queryByRole('group', { name: '찜 넣기' })).toBeNull()
    expect(within(sheet).getByRole('button', { name: '상품 삭제 — 15번' })).toBeTruthy()
    expect(within(within(sheet).getByRole('list', { name: '15번 찜·대기' })).getByText('문자-5678')).toBeTruthy()
  }, SLOW)

  it('이미 있는 손님은 눌러 고른다 — 고른 손님으로만 보내고 이름은 바꾸지 않는다. [닫기]는 아무것도 보내지 않고 메뉴로 돌아간다', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, { ...SAMPLE, buyers: [...SAMPLE.buyers, buyer('u7', '박하나')] })
    const form = await openAdd(world)
    fireEvent.change(within(form).getByLabelText('손님 이름'), { target: { value: '박' } })
    const picks = within(form).getByRole('group', { name: '이미 있는 손님' })
    // 이미 15번을 찜한 손님(홍길동·김영희)은 후보에 없다
    expect(within(picks).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['박하나 고르기'])
    fireEvent.click(within(picks).getByRole('button', { name: '박하나 고르기' }))
    expect(within(form).queryByLabelText('손님 이름')).toBeNull()
    expect(within(form).getByLabelText('고른 손님 박하나')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: '15번에 찜 넣기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', no: 15, buyer: 'u7' })
    // 다시 열어 [닫기]
    const sheet = screen.getByTestId('product-sheet')
    await waitFor(() => expect(within(sheet).queryByRole('group', { name: '찜 넣기' })).toBeNull())
    fireEvent.click(within(sheet).getByRole('button', { name: '찜 넣기 — 15번' }))
    fireEvent.click(within(await within(sheet).findByRole('group', { name: '찜 넣기' })).getByRole('button', { name: '닫기' }))
    expect(within(sheet).queryByRole('group', { name: '찜 넣기' })).toBeNull()
    expect(within(sheet).getByRole('button', { name: '찜 넣기 — 15번' })).toBeTruthy()
    expect(world.events.length).toBe(1)
  }, SLOW)

  it('끝 네 자리가 같은 손님이 여럿이면 서버가 준 후보에서 고르거나 [새 손님으로 넣기]', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, { ...SAMPLE, buyers: [...SAMPLE.buyers, buyer('s2', '문자찜(가)', { kind: 'sms', phoneLast4: '0937' })] })
    let sent = 0
    world.server.on('POST', /^\/api\/events/, (call) => {
      world.events.push(call)
      sent += 1
      if (call.body?.last4 === '0937' && call.body.newBuyer !== true) return { status: 409, body: { error: { code: 'BUYER_AMBIGUOUS', message: '끝자리 0937 손님이 여러 명이에요. 누구인지 골라 주세요.' }, candidates: [{ buyer: 's1', display: '문자찜', phoneLast4: '0937', claims: [88] }, { buyer: 's2', display: '문자찜(가)', phoneLast4: '0937', claims: [] }] } }
      world.seq += 1
      return { body: { date: '2026-10-29', rehearsal: false, seq: world.seq, type: 'sms', changed: true, effects: [] } }
    })
    const form = await openAdd(world)
    fireEvent.change(within(form).getByLabelText('전화번호 끝 네 자리'), { target: { value: '0937' } })
    fireEvent.click(within(form).getByRole('button', { name: '15번에 찜 넣기' }))
    const choose = await within(form).findByRole('group', { name: '손님 고르기' })
    expect(within(choose).getByText('끝자리 0937 손님이 여러 명이에요. 누구인지 골라 주세요.')).toBeTruthy()
    expect(within(choose).getAllByRole('button').map((button) => button.textContent)).toEqual(['문자찜 · 88번', '문자찜(가)', '새 손님으로 넣기'])
    fireEvent.click(within(choose).getByRole('button', { name: '새 손님으로 넣기' }))
    await waitFor(() => expect(sent).toBe(2))
    expect(world.events[1]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', no: 15, last4: '0937', newBuyer: true })
    // 요청 번호는 내용이 바뀌면 새로 — 같은 내용 다시 누르기만 같은 번호
    expect(world.events[1]?.body?.requestId).not.toBe(world.events[0]?.body?.requestId)
    // 다시: 이번에는 후보를 고른다
    const sheet = screen.getByTestId('product-sheet')
    await waitFor(() => expect(within(sheet).queryByRole('group', { name: '찜 넣기' })).toBeNull())
    fireEvent.click(within(sheet).getByRole('button', { name: '찜 넣기 — 15번' }))
    const again = await within(sheet).findByRole('group', { name: '찜 넣기' })
    fireEvent.change(within(again).getByLabelText('전화번호 끝 네 자리'), { target: { value: '0937' } })
    fireEvent.click(within(again).getByRole('button', { name: '15번에 찜 넣기' }))
    fireEvent.click(within(await within(again).findByRole('group', { name: '손님 고르기' })).getByRole('button', { name: '문자찜(가) 고르기' }))
    await waitFor(() => expect(sent).toBe(4))
    expect(world.events[3]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', no: 15, buyer: 's2' })
  }, SLOW)

  it('옵션 상품에는 [찜 넣기]가 없다 (옵션·수량을 골라야 해서)', async () => {
    const world = makeWorld({ products: [product(15, { hasOptions: true })] })
    await open(world, { products: [product(15, { hasOptions: true })] })
    fireEvent.click(within(await screen.findByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 15번' }))
    const sheet = await screen.findByTestId('product-sheet')
    expect(within(sheet).getByRole('button', { name: '상품 삭제 — 15번' })).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: '찜 넣기 — 15번' })).toBeNull()
  }, SLOW)
})
