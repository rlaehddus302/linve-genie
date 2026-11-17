// 앱 B1 어댑터 (APP-03 AC1·AC3, L-7·L-11, D-QS1-01·02) — 가짜 BLE 전송·가짜 B1로: 연결 마법사(찾기·고르기), 출력, 기억·고르기 창 없이 다시 잇기,
// 웹 Web Bluetooth 길과 같은 바이트, 받은 그림의 점 그대로, 프린터 골든의 B1 프로필과 같음.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NiimbotBluetoothClient } from '@mmote/niimbluelib'
import { getPixel } from '@livejjim/label'
import { B1_PROFILE, createNiimbotAdapter, type NiimbotClientLike, type RememberingPrinterAdapter } from '@livejjim/printer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createFakeB1, createFakeBleTransport, createNativeB1Adapter, matchesNiimbotName, type BleDeviceInfo, type DevicePicker, type FakeBleTransport } from '../src/index.ts'
import { ManualTimer, createFakeWebBluetoothDevice, flush, sampleImage } from './fakes.ts'

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

const made: RememberingPrinterAdapter[] = []
afterEach(async () => {
  for (const a of made.splice(0)) await a.disconnect()
})

/** 고르기 창: 첫 장치를 고른다 (또는 닫는다) */
function picker(choice: 'first' | 'cancel' = 'first'): DevicePicker & { readonly seen: BleDeviceInfo[][] } {
  const seen: BleDeviceInfo[][] = []
  const pick: DevicePicker = (scan) =>
    new Promise((resolve) => {
      if (choice === 'cancel') {
        resolve(null)
        return
      }
      scan.onDevices((devices) => {
        seen.push([...devices])
        resolve(devices[0] ?? null)
      })
    })
  return Object.assign(pick, { seen })
}

function setup(options: Parameters<typeof createFakeBleTransport>[0] = {}, pickDevice: DevicePicker = picker()) {
  const fake: FakeBleTransport = createFakeBleTransport(options)
  const timer = new ManualTimer()
  const adapter = createNativeB1Adapter({ transport: fake.transport, pickDevice, timer, client: { packetIntervalMs: 0 } })
  made.push(adapter)
  return { fake, adapter, timer }
}

describe('연결 마법사 (L-7)', () => {
  it('연결 방법은 블루투스 하나 (아이폰 앱도 UNSUPPORTED가 아니다 — APP-03 AC2의 바탕)', async () => {
    const { adapter } = setup()
    await flush()
    expect(adapter.availableMethods()).toEqual(['bluetooth'])
    expect(adapter.profile).toBe(B1_PROFILE)
    expect(adapter.state).toBe('DISCONNECTED')
  })

  it('연결: 찾기 → 판매자가 고름 → 찾기 멈춤 → 협상 → B1 확인 → CONNECTED, 기억 = 그 기기 ID', async () => {
    const pick = picker()
    const { fake, adapter } = setup({}, pick)
    const states: string[] = []
    adapter.onStateChange((s) => states.push(s))
    const remembered: unknown[] = []
    adapter.onRememberedChange((v) => remembered.push(v))
    const result = await adapter.connect('bluetooth')
    expect(result).toEqual({ ok: true })
    expect(states).toEqual(['CONNECTING', 'CONNECTED'])
    expect(pick.seen).toEqual([[fake.device]])
    expect(fake.scanning).toBe(0)
    expect(adapter.remembered).toEqual({ method: 'bluetooth', deviceId: fake.device.id })
    expect(remembered).toEqual([{ method: 'bluetooth', deviceId: fake.device.id }])
  })

  it('고르기 창을 닫으면 NOT_SELECTED, 찾기는 멈춘다', async () => {
    const { fake, adapter } = setup({}, picker('cancel'))
    const result = await adapter.connect('bluetooth')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_SELECTED')
    expect(fake.scanning).toBe(0)
    expect(adapter.state).toBe('DISCONNECTED')
  })

  it('블루투스가 꺼져 있으면 BLUETOOTH_OFF, 권한 없음도 같은 길', async () => {
    const { adapter } = setup({ radio: 'off' })
    const result = await adapter.connect('bluetooth')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('BLUETOOTH_OFF')
    const denied = setup({ radio: 'unauthorized' })
    const again = await denied.adapter.connect('bluetooth')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('BLUETOOTH_OFF')
  })

  it('이 기기에 BLE가 없으면 연결 방법이 없다 (UNSUPPORTED)', async () => {
    const { adapter } = setup({ radio: 'unsupported' })
    await flush()
    expect(adapter.availableMethods()).toEqual([])
    const result = await adapter.connect('bluetooth')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED')
  })

  it('켠 프로필이 아닌 프린터(B1 Pro = 4097)는 WRONG_MODEL이고 기억하지 않는다', async () => {
    // PRN2 D-PRN2-05: D110(2304)은 켠 실험 프로필이 되었다 — 켠 프로필이 아닌 300dpi B1 Pro로 본다
    const { fake, adapter } = setup({ printer: { modelId: 4097 } })
    const result = await adapter.connect('bluetooth')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('WRONG_MODEL')
    expect(adapter.hasRemembered).toBe(false)
    expect(fake.connected).toBe(false)
  })

  it('matchesNiimbotName: 이름 앞자리 글자 그대로(PRN2 D-PRN2-04 — 대소문자를 가린다), 이름 없는 장치는 거짓', () => {
    expect(matchesNiimbotName('B1-G123', ['B1-', 'D110-'])).toBe(true)
    expect(matchesNiimbotName('b21-x', ['B21-'])).toBe(false)
    expect(matchesNiimbotName('P50_X', ['B1-', 'D110-'])).toBe(false)
    expect(matchesNiimbotName(null, ['B1-'])).toBe(false)
  })
})

describe('출력 (APP-03 AC3, L-7 마지막 줄 +1행·농도)', () => {
  it('384×240 그림: 프린터가 받은 쪽은 384×241(흰 줄 하나 더), 농도 3 기본, 받은 점이 보낸 점과 같다 — 다시 그리지 않음', async () => {
    const { fake, adapter } = setup({ mtu: 185 })
    await adapter.connect('bluetooth')
    const image = sampleImage(3)
    const result = await adapter.print(image)
    expect(result).toEqual({ ok: true })
    expect(adapter.state).toBe('CONNECTED')
    expect(fake.printer.printed).toHaveLength(1)
    const page = fake.printer.printed[0]!
    expect(page).toMatchObject({ rows: 241, cols: 384, copies: 1, density: 3, labelType: 1 })
    // 점 비교: 프린터 비트맵(줄 48바이트, 왼쪽 점이 높은 비트)과 보낸 그림이 같다, 마지막 줄은 희다
    const width = 48
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 384; x++) {
        const printerBlack = ((page.bitmap[y * width + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0
        if (printerBlack !== getPixel(image, x, y)) throw new Error(`점이 다르다 (${x}, ${y})`)
      }
    }
    expect(page.bitmap.subarray(240 * width).every((b) => b === 0)).toBe(true)
  })

  it('농도 1~5 밖·너비 넘침·연결 전은 웹과 같은 오류 코드', async () => {
    const { adapter } = setup()
    expect((await adapter.print(sampleImage())).ok).toBe(false)
    await adapter.connect('bluetooth')
    const bad = await adapter.print(sampleImage(), { density: 6 })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('INVALID_DENSITY')
    const wide = await adapter.print(sampleImage(1, 400, 10))
    expect(wide.ok).toBe(false)
    if (!wide.ok) expect(wide.error.code).toBe('IMAGE_TOO_WIDE')
  })

  it('출력 중 끊기면 DISCONNECTED로 실패하고 상태는 끊김', async () => {
    const { fake, adapter } = setup({ printer: { silent: [163] } })
    await adapter.connect('bluetooth')
    const printing = adapter.print(sampleImage())
    await flush(50)
    expect(adapter.state).toBe('PRINTING')
    fake.dropLink()
    const result = await printing
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('DISCONNECTED')
    expect(adapter.state).toBe('DISCONNECTED')
  })

  it('프린터가 오류 패킷(In_PrintError)으로 답하면 앱 BLE 길에서도 까닭이 붙는다: 1 덮개·2 용지·3·4 배터리·7 과열, 모르는 번호는 까닭 없음 (D-ALERTFLOAT-01)', async () => {
    const cases: [number, string | undefined][] = [
      [1, 'COVER_OPEN'],
      [2, 'NO_PAPER'],
      [3, 'LOW_BATTERY'],
      [4, 'LOW_BATTERY'],
      [7, 'OVERHEAT'],
      [9, undefined],
    ]
    for (const [code, issue] of cases) {
      const { fake, adapter } = setup({ printer: { printError: code } })
      await adapter.connect('bluetooth')
      const result = await adapter.print(sampleImage())
      expect(result.ok, String(code)).toBe(false)
      if (result.ok) continue
      expect(result.error.code, String(code)).toBe('PRINT_FAILED')
      expect(result.error.issue, String(code)).toBe(issue)
      // 연결은 그대로 (다시 시작하면 이어서 출력)
      expect(adapter.state, String(code)).toBe('CONNECTED')
      expect(fake.printer.printed).toHaveLength(0)
    }
  })
})

describe('기억·다시 잇기 (D-QS1-01·02, APP-03 "다른 앱으로 가 있어도")', () => {
  it('프린터 쪽에서 끊긴 뒤 connectRemembered(): 고르기 창 없이 기억한 ID로 잇는다', async () => {
    const pick = picker()
    const { fake, adapter } = setup({}, pick)
    await adapter.connect('bluetooth')
    fake.dropLink()
    expect(adapter.state).toBe('DISCONNECTED')
    const result = await adapter.connectRemembered()
    expect(result).toEqual({ ok: true })
    expect(pick.seen).toHaveLength(1) // 고르기 창은 처음 한 번만
    expect(fake.connectCount).toBe(2)
  })

  it('앱을 다시 켠 뒤(restoreRemembered) 저장한 ID로 고르기 창 없이 잇는다; 기억이 없으면 시도 없이 DISCONNECTED', async () => {
    const pick = picker()
    const { fake, adapter } = setup({}, pick)
    adapter.restoreRemembered({ method: 'bluetooth', deviceId: fake.device.id })
    expect(adapter.hasRemembered).toBe(true)
    expect(await adapter.connectRemembered()).toEqual({ ok: true })
    expect(pick.seen).toHaveLength(0)
    const fresh = setup({}, pick)
    const none = await fresh.adapter.connectRemembered()
    expect(none.ok).toBe(false)
    if (!none.ok) expect(none.error.code).toBe('DISCONNECTED')
    expect(fresh.fake.connectCount).toBe(0)
  })

  it('"다시 연결"(reconnect)로 기억한 기기에 실패하면 기억을 지운다 — 다음엔 고르기 창부터', async () => {
    const pick = picker()
    const { fake, adapter } = setup({}, pick)
    await adapter.connect('bluetooth')
    await adapter.disconnect()
    fake.setConnectFails(true)
    const failed = await adapter.reconnect('bluetooth')
    expect(failed.ok).toBe(false)
    expect(adapter.hasRemembered).toBe(false)
    fake.setConnectFails(false)
    await adapter.reconnect('bluetooth')
    expect(pick.seen).toHaveLength(2)
  })
})

describe('웹 Web Bluetooth와 같은 바이트 (APP-03 AC1, 프린터 골든 profile NIIMBOT_B1)', () => {
  it('같은 그림·같은 농도로 두 길이 프린터에 보낸 바이트가 같다 (조각 경계만 다름)', async () => {
    const image = sampleImage(9)
    // 네이티브 BLE 길 (MTU 23 → 조각이 가장 잘게 나뉜다)
    const { fake, adapter } = setup({ mtu: 23 })
    await adapter.connect('bluetooth')
    expect((await adapter.print(image, { density: 4 })).ok).toBe(true)
    await adapter.disconnect()
    // 웹 길: niimbluelib NiimbotBluetoothClient + 가짜 Web Bluetooth 기기 → 같은 가짜 B1 구현
    const webPrinter = createFakeB1()
    const device = createFakeWebBluetoothDevice(webPrinter)
    const webClient = new NiimbotBluetoothClient()
    webClient.setPacketInterval(0)
    const web = createNiimbotAdapter({
      environment: () => ({ bluetooth: { requestDevice: async () => device } }),
      createClient: () => webClient as unknown as NiimbotClientLike,
      timer: new ManualTimer(),
    })
    made.push(web)
    expect(await web.connect('bluetooth')).toEqual({ ok: true })
    expect((await web.print(image, { density: 4 })).ok).toBe(true)
    await web.disconnect()

    const native = fake.printer.received
    const viaWeb = webPrinter.received
    expect(native.length).toBe(viaWeb.length)
    expect(Buffer.from(native).equals(Buffer.from(viaWeb))).toBe(true)
    expect(fake.printer.requests).toEqual(webPrinter.requests)
    expect(fake.printer.printed[0]).toEqual(webPrinter.printed[0])
    // 조각은 네이티브가 더 많다 (MTU 23) — 바이트는 같다
    expect(fake.printer.writes).toBeGreaterThan(webPrinter.writes)
  })

  it('어댑터 프로필이 프린터 골든 G-PRT-N1-65의 NIIMBOT_B1과 같다', () => {
    const file = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'tests', 'golden', 'printer', 'profile.json'), 'utf8')) as {
      cases: { id: string; profile: string; out: Record<string, unknown> }[]
    }
    const golden = file.cases.find((c) => c.profile === 'NIIMBOT_B1')
    expect(golden?.id).toBe('G-PRT-N1-65')
    const { adapter } = setup()
    const profile = adapter.profile as typeof B1_PROFILE
    const picked = Object.fromEntries(Object.keys(golden!.out).map((key) => [key, (profile as unknown as Record<string, unknown>)[key]]))
    expect(picked).toEqual(golden!.out)
  })
})
