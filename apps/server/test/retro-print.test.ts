// 11월 12일 라이브 복기에서 나온 라벨 고침 (docs/retro/2026-11-12-improvement-plan.md F1·F2, D-RETRO-41~43):
// - 라벨 없는 판매 한꺼번에 뽑기 (POST /api/print/labels/print-missing) — 라벨을 꺼 둔 동안 확정된 찜만, 이미 작업이 있는 라벨 키는 다시 넣지 않는다
// - 실패한 출력 시도에 앱이 아는 까닭과 시각을 남긴다 (POST /api/print/result의 cause → print_attempts.fail_*)
// - 대기열 조회(GET /api/print)의 live — 지금 열려 있는 실제 방송이 있는지 (방송 중 계속 다시 잇기)
import type { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { ATTEMPT_CAUSE_REASONS, parseAttemptCause } from '../src/print.ts'
import { DAY, DEVICE_A, becomeDevice, labelReports, printApi, register } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid, writeEvent, type JsonResponse, type Seller, type TestServer } from './support.ts'

async function setLabels(world: TestServer, seller: Seller, enabled: boolean): Promise<void> {
  const response = await world.server.app.request('/api/settings/labels', {
    method: 'PUT',
    headers: { Cookie: seller.cookie, Origin: 'https://app.livejjim.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  expect(response.status).toBe(200)
}

let messageCounter = 0
async function say(world: TestServer, seller: Seller, b: string, channel: string, nick: string, text: string): Promise<void> {
  const result = await world.server.ingestChat(seller.sellerId, { b, id: `retro-${String(++messageCounter)}`, ch: channel, nick, text })
  expect(result.status).toBe('recorded')
}

async function rows<T>(world: TestServer, sql: string, params: unknown[] = []): Promise<T[]> {
  return ((await (world.database.pglite as PGlite).query<T>(sql, params)).rows as T[]).map((row) => ({ ...row }))
}

const missing = (world: TestServer, seller: Seller, b: string, requestId = rid('pm')): Promise<JsonResponse> => client(world, seller.cookie).post('/api/print/labels/print-missing', { requestId, b })

interface MadeJob {
  readonly id: string
  readonly reason: string
  readonly status: string
  readonly label: { readonly no: number; readonly buyer: { readonly name?: string } }
}
const jobsOf = (response: JsonResponse): MadeJob[] => response.body['jobs'] as MadeJob[]

describe('F1-2 라벨 없는 판매 한꺼번에 뽑기', () => {
  it('라벨을 꺼 둔 동안 확정된 찜만 번호 순으로 대기열에 넣고, 이미 라벨이 있는 찜은 다시 넣지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const p = printApi(world, seller)
    // 켜 둔 동안 확정 → 자동 작업
    await register(world, seller, b.id, 7, '러블리로즈', 30000)
    await say(world, seller, b.id, 'UC_A', '홍길동', '7')
    expect((await p.overview()).queue.waiting).toBe(1)
    // 끈 동안 확정 3건 (번호를 섞어서) → 작업이 생기지 않는다
    await setLabels(world, seller, false)
    await register(world, seller, b.id, 419, '오색글래머', 40000)
    await register(world, seller, b.id, 333, '라울', 20000)
    await register(world, seller, b.id, 372, '핑크프릴', 10000)
    await say(world, seller, b.id, 'UC_B', '이영희', '419')
    await say(world, seller, b.id, 'UC_C', '김철수', '333')
    await say(world, seller, b.id, 'UC_D', '박민수', '372')
    expect((await p.overview()).queue.waiting).toBe(1)
    // 꺼져 있으면 받지 않는다
    expect((await missing(world, seller, b.id)).body).toEqual({ error: { code: 'LABELS_OFF', message: '라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.' } })
    await setLabels(world, seller, true)
    const requestId = rid('pm')
    const made = await expectOk(missing(world, seller, b.id, requestId))
    expect(jobsOf(made).map((job) => [job.label.no, job.reason, job.status, job.label.buyer.name])).toEqual([
      [333, 'manual', 'WAITING', '김철수'],
      [372, 'manual', 'WAITING', '박민수'],
      [419, 'manual', 'WAITING', '이영희'],
    ])
    expect((await p.overview()).queue.waiting).toBe(4)
    // 같은 요청 번호: 같은 결과, 더 만들지 않는다
    expect(jobsOf(await expectOk(missing(world, seller, b.id, requestId))).map((job) => job.id)).toEqual(jobsOf(made).map((job) => job.id))
    // 새 요청: 이미 다 넣었으니 아무것도 넣지 않는다
    expect(jobsOf(await expectOk(missing(world, seller, b.id)))).toEqual([])
    expect((await p.overview()).queue.waiting).toBe(4)
    // 출력 순서: 먼저 있던 7번, 그 뒤 넣은 번호 순
    await becomeDevice(world, seller)
    const printed: number[] = []
    for (let i = 0; i < 4; i++) {
      const held = await p.claim(DEVICE_A)
      printed.push(held.job?.label.no ?? -1)
      expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
    }
    expect(printed).toEqual([7, 333, 372, 419])
    // 다 나온 뒤에도 다시 넣지 않는다 (중복 출력 방지)
    expect(jobsOf(await expectOk(missing(world, seller, b.id)))).toEqual([])
    expect((await p.overview()).queue.waiting).toBe(0)
  })

  it('끈 동안의 자동 출력 효과와 묶어 출력함이 되면 한 번 보고한다 (라벨 출력과 같은 길 — L-13 8)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await setLabels(world, seller, false)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await say(world, seller, b.id, 'UC_A', '홍길동', '15')
    const effect = (await rows<{ effect_id: string }>(world, `select effect_id from outbox where seller_id = $1 and kind = 'PRINT_PRODUCT_LABEL'`, [seller.sellerId]))[0]?.effect_id
    expect(effect).toBeDefined()
    await setLabels(world, seller, true)
    await expectOk(missing(world, seller, b.id))
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const held = await p.claim(DEVICE_A)
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
    expect((await labelReports(world, seller.sellerId)).map((report) => report.effectId)).toEqual([effect])
  })

  it('판매자가 대기열에서 뺀 라벨(출력 안 함)과 1등이 아닌 찜은 넣지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const p = printApi(world, seller)
    await register(world, seller, b.id, 1)
    await say(world, seller, b.id, 'UC_A', '홍길동', '1')
    const waiting = (await p.overview()).jobs[0]
    await expectOk(p.cancel(DAY, waiting?.id ?? ''))
    await setLabels(world, seller, false)
    await register(world, seller, b.id, 2)
    await say(world, seller, b.id, 'UC_B', '이영희', '2')
    await say(world, seller, b.id, 'UC_C', '김철수', '2')
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 2, buyer: 'UC_B', reason: '구매자 요청' }))
    await setLabels(world, seller, true)
    const made = await expectOk(missing(world, seller, b.id))
    // 1번(뺀 라벨)은 그대로 출력 안 함, 2번은 지금 1등(김철수)만
    expect(jobsOf(made).map((job) => [job.label.no, job.label.buyer.name])).toEqual([[2, '김철수']])
  })

  it('다른 방송·다른 판매자·리허설·요청 번호 없음은 받지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    await setLabels(world, seller, false)
    const b = await createBroadcast(world, seller, { date: DAY })
    const second = await createBroadcast(world, seller, { date: DAY, title: '2부' })
    await register(world, seller, b.id, 1)
    await register(world, seller, second.id, 1)
    await say(world, seller, b.id, 'UC_A', '홍길동', '1')
    await say(world, seller, second.id, 'UC_B', '이영희', '1')
    await setLabels(world, seller, true)
    expect((await missing(world, other, b.id)).status).toBe(404)
    expect((await client(world, seller.cookie).post('/api/print/labels/print-missing', { b: b.id })).body).toMatchObject({ error: { code: 'INVALID_REQUEST_ID' } })
    expect((await client(world, seller.cookie).post('/api/print/labels/print-missing', { requestId: rid('pm'), b: b.id, claim: 'x' })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    // 그 방송 것만
    expect(jobsOf(await expectOk(missing(world, seller, b.id))).map((job) => job.label.buyer.name)).toEqual(['홍길동'])
    expect(jobsOf(await expectOk(missing(world, seller, second.id))).map((job) => job.label.buyer.name)).toEqual(['이영희'])
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    expect((await missing(world, seller, rehearsal.id)).body).toEqual({ error: { code: 'PRINT_REHEARSAL', message: '리허설 방송은 라벨을 출력하지 않아요.' } })
  })
})

describe('F2-2 실패한 출력 시도에 까닭과 시각을 남긴다', () => {
  interface AttemptRow {
    result: string | null
    fail_reason: string | null
    fail_at: string | Date | null
    fail_detail: string | null
  }
  const attempts = (world: TestServer, seller: Seller) => rows<AttemptRow>(world, `select result, fail_reason, fail_at, fail_detail from print_attempts where seller_id = $1 order by id`, [seller.sellerId])

  async function claimed(world: TestServer, seller: Seller) {
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 375)
    await say(world, seller, b.id, 'UC_A', '홍길동', '375')
    await becomeDevice(world, seller)
    const p = printApi(world, seller)
    const held = await p.claim(DEVICE_A)
    return { p, attempt: held.job?.attempt ?? '' }
  }

  it('시간 초과로 끝난 시도에 까닭 낱말·앱이 본 시각·함께 알린 값을 남긴다 (정해진 칸만)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { p, attempt } = await claimed(world, seller)
    const at = new Date(world.clock.now() - 1500).toISOString()
    const response = await expectOk(
      p.api.post('/api/print/result', {
        deviceId: DEVICE_A,
        attempt,
        ok: false,
        error: { code: 'TIMEOUT' },
        cause: { reason: 'OUT_OF_RANGE', at, radio: 'on', app: 'background', wentBackground: true, elapsedMs: 34_000, lostAgoMs: 31_000, ble: 201, android: 8, profileId: 'NIIMBOT_B1', deviceName: 'B1-H123456789', address: 'AA:BB:CC:DD:EE:FF', note: '홍길동' },
      }),
    )
    expect(response.body).toEqual({ recorded: true })
    const [row] = await attempts(world, seller)
    expect(row?.result).toBe('TIMEOUT')
    expect(row?.fail_reason).toBe('OUT_OF_RANGE')
    expect(new Date(row?.fail_at ?? 0).toISOString()).toBe(at)
    // 받은 칸만 — 기기 이름·주소·글은 남기지 않는다
    expect(JSON.parse(row?.fail_detail ?? '{}')).toEqual({ radio: 'on', app: 'background', wentBackground: true, elapsedMs: 34_000, lostAgoMs: 31_000, ble: 201, android: 8, profileId: 'NIIMBOT_B1' })
    expect(row?.fail_detail).not.toMatch(/H123456789|AA:BB|홍길동/)
    // 대기열 동작은 그대로: 프린터 오류 멈춤, 작업은 대기 맨 앞
    const overview = await p.overview()
    expect(overview.queue.pause?.reason).toBe('PRINTER_ERROR')
    expect(overview.jobs[0]).toMatchObject({ status: 'WAITING', attempts: 1, lastError: { code: 'TIMEOUT', item: null } })
  })

  it('까닭이 없거나(옛 앱) 모양이 틀려도 결과는 그대로 기록하고 까닭만 비운다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { p, attempt } = await claimed(world, seller)
    expect(await p.fail(DEVICE_A, attempt, 'DISCONNECTED')).toBe(true)
    await expectOk(p.state(DEVICE_A, true))
    const second = await p.claim(DEVICE_A)
    expect((await expectOk(p.api.post('/api/print/result', { deviceId: DEVICE_A, attempt: second.job?.attempt ?? '', ok: false, error: { code: 'DISCONNECTED' }, cause: { reason: '아무 글', at: 'x' } }))).body).toEqual({ recorded: true })
    await expectOk(p.state(DEVICE_A, true))
    const third = await p.claim(DEVICE_A)
    expect((await expectOk(p.api.post('/api/print/result', { deviceId: DEVICE_A, attempt: third.job?.attempt ?? '', ok: false, error: { code: 'DISCONNECTED' }, cause: 'BLUETOOTH_OFF' }))).body).toEqual({ recorded: true })
    expect((await attempts(world, seller)).map((row) => [row.result, row.fail_reason, row.fail_at, row.fail_detail])).toEqual([
      ['DISCONNECTED', null, null, null],
      ['DISCONNECTED', null, null, null],
      ['DISCONNECTED', null, null, null],
    ])
  })

  it('출력함 결과에는 까닭을 남기지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { p, attempt } = await claimed(world, seller)
    await expectOk(p.api.post('/api/print/result', { deviceId: DEVICE_A, attempt, ok: true, cause: { reason: 'UNKNOWN' } }))
    expect((await attempts(world, seller)).map((row) => [row.result, row.fail_reason])).toEqual([['DONE', null]])
  })

  it('parseAttemptCause: 낱말은 정해진 것만, 시각은 서버 시계와 하루 안, 수는 범위 안의 정수, 프린터는 켠 프로필 ID만', () => {
    const now = new Date('2026-11-12T03:25:53.000Z')
    expect(ATTEMPT_CAUSE_REASONS).toEqual(['BLUETOOTH_OFF', 'BLUETOOTH_DENIED', 'OUT_OF_RANGE', 'PRINTER_CLOSED', 'LINK_LOST', 'APP_BACKGROUND', 'NO_RESPONSE', 'UNKNOWN'])
    expect(parseAttemptCause(undefined, now)).toBeNull()
    expect(parseAttemptCause([], now)).toBeNull()
    expect(parseAttemptCause({ reason: 'HACK' }, now)).toBeNull()
    expect(parseAttemptCause({ reason: 'BLUETOOTH_OFF' }, now)).toEqual({ reason: 'BLUETOOTH_OFF', at: null, detail: {} })
    expect(parseAttemptCause({ reason: 'NO_RESPONSE', at: '2026-11-12T03:25:50.000Z' }, now)?.at?.toISOString()).toBe('2026-11-12T03:25:50.000Z')
    // 휴대폰 시계가 엉뚱하면 시각을 버린다
    expect(parseAttemptCause({ reason: 'NO_RESPONSE', at: '2031-01-01T00:00:00.000Z' }, now)?.at).toBeNull()
    expect(parseAttemptCause({ reason: 'NO_RESPONSE', at: 12345 }, now)?.at).toBeNull()
    expect(parseAttemptCause({ reason: 'LINK_LOST', radio: 'weird', app: 'x', wentBackground: 'yes', elapsedMs: -1, lostAgoMs: 1.5, ble: '201', ios: 6, att: 99_999_999, profileId: 'NOT_A_PRINTER' }, now)?.detail).toEqual({ ios: 6 })
  })
})

describe('F2 대기열 조회의 live: 지금 열려 있는 실제 방송이 있는지', () => {
  const live = async (world: TestServer, seller: Seller): Promise<unknown> => (await expectOk(client(world, seller.cookie).get('/api/print'))).body['live']

  it('방송 화면에 들어온 실제 방송이 있고 끝내지 않았으면 true, 끝내면 false. 리허설·다른 판매자의 방송은 세지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const api = client(world, seller.cookie)
    expect(await live(world, seller)).toBe(false)
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await expectOk(api.post(`/api/broadcasts/${rehearsal.id}/open`, {}))
    expect(await live(world, seller)).toBe(false)
    const b = await createBroadcast(world, seller, { date: DAY })
    await expectOk(api.post(`/api/broadcasts/${b.id}/open`, {}))
    expect(await live(world, seller)).toBe(true)
    expect(await live(world, other)).toBe(false)
    await expectOk(api.post(`/api/broadcasts/${b.id}/end`, { requestId: rid() }))
    expect(await live(world, seller)).toBe(false)
  })
})
