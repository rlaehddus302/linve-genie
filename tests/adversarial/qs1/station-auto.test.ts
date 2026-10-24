// QS1 적대 시험 (test-domain): 출력 기기의 저절로 다시 잇기 (AC-QS1-22·30, D-QS1-02, L-11 8).
import { combineNiimbotFakes, createB1Adapter, createFakeNiimbotBluetooth, createFakeNiimbotSerial, createFakePrinter, type FakePrinter } from '@livejjim/printer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualTimer, newStorage, queueOf, rig, type Rig } from './station-helpers.ts'

let current: Rig | null = null
afterEach(() => {
  current?.station.stop()
  current = null
  vi.unstubAllGlobals()
})

async function connectedTest(timer: ManualTimer): Promise<{ r: Rig; printer: FakePrinter }> {
  const printer = createFakePrinter({ methods: ['bluetooth'], timer })
  const r = await rig({ testPrinter: () => printer, timer })
  current = r
  expect(await r.station.connect('test')).toBe(true)
  return { r, printer }
}

describe('TD-QS1-001 이어진 뒤 60초가 지나면 횟수를 새로 센다 — 출력이 이어져도 (AC-QS1-22, D-QS1-02 (3))', () => {
  it('6번째 시도로 이어진 뒤 30초마다 라벨을 찍으며 5분 이어져 있다가 끊기면, 1초 뒤 다시 잇기를 시도한다', async () => {
    const timer = new ManualTimer()
    const { r, printer } = await connectedTest(timer)
    // 1~5번째 시도는 거절, 6번째(30초 간격)에 이어진다
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(1000 + 2000 + 4000 + 8000 + 16000)
    expect(printer.rememberedAttempts).toBe(5)
    printer.setConnectError(undefined)
    await timer.advance(30000)
    expect(printer.rememberedAttempts).toBe(6)
    expect(r.station.getSnapshot().connection).toBe('CONNECTED')
    // 방송 중: 30초마다 한 장씩 (10장, 5분) — 그동안 끊기지 않았다
    for (let i = 0; i < 10; i++) {
      r.server.jobs.push(`job-${String(i)}`)
      r.store.setQueue(queueOf(true, true, 2 + i))
      await timer.advance(30000)
    }
    expect(printer.printed.length).toBe(10)
    expect(r.station.getSnapshot().connection).toBe('CONNECTED')
    // 5분 이어진 뒤 끊김 → 새로 센다: 1초 뒤 시도
    printer.simulateDisconnect()
    await timer.advance(1000)
    expect(printer.rememberedAttempts).toBe(7)
    expect(r.station.getSnapshot().connection).toBe('CONNECTED')
  })

  it('비교: 출력 없이 60초 넘게 이어져 있다가 끊기면 1초 뒤 시도한다 (회귀)', async () => {
    const timer = new ManualTimer()
    const { r, printer } = await connectedTest(timer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(1000 + 2000 + 4000 + 8000 + 16000)
    printer.setConnectError(undefined)
    await timer.advance(30000)
    expect(printer.rememberedAttempts).toBe(6)
    await timer.advance(300000)
    printer.simulateDisconnect()
    await timer.advance(1000)
    expect(printer.rememberedAttempts).toBe(7)
    expect(r.station.getSnapshot().connection).toBe('CONNECTED')
  })
})

describe('저절로 다시 잇기 회귀 (AC-QS1-21·22, D-QS1-01 (3))', () => {
  it('새로고침 뒤 "다시 연결"(getDevices로 고르기 창 없이)로 이은 B1이 끊기면 저절로 다시 잇는다 — 고르기 창은 처음 1번 그대로', async () => {
    const timer = new ManualTimer()
    const local = newStorage()
    const fake = createFakeNiimbotBluetooth({ timer, getDevices: true })
    const adapter = () => createB1Adapter({ environment: () => fake.environment, createClient: fake.createClient, timer })
    const first = await rig({ adapter, methods: ['bluetooth'], timer, local })
    current = first
    expect(await first.station.connect('bluetooth')).toBe(true)
    first.station.stop()
    // 새로고침: 같은 저장소, 새 station·새 어댑터
    const second = await rig({ adapter, methods: ['bluetooth'], timer, local })
    current = second
    expect(fake.connectAttempts).toBe(1)
    expect(await second.station.reconnect()).toBe(true)
    expect(fake.requests).toBe(1)
    fake.disconnect()
    await timer.advance(1000)
    expect(second.station.getSnapshot().connection).toBe('CONNECTED')
    expect(second.handle().autoReconnectAttempts()).toBe(1)
    expect(fake.requests).toBe(1)
  })

  it('USB 선을 뽑았다 다시 꽂으면 다음 간격의 저절로 잇기로 이어진다 — requestPort 없음', async () => {
    const timer = new ManualTimer()
    const bt = createFakeNiimbotBluetooth({ timer })
    const usb = createFakeNiimbotSerial({})
    const fakes = combineNiimbotFakes(bt, usb)
    const r = await rig({ adapter: () => createB1Adapter({ environment: () => fakes.environment, createClient: fakes.createClient, timer }), methods: ['bluetooth', 'serial'], timer })
    current = r
    expect(await r.station.connect('serial')).toBe(true)
    expect(usb.requests).toBe(1)
    usb.unplug(0)
    await timer.advance(1000 + 2000)
    expect(r.station.getSnapshot().connection).toBe('DISCONNECTED')
    usb.plug(0)
    await timer.advance(4000)
    expect(r.station.getSnapshot().connection).toBe('CONNECTED')
    expect(usb.requests).toBe(1)
    expect(r.handle().autoReconnectAttempts()).toBeLessThanOrEqual(3)
  })

  it('기다리는 동안 "다시 연결"이 실패하면 저절로 잇기도 그친다 — 그 뒤 기다리던 시도 없음', async () => {
    const timer = new ManualTimer()
    const { r, printer } = await connectedTest(timer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(1000)
    expect(r.handle().autoReconnectAttempts()).toBe(1)
    expect(await r.station.reconnect()).toBe(false)
    printer.setConnectError(undefined)
    await timer.advance(200_000)
    expect(r.handle().autoReconnectAttempts()).toBe(1)
    expect(r.station.getSnapshot().connection).toBe('DISCONNECTED')
  })

  it('출력 기기가 아닌 기기는 끊겨도 저절로 잇지 않고, 기다리는 중 출력 기기에서 내려오면 그친다', async () => {
    const timer = new ManualTimer()
    const { r, printer } = await connectedTest(timer)
    printer.setConnectError('CONNECT_FAILED')
    printer.simulateDisconnect()
    await timer.advance(1000)
    expect(r.handle().autoReconnectAttempts()).toBe(1)
    r.store.setQueue(queueOf(false, true, 5))
    printer.setConnectError(undefined)
    await timer.advance(200_000)
    expect(r.handle().autoReconnectAttempts()).toBe(1)
    // 출력 기기가 아닌 채로 이었다가 끊김 → 0번
    expect(await r.station.connect('test')).toBe(true)
    printer.simulateDisconnect()
    await timer.advance(200_000)
    expect(r.handle().autoReconnectAttempts()).toBe(1)
  })
})
