// Marklife·바우아토 어댑터 (AC-N1-03·30~34·40~42·50·55, LABEL_RULES L-12 3~7, D-N1-04~08) — 가짜 Web Bluetooth 기기와 손으로 돌리는 타이머로 돈다.
import { createBitmap, defaultTemplate, renderProductLabel, setPixel, type LabelBitmap } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BAUATO_PPA2L,
  EXPERIMENTAL_PROFILES,
  MARKLIFE_DEFAULTS,
  MARKLIFE_MESSAGES,
  MARKLIFE_P12,
  MARKLIFE_PROFILES,
  MARKLIFE_S2,
  PRINTER_MESSAGES,
  buildPrintJob,
  createFakeBluetooth,
  createMarklifeAdapter,
  unsupportedMessage,
  type ConnectionState,
  type FakeBluetoothOptions,
  type MarklifeAdapterOptions,
  type ModelProfile,
} from '../src/index.ts'
import { ManualTimer, decodeMarklifeJob, flush } from './fakes.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const SERVICE_A = '0000ff00-0000-1000-8000-00805f9b34fb'
const SERVICE_C = '0000fd00-0000-1000-8000-00805f9b34fb'

function setup(fakeOptions: FakeBluetoothOptions = {}, adapterOptions: MarklifeAdapterOptions = {}) {
  const timer = new ManualTimer()
  const fake = createFakeBluetooth({ timer, ...fakeOptions })
  const adapter = createMarklifeAdapter({ environment: () => fake.environment, timer, ...adapterOptions })
  const states: ConnectionState[] = []
  adapter.onStateChange((s) => states.push(s))
  return { timer, fake, adapter, states }
}

/** 50×30 테두리 그림 (384×240) */
function border(width = 384, height = 240): LabelBitmap {
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

/** 압축이 잘 안 되는 그림 — 조각이 많이 나온다 */
function noisy(width: number, height: number, seed = 7): LabelBitmap {
  const image = createBitmap(width, height)
  let v = seed
  for (let i = 0; i < image.data.length; i++) {
    v = (v * 1103515245 + 12345) & 0x7fffffff
    image.data[i] = v >>> 16
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

const jobBytes = (profile: ModelProfile, image: LabelBitmap): Uint8Array => {
  const job = buildPrintJob(profile, image)
  if (!job.ok) throw new Error(job.code)
  return job.bytes
}

/** 출력이 끝날 때까지 타이머를 30ms씩 돌린다 */
async function runUntil(timer: ManualTimer, settled: () => boolean, stepMs = 30, maxMs = 60_000): Promise<void> {
  for (let t = 0; t < maxMs && !settled(); t += stepMs) await timer.advance(stepMs)
}

function track<T>(promise: Promise<T>): { promise: Promise<T>; done: () => boolean } {
  let done = false
  void promise.then(() => {
    done = true
  })
  return { promise, done: () => done }
}

describe('프로필 목록과 표 한 줄로 더하기 (AC-N1-03)', () => {
  it('Marklife 기본 목록은 9종(표 순서, 바우아토 없음), 실험 목록은 바우아토 하나', () => {
    expect(MARKLIFE_PROFILES.map((p) => p.id)).toEqual([
      'MARKLIFE_P50',
      'MARKLIFE_S2',
      'MARKLIFE_X2',
      'MARKLIFE_P11',
      'MARKLIFE_P12',
      'MARKLIFE_P15',
      'MARKLIFE_L13',
      'MARKLIFE_LP90',
      'MARKLIFE_LP15',
    ])
    expect(EXPERIMENTAL_PROFILES.map((p) => p.id)).toEqual(['BAUATO_PPA2L'])
    expect(MARKLIFE_PROFILES.some((p) => p.experimental)).toBe(false)
    expect(createMarklifeAdapter({ environment: () => ({}) }).profile).toBe(MARKLIFE_PROFILES[0])
  })

  it('시험용 가짜 프로필(T9_, L11, 96점)을 목록에 더해 넘기는 것만으로 그 기기를 고르고 L11 바이트로 출력한다', async () => {
    const T9: ModelProfile = { ...MARKLIFE_P12, id: 'TEST_T9', displayName: '시험용 T9', namePrefix: 'T9_' }
    const plain = setup({ name: 'T9_0001' })
    expect(await plain.adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL' } })
    // 가짜 기기는 이름표에 없는 기기라 작업의 끝을 계산할 방식을 알려 준다
    const { fake, adapter, timer } = setup({ name: 'T9_0001', protocol: 'MARKLIFE_L11' }, { profiles: [...MARKLIFE_PROFILES, T9] })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    expect(adapter.profile).toBe(T9)
    expect(fake.requests[0]?.filters.map((f) => f.namePrefix)).toContain('T9_')
    const image = border(320, 96)
    const p = track(adapter.print(image))
    await runUntil(timer, p.done)
    expect(await p.promise).toEqual({ ok: true })
    expect(fake.printed).toHaveLength(1)
    expect(Array.from(fake.printed[0] ?? [])).toEqual(Array.from(jobBytes(MARKLIFE_P12, image)))
  })

  it('NIIMBOT 프로필이나 이름 앞자리가 없는 프로필은 Marklife 어댑터에 넣을 수 없다', () => {
    expect(() => createMarklifeAdapter({ profiles: [] })).toThrow()
    expect(() => createMarklifeAdapter({ profiles: [{ ...MARKLIFE_S2, protocol: 'NIIMBOT_B1' }] })).toThrow()
    expect(() => createMarklifeAdapter({ profiles: [{ ...MARKLIFE_S2, namePrefix: null }] })).toThrow()
  })
})

describe('Web Bluetooth만, 자동 연결 없음 (AC-N1-30)', () => {
  it('연결 방법: requestDevice가 있으면 [bluetooth], 없으면 [] — serial은 없다', () => {
    const { adapter } = setup()
    expect(adapter.availableMethods()).toEqual(['bluetooth'])
    expect(createMarklifeAdapter({ environment: () => ({ bluetooth: {} }) }).availableMethods()).toEqual([])
    expect(createMarklifeAdapter({ environment: () => ({}) }).availableMethods()).toEqual([])
    expect(createMarklifeAdapter({ profiles: EXPERIMENTAL_PROFILES, environment: () => ({ bluetooth: null }) }).availableMethods()).toEqual([])
  })

  it('패키지를 import하거나 어댑터를 만들기만 해서는 navigator를 읽지 않는다 — 연결은 부르는 쪽이 부를 때만', async () => {
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
    vi.resetModules()
    const mod = await import('../src/index.ts')
    const adapter = mod.createMarklifeAdapter()
    expect(reads).toBe(0)
    expect(adapter.state).toBe('DISCONNECTED')
    expect(adapter.availableMethods()).toEqual([])
    expect(reads).toBeGreaterThan(0)
  })

  it('만든 뒤 연결을 부르지 않으면 고르기 창을 열지 않는다', async () => {
    const { fake, adapter } = setup()
    await flush()
    expect(fake.requests).toHaveLength(0)
    expect(adapter.state).toBe('DISCONNECTED')
  })
})

describe('기기 고르기 창과 이름으로 고르기 (AC-N1-31·55)', () => {
  it('requestDevice를 한 번: 켠 프로필의 이름 앞자리마다 namePrefix 하나, 함께 쓸 서비스 ff00·fd00, acceptAllDevices 없음', async () => {
    const { fake, adapter, states } = setup({ name: 'P12_ZA15B_BLE' })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    expect(fake.requests).toHaveLength(1)
    const request = fake.requests[0]
    expect(request?.filters).toEqual(['P50_', 'S2_', 'X2_', 'P11_', 'P12_', 'P15_', 'L13_', 'LP90_', 'LP15_'].map((namePrefix) => ({ namePrefix })))
    expect(request?.optionalServices).toEqual([SERVICE_A, SERVICE_C])
    expect(Object.keys(request ?? {}).sort()).toEqual(['filters', 'optionalServices'])
    expect(adapter.profile).toBe(MARKLIFE_P12)
    expect(states).toEqual(['CONNECTING', 'CONNECTED'])
  })

  it('바우아토를 넘긴 어댑터는 거르기에 PPA2가 있고 바우아토를 고른다', async () => {
    const { fake, adapter } = setup({ name: 'PPA2L_1234' }, { profiles: [...MARKLIFE_PROFILES, ...EXPERIMENTAL_PROFILES] })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    expect(fake.requests[0]?.filters.at(-1)).toEqual({ namePrefix: 'PPA2' })
    expect(adapter.profile).toBe(BAUATO_PPA2L)
  })

  it('기본 목록 어댑터는 PPA2를 거르기에 넣지 않고(고르기 창에 안 보인다), 골라도 WRONG_MODEL', async () => {
    const hidden = setup({ name: 'PPA2L_1234', respectFilters: true })
    expect(await hidden.adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'NOT_SELECTED' } })
    expect(hidden.fake.requests[0]?.filters.some((f) => f.namePrefix.startsWith('PPA2'))).toBe(false)
    const picked = setup({ name: 'PPA2L_1234' })
    const r = await picked.adapter.connect('bluetooth')
    expect(r).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL', message: '연결할 수 없는 프린터예요. 목록에 있는 프린터를 골라 주세요.' } })
    expect(picked.adapter.state).toBe('DISCONNECTED')
    expect(picked.fake.connectCount).toBe(0)
  })

  it('이름이 켠 프로필과 맞지 않으면(P12·P12 Pro·Phomemo P12·이름 없음) 연결하지 않고 WRONG_MODEL', async () => {
    for (const name of ['P12', 'P12 Pro', 'Phomemo P12', 'p12_za15b', ' P12_ZA15B', null]) {
      const { fake, adapter, states } = setup({ name })
      expect((await adapter.connect('bluetooth')).ok === false && adapter.state, String(name)).toBe('DISCONNECTED')
      expect(fake.connected).toBe(false)
      expect(states).toEqual(['CONNECTING', 'DISCONNECTED'])
    }
  })

  it('바우아토 프로필은 실험적, 대체 경로 Luck Jingle 앱, 크기 50×30·50×15·50×50, L11 바이트(돌림·농도 없음)이고 보내기·끝 알림은 Marklife와 같다', async () => {
    expect(BAUATO_PPA2L).toMatchObject({ experimental: true, fallbackApp: 'Luck Jingle 앱', sizes: ['50x30', '50x15', '50x50'], rotate: 'NONE', density: null, protocol: 'MARKLIFE_L11' })
    const { fake, adapter, timer } = setup({ name: 'PPA2L_9F3C' }, { profiles: EXPERIMENTAL_PROFILES })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    const image = border(384, 120)
    const p = track(adapter.print(image, { density: 3 }))
    await runUntil(timer, p.done)
    expect(await p.promise).toEqual({ ok: true })
    expect(Array.from(fake.printed[0] ?? [])).toEqual(Array.from(jobBytes(BAUATO_PPA2L, image)))
    expect(decodeMarklifeJob(fake.printed[0] as Uint8Array, BAUATO_PPA2L).data).toEqual(image.data)
  })
})

describe('GATT 꾸러미 찾기 (AC-N1-32)', () => {
  it('A만 있으면 A, C만 있으면 C, 둘 다 없으면 끊고 WRONG_MODEL·DISCONNECTED', async () => {
    const a = setup({ bundle: 'A' })
    expect((await a.adapter.connect('bluetooth')).ok).toBe(true)
    expect(a.adapter.bundle).toBe('A')
    expect(a.fake.notifying).toEqual(['ff01', 'ff03'])
    const c = setup({ bundle: 'C', name: 'X2_ABCD' })
    expect((await c.adapter.connect('bluetooth')).ok).toBe(true)
    expect(c.adapter.bundle).toBe('C')
    expect(c.fake.notifying).toEqual(['fd02'])
    const none = setup({ bundle: 'none' })
    expect(await none.adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL' } })
    expect(none.adapter.state).toBe('DISCONNECTED')
    expect(none.fake.connected).toBe(false)
    expect(none.adapter.bundle).toBeNull()
  })

  it('A의 쓰기 특성이 없고 C도 없으면 WRONG_MODEL', async () => {
    const { adapter, fake } = setup({ missingCharacteristics: ['ff02'] })
    expect(await adapter.connect('bluetooth')).toMatchObject({ ok: false, error: { code: 'WRONG_MODEL' } })
    expect(fake.connected).toBe(false)
  })

  it('꾸러미 A는 ff01·ff03 알림을 켜고, 연결 직후 온 첫 01 04를 놓치지 않는다 — 첫 출력에서 기다림 없이 조각 4개', async () => {
    const { adapter, fake, timer } = setup({ creditsPerPacket: 0, ack: 'none' })
    await adapter.connect('bluetooth')
    const p = track(adapter.print(noisy(384, 240)))
    await flush()
    expect(fake.packets).toHaveLength(1)
    await timer.advance(30 * 3)
    expect(fake.packets).toHaveLength(4)
    // 크레딧이 떨어지면 멈춘다 (1초 기다림 전)
    await timer.advance(500)
    expect(fake.packets).toHaveLength(4)
    await adapter.disconnect()
    expect(await p.promise).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
  })
})

describe('연결 실패와 문장 (AC-N1-33·34)', () => {
  it('고르기 창 닫기 NOT_SELECTED, 블루투스 꺼짐 BLUETOOTH_OFF, GATT 연결 실패 DISCONNECTED(+ 다시 연결)', async () => {
    const cancel = setup({ chooser: 'cancel' })
    expect(await cancel.adapter.connect('bluetooth')).toEqual({
      ok: false,
      error: { code: 'NOT_SELECTED', message: '프린터를 고르지 않았어요. 다시 연결을 누르고 목록에서 프린터를 골라 주세요.', detail: 'NotFoundError: User cancelled the requestDevice() chooser.' },
    })
    expect(cancel.states).toEqual(['CONNECTING', 'DISCONNECTED'])
    const off = setup({ available: false })
    expect(await off.adapter.connect('bluetooth')).toEqual({ ok: false, error: { code: 'BLUETOOTH_OFF', message: '블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 연결해 주세요.' } })
    expect(off.fake.requests).toHaveLength(0)
    const broken = setup({ connectFails: true })
    const r = await broken.adapter.connect('bluetooth')
    expect(r).toMatchObject({ ok: false, error: { code: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', action: '다시 연결' } })
    expect(broken.adapter.state).toBe('DISCONNECTED')
    // 다시 누르면 다시 연결된다
    broken.fake.setConnectFails(false)
    expect((await broken.adapter.connect('bluetooth')).ok).toBe(true)
  })

  it('L-12 6 표 전부를 글자로 대조한다 — 문장이 다른 것만 다르고 나머지는 L-7 표 그대로', () => {
    expect(MARKLIFE_MESSAGES).toEqual({
      UNSUPPORTED: '이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 Marklife 앱에서 인쇄해 주세요.',
      NOT_SELECTED: '프린터를 고르지 않았어요. 다시 연결을 누르고 목록에서 프린터를 골라 주세요.',
      BLUETOOTH_OFF: '블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 연결해 주세요.',
      WRONG_MODEL: '연결할 수 없는 프린터예요. 목록에 있는 프린터를 골라 주세요.',
      DISCONNECTED: '프린터 연결이 끊겼어요.',
      NOT_CONNECTED: '프린터를 먼저 연결해 주세요.',
      BUSY: '앞 라벨을 출력하는 중이에요. 끝난 뒤 다시 해 주세요.',
      IMAGE_TOO_WIDE: '라벨이 프린터보다 넓어요. 라벨 크기를 확인해 주세요.',
      TIMEOUT: '프린터가 응답하지 않아요. 프린터 전원과 라벨을 확인한 뒤 다시 시작해 주세요.',
      PRINT_FAILED: '라벨을 출력하지 못했어요. 프린터의 라벨과 덮개를 확인한 뒤 다시 시작해 주세요.',
      INVALID_DENSITY: '인쇄 농도는 1~3 사이의 정수로 정해 주세요.',
    })
    expect(Object.keys(MARKLIFE_MESSAGES)).not.toContain('PORT_BUSY')
    // B1 어댑터의 문장(L-7 표)은 그대로
    expect(PRINTER_MESSAGES.NOT_SELECTED).toBe('프린터를 고르지 않았어요. 다시 연결을 누르고 목록에서 B1을 골라 주세요.')
    expect(PRINTER_MESSAGES.WRONG_MODEL).toBe('지금은 NIIMBOT B1만 연결할 수 있어요. B1을 골라 주세요.')
    expect(PRINTER_MESSAGES.INVALID_DENSITY).toBe('인쇄 농도는 1~5 사이의 정수로 정해 주세요.')
  })

  it('YXQ 농도 밖은 INVALID_DENSITY 문장(1~3)이고 가짜 기기 기록은 0조각', async () => {
    const { adapter, fake } = setup()
    await adapter.connect('bluetooth')
    for (const density of [0, 4, 1.5, Number.NaN]) {
      expect(await adapter.print(border(), { density })).toEqual({ ok: false, error: { code: 'INVALID_DENSITY', message: '인쇄 농도는 1~3 사이의 정수로 정해 주세요.' } })
    }
    expect(fake.packets).toHaveLength(0)
    expect(adapter.state).toBe('CONNECTED')
  })

  it('작업 바이트를 만들지 않는 경우(헤드보다 넓음·L-1 형식 아님)는 아무것도 보내지 않고 같은 코드', async () => {
    const { adapter, fake } = setup({ name: 'P12_1' })
    await adapter.connect('bluetooth')
    expect(await adapter.print(border(384, 240))).toMatchObject({ ok: false, error: { code: 'IMAGE_TOO_WIDE', message: '라벨이 프린터보다 넓어요. 라벨 크기를 확인해 주세요.' } })
    expect(await adapter.print({ width: 320, height: 96, data: new Uint8Array(3) })).toMatchObject({ ok: false, error: { code: 'PRINT_FAILED' } })
    expect(await adapter.print({ width: 0, height: 96, data: new Uint8Array(0) })).toMatchObject({ ok: false, error: { code: 'PRINT_FAILED' } })
    expect(fake.packets).toHaveLength(0)
    expect(adapter.state).toBe('CONNECTED')
  })

  it('연결 중 다시 누르면 같은 연결을 기다리고, 연결 중 연결 끊기를 누르면 연결이 끝나도 붙지 않는다', async () => {
    const { adapter, fake } = setup()
    const a = adapter.connect('bluetooth')
    const b = adapter.connect('bluetooth')
    expect(b).toBe(a)
    expect((await a).ok).toBe(true)
    expect(fake.requests).toHaveLength(1)
    await adapter.disconnect()
    const c = adapter.connect('bluetooth')
    await adapter.disconnect()
    const r = await c
    expect(r).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
    expect(adapter.state).toBe('DISCONNECTED')
    expect(fake.connected).toBe(false)
    expect((await adapter.print(border())).ok).toBe(false)
  })

  it('블루투스가 없는 환경으로 연결하면 UNSUPPORTED — 까닭(사용자 에이전트)과 프로필의 대체 경로 앱으로 만든 문장', async () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.0'
    const kakao = 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.86 Mobile Safari/537.36;KAKAOTALK 2410800'
    const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'
    const cases = [
      [iphone, 0, MARKLIFE_PROFILES, '아이폰·아이패드에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 Marklife 앱에서 인쇄해 주세요.'],
      [kakao, 5, MARKLIFE_PROFILES, '카카오톡·인스타그램 같은 앱 안에서 연 화면에서는 프린터에 바로 연결할 수 없어요. 크롬에서 열거나, 라벨을 그림 파일로 저장해 Marklife 앱에서 인쇄해 주세요.'],
      [firefox, 0, MARKLIFE_PROFILES, '이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 Marklife 앱에서 인쇄해 주세요.'],
      [firefox, 0, EXPERIMENTAL_PROFILES, '이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 Luck Jingle 앱에서 인쇄해 주세요.'],
      [iphone, 0, EXPERIMENTAL_PROFILES, '아이폰·아이패드에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 Luck Jingle 앱에서 인쇄해 주세요.'],
    ] as const
    for (const [userAgent, maxTouchPoints, profiles, message] of cases) {
      const adapter = createMarklifeAdapter({ profiles, environment: () => ({ userAgent, maxTouchPoints }) })
      expect(adapter.availableMethods()).toEqual([])
      expect(await adapter.connect('bluetooth')).toEqual({ ok: false, error: { code: 'UNSUPPORTED', message } })
      expect(adapter.state).toBe('DISCONNECTED')
    }
  })

  it('까닭 문장 셋은 L-12 6과 글자까지 같고, OTHER + NIIMBOT 앱은 L-7 표의 UNSUPPORTED와 같다', () => {
    expect(unsupportedMessage('IOS', '{앱}')).toBe('아이폰·아이패드에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 {앱}에서 인쇄해 주세요.')
    expect(unsupportedMessage('IN_APP', '{앱}')).toBe('카카오톡·인스타그램 같은 앱 안에서 연 화면에서는 프린터에 바로 연결할 수 없어요. 크롬에서 열거나, 라벨을 그림 파일로 저장해 {앱}에서 인쇄해 주세요.')
    expect(unsupportedMessage('OTHER', '{앱}')).toBe('이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 {앱}에서 인쇄해 주세요.')
    expect(unsupportedMessage('OTHER', 'NIIMBOT 앱')).toBe(PRINTER_MESSAGES.UNSUPPORTED)
  })
})

describe('조각·간격·같은 바이트 (AC-N1-40)', () => {
  for (const [title, profile, name, image] of [
    ['50×30 테두리 그림을 S2로', MARKLIFE_S2, 'S2_1A2B', border()],
    ['테이프 12×40 그림을 P12로', MARKLIFE_P12, 'P12_ZA15B', border(320, 96)],
  ] as const) {
    it(`${title}: 조각은 90바이트 이하(마지막 빼고 정확히 90), 이어 붙이면 작업 바이트와 같다`, async () => {
      const { adapter, fake, timer } = setup({ name, initialCredits: 4, creditsPerPacket: 4 })
      await adapter.connect('bluetooth')
      const p = track(adapter.print(image))
      await runUntil(timer, p.done)
      expect(await p.promise).toEqual({ ok: true })
      const expected = jobBytes(profile, image)
      expect(fake.packets.length).toBe(Math.ceil(expected.length / 90))
      fake.packets.forEach((packet, i) => {
        if (i < fake.packets.length - 1) expect(packet.length).toBe(90)
        else expect(packet.length).toBeLessThanOrEqual(90)
      })
      expect(Array.from(concat(fake.packets))).toEqual(Array.from(expected))
      expect(fake.attempts).toHaveLength(1)
      expect(Array.from(fake.printed[0] ?? [])).toEqual(Array.from(expected))
      expect(timer.pending).toBe(0)
    })
  }

  it('조각 사이 간격은 주입한 타이머로 30ms — 타이머를 돌리지 않으면 두 번째 조각이 나가지 않는다', async () => {
    const { adapter, fake, timer } = setup({ creditsPerPacket: 4 })
    await adapter.connect('bluetooth')
    void adapter.print(noisy(384, 240))
    await flush()
    expect(fake.packets).toHaveLength(1)
    await flush(200)
    expect(fake.packets).toHaveLength(1)
    await timer.advance(29)
    expect(fake.packets).toHaveLength(1)
    await timer.advance(1)
    expect(fake.packets).toHaveLength(2)
    await timer.advance(30)
    expect(fake.packets).toHaveLength(3)
    await adapter.disconnect()
  })

  it('MTU 알림: 02 40 00(64) 뒤 조각은 61바이트 이하, 02 B3 00(179)이어도 90을 넘지 않는다, 02 03 00은 무시', async () => {
    const big = setup({ mtu: 179, creditsPerPacket: 4 })
    await big.adapter.connect('bluetooth')
    const p1 = track(big.adapter.print(noisy(384, 60)))
    await runUntil(big.timer, p1.done)
    expect((await p1.promise).ok).toBe(true)
    expect(Math.max(...big.fake.packets.map((x) => x.length))).toBe(90)

    const tiny = setup({ mtu: 3, creditsPerPacket: 4 })
    await tiny.adapter.connect('bluetooth')
    const p2 = track(tiny.adapter.print(noisy(384, 60)))
    await runUntil(tiny.timer, p2.done)
    expect(Math.max(...tiny.fake.packets.map((x) => x.length))).toBe(90)

    const { adapter, fake, timer } = setup({ creditsPerPacket: 4 })
    await adapter.connect('bluetooth')
    const image = noisy(384, 60)
    const p = track(adapter.print(image))
    await flush()
    await timer.advance(30)
    expect(fake.packets.map((x) => x.length)).toEqual([90, 90])
    fake.sendFlow([0x02, 0x40, 0x00])
    await runUntil(timer, p.done)
    expect((await p.promise).ok).toBe(true)
    const after = fake.packets.slice(2)
    expect(after.length).toBeGreaterThan(1)
    for (const packet of after) expect(packet.length).toBeLessThanOrEqual(61)
    expect(Array.from(concat(fake.packets))).toEqual(Array.from(jobBytes(MARKLIFE_S2, image)))
    // 다시 커져도 조각은 줄기만 한다
    const again = track(adapter.print(image))
    fake.sendFlow([0x02, 0xb3, 0x00])
    await runUntil(timer, again.done)
    expect((await again.promise).ok).toBe(true)
    for (const packet of fake.packets.slice(2)) expect(packet.length).toBeLessThanOrEqual(61)
  })
})

describe('흐름 제어 — 꾸러미 A (AC-N1-41)', () => {
  it('크레딧은 0에서 시작: 첫 알림 전에는 쓰지 않는다(1초까지), 1초가 지나면 하나', async () => {
    const { adapter, fake, timer } = setup({ initialCredits: null, creditsPerPacket: 0, ack: 'none' })
    await adapter.connect('bluetooth')
    void adapter.print(noisy(384, 240))
    await timer.advance(999)
    expect(fake.packets).toHaveLength(0)
    await timer.advance(1)
    expect(fake.packets).toHaveLength(1)
    await adapter.disconnect()
  })

  it('01 04를 받으면 4개 나가고 멈춘다, 01 01마다 하나 더, 01 09여도 한 번에 4개까지', async () => {
    const { adapter, fake, timer } = setup({ initialCredits: null, creditsPerPacket: 0, ack: 'none' })
    await adapter.connect('bluetooth')
    void adapter.print(noisy(384, 240))
    await timer.advance(100)
    fake.sendFlow([0x01, 0x04])
    await timer.advance(300)
    expect(fake.packets).toHaveLength(4)
    fake.sendFlow([0x01, 0x01])
    await timer.advance(300)
    expect(fake.packets).toHaveLength(5)
    fake.sendFlow([0x01, 0x09])
    await timer.advance(500)
    expect(fake.packets).toHaveLength(9)
    // 01 00은 크레딧이 아니다
    fake.sendFlow([0x01, 0x00])
    await timer.advance(500)
    expect(fake.packets).toHaveLength(9)
    await adapter.disconnect()
  })

  it('크레딧을 전혀 보내지 않으면 조각이 (30ms 쉼 + 1초)마다 하나씩, 끝 알림이 없으면 20초에 TIMEOUT', async () => {
    const { adapter, fake, timer } = setup({ initialCredits: null, creditsPerPacket: 0 })
    await adapter.connect('bluetooth')
    const p = track(adapter.print(noisy(384, 240)))
    await timer.advance(1000)
    expect(fake.packets).toHaveLength(1)
    await timer.advance(1029)
    expect(fake.packets).toHaveLength(1)
    await timer.advance(1)
    expect(fake.packets).toHaveLength(2)
    await timer.advance(20_000 - 2030 - 1)
    expect(p.done()).toBe(false)
    await timer.advance(1)
    expect(await p.promise).toEqual({ ok: false, error: { code: 'TIMEOUT', message: PRINTER_MESSAGES.TIMEOUT } })
    expect(adapter.state).toBe('CONNECTED')
    expect(timer.pending).toBe(0)
    const sent = fake.packets.length
    await timer.advance(5000)
    expect(fake.packets).toHaveLength(sent)
  })

  it('꾸러미 C는 크레딧을 기다리지 않고 간격만 지켜 보낸다', async () => {
    const { adapter, fake, timer } = setup({ bundle: 'C', name: 'X2_1', initialCredits: null, creditsPerPacket: 0 })
    await adapter.connect('bluetooth')
    const image = noisy(384, 40)
    const p = track(adapter.print(image))
    await flush()
    expect(fake.packets).toHaveLength(1)
    await timer.advance(30 * 5)
    expect(fake.packets).toHaveLength(6)
    await runUntil(timer, p.done)
    expect(await p.promise).toEqual({ ok: true })
    expect(Array.from(concat(fake.packets))).toEqual(Array.from(jobBytes(MARKLIFE_PROFILES[2] as ModelProfile, image)))
  })

  it('어떤 순간에도 보낸 조각 수 ≤ 받은 크레딧 합(상한 적용) + 1초 기다림으로 보낸 수', async () => {
    const { adapter, fake, timer } = setup({ initialCredits: 2, creditsPerPacket: 0, ack: 'none' })
    await adapter.connect('bluetooth')
    void adapter.print(noisy(384, 240))
    let granted = 2
    let waited = 0
    const credits = [3, 0, 7, 1, 0, 0, 2, 5]
    for (const n of credits) {
      const before = fake.packets.length
      await timer.advance(400)
      // 크레딧이 없어 1초를 기다렸다면 그 조각 하나
      if (fake.packets.length > before && granted <= before) waited++
      expect(fake.packets.length).toBeLessThanOrEqual(granted + waited + 1)
      fake.sendFlow([0x01, n])
      granted += Math.min(4, n)
    }
    await adapter.disconnect()
  })
})

describe('AA 끝 알림 — 라벨이 조용히 빠지지 않는다 (AC-N1-42)', () => {
  it('모든 조각을 쓰고 ff01로 AA를 받아야 OK, 마지막 조각 쓰기가 끝나기 전에 온 AA도 센다', async () => {
    const { adapter, fake, timer, states } = setup()
    await adapter.connect('bluetooth')
    states.length = 0
    const p = track(adapter.print(border()))
    await runUntil(timer, p.done)
    expect(await p.promise).toEqual({ ok: true })
    expect(states).toEqual(['PRINTING', 'CONNECTED'])
    expect(fake.attempts[0]?.acked).toBe(true)
  })

  it('AA가 늦게 와도(n ms) 기다린다, 오지 않으면 출력 시작 20초 뒤 TIMEOUT — 출력함이 되지 않는다', async () => {
    const late = setup({ ack: { delayMs: 5000 } })
    await late.adapter.connect('bluetooth')
    const p1 = track(late.adapter.print(border()))
    await late.timer.advance(4000)
    expect(p1.done()).toBe(false)
    await late.timer.advance(2000)
    expect(await p1.promise).toEqual({ ok: true })

    const none = setup({ ack: 'none' })
    await none.adapter.connect('bluetooth')
    const p2 = track(none.adapter.print(border()))
    await none.timer.advance(19_999)
    expect(p2.done()).toBe(false)
    await none.timer.advance(1)
    expect(await p2.promise).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
    expect(none.adapter.state).toBe('CONNECTED')
  })

  it('출력 전에 와 있던 AA(앞 출력의 늦은 알림)는 세지 않는다, AA가 아닌 알림(55·여러 바이트)은 끝 알림이 아니다', async () => {
    for (const ack of [{ bytes: [0x55] }, { bytes: [0xaa, 0x00] }, { bytes: [0x00, 0xaa] }] as const) {
      const { adapter, fake, timer } = setup({ ack })
      await adapter.connect('bluetooth')
      fake.sendNotify([0xaa])
      const p = track(adapter.print(border()))
      await timer.advance(19_999)
      expect(p.done(), JSON.stringify(ack)).toBe(false)
      await timer.advance(1)
      expect(await p.promise).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
    }
  })

  it('보내는 중에 끊기면 DISCONNECTED(+ 다시 연결), 상태 DISCONNECTED', async () => {
    const { adapter, fake, timer } = setup({ jobs: { 1: { disconnectAtPacket: 3 } } })
    await adapter.connect('bluetooth')
    const p = track(adapter.print(noisy(384, 240)))
    await runUntil(timer, p.done)
    expect(await p.promise).toEqual({ ok: false, error: { code: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', action: '다시 연결' } })
    expect(adapter.state).toBe('DISCONNECTED')
    expect(fake.attempts[0]).toMatchObject({ complete: false, acked: false })
    expect(fake.attempts[0]?.packets).toHaveLength(2)
    expect(timer.pending).toBe(0)
  })

  it('모든 조각을 보낸 뒤 AA 전에 끊겨도 DISCONNECTED, AA를 받은 뒤의 끊김은 출력 OK', async () => {
    const before = setup({ ack: 'hold' })
    await before.adapter.connect('bluetooth')
    const p1 = track(before.adapter.print(border()))
    await runUntil(before.timer, () => before.fake.attempts[0]?.complete === true)
    await flush()
    before.fake.disconnect()
    expect(await p1.promise).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
    expect(before.adapter.state).toBe('DISCONNECTED')

    const after = setup({ ack: 'hold' })
    await after.adapter.connect('bluetooth')
    const p2 = track(after.adapter.print(border()))
    await runUntil(after.timer, () => after.fake.attempts[0]?.complete === true)
    await flush()
    after.fake.releaseAck()
    after.fake.disconnect()
    expect(await p2.promise).toEqual({ ok: true })
    expect(after.adapter.state).toBe('DISCONNECTED')
  })

  it('쓰기 오류(연결은 그대로)는 PRINT_FAILED, 상태는 연결됨', async () => {
    const { adapter, timer } = setup({ jobs: { 1: { failWriteAtPacket: 2 } } })
    await adapter.connect('bluetooth')
    const p = track(adapter.print(noisy(384, 240)))
    await runUntil(timer, p.done)
    expect(await p.promise).toMatchObject({ ok: false, error: { code: 'PRINT_FAILED' } })
    expect(adapter.state).toBe('CONNECTED')
    expect(timer.pending).toBe(0)
  })
})

describe('가짜 Web Bluetooth 기기 (AC-N1-50)', () => {
  it('받은 조각을 받은 순서대로 복사해 기록한다 (받은 뒤 원본을 바꿔도 기록은 그대로), 출력마다 이어 붙인 바이트', async () => {
    const fake = createFakeBluetooth({ name: 'S2_X', timer: new ManualTimer() })
    const device = await fake.bluetooth.requestDevice({ filters: [{ namePrefix: 'S2_' }], optionalServices: [SERVICE_A] })
    const server = await device.gatt?.connect()
    const service = await server?.getPrimaryService(SERVICE_A)
    const write = await service?.getCharacteristic('0000ff02-0000-1000-8000-00805f9b34fb')
    const packet = new Uint8Array([1, 2, 3])
    await write?.writeValueWithoutResponse?.(packet)
    packet.fill(9)
    expect(Array.from(fake.packets[0] ?? [])).toEqual([1, 2, 3])
    expect(fake.attempts[0]).toMatchObject({ index: 1, complete: false, acked: false })
  })

  it('작업의 끝을 래스터 머리로 계산해 AA를 보낸다 — 고르기 창 닫기·블루투스 꺼짐·연결 실패를 미리 정할 수 있다', async () => {
    const fake = createFakeBluetooth({ name: 'P12_X', chooser: 'cancel', available: false })
    expect(await fake.bluetooth.getAvailability?.()).toBe(false)
    await expect(fake.bluetooth.requestDevice({ filters: [], optionalServices: [] })).rejects.toMatchObject({ name: 'NotFoundError' })
    fake.setChooser('pick')
    fake.setAvailable(true)
    fake.setConnectFails(true)
    const device = await fake.bluetooth.requestDevice({ filters: [], optionalServices: [] })
    await expect(device.gatt?.connect()).rejects.toMatchObject({ name: 'NetworkError' })
  })

  it('시각·난수를 쓰지 않는다 (Date.now·Math.random을 던지게 해도 출력이 된다)', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now')
    })
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random')
    })
    const { adapter, timer } = setup({ name: 'P12_1' })
    await adapter.connect('bluetooth')
    const p = track(adapter.print(border(320, 96)))
    await runUntil(timer, p.done)
    expect(await p.promise).toEqual({ ok: true })
  })
})

describe('보내기 기본값 (AC-N1-63 기록과 같다)', () => {
  it('시간 초과 20초 · 간격 30ms · 조각 90바이트 · 크레딧 기다림 1초 · 크레딧 상한 4', () => {
    expect({ ...MARKLIFE_DEFAULTS }).toEqual({ printTimeoutMs: 20_000, packetIntervalMs: 30, maxPacketBytes: 90, creditWaitMs: 1000, maxCredits: 4 })
  })
})

describe('실제 라벨 그림 (렌더 → 작업 바이트 → 가짜 기기)', () => {
  it('테이프 세 크기의 기본 템플릿 그림을 P12에 넣으면 래스터 머리의 폭이 0C 00이고 가짜 기기가 받은 그림을 되돌리면 같은 그림', async () => {
    const env = createNodeRenderEnv()
    const { adapter, fake, timer } = setup({ name: 'P12_ZA15B' })
    await adapter.connect('bluetooth')
    for (const size of ['tape12x40', 'tape15x30', 'tape15x50'] as const) {
      const r = renderProductLabel(env, defaultTemplate('product', size), { no: 9999, name: '왕비뇌신금', price: 99999999, date: '2026-10-08', buyer: { kind: 'youtube', name: '우주천사' } })
      if (!r.ok) throw new Error(JSON.stringify(r.error))
      const bytes = jobBytes(MARKLIFE_P12, r.image)
      expect([bytes[19 + 4], bytes[19 + 5]]).toEqual([0x0c, 0x00])
      const p = track(adapter.print(r.image))
      await runUntil(timer, p.done)
      expect(await p.promise).toEqual({ ok: true })
      expect(decodeMarklifeJob(fake.printed.at(-1) as Uint8Array, MARKLIFE_P12).data).toEqual(r.image.data)
    }
  })
})
