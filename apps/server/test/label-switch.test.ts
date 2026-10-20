// N4a 라벨 기능 켬/끔 서버 규칙 (AC-N4a-01~07·41, SPEC RCP-01, LABEL_RULES L-12, L-11 2·3·7, D-N4a-01~04).
import { readFileSync } from 'node:fs'
import type { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createAutoJobs } from '../src/print-store.ts'
import { DAY, DEVICE_A, DEVICE_B, becomeDevice, labelReports, printApi, register, settled } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid, sseReader, startServer, writeEvent, type JsonResponse, type Seller, type TestServer } from './support.ts'

const open: { cancel: () => Promise<void> }[] = []
afterEach(async () => {
  for (const reader of open.splice(0)) await reader.cancel().catch(() => {})
})

const OFF_ERROR = { error: { code: 'LABELS_OFF', message: '라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.' } }

interface LabelSettingsBody {
  enabled: boolean
  history: { enabled: boolean; at: string; loginId: string }[]
  waiting: number
  rev: number
  changed?: boolean
}

function labelsApi(world: TestServer, seller: Seller) {
  const put = async (body: unknown): Promise<JsonResponse> => {
    const response = await world.server.app.request('/api/settings/labels', {
      method: 'PUT',
      headers: { Cookie: seller.cookie, Origin: 'https://app.livejjim.test', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text, headers: response.headers }
  }
  return {
    put,
    get: async (): Promise<LabelSettingsBody> => (await expectOk(client(world, seller.cookie).get('/api/settings/labels'))).body as unknown as LabelSettingsBody,
    set: async (enabled: boolean): Promise<LabelSettingsBody> => (await expectOk(put({ enabled }))).body as unknown as LabelSettingsBody,
  }
}

let messageCounter = 0
async function say(world: TestServer, seller: Seller, b: string, channel: string, nick: string, text: string, id = `n4a-${String(++messageCounter)}`): Promise<void> {
  const result = await world.server.ingestChat(seller.sellerId, { b, id, ch: channel, nick, text })
  expect(result.status).toBe('recorded')
}

async function rows<T>(world: TestServer, sql: string, params: unknown[] = []): Promise<T[]> {
  return ((await (world.database.pglite as PGlite).query<T>(sql, params)).rows as T[]).map((row) => ({ ...row }))
}

/** 출력 기록 표 전부 (판매자 조건) — 거절이 아무것도 바꾸지 않았는지 */
async function printTables(world: TestServer, sellerId: string): Promise<string> {
  const parts: string[] = []
  for (const table of ['print_queues', 'print_labels', 'print_jobs', 'print_attempts', 'label_templates', 'print_requests', 'label_switches']) {
    parts.push(`${table}:${JSON.stringify(await rows(world, `select * from ${table} where seller_id = $1 order by 1`, [sellerId]))}`)
  }
  return parts.join('\n')
}

async function stream(world: TestServer, seller: Seller, device?: string) {
  const response = await world.server.app.request(`/api/stream${device === undefined ? '' : `?device=${device}`}`, { headers: { Cookie: seller.cookie } })
  expect(response.status).toBe(200)
  const reader = sseReader(response)
  open.push(reader)
  await reader.until(() => reader.events.some((event) => event.event === 'ready'))
  return reader
}

const noticesOf = (reader: ReturnType<typeof sseReader>, kind: string) => reader.events.filter((event) => event.event === kind).map((event) => JSON.parse(event.data) as Record<string, unknown>)

async function claimsOf(world: TestServer, seller: Seller): Promise<{ id: string; buyer: string; status: string; confirmVersion: number | null; product: string; locked: boolean }[]> {
  return ((await client(world, seller.cookie).get(`/api/days/${DAY}`)).body as { claims: { id: string; buyer: string; status: string; confirmVersion: number | null; product: string; locked: boolean }[] }).claims
}

const claimOf = async (world: TestServer, seller: Seller, b: string, no: number, buyer: string) => {
  const found = (await claimsOf(world, seller)).find((claim) => claim.product === `${b}/${String(no)}` && claim.buyer === buyer)
  if (found === undefined) throw new Error('찜이 없다')
  return found
}

const jobCount = async (world: TestServer, sellerId: string): Promise<number> => (await rows<{ n: number }>(world, `select count(*)::int as n from print_jobs where seller_id = $1`, [sellerId]))[0]?.n ?? -1

describe('AC-N4a-01 라벨 기능 설정: 기본 켬, 엔진 밖, 격리, 재시작', () => {
  it('새 판매자와 I1 출력 기록이 있는 판매자 모두 켬이고 이력이 비어 있다. 켜진 판매자의 출력은 I1 그대로', async () => {
    const world = await newWorld()
    const fresh = await addSeller(world)
    expect(await labelsApi(world, fresh).get()).toEqual({ enabled: true, history: [], waiting: 0, rev: 0 })
    expect((await printApi(world, fresh).overview()).queue.labelsEnabled).toBe(true)
    // 켬 조회는 대기열 줄을 만들지 않는다
    expect(await rows(world, `select * from print_queues where seller_id = $1`, [fresh.sellerId])).toEqual([])

    const old = await addSeller(world)
    const b = await createBroadcast(world, old, { date: DAY })
    await register(world, old, b.id, 15)
    await say(world, old, b.id, 'UC_A', '홍길동', '15')
    const p = printApi(world, old)
    await becomeDevice(world, old)
    const held = await p.claim(DEVICE_A)
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
    const settings = await labelsApi(world, old).get()
    expect(settings).toMatchObject({ enabled: true, history: [], waiting: 0 })
    expect((await p.overview()).queue).toMatchObject({ labelsEnabled: true, device: { id: DEVICE_A }, pause: null })
    // 이 칸이 생기기 전의 대기열 줄도 켬이다 (마이그레이션 기본값)
    const column = await rows<{ column_default: string; is_nullable: string }>(world, `select column_default, is_nullable from information_schema.columns where table_name = 'print_queues' and column_name = 'labels_enabled'`)
    expect(column).toEqual([{ column_default: 'true', is_nullable: 'NO' }])
  })

  it('켬/끔은 판매 규칙 설정이 아니다: /api/settings에 없고, 보내면 모르는 키로 거절, broadcast.start 스냅샷의 키는 켬인 판매자와 같다', async () => {
    const world = await newWorld()
    const on = await addSeller(world)
    const off = await addSeller(world)
    await labelsApi(world, off).set(false)
    const settings = (await expectOk(client(world, off.cookie).get('/api/settings'))).body as { settings: Record<string, unknown> }
    expect(JSON.stringify(settings)).not.toMatch(/label/i)
    for (const key of ['labels', 'labels.enabled', 'labelsEnabled', 'print.labels']) {
      const refused = await client(world, off.cookie).patch('/api/settings', { settings: { [key]: false } })
      expect(refused.status, key).toBe(400)
    }
    expect((await client(world, off.cookie).patch('/api/settings', { labelsEnabled: false })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    await createBroadcast(world, on, { date: DAY })
    await createBroadcast(world, off, { date: DAY })
    const starts = await rows<{ seller_id: string; body: string }>(world, `select seller_id, body from events where type = 'broadcast.start'`)
    const keysOf = (sellerId: string) => {
      const body = JSON.parse(starts.find((row) => row.seller_id === sellerId)?.body ?? '{}') as Record<string, unknown>
      return { top: Object.keys(body).sort(), settings: Object.keys((body.settings ?? {}) as Record<string, unknown>).sort() }
    }
    expect(keysOf(off.sellerId)).toEqual(keysOf(on.sellerId))
    expect(keysOf(off.sellerId).settings.length).toBeGreaterThan(0)
    expect(JSON.stringify(starts.map((row) => JSON.parse(row.body) as unknown))).not.toMatch(/label/i)
  })

  it('켬/끔과 이력은 서버를 다시 켜도 그대로다. 다른 판매자의 켬/끔은 보이지 않고, 한 판매자가 꺼도 다른 판매자의 자동 작업은 생긴다', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const other = await addSeller(world)
    await labelsApi(world, a).set(false)
    world.server.close()
    const again = startServer(world.database, world.masterKey, { clock: world.clock })
    const settings = await labelsApi(again, a).get()
    expect(settings.enabled).toBe(false)
    expect(settings.history).toEqual([{ enabled: false, at: new Date(world.clock.now()).toISOString(), loginId: a.loginId }])
    expect(await labelsApi(again, other).get()).toEqual({ enabled: true, history: [], waiting: 0, rev: 0 })
    const b = await createBroadcast(again, other, { date: DAY })
    await register(again, other, b.id, 15)
    await say(again, other, b.id, 'UC_A', '홍길동', '15')
    expect((await printApi(again, other).overview()).jobs).toHaveLength(1)
    again.server.close()
  })
})

describe('AC-N4a-02 켜고 끄기·이력·실시간', () => {
  it('값이 실제로 바뀔 때만 이력 한 줄, 같은 값은 아무것도 없다. 조회는 최근 20줄 새것 먼저', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const labels = labelsApi(world, seller)
    const same = await labels.set(true)
    expect(same).toEqual({ enabled: true, history: [], waiting: 0, rev: 0, changed: false })
    expect(await rows(world, `select * from print_queues where seller_id = $1`, [seller.sellerId])).toEqual([])
    const off = await labels.set(false)
    expect(off).toMatchObject({ enabled: false, changed: true, history: [{ enabled: false, at: new Date(world.clock.now()).toISOString(), loginId: seller.loginId }] })
    const before = await printTables(world, seller.sellerId)
    expect(await labels.set(false)).toMatchObject({ enabled: false, changed: false })
    expect(await printTables(world, seller.sellerId)).toBe(before)
    for (let index = 0; index < 24; index++) {
      world.clock.advance(60_000)
      await labels.set(index % 2 === 0)
    }
    const settings = await labels.get()
    expect(settings.history).toHaveLength(20)
    expect(settings.history[0]).toEqual({ enabled: false, at: new Date(world.clock.now()).toISOString(), loginId: seller.loginId })
    expect(settings.history.map((entry) => entry.at)).toEqual([...settings.history.map((entry) => entry.at)].sort().reverse())
    expect((await rows<{ n: number }>(world, `select count(*)::int as n from label_switches where seller_id = $1`, [seller.sellerId]))[0]?.n).toBe(25)
    // 이력은 지우는 경로가 없다
    for (const method of ['DELETE', 'POST', 'PATCH']) {
      const response = await world.server.app.request('/api/settings/labels', { method, headers: { Cookie: seller.cookie, Origin: 'https://app.livejjim.test', 'Content-Type': 'application/json' }, body: '{}' })
      expect(response.status, method).toBe(404)
    }
  })

  it('본문은 켬/끔 값 하나만: 불리언이 아니면 INVALID_INPUT, 다른 칸은 UNKNOWN_FIELD. 로그인·Origin·JSON 검사는 공통 그대로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const labels = labelsApi(world, seller)
    const invalid = { error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'enabled', message: '라벨 기능은 켜기나 끄기로만 정할 수 있어요.' }] } }
    for (const body of [{}, { enabled: 'false' }, { enabled: 0 }, { enabled: null }]) expect((await labels.put(body)).body).toEqual(invalid)
    const unknown = await labels.put({ enabled: false, sellerId: 'x' })
    expect(unknown.status).toBe(400)
    expect(unknown.body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    expect((await world.server.app.request('/api/settings/labels', { method: 'PUT', headers: { Cookie: seller.cookie, Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{"enabled":false}' })).status).toBe(403)
    expect((await world.server.app.request('/api/settings/labels', { method: 'PUT', headers: { Cookie: seller.cookie, Origin: 'https://app.livejjim.test', 'Content-Type': 'text/plain' }, body: '{"enabled":false}' })).status).toBe(415)
    expect((await world.server.app.request('/api/settings/labels', { method: 'PUT', headers: { Origin: 'https://app.livejjim.test', 'Content-Type': 'application/json' }, body: '{"enabled":false}' })).status).toBe(401)
    expect((await world.server.app.request('/api/settings/labels')).status).toBe(401)
    expect((await labels.get()).enabled).toBe(true)
  })

  it('두 기기에서 동시에 여러 번 와도 한 줄씩: 이력 줄 수 = 실제로 바뀐 횟수, 마지막 줄 = 지금 값', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const labels = labelsApi(world, seller)
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => labels.put({ enabled: index % 3 === 0 })))
    expect(results.every((result) => result.status === 200)).toBe(true)
    const changed = results.filter((result) => result.body.changed === true).length
    const history = await rows<{ enabled: boolean }>(world, `select enabled from label_switches where seller_id = $1 order by id`, [seller.sellerId])
    expect(history).toHaveLength(changed)
    // 이웃한 줄은 늘 다른 값이다 (실제로 바뀐 것만), 첫 줄은 기본(켬)에서 바뀐 끔
    history.forEach((row, index) => expect(row.enabled).toBe(index % 2 === 1))
    expect((await labels.get()).enabled).toBe(history.at(-1)?.enabled ?? true)
  })

  it('바뀌면 그 판매자의 모든 연결에 labels 알림과 print 알림(queue.labelsEnabled)이 간다. 다른 판매자에게는 아무것도 가지 않는다. 로그에 본문·아이디가 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const pc = await stream(world, seller)
    const phone = await stream(world, seller, DEVICE_A)
    const theirs = await stream(world, other)
    const set = await labelsApi(world, seller).set(false)
    for (const reader of [pc, phone]) {
      await reader.until(() => noticesOf(reader, 'labels').length > 0 && noticesOf(reader, 'print').some((notice) => (notice.queue as { labelsEnabled: boolean }).labelsEnabled === false))
      expect(noticesOf(reader, 'labels')).toEqual([{ rev: set.rev, enabled: false, entry: { enabled: false, at: new Date(world.clock.now()).toISOString(), loginId: seller.loginId } }])
    }
    // 같은 값이면 알림도 없다
    await labelsApi(world, seller).set(false)
    await settled(world)
    expect(noticesOf(pc, 'labels')).toHaveLength(1)
    expect(noticesOf(theirs, 'labels')).toEqual([])
    expect(noticesOf(theirs, 'print')).toEqual([])
    expect(JSON.stringify(world.logs)).not.toContain(seller.loginId)
    expect(JSON.stringify(world.logs)).not.toMatch(/enabled/)
  })
})

describe('AC-N4a-03 꺼져 있으면 자동 작업이 없다 — 판정·감사는 그대로', () => {
  /** 같은 이벤트 순서 (첫 판정·승계·직접 배정·재고 늘림·문자찜). 결정적 ID로 두 세계에 똑같이 넣는다 */
  async function scenario(enabled: boolean): Promise<{ world: TestServer; seller: Seller; b: string }> {
    let sms = 0
    const world = await newWorld({ ids: { broadcast: () => 'b_same', scope: () => 'scp_same', smsRef: () => `r${'a'.repeat(18)}${'abcdefghijklmnopqrstuvwxyz'[sms++] ?? 'z'}` } })
    const seller = await addSeller(world, `cmp${enabled ? 'on' : 'off'}`)
    if (!enabled) await labelsApi(world, seller).set(false)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (const no of [1, 2, 3, 4]) await register(world, seller, b.id, no, `품종${String(no)}`, 1000 * no)
    await say(world, seller, b.id, 'UC_A', '홍길동', '1', 'm1')
    await say(world, seller, b.id, 'UC_B', '김철수', '1', 'm2')
    await say(world, seller, b.id, 'UC_C', '이영희', '2', 'm3')
    await say(world, seller, b.id, 'UC_D', '박민수', '2', 'm4')
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 3, received: '12:00', memo: '김 이모' }))
    await expectOk(writeEvent(world, seller, { type: 'host.assign', b: b.id, no: 4, buyer: 'UC_C', reason: '전화 주문' }))
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 1, buyer: 'UC_A', reason: '구매자 요청' }))
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, no: 2, stock: 2 }))
    return { world, seller, b: b.id }
  }

  it('같은 이벤트 순서를 켬·끔 판매자에 넣으면 엔진 상태·효과·발송함 행이 같고 다른 것은 출력 작업의 유무뿐', async () => {
    const on = await scenario(true)
    const off = await scenario(false)
    const engineSide = async ({ world, seller }: { world: TestServer; seller: Seller }) => ({
      view: (await expectOk(client(world, seller.cookie).get(`/api/days/${DAY}`))).body,
      events: await rows(world, `select seq, type, body, changed, failed from events where seller_id = $1 order by seq`, [seller.sellerId]),
      outbox: await rows(world, `select effect_id, seq, kind, body, rehearsal from outbox where seller_id = $1 order by id`, [seller.sellerId]),
    })
    const left = await engineSide(on)
    const right = await engineSide(off)
    expect(right).toEqual(left)
    const labelEffects = (left.outbox as { kind: string; effect_id: string }[]).filter((row) => row.kind === 'PRINT_PRODUCT_LABEL')
    // 첫 판정 A·C, 문자찜, 직접 배정, 승계 B, 재고 늘림 D
    expect(labelEffects).toHaveLength(6)
    expect((left.outbox as { kind: string }[]).some((row) => row.kind === 'POST_THANKS')).toBe(true)
    const onJobs = await rows<{ job_id: string; reason: string }>(on.world, `select job_id, reason from print_jobs where seller_id = $1 order by id`, [on.seller.sellerId])
    expect(onJobs.map((job) => job.job_id).sort()).toEqual(labelEffects.map((row) => row.effect_id).sort())
    expect(await jobCount(off.world, off.seller.sellerId)).toBe(0)
    expect(await rows(off.world, `select * from print_labels where seller_id = $1`, [off.seller.sellerId])).toEqual([])
    const overview = await printApi(off.world, off.seller).overview()
    expect(overview).toMatchObject({ jobs: [], discard: [], queue: { waiting: 0, printing: 0, labelsEnabled: false } })
    // 꺼진 동안 1등이 된 상품은 라벨 상태 "작업 없음"(NONE)이고 손으로 출력할 수 있는 모양이다
    const labels = await printApi(off.world, off.seller).labels()
    expect(labels.labels.map((label) => [label.no, label.state, label.canPrint])).toEqual([
      [1, 'NONE', true],
      [2, 'NONE', true],
      [2, 'NONE', true],
      [3, 'NONE', true],
      [4, 'NONE', true],
    ])
  })

  it('꺼져 있으면 실시간 출력 알림도 작업 때문에 나가지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await labelsApi(world, seller).set(false)
    await settled(world)
    const reader = await stream(world, seller)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await say(world, seller, b.id, 'UC_A', '홍길동', '15')
    await settled(world)
    await reader.until(() => reader.events.filter((event) => event.event === 'change').length >= 3)
    expect(noticesOf(reader, 'print')).toEqual([])
  })

  it('바꾼 때부터: 같은 방송에서 켬 → 끔 → 켬 → 끔, 자동 작업 = 켬이던 동안 기록된 효과 수. 재전송은 작업을 새로 만들지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const labels = labelsApi(world, seller)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (const no of [1, 2, 3, 4, 5, 6]) await register(world, seller, b.id, no)
    await say(world, seller, b.id, 'UC_1', 'n1', '1') // 켬 → 작업
    await labels.set(false)
    await say(world, seller, b.id, 'UC_2', 'n2', '2') // 끔
    const smsRequest = rid('sms')
    await expectOk(client(world, seller.cookie).post('/api/events', { requestId: smsRequest, type: 'sms', b: b.id, no: 3, received: '12:00', memo: '이모' })) // 끔
    await labels.set(true)
    await say(world, seller, b.id, 'UC_4', 'n4', '4', 'again-4') // 켬 → 작업
    await labels.set(false)
    await say(world, seller, b.id, 'UC_5', 'n5', '5') // 끔
    // 끔 동안의 재전송(같은 요청 번호·메시지 ID) — 처음 기록 때 정해진 대로
    await labels.set(true)
    await expectOk(client(world, seller.cookie).post('/api/events', { requestId: smsRequest, type: 'sms', b: b.id, no: 3, received: '12:00', memo: '이모' }))
    expect((await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'again-4', ch: 'UC_4', nick: 'n4', text: '4' })).status).not.toBe('recorded')
    await say(world, seller, b.id, 'UC_6', 'n6', '6') // 켬 → 작업
    const jobs = await rows<{ no: number; reason: string }>(world, `select l.no, j.reason from print_jobs j join print_labels l on l.id = j.label_id where j.seller_id = $1 order by j.id`, [seller.sellerId])
    expect(jobs).toEqual([
      { no: 1, reason: 'auto' },
      { no: 4, reason: 'auto' },
      { no: 6, reason: 'auto' },
    ])
    const effects = await rows<{ n: number }>(world, `select count(*)::int as n from outbox where seller_id = $1 and kind = 'PRINT_PRODUCT_LABEL'`, [seller.sellerId])
    expect(effects[0]?.n).toBe(6)
    // 켰을 때 대기 작업이 있었으므로 쌓인 라벨(판매자 멈춤)이다
    expect((await printApi(world, seller).overview()).queue.pause).toEqual({ reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true })
  })

  it('켬/끔은 기록 트랜잭션 안에서 읽는다: 같은 트랜잭션에서 바꾼 값을 따르고, 기록 도중의 끄기는 그 기록이 커밋된 뒤에야 처리된다', async () => {
    // 소스 검사: 효과 → 작업은 잠근 대기열 줄(lockQueue(tx…))의 labelsEnabled로 거르고, txHook은 미리 읽은 값을 받지 않는다
    const store = readFileSync(new URL('../src/print-store.ts', import.meta.url), 'utf8')
    const fn = store.slice(store.indexOf('export async function createAutoJobs'), store.indexOf('// ── 라벨 키'))
    expect(fn).toMatch(/const queue = await lockQueue\(tx, sellerId, now\)\s+\/\/[^\n]*\n\s+\/\/[^\n]*\n\s+if \(!queue\.labelsEnabled\) return \{ labels: \[\], jobs: \[\] \}/)
    const service = readFileSync(new URL('../src/print.ts', import.meta.url), 'utf8')
    const hook = service.slice(service.indexOf('readonly txHook = async'), service.indexOf('// ── 알림 (AC-I1-15)'))
    expect(hook).not.toMatch(/labelsEnabled|labelsOff|readQueue/)

    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await say(world, seller, b.id, 'UC_A', '홍길동', '15')
    const scopeId = (await rows<{ id: string }>(world, `select id from scopes where seller_id = $1`, [seller.sellerId]))[0]?.id ?? ''
    // 커밋된 값은 켬이지만 같은 트랜잭션 안에서 끈 값을 따른다 (롤백해 둔다)
    const inTx = await world.database.db
      .transaction(async (tx) => {
        await tx.execute(sql`delete from print_jobs where seller_id = ${seller.sellerId}`)
        await tx.execute(sql`delete from print_labels where seller_id = ${seller.sellerId}`)
        await tx.execute(sql`update print_queues set labels_enabled = false where seller_id = ${seller.sellerId}`)
        const created = await createAutoJobs(tx, seller.sellerId, scopeId, 0, 1000, () => JSON.stringify({ kind: 'sms' }), new Date())
        throw Object.assign(new Error('rollback'), { created })
      })
      .catch((error: { created?: unknown }) => error.created)
    expect(inTx).toEqual({ labels: [], jobs: [] })
    expect(await jobCount(world, seller.sellerId)).toBe(1)

    // 기록 도중(커밋 전)에 보낸 끄기는 그 기록이 끝난 뒤 처리된다 — 그 기록의 효과는 켬 값으로 작업이 되고, 끄기 응답 뒤의 기록은 작업이 없다
    let toggle: Promise<LabelSettingsBody> | null = null
    const hooked = startServer(world.database, world.masterKey, {
      clock: world.clock,
      hooks: {
        beforeCommit: (records) => {
          if (toggle === null && records.some((record) => record.effects.some((effect) => effect.kind === 'PRINT_PRODUCT_LABEL'))) toggle = labelsApi(hooked, seller).set(false)
        },
      },
    })
    await register(hooked, seller, b.id, 16)
    await say(hooked, seller, b.id, 'UC_B', '김철수', '16')
    expect(toggle).not.toBeNull()
    expect((await (toggle as unknown as Promise<LabelSettingsBody>)).enabled).toBe(false)
    expect(await jobCount(world, seller.sellerId)).toBe(2)
    await register(hooked, seller, b.id, 17)
    await say(hooked, seller, b.id, 'UC_C', '이영희', '17')
    expect(await jobCount(world, seller.sellerId)).toBe(2)
    hooked.server.close()
  })
})

describe('AC-N4a-04 꺼져 있어도 폐기와 버릴 라벨은 그대로', () => {
  it('출력한 1등 취소 → 버릴 라벨, 대기 작업의 1등 취소 → 출력 안 함 + 폐기, 승계자는 작업 없음, 버렸어요는 꺼진 채로', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await register(world, seller, b.id, 16)
    await say(world, seller, b.id, 'UC_A', '홍길동', '15')
    await say(world, seller, b.id, 'UC_B', '김철수', '16')
    await say(world, seller, b.id, 'UC_C', '이영희', '15')
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const first = await p.claim(DEVICE_A)
    expect(first.job?.label.no).toBe(15)
    expect(await p.done(DEVICE_A, first.job?.attempt ?? '')).toBe(true)
    const waitingB = (await p.overview()).jobs.find((job) => job.label.no === 16)
    expect(waitingB?.status).toBe('WAITING')
    await labelsApi(world, seller).set(false)
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UC_A', reason: '구매자 요청' }))
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 16, buyer: 'UC_B', reason: '구매자 요청' }))
    const overview = await p.overview()
    expect(overview.queue).toMatchObject({ discard: 1, waiting: 0, labelsEnabled: false })
    expect(overview.discard.map((job) => [job.id, job.word, job.discard])).toEqual([[first.job?.id, '폐기 — 버려 주세요', true]])
    const all = await rows<{ job_id: string; status: string; voided: boolean }>(world, `select job_id, status, voided from print_jobs where seller_id = $1 order by id`, [seller.sellerId])
    expect(all).toEqual([
      { job_id: first.job?.id, status: 'DONE', voided: true },
      { job_id: waitingB?.id, status: 'CANCELLED', voided: true },
    ])
    // 승계자 C의 확정 효과는 작업이 되지 않는다 (효과는 있다)
    const c = await claimOf(world, seller, b.id, 15, 'UC_C')
    expect(c.status).toBe('CONFIRMED')
    expect((await rows<{ n: number }>(world, `select count(*)::int as n from outbox where seller_id = $1 and kind = 'PRINT_PRODUCT_LABEL' and body like $2`, [seller.sellerId, `%"claim":"${c.id}"%`]))[0]?.n).toBe(1)
    // 꺼진 채로 버렸어요
    const discarded = await expectOk(p.discard(DAY, first.job?.id ?? ''))
    expect(discarded.body).toMatchObject({ job: { discard: false, word: '폐기' } })
    const row = (await rows<{ discarded_by: string; discarded_at: Date | null }>(world, `select discarded_by, discarded_at from print_jobs where seller_id = $1 and job_id = $2`, [seller.sellerId, first.job?.id]))[0]
    expect(row?.discarded_by).toBe(seller.accountId)
    expect(row?.discarded_at).not.toBeNull()
    expect((await p.overview()).discard).toEqual([])
  })
})

describe('AC-N4a-05 꺼져 있을 때 거절하는 요청과 받는 요청', () => {
  it('출력을 새로 시작하거나 라벨을 새로 만드는 요청은 LABELS_OFF이고 아무것도 바뀌지 않는다. 켠 뒤 같은 요청 번호는 처음처럼 처리된다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (const no of [1, 2, 3]) await register(world, seller, b.id, no)
    await say(world, seller, b.id, 'UC_1', 'n1', '1')
    await say(world, seller, b.id, 'UC_2', 'n2', '2')
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const printed = await p.claim(DEVICE_A)
    expect(await p.done(DEVICE_A, printed.job?.attempt ?? '')).toBe(true)
    // 이미 처리한 요청 번호 (켜 있을 때)
    const templates = (await expectOk(p.api.get('/api/print/templates'))).body as { product: { template: Record<string, unknown>; version: number } }
    await labelsApi(world, seller).set(false)
    await say(world, seller, b.id, 'UC_3', 'n3', '3') // 꺼진 동안 1등 — 작업 없음
    const claim3 = await claimOf(world, seller, b.id, 3, 'UC_3')
    const claim1 = await claimOf(world, seller, b.id, 1, 'UC_1')
    const before = await printTables(world, seller.sellerId)
    const printRequest = rid('pl')
    const packingRequest = rid('pk')
    const refused: JsonResponse[] = [
      await p.print(b.id, claim3.id, printRequest),
      await p.reprint(b.id, claim1.id),
      await p.packing(DAY, 'UC_1', packingRequest),
      await p.register(DEVICE_A, '휴대폰'),
      await p.register(DEVICE_B, '판매 PC'),
      await p.register(DEVICE_B, '판매 PC', true),
      await p.claimRaw(DEVICE_A),
      await p.claimRaw(DEVICE_B),
      await p.restart(),
      await p.put('/api/print/templates/product', { template: templates.product.template, version: templates.product.version }),
      await p.put('/api/print/templates/packing', { template: { nonsense: true }, version: 0 }),
    ]
    for (const response of refused) {
      expect(response.status, response.text).toBe(409)
      expect(response.body).toEqual(OFF_ERROR)
    }
    // 멈춰 있어도 다시 시작·출력 시작은 거절
    await expectOk(p.pause())
    const pausedBefore = await printTables(world, seller.sellerId)
    expect((await p.restart()).body).toEqual(OFF_ERROR)
    expect(await printTables(world, seller.sellerId)).toBe(pausedBefore)
    // 거절한 것은 아무것도 남기지 않았다 (멈추기만 바뀜)
    const after = await printTables(world, seller.sellerId)
    expect(after.replace(/"paused":"SELLER"/, '"paused":null').replace(/"rev":\d+/, '')).toBe(before.replace(/"rev":\d+/, ''))
    // 리허설 범위는 리허설 거절이 먼저다
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    expect((await p.print(rehearsal.id, 'c1')).body).toEqual({ error: { code: 'PRINT_REHEARSAL', message: '리허설 방송은 라벨을 출력하지 않아요.' } })
    expect((await p.reprint(rehearsal.id, 'c1')).body).toMatchObject({ error: { code: 'PRINT_REHEARSAL' } })
    expect((await p.api.post('/api/print/packing', { requestId: rid('pk'), date: DAY, buyer: 'UC_1', rehearsal: true })).body).toMatchObject({ error: { code: 'PRINT_REHEARSAL' } })
    // 켠 뒤 같은 요청 번호 → 처음 보낸 것처럼
    await labelsApi(world, seller).set(true)
    const made = await expectOk(p.print(b.id, claim3.id, printRequest))
    expect(made.body).toMatchObject({ jobs: [{ reason: 'manual', status: 'WAITING', label: { no: 3 } }] })
    const packed = await expectOk(p.packing(DAY, 'UC_1', packingRequest))
    expect((packed.body.jobs as unknown[]).length).toBeGreaterThan(0)
  })

  it('켜 있을 때 이미 처리한 요청 번호의 재전송은 꺼져 있어도 처음 결과(새로 만드는 것이 없다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world, undefined)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'print.autoOnConfirm': false } }))
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 1)
    await say(world, seller, b.id, 'UC_1', 'n1', '1')
    const p = printApi(world, seller)
    const claim = await claimOf(world, seller, b.id, 1, 'UC_1')
    const request = rid('pl')
    const first = await expectOk(p.print(b.id, claim.id, request))
    await labelsApi(world, seller).set(false)
    const again = await expectOk(p.print(b.id, claim.id, request))
    expect(again.body).toEqual(first.body)
    expect(await jobCount(world, seller.sellerId)).toBe(1)
  })

  it('줄이거나 끝내는 요청과 조회는 받는다: 빼기·모두 빼기·멈추기·출력 그만하기·프린터 연결 알림·조회', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (const no of [1, 2, 3]) {
      await register(world, seller, b.id, no)
      await say(world, seller, b.id, `UC_${String(no)}`, `n${String(no)}`, String(no))
    }
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await labelsApi(world, seller).set(false)
    const overview = await p.overview()
    expect(overview.jobs).toHaveLength(3)
    expect((await expectOk(p.cancel(DAY, overview.jobs[0]?.id ?? ''))).body).toMatchObject({ job: { status: 'CANCELLED' } })
    expect((await expectOk(p.pause())).body).toMatchObject({ queue: { pause: { reason: 'SELLER' }, labelsEnabled: false } })
    expect((await expectOk(p.state(DEVICE_A, false))).body).toMatchObject({ queue: { device: { printerConnected: false } } })
    expect((await expectOk(p.state(DEVICE_A, true))).body).toMatchObject({ queue: { device: { printerConnected: true } } })
    expect((await expectOk(p.cancelAll())).body).toMatchObject({ cancelled: 2, queue: { waiting: 0 } })
    expect((await expectOk(p.release())).body).toMatchObject({ queue: { device: null } })
    await expectOk(p.api.get('/api/print'))
    await expectOk(p.api.get(`/api/print/labels?date=${DAY}`))
    await expectOk(p.api.get(`/api/print/packing?date=${DAY}&buyer=UC_1`))
    await expectOk(p.api.get('/api/print/templates'))
    await expectOk(p.api.get('/api/settings/labels'))
  })
})

describe('AC-N4a-06 끌 때와 켤 때의 대기열', () => {
  async function setup() {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (const no of [1, 2, 3, 4]) {
      await register(world, seller, b.id, no)
      await say(world, seller, b.id, `UC_${String(no)}`, `n${String(no)}`, String(no))
    }
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const held = await p.claim(DEVICE_A)
    expect(held.job?.label.no).toBe(1)
    return { world, seller, b: b.id, p, held }
  }

  it('끄면 대기 3장·출력 기기·멈춤 그대로, 받기는 LABELS_OFF, 출력 중이던 장의 출력함은 기록하고 보고한다. 켜면 판매자 멈춤 + 쌓인 라벨, 출력 시작 뒤 먼저 들어온 순서', async () => {
    const { world, seller, p, held } = await setup()
    await labelsApi(world, seller).set(false)
    const off = await p.overview()
    expect(off.queue).toMatchObject({ waiting: 3, printing: 1, pause: null, device: { id: DEVICE_A }, labelsEnabled: false })
    expect(off.jobs.map((job) => job.status)).toEqual(['PRINTING', 'WAITING', 'WAITING', 'WAITING'])
    expect((await p.claimRaw(DEVICE_A)).body).toEqual(OFF_ERROR)
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(false)
    expect((await labelReports(world, seller.sellerId)).map((report) => report.effectId)).toEqual([held.job?.id])
    const turnedOn = await labelsApi(world, seller).set(true)
    expect(turnedOn.waiting).toBe(3)
    const on = await p.overview()
    expect(on.queue).toMatchObject({ waiting: 3, labelsEnabled: true, pause: { reason: 'SELLER', message: '출력을 멈췄어요.', backlog: true } })
    expect((await p.claim(DEVICE_A)).reason).toBe('PAUSED')
    await expectOk(p.restart())
    const order: number[] = []
    for (let index = 0; index < 3; index++) {
      const next = await p.claim(DEVICE_A)
      order.push(next.job?.label.no ?? 0)
      expect(await p.done(DEVICE_A, next.job?.attempt ?? '')).toBe(true)
    }
    expect(order).toEqual([2, 3, 4])
  })

  it('꺼진 동안 출력 중이던 장이 실패하면 I1대로 대기 맨 앞·멈춤, 켜도 손으로 푸는 멈춤은 그대로', async () => {
    const { world, seller, p, held } = await setup()
    await labelsApi(world, seller).set(false)
    expect(await p.fail(DEVICE_A, held.job?.attempt ?? '', 'PRINT_FAILED')).toBe(true)
    const off = await p.overview()
    expect(off.queue).toMatchObject({ waiting: 4, pause: { reason: 'PRINTER_ERROR', backlog: false } })
    expect(off.jobs[0]?.label.no).toBe(1)
    await labelsApi(world, seller).set(true)
    expect((await p.overview()).queue.pause).toMatchObject({ reason: 'PRINTER_ERROR', backlog: false })
  })

  it('켤 때: 끊김 멈춤 + 대기 → 판매자 멈춤(쌓인 라벨), 판매자 멈춤은 그대로(쌓인 라벨 아님), 대기 작업이 없으면 대기열을 바꾸지 않는다', async () => {
    const disconnected = await setup()
    expect(await disconnected.p.fail(DEVICE_A, disconnected.held.job?.attempt ?? '', 'DISCONNECTED')).toBe(true)
    expect((await disconnected.p.overview()).queue.pause?.reason).toBe('DISCONNECTED')
    await labelsApi(disconnected.world, disconnected.seller).set(false)
    await labelsApi(disconnected.world, disconnected.seller).set(true)
    expect((await disconnected.p.overview()).queue.pause).toMatchObject({ reason: 'SELLER', backlog: true })
    // 출력 시작을 눌러도 프린터가 끊겨 있으면 끊김 멈춤 (I1 그대로)
    await expectOk(disconnected.p.restart())
    expect((await disconnected.p.overview()).queue.pause?.reason).toBe('DISCONNECTED')

    const seller = await setup()
    await expectOk(seller.p.pause())
    await labelsApi(seller.world, seller.seller).set(false)
    await labelsApi(seller.world, seller.seller).set(true)
    expect((await seller.p.overview()).queue.pause).toMatchObject({ reason: 'SELLER', backlog: false })

    const empty = await setup()
    expect(await empty.p.done(DEVICE_A, empty.held.job?.attempt ?? '')).toBe(true)
    await expectOk(empty.p.cancelAll())
    await labelsApi(empty.world, empty.seller).set(false)
    const before = (await empty.p.overview()).queue
    await labelsApi(empty.world, empty.seller).set(true)
    const after = (await empty.p.overview()).queue
    expect({ ...after, rev: 0, labelsEnabled: false }).toEqual({ ...before, rev: 0 })
    expect(after.pause).toBeNull()
    // 켠 뒤 새 1등의 자동 작업은 바로 받는다
    await register(empty.world, empty.seller, empty.b, 9)
    await say(empty.world, empty.seller, empty.b, 'UC_9', 'n9', '9')
    expect((await empty.p.claim(DEVICE_A)).job?.label.no).toBe(9)
  })
})

describe('AC-N4a-07 켠 뒤 손으로 출력한 라벨은 끈 동안의 효과와 묶어 보고한다', () => {
  it('끈 동안 1등 A → 켜고 라벨 출력 → 출력함이면 effect.labelPrinted 한 번(재전송·다시 출력·재시작에도), A의 "15 취소"는 취소 요청', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'cancel.buyerChat': 'AUTO' } }))
    await labelsApi(world, seller).set(false)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15, '핑크프릴', 10000)
    await say(world, seller, b.id, 'UC_A', '홍길동', '15')
    const a = await claimOf(world, seller, b.id, 15, 'UC_A')
    const effect = (await rows<{ effect_id: string }>(world, `select effect_id from outbox where seller_id = $1 and kind = 'PRINT_PRODUCT_LABEL'`, [seller.sellerId]))[0]?.effect_id
    expect(effect).toBeDefined()
    expect(await jobCount(world, seller.sellerId)).toBe(0)
    await labelsApi(world, seller).set(true)
    const p = printApi(world, seller)
    const made = await expectOk(p.print(b.id, a.id))
    expect(made.body).toMatchObject({ jobs: [{ reason: 'manual', status: 'WAITING', label: { key: `${a.id}@1`, buyer: { kind: 'youtube', name: '홍길동' } } }] })
    await becomeDevice(world, seller)
    const held = await p.claim(DEVICE_A)
    expect(held.job?.reason).toBe('manual')
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(false)
    expect((await labelReports(world, seller.sellerId)).map((report) => report.effectId)).toEqual([effect])
    await expectOk(p.reprint(b.id, a.id))
    const reprinted = await p.claim(DEVICE_A)
    expect(await p.done(DEVICE_A, reprinted.job?.attempt ?? '')).toBe(true)
    world.server.close()
    const again = startServer(world.database, world.masterKey, { clock: world.clock })
    expect(await labelReports(again, seller.sellerId)).toHaveLength(1)
    expect((await claimOf(again, seller, b.id, 15, 'UC_A')).locked).toBe(true)
    await say(again, seller, b.id, 'UC_A', '홍길동', '15 취소')
    const after = await claimOf(again, seller, b.id, 15, 'UC_A')
    expect(after.status).toBe('CONFIRMED')
    const view = (await client(again, seller.cookie).get(`/api/days/${DAY}`)).body as { cancelRequests: { claim: string }[] }
    expect(view.cancelRequests.map((request) => request.claim)).toEqual([a.id])
    again.server.close()
  })

  it('비교: 켜 둔 채 자동 출력을 끈 방송에서 손으로 출력한 라벨은 보고하지 않는다 — A의 "15 취소"는 바로 취소', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'cancel.buyerChat': 'AUTO', 'print.autoOnConfirm': false } }))
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await say(world, seller, b.id, 'UC_A', '홍길동', '15')
    const a = await claimOf(world, seller, b.id, 15, 'UC_A')
    const p = printApi(world, seller)
    await expectOk(p.print(b.id, a.id))
    await becomeDevice(world, seller)
    const held = await p.claim(DEVICE_A)
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
    expect(await labelReports(world, seller.sellerId)).toEqual([])
    await say(world, seller, b.id, 'UC_A', '홍길동', '15 취소')
    expect((await claimOf(world, seller, b.id, 15, 'UC_A')).status).toBe('CANCELLED')
  })

  it('끈 동안 1등이었다가 켜기 전에 취소·승계된 찜은 라벨 출력이 거절되고, 지금 1등은 출력할 수 있다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await labelsApi(world, seller).set(false)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await say(world, seller, b.id, 'UC_A', '홍길동', '15')
    await say(world, seller, b.id, 'UC_C', '이영희', '15')
    const a = await claimOf(world, seller, b.id, 15, 'UC_A')
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UC_A', reason: '구매자 요청' }))
    await labelsApi(world, seller).set(true)
    const p = printApi(world, seller)
    expect((await p.print(b.id, a.id)).body).toEqual({ error: { code: 'PRINT_NOT_WINNER', message: '지금 1등이 아니라 라벨을 출력할 수 없어요.' } })
    const c = await claimOf(world, seller, b.id, 15, 'UC_C')
    expect((await expectOk(p.print(b.id, c.id))).body).toMatchObject({ jobs: [{ reason: 'manual', label: { buyer: { kind: 'youtube', name: '이영희' } } }] })
    const label = (await rows<{ effect_id: string | null }>(world, `select effect_id from print_labels where seller_id = $1`, [seller.sellerId]))[0]
    expect(label?.effect_id).toMatch(new RegExp(`^${c.id}:PRINT_PRODUCT_LABEL:`))
  })
})

describe('AC-N4a-41 격리·보안', () => {
  it('켬/끔 조회·바꾸기는 로그인한 판매자 자기 것만 — 판매자를 고르는 칸을 받지 않는다', async () => {
    const world = await newWorld()
    const a = await addSeller(world)
    const other = await addSeller(world)
    await labelsApi(world, a).set(false)
    expect((await labelsApi(world, other).put({ enabled: true, seller: a.sellerId })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    expect((await expectOk(client(world, other.cookie).get(`/api/settings/labels?seller=${a.sellerId}`))).body).toEqual({ enabled: true, history: [], waiting: 0, rev: 0 })
    await labelsApi(world, other).set(false)
    await labelsApi(world, other).set(true)
    const mine = await labelsApi(world, a).get()
    expect(mine.enabled).toBe(false)
    expect(mine.history.map((entry) => entry.loginId)).toEqual([a.loginId])
    expect((await labelsApi(world, other).get()).history.map((entry) => entry.loginId)).toEqual([other.loginId, other.loginId])
  })
})
