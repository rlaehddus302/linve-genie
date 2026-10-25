// CRM1 적대 시험 (test-domain) — 수용 기준을 하나씩 깨뜨려 본다.
// - TD-CRM1-001: 음성 문자찜의 "끝자리만" 문자 구매자(전화번호 없음 — 범위·끝자리로 만든 그날만의 키)를 날짜를 넘는 손님으로 다룬다
// - AC-CRM1-08 사유 변형(전각 공백·탭·줄 나눔·비슷한 글), 무효(host.reject)·교체 취소, 한 날에 (가)·(나) 둘 다
// - AC-CRM1-22 메모 검사 경계(코드 포인트 200·201, 이모지·결합 글자, 앞뒤 전각 공백, 제어 글자·탭·짝 없는 서로게이트, 번호 표기 변형), 덧붙이기·지우기·동시 저장
// - AC-CRM1-25·27 권한·로그, AC-CRM1-26 구매자에게 가는 것·백업·판매대장에 손님 기록·메모가 없다
// - AC-CRM1-07 봉인 날짜: 합친 문자 구매자의 전화번호 키로 이어진다, 봉인 날짜엔 아무것도 쓰지 않는다
// - AC-CRM1-30 동시 요청(입금 쓰기 ↔ 손님 기록 조회)이 섞여도 마지막 조회 = 처음부터 센 값
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createBackupBytes } from '../../../apps/server/src/backup.ts'
import { at, buy, chat, countOf, crm, crmWorld, kst, ok, payAll } from '../../../apps/server/test/crm1-support.ts'
import { getFile } from '../../../apps/server/test/i2-support.ts'
import { readZip } from '../../../apps/server/test/n4b-support.ts'
import { addSeller, client, createBroadcast, expectOk, login, writeEvent } from '../../../apps/server/test/support.ts'

/** 농부 이모지 = U+1F469 ZWJ U+1F33E (코드 포인트 3개) */
const FARMER = '\u{1F469}\u200D\u{1F33E}'
const PHONE_MESSAGE = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'

// ── TD-CRM1-001 끝자리만 문자 구매자 ────────────────────────────────────

describe('TD-CRM1-001: 끝자리만 말한 음성 문자찜 구매자는 전화번호 없는 문자 손님이다 (D-CRM1-02·D-CRM1-08, AC-CRM1-05)', () => {
  it('10-01·10-08에 "끝자리 1234"로 넣은 문자 구매자 — "모든 손님"에 줄이 없고, 메모 칸 대신 안내(손님 ID null), 기록은 그날만', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const buyers: string[] = []
    for (const date of ['2026-10-01', '2026-10-08']) {
      at(world, date, '20:00:00')
      const b = (await createBroadcast(world, seller, { date })).id
      await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 10_000 })
      // 전화번호 없이 끝자리 넷만 (음성 문자찜 — 서버는 범위·끝자리로 그날만의 키를 만든다, sms-last4.ts)
      const buyer = (await ok(world, seller, { type: 'sms', b, no: 1, received: '20:00', last4: '1234', voice: true })).body.buyer as string
      await payAll(world, seller, date, buyer)
      buyers.push(buyer)
    }
    at(world, '2026-10-26', '12:00:00')
    // 그날 기록은 그날 묶음만 (지금도 그렇다 — 다른 날과 이어지지 않는다)
    expect((await c.summary('2026-10-08', buyers[1] as string)).purchaseDays).toBe(1)
    // 다른 날과 이어지지 않는 손님이 "모든 손님"에 날짜마다 따로 한 줄씩 생기면 안 된다 (같은 "문자 · 끝자리 1234" 두 줄)
    expect((await c.rows()).map((row) => [row.kindLabel, row.latestDate])).toEqual([])
    // 메모 칸 대신 "전화번호 없는 문자 손님은 다른 날과 이어지지 않아 메모를 남길 수 없어요." — 메모를 저장해도 다음 날짜엔 보이지 않기 때문
    const members = await c.members('2026-10-08', buyers[1] as string)
    expect(members).toEqual([expect.objectContaining({ buyer: buyers[1], kindLabel: '문자 · 끝자리 1234', phoneLast4: '1234', customer: null, memo: null })])
  })
})

// ── AC-CRM1-08 사유 읽기 ────────────────────────────────────────────────

describe("AC-CRM1-08 '입금 안 함' 사유 변형 (적대)", () => {
  it('공백(전각·탭·줄 나눔·NBSP)만 다른 사유는 미입금, 비슷한 글("입금 안함?"·"입금 안 함함"·"입금 안 했음")은 아니다 — 취소는 모두 센다', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const cases: [string, string, boolean][] = [
      ['2026-10-01', '입금\u3000안\u3000함', true],
      ['2026-10-02', '\t입금 안 함\n', true],
      ['2026-10-03', '입금\u00a0안\u00a0함', true],
      ['2026-10-04', '입 금 안 함', true],
      ['2026-10-05', '입금 안함?', false],
      ['2026-10-06', '입금 안 함함', false],
      ['2026-10-07', '입금 안 했음', false],
      ['2026-10-08', '입금안함 입금안함', false],
    ]
    for (const [date, reason] of cases) {
      const { b, no } = await buy(world, seller, date, 'UC_A', '다육이맘', 10_000)
      await ok(world, seller, { type: 'host.cancel', b, no, buyer: 'UC_A', reason })
    }
    at(world, '2026-10-26', '12:00:00')
    const wanted = cases.filter(([, , noPay]) => noPay).map(([date]) => date)
    expect(await c.summary('2026-10-08', 'UC_A')).toEqual({
      purchaseDays: 0,
      purchaseTotal: 0,
      lastPurchase: null,
      unpaidDays: wanted.length,
      lastUnpaid: wanted.at(-1),
      cancels: cases.length,
      regular: false,
      caution: true,
    })
  })

  it("무효(host.reject) '입금 안 함'도 미입금. 같은 날 (가) 기한 지난 미입금 묶음과 (나)가 함께면 1번. 대기에서 올라온 1등의 '입금 안 함' 취소는 그 사람 몫", async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    // 10-01: UC_A 1등 무효 '입금 안 함'
    const d1 = await buy(world, seller, '2026-10-01', 'UC_A', '다육이맘', 10_000)
    await ok(world, seller, { type: 'host.reject', b: d1.b, no: d1.no, buyer: 'UC_A', reason: '입금 안 함' })
    // 10-02: UC_A가 두 상품 1등 — 하나는 '입금 안 함' 취소, 하나는 남아 미입금(기한 지남) → 같은 날 1번
    const d2 = await buy(world, seller, '2026-10-02', 'UC_A', '다육이맘', 10_000)
    await buy(world, seller, '2026-10-02', 'UC_A', '다육이맘', 7000, d2.b)
    await ok(world, seller, { type: 'host.cancel', b: d2.b, no: d2.no, buyer: 'UC_A', reason: '입금 안 함' })
    // 10-03: UC_Z 1등, UC_A 대기 → UC_Z '손님 요청' 취소로 UC_A가 올라옴 → UC_A '입금 안 함' 취소 (1등이었던 찜)
    const d3 = await buy(world, seller, '2026-10-03', 'UC_Z', '제트', 10_000)
    await chat(world, seller, d3.b, 'w3', 'UC_A', '다육이맘', String(d3.no))
    await ok(world, seller, { type: 'host.cancel', b: d3.b, no: d3.no, buyer: 'UC_Z', reason: '손님 요청' })
    await ok(world, seller, { type: 'host.cancel', b: d3.b, no: d3.no, buyer: 'UC_A', reason: '입금 안 함' })
    at(world, '2026-10-26', '12:00:00')
    expect(await c.summary('2026-10-03', 'UC_A')).toMatchObject({ unpaidDays: 3, lastUnpaid: '2026-10-03', cancels: 3, caution: true })
    // UC_Z는 '손님 요청'으로 끝난 1등 하나 — 취소 1번, 미입금 아님
    expect(await c.summary('2026-10-03', 'UC_Z')).toMatchObject({ unpaidDays: 0, cancels: 1, caution: false })
  })
})

// ── AC-CRM1-22 메모 검사 ────────────────────────────────────────────────

describe('AC-CRM1-22 메모 검사 경계 (적대)', () => {
  async function memoWorld() {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    await buy(world, seller, '2026-10-08', 'UC_A', '다육이맘', 10_000)
    const id = (await c.members('2026-10-08', 'UC_A'))[0]?.customer as string
    return { world, seller, c, id }
  }

  it('코드 포인트로 센다: 이모지 200개 저장, 201개 거절. 결합 글자·ZWJ 이모지는 코드 포인트마다 센다. 앞뒤 전각 공백·줄 나눔은 뺀다', async () => {
    const { c, id } = await memoWorld()
    expect((await expectOk(c.memo(id, '🌵'.repeat(200)))).body.memo).toMatchObject({ text: '🌵'.repeat(200) })
    expect((await c.memo(id, '🌵'.repeat(201))).body).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'text', message: '메모는 200자까지 적을 수 있어요.' }] } })
    // ${FARMER} = 3 코드 포인트 → 67개 = 201
    expect((await c.memo(id, FARMER.repeat(67))).status).toBe(400)
    expect((await c.memo(id, `${FARMER.repeat(66)}가a`)).status).toBe(200)
    // 앞뒤 공백 200개 + 글 200자 = 저장 (빼고 센다)
    expect((await expectOk(c.memo(id, `\u3000 \n${'가'.repeat(200)}\r\n\u3000`))).body.memo).toMatchObject({ text: '가'.repeat(200) })
    // \r\n과 \r는 \n으로, 가운데 줄 나눔은 그대로
    expect((await expectOk(c.memo(id, '첫줄\r\n둘째\r셋째'))).body.memo).toMatchObject({ text: '첫줄\n둘째\n셋째' })
    // 공백만 = 지움
    expect((await expectOk(c.memo(id, ' \u3000\n\t '))).body).toEqual({ memo: null })
  })

  it('제어 글자(BEL·탭·DEL·C1)·짝 없는 서로게이트·글자 아닌 값은 거절, 거절 뒤 마지막 메모는 그대로', async () => {
    const { world, seller, c, id } = await memoWorld()
    await expectOk(c.memo(id, '먼저 쓴 메모'))
    for (const text of ['종\u0007', '가\t나', '가\u007f', '가\u0085나', '가\u009b나', '가\ud800나', '가\udc00']) {
      const response = await c.memo(id, text)
      expect(response.status, JSON.stringify(text)).toBe(400)
      expect(response.body, JSON.stringify(text)).toEqual({ error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'text', message: '메모에 쓸 수 없는 글자가 있어요. 빼고 적어 주세요.' }] } })
    }
    for (const body of [123, null, ['가'], { a: 1 }, true]) expect((await c.memo(id, body)).status, JSON.stringify(body)).toBe(400)
    expect((await client(world, seller.cookie).put(`/api/customers/${id}/memo`, { text: '가', extra: 1 })).body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    expect((await c.members('2026-10-08', 'UC_A'))[0]?.memo?.text).toBe('먼저 쓴 메모')
    // 거절은 행을 더하지 않는다 (저장 한 번만)
    expect(await countOf(world, 'customer_memos')).toBe(1)
  })

  it('번호 표기 변형은 D-079 ⑥ 문장으로 거절, 010을 뺀 8자리·날짜·금액은 저장', async () => {
    const { c, id } = await memoWorld()
    for (const text of ['010 1234 5678로 연락', '01012345678', '010.1234.5678', '번호 010-1234-5678\n입금 늦음', '011-234-5678']) {
      const response = await c.memo(id, text)
      expect(response.status, text).toBe(400)
      expect(response.body, text).toMatchObject({ error: { problems: [{ field: 'text', message: PHONE_MESSAGE }] } })
    }
    for (const text of ['10/8 늦게 입금 15,000원', '1234-5678', '2026-10-08 노쇼', '끝자리 5678']) expect((await c.memo(id, text)).status, text).toBe(200)
  })

  it('두 기기 동시 저장 — 둘 다 덧붙고 나중 것이 마지막, 이벤트 로그는 그대로', async () => {
    const { world, c, id } = await memoWorld()
    const events = await countOf(world, 'events')
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => c.memo(id, `메모 ${String(i)}`)))
    for (const result of results) expect(result.status).toBe(200)
    expect(await countOf(world, 'customer_memos')).toBe(8)
    const last = await world.database.pglite?.query<{ text: string }>('select text from customer_memos order by id desc limit 1')
    expect((await c.members('2026-10-08', 'UC_A'))[0]?.memo?.text).toBe(last?.rows[0]?.text)
    expect(await countOf(world, 'events')).toBe(events)
  })
})

// ── AC-CRM1-25·27 권한·로그 ─────────────────────────────────────────────

describe('AC-CRM1-25·27 다른 판매자·로그 (적대)', () => {
  it('S2가 S1 손님 ID로 메모를 쓰거나 읽으면 404, 행이 생기지 않는다. 같은 채널이 S2에도 있어도 손님 ID가 다르다', async () => {
    const { world, seller } = await crmWorld()
    const other = await addSeller(world)
    await buy(world, seller, '2026-10-08', 'UC_SAME', '같은채널', 10_000)
    await buy(world, other, '2026-10-08', 'UC_SAME', '같은채널', 10_000)
    const mine = (await crm(world, seller).members('2026-10-08', 'UC_SAME'))[0]?.customer as string
    const theirs = (await crm(world, other).members('2026-10-08', 'UC_SAME'))[0]?.customer as string
    expect(mine).not.toBe(theirs)
    expect((await crm(world, other).memo(mine, 'S2가 쓴 메모')).status).toBe(404)
    expect((await crm(world, other).customer(mine)).status).toBe(404)
    expect(await countOf(world, 'customer_memos')).toBe(0)
    await expectOk(crm(world, seller).memo(mine, 'S1 메모'))
    expect((await crm(world, other).members('2026-10-08', 'UC_SAME'))[0]?.memo).toBeNull()
    expect(JSON.stringify((await expectOk(crm(world, other).customer(theirs))).body)).not.toContain('S1 메모')
  })

  it('거절한 메모 글(번호·201자·제어 글자)·찾는 말·채널 ID·전화번호가 로그에도 오류 응답에도 없다', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const d = await buy(world, seller, '2026-10-08', 'UC_LOGSECRET77', '비밀닉', 10_000)
    await ok(world, seller, { type: 'product.register', b: d.b, no: 701, name: '문자', price: 5000 })
    const sms = (await ok(world, seller, { type: 'sms', b: d.b, no: 701, received: '20:00', phone: '010-4444-8765' })).body.buyer as string
    await ok(world, seller, { type: 'buyer.merge', from: sms, into: 'UC_LOGSECRET77', reason: '같은 사람' }, '2026-10-08')
    const members = await c.members('2026-10-08', 'UC_LOGSECRET77')
    const texts = ['비밀메모 010-4444-8765', `비밀메모${'가'.repeat(200)}`, '비밀메모\u0007']
    const bodies: string[] = []
    for (const member of members) for (const text of texts) bodies.push((await c.memo(member.customer as string, text)).text)
    bodies.push((await c.list(`q=${encodeURIComponent('010-4444-8765')}`)).text, (await c.list(`q=${encodeURIComponent('비밀찾기'.repeat(11))}`)).text)
    for (const row of await c.rows()) bodies.push((await expectOk(c.customer(row.id))).text)
    const logs = JSON.stringify(world.logs)
    for (const secret of ['비밀메모', '비밀찾기', 'UC_LOGSECRET77', '010-4444-8765', '01044448765']) expect(logs, secret).not.toContain(secret)
    for (const body of bodies.slice(0, 8)) for (const secret of ['비밀메모', '비밀찾기', '4444-8765']) expect(body, secret).not.toContain(secret)
  })
})

// ── AC-CRM1-26 구매자에게 가는 것·백업 ──────────────────────────────────

describe('AC-CRM1-26 판매대장·백업·포장 라벨·발송함에 손님 기록·메모가 없다 (적대)', () => {
  it('입금 늦음 주의·메모 "노쇼 2번 조심" 손님 — 판매대장 엑셀(전체·그날)·백업 파일·포장 라벨 자료·발송함 글에 메모·꼬리표 낱말이 없다', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    await buy(world, seller, '2026-10-08', 'UC_B', '비', 10_000)
    await buy(world, seller, '2026-10-22', 'UC_B', '비', 20_000)
    at(world, '2026-10-26', '12:00:00')
    expect(await c.summary('2026-10-22', 'UC_B')).toMatchObject({ caution: true })
    const id = (await c.members('2026-10-22', 'UC_B'))[0]?.customer as string
    await expectOk(c.memo(id, '노쇼 2번 조심'))
    await expectOk(c.saveSettings({ regularCount: 2, regularAmount: null, waitDays: 3 }))
    const texts: [string, string][] = []
    for (const path of ['/api/export/ledger.xlsx', '/api/ledger.xlsx?from=2026-10-01&to=2026-10-26']) {
      const file = await getFile(world, seller.cookie, path)
      if (file.status !== 200) continue
      texts.push([path, readZip(file.bytes).map((item) => new TextDecoder().decode(item.bytes)).join('\n')])
    }
    expect(texts.length).toBeGreaterThan(0)
    texts.push(['backup', gunzipSync(await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())).toString('utf8')])
    const label = await client(world, seller.cookie).get('/api/days/2026-10-22/packing-label?buyer=UC_B')
    if (label.status === 200) texts.push(['packing-label', label.text])
    const outbox = await world.database.pglite?.query<{ body: string }>('select body from outbox')
    texts.push(['outbox', JSON.stringify(outbox?.rows ?? [])])
    for (const [where, text] of texts) {
      for (const word of ['노쇼 2번 조심', '입금 늦음 주의', '단골', 'regularCount', 'customer_memos', 'caution']) expect(text, `${where} ${word}`).not.toContain(word)
    }
  })
})

// ── AC-CRM1-07 봉인 날짜 ────────────────────────────────────────────────

describe('AC-CRM1-07 봉인 날짜 (적대)', () => {
  it('봉인된 날짜에서 합친 문자 구매자의 전화번호 키로 오늘 같은 번호 문자 손님이 이어진다. 봉인 날짜 범위는 조회로 바뀌지 않는다', async () => {
    const { world, seller: first } = await crmWorld(kst('2026-09-10', '09:00:00'))
    const d = await buy(world, first, '2026-09-10', 'UC_A', '다육이맘', 12_000)
    await ok(world, first, { type: 'product.register', b: d.b, no: 600, name: '문자', price: 8000 })
    const r1 = (await ok(world, first, { type: 'sms', b: d.b, no: 600, received: '20:00', phone: '010-5555-1234' })).body.buyer as string
    await ok(world, first, { type: 'buyer.merge', from: r1, into: 'UC_A', reason: '같은 사람' }, '2026-09-10')
    await payAll(world, first, '2026-09-10', 'UC_A')
    at(world, '2026-10-26', '12:00:00')
    const seller = { ...first, cookie: await login(world, first.loginId, first.password) }
    const c = crm(world, seller)
    expect(await world.server.sealer.runOnce()).toBe(1)
    const sealedBefore = JSON.stringify((await world.database.pglite?.query('select id, seq, ledger_digest from scopes order by id'))?.rows)
    at(world, '2026-10-26', '20:00:00')
    const b = (await createBroadcast(world, seller, { date: '2026-10-26' })).id
    await ok(world, seller, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    const r9 = (await ok(world, seller, { type: 'sms', b, no: 1, received: '20:00', phone: '010-5555-1234' })).body.buyer as string
    expect(await c.summary('2026-10-26', r9)).toMatchObject({ purchaseDays: 1, purchaseTotal: 20_000, lastPurchase: '2026-09-10' })
    expect(await c.summary('2026-09-10', r1)).toMatchObject({ purchaseDays: 1, purchaseTotal: 20_000 })
    const after = JSON.stringify((await world.database.pglite?.query(`select id, seq, ledger_digest from scopes where date = '2026-09-10' order by id`))?.rows)
    expect(sealedBefore).toContain(after.slice(1, -1))
  })
})

// ── AC-CRM1-30 동시 요청 ────────────────────────────────────────────────

describe('AC-CRM1-30 동시 요청이 섞여도 마지막 조회는 처음부터 센 값 (적대)', () => {
  it('날짜 6개 입금 쓰기와 손님 기록·모든 손님 조회를 한꺼번에 — 끝난 뒤 조회 = 모두 입금된 값', async () => {
    const { world, seller } = await crmWorld()
    const c = crm(world, seller)
    const dates = ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09', '2026-10-11']
    for (const date of dates) await buy(world, seller, date, 'UC_A', '다육이맘', 10_000)
    at(world, '2026-10-26', '12:00:00')
    expect(await c.summary('2026-10-11', 'UC_A')).toMatchObject({ unpaidDays: 6, purchaseDays: 0 })
    const totals = await Promise.all(dates.map(async (date) => ((await expectOk(client(world, seller.cookie).get(`/api/days/${date}`))).body.settlements as { total: number }[])[0]?.total as number))
    await Promise.all([
      ...dates.map((date, i) => writeEvent(world, seller, { type: 'settlement.payment', buyer: 'UC_A', date, amount: totals[i] }, date).then((response) => expect(response.status).toBe(200))),
      ...dates.map((date) => c.dayList(date)),
      c.list(),
      c.list('sort=unpaid'),
    ])
    expect(await c.summary('2026-10-11', 'UC_A')).toEqual({ purchaseDays: 6, purchaseTotal: 60_000, lastPurchase: '2026-10-11', unpaidDays: 0, lastUnpaid: null, cancels: 0, regular: true, caution: false })
    expect((await c.rows())[0]).toMatchObject({ purchaseDays: 6, purchaseTotal: 60_000, unpaidDays: 0 })
  })
})
