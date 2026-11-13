// 방송 중 계속 다시 잇기 (F2, D-RETRO-42): setKeepTrying(true)면 6번을 넘겨도 그치지 않고 30초마다 잇는다.
// 방송이 끝나면(false) 한도를 넘긴 기다림은 그치고, 한도에 걸려 그친 뒤 방송이 열리면(true) 다시 잇는다. 방송이 없을 때의 정책(L-11 8)은 그대로다.
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
  const pickDevice: DevicePicker = (scan) => new Promise((resolve) => scan.onDevices((devices) => resolve(devices[0] ?? null)))
  const inner: RememberingPrinterAdapter = createNativeB1Adapter({ transport: fake.transport, pickDevice, timer, client: { packetIntervalMs: 0 } })
  const adapter = createReconnectingAdapter(inner, { timer, ...AUTO_RECONNECT_POLICY })
  made.push(adapter)
  const states: AutoReconnectState[] = []
  adapter.onAutoChange((state) => states.push(state))
  const settled = () => waitFor(() => adapter.state === 'CONNECTED' || timer.pending > 0 || !adapter.reconnecting)
  /** 걸린 간격만큼 n번 돌린다 — 돌린 간격들 */
  const run = async (times: number): Promise<number[]> => {
    const seen: number[] = []
    for (let i = 0; i < times; i++) {
      seen.push(timer.delays[0]!)
      await timer.advance(timer.delays[0]!)
      await settled()
    }
    return seen
  }
  return { fake, timer, adapter, states, run }
}

describe('방송 중 계속 다시 잇기 (setKeepTrying)', () => {
  it('켜 두면 6번을 넘겨도 그치지 않고 30초마다 잇고, 화면 상태는 총 횟수 없이 n번째다', async () => {
    const { fake, adapter, run } = setup()
    adapter.setKeepTrying(true)
    await adapter.connect('bluetooth')
    fake.setConnectFails(true)
    fake.dropLink()
    expect(adapter.autoState).toEqual({ kind: 'trying', attempt: 1, total: null })
    expect(await run(10)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000, 30_000])
    expect(adapter.autoState).toEqual({ kind: 'trying', attempt: 11, total: null })
    expect(adapter.reconnecting).toBe(true)
    // 프린터가 돌아오면 다음 시도에서 이어진다
    fake.setConnectFails(false)
    await run(1)
    await waitFor(() => adapter.state === 'CONNECTED')
    expect(adapter.autoState).toBeNull()
  })

  it('방송이 끝나면(false) 한도를 넘겨 기다리던 것은 그 자리에서 그친다', async () => {
    const { fake, timer, adapter, run } = setup()
    adapter.setKeepTrying(true)
    await adapter.connect('bluetooth')
    fake.setConnectFails(true)
    fake.dropLink()
    await run(8)
    expect(timer.pending).toBe(1)
    adapter.setKeepTrying(false)
    expect(timer.pending).toBe(0)
    expect(adapter.autoState).toEqual({ kind: 'gaveUp' })
    await timer.advance(120_000)
    expect(timer.pending).toBe(0)
    expect(adapter.attempts).toBe(8)
  })

  it('한도 안에서 방송이 끝나면 남은 횟수는 지금 정책대로 마저 잇고 6번에서 그친다', async () => {
    const { fake, adapter, run } = setup()
    adapter.setKeepTrying(true)
    await adapter.connect('bluetooth')
    fake.setConnectFails(true)
    fake.dropLink()
    await run(2)
    adapter.setKeepTrying(false)
    expect(adapter.autoState).toEqual({ kind: 'trying', attempt: 3, total: 6 })
    expect(await run(4)).toEqual([4_000, 8_000, 16_000, 30_000])
    await waitFor(() => adapter.autoState?.kind === 'gaveUp')
  })

  it('6번에 그친 뒤 방송이 열리면(true) 30초 간격으로 다시 잇는다', async () => {
    const { fake, timer, adapter, run } = setup()
    await adapter.connect('bluetooth')
    fake.setConnectFails(true)
    fake.dropLink()
    await run(6)
    await waitFor(() => adapter.autoState?.kind === 'gaveUp')
    expect(timer.pending).toBe(0)
    adapter.setKeepTrying(true)
    expect(adapter.autoState).toEqual({ kind: 'trying', attempt: 7, total: null })
    expect(timer.delays).toEqual([30_000])
    fake.setConnectFails(false)
    await run(1)
    await waitFor(() => adapter.state === 'CONNECTED')
  })

  it('판매자가 끊었거나 손으로 이은 것이 실패한 뒤에는 방송이 열려도 저절로 잇지 않는다', async () => {
    const { fake, timer, adapter } = setup()
    await adapter.connect('bluetooth')
    await adapter.disconnect()
    adapter.setKeepTrying(true)
    expect(timer.pending).toBe(0)
    expect(adapter.autoState).toBeNull()
    adapter.setKeepTrying(false)
    // 손으로 이은 것이 실패
    expect(await adapter.reconnect('bluetooth')).toEqual({ ok: true })
    fake.setConnectFails(true)
    fake.dropLink()
    expect((await adapter.reconnect('bluetooth')).ok).toBe(false)
    adapter.setKeepTrying(true)
    expect(timer.pending).toBe(0)
    expect(adapter.autoState).toBeNull()
  })

  it('허락되지 않으면(출력 기기 아님·라벨 끔) 켜 두어도 잇지 않는다', async () => {
    const { fake, timer, adapter } = setup()
    adapter.setAllowed(false)
    adapter.setKeepTrying(true)
    await adapter.connect('bluetooth')
    fake.dropLink()
    expect(timer.pending).toBe(0)
    expect(adapter.autoState).toBeNull()
  })

  it('켜고 끌 때 총 횟수가 바뀐 것을 화면에 알린다', async () => {
    const { fake, adapter, states } = setup()
    await adapter.connect('bluetooth')
    fake.setConnectFails(true)
    fake.dropLink()
    adapter.setKeepTrying(true)
    adapter.setKeepTrying(false)
    expect(states).toEqual([
      { kind: 'trying', attempt: 1, total: 6 },
      { kind: 'trying', attempt: 1, total: null },
      { kind: 'trying', attempt: 1, total: 6 },
    ])
  })
})
