// N1 적대 테스트 (test-domain): 어댑터 장면 공격 (AC-N1-23·30·33·42, LABEL_RULES L-12 3·5).
// - import·어댑터 만들기만으로는 navigator를 읽지 않는다
// - 거절되는 출력(넓은 그림·농도 밖·L-1 아닌 그림)은 한 조각도 보내지 않고 상태는 연결됨 그대로
// - 출력 전(첫 조각 전 크레딧 기다림 중 포함)에 온 `AA`, 흐름 제어 특성으로 온 `AA`는 끝 알림이 아니다 → 마지막 쓰기가 끝나고 20초에 TIMEOUT
//   (L-12 5 "진행이 멈춘 20초", D-N1-12 — 전에는 출력 시작부터 20초를 가정했다)
// - 시간 초과된 앞 출력의 늦은 `AA`가 출력 사이에 오면 다음 출력의 끝으로 세지 않는다
import { createBitmap, setPixel } from '@livejjim/label'
import { MARKLIFE_MESSAGES, MARKLIFE_P12, MARKLIFE_S2, buildPrintJob, type PrinterResult } from '@livejjim/printer'
import { describe, expect, it, vi } from 'vitest'
import { ManualBle, StepTimer, flush } from './ble-mock.ts'

const s2Image = (): ReturnType<typeof createBitmap> => {
  const img = createBitmap(384, 40)
  for (let x = 0; x < 384; x += 3) setPixel(img, x, x % 40, true)
  return img
}

async function setup(name = 'S2_AB12', initial: readonly (readonly number[])[] = [[0x01, 0x04]]) {
  const { createMarklifeAdapter } = await import('@livejjim/printer')
  const timer = new StepTimer()
  const ble = new ManualBle({ name, timer, onFlowStart: initial })
  const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer })
  expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
  return { timer, ble, adapter }
}

/** 출력을 시작하고, 조각마다 크레딧을 돌려주며 ms만큼 돌린다 */
async function run(ctx: Awaited<ReturnType<typeof setup>>, ms: number, onTick?: () => void): Promise<void> {
  for (let t = 0; t < ms; t += 10) {
    ctx.ble.sendFlow([0x01, 0x01])
    onTick?.()
    await ctx.timer.advance(10)
  }
}

/** 마지막으로 쓰기가 끝난 시각 (L-12 5 — 시간 초과 20초는 여기부터 센다) */
const lastWriteEnd = (ctx: Awaited<ReturnType<typeof setup>>): number => {
  const end = ctx.ble.writes.at(-1)?.endAt
  if (end === undefined) throw new Error('끝난 쓰기가 없다')
  return end
}

describe('AC-N1-30 import·만들기만으로는 navigator를 읽지 않는다', () => {
  it('navigator를 읽으면 세는 덫을 놓고 어댑터를 만든다', async () => {
    let reads = 0
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      get() {
        reads++
        return { userAgent: 'x' }
      },
    })
    try {
      // 모듈을 새로 읽어 import 자체도 덫 안에서 돈다
      vi.resetModules()
      const m = await import('@livejjim/printer')
      m.createMarklifeAdapter()
      // PRN2: EXPERIMENTAL_PROFILES가 없어졌다(D-PRN2-01) — 같은 내용(바우아토만)으로. 웹 한 목록 어댑터·고르기 창 인자도 같은 성질(L-12 3)
      m.createMarklifeAdapter({ profiles: [m.BAUATO_PPA2L] })
      m.createWebPrinterAdapter()
      m.printerRequestOptions()
      expect(reads).toBe(0)
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original)
      else delete (globalThis as { navigator?: unknown }).navigator
    }
  })
})

describe('AC-N1-23 거절되는 출력은 한 조각도 보내지 않는다', () => {
  it.each([
    ['S2에 392점 그림', 'S2_AB12', () => createBitmap(392, 10), {}, 'IMAGE_TOO_WIDE'],
    ['S2에 농도 4', 'S2_AB12', () => createBitmap(384, 10), { density: 4 }, 'INVALID_DENSITY'],
    ['S2에 농도 0', 'S2_AB12', () => createBitmap(384, 10), { density: 0 }, 'INVALID_DENSITY'],
    ['P12에 높이 97 그림', 'P12_AB12', () => createBitmap(40, 97), {}, 'IMAGE_TOO_WIDE'],
    ['P12에 50×30 그림', 'P12_AB12', () => createBitmap(384, 240), { density: 9 }, 'IMAGE_TOO_WIDE'],
    ['L-1이 아닌 그림', 'S2_AB12', () => ({ width: 10, height: 2, data: new Uint8Array(3) }), {}, 'PRINT_FAILED'],
  ] as const)('%s → %s', async (_what, name, img, options, code) => {
    const ctx = await setup(name)
    const r = await ctx.adapter.print(img() as ReturnType<typeof createBitmap>, options)
    expect(r).toMatchObject({ ok: false, error: { code, message: MARKLIFE_MESSAGES[code] } })
    await ctx.timer.advance(25_000)
    expect(ctx.ble.writes).toHaveLength(0)
    expect(ctx.adapter.state).toBe('CONNECTED')
    expect(ctx.timer.pending).toBe(0)
  })
})

describe('AC-N1-42 끝 알림이 아닌 것', () => {
  it('첫 조각 전(크레딧 기다림 중)에 온 AA는 세지 않는다 → 마지막 쓰기가 끝나고 20초에 TIMEOUT (D-N1-12)', async () => {
    const ctx = await setup('S2_AB12', [])
    const job = buildPrintJob(MARKLIFE_S2, s2Image())
    if (!job.ok) throw new Error(job.code)
    let result: PrinterResult | undefined
    void ctx.adapter.print(s2Image()).then((r) => (result = r))
    await ctx.timer.advance(500)
    expect(ctx.ble.writes).toHaveLength(0)
    ctx.ble.sendNotify([0xaa])
    // 크레딧을 돌려주며 모두 보낸다
    await run(ctx, 2_000)
    expect(Buffer.from(ctx.ble.joined()).equals(Buffer.from(job.bytes))).toBe(true)
    expect(ctx.ble.writes[0]?.at).toBe(500)
    const last = lastWriteEnd(ctx)
    // 출력 시작 20초(20,000ms)는 기준이 아니다 — 마지막 쓰기 끝 + 20,000ms 1ms 전까지는 PRINTING
    await ctx.timer.advance(last + 20_000 - 1 - ctx.timer.now)
    expect(result).toBeUndefined()
    expect(ctx.adapter.state).toBe('PRINTING')
    await ctx.timer.advance(1)
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
    expect(ctx.adapter.state).toBe('CONNECTED')
    expect(ctx.timer.pending).toBe(0)
  })

  it('흐름 제어 특성(ff03)으로 온 AA는 끝 알림이 아니다', async () => {
    const ctx = await setup()
    let result: PrinterResult | undefined
    void ctx.adapter.print(s2Image()).then((r) => (result = r))
    await run(ctx, 21_000, () => ctx.ble.sendFlow([0xaa]))
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
  })

  it('시간 초과된 앞 출력의 늦은 AA가 출력 사이에 오면 다음 출력의 끝으로 세지 않는다', async () => {
    const ctx = await setup()
    let first: PrinterResult | undefined
    void ctx.adapter.print(s2Image()).then((r) => (first = r))
    for (let i = 0; i < 3_000 && !first; i++) await run(ctx, 10)
    expect(first).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
    ctx.ble.sendNotify([0xaa]) // 늦은 끝 알림
    await flush()
    const from = ctx.ble.writes.length
    let second: PrinterResult | undefined
    void ctx.adapter.print(s2Image()).then((r) => (second = r))
    await run(ctx, 2_000)
    expect(ctx.ble.writes.length).toBeGreaterThan(from)
    expect(second).toBeUndefined()
    const last = lastWriteEnd(ctx)
    await run(ctx, last + 20_000 - ctx.timer.now)
    expect(second).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
  })

  it('P12: 모든 조각을 쓴 뒤 AA 전에 끊기면 DISCONNECTED(+ 다시 연결), 다시 연결하면 다음 출력은 처음 바이트부터', async () => {
    const ctx = await setup('P12_AB12')
    const img = createBitmap(320, 96)
    for (let x = 0; x < 320; x++) setPixel(img, x, x % 96, true)
    const job = buildPrintJob(MARKLIFE_P12, img)
    if (!job.ok) throw new Error(job.code)
    let result: PrinterResult | undefined
    void ctx.adapter.print(img).then((r) => (result = r))
    await run(ctx, 3_000)
    expect(Buffer.from(ctx.ble.joined()).equals(Buffer.from(job.bytes))).toBe(true)
    expect(result).toBeUndefined()
    ctx.ble.drop()
    await flush()
    expect(result).toMatchObject({ ok: false, error: { code: 'DISCONNECTED', action: '다시 연결' } })
    expect(ctx.adapter.state).toBe('DISCONNECTED')
    // 다시 연결
    const before = ctx.ble.writes.length
    expect(await ctx.adapter.connect('bluetooth')).toEqual({ ok: true })
    ctx.ble.sendFlow([0x01, 0x04])
    let again: PrinterResult | undefined
    void ctx.adapter.print(img).then((r) => (again = r))
    await run(ctx, 3_000)
    expect(Buffer.from(ctx.ble.joined(before)).equals(Buffer.from(job.bytes))).toBe(true)
    ctx.ble.sendNotify([0xaa])
    await flush()
    expect(again).toEqual({ ok: true })
    expect(ctx.timer.pending).toBe(0)
  })

  it('S2: AA를 받은 뒤의 끊김은 출력 OK', async () => {
    const ctx = await setup()
    const job = buildPrintJob(MARKLIFE_S2, s2Image())
    if (!job.ok) throw new Error(job.code)
    let result: PrinterResult | undefined
    void ctx.adapter.print(s2Image()).then((r) => (result = r))
    await run(ctx, 2_000)
    ctx.ble.sendNotify([0xaa])
    ctx.ble.drop()
    await flush()
    expect(result).toEqual({ ok: true })
    expect(ctx.adapter.state).toBe('DISCONNECTED')
  })
})
