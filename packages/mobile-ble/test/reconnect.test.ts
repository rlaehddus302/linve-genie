// 끊김 다시 잇기 (APP-03, L-11, D-QS1-02): 프린터 쪽 끊김 → 1·2·4·8초 간격으로 기억한 기기에 고르기 창 없이, 판매자가 끊은 것은 다시 잇지 않음.
// 간격은 손으로 돌리는 타이머, 협상 자체는 가짜 B1이 실제 시간(setTimeout 0)으로 답하므로 waitFor로 기다린다.
import type { RememberingPrinterAdapter } from '@livejjim/printer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { RECONNECT_DELAYS_MS, createFakeBleTransport, createNativeB1Adapter, createReconnectingAdapter, type DevicePicker, type ReconnectingAdapter } from '../src/index.ts'
import { ManualTimer, flush, sampleImage, waitFor } from './fakes.ts'

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

function setup(options: Parameters<typeof createReconnectingAdapter>[1] = {}) {
  const fake = createFakeBleTransport()
  const timer = new ManualTimer()
  let picks = 0
  const pickDevice: DevicePicker = (scan) =>
    new Promise((resolve) => {
      picks++
      scan.onDevices((devices) => resolve(devices[0] ?? null))
    })
  const inner: RememberingPrinterAdapter = createNativeB1Adapter({ transport: fake.transport, pickDevice, timer, client: { packetIntervalMs: 0 } })
  const adapter = createReconnectingAdapter(inner, { timer, ...options })
  made.push(adapter)
  /** 다음 시도가 끝날 때까지 (이어졌거나 다음 간격이 걸렸거나 멈췄거나) */
  const settled = () => waitFor(() => adapter.state === 'CONNECTED' || timer.pending > 0 || !adapter.reconnecting)
  return { fake, timer, adapter, picks: () => picks, settled }
}

describe('createReconnectingAdapter', () => {
  it('간격은 1·2·4·8초, 가장 길게 8초', () => {
    expect([...RECONNECT_DELAYS_MS]).toEqual([1_000, 2_000, 4_000, 8_000])
  })

  it('프린터 쪽에서 끊기면 1초 뒤 기억한 기기로 다시 잇는다 — 고르기 창 없음, 이어지면 셈을 비운다', async () => {
    const { fake, timer, adapter, picks } = setup()
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    fake.dropLink()
    expect(adapter.state).toBe('DISCONNECTED')
    expect(adapter.reconnecting).toBe(true)
    expect(timer.delays).toEqual([1_000])
    await timer.advance(1_000)
    await waitFor(() => adapter.state === 'CONNECTED')
    expect(adapter.reconnecting).toBe(false)
    expect(adapter.attempts).toBe(0)
    expect(picks()).toBe(1)
    expect(fake.connectCount).toBe(2)
  })

  it('잇지 못하면 2·4·8·8초로 늘리고, 되면 그친다', async () => {
    const { fake, timer, adapter, settled } = setup()
    await adapter.connect('bluetooth')
    fake.setConnectFails(true)
    fake.dropLink()
    const seen: number[] = []
    for (let i = 0; i < 5; i++) {
      seen.push(timer.delays[0]!)
      await timer.advance(timer.delays[0]!)
      await settled()
    }
    expect(seen).toEqual([1_000, 2_000, 4_000, 8_000, 8_000])
    expect(adapter.attempts).toBe(5)
    fake.setConnectFails(false)
    await timer.advance(8_000)
    await waitFor(() => adapter.state === 'CONNECTED')
    expect(timer.pending).toBe(0)
    expect(adapter.attempts).toBe(0)
  })

  it('한도를 두면 그 뒤 멈추고 onGiveUp — 라벨 대기열 쪽이 "프린터를 연결해 주세요"를 보일 차례', async () => {
    let gaveUp = 0
    const { fake, timer, adapter, settled } = setup({ maxAttempts: 2, onGiveUp: () => gaveUp++ })
    await adapter.connect('bluetooth')
    fake.setConnectFails(true)
    fake.dropLink()
    await timer.advance(1_000)
    await settled()
    await timer.advance(2_000)
    await waitFor(() => gaveUp === 1)
    expect(adapter.attempts).toBe(2)
    expect(timer.pending).toBe(0)
    expect(adapter.reconnecting).toBe(false)
  })

  it('판매자가 "연결 끊기"를 누르면 다시 잇지 않는다', async () => {
    const { fake, timer, adapter } = setup()
    await adapter.connect('bluetooth')
    await adapter.disconnect()
    expect(timer.pending).toBe(0)
    expect(adapter.reconnecting).toBe(false)
    expect(fake.connected).toBe(false)
    await timer.advance(10_000)
    expect(fake.connectCount).toBe(1)
  })

  it('출력 중 끊기면 출력은 DISCONNECTED로 실패하고(앱 대기열이 다룸) 연결은 다시 잇는다', async () => {
    const { fake, timer, adapter } = setup()
    await adapter.connect('bluetooth')
    const printing = adapter.print(sampleImage())
    await flush(30)
    fake.dropLink()
    const result = await printing
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('DISCONNECTED')
    await timer.advance(1_000)
    await waitFor(() => adapter.state === 'CONNECTED')
    expect((await adapter.print(sampleImage())).ok).toBe(true)
  })

  it('dispose 뒤에는 아무것도 예약하지 않는다', async () => {
    const { fake, timer, adapter } = setup()
    await adapter.connect('bluetooth')
    adapter.dispose()
    fake.dropLink()
    expect(timer.pending).toBe(0)
  })
})
