// 11월 12일 라이브 복기의 라벨 고침 — 앱 라벨 대기열 (docs/retro/2026-11-12-improvement-plan.md F1·F2, D-RETRO-40·42·43):
// - 대기 라벨 지금 뽑기(printWaiting): 끊김·멈춤을 풀고 다시 읽어 차례로 뽑는다. 프린터가 없으면 먼저 다시 연결.
// - 방송 중 계속 다시 잇기: 서버가 방송이 열려 있다고 알리면(live) 출력 기기는 6번 뒤에도 그치지 않는다. 방송이 없으면 지금 정책 그대로.
// - 시간 초과·끊김으로 실패한 시도에 앱이 아는 까닭과 시각을 붙인다. 옛 서버(까닭 칸을 모름)에는 까닭 없이 다시 알린다.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ClaimedJob, QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import { LabelQueue } from '../src/lib/label-queue.ts'
import { FakeBlePrinter, type PrinterResult } from '../src/native/ble.ts'
import { FakeClock, FakeEventSource, FakeServer, flush } from './support.ts'

const ME = 'app-device-1'
const device = (patch: Partial<NonNullable<QueueSummary['device']>> = {}): NonNullable<QueueSummary['device']> => ({ id: ME, name: '내 휴대폰', live: true, printerConnected: true, releasing: false, profileId: null, ...patch })
const summary = (patch: Partial<QueueSummary> = {}): QueueSummary => ({ rev: 1, device: device(), pause: null, waiting: 2, printing: 0, discard: 0, labelsEnabled: true, labelSizes: ['50x30'], ...patch })
const job = (id: string): ClaimedJob => ({ id, date: '2026-11-12', kind: 'product', reason: 'auto', attempt: `${id}-a1`, data: {} as ClaimedJob['data'], template: { size: '50x30' } as ClaimedJob['template'], page: null, pages: null, label: { key: `${id}@1`, claim: 'c1', version: 1, broadcast: 'b1', no: 419, buyerId: null, buyer: { kind: 'youtube', name: '홍길동' } } })

function setup(ble = new FakeBlePrinter()) {
  const server = new FakeServer()
  server.install()
  const clock = new FakeClock()
  const world = { summary: summary(), live: false, jobs: [] as ClaimedJob[], now: Date.parse('2026-11-12T03:25:53.000Z') }
  const queue = new LabelQueue({ ble, deviceId: ME, openStream: () => new FakeEventSource('/api/stream'), timer: clock, now: () => world.now })
  server.on('GET', /^\/api\/print$/, () => ({ body: { queue: world.summary, jobs: [], discard: [], live: world.live } }))
  server.on('POST', /^\/api\/print\/claim$/, () => {
    const next = world.jobs.shift() ?? null
    return { body: { job: next, reason: next === null ? 'EMPTY' : undefined } }
  })
  server.on('GET', /bitmap/, () => ({ body: { width: 8, height: 1, data: 'gA==' } }))
  server.on('POST', /^\/api\/print\/result$/, () => ({ body: { recorded: true } }))
  server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
  return { server, ble, clock, queue, world }
}

const posts = (server: FakeServer, pattern: RegExp) => server.callsTo('POST', pattern).map((call) => call.body)

describe('F1 대기 라벨 지금 뽑기 (printWaiting)', () => {
  it('프린터가 이어져 있지 않으면 아무것도 바꾸지 않고 "먼저 다시 연결"을 돌려준다', async () => {
    const { server, queue, world } = setup()
    world.summary = summary({ pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false }, device: device({ printerConnected: false }) })
    queue.start()
    await flush()
    expect(await queue.printWaiting()).toEqual({ kind: 'needPrinter' })
    expect(posts(server, /restart|claim|\/print\/device$/)).toEqual([])
    queue.stop()
  })

  it('끊김으로 멈춰 있으면 연결됨을 다시 알려 풀고 대기 맨 앞부터 차례로 뽑는다', async () => {
    const { server, ble, queue, world } = setup()
    queue.start()
    await queue.connect()
    await flush(20)
    // 서버는 끊긴 줄 안다(라벨 2장이 대기로 남았다) — 프린터는 이어져 있다
    world.summary = summary({ rev: 3, pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false }, device: device({ printerConnected: false }) })
    world.jobs = [job('j419'), job('j372')]
    server.on('POST', /^\/api\/print\/device\/state$/, (call) => {
      if (call.body?.connected === true) world.summary = summary({ rev: 4 })
      return { body: { queue: world.summary } }
    })
    const before = posts(server, /device\/state/).length
    expect(await queue.printWaiting()).toEqual({ kind: 'started', count: 2 })
    await flush(30)
    expect(posts(server, /device\/state/).slice(before)).toEqual([{ deviceId: ME, connected: true }])
    expect(posts(server, /restart/)).toEqual([])
    expect(ble.printed).toHaveLength(2)
    expect(posts(server, /print\/result/)).toEqual([
      { deviceId: ME, attempt: 'j419-a1', ok: true },
      { deviceId: ME, attempt: 'j372-a1', ok: true },
    ])
    queue.stop()
  })

  it('손으로 푸는 멈춤(라벨을 다시 켠 뒤 쌓인 라벨·프린터 오류)이면 다시 시작을 보내 풀고 뽑는다', async () => {
    const { server, ble, queue, world } = setup()
    queue.start()
    await queue.connect()
    await flush(20)
    world.summary = summary({ rev: 3, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true } })
    world.jobs = [job('j1')]
    server.on('POST', /^\/api\/print\/restart$/, () => {
      world.summary = summary({ rev: 4, waiting: 1 })
      return { body: { queue: world.summary } }
    })
    expect(await queue.printWaiting()).toEqual({ kind: 'started', count: 1 })
    await flush(30)
    expect(posts(server, /restart/)).toEqual([{}])
    expect(ble.printed).toHaveLength(1)
    queue.stop()
  })

  it('풀었는데도 멈춰 있으면(라벨 오류) 그 까닭 문장을 돌려준다', async () => {
    const { server, queue, world } = setup()
    queue.start()
    await queue.connect()
    await flush(20)
    const paused = { reason: 'LABEL_ERROR' as const, message: '라벨을 만들지 못해 멈췄어요. 라벨 설정을 확인한 뒤 다시 시작해 주세요.', backlog: false }
    world.summary = summary({ rev: 3, pause: paused })
    server.on('POST', /^\/api\/print\/restart$/, () => ({ body: { queue: world.summary } }))
    expect(await queue.printWaiting()).toEqual({ kind: 'error', message: paused.message })
    queue.stop()
  })

  it('출력 기기가 없으면 이 기기를 출력 기기로 하고 뽑는다', async () => {
    const { server, ble, queue, world } = setup()
    world.summary = summary({ device: null })
    queue.start()
    await queue.connect()
    await flush(20)
    world.jobs = [job('j1')]
    server.on('POST', /^\/api\/print\/device$/, () => {
      // 새로 정할 때 대기 작업이 있으면 판매자 멈춤으로 시작한다 (L-11 10)
      world.summary = summary({ rev: 2, waiting: 1, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true } })
      return { body: { queue: world.summary, waiting: 1, backlog: true } }
    })
    server.on('POST', /^\/api\/print\/restart$/, () => {
      world.summary = summary({ rev: 3, waiting: 1 })
      return { body: { queue: world.summary } }
    })
    expect(await queue.printWaiting()).toEqual({ kind: 'started', count: 1 })
    await flush(30)
    expect(posts(server, /\/print\/device$/)).toEqual([{ deviceId: ME, name: '내 휴대폰' }])
    expect(ble.printed).toHaveLength(1)
    queue.stop()
  })

  it('다른 기기가 출력 기기면 받지 않는다 — 손으로 푸는 멈춤만 풀고 그 기기 이름을 돌려준다', async () => {
    const { server, queue, world } = setup()
    world.summary = summary({ device: device({ id: 'other-device-9', name: '가게 폰' }), pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true } })
    server.on('POST', /^\/api\/print\/restart$/, () => {
      world.summary = summary({ rev: 2, device: device({ id: 'other-device-9', name: '가게 폰' }) })
      return { body: { queue: world.summary } }
    })
    queue.start()
    await queue.connect()
    await flush(20)
    expect(await queue.printWaiting()).toEqual({ kind: 'other', name: '가게 폰', printing: true })
    expect(posts(server, /claim|\/print\/device$/)).toEqual([])
    // 그 기기의 프린터가 끊겨 있으면 여기서 풀 수 없다
    world.summary = summary({ rev: 3, device: device({ id: 'other-device-9', name: '가게 폰', printerConnected: false }), pause: { reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false } })
    expect(await queue.printWaiting()).toEqual({ kind: 'other', name: '가게 폰', printing: false })
    expect(posts(server, /restart/)).toHaveLength(1)
    queue.stop()
  })

  it('라벨 뽑기가 꺼져 있거나 대기가 없으면 그렇게 알린다', async () => {
    const { queue, world } = setup()
    world.summary = summary({ labelsEnabled: false })
    queue.start()
    await queue.connect()
    await flush(20)
    expect(await queue.printWaiting()).toEqual({ kind: 'off' })
    world.summary = summary({ rev: 2, waiting: 0 })
    expect(await queue.printWaiting()).toEqual({ kind: 'empty' })
    queue.stop()
  })

  it('요약을 불러오지 못하면 그 문장을 돌려준다', async () => {
    const { server, queue } = setup()
    queue.start()
    await queue.connect()
    await flush(20)
    server.on('GET', /^\/api\/print$/, () => ({ status: 503, body: { error: { code: 'UNAVAILABLE', message: '잠시 뒤 다시 해 주세요.' } } }))
    expect(await queue.printWaiting()).toEqual({ kind: 'error', message: '잠시 뒤 다시 해 주세요.' })
    queue.stop()
  })
})

describe('F2 방송 중 계속 다시 잇기', () => {
  it('출력 기기이고 라벨이 켜져 있고 방송이 열려 있을 때만 계속 잇기를 켠다', async () => {
    const { ble, queue, world } = setup()
    world.live = true
    queue.start()
    await flush()
    expect(ble.autoAllowed).toBe(true)
    expect(ble.keepReconnecting).toBe(true)
    expect(queue.getSnapshot().live).toBe(true)
    // 방송이 끝났다 → 지금 정책(6번 뒤 그침)으로
    world.live = false
    await queue.reload()
    expect(ble.autoAllowed).toBe(true)
    expect(ble.keepReconnecting).toBe(false)
    // 방송이 열려 있어도 출력 기기가 아니면 켜지 않는다
    world.live = true
    world.summary = summary({ rev: 2, device: device({ id: 'other-device-9' }) })
    await queue.reload()
    expect(ble.keepReconnecting).toBe(false)
    // 라벨을 끄면 켜지 않는다
    world.summary = summary({ rev: 3, labelsEnabled: false })
    await queue.reload()
    expect(ble.keepReconnecting).toBe(false)
    world.summary = summary({ rev: 4 })
    await queue.reload()
    expect(ble.keepReconnecting).toBe(true)
    queue.stop()
    expect(ble.keepReconnecting).toBe(false)
  })

  it('옛 서버(방송이 열려 있는지 알리지 않음)면 지금 정책 그대로다', async () => {
    const { server, ble, queue } = setup()
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: summary(), jobs: [], discard: [] } }))
    queue.start()
    await flush()
    expect(ble.autoAllowed).toBe(true)
    expect(ble.keepReconnecting).toBe(false)
    expect(queue.getSnapshot().live).toBe(false)
    queue.stop()
  })

  it('끊긴 때·6번을 넘긴 차례마다·그쳤을 때 방송이 아직 열려 있는지 다시 확인한다 — 끝났으면 계속 잇기를 거둔다', async () => {
    const { server, ble, queue, world } = setup()
    world.live = true
    queue.start()
    await queue.connect()
    await flush(20)
    const loads = () => server.callsTo('GET', /^\/api\/print$/).length
    const auto = async (state: FakeBlePrinter['autoReconnect']) => {
      ble.autoReconnect = state
      ble.changed()
      await flush()
    }
    let before = loads()
    // 끊긴 때 (첫 차례)
    await auto({ kind: 'trying', attempt: 1, total: null })
    expect(loads()).toBe(before + 1)
    // 같은 차례가 다시 알려져도, 2~6번째에도 다시 묻지 않는다
    before = loads()
    await auto({ kind: 'trying', attempt: 1, total: null })
    for (const attempt of [2, 3, 4, 5, 6]) await auto({ kind: 'trying', attempt, total: null })
    expect(loads()).toBe(before)
    // 6번을 넘긴 차례마다 (30초마다 한 번)
    await auto({ kind: 'trying', attempt: 7, total: null })
    await auto({ kind: 'trying', attempt: 8, total: null })
    expect(loads()).toBe(before + 2)
    expect(ble.keepReconnecting).toBe(true)
    // 방송이 끝났다 → 다음 확인에서 계속 잇기를 거둔다
    world.live = false
    await auto({ kind: 'trying', attempt: 9, total: null })
    expect(ble.keepReconnecting).toBe(false)
    // 그쳤을 때도 한 번 확인한다 — 그사이 방송이 열렸으면 다시 잇게 된다
    world.live = true
    before = loads()
    await auto({ kind: 'gaveUp' })
    expect(loads()).toBe(before + 1)
    expect(ble.keepReconnecting).toBe(true)
    queue.stop()
  })
})

describe('F2-2 실패한 시도에 까닭과 시각을 붙인다', () => {
  const timeout: PrinterResult = { ok: false, error: { code: 'TIMEOUT', message: '프린터가 응답하지 않아요. 프린터 전원과 라벨을 확인한 뒤 다시 시작해 주세요.' } }

  it('시간 초과로 끝나면 블루투스 상태·앱 앞/뒤·끊긴 오류 번호·걸린 시간·프린터 프로필과 시각을 결과에 붙인다', async () => {
    const ble = new FakeBlePrinter({ printResult: () => timeout })
    const { server, queue, world } = setup(ble)
    const started = world.now
    ble.facts = { radio: 'on', app: 'background', leftAt: started + 2_000, lost: { at: started + 3_000, ble: 201, android: 8 } }
    world.jobs = [job('j375')]
    const print = ble.print.bind(ble)
    ble.print = async (image, options) => {
      // 보내고 34초 뒤 포기했다
      world.now = started + 34_000
      return print(image, options)
    }
    queue.start()
    await queue.connect()
    await flush(30)
    expect(posts(server, /print\/result/)).toEqual([
      {
        deviceId: ME,
        attempt: 'j375-a1',
        ok: false,
        error: { code: 'TIMEOUT' },
        cause: { reason: 'OUT_OF_RANGE', at: '2026-11-12T03:26:27.000Z', radio: 'on', app: 'background', wentBackground: true, elapsedMs: 34_000, lostAgoMs: 31_000, ble: 201, android: 8 },
      },
    ])
    queue.stop()
  })

  it('옛 서버가 까닭 칸을 받지 않으면 까닭 없이 결과만 다시 알린다 (결과를 잃지 않는다)', async () => {
    const ble = new FakeBlePrinter({ printResult: () => timeout })
    const { server, queue, world } = setup(ble)
    ble.facts = { radio: 'off', app: 'active', leftAt: null, lost: null }
    world.jobs = [job('j1')]
    server.on('POST', /^\/api\/print\/result$/, (call) => (call.body?.cause === undefined ? { body: { recorded: true } } : { status: 400, body: { error: { code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.' } } }))
    queue.start()
    await queue.connect()
    await flush(30)
    const sent = posts(server, /print\/result/)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({ attempt: 'j1-a1', ok: false, cause: { reason: 'BLUETOOTH_OFF' } })
    expect(sent[1]).toEqual({ deviceId: ME, attempt: 'j1-a1', ok: false, error: { code: 'TIMEOUT' } })
    queue.stop()
  })

  it('사실을 모르는 연결(시험용 프린터)과 출력함 결과에는 까닭을 붙이지 않는다', async () => {
    let fail = true
    const ble = new FakeBlePrinter({ printResult: () => (fail ? timeout : { ok: true }) })
    const { server, queue, world, clock } = setup(ble)
    world.jobs = [job('j1'), job('j2')]
    queue.start()
    await queue.connect()
    await flush(30)
    expect(posts(server, /print\/result/)).toEqual([{ deviceId: ME, attempt: 'j1-a1', ok: false, error: { code: 'TIMEOUT' } }])
    fail = false
    ble.facts = { radio: 'on', app: 'active', leftAt: null, lost: null }
    await queue.connect()
    await clock.advance(2000)
    await flush(30)
    expect(posts(server, /print\/result/).at(-1)).toEqual({ deviceId: ME, attempt: 'j2-a1', ok: true })
    queue.stop()
  })
})
