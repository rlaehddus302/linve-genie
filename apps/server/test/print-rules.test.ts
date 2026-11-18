// I1 서버 출력 기록 규칙 (AC-I1-01·03·04·08·10·11·13·14·15·16·17, LABEL_RULES L-9·L-10·L-11).
import { readFileSync } from 'node:fs'
import { defaultTemplate, labelContentKey, type ProductTemplate } from '@livejjim/label'
import { afterEach, describe, expect, it } from 'vitest'
import { autoLabelEffects, createAutoJobs } from '../src/print-store.ts'
import { productionServerOptions } from '../src/production.ts'
import { createServer } from '../src/server.ts'
import { DAY, DEVICE_A, DEVICE_B, becomeDevice, chat, labelReports, printApi, register, settled } from './print-support.ts'
import { addSeller, client, createBroadcast, dumpAllTables, expectOk, newWorld, openTestDb, rid, sseReader, startServer, writeEvent, type Seller, type TestServer } from './support.ts'
import { generateMasterKey } from '../src/secrets.ts'

const open: { cancel: () => Promise<void> }[] = []
afterEach(async () => {
  for (const reader of open.splice(0)) await reader.cancel().catch(() => {})
})

async function stream(world: TestServer, seller: Seller, device?: string) {
  const response = await world.server.app.request(`/api/stream${device === undefined ? '' : `?device=${device}`}`, { headers: { Cookie: seller.cookie } })
  expect(response.status).toBe(200)
  const reader = sseReader(response)
  open.push(reader)
  await reader.until(() => reader.events.some((event) => event.event === 'ready'))
  return reader
}

const prints = (reader: ReturnType<typeof sseReader>) => reader.events.filter((event) => event.event === 'print').map((event) => JSON.parse(event.data) as Record<string, unknown>)

async function sale(world: TestServer, seller: Seller, b: string, no: number, channel: string, nick: string, name = '구피', price = 10000): Promise<void> {
  await register(world, seller, b, no, name, price)
  await chat(world, seller, b, channel, nick, String(no))
}

async function claimsOf(world: TestServer, seller: Seller): Promise<{ id: string; buyer: string; status: string; confirmVersion: number | null; product: string }[]> {
  return ((await client(world, seller.cookie).get(`/api/days/${DAY}`)).body as { claims: { id: string; buyer: string; status: string; confirmVersion: number | null; product: string }[] }).claims
}

describe('AC-I1-04 엔진 상태 → 라벨 데이터 (L-9)', () => {
  it('닉네임 표기 선택은 대기 중인 라벨을 받을 때 적용하고, 끄면 재출력에서 원문으로 돌아온다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, b.id, 15, 'UC_A', '꽃언니-ab12')
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await expectOk(p.put('/api/settings/nickname-display', { hideSuffix: true }))
    expect((await p.api.get('/api/print')).body).toMatchObject({ queue: { hideNicknameSuffix: true } })
    const first = (await p.claim(DEVICE_A)).job!
    expect(first.data.buyer).toMatchObject({ name: '꽃언니' })
    await p.done(DEVICE_A, first.attempt)
    await expectOk(p.put('/api/settings/nickname-display', { hideSuffix: false }))
    await expectOk(p.reprint(b.id, first.label.claim!))
    expect((await p.claim(DEVICE_A)).job?.data.buyer).toMatchObject({ name: '꽃언니-ab12' })
  })

  it('(가) 닉네임이 바뀌어도 재출력은 처음 이름 (나) 대기 중 품종 고침은 고친 품종 (다) UNPAID_CLAIMS 가격은 바뀐 스냅샷', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, b.id, 15, 'UC_A', '홍길동', '핑크프릴', 10000)
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, no: 15, name: '핑크프릴 금' }))
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, no: 15, price: 12000, applyTo: 'UNPAID_CLAIMS' }))
    // 닉네임 바뀜 (다른 번호 채팅)
    await register(world, seller, b.id, 16)
    await chat(world, seller, b.id, 'UC_A', '새이름', '아무말')
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const first = await p.claim(DEVICE_A)
    expect(first.job?.data).toEqual({ no: 15, name: '핑크프릴 금', price: 12000, date: DAY, buyer: { kind: 'youtube', name: '홍길동' } })
    expect(await p.done(DEVICE_A, first.job?.attempt ?? '')).toBe(true)
    // 닉네임만 바뀐 것은 재출력 필요가 아니다
    expect((await p.labels()).labels[0]).toMatchObject({ state: 'PRINTED', reprintNeeded: false })
    const claim = first.job?.label.claim ?? ''
    await expectOk(p.reprint(b.id, claim))
    const again = await p.claim(DEVICE_A)
    expect(again.job?.data.buyer).toEqual({ kind: 'youtube', name: '홍길동' })
    expect(await p.done(DEVICE_A, again.job?.attempt ?? '')).toBe(true)
    expect((await p.labels()).labels[0]).toMatchObject({ printed: 2 })
    // 재출력은 엔진 보고를 다시 하지 않는다 (효과마다 한 번)
    expect((await labelReports(world)).length).toBe(1)
  })

  it('377번의 저장된 품종과 이번 한 장의 수정값을 구분하고 재요청은 한 장만 만든다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 377, '녹근')
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, no: 377, name: '녹금' }))
    await chat(world, seller, b.id, 'UC_A', '손님', '377')
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const first = (await p.claim(DEVICE_A)).job!
    expect(first.data.name).toBe('녹금')
    await p.done(DEVICE_A, first.attempt)
    const edits = { name: '녹금 선물', nickname: '포장용', price: 5000 }
    const input = { b: b.id, claim: first.label.claim, requestId: rid('copy'), edits }
    await expectOk(p.api.post('/api/print/labels/reprint', input))
    await expectOk(p.api.post('/api/print/labels/reprint', input))
    const copy = (await p.claim(DEVICE_A)).job!
    expect(copy.data).toMatchObject({ no: 377, name: '녹금 선물', price: 5000, buyer: { kind: 'youtube', name: '포장용' } })
    await p.done(DEVICE_A, copy.attempt)
    expect((await p.claim(DEVICE_A)).job).toBeNull()
    const history = await expectOk(p.api.get(`/api/print/labels?date=${DAY}&historyBroadcast=${b.id}`))
    expect(history.body).toMatchObject({ labels: [{ data: { name: '녹금', price: 10000 }, history: [{ data: { name: '녹금' } }, { data: { name: '녹금 선물' } }] }] })
  })

  it('직접 인쇄는 찜 없이 대기열과 출력 내역에 한 장을 남긴다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const body = { b: b.id, no: 333, name: '수박색금', price: 50000, requestId: rid('direct') }
    await expectOk(p.api.post('/api/print/labels/direct', body))
    await expectOk(p.api.post('/api/print/labels/direct', body))
    await register(world, seller, b.id, 334)
    const job = (await p.claim(DEVICE_A)).job!
    expect(job.data).toMatchObject({ no: 333, name: '수박색금', price: 50000 })
    await p.done(DEVICE_A, job.attempt)
    expect((await p.claim(DEVICE_A)).job).toBeNull()
    expect(await claimsOf(world, seller)).toEqual([])
    expect((await p.api.get(`/api/print/labels?date=${DAY}&historyBroadcast=${b.id}`)).body).toMatchObject({ labels: [{ history: [{ data: { no: 333 } }] }] })
  })

  // D-LABELTAB-01: 라이브 화면 [라벨] 탭의 인쇄 단추 — 손님 이름을 적으면 라벨에 그 이름, 비우면 옛처럼 "직접 인쇄", 너무 길면 거절
  it('직접 인쇄에 손님 이름을 적으면 라벨에 그 이름이 찍힌다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await expectOk(p.api.post('/api/print/labels/direct', { b: b.id, no: 12, name: '홍옥', price: 3000, nickname: '  꽃언니 ', requestId: rid('direct-name') }))
    const named = (await p.claim(DEVICE_A)).job!
    expect(named.data).toMatchObject({ no: 12, buyer: { kind: 'youtube', name: '꽃언니' } })
    await p.done(DEVICE_A, named.attempt)
    await expectOk(p.api.post('/api/print/labels/direct', { b: b.id, no: 13, name: '', price: 0, nickname: '', requestId: rid('direct-blank') }))
    const plain = (await p.claim(DEVICE_A)).job!
    expect(plain.data).toMatchObject({ no: 13, buyer: { kind: 'youtube', name: '직접 인쇄' } })
    await p.done(DEVICE_A, plain.attempt)
    const long = await p.api.post('/api/print/labels/direct', { b: b.id, no: 14, name: '홍옥', price: 3000, nickname: '가'.repeat(41), requestId: rid('direct-long') })
    expect(long.status).toBe(422)
    expect((await p.claim(DEVICE_A)).job).toBeNull()
  })

  it('(라) 문자찜 지정 구매자가 유튜브 채널이면 그 채널 이름(D-CLAIMADD-04) (마) 문자 구매자를 유튜브 시청자에 합쳐도 문자 구매자의 찜 라벨은 문자찜, 유튜브 쪽은 그 채널 이름', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await register(world, seller, b.id, 16)
    await register(world, seller, b.id, 17)
    await chat(world, seller, b.id, 'UC_A', '홍길동', '16')
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 15, received: '12:00', memo: '김영희 이모', phone: '010-1234-5678', buyer: 'UC_A' }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 17, received: '12:00', memo: '박 이모' }))
    const claims = await claimsOf(world, seller)
    const smsBuyer = claims.find((claim) => claim.product === `${b.id}/17`)?.buyer ?? ''
    await expectOk(writeEvent(world, seller, { type: 'buyer.merge', from: smsBuyer, into: 'UC_A', reason: '같은 사람' }, DAY))
    const p = printApi(world, seller)
    const jobs = (await p.overview()).jobs
    const byNo = new Map(jobs.map((job) => [job.label.no, job]))
    expect(byNo.get(16)?.label.buyer).toEqual({ kind: 'youtube', name: '홍길동' })
    expect(byNo.get(15)?.label.buyer).toEqual({ kind: 'youtube', name: '홍길동' })
    expect(byNo.get(17)?.label.buyer).toEqual({ kind: 'sms' })
    // 라벨 데이터·응답에 메모·전화번호·뒤 4자리가 없다 (AC-I1-17)
    const text = JSON.stringify(await p.overview()) + JSON.stringify(await p.labels())
    expect(text).not.toMatch(/김영희|박 이모|5678|010|phone/)
  })

  it('(바) 판매자가 채팅 손님을 골라 넣은 문자찜은 "닉네임으로 보이기"(named)를 켜든 끄든 라벨이 그 채널 이름, 문자 구매자는 named여도 문자찜 (D-CLAIMADD-03·04)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await register(world, seller, b.id, 16)
    await register(world, seller, b.id, 17)
    await chat(world, seller, b.id, 'UC_A', '홍길동', '예쁘네요 저요')
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 15, received: '12:00', buyer: 'UC_A', named: true }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 16, received: '12:00', buyer: 'UC_A' }))
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 17, received: '12:00', memo: '박 이모', named: true }))
    const p = printApi(world, seller)
    const byNo = new Map((await p.overview()).jobs.map((job) => [job.label.no, job]))
    expect(byNo.get(15)?.label.buyer).toEqual({ kind: 'youtube', name: '홍길동' })
    // 스위치를 켜지 않고 닉네임 손님을 골라 넣어도 라벨은 닉네임 (D-CLAIMADD-04, 사용자 "98번 찜 넣기 해서 봄가을 닉네임 골랐는데 라벨에는 문자찜으로 나오는 버그")
    expect(byNo.get(16)?.label.buyer).toEqual({ kind: 'youtube', name: '홍길동' })
    expect(byNo.get(17)?.label.buyer).toEqual({ kind: 'sms' })
    // 손으로 넣은 두 찜 모두 그 채팅 손님 한 사람의 찜이다(정산 합산)
    const claims = await claimsOf(world, seller)
    expect(claims.filter((claim) => claim.buyer === 'UC_A').map((claim) => claim.product).sort()).toEqual([`${b.id}/15`, `${b.id}/16`])
  })
})

describe('AC-I1-03 리허설 고정 (RA-S05-002)', () => {
  it('리허설 발송함 행이 있는 채로 효과 → 작업 함수를 돌려도 작업이 없다, 질의는 rehearsal = false로 묶여 있다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await sale(world, seller, rehearsal.id, 15, 'sim_a', '가짜')
    const scope = await world.database.pglite?.query<{ id: string }>(`select id from scopes where seller_id = $1 and rehearsal = true`, [seller.sellerId])
    const scopeId = scope?.rows[0]?.id ?? ''
    const db = world.database.db
    expect(await autoLabelEffects(db, seller.sellerId, scopeId, 0, 1000)).toEqual([])
    const created = await db.transaction((tx) => createAutoJobs(tx, seller.sellerId, scopeId, 0, 1000, () => JSON.stringify({ kind: 'sms' }), new Date()))
    expect(created).toEqual({ labels: [], jobs: [] })
    const jobs = await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from print_jobs`)
    expect(jobs?.rows[0]?.n).toBe(0)
    // 소스 검사: 효과 조회는 리허설 인자 없이 발송함·범위 모두 rehearsal = false
    const source = readFileSync(new URL('../src/print-store.ts', import.meta.url), 'utf8')
    const fn = source.slice(source.indexOf('export async function autoLabelEffects'), source.indexOf('export type NewLabel'))
    expect(fn).toMatch(/autoLabelEffects\(db: Db, sellerId: string, scopeId: string, fromSeq: number, toSeq: number\)/)
    expect(fn).toContain('eq(outbox.rehearsal, false)')
    expect(fn).toContain('eq(scopes.rehearsal, false)')
  })

  it('리허설 범위에는 손으로 출력·다시 출력·포장 라벨을 요청할 수 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const rehearsal = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await sale(world, seller, rehearsal.id, 15, 'sim_a', '가짜')
    const p = printApi(world, seller)
    const message = { error: { code: 'PRINT_REHEARSAL', message: '리허설 방송은 라벨을 출력하지 않아요.' } }
    expect((await p.print(rehearsal.id, 'c1')).body).toEqual(message)
    expect((await p.reprint(rehearsal.id, 'c1')).body).toEqual(message)
    expect((await p.api.post('/api/print/packing', { requestId: rid(), date: DAY, buyer: 'sim_a', rehearsal: true })).body).toEqual(message)
    expect((await p.api.get(`/api/print/labels?date=${DAY}&rehearsal=true`)).body).toEqual(message)
    const count = await world.database.pglite?.query<{ n: number }>(`select (select count(*) from print_jobs) + (select count(*) from print_labels) + (select count(*) from print_requests) as n`)
    expect(Number(count?.rows[0]?.n)).toBe(0)
  })
})

describe('AC-I1-08 엔진 출력 보고', () => {
  it('출력 중에 취소된 뒤 출력함이면 늦은 보고 → 엔진 VOID_LABEL·버릴 라벨', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, b.id, 15, 'UC_A', '홍길동')
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const held = await p.claim(DEVICE_A)
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UC_A', reason: '구매자 요청' }))
    let overview = await p.overview()
    expect(overview.jobs[0]).toMatchObject({ status: 'PRINTING', voided: true })
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
    overview = await p.overview()
    expect(overview.discard.map((job) => job.id)).toEqual([held.job?.id])
    expect((await labelReports(world)).map((report) => report.effectId)).toEqual([held.job?.id])
    const effects = ((await client(world, seller.cookie).get(`/api/days/${DAY}`)).body as { effects: { kind: string; status: string }[] }).effects
    expect(effects.filter((effect) => effect.kind === 'VOID_LABEL')).toHaveLength(1)
  })

  it('출력 중에 취소된 뒤 실패면 대기로 돌아가지 않고 출력 안 함 + 폐기, 보고 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, b.id, 15, 'UC_A', '홍길동')
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const held = await p.claim(DEVICE_A)
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UC_A', reason: '구매자 요청' }))
    expect(await p.fail(DEVICE_A, held.job?.attempt ?? '', 'PRINT_FAILED')).toBe(true)
    const overview = await p.overview()
    expect(overview.jobs).toEqual([])
    expect(overview.queue.pause?.reason).toBe('PRINTER_ERROR')
    expect(await labelReports(world)).toEqual([])
    const labels = await p.labels()
    expect(labels.labels[0]).toMatchObject({ voided: true, word: '폐기' })
  })

  it('출력함 기록과 엔진 보고는 함께 남거나 함께 남지 않는다 (커밋 직전 실패 → 둘 다 없음, 다시 보내면 둘 다)', async () => {
    let fail = false
    const world = await newWorld({
      hooks: {
        beforeCommit: (records) => {
          if (fail && records.some((record) => record.type === 'effect.labelPrinted')) throw new Error('주입한 실패')
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, b.id, 15, 'UC_A', '홍길동')
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const held = await p.claim(DEVICE_A)
    fail = true
    const failed = await p.api.post('/api/print/result', { deviceId: DEVICE_A, attempt: held.job?.attempt, ok: true })
    expect(failed.status).toBe(500)
    expect(await labelReports(world)).toEqual([])
    expect((await p.overview()).jobs[0]?.status).toBe('PRINTING')
    fail = false
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
    expect((await labelReports(world)).length).toBe(1)
    expect((await p.overview()).jobs).toEqual([])
  })

  it('효과 기록 중 실패하면 이벤트·작업 모두 없다 (AC-I1-02)', async () => {
    let fail = false
    const world = await newWorld({
      hooks: {
        beforeCommit: () => {
          if (fail) throw new Error('주입한 실패')
        },
      },
    })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    fail = true
    const result = await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'x1', ch: 'UC_A', nick: '홍길동', text: '15' })
    expect(result.status).toBe('save_failed')
    const count = await world.database.pglite?.query<{ e: number; j: number; l: number }>(
      `select (select count(*) from events where type = 'chat')::int as e, (select count(*) from print_jobs)::int as j, (select count(*) from print_labels)::int as l`,
    )
    expect(count?.rows[0]).toEqual({ e: 0, j: 0, l: 0 })
  })
})

describe('AC-I1-01 격리·재시작', () => {
  it('다른 판매자의 작업·시도·기기로는 아무것도 보이지도 바뀌지도 않는다 (없는 작업과 같은 응답)', async () => {
    const world = await newWorld()
    const mine = await addSeller(world)
    const other = await addSeller(world)
    const b = await createBroadcast(world, mine, { date: DAY })
    await sale(world, mine, b.id, 15, 'UC_A', '홍길동')
    const p = printApi(world, mine)
    const q = printApi(world, other)
    await becomeDevice(world, mine)
    const held = await p.claim(DEVICE_A)
    const jobId = held.job?.id ?? ''
    expect((await q.overview()).jobs).toEqual([])
    expect((await q.cancel(DAY, jobId)).status).toBe(404)
    expect((await q.cancel(DAY, 'nothing-here')).body).toEqual((await q.cancel(DAY, jobId)).body)
    expect((await q.discard(DAY, jobId)).status).toBe(404)
    expect((await q.api.post('/api/print/result', { deviceId: DEVICE_A, attempt: held.job?.attempt, ok: true })).status).toBe(404)
    expect((await q.claimRaw(DEVICE_A)).status).toBe(409)
    expect((await q.print(b.id, held.job?.label.claim ?? '')).status).toBe(404)
    expect((await q.api.get(`/api/print/labels?date=${DAY}`)).status).toBe(404)
    expect((await p.overview()).jobs[0]?.status).toBe('PRINTING')
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
  })

  it('출력 기기가 아닌 기기의 받기·연결 알림, 다른 판매자의 조치는 DB를 하나도 바꾸지 않는다 (AC-I1-06)', async () => {
    const world = await newWorld()
    const mine = await addSeller(world)
    const other = await addSeller(world)
    const b = await createBroadcast(world, mine, { date: DAY })
    await sale(world, mine, b.id, 15, 'UC_A', '홍길동')
    await becomeDevice(world, mine)
    const p = printApi(world, mine)
    const q = printApi(world, other)
    const before = await dumpAllTables(world.database)
    expect((await p.claimRaw(DEVICE_B)).body).toEqual({ error: { code: 'PRINT_NOT_DEVICE', message: '이 기기는 출력 기기가 아니에요.' } })
    expect((await p.state(DEVICE_B, false)).status).toBe(409)
    expect((await q.claimRaw(DEVICE_A)).status).toBe(409)
    expect((await q.state(DEVICE_A, true)).status).toBe(409)
    await expectOk(q.release())
    await expectOk(q.restart())
    expect((await q.cancelAll()).body).toMatchObject({ cancelled: 0 })
    await settled(world)
    const after = await dumpAllTables(world.database)
    // 다른 판매자의 모두 빼기는 그 판매자의 대기열 줄만 만들 수 있다 — 내 기록은 그대로
    const strip = (dump: string) =>
      dump
        .split('\n')
        .map((line) => {
          if (!line.startsWith('print_queues:')) return line
          const rows = JSON.parse(line.slice('print_queues:'.length)) as { seller_id: string }[]
          return `print_queues:${JSON.stringify(rows.filter((row) => row.seller_id === mine.sellerId))}`
        })
        .join('\n')
    expect(strip(after)).toEqual(strip(before))
  })

  it('서버를 다시 켜도 작업·시도·멈춤·출력 기기·템플릿이 그대로다', async () => {
    const database = await openTestDb()
    const masterKey = generateMasterKey()
    const first = startServer(database, masterKey)
    const seller = await addSeller(first)
    const b = await createBroadcast(first, seller, { date: DAY })
    await sale(first, seller, b.id, 15, 'UC_A', '홍길동')
    await sale(first, seller, b.id, 16, 'UC_B', '김철수')
    const p1 = printApi(first, seller)
    await becomeDevice(first, seller)
    const one = await p1.claim(DEVICE_A)
    expect(await p1.fail(DEVICE_A, one.job?.attempt ?? '', 'DISCONNECTED')).toBe(true)
    const template = { ...defaultTemplate('product'), shopName: '다육이네' }
    await expectOk(p1.put('/api/print/templates/product', { template, version: 0 }))
    const before = await p1.overview()
    first.server.close()
    const second = startServer(database, masterKey, { clock: first.clock })
    const p2 = printApi(second, seller)
    const after = await p2.overview()
    expect(after.jobs).toEqual(before.jobs)
    expect(after.queue).toMatchObject({ device: { id: DEVICE_A, name: '휴대폰' }, pause: { reason: 'DISCONNECTED' } })
    expect(((await expectOk(p2.api.get('/api/print/templates'))).body.product as { version: number; template: { shopName: string } })).toMatchObject({ version: 1, template: { shopName: '다육이네' } })
    await expectOk(p2.state(DEVICE_A, true))
    const again = await p2.claim(DEVICE_A)
    expect(again.job?.id).toBe(one.job?.id)
    expect(again.job?.template).toMatchObject({ shopName: '다육이네' })
  })
})

describe('AC-I1-10 출력 기기', () => {
  it('기기 이름은 다듬은 뒤 1~20자, 같은 기기가 다시 알리면 멈춤을 바꾸지 않는다, 그만하기는 출력 중인 장이 끝난 뒤', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, b.id, 15, 'UC_A', '홍길동')
    const p = printApi(world, seller)
    expect((await p.register(DEVICE_A, '   ')).status).toBe(400)
    expect((await p.register(DEVICE_A, 'x'.repeat(21))).status).toBe(400)
    expect((await p.register('short', 'PC')).status).toBe(400)
    const made = await expectOk(p.register(DEVICE_A, '  판매\u0000 PC  '))
    expect(made.body).toMatchObject({ backlog: true, waiting: 1, queue: { device: { name: '판매 PC' }, pause: { reason: 'SELLER', backlog: true } } })
    // 새로고침: 멈춤 그대로
    expect((await expectOk(p.register(DEVICE_A, '판매 PC'))).body).toMatchObject({ backlog: false, queue: { pause: { reason: 'SELLER', backlog: true } } })
    await expectOk(p.restart())
    const held = await p.claim(DEVICE_A)
    const releasing = await expectOk(p.release())
    expect(releasing.body).toMatchObject({ queue: { device: { id: DEVICE_A, releasing: true } } })
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
    expect((await p.overview()).queue.device).toBeNull()
    // 비운 뒤엔 다른 기기가 바로 된다 (대기 0이라 멈춤 없음)
    expect((await expectOk(p.register(DEVICE_B, '휴대폰'))).body).toMatchObject({ backlog: false, queue: { pause: null } })
  })

  it('출력 그만하기 뒤 같은 기기가 다시 "이 기기에서 출력"을 누르면 그만하기를 거두고, 그 장이 끝나도 출력 기기로 남는다 (TD-I1-002)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const p = printApi(world, seller)
    await becomeDevice(world, seller, DEVICE_A, '휴대폰')
    await sale(world, seller, b.id, 1, 'UC_1', 'n1')
    await sale(world, seller, b.id, 2, 'UC_2', 'n2')
    const held = await p.claim(DEVICE_A)
    expect((await expectOk(p.release())).body).toMatchObject({ queue: { device: { releasing: true } } })
    const again = await expectOk(p.register(DEVICE_A, '휴대폰'))
    expect(again.body).toMatchObject({ backlog: false, queue: { device: { id: DEVICE_A, releasing: false }, pause: null } })
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(true)
    expect((await p.overview()).queue.device).toMatchObject({ id: DEVICE_A, releasing: false })
    const next = await p.claim(DEVICE_A)
    expect(next.job?.data.no).toBe(2)
  })

  it('실시간 연결 여부: 출력 기기의 연결이 열리고 닫히면 다른 기기에 알린다 (AC-I1-15)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const p = printApi(world, seller)
    await expectOk(p.register(DEVICE_A, '휴대폰'))
    const watcher = await stream(world, seller)
    expect((await p.overview()).queue.device?.live).toBe(false)
    const device = await stream(world, seller, DEVICE_A)
    await watcher.until(() => prints(watcher).some((notice) => (notice.queue as { device: { live: boolean } }).device.live))
    expect((await p.overview()).queue.device?.live).toBe(true)
    await device.cancel()
    await watcher.until(() => {
      const last = prints(watcher).at(-1)
      return last !== undefined && (last.queue as { device: { live: boolean } }).device.live === false
    })
    expect((await world.server.app.request('/api/stream?device=x', { headers: { Cookie: seller.cookie } })).status).toBe(400)
  })
})

describe('AC-I1-15 실시간 알림', () => {
  it('작업이 생기면 그 판매자의 모든 연결에 print 알림(바뀐 작업·라벨 키·요약)이 가고, 다른 판매자에게는 아무것도 가지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const mine = await stream(world, seller)
    const theirs = await stream(world, other)
    const b = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, b.id, 15, 'UC_A', '홍길동')
    await mine.until(() => prints(mine).some((notice) => (notice.jobs as unknown[]).length > 0))
    const notice = prints(mine).find((item) => (item.jobs as unknown[]).length > 0) as { rev: number; queue: { waiting: number }; jobs: { status: string }[]; labels: { word: string }[] }
    expect(notice.queue.waiting).toBe(1)
    expect(notice.jobs[0]?.status).toBe('WAITING')
    expect(notice.labels[0]?.word).toBe('라벨 대기')
    expect(notice.rev).toBeGreaterThan(0)
    await settled(world)
    expect(prints(theirs)).toEqual([])
  })
})

describe('AC-I1-11 빼기·모두 빼기', () => {
  it('출력 중인 라벨은 뺄 수 없고, 모두 빼기는 확인 표시가 있어야 한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (const no of [1, 2, 3]) await sale(world, seller, b.id, no, `UC_${String(no)}`, `n${String(no)}`)
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const held = await p.claim(DEVICE_A)
    const refused = await p.cancel(DAY, held.job?.id ?? '')
    expect(refused.body).toEqual({ error: { code: 'PRINT_JOB_PRINTING', message: '출력 중인 라벨은 뺄 수 없어요.' } })
    expect((await p.api.post('/api/print/jobs/cancel-all', {})).status).toBe(400)
    const all = await expectOk(p.cancelAll())
    expect(all.body).toMatchObject({ cancelled: 2, queue: { waiting: 0, printing: 1 } })
    const labels = await p.labels()
    expect(labels.labels.map((label) => label.word)).toEqual(['출력 중', '출력 안 함', '출력 안 함'])
  })

  it('라벨 오류 결과는 라벨 오류 멈춤(다시 시작으로만), DOES_NOT_FIT은 항목과 함께', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, b.id, 1, 'UC_1', 'n1')
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const held = await p.claim(DEVICE_A)
    expect(await p.fail(DEVICE_A, held.job?.attempt ?? '', 'DOES_NOT_FIT', 'price')).toBe(true)
    const overview = await p.overview()
    expect(overview.queue.pause).toEqual({ reason: 'LABEL_ERROR', message: '라벨을 만들지 못해 멈췄어요. 라벨 설정을 확인한 뒤 다시 시작해 주세요.', backlog: false })
    expect(overview.jobs[0]?.lastError).toEqual({ code: 'DOES_NOT_FIT', item: 'price' })
    // 끊겼다 이어져도 손으로 푸는 멈춤은 풀리지 않는다
    await expectOk(p.state(DEVICE_A, false))
    await expectOk(p.state(DEVICE_A, true))
    expect((await p.overview()).queue.pause?.reason).toBe('LABEL_ERROR')
    await expectOk(p.restart())
    expect((await p.overview()).queue.pause).toBeNull()
    expect((await p.api.post('/api/print/result', { deviceId: DEVICE_A, attempt: held.job?.attempt, ok: false, error: { code: 'WHATEVER' } })).status).toBe(400)
  })

  it('1등인데 받을 때 라벨 데이터를 만들 수 없으면(번호 10000 — L-3 밖) 폐기하지 않고 대기 맨 앞·시도 +1·라벨 오류 멈춤 (L-11 5, TD-I1-001)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    // 채팅 파서는 10000을 찜으로 읽지 않는다 — 문자찜으로 1등을 만든다.
    // SRV1부터 API는 번호 한도(claim.maxNumber) 밖 문자찜을 받지 않는다 — 그 전에 기록된 옛 문자찜과 같은 이벤트를 기록 경로로 바로 쓴다(바꾼 기존 시험, SRV1 dev-notes)
    // REL1부터 숫자 no 상품 등록도 번호 한도 밖이면 400(66d819b5) — 상품도 그 전에 기록된 옛 등록과 같은 이벤트를 기록 경로로 바로 쓴다
    const oldProduct = await world.server.writer.write({
      sellerId: seller.sellerId,
      date: DAY,
      rehearsal: false,
      createScope: false,
      requestId: 'old-register-10000',
      build: () => [{ fields: { type: 'product.register', b: b.id, no: 10000, name: '큰번호', price: 8000 }, actor: { kind: 'account', accountId: seller.accountId } }],
    })
    expect(oldProduct.kind).toBe('ok')
    const old = await world.server.writer.write({
      sellerId: seller.sellerId,
      date: DAY,
      rehearsal: false,
      createScope: false,
      requestId: 'old-sms-10000',
      build: () => [{ fields: { type: 'sms', b: b.id, no: 10000, ref: 'oldsmsref', received: '20:00' }, actor: { kind: 'account', accountId: seller.accountId } }],
    })
    expect(old.kind).toBe('ok')
    await sale(world, seller, b.id, 2, 'UC_B', '김철수')
    expect(await p.claim(DEVICE_A)).toEqual({ job: null, reason: 'PAUSED' })
    let overview = await p.overview()
    expect(overview.queue.pause).toEqual({ reason: 'LABEL_ERROR', message: '라벨을 만들지 못해 멈췄어요. 라벨 설정을 확인한 뒤 다시 시작해 주세요.', backlog: false })
    expect(overview.jobs.map((job) => [job.label.no, job.status, job.voided, job.attempts, job.lastError?.code ?? null])).toEqual([
      [10000, 'WAITING', false, 1, 'INVALID_DATA'],
      [2, 'WAITING', false, 0, null],
    ])
    let labels = await p.labels()
    expect(labels.labels.find((label) => label.no === 10000)).toMatchObject({ state: 'WAITING', voided: false, winner: true })
    // 다시 시작해도 저절로 버리지 않는다 — 같은 장에서 다시 멈춘다
    await expectOk(p.restart())
    expect((await p.claim(DEVICE_A)).reason).toBe('PAUSED')
    expect((await p.overview()).jobs[0]).toMatchObject({ attempts: 2, voided: false, status: 'WAITING' })
    // 판매자가 그 장을 빼면 다음 장이 나온다
    await expectOk(p.cancel(DAY, overview.jobs[0]?.id ?? ''))
    await expectOk(p.restart())
    const next = await p.claim(DEVICE_A)
    expect(next.job?.data.no).toBe(2)
    overview = await p.overview()
    expect(overview.queue.discard).toBe(0)
    labels = await p.labels()
    expect(labels.labels.find((label) => label.no === 10000)).toMatchObject({ state: 'NOT_PRINTED', voided: false })
  })
})

describe('AC-I1-13 포장 라벨', () => {
  it('쪽마다 작업 하나, 데이터는 요청 때(지금의 구매자·방송 순서·코어 상품 합계), 1등 상품이 없으면 거절, 바뀌면 재출력 필요', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b1 = await createBroadcast(world, seller, { date: DAY })
    for (let no = 1; no <= 12; no++) await sale(world, seller, b1.id, no, 'UC_A', '홍길동', `품종${String(no)}`, 1000)
    const b2 = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, b2.id, 5, 'UC_A', '홍길동', '라울', 5000)
    const p = printApi(world, seller)
    await expectOk(p.cancelAll())
    const none = await p.packing(DAY, 'UC_NOBODY')
    expect(none.status).toBe(404)
    await register(world, seller, b2.id, 9)
    await chat(world, seller, b2.id, 'UC_Z', '구경꾼', '안녕하세요')
    const empty = await p.packing(DAY, 'UC_Z')
    expect(empty.body).toEqual({ error: { code: 'PRINT_NO_ITEMS', message: '이 묶음에는 1등 상품이 없어 포장 라벨을 만들 수 없어요.' } })
    const made = await expectOk(p.packing(DAY, 'UC_A'))
    const jobs = made.body.jobs as { page: number; pages: number; data: { broadcasts: { title: string; numbers: number[] }[]; subtotal: number; buyer: unknown } }[]
    // 1부 12개 → 10개씩 2쪽, 2부 1개 → 1쪽 = 3쪽
    expect(jobs.map((job) => [job.page, job.pages])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
    expect(jobs[0]?.data).toEqual({
      date: DAY,
      buyer: { kind: 'youtube', name: '홍길동' },
      broadcasts: [
        { title: '1부', numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
        { title: '2부', numbers: [5] },
      ],
      subtotal: 17000,
    })
    const busy = await p.packing(DAY, 'UC_A')
    expect(busy.body).toMatchObject({ error: { code: 'PRINT_IN_PROGRESS' } })
    await becomeDevice(world, seller)
    for (let page = 1; page <= 3; page++) {
      const claimed = await p.claim(DEVICE_A)
      expect(claimed.job).toMatchObject({ kind: 'packing', reason: 'packing', page, pages: 3, template: { kind: 'packing', perPage: 10 } })
      expect(await p.done(DEVICE_A, claimed.job?.attempt ?? '')).toBe(true)
    }
    // 포장 라벨은 엔진에 보고하지 않는다
    expect(await labelReports(world)).toEqual([])
    let view = (await expectOk(p.api.get(`/api/print/packing?date=${DAY}&buyer=UC_A`))).body as { label: { state: string; reprintNeeded: boolean; printed: number } }
    expect(view.label).toMatchObject({ state: 'PRINTED', reprintNeeded: false, printed: 3 })
    await sale(world, seller, b2.id, 6, 'UC_A', '홍길동', '새것', 2000)
    view = (await expectOk(p.api.get(`/api/print/packing?date=${DAY}&buyer=UC_A`))).body as { label: { state: string; reprintNeeded: boolean; printed: number } }
    expect(view.label).toMatchObject({ state: 'REPRINT_NEEDED', reprintNeeded: true })
    const contentKey = labelContentKey('packing', (view as unknown as { data: unknown }).data)
    expect(contentKey.ok).toBe(true)
  })
})

describe('AC-I1-14 템플릿 저장', () => {
  it('기본 템플릿·검사·16KB·가게 이름 40자·판 충돌·저장 뒤 받을 때 새 템플릿', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const p = printApi(world, seller)
    const read = (await expectOk(p.api.get('/api/print/templates'))).body as { product: { template: ProductTemplate; version: number }; packing: { version: number } }
    // FB1 D-FB1-07: 비어 있는 가게 이름은 설정 "가게"의 가게 이름으로 채워 내주고, 저장된 본문의 이름은 storedShopName
    expect(read.product).toEqual({ template: { ...defaultTemplate('product'), shopName: `가게 ${seller.loginId}` }, version: 0, storedShopName: '' })
    expect(read.packing.version).toBe(0)
    const base = defaultTemplate('product')
    const bad = await p.put('/api/print/templates/product', { template: { ...base, items: { ...base.items, number: { ...base.items.number, visible: false } } }, version: 0 })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({ error: { code: 'INVALID_TEMPLATE', message: '라벨 설정에 고칠 곳이 있어요.', problems: [{ field: 'template.items.number.visible', message: '번호는 끌 수 없어요.' }] } })
    const long = await p.put('/api/print/templates/product', { template: { ...base, shopName: '가'.repeat(41) }, version: 0 })
    expect(long.body).toMatchObject({ error: { code: 'INVALID_TEMPLATE', problems: [{ field: 'template.shopName', message: '가게 이름은 40자 이하로 적어 주세요.' }] } })
    const huge = await p.put('/api/print/templates/product', { template: { ...base, shopName: '가'.repeat(6000) }, version: 0 })
    expect(huge.body).toMatchObject({ error: { code: 'TEMPLATE_TOO_LARGE' } })
    // 가게 이름에는 휴대폰 번호 검사를 하지 않는다 (D-I1-05)
    const saved = await expectOk(p.put('/api/print/templates/product', { template: { ...base, shopName: '다육이네 010-1234-5678' }, version: 0 }))
    expect(saved.body).toMatchObject({ version: 1, message: '라벨 설정을 저장했어요.' })
    const stale = await p.put('/api/print/templates/product', { template: base, version: 0 })
    expect(stale.body).toEqual({ error: { code: 'TEMPLATE_CONFLICT', message: '다른 기기에서 라벨 설정이 바뀌었어요. 새로 불러온 뒤 다시 바꿔 주세요.' } })
    const wrongKind = await p.put('/api/print/templates/packing', { template: base, version: 0 })
    expect(wrongKind.status).toBe(400)
    const unknownKey = await p.put('/api/print/templates/product', { template: { ...base, extra: 1 }, version: 1 })
    expect(unknownKey.body).toMatchObject({ error: { problems: [{ field: 'template.extra' }] } })
    const unsafeKey = await p.put('/api/print/templates/product', { template: { ...base, '01012345678': 1 }, version: 1 })
    expect(unsafeKey.text).not.toContain('01012345678')
    const phoneKey = await p.put('/api/print/templates/product', { template: { ...base, a01012345678: 1 }, version: 1 })
    expect(phoneKey.text).not.toContain('01012345678')
    expect(phoneKey.body).toMatchObject({ error: { problems: [{ field: 'template' }] } })
  })
})

describe('AC-I1-16 시험 모드 신호', () => {
  it('운영 설정 조립은 어떤 환경변수로도 시험 모드를 켜지 않는다 — E2E 기동만 켠다', async () => {
    const database = await openTestDb()
    const env = {
      LIVEJJIM_MASTER_KEY: generateMasterKey(),
      LIVEJJIM_APP_ORIGIN: 'https://app.livejjim.test',
      LIVEJJIM_TEST_PRINTER: '1',
      TEST_PRINTER: 'yes',
      E2E: '1',
      NODE_ENV: 'test',
    }
    const assembled = productionServerOptions(env, database)
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) return
    expect(assembled.options.testPrinter).toBe(false)
    const server = createServer({ ...assembled.options, log: () => {} })
    const world = { server, database, masterKey: env.LIVEJJIM_MASTER_KEY, clock: { now: Date.now, set: () => {}, advance: () => {} }, logs: [] } as unknown as TestServer
    const seller = await addSeller(world)
    expect((await client(world, seller.cookie).get('/api/client-config')).body).toEqual({ hostActionDelayMs: 5000, testPrinter: false, billing: { enabled: false, testPayment: false } })
    server.close()
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    expect(source).toContain('productionServerOptions(process.env, database)')
    expect(source).not.toMatch(/testPrinter/)
    expect(productionServerOptions({ LIVEJJIM_APP_ORIGIN: 'https://a.test' }, database).ok).toBe(false)
  })
})

describe('AC-I1-17 로그·개인정보', () => {
  it('서버 로그에 라벨 데이터·닉네임·품종·기기 이름·가게 이름이 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await sale(world, seller, b.id, 15, 'UC_A', '비밀닉네임', '비밀품종')
    const p = printApi(world, seller)
    await expectOk(p.register(DEVICE_A, '비밀기기'))
    await expectOk(p.put('/api/print/templates/product', { template: { ...defaultTemplate('product'), shopName: '비밀가게' }, version: 0 }))
    await expectOk(p.restart())
    const held = await p.claim(DEVICE_A)
    await p.fail(DEVICE_A, held.job?.attempt ?? '', 'TIMEOUT')
    await settled(world)
    expect(JSON.stringify(world.logs)).not.toMatch(/비밀/)
  })
})
