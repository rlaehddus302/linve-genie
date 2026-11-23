// 찜 기록 번호별 보기·정렬·작은 글자·눌러서 조치, 상품 자세히 [찜 넣기] (D-RETRO-50~54, 복기 F6·F7 — 사용자 지시 2026-11-12
// "찜 목록에서 각 번호를 누르면 내가 원하는 대로 수정 … 글자 크기를 줄여 한 화면에 더 많이 … 번호별로 누가 찜했는지 … 오름차순 … 상품을 눌러 임의로 문자찜 등록").
// 화면은 판정하지 않는다 — 엔진에 이미 있는 방송자 조치(host.promote·host.assign)와 문자찜(sms) 쓰기를 보내는지만 본다.
// D-UX4-151 (사용자 지시 2026-11-16 "번호별 보기를 빼고 상품 탭 [찜 된 것만]으로 통일"): 번호별 보기·그 정렬·"+n명" 접기 시험을 걷거나 손님별 꼬리표로 바꿨다.
// 찾기 칸·도구 줄(D-UX4-152)·시각(D-UX4-154)은 claim-feed-ux4-151 시험에 있다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { getFeedView, resetFeedView } from '../src/lib/feed-view.ts'
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

const openFeed = async () => fireEvent.click(await screen.findByRole('button', { name: '찜' }) /* D-UX4-210 탭 이름 찜 기록 → 찜 */)
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
  // D-UX4-151: [손님별 | 번호별] 고르기와 번호별 줄을 걷었다 — 고르기 줄은 [최근순 | 이름순] · 글자 [크게 | 작게]만, 그 위에 찾기 칸(D-UX4-152)
  // D-UX4-199 (사용자 "정렬 ui도 상품 목록과 맞춰라. 글자 크기 옵션은 지워라"): 옛 기대는 찾기 칸 아래 한 줄에 [최근순 | 이름순] · 글자 [크게 | 작게] 네 단추.
  // 이제 그 줄 오른쪽에 상품 목록 [목록 순서]와 같은 단추 하나(지금 순서 이름) — 누르면 아래 창에서 고른다. 글자 크기 단추는 없다.
  const sortButton = () => screen.getByTestId('feed-sort-button')
  const pickSort = (name: string) => {
    fireEvent.click(sortButton())
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '목록 순서' })).getByRole('radio', { name }))
  }

  it('목록 위 도구 줄: 찾기 칸 아래 줄 오른쪽에 [목록 순서] 단추(기본 최근순) — 글자 크기 고르기·번호별 보기는 없다', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, SAMPLE)
    await openFeed()
    const group = await screen.findByRole('group', { name: '찜 기록 찾기·정렬' })
    // D-UX4-201: 찾기 칸은 머리 돋보기를 눌러 연다(옛: 늘 보임)
    expect(within(group).queryByLabelText('찜 기록 찾기')).toBeNull()
    fireEvent.click(screen.getByTestId('console-search'))
    expect(within(group).getByLabelText('찜 기록 찾기')).toBeTruthy()
    expect(group.contains(sortButton())).toBe(true)
    expect(sortButton().getAttribute('aria-label')).toBe('목록 순서 — 최근순')
    expect(sortButton().textContent).toBe('최근순')
    // 상품 목록 도구 줄과 같은 자리: 둘째 줄 오른쪽(가로 줄, 양 끝 정렬)
    const row = sortButton().parentElement as HTMLElement
    expect(getComputedStyle(row).flexDirection).toBe('row')
    expect(getComputedStyle(row).justifyContent).toBe('space-between')
    expect(row.lastElementChild).toBe(sortButton())
    expect(within(group).getAllByRole('button').filter((button) => button !== sortButton())).toHaveLength(0)
    expect(screen.queryByRole('group', { name: '정렬' })).toBeNull()
    expect(screen.queryByRole('group', { name: '글자 크기' })).toBeNull()
    expect(screen.queryByRole('button', { name: '글자 크게' })).toBeNull()
    expect(screen.queryByRole('button', { name: '글자 작게' })).toBeNull()
    expect(screen.queryByRole('button', { name: '번호별 보기' })).toBeNull()
    expect(screen.queryByRole('list', { name: '번호별 찜 기록' })).toBeNull()
    // 기본: 지금까지의 손님별 (가장 최근에 찜한 손님이 맨 아래)
    expect(labels(screen.getByRole('list', { name: '찜 기록' }))).toEqual(['홍길동 15 찜', '문자-0937 88 보류', '김영희 15 대기 1 · 이미 찜됨 · 1등 홍길동, 7 찜'])
  }, SLOW)

  it('손님별 이름순: 이름 오름차순, 한 손님 안의 번호도 오름차순 — 최근순으로 되돌리면 지금까지와 같다', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, SAMPLE)
    await openFeed()
    await screen.findByTestId('feed-sort-button')
    // 고르는 판: 최근순 · 이름순, 지금 것에 표시 (D-UX4-199 — 상품 목록 고르는 판과 같은 부품)
    fireEvent.click(sortButton())
    const choices = screen.getByRole('radiogroup', { name: '목록 순서' })
    expect(within(choices).getAllByRole('radio').map((radio) => `${radio.getAttribute('aria-label') ?? ''}${radio.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`)).toEqual(['최근순 ✓', '이름순'])
    fireEvent.click(within(choices).getByRole('radio', { name: '이름순' }))
    expect(labels(screen.getByRole('list', { name: '찜 기록' }))).toEqual(['김영희 7 찜, 15 대기 1 · 이미 찜됨 · 1등 홍길동', '문자-0937 88 보류', '홍길동 15 찜'])
    expect(getFeedView().buyerSort).toBe('name')
    expect(sortButton().textContent).toBe('이름순')
    pickSort('최근순')
    expect(labels(screen.getByRole('list', { name: '찜 기록' }))[0]).toBe('홍길동 15 찜')
  }, SLOW)

  // D-UX4-199 (사용자 "글자 크기 옵션은 지워라"): 옛 시험은 [글자 작게]로 꼬리표가 36 → 30으로 낮아지는지 봤다. 이제 그 단추가 없고 꼬리표는 늘 보통 크기.
  it('꼬리표는 늘 보통 크기(높이 36·누르는 폭 48 이상)이고 이름 아래 줄에 놓인다 — 보류 찜 판은 고르기 줄 없이 같은 크기', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, { ...SAMPLE, pending: [{ product: 'b1/88', broadcast: 'b1', no: 88, buyers: ['s1'], claims: ['c3'] } as never] })
    await openFeed()
    const tag = () => within(screen.getByRole('list', { name: '찜 기록' })).getByRole('button', { name: '15 찜' })
    expect(getComputedStyle(tag()).minHeight).toBe('36px')
    expect(getComputedStyle(tag()).minWidth).toBe('48px')
    expect(screen.queryByRole('button', { name: '글자 작게' })).toBeNull()
    // (D-UX4-151: 번호별 꼬리표의 같은 확인은 번호별 보기와 함께 걷었다)
    // D-ALERTFLOAT-01 (사용자 지시 2026-11-17): 옛 "보류 찜 판"(손님별 꼬리표 목록, 도구 줄 없음)을 없앴다 —
    // 등록 안 된 번호의 찜은 오른쪽 아래 빨간 알림 하나로 알리고, 도구 줄은 여전히 찜 기록 탭의 하나뿐
    expect(screen.getByRole('button', { name: '등록 안 된 번호에 찜 1건' })).toBeTruthy()
    expect(screen.getAllByRole('group', { name: '찜 기록 찾기·정렬' })).toHaveLength(1)
  }, SLOW)

  // D-UX4-151: 번호 줄의 "+n명" 접기·펼치기 시험은 번호별 보기와 함께 걷었다 (손님별 줄은 접지 않는다)
})

describe('찜을 눌러 조치 (D-RETRO-53)', () => {
  const menuRows = (menu: HTMLElement) => within(menu).getAllByRole('button').map((button) => button.getAttribute('aria-label'))

  // D-UX4-151: 번호별 꼬리표 "김영희 대기 1" 대신 손님별 줄의 꼬리표 "15 대기 1"을 누른다 (메뉴·보내는 것은 같다)
  it('대기 찜(손님별 꼬리표)을 누르면 [찜으로 올리기 · 상품 보기 · 상품 고치기 · 찜 삭제] — 자리가 찼으면 "지금 찜인 손님은 대기 1번으로" 묻고 [닫기 | 올리기] 뒤 교체 배정을 보낸다', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, SAMPLE)
    await openFeed()
    fireEvent.click(within(await screen.findByRole('list', { name: '찜 기록' })).getByRole('button', { name: '15 대기 1 · 이미 찜됨 · 1등 홍길동' }))
    const menu = await screen.findByRole('group', { name: '찜 메뉴' })
    expect(screen.getByText('15번 찜')).toBeTruthy()
    expect(within(menu).getByText('김영희')).toBeTruthy()
    // 판 머리에 그 찜을 받은 시각 — 초까지 (D-UX4-154, 11:00:02Z = 한국 20:00:02)
    expect(within(menu).getByLabelText('찜한 시각 20:00:02').textContent).toBe('20:00:02')
    // D-STK-02 (사용자 지시 2026-11-16 "동일 상품 번호에 여러 개 … 뒷사람도 라벨"): 대기 1번 찜 맨 위에 [이 손님에게도 팔기]가 더해졌다 (옛 기대: 아래 넷)
    // D-PASS-END-01 (사용자 2026-11-23 "라방 끝나고 찜 패스 처리하는 방법 필요함"): 살아 있는 찜에 [패스 처리]가 [찜 삭제] 위에 더해졌다
    expect(menuRows(menu)).toEqual(['이 손님에게도 팔기', '찜으로 올리기', '상품 보기', '상품 고치기', '패스 처리', '찜 삭제'])
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
    expect(menuRows(menu)).toEqual(['상품 보기', '상품 고치기', '패스 처리', '찜 삭제']) // [패스 처리] D-PASS-END-01
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

  // 스펙 변경 (D-CLAIMADD-05, 사용자 지시 2026-11-18 "그냥 문자찜으로 넣거나 아니면 최근 채팅친 사람 닉네임으로 넣거나. 맨 위에는 '문자찜', 그 아래는
  // 최근 채팅 닉네임 순 … 그외는 다 지워"). 옛 기대: 제목 "15번에 찜 넣기", 손님 이름·전화번호 끝 네 자리 칸과 [닫기 | 찜 넣기/문자찜으로 넣기] 한 줄,
  // 끝 네 자리 숫자 네 개 검사, 이미 있는 손님 후보 고르기, 끝 네 자리 겹침 때 서버 후보·[새 손님으로 넣기], 최근 채팅 손님 캡슐(named 없음).
  it('맨 위 [문자찜] 줄 → 이름·번호 없는 문자찜을 보내고 결과 한 줄을 보인 뒤 칸을 닫는다 — 이름·끝 네 자리 칸·제목은 없다 (D-CLAIMADD-05)', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, SAMPLE)
    const form = await openAdd(world)
    // 칸을 연 동안 메뉴 줄(상품 삭제 등)은 숨는다
    expect(screen.queryByRole('button', { name: '상품 삭제 — 15번' })).toBeNull()
    expect(within(form).queryByLabelText('손님 이름')).toBeNull()
    expect(within(form).queryByLabelText('전화번호 끝 네 자리')).toBeNull()
    expect(within(form).queryByRole('switch')).toBeNull()
    expect(within(form).queryByText('15번에 찜 넣기')).toBeNull()
    expect(within(form).getAllByRole('button')[0]?.getAttribute('aria-label')).toBe('15번에 문자찜으로 넣기')
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=7$/, () => ({
      body: changes(7, 8, {
        products: [product(15, { name: '핑크프릴', price: 35_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2', 's9'], waitlistClaims: ['c2', 'c9'] })],
        claims: [claim('c9', 15, 's9', { status: 'WAITLISTED', origin: 'sms', seq: 8 })],
        buyers: [buyer('s9', '문자찜', { kind: 'sms' })],
      }),
    }))
    fireEvent.click(within(form).getByRole('button', { name: '15번에 문자찜으로 넣기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', no: 15 })
    const sheet = screen.getByTestId('product-sheet')
    // D-PILLX-01 (사용자 지시 2026-11-18 "넣었어요 이딴 알림 지우고"): 옛 기대는 "넣었어요 — … · 대기 2" 한 줄. 이제 알림 없이 이름 알약이 하나 는다
    await waitFor(() => expect(within(within(sheet).getByRole('list', { name: '15번 찜·대기' })).getAllByRole('button')).toHaveLength(3))
    expect(within(sheet).queryByText(/^넣었어요/)).toBeNull()
    expect(within(sheet).queryByRole('group', { name: '찜 넣기' })).toBeNull()
    expect(within(sheet).getByRole('button', { name: '상품 삭제 — 15번' })).toBeTruthy()
  }, SLOW)

  it('최근 채팅 손님 줄을 누르면 그 손님 닉네임으로 바로 넣는다(named) — 이미 15번을 찜한 손님·방송자는 보이지 않는다 (D-CLAIMADD-01·05)', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    const message = (seq: number, channel: string, text: string, owner = false) => ({
      id: `m${String(seq)}`, broadcast: 'b1', channel, nick: channel, text, owner, seq, at: '2026-10-29T11:00:00.000Z', publishedAt: '2026-10-29T11:00:00.000Z',
      ignored: false, order: false, cancel: false, orders: [], cancels: [], mentions: [], converted: [], claims: [], failed: false,
    })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/messages/, () => ({
      body: { date: '2026-10-29', rehearsal: false, seq: 7, more: false, messages: [message(1, 'u7', '안녕하세요'), message(2, 'u1', '15번이요'), message(3, 'own', '시작할게요', true), message(4, 'u8', '418. 하고94. 번주세요')] },
    }))
    await open(world, { ...SAMPLE, buyers: [...SAMPLE.buyers, buyer('u7', '박하나'), buyer('u8', '이두리'), buyer('own', '방송자')] })
    const form = await openAdd(world)
    const recent = await within(form).findByRole('group', { name: '최근 채팅 손님' })
    // 새 채팅부터 — 닉네임 아래 채팅 앞부분
    expect(within(recent).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['이두리 손님으로 15번에 찜 넣기', '박하나 손님으로 15번에 찜 넣기'])
    expect(within(recent).getByText('418. 하고94.…')).toBeTruthy()
    // [문자찜]이 맨 위, 최근 채팅 손님이 그 아래
    const all = within(form).getAllByRole('button').map((button) => button.getAttribute('aria-label'))
    expect(all.indexOf('15번에 문자찜으로 넣기')).toBeLessThan(all.indexOf('이두리 손님으로 15번에 찜 넣기'))
    fireEvent.click(within(recent).getByRole('button', { name: '이두리 손님으로 15번에 찜 넣기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', no: 15, buyer: 'u8', named: true })
  }, SLOW)

  it('[닫기]는 아무것도 보내지 않고 메뉴로 돌아간다', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, SAMPLE)
    const form = await openAdd(world)
    fireEvent.click(within(form).getByRole('button', { name: '닫기' }))
    const opened = screen.getByTestId('product-sheet')
    expect(within(opened).queryByRole('group', { name: '찜 넣기' })).toBeNull()
    expect(within(opened).getByRole('button', { name: '찜 넣기 — 15번' })).toBeTruthy()
    expect(world.events.length).toBe(0)
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

describe('상품 자세히 이름 알약 (D-PILLX-01)', () => {
  it('지울 수 있는 찜·대기 알약은 오른쪽에 × — 끝난 라이브처럼 누를 수 없으면 없다', async () => {
    const world = makeWorld({ products: [product(15), product(7)] })
    await open(world, SAMPLE)
    fireEvent.click(within(await screen.findByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 15번' }))
    const sheet = await screen.findByTestId('product-sheet')
    const pills = within(within(sheet).getByRole('list', { name: '15번 찜·대기' })).getAllByRole('button')
    expect(pills.length).toBeGreaterThan(0)
    for (const pill of pills) expect(within(pill).getByTestId('pill-remove-mark')).toBeTruthy()
  }, SLOW)
})
