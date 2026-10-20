// 어댑터 계약 시험 묶음 (AC-P1-40·42·43·44, AC-N1-43) — B1 어댑터(가짜 niimbluelib 클라이언트)·가짜 프린터·Marklife 어댑터(가짜 블루투스 기기 —
// YXQ 프로필 S2 하나와 L11 프로필 P12 하나)가 같은 묶음을 통과한다. 마지막 줄 +1행은 B1 전용이라 이 묶음에서 빼고 b1.test.ts에서 본다.
// 모델마다 다른 것은 묶음의 입력으로만 받는다: 그 프로필에 맞는 그림, 헤드보다 넓은 그림, 농도 범위·문장(농도를 받지 않는 L11은 무엇을 넘겨도 보낸다).
// Marklife 묶음의 타이머는 조각 사이 30ms를 바로 돌리는 PacedTimer다(정확한 간격은 marklife.test.ts).
import type { LabelBitmap } from '@livejjim/label'
import { describe, expect, it } from 'vitest'
import {
  MARKLIFE_P12,
  MARKLIFE_S2,
  PRINTER_MESSAGES,
  createFakeBluetooth,
  createFakePrinter,
  createMarklifeAdapter,
  createNiimbotAdapter,
  type ConnectionState,
  type ModelProfile,
  type PrinterAdapter,
} from '../src/index.ts'
import { FakeNiimbotClient, ManualTimer, PacedTimer, decodeEncoded, decodeMarklifeJob, flush, sampleImage } from './fakes.ts'

const TIMEOUT_MS = 5000

/** 농도: 보내는 값·보내지 않는 값과 그 문장. null이면 농도를 받지 않는다(무엇을 넘겨도 보낸다) */
type DensitySpec = { readonly valid: readonly number[]; readonly invalid: readonly number[]; readonly message: string } | null

const NIIMBOT_DENSITY: DensitySpec = { valid: [1, 2, 3, 4, 5], invalid: [0, 6, 2.5, -1, Number.NaN], message: '인쇄 농도는 1~5 사이의 정수로 정해 주세요.' }

interface Harness {
  readonly adapter: PrinterAdapter
  readonly timer: ManualTimer
  /** 그 프로필에 맞는 시험 그림 */
  image(seed?: number): LabelBitmap
  /** 헤드보다 넓은 그림 */
  tooWide(): LabelBitmap
  readonly density: DensitySpec
  /** 프린터가 받은 그림 (끝까지 출력한 것, 받은 순서) */
  printed(): LabelBitmap[]
  /**
   * 다음 출력이 끝났다는 알림을 늦춘다 — finish()로 끝낸다 (가짜 프린터는 ms만큼의 지연).
   * finishThenDisconnect(): 프린터가 끝났다고 알린 직후, 출력 결과를 돌려주기 전에 끊긴다
   */
  holdNextPrint(ms?: number): { finish(): Promise<void>; finishThenDisconnect(): Promise<void> }
  /** 프린터 쪽에서 끊긴다 */
  disconnectNow(): void
  /** 다음 출력에서 프린터 오류 */
  failNextPrint(): void
}

function b1Harness(): Harness {
  const timer = new ManualTimer()
  const clients: FakeNiimbotClient[] = []
  const adapter = createNiimbotAdapter({
    environment: () => ({ bluetooth: { requestDevice: () => undefined }, serial: { requestPort: () => undefined } }),
    createClient: () => {
      const c = new FakeNiimbotClient()
      clients.push(c)
      return c
    },
    timer,
    printTimeoutMs: TIMEOUT_MS,
  })
  const last = () => clients.at(-1) as FakeNiimbotClient
  return {
    adapter,
    timer,
    image: (seed = 1) => sampleImage(seed),
    tooWide: () => sampleImage(1, 385, 240),
    density: NIIMBOT_DENSITY,
    printed: () =>
      clients.flatMap((c) =>
        c.tasks
          .filter((t) => t.done)
          .map((t) => {
            const page = t.pages[0]
            if (!page) throw new Error('쪽 없음')
            const full = decodeEncoded(page.image, 384)
            // 맨 아래 한 줄(+1행)을 떼고 받은 그림과 비교한다
            return { width: full.width, height: full.height - 1, data: full.data.subarray(0, full.data.length - 48) }
          }),
      ),
    holdNextPrint: () => {
      const client = last()
      client.autoFinish = false
      return {
        finish: async () => {
          client.tasks.at(-1)?.finish()
          client.autoFinish = true
          await flush()
        },
        finishThenDisconnect: async () => {
          // 끝냄 알림(printEnd)의 응답이 오기 전에 블루투스가 끊긴다
          client.holdEnd = true
          client.tasks.at(-1)?.finish()
          client.autoFinish = true
          await flush()
          client.emitDisconnect()
          await flush()
        },
      }
    },
    disconnectNow: () => last().emitDisconnect(),
    failNextPrint: () => {
      last().failOn = 'page'
    },
  }
}

function fakeHarness(): Harness {
  const timer = new ManualTimer()
  const printer = createFakePrinter({ timer, printTimeoutMs: TIMEOUT_MS, methods: ['bluetooth', 'serial'] })
  return {
    adapter: printer,
    timer,
    image: (seed = 1) => sampleImage(seed),
    tooWide: () => sampleImage(1, 385, 240),
    density: NIIMBOT_DENSITY,
    printed: () => printer.printed.map((r) => r.image),
    holdNextPrint: (ms = 1000) => {
      printer.setBehavior(printer.printCalls + 1, { delayMs: ms })
      return {
        finish: () => timer.advance(ms),
        finishThenDisconnect: async () => {
          // 지연이 끝나 결과가 'done'으로 정해진 바로 그때(돌려주기 전에) 끊긴다
          timer.fireNext(() => printer.simulateDisconnect())
          await flush()
        },
      }
    },
    disconnectNow: () => printer.simulateDisconnect(),
    failNextPrint: () => printer.setBehavior(printer.printCalls + 1, 'fail'),
  }
}

/** Marklife 어댑터 + 가짜 블루투스 기기 (꾸러미 A, 첫 크레딧 `01 04`, 조각마다 `01 01`, 작업을 다 받으면 `AA`) */
function marklifeHarness(profile: ModelProfile, deviceName: string, image: (seed: number) => LabelBitmap, tooWide: () => LabelBitmap, density: DensitySpec): () => Harness {
  return () => {
    const timer = new PacedTimer()
    const fake = createFakeBluetooth({ name: deviceName, timer })
    const adapter = createMarklifeAdapter({ environment: () => fake.environment, timer, printTimeoutMs: TIMEOUT_MS })
    /** 지금 보내는 작업을 끝까지 받을 때까지 기다린다 (조각 간격은 PacedTimer가 바로 돌린다) */
    const untilReceived = async (): Promise<void> => {
      for (let i = 0; i < 400 && fake.attempts.at(-1)?.complete !== true; i++) await flush()
      expect(fake.attempts.at(-1)?.complete).toBe(true)
    }
    return {
      adapter,
      timer,
      image: (seed = 1) => image(seed),
      tooWide,
      density,
      printed: () => fake.printed.map((bytes) => decodeMarklifeJob(bytes, profile)),
      holdNextPrint: () => {
        // 다음 작업은 다 받아도 `AA`를 붙잡아 둔다 — finish()가 보낸다
        fake.setJob(fake.attempts.length + 1, { ack: 'hold' })
        return {
          finish: async () => {
            await untilReceived()
            fake.releaseAck()
            await flush()
          },
          finishThenDisconnect: async () => {
            // `AA`를 보낸 바로 그때(결과를 돌려주기 전에) 끊긴다
            await untilReceived()
            fake.releaseAck()
            fake.disconnect()
            await flush()
          },
        }
      },
      disconnectNow: () => fake.disconnect(),
      failNextPrint: () => fake.setJob(fake.attempts.length + 1, { failWriteAtPacket: 1 }),
    }
  }
}

const S2_DENSITY: DensitySpec = { valid: [1, 2, 3], invalid: [0, 4, 6, 2.5, -1, Number.NaN], message: '인쇄 농도는 1~3 사이의 정수로 정해 주세요.' }

for (const [name, make] of [
  ['B1 어댑터(가짜 niimbluelib 클라이언트)', b1Harness],
  ['가짜 프린터', fakeHarness],
  ['Marklife 어댑터 S2(YXQ 2, 50×30)', marklifeHarness(MARKLIFE_S2, 'S2_1A2B_BLE', (seed) => sampleImage(seed), () => sampleImage(1, 385, 240), S2_DENSITY)],
  // 테이프 12×40 = 320×96 그림 — 시계 방향 90도로 돌리면 96점 폭이다. 높이 97이면 돌린 폭 97 > 96
  ['Marklife 어댑터 P12(L11, 테이프 12×40)', marklifeHarness(MARKLIFE_P12, 'P12_ZA15B', (seed) => sampleImage(seed, 320, 96), () => sampleImage(1, 320, 97), null)],
] as const) {
  describe(`어댑터 계약 — ${name}`, () => {
    it('처음은 끊김, 연결 전 출력은 NOT_CONNECTED("프린터를 먼저 연결해 주세요.")', async () => {
      const h = make()
      expect(h.adapter.state).toBe('DISCONNECTED')
      const r = await h.adapter.print(h.image())
      expect(!r.ok && r.error).toEqual({ code: 'NOT_CONNECTED', message: '프린터를 먼저 연결해 주세요.' })
      expect(h.printed()).toHaveLength(0)
    })

    it('연결하면 연결 중 → 연결됨을 알린다, 그만 들으면 알리지 않는다', async () => {
      const h = make()
      const seen: ConnectionState[] = []
      const stop = h.adapter.onStateChange((s) => seen.push(s))
      expect((await h.adapter.connect('bluetooth')).ok).toBe(true)
      expect(seen).toEqual(['CONNECTING', 'CONNECTED'])
      expect(h.adapter.state).toBe('CONNECTED')
      stop()
      await h.adapter.disconnect()
      expect(seen).toEqual(['CONNECTING', 'CONNECTED'])
      expect(h.adapter.state).toBe('DISCONNECTED')
    })

    it('출력: 출력 중 → 연결됨, 받은 그림은 점 하나까지 같다, 프린터가 끝났다고 알린 뒤에 끝난다', async () => {
      const h = make()
      await h.adapter.connect('bluetooth')
      const seen: ConnectionState[] = []
      h.adapter.onStateChange((s) => seen.push(s))
      const hold = h.holdNextPrint()
      let settled = false
      const image = h.image(3)
      const pending = h.adapter.print(image).then((r) => {
        settled = true
        return r
      })
      await flush()
      expect(h.adapter.state).toBe('PRINTING')
      expect(settled).toBe(false)
      await hold.finish()
      const r = await pending
      expect(r.ok).toBe(true)
      expect(seen).toEqual(['PRINTING', 'CONNECTED'])
      expect(h.printed()).toHaveLength(1)
      expect(Array.from(h.printed()[0]?.data ?? [])).toEqual(Array.from(image.data))
    })

    it('프린터가 끝났다고 알린 뒤(결과를 돌려주기 전) 끊기면 그 출력은 끝난 것(ok·기록에 있다), 상태는 끊김 그대로 (TD-P1-001·002)', async () => {
      const h = make()
      await h.adapter.connect('bluetooth')
      const seen: ConnectionState[] = []
      h.adapter.onStateChange((s) => seen.push(s))
      const hold = h.holdNextPrint()
      const image = h.image(4)
      const pending = h.adapter.print(image)
      await flush()
      expect(h.adapter.state).toBe('PRINTING')
      await hold.finishThenDisconnect()
      const r = await pending
      expect(r).toEqual({ ok: true })
      // 끊긴 프린터를 "연결됨"으로 되돌리지 않는다
      expect(h.adapter.state).toBe('DISCONNECTED')
      expect(seen).toEqual(['PRINTING', 'DISCONNECTED'])
      expect(h.printed()).toHaveLength(1)
      expect(Array.from(h.printed()[0]?.data ?? [])).toEqual(Array.from(image.data))
      expect(h.timer.pending).toBe(0)
      // 연결 전 출력은 여전히 NOT_CONNECTED, 다시 연결하면 다음 출력
      const before = await h.adapter.print(h.image())
      expect(!before.ok && before.error.code).toBe('NOT_CONNECTED')
      expect((await h.adapter.connect('bluetooth')).ok).toBe(true)
      expect((await h.adapter.print(h.image(5))).ok).toBe(true)
      expect(h.adapter.state).toBe('CONNECTED')
      expect(h.printed()).toHaveLength(2)
    })

    it('출력 중에 또 출력하면 BUSY', async () => {
      const h = make()
      await h.adapter.connect('bluetooth')
      const hold = h.holdNextPrint()
      const first = h.adapter.print(h.image())
      await flush()
      const second = await h.adapter.print(h.image(2))
      expect(!second.ok && second.error).toEqual({ code: 'BUSY', message: PRINTER_MESSAGES.BUSY })
      await hold.finish()
      expect((await first).ok).toBe(true)
      expect(h.printed()).toHaveLength(1)
    })

    it('농도: 범위 안 정수는 보내고, 범위 밖·소수는 보내지 않고 오류 (농도를 받지 않는 프로필은 무엇을 넘겨도 보낸다)', async () => {
      const h = make()
      await h.adapter.connect('bluetooth')
      if (h.density === null) {
        const values = [undefined, 0, 1, 3, 6, 2.5, -1, Number.NaN]
        for (const density of values) expect((await h.adapter.print(h.image(), density === undefined ? {} : { density })).ok, String(density)).toBe(true)
        expect(h.printed()).toHaveLength(values.length)
        return
      }
      for (const density of h.density.invalid) {
        const r = await h.adapter.print(h.image(), { density })
        expect(!r.ok && r.error.code, String(density)).toBe('INVALID_DENSITY')
        expect(!r.ok && r.error.message).toBe(h.density.message)
      }
      expect(h.printed()).toHaveLength(0)
      for (const density of h.density.valid) expect((await h.adapter.print(h.image(), { density })).ok).toBe(true)
      expect(h.printed()).toHaveLength(h.density.valid.length)
    })

    it('헤드보다 넓은 그림(B1·S2는 폭 385점, P12는 돌린 폭 97점)은 보내지 않고 IMAGE_TOO_WIDE', async () => {
      const h = make()
      await h.adapter.connect('bluetooth')
      const r = await h.adapter.print(h.tooWide())
      expect(!r.ok && r.error).toEqual({ code: 'IMAGE_TOO_WIDE', message: '라벨이 프린터보다 넓어요. 라벨 크기를 확인해 주세요.' })
      expect(h.printed()).toHaveLength(0)
      expect(h.adapter.state).toBe('CONNECTED')
    })

    it('출력 중 끊기면 DISCONNECTED("프린터 연결이 끊겼어요." + 다시 연결), 상태 끊김, 기록에 없다', async () => {
      const h = make()
      await h.adapter.connect('bluetooth')
      h.holdNextPrint()
      const pending = h.adapter.print(h.image())
      await flush()
      h.disconnectNow()
      const r = await pending
      expect(!r.ok && r.error).toEqual({ code: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', action: '다시 연결' })
      expect(h.adapter.state).toBe('DISCONNECTED')
      expect(h.printed()).toHaveLength(0)
      // 다시 연결하면 다시 출력할 수 있다
      expect((await h.adapter.connect('bluetooth')).ok).toBe(true)
      expect((await h.adapter.print(h.image())).ok).toBe(true)
      expect(h.printed()).toHaveLength(1)
    })

    it('프린터가 오류를 알리면 PRINT_FAILED, 연결은 그대로', async () => {
      const h = make()
      await h.adapter.connect('bluetooth')
      h.failNextPrint()
      const r = await h.adapter.print(h.image())
      expect(!r.ok && r.error.code).toBe('PRINT_FAILED')
      expect(!r.ok && r.error.message).toBe(PRINTER_MESSAGES.PRINT_FAILED)
      expect(h.adapter.state).toBe('CONNECTED')
      expect(h.printed()).toHaveLength(0)
    })

    it('정해진 시간 안에 끝나지 않으면 TIMEOUT (주입한 타이머)', async () => {
      const h = make()
      await h.adapter.connect('bluetooth')
      h.holdNextPrint(TIMEOUT_MS * 2)
      let settled = false
      const pending = h.adapter.print(h.image()).then((r) => {
        settled = true
        return r
      })
      await h.timer.advance(TIMEOUT_MS - 1)
      expect(settled).toBe(false)
      await h.timer.advance(1)
      const r = await pending
      expect(!r.ok && r.error).toEqual({ code: 'TIMEOUT', message: PRINTER_MESSAGES.TIMEOUT })
      expect(h.adapter.state).toBe('CONNECTED')
    })

    it('받은 뒤 원본 그림을 바꿔도 기록은 그대로다', async () => {
      const h = make()
      await h.adapter.connect('bluetooth')
      const image = h.image(5)
      const before = Array.from(image.data)
      expect((await h.adapter.print(image)).ok).toBe(true)
      image.data.fill(0xff)
      expect(Array.from(h.printed()[0]?.data ?? [])).toEqual(before)
    })

    it('끝난 출력은 시간 초과 타이머를 남기지 않는다', async () => {
      const h = make()
      await h.adapter.connect('bluetooth')
      expect((await h.adapter.print(h.image())).ok).toBe(true)
      expect(h.timer.pending).toBe(0)
    })
  })
}
