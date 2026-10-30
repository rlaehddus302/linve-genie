// 앱 Marklife (APP-03, LABEL_RULES L-12 3~5, D-N1-04~06·11, D-QS1-01·02) — 가짜 BleManager 위의 가짜 Marklife로:
// 웹 가짜 기기와 같은 바이트(YXQ·L11 대표), 응답 있는 쓰기, 이름 판단(대소문자·밑줄·광고 이름 먼저), 기억·고르기 창 없이 다시 잇기,
// B1 목록에서 Marklife 빼기, 한 목록 고르기(createPrinterPicker)가 기종을 갈라 보내기.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MARKLIFE_P12,
  MARKLIFE_P50,
  MARKLIFE_S2,
  MARKLIFE_X2,
  buildPrintJob,
  createFakeBluetooth,
  createMarklifeAdapter,
  systemTimer,
  type BluetoothRequestOptions,
  type FakeBluetoothOptions,
  type ModelProfile,
} from '@livejjim/printer'
import { describe, expect, it } from 'vitest'
import {
  RECONNECT_DELAYS_MS,
  createBleBluetooth,
  createFakeBleTransport,
  createNativeB1Adapter,
  createNativeMarklifeAdapter,
  createPlxTransport,
  createPrinterPicker,
  createReconnectingAdapter,
  printerKindOf,
  type BleDeviceInfo,
  type DevicePicker,
} from '../src/index.ts'
import { NIIMBOT_FAKE_DEFAULT_ID, combineTransports, createFakeMarklifeManager, type FakeMarklifeDeviceOptions } from './marklife-fakes.ts'
import { ManualTimer, sampleImage, waitFor } from './fakes.ts'

const NIIMBOT_SERVICE = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'

/** 목록에 이 이름이 보이면 고르는 고르기 창 — 본 목록을 남긴다 */
function pickByName(name: string, seen: (readonly BleDeviceInfo[])[] = []): DevicePicker & { calls: number } {
  const picker = Object.assign(
    (scan: Parameters<DevicePicker>[0]) =>
      new Promise<BleDeviceInfo | null>((resolve) => {
        picker.calls++
        const stop = scan.onDevices((devices) => {
          seen.push(devices)
          const hit = devices.find((d) => d.name === name)
          if (hit) {
            stop()
            resolve(hit)
          }
        })
      }),
    { calls: 0 },
  )
  return picker
}

/** 목록이 한 번 오면 그 목록을 남기고 닫는 고르기 창 */
function closeAfterList(seen: (readonly BleDeviceInfo[])[]): DevicePicker {
  return (scan) =>
    new Promise((resolve) => {
      const stop = scan.onDevices((devices) => {
        seen.push(devices)
        // 장치가 모두 알려질 때까지 한 틱 기다린다
        setTimeout(() => {
          stop()
          resolve(null)
        }, 5)
      })
    })
}

const tape = (seed: number): ReturnType<typeof sampleImage> => sampleImage(seed, 320, 96)

/** 웹 길: 같은 그림을 웹 가짜 기기 + printer Marklife 어댑터로 */
async function webBytes(fakeOptions: FakeBluetoothOptions, image: ReturnType<typeof sampleImage>) {
  const fake = createFakeBluetooth({ timer: systemTimer, ...fakeOptions })
  const adapter = createMarklifeAdapter({ environment: () => fake.environment, packetIntervalMs: 0, creditWaitMs: 5 })
  expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
  expect(await adapter.print(image)).toEqual({ ok: true })
  return { printed: fake.printed, packets: fake.packets, profile: adapter.profile, bundle: adapter.bundle }
}

describe('웹 가짜 기기와 같은 바이트 (L-12 4·5, 기종별 대표)', () => {
  const cases: {
    title: string
    profile: ModelProfile
    device: FakeMarklifeDeviceOptions
    web: FakeBluetoothOptions
    image: ReturnType<typeof sampleImage>
  }[] = [
    {
      title: 'YXQ3 P50 · 꾸러미 A · 크레딧 01 04/01 01 · MTU 알림 64',
      profile: MARKLIFE_P50,
      device: { id: 'ML:P50', localName: 'P50_AB12', printer: { protocol: 'MARKLIFE_YXQ3', bundle: 'A', mtuNotice: 64 }, serviceUUIDs: [NIIMBOT_SERVICE] },
      web: { name: 'P50_AB12', bundle: 'A', mtu: 64 },
      image: sampleImage(3),
    },
    {
      title: 'YXQ2 S2 · 꾸러미 A · 첫 크레딧 없음(1초 기다림 대신 5ms)',
      profile: MARKLIFE_S2,
      device: { id: 'ML:S2', localName: 'S2_0001', printer: { protocol: 'MARKLIFE_YXQ2', bundle: 'A', initialCredits: null } },
      web: { name: 'S2_0001', bundle: 'A', initialCredits: null },
      image: sampleImage(5),
    },
    {
      title: 'YXQ8 X2 · 꾸러미 C(fd00, 흐름 제어 없음)',
      profile: MARKLIFE_X2,
      device: { id: 'ML:X2', localName: 'X2_9', printer: { protocol: 'MARKLIFE_YXQ8', bundle: 'C' } },
      web: { name: 'X2_9', bundle: 'C' },
      image: sampleImage(7),
    },
    {
      title: 'L11 P12 테이프 · 꾸러미 C · 시계 방향 90도',
      profile: MARKLIFE_P12,
      device: { id: 'ML:P12', localName: 'P12_ZA15B', printer: { protocol: 'MARKLIFE_L11', bundle: 'C' } },
      web: { name: 'P12_ZA15B', bundle: 'C' },
      image: tape(2),
    },
    {
      title: 'L11 P12 테이프 · 꾸러미 A · 크레딧',
      profile: MARKLIFE_P12,
      device: { id: 'ML:P12A', localName: 'P12_A', printer: { protocol: 'MARKLIFE_L11', bundle: 'A' } },
      web: { name: 'P12_A', bundle: 'A' },
      image: tape(4),
    },
  ]

  for (const c of cases) {
    it(c.title, async () => {
      const manager = createFakeMarklifeManager([c.device])
      const adapter = createNativeMarklifeAdapter({
        transport: createPlxTransport(manager),
        pickDevice: pickByName(c.device.localName as string),
        packetIntervalMs: 0,
        creditWaitMs: 5,
      })
      expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
      expect(adapter.profile.id).toBe(c.profile.id)
      expect(adapter.state).toBe('CONNECTED')
      expect(await adapter.print(c.image)).toEqual({ ok: true })

      const web = await webBytes(c.web, c.image)
      expect(web.profile.id).toBe(c.profile.id)
      expect(adapter.bundle).toBe(web.bundle)
      const job = buildPrintJob(c.profile, c.image, {})
      if (!job.ok) throw new Error('작업 바이트를 못 만들었다')
      // 프린터가 받은 작업이 웹 길과 같고, printer 패키지가 만든 작업 그대로다
      expect(manager.printed(c.device.id)).toHaveLength(1)
      expect([...(manager.printed(c.device.id)[0] as Uint8Array)]).toEqual([...(web.printed[0] as Uint8Array)])
      expect([...(web.printed[0] as Uint8Array)]).toEqual([...job.bytes])
      // 조각 나누기도 같다 (90바이트 상한·MTU 알림으로 줄이기는 어댑터가 정한다)
      expect(manager.packets(c.device.id).map((p) => p.length)).toEqual(web.packets.map((p) => p.length))
      const notice = c.device.printer?.mtuNotice
      expect(Math.max(...manager.packets(c.device.id).map((p) => p.length))).toBe(notice == null ? 90 : notice - 3)
      await adapter.disconnect()
      expect(adapter.state).toBe('DISCONNECTED')
    })
  }

  it('응답 없는 쓰기를 받지 않는 특성이면 응답 있는 쓰기로 같은 바이트', async () => {
    const device: FakeMarklifeDeviceOptions = { id: 'ML:W', localName: 'P50_W', printer: { protocol: 'MARKLIFE_YXQ3', bundle: 'C', writeWithoutResponse: false } }
    const manager = createFakeMarklifeManager([device])
    const adapter = createNativeMarklifeAdapter({ transport: createPlxTransport(manager), pickDevice: pickByName('P50_W'), packetIntervalMs: 0 })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    const image = sampleImage(9)
    expect(await adapter.print(image)).toEqual({ ok: true })
    expect(manager.withResponseWrites('ML:W')).toBe(manager.packets('ML:W').length)
    const job = buildPrintJob(MARKLIFE_P50, image, {})
    if (!job.ok) throw new Error('작업 바이트를 못 만들었다')
    expect([...(manager.printed('ML:W')[0] as Uint8Array)]).toEqual([...job.bytes])
  })

  it('작은 MTU(23)로 이어지면 끼움 장치가 20바이트씩 나눠 쓰고, 프린터가 받은 작업은 같다', async () => {
    const device: FakeMarklifeDeviceOptions = { id: 'ML:M', localName: 'P50_M', mtu: 23, printer: { protocol: 'MARKLIFE_YXQ3', bundle: 'C' } }
    const manager = createFakeMarklifeManager([device])
    const adapter = createNativeMarklifeAdapter({ transport: createPlxTransport(manager), pickDevice: pickByName('P50_M'), packetIntervalMs: 0 })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    const image = sampleImage(11)
    expect(await adapter.print(image)).toEqual({ ok: true })
    expect(Math.max(...manager.packets('ML:M').map((p) => p.length))).toBe(20)
    const job = buildPrintJob(MARKLIFE_P50, image, {})
    if (!job.ok) throw new Error('작업 바이트를 못 만들었다')
    expect([...(manager.printed('ML:M')[0] as Uint8Array)]).toEqual([...job.bytes])
  })

  it('출력 중 프린터 쪽 끊김은 DISCONNECTED, 상태도 끊김', async () => {
    const device: FakeMarklifeDeviceOptions = { id: 'ML:D', localName: 'P50_D', printer: { protocol: 'MARKLIFE_YXQ3', bundle: 'A' } }
    const manager = createFakeMarklifeManager([device])
    const adapter = createNativeMarklifeAdapter({ transport: createPlxTransport(manager), pickDevice: pickByName('P50_D'), packetIntervalMs: 2 })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    const printing = adapter.print(sampleImage(1))
    await waitFor(() => manager.packets('ML:D').length >= 3)
    manager.drop('ML:D')
    const result = await printing
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('DISCONNECTED')
    expect(adapter.state).toBe('DISCONNECTED')
  })
})

describe('이름 판단 (L-12 3 — 대소문자 가림·밑줄, D-N1-11)', () => {
  const crowd: FakeMarklifeDeviceOptions[] = [
    { id: '1', localName: 'P12_ZA15B', printer: { protocol: 'MARKLIFE_L11', bundle: 'C' } },
    { id: '2', localName: 'p12_za15b' },
    { id: '3', localName: 'P12' },
    { id: '4', localName: 'P12 Pro' },
    { id: '5', localName: 'Phomemo P12' },
    { id: '6', localName: ' P12_X' },
    { id: '7', localName: 'P50_ok', printer: { protocol: 'MARKLIFE_YXQ3', bundle: 'A' } },
    // 기기가 들고 있는 이름은 옛 이름, 광고의 이름이 지금 이름 — 광고의 이름으로 보이고 고른다
    { id: '8', name: 'OLDNAME', localName: 'L13_NEW', printer: { protocol: 'MARKLIFE_L11', bundle: 'C' } },
    // 광고 이름이 없으면 기기 이름
    { id: '9', name: 'LP90_G', localName: null, printer: { protocol: 'MARKLIFE_L11', bundle: 'C' } },
  ]

  it('목록에는 L-12 3으로 고를 수 있는 기기만 보이고, 보인 기기는 모두 이어진다 (이름 때문에 거절되지 않는다)', async () => {
    const manager = createFakeMarklifeManager(crowd)
    const transport = createPlxTransport(manager)
    const seen: (readonly BleDeviceInfo[])[] = []
    const lister = createNativeMarklifeAdapter({ transport, pickDevice: closeAfterList(seen) })
    const closed = await lister.connect('bluetooth')
    expect(closed.ok).toBe(false)
    if (!closed.ok) expect(closed.error.code).toBe('NOT_SELECTED')
    const listed = seen.at(-1) ?? []
    expect(listed.map((d) => d.name).sort()).toEqual(['L13_NEW', 'LP90_G', 'P12_ZA15B', 'P50_ok'])
    for (const shown of listed) {
      const adapter = createNativeMarklifeAdapter({ transport, pickDevice: pickByName(shown.name as string) })
      const result = await adapter.connect('bluetooth')
      expect(result, shown.name ?? '').toEqual({ ok: true })
      await adapter.disconnect()
    }
  })

  it('printerKindOf: Marklife 이름 → MARKLIFE, 대소문자만 다른 Marklife 꼴 → 받지 않음, 그 밖 → NIIMBOT', () => {
    expect(printerKindOf('P12_ZA15B')).toBe('MARKLIFE')
    expect(printerKindOf('p12_za15b')).toBeNull()
    expect(printerKindOf('B1-H123')).toBe('NIIMBOT')
    expect(printerKindOf('P12 Pro')).toBe('NIIMBOT')
    expect(printerKindOf(null)).toBe('NIIMBOT')
  })
})

describe('기억·고르기 창 없이 다시 잇기 (D-QS1-01·02, 1·2·4·8초)', () => {
  const p12: FakeMarklifeDeviceOptions = { id: 'ML:P12', localName: 'P12_ZA15B', printer: { protocol: 'MARKLIFE_L11', bundle: 'C' } }

  it('이으면 기억 = 그 기기 ID, 프린터 쪽에서 끊기면 createReconnectingAdapter가 1초 뒤 고르기 창 없이 다시 잇는다', async () => {
    const manager = createFakeMarklifeManager([p12])
    const pick = pickByName('P12_ZA15B')
    const inner = createNativeMarklifeAdapter({ transport: createPlxTransport(manager), pickDevice: pick, packetIntervalMs: 0 })
    const remembered: unknown[] = []
    inner.onRememberedChange((v) => remembered.push(v))
    const timer = new ManualTimer()
    const adapter = createReconnectingAdapter(inner, { timer })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(adapter.remembered).toEqual({ method: 'bluetooth', deviceId: 'ML:P12' })
    expect(remembered).toEqual([{ method: 'bluetooth', deviceId: 'ML:P12' }])

    manager.drop('ML:P12')
    expect(adapter.state).toBe('DISCONNECTED')
    expect(timer.delays).toEqual([RECONNECT_DELAYS_MS[0]])
    await timer.advance(1_000)
    await waitFor(() => adapter.state === 'CONNECTED')
    expect(pick.calls).toBe(1)
    expect(manager.connectCount('ML:P12')).toBe(2)
    expect(await adapter.print(tape(1))).toEqual({ ok: true })
    adapter.dispose()
  })

  it('앱을 다시 켠 뒤(restoreRemembered): 이름을 몰라도 이어서 기기가 알린 이름으로 기종을 정한다. 기억이 없으면 시도 없이 DISCONNECTED', async () => {
    const manager = createFakeMarklifeManager([p12])
    const pick = pickByName('P12_ZA15B')
    const adapter = createNativeMarklifeAdapter({ transport: createPlxTransport(manager), pickDevice: pick, packetIntervalMs: 0 })
    const none = await adapter.connectRemembered()
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.error.code).toBe('DISCONNECTED')
    expect(manager.connectCount('ML:P12')).toBe(0)

    adapter.restoreRemembered({ method: 'bluetooth', deviceId: 'ML:P12' })
    expect(await adapter.connectRemembered()).toEqual({ ok: true })
    expect(pick.calls).toBe(0)
    expect(adapter.profile.id).toBe('MARKLIFE_P12')
    expect(await adapter.print(tape(5))).toEqual({ ok: true })
  })

  it('"다시 연결"(reconnect)로 기억한 기기에 실패하면 기억을 지운다; 저절로 다시 잇기(connectRemembered) 실패는 기억을 둔다', async () => {
    const manager = createFakeMarklifeManager([p12])
    const adapter = createNativeMarklifeAdapter({ transport: createPlxTransport(manager), pickDevice: pickByName('P12_ZA15B') })
    adapter.restoreRemembered({ method: 'bluetooth', deviceId: 'GONE' })
    const auto = await adapter.connectRemembered()
    expect(auto.ok).toBe(false)
    expect(adapter.remembered).toEqual({ method: 'bluetooth', deviceId: 'GONE' })
    const manual = await adapter.reconnect('bluetooth')
    expect(manual.ok).toBe(false)
    if (!manual.ok) expect(manual.error.code).toBe('CONNECT_FAILED')
    expect(adapter.remembered).toBeNull()
    // 다음 "다시 연결"은 고르기 창부터
    expect(await adapter.reconnect('bluetooth')).toEqual({ ok: true })
    expect(adapter.remembered).toEqual({ method: 'bluetooth', deviceId: 'ML:P12' })
  })

  it('기억한 ID의 기기가 다른 이름(Marklife 아님)이면 WRONG_MODEL, 기억을 바꾸지 않는다', async () => {
    const manager = createFakeMarklifeManager([{ id: 'X', localName: 'Other_1', printer: { protocol: 'MARKLIFE_L11', bundle: 'C' } }])
    const adapter = createNativeMarklifeAdapter({ transport: createPlxTransport(manager), pickDevice: pickByName('none') })
    adapter.restoreRemembered({ method: 'bluetooth', deviceId: 'X' })
    const result = await adapter.connectRemembered()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('WRONG_MODEL')
    expect(manager.connected('X')).toBe(false)
    expect(adapter.remembered).toEqual({ method: 'bluetooth', deviceId: 'X' })
  })

  it('블루투스가 꺼져 있으면 BLUETOOTH_OFF', async () => {
    const manager = createFakeMarklifeManager([p12])
    manager.setRadio('PoweredOff' as never)
    const adapter = createNativeMarklifeAdapter({ transport: createPlxTransport(manager), pickDevice: pickByName('P12_ZA15B') })
    const result = await adapter.connect('bluetooth')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('BLUETOOTH_OFF')
  })
})

describe('B1 목록과 한 목록 고르기 (Marklife가 NIIMBOT 서비스를 알림)', () => {
  const marklifeLike: FakeMarklifeDeviceOptions[] = [
    { id: 'ML:P12', localName: 'P12_ZA15B', serviceUUIDs: [NIIMBOT_SERVICE], printer: { protocol: 'MARKLIFE_L11', bundle: 'C' } },
    { id: 'ML:S2', localName: 'S2_77', serviceUUIDs: [NIIMBOT_SERVICE], printer: { protocol: 'MARKLIFE_YXQ2', bundle: 'A' } },
    { id: 'ML:low', localName: 'p50_lower', serviceUUIDs: [NIIMBOT_SERVICE] },
  ]

  it('B1 연결 목록에 Marklife 이름 꼴은 보이지 않는다', async () => {
    const manager = createFakeMarklifeManager(marklifeLike)
    const b1 = createFakeBleTransport()
    const transport = combineTransports(b1.transport, createPlxTransport(manager))
    const seen: (readonly BleDeviceInfo[])[] = []
    const adapter = createNativeB1Adapter({ transport, pickDevice: closeAfterList(seen) })
    await adapter.connect('bluetooth')
    const names = seen.flat().map((d) => d.name)
    expect(names).toContain('B1-FAKE01')
    expect(names).not.toContain('P12_ZA15B')
    expect(names).not.toContain('S2_77')
    expect(names).not.toContain('p50_lower')
  })

  it('한 목록에 B1과 Marklife가 함께 보이고, 고른 기기의 기종 어댑터로 간다 — 바꿔 골라도 앞 기종은 끊는다', async () => {
    const manager = createFakeMarklifeManager(marklifeLike)
    const b1 = createFakeBleTransport()
    const transport = combineTransports(b1.transport, createPlxTransport(manager))
    let want = 'P12_ZA15B'
    const seen: (readonly BleDeviceInfo[])[] = []
    const pickDevice: DevicePicker = (scan) => pickByName(want, seen)(scan)
    const picker = createPrinterPicker({ transport, pickDevice, marklife: { packetIntervalMs: 0 } })
    const states: string[] = []
    picker.onStateChange((s) => states.push(s))
    expect(picker.availableMethods()).toEqual(['bluetooth'])

    expect(await picker.connect('bluetooth')).toEqual({ ok: true })
    expect(picker.kind).toBe('MARKLIFE')
    expect(picker.profile.displayName).toBe('Marklife P12')
    expect(picker.state).toBe('CONNECTED')
    expect(picker.remembered).toEqual({ method: 'bluetooth', deviceId: 'ML:P12' })
    expect(await picker.print(tape(3))).toEqual({ ok: true })
    expect(manager.printed('ML:P12')).toHaveLength(1)
    const names = seen.flat().map((d) => d.name)
    expect(names).toContain('P12_ZA15B')
    expect(names).not.toContain('p50_lower')
    expect(states[0]).toBe('CONNECTING')
    expect(states.at(-1)).toBe('CONNECTED')

    await picker.disconnect()
    want = 'B1-FAKE01'
    expect(await picker.connect('bluetooth')).toEqual({ ok: true })
    expect(picker.kind).toBe('NIIMBOT')
    expect(picker.profile.displayName).toBe('NIIMBOT B1')
    expect(picker.remembered).toEqual({ method: 'bluetooth', deviceId: NIIMBOT_FAKE_DEFAULT_ID })
    expect(await picker.print(sampleImage(2))).toEqual({ ok: true })
    expect(b1.printer.printed).toHaveLength(1)
    expect(manager.connected('ML:P12')).toBe(false)
  })

  it('앱을 다시 켠 뒤 기억한 Marklife: 잠깐 찾아 기종을 정하고 고르기 창 없이 잇는다, 끊기면 다시 잇기도 그 기종으로', async () => {
    const manager = createFakeMarklifeManager(marklifeLike)
    const b1 = createFakeBleTransport()
    const transport = combineTransports(b1.transport, createPlxTransport(manager))
    const pick = pickByName('never')
    const picker = createPrinterPicker({ transport, pickDevice: pick, marklife: { packetIntervalMs: 0 } })
    picker.restoreRemembered({ method: 'bluetooth', deviceId: 'ML:S2' })
    const timer = new ManualTimer()
    const adapter = createReconnectingAdapter(picker, { timer })
    expect(await adapter.connectRemembered()).toEqual({ ok: true })
    expect(picker.kind).toBe('MARKLIFE')
    expect(picker.profile.displayName).toBe('Marklife S2')
    expect(pick.calls).toBe(0)

    manager.drop('ML:S2')
    expect(adapter.state).toBe('DISCONNECTED')
    await timer.advance(1_000)
    await waitFor(() => adapter.state === 'CONNECTED')
    expect(manager.connectCount('ML:S2')).toBe(2)
    expect(pick.calls).toBe(0)
    expect(await adapter.print(sampleImage(4))).toEqual({ ok: true })
    expect(manager.printed('ML:S2')).toHaveLength(1)
    adapter.dispose()
  })

  it('기억한 기기가 보이지 않으면 저절로 다시 잇기는 시도 없이 DISCONNECTED (기억은 둔다)', async () => {
    const manager = createFakeMarklifeManager(marklifeLike)
    const transport = createPlxTransport(manager)
    const timer = new ManualTimer()
    const picker = createPrinterPicker({ transport, pickDevice: pickByName('never'), timer, identifyScanMs: 50 })
    picker.restoreRemembered({ method: 'bluetooth', deviceId: 'NOPE' })
    const pending = picker.connectRemembered()
    await timer.advance(50)
    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('DISCONNECTED')
    expect(picker.remembered).toEqual({ method: 'bluetooth', deviceId: 'NOPE' })
  })
})

describe('끼움 장치 (Web Bluetooth 모양)', () => {
  it('requestDevice: 고르기를 닫으면 NotFoundError, 서비스·특성이 없으면 NotFoundError', async () => {
    const manager = createFakeMarklifeManager([{ id: 'A1', localName: 'P50_1', printer: { protocol: 'MARKLIFE_YXQ3', bundle: 'C' } }])
    const transport = createPlxTransport(manager)
    const request: BluetoothRequestOptions = { filters: [{ namePrefix: 'P50_' }], optionalServices: [] }
    const closed = createBleBluetooth({ transport, chooseDevice: async () => null })
    await expect(closed.requestDevice(request)).rejects.toMatchObject({ name: 'NotFoundError' })
    const bluetooth = createBleBluetooth({ transport, chooseDevice: async () => ({ id: 'A1', name: 'P50_1' }) })
    const device = await bluetooth.requestDevice(request)
    const server = await device.gatt!.connect()
    expect(server.connected).toBe(true)
    await expect(server.getPrimaryService('ff00')).rejects.toMatchObject({ name: 'NotFoundError' })
    const service = await server.getPrimaryService('fd00')
    await expect(service.getCharacteristic('ff02')).rejects.toMatchObject({ name: 'NotFoundError' })
    const write = await service.getCharacteristic('fd01')
    expect(write.properties).toEqual({ notify: false, writeWithoutResponse: true, write: true })
    let gone = 0
    device.addEventListener('gattserverdisconnected', () => gone++)
    manager.drop('A1')
    expect(gone).toBe(1)
    expect(server.connected).toBe(false)
    await expect(write.writeValueWithoutResponse!(Uint8Array.of(1))).rejects.toMatchObject({ name: 'NetworkError' })
  })

  it('mobile-ble에 Marklife 패킷 만들기가 없다 — printer의 어댑터·작업 바이트를 그대로 쓴다', () => {
    const root = join(import.meta.dirname, '..', 'src')
    const marklife = readFileSync(join(root, 'marklife.ts'), 'utf8')
    const bluetooth = readFileSync(join(root, 'bluetooth.ts'), 'utf8')
    expect(marklife).toContain('createMarklifeAdapter(')
    for (const text of [marklife, bluetooth]) expect(text).not.toMatch(/buildPrintJob|rotateClockwise|0xaa|0x1f|DENSITY_BYTES/i)
  })
})
