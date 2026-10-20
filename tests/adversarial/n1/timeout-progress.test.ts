// N1 적대 테스트 (test-domain): 시간 초과는 "진행이 멈춘 20초" (AC-N1-71·45·41·42, LABEL_RULES L-12 4·5·7, D-N1-12·13).
// 속성(AC-N1-71): 조각 수·MTU·크레딧(넉넉히·늦게·조금·없음)·꾸러미 A/C·느린 쓰기·쓰기 멈춤 위치(끝나지 않음·20초 경계 ±1ms·무작위)·
// `AA`(없음·출력 전·마지막 쓰기 뒤 d ms·보내는 중)·잡음 알림(크레딧·`55`·같은 MTU)을 섞는다. 관찰한 쓰기 시작·끝 시각만으로:
//   - TIMEOUT은 마지막으로 쓰기가 끝난 때(없으면 출력 시작)부터 정확히 20,000ms 뒤에만 난다
//   - TIMEOUT이면 그때 쓰기가 끝나지 않은 채였거나, 모든 조각을 다 쓰고 `AA`를 기다리던 중이다 (조각을 안 보내고 멈춰 있지 않다)
//   - 출력 OK면 (마지막 조각 쓰기 끝, 이번 출력의 `AA`) 둘 다 갖춰진 바로 그 순간이고, 그 전에 진행 없이 20초가 지난 적이 없다
//   - 조각 간격은 앞 쓰기가 끝난 때부터 30ms(꾸러미 C) · 30~1,030ms(꾸러미 A) · 크레딧이 전혀 없으면 정확히 1,030ms(첫 조각 1,000ms)
//   - 결과 뒤에는 쓰기가 없고, 멈춘 쓰기가 늦게 끝나도 결과·상태가 그대로이며 남은 타이머가 없다
// 장면: AC-N1-45의 수치(22,940·48,830·45,290·65,290ms), 아주 큰 작업(1바이트 조각 19,233개 · 크레딧 없음 ≈ 5.5시간),
// 멈춘 쓰기 중 잡음 알림·끊김·판매자 끊기, 경계 ±1ms, 실행기 재시도에서 같은 라벨이 두 번 나오지 않음(L-8 3, D-P1-09).
import { createBitmap, setPixel, type LabelBitmap } from '@livejjim/label'
import {
  BAUATO_PPA2L,
  EXPERIMENTAL_PROFILES,
  MARKLIFE_P12,
  MARKLIFE_P50,
  MARKLIFE_PROFILES,
  MARKLIFE_S2,
  buildPrintJob,
  createFakeBluetooth,
  createMarklifeAdapter,
  createPrintRunner,
  type ModelProfile,
  type NewJob,
  type PrinterResult,
} from '@livejjim/printer'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ManualBle, StepTimer, flush, type Write, type WriteLatency } from './ble-mock.ts'

const ALL = [...MARKLIFE_PROFILES, ...EXPERIMENTAL_PROFILES]
/** 진행 없이 기다리는 시간 (L-12 5) */
const LIMIT = 20_000

/** 384점 프로필은 384 × length, 테이프(돌림)는 length × 96 */
function image(profile: ModelProfile, length: number, seed: number, noisy: boolean): LabelBitmap {
  const img = profile.rotate === 'CW90' ? createBitmap(length, 96) : createBitmap(384, length)
  if (!noisy) return img
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

const nameOf = (profile: ModelProfile): string => `${profile.namePrefix as string}AB12`

type CreditMode = 'none' | 'plenty' | 'late' | 'stingy'
type AaPlan = { readonly kind: 'none' } | { readonly kind: 'beforePrint' } | { readonly kind: 'afterLast'; readonly d: number } | { readonly kind: 'early'; readonly k: number }
type StallHow = { readonly kind: 'never' } | { readonly kind: 'boundary'; readonly delta: number } | { readonly kind: 'latency'; readonly ms: number }
type Noise = 'none' | 'credit0' | 'credit1' | 'notify55' | 'mtuSame'

interface Scenario {
  readonly profile: ModelProfile
  readonly bundle: 'A' | 'C'
  readonly length: number
  readonly noisy: boolean
  readonly seed: number
  /** 연결할 때 보내는 MTU 알림 (꾸러미 A만) */
  readonly mtu: number | null
  readonly credit: CreditMode
  readonly creditDelay: number
  /** 느린 쓰기 (index는 조각 수로 나눈 나머지) */
  readonly slow: readonly { readonly index: number; readonly ms: number }[]
  readonly stall: { readonly index: number; readonly how: StallHow } | null
  readonly aa: AaPlan
  readonly noise: Noise
}

type Kind = 'OK' | 'TIMEOUT_SENDING' | 'TIMEOUT_AA'

interface RunInfo {
  readonly kind: Kind
  readonly tie: boolean
  readonly chunks: number
  /** 출력 시작부터 마지막 조각의 쓰기가 끝날 때까지 (다 못 썼으면 undefined) */
  readonly span: number | undefined
}

/**
 * 장면 하나를 돌리고 관찰한 쓰기 시각으로 시간 초과 규칙을 검사한다.
 * 크레딧이 전혀 없고(잡음 크레딧도 없음) 꾸러미 A면 간격까지 정확히 본다.
 */
async function runScenario(sc: Scenario, maxChunks = 2500): Promise<RunInfo | undefined> {
  const timer = new StepTimer()
  const img = image(sc.profile, sc.length, sc.seed, sc.noisy)
  const built = buildPrintJob(sc.profile, img)
  if (!built.ok) throw new Error(built.code)
  const job = built.bytes
  const flowA = sc.bundle === 'A'
  const packet = flowA && sc.mtu !== null && sc.mtu > 3 ? Math.min(90, sc.mtu - 3) : 90
  const chunks = Math.ceil(job.length / packet)
  if (chunks > maxChunks) return undefined

  const flowStart: number[][] = []
  if (flowA) {
    if (sc.credit === 'plenty' || sc.credit === 'late') flowStart.push([0x01, 0x04])
    if (sc.credit === 'stingy') flowStart.push([0x01, 0x01])
    if (sc.mtu !== null) flowStart.push([0x02, sc.mtu & 0xff, (sc.mtu >> 8) & 0xff])
  }

  let result: PrinterResult | undefined
  let resultAt = -1
  let printing = false
  /** 마지막 진행(출력 시작 또는 쓰기 끝) 시각 — 멈춤의 경계 지연을 계산할 때만 쓴다 */
  let lastProgress = 0
  let issuedBytes = 0
  const issuedAt: number[] = []
  const aaLog: { at: number; counted: boolean }[] = []
  const stallIndex = sc.stall ? sc.stall.index % chunks : -1
  const slow = new Map(sc.slow.map((s) => [s.index % chunks, s.ms] as const))

  // 콜백은 ble를 만든 뒤에만 불린다
  const sendAA = (): void => {
    if (!ble.connected) return
    aaLog.push({ at: timer.now, counted: printing && ble.writes.length > 0 })
    ble.sendNotify([0xaa])
  }
  const writeLatency = (index: number, w: Write): WriteLatency => {
    issuedBytes += w.bytes.length
    issuedAt[index] = issuedBytes
    if (index === stallIndex && sc.stall) {
      const how = sc.stall.how
      if (how.kind === 'never') return 'stall'
      if (how.kind === 'boundary') return Math.max(1, lastProgress + LIMIT + how.delta - w.at)
      return how.ms
    }
    return slow.get(index)
  }
  const onWriteEnd = (index: number): void => {
    if (result) return
    lastProgress = timer.now
    if (flowA) {
      if (sc.credit === 'plenty') ble.sendFlow([0x01, 0x01])
      else if (sc.credit === 'late') timer.schedule(() => ble.sendFlow([0x01, 0x01]), sc.creditDelay)
      else if (sc.credit === 'stingy' && index % 2 === 0) ble.sendFlow([0x01, 0x01])
    }
    if (sc.aa.kind === 'early' && index === sc.aa.k % chunks) sendAA()
    if (sc.aa.kind === 'afterLast' && issuedAt[index] === job.length) {
      if (sc.aa.d === 0) sendAA()
      else timer.schedule(sendAA, sc.aa.d)
    }
  }
  const ble = new ManualBle({ name: nameOf(sc.profile), bundle: sc.bundle, timer, onFlowStart: flowStart, writeLatency, onWriteEnd })
  const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer, profiles: ALL })
  expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
  expect(adapter.profile.id).toBe(sc.profile.id)
  expect(adapter.bundle).toBe(sc.bundle)

  if (sc.noise !== 'none') {
    const tick = (): void => {
      if (result) return
      if (sc.noise === 'credit0') ble.sendFlow([0x01, 0x00])
      else if (sc.noise === 'credit1') ble.sendFlow([0x01, 0x01])
      else if (sc.noise === 'notify55') ble.sendNotify([0x55])
      else ble.sendFlow([0x02, (sc.mtu ?? 200) & 0xff, ((sc.mtu ?? 200) >> 8) & 0xff])
      timer.schedule(tick, 700)
    }
    timer.schedule(tick, 350)
  }

  if (sc.aa.kind === 'beforePrint') sendAA()
  const printStart = timer.now
  lastProgress = printStart
  printing = true
  void adapter.print(img).then((r) => {
    result = r
    resultAt = timer.now
  })
  const cap = printStart + 200_000 + chunks * 1_100
  while (!result && timer.now < cap) await timer.advance(5_000)
  expect(result, '출력이 끝나지 않았다').toBeDefined()
  const r = result as PrinterResult
  const R = resultAt
  const writes = ble.writes

  // 조각 간격 (L-12 4, D-N1-13): 앞 쓰기가 끝난 때부터 센다. 쓰기는 하나씩만 한다
  const exactNoCredit = flowA && sc.credit === 'none' && sc.noise !== 'credit1'
  for (let k = 0; k < writes.length; k++) {
    const w = writes[k] as Write
    expect(w.bytes.length, `조각 ${String(k)} 크기`).toBeLessThanOrEqual(packet)
    if (k === 0) {
      const gap = w.at - printStart
      if (!flowA) expect(gap, '첫 조각(꾸러미 C)').toBe(0)
      else if (exactNoCredit) expect(gap, '첫 조각(크레딧 없음)').toBe(1000)
      else {
        expect(gap).toBeGreaterThanOrEqual(0)
        expect(gap).toBeLessThanOrEqual(1000)
      }
      continue
    }
    const prev = writes[k - 1] as Write
    expect(prev.endAt, `조각 ${String(k)}: 앞 쓰기가 끝나기 전에 썼다`).toBeDefined()
    const gap = w.at - (prev.endAt as number)
    if (!flowA) expect(gap, `조각 ${String(k)} 간격(꾸러미 C)`).toBe(30)
    else if (exactNoCredit) expect(gap, `조각 ${String(k)} 간격(크레딧 없음 — 1,030ms)`).toBe(1030)
    else {
      expect(gap, `조각 ${String(k)} 간격`).toBeGreaterThanOrEqual(30)
      expect(gap, `조각 ${String(k)} 간격`).toBeLessThanOrEqual(1030)
    }
  }
  // 결과 뒤에는 쓰기를 시작하지 않는다
  expect(writes.filter((w) => w.at > R), '결과 뒤 쓰기').toHaveLength(0)

  const progress = [printStart, ...writes.map((w) => w.endAt).filter((t): t is number => t !== undefined)].sort((a, b) => a - b)
  const finalIndex = issuedAt.findIndex((n) => n === job.length)
  const finalEnd = finalIndex >= 0 ? writes[finalIndex]?.endAt : undefined
  const firstAa = aaLog.find((a) => a.counted)?.at
  const done = finalEnd !== undefined && firstAa !== undefined ? Math.max(finalEnd, firstAa) : undefined
  const maxGap = (ps: readonly number[]): number => ps.slice(1).reduce((m, p, i) => Math.max(m, p - (ps[i] as number)), 0)

  let kind: Kind
  let tie: boolean
  if (r.ok) {
    expect(done, 'AA와 마지막 쓰기 끝 없이 출력 OK').toBeDefined()
    expect(R, '출력 OK는 (마지막 쓰기 끝, AA)가 갖춰진 순간').toBe(done)
    const ps = progress.filter((p) => p <= R)
    expect(maxGap(ps), '진행 없이 20초가 지났는데 OK').toBeLessThanOrEqual(LIMIT)
    expect(R - (ps.at(-1) as number), '마지막 진행 뒤 20초가 지났는데 OK').toBeLessThanOrEqual(LIMIT)
    tie = maxGap(ps) === LIMIT || R - (ps.at(-1) as number) === LIMIT
    expect(Buffer.from(ble.joined()).equals(Buffer.from(job)), '이어 붙인 조각 = 작업 바이트').toBe(true)
    kind = 'OK'
  } else {
    expect(r.error.code, '끊김 없는 장면의 결과').toBe('TIMEOUT')
    const ps = progress.filter((p) => p < R)
    const last = ps.at(-1) as number
    expect(R - last, 'TIMEOUT은 마지막 진행(쓰기 끝·출력 시작)부터 정확히 20,000ms').toBe(LIMIT)
    expect(maxGap(ps), '그 전에 진행 없이 20초가 지났다 — 더 일찍 TIMEOUT이어야').toBeLessThanOrEqual(LIMIT)
    expect(done === undefined || done >= R, '출력 OK가 될 수 있었는데 TIMEOUT').toBe(true)
    const lastIssued = writes.at(-1)
    const waitingForWrite = lastIssued !== undefined && (lastIssued.endAt === undefined || lastIssued.endAt >= R)
    const waitingForAa = finalEnd !== undefined && finalEnd < R
    expect(waitingForWrite || waitingForAa, 'TIMEOUT인데 쓰기도 멈추지 않았고 다 보내지도 않았다(조각을 안 보내고 멈춤)').toBe(true)
    tie = done === R || writes.some((w) => w.endAt === R)
    kind = waitingForWrite ? 'TIMEOUT_SENDING' : 'TIMEOUT_AA'
  }
  expect(adapter.state).toBe('CONNECTED')
  await flush()
  expect(timer.pending, '남은 타이머').toBe(0)
  // 멈춘 쓰기가 늦게 끝나도, 늦은 AA가 와도 결과·상태가 그대로이고 더 쓰지 않는다
  const n = writes.length
  ble.release()
  sendAA()
  await timer.advance(60_000)
  expect(writes.length, '결과 뒤 쓰기').toBe(n)
  expect(result).toBe(r)
  expect(adapter.state).toBe('CONNECTED')
  expect(timer.pending, '남은 타이머').toBe(0)
  return { kind, tie, chunks, span: finalEnd === undefined ? undefined : finalEnd - printStart }
}

const stallHowArb: fc.Arbitrary<StallHow> = fc.oneof(
  { weight: 3, arbitrary: fc.constant({ kind: 'never' as const }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('boundary' as const), delta: fc.constantFrom(-1, 0, 1) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('latency' as const), ms: fc.integer({ min: 0, max: 45_000 }) }) },
)

const aaArb: fc.Arbitrary<AaPlan> = fc.oneof(
  { weight: 2, arbitrary: fc.constant({ kind: 'none' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'beforePrint' as const }) },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant('afterLast' as const), d: fc.oneof(fc.constantFrom(0, 1, 19_999, 20_000, 20_001), fc.integer({ min: 0, max: 30_000 })) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('early' as const), k: fc.nat() }) },
)

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    profile: fc.constantFrom(MARKLIFE_S2, MARKLIFE_P50, MARKLIFE_P12, BAUATO_PPA2L),
    bundle: fc.constantFrom('A' as const, 'A' as const, 'C' as const),
    length: fc.oneof(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 400 })),
    noisy: fc.boolean(),
    seed: fc.integer(),
    mtu: fc.oneof({ weight: 2, arbitrary: fc.constant(null) }, { weight: 2, arbitrary: fc.constant(23) }, { weight: 3, arbitrary: fc.integer({ min: 4, max: 130 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 3 }) }),
    credit: fc.constantFrom<CreditMode>('none', 'plenty', 'late', 'stingy'),
    creditDelay: fc.oneof(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 2_500 })),
    slow: fc.array(fc.record({ index: fc.nat(), ms: fc.oneof(fc.integer({ min: 1, max: 300 }), fc.integer({ min: 15_000, max: 19_999 }), fc.integer({ min: 0, max: 40_000 })) }), { maxLength: 3 }),
    stall: fc.option(fc.record({ index: fc.nat(), how: stallHowArb }), { freq: 2 }),
    aa: aaArb,
    noise: fc.constantFrom<Noise>('none', 'none', 'credit0', 'credit1', 'notify55', 'mtuSame'),
  })
  // 테이프 프린터는 그림 폭이 곧 길이다 — 너무 긴 테이프는 줄인다
  .map((sc) => (sc.profile.rotate === 'CW90' ? { ...sc, length: Math.min(sc.length, 320) } : sc))

describe('AC-N1-71 TIMEOUT은 마지막 쓰기가 끝나고 정확히 20초 뒤에만 (속성, D-N1-12·13)', () => {
  it('조각 수·MTU·크레딧·꾸러미·느린 쓰기·멈춤 위치·AA 유무를 섞어도 시간 초과는 진행이 멈춘 20초뿐', async () => {
    const kinds = new Map<string, number>()
    let ties = 0
    let bigJobs = 0
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (sc) => {
        const info = await runScenario(sc)
        fc.pre(info !== undefined)
        if (!info) return
        kinds.set(info.kind, (kinds.get(info.kind) ?? 0) + 1)
        if (info.tie) ties++
        // 보내는 데만 20초가 넘게 걸리고도 출력 OK인 작업 (옛 규칙 "출력 시작 20초"면 TIMEOUT → 같은 라벨 두 장)
        if (info.kind === 'OK' && info.span !== undefined && info.span > LIMIT) bigJobs++
      }),
      { numRuns: 300, seed: 0x4e3712 },
    )
    // 공격이 의미 있으려면 세 결과와 큰 작업이 모두 나와야 한다
    expect(kinds.get('OK') ?? 0).toBeGreaterThan(20)
    expect(kinds.get('TIMEOUT_SENDING') ?? 0).toBeGreaterThan(20)
    expect(kinds.get('TIMEOUT_AA') ?? 0).toBeGreaterThan(20)
    expect(bigJobs).toBeGreaterThan(15)
    expect(ties).toBeGreaterThan(0)
  })

  it('고정 반례 모음 — 멈춤이 첫 조각·마지막 조각, 크레딧 없는 첫 조각 멈춤, 경계 ±1ms', async () => {
    const base: Scenario = {
      profile: MARKLIFE_P12,
      bundle: 'A',
      length: 320,
      noisy: false,
      seed: 1,
      mtu: null,
      credit: 'plenty',
      creditDelay: 0,
      slow: [],
      stall: null,
      aa: { kind: 'afterLast', d: 0 },
      noise: 'none',
    }
    const cases: [string, Partial<Scenario>, Kind][] = [
      ['첫 조각이 멈춤 → 출력 시작 20초', { stall: { index: 0, how: { kind: 'never' } } }, 'TIMEOUT_SENDING'],
      ['크레딧 없고 첫 조각(1,000ms)이 멈춤 → 그래도 출력 시작 20초', { credit: 'none', stall: { index: 0, how: { kind: 'never' } } }, 'TIMEOUT_SENDING'],
      ['마지막 조각이 멈춤, AA는 이미 옴', { stall: { index: 43, how: { kind: 'never' } }, aa: { kind: 'early', k: 10 } }, 'TIMEOUT_SENDING'],
      ['멈춘 쓰기가 앞 쓰기 끝 + 19,999ms에 끝남 → 이어서 보냄', { stall: { index: 20, how: { kind: 'boundary', delta: -1 } } }, 'OK'],
      ['멈춘 쓰기가 앞 쓰기 끝 + 20,001ms에 끝남 → TIMEOUT', { stall: { index: 20, how: { kind: 'boundary', delta: 1 } } }, 'TIMEOUT_SENDING'],
      ['AA가 마지막 쓰기 끝 + 19,999ms', { aa: { kind: 'afterLast', d: 19_999 } }, 'OK'],
      ['AA가 마지막 쓰기 끝 + 20,001ms', { aa: { kind: 'afterLast', d: 20_001 } }, 'TIMEOUT_AA'],
      ['크레딧 없는 기기(1.03초 간격) 44조각 + AA', { credit: 'none' }, 'OK'],
      ['크레딧 없는 기기 44조각, AA 없음', { credit: 'none', aa: { kind: 'none' } }, 'TIMEOUT_AA'],
      ['멈춘 쓰기 중 크레딧 잡음 `01 01`', { stall: { index: 5, how: { kind: 'never' } }, noise: 'credit1' }, 'TIMEOUT_SENDING'],
      ['멈춘 쓰기 중 `55` 잡음', { stall: { index: 5, how: { kind: 'never' } }, noise: 'notify55' }, 'TIMEOUT_SENDING'],
      ['멈춘 쓰기 중 같은 MTU 알림', { stall: { index: 5, how: { kind: 'never' } }, noise: 'mtuSame', mtu: 93 }, 'TIMEOUT_SENDING'],
      ['꾸러미 C, 앞 쓰기 끝부터 19,999ms에 끝나는 쓰기 두 번(30ms 쉼 + 19,969ms)', { bundle: 'C', slow: [{ index: 3, ms: 19_969 }, { index: 30, ms: 19_969 }] }, 'OK'],
      ['꾸러미 C, 앞 쓰기 끝부터 20,001ms에 끝나는 쓰기(30ms 쉼 + 19,971ms)', { bundle: 'C', slow: [{ index: 3, ms: 19_971 }] }, 'TIMEOUT_SENDING'],
    ]
    for (const [what, patch, want] of cases) {
      const info = await runScenario({ ...base, ...patch })
      expect(info?.kind, what).toBe(want)
    }
  })
})

/** 조각마다 크레딧을 돌려주고, 연결할 때 MTU를 알리는 기기 */
async function connectManual(profile: ModelProfile, opts: { mtu?: number; credits?: boolean; writeLatency?: (i: number, w: Write) => WriteLatency } = {}) {
  const timer = new StepTimer()
  const credits = opts.credits ?? true
  const flowStart: number[][] = credits ? [[0x01, 0x04]] : []
  if (opts.mtu !== undefined) flowStart.push([0x02, opts.mtu & 0xff, (opts.mtu >> 8) & 0xff])
  const ble: ManualBle = new ManualBle({
    name: nameOf(profile),
    timer,
    onFlowStart: flowStart,
    ...(opts.writeLatency ? { writeLatency: opts.writeLatency } : {}),
    onWriteEnd: () => {
      if (credits) ble.sendFlow([0x01, 0x01])
    },
  })
  const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer, profiles: ALL })
  expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
  return { timer, ble, adapter }
}

describe('AC-N1-45 진행이 멈춘 20초 — 수치 그대로', () => {
  const bauato50 = (): LabelBitmap => createBitmap(384, 400)

  it('바우아토 50×50 · MTU 23: 962조각, 마지막 조각 28,830ms, AA 없으면 48,830ms에 TIMEOUT(48,829ms엔 PRINTING)', async () => {
    const { timer, ble, adapter } = await connectManual(BAUATO_PPA2L, { mtu: 23 })
    const job = buildPrintJob(BAUATO_PPA2L, bauato50())
    if (!job.ok) throw new Error(job.code)
    expect(job.bytes.length).toBe(19_233)
    let result: PrinterResult | undefined
    void adapter.print(bauato50()).then((r) => (result = r))
    await timer.advance(48_829)
    expect(ble.writes).toHaveLength(962)
    expect(ble.writes.every((w) => w.bytes.length <= 20)).toBe(true)
    expect(ble.writes.at(-1)?.at).toBe(28_830)
    expect(result).toBeUndefined()
    expect(adapter.state).toBe('PRINTING')
    await timer.advance(1)
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
    expect(adapter.state).toBe('CONNECTED')
    expect(timer.pending).toBe(0)
  })

  it('같은 작업에서 100번째 조각이 멈추면 22,940ms에 TIMEOUT, 그 뒤 멈춘 쓰기가 끝나도 결과는 그대로이고 101번째를 쓰지 않는다', async () => {
    const { timer, ble, adapter } = await connectManual(BAUATO_PPA2L, { mtu: 23, writeLatency: (i) => (i === 99 ? 'stall' : undefined) })
    let result: PrinterResult | undefined
    void adapter.print(bauato50()).then((r) => (result = r))
    await timer.advance(22_939)
    expect(ble.writes).toHaveLength(100)
    expect(ble.writes[98]?.endAt).toBe(2_940)
    expect(result).toBeUndefined()
    await timer.advance(1)
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
    ble.release()
    await timer.advance(5_000)
    expect(ble.writes).toHaveLength(100)
    expect(adapter.state).toBe('CONNECTED')
    expect(timer.pending).toBe(0)
  })

  it('크레딧 없는 기기 · P12 테이프 12×40(44조각): 첫 1,000ms, 마지막 45,290ms, AA 없으면 65,290ms에 TIMEOUT', async () => {
    const { timer, ble, adapter } = await connectManual(MARKLIFE_P12, { credits: false })
    const img = createBitmap(320, 96)
    let result: PrinterResult | undefined
    void adapter.print(img).then((r) => (result = r))
    await timer.advance(65_289)
    expect(ble.writes).toHaveLength(44)
    expect(ble.writes[0]?.at).toBe(1_000)
    expect(ble.writes.at(-1)?.at).toBe(45_290)
    expect(result).toBeUndefined()
    await timer.advance(1)
    expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
  })
})

describe('L-12 5 새 규칙의 구멍 — 멈춘 쓰기·아주 큰 작업·다시 거는 경계', () => {
  it('아주 큰 작업: 바우아토 50×50을 1바이트 조각(MTU 4) 19,233개로, 크레딧 없이(1.03초 간격 ≈ 5.5시간) — TIMEOUT 없이 끝까지, 타이머가 쌓이지 않는다', async () => {
    const timer = new StepTimer()
    const img = createBitmap(384, 400)
    for (let x = 0; x < 384; x += 7) setPixel(img, x, x % 400, true)
    const job = buildPrintJob(BAUATO_PPA2L, img)
    if (!job.ok) throw new Error(job.code)
    let sent = 0
    const ble: ManualBle = new ManualBle({
      name: 'PPA2L_1234',
      timer,
      onFlowStart: [[0x02, 0x04, 0x00]],
      // 다 받으면 19,999ms 뒤에 AA (경계 바로 안쪽)
      onWriteEnd: (_i, w) => {
        sent += w.bytes.length
        if (sent === job.bytes.length) timer.schedule(() => ble.sendNotify([0xaa]), 19_999)
      },
    })
    const adapter = createMarklifeAdapter({ environment: () => ble.environment, timer, profiles: ALL })
    expect(await adapter.connect('bluetooth')).toEqual({ ok: true })
    let result: PrinterResult | undefined
    void adapter.print(img).then((r) => (result = r))
    const lastAt = 1_000 + (19_233 - 1) * 1_030
    while (!result && timer.now < lastAt + 40_000) await timer.advance(600_000)
    expect(result).toEqual({ ok: true })
    expect(ble.writes).toHaveLength(19_233)
    expect(ble.writes.every((w) => w.bytes.length === 1)).toBe(true)
    expect(ble.writes.at(-1)?.at).toBe(lastAt)
    expect(Buffer.from(ble.joined()).equals(Buffer.from(job.bytes))).toBe(true)
    // 다시 걸 때마다 앞 타이머를 지운다 — 어댑터의 타이머가 쌓이지 않는다
    expect(timer.maxPending).toBeLessThanOrEqual(3)
    expect(timer.pending).toBe(0)
  })

  it('멈춘 쓰기 중 연결이 끊기면 20초를 기다리지 않고 바로 DISCONNECTED, 상태도 끊김', async () => {
    const { timer, ble, adapter } = await connectManual(MARKLIFE_S2, { writeLatency: (i) => (i === 2 ? 'stall' : undefined) })
    const img = image(MARKLIFE_S2, 120, 3, true)
    let result: PrinterResult | undefined
    void adapter.print(img).then((r) => (result = r))
    await timer.advance(5_000)
    expect(ble.writes).toHaveLength(3)
    expect(result).toBeUndefined()
    ble.drop()
    await flush()
    expect(result).toMatchObject({ ok: false, error: { code: 'DISCONNECTED', action: '다시 연결' } })
    expect(adapter.state).toBe('DISCONNECTED')
    expect(timer.pending).toBe(0)
  })

  it('멈춘 쓰기 중 판매자가 연결 끊기 → 바로 DISCONNECTED, 남은 타이머 없음', async () => {
    const { timer, ble, adapter } = await connectManual(MARKLIFE_S2, { writeLatency: (i) => (i === 1 ? 'stall' : undefined) })
    let result: PrinterResult | undefined
    void adapter.print(image(MARKLIFE_S2, 120, 5, true)).then((r) => (result = r))
    await timer.advance(3_000)
    await adapter.disconnect()
    await flush()
    expect(result).toMatchObject({ ok: false, error: { code: 'DISCONNECTED' } })
    expect(adapter.state).toBe('DISCONNECTED')
    expect(ble.connected).toBe(false)
    expect(timer.pending).toBe(0)
  })

  it('멈춘 쓰기로 TIMEOUT이 난 뒤 같은 연결로 다시 출력하면 처음 바이트부터 새로 보내고 OK (멈춘 쓰기는 아직 안 끝남)', async () => {
    const { timer, ble, adapter } = await connectManual(MARKLIFE_S2, { writeLatency: (i) => (i === 4 ? 'stall' : undefined) })
    const img = image(MARKLIFE_S2, 120, 9, true)
    const job = buildPrintJob(MARKLIFE_S2, img)
    if (!job.ok) throw new Error(job.code)
    let first: PrinterResult | undefined
    void adapter.print(img).then((r) => (first = r))
    await timer.advance(30_000)
    expect(first).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
    expect(ble.writes[3]?.endAt).toBe(90)
    const from = ble.writes.length
    let second: PrinterResult | undefined
    void adapter.print(img).then((r) => (second = r))
    for (let i = 0; i < 200 && !(ble.joined(from).length === job.bytes.length); i++) await timer.advance(50)
    expect(Buffer.from(ble.joined(from)).equals(Buffer.from(job.bytes))).toBe(true)
    expect(second).toBeUndefined()
    ble.sendNotify([0xaa])
    await flush()
    expect(second).toEqual({ ok: true })
    // 앞 출력의 멈춘 쓰기가 이제 끝나도 아무 일 없다
    ble.release()
    await timer.advance(25_000)
    expect(ble.writes.length - from).toBe(Math.ceil(job.bytes.length / 90))
    expect(adapter.state).toBe('CONNECTED')
    expect(timer.pending).toBe(0)
  })
})

describe('L-8 3 · D-P1-09 재시도 — 같은 라벨이 두 번 나오지 않고 빠지지도 않는다 (가짜 기기 + 실행기)', () => {
  const big = (n: number): LabelBitmap => {
    const img = createBitmap(384, 400)
    for (let x = 0; x < 384; x++) setPixel(img, x, (x * 7 + n * 13) % 400, true)
    return img
  }
  const jobOf = (i: number): NewJob => ({ id: `effect-${String(i)}`, labelKey: `claim-${String(i)}@1`, kind: 'product', data: { i }, contentKey: `k-${String(i)}` })
  const render = (job: { readonly data: unknown }) => ({ ok: true as const, image: big((job.data as { i: number }).i) })
  const bytesOf = (i: number): Uint8Array => {
    const r = buildPrintJob(BAUATO_PPA2L, big(i))
    if (!r.ok) throw new Error(r.code)
    return r.bytes
  }
  async function until(timer: StepTimer, done: () => boolean, maxMs = 20_000_000): Promise<void> {
    for (let t = 0; t < maxMs && !done(); t += 60_000) await timer.advance(60_000)
    expect(done()).toBe(true)
  }

  it('크레딧 없는 기기 + MTU 23의 큰 라벨 3장(각 ≈ 990초) — TIMEOUT 없이 한 장씩, 기록된 시도도 3번뿐', async () => {
    const timer = new StepTimer()
    const fake = createFakeBluetooth({ name: 'PPA2L_1234', timer, initialCredits: null, creditsPerPacket: 0, mtu: 23 })
    const adapter = createMarklifeAdapter({ environment: () => fake.environment, timer, profiles: EXPERIMENTAL_PROFILES })
    const runner = createPrintRunner({ adapter, render, clock: () => 0, device: 'PC' })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    for (let i = 1; i <= 3; i++) runner.enqueue(jobOf(i))
    await until(timer, () => runner.state.jobs.every((j) => j.status === 'DONE') || runner.state.paused !== null)
    await runner.idle()
    expect(runner.state.paused).toBeNull()
    expect(runner.state.jobs.map((j) => [j.status, j.attempts, j.lastError])).toEqual([
      ['DONE', 0, null],
      ['DONE', 0, null],
      ['DONE', 0, null],
    ])
    expect(fake.attempts).toHaveLength(3)
    expect(fake.printed).toHaveLength(3)
    fake.printed.forEach((b, i) => expect(Buffer.from(b).equals(Buffer.from(bytesOf(i + 1))), `${String(i + 1)}번째`).toBe(true))
    runner.dispose()
  })

  it('2번째 라벨의 50번째 조각이 멈춤 → TIMEOUT, 프린터 오류 멈춤 → 멈춘 쓰기가 늦게 끝나도 그대로 → 다시 시작하면 2번째부터, 라벨마다 한 장씩', async () => {
    const timer = new StepTimer()
    const fake = createFakeBluetooth({ name: 'PPA2L_1234', timer, mtu: 23, jobs: { 2: { stallWriteAtPacket: 50 } } })
    const adapter = createMarklifeAdapter({ environment: () => fake.environment, timer, profiles: EXPERIMENTAL_PROFILES })
    const runner = createPrintRunner({ adapter, render, clock: () => 0, device: 'PC' })
    expect((await adapter.connect('bluetooth')).ok).toBe(true)
    for (let i = 1; i <= 3; i++) runner.enqueue(jobOf(i))
    await until(timer, () => runner.state.paused !== null)
    expect(runner.state.paused).toBe('PRINTER_ERROR')
    expect(runner.state.jobs[1]).toMatchObject({ status: 'WAITING', attempts: 1, lastError: 'TIMEOUT' })
    expect(fake.printed).toHaveLength(1)
    expect(fake.stalledWrites).toBe(1)
    // 멈춘 쓰기가 늦게 끝나도 어댑터는 더 보내지 않는다
    const packets = fake.packets.length
    fake.releaseStalledWrites()
    await timer.advance(60_000)
    expect(fake.packets.length).toBe(packets)
    expect(adapter.state).toBe('CONNECTED')
    runner.restart()
    await until(timer, () => runner.state.jobs.every((j) => j.status === 'DONE'))
    await runner.idle()
    expect(fake.printed).toHaveLength(3)
    fake.printed.forEach((b, i) => expect(Buffer.from(b).equals(Buffer.from(bytesOf(i + 1))), `${String(i + 1)}번째`).toBe(true))
    expect(fake.attempts.map((a) => [a.complete, a.acked])).toEqual([
      [true, true],
      [false, false],
      [true, true],
      [true, true],
    ])
    expect(fake.attempts[1]?.packets).toHaveLength(49)
    runner.dispose()
  })
})
