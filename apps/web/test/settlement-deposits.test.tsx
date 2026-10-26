// 정산 자세히의 입금 연결·되돌리기·리허설 안내 (N3 — AC-N3-47·48, AC-N3-32 계약). 실제 코어로 도는 가짜 서버에 입금 연결을 덧붙인다.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { DepositLinkView } from '../src/api/deposit-types.ts'
import type { Changes } from '../src/api/types.ts'
import { REHEARSAL_DEPOSITS, SettlementsPage } from '../src/components/SettlementsPage.tsx'
import type { Route, ScopeRoute } from '../src/lib/router.ts'
import { applyChanges, fromFull } from '../src/lib/scope-data.ts'
import { chat, register, viewOf } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, apiError, flush } from './support.ts'

let engine: EngineServer
let links: DepositLinkView[] = []

const link = (patch: Partial<DepositLinkView> = {}): DepositLinkView => ({
  seq: 3,
  kind: 'payment',
  auto: true,
  reverted: false,
  deposit: { no: 3, name: '김영희', at: '2026-10-19T12:03:00.000Z', precision: 'minute', amount: 14000, source: '시험용 입금', sourceKind: 'FAKE' },
  ...patch,
})

/** 가나 14,000원(1부 15번 10,000 + 배송비) — seq 3 입금은 입금 확인이 적음, 다라는 손으로 같은 메모를 적은 입금(연결 없음) */
const EVENTS = [
  register(15, '핑크프릴', 10000),
  chat('m1', 'c1', '가나', '15'),
  { type: 'settlement.payment', buyer: 'c1', date: DATE, amount: 14000, memo: '자동 입금 확인 · 입금 #3' },
  register(16, '청보석', 7000),
  chat('m2', 'c2', '다라', '16'),
  { type: 'settlement.payment', buyer: 'c2', date: DATE, amount: 11000, memo: '자동 입금 확인 · 입금 #3' },
]

function Harness({ initial }: { readonly initial: ScopeRoute }) {
  const [route, setRoute] = useState<Route>(initial)
  return route.name === 'settlements' ? <SettlementsPage route={route} navigate={setRoute} /> : null
}

async function open(initial: ScopeRoute = { name: 'settlements', date: DATE, rehearsal: false, buyer: 'c1' }) {
  engine = new EngineServer(EVENTS)
  links = [link()]
  let since = 0
  engine.server
    .on('GET', new RegExp(`^/api/days/${DATE}$`), () => ({ body: { ...viewOf(engine.state, engine.seq), depositLinks: links } }))
    .on('GET', new RegExp(`^/api/days/${DATE}\\?rehearsal=true$`), () => ({ body: { ...viewOf(engine.state, engine.seq), rehearsal: true, depositLinks: links } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/changes\\?since=(\\d+)`), (_call, match) => {
      since = Number(match[1])
      const changes = engine.changes(since)
      // 서버처럼: 정산 묶음이 바뀐 증분에만 입금 연결(범위 전체)
      return { body: changes.settlements.length > 0 ? { ...changes, depositLinks: links } : changes }
    })
    .on('POST', /^\/api\/deposits\/3\/revert$/, () => {
      engine.writeQuietly({ type: 'settlement.refund', buyer: 'c1', date: DATE, amount: 14000, reason: '입금 확인 되돌림 · 입금 #3' })
      links = [link({ reverted: true }), link({ seq: engine.seq, kind: 'refund', auto: false })]
      queueMicrotask(() => FakeEventSource.instances.at(-1)?.emit('change', { date: DATE, rehearsal: false, seq: engine.seq, type: 'settlement.refund' }))
      return { body: { deposit: { no: 3, status: 'REVIEW', applied: null }, refund: { date: DATE, seq: engine.seq } } }
    })
  vi.stubGlobal('fetch', engine.server.fetch)
  render(<Harness initial={initial} />)
  await flush(10)
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

const records = () => within(within(screen.getByRole('region', { name: '정산 자세히' })).getByRole('region', { name: '정산 기록' })).getAllByRole('listitem')

describe('정산 자세히의 입금 연결 (AC-N3-47)', () => {
  it('입금 확인이 적은 입금은 입금 정보를 보이고 "입금 확인 되돌리기"가 있다 — 연결은 서버의 seq로(메모 글을 읽지 않는다)', async () => {
    await open()
    const [payment] = records()
    expect(payment?.textContent).toBe('입금 14,000원 · 자동 입금 확인 · 김영희 · 10/19 21:03 · 입금 번호 3 · 기록한 때 10/19 10:00입금 확인 되돌리기') // MOB2 D-MOB2-05
    expect(within(payment as HTMLElement).getByRole('button', { name: '입금 확인 되돌리기' })).toBeDefined()
    // 손으로 같은 메모를 적은 입금은 연결이 없다 (메모 그대로, 되돌리기 없음)
    fireEvent.click(screen.getByRole('button', { name: '정산 목록으로' }))
    await flush()
    fireEvent.click(within(screen.getByRole('list', { name: '정산 묶음' })).getAllByRole('link').find((item) => item.textContent?.startsWith('다라')) as HTMLElement)
    await flush()
    const [manual] = records()
    expect(manual?.textContent).toBe('입금 11,000원 · 자동 입금 확인 · 입금 번호 3 · 기록한 때 10/19 10:00') // MOB2 D-MOB2-05
    expect(within(manual as HTMLElement).queryByRole('button')).toBeNull()
  })

  it('"입금 확인 되돌리기"는 같은 확인 창을 거쳐 보내고, 되돌림 환불은 "입금 확인 되돌림 · 입금 번호 3" — 되돌린 입금에는 버튼이 없다', async () => { // MOB2 D-MOB2-05
    await open()
    fireEvent.click(screen.getByRole('button', { name: '입금 확인 되돌리기' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('가나 · 10월 19일 묶음에 적은 14,000원 입금을 되돌려요. 같은 금액의 환불 기록이 남고 이 입금은 확인 필요로 돌아가요.')
    fireEvent.click(within(dialog).getByRole('button', { name: '되돌리기' }))
    await flush(20)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(records().map((item) => item.textContent)).toEqual([
      '입금 14,000원 · 자동 입금 확인 · 김영희 · 10/19 21:03 · 입금 번호 3 · 되돌림 · 기록한 때 10/19 10:00', // MOB2 D-MOB2-05
      '환불 14,000원 · 입금 확인 되돌림 · 입금 번호 3 · 기록한 때 10/19 10:00', // MOB2 D-MOB2-05
    ])
    expect(screen.queryByRole('button', { name: '입금 확인 되돌리기' })).toBeNull()
    expect(screen.getByText('입금 확인을 되돌렸어요. 같은 금액의 환불 기록을 적었어요.').getAttribute('data-tone')).toBe('success')
  })

  it('되돌리기 거절(409)은 서버 문장을 그대로 — 아무것도 바뀌지 않는다', async () => {
    await open()
    engine.server.on('POST', /^\/api\/deposits\/3\/revert$/, () => apiError(409, 'REFUND_RECORDED', '이미 환불을 적어서 되돌릴 수 없어요. 정산에서 확인해 주세요.'))
    fireEvent.click(screen.getByRole('button', { name: '입금 확인 되돌리기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '되돌리기' }))
    await flush(10)
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('이미 환불을 적어서 되돌릴 수 없어요. 정산에서 확인해 주세요.')
    expect(records()).toHaveLength(1)
  })
})

describe('리허설 (AC-N3-48)', () => {
  it('"리허설 묶음은 입금 확인에 쓰지 않아요." — 입금 연결·되돌리기가 없다', async () => {
    await open({ name: 'settlements', date: DATE, rehearsal: true, buyer: 'c1' })
    expect(screen.getByText(REHEARSAL_DEPOSITS).textContent).toBe('리허설 묶음은 입금 확인에 쓰지 않아요.')
    const [payment] = records()
    expect(payment?.textContent).toBe('입금 14,000원 · 자동 입금 확인 · 입금 번호 3 · 기록한 때 10/19 10:00') // MOB2 D-MOB2-05
    expect(screen.queryByRole('button', { name: '입금 확인 되돌리기' })).toBeNull()
  })
})

describe('범위 자료의 입금 연결 (scope-data)', () => {
  it('증분에 입금 연결이 없으면 그대로, 있으면 범위 전체로 바꾼다', () => {
    const data = fromFull({ ...viewOf(engine?.state ?? new EngineServer(EVENTS).state, 6), depositLinks: [link()] })
    expect([...data.depositLinks.keys()]).toEqual([3])
    const base: Changes = { ...new EngineServer(EVENTS).changes(6), since: 6, seq: 7 }
    const kept = applyChanges(data, base)
    expect(kept.depositLinks).toBe(data.depositLinks)
    const replaced = applyChanges(data, { ...base, depositLinks: [link({ reverted: true }), link({ seq: 7, kind: 'refund' })] })
    expect([...replaced.depositLinks.keys()]).toEqual([3, 7])
    expect(replaced.depositLinks.get(3)?.reverted).toBe(true)
    expect(fromFull(viewOf(new EngineServer(EVENTS).state, 6)).depositLinks.size).toBe(0)
  })
})
