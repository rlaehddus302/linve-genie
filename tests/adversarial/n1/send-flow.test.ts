// N1 적대 테스트 (test-domain): 보내기 공격 (AC-N1-71, AC-N1-40~42, LABEL_RULES L-12 4·5).
// 손으로 조종하는 기기(ble-mock.ts)에 무작위 크레딧 알림(`01 n`, n 0~255)·MTU 알림(`02 lo hi`)·`AA`·다른 알림·끊김을 무작위 시각에 섞는다.
// 속성: (1) 조각은 늘 90바이트 이하이고, MTU 알림 뒤에는 MTU − 3 이하 (2) 크레딧 없이 나간 조각은 크레딧 0으로 1초 이상 기다린 뒤뿐
// (3) 출력 OK면: 첫 조각 뒤 `AA`를 받았고, 조각을 이으면 작업 바이트와 같다 (4) `AA` 없이 OK가 되지 않는다
// (5) 결과는 OK·DISCONNECTED·TIMEOUT 중 그 시점에 맞는 것 (6) 출력이 끝나면 남은 타이머가 없다
import { createBitmap, setPixel, type LabelBitmap } from '@livejjim/label'
import { MARKLIFE_P12, MARKLIFE_S2, buildPrintJob, createMarklifeAdapter, type ModelProfile, type PrinterResult } from '@livejjim/printer'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ManualBle, StepTimer, flush } from './ble-mock.ts'

type Ev =
  | { t: 'credit'; n: number }
  | { t: 'mtu'; v: number }
  | { t: 'aa' }
  | { t: 'other'; bytes: readonly number[] }
  | { t: 'drop' }
  | { t: 'flowJunk'; bytes: readonly number[] }

const evArb: fc.Arbitrary<Ev> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ t: fc.constant('credit' as const), n: fc.oneof(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 255 })) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('mtu' as const), v: fc.oneof(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 600 })) }) },
  { weight: 2, arbitrary: fc.constant({ t: 'aa' as const }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('other' as const), bytes: fc.oneof(fc.constant([0x55]), fc.constant([0xaa, 0xaa]), fc.constant([0xaa, 0x00]), fc.constant([])) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('flowJunk' as const), bytes: fc.oneof(fc.constant([0x01]), fc.constant([0x02, 0x40]), fc.constant([0x03, 0x04]), fc.constant([])) }) },
  { weight: 1, arbitrary: fc.constant({ t: 'drop' as const }) },
)

const stepArb = fc.record({ delay: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 1500 })), ev: evArb })

function image(profile: ModelProfile, length: number, seed: number): LabelBitmap {
  // S2: 384 × length(무작위 점 — 잘 줄지 않아 조각이 여러 개) / P12: length × 96(돌려 보낸다)
  const img = profile.rotate === 'CW90' ? createBitmap(length, 96) : createBitmap(384, length)
  let s = seed | 1
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      s ^= s << 13
      s ^= s >>> 17
      s ^= s << 5
      if ((s & 7) === 0) setPixel(img, x, y, true)
    }
  return img
}

interface Model {
  credits: number
  /** 마지막으로 크레딧이 0이 아니게 된 뒤, 또는 마지막 쓰기 뒤의 시각 — 크레딧 없이 쓰려면 여기서 1초가 지나야 한다 */
  zeroSince: number
  limit: number
}

describe('AC-N1-71 보내기 — 무작위 알림·끊김 열', () => {
  for (const [profile, label, lengths] of [
    [MARKLIFE_S2, 'S2 (YXQ)', { min: 8, max: 120 }],
    [MARKLIFE_P12, 'P12 (L11·돌림)', { min: 8, max: 120 }],
  ] as const) {
    it(`${label}: 조각 크기·크레딧 규칙·AA 없이 OK 없음·남은 타이머 없음`, async () => {
      const outcomes = new Map<string, number>()
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: lengths.min, max: lengths.max }),
          fc.integer(),
          fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 255 })),
          fc.array(stepArb, { minLength: 0, maxLength: 60 }),
          async (length, seed, initialCredit, steps) => {
            const timer = new StepTimer()
            const ble = new ManualBle({
              name: `${profile.namePrefix as string}AB12`,
              timer,
              onFlowStart: initialCredit === null ? [] : [[0x01, initialCredit]],
            })
            const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer })
            expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
            expect(adapter.profile.id).toBe(profile.id)
            const img = image(profile, length, seed)
            const job = buildPrintJob(profile, img)
            if (!job.ok) throw new Error(job.code)

            const model: Model = { credits: Math.min(4, initialCredit ?? 0), zeroSince: 0, limit: 90 }
            let checked = 0
            let firstWriteAt: number | undefined
            let firstAaAfterWrite: number | undefined
            let droppedAt: number | undefined
            /** 알림이 오기 전까지의 쓰기를 모델로 대조한다 */
            const checkWrites = (): void => {
              for (; checked < ble.writes.length; checked++) {
                const w = ble.writes[checked] as { at: number; bytes: Uint8Array }
                firstWriteAt ??= w.at
                expect(w.bytes.length, `조각 ${checked} 크기`).toBeLessThanOrEqual(90)
                expect(w.bytes.length, `조각 ${checked} MTU`).toBeLessThanOrEqual(model.limit)
                if (model.credits > 0) model.credits--
                else expect(w.at - model.zeroSince, `조각 ${checked}: 크레딧 없이 쓰려면 1초 기다림`).toBeGreaterThanOrEqual(1000)
                model.zeroSince = w.at
              }
            }
            let result: PrinterResult | undefined
            void adapter.print(img).then((r) => {
              result = r
            })
            await flush()
            checkWrites()
            for (const { delay, ev } of steps) {
              if (result) break
              // 쓰기 사이마다 모델을 맞춘다 — 타이머를 조금씩 돌린다
              for (let left = delay; left > 0; left -= 10) {
                await timer.advance(Math.min(10, left))
                checkWrites()
              }
              await flush()
              checkWrites()
              if (result) break
              switch (ev.t) {
                case 'credit':
                  if (ble.connected) model.credits = Math.min(4, model.credits + ev.n)
                  ble.sendFlow([0x01, ev.n])
                  break
                case 'mtu':
                  if (ble.connected && ev.v > 3) model.limit = Math.min(model.limit, ev.v - 3)
                  ble.sendFlow([0x02, ev.v & 0xff, (ev.v >> 8) & 0xff])
                  break
                case 'aa':
                  if (ble.connected && firstWriteAt !== undefined) firstAaAfterWrite ??= timer.now
                  ble.sendNotify([0xaa])
                  break
                case 'other':
                  ble.sendNotify(ev.bytes)
                  break
                case 'flowJunk':
                  ble.sendFlow(ev.bytes)
                  break
                case 'drop':
                  if (ble.connected) droppedAt ??= timer.now
                  ble.drop()
                  break
              }
              await flush()
              checkWrites()
            }
            // 끝까지 돌린다 (20초 시간 초과가 넉넉히 지나게)
            for (let i = 0; i < 260 && !result; i++) {
              await timer.advance(100)
              checkWrites()
            }
            expect(result, '출력이 끝나지 않았다').toBeDefined()
            const r = result as PrinterResult
            outcomes.set(r.ok ? 'OK' : r.error.code, (outcomes.get(r.ok ? 'OK' : r.error.code) ?? 0) + 1)
            const joined = ble.joined()
            const allWritten = Buffer.from(joined).equals(Buffer.from(job.bytes))
            if (r.ok) {
              // AA 없이 OK가 되지 않는다 · 이어 붙인 조각 = 작업 바이트
              expect(firstAaAfterWrite, 'AA 없이 출력 OK').toBeDefined()
              expect(allWritten, '이어 붙인 조각 = 작업 바이트').toBe(true)
              expect(droppedAt === undefined || droppedAt >= (firstAaAfterWrite as number)).toBe(true)
              expect(adapter.state).toBe(ble.connected ? 'CONNECTED' : 'DISCONNECTED')
            } else if (r.error.code === 'DISCONNECTED') {
              expect(droppedAt, '끊기지 않았는데 DISCONNECTED').toBeDefined()
              expect(adapter.state).toBe('DISCONNECTED')
            } else {
              expect(r.error.code).toBe('TIMEOUT')
              expect(droppedAt, '끊겼는데 TIMEOUT').toBeUndefined()
              expect(timer.now).toBeGreaterThanOrEqual(20_000)
              // 시간 초과가 맞다: 20초 전에 (AA + 모든 조각)이 갖춰지지 않았다
              expect(firstAaAfterWrite === undefined || !allWritten || (ble.writes.at(-1)?.at ?? 0) >= 20_000 || (firstAaAfterWrite as number) >= 20_000).toBe(true)
              expect(adapter.state).toBe('CONNECTED')
            }
            // 출력이 끝나면 남은 타이머가 없다
            await flush()
            expect(timer.pending, '남은 타이머').toBe(0)
            // 끝난 뒤에는 쓰기가 더 없다
            const n = ble.writes.length
            await timer.advance(5000)
            expect(ble.writes.length).toBe(n)
          },
        ),
        { numRuns: 150, seed: 0x4e3171 },
      )
      // 세 결과가 모두 나와야 공격이 의미 있다
      expect(outcomes.get('OK') ?? 0).toBeGreaterThan(5)
      expect(outcomes.get('DISCONNECTED') ?? 0).toBeGreaterThan(5)
      expect(outcomes.get('TIMEOUT') ?? 0).toBeGreaterThan(5)
    })
  }

  it('크레딧 알림이 MTU·끝 알림과 같은 틈에 겹쳐도 OK 바이트는 작업 바이트 그대로 (AA를 마지막 조각 쓰기 전에 받음)', async () => {
    const timer = new StepTimer()
    const ble = new ManualBle({ name: 'S2_X', timer, onFlowStart: [[0x01, 0x04], [0x02, 0x40, 0x00]] })
    const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer })
    await adapter.connect('bluetooth')
    const img = image(MARKLIFE_S2, 60, 7)
    const job = buildPrintJob(MARKLIFE_S2, img)
    if (!job.ok) throw new Error(job.code)
    let result: PrinterResult | undefined
    void adapter.print(img).then((r) => (result = r))
    await timer.advance(200)
    // 첫 크레딧 4 → 조각 4개(30ms 간격)에서 멈춘다
    expect(ble.writes.length).toBe(4)
    expect(ble.writes.every((w) => w.bytes.length <= 61)).toBe(true)
    ble.sendNotify([0xaa])
    for (let i = 0; i < 400 && !result; i++) {
      ble.sendFlow([0x01, 0x01])
      await timer.advance(30)
    }
    expect(result).toEqual({ ok: true })
    expect(Buffer.from(ble.joined()).equals(Buffer.from(job.bytes))).toBe(true)
    expect(timer.pending).toBe(0)
  })
})
