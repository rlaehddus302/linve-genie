// 방송 중 화면 (APP-01 AC1·AC5, APP-02, APP-04, D-UX2-03): 서버 상품이 리스트에 보이고, "직접 넣기"의 빠른 입력 한 줄이 등록 요청이 되며,
// 실시간 change로 1등(예약)이 보이고, 뒤로 갔다 돌아오면 다시 잇고 "자리를 비운 동안 찜 n건"이 보이며, 듣기 시작 → 안내 → 서버가 읽은 결과로 바로 등록된다.
// 새 시안(D-UX2-03)으로 바뀐 것: "현재 상품" 카드·알림 띠 대신 상품 리스트(줄을 누르면 자세히 시트), 빠른 입력·문자찜은 "직접 넣기" 시트,
// 음성 켜기/끄기는 아래 고정 버튼 "듣기 시작/듣기 멈추기", 음성 상태는 머리의 "듣는 중". 요청 본문·막힘 조건 기대는 그대로다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { DIRECT_INPUT, LISTEN_START, LISTEN_STATE, LISTEN_STOP, VOICE_CONSENT_LINES, VOICE_SENT_LINE } from '../src/lib/words.ts'
import { makeWorld } from './screen-support.tsx'
import { BROADCAST, buyer, changes, claim, flush, fullView, product } from './support.ts'

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

// 직접 넣기·휴대폰 마이크는 아래 고정 단추가 아니라 방송 메뉴(⋯)에 있다 (D-UX3-73)
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: '방송 메뉴' }))
const openDirect = () => {
  openMenu()
  fireEvent.click(screen.getByRole('button', { name: DIRECT_INPUT }))
}

describe('ConsoleScreen', () => {
  it('서버에 등록된 상품이 리스트에 크게 보이고, 누르면 자세히가 열리며 상태 낱말은 한국어다', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', price: 12_000 })] })
    await open(world)
    const list = screen.getByRole('list', { name: '상품 목록' })
    expect(within(list).getByText('15번')).toBeTruthy()
    expect(within(list).getByText('핑크프릴')).toBeTruthy()
    expect(within(list).getByText('12,000원')).toBeTruthy()
    expect(within(list).getByText('아직 예약 없음')).toBeTruthy()
    expect(screen.queryByText(/OPEN|CONFIRMED/)).toBeNull()
    // 알릴 것이 없으면 경고 줄을 그리지 않는다 (옛 기대: "알림 없음" 띠)
    expect(screen.queryByRole('region', { name: '알림' })).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: '상품 자세히 — 15번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    expect(within(detail).getByText('판매 중')).toBeTruthy()
    expect(within(detail).getByText('12,000원')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    openDirect()
    expect(screen.getByRole('button', { name: '보내기' })).toBeTruthy()
  })

  it('빠른 입력 한 줄을 보내면 product.register 요청이 가고 등록 뒤 5초 되돌리기가 보인다', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    openDirect()
    const input = screen.getByRole('textbox', { name: '빠른 입력' })
    fireEvent.change(input, { target: { value: '16 핑크프릴 10000' } })
    // SRV1 (D-APP-24, AC-SRV1-05): 미리 보기는 서버 읽기 입구의 답(150ms 뒤) — 옛 기대는 앱이 읽어 친 즉시
    expect(await screen.findByText('등록하면: 16번 핑크프릴 10,000원')).toBeTruthy()
    expect(world.reads.at(-1)?.body).toEqual({ kind: 'quick', text: '16 핑크프릴 10000' })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 6, { products: [product(16, { name: '핑크프릴' })] }) }))
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    // 옛 기대: 본문 no·name·price. 새 기대(약속 2): 친 줄 원문 — 서버가 같은 함수로 다시 읽어 16번 핑크프릴 10,000원을 기록한다
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.register', b: 'b1', text: '16 핑크프릴 10000' })
    await waitFor(() => expect(screen.getByRole('button', { name: '16번 등록 되돌리기' })).toBeTruthy())
    expect((input as HTMLInputElement).value).toBe('')
    expect(within(screen.getByRole('list', { name: '상품 목록' })).getByText('16번')).toBeTruthy()
    // 되돌리기 → product.close
    fireEvent.click(screen.getByRole('button', { name: '16번 등록 되돌리기' }))
    await waitFor(() => expect(world.events.length).toBe(2))
    expect(world.events[1]?.body).toMatchObject({ type: 'product.close', b: 'b1', no: 16 })
  })

  it('오류 줄은 문장으로 알리고 보내지 않는다', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    openDirect()
    fireEvent.change(screen.getByRole('textbox', { name: '빠른 입력' }), { target: { value: '핑크프릴 10000' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('맨 앞에 상품 번호를 적어 주세요. 예: 15 핑크프릴 10000'))
    expect(world.events.length).toBe(0)
  })

  it('D-LIVETEST-07 찜 기록: 채팅·문자찜이 시각·어디서·이름·번호·결과로, 이미 1등이 있는 상품을 찜하면 "이미 찜됨 · 1등"과 채팅 원문이 보이고, 보류 찜 칸을 누르면 보류 찜만 연다', async () => {
    const world = makeWorld({ products: [product(15)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/messages/, () => ({ body: { messages: [{ id: 'm2', broadcast: 'b1', channel: 'ch2', nick: '김영희', text: '15번 저도요', owner: false, seq: 11, at: '2026-10-29T11:00:09.000Z', publishedAt: '2026-10-29T11:00:09.000Z', ignored: false, order: true, cancel: false, orders: [15], cancels: [], mentions: [], converted: [], claims: ['c2'], failed: false }], more: false } }))
    await open(world)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({
      body: changes(5, 7, {
        products: [product(15, { winners: ['u1'], winnerClaims: ['c1'], waitlist: ['u2'], waitlistClaims: ['c2'] })],
        claims: [claim('c1', 15, 'u1'), claim('c2', 15, 'u2', { status: 'WAITLISTED', seq: 11, rankTime: '2026-10-29T11:00:09.000Z' }), claim('c3', 88, 'u3', { status: 'PENDING', origin: 'sms', productId: null, seq: 12, rankTime: '2026-10-29T11:00:12.000Z' })],
        pending: [{ product: 'b1/88', broadcast: 'b1', no: 88, buyers: ['u3'], claims: ['c3'] } as never],
        buyers: [buyer('u1', '홍길동'), buyer('u2', '김영희'), buyer('u3', '문자손님')],
      }),
    }))
    await act(async () => {
      world.source().emit('change', { date: '2026-10-29', rehearsal: false, seq: 7, type: 'chat' })
      await flush()
    })
    fireEvent.click(await screen.findByRole('button', { name: '찜 기록' }))
    const feed = await screen.findByRole('list', { name: '찜 기록' })
    const rows = within(feed).getAllByRole('listitem')
    // D-UX3-75로 바뀐 기대 (사용자 지시 2026-11-09 "라이브채팅처럼 … 맨 아래 있는게 가장 최근꺼로"): 최신이 맨 아래 — 1등 → 대기(이미 찜됨) → 문자 보류
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['15번 홍길동 1등', '15번 김영희 대기 1번', '88번 문자손님 보류'])
    expect(rows[2]?.textContent).toContain('문자')
    await waitFor(() => expect(rows[1]?.textContent).toContain('15번 저도요'))
    expect(rows[1]?.textContent).toContain('이미 찜됨 · 1등 홍길동')
    expect(rows[0]?.textContent).not.toContain('이미 찜됨')
    fireEvent.click(screen.getByRole('button', { name: /^보류 찜 1/ }))
    const pendingRows = await waitFor(() => {
      const lists = screen.getAllByRole('list', { name: '찜 기록' })
      const only = lists.find((list) => within(list).queryAllByRole('listitem').length === 1)
      expect(only).toBeTruthy()
      return within(only!).getAllByRole('listitem')
    })
    expect(pendingRows[0]?.getAttribute('aria-label')).toBe('88번 문자손님 보류')
  })

  it('D-UX4-12 채팅·문자 탭: 찜 기록 옆 탭에 채팅과 손님 문자가 받은 시각 순(최신이 맨 아래 — D-UX3-75)으로, 문자는 서버가 한 일과 끝번호로 보이고 새 문자 알림이 오면 다시 읽는다', async () => {
    const world = makeWorld({ products: [product(15)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/messages/, () => ({ body: { messages: [{ id: 'm1', broadcast: 'b1', channel: 'ch1', nick: '김영희', text: '15번 주세요', owner: false, seq: 11, at: '2026-10-29T11:00:05.000Z', publishedAt: '2026-10-29T11:00:05.000Z', ignored: false, order: true, cancel: false, orders: [15], cancels: [], mentions: [], converted: [], claims: [], failed: false }], more: false } }))
    let smsReads = 0
    let feed: unknown[] = [{ id: 's1', at: '2026-10-29T11:00:09.000Z', last4: '5678', sender: null, text: '15 홍길동', result: 'claim', numbers: [15] }]
    world.server.on('GET', /^\/api\/inbox\/sms\?b=b1$/, () => {
      smsReads++
      return { body: { messages: feed } }
    })
    await open(world)
    const tab = screen.getByRole('button', { name: '채팅·문자' })
    // 탭은 상품·찜 기록과 한 줄 (위아래로 쌓지 않는다)
    expect(screen.getByRole('tablist', { name: '보기' }).children).toHaveLength(3)
    fireEvent.click(tab)
    const list = await screen.findByRole('list', { name: '채팅·문자' })
    await waitFor(() => expect(within(list).getAllByRole('listitem').map((row) => row.getAttribute('aria-label'))).toEqual(['채팅 김영희', '문자 끝번호 5678']))
    const rows = within(list).getAllByRole('listitem')
    expect(rows[1]?.textContent).toContain('15 홍길동')
    expect(rows[1]?.textContent).toContain('찜 15번')
    expect(rows[0]?.textContent).toContain('15번 주세요')
    expect(rows[0]?.textContent).toContain('주문 15번')
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
    // 리스트 둘째 줄: 예약(1등) 이름 · 대기 n명
    const board = screen.getByRole('list', { name: '상품 목록' })
    await waitFor(() => expect(board.textContent).toContain('예약 홍길동'))
    expect(board.textContent).toContain('· 대기 1명')
    fireEvent.click(within(board).getByRole('button', { name: '상품 자세히 — 15번' }))
    const list = await screen.findByRole('list', { name: '15번 찜' })
    // 시트도 보드와 같은 말: 1등은 "예약" (D-UX2-07 — 옛 기대 '1등')
    expect(list.textContent).toContain('예약')
    expect(list.textContent).not.toContain('1등')
    expect(list.textContent).toContain('홍길동')
    expect(list.textContent).toContain('대기 1번')
    expect(list.textContent).toContain('김영희')
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
    expect(screen.getByRole('status', { name: LISTEN_STATE.off })).toBeTruthy()
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: LISTEN_START }))
    const dialog = await screen.findByRole('dialog', { name: '음성 안내' })
    for (const line of VOICE_CONSENT_LINES) expect(within(dialog).getByText(line)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '알겠어요, 켤게요' }))
    await waitFor(() => expect(screen.getByRole('status', { name: LISTEN_STATE.on })).toBeTruthy())
    // 받아쓰기 서버 안내는 안내 창(위)과 방송 메뉴 → 음성 설정에 있다 (D-UX2-03)
    fireEvent.click(screen.getByRole('button', { name: '방송 메뉴' }))
    fireEvent.click(screen.getByRole('button', { name: '음성 설정' }))
    expect(screen.getByText(VOICE_SENT_LINE)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(world.audio.starts.length).toBe(1)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 6, { products: [product(17, { price: 20_000 })] }) }))
    await act(async () => {
      const now = Date.now()
      world.audio.emit({ text: '17번 2만 원', startMs: now - 1500, endMs: now - 200, reading: { no: 17, name: '', price: 20_000, instant: true, correction: false, readout: '17번 20,000원' } })
      await flush(12)
    })
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.register', b: 'b1', no: 17, name: '', price: 20_000 })
    expect(screen.getByRole('button', { name: '17번 등록 되돌리기' })).toBeTruthy()
    expect(screen.getByRole('status', { name: '지금 들리는 말' }).textContent).toContain('17번 2만 원')
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: LISTEN_STOP }))
    await waitFor(() => expect(world.audio.stops).toBe(1))
    openMenu()
    expect(screen.getByRole('button', { name: LISTEN_START })).toBeTruthy()
  })

  it('문자찜 한 줄을 넣으면 sms 이벤트가 간다 (전화번호는 화면에 남지 않는다)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 6, { claims: [claim('c1', 15, 'u9')] }) }))
    openDirect()
    fireEvent.change(screen.getByLabelText('번호'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('전화번호 (선택)'), { target: { value: '010-1234-5678' } })
    fireEvent.click(screen.getByRole('button', { name: /문자찜 넣기$/ }))
    await waitFor(() => expect(world.events.length).toBe(1))
    // 옛 기대: 번호 숫자 no. 새 기대(D-APP-24): 번호 칸 원문 noText — 서버가 그 방송 번호 한도로 읽는다
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', noText: '15', phone: '010-1234-5678' })
    // 옛 기대: "15번 문자찜을 넣었어요." 새 기대(D-APPX-03, 웹 SmsPage와 같은 결과 카드): 찜의 지금 상태 한 줄 + 같은 사람 하나 더
    await waitFor(() => expect(screen.getByText(/^15번 · /)).toBeTruthy())
    expect((screen.getByLabelText('전화번호 (선택)') as HTMLInputElement).value).toBe('')
  })

  it('문자찜 번호가 방송 번호 범위를 넘으면(번호 칸에 전화번호가 붙음) 보내지 않고 고칠 방법을 알린다 (APP2 실기기)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    openDirect()
    fireEvent.change(screen.getByLabelText('번호'), { target: { value: '21301000001234' } })
    fireEvent.click(screen.getByRole('button', { name: /문자찜 넣기$/ }))
    await waitFor(() => expect(screen.getByText(/번호는 1부터 \d+까지예요\. 번호를 확인해 주세요\./)).toBeTruthy())
    fireEvent.change(screen.getByLabelText('번호'), { target: { value: '1e3' } })
    fireEvent.click(screen.getByRole('button', { name: /문자찜 넣기$/ }))
    await waitFor(() => expect(screen.getByText('상품 번호를 숫자로 적어 주세요.')).toBeTruthy())
    expect(world.events.length).toBe(0)
  })

  it('문자찜 칸 (D-APPX-03, 웹 SmsPage와 같은 칸): 받은 시각·메모·구매자 고르기는 원문으로, 고르면 전화번호는 보내지 않는다, 되면 칸을 비운다', async () => {
    const world = makeWorld({ products: [product(15), product(16)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=false)?$/, () => ({ body: fullView({ seq: world.seq, products: [product(15), product(16)], claims: [claim('c1', 15, 'u1')], buyers: [buyer('u1', '꽃집언니', { phoneLast4: '5678' })] }) }))
    await open(world)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 6, { claims: [claim('c2', 16, 'u1', { origin: 'sms', seq: 6 })] }) }))
    openDirect()
    fireEvent.change(screen.getByLabelText('번호'), { target: { value: '16' } })
    fireEvent.change(screen.getByLabelText('받은 시각 (선택)'), { target: { value: '20:01' } })
    fireEvent.change(screen.getByLabelText('메모 (선택)'), { target: { value: '현관 앞' } })
    fireEvent.change(screen.getByLabelText('구매자 찾기 (선택)'), { target: { value: '5678' } })
    fireEvent.click(screen.getByRole('button', { name: '구매자 꽃집언니 고르기' }))
    expect(screen.queryByLabelText('전화번호 (선택)')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '16번에 문자찜 넣기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', noText: '16', receivedText: '20:01', memo: '현관 앞', buyer: 'u1' })
    await waitFor(() => expect((screen.getByLabelText('번호') as HTMLInputElement).value).toBe(''))
    expect(screen.getByLabelText('전화번호 (선택)')).toBeTruthy()
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

  it('채팅 보기·댓글 붙여넣기 (D-APPX-03): 최근 채팅의 주문 표시, 붙여넣기는 미리 본 뒤 같은 요청 번호로 넣는다', async () => {
    const world = makeWorld({ products: [product(15)] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/messages/, () => ({ body: { date: '2026-10-29', rehearsal: false, seq: 5, more: false, messages: [{ id: 'm1', broadcast: 'b1', channel: 'ch1', nick: '꽃집언니', text: '15번이요', owner: false, seq: 4, at: '2026-10-29T11:00:00.000Z', publishedAt: '2026-10-29T11:00:00.000Z', ignored: false, order: true, cancel: false, orders: [15], cancels: [], mentions: [15], converted: [], claims: [], failed: false }] } }))
    const pastes: { path: string; body: Record<string, unknown> | null }[] = []
    world.server.on('POST', /^\/api\/broadcasts\/b1\/paste/, (call) => {
      pastes.push({ path: call.path, body: call.body })
      return { body: { rows: [{ line: 1, nickname: '틱톡손님', result: 'ORDER', numbers: [15], message: '15번 찜' }], groups: [], total: 1, ...(call.path.endsWith('/preview') ? {} : { added: 1 }) } }
    })
    await open(world)
    fireEvent.click(screen.getByRole('button', { name: '방송 메뉴' }))
    fireEvent.click(screen.getByRole('button', { name: /^채팅 보기/ }))
    expect(await screen.findByText('15번이요')).toBeTruthy()
    expect(screen.getByText('주문 15번')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '방송 메뉴' }))
    fireEvent.click(screen.getByRole('button', { name: /^댓글 붙여넣기/ }))
    fireEvent.change(screen.getByLabelText('붙여 넣을 댓글'), { target: { value: '틱톡손님: 15' } })
    fireEvent.click(screen.getByRole('button', { name: '미리 보기' }))
    expect(await screen.findByText('1줄 틱톡손님 15번 찜')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '찜 1개 넣기' }))
    expect(await screen.findByText('찜 1개를 넣었어요.')).toBeTruthy()
    expect(pastes.map((call) => call.path)).toEqual(['/api/broadcasts/b1/paste/preview', '/api/broadcasts/b1/paste'])
    expect(pastes[1]!.body).toMatchObject({ text: '틱톡손님: 15', includeOverlaps: [] })
  })

  it('겹친 상품 시트: "판매 완료"·"1등" 대신 "아직 안 정했어요"·"겹침", 정하기 버튼은 앱 정하기 창을 연다 (D-UX2-07, D-APPX-03)', async () => {
    const world = makeWorld({ products: [product(5, { status: 'SOLD', conflict: true, winners: ['u1'], winnerClaims: ['c1'] })] })
    world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=false)?$/, () => ({
      body: fullView({ seq: world.seq, products: [product(5, { status: 'SOLD', conflict: true, winners: ['u1'], winnerClaims: ['c1'] })], claims: [claim('c1', 5, 'u1'), claim('c2', 5, 'u2', { status: 'CONFLICT', seq: 11 })], buyers: [buyer('u1', '꽃집언니'), buyer('u2', '문자손님')] }),
    }))
    await open(world)
    const board = screen.getByRole('list', { name: '상품 목록' })
    expect(board.textContent).toContain('예약이 겹쳐요')
    fireEvent.click(within(board).getByRole('button', { name: '상품 자세히 — 5번' }))
    const detail = await screen.findByRole('group', { name: '상품 자세히' })
    expect(within(detail).getByText('아직 안 정했어요')).toBeTruthy()
    expect(detail.textContent).not.toContain('판매 완료')
    expect(detail.textContent).not.toContain('1등')
    expect(detail.textContent).not.toContain('충돌')
    expect(detail.textContent).toContain('예약이 겹쳐서 정해야 해요.')
    const claims = within(detail).getByRole('list', { name: '5번 찜' }).textContent ?? ''
    expect(claims.match(/겹침/g)).toHaveLength(2)
    expect(claims).toContain('꽃집언니')
    expect(claims).toContain('문자손님')
    // 옛 기대: "누가 살지 정하기 (웹으로 열기)". 새 기대(D-APPX-03): 방송 화면의 정하기 창을 그 상품으로 열고, 고른 조치는 대기 뒤 보낸다
    fireEvent.click(within(detail).getByRole('button', { name: '누가 살지 정하기' }))
    const decide = await screen.findByRole('group', { name: '충돌 — 5번' })
    expect(decide.textContent).toContain('지금 1등: 꽃집언니')
    fireEvent.click(within(decide).getByRole('button', { name: '그대로 유지' }))
    expect(await screen.findByText(/뒤 보내요: 5번 충돌 그대로 유지/)).toBeTruthy()
  })

  it('방송을 끝내면 "끝난 방송"이 되고 홈으로 돌려보낸다 (D-UX2-07)', async () => {
    const world = makeWorld({ products: [product(15)] })
    world.server.on('POST', /^\/api\/broadcasts\/b1\/end$/, () => ({ body: { seq: world.seq } }))
    let home = 0
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} onEnded={() => home++} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush()
    })
    fireEvent.click(screen.getByRole('button', { name: '방송 메뉴' }))
    fireEvent.click(await screen.findByRole('button', { name: '방송 끝내기' }))
    fireEvent.click(await screen.findByRole('button', { name: '끝내기' }))
    await waitFor(() => expect(home).toBe(1))
    expect(screen.getByText('끝난 방송')).toBeTruthy()
    expect(screen.queryByRole('button', { name: DIRECT_INPUT })).toBeNull()
  })

  it('직접 넣기 예시는 그 방송 가격 단위와 같은 꼴이다 — 천원 단위면 "15 핑크프릴 10" (D-UX2-07)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    openDirect()
    const input = screen.getByRole('textbox', { name: '빠른 입력' })
    expect(input.getAttribute('placeholder')).toBe('예: 15 핑크프릴 10')
    expect(screen.getByText('가격 단위: 천원 — 10은 10,000원, 2만은 20,000원')).toBeTruthy()
  })

  it('1등 옆 손님 꼬리표(CR-7, D-APPX-01): 서버가 보이라고 하면(show) 첫 1등 옆에 "단골 · 누적 …"을 붙인다', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', winners: ['u1'], winnerClaims: ['c1'] })] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/customer-badges\?buyer=u1$/, () => ({ body: { show: true, badges: [{ buyer: 'u1', text: '단골 · 누적 152,000원', spoken: null }] } }))
    await open(world)
    expect(await screen.findByText('단골 · 누적 152,000원')).toBeTruthy()
  })

  it('리허설 방송은 손님 꼬리표를 묻지 않는다', async () => {
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

  it('새 방송 단계에서 막 넘어오면 "들어왔다" 기록을 먼저 끝낸 뒤 방송 목록을 받는다 — 기록 전엔 목록에 없어 "찾지 못했어요"가 뜨면 안 된다 (D-UX3-25 고침)', async () => {
    const world = makeWorld({ products: [] })
    let opened = false
    world.server.on('POST', /^\/api\/broadcasts\/b1\/open$/, () => {
      opened = true
      return { body: { ok: true } }
    })
    world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: opened ? [BROADCAST] : [] } }))
    await open(world)
    expect(screen.queryByText('그 방송을 찾지 못했어요. 홈에서 다시 골라 주세요.')).toBeNull()
    expect(opened).toBe(true)
  })
})
