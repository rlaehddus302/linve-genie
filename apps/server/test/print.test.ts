// I1 서버 출력 기록 — 자동 작업·출력 기기·받기·결과·엔진 보고 (AC-I1-01·02·06·07·08·09·10, LABEL_RULES L-11 2·4·6·7·8·10).
import { applyEvent, initEngine, listEffects, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { RECLAIM_AFTER_MS } from '../src/print.ts'
import { mergeRaw } from '../src/store.ts'
import { DAY, DEVICE_A, DEVICE_B, becomeDevice, chat, labelReports, printApi, register } from './print-support.ts'
import { addSeller, client, createBroadcast, expectOk, newWorld, rid, writeEvent, type Seller, type TestServer } from './support.ts'

// 채팅은 본문·이름을 chat_raw에 따로 둔다(Y1, AC-Y1-60) — 서버 재생과 같이 합친 본문으로 재생한다
async function replayEffects(world: TestServer, seller: Seller, date = DAY): Promise<ReturnType<typeof listEffects>> {
  const rows = await world.database.pglite?.query<{ body: string; failed: boolean; nick: string | null; text: string | null }>(
    `select e.body, e.failed, r.nick, r.text from events e join scopes s on s.id = e.scope_id
       left join chat_raw r on r.scope_id = e.scope_id and r.seq = e.seq and r.seller_id = e.seller_id
     where e.seller_id = $1 and s.date = $2 and s.rehearsal = false order by e.seq`,
    [seller.sellerId, date],
  )
  let state: EngineState = initEngine({ broadcasts: [], settings: {} })
  for (const row of rows?.rows ?? []) if (!row.failed) state = applyEvent(state, JSON.parse(mergeRaw(row.body, row.nick, row.text)) as EngineEvent).state
  return listEffects(state)
}

describe('AC-I1-02 자동 작업은 효과와 같은 기록에서', () => {
  it('1등 확정 → 효과마다 작업 하나(작업 ID = 효과 ID, 라벨 키 = 찜@확정버전, 까닭 auto, 대기, 구매자 = 그 순간의 이름)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15, '핑크프릴', 10000)
    await chat(world, seller, b.id, 'UC_A', '홍길동', '15')
    const p = printApi(world, seller)
    const overview = await p.overview()
    const effects = (await replayEffects(world, seller)).filter((effect) => effect.kind === 'PRINT_PRODUCT_LABEL')
    expect(effects).toHaveLength(1)
    expect(overview.jobs).toHaveLength(1)
    const job = overview.jobs[0]
    expect(job?.id).toBe(effects[0]?.id)
    expect(job).toMatchObject({ date: DAY, kind: 'product', reason: 'auto', status: 'WAITING', word: '작업 대기', voided: false, attempts: 0 })
    expect(job?.label).toMatchObject({ key: `${effects[0]?.claim ?? ''}@1`, claim: effects[0]?.claim, version: 1, broadcast: b.id, no: 15, buyer: { kind: 'youtube', name: '홍길동' } })
    // 상품 라벨 데이터에 찜 시각 HH:MM(KST)이 붙는다 (D-LABEL-TIME-01 — 내용 키 밖)
    expect(job?.data).toEqual({ no: 15, name: '핑크프릴', price: 10000, date: DAY, time: '12:00', buyer: { kind: 'youtube', name: '홍길동' } })
    expect(overview.queue).toMatchObject({ device: null, pause: null, waiting: 1, printing: 0, discard: 0 })
  })

  it('출력 기기가 받고 출력함을 알리면 엔진에 effect.labelPrinted가 효과마다 한 번 기록되고 잠긴다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15, '핑크프릴', 10000)
    await chat(world, seller, b.id, 'UC_A', '홍길동', '15')
    const p = printApi(world, seller)
    // 새로 출력 기기가 될 때 대기 작업이 있으면 판매자 멈춤으로 시작한다
    const registered = await expectOk(p.register(DEVICE_A, '휴대폰'))
    expect(registered.body).toMatchObject({ waiting: 1, backlog: true })
    expect((await p.claim(DEVICE_A)).reason).toBe('PAUSED')
    await expectOk(p.restart())
    const claimed = await p.claim(DEVICE_A)
    // 상품 라벨 데이터에 찜 시각 HH:MM(KST)이 붙는다 (D-LABEL-TIME-01 — 내용 키 밖)
    expect(claimed.job?.data).toEqual({ no: 15, name: '핑크프릴', price: 10000, date: DAY, time: '12:00', buyer: { kind: 'youtube', name: '홍길동' } })
    expect(claimed.job?.template).toMatchObject({ kind: 'product', size: '50x30' })
    // 출력 중 작업이 있으면 다음을 주지 않는다
    expect((await p.claim(DEVICE_A)).reason).toBe('BUSY')
    expect(await p.done(DEVICE_A, claimed.job?.attempt ?? '')).toBe(true)
    // 같은 결과를 다시 보내도 한 번만
    expect(await p.done(DEVICE_A, claimed.job?.attempt ?? '')).toBe(false)
    const reports = await labelReports(world)
    expect(reports.map((report) => report.effectId)).toEqual([claimed.job?.id])
    const overview = await p.overview()
    expect(overview.jobs).toEqual([])
    const labels = await p.labels()
    expect(labels.labels[0]).toMatchObject({ state: 'PRINTED', word: '라벨 출력됨', printed: 1, reprintNeeded: false, history: [{ device: '휴대폰' }] })
    // 잠금: AUTO여도 시청자 취소는 취소 요청이 된다 (G-ENG-301)
    const view = (await client(world, seller.cookie).get(`/api/days/${DAY}`)).body as { claims: { locked: boolean }[] }
    expect(view.claims[0]?.locked).toBe(true)
  })

  it('리허설 방송의 확정은 작업을 만들지 않는다 (AC-I1-03)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY, rehearsal: true })
    await register(world, seller, b.id, 15)
    await chat(world, seller, b.id, 'UC_A', '홍길동', '15')
    const p = printApi(world, seller)
    expect((await p.overview()).jobs).toEqual([])
    const outbox = await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from outbox where rehearsal = true and kind = 'PRINT_PRODUCT_LABEL'`)
    expect(outbox?.rows[0]?.n).toBe(1)
    const refused = await p.print(b.id, 'c1')
    expect(refused.status).toBe(422)
    expect(refused.body).toEqual({ error: { code: 'PRINT_REHEARSAL', message: '리허설 방송은 라벨을 출력하지 않아요.' } })
  })
})

describe('AC-I1-05 폐기와 버릴 라벨', () => {
  it('출력한 1등을 취소하면 버릴 라벨, 승계자 새 라벨 / 버렸어요는 한 번', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15, '핑크프릴', 10000)
    await chat(world, seller, b.id, 'UC_A', '홍길동', '15')
    await chat(world, seller, b.id, 'UC_B', '김철수', '15')
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    const first = await p.claim(DEVICE_A)
    expect(await p.done(DEVICE_A, first.job?.attempt ?? '')).toBe(true)
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UC_A', reason: '구매자 요청' }))
    const overview = await p.overview()
    expect(overview.queue.discard).toBe(1)
    expect(overview.discard[0]).toMatchObject({ id: first.job?.id, word: '폐기 — 버려 주세요', discard: true })
    expect(overview.jobs).toHaveLength(1)
    expect(overview.jobs[0]?.label.buyer).toEqual({ kind: 'youtube', name: '김철수' })
    const discarded = await expectOk(p.discard(DAY, first.job?.id ?? ''))
    expect(discarded.body).toMatchObject({ job: { discard: false, word: '폐기' } })
    await expectOk(p.discard(DAY, first.job?.id ?? ''))
    expect((await p.overview()).queue.discard).toBe(0)
  })
})

describe('AC-I1-07·09·10 결과·멈춤·출력 기기', () => {
  it('끊김 → 끊김 멈춤·대기 맨 앞(시도 1) → 다시 연결 → 이어서', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (const no of [1, 2, 3]) await register(world, seller, b.id, no)
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    for (const no of [1, 2, 3]) await chat(world, seller, b.id, `UC_${String(no)}`, `n${String(no)}`, String(no))
    const one = await p.claim(DEVICE_A)
    expect(one.job?.data.no).toBe(1)
    expect(await p.done(DEVICE_A, one.job?.attempt ?? '')).toBe(true)
    const two = await p.claim(DEVICE_A)
    expect(await p.fail(DEVICE_A, two.job?.attempt ?? '', 'DISCONNECTED')).toBe(true)
    let overview = await p.overview()
    expect(overview.queue.pause).toEqual({ reason: 'DISCONNECTED', message: '프린터 연결이 끊겼어요.', backlog: false })
    expect(overview.jobs[0]).toMatchObject({ id: two.job?.id, status: 'WAITING', attempts: 1, lastError: { code: 'DISCONNECTED', item: null } })
    // 끊김 멈춤은 다시 시작으로 풀리지 않는다
    const restart = await p.restart()
    expect(restart.status).toBe(409)
    expect((await p.claim(DEVICE_A)).reason).toBe('PAUSED')
    await expectOk(p.state(DEVICE_A, true))
    const again = await p.claim(DEVICE_A)
    expect(again.job?.id).toBe(two.job?.id)
    expect(await p.done(DEVICE_A, again.job?.attempt ?? '')).toBe(true)
    // 늦은 결과(이미 결과가 정해진 시도)는 버린다
    expect(await p.done(DEVICE_A, two.job?.attempt ?? '')).toBe(false)
    const three = await p.claim(DEVICE_A)
    expect(three.job?.data.no).toBe(3)
    expect(await p.done(DEVICE_A, three.job?.attempt ?? '')).toBe(true)
    overview = await p.overview()
    expect(overview.queue).toMatchObject({ waiting: 0, printing: 0, pause: null })
    expect((await labelReports(world)).length).toBe(3)
  })

  it('다른 기기는 바꾸기 없이 거절, 바꾸면 이전 기기의 출력 중 작업은 대기 맨 앞(DISCONNECTED)·이전 기기 결과는 버림', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 1)
    const p = printApi(world, seller)
    await becomeDevice(world, seller, DEVICE_A, 'PC')
    await chat(world, seller, b.id, 'UC_1', 'n1', '1')
    const held = await p.claim(DEVICE_A)
    const taken = await p.register(DEVICE_B, '휴대폰')
    expect(taken.status).toBe(409)
    expect(taken.body).toMatchObject({ device: { name: 'PC' }, error: { code: 'PRINT_DEVICE_TAKEN' } })
    expect((await p.claimRaw(DEVICE_B)).status).toBe(409)
    await expectOk(p.register(DEVICE_B, '휴대폰', true))
    expect(await p.done(DEVICE_A, held.job?.attempt ?? '')).toBe(false)
    expect((await p.claimRaw(DEVICE_A)).status).toBe(409)
    const overview = await p.overview()
    expect(overview.queue.device).toMatchObject({ id: DEVICE_B, name: '휴대폰' })
    expect(overview.queue.pause).toBeNull()
    expect(overview.jobs[0]).toMatchObject({ status: 'WAITING', attempts: 1, lastError: { code: 'DISCONNECTED' } })
    const next = await p.claim(DEVICE_B)
    expect(next.job?.id).toBe(held.job?.id)
    expect(await p.done(DEVICE_B, next.job?.attempt ?? '')).toBe(true)
    const labels = await p.labels()
    expect(labels.labels[0]).toMatchObject({ printed: 1, history: [{ device: '휴대폰' }] })
  })

  it('받기 응답을 잃은 같은 기기가 다시 받으면 같은 장을 새 표로 준다 — 다음 작업은 주지 않고, 데이터는 다시 받는 때의 것, 앞 표의 결과는 버림 (AC-I1-06·07, TE-I1-002)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    for (const no of [1, 2]) await register(world, seller, b.id, no, '구피', 10000)
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    for (const no of [1, 2]) await chat(world, seller, b.id, `UC_${String(no)}`, `n${String(no)}`, String(no))
    // 이 응답이 기기에 닿지 않았다고 본다 (서버는 출력 중으로 기록)
    const lost = await p.claim(DEVICE_A)
    expect(lost.job?.data.no).toBe(1)
    // 겹쳐 온 같은 기기의 받기(시도를 준 지 2초 안)는 BUSY — 같은 장을 두 번 주지 않는다
    world.clock.advance(RECLAIM_AFTER_MS - 1)
    expect(await p.claim(DEVICE_A)).toEqual({ job: null, reason: 'BUSY' })
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, no: 1, name: '새품종' }))
    // 화면은 받기 응답을 잃으면 3초 뒤 다시 받는다
    world.clock.advance(3000)
    const again = await p.claim(DEVICE_A)
    expect(again.job?.id).toBe(lost.job?.id)
    expect(again.job?.attempt).not.toBe(lost.job?.attempt)
    expect(again.job?.data).toMatchObject({ no: 1, name: '새품종' })
    const overview = await p.overview()
    // 출력 중은 여전히 하나, 다음 작업(2번)은 대기 그대로
    expect(overview.queue).toMatchObject({ printing: 1, waiting: 1, pause: null, device: { id: DEVICE_A, printerConnected: true } })
    expect(overview.jobs.map((job) => [job.id, job.status])).toEqual([
      [lost.job?.id, 'PRINTING'],
      [expect.any(String), 'WAITING'],
    ])
    expect(overview.jobs[0]).toMatchObject({ attempts: 1, lastError: { code: 'DISCONNECTED', item: null } })
    // 다른 기기는 여전히 받지 못한다
    expect((await p.claimRaw(DEVICE_B)).status).toBe(409)
    // 앞 표의 결과는 버리고, 새 표의 결과만 한 번 기록한다 (엔진 보고도 하나)
    expect(await p.done(DEVICE_A, lost.job?.attempt ?? '')).toBe(false)
    expect(await p.done(DEVICE_A, again.job?.attempt ?? '')).toBe(true)
    expect(await p.done(DEVICE_A, again.job?.attempt ?? '')).toBe(false)
    expect((await labelReports(world)).map((report) => report.effectId)).toEqual([lost.job?.id])
    const next = await p.claim(DEVICE_A)
    expect(next.job?.data.no).toBe(2)
    expect(await p.done(DEVICE_A, next.job?.attempt ?? '')).toBe(true)
    const labels = await p.labels()
    expect(labels.labels.map((label) => [label.no, label.printed, label.state])).toEqual([
      [1, 1, 'PRINTED'],
      [2, 1, 'PRINTED'],
    ])
  })

  it('받기 응답을 잃은 사이 그 1등이 취소됐으면 다시 받을 때 그 장은 출력 안 함 + 폐기, 승계자 라벨을 준다 (L-11 4·5)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15, '핑크프릴', 10000)
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await chat(world, seller, b.id, 'UC_A', '홍길동', '15')
    await chat(world, seller, b.id, 'UC_B', '김철수', '15')
    const lost = await p.claim(DEVICE_A)
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UC_A', reason: '구매자 요청' }))
    world.clock.advance(RECLAIM_AFTER_MS)
    const again = await p.claim(DEVICE_A)
    expect(again.job?.id).not.toBe(lost.job?.id)
    expect(again.job?.data).toMatchObject({ no: 15, buyer: { kind: 'youtube', name: '김철수' } })
    expect(await p.done(DEVICE_A, lost.job?.attempt ?? '')).toBe(false)
    expect(await p.done(DEVICE_A, again.job?.attempt ?? '')).toBe(true)
    const overview = await p.overview()
    expect(overview.queue).toMatchObject({ printing: 0, waiting: 0, discard: 0 })
    const labels = await p.labels()
    expect(labels.labels.map((label) => [label.key, label.state, label.printed])).toEqual([
      [lost.job?.label.key, 'VOIDED', 0],
      [again.job?.label.key, 'PRINTED', 1],
    ])
    expect((await labelReports(world)).map((report) => report.effectId)).toEqual([again.job?.id])
  })

  it('출력 그만하기를 기다리는 중 받기 응답을 잃은 기기가 다시 받으면 그 장은 대기 맨 앞, 출력 기기는 빈다 (L-11 10)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 1)
    const p = printApi(world, seller)
    await becomeDevice(world, seller)
    await chat(world, seller, b.id, 'UC_1', 'n1', '1')
    const lost = await p.claim(DEVICE_A)
    expect((await expectOk(p.release())).body).toMatchObject({ queue: { device: { id: DEVICE_A, releasing: true } } })
    world.clock.advance(RECLAIM_AFTER_MS)
    const refused = await p.claimRaw(DEVICE_A)
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ error: { code: 'PRINT_NOT_DEVICE' } })
    const overview = await p.overview()
    expect(overview.queue).toMatchObject({ device: null, printing: 0, waiting: 1, pause: null })
    expect(overview.jobs[0]).toMatchObject({ id: lost.job?.id, status: 'WAITING', attempts: 1, lastError: { code: 'DISCONNECTED' } })
    expect(await p.done(DEVICE_A, lost.job?.attempt ?? '')).toBe(false)
    // 다음 출력 기기가 이어서 찍는다 (새로 정함 — 쌓인 라벨은 출력 시작으로)
    await becomeDevice(world, seller, DEVICE_B, 'PC')
    const next = await p.claim(DEVICE_B)
    expect(next.job?.id).toBe(lost.job?.id)
  })

  it('손으로 출력·다시 출력·빼기', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await expectOk(client(world, seller.cookie).patch('/api/settings', { settings: { 'print.autoOnConfirm': false } }))
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15, '핑크프릴', 10000)
    await chat(world, seller, b.id, 'UC_A', '홍길동', '15')
    const p = printApi(world, seller)
    expect((await p.overview()).jobs).toEqual([])
    const labels = await p.labels()
    expect(labels.labels[0]).toMatchObject({ state: 'NONE', word: '', canPrint: true, canReprint: false })
    const claim = labels.labels[0]?.claim as string
    const notYet = await p.reprint(b.id, claim)
    expect(notYet.body).toMatchObject({ error: { code: 'PRINT_NOT_PRINTED', message: '아직 출력한 적이 없는 라벨이에요.' } })
    const requestId = rid('pl')
    const made = await expectOk(p.print(b.id, claim, requestId))
    const same = await expectOk(p.print(b.id, claim, requestId))
    expect(same.body).toEqual(made.body)
    expect((await p.overview()).jobs).toHaveLength(1)
    const exists = await p.print(b.id, claim)
    expect(exists.body).toMatchObject({ error: { code: 'PRINT_LABEL_EXISTS' } })
    const busy = await p.reprint(b.id, claim)
    expect(busy.body).toMatchObject({ error: { code: 'PRINT_IN_PROGRESS', message: '이 라벨은 이미 출력을 기다리고 있어요.' } })
    const job = (made.body.jobs as { id: string }[])[0]
    await expectOk(p.cancel(DAY, job?.id ?? ''))
    expect((await p.labels()).labels[0]).toMatchObject({ state: 'NOT_PRINTED', word: '출력 안 함', canReprint: true })
    await expectOk(p.reprint(b.id, claim))
    await becomeDevice(world, seller)
    const claimed = await p.claim(DEVICE_A)
    expect(claimed.job?.reason).toBe('reprint')
    expect(await p.done(DEVICE_A, claimed.job?.attempt ?? '')).toBe(true)
    // 효과가 없는 라벨(손으로 출력)은 엔진에 보고하지 않는다
    expect(await labelReports(world)).toEqual([])
    // 품종을 고치면 재출력 필요
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, no: 15, name: '핑크프릴 금' }))
    expect((await p.labels()).labels[0]).toMatchObject({ state: 'REPRINT_NEEDED', word: '재출력 필요', reprintNeeded: true })
    // 취소하면 손으로 찍은 라벨도 버릴 라벨 (엔진 VOID_LABEL 없이)
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UC_A', reason: '구매자 요청' }))
    expect((await p.overview()).queue.discard).toBe(1)
    const voided = await p.reprint(b.id, claim)
    expect(voided.body).toMatchObject({ error: { code: 'PRINT_VOIDED', message: '폐기한 라벨은 다시 출력할 수 없어요.' } })
  })
})
