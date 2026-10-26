// QL3R1 웹 단위 시험 — 긴 창 처음 초점(D-QL3R1-01), 출력 기기 끊김 짧은 줄(D-QL3R1-04), 찜 취소·무효 빠른 사유 바로 보내기(D-QL3R1-05),
// 휴대폰 콘솔 차례(D-QL3R1-03), 입금·정산·봉인·상품 칸 낱말(D-QL3R1-06·07), /privacy 보관 문장(D-QL3R1-08).
// jsdom에는 matchMedia가 없어 휴대폰 모양이다(use-wide.ts).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { AlertStrip } from '../src/components/AlertStrip.tsx'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { FILE_ERROR, PASTE_HINT } from '../src/components/DepositPaste.tsx'
import { Modal } from '../src/components/Modal.tsx'
import { sealAtWords } from '../src/components/SealNotice.tsx'
import { DEVICE_SHORT_NAME_MAX, deviceLostMessage, deviceLostShortMessage, stationLeadShortText, stationLeadText } from '../src/lib/print-words.ts'
import type { AlertCounts } from '../src/lib/derive.ts'
import { chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { FakeEventSource, flush } from './support.ts'

let engine: EngineServer

function setup(events: Record<string, unknown>[] = [], options: ConstructorParameters<typeof EngineServer>[1] = {}) {
  engine = new EngineServer(events, options)
  vi.stubGlobal('fetch', engine.server.fetch)
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  onUnauthorized(null)
})

async function openConsole() {
  const utils = render(<ConsolePage broadcastId="b1" navigate={vi.fn()} />)
  const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
  await flush(10)
  return { ...utils, quick }
}

const enter = (input: HTMLElement, text: string) => {
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

describe('긴 창 처음 초점 (D-QL3R1-01, AC-QL3R1-01~03)', () => {
  it('처음 초점("닫기")은 preventScroll: true로 주고, 창 배경·창의 스크롤을 맨 위로 맞춘다', () => {
    const calls: { el: Element; options: FocusOptions | undefined }[] = []
    const original = HTMLElement.prototype.focus
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      calls.push({ el: this, options })
      original.call(this, options)
    })
    render(
      <Modal title="1번 자세히" onClose={() => undefined}>
        <p>긴 내용</p>
      </Modal>,
    )
    const close = screen.getByRole('button', { name: '닫기' })
    expect(document.activeElement).toBe(close)
    expect(calls.find((call) => call.el === close)?.options).toEqual({ preventScroll: true })
    const backdrop = document.querySelector('.backdrop') as HTMLElement
    expect(backdrop.scrollTop).toBe(0)
  })

  it('넘겨받은 initialFocus도 preventScroll: true — 초점을 받는 요소는 그대로', () => {
    const calls: { el: Element; options: FocusOptions | undefined }[] = []
    const original = HTMLElement.prototype.focus
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      calls.push({ el: this, options })
      original.call(this, options)
    })
    function WithField() {
      const field = useRef<HTMLInputElement>(null)
      return (
        <Modal title="찜 취소" onClose={() => undefined} initialFocus={field}>
          <input ref={field} aria-label="사유" />
        </Modal>
      )
    }
    render(<WithField />)
    const field = screen.getByLabelText('사유')
    expect(document.activeElement).toBe(field)
    expect(calls.find((call) => call.el === field)?.options).toEqual({ preventScroll: true })
  })

  it('누른 단추가 사라져 초점이 창 밖으로 빠지면 "닫기"로 되돌리되 preventScroll: true (보던 자리를 옮기지 않음)', () => {
    const calls: { el: Element; options: FocusOptions | undefined }[] = []
    const original = HTMLElement.prototype.focus
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      calls.push({ el: this, options })
      original.call(this, options)
    })
    function Vanishing() {
      const [shown, setShown] = useState(true)
      return (
        <Modal title="1번 자세히" onClose={() => undefined}>
          {shown ? (
            <button type="button" onClick={() => setShown(false)}>
              찜 취소하기
            </button>
          ) : (
            <p>바뀜</p>
          )}
        </Modal>
      )
    }
    render(<Vanishing />)
    const button = screen.getByRole('button', { name: '찜 취소하기' })
    button.focus()
    calls.length = 0
    fireEvent.click(button)
    const close = screen.getByRole('button', { name: '닫기' })
    expect(document.activeElement).toBe(close)
    const back = calls.filter((call) => call.el === close)
    expect(back.length).toBeGreaterThan(0)
    for (const call of back) expect(call.options).toEqual({ preventScroll: true })
  })

  it('Esc는 닫고 Tab은 창 안에서 돈다 (그대로)', () => {
    const onClose = vi.fn()
    render(
      <Modal title="창" onClose={onClose} actions={<button type="button">보내기</button>}>
        <p>내용</p>
      </Modal>,
    )
    const close = screen.getByRole('button', { name: '닫기' })
    const send = screen.getByRole('button', { name: '보내기' })
    send.focus()
    fireEvent.keyDown(send, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('출력 기기 끊김 짧은 줄 (D-QL3R1-04, AC-QL3R1-25·26)', () => {
  const counts: AlertCounts = { conflict: 0, cancelRequest: 0, succession: 0, pending: 1, attention: 0 } as AlertCounts

  it('짧은 문장: "라벨이 안 나가요 · \'PC\' 화면을 켜 주세요", 11낱자 이상이면 앞 10낱자 + "…"', () => {
    expect(deviceLostShortMessage('PC')).toBe("라벨이 안 나가요 · 'PC' 화면을 켜 주세요")
    expect(DEVICE_SHORT_NAME_MAX).toBe(10)
    expect(deviceLostShortMessage('가나다라마바사아자차')).toBe("라벨이 안 나가요 · '가나다라마바사아자차' 화면을 켜 주세요")
    expect(deviceLostShortMessage('가나다라마바사아자차카')).toBe("라벨이 안 나가요 · '가나다라마바사아자차…' 화면을 켜 주세요")
    // 낱자는 Array.from으로 센다 (그림 글자 하나 = 한 낱자)
    expect(deviceLostShortMessage('🌵🌵🌵🌵🌵🌵🌵🌵🌵🌵🌵')).toBe("라벨이 안 나가요 · '🌵🌵🌵🌵🌵🌵🌵🌵🌵🌵…' 화면을 켜 주세요")
  })

  it('짧은 문장은 출력 기기 끊김·출력 기기 없음+대기 라벨일 때만 — 정상·이 기기가 출력 기기면 없다', () => { // QL3R2 D-QL3R2-03
    const base = { labelsOn: true, rehearsal: false, ended: false, mine: false } as const
    const device = { id: 'd1', name: 'PC', live: false, printerConnected: true, releasing: false }
    const queue = { rev: 1, device, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled: true }
    expect(stationLeadText({ ...base, queue })).toBe(deviceLostMessage('PC'))
    expect(stationLeadShortText({ ...base, queue })).toBe("라벨이 안 나가요 · 'PC' 화면을 켜 주세요")
    expect(stationLeadShortText({ ...base, queue: { ...queue, device: { ...device, live: true } } })).toBeNull()
    expect(stationLeadShortText({ ...base, queue: { ...queue, device: null, waiting: 3 } })).toBe('라벨이 안 나가요 · 프린터를 연결해 주세요') // QL3R2 D-QL3R2-03 · MOB2 D-MOB2-17
    expect(stationLeadShortText({ ...base, mine: true, queue })).toBeNull()
    expect(stationLeadShortText({ ...base, rehearsal: true, queue })).toBeNull()
  })

  it('접힌 띠: "알림" 영역 안의 항목·이름은 그대로(긴 문장), 영역 밖 자기 줄에 짧은 문장 단추 — 누르면 같은 곳. 펼치면 짧은 줄이 없다', () => {
    const onClick = vi.fn()
    const name = '<b>굵게</b>'
    const lead = { key: 'print-station', text: deviceLostMessage(name), shortText: deviceLostShortMessage(name), soft: true, uncounted: true, onClick }
    const { rerender } = render(<AlertStrip leads={[lead]} counts={counts} onOpen={() => undefined} expanded={false} onToggle={() => undefined} />)
    const region = screen.getByRole('region', { name: '알림' })
    expect(within(region).queryByRole('button', { name: deviceLostMessage(name) })).toBeNull() // QL3R2 D-QL3R2-02 — 접힌 휴대폰 띠는 짧은 줄 하나만(이중 표시 없음)
    expect(within(region).queryByText(/라벨이 안 나가요/)).toBeNull()
    const short = screen.getByRole('button', { name: "라벨이 안 나가요 · '<b>굵게</b>' 화면을 켜 주세요" })
    expect(region.contains(short)).toBe(false)
    expect(short.querySelector('b')).toBeNull()
    fireEvent.click(short)
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(<AlertStrip leads={[lead]} counts={counts} onOpen={() => undefined} expanded onToggle={() => undefined} />)
    expect(screen.queryByText(/라벨이 안 나가요/)).toBeNull()
    expect(within(screen.getByRole('region', { name: '알림' })).getByRole('button', { name: deviceLostMessage(name) })).toBeDefined() // QL3R2 D-QL3R2-02 — 펼치면 긴 문장
  })
})

describe('찜 취소·무효 빠른 사유 (D-QL3R1-05, AC-QL3R1-30~32)', () => {
  it('"무효로 하기" 창: 숫자 키 2 → 사유 "장난 찜"으로 바로 5초 대기, 창은 닫힌다', async () => {
    setup([register(15, '핑크프릴', 10000), chat('m1', 'UC_hong1234', '홍길동', '15')])
    const { quick } = await openConsole()
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    fireEvent.click(within(within(detail).getByRole('region', { name: '1등' })).getByRole('button', { name: '무효로 하기' }))
    const reason = await screen.findByRole('dialog', { name: '15번 홍길동 무효' })
    const close = within(reason).getByRole('button', { name: '닫기' })
    await waitFor(() => expect(document.activeElement).toBe(close))
    fireEvent.keyDown(close, { key: '2' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '15번 홍길동 무효' })).toBeNull())
    expect(await screen.findByText(/뒤 보내요: 15번 홍길동 무효/)).toBeDefined()
    await waitFor(() => expect(engine.posts.filter((post) => post.type === 'host.reject')).toHaveLength(1))
    expect(engine.posts.find((post) => post.type === 'host.reject')).toMatchObject({ no: 15, reason: '장난 찜' })
  })

  it('찜 취소 창: 사유 없이 "찜 취소하기"는 막고, 칸에 숫자를 치면 글자로 들어간다(보내지 않음), 직접 적은 사유는 Enter로', async () => {
    setup([register(15, '핑크프릴', 10000), chat('m1', 'UC_hong1234', '홍길동', '15')])
    const { quick } = await openConsole()
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    fireEvent.click(within(within(detail).getByRole('region', { name: '1등' })).getByRole('button', { name: '찜 취소하기' }))
    const reason = await screen.findByRole('dialog', { name: '15번 홍길동 취소' })
    fireEvent.click(within(reason).getByRole('button', { name: '찜 취소하기' }))
    expect(await within(reason).findByText('사유를 적어 주세요.')).toBeDefined()
    const field = within(reason).getByLabelText('사유') as HTMLInputElement
    field.focus()
    fireEvent.keyDown(field, { key: '1' })
    fireEvent.change(field, { target: { value: '1 직접 적은 사유' } })
    expect(screen.getByRole('dialog', { name: '15번 홍길동 취소' })).toBeDefined()
    expect(engine.posts.filter((post) => post.type === 'host.cancel')).toHaveLength(0)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByText(/뒤 보내요: 15번 홍길동 취소/)).toBeDefined()
    await waitFor(() => expect(engine.posts.filter((post) => post.type === 'host.cancel')).toHaveLength(1))
    expect(engine.posts.find((post) => post.type === 'host.cancel')).toMatchObject({ reason: '1 직접 적은 사유' })
  })

  it('다른 사유 창(차단)은 그대로 — 빠른 사유를 고르면 보내기 단추로 초점, 보내지 않는다', async () => {
    setup([register(15, '핑크프릴', 10000), chat('m1', 'UC_hong1234', '홍길동', '15')])
    const { quick } = await openConsole()
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    fireEvent.click(within(detail).getByRole('button', { name: '차단하기' }))
    const reason = await screen.findByRole('dialog', { name: '홍길동 차단' })
    fireEvent.click(within(reason).getByRole('button', { name: '2 장난 찜' }))
    const send = within(reason).getAllByRole('button', { name: '차단하기' }).at(-1) as HTMLElement
    expect(document.activeElement).toBe(send)
    expect(screen.getByRole('dialog', { name: '홍길동 차단' })).toBeDefined()
    await flush(5)
    expect(engine.posts.filter((post) => post.type === 'host.blockBuyer')).toHaveLength(0)
  })
})

describe('휴대폰 콘솔 차례 (D-QL3R1-03, AC-QL3R1-20)', () => {
  it('현재 상품 → 상품 보드 → 채팅 → 행동 줄(방송 목록·상품 목록 가져오기·방송 끝내기) → 여러 플랫폼·유튜브 칸 (DOM 차례)', async () => {
    setup([register(15, '핑크프릴', 10000)])
    const { container } = await openConsole()
    const main = container.querySelector('main') as HTMLElement
    const current = within(main).getByRole('region', { name: '현재 상품' })
    const board = within(main).getByRole('region', { name: '상품 보드' })
    const chatPanel = within(main).getByRole('region', { name: '채팅' })
    const end = within(main).getByRole('button', { name: '방송 끝내기' })
    const side = main.querySelector('.console-side') as HTMLElement
    const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(current, board)).toBe(true)
    expect(follows(board, chatPanel)).toBe(true)
    expect(follows(chatPanel, end)).toBe(true)
    expect(follows(end, side)).toBe(true)
  })

  it('요약 줄: 문장 전체가 title에도 있다 (휴대폰 큰 글씨 한 줄 말줄임, D-QL3R1-02 ⓒ)', async () => {
    setup([register(15, '핑크프릴', 10000)])
    await openConsole()
    const line = screen.getByRole('status', { name: '현재 상품 요약' })
    expect(line.getAttribute('title')).toBe(line.textContent)
    expect(line.textContent).toBe('15번 핑크프릴 · 판매 중 · 1등 아직 없음 · 대기 0명')
  })
})

describe('쉬운 낱말 (D-QL3R1-06·07)', () => {
  it('입금 붙여넣기 안내·오류에 "CSV 파일"이 없다', () => {
    expect(PASTE_HINT).toBe('은행 거래내역 표를 첫 줄(거래일시·입금액 같은 칸 이름)까지 복사해 붙여 넣거나 은행에서 받은 파일(.csv)을 골라 주세요. 출금 줄은 넣지 않아요.')
    expect(FILE_ERROR).toBe('파일을 읽지 못했어요. 은행에서 받은 .csv 파일인지 확인해 주세요.')
  })

  it('봉인 예고: "이 날짜 기록은 11월 25일 0시부터 잠겨요. 그 뒤로는 고칠 수 없어요."', () => {
    expect(sealAtWords('2026-11-24T15:00:00.000Z')).toBe('이 날짜 기록은 11월 25일 0시부터 잠겨요. 그 뒤로는 고칠 수 없어요.')
  })

  // QL3R1 D-QL3R1-10: 칸 제목이 "상품 관리"로 바뀜(AC-QL3R1-47)
  it('상품 자세히: 칸 제목 "상품 관리"(이름도), 옛 이름 "상품 바꾸기"·"상품 명령" 없음, 찜 목록 위 한 줄 설명', async () => {
    setup([register(15, '핑크프릴', 10000), chat('m1', 'UC_hong1234', '홍길동', '15')])
    const { quick } = await openConsole()
    enter(quick, '15')
    const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
    expect(within(detail).getByRole('region', { name: '상품 관리' })).toBeDefined()
    expect(within(detail).getByRole('heading', { name: '상품 관리' })).toBeDefined()
    expect(within(detail).queryByText('상품 바꾸기')).toBeNull()
    expect(within(detail).queryByText('상품 명령')).toBeNull()
    expect(within(detail).getByText('찜 취소: 손님이 안 사기로 했을 때 · 무효: 장난이나 잘못 들어온 찜 · 확인(잠금): 늦게 온 찜이 이 1등을 저절로 밀어내지 않게')).toBeDefined()
  })
})
