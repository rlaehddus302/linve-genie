// PRN2 프린터 지원 단계 (AC-PRN2-01~05·11, LABEL_RULES L-7·L-11 10·13·L-12, D-PRN2-01~05·07·08).
// 켠 프로필 표 하나·단계·고르기 목록(앱·웹 공용 함수)·Luck Jingle 바이트와 OK 끝 알림·ff03 없는 꾸러미 A·NIIMBOT 모델 확인·웹 한 목록 어댑터·
// server·web이 쓰는 도우미(크기 목록·단계·출력 기기 프로필 ID). 실물 프린터 없이 가짜 기기와 손으로 돌리는 타이머로 돈다.
import { createBitmap, setPixel, type LabelBitmap } from '@livejjim/label'
import { modelsLibrary } from '@mmote/niimbluelib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  B1_PROFILE,
  BAUATO_PPA2L,
  ENABLED_PROFILES,
  LABEL_PROFILES,
  MARKLIFE_MESSAGES,
  MARKLIFE_P12,
  MARKLIFE_S2,
  NIIMBOT_B1_SE,
  NIIMBOT_B21,
  NIIMBOT_D110,
  NIIMBOT_PROFILES,
  PRINTER_MESSAGES,
  PRINTER_PROFILES,
  buildPrintJob,
  connectedProfileId,
  createB1Adapter,
  createFakeBluetooth,
  createFakeNiimbotBluetooth,
  createFakePrinter,
  createMarklifeAdapter,
  createNiimbotAdapter,
  createWebPrinterAdapter,
  experimentalNotice,
  labelSizesForProfileId,
  pickListFilter,
  pickListTarget,
  printerProfile,
  printerRequestOptions,
  printerSupportStage,
  profileSupportsSize,
  type FakeBluetoothOptions,
  type ModelProfile,
  type NiimbotProfile,
  type WebPrinterEnvironment,
} from '../src/index.ts'
import { FakeNiimbotClient, ManualTimer, flush, sampleImage } from './fakes.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

const NIIMBOT_SERVICE = 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'

function border(width: number, height: number): LabelBitmap {
  const image = createBitmap(width, height)
  for (let x = 0; x < width; x++) {
    setPixel(image, x, 0, true)
    setPixel(image, x, height - 1, true)
  }
  for (let y = 0; y < height; y++) {
    setPixel(image, 0, y, true)
    setPixel(image, width - 1, y, true)
  }
  return image
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function runUntil(timer: ManualTimer, done: () => boolean, stepMs = 30, maxMs = 120_000): Promise<void> {
  for (let t = 0; t < maxMs && !done(); t += stepMs) await timer.advance(stepMs)
}

function track<T>(promise: Promise<T>): { promise: Promise<T>; done: () => boolean } {
  let done = false
  void promise.then(() => {
    done = true
  })
  return { promise, done: () => done }
}

describe('켠 프로필 표 하나와 지원 단계 (AC-PRN2-01, D-PRN2-01·05·08)', () => {
  it('표 = NIIMBOT 4 + Marklife 9 + 바우아토, 확인됨은 B1 하나, 나머지는 모두 실험', () => {
    expect(PRINTER_PROFILES.map((p) => p.id)).toEqual([
      'NIIMBOT_B1',
      'NIIMBOT_B1_SE',
      'NIIMBOT_B21',
      'NIIMBOT_D110',
      'MARKLIFE_P50',
      'MARKLIFE_S2',
      'MARKLIFE_X2',
      'MARKLIFE_P11',
      'MARKLIFE_P12',
      'MARKLIFE_P15',
      'MARKLIFE_L13',
      'MARKLIFE_LP90',
      'MARKLIFE_LP15',
      'BAUATO_PPA2L',
    ])
    expect(PRINTER_PROFILES.filter((p) => !p.experimental)).toEqual([B1_PROFILE])
    expect(new Set(PRINTER_PROFILES.map((p) => p.id)).size).toBe(PRINTER_PROFILES.length)
    expect(ENABLED_PROFILES).toBe(NIIMBOT_PROFILES)
    expect(LABEL_PROFILES.at(-1)).toBe(BAUATO_PPA2L)
    for (const p of PRINTER_PROFILES) expect(Object.isFrozen(p), p.id).toBe(true)
  })

  it('NIIMBOT 줄은 niimbluelib 0.47.1 모델 표 그대로다 (dpi·방향·헤드·농도 — D-PRN2-05)', () => {
    for (const p of NIIMBOT_PROFILES) {
      const meta = modelsLibrary.find((m) => m.model === p.model)
      expect(meta, p.model).toBeDefined()
      expect(p.dpi, p.id).toBe(meta?.dpi)
      expect(p.printDirection, p.id).toBe(meta?.printDirection)
      expect(p.headDots, p.id).toBe(meta?.printheadPixels)
      expect([p.density.min, p.density.max, p.density.default], p.id).toEqual([meta?.densityMin, meta?.densityMax, meta?.densityDefault])
      // 돌림·마지막 흰 줄은 방향에서 나온다 (left = 시계 방향 90도·흰 줄 없음)
      expect(p.rotate, p.id).toBe(p.printDirection === 'left' ? 'CW90' : 'NONE')
      expect(p.extraBlankRows, p.id).toBe(p.printDirection === 'left' ? 0 : 1)
    }
    expect([NIIMBOT_B1_SE.printTask, NIIMBOT_B21.printTask, NIIMBOT_D110.printTask]).toEqual(['B1', 'B21_V1', 'D110'])
  })
})

describe('고르기 목록 — 앱·웹 같은 함수 (AC-PRN2-04, D-PRN2-04)', () => {
  it('이름 첫 글자 거르기가 없다 — 모델 이름 첫 글자만 같은 기기는 목록에 없다', () => {
    for (const name of ['B', 'Buds', 'D', 'Dell Mouse', 'M110', 'AirPods', 'P12', 'S2', 'T9-1', 'Z1']) expect(pickListTarget(name, []), name).toBeNull()
  })

  it('찾기 거르기 = NIIMBOT 서비스 · 켠 NIIMBOT 이름 꼴 · L-12 앞자리 (표에서 나온다)', () => {
    expect(pickListFilter()).toEqual({
      serviceUuids: [NIIMBOT_SERVICE],
      niimbotNamePrefixes: ['B1-', 'B1_', 'B1_SE-', 'B1_SE_', 'B21-', 'B21_', 'D110-', 'D110_'],
      labelNamePrefixes: ['P50_', 'S2_', 'X2_', 'P11_', 'P12_', 'P15_', 'L13_', 'LP90_', 'LP15_', 'PPA2'],
    })
  })

  it('웹 고르기 창은 requestDevice 하나 — filters = 서비스 + 이름 꼴 + L-12 앞자리, optionalServices = ff00·fd00', () => {
    const options = printerRequestOptions()
    expect(options.filters[0]).toEqual({ services: [NIIMBOT_SERVICE] })
    expect(options.filters.slice(1)).toEqual([...pickListFilter().niimbotNamePrefixes, ...pickListFilter().labelNamePrefixes].map((namePrefix) => ({ namePrefix })))
    expect(options.optionalServices).toEqual(['0000ff00-0000-1000-8000-00805f9b34fb', '0000fd00-0000-1000-8000-00805f9b34fb'])
  })

  it('켠 표에 한 줄을 더하는 것만으로 목록 판정이 따라간다 — 코드 분기 없음 (AC-PRN2-11)', () => {
    const T9: ModelProfile = { ...MARKLIFE_P12, id: 'TEST_T9', namePrefix: 'T9_' }
    const N9: NiimbotProfile = { ...NIIMBOT_B21, id: 'TEST_N9', model: 'N9' }
    const table = [...PRINTER_PROFILES, T9, N9]
    expect(pickListTarget('T9_0001', [], PRINTER_PROFILES)).toBeNull()
    expect(pickListTarget('T9_0001', [], table)).toBe('TEST_T9')
    expect(pickListTarget('N9-0001', [], PRINTER_PROFILES)).toBeNull()
    expect(pickListTarget('N9-0001', [], table)).toBe('NIIMBOT')
    expect(pickListFilter(table).labelNamePrefixes).toContain('T9_')
    expect(pickListFilter(table).niimbotNamePrefixes).toContain('N9_')
    // NIIMBOT 줄이 하나도 없으면 서비스 광고만으로는 목록에 없다
    expect(pickListTarget(null, [NIIMBOT_SERVICE], LABEL_PROFILES)).toBeNull()
  })

  it('입력이 이상해도 던지지 않는다 (이름이 글이 아님·서비스 목록에 글이 아닌 것)', () => {
    expect(pickListTarget(42, [null, 7, NIIMBOT_SERVICE.toUpperCase()])).toBe('NIIMBOT')
    expect(pickListTarget(undefined, 'x' as unknown as string[])).toBeNull()
  })
})

describe('바우아토 Luck Jingle 바이트 · 끝 알림 · ff03 없는 꾸러미 A (AC-PRN2-02·03, D-PRN2-02·03)', () => {
  function setup(fakeOptions: FakeBluetoothOptions, profiles: readonly ModelProfile[] = LABEL_PROFILES) {
    const timer = new ManualTimer()
    const fake = createFakeBluetooth({ timer, ...fakeOptions })
    const adapter = createMarklifeAdapter({ environment: () => fake.environment, timer, profiles })
    return { timer, fake, adapter }
  }

  it('바우아토: 가짜 기기가 받은 조각을 이어 붙이면 작업 바이트 함수와 같고, OK(4F 4B) 끝 알림으로 출력 OK', async () => {
    const { timer, fake, adapter } = setup({ name: 'PPA2L_1234', ack: 'ok' })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    expect(adapter.profile).toBe(BAUATO_PPA2L)
    const image = border(384, 240)
    const p = track(adapter.print(image, { density: 3 }))
    await runUntil(timer, p.done)
    expect(await p.promise).toEqual({ ok: true })
    const job = buildPrintJob(BAUATO_PPA2L, image)
    if (!job.ok) throw new Error('바이트 없음')
    expect(Array.from(concat(fake.packets))).toEqual(Array.from(job.bytes))
    expect(fake.attempts.map((a) => [a.complete, a.acked])).toEqual([[true, true]])
    expect(fake.printed).toHaveLength(1)
    // 농도를 넘겨도 농도 명령이 없다 — 받은 바이트가 농도 없이 만든 바이트와 같다
    expect(Array.from(job.bytes.subarray(0, 4))).toEqual([0x10, 0xff, 0xf1, 0x03])
  })

  it('Marklife는 OK를 끝으로 세지 않는다 — OK만 오면 20초 뒤 TIMEOUT (안 찍힌 라벨을 찍힌 것으로 기록하지 않는다)', async () => {
    const { timer, fake, adapter } = setup({ name: 'S2_ABCD', ack: 'ok' })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    const p = track(adapter.print(border(384, 240)))
    await runUntil(timer, p.done, 1000)
    expect(await p.promise).toEqual({ ok: false, error: { code: 'TIMEOUT', message: MARKLIFE_MESSAGES.TIMEOUT } })
    expect(fake.attempts[0]?.complete).toBe(true)
    expect(fake.attempts[0]?.acked).toBe(false)
  })

  it('Marklife 출력 중 첫 조각 뒤 OK가 와도 끝이 아니다 — 끝까지 보내고 AA로 끝난다', async () => {
    const { timer, fake, adapter } = setup({ name: 'P12_ZA15B', ack: 'hold' })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    const p = track(adapter.print(border(320, 96)))
    await timer.advance(30)
    fake.sendNotify([0x4f, 0x4b])
    await runUntil(timer, () => fake.attempts[0]?.complete === true)
    expect(p.done()).toBe(false)
    fake.releaseAck()
    await flush()
    expect(await p.promise).toEqual({ ok: true })
    const job = buildPrintJob(MARKLIFE_P12, border(320, 96))
    if (!job.ok) throw new Error('바이트 없음')
    expect(Array.from(concat(fake.packets))).toEqual(Array.from(job.bytes))
  })

  it('바우아토도 다른 꼴(ok·OK+줄바꿈·AA AA)은 끝이 아니다 — TIMEOUT', async () => {
    for (const bytes of [
      [0x6f, 0x6b],
      [0x4f, 0x4b, 0x0d, 0x0a],
      [0xaa, 0xaa],
    ]) {
      const { timer, adapter } = setup({ name: 'PPA2L_1', ack: { bytes } })
      expect((await adapter.connect('bluetooth')).ok).toBe(true)
      const p = track(adapter.print(border(384, 120)))
      await runUntil(timer, p.done, 1000)
      expect((await p.promise).ok, bytes.join()).toBe(false)
    }
  })

  it('꾸러미 A에 ff03이 없으면 크레딧 없이 끝까지 보낸다 — 조각 사이 30ms만 쉰다 (D-PRN2-03)', async () => {
    const { timer, fake, adapter } = setup({ name: 'S2_ABCD', missingCharacteristics: ['ff03'], initialCredits: null, creditsPerPacket: 0 })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    expect(adapter.bundle).toBe('A')
    expect(fake.notifying).toEqual(['ff01'])
    const image = border(384, 240)
    const p = track(adapter.print(image))
    await runUntil(timer, p.done)
    expect(await p.promise).toEqual({ ok: true })
    const job = buildPrintJob(MARKLIFE_S2, image)
    if (!job.ok) throw new Error('바이트 없음')
    expect(Array.from(concat(fake.packets))).toEqual(Array.from(job.bytes))
    // 크레딧 기다림(1초)이 없다: 마지막 조각은 (조각 수 − 1) × 30ms
    expect(timer.now).toBe((fake.packets.length - 1) * 30)
  })

  it('쓰기·알림 특성이 없는 꾸러미 A는 여전히 꾸러미가 아니다 — C도 없으면 WRONG_MODEL', async () => {
    const { adapter } = setup({ name: 'S2_ABCD', missingCharacteristics: ['ff02'] })
    expect(await adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL' } })
  })
})

describe('NIIMBOT 모델 확인 (AC-PRN2-05, D-PRN2-05)', () => {
  const ENV = { bluetooth: { requestDevice: () => Promise.resolve({ id: 'd1', name: 'B1-0001' }), getAvailability: () => Promise.resolve(true) } }

  it('켠 모델(B1·B1 SE·B21·D110)이면 그 프로필로 쓰고 단계·크기·농도를 따른다', async () => {
    for (const [model, profile] of [
      ['B1', B1_PROFILE],
      ['B1_SE', NIIMBOT_B1_SE],
      ['B21', NIIMBOT_B21],
      ['D110', NIIMBOT_D110],
    ] as const) {
      const client = new FakeNiimbotClient()
      client.model = model
      const adapter = createB1Adapter({ environment: () => ENV, createClient: () => client })
      expect(await adapter.connect('bluetooth'), model).toEqual({ ok: true })
      expect(adapter.profile).toBe(profile)
      expect(connectedProfileId(adapter)).toBe(profile.id)
      await adapter.disconnect()
    }
  })

  it('D110: 인쇄 방식 D110·기본 농도 2·테이프 그림(320×96)을 돌려 보내고, 농도 4는 1~3 문장으로 거절', async () => {
    const client = new FakeNiimbotClient()
    client.model = 'D110'
    const adapter = createB1Adapter({ environment: () => ENV, createClient: () => client })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    expect(await adapter.print(sampleImage(1, 320, 96))).toEqual({ ok: true })
    expect(client.tasks.at(-1)?.name).toBe('D110')
    expect(client.tasks.at(-1)?.options.density).toBe(2)
    expect(await adapter.print(sampleImage(1, 320, 96), { density: 4 })).toEqual({
      ok: false,
      error: { code: 'INVALID_DENSITY', message: '인쇄 농도는 1~3 사이의 정수로 정해 주세요.' },
    })
    // 받은 그림의 높이가 96점 헤드보다 크면 보내지 않는다 (50×30 그림은 D110에 맞지 않는다)
    expect(await adapter.print(sampleImage(1, 384, 240))).toMatchObject({ ok: false, error: { code: 'IMAGE_TOO_WIDE' } })
  })

  it('B1 Pro·B21 Pro·D110_M·B21S·모름은 끊고 WRONG_MODEL — 문장이 그림 파일 경로를 알린다', async () => {
    for (const model of ['B1_PRO', 'B21_PRO', 'D110_M', 'B21S', undefined]) {
      const client = new FakeNiimbotClient()
      client.model = model
      const adapter = createB1Adapter({ environment: () => ENV, createClient: () => client })
      const r = await adapter.connect('bluetooth')
      expect(r, String(model)).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL', message: PRINTER_MESSAGES.WRONG_MODEL } })
      expect(PRINTER_MESSAGES.WRONG_MODEL).toContain('그림 파일로 저장해 NIIMBOT 앱에서 인쇄')
      expect(client.connected).toBe(false)
      expect(adapter.state).toBe('DISCONNECTED')
      expect(adapter.hasRemembered).toBe(false)
    }
  })

  it('NIIMBOT 고르기 창에서 L-12 이름의 기기를 고르면(빼기를 모르는 브라우저) 연결하지 않고 WRONG_MODEL', async () => {
    const client = new FakeNiimbotClient()
    const env = { bluetooth: { requestDevice: () => Promise.resolve({ id: 'm1', name: 'P12_ZA15B' }), getAvailability: () => Promise.resolve(false) } }
    const adapter = createNiimbotAdapter({ environment: () => env, createClient: () => client })
    // 블루투스가 꺼졌다고 했어도 기기를 골랐으니 WRONG_MODEL 그대로 (D-QS1-11)
    expect(await adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL' } })
    expect(client.connected).toBe(false)
  })
})

describe('웹 한 목록 어댑터 — requestDevice 하나로 NIIMBOT·L-12를 가른다 (AC-PRN2-04, L-7)', () => {
  function rig(pick: 'ml' | 'nb' | 'cancel', mlOptions: FakeBluetoothOptions = {}) {
    const timer = new ManualTimer()
    const ml = createFakeBluetooth({ timer, name: 'P12_ZA15B', ...mlOptions })
    const nb = createFakeNiimbotBluetooth({ timer })
    let choice = pick
    let available = true
    const requests: unknown[] = []
    const environment = (): WebPrinterEnvironment => ({
      bluetooth: {
        requestDevice: (options: unknown) => {
          requests.push(options)
          if (choice === 'cancel') return Promise.reject(Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' }))
          return choice === 'ml' ? ml.bluetooth.requestDevice(options as never) : (nb.environment.bluetooth?.requestDevice as () => Promise<unknown>)()
        },
        getAvailability: () => Promise.resolve(available),
      },
      serial: { requestPort: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' })) },
      userAgent: 'Chrome',
      maxTouchPoints: 0,
    })
    const adapter = createWebPrinterAdapter({ environment, createClient: nb.createClient, timer, marklife: { packetIntervalMs: 0 } })
    return {
      timer,
      ml,
      nb,
      adapter,
      requests,
      choose: (next: 'ml' | 'nb' | 'cancel') => {
        choice = next
      },
      setAvailable: (v: boolean) => {
        available = v
      },
    }
  }

  it('고르기 창은 한 번, 인자는 printerRequestOptions — Marklife 이름이면 Marklife로 잇고 프로필 ID를 알린다', async () => {
    const { adapter, requests, ml, timer } = rig('ml')
    expect(adapter.state).toBe('DISCONNECTED')
    expect(adapter.profileId).toBeNull()
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(requests).toEqual([printerRequestOptions()])
    expect(adapter.kind).toBe('LABEL')
    expect(adapter.profileId).toBe('MARKLIFE_P12')
    expect(adapter.state).toBe('CONNECTED')
    const p = track(adapter.print(border(320, 96)))
    await runUntil(timer, p.done)
    expect(await p.promise).toEqual({ ok: true })
    expect(ml.printed).toHaveLength(1)
    await adapter.disconnect()
    expect(adapter.profileId).toBeNull()
  })

  it('NIIMBOT 기기면 NIIMBOT 어댑터로 — 고른 기기를 넘겨 고르기 창을 다시 띄우지 않고, 기억한다', async () => {
    const { adapter, requests, nb } = rig('nb')
    const remembered: unknown[] = []
    adapter.onRememberedChange((v) => remembered.push(v))
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(requests).toHaveLength(1)
    expect(nb.authorizedDevices).toEqual([nb.device])
    expect(adapter.kind).toBe('NIIMBOT')
    expect(adapter.profileId).toBe('NIIMBOT_B1')
    expect(adapter.hasRemembered).toBe(true)
    expect(remembered).toEqual([{ method: 'bluetooth', deviceId: 'fake-b1-01' }])
    expect(await adapter.print(sampleImage())).toEqual({ ok: true })
    expect(nb.printed).toHaveLength(1)
  })

  it('L-12 프린터가 마지막으로 이어지면 NIIMBOT 기억을 지운다 (기억 = 마지막으로 연결에 성공한 프린터)', async () => {
    const r = rig('nb')
    const remembered: unknown[] = []
    r.adapter.onRememberedChange((v) => remembered.push(v))
    expect((await r.adapter.connect('bluetooth')).ok).toBe(true)
    await r.adapter.disconnect()
    r.choose('ml')
    expect((await r.adapter.connect('bluetooth')).ok).toBe(true)
    expect(r.adapter.kind).toBe('LABEL')
    expect(r.adapter.hasRemembered).toBe(false)
    expect(remembered.at(-1)).toBeNull()
    // 저절로 다시 잇기는 기억이 없어 시도하지 않는다
    await r.adapter.disconnect()
    expect(await r.adapter.connectRemembered()).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
  })

  it('창을 닫으면 NOT_SELECTED, 블루투스가 꺼졌다고 했는데 실패하면 BLUETOOTH_OFF, 연결 상태는 끊김', async () => {
    const r = rig('cancel')
    const states: string[] = []
    r.adapter.onStateChange((s) => states.push(s))
    expect(await r.adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'NOT_SELECTED', message: PRINTER_MESSAGES.NOT_SELECTED } })
    expect(states).toEqual(['CONNECTING', 'DISCONNECTED'])
    r.setAvailable(false)
    expect(await r.adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'BLUETOOTH_OFF' } })
  })

  it('USB는 NIIMBOT 어댑터 그대로 · 블루투스가 없는 브라우저는 UNSUPPORTED', async () => {
    const r = rig('nb')
    expect(r.adapter.availableMethods()).toEqual(['bluetooth', 'serial'])
    expect(await r.adapter.connect('serial')).toMatchObject({ ok: false, error: { code: 'NOT_SELECTED' } })
    expect(r.adapter.kind).toBe('NIIMBOT')
    const none = createWebPrinterAdapter({ environment: () => ({}) })
    expect(none.availableMethods()).toEqual([])
    expect(await none.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } })
  })

  it('import·만들기만으로는 navigator를 읽지 않는다', () => {
    let reads = 0
    vi.stubGlobal(
      'navigator',
      new Proxy(
        {},
        {
          get: () => {
            reads++
            return undefined
          },
        },
      ),
    )
    createWebPrinterAdapter()
    expect(reads).toBe(0)
    vi.unstubAllGlobals()
  })
})

describe('server·web이 쓰는 도우미 (AC-PRN2-08, L-1·L-11 10·13, D-PRN2-07)', () => {
  it('크기 목록: 그 프로필의 크기, 모르면 B1 목록', () => {
    expect(labelSizesForProfileId('NIIMBOT_D110')).toEqual(['tape12x40', 'tape15x30', 'tape15x50'])
    expect(labelSizesForProfileId('BAUATO_PPA2L')).toEqual(['50x30', '50x15', '50x50'])
    for (const unknown of [null, undefined, '', 'NIIMBOT_B1_PRO', 42]) expect(labelSizesForProfileId(unknown)).toEqual(['50x30', '50x20', '50x40'])
    expect(profileSupportsSize('NIIMBOT_D110', '50x30')).toBe(false)
    expect(profileSupportsSize(null, '50x30')).toBe(true)
    expect(profileSupportsSize('MARKLIFE_P50', '50x50')).toBe(true)
  })

  it('단계: B1 확인됨 · 표의 나머지 실험 · 표에 없으면 그림 파일로만', () => {
    expect(printerSupportStage('NIIMBOT_B1')).toBe('CONFIRMED')
    for (const p of PRINTER_PROFILES.filter((x) => x.id !== 'NIIMBOT_B1')) expect(printerSupportStage(p.id), p.id).toBe('EXPERIMENTAL')
    for (const id of ['NIIMBOT_B1_PRO', '', null, undefined]) expect(printerSupportStage(id)).toBe('IMAGE_ONLY')
  })

  it('실험 안내 한 줄은 L-7 문장 그대로 — {앱}은 프로필의 대체 경로 앱', () => {
    expect(experimentalNotice(BAUATO_PPA2L)).toBe('실험 중인 프린터예요. 테스트 인쇄가 잘 나오는지 꼭 확인해 주세요. 잘 안 나오면 라벨을 그림 파일로 Luck Jingle 앱에서 인쇄해 주세요.')
    expect(experimentalNotice(NIIMBOT_D110)).toContain('NIIMBOT 앱에서')
  })

  it('출력 기기가 알릴 프로필 ID: 연결됐을 때만, 표에 있는 ID만 (이름·기기 ID 없음)', async () => {
    const fake = createFakePrinter()
    expect(connectedProfileId(fake)).toBeNull()
    expect((await fake.connect('bluetooth')).ok).toBe(true)
    expect(connectedProfileId(fake)).toBe('NIIMBOT_B1')
    const odd = { ...B1_PROFILE, id: 'SOMETHING' }
    expect(connectedProfileId({ state: 'CONNECTED', profile: odd })).toBeNull()
    expect(connectedProfileId({ state: 'CONNECTED', profile: { displayName: 'x', dpi: 203, headDots: 384, density: null } })).toBeNull()
    await fake.disconnect()
    expect(connectedProfileId(fake)).toBeNull()
    expect(printerProfile('NIIMBOT_D110')).toBe(NIIMBOT_D110)
  })

  it('시험용 프린터는 켠 표의 어느 줄이든 흉내 낸다 — 실험 기종 ID를 알리고, 돌림 프로필은 높이를 헤드와 견준다, 농도 없는 프로필은 농도를 쓰지 않는다', async () => {
    const bauato = createFakePrinter({ profile: BAUATO_PPA2L })
    expect((await bauato.connect('bluetooth')).ok).toBe(true)
    expect(connectedProfileId(bauato)).toBe('BAUATO_PPA2L')
    expect(printerSupportStage(connectedProfileId(bauato))).toBe('EXPERIMENTAL')
    expect(await bauato.print(border(384, 240), { density: 9 })).toEqual({ ok: true })
    expect(bauato.printed[0]?.density).toBe(0)
    const d110 = createFakePrinter({ profile: NIIMBOT_D110 })
    expect((await d110.connect('bluetooth')).ok).toBe(true)
    expect(await d110.print(border(320, 96))).toEqual({ ok: true })
    expect(d110.printed[0]?.density).toBe(2)
    expect(await d110.print(border(384, 240))).toMatchObject({ ok: false, error: { code: 'IMAGE_TOO_WIDE' } })
    expect(await d110.print(border(320, 96), { density: 4 })).toEqual({ ok: false, error: { code: 'INVALID_DENSITY', message: '인쇄 농도는 1~3 사이의 정수로 정해 주세요.' } })
  })
})
