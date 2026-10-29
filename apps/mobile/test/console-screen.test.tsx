// 라이브 콘솔 화면 (APP-01 AC1·AC5, APP-02, APP-04): 서버 상품이 보이고, 빠른 입력 한 줄이 등록 요청이 되며, 실시간 change로 1등이 보이고,
// 뒤로 갔다 돌아오면 다시 잇고 "자리를 비운 동안 찜 n건"이 보이며, 음성 켜기 → 안내 → 서버가 읽은 결과로 바로 등록된다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { VOICE_CONSENT_LINES, VOICE_LISTENING, VOICE_ON, VOICE_SENT_LINE } from '../src/lib/words.ts'
import { makeWorld } from './screen-support.tsx'
import { changes, claim, flush, product } from './support.ts'

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

describe('ConsoleScreen', () => {
  it('서버에 등록된 상품이 현재 상품·보드에 보이고 상태 낱말은 한국어다', async () => {
    const world = makeWorld({ products: [product(15, { name: '핑크프릴', price: 12_000 })] })
    await open(world)
    const current = screen.getByRole('group', { name: '현재 상품' })
    expect(within(current).getByText('15번 핑크프릴')).toBeTruthy()
    expect(within(current).getByText('12,000원')).toBeTruthy()
    expect(within(current).getByText('판매 중')).toBeTruthy()
    expect(screen.queryByText(/OPEN|CONFIRMED/)).toBeNull()
    expect(screen.getByRole('region', { name: '알림' }).textContent).toContain('알림 없음')
    expect(screen.getByRole('button', { name: '보내기' })).toBeTruthy()
  })

  it('빠른 입력 한 줄을 보내면 product.register 요청이 가고 등록 뒤 5초 되돌리기가 보인다', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    const input = screen.getByRole('textbox', { name: '빠른 입력' })
    fireEvent.change(input, { target: { value: '16 핑크프릴 10000' } })
    expect(screen.getByText('등록하면: 16번 핑크프릴 10,000원')).toBeTruthy()
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 6, { products: [product(16, { name: '핑크프릴' })] }) }))
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'product.register', b: 'b1', no: 16, name: '핑크프릴', price: 10_000 })
    await waitFor(() => expect(screen.getByRole('button', { name: '16번 등록 되돌리기' })).toBeTruthy())
    expect((input as HTMLInputElement).value).toBe('')
    expect(within(screen.getByRole('group', { name: '현재 상품' })).getByText('16번 핑크프릴')).toBeTruthy()
    // 되돌리기 → product.close
    fireEvent.click(screen.getByRole('button', { name: '16번 등록 되돌리기' }))
    await waitFor(() => expect(world.events.length).toBe(2))
    expect(world.events[1]?.body).toMatchObject({ type: 'product.close', b: 'b1', no: 16 })
  })

  it('오류 줄은 문장으로 알리고 보내지 않는다', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    fireEvent.change(screen.getByRole('textbox', { name: '빠른 입력' }), { target: { value: '핑크프릴 10000' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('맨 앞에 상품 번호를 적어 주세요. 예: 15 핑크프릴 10000'))
    expect(world.events.length).toBe(0)
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
    const list = await screen.findByRole('list', { name: '15번 찜' })
    expect(list.textContent).toContain('1등')
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

  it('음성 켜기 → 안내 창 → 켜짐 → 서버가 읽은 결과가 바로 등록되고 되돌리기가 보인다 (APP-02·APP-05)', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    fireEvent.click(screen.getByRole('button', { name: VOICE_ON }))
    const dialog = await screen.findByRole('dialog', { name: '음성 안내' })
    for (const line of VOICE_CONSENT_LINES) expect(within(dialog).getByText(line)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '알겠어요, 켤게요' }))
    await waitFor(() => expect(screen.getByText(VOICE_LISTENING)).toBeTruthy())
    expect(screen.getByText(VOICE_SENT_LINE)).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: '음성 끄기' }))
    await waitFor(() => expect(world.audio.stops).toBe(1))
    expect(screen.getByRole('button', { name: VOICE_ON })).toBeTruthy()
  })

  it('문자찜 한 줄을 넣으면 sms 이벤트가 간다 (전화번호는 화면에 남지 않는다)', async () => {
    const world = makeWorld({ products: [product(15)] })
    await open(world)
    world.server.on('GET', /^\/api\/days\/2026-10-29\/changes\?since=5/, () => ({ body: changes(5, 6, { claims: [claim('c1', 15, 'u9')] }) }))
    fireEvent.change(screen.getByLabelText('번호'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('전화번호 (선택)'), { target: { value: '010-1234-5678' } })
    fireEvent.click(screen.getByRole('button', { name: '문자찜 넣기' }))
    await waitFor(() => expect(world.events.length).toBe(1))
    expect(world.events[0]?.body).toEqual({ requestId: expect.any(String), type: 'sms', b: 'b1', no: 15, phone: '010-1234-5678' })
    await waitFor(() => expect(screen.getByText('15번 문자찜을 넣었어요.')).toBeTruthy())
    expect((screen.getByLabelText('전화번호 (선택)') as HTMLInputElement).value).toBe('')
  })
})
