// PRN2 적대 시험 (test-domain): 기기 쪽 경계 (AC-PRN2-03·04·05, L-7 고르기 목록·지원 단계, L-12 3·4·5, D-PRN2-03·04·05·16·22).
// - 끝 알림: 무작위 알림 값 — 끝은 정확히 `AA` 한 바이트, Luck Jingle만 정확히 `4F 4B`도. 어댑터에서 `OK`가 두 알림으로 쪼개져 와도·출력 전에 와도 끝이 아니다.
//   Marklife는 첫 조각 뒤 `OK`(YXQ 첫 명령의 답)를 받아도 끝까지 보내고 `AA`를 기다린다.
// - ff03 없는 꾸러미 A: 크레딧을 기다리지 않고 30ms 간격으로 끝까지 보낸다 (1.03초 간격이 아니다), 바이트는 작업 그대로.
// - 고르기 목록 이름 경계: 대소문자·앞 공백·전각·폭 없는 공백·이어폰·Phomemo·첫 글자만 같은 기기 — 웹·앱 같은 답 (속성 포함).
// - D-PRN2-16: 대소문자만 다른 L-12 이름 + NIIMBOT 서비스 → NIIMBOT 목록, 이은 뒤 모델이 다르면 WRONG_MODEL.
// - WRONG_MODEL: B1 Pro·B21 Pro(300dpi)·변형은 웹(B1·한 목록)·앱(네이티브 B1·고르기) 모두 WRONG_MODEL + 그림 파일 경로 문장, 기억하지 않음,
//   알릴 프로필 ID 없음. 켠 실험 모델(B1 SE·B21·D110)은 그 프로필로 이어 "실험"이다.
// - D-PRN2-22: 농도가 없는 프로필을 흉내 낸 시험용 프린터는 받은 농도를 쓰지 않고 0으로 기록한다.
import { createBitmap, type LabelBitmap } from '@livejjim/label'
import {
  BAUATO_PPA2L,
  LABEL_PROFILES,
  MARKLIFE_P12,
  MARKLIFE_P50,
  MARKLIFE_S2,
  PRINTER_MESSAGES,
  buildPrintJob,
  createB1Adapter,
  createFakePrinter,
  createFakeNiimbotBluetooth,
  createMarklifeAdapter,
  createWebPrinterAdapter,
  isEndNotice,
  pickListTarget,
  printerProfile,
  printerSupportStage,
  systemTimer,
  type BluetoothRequestOptions,
  type LabelProtocol,
  type ModelProfile,
  type PrinterResult,
} from '@livejjim/printer'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createFakeBleTransport, createNativeB1Adapter, createPrinterPicker, defaultPrinterFamilies, familyOf, type BleDeviceInfo, type DevicePicker } from '../../../packages/mobile-ble/src/index.ts'
import { ManualBle, StepTimer } from '../n1/ble-mock.ts'
import { NIIMBOT_SERVICE, withoutFlow } from './helpers.ts'

const PROTOCOLS: readonly LabelProtocol[] = ['MARKLIFE_YXQ2', 'MARKLIFE_YXQ3', 'MARKLIFE_YXQ8', 'MARKLIFE_L11', 'LUCKJINGLE']
const imageFor = (p: ModelProfile, n = 40): LabelBitmap => (p.rotate === 'CW90' ? createBitmap(n * 8, 96) : createBitmap(384, n))

describe('끝 알림 값 — 무작위 (L-12 5, D-PRN2-03)', () => {
  it('끝 ⇔ 정확히 AA 한 바이트, 또는 Luck Jingle이고 정확히 4F 4B (속성)', () => {
    const interesting = fc.oneof(
      fc.uint8Array({ maxLength: 6 }),
      fc.constantFrom([0xaa], [0x4f, 0x4b], [0x6f, 0x6b], [0x4f, 0x6b], [0x4f, 0x4b, 0x0a], [0x4f, 0x4b, 0x0d, 0x0a], [0x0a, 0x4f, 0x4b], [0xaa, 0xaa], [0xaa, 0x00], [0x00, 0xaa], [0x4f], [0x4b], [], [0x20, 0x4f, 0x4b], [0x4f, 0x4b, 0x00]).map((a) => Uint8Array.from(a)),
    )
    fc.assert(
      fc.property(fc.constantFrom(...PROTOCOLS), interesting, (protocol, value) => {
        const want = (value.length === 1 && value[0] === 0xaa) || (protocol === 'LUCKJINGLE' && value.length === 2 && value[0] === 0x4f && value[1] === 0x4b)
        expect(isEndNotice(protocol, value), `${protocol} ${Buffer.from(value).toString('hex')}`).toBe(want)
      }),
      { numRuns: 1_500, seed: 0x9120 },
    )
  })
})

/** 크레딧을 넉넉히 주는 손 기기 + 어댑터 (조각 사이 30ms) */
async function connected(profile: ModelProfile, extra: { onWriteEnd?: (i: number, bytes: Uint8Array) => void } = {}) {
  const timer = new StepTimer()
  const ble: ManualBle = new ManualBle({
    name: `${profile.namePrefix as string}AB12`,
    timer,
    onFlowStart: [[0x01, 0x04]],
    onWriteEnd: (i, w) => {
      ble.sendFlow([0x01, 0x01])
      extra.onWriteEnd?.(i, w.bytes)
    },
  })
  const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer, profiles: LABEL_PROFILES })
  expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
  return { timer, ble, adapter }
}

describe('끝 알림 — 어댑터에서 (AC-PRN2-03)', () => {
  it('바우아토: OK가 두 알림(4F · 4B)으로 쪼개져 오면 끝이 아니다 → 마지막 조각 뒤 20초에 TIMEOUT', async () => {
    const image = imageFor(BAUATO_PPA2L)
    const job = buildPrintJob(BAUATO_PPA2L, image)
    if (!job.ok) throw new Error(job.code)
    let sent = 0
    const c = await connected(BAUATO_PPA2L, {
      onWriteEnd: (_i, b) => {
        sent += b.length
        if (sent === job.bytes.length) {
          c.timer.schedule(() => c.ble.sendNotify([0x4f]), 5)
          c.timer.schedule(() => c.ble.sendNotify([0x4b]), 6)
        }
      },
    })
    let result: PrinterResult | undefined
    void c.adapter.print(image).then((r) => (result = r))
    await c.timer.advance(10_000)
    expect(result).toBeUndefined()
    const last = c.ble.writes.at(-1)!.endAt!
    await c.timer.advance(last + 20_000 - c.timer.now - 1)
    expect(result).toBeUndefined()
    await c.timer.advance(1)
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
  })

  it('바우아토: 출력 전에 온 OK는 세지 않는다 → 이번 출력의 끝 알림이 없으면 TIMEOUT', async () => {
    const c = await connected(BAUATO_PPA2L)
    c.ble.sendNotify([0x4f, 0x4b])
    c.ble.sendNotify([0xaa])
    let result: PrinterResult | undefined
    void c.adapter.print(imageFor(BAUATO_PPA2L)).then((r) => (result = r))
    await c.timer.advance(30_000)
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
  })

  it.each([MARKLIFE_S2, MARKLIFE_P50, MARKLIFE_P12])('%s: 첫 조각 뒤 OK(첫 명령의 답)가 와도 출력함이 아니다 — 끝까지 보내고 AA에서만 끝', async (profile) => {
    const image = imageFor(profile, 120)
    const job = buildPrintJob(profile, image)
    if (!job.ok) throw new Error(job.code)
    let sent = 0
    const c = await connected(profile, {
      onWriteEnd: (i, b) => {
        sent += b.length
        if (i === 0) c.timer.schedule(() => c.ble.sendNotify([0x4f, 0x4b]), 1)
        if (sent === job.bytes.length) c.timer.schedule(() => c.ble.sendNotify([0xaa]), 500)
      },
    })
    let result: PrinterResult | undefined
    let doneAt = -1
    void c.adapter.print(image).then((r) => {
      result = r
      doneAt = c.timer.now
    })
    await c.timer.advance(60_000)
    expect(result).toEqual({ ok: true })
    expect(Buffer.from(c.ble.joined()).equals(Buffer.from(job.bytes))).toBe(true)
    expect(doneAt).toBe(c.ble.writes.at(-1)!.endAt! + 500)
  })
})

describe('ff03 없는 꾸러미 A — 크레딧 없이 끝까지 (AC-PRN2-03, D-PRN2-03)', () => {
  it.each([BAUATO_PPA2L, MARKLIFE_S2, MARKLIFE_P12])('%s: 연결되고, 조각 사이 30ms(첫 조각은 바로), 바이트 = 작업, AA로 끝', async (profile) => {
    const timer = new StepTimer()
    const image = imageFor(profile, 60)
    const job = buildPrintJob(profile, image)
    if (!job.ok) throw new Error(job.code)
    let sent = 0
    const ble: ManualBle = new ManualBle({
      name: `${profile.namePrefix as string}NOFLOW`,
      timer,
      // ff03이 없으니 크레딧 알림은 오지 않는다
      onWriteEnd: (_i, w) => {
        sent += w.bytes.length
        if (sent === job.bytes.length) timer.schedule(() => ble.sendNotify([0xaa]), 3)
      },
    })
    const adapter = createMarklifeAdapter({ environment: () => withoutFlow(ble.environment), timer, profiles: LABEL_PROFILES })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    let result: PrinterResult | undefined
    void adapter.print(image).then((r) => (result = r))
    await timer.advance(60_000)
    expect(result).toEqual({ ok: true })
    expect(Buffer.from(ble.joined()).equals(Buffer.from(job.bytes))).toBe(true)
    const at = ble.writes.map((w) => w.at)
    expect(at[0]).toBe(0)
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!, `${String(i)}번째 간격`).toBe(30)
    expect(ble.writes.every((w) => w.bytes.length <= 90)).toBe(true)
  })
})

// ─── 고르기 목록 이름 경계 ───

const FAMILY_OF = (name: string | null, services: readonly string[] = []): string | null => familyOf(name, defaultPrinterFamilies(), services)
const asFamily = (target: string | null): string | null => (target === null ? null : target === 'NIIMBOT' ? 'NIIMBOT' : 'MARKLIFE')

describe('고르기 목록 이름 경계 — 웹·앱 같은 답 (AC-PRN2-04, L-7 고르기 목록, D-PRN2-04)', () => {
  const cases: [string, string | null, readonly string[], string | null][] = [
    ['B1- 정상', 'B1-G3250', [], 'NIIMBOT'],
    ['소문자 b1-', 'b1-G3250', [], null],
    ['앞 공백', ' B1-G3250', [], null],
    ['앞 탭', '\tB1-G3250', [], null],
    ['전각 Ｂ', 'Ｂ1-G3250', [], null],
    ['전각 하이픈', 'B1－G3250', [], null],
    ['폭 없는 공백이 모델 뒤', 'B1​-G3250', [], null],
    ['폭 없는 공백이 맨 앞', '​B1-G3250', [], null],
    ['B1 공백 Pro', 'B1 Pro', [], null],
    ['B21S (모델 이름 뒤 - _ 아님)', 'B21S-0001', [], null],
    ['B1_SE_ (켠 모델 B1_SE)', 'B1_SE_0001', [], 'NIIMBOT'],
    ['D110_M (B1_·D110_ 꼴 — 이은 뒤 모델로 거름)', 'D110_M-0001', [], 'NIIMBOT'],
    ['이어폰 Buds (첫 글자 B)', 'Buds2 Pro', [], null],
    ['이어폰 Galaxy Buds', 'Galaxy Buds3 (A1B2)', [], null],
    ['이어폰 Bose', 'Bose QC Earbuds', [], null],
    ['이어폰 Beats', 'Beats Studio Buds', [], null],
    ['Phomemo P12 (Marklife와 같은 모델 이름)', 'Phomemo P12', [], null],
    ['Phomemo M110', 'M110', [], null],
    ['Phomemo D30 (첫 글자 D)', 'D30', [], null],
    ['P12 끝 공백 (앞자리 뒤는 보지 않음)', 'P12_AB ', [], 'MARKLIFE_P12'],
    ['p12_ 소문자', 'p12_AB', [], null],
    ['전각 Ｐ12_', 'Ｐ12_AB', [], null],
    ['P12 폭 없는 공백', 'P12​_AB', [], null],
    ['PPA2L 정상', 'PPA2L_9F', [], 'BAUATO_PPA2L'],
    ['ppa2 소문자', 'ppa2L_9F', [], null],
    ['NIIMBOT 서비스 대문자 + 이어폰 이름', 'Buds2 Pro', [NIIMBOT_SERVICE.toUpperCase()], 'NIIMBOT'],
    ['다른 서비스만', 'B1', ['0000180f-0000-1000-8000-00805f9b34fb'], null],
    ['NIIMBOT 서비스 + L-12 이름 → L-12 먼저', 'S2_77', [NIIMBOT_SERVICE], 'MARKLIFE_S2'],
  ]
  it.each(cases)('%s', (_what, name, services, want) => {
    expect(pickListTarget(name, services)).toBe(want)
    expect(FAMILY_OF(name, services)).toBe(asFamily(want))
  })

  it('D-PRN2-16: 대소문자만 다른 L-12 이름 + NIIMBOT 서비스(p50_lower) → NIIMBOT 목록에 든다', () => {
    expect(pickListTarget('p50_lower', [NIIMBOT_SERVICE])).toBe('NIIMBOT')
    expect(FAMILY_OF('p50_lower', [NIIMBOT_SERVICE])).toBe('NIIMBOT')
    // 서비스가 없으면 목록 밖
    expect(pickListTarget('p50_lower', [])).toBeNull()
  })

  it('D-PRN2-16: 웹에서 그 기기를 고르면 NIIMBOT 쪽으로 잇고, 모델이 켠 표와 다르면 끊고 WRONG_MODEL — 기억·프로필 ID 없음', async () => {
    const niim = createFakeNiimbotBluetooth({ model: 'P50', name: 'p50_lower' })
    const adapter = createWebPrinterAdapter({
      timer: systemTimer,
      environment: () => ({ bluetooth: { getAvailability: () => Promise.resolve(true), requestDevice: () => Promise.resolve(niim.device) }, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0', maxTouchPoints: 0 }),
      createClient: niim.createClient,
    })
    const r = await adapter.connect('bluetooth')
    expect(r).toEqual({ ok: false, error: { code: 'WRONG_MODEL', message: PRINTER_MESSAGES.WRONG_MODEL, detail: '모델: P50' } })
    expect(adapter.state).toBe('DISCONNECTED')
    expect(adapter.hasRemembered).toBe(false)
    expect(adapter.profileId).toBeNull()
    expect(niim.connected).toBe(false)
  })

  it('속성: 아무 이름 + 아무 서비스 → 웹 판정과 앱 계열이 같고, 목록에 들면 이름이 앞자리·모델 꼴로 시작하거나 NIIMBOT 서비스를 광고한다', () => {
    const prefixes = ['P50_', 'S2_', 'X2_', 'P11_', 'P12_', 'P15_', 'L13_', 'LP90_', 'LP15_', 'PPA2', 'B1-', 'B1_', 'B1_SE-', 'B1_SE_', 'B21-', 'B21_', 'D110-', 'D110_']
    const nameArb = fc.oneof(
      fc.string({ maxLength: 12 }),
      fc.tuple(fc.constantFrom('', ' ', '​', '　', 'x', 'Phomemo ', 'Galaxy '), fc.constantFrom(...prefixes), fc.string({ maxLength: 6 })).map(([h, p, t]) => h + p + t),
      fc.tuple(fc.constantFrom(...prefixes), fc.string({ maxLength: 6 })).map(([p, t]) => p.toLowerCase() + t),
      fc.constant(null),
    )
    const svcArb = fc.subarray([NIIMBOT_SERVICE, NIIMBOT_SERVICE.toUpperCase(), '0000ff00-0000-1000-8000-00805f9b34fb', '0000180f-0000-1000-8000-00805f9b34fb'])
    fc.assert(
      fc.property(nameArb, svcArb, (name, services) => {
        const target = pickListTarget(name, services)
        expect(FAMILY_OF(name, services)).toBe(asFamily(target))
        if (target !== null) {
          const byName = typeof name === 'string' && prefixes.some((p) => name.startsWith(p))
          const bySvc = services.some((s) => s.toLowerCase() === NIIMBOT_SERVICE)
          expect(byName || bySvc).toBe(true)
          if (target !== 'NIIMBOT') expect(printerProfile(target)?.namePrefix && (name as string).startsWith(printerProfile(target)!.namePrefix!)).toBe(true)
        }
      }),
      { numRuns: 1_500, seed: 0x9121 },
    )
  })
})

// ─── WRONG_MODEL ───

const pickFirst: DevicePicker = (scan) =>
  new Promise((resolve) => {
    const stop = scan.onDevices((devices) => {
      const hit = devices[0]
      if (hit) {
        stop()
        resolve(hit)
      }
    })
  })

describe('WRONG_MODEL — 켠 표에 없는 NIIMBOT 모델 (AC-PRN2-05, L-7, D-PRN2-05·06)', () => {
  it.each(['B1_PRO', 'B21_PRO', 'B21S', 'D110_M', 'D11'])('웹 B1 어댑터·한 목록 어댑터: %s → WRONG_MODEL + 그림 파일 경로 문장, 끊고 기억하지 않는다', async (model) => {
    expect(PRINTER_MESSAGES.WRONG_MODEL).toContain('그림 파일')
    for (const make of ['b1', 'one'] as const) {
      const niim = createFakeNiimbotBluetooth({ model, name: `${model}-0001` })
      const adapter =
        make === 'b1'
          ? createB1Adapter({ environment: () => niim.environment, createClient: niim.createClient, timer: systemTimer })
          : createWebPrinterAdapter({
              timer: systemTimer,
              environment: () => ({ bluetooth: { getAvailability: () => Promise.resolve(false), requestDevice: (_r: BluetoothRequestOptions) => Promise.resolve(niim.device) }, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0', maxTouchPoints: 0 }),
              createClient: niim.createClient,
            })
      const r = await adapter.connect('bluetooth')
      // 한 목록은 getAvailability false여도 WRONG_MODEL 그대로(BLUETOOTH_OFF 아님 — D-QS1-11)
      expect(r, make).toEqual({ ok: false, error: { code: 'WRONG_MODEL', message: PRINTER_MESSAGES.WRONG_MODEL, detail: `모델: ${model}` } })
      expect(adapter.state).toBe('DISCONNECTED')
      expect(adapter.hasRemembered).toBe(false)
      expect(niim.connected).toBe(false)
    }
  })

  it.each([
    ['B1_PRO', 4097],
    ['B21_PRO', 785],
  ] as const)('앱 네이티브 B1 어댑터·한 목록 고르기: %s → WRONG_MODEL, 알릴 프로필 ID 없음', async (model, modelId) => {
    const fake = createFakeBleTransport({ printer: { modelId } })
    const adapter = createNativeB1Adapter({ transport: fake.transport, pickDevice: async () => fake.device, client: { packetIntervalMs: 0 } })
    const r = await adapter.connect('bluetooth')
    expect(r).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL', message: PRINTER_MESSAGES.WRONG_MODEL, detail: `모델: ${model}` } })
    expect(adapter.hasRemembered).toBe(false)
    const fake2 = createFakeBleTransport({ printer: { modelId } })
    const picker = createPrinterPicker({ transport: fake2.transport, pickDevice: pickFirst, client: { packetIntervalMs: 0 } })
    const r2 = await picker.connect('bluetooth')
    expect(r2).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL', detail: `모델: ${model}` } })
    expect(picker.profileId).toBeNull()
    expect(picker.hasRemembered).toBe(false)
    expect(fake2.connected).toBe(false)
  })

  it.each([
    ['B1_SE', 'NIIMBOT_B1_SE'],
    ['B21', 'NIIMBOT_B21'],
    ['D110', 'NIIMBOT_D110'],
    ['B1', 'NIIMBOT_B1'],
  ])('켠 모델 %s → %s로 잇고 단계는 표대로', async (model, id) => {
    const niim = createFakeNiimbotBluetooth({ model, name: `${model}-0001` })
    const adapter = createWebPrinterAdapter({
      timer: systemTimer,
      environment: () => ({ bluetooth: { getAvailability: () => Promise.resolve(true), requestDevice: () => Promise.resolve(niim.device) }, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0', maxTouchPoints: 0 }),
      createClient: niim.createClient,
    })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(adapter.profileId).toBe(id)
    expect(printerSupportStage(adapter.profileId)).toBe(id === 'NIIMBOT_B1' ? 'CONFIRMED' : 'EXPERIMENTAL')
    await adapter.disconnect()
    expect(adapter.profileId).toBeNull()
  })
})

describe('앱 고르기: 목록에 든 NIIMBOT 기기는 이름이 모델 꼴이 아니어도 이어서 모델로 판단한다 (골든 list 2 → L-7 모델 확인)', () => {
  it.each([
    ['서비스만 광고하는 이름 없는 기기 (G-PRT-PRN2-25)', null, [NIIMBOT_SERVICE]],
    ['B1 Pro 이름 + 서비스 (G-PRT-PRN2-31)', 'B1 Pro-0001', [NIIMBOT_SERVICE]],
    ['B1 이름만 + 서비스 대문자 (G-PRT-PRN2-27·44)', 'B1', [NIIMBOT_SERVICE.toUpperCase()]],
    ['B1- 이름, 서비스 없음 (G-PRT-PRN2-21)', 'B1-G3250', []],
  ] as const)('%s → 모델 B1이면 NIIMBOT_B1로 이어진다', async (_what, name, services) => {
    const fake = createFakeBleTransport({ device: { id: 'FA:KE:B1:00:00:01', name, ...(services.length > 0 ? { serviceUuids: [...services] } : {}) } })
    const picker = createPrinterPicker({ transport: fake.transport, pickDevice: pickFirst, client: { packetIntervalMs: 0 } })
    const r = await picker.connect('bluetooth')
    expect(r).toEqual({ ok: true })
    expect(picker.kind).toBe('NIIMBOT')
    expect(picker.profileId).toBe('NIIMBOT_B1')
    await picker.disconnect()
    expect(picker.profileId).toBeNull()
  })
})

describe('D-PRN2-22 시험용 프린터 — 농도 없는 프로필은 받은 농도를 쓰지 않고 0으로 기록', () => {
  it.each(['BAUATO_PPA2L', 'MARKLIFE_P12'])('%s', async (id) => {
    const profile = printerProfile(id)!
    const printer = createFakePrinter({ profile, methods: ['bluetooth'] })
    expect(await printer.connect('bluetooth')).toEqual({ ok: true })
    expect(await printer.print(imageFor(profile, 12), { density: 3 })).toEqual({ ok: true })
    expect(printer.printed.map((p) => p.density)).toEqual([0])
  })
  it('농도 있는 프로필(P50 1~3)은 범위 밖 농도를 받지 않는다 (INVALID_DENSITY, 문장 1~3)', async () => {
    const printer = createFakePrinter({ profile: MARKLIFE_P50, methods: ['bluetooth'] })
    await printer.connect('bluetooth')
    const r = await printer.print(imageFor(MARKLIFE_P50, 12), { density: 5 })
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_DENSITY' } })
    expect((r as { error: { message: string } }).error.message).toContain('1~3')
  })
})

describe('기기 정보 타입 확인', () => {
  it('BleDeviceInfo 서비스 칸 이름', () => {
    const d: BleDeviceInfo = { id: 'x', name: 'B1-1', serviceUuids: [NIIMBOT_SERVICE] }
    expect(FAMILY_OF(d.name, d.serviceUuids)).toBe('NIIMBOT')
  })
})
