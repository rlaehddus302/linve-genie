// MOB2 수정 라운드 3 (D-MOB2-15·16): 시간 지남은 이 탭이 찜을 처음 받은 때부터(휴대폰 시계 차이 없음, RA-MOB2-04),
// 결과 줄 "1등 고르기"·접힌 띠 "승계 n"(U-MOB2-02), 시간 지난 보류 찜 안내의 다음 할 일(U-MOB2-06).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { WriteResult } from '../src/api/types.ts'
import { SuccessionDialog } from '../src/components/AlertDialogs.tsx'
import { AlertStrip, SUCCESSION_SHORT_WORD } from '../src/components/AlertStrip.tsx'
import { ConsoleContext, type ConsoleApi } from '../src/components/console-context.ts'
import { ConsolePage } from '../src/components/ConsolePage.tsx'
import { UndoBar } from '../src/components/UndoBar.tsx'
import { ClaimSeen } from '../src/lib/claim-seen.ts'
import { BuyerNames, PENDING_TIMED_OUT_TAIL, alertCounts, claimWord, isPendingTimedOut, nextPendingFlip } from '../src/lib/derive.ts'
import type { ScopeData } from '../src/lib/scope-data.ts'
import { UndoQueue, type Timer } from '../src/lib/undo-queue.ts'
import { captureVacated, vacatedLine } from '../src/lib/vacated.ts'
import { T0, chat, dataOf, register, sms } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, fixtureClock, flush } from './support.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  onUnauthorized(null)
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

class ManualTimer implements Timer {
  now = 0
  readonly #tasks = new Map<number, { at: number; fn: () => void }>()
  #next = 1
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

// ── D-MOB2-15 처음 받은 시각 ─────────────────────────────────────────────

describe('시간 지남은 이 탭이 그 찜을 처음 받은 때부터 (RA-MOB2-04, D-MOB2-15)', () => {
  /** 번호 31(상품 없음)의 보류 찜 하나 */
  function pending(): { readonly data: ScopeData; readonly at: number } {
    const data = dataOf([register(1, '자리', 1000), sms('r1', 31, { memo: '김씨' })])
    const claim = [...data.claims.values()].find((item) => item.status === 'PENDING')
    if (claim === undefined) throw new Error('보류 찜')
    return { data, at: Date.parse(claim.at) }
  }
  const claimOf = (data: ScopeData) => {
    const claim = [...data.claims.values()].find((item) => item.status === 'PENDING')
    if (claim === undefined) throw new Error('보류 찜')
    return claim
  }

  it('시계가 서버보다 90초(W + 60초) 앞선 기기: 막 받은 보류 찜은 "보류"이고 알림 수에 든다 — 받은 뒤 30초 정각까지 그대로, 30초 + 1ms에 "보류 · 시간 지남"', () => {
    const { data, at } = pending()
    const arrived = at + 90_000 // 이 기기의 시계로 받은 때
    const noted = new ClaimSeen().note(data, arrived)
    const claim = claimOf(noted)
    expect(isPendingTimedOut(noted, claim, arrived)).toBe(false)
    expect(claimWord(noted, claim, arrived)).toBe('보류')
    expect(alertCounts(noted, arrived).pending).toBe(1)
    expect(isPendingTimedOut(noted, claim, arrived + 30_000)).toBe(false)
    expect(isPendingTimedOut(noted, claim, arrived + 30_001)).toBe(true)
    expect(claimWord(noted, claim, arrived + 30_001)).toBe('보류 · 시간 지남')
    expect(alertCounts(noted, arrived + 30_001).pending).toBe(0)
    // 다음에 바뀌는 때도 처음 받은 시각 기준
    expect(nextPendingFlip(noted, arrived)).toBe(arrived + 30_001)
    // 받은 시각 기록이 없는 자료(저장소를 거치지 않음)는 지금처럼 찜의 at — 같은 기기 시계면 이미 시간 지남
    expect(isPendingTimedOut(data, claim, arrived)).toBe(true)
  })

  it('같은 찜이 다시 와도(증분·전체 조회) 처음 받은 시각이 그대로다 — 새로 들어온 찜만 그때 시각', () => {
    const seen = new ClaimSeen()
    const { data, at } = pending()
    const first = seen.note(data, at + 5_000)
    const claim = claimOf(first)
    expect(first.seen?.get(claim.id)).toBe(at + 5_000)
    // 같은 찜이 든 새 자료(전체 조회를 다시 받음)를 한참 뒤에 받아도 처음 값
    const again = seen.note(dataOf([register(1, '자리', 1000), sms('r1', 31, { memo: '김씨' })]), at + 50_000)
    expect(again.seen?.get(claim.id)).toBe(at + 5_000)
    expect(isPendingTimedOut(again, claimOf(again), at + 35_001)).toBe(true)
    // 다른 찜이 더해진 자료: 새 찜만 그때 시각
    const more = seen.note(dataOf([register(1, '자리', 1000), sms('r1', 31, { memo: '김씨' }), sms('r2', 32, { memo: '이씨' })]), at + 60_000)
    const fresh = [...more.claims.values()].find((item) => item.no === 32)
    if (fresh === undefined) throw new Error('32번 찜')
    expect(more.seen?.get(claim.id)).toBe(at + 5_000)
    expect(more.seen?.get(fresh.id)).toBe(at + 60_000)
  })

  it('받은 시각 기록이 있는데 그 찜이 없으면 시간 지남이 아니다(늦게 바뀌는 쪽만) — 다른 범위(리허설)의 기록과 섞이지 않는다', () => {
    const seen = new ClaimSeen()
    const { data, at } = pending()
    const claim = claimOf(data)
    const other = seen.note({ ...data, rehearsal: true }, at)
    const live = { ...data, seen: seen.view(data) }
    expect(other.seen?.get(claim.id)).toBe(at)
    expect(live.seen.get(claim.id)).toBeUndefined()
    expect(isPendingTimedOut(live, claim, at + 999_999)).toBe(false)
    expect(nextPendingFlip(live, at)).toBeNull()
  })

  it('콘솔: 시계가 한참 앞선 기기로 연 화면의 보류 찜은 연 뒤 "보류 1"로 알림 띠에 든다 (처음 받은 때부터 잼)', async () => {
    const engine = new EngineServer([register(1, '자리', 1000), sms('r1', 31, { memo: '김씨' })])
    vi.stubGlobal('fetch', engine.server.fetch)
    vi.stubGlobal('EventSource', FakeEventSource)
    FakeEventSource.reset()
    // 찜의 at(T0 부근)보다 2분 앞선 시계 — 찜의 at과 바로 견주면 바로 "시간 지남"
    fixtureClock(T0 + 120_000)
    render(<ConsolePage broadcastId="b1" navigate={() => {}} />)
    await screen.findByLabelText('빠른 입력')
    await flush(10)
    const strip = screen.getByRole('region', { name: '알림' })
    expect(within(strip).getByRole('button', { name: '보류 1' })).toBeDefined()
    // 그 기기 시계로 31초가 지나고 화면이 다시 그려지면 알림 수에서 빠진다
    vi.setSystemTime(Date.now() + 31_000)
    engine.write(chat('m9', 'UC_z', '구경꾼', '안녕하세요'))
    await waitFor(() => expect(within(screen.getByRole('region', { name: '알림' })).queryByRole('button', { name: '보류 1' })).toBeNull())
  }, 15_000)
})

// ── D-MOB2-16 (1) "1등 고르기"·"승계 n" ───────────────────────────────────

const written = (): WriteResult => ({ date: DATE, rehearsal: false, seq: 3, type: 'host.cancel', changed: true, effects: [] })

describe('결과 줄 "1등 고르기"와 접힌 띠 "승계 n" (U-MOB2-02, D-MOB2-16 (1))', () => {
  /** 15번 1등 홍길동, 대기 김철수·이영희 */
  const events = [register(15, '핑크프릴', 10000), chat('m1', 'UC_a', '홍길동', '15'), chat('m2', 'UC_b', '김철수', '15'), chat('m3', 'UC_c', '이영희', '15')]
  const cancel = { type: 'host.cancel', b: 'b1', no: 15, buyer: 'UC_a', reason: '시청자 요청' }

  it('ASK 결과 줄에만 고를 단위가 붙는다 — 새 1등·대기 없음 결과에는 없다', () => {
    const settings = { 'cancel.succession': 'ASK' } as const
    const before = dataOf(events, settings)
    const winner = [...before.claims.values()].find((claim) => claim.currentBuyer === 'UC_a' && claim.status === 'CONFIRMED')
    if (winner === undefined) throw new Error('1등 찜')
    const captured = captureVacated(before, cancel, [winner.id])
    if (captured === null) throw new Error('잡은 모양')
    const line = vacatedLine(captured, dataOf([...events, cancel], settings))
    expect(line?.text).toBe('15번 1등 자리가 비었어요 · 대기 2명 — 누구를 1등으로 할지 골라 주세요')
    expect(line?.pick).toEqual({ product: 'b1/15', variant: null })
    const auto = vacatedLine(captured, dataOf([...events, cancel]))
    expect(auto?.text).toBe('15번 새 1등: 김철수')
    expect(auto?.pick).toBeUndefined()
  })

  it('되돌리기 띠: 고를 단위가 있는 결과 줄에 "1등 고르기"(누르면 그 단위로) — 다른 결과 줄·고를 곳이 없는 화면에는 없다', async () => {
    const timer = new ManualTimer()
    const queue = new UndoQueue({ timer, now: () => timer.now, delayMs: 5000 })
    queue.add({
      label: '15번 홍길동 취소',
      send: async () => written(),
      outcome: async () => ({ text: '15번 1등 자리가 비었어요 · 대기 2명 — 누구를 1등으로 할지 골라 주세요', tone: 'warning', pick: { product: 'b1/15', variant: null } }),
    })
    queue.add({ label: '16번 박영희 취소', send: async () => written(), outcome: async () => ({ text: '16번 새 1등: 최민수', tone: 'success' }) })
    timer.advance(5000)
    await flush(10)
    const onPick = vi.fn()
    const { rerender } = render(<UndoBar items={queue.getSnapshot()} queue={queue} onPick={onPick} />)
    const buttons = screen.getAllByRole('button', { name: '1등 고르기' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.closest('li')?.textContent).toContain('15번 1등 자리가 비었어요')
    fireEvent.click(buttons[0] as HTMLElement)
    expect(onPick).toHaveBeenCalledWith({ product: 'b1/15', variant: null })
    rerender(<UndoBar items={queue.getSnapshot()} queue={queue} />)
    expect(screen.queryByRole('button', { name: '1등 고르기' })).toBeNull()
  })

  it('승계 결정 창: 고른 상품의 단위를 맨 앞에 — 없으면 평소 차례', () => {
    const settings = { 'cancel.succession': 'ASK' } as const
    const two = [
      ...events,
      register(16, '청보석', 20000),
      chat('m4', 'UC_d', '박영희', '16'),
      chat('m5', 'UC_e', '최민수', '16'),
      cancel,
      { type: 'host.cancel', b: 'b1', no: 16, buyer: 'UC_d', reason: '시청자 요청' },
    ]
    const api = apiOf(dataOf(two, settings))
    const { rerender } = render(
      <ConsoleContext.Provider value={api}>
        <SuccessionDialog onClose={() => {}} />
      </ConsoleContext.Provider>,
    )
    expect(screen.getByRole('dialog').getAttribute('aria-label') ?? screen.getByRole('heading', { level: 2 }).textContent).toContain('15번')
    rerender(
      <ConsoleContext.Provider value={api}>
        <SuccessionDialog onClose={() => {}} pick={{ product: 'b1/16', variant: null }} />
      </ConsoleContext.Provider>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('승계 결정 — 16번 청보석')
    expect(dialog.textContent).toContain('대기 1번 최민수')
    expect(dialog.textContent).toContain('승계 결정 2개 중 첫 번째예요.')
  })

  it('알림 띠: 접힌 휴대폰은 "승계 1"(글 = 단추 이름), 펼친 띠·PC는 "승계 결정 필요 1"', () => {
    const counts = { conflict: 0, cancelRequest: 0, succession: 1, pending: 0, attention: 0 }
    const onOpen = vi.fn()
    const { rerender } = render(<AlertStrip counts={counts} onOpen={onOpen} expanded={false} onToggle={() => undefined} />)
    expect(SUCCESSION_SHORT_WORD).toBe('승계')
    const short = screen.getByRole('button', { name: '승계 1' })
    expect(short.textContent).toBe('승계 1')
    fireEvent.click(short)
    expect(onOpen).toHaveBeenCalledWith('succession')
    rerender(<AlertStrip counts={counts} onOpen={onOpen} expanded onToggle={() => undefined} />)
    expect(screen.getByRole('button', { name: '승계 결정 필요 1' }).textContent).toBe('승계 결정 필요 1')
    cleanup()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    render(<AlertStrip counts={counts} onOpen={onOpen} />)
    expect(screen.getByRole('button', { name: '승계 결정 필요 1' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '승계 1' })).toBeNull()
  })

  describe('콘솔', () => {
    let engine: EngineServer
    beforeEach(() => {
      engine = new EngineServer(events, { settings: { 'cancel.succession': 'ASK' } })
      vi.stubGlobal('fetch', engine.server.fetch)
      vi.stubGlobal('EventSource', FakeEventSource)
      FakeEventSource.reset()
    })

    it('1등 찜 취소 → 결과 줄 "1등 고르기" → 15번 승계 결정 창(대기 2명)', async () => {
      render(<ConsolePage broadcastId="b1" navigate={() => {}} />)
      const quick = (await screen.findByLabelText('빠른 입력')) as HTMLInputElement
      await flush(10)
      fireEvent.change(quick, { target: { value: '15' } })
      fireEvent.keyDown(quick, { key: 'Enter' })
      const detail = await screen.findByRole('dialog', { name: '15번 자세히' })
      fireEvent.click(within(detail).getAllByRole('button', { name: '찜 취소하기' })[0] as HTMLElement) // 첫 줄이 1등 홍길동
      const reason = await screen.findByRole('dialog', { name: '15번 홍길동 취소' })
      fireEvent.click(within(reason).getByRole('button', { name: '2 장난 찜' }))
      const line = await screen.findByText('15번 1등 자리가 비었어요 · 대기 2명 — 누구를 1등으로 할지 골라 주세요', {}, { timeout: 5000 })
      const bar = screen.getByRole('region', { name: '보내기 전 조치' })
      expect(bar.contains(line)).toBe(true)
      for (const dialog of screen.queryAllByRole('dialog')) fireEvent.keyDown(dialog, { key: 'Escape' })
      fireEvent.click(within(bar).getByRole('button', { name: '1등 고르기' }))
      const dialog = await screen.findByRole('dialog', { name: /^승계 결정 — 15번/ })
      expect(dialog.textContent).toContain('대기 1번 김철수')
      expect(dialog.textContent).toContain('대기 2번 이영희')
    }, 15_000)
  })
})

// ── D-MOB2-16 (3) ────────────────────────────────────────────────────────

describe('시간이 지난 보류 찜 결과 카드 끝 (U-MOB2-06, D-MOB2-16 (3))', () => {
  it('다음 할 일이 있는 문장', () => {
    expect(PENDING_TIMED_OUT_TAIL).toBe(' — 지금 등록해도 판정되지 않아요. 판매를 시작한 뒤 문자찜을 다시 넣어 주세요')
  })
})
