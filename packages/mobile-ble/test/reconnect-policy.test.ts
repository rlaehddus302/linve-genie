// L-11 8 저절로 다시 잇기 (D-QS1-02·D-QS1-11): 1·2·4·8·16·30초, 모두 6번, 다시 이어진 뒤 60초가 지나야 새로 셈,
// 판매자 "다시 연결"은 기다림을 그치고 바로 한 번(실패하면 저절로 잇기도 그침), 출력 기기에서 내려오면(setAllowed false) 그침. 화면 상태(n/6·그침).
import type { RememberingPrinterAdapter } from '@livejjim/printer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AUTO_RECONNECT_POLICY, createFakeBleTransport, createNativeB1Adapter, createReconnectingAdapter, type AutoReconnectState, type DevicePicker, type ReconnectingAdapter } from '../src/index.ts'
import { ManualTimer, waitFor } from './fakes.ts'

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

const made: ReconnectingAdapter[] = []
afterEach(async () => {
  for (const a of made.splice(0)) {
    a.dispose()
    await a.disconnect()
  }
})

function setup() {
  const fake = createFakeBleTransport()
  const timer = new ManualTimer()
  let picks = 0
  const pickDevice: DevicePicker = (scan) =>
    new Promise((resolve) => {
      picks++
      scan.onDevices((devices) => resolve(devices[0] ?? null))
    })
  const inner: RememberingPrinterAdapter = createNativeB1Adapter({ transport: fake.transport, pickDevice, timer, client: { packetIntervalMs: 0 } })
  const adapter = createReconnectingAdapter(inner, { timer, ...AUTO_RECONNECT_POLICY })
  made.push(adapter)
  const states: AutoReconnectState[] = []
  adapter.onAutoChange((state) => states.push(state))
  const settled = () => waitFor(() => adapter.state === 'CONNECTED' || timer.pending > 0 || !adapter.reconnecting)
  return { fake, timer, adapter, picks: () => picks, settled, states }
}

describe('AUTO_RECONNECT_POLICY (L-11 8)', () => {
  it('값: 1·2·4·8·16·30초, 6번, 60초', () => {
    expect([...AUTO_RECONNECT_POLICY.delaysMs]).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000])
    expect(AUTO_RECONNECT_POLICY.maxAttempts).toBe(6)
    expect(AUTO_RECONNECT_POLICY.stableMs).toBe(60_000)
  })

  it('잇지 못하면 앞 시도가 끝난 때부터 1·2·4·8·16·30초, 6번 뒤 그치고 화면은 "그침"', async () => {
    const { fake, timer, adapter, settled, states } = setup()
    await adapter.connect('bluetooth')
    fake.setConnectFails(true)
    fake.dropLink()
    expect(adapter.autoState).toEqual({ kind: 'trying', attempt: 1, total: 6 })
    const seen: number[] = []
    for (let i = 0; i < 6; i++) {
      seen.push(timer.delays[0]!)
      await timer.advance(timer.delays[0]!)
      await settled()
    }
    expect(seen).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000])
    await waitFor(() => adapter.autoState?.kind === 'gaveUp')
    expect(timer.pending).toBe(0)
    expect(adapter.attempts).toBe(6)
    expect(states.filter((s) => s?.kind === 'trying').map((s) => (s?.kind === 'trying' ? s.attempt : 0))).toEqual([1, 2, 3, 4, 5, 6])
    // 그친 뒤에는 판매자가 "다시 연결"을 눌러야 한다
    fake.setConnectFails(false)
    expect(await adapter.reconnect('bluetooth')).toEqual({ ok: true })
    expect(adapter.autoState).toBeNull()
  })

  it('다시 이어진 뒤 60초 안에 또 끊기면 남은 횟수로 이어서 센다, 60초가 지나면 새로 센다', async () => {
    const { fake, timer, adapter } = setup()
    await adapter.connect('bluetooth')
    fake.dropLink()
    await timer.advance(1_000)
    await waitFor(() => adapter.state === 'CONNECTED')
    expect(adapter.attempts).toBe(1)
    // 60초 안에 또 끊김 → 두 번째 시도 (2초)
    await timer.advance(30_000)
    fake.dropLink()
    expect(adapter.autoState).toEqual({ kind: 'trying', attempt: 2, total: 6 })
    expect(timer.delays).toEqual([2_000])
    await timer.advance(2_000)
    await waitFor(() => adapter.state === 'CONNECTED')
    expect(adapter.attempts).toBe(2)
    // 60초 동안 끊기지 않음 → 새로 셈
    await timer.advance(60_000)
    expect(adapter.attempts).toBe(0)
    fake.dropLink()
    expect(timer.delays).toEqual([1_000])
  })

  it('기다리는 동안 판매자가 "다시 연결"을 누르면 기다림을 그치고 바로 한 번 — 실패하면 저절로 잇기도 그친다', async () => {
    const { fake, timer, adapter, picks } = setup()
    await adapter.connect('bluetooth')
    fake.setConnectFails(true)
    fake.dropLink()
    expect(timer.delays).toEqual([1_000])
    const result = await adapter.reconnect('bluetooth')
    expect(result.ok).toBe(false)
    expect(timer.pending).toBe(0)
    expect(adapter.autoState).toBeNull()
    await timer.advance(60_000)
    expect(fake.connectCount).toBe(1)
    expect(picks()).toBe(1)
  })

  it('기다리는 동안 "다시 연결"이 되면 그 연결부터 새로 센다', async () => {
    const { fake, timer, adapter } = setup()
    await adapter.connect('bluetooth')
    fake.dropLink()
    expect(await adapter.reconnect('bluetooth')).toEqual({ ok: true })
    expect(timer.pending).toBe(0)
    expect(adapter.attempts).toBe(0)
    fake.dropLink()
    expect(timer.delays).toEqual([1_000])
  })

  it('출력 기기에서 내려오면(setAllowed false) 그치고, 그동안 끊겨도 잇지 않는다. 다시 허락돼도 지난 끊김으로는 시작하지 않는다', async () => {
    const { fake, timer, adapter } = setup()
    adapter.setAllowed(false)
    await adapter.connect('bluetooth')
    fake.dropLink()
    expect(timer.pending).toBe(0)
    expect(adapter.autoState).toBeNull()
    adapter.setAllowed(true)
    expect(timer.pending).toBe(0)
    // 판매자가 다시 이은 뒤의 끊김부터는 잇는다
    expect(await adapter.reconnect('bluetooth')).toEqual({ ok: true })
    fake.dropLink()
    expect(timer.delays).toEqual([1_000])
    adapter.setAllowed(false)
    expect(timer.pending).toBe(0)
    await timer.advance(10_000)
    expect(adapter.state).toBe('DISCONNECTED')
  })
})
