// AC-S04-50 판매 규칙 설정, AC-S04-51 이벤트 쓰기 API, AC-S04-52 조회·이력 API
import {
  DEFAULT_SETTINGS,
  EVENT_TYPES,
  checkEvent,
  initEngine,
  listBroadcasts,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
} from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { API_EVENTS } from '../src/api-fields.ts'
import { withIsoTimes } from '../src/time.ts'
import { T0, addSeller, client, countRows, createBroadcast, expectOk, newWorld, rid, writeEvent } from './support.ts'

describe('AC-S04-50 판매 규칙 설정 읽기·바꾸기', () => {
  it('읽기는 모든 키(기본값으로 채움), 바꾸기는 일부 키', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.get('/api/settings')).body).toEqual({ settings: DEFAULT_SETTINGS })
    const changed = await expectOk(api.patch('/api/settings', { settings: { 'waitlist.max': 0, 'shipping.freeThreshold': 50_000 } }))
    expect(changed.body).toEqual({ settings: { ...DEFAULT_SETTINGS, 'waitlist.max': 0, 'shipping.freeThreshold': 50_000 } })
    await expectOk(api.patch('/api/settings', { settings: { 'shipping.freeThreshold': null } }))
    expect((await api.get('/api/settings')).body).toEqual({ settings: { ...DEFAULT_SETTINGS, 'waitlist.max': 0 } })
  })

  it('코어 설정 검사로 거르고 문제가 있으면 400(키와 이유), 저장 없음. MANUAL은 "아직 지원하지 않아요"', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    const bad = await api.patch('/api/settings', { settings: { 'waitlist.max': 101, 'claim.parseMode': 'FUZZY', 'shipping.baseFee': 1.5, 'claim.ignoreOwner': 'yes' } })
    expect(bad.status).toBe(400)
    expect(bad.body).toEqual({
      error: {
        code: 'INVALID_INPUT',
        message: '입력한 내용을 확인해 주세요.',
        problems: [
          { field: 'settings.waitlist.max', message: '0부터 100까지 숫자로 적어 주세요.' }, // FB1 D-FB1-18 (g) 범위 문장
          { field: 'settings.claim.parseMode', message: '고를 수 있는 값이 아니에요' },
          { field: 'settings.shipping.baseFee', message: '0부터 1,000,000까지 숫자로 적어 주세요.' }, // FB1 D-FB1-18 (g) 범위 문장
          { field: 'settings.claim.ignoreOwner', message: '예나 아니오로만 정할 수 있어요' },
        ],
      },
    })
    expect((await api.patch('/api/settings', { settings: { 'unknown.key': 1 } })).body).toMatchObject({ error: { problems: [{ field: 'settings.unknown.key', message: '모르는 설정이에요' }] } })
    expect((await api.patch('/api/settings', { settings: [] })).status).toBe(400)
    expect((await api.patch('/api/settings', { 'waitlist.max': 3 })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    const manual = await api.patch('/api/settings', { settings: { 'settlement.groupBy': 'MANUAL' } })
    expect(manual.status).toBe(400)
    expect(manual.body).toEqual({ error: { code: 'NOT_SUPPORTED', message: '아직 지원하지 않는 설정이에요.', problems: [{ field: 'settings.settlement.groupBy', message: '아직 지원하지 않아요.' }] } })
    expect((await api.get('/api/settings')).body).toEqual({ settings: DEFAULT_SETTINGS })
  })

  it('바꾼 설정은 다음에 만드는 방송부터 — 이미 시작한 방송은 바꾸기 전 대기 한도를 쓴다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await expectOk(api.patch('/api/settings', { settings: { 'waitlist.max': 1 } }))
    const first = await createBroadcast(world, seller)
    await expectOk(api.patch('/api/settings', { settings: { 'waitlist.max': 3 } }))
    const second = await createBroadcast(world, seller)
    for (const b of [first, second]) await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    for (let i = 0; i < 6; i++) {
      await world.server.ingestChat(seller.sellerId, { b: first.id, id: `f${String(i)}`, ch: `UC${String(i)}`, nick: 'n', text: '1' })
      await world.server.ingestChat(seller.sellerId, { b: second.id, id: `s${String(i)}`, ch: `UC${String(i)}`, nick: 'n', text: '1' })
    }
    const view = (await api.get(`/api/days/${first.date}`)).body
    const products = view.products as { broadcast: string; waitlist: string[] }[]
    expect(products.find((p) => p.broadcast === first.id)?.waitlist).toHaveLength(1)
    expect(products.find((p) => p.broadcast === second.id)?.waitlist).toHaveLength(3)
  })
})

describe('AC-S04-51 이벤트 쓰기 API', () => {
  // O2(AC-O2-31, D-O2-14): 옵션 방송 이벤트(지금 상품 product.focus·확인 필요 바로잡기 host.resolveReview·지우기 host.dismissReview)의 쓰기 API를 열었다 — product.* 6 → 7, host.* 12 → 14 (교체)
  // D-RETRO-82: 확인 중(임시 등록) 상품을 판매자가 확정·거두는 product.confirm·product.withdraw의 쓰기 API를 열었다 — product.* 7 → 9 (교체)
  it('화면이 보낼 수 있는 종류는 product.*(9)·sms·host.*(14)·buyer.merge/unmerge·settlement.*(4) — 모두 엔진이 처리하는 종류다', () => {
    const types = Object.keys(API_EVENTS)
    expect(types.filter((type) => type.startsWith('product.'))).toHaveLength(9)
    expect(types).toContain('product.confirm')
    expect(types).toContain('product.withdraw')
    // 확인 중으로 올리는 칸은 화면이 보내지 못한다 — 판매자의 손 등록은 늘 바로 판매 중이다 (D-RETRO-82)
    expect(API_EVENTS['product.register']?.fields).not.toContain('tentative')
    expect(types.filter((type) => type.startsWith('host.'))).toHaveLength(14)
    expect(types.filter((type) => type.startsWith('settlement.'))).toHaveLength(4)
    expect(types.filter((type) => type.startsWith('buyer.')).sort()).toEqual(['buyer.merge', 'buyer.unmerge'])
    expect(types).toContain('sms')
    expect(types).toContain('product.focus')
    expect(types).toContain('host.resolveReview')
    expect(types).toContain('host.dismissReview')
    // D-YT-SRV-24: 방송 중 감사 켜기·끄기 broadcast.thanks를 방송 메뉴에서 보낸다 — 종류 하나 추가 (+1)
    expect(types.filter((type) => type.startsWith('broadcast.'))).toEqual(['broadcast.thanks'])
    expect(types).toHaveLength(9 + 14 + 4 + 2 + 1 + 1)
    for (const type of types) expect(EVENT_TYPES).toContain(type)
    // D-RETRO-85: broadcast.pendingExpire(D-PEND-01)는 서버가 상품 공개 이벤트 앞에 스스로 덧붙이는 종류다(writer.ts withPendingKept) — 화면이 보내는 종류가 아니다.
    // D-PEND-01이 엔진에 종류를 더하며 이 목록을 고치지 않아 깨져 있던 것을 스펙(R-5 "방송 중에는 broadcast.pendingExpire로")대로 바로잡는다
    const engineOnly = ['broadcast.start', 'broadcast.end', 'broadcast.pendingExpire', 'chat', 'effect.labelPrinted', 'effect.thanksSent']
    for (const type of EVENT_TYPES) if (!types.includes(type)) expect(engineOnly).toContain(type)
  })

  it('요청 필드 표는 코어 이벤트 표와 같다 (서버가 받는 필드는 코어도 받고, 코어 필수 필드는 서버도 받는다)', () => {
    const state = initEngine({ broadcasts: [{ id: 'b1', date: '2026-10-19', title: '1부' }], settings: {} })
    const UNKNOWN = '이 종류의 이벤트에 없는 필드다'
    for (const [type, spec] of Object.entries(API_EVENTS)) {
      // voiceLog (V3 R-25): 음성 기록 칸 — 엔진 필드가 아니고 서버가 음성 기록 줄로만 쓴다(sms의 voice와 같이 뺀다)
      const fields = type === 'sms' ? [...spec.fields.filter((field) => !['phone', 'last4', 'newBuyer', 'voice'].includes(field)), 'ref', 'phoneKey', 'phoneLast4'] : spec.fields.filter((field) => field !== 'voiceLog')
      const event: Record<string, unknown> = { type, seq: 1, at: T0 }
      for (const field of fields) event[field] = 'x'
      const problems = checkEvent(state, event)
      expect(problems.filter((problem) => problem.message.includes(UNKNOWN)).map((problem) => problem.field), type).toEqual([])
      // 서버 표에 없는 이름은 코어도 받지 않는다
      expect(checkEvent(state, { ...event, zzz: 1 }).some((problem) => problem.field === 'zzz'), type).toBe(true)
      // 코어 필수 필드는 서버 표에 있다 (sms의 ref는 서버가 만든다)
      const required = checkEvent(state, { type, seq: 1, at: T0 })
        .filter((problem) => problem.message === '필수 필드가 없다')
        .map((problem) => problem.field)
      for (const field of required) expect(type === 'sms' && field === 'ref' ? true : spec.fields.includes(field as string), `${type}.${String(field)}`).toBe(true)
    }
  })

  it('응답: seq, changed, 이 입력으로 나온 효과 ID. 맞지 않는 명령도 기록되고 changed: false', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    const sms = await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, received: '11:59' }))
    // 문자찜 응답에는 그 문자찜이 정한 구매자 자신(buyer)이 더해졌다 (AC-S06b-11) — 전화번호 없는 새 문자 구매자 = sms:<서버가 만든 ref>
    const smsClaimBuyer = listClaims((await world.server.writer.read(seller.sellerId, b.date)).state).find((claim) => claim.seq === 3)?.buyer
    expect(smsClaimBuyer).toMatch(/^sms:[a-z]+$/)
    expect(sms.body).toEqual({
      date: b.date,
      rehearsal: false,
      seq: 3,
      type: 'sms',
      changed: true,
      effects: ['c1:PRINT_PRODUCT_LABEL:-:1', 'c1:POST_THANKS:LIVE_CHAT:1'],
      phoneLast4: null,
      buyer: smsClaimBuyer,
    })
    const outboxIds = (await world.database.pglite?.query<{ effect_id: string }>(`select effect_id from outbox where seq = 3 order by id`))?.rows.map((row) => row.effect_id)
    expect(outboxIds).toEqual(sms.body.effects)
    const noop = await expectOk(writeEvent(world, seller, { type: 'host.cancel', b: b.id, no: 99, buyer: 'UC1', reason: '없는 상품' }))
    expect(noop.body).toEqual({ date: b.date, rehearsal: false, seq: 4, type: 'host.cancel', changed: false, effects: [] })
    expect(await countRows(world.database, 'events')).toBe(4)
  })

  it('범위: b가 있으면 그 방송의 범위(남의·없는 방송은 404), 없으면 ?date= 범위(없는 범위면 404), settlement.*의 date는 범위 날짜와 같아야 한다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b18 = await createBroadcast(world, seller, { date: '2026-10-18' })
    const b19 = await createBroadcast(world, seller, { date: '2026-10-19' })
    await world.server.ingestChat(seller.sellerId, { b: b18.id, id: 'm1', ch: 'UC1', nick: 'n', text: '안녕' })
    expect((await writeEvent(world, seller, { type: 'product.register', b: 'b_none', no: 1, name: 'a', price: 1 })).status).toBe(404)
    expect((await writeEvent(world, seller, { type: 'product.register', b: b18.id, no: 1, name: 'a', price: 1 }, '2026-10-18')).status).toBe(400)
    const block = await expectOk(writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UC1', reason: '욕설' }, '2026-10-18'))
    expect(block.body).toMatchObject({ date: '2026-10-18', seq: 3 })
    expect((await writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UC1', reason: '욕설' })).status).toBe(400)
    expect((await writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UC1', reason: '욕설' }, '2026-10-20')).status).toBe(404)
    expect((await writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UC1', reason: '욕설' }, '2026-02-30')).status).toBe(400)
    const mismatch = await writeEvent(world, seller, { type: 'settlement.payment', buyer: 'UC1', date: '2026-10-19', amount: 1000 }, '2026-10-18')
    expect(mismatch.status).toBe(400)
    expect(mismatch.body).toMatchObject({ error: { problems: [{ field: 'date' }] } })
    await expectOk(writeEvent(world, seller, { type: 'settlement.payment', buyer: 'UC1', date: '2026-10-18', amount: 1000, memo: '입금자 김영희' }, '2026-10-18'))
    expect((await client(world, seller.cookie).get('/api/days')).body).toEqual({
      days: [
        // Y1: 범위마다 봉인 예정 시각·봉인 여부 (AC-Y1-62) — 10/18은 유튜브 채팅(실제 범위 채팅)이 있어 10/18 + 30일 0시(KST)
        { date: '2026-10-18', rehearsal: false, seq: 4, sealAt: '2026-11-16T15:00:00.000Z', sealed: false },
        { date: '2026-10-19', rehearsal: false, seq: 1, sealAt: null, sealed: false },
      ],
    })
    void b19
  })

  it('요청 본문은 그 종류의 엔진 필드와 요청 번호만: 모르는 필드·seq·at·다른 종류의 필드는 400, 기록 없음', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const base = JSON.stringify({ requestId: 'R', type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 }).slice(0, -1)
    for (const extra of ['"seq":5', `"at":${String(T0)}`, '"note":"x"', '"buyer":"UC1"', '"__proto__":{"x":1}', '"constructor":{}']) {
      const text = `${base.replace('"R"', `"${rid()}"`)},${extra}}`
      const response = await client(world, seller.cookie).raw('/api/events', { method: 'POST', headers: { Origin: 'https://app.livejjim.test', 'Content-Type': 'application/json' }, body: text })
      expect(response.status, text).toBe(400)
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('UNKNOWN_FIELD')
    }
    expect(await countRows(world.database, 'events')).toBe(1)
  })

  it('product.*·host.*·buyer.*·settlement.* 한 바퀴 (판정은 코어 그대로)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const ok = (event: Record<string, unknown>, date?: string) => expectOk(writeEvent(world, seller, event, date))
    await ok({ type: 'product.register', b: b.id, no: 1, name: '핑크프릴', price: 10000, stock: 2, status: 'READY' })
    await ok({ type: 'product.open', b: b.id, no: 1 })
    await ok({ type: 'product.update', b: b.id, no: 1, price: 12000, applyTo: 'NEW_ONLY' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: '영희', text: '1' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm2', ch: 'UC2', nick: '철수', text: '1' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm3', ch: 'UC3', nick: '민수', text: '1' })
    await ok({ type: 'host.confirm', b: b.id, no: 1, buyer: 'UC1' })
    await ok({ type: 'host.promote', b: b.id, no: 1, buyer: 'UC3', reason: '먼저 말함' })
    await ok({ type: 'product.hold', b: b.id, no: 1 })
    await ok({ type: 'product.renumber', b: b.id, from: 1, to: 11 })
    await ok({ type: 'buyer.merge', from: 'UC2', into: 'UC1', reason: '같은 사람' }, b.date)
    await ok({ type: 'buyer.unmerge', from: 'UC2', reason: '다른 사람' }, b.date)
    await ok({ type: 'settlement.shippingOverride', buyer: 'UC1', date: b.date, mode: 'PICKUP' }, b.date)
    await ok({ type: 'settlement.adjust', buyer: 'UC1', date: b.date, amount: -1000, reason: '단골 할인' }, b.date)
    await ok({ type: 'settlement.payment', buyer: 'UC1', date: b.date, amount: 11000 }, b.date)
    await ok({ type: 'settlement.refund', buyer: 'UC1', date: b.date, amount: 1000, reason: '과입금' }, b.date)
    await ok({ type: 'product.close', b: b.id, no: 11 })
    const view = (await client(world, seller.cookie).get(`/api/days/${b.date}`)).body
    expect((view.products as { key: string; status: string }[]).map((p) => [p.key, p.status])).toEqual([[`${b.id}/11`, 'CLOSED']])
    const settlement = (view.settlements as { buyer: string; total: number; received: number }[]).find((s) => s.buyer === 'UC1')
    expect(settlement).toMatchObject({ received: 10000 })
  })
})

describe('AC-S04-52 조회·이력 API', () => {
  it('방송 목록: 날짜별, ID·날짜·제목·끝났는지', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b20 = await createBroadcast(world, seller, { date: '2026-10-20', title: '둘째 날' })
    const b19a = await createBroadcast(world, seller, { date: '2026-10-19' })
    const b19b = await createBroadcast(world, seller, { date: '2026-10-19' })
    // D-UX3-18: 만든 시각(createdAt)·이은 플랫폼(platforms)을 덧붙였다 — 옛 기대는 앞 여섯 칸만이었다
    const made = { createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) as unknown as string, platforms: [] }
    expect((await client(world, seller.cookie).get('/api/broadcasts')).body).toEqual({
      broadcasts: [
        { id: b19a.id, date: '2026-10-19', title: '1부', rehearsal: false, ended: false, endedAt: null, ...made },
        { id: b19b.id, date: '2026-10-19', title: '2부', rehearsal: false, ended: false, endedAt: null, ...made },
        { id: b20.id, date: '2026-10-20', title: '둘째 날', rehearsal: false, ended: false, endedAt: null, ...made },
      ],
    })
  })

  it('범위 조회: 값은 코어 조회 함수의 결과와 같다(시각 필드는 UTC ISO 8601), 지금 seq, 확인 필요', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1000 }))
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm1', ch: 'UC1', nick: 'n', text: '1' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm2', ch: 'UC2', nick: 'n', text: '1' })
    await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'm3', ch: 'UC1', nick: 'n', text: '1 취소' })
    await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 1, received: '11:59', phone: '01011112222' }))
    const view = await client(world, seller.cookie).get(`/api/days/${b.date}`)
    const state = (await world.server.writer.read(seller.sellerId, b.date)).state
    expect(view.body).toEqual({
      ...withIsoTimes({
        date: b.date,
        rehearsal: false,
        seq: 6,
        broadcasts: listBroadcasts(state),
        products: listProducts(state),
        claims: listClaims(state),
        pending: listPending(state),
        buyers: listBuyers(state),
        settlements: listSettlements(state),
        effects: listEffects(state),
        cancelRequests: listCancelRequests(state),
        attention: [],
        // I2 (AC-I2-33): 실제 범위의 날짜 보기에는 묶음마다 포장·배송 상태가 있다 — 기록이 없으면 포장 대기 (교체 목록: harness/sprints/I2/dev-notes.md)
        // T1 (AC-T1-52): 묶음마다 택배 줄 parcel — 택배 접수가 없으면 null (계약 변경에 따른 교체: harness/sprints/T1/dev-notes.md)
        packing: listSettlements(state)
          .filter((settlement) => settlement.date === b.date && settlement.items.length > 0)
          .map((settlement) => ({ buyer: settlement.buyer, status: '포장 대기', invoice: null, parcel: null })),
      }),
      // N3(AC-N3-32): 실제 범위 조회에는 입금 연결이 붙는다 (입금 확인으로 적은 기록이 없으면 빈 목록) — 계약 변경에 따른 교체
      depositLinks: [],
    })
    expect((view.body.packing as unknown[]).length).toBeGreaterThan(0)
    expect(JSON.parse(view.text)).toEqual(view.body)
    expect((view.body.claims as { at: string }[])[0]?.at).toBe(new Date(T0).toISOString())
    expect(view.headers.get('cache-control')).toBe('no-store')
    expect((await client(world, seller.cookie).get('/api/days/2026-10-25')).status).toBe(404)
    expect((await client(world, seller.cookie).get('/api/days/not-a-date')).status).toBe(404)
  })

  it('이력: seq 순, 종류·시각·조치자(계정 아이디·서버·수집기)·사유·그 밖의 필드·실패 표시, 어떤 seq 뒤부터 일부만', async () => {
    const world = await newWorld()
    const seller = await addSeller(world, 'histshop')
    const b18 = await createBroadcast(world, seller, { date: '2026-10-18' })
    await world.server.ingestChat(seller.sellerId, { b: b18.id, id: 'm1', ch: 'UCX', nick: 'X', text: '안녕' })
    await expectOk(writeEvent(world, seller, { type: 'host.blockBuyer', buyer: 'UCX', reason: '욕설' }, '2026-10-18'))
    world.clock.advance(1000)
    const b = await createBroadcast(world, seller, { date: '2026-10-19' })
    world.clock.advance(1000)
    await expectOk(writeEvent(world, seller, { type: 'product.update', b: b.id, no: 1, price: 5000 }))
    const api = client(world, seller.cookie)
    const all = await api.get('/api/days/2026-10-19/history')
    expect(all.body).toEqual({
      date: '2026-10-19',
      rehearsal: false,
      events: [
        {
          seq: 1,
          type: 'broadcast.start',
          at: new Date(T0 + 1000).toISOString(),
          receivedAt: new Date(T0 + 1000).toISOString(),
          actor: { kind: 'account', loginId: 'histshop' },
          reason: null,
          fields: { b: b.id, date: '2026-10-19', title: '1부', settings: DEFAULT_SETTINGS },
          failed: false,
        },
        {
          seq: 2,
          type: 'host.blockBuyer',
          at: new Date(T0 + 1000).toISOString(),
          receivedAt: new Date(T0 + 1000).toISOString(),
          actor: { kind: 'server', loginId: null },
          reason: '이전 방송에서 차단한 시청자',
          fields: { buyer: 'UCX' },
          failed: false,
        },
        {
          seq: 3,
          type: 'product.update',
          at: new Date(T0 + 2000).toISOString(),
          receivedAt: new Date(T0 + 2000).toISOString(),
          actor: { kind: 'account', loginId: 'histshop' },
          reason: null,
          fields: { b: b.id, no: 1, price: 5000 },
          failed: false,
        },
      ],
    })
    const page = await api.get('/api/days/2026-10-19/history?after=1&limit=1')
    expect((page.body.events as { seq: number }[]).map((event) => event.seq)).toEqual([2])
    expect((await api.get('/api/days/2026-10-19/history?after=3')).body).toEqual({ date: '2026-10-19', rehearsal: false, events: [] })
    expect((await api.get('/api/days/2026-10-18/history')).body.events).toHaveLength(3)
    expect(((await api.get('/api/days/2026-10-18/history')).body.events as { actor: { kind: string } }[])[1]?.actor).toEqual({ kind: 'collector', loginId: null })
    for (const query of ['after=-1', 'limit=0', 'after=abc', 'limit=99999']) expect((await api.get(`/api/days/2026-10-19/history?${query}`)).status, query).toBe(400)
    expect((await api.get('/api/days/2026-10-25/history')).status).toBe(404)
  })

  it('모든 이벤트 행에 조치자와 서버 도착 시각(UTC)을 적고, 엔진 이벤트에는 넣지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 1, name: 'a', price: 1 }))
    const rows = (await world.database.pglite?.query<{ actor: string; account_id: string | null; received_at: Date; body: string }>(`select actor, account_id, received_at, body from events order by seq`))?.rows ?? []
    for (const row of rows) {
      expect(row.actor).toBe('account')
      expect(row.account_id).toBe(seller.accountId)
      expect(row.received_at.getTime()).toBe(T0)
      const event = JSON.parse(row.body) as Record<string, unknown>
      for (const key of ['actor', 'account', 'accountId', 'receivedAt', 'requestId']) expect(Object.hasOwn(event, key)).toBe(false)
    }
  })
})

describe('오류 문장은 쉬운 한국어 (UX-01·03, AC-S04-22)', () => {
  it('API 오류 응답의 문장·문제 문장에 영어가 없다 (설정 문제는 코어 checkSettings 문장 그대로)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const api = client(world, seller.cookie)
    const anonymous = client(world, null)
    const raw = async (body: string, contentType = 'application/json') => {
      const response = await api.raw('/api/events', { method: 'POST', headers: { Origin: 'https://app.livejjim.test', 'Content-Type': contentType }, body })
      return { status: response.status, body: (await response.json()) as Record<string, unknown> }
    }
    const responses = [
      await anonymous.get('/api/me'),
      await api.get('/api/days/2026-01-01'),
      await api.post('/api/events', {}),
      await api.post('/api/events', { requestId: rid(), type: 'nope' }),
      await api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, no: -1, name: 3, price: 'x', stock: 0, status: 'X' }),
      await api.post('/api/events', { requestId: rid(), type: 'product.register', b: b.id, no: 1, name: 'a', price: 1, extra: 1 }),
      await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, no: 1, received: '25:00', memo: '010-1234-5678', phone: 5, buyer: '' }),
      await api.post('/api/events', { requestId: rid(), type: 'sms', b: b.id, no: 1, buyer: 'UCX' }),
      await api.post('/api/events', { requestId: rid(), type: 'host.assign', b: b.id, no: 1, buyer: 'UC1', reason: 'r', replace: 'UC2' }),
      await api.post('/api/events', { requestId: rid(), type: 'settlement.shippingOverride', buyer: 'UC1', date: b.date, mode: 'FIXED' }),
      await api.post(`/api/events?date=${b.date}`, { requestId: rid(), type: 'settlement.shippingOverride', buyer: 'UC1', date: b.date, mode: 'FIXED' }),
      await api.post(`/api/events?date=${b.date}`, { requestId: rid(), type: 'settlement.payment', buyer: 'UC1', date: '2026-01-01', amount: 0 }),
      await api.post('/api/broadcasts', { requestId: rid(), date: 'x', title: '' }),
      await api.get(`/api/days/${b.date}/history?after=x`),
      await raw('{"x":'),
      await raw('{}', 'text/plain'),
      await raw('[1]'),
      await client(world, null).post('/api/login', { loginId: 'zz', password: 'yy-yy-yy-yy' }),
    ]
    for (const { status, body } of responses) {
      const error = (body as { error?: { message?: string; problems?: { field: string | null; message: string }[] } }).error
      expect(status).toBeGreaterThanOrEqual(400)
      expect(error?.message, JSON.stringify(body)).toMatch(/[가-힣]/)
      expect(error?.message, JSON.stringify(body)).not.toMatch(/[A-Za-z]/)
      for (const problem of error?.problems ?? []) {
        expect(problem.message, JSON.stringify(problem)).toMatch(/[가-힣]/)
        expect(problem.message, JSON.stringify(problem)).not.toMatch(/[A-Za-z]/)
      }
    }
  })
})
