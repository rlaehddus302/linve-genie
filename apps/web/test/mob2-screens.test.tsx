// MOB2 화면 — 접힌 알림 띠의 넘친 칩 숨김(AC-MOB2-02), 되돌리기 띠의 결과 한 줄·다시 보내기 문장(AC-MOB2-10·40·41),
// "상품 관리"(AC-MOB2-20), 시간이 지난 보류 찜(AC-MOB2-30·32) — D-MOB2-02·04·05·06·07.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import type { WriteResult } from '../src/api/types.ts'
import { PendingDialog } from '../src/components/AlertDialogs.tsx'
import { AlertStrip, markOverflow } from '../src/components/AlertStrip.tsx'
import { ConsoleContext, type ConsoleApi } from '../src/components/console-context.ts'
import { ProductDetail } from '../src/components/ProductDetail.tsx'
import { UndoBar } from '../src/components/UndoBar.tsx'
import { BuyerNames } from '../src/lib/derive.ts'
import { AUTO_RESEND_NOTE, ResendBoard, STATUS_CHANGED_NOTE } from '../src/lib/resend-board.ts'
import type { ScopeData } from '../src/lib/scope-data.ts'
import { UndoQueue, type Timer } from '../src/lib/undo-queue.ts'
import { T0, chat, dataOf, register, sms } from './engine.ts'
import { DATE, flush } from './support.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function apiOf(data: ScopeData): ConsoleApi {
  return {
    b: 'b1',
    date: DATE,
    rehearsal: false,
    ended: false,
    sealed: false,
    data,
    names: new BuyerNames(data.buyers, data.claims),
    waiting: { claims: new Set(), products: new Set() },
    delayMs: 5000,
    settingsOf: (id) => data.broadcasts.get(id)?.settings ?? null,
    openDialog: () => {},
    closeTop: () => {},
    closeAll: () => {},
    queueHost: () => {},
    command: () => Promise.reject(new Error('보내지 않는다')),
    write: () => Promise.reject(new Error('보내지 않는다')),
    fillQuick: () => {},
    select: () => {},
  }
}

const rect = (left: number, top: number, right: number, bottom: number): DOMRect =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect

describe('접힌 알림 띠: 상자 전체가 띠 안에 들지 않는 칩은 보이지 않는다 (AC-MOB2-02, D-MOB2-02)', () => {
  const counts = { conflict: 1, cancelRequest: 0, succession: 0, pending: 1, attention: 1 }

  it('둘째 줄로 넘친 칩·옆으로 반쯤 잘린 칩에 data-overflow, 첫 칩은 늘 보임 — 펼치면 모두 지움', () => {
    // 띠 상자 0~300 × 0~44. 첫 칩은 띠 안, 둘째는 옆으로 반쯤(280~340), 셋째는 둘째 줄(50~94)
    const boxes = [rect(0, 0, 120, 44), rect(280, 0, 340, 44), rect(0, 50, 100, 94)]
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('alerts')) return rect(0, 0, 300, 44)
      if (this.tagName === 'LI') {
        const index = [...(this.parentElement?.children ?? [])].indexOf(this)
        return boxes[index] ?? rect(0, 0, 0, 0)
      }
      return rect(0, 0, 0, 0)
    })
    const { rerender } = render(<AlertStrip counts={counts} onOpen={() => {}} expanded={false} onToggle={() => {}} />)
    const items = [...screen.getByRole('region', { name: '알림' }).querySelectorAll('li')]
    expect(items.map((item) => item.getAttribute('data-overflow'))).toEqual([null, 'true', 'true'])
    // 숨긴 칩의 글은 띠 안에 그대로(접근성 트리에서만 빠짐 — visibility: hidden은 styles.css), 펼치기 단추 이름은 세는 알림 수 그대로
    expect(screen.getByRole('button', { name: '알림 3 펼치기' })).toBeDefined()
    rerender(<AlertStrip counts={counts} onOpen={() => {}} expanded onToggle={() => {}} />)
    expect(items.map((item) => item.getAttribute('data-overflow'))).toEqual([null, null, null])
    rerender(<AlertStrip counts={counts} onOpen={() => {}} expanded={false} onToggle={() => {}} />)
    expect(items.map((item) => item.getAttribute('data-overflow'))).toEqual([null, 'true', 'true'])
  })

  it('첫 칩이 넘쳐도 숨기지 않고, 1px 차이는 안으로 본다', () => {
    const strip = document.createElement('section')
    const list = document.createElement('ul')
    list.className = 'alerts-list'
    const first = document.createElement('li')
    const second = document.createElement('li')
    list.append(first, second)
    strip.append(list)
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 300, 44))
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 44))
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(rect(250, -1, 301, 45))
    markOverflow(strip, false)
    expect(first.hasAttribute('data-overflow')).toBe(false)
    expect(second.hasAttribute('data-overflow')).toBe(false)
  })
})

class ManualTimer implements Timer {
  now = 0
  #next = 1
  readonly #tasks = new Map<number, { at: number; fn: () => void }>()
  set(fn: () => void, ms: number): unknown {
    const id = this.#next++
    this.#tasks.set(id, { at: this.now + ms, fn })
    return id
  }
  clear(handle: unknown): void {
    this.#tasks.delete(handle as number)
  }
  advance(ms: number): void {
    const end = this.now + ms
    for (;;) {
      const due = [...this.#tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (due === undefined) break
      this.#tasks.delete(due[0])
      this.now = due[1].at
      due[1].fn()
    }
    this.now = end
  }
}

const written = (changed = true): WriteResult => ({ date: DATE, rehearsal: false, seq: 3, type: 'host.cancel', changed, effects: [] })

function Bar({ queue }: { readonly queue: UndoQueue }) {
  return <UndoBar items={queue.getSnapshot()} queue={queue} />
}

describe('되돌리기 띠: 결과 한 줄과 다시 보내기 문장 (AC-MOB2-10·40·41, D-MOB2-04·07)', () => {
  it('1등 찜 취소 결과 줄(role=status, 이름은 글자 그대로)과 "확인", "보냈어요"는 없다', async () => {
    const timer = new ManualTimer()
    const queue = new UndoQueue({ timer, now: () => timer.now, delayMs: 5000 })
    queue.add({ label: '15번 <b>해커</b> 취소', send: async () => written(), outcome: async () => ({ text: '15번 새 1등: <b>김철수</b>', tone: 'success' }) })
    timer.advance(5000)
    await flush()
    const { rerender } = render(<Bar queue={queue} />)
    const bar = screen.getByRole('region', { name: '보내기 전 조치' })
    expect(within(bar).getByRole('status').textContent).toBe('15번 새 1등: <b>김철수</b>')
    expect(bar.querySelectorAll('b')).toHaveLength(0)
    expect(bar.textContent).not.toContain('보냈어요')
    expect(bar.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('success')
    fireEvent.click(within(bar).getByRole('button', { name: '확인' }))
    rerender(<Bar queue={queue} />)
    expect(screen.queryByRole('region', { name: '보내기 전 조치' })).toBeNull()
  })

  it('저장 실패(네트워크)면 실패 줄 끝에 "연결이 돌아오면 저절로 다시 보내요. 바로 보내려면 …"(D-MOB2-16 (2)), 서버 오류(500)에는 없다 — 저절로 보내면 "연결이 돌아와 보냈어요: …"', async () => {
    const timer = new ManualTimer()
    const queue = new UndoQueue({ timer, now: () => timer.now, delayMs: 5000, retry: { delays: [], sleep: async () => {} } })
    let fail: ApiError | null = new ApiError({ status: 0, code: 'NETWORK', message: '인터넷 연결을 확인해 주세요.', network: true })
    queue.add({
      label: '15번 홍길동 취소',
      send: async () => {
        if (fail !== null) throw fail
        return written()
      },
    })
    queue.add({ label: '16번 박영희 취소', send: async () => Promise.reject(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: '서버에 문제가 생겼어요.' })) })
    timer.advance(5000)
    await flush(10)
    const { rerender } = render(<Bar queue={queue} />)
    const alerts = screen.getAllByRole('alert').map((item) => item.textContent ?? '')
    expect(alerts[0]).toContain('15번 홍길동 취소 — 저장하지 못했어요.')
    expect(alerts[0]?.endsWith(" 연결이 돌아오면 저절로 다시 보내요. 바로 보내려면 '다시 보내기'를 눌러도 돼요.")).toBe(true) // MOB2 D-MOB2-16 (2)
    expect(alerts[1]).not.toContain('연결이 돌아오면')
    fail = null
    await act(async () => {
      await queue.resendRetryable()
    })
    rerender(<Bar queue={queue} />)
    expect(screen.getAllByRole('status').map((item) => item.textContent)).toContain('연결이 돌아와 보냈어요: 15번 홍길동 취소')
  })

  it('U-MOB2-07: 띠의 시계가 줄이 생기기 전 값이어도 남은 초는 대기 시간(2초·등록 되돌리기 시간)을 넘지 않는다', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    const queue = new UndoQueue({ timer: new ManualTimer(), now: () => Date.now(), delayMs: 2000, registerUndoMs: 3000 })
    const { rerender } = render(<Bar queue={queue} />)
    // 띠가 처음 그려진 뒤 1.5초가 지나서 줄이 생긴다 (띠의 시계는 아직 처음 값)
    vi.setSystemTime(1_001_500)
    queue.add({ label: '15번 홍길동 취소', send: async () => written() })
    queue.addRegistration({ no: 16, product: 'b1/16', undo: async () => 'undone' })
    rerender(<Bar queue={queue} />)
    const bar = screen.getByRole('region', { name: '보내기 전 조치' })
    expect(bar.textContent).toContain('2초 뒤 보내요: 15번 홍길동 취소')
    expect([...bar.querySelectorAll('.countdown')].map((item) => item.textContent)).toEqual(['남은 시간 2초', '남은 시간 3초'])
  })

  it('저절로 다시 보낸 등록은 "연결이 돌아와 보냈어요: 15번을 등록했어요" + 되돌리기', () => {
    const queue = new UndoQueue({ timer: new ManualTimer(), now: () => 0 })
    queue.addRegistration({ no: 15, product: 'b1/15', undo: async () => 'undone', auto: true })
    render(<Bar queue={queue} />)
    expect(screen.getByRole('status').textContent).toBe('연결이 돌아와 보냈어요: 15번을 등록했어요')
    expect(screen.getByRole('button', { name: '15번 등록 되돌리기' })).toBeDefined()
  })
})

describe('상품 자세히 "상품 관리" (AC-MOB2-20, D-MOB2-05)', () => {
  it('일시 중지·판매 종료·고치기가 든 영역의 제목·이름이 "상품 관리", "상품 명령"은 없다', () => {
    const data = dataOf([register(15, '핑크프릴', 10000), chat('m1', 'UC_a', '홍길동', '15')])
    render(
      <ConsoleContext.Provider value={apiOf(data)}>
        <ProductDetail productKey="b1/15" onClose={() => {}} onEdit={() => {}} />
      </ConsoleContext.Provider>,
    )
    const section = screen.getByRole('region', { name: '상품 관리' })
    expect(within(section).getByRole('heading', { name: '상품 관리' })).toBeDefined()
    expect(within(section).getByRole('button', { name: '일시 중지' })).toBeDefined()
    expect(within(section).getByRole('button', { name: '고치기' })).toBeDefined()
    expect(document.body.textContent).not.toContain('상품 명령')
  })
})

describe('시간이 지난 보류 찜 (AC-MOB2-30·32, D-MOB2-06)', () => {
  /** 31번 보류 찜(T0 + 1초), 32번 보류 찜(T0 + 21초) */
  function pendingData(): ScopeData {
    const events: Record<string, unknown>[] = [register(1, '자리', 1000), sms('r1', 31, { memo: '김씨' })]
    for (let i = 0; i < 19; i++) events.push(chat(`m${String(i)}`, `UC_x${String(i)}`, `시청자${String(i)}`, '안녕하세요'))
    events.push(sms('r2', 32, { memo: '이씨' }))
    return dataOf(events)
  }
  const t0 = T0 + 1000

  it('보류 찜 창: 위는 시간이 지나지 않은 번호(번호 넣기), 아래 "시간이 지난 보류 찜"에 "31번 1개"(번호 넣기 없음)', () => {
    const api = apiOf(pendingData())
    const draw = (now: number) => (
      <ConsoleContext.Provider value={api}>
        <PendingDialog now={now} onClose={() => {}} />
      </ConsoleContext.Provider>
    )
    const { rerender } = render(draw(t0 + 30_000))
    expect(screen.queryByRole('region', { name: '시간이 지난 보류 찜' })).toBeNull()
    expect(screen.getByRole('button', { name: '31번 번호 넣기' })).toBeDefined()
    rerender(draw(t0 + 31_000))
    const late = screen.getByRole('region', { name: '시간이 지난 보류 찜' })
    expect(within(late).getByRole('heading', { name: '시간이 지난 보류 찜' })).toBeDefined()
    expect(within(late).getByRole('listitem').textContent).toBe('31번 1개')
    expect(screen.queryByRole('button', { name: '31번 번호 넣기' })).toBeNull()
    expect(screen.getByRole('button', { name: '32번 번호 넣기' })).toBeDefined()
    // "최근 만료된 찜"(엔진 EXPIRED)은 그대로
    expect(screen.getByRole('dialog', { name: '보류 찜' }).textContent).toContain('최근 만료된 찜')
  })

  it('상품 자세히의 공개 전(READY) 상품 보류 찜 줄: 1초 안에 "보류" → "보류 · 시간 지남"', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: T0 })
    const data = dataOf([{ type: 'product.register', b: 'b1', no: 31, name: '공개전', price: 1000, status: 'READY' }, sms('r1', 31, { memo: '김씨' })])
    const claim = [...data.claims.values()][0]
    if (claim === undefined) throw new Error('찜')
    const at = Date.parse(claim.at)
    vi.setSystemTime(at + 29_000)
    render(
      <ConsoleContext.Provider value={apiOf(data)}>
        <ProductDetail productKey="b1/31" onClose={() => {}} onEdit={() => {}} />
      </ConsoleContext.Provider>,
    )
    const section = screen.getByRole('region', { name: '보류·충돌 찜' })
    expect(within(section).getByText('보류', { exact: true })).toBeDefined()
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(within(section).getByText('보류', { exact: true })).toBeDefined()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(within(section).getByText('보류 · 시간 지남', { exact: true })).toBeDefined()
    expect(section.textContent).not.toContain('만료')
  })
})

describe('상품 관리 명령의 저절로 다시 보내기는 상품마다 하나, 상태가 바뀌면 보내지 않는다 (RA-MOB2-01, D-MOB2-07, AC-MOB2-42)', () => {
  const networkError = () => new ApiError({ status: 0, code: 'NETWORK', message: '인터넷 연결이 끊겼어요.', network: true })
  const ok = (): WriteResult => ({ seq: 1, changed: true }) as WriteResult

  function setup(initial: ScopeData) {
    const board = new ResendBoard()
    let current = initial
    let online = false
    const sent: { type: unknown; requestId: string | undefined }[] = []
    const api: ConsoleApi = {
      ...apiOf(initial),
      resend: board,
      latest: () => current,
      command: (event, requestId) => {
        sent.push({ type: event.type, requestId })
        return online ? Promise.resolve(ok()) : Promise.reject(networkError())
      },
    }
    const view = render(
      <ConsoleContext.Provider value={api}>
        <ProductDetail productKey="b1/15" onClose={() => {}} onEdit={() => {}} />
      </ConsoleContext.Provider>,
    )
    return {
      board,
      sent,
      view,
      goOnline: () => {
        online = true
      },
      setData: (data: ScopeData) => {
        current = data
      },
    }
  }

  const opened = () => dataOf([register(15, '핑크프릴', 10000)])
  const held = () => dataOf([register(15, '핑크프릴', 10000), { type: 'product.hold', b: 'b1', no: 15 }])

  it('실패한 일시 중지 뒤 직접 다시 눌러 보냄 → 옛 실패는 내려가고, 연결이 돌아와도 옛 요청 번호로 다시 가지 않는다', async () => {
    const t = setup(opened())
    fireEvent.click(screen.getByRole('button', { name: '일시 중지' }))
    await act(flush)
    expect(t.board.has('command:b1/15')).toBe(true)
    expect(screen.getByText(AUTO_RESEND_NOTE)).toBeDefined()
    const first = t.sent[0]?.requestId
    // 연결이 돌아오자마자(실시간 다시 잇기 전) 판매자가 "일시 중지"를 다시 눌러 새 번호로 성공
    t.goOnline()
    fireEvent.click(screen.getByRole('button', { name: '일시 중지' }))
    await act(flush)
    expect(t.board.size).toBe(0)
    // 그 뒤 판매자가 "다시 판매" — 실시간이 다시 이어져도 옛 일시 중지는 가지 않는다
    await act(() => t.board.flush())
    expect(t.sent.filter((item) => item.requestId === first)).toHaveLength(1)
    expect(t.sent.map((item) => item.type)).toEqual(['product.hold', 'product.hold'])
  })

  it('창을 닫았고 그사이 상태가 바뀌었으면(일시 중지가 이미 됨) 저절로 보내지 않는다', async () => {
    const t = setup(opened())
    fireEvent.click(screen.getByRole('button', { name: '일시 중지' }))
    await act(flush)
    t.view.unmount()
    t.goOnline()
    t.setData(held())
    await act(() => t.board.flush())
    expect(t.sent).toHaveLength(1)
    expect(t.board.size).toBe(0)
  })

  it('창이 열린 채 상태가 바뀌었으면 보내지 않고 "그사이 상품 상태가 바뀌어…" 안내', async () => {
    const t = setup(opened())
    fireEvent.click(screen.getByRole('button', { name: '일시 중지' }))
    await act(flush)
    t.goOnline()
    t.setData(held())
    await act(() => t.board.flush())
    expect(t.sent).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: '상품 관리' })).getByRole('status').textContent).toBe(STATUS_CHANGED_NOTE)
    expect(screen.queryByText(AUTO_RESEND_NOTE)).toBeNull()
  })

  it('상태가 그대로면(판매 중 ↔ 다 팔림 포함) 창이 닫혀 있어도 같은 요청 번호로 한 번 (AC-MOB2-42)', async () => {
    const t = setup(opened())
    fireEvent.click(screen.getByRole('button', { name: '일시 중지' }))
    await act(flush)
    t.view.unmount()
    t.goOnline()
    await act(() => t.board.flush())
    expect(t.sent).toHaveLength(2)
    expect(t.sent[1]?.requestId).toBe(t.sent[0]?.requestId)
  })

  it('실패 안내의 "확인"을 누르면 저절로 보내지 않는다 (판매자가 닫은 것) — 창의 "닫기"와 이름이 겹치지 않는다', async () => {
    const t = setup(opened())
    fireEvent.click(screen.getByRole('button', { name: '일시 중지' }))
    await act(flush)
    expect(screen.getAllByRole('button', { name: /닫기/ }).map((button) => button.textContent)).not.toContain('확인')
    fireEvent.click(within(screen.getByRole('region', { name: '상품 관리' })).getByRole('button', { name: '확인' }))
    expect(within(screen.getByRole('region', { name: '상품 관리' })).queryByRole('alert')).toBeNull()
    t.goOnline()
    await act(() => t.board.flush())
    expect(t.sent).toHaveLength(1)
  })
})
