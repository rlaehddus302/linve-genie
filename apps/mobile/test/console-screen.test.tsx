// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 방송 중 화면 (APP-01 AC1·AC5, APP-02, APP-04, D-UX2-03): 서버 상품이 리스트에 보이고, "직접 넣기"의 빠른 입력 한 줄이 등록 요청이 되며,
// 실시간 change로 1등(찜)이 보이고, 뒤로 갔다 돌아오면 다시 잇고 "자리를 비운 동안 찜 n건"이 보이며, 듣기 시작 → 안내 → 서버가 읽은 결과로 바로 등록된다.
// 새 시안(D-UX2-03)으로 바뀐 것: "현재 상품" 카드·알림 띠 대신 상품 리스트(줄을 누르면 자세히 시트), 빠른 입력·문자찜은 "직접 넣기" 시트,
// 음성 켜기/끄기는 아래 고정 버튼 "듣기 시작/듣기 멈추기", 음성 상태는 머리의 "듣는 중". 요청 본문·막힘 조건 기대는 그대로다.
// D-UX4-20~31 (사용자 지시 2026-11-09)로 바뀐 것: ⋯ 메뉴 판 → 톱니로 여는 "방송 설정" 화면, "직접 넣기" 빠른 입력 → 상품 탭 (+) 상품 추가 화면,
// 문자찜 칸은 설정 화면 "문자찜 직접 넣기", 상품 자세히는 점선 칸(바로 고치기)·이름 알약(눌러 찜 삭제)·상품 삭제, 찜 기록 꼬리표를 눌러 찜 삭제.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen, LINK_TITLE, THANKS_TITLE } from '../src/screens/ConsoleScreen.tsx'
import { END_LINK_LABEL } from '../src/screens/console/EndBroadcast.tsx'
import { ASK_ADD, ASK_NAME, ASK_NO, ASK_PRICE } from '../src/screens/console/ProductAdd.tsx'
import { DOCK_STATE } from '../src/screens/console/StreamAudio.tsx'
import { LISTEN_START, LISTEN_STATE, VOICE_CONSENT_LINES } from '../src/lib/words.ts'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST, BROADCAST_VIEW, SETTINGS, buyer, changes, claim, flush, fullView, product } from './support.ts'

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
}

async function open(world: ReturnType<typeof makeWorld>) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
}

// 휴대폰 마이크·문자찜 칸은 머리 톱니로 여는 방송 설정 화면에 있다 (D-UX3-73 → D-UX4-20)
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: '라이브 관리' }))
/** 쓰기 뒤 따라잡기 — 바뀐 것 없이 seq만 (여러 번 쓰는 흐름용) */
const followWrites = (world: ReturnType<typeof makeWorld>) => world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, {}) }))
/** 앱 숫자판으로 친다 */
const typePad = (digits: string) => {
  const pad = screen.getByRole('group', { name: '숫자판' })
  for (const key of digits) fireEvent.click(within(pad).getByRole('button', { name: key }))
}

describe('ConsoleScreen', () => {
  // D-UX3-87 (사용자 지시 2026-11-09 "상품 목록은 가장 최근에 말한게 가장 위로"): 상품만 D-UX3-75(최신이 맨 아래)를 되돌린다
  it('상품 목록은 가장 최근에 올린 상품이 맨 위 (D-UX3-87)', async () => {
    const world = makeWorld({ products: [product(15), product(16)] })
    await open(world)
    const list = await screen.findByRole('list', { name: '상품 목록' })
    const labels = within(list).getAllByRole('button').map((row) => row.getAttribute('aria-label') ?? '')
    expect(labels.findIndex((label) => label.includes('16번'))).toBeLessThan(labels.findIndex((label) => label.includes('15번')))
  })

  // D-UX3-81로 바뀐 기대 (사용자 지시 2026-11-09 "상품, 찜기록은 위로 정렬, 채팅문자는 아래로 정렬"): 옛 D-UX3-77 "모두 아래"
  it('상품·찜 기록 목록은 위에, 채팅·문자는 화면 아래에 붙는다 (D-UX3-81)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    expect(getComputedStyle(screen.getByTestId('console-list')).justifyContent).toBe('flex-start')
    fireEvent.click(screen.getByRole('button', { name: '찜 기록' }))
    expect(getComputedStyle(screen.getByTestId('console-list')).justifyContent).toBe('flex-start')
    fireEvent.click(screen.getByRole('button', { name: '채팅·문자' }))
    expect(getComputedStyle(screen.getByTestId('console-list')).justifyContent).toBe('flex-end')
  })

  it('서버에 등록된 상품이 리스트에 크게 보이고, 누르면 자세히가 열리며 상태 낱말은 한국어다', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', price: 12_000 })] })
    await open(world)
    const list = screen.getByRole('list', { name: '상품 목록' })
    expect(within(list).getByText('15번')).toBeTruthy()
    expect(within(list).getByText('핑크프릴')).toBeTruthy()
    expect(within(list).getByText('12,000원')).toBeTruthy()
    // 찜·대기가 없으면 아래 줄을 그리지 않는다 (D-UX3-78 — 옛 기대: '아직 예약 없음')
    expect(list.textContent).not.toContain('예약')
    expect(within(list).queryByRole('list', { name: '15번 찜한 손님' })).toBeNull()
    expect(screen.queryByText(/OPEN|CONFIRMED/)).toBeNull()
    // 알릴 것이 없으면 경고 줄을 그리지 않는다 (옛 기대: "알림 없음" 띠)
    expect(screen.queryByRole('region', { name: '알림' })).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: '상품 자세히 — 15번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    // 옛 기대: 상태 낱말 "판매 중"·가격. 새 기대(D-UX4-30): 번호·품종·가격 점선 칸만 — 판매 완료·찜 요약·"아직 찜이 없어요"·일시 중지·판매 종료는 없다
    expect(within(detail).getByRole('button', { name: '번호 고치기' }).textContent).toBe('15번')
    expect(within(detail).getByRole('button', { name: '품종 고치기' }).textContent).toBe('핑크프릴')
    expect(within(detail).getByRole('button', { name: '가격 고치기' }).textContent).toBe('12,000원')
    for (const gone of ['판매 중', '아직 찜이 없어요', '일시 중지', '판매 종료']) expect(detail.textContent).not.toContain(gone)
    expect(within(detail).getByRole('button', { name: '상품 삭제 — 15번' })).toBeTruthy()
    // D-UX4-103으로 바뀐 기대 (옛: 상품 자세히 아래 창의 [닫기] 단추를 눌러 닫음): 아래 창에는 닫기 단추가 없다 — 바깥(판 닫기)을 눌러 닫는다
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    // 옛 기대: 방송 메뉴 → 직접 넣기의 [보내기]. 새 기대(D-UX4-31): 상품 탭 오른쪽 아래 (+) 상품 추가
    expect(screen.getByRole('button', { name: '상품 추가' })).toBeTruthy()
  })

  // 옛 시험: 빠른 입력 한 줄 → product.register(text)·5초 되돌리기. 새 기대(D-UX4-31, 사용자 지시 2026-11-09): (+) → 한 번에 하나씩 묻는 상품 추가 화면
  it('(+) 상품 추가: 앱 숫자판으로 번호 → [다음] → 가격(한글 금액) → 확인 "15번 / 15,000원 / 상품을 추가할까요?" → [추가하기]면 원문 칸으로 등록하고 돌아온다', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    followWrites(world)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    expect(within(page).getByText(ASK_NO)).toBeTruthy()
    // 옛 기대: 값이 없으면 [다음]이 없다. 새 기대(D-UX4-54, 사용자 지시 2026-11-09 "안보이게 하지말고 비활성화로"): 보이되 눌리지 않는다
    expect(within(page).getByRole('button', { name: '다음' }).getAttribute('aria-disabled')).toBe('true')
    typePad('16')
    expect(within(page).getByText('16번')).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    expect(within(page).getByText(ASK_PRICE)).toBeTruthy()
    // 번호는 위로 올라간다
    expect(within(page).getByRole('button', { name: '번호 16번 고치기' })).toBeTruthy()
    typePad('15000')
    expect(within(page).getByText('15,000원')).toBeTruthy()
    expect(within(page).getByText('1만 5,000원')).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '지우기' }))
    expect(within(page).getByText('1,500원')).toBeTruthy()
    // 만 원 아래는 한글 읽기를 따로 그리지 않는다
    expect(within(page).getAllByText('1,500원')).toHaveLength(1)
    typePad('0')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    // 다육이 방송이 아니면 품종을 묻지 않고 바로 확인
    expect(within(page).queryByText(ASK_NAME)).toBeNull()
    expect(within(page).getByText('16번')).toBeTruthy()
    expect(within(page).getByText('15,000원')).toBeTruthy()
    expect(within(page).getByText(ASK_ADD)).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '추가하기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    // 원문 칸(SRV1 약속 2): 가격은 "원"을 붙여 — 천원 단위 방송에서도 15,000원으로 읽힌다
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.register', b: 'b1', noText: '16', priceText: '15000원', name: '' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '상품 추가' })).toBeNull())
  })

  it('다육이 라이브가면 상품 추가가 품종도 묻는다 — 품종 칸은 휴대폰 키보드, 확인에 "15번 / 삼광색금 / 15,000원" (D-UX4-31)', async () => {
    const world = makeWorld({ products: [] })
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, title: '2026-10-29 목요일 다육이 라이브' }] } }))
    await open(world)
    followWrites(world)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    typePad('15')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    typePad('15000')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    const name = within(page).getByLabelText(ASK_NAME)
    // 품종 단계에는 앱 숫자판이 없다
    expect(within(page).queryByRole('group', { name: '숫자판' })).toBeNull()
    fireEvent.change(name, { target: { value: '삼광색금' } })
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    for (const line of ['15번', '삼광색금', '15,000원', ASK_ADD]) expect(within(page).getByText(line)).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '추가하기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.register', b: 'b1', noText: '15', priceText: '15000원', name: '삼광색금' })
  })

  it('상품 추가: 이미 있는 번호·100원 미만 가격은 그 자리에서 알리고 넘어가지 않는다 — 보내지 않는다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    fireEvent.click(screen.getByRole('button', { name: '상품 추가' }))
    const page = await screen.findByRole('dialog', { name: '상품 추가' })
    typePad('15')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    expect(within(page).getByText('15번은 이미 있어요. 다른 번호를 적어 주세요.')).toBeTruthy()
    fireEvent.click(within(page).getByRole('button', { name: '지우기' }))
    typePad('7')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    typePad('50')
    fireEvent.click(within(page).getByRole('button', { name: '다음' }))
    expect(within(page).getByText('가격은 100원 이상으로 적어 주세요.')).toBeTruthy()
    expect(within(page).queryByText(ASK_ADD)).toBeNull()
    expect(world.events.length).toBe(0)
  })

  it('D-LIVETEST-07·D-UX3-79 찜 기록: 구매자별 한 줄에 이름(문자 손님은 문자-끝 4자리)과 찜한 번호 꼬리표가 찜한 순서로, 이미 1등이 있는 번호는 "이미 찜됨 · 1등"으로 읽히고, 보류 찜 칸을 누르면 보류 찜만 연다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({
      body: changes(5, 7, {
        products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] })],
        claims: [
          claim('c1', 15, 'u1'),
          claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11, rankTime: '2026-10-29T11:00:09.000Z' }),
          claim('c3', 88, 'u3', { status: 'PENDING', origin: 'sms', productId: null, seq: 12, rankTime: '2026-10-29T11:00:12.000Z' }),
          claim('c4', 243, 'u1', { seq: 13, rankTime: '2026-10-29T11:00:15.000Z' }),
        ],
        pending: [{ product: 'b1/88', broadcast: 'b1', no: 88, buyers: ['u3'], claims: ['c3'] } as never],
        buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희'), buyer('u3', '문자손님', { kind: 'sms', phoneLast4: '0937' })],
      }),
    }))
    await act(async () => {
      world.source().emit('change', { date: '2026-10-29', rehearsal: false, seq: 7, type: 'chat' })
      await flush()
    })
    fireEvent.click(await screen.findByRole('button', { name: '찜 기록' }))
    const feed = await screen.findByRole('list', { name: '찜 기록' })
    const rows = within(feed).getAllByRole('listitem')
    // D-UX3-79로 바뀐 기대 (사용자 지시 2026-11-09 "구매자별로 번호를 묶는 느낌"): 옛 기대는 찜 하나가 한 줄(시각·어디서·이름·번호·결과 + 채팅 원문).
    // 이제 손님 하나가 한 줄 — 가장 최근에 찜한 손님이 맨 아래(D-UX3-75), 한 손님 안의 번호는 찜한 순서, 시각은 그리지 않는다.
    // D-UX3-83로 바뀐 기대 (사용자 지시 2026-11-09 "찜은 금색 [123 찜], 대기는 회색 [123 대기 1]"): 옛 기대는 꼬리표에 번호만, 읽기 낱말 "15번 1등"·"대기 1번"
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      '김영희 15 대기 1 · 이미 찜됨 · 1등 홍길동',
      '문자-0937 88 보류',
      '홍길동 15 찜, 243 찜',
    ])
    expect(within(rows[2]!).getByText('홍길동')).toBeTruthy()
    expect(within(rows[2]!).getByText('15 찜')).toBeTruthy()
    expect(within(rows[2]!).getByText('243 찜')).toBeTruthy()
    expect(within(rows[0]!).getByText('15 대기 1')).toBeTruthy()
    expect(within(rows[1]!).getByText('88 보류')).toBeTruthy()
    expect(within(rows[1]!).getByText('문자-0937')).toBeTruthy()
    expect(rows[1]?.textContent).not.toContain('문자손님')
    expect(feed.textContent).not.toMatch(/\d{1,2}:\d{2}/)
    fireEvent.click(screen.getByRole('button', { name: /^보류 찜 1/ }))
    const pendingRows = await waitFor(() => {
      const lists = screen.getAllByRole('list', { name: '찜 기록' })
      const only = lists.find((list) => within(list).queryAllByRole('listitem').length === 1)
      expect(only).toBeTruthy()
      return within(only!).getAllByRole('listitem')
    })
    expect(pendingRows[0]?.getAttribute('aria-label')).toBe('문자-0937 88 보류')
  })

  // D-UX4-27·25 (사용자 지시 2026-11-09 "[140 찜] 이런 각 항목을 누르면 아래에서 메뉴 … 찜 삭제 … 삭제하면 그 다음 대기 1이 찜되게")
  it('찜 기록 꼬리표를 누르면 "15번 찜" 메뉴 → 찜 삭제 → "15번 찜을 삭제할까요?" [닫기 | 삭제] → 진행자 취소, 승계가 진행자 결정으로 남으면 대기 1을 1등으로', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5$/, () => ({
      body: changes(5, 7, {
        products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] })],
        claims: [claim('c1', 15, 'u1'), claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11 })],
        buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희')],
      }),
    }))
    await act(async () => {
      world.source().emit('change', { date: '2026-10-29', rehearsal: false, seq: 7, type: 'chat' })
      await flush()
    })
    world.seq = 7
    // 취소 뒤 따라잡기: 1등 자리가 비고 승계 결정 필요(ASK)로 남았다
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=7$/, () => ({
      body: changes(7, 8, {
        products: [product(15, { awaitingSuccession: true, waitlist: ['u2'], waitlistClaims: ['c2'] })],
        claims: [claim('c1', 15, 'u1', { status: 'CANCELLED' }), claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11 })],
      }),
    }))
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=8$/, () => ({ body: changes(8, 9, {}) }))
    fireEvent.click(await screen.findByRole('button', { name: '찜 기록' }))
    const feed = await screen.findByRole('list', { name: '찜 기록' })
    fireEvent.click(within(feed).getByRole('button', { name: '15 찜' }))
    const menu = await screen.findByRole('group', { name: '찜 메뉴' })
    expect(screen.getByText('15번 찜')).toBeTruthy()
    expect(within(menu).getByText('홍길동')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('button', { name: '찜 삭제' }))
    const ask = await screen.findByRole('alertdialog', { name: '15번 찜을 삭제할까요?' })
    // 부정 왼쪽 · 긍정 오른쪽 (D-UX4-01)
    expect(within(ask).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['닫기', '삭제'])
    fireEvent.click(within(ask).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(world.events.length).toBe(2))
    expect(world.events[0]?.body).toMatchObject({ type: 'host.cancel', b: 'b1', no: 15, buyer: 'u1', reason: '판매자가 찜을 삭제했어요' })
    expect(world.events[1]?.body).toMatchObject({ type: 'host.promote', b: 'b1', no: 15, buyer: 'u2' })
  })

  it('D-UX4-12 채팅·문자 탭: 찜 기록 옆 탭에 채팅과 손님 문자가 받은 시각 순(최신이 맨 아래 — D-UX3-75)으로, 한 줄에 시각(20:00)·굵은 닉네임(문자는 "문자-끝번호")·내용·결과 꼬리표(15번 찜 금색 · 15번 대기 1 회색), 줄 바탕·출처 꼬리표·문자 설명 없이(D-UX3-80·82) 보이고 새 문자 알림이 오면 다시 읽는다', async () => {
    const world = makeWorld({ products: [product(15)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/messages/, () => ({ body: { messages: [{ id: 'm1', broadcast: 'b1', channel: 'ch1', nick: '김영희', text: '15번 주세요', owner: false, seq: 11, at: '2026-10-29T11:00:05.000Z', publishedAt: '2026-10-29T11:00:05.000Z', ignored: false, order: true, cancel: false, orders: [15], cancels: [], mentions: [], converted: [], claims: [], failed: false }, { id: 'm3', broadcast: 'b1', channel: 'ch3', nick: '홍길동', text: '15', owner: false, seq: 12, at: '2026-10-29T11:00:06.000Z', publishedAt: '2026-10-29T11:00:06.000Z', ignored: false, order: true, cancel: false, orders: [15], cancels: [], mentions: [], converted: [], claims: ['c1'], failed: false }, { id: 'm4', broadcast: 'b1', channel: 'ch4', nick: '박철수', text: '15 저도', owner: false, seq: 13, at: '2026-10-29T11:00:07.000Z', publishedAt: '2026-10-29T11:00:07.000Z', ignored: false, order: true, cancel: false, orders: [15], cancels: [], mentions: [], converted: [], claims: ['c2'], failed: false }], more: false } }))
    let smsReads = 0
    let feed: unknown[] = [{ id: 's1', at: '2026-10-29T11:00:09.000Z', last4: '5678', sender: null, text: '15 홍길동', result: 'claim', numbers: [15] }]
    world.server.on('GET', /^\/api\/inbox\/sms\?b=b1$/, () => {
      smsReads++
      return { body: { messages: feed } }
    })
    await open(world)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({
      body: changes(5, 7, {
        products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] })],
        claims: [claim('c1', 15, 'u1'), claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11 })],
        buyers: [buyer('u1', '홍길동'), buyer('u2', '박철수')],
      }),
    }))
    await act(async () => {
      world.source().emit('change', { date: '2026-10-29', rehearsal: false, seq: 7, type: 'chat' })
      await flush()
    })
    const tab = screen.getByRole('button', { name: '채팅·문자' })
    // 탭은 상품·찜 기록과 한 줄 (위아래로 쌓지 않는다)
    expect(screen.getByRole('tablist', { name: '보기' }).children).toHaveLength(3)
    fireEvent.click(tab)
    const list = await screen.findByRole('list', { name: '채팅·문자' })
    // D-UX3-80으로 바뀐 기대 (사용자 지시 2026-11-09 "맨 왼쪽에 닉네임(문자는 문자-0937), 그 다음 내용, 그 다음 (243번 찜) or (342번 대기 1), 시간은 버려")
    await waitFor(() => expect(within(list).getAllByRole('listitem').map((row) => row.getAttribute('aria-label'))).toEqual(['김영희', '홍길동', '박철수', '문자-5678']))
    const rows = within(list).getAllByRole('listitem')
    // D-UX3-82로 바뀐 기대 (사용자 지시 2026-11-09 "괄호로 하란 뜻이 아니라 별도 배경 태그로 … 찜은 금색, 대기는 회색. 맨 왼쪽에 23:23 형식으로 시간 추가 … 손님문자에요 설명 삭제")
    // D-UX4-66 (사용자 지시 2026-11-10 "닉네임 오른쪽에 태그를 … [...번 찜], [...번 대기 1] 이런 식으로"): 시각 · 닉네임 · 꼬리표 · 내용
    // 옛 기대: '20:00김영희  15번 주세요주문 15번' (꼬리표가 내용 뒤, 찜 전 주문은 "주문 15번")
    expect(rows.map((row) => row.textContent)).toEqual(['20:00김영희15번 주문15번 주세요', '20:00홍길동15번 찜15', '20:00박철수15번 대기 115 저도', '20:00문자-567815번 찜15 홍길동'])
    expect(within(list).queryByText(/[()]|^채팅$|^문자$/)).toBeNull()
    // 찜은 금색 꼬리표, 대기는 회색 꼬리표 (바탕이 있는 따로 된 꼬리표)
    const tagBg = (word: string) => (within(list).getAllByText(word)[0]?.parentElement as HTMLElement | null)?.style.backgroundColor
    expect(tagBg('15번 찜')).toBe('rgb(248, 227, 163)')
    expect(tagBg('15번 대기 1')).toBeTruthy()
    expect(tagBg('15번 대기 1')).not.toBe(tagBg('15번 찜'))
    // 줄에는 바탕이 없다
    expect(rows.every((row) => row.style.backgroundColor === '')).toBe(true)
    expect(screen.queryByText(/손님 문자예요/)).toBeNull()
    expect(screen.queryByText(/claim|none|review/)).toBeNull()
    // 다른 방송의 알림은 지나치고, 이 방송의 새 문자 알림이 오면 다시 읽는다
    const before = smsReads
    feed = [{ id: 's2', at: '2026-10-29T11:00:20.000Z', last4: '1111', sender: null, text: '안녕하세요', result: 'none', numbers: [] }, ...feed]
    await act(async () => {
      for (const source of world.sources) source.emit('inbox', { kind: 'sms', b: 'b9' })
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    expect(smsReads).toBe(before)
    await act(async () => {
      for (const source of world.sources) source.emit('inbox', { kind: 'sms', b: 'b1' })
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    await waitFor(() => expect(within(screen.getByRole('list', { name: '채팅·문자' })).getAllByRole('listitem').at(-1)?.textContent).toContain('찜 아님'))
  })

  it('실시간 change가 오면 증분을 받아 1등·대기가 이름과 낱말로 보인다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({
      body: changes(5, 7, {
        products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] })],
        claims: [claim('c1', 15, 'u1'), claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11 })],
        buyers: [
          { id: 'u1', kind: 'youtube', current: 'u1', mergedInto: null, merged: [], display: '홍길동', nameHistory: ['홍길동'], phoneLast4: null, items: ['b1/15'], subtotal: 10_000, byBroadcast: { b1: 10_000 }, blocked: false },
          { id: 'u2', kind: 'youtube', current: 'u2', mergedInto: null, merged: [], display: '김영희', nameHistory: ['김영희'], phoneLast4: null, items: [], subtotal: 0, byBroadcast: {}, blocked: false },
        ],
      }),
    }))
    await act(async () => {
      world.source().emit('change', { date: '2026-10-29', rehearsal: false, seq: 7, type: 'chat' })
      await flush()
    })
    // 리스트 둘째 줄: [찜 1등] 금색 꼬리표 → 대기 손님 회색 꼬리표 (D-UX3-78 — 옛 기대: '예약 홍길동 · 대기 1명')
    const board = screen.getByRole('list', { name: '상품 목록' })
    const tags = await within(board).findByRole('list', { name: '15번 찜한 손님' })
    // 옛 기대(D-UX3-78): ['찜 홍길동', '김영희']. 새 기대(D-UX4-24): 닉네임만 — 1등·대기는 색으로
    expect(within(tags).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['홍길동', '김영희'])
    expect(board.textContent).not.toContain('예약')
    fireEvent.click(within(board).getByRole('button', { name: '상품 자세히 — 15번' }))
    // 옛 기대: 시트 찜 목록 "찜 홍길동 · 대기 1번 김영희". 새 기대(D-UX4-30): 이름 알약만, 1등 → 대기 순서 (읽기 이름에 찜·대기)
    const list = await screen.findByRole('list', { name: '15번 찜·대기' })
    expect(within(list).getAllByRole('button').map((pill) => pill.getAttribute('aria-label'))).toEqual(['홍길동 찜', '김영희 대기'])
    expect(list.textContent).toBe('홍길동김영희')
  })

  it('상품 자세히의 이름 알약을 누르면 "찜을 삭제할까요? 문자-0937" [닫기 | 삭제] → 진행자 취소 (D-UX4-30)', async () => {
    const world = makeWorld({ products: [product(15)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=false)?$/, () => ({
      body: fullView({ seq: world.seq, products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u3'], waitlistClaims: ['c3'] })], claims: [claim('c1', 15, 'u1'), claim('c3', 15, 'u3', { status: 'WAITLISTED', origin: 'sms', seq: 12 })], buyers: [buyer('u1', '홍길동'), buyer('u3', '문자손님', { kind: 'sms', phoneLast4: '0937' })] }),
    }))
    await open(world)
    followWrites(world)
    fireEvent.click(within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 15번' }))
    const list = await screen.findByRole('list', { name: '15번 찜·대기' })
    fireEvent.click(within(list).getByRole('button', { name: '문자-0937 대기' }))
    const ask = await screen.findByRole('alertdialog', { name: '찜을 삭제할까요?' })
    expect(ask.textContent).toContain('문자-0937')
    fireEvent.click(within(ask).getByRole('button', { name: '닫기' }))
    expect(world.events.length).toBe(0)
    fireEvent.click(within(list).getByRole('button', { name: '문자-0937 대기' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: '찜을 삭제할까요?' })).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toMatchObject({ type: 'host.cancel', b: 'b1', no: 15, buyer: 'u3' })
  })

  // D-UX4-28 (사용자 지시 2026-11-09 "상품 삭제 메뉴 … 상품을 삭제할까요? 123번 삼광색금 50,000원 닫기 | 삭제")
  it('상품 삭제: "상품을 삭제할까요?" 팝업에 상품 한 줄 → [삭제]면 대기를 먼저, 1등을 맨 나중에 취소하고 판매 종료한다', async () => {
    const world = makeWorld({ products: [product(123)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=false)?$/, () => ({
      body: fullView({ seq: world.seq, products: [product(123, { name: '삼광색금', price: 50_000, status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] })], claims: [claim('c1', 123, 'u1'), claim('c2', 123, 'u2', { status: 'WAITLISTED', seq: 12 })], buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희')] }),
    }))
    await open(world)
    followWrites(world)
    fireEvent.click(within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 123번' }))
    fireEvent.click(await screen.findByRole('button', { name: '상품 삭제 — 123번' }))
    const ask = await screen.findByRole('alertdialog', { name: '상품을 삭제할까요?' })
    expect(ask.textContent).toContain('123번 삼광색금 50,000원')
    expect(ask.textContent).toContain('찜 2건도 함께 지워져요.')
    fireEvent.click(within(ask).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(world.events.length).toBe(3))
    expect(world.events.map((call) => [call.body?.type, call.body?.buyer])).toEqual([['host.cancel', 'u2'], ['host.cancel', 'u1'], ['product.close', undefined]])
    expect(world.events[2]?.body).toMatchObject({ b: 'b1', no: 123 })
  })

  // 옛 기대(D-UX4-30): 칸을 누르면 그 자리 입력 칸 — 칸을 나가면(blur) 바로 보냈다(가격 → 품종 → 번호 각각 한 번씩).
  // 새 기대(D-UX4-106, 사용자 지시 2026-11-10): 칸을 누르면 반 화면 판 · 빈 큰 칸(옛 값은 자리 글) · 앱 숫자판, [확인]은 숫자판만 닫고 보내지 않는다.
  // 창을 닫을 때 "바꿀까요?" → [바꿀게요]면 그때 보낸다 (자세한 시험: product-edit-ux4-106)
  it('점선 칸을 누르면 반 화면 판에서 고치고, 닫을 때 묻고 보낸다 — 가격은 원문 칸 (D-UX4-30 → D-UX4-106)', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', price: 12_000 })] })
    await open(world)
    followWrites(world)
    fireEvent.click(within(screen.getByRole('list', { name: '상품 목록' })).getByRole('button', { name: '상품 자세히 — 15번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '가격 고치기' }))
    typePad('18000')
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    await flush()
    expect(world.events.length).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: '판 닫기' }))
    const ask = await screen.findByRole('alertdialog', { name: '15번 핑크프릴 12,000원에서\n15번 핑크프릴 18,000원으로 바꿀까요?' })
    fireEvent.click(within(ask).getByRole('button', { name: '바꿀게요' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.update', b: 'b1', noText: '15', priceText: '18000원' })
  })

  it('뒤로 갔다 돌아오면 끊긴 실시간을 바로 다시 잇고 "자리를 비운 동안 찜 n건"을 보인다 (APP-04)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 8, { claims: [claim('c1', 15, 'u1'), claim('c2', 15, 'u2', { status: 'WAITLISTED' })] }) }))
    await act(async () => {
      setVisibility('hidden')
      world.source().fail()
      await flush()
    })
    const before = world.sources.length
    await act(async () => {
      setVisibility('visible')
      await flush()
    })
    expect(world.sources.length).toBe(before + 1)
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: 8 }])
      await flush()
    })
    await waitFor(() => expect(screen.getByRole('status', { name: '자리를 비운 동안' }).textContent).toBe('자리를 비운 동안 찜 2건'))
  })

  it('듣기 시작 → 안내 창 → 듣는 중 → 서버가 읽은 결과가 바로 등록되고 되돌리기가 보인다 (APP-02·APP-05)', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    // D-UX4-67: 들린 말 창 상태는 듣는 중 · 재연결 중 · 연결 끊김 세 가지 (옛 기대: "듣기 꺼짐")
    expect(screen.getByRole('status', { name: DOCK_STATE.lost })).toBeTruthy()
    // D-UX4-94: 라이브 관리의 "휴대폰 마이크로 음성 인식"·"음성 설정" 줄을 없앴다 — 휴대폰 마이크 켜기는 음성 세션을 직접 켜서 본다(옛: 관리 줄 누르기)
    openMenu()
    expect(screen.queryByRole('button', { name: LISTEN_START })).toBeNull()
    expect(screen.queryByRole('button', { name: '음성 설정' })).toBeNull()
    fireEvent.click(within(await screen.findByRole('dialog', { name: '라이브 관리' })).getByRole('button', { name: '뒤로' }))
    act(() => {
      void world.services.voice.turnOn('b1', '저녁 방송')
    })
    const dialog = await screen.findByRole('dialog', { name: '음성 안내' })
    for (const line of VOICE_CONSENT_LINES) expect(within(dialog).getByText(line)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '알겠어요, 켤게요' }))
    await waitFor(() => expect(screen.getByRole('status', { name: LISTEN_STATE.on })).toBeTruthy())
    expect(world.audio.starts.length).toBe(1)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 6, { products: [product(17, { price: 20_000 })] }) }))
    await act(async () => {
      const now = Date.now()
      world.audio.emit({ text: '17번 2만 원', startMs: now - 1500, endMs: now - 200, reading: { no: 17, name: '', price: 20_000, instant: true, correction: false, readout: '17번 20,000원' } })
      await flush(12)
    })
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.register', b: 'b1', no: 17, name: '', price: 20_000 })
    // 바로 등록 뒤 되돌리기 창은 띄우지 않는다 — 고칠 것은 상품에서 직접 (D-UX4-70)
    expect(screen.queryByRole('button', { name: '17번 등록 되돌리기' })).toBeNull()
    expect(screen.getByRole('status', { name: '지금 인식한 말' }).textContent).toContain('17번 2만 원') // 문구 바뀜 (D-UX4-96, 옛 기대: "지금 들리는 말")
    await act(async () => {
      await world.services.voice.turnOff()
    })
    await waitFor(() => expect(world.audio.stops).toBe(1))
  })

  // 옛 시험 셋(문자찜 한 줄 넣기·번호 범위 넘음·문자찜 칸 원문): 방송 관리 "문자찜 직접 넣기"를 없앴다 (D-UX4-78, 사용자 지시 2026-11-10 "문자찜 직접 넣기 기능은 지워").
  // 문자찜은 음성·휴대폰 문자 받기로 들어온다. 웹 문자찜 화면은 그대로다.
  it('라이브 관리에 "문자찜 직접 넣기"·"댓글 붙여넣기" 줄이 없다 (D-UX4-78)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    openMenu()
    const page = await screen.findByRole('dialog', { name: '라이브 관리' })
    expect(within(page).queryByRole('button', { name: '문자찜 직접 넣기' })).toBeNull()
    expect(within(page).queryByRole('button', { name: '댓글 붙여넣기' })).toBeNull()
    expect(page.textContent).not.toContain('문자찜 직접 넣기')
    expect(page.textContent).not.toContain('댓글 붙여넣기')
  })

  it('정하기 창 (D-APPX-03, 웹 알림 창과 같은 문구): 취소 요청은 승인·무시, 승계는 사유와 함께 1등으로 — 대기 뒤 보낸다', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=false)?$/, () => ({
      body: fullView({
        seq: world.seq,
        products: [product(5, { status: 'SOLD', winners: ['u1'], winnerClaims: ['c1'] }), product(6, { awaitingSuccession: true, waitlist: ['u3'], waitlistClaims: ['c3'] })],
        claims: [claim('c1', 5, 'u1'), claim('c3', 6, 'u3', { status: 'WAITLISTED', seq: 12 })],
        buyers: [buyer('u1', '꽃집언니'), buyer('u3', '초록손')],
        cancelRequests: [{ product: 'b1/5', buyer: 'u1', currentBuyer: 'u1', claim: 'c1', chooseVariant: false, choices: ['c1'], seq: 13 } as never],
      }),
    }))
    world.server.on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 20 } }))
    // 보낸 조치는 응답 seq까지 따라잡는다 — 따라잡기 응답은 바뀐 것 없이 seq만
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=(\d+)/, (call) => ({ body: changes(Number(/since=(\d+)/.exec(call.path)?.[1] ?? 5), world.seq, {}) }))
    await open(world)
    // D-LIVETEST-07: 정하기 단추 대신 경고 칸(취소 요청·승계 결정 필요)을 누르면 정하기 창이 열린다
    fireEvent.click(await screen.findByRole('button', { name: /^취소 요청 1/ }))
    const cancel = await screen.findByRole('group', { name: '취소 요청 — 5번' })
    expect(cancel.textContent).toContain('요청한 사람: 꽃집언니')
    expect(cancel.textContent).toContain('승인하면 1등 자리가 비고 다시 판매 중이 돼요.')
    fireEvent.click(within(cancel).getByRole('button', { name: '취소 승인' }))
    await waitFor(() => expect(world.events.some((call) => call.body?.type === 'host.approveCancel')).toBe(true))
    expect(world.events.find((call) => call.body?.type === 'host.approveCancel')?.body).toMatchObject({ b: 'b1', no: 5, buyer: 'u1' })
    fireEvent.click(screen.getByRole('button', { name: /^승계 결정 필요 1/ }))
    const succession = await screen.findByRole('group', { name: '승계 결정 — 6번' })
    fireEvent.click(within(succession).getByRole('button', { name: '초록손 1등으로' }))
    fireEvent.click(within(succession).getByRole('button', { name: '1등으로 올리기' }))
    expect(within(succession).getByText(/사유를 적어 주세요/)).toBeTruthy()
    fireEvent.click(within(succession).getByRole('button', { name: '사유 시청자 요청' }))
    fireEvent.click(within(succession).getByRole('button', { name: '1등으로 올리기' }))
    await waitFor(() => expect(world.events.some((call) => call.body?.type === 'host.promote')).toBe(true))
    expect(world.events.find((call) => call.body?.type === 'host.promote')?.body).toMatchObject({ b: 'b1', no: 6, buyer: 'u3', reason: '시청자 요청' })
  })

  // 옛 시험 뒷부분(댓글 붙여넣기 미리 보기·넣기)은 없앴다 — 댓글 붙여넣기를 앱에서 없앰 (D-UX4-78)
  // 옛 시험: 방송 관리 "채팅 보기" 판. 새 기대(D-UX4-84): 채팅 보기를 없애 같은 채팅을 채팅·문자 탭에서 본다(주문 꼬리표 "15번 주문")
  it('채팅은 채팅·문자 탭에서 — 라이브 관리에 "채팅 보기"가 없다 (D-UX4-84)', async () => {
    const world = makeWorld({ products: [product(15)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/messages/, () => ({ body: { date: '2026-10-29', rehearsal: false, seq: 5, more: false, messages: [{ id: 'm1', broadcast: 'b1', channel: 'ch1', nick: '꽃집언니', text: '15번이요', owner: false, seq: 4, at: '2026-10-29T11:00:00.000Z', publishedAt: '2026-10-29T11:00:00.000Z', ignored: false, order: true, cancel: false, orders: [15], cancels: [], mentions: [15], converted: [], claims: [], failed: false }] } }))
    await open(world)
    fireEvent.click(screen.getByRole('button', { name: '라이브 관리' }))
    const page = await screen.findByRole('dialog', { name: '라이브 관리' })
    expect(within(page).queryByRole('button', { name: '채팅 보기' })).toBeNull()
    fireEvent.click(within(page).getByRole('button', { name: '뒤로' }))
    fireEvent.click(screen.getByRole('button', { name: '채팅·문자' }))
    const talk = await screen.findByRole('list', { name: '채팅·문자' })
    expect(talk.textContent).toContain('15번이요')
    expect(talk.textContent).toContain('15번 주문')
  })

  it('겹친 상품 시트: "판매 완료"·"1등" 대신 "아직 안 정했어요"·"겹침", 정하기 버튼은 앱 정하기 창을 연다 (D-UX2-07, D-APPX-03)', async () => {
    const world = makeWorld({ products: [product(5, { status: 'SOLD', conflict: true, winners: ['u1'], winnerClaims: ['c1'] })] })
    world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=false)?$/, () => ({
      body: fullView({ seq: world.seq, products: [product(5, { status: 'SOLD', conflict: true, winners: ['u1'], winnerClaims: ['c1'] })], claims: [claim('c1', 5, 'u1'), claim('c2', 5, 'u2', { status: 'CONFLICT', seq: 11 })], buyers: [buyer('u1', '꽃집언니'), buyer('u2', '문자손님')] }),
    }))
    await open(world)
    const board = screen.getByRole('list', { name: '상품 목록' })
    expect(board.textContent).toContain('찜이 겹쳐요') // D-UX3-78 (옛 기대 '예약이 겹쳐요')
    fireEvent.click(within(board).getByRole('button', { name: '상품 자세히 — 5번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    expect(detail.textContent).not.toContain('판매 완료')
    expect(detail.textContent).not.toContain('1등')
    expect(detail.textContent).not.toContain('충돌')
    // 옛 기대: "아직 안 정했어요" 배지·"찜이 겹쳐서 정해야 해요." 요약·찜 줄마다 "겹침". 새 기대(D-UX4-30): 요약 글 없이 이름 알약 — 겹친 찜은 빨강(읽기 이름 "겹침")
    const pills = within(within(detail).getByRole('list', { name: '5번 찜·대기' })).getAllByRole('button').map((pill) => pill.getAttribute('aria-label'))
    expect(pills).toEqual(['꽃집언니 찜', '문자손님 겹침'])
    // 옛 기대: "누가 살지 정하기 (웹으로 열기)". 새 기대(D-APPX-03): 방송 화면의 정하기 창을 그 상품으로 열고, 고른 조치는 대기 뒤 보낸다
    fireEvent.click(within(detail).getByRole('button', { name: '누가 살지 정하기' }))
    const decide = await screen.findByRole('group', { name: '충돌 — 5번' })
    expect(decide.textContent).toContain('지금 1등: 꽃집언니')
    fireEvent.click(within(decide).getByRole('button', { name: '그대로 유지' }))
    expect(await screen.findByText(/뒤 보내요: 5번 충돌 그대로 유지/)).toBeTruthy()
  })

  it('라이브를 끝내면 "끝난 라이브"이 되고 홈으로 돌려보낸다 (D-UX2-07)', async () => {
    const world = makeWorld({ products: [product(15)] })
    world.server.on('POST', /^\/api\/broadcasts\/b1\/end$/, () => ({ body: { seq: world.seq } }))
    let home = 0
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} onEnded={() => home++} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    // 옛 기대: 방송 관리 "방송 끝내기" → 아래 판 [끝내기]. 새 기대(D-UX4-79): 방송 관리 → 방송 연결 → 맨 아래 "방송 연결 끊기" → 가운데 팝업 [끊기](빨강)
    fireEvent.click(screen.getByRole('button', { name: '라이브 관리' }))
    fireEvent.click(await screen.findByRole('button', { name: LINK_TITLE }))
    fireEvent.click(await screen.findByRole('button', { name: END_LINK_LABEL }))
    const popup = await screen.findByRole('alertdialog', { name: '라이브 연결을 끊을까요?' })
    fireEvent.click(within(popup).getByRole('button', { name: '끊기' }))
    await waitFor(() => expect(home).toBe(1))
    expect(screen.getByText('끝난 라이브')).toBeTruthy()
    // 끝난 방송에는 (+) 상품 추가가 없다 (옛 기대: "직접 넣기" 메뉴 없음)
    expect(screen.queryByRole('button', { name: '상품 추가' })).toBeNull()
  })

  // D-YT-SRV-24 (사용자 지시 2026-11-09 "방송 화면에서 ... 버튼 눌러서 켜고 끌 수 있게")
  // D-UX4-20: 줄 "감사 채팅 켜기/끄기" → 방송 설정 화면의 스위치 "감사 채팅"(켜짐·꺼짐이 스위치에)
  // D-UX4-63 (사용자 지시 2026-11-10): 이름 "자동 감사 채팅", 켜고 끈 결과 줄은 띄우지 않는다 (옛 기대: 결과 한 줄 THANKS_ON_DONE이 보인다)
  it('라이브 설정에서 꺼져 있는 자동 감사 채팅 스위치를 켜면 broadcast.thanks(켬)가 가고, 결과 줄 없이 스위치가 지금 상태를 보인다', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    // 쓰기 뒤 따라잡기: 방송 설정의 감사 채팅이 켬으로 바뀐 증분
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 6, { broadcasts: [{ ...BROADCAST_VIEW, settings: { ...SETTINGS, 'thanks.liveChat': true } }] }) }))
    openMenu()
    fireEvent.click(await screen.findByRole('switch', { name: `${THANKS_TITLE} — 꺼짐` }))
    await waitFor(() => expect(world.events.some((call) => call.body?.type === 'broadcast.thanks')).toBe(true))
    const sent = world.events.find((call) => call.body?.type === 'broadcast.thanks')
    expect(sent?.body).toMatchObject({ type: 'broadcast.thanks', b: 'b1', liveChat: true })
    // 스위치가 지금 상태(켬)를 보인다
    expect(await screen.findByRole('switch', { name: `${THANKS_TITLE} — 켜짐` })).toBeTruthy()
    expect(screen.queryByText(/감사 채팅을 켰어요/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // 옛 시험: "직접 넣기 예시는 그 방송 가격 단위와 같은 꼴" — 빠른 입력 한 줄을 없앴다(D-UX4-31). 가격 단위와 상관없는 원문 "원"은 (+) 상품 추가 시험이 본다.
  // D-UX4-42: 톱니 → 머리 오른쪽 "관리" 글자 단추(읽기 이름 "방송 관리")
  it('라이브 관리 화면: 머리 "관리"로 열고, 머리 글(라이브 제목) 없이 묶음 이름과 줄만 — 뒤로 닫는다 (D-UX4-20·42)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    openMenu()
    expect(screen.getByRole('button', { name: '라이브 관리' }).textContent).toBe('관리')
    const page = await screen.findByRole('dialog', { name: '라이브 관리' })
    expect(page.textContent).not.toContain('라이브 메뉴')
    expect(page.textContent).not.toContain('저녁 라이브')
    // 옛 기대: "문자찜 직접 넣기"·"방송 끝내기" 줄. 새 기대(D-UX4-78·79): 문자찜 직접 넣기는 없고, 끝내기는 방송 연결 안 "방송 연결 끊기"로
    expect(within(page).getByRole('button', { name: LINK_TITLE })).toBeTruthy()
    expect(within(page).queryByRole('button', { name: '라이브 끝내기' })).toBeNull()
    fireEvent.click(within(page).getByRole('button', { name: '뒤로' }))
    expect(screen.queryByRole('dialog', { name: '라이브 관리' })).toBeNull()
  })

  // 옛 시험(CR-7, D-APPX-01): 첫 1등 옆 "단골 · 누적 …". 새 기대(D-UX4-24, 사용자 지시 "각 상품마다 찜 목록에서 닉네임만 보여줘"): 상품 줄은 닉네임만
  it('상품 줄에는 닉네임만 — 손님 꼬리표를 묻지도 붙이지도 않는다', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', winners: ['u1'], winnerClaims: ['c1'] })] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/customer-badges\?buyer=u1$/, () => ({ body: { show: true, badges: [{ buyer: 'u1', text: '단골 · 누적 152,000원', spoken: null }] } }))
    await open(world)
    await flush()
    expect(screen.queryByText('단골 · 누적 152,000원')).toBeNull()
    expect(world.server.callsTo('GET', /customer-badges/)).toHaveLength(0)
  })

  it('리허설 라이브는 손님 꼬리표를 묻지 않는다', async () => {
    const world = makeWorld({ rehearsal: true, products: [product(15, { name: '핑크프릴', winners: ['u1'], winnerClaims: ['c1'] })] })
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await waitFor(() => expect(screen.getByText('핑크프릴')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: true, seq: world.seq }])
      await flush()
    })
    await flush()
    expect(world.server.callsTo('GET', /customer-badges/)).toHaveLength(0)
  })

  it('새 라이브 단계에서 막 넘어오면 "들어왔다" 기록을 먼저 끝낸 뒤 라이브 목록을 받는다 — 기록 전엔 목록에 없어 "찾지 못했어요"가 뜨면 안 된다 (D-UX3-25 고침)', async () => {
    const world = makeWorld({ products: [] })
    let opened = false
    world.server.on('POST', /^\/api\/broadcasts\/b1\/open$/, () => {
      opened = true
      return { body: { ok: true } }
    })
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: opened ? [BROADCAST] : [] } }))
    await open(world)
    expect(screen.queryByText('그 라이브를 찾지 못했어요. 홈에서 다시 골라 주세요.')).toBeNull()
    expect(opened).toBe(true)
  })
})
