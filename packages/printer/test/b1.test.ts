// B1 어댑터 — 기능 감지·연결 오류·마지막 줄 대응·농도·프로필 확장 (AC-P1-40~43, L-7).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LabelType } from '@mmote/niimbluelib'
import { bitmapsEqual, getPixel, type LabelBitmap } from '@livejjim/label'
import { describe, expect, it, vi } from 'vitest'
import {
  B1_PROFILE,
  CONNECTION_STATES,
  ENABLED_PROFILES,
  PRINTER_ERROR_CODES,
  PRINTER_MESSAGES,
  createB1Adapter,
  createNiimbotAdapter,
  describeCause,
  detectMethods,
  type PrinterEnvironment,
  type PrinterProfile,
} from '../src/index.ts'
import { FakeNiimbotClient, ManualTimer, decodeEncoded, flush, sampleImage } from './fakes.ts'

const BOTH: PrinterEnvironment = { bluetooth: { requestDevice: () => undefined }, serial: { requestPort: () => undefined } }

function setup(env: PrinterEnvironment = BOTH, client = new FakeNiimbotClient()) {
  const made: string[] = []
  const adapter = createB1Adapter({
    environment: () => env,
    createClient: (method) => {
      made.push(method)
      return client
    },
    timer: new ManualTimer(),
  })
  return { adapter, client, made }
}

const domError = (name: string, message = name) => Object.assign(new Error(message), { name })

describe('PrinterAdapter와 프로필 (AC-P1-40)', () => {
  it('연결 상태 4가지', () => {
    expect([...CONNECTION_STATES]).toEqual(['DISCONNECTED', 'CONNECTING', 'CONNECTED', 'PRINTING'])
  })

  it('B1 프로필: 203dpi·헤드 384점·농도 1~5 기본 3·B1 인쇄 방식·간격 있는 라벨·마지막 줄 +1행, 켜진 프로필은 B1·B1 SE·B21·D110 (PRN2 D-PRN2-05)', () => {
    expect(B1_PROFILE).toMatchObject({ model: 'B1', dpi: 203, headDots: 384, density: { min: 1, max: 5, default: 3 }, printTask: 'B1', labelType: 'WITH_GAPS', extraBlankRows: 1, printDirection: 'top' })
    // PRN2 D-PRN2-05: N1까지는 B1 하나 — niimbluelib 0.47.1 표 그대로 실험 프로필 세 줄을 더했다
    expect(ENABLED_PROFILES.map((p) => p.model)).toEqual(['B1', 'B1_SE', 'B21', 'D110'])
    expect(ENABLED_PROFILES.map((p) => p.experimental)).toEqual([false, true, true, true])
    expect(setup().adapter.profile).toBe(B1_PROFILE)
  })

  it('프로필 목록에 모델 하나를 더하는 것만으로 다른 모델을 붙일 수 있다 (시험용 가짜 프로필 — 제품 코드에는 켜지 않는다)', async () => {
    // PRN2: D110은 켠 프로필이 되었다(D-PRN2-05) — 시험용 가짜는 표에 없는 모델(D11)로 둔다
    const TEST_D110: PrinterProfile = { model: 'D11', displayName: '시험용 D11', dpi: 203, headDots: 96, density: { min: 1, max: 3, default: 2 }, printTask: 'D110', labelType: 'WITH_GAPS', printDirection: 'left', extraBlankRows: 0 }
    const client = new FakeNiimbotClient()
    client.model = 'D11'
    const b1Only = createB1Adapter({ environment: () => BOTH, createClient: () => client })
    expect((await b1Only.connect('bluetooth')).ok).toBe(false)
    const extended = createNiimbotAdapter({ profiles: [B1_PROFILE, TEST_D110], environment: () => BOTH, createClient: () => client })
    expect((await extended.connect('bluetooth')).ok).toBe(true)
    expect(extended.profile).toBe(TEST_D110)
    // 그 모델의 헤드 점 수·농도·인쇄 방식을 쓴다 — left는 돌린 뒤의 폭(받은 그림의 높이)을 헤드와 견준다 (L-7 PRN2)
    expect(await extended.print(sampleImage(1, 96, 97))).toMatchObject({ ok: false, error: { code: 'IMAGE_TOO_WIDE' } })
    expect((await extended.print(sampleImage(1, 320, 96))).ok).toBe(true)
    const small = sampleImage(2, 96, 40)
    expect((await extended.print(small)).ok).toBe(true)
    const task = client.tasks.at(-1)
    expect(task?.name).toBe('D110')
    expect(task?.options.density).toBe(2)
    expect(task?.pages[0]?.image.rows).toBe(96) // 'left' 방향은 돌려서 보낸다 (+1행 없음)
  })
})

describe('B1 어댑터 — 기능 감지와 연결 (AC-P1-41)', () => {
  it('@mmote/niimbluelib을 정확한 버전으로 의존한다', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(manifest.dependencies['@mmote/niimbluelib']).toMatch(/^\d+\.\d+\.\d+$/)
    for (const [name, v] of Object.entries(manifest.dependencies)) if (!v.startsWith('workspace:')) expect(v, name).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('연결 방법: 블루투스가 있으면 bluetooth, 시리얼이 있으면 serial(블루투스가 앞), 둘 다 없으면 빈 목록', () => {
    expect(detectMethods(BOTH)).toEqual(['bluetooth', 'serial'])
    expect(detectMethods({ serial: { requestPort: () => undefined } })).toEqual(['serial'])
    expect(detectMethods({ bluetooth: { requestDevice: () => undefined } })).toEqual(['bluetooth'])
    expect(detectMethods({})).toEqual([])
    expect(detectMethods({ bluetooth: {} })).toEqual([])
  })

  it('둘 다 없는 환경(아이폰 사파리·Node)에서 연결하면 UNSUPPORTED와 그 문장, 클라이언트를 만들지 않는다', async () => {
    const { adapter, made } = setup({})
    expect(adapter.availableMethods()).toEqual([])
    const r = await adapter.connect('bluetooth')
    expect(!r.ok && r.error).toEqual({ code: 'UNSUPPORTED', message: PRINTER_MESSAGES.UNSUPPORTED })
    expect(made).toEqual([])
    expect(adapter.state).toBe('DISCONNECTED')
    // 실제 Node 환경(navigator.bluetooth 없음)도 같다 — 기본 환경 감지
    const real = createB1Adapter()
    expect(real.availableMethods()).toEqual([])
    expect((await real.connect('serial')).ok).toBe(false)
  })

  it('패키지를 import만 해서는 navigator를 건드리지 않는다', async () => {
    let touched = 0
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      get() {
        touched++
        return undefined
      },
    })
    try {
      vi.resetModules()
      const fresh = await import('../src/index.ts')
      expect(touched).toBe(0)
      fresh.createB1Adapter()
      fresh.createFakePrinter()
      expect(touched).toBe(0)
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original)
      else Reflect.deleteProperty(globalThis, 'navigator')
    }
  })

  it('장치 선택 창을 닫으면 NOT_SELECTED', async () => {
    const client = new FakeNiimbotClient()
    client.connectError = domError('NotFoundError', 'User cancelled the requestDevice() chooser.')
    const r = await setup(BOTH, client).adapter.connect('bluetooth')
    expect(!r.ok && r.error.code).toBe('NOT_SELECTED')
    expect(!r.ok && r.error.message).toBe(PRINTER_MESSAGES.NOT_SELECTED)
    expect(!r.ok && r.error.detail).toBeUndefined() // FB1 D-FB1-09 — 상세에 원래 예외 글을 넣지 않는다
  })

  // QS1 D-QS1-03 — getAvailability false여도 한 번 시도한다. 전: "false면 BLUETOOTH_OFF, 클라이언트를 만들지 않는다"
  it('블루투스를 쓸 수 없으면(getAvailability false) 한 번 시도하고, 시도도 실패하면 BLUETOOTH_OFF', async () => {
    const env: PrinterEnvironment = {
      bluetooth: { requestDevice: () => Promise.reject(domError('NotFoundError', 'User cancelled the requestDevice() chooser.')), getAvailability: async () => false },
    }
    const { adapter, made } = setup(env)
    const r = await adapter.connect('bluetooth')
    expect(!r.ok && r.error).toEqual({ code: 'BLUETOOTH_OFF', message: PRINTER_MESSAGES.BLUETOOTH_OFF })
    expect(made).toEqual(['bluetooth']) // QS1 D-QS1-03 — 시도했다
    expect(adapter.state).toBe('DISCONNECTED')
    // QS1 D-QS1-03 — false인데 시도는 됨(윈도우 오판): 연결된다
    const misjudged = setup({ bluetooth: { requestDevice: () => undefined, getAvailability: async () => false } })
    expect(await misjudged.adapter.connect('bluetooth')).toEqual({ ok: true })
    expect(misjudged.adapter.state).toBe('CONNECTED')
    // 어댑터가 꺼져 있다는 예외도 같다
    const client = new FakeNiimbotClient()
    client.connectError = domError('NotFoundError', 'Bluetooth adapter not available.')
    const r2 = await setup(BOTH, client).adapter.connect('bluetooth')
    expect(!r2.ok && r2.error.code).toBe('BLUETOOTH_OFF')
  })

  it('시리얼 포트를 열 수 없으면 PORT_BUSY', async () => {
    for (const error of [domError('NetworkError', 'Failed to open serial port.'), domError('InvalidStateError', 'The port is already open.')]) {
      const client = new FakeNiimbotClient()
      client.connectError = error
      const { adapter, made } = setup(BOTH, client)
      const r = await adapter.connect('serial')
      expect(!r.ok && r.error).toMatchObject({ code: 'PORT_BUSY', message: PRINTER_MESSAGES.PORT_BUSY })
      expect(made).toEqual(['serial'])
    }
  })

  it('연결된 프린터 모델이 켠 프로필(B1·B1 SE·B21·D110)이 아니면 연결을 끊고 WRONG_MODEL — 300dpi B1 Pro·B21 Pro·변형·모름 (AC-PRN2-05)', async () => {
    for (const model of ['B1_PRO', 'B21_PRO', 'D110_M', 'B21S', undefined]) {
      const client = new FakeNiimbotClient()
      client.model = model
      const { adapter } = setup(BOTH, client)
      const r = await adapter.connect('bluetooth')
      expect(!r.ok && r.error.code).toBe('WRONG_MODEL')
      // 문장이 그림 파일 경로를 알린다 (L-7 표 PRN2)
      expect(!r.ok && r.error.message).toBe('이 프린터는 바로 출력할 수 없어요. 다른 프린터를 고르거나, 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.')
      expect(client.disconnectCalls).toBe(1)
      expect(client.connected).toBe(false)
      expect(adapter.state).toBe('DISCONNECTED')
      expect((await adapter.print(sampleImage())).ok).toBe(false)
    }
  })

  it('연결은 부르는 쪽이 부를 때만 시작한다 — 만들기·감지만으로는 클라이언트를 만들지 않는다, 끊긴 뒤 저절로 다시 연결하지 않는다', async () => {
    const { adapter, client, made } = setup()
    adapter.availableMethods()
    await flush()
    expect(made).toEqual([])
    await adapter.connect('bluetooth')
    expect(made).toEqual(['bluetooth'])
    client.emitDisconnect()
    await flush()
    expect(adapter.state).toBe('DISCONNECTED')
    expect(made).toEqual(['bluetooth'])
  })

  it('연결 중에 또 누르면 같은 연결을 기다린다(클라이언트 하나)', async () => {
    const { adapter, made } = setup()
    const [a, b] = await Promise.all([adapter.connect('bluetooth'), adapter.connect('bluetooth')])
    expect(a.ok && b.ok).toBe(true)
    expect(made).toEqual(['bluetooth'])
  })

  it('연결하는 동안 연결 끊기를 누르면 붙지 않는다', async () => {
    let release!: () => void
    const client = new FakeNiimbotClient()
    const slow = Object.assign(client, {
      connect: () =>
        new Promise<unknown>((resolve) => {
          release = () => {
            client.connected = true
            resolve({})
          }
        }),
    })
    const { adapter } = setup(BOTH, slow)
    const pending = adapter.connect('bluetooth')
    await flush()
    expect(adapter.state).toBe('CONNECTING')
    await adapter.disconnect()
    release()
    const r = await pending
    expect(r.ok).toBe(false)
    expect(adapter.state).toBe('DISCONNECTED')
    expect(client.connected).toBe(false)
  })
})

describe('B1 출력 — 마지막 줄 대응·농도 (AC-P1-42)', () => {
  it('B1 인쇄 방식·농도 3·간격 있는 라벨·1쪽·1장, 받은 그림은 384×241 — 위 240줄은 같고 맨 아래 줄은 흰색', async () => {
    const { adapter, client } = setup()
    await adapter.connect('bluetooth')
    const image = sampleImage(7)
    const r = await adapter.print(image)
    expect(r.ok).toBe(true)
    expect(adapter.state).toBe('CONNECTED')
    expect(client.tasks).toHaveLength(1)
    const task = client.tasks[0]
    expect(task?.name).toBe('B1')
    expect(task?.options).toEqual({ density: 3, labelType: LabelType.WithGaps, totalPages: 1 })
    expect(task?.inited).toBe(true)
    expect(task?.ended).toBe(1)
    expect(task?.pages).toHaveLength(1)
    expect(task?.pages[0]?.quantity).toBe(1)
    const sent = task?.pages[0]?.image
    expect(sent && [sent.cols, sent.rows]).toEqual([384, 241])
    const decoded = decodeEncoded(sent as NonNullable<typeof sent>, 384)
    for (let y = 0; y < 240; y++) for (let x = 0; x < 384; x++) if (getPixel(decoded, x, y) !== getPixel(image, x, y)) throw new Error(`${String(x)},${String(y)} 다름`)
    for (let x = 0; x < 384; x++) expect(getPixel(decoded, x, 240)).toBe(false)
    // 받은 그림은 바꾸지 않는다
    expect(image.height).toBe(240)
  })

  it('맨 아래 줄이 검정인 그림(테스트 라벨 테두리)도 그 줄을 그대로 보내고 그 아래에 흰 줄을 더한다', async () => {
    const { adapter, client } = setup()
    await adapter.connect('bluetooth')
    const image = sampleImage(1)
    for (let x = 0; x < 384; x++) image.data[239 * 48 + (x >> 3)] = 0xff
    await adapter.print(image)
    const decoded = decodeEncoded(client.tasks[0]?.pages[0]?.image as never, 384)
    expect(Array.from({ length: 384 }, (_, x) => getPixel(decoded, x, 239)).every(Boolean)).toBe(true)
    expect(Array.from({ length: 384 }, (_, x) => getPixel(decoded, x, 240)).some(Boolean)).toBe(false)
  })

  it('농도 1~5는 그대로 보낸다', async () => {
    const { adapter, client } = setup()
    await adapter.connect('bluetooth')
    for (const density of [1, 2, 3, 4, 5]) await adapter.print(sampleImage(), { density })
    expect(client.tasks.map((t) => t.options.density)).toEqual([1, 2, 3, 4, 5])
  })

  it('라벨 패키지와 같은 비트 순서 — 왼쪽 점이 높은 비트, 1 = 검정 (AC-P1-60)', async () => {
    const { adapter, client } = setup()
    await adapter.connect('bluetooth')
    const image: LabelBitmap = { width: 384, height: 2, data: new Uint8Array(96) }
    image.data[0] = 0b1000_0001
    image.data[48 + 47] = 0b0000_0001
    await adapter.print(image)
    const decoded = decodeEncoded(client.tasks[0]?.pages[0]?.image as never, 384)
    expect([getPixel(decoded, 0, 0), getPixel(decoded, 1, 0), getPixel(decoded, 7, 0), getPixel(decoded, 383, 1)]).toEqual([true, false, true, true])
    expect(bitmapsEqual({ width: 384, height: 2, data: decoded.data.subarray(0, 96) }, image)).toBe(true)
  })
})

describe('끊김·오류·시간 초과 (AC-P1-43)', () => {
  it('오류 문장은 L-7 표와 글자까지 같다', () => {
    const TABLE: Record<string, string> = {
      UNSUPPORTED: '이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.',
      NOT_SELECTED: '프린터를 고르지 않았어요. 다시 연결을 누르고 목록에서 프린터를 골라 주세요.', // PRN2 D-PRN2-05
      BLUETOOTH_OFF: '블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 연결해 주세요.',
      PORT_BUSY: 'USB 연결을 다른 프로그램이 쓰고 있어요. NIIMBOT 프로그램을 닫거나 블루투스로 연결해 주세요.',
      WRONG_MODEL: '이 프린터는 바로 출력할 수 없어요. 다른 프린터를 고르거나, 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.', // PRN2 D-PRN2-05
      DISCONNECTED: '프린터 연결이 끊겼어요.',
      CONNECT_FAILED: '프린터에 연결하지 못했어요. 아래를 차례로 해 본 뒤 다시 연결해 주세요.', // FB1 D-FB1-09
      NOT_CONNECTED: '프린터를 먼저 연결해 주세요.',
      BUSY: '앞 라벨을 출력하는 중이에요. 끝난 뒤 다시 해 주세요.',
      IMAGE_TOO_WIDE: '라벨이 프린터보다 넓어요. 라벨 크기를 확인해 주세요.',
      TIMEOUT: '프린터가 응답하지 않아요. 프린터 전원과 라벨을 확인한 뒤 다시 시작해 주세요.',
      PRINT_FAILED: '라벨을 출력하지 못했어요. 프린터의 라벨과 덮개를 확인한 뒤 다시 시작해 주세요.',
    }
    expect([...PRINTER_ERROR_CODES].sort()).toEqual(Object.keys(TABLE).sort())
    for (const code of PRINTER_ERROR_CODES) expect(PRINTER_MESSAGES[code], code).toBe(TABLE[code])
    // 영어는 제품 이름(NIIMBOT·B1·USB)만
    for (const message of Object.values(PRINTER_MESSAGES)) expect(message.replace(/NIIMBOT|B1|USB/g, '')).not.toMatch(/[A-Za-z]/)
  })

  it('출력 중 프린터 오류 예외 → PRINT_FAILED, 상세에 원래 예외 글 없음 (라벨 내용·전화번호 없음 — FB1 D-FB1-09)', async () => {
    const { adapter, client } = setup()
    await adapter.connect('bluetooth')
    client.failOn = 'page'
    const r = await adapter.print(sampleImage())
    expect(!r.ok && r.error.code).toBe('PRINT_FAILED')
    // FB1 D-FB1-09 — 상세는 쉬운 말 고정 문장뿐이다(원래 예외 글을 돌려주지 않는다)
    expect(!r.ok && r.error.detail).toBeUndefined()
    expect(describeCause(new Error('구매자 010-1234-5678 출력 실패'))).toBeUndefined()
    expect(describeCause(new Error('Timeout 10000ms'))).toBe('프린터가 답하지 않아 기다리는 시간이 지났어요.')
  })

  it('출력 중 클라이언트가 끊김을 알리면 DISCONNECTED, 끊김 알림보다 예외가 먼저 와도 끊김', async () => {
    const { adapter, client } = setup()
    await adapter.connect('bluetooth')
    client.failOn = 'page'
    const original = client.protocol.newPrintTask
    client.protocol.newPrintTask = (name, options) => {
      const task = original(name, options)
      client.connected = false
      return task
    }
    const r = await adapter.print(sampleImage())
    expect(!r.ok && r.error.code).toBe('DISCONNECTED')
    expect(adapter.state).toBe('DISCONNECTED')
  })

  it('프린터가 끝났다고 알린 뒤 끝냄 알림(printEnd) 응답이 시간 안에 오지 않아도 출력은 끝난 것 — TIMEOUT이 아니다 (TD-P1-001)', async () => {
    const timer = new ManualTimer()
    const client = new FakeNiimbotClient()
    const adapter = createB1Adapter({ environment: () => BOTH, createClient: () => client, timer })
    await adapter.connect('bluetooth')
    client.holdEnd = true
    let settled = false
    const pending = adapter.print(sampleImage()).then((r) => {
      settled = true
      return r
    })
    await flush()
    expect(client.tasks[0]?.done).toBe(true)
    expect(settled).toBe(false) // 끝냄 알림을 기다린다
    await timer.advance(20_000)
    expect(await pending).toEqual({ ok: true })
    expect(adapter.state).toBe('CONNECTED')
    expect(client.tasks[0]?.ended).toBe(1) // 끝냄 알림을 다시 보내지 않는다
    expect(timer.pending).toBe(0)
  })

  it('프린터가 끝났다고 알린 뒤 판매자가 연결을 끊어도 그 출력은 끝난 것, 상태는 끊김 (TD-P1-001)', async () => {
    const { adapter, client } = setup()
    await adapter.connect('bluetooth')
    client.holdEnd = true
    const pending = adapter.print(sampleImage())
    await flush()
    expect(client.tasks[0]?.done).toBe(true)
    await adapter.disconnect()
    expect(await pending).toEqual({ ok: true })
    expect(adapter.state).toBe('DISCONNECTED')
  })

  it('끝냄 알림 응답이 실패여도(false) 프린터가 끝났다고 알렸으면 출력은 끝난 것', async () => {
    const { adapter, client } = setup()
    await adapter.connect('bluetooth')
    client.holdEnd = true
    const pending = adapter.print(sampleImage())
    await flush()
    client.tasks[0]?.releaseEnd?.(false)
    expect(await pending).toEqual({ ok: true })
    expect(adapter.state).toBe('CONNECTED')
  })

  it('프린터가 끝났다고 알리기 전의 끊김은 여전히 DISCONNECTED (찍혔는지 알 수 없다 — D-P1-09)', async () => {
    const { adapter, client } = setup()
    await adapter.connect('bluetooth')
    client.autoFinish = false
    const pending = adapter.print(sampleImage())
    await flush()
    expect(client.tasks[0]?.done).toBe(false)
    client.emitDisconnect()
    const r = await pending
    expect(!r.ok && r.error.code).toBe('DISCONNECTED')
    expect(adapter.state).toBe('DISCONNECTED')
  })

  it('시간 초과 기본값은 20초', async () => {
    const timer = new ManualTimer()
    const client = new FakeNiimbotClient()
    const adapter = createB1Adapter({ environment: () => BOTH, createClient: () => client, timer })
    await adapter.connect('bluetooth')
    client.autoFinish = false
    const pending = adapter.print(sampleImage())
    await timer.advance(19_999)
    expect(adapter.state).toBe('PRINTING')
    await timer.advance(1)
    const r = await pending
    expect(!r.ok && r.error.code).toBe('TIMEOUT')
    expect(client.tasks[0]?.ended).toBe(1) // 끝냄 알림은 보낸다
  })
})
