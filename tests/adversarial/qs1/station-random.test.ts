// QS1 적대 시험 (test-domain): 출력 기기 + 실제 B1 어댑터 + 가짜 B1 블루투스에 끊김·다시 잇기·"다시 연결"·"연결 끊기"·연결 방법 연결·출력을
// 아무 순서·아무 때(쉬는 1초 안, 각 간격 안 — 판매자 동작은 기다리지 않고도 누른다)에 섞는 속성 시험 (AC-QS1-30, D-QS1-01~03, L-7 "자세히").
// 지키는 것:
//  (1) 같은 때 연결 시도(niimbluelib connect)는 둘이 아니다
//  (2) 고르기 창(requestDevice)은 판매자의 연결 방법 단추·"다시 연결"이 진행 중일 때만 뜬다 — 기억한 기기로만 잇기(저절로)는 부르지 않는다
//  (3) 저절로 잇는 시도는 판매자가 이은 연결·60초 넘게 이어진 연결 사이에 6번 이하 (이었다 끊겼다를 60초 안에 거듭해도)
//  (4) "연결 끊기" 뒤(판매자가 다시 잇기 전)엔 저절로 잇지 않는다
//  (5) 결과를 "출력함"으로 알린 장은 다시 찍지 않는다 · 끊긴 동안 받기(claim)를 하지 않는다
//  (6) getAvailability() false·예외·느림, 고르기 창 닫기를 섞어도 오류 상세는 쉬운 말 고정 문장뿐(원래 예외 글 없음)
import {
  RETRIED_TIMEOUT_DETAIL,
  TIMEOUT_DETAIL,
  createB1Adapter,
  createFakeNiimbotBluetooth,
  type NiimbotClientLike,
  type PrinterEnvironment,
} from '@livejjim/printer'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualTimer, flush, queueOf, rig, type Rig } from './station-helpers.ts'

let current: Rig | null = null
afterEach(() => {
  current?.station.stop()
  current = null
  vi.unstubAllGlobals()
})

type Action =
  | { readonly k: 'drop' }
  | { readonly k: 'power'; readonly on: boolean }
  | { readonly k: 'advance'; readonly ms: number }
  | { readonly k: 'reconnect'; readonly wait: boolean }
  | { readonly k: 'pick'; readonly wait: boolean }
  | { readonly k: 'disconnect'; readonly wait: boolean }
  | { readonly k: 'unanswered'; readonly n: number }
  | { readonly k: 'avail'; readonly mode: 'true' | 'false' | 'throws' | 'slow' }
  | { readonly k: 'chooser'; readonly v: 'pick' | 'cancel' }
  | { readonly k: 'slow'; readonly ms: number }
  | { readonly k: 'job' }
  | { readonly k: 'mine'; readonly on: boolean }

const msArb = fc.oneof(
  fc.constantFrom(0, 1, 500, 999, 1000, 1001, 1999, 2000, 3000, 4000, 7000, 8000, 15000, 16000, 30000, 31000, 59999, 60000, 61000),
  fc.integer({ min: 0, max: 70_000 }),
)

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 3, arbitrary: fc.constant({ k: 'drop' as const }) },
  { weight: 1, arbitrary: fc.boolean().map((on) => ({ k: 'power' as const, on })) },
  { weight: 6, arbitrary: msArb.map((ms) => ({ k: 'advance' as const, ms })) },
  { weight: 2, arbitrary: fc.boolean().map((wait) => ({ k: 'reconnect' as const, wait })) },
  { weight: 1, arbitrary: fc.boolean().map((wait) => ({ k: 'pick' as const, wait })) },
  { weight: 1, arbitrary: fc.boolean().map((wait) => ({ k: 'disconnect' as const, wait })) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 2 }).map((n) => ({ k: 'unanswered' as const, n })) },
  { weight: 1, arbitrary: fc.constantFrom('true', 'false', 'throws', 'slow').map((mode) => ({ k: 'avail' as const, mode })) },
  { weight: 1, arbitrary: fc.constantFrom('pick', 'cancel').map((v) => ({ k: 'chooser' as const, v })) },
  { weight: 1, arbitrary: fc.constantFrom(0, 0, 300, 1500).map((ms) => ({ k: 'slow' as const, ms })) },
  { weight: 2, arbitrary: fc.constant({ k: 'job' as const }) },
  { weight: 1, arbitrary: fc.boolean().map((on) => ({ k: 'mine' as const, on })) },
)

const ALLOWED_DETAIL = (detail: string | undefined): boolean =>
  detail === undefined || detail === TIMEOUT_DETAIL || detail === RETRIED_TIMEOUT_DETAIL || /^모델: [A-Za-z0-9 _-]{1,40}$/.test(detail)

async function run(actions: readonly Action[]): Promise<void> {
  current?.station.stop()
  vi.unstubAllGlobals()
  const timer = new ManualTimer()
  const fake = createFakeNiimbotBluetooth({ timer, negotiationTimeoutMs: 1500 })
  const violations: string[] = []
  let sellerPending = 0
  let availMode: 'true' | 'false' | 'throws' | 'slow' = 'true'
  let slowMs = 0
  let active = 0
  let maxActive = 0
  const inner = fake.environment.bluetooth as NonNullable<PrinterEnvironment['bluetooth']> & { requestDevice: (o: unknown) => Promise<unknown> }
  const bluetooth = {
    requestDevice: (options: unknown): Promise<unknown> => {
      if (sellerPending === 0) violations.push('판매자 동작 없이 고르기 창')
      return inner.requestDevice(options)
    },
    getAvailability: (): Promise<boolean> => {
      if (availMode === 'throws') return Promise.reject(new Error('getAvailability SecretFailure'))
      if (availMode === 'slow') return new Promise<boolean>((resolve) => timer.setTimeout(() => resolve(false), 2500))
      return Promise.resolve(availMode === 'true')
    },
    get getDevices() {
      return inner.getDevices
    },
  }
  const env: PrinterEnvironment = { bluetooth }
  const wrap = (client: NiimbotClientLike): NiimbotClientLike => ({
    async connect(options) {
      active++
      maxActive = Math.max(maxActive, active)
      try {
        if (slowMs > 0) await new Promise<void>((resolve) => timer.setTimeout(resolve, slowMs))
        return await client.connect(options)
      } finally {
        active--
      }
    },
    disconnect: () => client.disconnect(),
    isConnected: () => client.isConnected(),
    getModelMetadata: () => client.getModelMetadata(),
    on: (event, listener) => client.on(event, listener),
    off: (event, listener) => client.off(event, listener),
    get protocol() {
      return client.protocol
    },
  })
  const r = await rig({
    adapter: () => createB1Adapter({ environment: () => env, createClient: (method) => wrap(fake.createClient(method)), timer }),
    methods: ['bluetooth'],
    timer,
  })
  current = r
  const { station, server, store } = r
  let rev = 1
  let mine = true
  let jobs = 0

  // (5) 받기는 프린터가 이어져 있을 때만
  const originalFetch = server.fetch
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    if (String(input) === '/api/print/claim' && !fake.connected) violations.push('끊긴 동안 받기')
    return originalFetch(input, init)
  })

  // (3) 모형: 판매자가 이은 연결 · 60초 넘게 이어진 연결에서 셈을 새로 한다 (위로만 막는 느슨한 모형)
  let base = 0
  let connectedSince: number | null = null
  let blocked = false
  let lastAuto = 0
  const autoNow = () => r.handle().autoReconnectAttempts()
  const check = (where: string) => {
    const snapshot = station.getSnapshot()
    const isUp = snapshot.connection === 'CONNECTED' || snapshot.connection === 'PRINTING'
    if (isUp && connectedSince === null) connectedSince = timer.now
    if (!isUp && connectedSince !== null) {
      if (timer.now - connectedSince >= 60_000) base = Math.max(base, lastAuto)
      connectedSince = null
    }
    if (isUp && connectedSince !== null && timer.now - connectedSince >= 60_000) base = Math.max(base, autoNow())
    const auto = autoNow()
    if (auto - base > 6) violations.push(`${where}: 저절로 잇기 ${String(auto - base)}번`)
    if (blocked && auto > lastAuto) violations.push(`${where}: 연결 끊기 뒤 저절로 잇기`)
    lastAuto = auto
    const error = snapshot.connectError
    if (error !== null && !ALLOWED_DETAIL(error.detail)) violations.push(`${where}: 상세 ${String(error.detail)}`)
    if (error !== null && /Secret|User cancelled|adapter not available|negotiate|unknown reason|GATT/.test(`${error.message} ${error.detail ?? ''}`)) violations.push(`${where}: 원래 예외 글`)
  }
  const unsubscribe = station.subscribe(() => check('상태'))

  /** 판매자 동작을 끝까지 기다린다 — 쉬는 시간·느린 확인이 손으로 돌리는 타이머에 걸려 있으니 0.5초씩 당기며 (많아야 30초) */
  const settle = async (p: Promise<unknown>): Promise<void> => {
    let done = false
    void p.finally(() => {
      done = true
    })
    for (let i = 0; i < 60 && !done; i++) await timer.advance(500)
    if (!done) violations.push('판매자 동작이 30초 넘게 끝나지 않음')
  }

  const seller = (kind: 'reconnect' | 'pick', wait: boolean): Promise<void> => {
    blocked = false
    sellerPending++
    const p = (kind === 'reconnect' ? station.reconnect() : station.connect('bluetooth'))
      .then((ok) => {
        if (ok) base = Math.max(base, autoNow())
      })
      .finally(() => {
        sellerPending--
      })
    return wait ? settle(p) : flush(1)
  }

  // 시작: 고르기 창으로 한 번 연결
  await seller('pick', true)
  for (const [i, a] of actions.entries()) {
    const where = `${String(i)}:${a.k}`
    switch (a.k) {
      case 'drop':
        fake.disconnect()
        break
      case 'power':
        fake.setPowered(a.on)
        break
      case 'advance':
        await timer.advance(a.ms)
        break
      case 'reconnect':
      case 'pick':
        await seller(a.k, a.wait)
        break
      case 'disconnect': {
        blocked = true
        lastAuto = autoNow()
        const p = station.disconnect()
        await (a.wait ? settle(p) : flush(1))
        break
      }
      case 'unanswered':
        fake.setUnansweredNegotiations(a.n)
        break
      case 'avail':
        availMode = a.mode
        break
      case 'chooser':
        fake.setChooser(a.v)
        break
      case 'slow':
        slowMs = a.ms
        break
      case 'job':
        jobs++
        server.jobs.push(`job-${String(jobs)}`)
        store.setQueue({ ...queueOf(mine, true, ++rev) })
        break
      case 'mine':
        mine = a.on
        store.setQueue({ ...queueOf(mine, true, ++rev) })
        break
    }
    await flush(2)
    check(where)
  }
  // 끝: 오래 기다려도 끝없이 되풀이하지 않는다
  await timer.advance(200_000)
  check('끝')
  const after = autoNow()
  await timer.advance(200_000)
  if (autoNow() !== after && station.getSnapshot().connection !== 'CONNECTED') violations.push('끝없이 다시 잇기')
  unsubscribe()

  if (maxActive > 1) violations.push(`같은 때 연결 시도 ${String(maxActive)}개`)
  // (5) 출력함으로 알린 장은 한 번만, 찍힌 수보다 많지 않다
  const okIds = server.results.filter((x) => x.ok).map((x) => x.attempt)
  if (new Set(okIds).size !== okIds.length) violations.push('같은 장을 두 번 출력함으로 알림')
  if (okIds.length > fake.printed.length) violations.push('찍지 않은 장을 출력함으로 알림')
  expect(violations).toEqual([])
}

describe('출력 기기 다시 잇기 속성 시험 (AC-QS1-30)', () => {
  it('아무 순서·아무 때의 끊김·다시 연결·연결 끊기·연결 방법 연결·출력에도 (1)~(6)을 지킨다', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 40 }), async (actions) => {
        await run(actions)
      }),
      { numRuns: 120 },
    )
  })
})
