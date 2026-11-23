// 앱 라벨 대기열 (APP-03·APP-04, L-11): 이 기기에서 출력 → 한 장씩 받아(claim) 서버 그림을 BLE로 보내고 결과를 알린다. 다시 붙으면 요약을 다시 받아 이어 찍는다.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ClaimedJob, QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import type { PrinterResult } from '../src/native/ble.ts'
import { decodeBase64, parseBitmap } from '../src/api/labels.ts'
import { labelPaper } from '../src/lib/label-paper.ts'
import { LabelQueue } from '../src/lib/label-queue.ts'
import { FakeBlePrinter } from '../src/native/ble.ts'
import { APP_PRINTER_UNSUPPORTED } from '../src/lib/words.ts'
import { FakeClock, FakeEventSource, FakeServer, flush } from './support.ts'

const queueSummary = (patch: Partial<QueueSummary> = {}): QueueSummary => ({ rev: 1, device: { id: 'app-device-1', name: '내 휴대폰', live: true, printerConnected: true, releasing: false }, pause: null, waiting: 2, printing: 0, discard: 0, labelsEnabled: true, ...patch })

// 템플릿은 실제 서버처럼 크기가 있다 — 크기가 없으면 앱도 INVALID_TEMPLATE로 멈춘다 (D-PRN2-34)
const job = (id: string): ClaimedJob => ({ id, date: '2026-10-29', kind: 'product', reason: 'auto', attempt: `${id}-a1`, data: {} as ClaimedJob['data'], template: { size: '50x30' } as ClaimedJob['template'], page: null, pages: null, label: { key: `${id}@1`, claim: 'c1', version: 1, broadcast: 'b1', no: 15, buyerId: 'u1', buyer: { display: '홍길동' } as unknown as ClaimedJob['label']['buyer'] } })

function setup() {
  const server = new FakeServer()
  server.install()
  const ble = new FakeBlePrinter()
  const sources: FakeEventSource[] = []
  const clock = new FakeClock()
  const queue = new LabelQueue({
    ble,
    deviceId: 'app-device-1',
    openStream: () => {
      const source = new FakeEventSource('/api/stream')
      sources.push(source)
      return source
    },
    timer: clock,
  })
  return { server, ble, sources, clock, queue }
}

describe('LabelQueue', () => {
  it('이 기기에서 출력을 누르면 기기를 등록하고, 프린터가 연결되면 한 장씩 받아 서버 그림을 찍고 결과를 알린다', async () => {
    const { server, ble, sources, queue } = setup()
    const jobs = [job('j1'), job('j2')]
    let summary = queueSummary({ device: null, waiting: 2 })
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: summary, jobs: [], discard: [] } }))
    server.on('POST', /^\/api\/print\/device$/, () => {
      summary = queueSummary({ waiting: 2 })
      return { body: { queue: summary, waiting: 2, backlog: true } }
    })
    server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: { ok: true } }))
    server.on('POST', /^\/api\/print\/claim$/, () => {
      const next = jobs.shift() ?? null
      summary = queueSummary({ waiting: jobs.length, printing: next === null ? 0 : 1 })
      return { body: { job: next, reason: next === null ? 'EMPTY' : undefined } }
    })
    // APP2: 서버 그림을 그대로 보낸다. 404에는 출력하지 않는다.
    server.on('GET', /^\/api\/print\/jobs\/[^/]+\/bitmap\?/, () => ({ body: { width: 384, height: 1, data: Buffer.alloc(48, 0x81).toString('base64') } }))
    server.on('POST', /^\/api\/print\/result$/, () => ({ body: { recorded: true } }))
    queue.start()
    await flush()
    sources[0]!.open()
    expect(queue.getSnapshot().mine).toBe(false)
    expect(await queue.become('내 휴대폰')).toEqual({ kind: 'ok' })
    await flush()
    expect(queue.getSnapshot().mine).toBe(true)
    // 프린터가 아직 끊김 → 서버에 끊김을 알리고 받지 않는다
    expect(server.callsTo('POST', /device\/state/).at(-1)?.body).toEqual({ deviceId: 'app-device-1', connected: false })
    expect(server.callsTo('POST', /claim/).length).toBe(0)
    await labelPaper.update('fake-b1', 12)
    await queue.connect()
    await flush(20)
    expect(server.callsTo('POST', /device\/state/).at(-1)?.body).toEqual({ deviceId: 'app-device-1', connected: true })
    expect(labelPaper.get('fake-b1')).toBe(10)
    await labelPaper.update('fake-b1', null)
    expect(ble.printed.length).toBe(2)
    expect(ble.printed[0]?.image.width).toBe(384)
    expect(ble.printed[0]?.density).toBe(3)
    expect([...ble.printed[0]!.image.data]).toEqual(Array(48).fill(0x81))
    const results = server.callsTo('POST', /\/api\/print\/result/).map((call) => call.body)
    expect(results).toEqual([
      { deviceId: 'app-device-1', attempt: 'j1-a1', ok: true },
      { deviceId: 'app-device-1', attempt: 'j2-a1', ok: true },
    ])
    expect(queue.getSnapshot().printed).toBe(2)
    expect(queue.getSnapshot().job).toBeNull()
  })

  it('앱으로 돌아와 저절로 다시 잇는 것은 기억한 프린터만 — 고르기 창을 여는 잇기(connect·reconnect)는 부르지 않는다 (D-NOPICK-01)', async () => {
    const { server, ble, queue } = setup()
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: queueSummary({ waiting: 0 }) } }))
    server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: { ok: true } }))
    server.on('POST', /^\/api\/print\/claim$/, () => ({ body: { job: null, reason: 'EMPTY' } }))
    ble.restoreRemembered({ method: 'bluetooth', deviceId: 'fake-b1' })
    const calls: string[] = []
    ble.connect = async () => {
      calls.push('connect')
      return { ok: false, error: { code: 'NOT_SELECTED', message: '' } } as PrinterResult
    }
    ble.reconnect = async () => {
      calls.push('reconnect')
      return { ok: false, error: { code: 'NOT_SELECTED', message: '' } } as PrinterResult
    }
    ble.connectRemembered = async () => {
      calls.push('remembered')
      return { ok: false, error: { code: 'DISCONNECTED', message: '' } } as PrinterResult
    }
    // 앱을 켤 때(start)와 앞으로 돌아올 때(resume) 둘 다
    queue.start()
    await flush(20)
    queue.resume()
    await flush(20)
    expect(calls).toEqual(['remembered', 'remembered'])
    expect(queue.getSnapshot().printerError).toBeNull()
    queue.stop()
  })

  it('복귀 시 놓친 찜을 이어 찍고, 서버가 연결 끊김으로 멈췄어도 이미 연결된 프린터를 다시 알린다', async () => {
    const { server, ble, queue, clock } = setup()
    const waiting = queueSummary({ rev: 3, pause: { reason: 'DISCONNECTED', message: '끊김', backlog: false } })
    const ready = queueSummary({ rev: 4 })
    let summary = queueSummary({ device: null, waiting: 0 })
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: summary } }))
    queue.start()
    await queue.connect()
    await flush()
    summary = waiting
    server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: { queue: ready } }))
    let claims = 0
    server.on('POST', /^\/api\/print\/claim$/, () => {
      claims++
      if (claims === 1) return { body: { job: null, reason: 'BUSY' } }
      return { body: { job: claims === 2 ? job('away') : null } }
    })
    server.on('GET', /bitmap/, () => ({ body: { width: 8, height: 1, data: 'gA==' } }))
    server.on('POST', /^\/api\/print\/result$/, () => ({ body: { recorded: true } }))
    queue.resume()
    await flush(20)
    await clock.advance(2000)
    await flush(20)
    expect(ble.printed).toHaveLength(1)
    expect(server.callsTo('POST', /print\/result/).map(call => call.body)).toEqual([
      { deviceId: 'app-device-1', attempt: 'away-a1', ok: true },
    ])
    queue.stop()
  })

  it('출력에 실패하면 그 시도를 실패로 알리고 프린터 문장을 보인다', async () => {
    const server = new FakeServer()
    server.install()
    const ble = new FakeBlePrinter({ printResult: () => ({ ok: false, error: { code: 'TIMEOUT', message: '프린터 오류로 멈췄어요.' } }) as PrinterResult })
    const clock = new FakeClock()
    const queue = new LabelQueue({ ble, deviceId: 'app-device-1', openStream: () => new FakeEventSource('/api/stream'), timer: clock })
    let given = false
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: queueSummary(), jobs: [], discard: [] } }))
    server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: { ok: true } }))
    server.on('POST', /^\/api\/print\/claim$/, () => {
      if (given) return { body: { job: null, reason: 'EMPTY' } }
      given = true
      return { body: { job: job('j1') } }
    })
    server.on('GET', /^\/api\/print\/jobs\/[^/]+\/bitmap\?/, () => ({ body: { width: 384, height: 1, data: Buffer.alloc(48, 0x81).toString('base64') } }))
    server.on('POST', /^\/api\/print\/result$/, () => ({ body: { recorded: true } }))
    queue.start()
    await flush()
    await queue.connect()
    await flush(20)
    expect(server.callsTo('POST', /result/).map((call) => call.body)).toEqual([{ deviceId: 'app-device-1', attempt: 'j1-a1', ok: false, error: { code: 'TIMEOUT' } }])
    expect(queue.getSnapshot().printerError?.message).toBe('프린터 오류로 멈췄어요.')
  })

  it('다시 붙으면(두 번째 ready) 요약을 다시 받고 print 알림의 판(rev)이 오래된 것은 버린다', async () => {
    const { server, sources, queue } = setup()
    let loads = 0
    server.on('GET', /^\/api\/print$/, () => {
      loads++
      return { body: { queue: queueSummary({ rev: 5, device: null }), jobs: [], discard: [] } }
    })
    queue.start()
    await flush()
    sources[0]!.open()
    expect(loads).toBe(1)
    sources[0]!.emit('print', { rev: 3, queue: queueSummary({ rev: 3, device: null, waiting: 9 }), jobs: [], labels: [] })
    expect(queue.getSnapshot().queue?.waiting).toBe(2)
    sources[0]!.emit('print', { rev: 6, queue: queueSummary({ rev: 6, device: null, waiting: 4 }), jobs: [], labels: [] })
    expect(queue.getSnapshot().queue?.waiting).toBe(4)
    expect(queue.backlog).toBe(4)
    sources[0]!.fail()
    sources[0]!.open()
    await flush()
    expect(loads).toBe(2)
  })

  it('다른 가게로 바뀌면(reset) 앞 가게의 큰 판을 버리고 새 가게의 작은 판 알림을 받는다 (D-PRINT-SHOP-01)', async () => {
    const { server, sources, queue } = setup()
    let rev = 1362
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: queueSummary({ rev, device: null }), jobs: [], discard: [] } }))
    queue.start()
    await flush()
    sources[0]!.open()
    expect(queue.getSnapshot().queue?.rev).toBe(1362)
    // 새 가게: 판이 처음부터 다시 센다
    rev = 180
    queue.reset()
    await flush()
    expect(queue.getSnapshot().queue?.rev).toBe(180)
    sources[0]!.emit('print', { rev: 181, queue: queueSummary({ rev: 181, device: null, waiting: 7 }), jobs: [], labels: [] })
    expect(queue.getSnapshot().queue?.waiting).toBe(7)
  })

  it('reset 없이도 요약을 다시 받으면 서버 판이 맞다 — 들고 있던 판이 더 커도 버린다 (D-PRINT-SHOP-01)', async () => {
    const { server, sources, queue } = setup()
    let rev = 1362
    server.on('GET', /^\/api\/print$/, () => ({ body: { queue: queueSummary({ rev, device: null }), jobs: [], discard: [] } }))
    queue.start()
    await flush()
    sources[0]!.open()
    rev = 187
    await queue.reload()
    expect(queue.getSnapshot().queue?.rev).toBe(187)
    sources[0]!.emit('print', { rev: 188, queue: queueSummary({ rev: 188, device: null, waiting: 3 }), jobs: [], labels: [] })
    expect(queue.getSnapshot().queue?.waiting).toBe(3)
  })

  it('서버 그림 모양 읽기: base64 1비트 행 바이트, 길이가 안 맞으면 null', () => {
    expect([...decodeBase64('AAEC/w==')]).toEqual([0, 1, 2, 255])
    expect(parseBitmap({ width: 16, height: 2, data: 'AAEC/w==' })).toEqual({ width: 16, height: 2, data: new Uint8Array([0, 1, 2, 255]) })
    expect(parseBitmap({ width: 16, height: 3, data: 'AAEC/w==' })).toBeNull()
  })
  it('블루투스가 없는 기기에서 연결하면 웹 문장("이 브라우저에서는…")이 아니라 앱 문장을 보인다', async () => {
    const { ble, queue } = setup()
    ble.connect = async () => ({ ok: false, error: { code: 'UNSUPPORTED', message: '이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.' } }) as PrinterResult
    await queue.connect()
    expect(queue.getSnapshot().printerError?.code).toBe('UNSUPPORTED')
    expect(queue.getSnapshot().printerError?.message).toBe(APP_PRINTER_UNSUPPORTED)
    expect(queue.getSnapshot().printerError?.message).not.toContain('브라우저')
  })
})
