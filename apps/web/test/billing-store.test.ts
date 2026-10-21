// 요금 상태 저장소 (N5, AC-N5-13·54·55): 다시 받을 때 첫 장만 새로 받고 이미 이어 받은 뒤쪽은 그대로 둔다, 받는 중의 알림은 끝난 뒤 한 번 더 받는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageItem } from '../src/api/billing-types.ts'
import { BillingStore, mergeFirstPage } from '../src/lib/billing-store.ts'
import { billingStatus } from './billing-support.ts'
import { FakeEventSource, FakeServer, flush } from './support.ts'

const usage = (id: number): UsageItem => ({ id, kind: 'LABELS', at: '2026-10-20T11:00:00.000Z', broadcast: null, productNo: id, productName: null, windowUntil: null })
const list = (ids: number[], next: string | null = null) => ({ items: ids.map(usage), next, loadingMore: false, error: null })

describe('첫 장 다시 받기 (mergeFirstPage)', () => {
  it('처음이거나 예전 목록이 첫 장보다 길지 않으면 새 첫 장 그대로', () => {
    expect(mergeFirstPage({ items: null, next: null, loadingMore: false, error: null }, { items: [usage(2), usage(1)], next: 'n' })).toEqual({ items: [usage(2), usage(1)], next: 'n' })
    expect(mergeFirstPage(list([2, 1]), { items: [usage(3), usage(2)], next: 'x' })).toEqual({ items: [usage(3), usage(2)], next: 'x' })
  })

  it('이어 받은 뒤쪽은 그대로 두고 그 다음 이어 받기 기준도 그대로', () => {
    const merged = mergeFirstPage(list([5, 4, 3, 2, 1], 'old-next'), { items: [usage(6), usage(5), usage(4)], next: 'n' })
    expect(merged.items.map((item) => item.id)).toEqual([6, 5, 4, 3, 2, 1])
    expect(merged.next).toBe('old-next')
  })

  it('새 첫 장의 마지막이 예전 목록에 없으면(새 항목이 한 장 넘게) 새 첫 장만', () => {
    expect(mergeFirstPage(list([3, 2, 1, 0], 'old'), { items: [usage(9), usage(8)], next: 'n' })).toEqual({ items: [usage(9), usage(8)], next: 'n' })
  })
})

describe('BillingStore', () => {
  let server: FakeServer
  beforeEach(() => {
    server = new FakeServer()
    vi.stubGlobal('fetch', server.fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeEventSource.reset()
  })

  it('요금 알림·다시 붙음(ready)에 다시 받고, 받는 중에 온 알림은 끝난 뒤 한 번 더 — 내역은 요금 화면일 때만', async () => {
    let release: (() => void) | null = null
    let calls = 0
    server.on('GET', /^\/api\/billing$/, async () => {
      calls += 1
      if (calls === 2) await new Promise<void>((resolve) => (release = resolve))
      return { body: billingStatus({ balances: { DAYS: calls, ORDERS: 0, LABELS: 0 } }) }
    })
    const source = new FakeEventSource('/api/stream')
    const timers: (() => void)[] = []
    const store = new BillingStore({ openStream: () => source, lists: false, timer: { set: (fn) => timers.push(fn), clear: () => {} }, watchVisible: () => () => {} })
    const reasons: string[] = []
    store.onNotice((reason) => reasons.push(reason))
    store.start()
    await flush(5)
    expect(store.getSnapshot().status?.balances.DAYS).toBe(1)
    source.emit('billing', { reason: 'grant' })
    await flush(2)
    source.emit('billing', { reason: 'order' })
    source.emit('ready', { scopes: [] })
    await flush(2)
    expect(calls).toBe(2)
    ;(release as (() => void) | null)?.()
    await flush(10)
    expect(calls).toBe(3)
    expect(store.getSnapshot().status?.balances.DAYS).toBe(3)
    expect(reasons).toEqual(['grant', 'order'])
    expect(server.callsTo('GET', /^\/api\/billing\//)).toHaveLength(0)
    // 화면이 열린 동안 1분마다 다시 받는다
    expect(timers.length).toBeGreaterThan(0)
    store.stop()
    expect(source.closed).toBe(true)
  })
})
