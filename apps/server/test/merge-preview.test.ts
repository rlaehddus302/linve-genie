// AC-S06b-10 합치기 미리 보기 조회 (BUY-03, SYS-02, DAT-06, D-074, D-100, RA-S06-003).
// GET /api/days/:date/merge-preview?from=&into=[&rehearsal=true] → 200 { date, rehearsal, seq, preview }.
// preview는 응답 seq까지 적용한 그 범위의 상태로 코어 previewMerge를 부른 결과 그대로다(서버는 판정을 다시 하지 않는다).
// 형식 오류·휴대폰 번호 모양 ID는 400, 다른 판매자·없는 범위는 날짜 조회와 같은 404, 로그인 필요, 아무것도 기록하지 않는다.
import { applyEvent, listClaims, previewMerge, type EngineEvent, type EngineState } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { PHONE_NUMBER_MESSAGE } from '../src/messages.ts'
import { addSeller, client, countRows, createBroadcast, dumpAllTables, expectOk, newWorld, writeEvent, type Seller, type TestServer } from './support.ts'

const DAY = '2026-10-18'

const previewPath = (from: string, into: string, extra = '') => `/api/days/${DAY}/merge-preview?from=${encodeURIComponent(from)}&into=${encodeURIComponent(into)}${extra}`

/** 그 범위의 지금 상태 */
const stateOf = async (world: TestServer, seller: Seller, rehearsal = false): Promise<EngineState> => (await world.server.writer.read(seller.sellerId, DAY, rehearsal)).state

/** G-ENG-174 앞부분과 같은 장면: A 15·18·19 1등, B 16 1등, 문자 구매자 X(전화번호) 18·19 1등·16 대기, A 16 대기 2순위, 문자 구매자 Y 17 1등, 찜 없는 C */
async function sale(world: TestServer, seller: Seller, rehearsal = false): Promise<{ b: string; x: string; y: string }> {
  const b = (await createBroadcast(world, seller, { date: DAY, ...(rehearsal ? { rehearsal: true } : {}) })).id
  const products: [number, number, number][] = [
    [15, 10000, 1],
    [16, 5000, 1],
    [17, 8000, 1],
    [18, 6000, 2],
    [19, 7000, 2],
  ]
  for (const [no, price, stock] of products) await expectOk(writeEvent(world, seller, { type: 'product.register', b, no, name: `상품${String(no)}`, price, stock }))
  const chat = async (id: string, ch: string, nick: string, text: string) => {
    expect((await world.server.ingestChat(seller.sellerId, { b, id, ch, nick, text })).status).toBe('recorded')
  }
  await chat('m1', 'UC_A', '홍길동', '15 18 19')
  await chat('m2', 'UC_B', '영희', '16')
  const x = (await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 18, phone: '010-1111-2222', memo: '김씨' }))).body.buyer as string
  await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 19, phone: '01011112222' }))
  await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 16, phone: '010 1111 2222' }))
  await chat('m3', 'UC_A', '홍길동', '16')
  const y = (await expectOk(writeEvent(world, seller, { type: 'sms', b, no: 17 }))).body.buyer as string
  await chat('m4', 'UC_C', '철수', '안녕하세요')
  return { b, x, y }
}

describe('AC-S06b-10 합치기 미리 보기 조회', () => {
  it('200 { date, rehearsal, seq, preview } — preview는 그 범위의 지금 상태로 부른 코어 previewMerge 그대로, seq는 그 범위의 마지막 seq', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b, x, y } = await sale(world, seller)
    const api = client(world, seller.cookie)
    const view = await expectOk(api.get(`/api/days/${DAY}`))
    const response = await expectOk(api.get(previewPath(x, 'UC_A')))
    expect(Object.keys(response.body).sort()).toEqual(['date', 'preview', 'rehearsal', 'seq'])
    expect(response.body.date).toBe(DAY)
    expect(response.body.rehearsal).toBe(false)
    expect(response.body.seq).toBe(view.body.seq)
    const state = await stateOf(world, seller)
    expect(response.body.preview).toEqual(previewMerge(state, x, 'UC_A'))
    // X → A: 18·19번에 두 사람 모두 1등 (G-ENG-174)
    expect(response.body.preview).toMatchObject({
      from: x,
      into: 'UC_A',
      blocked: 'BOTH_CONFIRMED',
      target: 'UC_A',
      bothConfirmed: [`${b}/18`, `${b}/19`],
      moving: { buyers: [x], items: [`${b}/18`, `${b}/19`], subtotal: 13000 },
      after: null,
      duplicates: [],
    })
    // 막히지 않는 쌍: X → B — 16번은 B 1등 > X 대기 → X의 대기 찜이 중복, 합친 뒤 B 5,000 + X 13,000
    const toB = await expectOk(api.get(previewPath(x, 'UC_B')))
    expect(toB.body.preview).toEqual(previewMerge(state, x, 'UC_B'))
    const xWait = listClaims(state).find((claim) => claim.buyer === x && claim.no === 16)
    expect(toB.body.preview).toMatchObject({
      blocked: null,
      after: { items: [`${b}/16`, `${b}/18`, `${b}/19`], subtotal: 18000 },
      duplicates: [{ claim: xWait?.id, product: `${b}/16`, buyer: x, status: 'WAITLISTED' }],
    })
    // 모든 구매자 쌍(모르는 ID·같은 ID 포함)에서 코어 결과 그대로
    const ids = ['UC_A', 'UC_B', 'UC_C', x, y, 'UC_ZZ', '__proto__']
    for (const from of ids) {
      for (const into of ids) {
        const got = await expectOk(api.get(previewPath(from, into)))
        expect(got.body.preview, `${from} → ${into}`).toEqual(previewMerge(state, from, into))
      }
    }
  })

  it('범위에 없는 구매자(__proto__·constructor 같은 문자열 포함)는 200과 blocked UNKNOWN_BUYER', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sale(world, seller)
    const api = client(world, seller.cookie)
    for (const [from, into] of [
      ['UC_NOBODY', 'UC_A'],
      ['UC_A', 'UC_NOBODY'],
      ['__proto__', 'UC_A'],
      ['UC_A', 'constructor'],
      ['sms:rnosuchref', 'UC_A'],
      ['a'.repeat(128), 'UC_A'],
    ] as const) {
      const response = await expectOk(api.get(previewPath(from, into)))
      expect((response.body.preview as { blocked: string }).blocked, `${from} → ${into}`).toBe('UNKNOWN_BUYER')
    }
  })

  it('미리 본 대로 합쳐진다: 막히면 합치기도 아무 일 없음, 막힘을 푼 뒤 미리 보기의 중복 찜이 DUPLICATE가 되고 합친 뒤 구매자 = after', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b, x } = await sale(world, seller)
    const api = client(world, seller.cookie)
    const blocked = await expectOk(api.get(previewPath(x, 'UC_A')))
    expect((blocked.body.preview as { blocked: string }).blocked).toBe('BOTH_CONFIRMED')
    const noop = await expectOk(writeEvent(world, seller, { type: 'buyer.merge', from: x, into: 'UC_A', reason: '같은 사람' }, DAY))
    expect(noop.body.changed).toBe(false)
    // 막힘 풀기 (G-ENG-174): X의 18번, A의 19번 취소
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b, no: 18, buyer: x, reason: '중복' }))
    await expectOk(writeEvent(world, seller, { type: 'host.cancel', b, no: 19, buyer: 'UC_A', reason: '중복' }))
    const open = await expectOk(api.get(previewPath(x, 'UC_A')))
    const preview = open.body.preview as { blocked: null; after: { items: string[]; subtotal: number }; duplicates: { claim: string; buyer: string; status: string }[] }
    expect(preview.blocked).toBeNull()
    expect(preview.after).toEqual({ items: [`${b}/15`, `${b}/18`, `${b}/19`], subtotal: 23000 })
    expect(preview.duplicates.map((item) => [item.buyer, item.status])).toEqual([['UC_A', 'WAITLISTED']])
    const merged = await expectOk(writeEvent(world, seller, { type: 'buyer.merge', from: x, into: 'UC_A', reason: '같은 사람' }, DAY))
    expect(merged.body.changed).toBe(true)
    const view = await expectOk(api.get(`/api/days/${DAY}`))
    const duplicates = (view.body.claims as { id: string; status: string }[]).filter((claim) => claim.status === 'DUPLICATE').map((claim) => claim.id)
    expect(duplicates).toEqual(preview.duplicates.map((item) => item.claim))
    const a = (view.body.buyers as { id: string; items: string[]; subtotal: number }[]).find((buyer) => buyer.id === 'UC_A')
    expect({ items: a?.items, subtotal: a?.subtotal }).toEqual(preview.after)
    // 합친 뒤: X는 이미 A에 합쳐짐, A → X는 고리
    expect(((await expectOk(api.get(previewPath(x, 'UC_B')))).body.preview as { blocked: string }).blocked).toBe('FROM_MERGED')
    expect(((await expectOk(api.get(previewPath('UC_A', x)))).body.preview as { blocked: string }).blocked).toBe('CYCLE')
  })

  it('응답 seq까지 적용한 상태로 계산한다 — 쓰기와 동시에 조회해도 seq와 미리 보기가 같은 상태의 것', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { b, x } = await sale(world, seller)
    const api = client(world, seller.cookie)
    const writes: Promise<unknown>[] = []
    const reads: Promise<{ body: Record<string, unknown> }>[] = []
    for (let i = 0; i < 6; i++) {
      writes.push(world.server.ingestChat(seller.sellerId, { b, id: `late-${String(i)}`, ch: `UC_L${String(i)}`, nick: '늦은손님', text: '16' }))
      reads.push(expectOk(api.get(previewPath(x, 'UC_B'))))
    }
    await Promise.all(writes)
    const runtime = await world.server.writer.read(seller.sellerId, DAY)
    for (const read of await Promise.all(reads)) {
      const point = runtime.points.find((item) => item.seq === read.body.seq)
      expect(point, `seq ${String(read.body.seq)}`).toBeDefined()
      expect(read.body.preview).toEqual(previewMerge(point?.state as EngineState, x, 'UC_B'))
    }
    // 쓰기가 끝난 뒤의 조회 seq = 그 범위의 마지막 seq
    expect((await expectOk(api.get(previewPath(x, 'UC_B')))).body.seq).toBe(runtime.seq)
  })

  it('리허설 범위는 &rehearsal=true로만 — 실제·리허설 범위가 섞이지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const real = await createBroadcast(world, seller, { date: DAY })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: real.id, no: 1, name: '구피', price: 1000 }))
    await world.server.ingestChat(seller.sellerId, { b: real.id, id: 'r1', ch: 'UC_REAL', nick: '실제', text: '1' })
    const { x } = await sale(world, seller, true)
    const api = client(world, seller.cookie)
    const inRehearsal = await expectOk(api.get(previewPath(x, 'UC_B', '&rehearsal=true')))
    expect(inRehearsal.body.rehearsal).toBe(true)
    expect(inRehearsal.body.seq).toBe((await expectOk(api.get(`/api/days/${DAY}?rehearsal=true`))).body.seq)
    expect(inRehearsal.body.preview).toEqual(previewMerge(await stateOf(world, seller, true), x, 'UC_B'))
    expect((inRehearsal.body.preview as { blocked: unknown }).blocked).toBeNull()
    // 실제 범위에는 리허설 구매자가 없다 (적지 않거나 rehearsal=false)
    for (const extra of ['', '&rehearsal=false']) {
      const inReal = await expectOk(api.get(previewPath(x, 'UC_REAL', extra)))
      expect(inReal.body.rehearsal).toBe(false)
      expect(inReal.body.seq).toBe(3)
      expect((inReal.body.preview as { blocked: string }).blocked).toBe('UNKNOWN_BUYER')
    }
    // 리허설 범위에는 실제 구매자가 없다
    expect(((await expectOk(api.get(previewPath('UC_REAL', 'UC_A', '&rehearsal=true')))).body.preview as { blocked: string }).blocked).toBe('UNKNOWN_BUYER')
    // 잘못된 rehearsal은 다른 날짜 조회와 같은 400
    for (const bad of ['1', 'TRUE', 'yes', '']) {
      const response = await api.get(previewPath(x, 'UC_B', `&rehearsal=${bad}`))
      const day = await api.get(`/api/days/${DAY}?rehearsal=${bad}`)
      expect(response.status, bad).toBe(400)
      expect(response.body, bad).toEqual(day.body)
      expect(response.body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field: 'rehearsal' }] } })
    }
  })

  it('다른 판매자의 범위·없는 범위·틀린 날짜는 날짜 조회와 같은 404 (있는지 알리지 않는다), 로그인이 없으면 401', async () => {
    const world = await newWorld()
    const owner = await addSeller(world)
    const stranger = await addSeller(world)
    const { x } = await sale(world, owner)
    const strangerApi = client(world, stranger.cookie)
    const ownerApi = client(world, owner.cookie)
    // 다른 판매자: 그 판매자의 구매자 ID를 알아도 404 — 날짜 조회와 같은 본문
    const cross = await strangerApi.get(previewPath(x, 'UC_A'))
    const crossDay = await strangerApi.get(`/api/days/${DAY}`)
    expect(cross.status).toBe(404)
    expect(cross.body).toEqual(crossDay.body)
    expect(cross.body).toEqual({ error: { code: 'NOT_FOUND', message: '찾을 수 없어요.' } })
    expect(cross.text).not.toContain(x)
    // 리허설 범위도 같다 (주인에게도 리허설 범위가 없다)
    expect((await ownerApi.get(previewPath(x, 'UC_A', '&rehearsal=true'))).status).toBe(404)
    // 없는 날짜·틀린 날짜
    for (const date of ['2026-10-17', '2026-13-01', '2026-02-30', 'yesterday', '20261018']) {
      const response = await ownerApi.get(`/api/days/${date}/merge-preview?from=UC_A&into=UC_B`)
      const day = await ownerApi.get(`/api/days/${date}`)
      expect(response.status, date).toBe(404)
      expect(response.body, date).toEqual(day.body)
    }
    // 로그인 없음·만료된 세션
    for (const cookie of [null, 'lj_session=nope']) {
      const response = await client(world, cookie).get(previewPath(x, 'UC_A'))
      expect(response.status).toBe(401)
      expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
    }
  })

  it('from·into가 없거나 빈 값·128자 넘음·제어 문자면 400 INVALID_INPUT(필드 from/into) — 받은 값은 되돌려 보내지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sale(world, seller)
    const api = client(world, seller.cookie)
    const base = `/api/days/${DAY}/merge-preview`
    const cases: [string, string[]][] = [
      ['', ['from', 'into']],
      ['?from=UC_A', ['into']],
      ['?into=UC_A', ['from']],
      ['?from=&into=UC_A', ['from']],
      ['?from=UC_A&into=', ['into']],
      ['?from=&into=', ['from', 'into']],
      [`?from=${'a'.repeat(129)}&into=UC_A`, ['from']],
      [`?from=UC_A&into=${'가'.repeat(129)}`, ['into']],
      ['?from=UC%00A&into=UC_A', ['from']],
      ['?from=UC_A&into=UC%0AA', ['into']],
      ['?from=UC%1FA&into=UC%7FB', ['from', 'into']],
      ['?From=UC_A&INTO=UC_B', ['from', 'into']],
    ]
    for (const [query, fields] of cases) {
      const response = await api.get(`${base}${query}`)
      expect(response.status, query).toBe(400)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const error = (response.body as { error: { code: string; problems: { field: string; message: string }[] } }).error
      expect(error.code, query).toBe('INVALID_INPUT')
      expect(error.problems.map((problem) => problem.field), query).toEqual(fields)
      for (const problem of error.problems) expect(problem.message).toMatch(/^[가-힣 .]+$/)
      expect(response.text).not.toContain('aaaa')
      expect(response.text).not.toContain('가가가')
    }
    // 128자(코드 포인트)는 받는다 — 이모지도 한 글자
    expect((await api.get(`${base}?from=${encodeURIComponent('😀'.repeat(128))}&into=UC_A`)).status).toBe(200)
    expect((await api.get(`${base}?from=${encodeURIComponent('😀'.repeat(129))}&into=UC_A`)).status).toBe(400)
  })

  it('휴대폰 번호처럼 보이는 ID는 400과 D-079 ⑥ 문장(+ 고를 것 안내) — 그 값은 응답·로그·DB 어디에도 없다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await sale(world, seller)
    const api = client(world, seller.cookie)
    const before = await dumpAllTables(world.database)
    const logCount = world.logs.length
    for (const phone of ['010-9876-5432', '01098765432', '010 9876 5432', '(010) 9876-5432', '０１０９８７６５４３２']) {
      const asFrom = await api.get(previewPath(phone, 'UC_A'))
      expect(asFrom.status, phone).toBe(400)
      expect(asFrom.body).toEqual({
        error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'from', message: PHONE_NUMBER_MESSAGE, hint: '전화번호 대신 구매자를 골라 주세요.' }] },
      })
      const asInto = await api.get(previewPath('UC_A', phone))
      expect(asInto.status, phone).toBe(400)
      expect(asInto.body).toMatchObject({ error: { problems: [{ field: 'into', message: PHONE_NUMBER_MESSAGE, hint: '전화번호 대신 합칠 구매자를 골라 주세요.' }] } })
      for (const text of [asFrom.text, asInto.text]) {
        expect(text).not.toContain('9876')
        expect(text).not.toContain('5432')
        expect(text).not.toContain('９８７６')
      }
    }
    expect(world.logs.length).toBe(logCount)
    expect(JSON.stringify(world.logs)).not.toContain('9876')
    expect(await dumpAllTables(world.database)).toBe(before)
  })

  it('조회는 아무것도 기록하지 않는다 — 이벤트·발송함·범위 seq·스냅샷 그대로, 응답은 Cache-Control: no-store', async () => {
    const world = await newWorld({ snapshotEvery: 1 })
    const seller = await addSeller(world)
    const { x, y } = await sale(world, seller)
    const api = client(world, seller.cookie)
    const before = await dumpAllTables(world.database)
    const counts = await Promise.all((['events', 'outbox', 'snapshots', 'scopes'] as const).map((table) => countRows(world.database, table)))
    const seqBefore = (await world.server.writer.read(seller.sellerId, DAY)).seq
    for (const [from, into] of [
      [x, 'UC_A'],
      [x, 'UC_B'],
      [y, x],
      ['UC_A', 'UC_A'],
      ['UC_NOBODY', 'UC_A'],
    ] as const) {
      const response = await expectOk(api.get(previewPath(from, into)))
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(await dumpAllTables(world.database)).toBe(before)
    expect(await Promise.all((['events', 'outbox', 'snapshots', 'scopes'] as const).map((table) => countRows(world.database, table)))).toEqual(counts)
    expect((await world.server.writer.read(seller.sellerId, DAY)).seq).toBe(seqBefore)
  })

  it('미리 보기는 넘긴 범위 상태를 바꾸지 않는다 — 조회 뒤 범위 조회와 같은 합치기의 결과가 조회 전과 같다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const { x } = await sale(world, seller)
    const api = client(world, seller.cookie)
    const state = await stateOf(world, seller)
    const serialized = JSON.stringify(state)
    const view = (await expectOk(api.get(`/api/days/${DAY}`))).body
    for (let i = 0; i < 3; i++) await expectOk(api.get(previewPath(x, 'UC_B')))
    expect(JSON.stringify(await stateOf(world, seller))).toBe(serialized)
    expect(await stateOf(world, seller)).toBe(state)
    expect((await expectOk(api.get(`/api/days/${DAY}`))).body).toEqual(view)
    // 같은 합치기를 엔진에 바로 적용한 결과 = 미리 보기 (DUPLICATE가 된 찜 = duplicates[].claim)
    const preview = previewMerge(state, x, 'UC_B')
    const merged = applyEvent(state, { type: 'buyer.merge', from: x, into: 'UC_B', reason: '같은 사람', seq: 999, at: Date.UTC(2026, 9, 18, 13, 0, 0) } as unknown as EngineEvent).state
    const dup = listClaims(merged).filter((claim) => claim.status === 'DUPLICATE').map((claim) => claim.id)
    expect(dup).toEqual(preview.duplicates.map((item) => item.claim))
  })
})
