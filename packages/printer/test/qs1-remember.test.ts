// QS1 — 마지막 프린터 기억·고르기 창 없이 다시 잇기·getAvailability 오판에도 한 번 시도 (AC-QS1-01~07, D-QS1-01·03, L-7).
import { describe, expect, it } from 'vitest'
import {
  FAKE_B1_USB_PRODUCT_ID,
  FAKE_B1_USB_VENDOR_ID,
  PRINTER_MESSAGES,
  RETRIED_TIMEOUT_DETAIL,
  combineNiimbotFakes,
  createB1Adapter,
  createFakeBluetooth,
  createFakeNiimbotBluetooth,
  createFakeNiimbotSerial,
  createFakePrinter,
  createMarklifeAdapter,
  isRememberingAdapter,
  parseRememberedPrinter,
  type ConnectionState,
  type FakeNiimbotBluetoothOptions,
  type FakeNiimbotSerialOptions,
  type PrinterEnvironment,
  type RememberedPrinter,
} from '../src/index.ts'
import { FakeNiimbotClient, ManualTimer, flush, sampleImage } from './fakes.ts'

const CONNECT_FAILED_MESSAGE = PRINTER_MESSAGES.CONNECT_FAILED

function b1(options: FakeNiimbotBluetoothOptions = {}) {
  const timer = new ManualTimer()
  const fake = createFakeNiimbotBluetooth({ timer, ...options })
  const adapter = createB1Adapter({ environment: () => fake.environment, createClient: fake.createClient, timer })
  const states: ConnectionState[] = []
  adapter.onStateChange((s) => states.push(s))
  const saved: (RememberedPrinter | null)[] = []
  adapter.onRememberedChange((v) => saved.push(v))
  return { fake, adapter, timer, states, saved }
}

function usb(options: FakeNiimbotSerialOptions = {}) {
  const fake = createFakeNiimbotSerial(options)
  const timer = new ManualTimer()
  const adapter = createB1Adapter({ environment: () => fake.environment, createClient: fake.createClient, timer })
  return { fake, adapter, timer }
}

describe('AC-QS1-01 마지막 프린터로 다시 잇기 (블루투스)', () => {
  it('끊긴 뒤 "다시 연결"은 고르기 창 없이 첫 연결 때 고른 같은 기기로, 연결 방법 연결은 늘 고르기 창', async () => {
    const { fake, adapter, states } = b1()
    expect(isRememberingAdapter(adapter)).toBe(true)
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(fake.requests).toBe(1)
    expect(adapter.hasRemembered).toBe(true)
    expect(adapter.remembered).toEqual({ method: 'bluetooth', deviceId: 'fake-b1-01' })
    fake.disconnect()
    expect(adapter.state).toBe('DISCONNECTED')
    states.length = 0
    expect(await adapter.reconnect('bluetooth')).toEqual({ ok: true })
    expect(fake.requests).toBe(1)
    expect(fake.authorizedDevices.at(-1)).toBe(fake.device)
    expect(states).toEqual(['CONNECTING', 'CONNECTED'])
    // 연결 방법 단추 — 기억이 있어도 고르기 창
    await adapter.disconnect()
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(fake.requests).toBe(2)
  })

  it('다시 이은 뒤에도 출력은 같은 어댑터로 된다', async () => {
    const { fake, adapter } = b1()
    await adapter.connect('bluetooth')
    fake.disconnect()
    await adapter.reconnect('bluetooth')
    expect((await adapter.print(sampleImage())).ok).toBe(true)
    expect(fake.printed).toHaveLength(1)
  })
})

describe('AC-QS1-02 기억하는 것과 잊는 것', () => {
  it('(a) 첫 연결이 실패하면 기억하지 않는다 — CONNECT_FAILED·NOT_SELECTED·PORT_BUSY', async () => {
    // CONNECT_FAILED: 첫 확인이 두 번 답하지 않음
    const timeout = b1({ unansweredNegotiations: 2 })
    const p = timeout.adapter.connect('bluetooth')
    await timeout.timer.advance(1_000)
    expect(await p).toMatchObject({ ok: false, error: { code: 'CONNECT_FAILED' } })
    expect(timeout.adapter.hasRemembered).toBe(false)
    timeout.fake.setUnansweredNegotiations(0)
    await timeout.adapter.reconnect('bluetooth')
    expect(timeout.fake.requests).toBe(2)

    const cancel = b1({ chooser: 'cancel' })
    expect(await cancel.adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'NOT_SELECTED' } })
    expect(cancel.adapter.hasRemembered).toBe(false)
    cancel.fake.setChooser('pick')
    expect((await cancel.adapter.reconnect('bluetooth')).ok).toBe(true)
    expect(cancel.fake.requests).toBe(2)

    const busy = usb({ busy: true })
    expect(await busy.adapter.connect('serial')).toMatchObject({ ok: false, error: { code: 'PORT_BUSY' } })
    expect(busy.adapter.hasRemembered).toBe(false)
    busy.fake.setBusy(false)
    expect((await busy.adapter.reconnect('serial')).ok).toBe(true)
    expect(busy.fake.requests).toBe(2)
  })

  it('(b) WRONG_MODEL은 기억하지 않는다', async () => {
    const { fake, adapter } = b1({ model: 'D110' })
    expect(await adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL' } })
    expect(adapter.hasRemembered).toBe(false)
    expect(adapter.remembered).toBeNull()
    await adapter.reconnect('bluetooth')
    expect(fake.requests).toBe(2)
  })

  it('(c) 기억한 기기로 이은 시도가 실패하면(첫 확인 다시 잇기 포함 한 번) CONNECT_FAILED 그대로, 기억을 지운다', async () => {
    const { fake, adapter, timer, saved } = b1()
    await adapter.connect('bluetooth')
    fake.disconnect()
    fake.setUnansweredNegotiations(2)
    const attemptsBefore = fake.connectAttempts
    const p = adapter.reconnect('bluetooth')
    await timer.advance(1_000)
    expect(await p).toEqual({ ok: false, error: { code: 'CONNECT_FAILED', message: CONNECT_FAILED_MESSAGE, action: '다시 연결', detail: RETRIED_TIMEOUT_DETAIL } })
    expect(fake.connectAttempts - attemptsBefore).toBe(2) // 첫 시도 + 1초 뒤 한 번 더
    expect(fake.requests).toBe(1)
    expect(adapter.hasRemembered).toBe(false)
    expect(saved.at(-1)).toBeNull()
    // 다음 "다시 연결"은 고르기 창부터
    fake.setUnansweredNegotiations(0)
    expect((await adapter.reconnect('bluetooth')).ok).toBe(true)
    expect(fake.requests).toBe(2)
  })

  it('(d) 연결에 성공할 때마다 기억은 그 기기로 바뀐다', async () => {
    const first = createFakeNiimbotBluetooth({ id: 'b1-first' })
    const second = createFakeNiimbotBluetooth({ id: 'b1-second', name: 'B1-SECOND' })
    let current = first
    const adapter = createB1Adapter({ environment: () => current.environment, createClient: (m) => current.createClient(m), timer: new ManualTimer() })
    await adapter.connect('bluetooth')
    expect(adapter.remembered).toEqual({ method: 'bluetooth', deviceId: 'b1-first' })
    await adapter.disconnect()
    current = second
    await adapter.connect('bluetooth')
    expect(adapter.remembered).toEqual({ method: 'bluetooth', deviceId: 'b1-second' })
    second.disconnect()
    await adapter.reconnect('bluetooth')
    expect(second.authorizedDevices.at(-1)).toBe(second.device)
    expect(second.requests).toBe(1)
  })

  it('판매자가 "연결 끊기"를 눌러도 기억은 그대로다', async () => {
    const { fake, adapter } = b1()
    await adapter.connect('bluetooth')
    await adapter.disconnect()
    expect(adapter.hasRemembered).toBe(true)
    expect((await adapter.reconnect('bluetooth')).ok).toBe(true)
    expect(fake.requests).toBe(1)
  })

  it('고르기 창 길의 실패는 앞 기억을 지우지 않는다 (마지막으로 성공한 기기 그대로)', async () => {
    const { fake, adapter } = b1()
    await adapter.connect('bluetooth')
    await adapter.disconnect()
    fake.setChooser('cancel')
    expect(await adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'NOT_SELECTED' } })
    expect(adapter.hasRemembered).toBe(true)
    expect((await adapter.reconnect('bluetooth')).ok).toBe(true)
  })
})

describe('AC-QS1-03 기억한 기기로만 잇기 (고르기 창 없음)', () => {
  it('기억이 없으면 고르기 창 없이 DISCONNECTED, 있으면 그 기기로', async () => {
    const { fake, adapter, states } = b1()
    expect(await adapter.connectRemembered()).toEqual({ ok: false, error: { code: 'DISCONNECTED', message: PRINTER_MESSAGES.DISCONNECTED, action: '다시 연결' } })
    expect(adapter.state).toBe('DISCONNECTED')
    expect(fake.requests).toBe(0)
    expect(fake.connectAttempts).toBe(0)
    expect(states).toEqual([])
    await adapter.connect('bluetooth')
    fake.disconnect()
    states.length = 0
    expect(await adapter.connectRemembered()).toEqual({ ok: true })
    expect(fake.requests).toBe(1)
    expect(fake.authorizedDevices.at(-1)).toBe(fake.device)
    expect(states).toEqual(['CONNECTING', 'CONNECTED'])
  })

  it('USB에서 기억이 없으면 requestPort를 부르지 않는다', async () => {
    const { fake, adapter } = usb()
    expect(await adapter.connectRemembered()).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
    expect(fake.requests).toBe(0)
  })

  it('실패해도 기억은 지우지 않는다 (저절로 다시 잇기가 다음 시도에 쓴다) — 고르기 창도 없다', async () => {
    const { fake, adapter } = b1()
    await adapter.connect('bluetooth')
    fake.setPowered(false)
    expect(adapter.state).toBe('DISCONNECTED')
    for (let i = 0; i < 6; i++) expect(await adapter.connectRemembered()).toMatchObject({ ok: false, error: { code: 'CONNECT_FAILED' } })
    expect(adapter.hasRemembered).toBe(true)
    expect(fake.requests).toBe(1)
    fake.setPowered(true)
    expect(await adapter.reconnect('bluetooth')).toEqual({ ok: true })
    expect(fake.requests).toBe(1)
  })

  it('연결 중에 세 길을 또 부르면 같은 시도를 기다린다 (시도는 하나)', async () => {
    const { fake, adapter, timer } = b1({ unansweredNegotiations: 0 })
    await adapter.connect('bluetooth')
    fake.disconnect()
    fake.setUnansweredNegotiations(1)
    const before = fake.connectAttempts
    const a = adapter.connectRemembered()
    const b = adapter.reconnect('bluetooth')
    const c = adapter.connect('bluetooth')
    expect(b).toBe(a)
    expect(c).toBe(a)
    await timer.advance(1_000)
    expect(await a).toEqual({ ok: true })
    expect(fake.connectAttempts - before).toBe(2) // 시간 초과 한 번 + 다시 잇기 한 번 — 시도는 하나
    expect(fake.requests).toBe(1)
  })

  it('쉬는 동안·잇는 동안 "연결 끊기"를 누르면 그 시도는 붙지 않고 DISCONNECTED', async () => {
    const { fake, adapter, timer } = b1()
    await adapter.connect('bluetooth')
    fake.disconnect()
    fake.setUnansweredNegotiations(1)
    const p = adapter.connectRemembered()
    await flush()
    expect(adapter.state).toBe('CONNECTING')
    await adapter.disconnect()
    await timer.advance(1_000)
    expect(await p).toEqual({ ok: false, error: { code: 'DISCONNECTED', message: PRINTER_MESSAGES.DISCONNECTED, action: '다시 연결' } })
    expect(adapter.state).toBe('DISCONNECTED')
    expect(fake.connected).toBe(false)
    expect(adapter.hasRemembered).toBe(true)
    // 잇는 동안(첫 시도 중) 끊기
    const q = adapter.connectRemembered()
    await adapter.disconnect()
    expect(await q).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
    expect(adapter.state).toBe('DISCONNECTED')
  })

  it('시험용 프린터도 같은 계약 — 한 번 연결한 뒤엔 기억한 기기로만 잇기가 되고, 연결한 적 없으면 실패', async () => {
    const printer = createFakePrinter({ methods: ['bluetooth', 'serial'] })
    expect(isRememberingAdapter(printer)).toBe(true)
    expect(await printer.connectRemembered()).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
    expect(printer.connectAttempts).toBe(0)
    expect(await printer.connect('bluetooth')).toEqual({ ok: true })
    expect(printer.pickerCount).toBe(1)
    expect(printer.remembered).toEqual({ method: 'bluetooth', deviceId: 'fake-printer' })
    printer.simulateDisconnect()
    expect(await printer.connectRemembered()).toEqual({ ok: true })
    expect(printer.pickerCount).toBe(1)
    expect(printer.rememberedAttempts).toBe(1)
    printer.simulateDisconnect()
    expect(await printer.reconnect('bluetooth')).toEqual({ ok: true })
    expect(printer.pickerCount).toBe(1)
    // 연결 방법 연결은 늘 고르기 창
    await printer.disconnect()
    await printer.connect('bluetooth')
    expect(printer.pickerCount).toBe(2)
    // 다시 연결 실패 → 기억을 지운다, 기억한 기기로만 잇기 실패는 지우지 않는다
    printer.simulateDisconnect()
    printer.setConnectError('CONNECT_FAILED')
    expect(await printer.connectRemembered()).toMatchObject({ ok: false, error: { code: 'CONNECT_FAILED' } })
    expect(printer.hasRemembered).toBe(true)
    expect(await printer.reconnect('bluetooth')).toMatchObject({ ok: false, error: { code: 'CONNECT_FAILED' } })
    expect(printer.hasRemembered).toBe(false)
    printer.setConnectError(undefined)
    await printer.reconnect('bluetooth')
    expect(printer.pickerCount).toBe(3)
  })

  it('시험용 프린터: 연결 중 같은 시도를 나누고, 연결 끊기를 누르면 붙지 않는다', async () => {
    const printer = createFakePrinter()
    const a = printer.connect('bluetooth')
    expect(printer.reconnect('bluetooth')).toBe(a)
    await printer.disconnect()
    expect(await a).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
    expect(printer.state).toBe('DISCONNECTED')
    expect(printer.hasRemembered).toBe(false)
  })

  it('시험용 프린터: 새로고침 뒤 되살린 값이 시험용 프린터의 값이면 고르기 창 없이, 아니면 고르기 창', async () => {
    const restored = createFakePrinter()
    restored.restoreRemembered({ method: 'bluetooth', deviceId: 'fake-printer' })
    expect(await restored.reconnect('bluetooth')).toEqual({ ok: true })
    expect(restored.pickerCount).toBe(0)
    const other = createFakePrinter()
    other.restoreRemembered({ method: 'bluetooth', deviceId: 'someone-else' })
    expect(await other.connectRemembered()).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
    expect(other.connectAttempts).toBe(0)
    expect(await other.reconnect('bluetooth')).toEqual({ ok: true })
    expect(other.pickerCount).toBe(1)
  })
})

describe('AC-QS1-04 USB(Web Serial)', () => {
  it('끊긴 뒤 "다시 연결"은 requestPort 없이 같은 포트 객체를 authorizedPort로', async () => {
    const { fake, adapter } = usb()
    expect(await adapter.connect('serial')).toEqual({ ok: true })
    expect(fake.requests).toBe(1)
    expect(adapter.remembered).toEqual({ method: 'serial', usbVendorId: FAKE_B1_USB_VENDOR_ID, usbProductId: FAKE_B1_USB_PRODUCT_ID })
    fake.unplug()
    expect(adapter.state).toBe('DISCONNECTED')
    fake.plug()
    expect(await adapter.reconnect('serial')).toEqual({ ok: true })
    expect(fake.requests).toBe(1)
    expect(fake.authorizedPorts.at(-1)).toBe(fake.ports[0])
    expect((await adapter.print(sampleImage())).ok).toBe(true)
    expect(fake.printed).toHaveLength(1)
  })

  it('뽑힌 채 기억한 포트로 다시 잇기는 실패(포트를 열 수 없음)하고, "다시 연결"이면 기억을 지운다', async () => {
    const { fake, adapter } = usb()
    await adapter.connect('serial')
    fake.unplug()
    expect((await adapter.connectRemembered()).ok).toBe(false)
    expect(adapter.hasRemembered).toBe(true)
    expect((await adapter.reconnect('serial')).ok).toBe(false)
    expect(adapter.hasRemembered).toBe(false)
    expect(fake.requests).toBe(1)
  })

  it('새로고침 뒤: getPorts에 같은 번호가 정확히 하나면 그 포트로, 0개·둘 이상·없음·예외면 고르기 창(기억한 기기로만 잇기는 실패)', async () => {
    const saved = { method: 'serial', usbVendorId: FAKE_B1_USB_VENDOR_ID, usbProductId: FAKE_B1_USB_PRODUCT_ID } as const
    // 정확히 하나
    {
      const { fake, adapter } = usb({ ports: [{ permitted: true }, { permitted: true, usbProductId: 0x9999 }] })
      adapter.restoreRemembered(saved)
      expect(await adapter.reconnect('serial')).toEqual({ ok: true })
      expect(fake.requests).toBe(0)
      expect(fake.authorizedPorts.at(-1)).toBe(fake.ports[0])
    }
    {
      const { fake, adapter } = usb({ ports: [{ permitted: true }] })
      adapter.restoreRemembered(saved)
      expect(await adapter.connectRemembered()).toEqual({ ok: true })
      expect(fake.requests).toBe(0)
    }
    const cases: { name: string; options: FakeNiimbotSerialOptions }[] = [
      { name: '0개 (허락되지 않음)', options: { ports: [{ permitted: false }] } },
      { name: '0개 (뽑힘)', options: { ports: [{ permitted: true, plugged: false }, { usbVendorId: 1, usbProductId: 1 }] } },
      { name: '둘 이상', options: { ports: [{ permitted: true }, { permitted: true }] } },
      { name: 'getPorts 없음', options: { ports: [{ permitted: true }], getPorts: false } },
      { name: 'getPorts 예외', options: { ports: [{ permitted: true }], getPorts: 'throws' } },
    ]
    for (const c of cases) {
      const only = usb(c.options)
      only.adapter.restoreRemembered(saved)
      expect(await only.adapter.connectRemembered(), c.name).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
      expect(only.fake.requests, c.name).toBe(0)
      expect(only.fake.connectAttempts, c.name).toBe(0)
      expect(only.adapter.hasRemembered, c.name).toBe(true)
      const prefer = usb(c.options)
      prefer.adapter.restoreRemembered(saved)
      await prefer.adapter.reconnect('serial')
      expect(prefer.fake.requests, c.name).toBe(1)
    }
  })

  it('번호가 없는 포트는 페이지 안에서만 기억한다 (저장소 값 null)', async () => {
    const { fake, adapter } = usb({ ports: [{ usbVendorId: null, usbProductId: null }] })
    await adapter.connect('serial')
    expect(adapter.hasRemembered).toBe(true)
    expect(adapter.remembered).toBeNull()
    fake.unplug()
    fake.plug()
    expect((await adapter.reconnect('serial')).ok).toBe(true)
    expect(fake.requests).toBe(1)
  })

  it('기억할 값에는 연결 방법과 기기를 알아보는 값만 있다 (이름·판매자 정보 없음)', async () => {
    const bt = b1({ name: 'B1-H123456789' })
    await bt.adapter.connect('bluetooth')
    expect(Object.keys(bt.adapter.remembered ?? {}).sort()).toEqual(['deviceId', 'method'])
    expect(JSON.stringify(bt.saved)).not.toContain('B1-H123456789')
    const port = usb()
    await port.adapter.connect('serial')
    expect(Object.keys(port.adapter.remembered ?? {}).sort()).toEqual(['method', 'usbProductId', 'usbVendorId'])
  })

  it('기억이 바뀔 때마다 알린다 (기억함·잊음)', async () => {
    const { fake, adapter, saved, timer } = b1()
    await adapter.connect('bluetooth')
    expect(saved).toEqual([{ method: 'bluetooth', deviceId: 'fake-b1-01' }])
    fake.disconnect()
    fake.setUnansweredNegotiations(2)
    const p = adapter.reconnect('bluetooth')
    await timer.advance(1_000)
    await p
    expect(saved).toEqual([{ method: 'bluetooth', deviceId: 'fake-b1-01' }, null])
  })

  it('저장소 값 읽기: 형식 밖이면 null', () => {
    expect(parseRememberedPrinter({ method: 'bluetooth', deviceId: 'abc' })).toEqual({ method: 'bluetooth', deviceId: 'abc' })
    expect(parseRememberedPrinter({ method: 'serial', usbVendorId: 1, usbProductId: 2 })).toEqual({ method: 'serial', usbVendorId: 1, usbProductId: 2 })
    expect(parseRememberedPrinter({ method: 'bluetooth', deviceId: 'abc', name: 'B1' })).toEqual({ method: 'bluetooth', deviceId: 'abc' })
    for (const bad of [null, undefined, 'x', 3, {}, { method: 'bluetooth' }, { method: 'bluetooth', deviceId: '' }, { method: 'bluetooth', deviceId: 'x'.repeat(129) }, { method: 'serial', usbVendorId: 1 }, { method: 'serial', usbVendorId: -1, usbProductId: 2 }, { method: 'serial', usbVendorId: 1.5, usbProductId: 2 }, { method: 'serial', usbVendorId: 0x10000, usbProductId: 2 }, { method: 'test' }]) {
      expect(parseRememberedPrinter(bad), JSON.stringify(bad)).toBeNull()
    }
    const { adapter } = b1()
    adapter.restoreRemembered({ method: 'bluetooth', deviceId: '' } as RememberedPrinter)
    expect(adapter.hasRemembered).toBe(false)
  })
})

describe('AC-QS1-05 블루투스 getDevices()는 있을 때만', () => {
  const saved = { method: 'bluetooth', deviceId: 'fake-b1-01' } as const

  it('getDevices가 있고 같은 ID를 돌려주면 requestDevice 없이 그 기기를 authorizedDevice로', async () => {
    const { fake, adapter } = b1({ getDevices: true, permitted: true })
    adapter.restoreRemembered(saved)
    expect(await adapter.reconnect('bluetooth')).toEqual({ ok: true })
    expect(fake.requests).toBe(0)
    expect(fake.getDevicesCalls).toBe(1)
    expect(fake.authorizedDevices).toEqual([fake.device])
    // 기억한 기기로만 잇기도 같다
    const only = b1({ getDevices: true, permitted: true })
    only.adapter.restoreRemembered(saved)
    expect(await only.adapter.connectRemembered()).toEqual({ ok: true })
    expect(only.fake.requests).toBe(0)
  })

  it('getDevices 없음·예외·같은 ID 없음 → 고르기 창, 기억한 기기로만 잇기는 시도 없이 실패', async () => {
    const cases: { name: string; options: FakeNiimbotBluetoothOptions }[] = [
      { name: '없음', options: { getDevices: false, permitted: true } },
      { name: '예외', options: { getDevices: 'throws', permitted: true } },
      { name: '같은 ID 없음', options: { getDevices: true, permitted: true, id: 'other-id' } },
      { name: '허락되지 않음', options: { getDevices: true, permitted: false } },
    ]
    for (const c of cases) {
      const only = b1(c.options)
      only.adapter.restoreRemembered(saved)
      expect(await only.adapter.connectRemembered(), c.name).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
      expect(only.fake.requests, c.name).toBe(0)
      expect(only.fake.connectAttempts, c.name).toBe(0)
      expect(only.adapter.state, c.name).toBe('DISCONNECTED')
      const prefer = b1(c.options)
      prefer.adapter.restoreRemembered(saved)
      expect((await prefer.adapter.reconnect('bluetooth')).ok, c.name).toBe(true)
      expect(prefer.fake.requests, c.name).toBe(1)
    }
  })

  it('되살린 값과 다른 연결 방법의 "다시 연결"은 그 방법의 고르기 창', async () => {
    const fakeBt = createFakeNiimbotBluetooth({ getDevices: true, permitted: true })
    const fakeUsb = createFakeNiimbotSerial({ ports: [{ permitted: true }] })
    const both = combineNiimbotFakes(fakeBt, fakeUsb)
    const adapter = createB1Adapter({ environment: () => both.environment, createClient: both.createClient, timer: new ManualTimer() })
    adapter.restoreRemembered(saved)
    expect((await adapter.reconnect('serial')).ok).toBe(true)
    expect(fakeUsb.requests).toBe(1)
    expect(fakeBt.requests).toBe(0)
    expect(adapter.remembered).toMatchObject({ method: 'serial' })
  })

  it('페이지 안 기억이 있으면 getDevices를 부르지 않는다', async () => {
    const { fake, adapter } = b1({ getDevices: true })
    await adapter.connect('bluetooth')
    fake.disconnect()
    await adapter.reconnect('bluetooth')
    expect(fake.getDevicesCalls).toBe(0)
  })
})

describe('AC-QS1-06 getAvailability()가 false여도 한 번 시도 (D-QS1-03)', () => {
  it('(a) false인데 고르면 이어짐(윈도우 오판) → CONNECTED', async () => {
    const { adapter, states } = b1({ available: false, adapterOff: false })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(states).toEqual(['CONNECTING', 'CONNECTED'])
  })

  it('(b) false, 시도도 실패 — 장치 꺼짐(NotFoundError)·고르기 창 닫음·GATT 연결 실패 → BLUETOOTH_OFF와 그 문장, DISCONNECTED', async () => {
    const off = b1({ available: false })
    expect(await off.adapter.connect('bluetooth')).toEqual({ ok: false, error: { code: 'BLUETOOTH_OFF', message: PRINTER_MESSAGES.BLUETOOTH_OFF } })
    expect(off.fake.requests).toBe(1)
    expect(off.adapter.state).toBe('DISCONNECTED')

    const cancel = b1({ available: false, adapterOff: false, chooser: 'cancel' })
    expect(await cancel.adapter.connect('bluetooth')).toEqual({ ok: false, error: { code: 'BLUETOOTH_OFF', message: PRINTER_MESSAGES.BLUETOOTH_OFF } })
    expect(cancel.adapter.state).toBe('DISCONNECTED')

    const gatt = b1({ available: false, adapterOff: false, powered: false })
    // 전원이 꺼져 목록에 없음 → 창을 닫음
    expect(await gatt.adapter.connect('bluetooth')).toEqual({ ok: false, error: { code: 'BLUETOOTH_OFF', message: PRINTER_MESSAGES.BLUETOOTH_OFF } })
    // 기억한 기기로 GATT 연결 실패
    const remembered = b1()
    await remembered.adapter.connect('bluetooth')
    remembered.fake.setPowered(false)
    remembered.fake.setAvailable(false)
    remembered.fake.setAdapterOff(false)
    expect(await remembered.adapter.reconnect('bluetooth')).toEqual({ ok: false, error: { code: 'BLUETOOTH_OFF', message: PRINTER_MESSAGES.BLUETOOTH_OFF } })
    expect(remembered.adapter.state).toBe('DISCONNECTED')
  })

  it('(c) false, 첫 확인 시간 초과 → 다시 잇기도 실패 → BLUETOOTH_OFF', async () => {
    const { adapter, timer, fake } = b1({ available: false, adapterOff: false, unansweredNegotiations: 2 })
    const p = adapter.connect('bluetooth')
    await timer.advance(1_000)
    expect(await p).toEqual({ ok: false, error: { code: 'BLUETOOTH_OFF', message: PRINTER_MESSAGES.BLUETOOTH_OFF } })
    expect(fake.connectAttempts).toBe(2)
  })

  it('(d) true·예외·없음이면 지금과 같은 코드', async () => {
    const pickCancel = (getAvailability?: () => Promise<boolean>): PrinterEnvironment => ({
      bluetooth: {
        requestDevice: () => Promise.reject(Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' })),
        ...(getAvailability ? { getAvailability } : {}),
      },
    })
    for (const env of [pickCancel(async () => true), pickCancel(() => Promise.reject(new Error('no'))), pickCancel()]) {
      const adapter = createB1Adapter({ environment: () => env, createClient: () => new FakeNiimbotClient(), timer: new ManualTimer() })
      expect(await adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'NOT_SELECTED' } })
    }
    const failing = new FakeNiimbotClient()
    failing.connectError = Object.assign(new Error('GATT Server is disconnected.'), { name: 'NetworkError' })
    const adapter = createB1Adapter({ environment: () => ({ bluetooth: { requestDevice: () => Promise.resolve({ id: 'x' }), getAvailability: async () => true } }), createClient: () => failing, timer: new ManualTimer() })
    expect(await adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'CONNECT_FAILED' } })
  })

  it('false여도 다른 모델을 고른 것은 WRONG_MODEL 그대로 (블루투스는 된 것)', async () => {
    const { adapter } = b1({ available: false, adapterOff: false, model: 'D110' })
    expect(await adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL' } })
  })

  it('(e) Marklife·바우아토 어댑터도 같다 — 오판이면 연결, 정말 꺼짐이면 BLUETOOTH_OFF', async () => {
    const misjudged = createFakeBluetooth({ name: 'P12_X', available: false, adapterOff: false })
    const a = createMarklifeAdapter({ environment: () => misjudged.environment, timer: new ManualTimer() })
    expect(await a.connect('bluetooth')).toEqual({ ok: true })
    expect(a.state).toBe('CONNECTED')

    const off = createFakeBluetooth({ name: 'P12_X', available: false })
    const b = createMarklifeAdapter({ environment: () => off.environment, timer: new ManualTimer() })
    expect(await b.connect('bluetooth')).toEqual({ ok: false, error: { code: 'BLUETOOTH_OFF', message: PRINTER_MESSAGES.BLUETOOTH_OFF } })
    expect(off.requests).toHaveLength(1)
    expect(b.state).toBe('DISCONNECTED')

    // 오판인데 창을 닫음·GATT 연결 실패 → BLUETOOTH_OFF
    const cancel = createFakeBluetooth({ name: 'P12_X', available: false, adapterOff: false, chooser: 'cancel' })
    const c = createMarklifeAdapter({ environment: () => cancel.environment, timer: new ManualTimer() })
    expect(await c.connect('bluetooth')).toEqual({ ok: false, error: { code: 'BLUETOOTH_OFF', message: PRINTER_MESSAGES.BLUETOOTH_OFF } })
    const gatt = createFakeBluetooth({ name: 'P12_X', available: false, adapterOff: false, connectFails: true })
    const d = createMarklifeAdapter({ environment: () => gatt.environment, timer: new ManualTimer() })
    expect(await d.connect('bluetooth')).toEqual({ ok: false, error: { code: 'BLUETOOTH_OFF', message: PRINTER_MESSAGES.BLUETOOTH_OFF } })
    expect(isRememberingAdapter(d)).toBe(false)
  })
})

describe('AC-QS1-07 가짜 기기', () => {
  it('가짜 B1 블루투스: 기기 쪽 끊김·전원(다시 잇기 거절/허락)·getDevices 있음/없음/예외·허락된 기기·장치 꺼짐과 오판을 따로 고른다', async () => {
    const fake = createFakeNiimbotBluetooth()
    const env = fake.environment
    expect(env.bluetooth?.getDevices).toBeUndefined()
    fake.setGetDevices(true)
    expect(await env.bluetooth?.getDevices?.()).toEqual([])
    await (env.bluetooth?.requestDevice as () => Promise<unknown>)()
    expect(fake.permitted).toBe(true)
    expect(await env.bluetooth?.getDevices?.()).toEqual([fake.device])
    fake.setGetDevices('throws')
    await expect(env.bluetooth?.getDevices?.()).rejects.toMatchObject({ name: 'SecurityError' })
    fake.setPermitted(false)
    fake.setGetDevices(true)
    expect(await env.bluetooth?.getDevices?.()).toEqual([])

    // 오판: getAvailability false지만 고르기 창은 된다
    fake.setAvailable(false)
    fake.setAdapterOff(false)
    expect(await env.bluetooth?.getAvailability?.()).toBe(false)
    await expect((env.bluetooth?.requestDevice as () => Promise<unknown>)()).resolves.toBe(fake.device)
    // 장치 꺼짐
    fake.setAdapterOff(true)
    await expect((env.bluetooth?.requestDevice as () => Promise<unknown>)()).rejects.toMatchObject({ name: 'NotFoundError', message: 'Bluetooth adapter not available.' })
    fake.setAdapterOff(undefined)
    fake.setAvailable(true)

    // 전원: 끄면 이어진 연결이 끊기고 다시 잇기를 거절, 켜면 받는다
    const client = fake.createClient('bluetooth')
    let dropped = 0
    client.on('disconnect', () => dropped++)
    await client.connect({ authorizedDevice: fake.device })
    expect(fake.connected).toBe(true)
    fake.setPowered(false)
    expect(fake.connected).toBe(false)
    expect(dropped).toBe(1)
    await expect(client.connect({ authorizedDevice: fake.device })).rejects.toMatchObject({ name: 'NetworkError' })
    fake.setPowered(true)
    await client.connect({ authorizedDevice: fake.device })
    expect(fake.connected).toBe(true)
    // 기기 쪽 끊김 (전원은 그대로)
    fake.disconnect()
    expect(dropped).toBe(2)
    expect(fake.powered).toBe(true)
    expect(fake.connectAttempts).toBe(3)
  })

  it('가짜 USB: getPorts·requestPort·제조사·제품 번호·뽑음·다시 꽂음', async () => {
    const fake = createFakeNiimbotSerial({ ports: [{}, { usbVendorId: 0x1234, usbProductId: 0x5678, permitted: true }] })
    const serial = fake.environment.serial
    expect(fake.ports[1]?.getInfo()).toEqual({ usbVendorId: 0x1234, usbProductId: 0x5678 })
    expect(await serial?.getPorts?.()).toEqual([fake.ports[1]])
    const picked = await (serial?.requestPort as () => Promise<unknown>)()
    expect(picked).toBe(fake.ports[0])
    expect(fake.requests).toBe(1)
    expect(await serial?.getPorts?.()).toEqual([fake.ports[0], fake.ports[1]])
    fake.unplug(0)
    expect(await serial?.getPorts?.()).toEqual([fake.ports[1]])
    fake.plug(0)
    expect(fake.ports[0]?.plugged).toBe(true)
    fake.setChooser('cancel')
    await expect((serial?.requestPort as () => Promise<unknown>)()).rejects.toMatchObject({ name: 'NotFoundError' })
    fake.setChooser(1)
    expect(await (serial?.requestPort as () => Promise<unknown>)()).toBe(fake.ports[1])
    fake.setGetPorts(false)
    expect(serial?.getPorts).toBeUndefined()
    fake.setGetPorts('throws')
    await expect(serial?.getPorts?.()).rejects.toMatchObject({ name: 'SecurityError' })
    expect(fake.addPort({ permitted: true })).toBe(2)
  })

  it('가짜 Web Bluetooth(Marklife): getAvailability 오판과 장치 꺼짐을 따로 고른다', async () => {
    const misjudged = createFakeBluetooth({ available: false, adapterOff: false })
    expect(await misjudged.bluetooth.getAvailability?.()).toBe(false)
    await expect(misjudged.bluetooth.requestDevice({ filters: [], optionalServices: [] })).resolves.toBe(misjudged.device)
    const off = createFakeBluetooth({ available: true, adapterOff: true })
    await expect(off.bluetooth.requestDevice({ filters: [], optionalServices: [] })).rejects.toMatchObject({ name: 'NotFoundError', message: 'Bluetooth adapter not available.' })
    off.setAdapterOff(false)
    const device = await off.bluetooth.requestDevice({ filters: [], optionalServices: [] })
    await expect(device.gatt?.connect()).resolves.toBeDefined()
  })

  it('가짜 기기 파일은 시각·난수를 쓰지 않는다', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    for (const file of ['fake.ts', 'fake-bluetooth.ts', 'fake-serial.ts']) {
      const text = readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8')
      expect(text, file).not.toMatch(/Date\.now|new Date\(|Math\.random|performance\.now/)
    }
  })
})
