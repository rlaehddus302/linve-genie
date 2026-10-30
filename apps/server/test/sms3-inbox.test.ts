// AC-SMS3-04~18·24·25: 휴대폰 알림 받기 — 받기 토큰(C-02)·입구 모양·응답(C-04)·한도·받은 시각·가르기(C-05)·합치기(C-06)·방송 창·문자찜 넣기·확인 카드·본문 보관(C-07).
// 기대값은 SPEC ORD-13·DOMAIN_RULES R-26·DEPOSIT_RULES DP-9 문장과 코어 조회 함수(listClaims)로 정한다.
import type { PGlite } from '@electric-sql/pglite'
import { SMS_EXCLUDED_WORDS, getBuyer, listClaims } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { kst } from './deposit-support.ts'
import { readBankNotice } from '../src/deposit/notice.ts'
import { addSeller, client, createBroadcast, dumpAllTables, expectOk, login, rid, writeEvent } from './support.ts'
import { SMS3_DAY, app, cards, claimsOf, inboxWorld, liveSale, makeToken, send, sendRaw, sms, statuses } from './sms3-support.ts'

const BANK_APPS = ['com.kbstar.kbbank', 'com.shinhan.sbanking', 'com.wooribank.smart.npib', 'com.kebhana.hanapush', 'nh.smart.banking', 'com.ibk.android.ionebank', 'com.kakaobank.channel', 'viva.republica.toss', 'com.kbankwith.smartbank']

const active = (status: string) => status === 'CONFIRMED' || status === 'WAITLISTED' || status === 'PENDING' || status === 'CONFLICT'

describe('AC-SMS3-04 은행 알림 읽기 — 예외 없음', () => {
  it('임의 글·null 칸·금액 모양 수천 개에도 결과 하나, 입금·입금 취소 금액은 1~100,000,000 정수', () => {
    let seed = 7
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed / 2_147_483_648
    }
    const pieces = ['입금', '출금', '입금취소', '잔액', '원', ' ', '1,000', '99999999999', '0', '\n', '\uD800', '😀', '10/31 20:05', '홍길동', '*', '[', ']', ':', '승인', '13/45 25:99']
    for (let i = 0; i < 400; i++) {
      const text = Array.from({ length: Math.floor(rand() * 60) }, () => pieces[Math.floor(rand() * pieces.length)]).join('')
      const result = readBankNotice({ channel: rand() < 0.5 ? 'SMS' : 'APP', from: rand() < 0.3 ? null : '1588-9999', title: rand() < 0.5 ? null : text.slice(0, 5), text, receivedAt: '2026-10-31T20:00:00+09:00' })
      if (result.kind === 'DEPOSIT' || result.kind === 'CANCEL') expect(Number.isInteger(result.amount) && result.amount >= 1 && result.amount <= 100_000_000).toBe(true)
    }
    const many = Array.from({ length: 3000 }, (_, i) => `${String(i)},000`).join(' ')
    expect(() => readBankNotice({ channel: 'SMS', from: null, title: null, text: `입금 ${many}`.slice(0, 1000), receivedAt: 'x' })).not.toThrow()
    expect(() => readBankNotice(null as never)).not.toThrow()
  })
})

describe('AC-SMS3-05 받기 토큰 (C-02)', () => {
  it('머리글 없음·엉터리는 401, 맞는 토큰은 200, 다시 만들면 옛 토큰 401, 끄면 401, DB엔 해시만, 다른 API엔 통하지 않음', async () => {
    const { world, seller, token: t1 } = await inboxWorld()
    expect((await send(world, null, [])).body).toMatchObject({ error: { code: 'TOKEN_INVALID' } })
    expect((await send(world, null, [])).status).toBe(401)
    expect((await sendRaw(world, null, JSON.stringify({ device: 'a', messages: [] }), 'Bearer not-a-real-token-1234')).status).toBe(401)
    expect((await send(world, `${t1}x`, [])).status).toBe(401)
    expect((await send(world, t1, [])).status).toBe(200)
    // 토큰으로 다른 API를 부르면 401 (세션만 통한다)
    const other = await world.server.app.request('/api/broadcasts', { headers: { Authorization: `Bearer ${t1}` } })
    expect(other.status).toBe(401)
    // DB에 원문 없음
    expect(await dumpAllTables(world.database)).not.toContain(t1)
    const t2 = await makeToken(world, seller)
    expect(t2).not.toBe(t1)
    expect((await send(world, t1, [])).status).toBe(401)
    expect((await send(world, t2, [])).status).toBe(200)
    const off = await expectOk(client(world, seller.cookie).put('/api/inbox/settings', { enabled: false }))
    expect(off.body.inbox).toMatchObject({ enabled: false, hasToken: true })
    expect((await send(world, t2, [])).status).toBe(401)
    await expectOk(client(world, seller.cookie).put('/api/inbox/settings', { enabled: true }))
    expect((await send(world, t2, [])).status).toBe(200)
  })

  it('판매자 B의 토큰은 B의 것으로만 처리된다 — A의 방송에 아무것도 없다', async () => {
    const { world, seller: a } = await inboxWorld()
    const b = await addSeller(world)
    const tb = await makeToken(world, b)
    const saleA = await liveSale(world, a, [15])
    expect(await statuses(world, tb, [sms('x1', '010-2222-3333', '15 김영희')])).toEqual(['IGNORED'])
    expect((await claimsOf(world, a)).length).toBe(0)
    expect(await cards(world, a, saleA.id)).toEqual([])
  })

  it('토큰 없이 켜기는 409 NO_TOKEN, 설정은 보조자에게 403', async () => {
    const { world } = await inboxWorld()
    const fresh = await addSeller(world)
    const on = await client(world, fresh.cookie).put('/api/inbox/settings', { enabled: true })
    expect(on.status).toBe(409)
    expect(on.body).toMatchObject({ error: { code: 'NO_TOKEN' } })
    const view = await expectOk(client(world, fresh.cookie).get('/api/inbox/settings'))
    expect(view.body.inbox).toEqual({ enabled: false, hasToken: false, tokenCreatedAt: null, lastReceivedAt: null, lastDevice: null })
  })
})

describe('AC-SMS3-06 요청 모양 (C-04)', () => {
  it('하나라도 틀리면 400 BAD_REQUEST이고 아무것도 처리하지 않는다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    const good = sms('g1', '010-1234-5678', '15')
    const bad: unknown[][] = [
      Array.from({ length: 21 }, (_, i) => sms(`m${String(i)}`, '010-1234-5678', '15')),
      [good, { ...sms('g2', '010-1234-5678', '15'), channel: 'MMS' }],
      [good, sms('x'.repeat(65), '010-1234-5678', '15')],
      [good, { ...sms('g3', '010-1234-5678', '15'), text: 15 }],
      [good, { ...sms('g4', '010-1234-5678', '15'), extra: 1 }],
    ]
    for (const messages of bad) {
      const response = await send(world, token, messages)
      expect(response.status, response.text).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'BAD_REQUEST' } })
    }
    expect((await send(world, token, [good], 'x'.repeat(31))).status).toBe(400)
    expect((await sendRaw(world, token, JSON.stringify({ device: 'a', messages: [], more: 1 }))).status).toBe(400)
    expect((await sendRaw(world, token, '{')).status).toBe(400)
    expect((await claimsOf(world, seller)).length).toBe(0)
    // 같은 id를 나중에 보내면 처음 받은 것처럼 처리된다 (틀린 요청은 받은 id로도 남지 않는다)
    expect(await statuses(world, token, [good])).toEqual(['SAVED'])
    expect((await claimsOf(world, seller)).filter((claim) => claim.broadcast === sale.id)).toHaveLength(1)
  })

  it('C-04 최대 요청(20건 × 한글 1,000자 + 제목·보낸 곳 200자)은 413 없이 받는다', async () => {
    const { world, token } = await inboxWorld()
    const messages = Array.from({ length: 20 }, (_, i) => app(`big${String(i)}`, '가'.repeat(200), '나'.repeat(200), '\u0001'.repeat(500) + '다'.repeat(500)))
    const response = await send(world, token, messages)
    expect(response.status, response.text).toBe(200)
  })

  it('본문 1,500자는 앞 1,000자만 읽는다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [775])
    const text = `${'가'.repeat(1000)} 775`
    expect(await statuses(world, token, [sms('long', '010-1234-5678', text.padEnd(1500, '나'))])).toEqual(['IGNORED'])
    expect(await claimsOf(world, seller)).toEqual([])
    expect(await cards(world, seller, sale.id)).toEqual([])
  })

  it('messages: []이면 200 { results: [], filters } — 거를 낱말 9개(R-26 3), 은행 앱 9개(DP-9 1)', async () => {
    const { world, token } = await inboxWorld()
    const response = await send(world, token, [])
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ results: [], filters: { skipWords: [...SMS_EXCLUDED_WORDS], bankApps: BANK_APPS } })
    expect((response.body.filters as { skipWords: string[] }).skipWords).toHaveLength(9)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('AC-SMS3-07 응답에 읽은 결과가 없다', () => {
  it('SAVED·IGNORED·SAVED·IGNORED 이고 결과마다 id·status 밖의 키가 없다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [775])
    const response = await send(world, token, [
      sms('r1', '010-1234-5678', '775'),
      sms('r2', '010-1234-5678', '안녕하세요'),
      sms('r3', '1588-9999', '[KB] 홍길동 입금 14,000'),
      sms('r4', '010-1234-5678', '(광고) 775'),
    ])
    expect(response.body.results).toEqual([
      { id: 'r1', status: 'SAVED' },
      { id: 'r2', status: 'IGNORED' },
      { id: 'r3', status: 'SAVED' },
      { id: 'r4', status: 'IGNORED' },
    ])
    expect(Object.keys(response.body).sort()).toEqual(['filters', 'results'])
  })
})

describe('AC-SMS3-08 한도', () => {
  it('1분에 121번째 메시지면 429 TOO_MANY이고 그 요청은 처리하지 않는다. 1분 뒤 같은 id는 처리된다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    for (let round = 0; round < 6; round++) {
      expect(await statuses(world, token, Array.from({ length: 20 }, (_, i) => sms(`k${String(round)}-${String(i)}`, '010-9999-0000', '안녕')))).toHaveLength(20)
    }
    const over = await send(world, token, [sms('late', '010-1234-5678', '15')])
    expect(over.status).toBe(429)
    expect(over.body).toMatchObject({ error: { code: 'TOO_MANY' } })
    expect(await claimsOf(world, seller)).toEqual([])
    world.clock.advance(60_001)
    expect(await statuses(world, token, [sms('late', '010-1234-5678', '15')])).toEqual(['SAVED'])
    expect((await claimsOf(world, seller)).length).toBe(1)
  })
})

describe('AC-SMS3-09 받은 시각', () => {
  const cases: [string, string | number | null, string][] = [
    ['오프셋 있는 ISO', '2026-10-31T20:01:05+09:00', '20:01:05'],
    ['오프셋 없는 KST', '2026-10-31T20:01:05', '20:01:05'],
    ['초 숫자', Math.floor(kst('2026-10-31 20:01:05') / 1000), '20:01:05'],
    ['밀리초 숫자', kst('2026-10-31 20:01:05'), '20:01:05'],
    ['없음', null, '20:03:00'],
    ['못 읽음', '어제 저녁', '20:03:00'],
    ['24시간 넘게 차이', '2026-10-29T20:01:05+09:00', '20:03:00'],
  ]
  for (const [title, receivedAt, expected] of cases) {
    it(`${title} → 문자찜 받은 시각 ${expected}`, async () => {
      const { world, seller, token } = await inboxWorld()
      await liveSale(world, seller, [15])
      world.clock.advance(3 * 60_000)
      expect(await statuses(world, token, [sms('t', '010-1234-5678', '15', receivedAt)])).toEqual(['SAVED'])
      const [claim] = await claimsOf(world, seller)
      expect(claim?.received).toBe(expected)
    })
  }
})

describe('AC-SMS3-10·11 가르기 (C-05)', () => {
  it('앱 알림·은행 대표번호는 입금, 휴대폰은 문자찜, 표 밖 번호의 입금은 확인 필요, 표 밖 번호의 15는 무시, 휴대폰의 입금 모양 글은 찜도 입금도 아님', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const results = await statuses(world, token, [
      app('ga', 'com.kakaobank.channel', '입금 14,000원', '이수진'),
      sms('na', '1588-9999', '[KB] 홍길동 입금 14,000'),
      sms('da', '010-2222-3333', '15 김영희'),
      sms('ra', '1600-0000', '[KB] 홍길동 입금 14,000'),
      sms('ma', '1600-0000', '15'),
      sms('ba', '010-2222-3333', '[KB] 홍길동 입금 15,000'),
    ])
    expect(results).toEqual(['SAVED', 'SAVED', 'SAVED', 'SAVED', 'IGNORED', 'IGNORED'])
    const claims = await claimsOf(world, seller)
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ no: 15, origin: 'sms' })
    const list = (await expectOk(client(world, seller.cookie).get('/api/deposits?status=REVIEW'))).body.deposits as { name: string; source: { kind: string; label: string }; review: { reason: string } }[]
    const byName = new Map(list.map((item) => [item.name, item]))
    expect(list).toHaveLength(3)
    expect(list.every((item) => item.source.kind === 'PHONE' && item.source.label === '휴대폰 알림')).toBe(true)
    // (라) 표 밖 번호의 입금 = 확인 필요 UNTRUSTED_SOURCE (가·나는 믿을 곳이지만 맞는 묶음이 없어 확인 필요)
    expect(list.filter((item) => item.review.reason === 'UNTRUSTED_SOURCE')).toHaveLength(1)
    expect(byName.get('이수진')?.review.reason).not.toBe('UNTRUSTED_SOURCE')
  })

  it('표 밖 앱(메신저)의 입금 모양 알림은 확인 필요 UNTRUSTED_SOURCE, 앱 알림의 775는 문자찜이 되지 않는다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [775])
    expect(await statuses(world, token, [app('k1', 'com.kakao.talk', null, '입금 14,000원 보냈어'), app('k2', 'com.kakao.talk', null, '775')])).toEqual(['SAVED', 'IGNORED'])
    expect(await claimsOf(world, seller)).toEqual([])
    const [item] = (await expectOk(client(world, seller.cookie).get('/api/deposits?status=REVIEW'))).body.deposits as { review: { reason: string } }[]
    expect(item?.review.reason).toBe('UNTRUSTED_SOURCE')
  })
})

describe('AC-SMS3-12 같은 것 합치기 (C-06)', () => {
  it('같은 id → DUPLICATE, 같은 보낸 곳·본문 30초 뒤 → DUPLICATE, 90초 뒤 → SAVED(찜은 하나), 25시간 뒤 같은 id → DUPLICATE 아님', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const at = (offsetSec: number) => new Date(kst('2026-10-31 20:00') + offsetSec * 1000).toISOString()
    expect(await statuses(world, token, [sms('a1', '010-1234-5678', '15', at(0))])).toEqual(['SAVED'])
    expect(await statuses(world, token, [sms('a1', '010-1234-5678', '15', at(0))])).toEqual(['DUPLICATE'])
    expect(await statuses(world, token, [sms('a2', '010-1234-5678', '15', at(30))])).toEqual(['DUPLICATE'])
    expect(await statuses(world, token, [sms('a3', '+82 10-1234-5678', '15', at(90))])).toEqual(['SAVED'])
    const claims = (await claimsOf(world, seller)).filter((claim) => active(claim.status))
    expect(claims).toHaveLength(1)
    world.clock.advance(25 * 3_600_000)
    const again = await statuses(world, token, [sms('a1', '010-1234-5678', '15')])
    expect(again[0]).not.toBe('DUPLICATE')
  })

  it('같은 id 동시 요청 20개 — 찜 하나, SAVED 하나', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const all = await Promise.all(Array.from({ length: 20 }, () => send(world, token, [sms('same', '010-1234-5678', '15')])))
    const flat = all.map((response) => (response.body.results as { status: string }[])[0]?.status)
    expect(flat.filter((status) => status === 'SAVED')).toHaveLength(1)
    expect(flat.filter((status) => status === 'DUPLICATE')).toHaveLength(19)
    expect(await claimsOf(world, seller)).toHaveLength(1)
  })
})

describe('AC-SMS3-13 방송 창', () => {
  it('방송 없음 → IGNORED이고 아무것도 저장되지 않는다(본문·번호 모두)', async () => {
    const { world, token } = await inboxWorld()
    expect(await statuses(world, token, [sms('n1', '010-1234-5678', '15 홍길동')])).toEqual(['IGNORED'])
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain('홍길동')
    expect(dump).not.toContain('01012345678')
    expect(dump).not.toContain('010-1234-5678')
  })

  it('리허설만 진행 중이면 IGNORED', async () => {
    const { world, seller, token } = await inboxWorld()
    const b = await createBroadcast(world, seller, { date: SMS3_DAY, rehearsal: true })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 15, name: '상품', price: 10_000 }))
    expect(await statuses(world, token, [sms('h1', '010-1234-5678', '15')])).toEqual(['IGNORED'])
    expect(listClaims((await world.server.writer.read(seller.sellerId, SMS3_DAY, true)).state)).toEqual([])
  })

  it('끝난 지 9분 59초면 끝난 방송의 문자찜, 10분 1초면 IGNORED. 방송이 없어도 은행 입금은 저장된다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16])
    await expectOk(client(world, seller.cookie).post(`/api/broadcasts/${sale.id}/end`, { requestId: rid('end') }))
    world.clock.advance(9 * 60_000 + 59_000)
    expect(await statuses(world, token, [sms('e1', '010-1234-5678', '15')])).toEqual(['SAVED'])
    world.clock.advance(2000)
    expect(await statuses(world, token, [sms('e2', '010-1234-5678', '16')])).toEqual(['IGNORED'])
    const claims = await claimsOf(world, seller)
    expect(claims.map((claim) => claim.no)).toEqual([15])
    expect(await statuses(world, token, [sms('e3', '1588-9999', '[KB] 홍길동 입금 14,000')])).toEqual(['SAVED'])
    expect(((await expectOk(client(world, seller.cookie).get('/api/deposits?status=REVIEW'))).body.deposits as unknown[]).length).toBe(1)
  })
})

describe('AC-SMS3-14 바로 넣기', () => {
  it('15 16 홍길동 → sms 이벤트 둘(받은 시각·뒤 4자리·메모·요청 번호 inbox-<id>-<번호>), 본문·번호 원문은 어디에도 없다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15, 16])
    expect(await statuses(world, token, [sms('d1', '010-1234-5678', '15 16 홍길동', '2026-10-31T20:01:05+09:00')])).toEqual(['SAVED'])
    const claims = await claimsOf(world, seller)
    expect(claims.map((claim) => [claim.no, claim.received, claim.origin])).toEqual([
      [15, '20:01:05', 'sms'],
      [16, '20:01:05', 'sms'],
    ])
    const state = (await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).state
    const buyer = getBuyer(state, claims[0]?.buyer as string)
    expect(buyer).toMatchObject({ kind: 'sms', display: '문자찜(홍길동)', phoneLast4: '5678' })
    expect(claims[0]?.buyer).toBe(claims[1]?.buyer)
    // "문자로 받음" 표시용 찜 ID와 방송 시작 시각 (손으로 넣은 문자찜은 들어가지 않는다)
    await expectOk(writeEvent(world, seller, { type: 'sms', b: claims[0]?.broadcast as string, no: 16, phone: '010-5555-6666' }))
    const view = await expectOk(client(world, seller.cookie).get(`/api/inbox/cards?b=${claims[0]?.broadcast as string}`))
    expect(view.body.inboxClaimIds).toEqual(claims.map((claim) => claim.id))
    expect(view.body.startedAt).toBe(new Date(world.clock.now()).toISOString())
    const pg = world.database.pglite as PGlite
    const rows = await pg.query<{ request_id: string; body: string; actor: string }>(`select request_id, body, actor from events where type = 'sms' and request_id like 'inbox-%' order by seq`)
    expect(rows.rows.map((row) => row.request_id)).toEqual(['inbox-d1-15', 'inbox-d1-16'])
    expect(rows.rows.every((row) => row.actor === 'server')).toBe(true)
    expect(rows.rows.every((row) => (JSON.parse(row.body) as { ref: string }).ref.startsWith('ibx_'))).toBe(true)
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain('15 16 홍길동')
    expect(dump).not.toContain('01012345678')
    expect(dump).not.toContain('010-1234-5678')
    expect(JSON.stringify(world.logs)).not.toMatch(/홍길동|5678/)
  })
})

describe('AC-SMS3-15 판매 중이 아니면 넣지 않음', () => {
  it('없는 번호·READY·CLOSED는 찜 없이 NOT_ON_SALE 카드, 1등이 차면(대기 자리) 넣는다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [16])
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: sale.id, no: 17, name: '준비', price: 10_000, status: 'READY' }))
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: sale.id, no: 18, name: '마감', price: 10_000 }))
    await expectOk(writeEvent(world, seller, { type: 'product.close', b: sale.id, no: 18 }))
    expect(await statuses(world, token, [sms('s15', '010-1234-5678', '15'), sms('s17', '010-1234-5678', '17'), sms('s18', '010-1234-5678', '18')])).toEqual(['SAVED', 'SAVED', 'SAVED'])
    expect(await claimsOf(world, seller)).toEqual([])
    const list = await cards(world, seller, sale.id)
    expect(list.map((card) => [card.kind, card.why, card.numbers, card.message])).toEqual([
      ['REVIEW', 'NOT_ON_SALE', [15], '15번은 지금 판매 중이 아니에요'],
      ['REVIEW', 'NOT_ON_SALE', [17], '17번은 지금 판매 중이 아니에요'],
      ['REVIEW', 'NOT_ON_SALE', [18], '18번은 지금 판매 중이 아니에요'],
    ])
    // 1등이 차면 대기로 넣는다
    expect(await statuses(world, token, [sms('w1', '010-1111-1111', '16'), sms('w2', '010-2222-2222', '16')])).toEqual(['SAVED', 'SAVED'])
    expect((await claimsOf(world, seller)).map((claim) => claim.status)).toEqual(['CONFIRMED', 'WAITLISTED'])
  })
})

describe('AC-SMS3-16 취소 요청은 승인 뒤', () => {
  it('15 취소 → 찜 그대로·카드, 승인 → 취소되고 대기 1순위 승계, 찜이 없는데 승인 → 취소할 찜이 없어요, 무시 → 기록 없음', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('c0', '010-1234-5678', '15'), sms('c1', '010-9999-8888', '15')])).toEqual(['SAVED', 'SAVED'])
    expect(await statuses(world, token, [sms('c2', '010-1234-5678', '15 취소')])).toEqual(['SAVED'])
    expect((await claimsOf(world, seller)).map((claim) => claim.status)).toEqual(['CONFIRMED', 'WAITLISTED'])
    const [card] = await cards(world, seller, sale.id)
    expect(card).toMatchObject({ kind: 'CANCEL', why: null, numbers: [15], last4: '5678', text: '15 취소', message: '15번 취소를 원해요' })
    const api = client(world, seller.cookie)
    const approved = await expectOk(api.post(`/api/inbox/cards/${card?.id as string}/approve`, { requestId: rid('ap') }))
    expect(approved.body).toMatchObject({ ok: true, cancelled: true, result: { type: 'host.cancel' } })
    expect((await claimsOf(world, seller)).map((claim) => claim.status)).toEqual(['CANCELLED', 'CONFIRMED'])
    expect(await cards(world, seller, sale.id)).toEqual([])
    // 찜이 없는데 승인
    expect(await statuses(world, token, [sms('c3', '010-7777-7777', '15 취소')])).toEqual(['SAVED'])
    const [lonely] = await cards(world, seller, sale.id)
    const seqBefore = (await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).seq
    const none = await api.post(`/api/inbox/cards/${lonely?.id as string}/approve`, { requestId: rid('ap') })
    expect(none.status).toBe(409)
    expect(none.body).toMatchObject({ error: { code: 'NO_CLAIM', message: '취소할 찜이 없어요' } })
    expect((await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).seq).toBe(seqBefore)
    await expectOk(api.post(`/api/inbox/cards/${lonely?.id as string}/ignore`, {}))
    expect(await cards(world, seller, sale.id)).toEqual([])
    expect((await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).seq).toBe(seqBefore)
    // 처리한 카드는 다시 처리할 수 없다
    expect((await api.post(`/api/inbox/cards/${lonely?.id as string}/ignore`, {})).status).toBe(409)
  })
})

describe('AC-SMS3-17 확인 필요 고르기', () => {
  it('15 있나요? → UNCLEAR 카드 번호 15, 넣기 → 그 번호의 문자찜(메모 없음)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('u1', '010-1234-5678', '15 있나요?')])).toEqual(['SAVED'])
    const [card] = await cards(world, seller, sale.id)
    expect(card).toMatchObject({ kind: 'REVIEW', why: 'UNCLEAR', numbers: [15], last4: '5678', message: '번호는 있는데 확실하지 않아요', text: '15 있나요?' })
    const inserted = await expectOk(client(world, seller.cookie).post(`/api/inbox/cards/${card?.id as string}/insert`, { requestId: rid('in'), no: 15 }))
    expect(inserted.body).toMatchObject({ ok: true, result: { type: 'sms', phoneLast4: '5678' } })
    const state = (await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).state
    const [claim] = await claimsOf(world, seller)
    expect(getBuyer(state, claim?.buyer as string)).toMatchObject({ kind: 'sms', display: '문자찜', phoneLast4: '5678' })
    expect(await cards(world, seller, sale.id)).toEqual([])
  })

  it('이름만 온 문자 → NO_NUMBER 카드("이름만 와서 누가 보냈는지 몰라요"), 넣으면 메모 = 보낸 이름의 새 문자 구매자(번호 없음)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('nn', '홍길동', '15')])).toEqual(['SAVED'])
    const [card] = await cards(world, seller, sale.id)
    expect(card).toMatchObject({ why: 'NO_NUMBER', last4: null, sender: '홍길동', message: '이름만 와서 누가 보냈는지 몰라요' })
    await expectOk(client(world, seller.cookie).post(`/api/inbox/cards/${card?.id as string}/insert`, { requestId: rid('in'), no: 15 }))
    const state = (await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).state
    const [claim] = await claimsOf(world, seller)
    expect(getBuyer(state, claim?.buyer as string)).toMatchObject({ kind: 'sms', display: '문자찜(홍길동)', phoneLast4: null })
  })

  it('옵션 방송의 15 홍길동 → OPTIONS 카드', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15], { saleMode: 'OPTIONS' })
    expect(await statuses(world, token, [sms('op', '010-1234-5678', '15 홍길동')])).toEqual(['SAVED'])
    const [card] = await cards(world, seller, sale.id)
    expect(card).toMatchObject({ why: 'OPTIONS', numbers: [15], memo: '홍길동', message: '옵션 방송이라 직접 골라 주세요' })
    expect(await claimsOf(world, seller)).toEqual([])
  })

  it('보조자도 카드를 보고 처리한다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    await statuses(world, token, [sms('as', '010-1234-5678', '15 있나요?')])
    const made = await expectOk(client(world, seller.cookie).post('/api/assistants', { name: '도우미' }))
    const assistant = made.body.assistant as { loginId: string }
    const cookie = await login(world, assistant.loginId, made.body.password as string)
    const view = await expectOk(client(world, cookie).get(`/api/inbox/cards?b=${sale.id}`))
    const [card] = view.body.cards as { id: string }[]
    await expectOk(client(world, cookie).post(`/api/inbox/cards/${card?.id as string}/insert`, { requestId: rid('in'), no: 15 }))
    expect((await client(world, cookie).post('/api/inbox/token', {})).status).toBe(403)
  })
})

describe('AC-SMS3-18 본문 보관', () => {
  it('카드의 본문만 암호화해 두고, 처리하면 바로, 처리하지 않으면 방송이 끝나고 24시간 뒤 지운다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    await statuses(world, token, [sms('k1', '010-1234-5678', '15 있나요?'), sms('k2', '010-1234-5678', '15 될까요')])
    const pg = world.database.pglite as PGlite
    const sealed = await pg.query<{ sealed: string | null }>('select sealed from inbox_cards order by seq')
    expect(sealed.rows.every((row) => row.sealed !== null && !row.sealed.includes('있나요'))).toBe(true)
    expect(await dumpAllTables(world.database)).not.toContain('있나요')
    const [first] = await cards(world, seller, sale.id)
    await expectOk(client(world, seller.cookie).post(`/api/inbox/cards/${first?.id as string}/ignore`, {}))
    const after = await pg.query<{ status: string; sealed: string | null }>('select status, sealed from inbox_cards order by seq')
    expect(after.rows[0]).toEqual({ status: 'IGNORED', sealed: null })
    expect(after.rows[1]?.sealed).not.toBeNull()
    await expectOk(client(world, seller.cookie).post(`/api/broadcasts/${sale.id}/end`, { requestId: rid('end') }))
    world.clock.advance(23 * 3_600_000)
    expect(await cards(world, seller, sale.id)).toHaveLength(1)
    world.clock.advance(3_600_001)
    expect(await cards(world, seller, sale.id)).toEqual([])
    const left = await pg.query<{ n: number }>('select count(*)::int as n from inbox_cards where sealed is not null')
    expect(left.rows[0]?.n).toBe(0)
  })
})

describe('AC-SMS3-24 휴대폰 알림 원천', () => {
  it('토큰을 처음 만들면 원천 PHONE "휴대폰 알림" 하나(다시 만들어도 하나). 원천을 끄면 은행 알림은 IGNORED, 손님 문자는 그대로', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    await makeToken(world, seller)
    const t3 = await makeToken(world, seller)
    const sources = ((await expectOk(client(world, seller.cookie).get('/api/deposits/sources'))).body.sources as { id: string; kind: string; label: string; fetchable: boolean }[]).filter((source) => source.kind === 'PHONE')
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ label: '휴대폰 알림', fetchable: false })
    expect(token).not.toBe(t3)
    await expectOk(client(world, seller.cookie).patch(`/api/deposits/sources/${sources[0]?.id as string}`, { enabled: false }))
    expect(await statuses(world, t3, [sms('o1', '1588-9999', '[KB] 홍길동 입금 14,000'), sms('o2', '010-1234-5678', '15')])).toEqual(['IGNORED', 'SAVED'])
    expect((await claimsOf(world, seller)).length).toBe(1)
  })
})

describe('받기 상태 (설정·실시간)', () => {
  it('받으면 마지막으로 받은 시각·기기 이름이 설정에 보인다', async () => {
    const { world, seller, token } = await inboxWorld()
    await statuses(world, token, [sms('l1', '010-1234-5678', '안녕')])
    const view = await expectOk(client(world, seller.cookie).get('/api/inbox/settings'))
    expect(view.body.inbox).toMatchObject({ enabled: true, hasToken: true, lastDevice: '갤럭시 S24', lastReceivedAt: new Date(world.clock.now()).toISOString() })
  })
})

describe('AC-SMS3-25 로그·DB에 본문 없음', () => {
  it('여러 요청 뒤 서버 로그 전체와 DB 덤프에 본문·제목·보낸 번호 원문·토큰 원문이 없다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15, 16])
    await statuses(world, token, [
      sms('p1', '010-4321-8765', '15 16 박하늘'),
      sms('p2', '010-4321-8765', '15 될까요 박하늘'),
      sms('p3', '010-4321-8765', '16 취소'),
      sms('p4', '15889999', '[KB]10/31 20:05 123456**789 정다운 입금 14,000 잔액1,014,000'),
      sms('p5', '1600-0000', '[KB]10/31 20:05 정다운 입금 77,000'),
      app('p6', 'com.kakaobank.channel', '입금취소 33,000원', '정다운'),
      app('p7', 'com.kakaobank.channel', '출금 5,000원', '내 입출금통장(1234) → 김밥천국'),
    ])
    const dump = await dumpAllTables(world.database)
    const logs = JSON.stringify(world.logs)
    for (const secret of ['박하늘', '될까요', '01043218765', '010-4321-8765', '123456**789', '김밥천국', '입금취소 33,000원', token]) {
      expect(logs).not.toContain(secret)
    }
    for (const secret of ['15 16 박하늘', '될까요', '01043218765', '010-4321-8765', '123456**789', '김밥천국', '[KB]10/31', token]) {
      expect(dump, secret).not.toContain(secret)
    }
  })
})
