// PRN2 적대 시험 (test-domain): 프린터 골든 전부를 웹 표·앱 계열 표 둘 다로 (AC-PRN2-01~04·11, D-PRN2-01~05, L-7·L-12).
// 패키지 골든 러너(packages/printer/test/golden.test.ts)는 순수 함수만 본다. 여기서는 실제로 쓰는 길을 탄다:
// - list: 웹 = 한 목록 어댑터(createWebPrinterAdapter)가 낸 requestDevice 인자로 브라우저 고르기 창을 흉내 내어(보이면 고르고, 안 보이면 닫음)
//   이은 쪽(kind)과 알릴 프로필 ID를 본다. 앱 = 기본 계열 표(defaultPrinterFamilies)의 판정·찾기 거르기·고르기 목록 줄.
// - end: 웹 Marklife 어댑터(손으로 조종하는 기기)와 앱 Marklife 어댑터(가짜 BleManager — 끝 알림 값만 바꿈) 둘 다에서 끝 / 시간 초과.
// - job: 웹 어댑터가 보낸 조각을 이어 붙인 것 = 앱 어댑터가 보낸 것 = 골든 바이트(문자 조각·rawRaster는 바이트 그대로, yxqRaster는 머리 + 창 10으로 풀기).
// - profile·name·browser: 웹 표(PRINTER_PROFILES)와 앱 계열 표가 같은 줄을 쓴다.
import { inflateSync } from 'node:zlib'
import { createBitmap, type LabelBitmap } from '@livejjim/label'
import {
  LABEL_PROFILES,
  PRINTER_PROFILES,
  buildPrintJob,
  createFakeNiimbotBluetooth,
  createMarklifeAdapter,
  createWebPrinterAdapter,
  printerProfile,
  profileForDeviceName,
  systemTimer,
  unsupportedReason,
  uuid16,
  type BluetoothRequestOptions,
  type ConnectionMethod,
  type ModelProfile,
  type NiimbotClientLike,
  type PrinterResult,
} from '@livejjim/printer'
import { describe, expect, it } from 'vitest'
import { createNativeMarklifeAdapter, createPlxTransport, createPrinterPicker, createFakeBleTransport, defaultPrinterFamilies, encodeBase64, familyOf, familyScanFilter, type BleDeviceInfo, type DevicePicker } from '../../../packages/mobile-ble/src/index.ts'
import { createFakeMarklifeManager } from '../../../packages/mobile-ble/test/marklife-fakes.ts'
import { ManualBle, StepTimer } from '../n1/ble-mock.ts'
import { NIIMBOT_SERVICE, golden, hexBytes, hexOf, shownByFilters, type GoldenCase } from './helpers.ts'

const LIST = golden('list')
const END = golden('end')
const JOB = golden('job')
const PROFILE = golden('profile')
const NAME = golden('name')
const BROWSER = golden('browser')

const L12_IDS = new Set(LABEL_PROFILES.map((p) => p.id))

/** 웹 한 목록 어댑터 + 브라우저 고르기 창 흉내 (보이는 기기면 고르고, 안 보이면 판매자가 창을 닫는다) */
async function webPick(name: string | null, services: readonly string[]): Promise<{ result: PrinterResult; kind: string | null; profileId: string | null; shown: boolean; request: BluetoothRequestOptions | undefined }> {
  const timer = new StepTimer()
  const ble = new ManualBle({ name: name ?? '', timer, onFlowStart: [[0x01, 0x04]] })
  const device = { ...ble.device, name: name ?? undefined } as unknown as typeof ble.device
  const niim = createFakeNiimbotBluetooth({ model: 'B1' })
  let request: BluetoothRequestOptions | undefined
  let shown = false
  const adapter = createWebPrinterAdapter({
    timer: systemTimer,
    environment: () => ({
      bluetooth: {
        getAvailability: () => Promise.resolve(true),
        requestDevice: (r: BluetoothRequestOptions) => {
          request = r
          shown = shownByFilters(r, name, services)
          return shown ? Promise.resolve(device) : Promise.reject(Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' }))
        },
      },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      maxTouchPoints: 0,
    }),
    // 고른 기기가 무엇이든 가짜 NIIMBOT B1에 잇는다 (NIIMBOT 쪽으로 갔는지만 본다)
    createClient: (method: ConnectionMethod): NiimbotClientLike => {
      const client = niim.createClient(method)
      return new Proxy(client, {
        get(target, key, receiver) {
          if (key === 'connect') return () => target.connect({ authorizedDevice: niim.device })
          const value = Reflect.get(target, key, receiver) as unknown
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
        },
      })
    },
  })
  try {
    const result = await adapter.connect('bluetooth')
    return { result, kind: adapter.kind, profileId: adapter.profileId, shown, request }
  } finally {
    await adapter.disconnect()
  }
}

describe('골든 list — 웹 한 목록 어댑터로 (requestDevice 하나, L-7 고르기 목록)', () => {
  it('사례 24개', () => expect(LIST).toHaveLength(24))
  it.each(LIST.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const want = c.out.list as string | null
    const r = await webPick(c.name ?? null, c.services ?? [])
    // 고르기 창은 한 번, optionalServices는 ff00·fd00·NIIMBOT 서비스(L-7, D-PRN2-20), acceptAllDevices 없음
    expect(r.request).toBeDefined()
    expect(r.request).not.toHaveProperty('acceptAllDevices')
    expect([...((r.request as unknown as { optionalServices: string[] }).optionalServices ?? [])].sort()).toEqual([uuid16(0xfd00), uuid16(0xff00), NIIMBOT_SERVICE].sort())
    if (want === null) {
      // 목록에 없다 — 창에 보이지 않아 고를 수 없다
      expect(r.shown, '창에 보였다').toBe(false)
      expect(r.result).toMatchObject({ ok: false, error: { code: 'NOT_SELECTED' } })
      expect(r.profileId).toBeNull()
      return
    }
    expect(r.shown, '창에 보이지 않았다').toBe(true)
    expect(r.result, JSON.stringify(r.result)).toEqual({ ok: true })
    if (want === 'NIIMBOT') {
      expect(r.kind).toBe('NIIMBOT')
      expect(r.profileId).toBe('NIIMBOT_B1')
    } else {
      expect(r.kind).toBe('LABEL')
      expect(r.profileId).toBe(want)
    }
  })
})

describe('골든 list — 앱 기본 계열 표로 (계열 판정·찾기 거르기·목록 줄)', () => {
  const families = defaultPrinterFamilies()
  const filter = familyScanFilter(families)
  it.each(LIST.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const want = c.out.list as string | null
    const name = c.name ?? null
    const services = c.services ?? []
    const kind = familyOf(name, families, services)
    expect(kind).toBe(want === null ? null : want === 'NIIMBOT' ? 'NIIMBOT' : 'MARKLIFE')
    // 찾기 거르기(서비스 또는 이름 앞자리 — 글자 그대로)에 걸리는지 = 목록에 드는지
    const scanned = services.some((s) => filter.serviceUuids.includes(s.toLowerCase())) || (typeof name === 'string' && filter.namePrefixes.some((p) => name.startsWith(p)))
    expect(scanned, '찾기 거르기').toBe(want !== null)
    // 고르기 목록 줄: 목록에 들면 한 줄, 실험 L-12 기종이면 "실험", NIIMBOT 줄은 표시 없음
    const fake = createFakeBleTransport()
    const picker = createPrinterPicker({ transport: fake.transport, pickDevice: () => Promise.resolve(null) })
    const device: BleDeviceInfo = { id: 'AA:BB:CC:DD:EE:01', name, rssi: -50, ...(services.length > 0 ? { serviceUuids: [...services] } : {}) }
    const entries = picker.entries([device])
    expect(entries).toHaveLength(want === null ? 0 : 1)
    if (want !== null && want !== 'NIIMBOT') {
      expect(entries[0]?.model).toBe(printerProfile(want)?.displayName)
      expect(entries[0]?.experimental).toBe(true)
      expect(entries[0]?.detail).toContain('실험')
    }
    if (want === 'NIIMBOT') expect(entries[0]?.experimental).toBe(false)
  })
})

describe('골든 profile — 웹 표와 앱 계열 표가 같은 줄', () => {
  const appRows = defaultPrinterFamilies().flatMap((f) => f.profiles)
  it('앱 계열 표가 덮는 프로필 = 켠 프로필 표 전부 (겹침 없음)', () => {
    expect(appRows.map((p) => p.id).sort()).toEqual(PRINTER_PROFILES.map((p) => p.id).sort())
    expect(new Set(appRows.map((p) => p.id)).size).toBe(appRows.length)
  })
  it.each(PROFILE.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const web = printerProfile(c.profile as string)
    const app = appRows.find((p) => p.id === c.profile)
    for (const row of [web, app]) {
      expect(row).toBeDefined()
      const picked = Object.fromEntries(Object.keys(c.out).map((k) => [k, (row as unknown as Record<string, unknown>)[k]]))
      expect(JSON.parse(JSON.stringify(picked))).toEqual(c.out)
    }
  })
  it('지원 단계: B1만 확인됨, 나머지 13줄은 실험 (AC-PRN2-01)', () => {
    expect(PRINTER_PROFILES.filter((p) => !p.experimental).map((p) => p.id)).toEqual(['NIIMBOT_B1'])
    expect(PRINTER_PROFILES).toHaveLength(14)
  })
})

describe('골든 name·browser — 웹 표와 앱 Marklife 계열', () => {
  const marklife = defaultPrinterFamilies().find((f) => f.id === 'MARKLIFE')!
  it.each(NAME.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const want = c.out.profile as string | null
    expect(profileForDeviceName(c.name, LABEL_PROFILES)?.id ?? null).toBe(want)
    expect(marklife.claim(c.name as string)).toBe(want === null ? 'pass' : 'mine')
    expect(marklife.modelName(c.name as string)).toBe(want === null ? 'Marklife' : printerProfile(want)?.displayName)
  })
  it.each(BROWSER.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(unsupportedReason(c.ua, c.maxTouchPoints ?? 0)).toBe(c.out.reason)
  })
})

// ─── 작업 바이트·끝 알림을 어댑터 둘로 ───

function fillRows(widthBytes: number, height: number, fill: string): Uint8Array {
  const out = new Uint8Array(widthBytes * height)
  if (fill === 'black') out.fill(0xff)
  if (fill === 'border')
    for (let y = 0; y < height; y++) {
      if (y === 0 || y === height - 1) out.fill(0xff, y * widthBytes, (y + 1) * widthBytes)
      else {
        out[y * widthBytes] = 0x80
        out[(y + 1) * widthBytes - 1] = (out[(y + 1) * widthBytes - 1] as number) | 0x01
      }
    }
  return out
}

function imageOf(c: GoldenCase): LabelBitmap {
  const spec = c.image!
  const row = Math.ceil(spec.width / 8)
  if (spec.rows) {
    const img = createBitmap(spec.width, spec.height)
    spec.rows.forEach((r, y) => img.data.set(hexBytes(r), y * row))
    return img
  }
  return { width: spec.width, height: spec.height, data: fillRows(row, spec.height, spec.fill as string) }
}

/** 골든 out.bytes를 받은 바이트와 맞춘다 (문자 조각·rawRaster는 그대로, yxqRaster는 머리 + 창 10으로 풀어서) */
function matchGoldenBytes(pieces: readonly unknown[], got: Uint8Array, where: string): void {
  let at = 0
  for (const piece of pieces) {
    if (typeof piece === 'string') {
      const want = hexBytes(piece)
      expect(hexOf(got.subarray(at, at + want.length)), `${where} @${String(at)}`).toBe(hexOf(want))
      at += want.length
      continue
    }
    const p = piece as { rawRaster?: { widthBytes: number; height: number; rows?: string[]; fill?: string }; yxqRaster?: { widthBytes: number; height: number; rows?: string[]; fill?: string } }
    const spec = (p.rawRaster ?? p.yxqRaster)!
    const rows = spec.rows ? Uint8Array.from(spec.rows.flatMap(hexBytes)) : fillRows(spec.widthBytes, spec.height, spec.fill as string)
    if (p.rawRaster) {
      const head = [0x1d, 0x76, 0x30, 0x00, spec.widthBytes & 0xff, spec.widthBytes >> 8, spec.height & 0xff, spec.height >> 8]
      expect(hexOf(got.subarray(at, at + 8)), `${where} rawRaster 머리`).toBe(hexOf(head))
      expect(hexOf(got.subarray(at + 8, at + 8 + rows.length)), `${where} rawRaster 줄`).toBe(hexOf(rows))
      at += 8 + rows.length
    } else {
      const head = [0x1f, 0x10, spec.widthBytes >> 8, spec.widthBytes & 0xff, spec.height >> 8, spec.height & 0xff]
      expect(hexOf(got.subarray(at, at + 6)), `${where} yxqRaster 머리`).toBe(hexOf(head))
      const len = ((got[at + 6]! << 24) | (got[at + 7]! << 16) | (got[at + 8]! << 8) | got[at + 9]!) >>> 0
      const packed = got.subarray(at + 10, at + 10 + len)
      expect(packed[0], `${where} CMF`).toBe(0x28)
      expect(hexOf(inflateSync(packed, { windowBits: 10 })), `${where} 풀린 줄`).toBe(hexOf(rows))
      at += 10 + len
    }
  }
  expect(at, `${where} 남는 바이트`).toBe(got.length)
}

/** 웹 Marklife 어댑터로 한 장: 크레딧을 주고, 다 받으면 end 값을 알린다. 결과와 보낸 바이트 */
async function webPrint(profile: ModelProfile, image: LabelBitmap, options: { density?: number } | undefined, end: readonly number[] = [0xaa]): Promise<{ result: PrinterResult; bytes: Uint8Array; at: number; writes: number }> {
  const timer = new StepTimer()
  let total = -1
  let sent = 0
  const ble: ManualBle = new ManualBle({
    name: `${profile.namePrefix as string}AB12`,
    timer,
    onFlowStart: [[0x01, 0x04]],
    onWriteEnd: (_i, w) => {
      ble.sendFlow([0x01, 0x01])
      sent += w.bytes.length
      if (sent === total) timer.schedule(() => ble.sendNotify(end), 10)
    },
  })
  const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer, profiles: LABEL_PROFILES })
  expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
  const job = buildPrintJob(profile, image, options ?? {})
  total = job.ok ? job.bytes.length : -1
  let result: PrinterResult | undefined
  void adapter.print(image, options).then((r) => (result = r))
  for (let i = 0; i < 200 && result === undefined; i++) await timer.advance(1_000)
  await adapter.disconnect()
  return { result: result!, bytes: ble.joined(), at: timer.now, writes: ble.writes.length }
}

/** 앱 Marklife 어댑터로 한 장 (가짜 BleManager — 다 받으면 보내는 `AA`를 end 값으로 바꾼다). 진행 없음 시간은 줄여 둔다 */
async function appPrint(profile: ModelProfile, image: LabelBitmap, options: { density?: number } | undefined, end: readonly number[] = [0xaa]): Promise<{ result: PrinterResult; printed: readonly Uint8Array[]; packets: Uint8Array }> {
  const name = `${profile.namePrefix as string}AB12`
  const manager = createFakeMarklifeManager([{ id: 'ML:01', localName: name, printer: { protocol: profile.protocol as never, bundle: 'A' } }])
  const notify = uuid16(0xff01)
  const swapped = {
    ...manager,
    monitorCharacteristicForDevice: (id: string, service: string, characteristic: string, listener: (e: unknown, c: { value?: string | null } | null) => void) =>
      manager.monitorCharacteristicForDevice(id, service, characteristic, (e, c) => {
        if (characteristic.toLowerCase() === notify && c?.value === encodeBase64(Uint8Array.of(0xaa))) listener(e, { ...c, value: encodeBase64(Uint8Array.from(end)) })
        else listener(e, c)
      }),
  } as typeof manager
  const pick: DevicePicker = (scan) =>
    new Promise((resolve) => {
      const stop = scan.onDevices((devices) => {
        const hit = devices.find((d) => d.name === name)
        if (hit) {
          stop()
          resolve(hit)
        }
      })
    })
  const adapter = createNativeMarklifeAdapter({ transport: createPlxTransport(swapped), pickDevice: pick, packetIntervalMs: 0, printTimeoutMs: 300 })
  expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
  const result = await adapter.print(image, options)
  await adapter.disconnect()
  const parts = manager.packets('ML:01')
  const packets = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    packets.set(p, at)
    at += p.length
  }
  return { result, printed: manager.printed('ML:01'), packets }
}

describe('골든 job — 웹 어댑터·앱 어댑터가 보낸 바이트 = 골든 (AC-PRN2-02)', () => {
  it.each(JOB.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const profile = printerProfile(c.profile as string)!
    const image = imageOf(c)
    const web = await webPrint(profile, image, c.options)
    const app = await appPrint(profile, image, c.options)
    if ('error' in c.out) {
      expect(web.result).toMatchObject({ ok: false, error: { code: c.out.error } })
      expect(app.result).toMatchObject({ ok: false, error: { code: c.out.error } })
      expect(web.writes, '거절된 출력은 한 조각도 보내지 않는다').toBe(0)
      expect(app.packets.length).toBe(0)
      return
    }
    expect(web.result).toEqual({ ok: true })
    expect(app.result).toEqual({ ok: true })
    matchGoldenBytes(c.out.bytes as unknown[], web.bytes, `${c.id} 웹`)
    expect(hexOf(app.packets), `${c.id} 앱 = 웹`).toBe(hexOf(web.bytes))
  })
})

describe('골든 end — 웹 어댑터·앱 어댑터에서 끝 / 시간 초과 (AC-PRN2-03)', () => {
  const image = (p: ModelProfile): LabelBitmap => (p.rotate === 'CW90' ? createBitmap(320, 96) : createBitmap(384, 8))
  it.each(END.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const profile = printerProfile(c.profile as string)!
    const value = hexBytes(c.value as string)
    const web = await webPrint(profile, image(profile), undefined, value)
    const app = await appPrint(profile, image(profile), undefined, value)
    if (c.out.end === true) {
      expect(web.result).toEqual({ ok: true })
      expect(app.result).toEqual({ ok: true })
    } else {
      // 끝 알림이 아니면 마지막 조각 뒤 20초에 TIMEOUT (안 찍힌 라벨을 찍힌 것으로 기록하지 않는다)
      expect(web.result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
      expect(app.result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
    }
  })
})

describe('L12_IDS 표 확인', () => {
  it('Marklife 9 + 바우아토', () => expect([...L12_IDS]).toHaveLength(10))
})
