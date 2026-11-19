// AC-SMS3-04~18·24·25: 휴대폰 알림 받기 — 받기 토큰(C-02)·입구 모양·응답(C-04)·한도·받은 시각·가르기(C-05)·합치기(C-06)·방송 창·문자찜 넣기·확인 카드·본문 보관(C-07).
// 기대값은 SPEC ORD-13·DOMAIN_RULES R-26·DEPOSIT_RULES DP-9 문장과 코어 조회 함수(listClaims)로 정한다.
import type { PGlite } from '@electric-sql/pglite'
import { SMS_EXCLUDED_WORDS, getBuyer, listClaims } from '@livejjim/core'
import { describe, expect, it, vi } from 'vitest'
import { kst } from './deposit-support.ts'
import { readBankNotice } from '../src/deposit/notice.ts'
import { addSeller, client, createBroadcast, dumpAllTables, expectOk, fakeClock, newWorld, rid, writeEvent } from './support.ts'
import { SMS3_DAY, SMS3_T0, app, cards, claimsOf, inboxWorld, liveSale, makeToken, send, sendRaw, sms, statuses } from './sms3-support.ts'

/** DP-9 1 표의 대표번호 16개, 숫자만 (C-04 filters.bankNumbers, D-SMS3-26) */
const BANK_NUMBERS = ['15889999', '16449999', '15999999', '15778000', '15998000', '15885000', '15995000', '15881111', '15991111', '16613000', '15882100', '15662566', '15882588', '15993333', '16617654', '15221000']
const BANK_APPS = ['com.kbstar.kbbank', 'com.shinhan.sbanking', 'com.wooribank.smart.npib', 'com.kebhana.hanapush', 'nh.smart.banking', 'com.nonghyup.nhallonebank', 'com.nh.cashcardapp', 'com.ibk.android.ionebank', 'com.kakaobank.channel', 'viva.republica.toss', 'com.kbankwith.smartbank', 'com.scbank.ma30', 'com.smg.spbs', 'com.epost.psf.sdsi'] // D-DEP2-18: NH 앱 둘·SC제일·새마을금고·우체국 더함

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
  // D-SMS3-27: 끄면 403 INBOX_OFF(토큰은 그대로) — 예전 시험은 끄면 401을 기대했다
  it('머리글 없음·엉터리는 401, 맞는 토큰은 200, 다시 만들면 옛 토큰 401, 끄면 403 INBOX_OFF(토큰 그대로), DB엔 해시만, 다른 API엔 통하지 않음', async () => {
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
    const offResponse = await send(world, t2, [])
    expect(offResponse.status).toBe(403)
    expect(offResponse.body).toMatchObject({ error: { code: 'INBOX_OFF' } })
    // 꺼져 있어도 옛 토큰·엉터리 토큰은 401 (401 → 403 순서)
    expect((await send(world, t1, [])).status).toBe(401)
    // 꺼진 동안 보낸 것은 처리하지 않는다 (본문이 커도 403 — 413보다 먼저)
    await liveSale(world, seller, [15])
    expect((await send(world, t2, [sms('off1', '010-1234-5678', '15')])).status).toBe(403)
    expect((await sendRaw(world, t2, 'x'.repeat(300 * 1024))).status).toBe(403)
    expect(await claimsOf(world, seller)).toEqual([])
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

  it('토큰 없이 켜기는 409 NO_TOKEN', async () => {
    const { world } = await inboxWorld()
    const fresh = await addSeller(world)
    const on = await client(world, fresh.cookie).put('/api/inbox/settings', { enabled: true })
    expect(on.status).toBe(409)
    expect(on.body).toMatchObject({ error: { code: 'NO_TOKEN' } })
    const view = await expectOk(client(world, fresh.cookie).get('/api/inbox/settings'))
    expect(view.body.inbox).toEqual({ enabled: false, hasToken: false, tokenCreatedAt: null, lastReceivedAt: null, lastDevice: null, staleBroadcast: null })
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

  it('messages: []이면 200 { results: [], filters } — 거를 낱말 9개(R-26 3), 은행 앱 9개(DP-9 1), 은행 대표번호 16개(D-SMS3-26)', async () => {
    const { world, token } = await inboxWorld()
    const response = await send(world, token, [])
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ results: [], filters: { skipWords: [...SMS_EXCLUDED_WORDS], bankApps: BANK_APPS, bankNumbers: BANK_NUMBERS } })
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
  // D-SMS3-28: 한도 1분 600건 (예전 120건)
  it('1분에 601번째 메시지면 429 TOO_MANY이고 그 요청은 처리하지 않는다. 1분 뒤 같은 id는 처리된다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    for (let round = 0; round < 30; round++) {
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
    // D-SMS3-30: 서버 도착보다 늦은 받은 시각은 서버 도착 시각
    ['서버 도착보다 늦음', '2026-10-31T20:05:00+09:00', '20:03:00'],
    // 24시간 넘게 지난 받은 시각은 이제 늦게 온 문자(LATE 카드 — 아래 AC-SMS3-09·13 늦게 온 문자, D-SMS3-30)
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

describe('AC-SMS3-09·13 늦게 온 문자 (D-SMS3-30)', () => {
  it('방송 시작 전 받은 문자·서버 도착보다 10분 넘게 이른 문자·이틀 전 문자 → 찜 없이 LATE 카드, 넣으면 받은 시각 = 서버 도착. 10분 안이면 바로 넣는다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16, 17, 18])
    world.clock.advance(5000)
    // 20:00:05에 19:59:50 받은 15 (방송 시작 20:00:00보다 이름)
    expect(await statuses(world, token, [sms('l1', '010-1111-2222', '15', '2026-10-31T19:59:50+09:00')])).toEqual(['SAVED'])
    world.clock.advance(20 * 60_000 - 4000)
    // 20:20:01에 20:10:00 받은 16 (10분 1초 이름)
    expect(await statuses(world, token, [sms('l2', '010-1111-3333', '16', '2026-10-31T20:10:00+09:00')])).toEqual(['SAVED'])
    // 이틀 전 받은 17 (24시간 넘게 지나도 원래 값으로 본다)
    expect(await statuses(world, token, [sms('l3', '010-1111-4444', '17', '2026-10-29T20:01:05+09:00')])).toEqual(['SAVED'])
    expect(await claimsOf(world, seller)).toEqual([])
    const list = await cards(world, seller, sale.id)
    expect(list.map((card) => [card.why, card.numbers, card.message, card.receivedAt, (card as unknown as { late: boolean }).late])).toEqual([
      ['LATE', [17], '늦게 온 문자예요 (휴대폰이 10월 29일 20:01:05에 받음). 넣으면 지금 받은 순서로 들어가요', new Date(kst('2026-10-29 20:01') + 5000).toISOString(), true],
      ['LATE', [15], '늦게 온 문자예요 (휴대폰이 10월 31일 19:59:50에 받음). 넣으면 지금 받은 순서로 들어가요', new Date(kst('2026-10-31 19:59') + 50_000).toISOString(), true],
      ['LATE', [16], '늦게 온 문자예요 (휴대폰이 10월 31일 20:10:00에 받음). 넣으면 지금 받은 순서로 들어가요', new Date(kst('2026-10-31 20:10')).toISOString(), true],
    ])
    expect(list.every((card) => card.kind === 'REVIEW' && (card as unknown as { arrivedAt: string }).arrivedAt.length > 0)).toBe(true)
    // 넣기: 받은 시각 = 서버 도착 (15 카드는 20:00:05에 왔다)
    const c15 = list.find((card) => card.numbers[0] === 15) as { id: string }
    await expectOk(client(world, seller.cookie).post(`/api/inbox/cards/${c15.id}/insert`, { requestId: rid('l1'), no: 15 }))
    expect((await claimsOf(world, seller)).map((claim) => [claim.no, claim.received])).toEqual([[15, '20:00:05']])
    // 20:19:59에 20:10:00 받은 18이 오면(9분 59초) 바로 넣는다 — 받은 시각 20:10:00
    world.clock.set(kst('2026-10-31 20:19') + 59_000)
    expect(await statuses(world, token, [sms('l4', '010-1111-5555', '18', '2026-10-31T20:10:00+09:00')])).toEqual(['SAVED'])
    expect((await claimsOf(world, seller)).find((claim) => claim.no === 18)?.received).toBe('20:10:00')
  })

  it('늦게 온 문자의 다른 확인 필요(UNCLEAR)도 넣으면 서버 도착 시각, 취소 요청은 늦어도 그대로', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16])
    world.clock.advance(30 * 60_000)
    expect(await statuses(world, token, [sms('u1', '010-1111-2222', '15 있나요?', '2026-10-31T20:01:00+09:00'), sms('u2', '010-1111-3333', '15 취소', '2026-10-31T20:02:00+09:00')])).toEqual(['SAVED', 'SAVED'])
    const list = await cards(world, seller, sale.id)
    const review = list.find((card) => card.kind === 'REVIEW') as unknown as { id: string; why: string; late: boolean; numbers: number[] } | undefined
    const cancel = list.find((card) => card.kind === 'CANCEL') as unknown as { late: boolean; receivedAt: string } | undefined
    expect(review?.late).toBe(true)
    expect(review?.why).not.toBe('LATE')
    expect(cancel?.late).toBe(false)
    await expectOk(client(world, seller.cookie).post(`/api/inbox/cards/${review?.id as string}/insert`, { requestId: rid('u1'), no: review?.numbers[0] as number }))
    expect((await claimsOf(world, seller)).map((claim) => claim.received)).toEqual(['20:30:00'])
  })
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
    // D-SMS3-30: 서버 도착보다 늦은 받은 시각은 서버 도착 시각이 되므로, 받은 시각들이 모두 지난 시각이 되게(10분 안) 서버 시계를 2분 뒤로
    world.clock.advance(2 * 60_000)
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
    const sale = await liveSale(world, seller, [15, 16])
    // D-SMS3-30: 받은 시각 20:01:05가 서버 도착보다 늦지 않게 서버 시계를 20:02로 (늦으면 서버 도착 시각이 된다)
    world.clock.advance(2 * 60_000)
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
    expect(view.body.startedAt).toBe(new Date(world.clock.now() - 2 * 60_000).toISOString())
    expect(sale.id).toBe(claims[0]?.broadcast)
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

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 시험 "보조자도 카드를 보고 처리한다"를 뺐다
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

describe('SMS3 고치기 — 카드 원자 처리·같은 문자 표지·이름만 취소·주기 정리', () => {
  it('이름만 온 "15 취소" 카드는 canApprove false, 승인하면 409 NAME_ONLY·쉬운 문장·기록 없음, 카드는 무시로 닫는다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('own', '010-1234-5678', '15'), sms('nm', '홍길동', '15 취소'), sms('ph', '010-1234-5678', '15 취소')])).toEqual(['SAVED', 'SAVED', 'SAVED'])
    const list = (await expectOk(client(world, seller.cookie).get(`/api/inbox/cards?b=${sale.id}`))).body.cards as { id: string; last4: string | null; canApprove: boolean }[]
    expect(list.map((card) => [card.last4, card.canApprove])).toEqual([
      [null, false],
      ['5678', true],
    ])
    const seq = (await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).seq
    const api = client(world, seller.cookie)
    const refused = await api.post(`/api/inbox/cards/${list[0]?.id as string}/approve`, { requestId: rid('ap') })
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ error: { code: 'NAME_ONLY', message: '이름만 와서 누가 보냈는지 몰라요. 보드에서 직접 취소해 주세요' } })
    expect((await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).seq).toBe(seq)
    await expectOk(api.post(`/api/inbox/cards/${list[0]?.id as string}/ignore`, {}))
    expect((await cards(world, seller, sale.id)).map((card) => card.last4)).toEqual(['5678'])
  })

  it('넣기가 판매 중 아님으로 거절되면 카드는 처리 안 한 채로 남아 다시 넣을 수 있다 (잡은 카드를 놓는다)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('u', '010-1234-5678', '15 16 있나요?')])).toEqual(['SAVED'])
    const [card] = await cards(world, seller, sale.id)
    const api = client(world, seller.cookie)
    const refused = await api.post(`/api/inbox/cards/${card?.id as string}/insert`, { requestId: rid('in'), no: 16 })
    expect(refused.status).toBe(409)
    expect(await cards(world, seller, sale.id)).toHaveLength(1)
    await expectOk(api.post(`/api/inbox/cards/${card?.id as string}/insert`, { requestId: rid('in'), no: 15 }))
    expect(await cards(world, seller, sale.id)).toEqual([])
    expect((await api.post(`/api/inbox/cards/${card?.id as string}/insert`, { requestId: rid('in'), no: 15 })).status).toBe(409)
  })

  it('찜이 아닌 문자(IGNORED)는 같은 문자 표지를 남기지 않는다 — 60초 안 같은 글의 새 문자도 다시 읽는다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const pg = world.database.pglite as PGlite
    expect(await statuses(world, token, [sms('a', '010-1234-5678', '안녕하세요')])).toEqual(['IGNORED'])
    expect((await pg.query<{ n: number }>('select count(*)::int as n from inbox_sms_seen')).rows[0]?.n).toBe(0)
    expect(await statuses(world, token, [sms('b', '010-1234-5678', '15')])).toEqual(['SAVED'])
    expect((await pg.query<{ n: number }>('select count(*)::int as n from inbox_sms_seen')).rows[0]?.n).toBe(1)
    expect(await statuses(world, token, [sms('c', '010-1234-5678', '15')])).toEqual(['DUPLICATE'])
  })

  it('처리·무시한 카드는 본문·읽은 이름·뒤 4자리를 바로 지우고, 방송이 끝나고 24시간 뒤 행째 지운다 (RA-SMS3-003)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('m1', '010-1234-5678', '15 있나요 홍길동'), sms('m2', '010-2222-3333', '15 될까요 김철수')])).toEqual(['SAVED', 'SAVED'])
    const [one, two] = await cards(world, seller, sale.id)
    const api = client(world, seller.cookie)
    await expectOk(api.post(`/api/inbox/cards/${one?.id as string}/insert`, { requestId: rid('in'), no: 15 }))
    await expectOk(api.post(`/api/inbox/cards/${two?.id as string}/ignore`, {}))
    const pg = world.database.pglite as PGlite
    const rows = await pg.query<{ status: string; memo: string | null; last4: string | null; sealed: string | null }>('select status, memo, last4, sealed from inbox_cards order by seq')
    expect(rows.rows).toEqual([
      { status: 'DONE', memo: null, last4: null, sealed: null },
      { status: 'IGNORED', memo: null, last4: null, sealed: null },
    ])
    await expectOk(api.post(`/api/broadcasts/${sale.id}/end`, { requestId: rid('end') }))
    world.clock.advance(24 * 3_600_000 + 1)
    await world.server.inbox.sweep()
    expect((await pg.query<{ n: number }>('select count(*)::int as n from inbox_cards')).rows[0]?.n).toBe(0)
  })

  it('보낸 곳·제목은 200자까지, 본문의 방향 글자는 지우고, 카드의 보낸 이름에서 제어·방향 글자를 지운다. 방향 글자 섞인 은행 번호는 믿지 않는다 (RA-SMS3-010)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    const long = '가'.repeat(500)
    expect(await statuses(world, token, [sms('l1', long, '15 있나요?')])).toEqual(['SAVED'])
    expect(await statuses(world, token, [sms('l2', '홍\u202E길동\u0007', '15\u202E 있나요?')])).toEqual(['SAVED'])
    const list = await cards(world, seller, sale.id)
    expect(list.map((card) => [card.sender?.length, card.text])).toEqual([
      [200, '15 있나요?'],
      [3, '15 있나요?'],
    ])
    expect(list[1]?.sender).toBe('홍길동')
    // 방향 글자를 끼운 대표번호는 받은 그대로 가른다 — 숫자 모양이 아니라 이름(C-05 ③)이고 찜이 아니라 무시. 입금이 되지 않는다
    expect(await statuses(world, token, [sms('b1', '1588\u202E-9999', '[KB] 홍길동 입금 14,000')])).toEqual(['IGNORED'])
    for (const status of ['REVIEW', 'AUTO_APPLIED']) {
      expect((await expectOk(client(world, seller.cookie).get(`/api/deposits?status=${status}`))).body.deposits).toEqual([])
    }
  })

  it('토큰 없는·틀린 요청은 IP마다 10분 20번까지 401, 넘으면 토큰을 보지 않고 429 — 다른 IP·맞는 토큰은 그대로 (RA-SMS3-011)', async () => {
    const world = await newWorld({ clock: fakeClock(SMS3_T0), deposits: { testMode: true, autoStart: false }, trustedProxies: 1 })
    const { token } = await inboxWorld({ world })
    const post = (auth: string | null, ip: string) =>
      world.server.app.request('/api/inbox/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }) },
        body: JSON.stringify({ device: '갤럭시', messages: [] }),
      })
    for (let i = 0; i < 20; i++) expect((await post(i % 2 === 0 ? null : 'x'.repeat(43), '203.0.113.7')).status).toBe(401)
    const blocked = await post('y'.repeat(43), '203.0.113.7')
    expect(blocked.status).toBe(429)
    expect(await blocked.text()).not.toContain('203.0.113.7')
    expect((await post('y'.repeat(43), '198.51.100.9')).status).toBe(401)
    expect((await post(token, '198.51.100.9')).status).toBe(200)
    world.clock.advance(10 * 60_000 + 1)
    expect((await post('y'.repeat(43), '203.0.113.7')).status).toBe(401)
  })

  it('주기 정리: 서버 정리 타이머가 판매자 전체로 돈다 — 아무것도 읽지 않고 시계만 넘겨도 카드(방송 끝나고 24시간, C-07)·은행 알림 줄(30일, DP-9 9)·받은 id가 DB에서 사라진다', async () => {
    // 정리 타이머만 손으로 돌린다 (다른 작업 타이머는 그대로)
    const pending: (() => void)[] = []
    const sweepTimer = {
      schedule(_ms: number, fn: () => void) {
        pending.push(fn)
        return () => {
          const at = pending.indexOf(fn)
          if (at >= 0) pending.splice(at, 1)
        }
      },
    }
    const fire = async () => {
      const run = pending.splice(0)
      for (const fn of run) fn()
      // sweep()은 비동기 — 다음 예약이 걸릴 때까지 기다린다
      for (let i = 0; i < 200 && pending.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    }
    const world = await newWorld({ clock: fakeClock(SMS3_T0), deposits: { testMode: true, autoStart: false }, inbox: { sweepTimer } })
    const { seller, token } = await inboxWorld({ world })
    const other = await inboxWorld({ world })
    expect(pending).toHaveLength(1)
    const sale = await liveSale(world, seller, [15])
    const otherSale = await liveSale(world, other.seller, [15])
    expect(await statuses(world, token, [sms('k', '010-1234-5678', '15 있나요?'), sms('n1', '1588-9999', '[KB] 입금 확인 안내'), sms('n2', '1588-9999', '[KB] 홍길동 입금취소 14,000')])).toEqual(['SAVED', 'SAVED', 'SAVED'])
    expect(await statuses(world, other.token, [sms('k', '010-2222-3333', '15 있나요?')])).toEqual(['SAVED'])
    const api = client(world, seller.cookie)
    const alerts = (await expectOk(api.get('/api/deposits/alerts'))).body.alerts as { id: number; kind: string; name: string | null }[]
    // 읽지 못함 줄에는 이름이 없다 (D-SMS3-17)
    expect(alerts.map((alert) => [alert.kind, alert.name])).toEqual([
      ['CANCEL', '홍길동'],
      ['UNREADABLE', null],
    ])
    await expectOk(api.post(`/api/deposits/alerts/${String(alerts[0]?.id)}/close`, {}))
    await expectOk(api.post(`/api/broadcasts/${sale.id}/end`, { requestId: rid('end') }))
    await expectOk(client(world, other.seller.cookie).post(`/api/broadcasts/${otherSale.id}/end`, { requestId: rid('end') }))
    const pg = world.database.pglite as PGlite
    const count = async (table: string) => (await pg.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]?.n
    expect([await count('inbox_cards'), await count('bank_alerts'), await count('inbox_seen')]).toEqual([2, 2, 4])
    // 23시간: 아직 남는다
    world.clock.advance(23 * 3_600_000)
    await fire()
    expect(await count('inbox_cards')).toBe(2)
    // 24시간 넘음: 두 판매자의 처리 안 한 카드·받은 id가 지워진다. 은행 알림 줄은 남는다
    world.clock.advance(3_600_001)
    await fire()
    expect([await count('inbox_cards'), await count('inbox_seen'), await count('inbox_sms_seen')]).toEqual([0, 0, 0])
    expect(await count('bank_alerts')).toBe(2)
    // 받은 지 30일 넘음: 닫은 줄·열린 줄 모두 지워진다
    world.clock.advance(29 * 86_400_000)
    await fire()
    expect(await count('bank_alerts')).toBe(0)
    expect(pending).toHaveLength(1)
  })
})

describe('SMS3 고치기 2라운드 — 12시간 넘은 방송·엔진이 받지 않음·잠깐의 오류', () => {
  it('시작 12시간이 넘은 끝내지 않은 방송은 창이 아니다 — IGNORED, 설정·콘솔에 알림(본문 없음), 닫기·다시 나옴, 끝내면 사라짐. 입금 알림은 그대로 (D-SMS3-29)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16])
    const api = client(world, seller.cookie)
    // 08:00:00 (정확히 12시간) — 아직 창
    world.clock.advance(12 * 3_600_000)
    expect(await statuses(world, token, [sms('s1', '010-1234-5678', '15')])).toEqual(['SAVED'])
    expect((await expectOk(api.get('/api/inbox/settings'))).body.inbox).toMatchObject({ staleBroadcast: null })
    // 08:00:01 — 창 아님. 찜이 아닌 글은 세지 않는다
    world.clock.advance(1000)
    expect(await statuses(world, token, [sms('s2', '010-2222-3333', '16 김영희'), sms('s3', '010-2222-3333', '안녕하세요')])).toEqual(['IGNORED', 'IGNORED'])
    expect((await claimsOf(world, seller)).map((claim) => claim.no)).toEqual([15])
    const stale = {
      b: sale.id,
      startedAt: new Date(SMS3_T0).toISOString(),
      lastAt: new Date(world.clock.now()).toISOString(),
      count: 1,
      message: '끝내지 않은 방송이 12시간 넘게 이어져 손님 문자를 넣지 않았어요. 방송을 끝내 주세요.',
    }
    expect((await expectOk(api.get('/api/inbox/settings'))).body.inbox).toMatchObject({ staleBroadcast: stale })
    const console = await expectOk(api.get(`/api/inbox/cards?b=${sale.id}`))
    expect(console.body).toMatchObject({ cards: [], staleBroadcast: stale })
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain('김영희')
    expect(dump).not.toContain('01022223333')
    // 입금 알림은 그대로
    expect(await statuses(world, token, [sms('dep', '1588-9999', '[KB] 홍길동 입금 14,000')])).toEqual(['SAVED'])
    // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다
    // 닫으면 사라지고, 또 넣지 않은 문자가 오면 다시 나온다
    expect((await expectOk(api.post('/api/inbox/stale/close', {}))).body.inbox).toMatchObject({ staleBroadcast: null })
    expect(await statuses(world, token, [sms('s4', '010-2222-3333', '16')])).toEqual(['IGNORED'])
    expect((await expectOk(api.get('/api/inbox/settings'))).body.inbox).toMatchObject({ staleBroadcast: { b: sale.id, count: 1 } })
    // 방송을 끝내면 사라진다
    await expectOk(api.post(`/api/broadcasts/${sale.id}/end`, { requestId: rid('end') }))
    expect((await expectOk(api.get('/api/inbox/settings'))).body.inbox).toMatchObject({ staleBroadcast: null })
  })

  it('엔진이 판매 중 아님 밖의 사유로 받지 않으면 REJECTED 카드 "15번은 바로 넣지 못했어요. 보드에서 확인해 주세요" (D-SMS3-31)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    const codes = ['SEALED', 'INVALID_INPUT', 'NOT_SUPPORTED', 'REQUEST_ERROR'] as const
    const spy = vi.spyOn(world.server.service, 'writeInboxSms')
    for (const code of codes) spy.mockResolvedValueOnce({ kind: 'rejected', rejection: { status: 409, code, message: '거절', problems: [] } })
    expect(await statuses(world, token, codes.map((code, i) => sms(`r-${code}`, `010-1234-000${String(i)}`, '15')))).toEqual(['SAVED', 'SAVED', 'SAVED', 'SAVED'])
    spy.mockRestore()
    const list = await cards(world, seller, sale.id)
    expect(list.map((card) => [card.why, card.numbers, card.message, (card as unknown as { canApprove: boolean }).canApprove])).toEqual(
      codes.map(() => ['REJECTED', [15], '15번은 바로 넣지 못했어요. 보드에서 확인해 주세요', false]),
    )
    expect(await claimsOf(world, seller)).toEqual([])
  })

  it('잠깐의 상태 읽기 오류(STATE_FORMAT)면 카드 없이 500, 그 id는 받은 것으로 적지 않아 다시 보내면 처리된다. 앞서 처리한 메시지는 DUPLICATE (D-SMS3-31)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16])
    const real = world.server.service.writeInboxSms.bind(world.server.service)
    const spy = vi.spyOn(world.server.service, 'writeInboxSms').mockImplementation(async (sellerId, actor, input) => {
      if (input.no === 16) return { kind: 'rejected', rejection: { status: 409, code: 'STATE_FORMAT', message: '잠시', problems: [] } }
      return real(sellerId, actor, input)
    })
    const failed = await send(world, token, [sms('f1', '010-1234-5678', '15'), sms('f2', '010-2222-3333', '15 16')])
    expect(failed.status).toBe(500)
    expect(failed.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } })
    expect(await cards(world, seller, sale.id)).toEqual([])
    spy.mockRestore()
    expect(await statuses(world, token, [sms('f1', '010-1234-5678', '15'), sms('f2', '010-2222-3333', '15 16')])).toEqual(['DUPLICATE', 'SAVED'])
    const claims = await claimsOf(world, seller)
    expect(claims.map((claim) => claim.no).sort()).toEqual([15, 15, 16])
    expect(await cards(world, seller, sale.id)).toEqual([])
  })
})
