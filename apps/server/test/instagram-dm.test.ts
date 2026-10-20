// N2 감사 DM (AC-N2-40~52, R-13 "인스타그램 회차의 감사", D-N2-09·D-N2-10, G-ENG-N2-02): 집는 행·동의·받는 댓글·댓글 하나에 DM 하나·DM 글·
// 직전 확인·게시 보고·다시 시도·타임아웃 확인·재시작·기한·수동 재전송·실행기 하나·DM 목록·판매 상태 불변. 가짜 메타 서버(실제 HTTP)·주입한 시계.
import { readFileSync } from 'node:fs'
import { applyEvent, initEngine, listClaims, listEffects, type EngineEvent, type EngineState } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { DM_LINE_MAX, dmLine, dmText } from '../src/instagram/text.ts'
import { newThanksRows } from '../src/youtube/outbox-store.ts'
import { startServer } from './support.ts'
import { connectedShop, connectInstagram, igWorld, linkLive, liveBroadcast, register, sendComments, SHORT_SEND_TIMEOUT, TEST_TIMEOUTS, type IgWorld, type Shop } from './instagram-support.ts'
import { MERGED_BODY, RAW_JOIN, addSeller, client, rid, type TestServer } from './support.ts'

let ig: IgWorld | null = null
const extra: TestServer[] = []
afterEach(async () => {
  for (const server of extra.splice(0)) server.server.close()
  await ig?.close()
  ig = null
})
async function world(options: Parameters<typeof igWorld>[0] = {}): Promise<IgWorld> {
  ig = await igWorld(options)
  return ig
}

interface Setup extends Shop {
  readonly b: string
  readonly live: string
}

/** 연결·(동의)·방송·라이브 잇기·상품 */
async function setup(w: IgWorld, options: { readonly consent?: boolean; readonly settings?: Record<string, unknown>; readonly products?: readonly [number, string, number][] } = {}): Promise<Setup> {
  const shop = await connectedShop(w, { username: 'my.shop', consent: options.consent ?? true })
  const b = await liveBroadcast(w, shop.seller, options.settings)
  const live = w.fake.startLive(shop.account.id)
  await linkLive(w, shop.seller, b, live)
  for (const [no, name, price] of options.products ?? [[15, '핑크프릴', 10000], [28, '라울', 5000]]) await register(w, shop.seller, b, no, name, price)
  return { ...shop, b, live }
}

/** 댓글 하나 (id 고정) */
async function comment(w: IgWorld, s: Setup, id: string, igsid: string, username: string, text: string): Promise<void> {
  expect((await sendComments(w, s.account, s.live, [{ id, igsid, username, text }])).status).toBe(200)
}

interface RowView {
  readonly id: number
  readonly comment: string | null
  readonly status: string
  readonly reason: string | null
  readonly message: string | null
  readonly product: string
  readonly line: string
  readonly attempts: number
  readonly together: number[]
  readonly sentAt: string | null
  readonly metaMessageId: string | null
  readonly nextAt: string | null
}

async function rows(w: IgWorld, s: Shop): Promise<RowView[]> {
  const response = await client(w, s.seller.cookie).get('/api/instagram/dms?date=2026-10-19')
  expect(response.status).toBe(200)
  return response.body.rows as RowView[]
}

async function drain(w: IgWorld): Promise<void> {
  await w.server.instagram.dms.drain()
}

async function eventTypes(w: TestServer, sellerId: string): Promise<{ type: string; actor: string; body: Record<string, unknown> }[]> {
  const result = await w.database.pglite?.query<{ type: string; actor: string; body: string }>(`select e.type, e.actor, ${MERGED_BODY} as body from events e ${RAW_JOIN} where e.seller_id = $1 order by e.scope_id, e.seq`, [sellerId])
  return (result?.rows ?? []).map((row) => ({ type: row.type, actor: row.actor, body: JSON.parse(row.body) as Record<string, unknown> }))
}

async function thanksReports(w: TestServer, sellerId: string): Promise<string[]> {
  return (await eventTypes(w, sellerId)).filter((event) => event.type === 'effect.thanksSent').map((event) => event.body.effectId as string)
}

async function write(w: TestServer, s: Shop, event: Record<string, unknown>): Promise<void> {
  const path = 'b' in event ? '/api/events' : '/api/events?date=2026-10-19'
  const response = await client(w, s.seller.cookie).post(path, { requestId: rid('ev'), ...event })
  expect(response.status, response.text).toBe(200)
}

async function replay(w: TestServer, sellerId: string): Promise<EngineState> {
  const result = await w.database.pglite?.query<{ body: string; failed: boolean }>(
    `select ${MERGED_BODY} as body, e.failed from events e join scopes s on s.id = e.scope_id ${RAW_JOIN} where e.seller_id = $1 and s.date = '2026-10-19' and s.rehearsal = false order by e.seq`,
    [sellerId],
  )
  let state = initEngine({ broadcasts: [], settings: {} })
  for (const row of result?.rows ?? []) if (!row.failed) state = applyEvent(state, JSON.parse(row.body) as EngineEvent).state
  return state
}

describe('AC-N2-40 실행기가 집는 행', () => {
  it('리허설 POST_THANKS 행이 많아도 실제 인스타 회차 하나만 보낸다, 인스타가 아닌 회차는 행이 없다', async () => {
    const w = await world()
    const s = await setup(w)
    const api = client(w, s.seller.cookie)
    const rehearsal = ((await api.post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-19', rehearsal: true })).body.broadcast as { id: string }).id
    for (let no = 1; no <= 5; no++) {
      expect((await api.post('/api/events', { requestId: rid('r'), type: 'product.register', b: rehearsal, no, name: `리허설${String(no)}`, price: 1000 })).status).toBe(200)
      expect((await api.post(`/api/broadcasts/${rehearsal}/rehearsal/chat`, { requestId: rid('vc'), nick: `시청자${String(no)}`, text: String(no) })).status).toBe(200)
    }
    const plain = await liveBroadcast(w, s.seller)
    await register(w, s.seller, plain, 1, '연결 없는 상품', 1000)
    await write(w, s, { type: 'sms', b: plain, no: 1, received: '12:00' })
    await comment(w, s, '501', '1', 'buyer.one', '15')
    const outbox = await w.database.pglite?.query<{ rehearsal: boolean; n: number }>(`select rehearsal, count(*)::int as n from outbox where kind = 'POST_THANKS' group by rehearsal order by rehearsal`)
    expect(outbox?.rows).toEqual([
      { rehearsal: false, n: 2 },
      { rehearsal: true, n: 5 },
    ])
    await drain(w)
    expect(w.fake.dms.map((dm) => dm.commentId)).toEqual(['501'])
    expect((await rows(w, s)).map((row) => row.comment)).toEqual(['ig:501'])
  })

  it('유튜브 발송함 실행기는 인스타 회차의 감사 행을 집지 않는다 — 인스타가 아닌 회차의 감사 행만 (N2 합치기, D-N2-01)', async () => {
    const w = await world()
    const s = await setup(w)
    const plain = await liveBroadcast(w, s.seller)
    await register(w, s.seller, plain, 1, '연결 없는 상품', 1000)
    await write(w, s, { type: 'sms', b: plain, no: 1, received: '12:00' })
    await comment(w, s, '601', '1', 'buyer.one', '15')
    const thanks = await w.database.pglite?.query<{ id: number; ig: boolean }>(
      `select o.id::int as id, exists (select 1 from ig_dm_rows d where d.outbox_id = o.id) as ig from outbox o where o.kind = 'POST_THANKS' and o.rehearsal = false order by o.id`,
    )
    expect(thanks?.rows.map((row) => row.ig)).toEqual([false, true])
    const picked = await newThanksRows(w.database.db)
    expect(picked.map((row) => row.id)).toEqual(thanks?.rows.filter((row) => !row.ig).map((row) => row.id))
  })

  it('행을 고르는 조회는 rehearsal = false를 조건에 고정하고 바꾸는 매개변수가 없다, 발송함 표의 열은 그대로다', async () => {
    const source = readFileSync(new URL('../src/instagram/store.ts', import.meta.url), 'utf8')
    const start = source.indexOf('export async function dueDmGroups(')
    const body = source.slice(start, source.indexOf('\n}\n', start))
    expect(body).toMatch(/^export async function dueDmGroups\(db: Db, now: Date, limit: number\)/)
    expect(body).toContain('eq(outbox.rehearsal, false)')
    expect(body).not.toMatch(/rehearsal(?!, false\))/)
    const w = await world()
    const columns = await w.database.pglite?.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'outbox' order by ordinal_position`)
    // 합친 뒤(N2 + Y1·I3 + I2): 발송함 열은 main의 것(Y1 0004 발송함 상태 열·I3 0005 정리 열)과 I2 0007의 restored — N2는 열을 더하지 않는다(D-N2-01)
    expect(columns?.rows.map((row) => row.column_name)).toEqual([
      'id',
      'seller_id',
      'scope_id',
      'effect_id',
      'seq',
      'kind',
      'body',
      'created_at',
      'rehearsal',
      'state',
      'reason',
      'target',
      'broadcast_id',
      'group_id',
      'attempts',
      'next_at',
      'deadline_at',
      'post_text',
      'sent_text',
      'attempt_at',
      'confirm_until',
      'confirm_tries',
      'remote_id',
      'posted_at',
      'reported',
      'manual',
      'resend_request_id',
      'lease_owner',
      'lease_until',
      'updated_at',
      'confirmed_by',
      'confirm_request_id',
      'dismissed_at',
      'dismissed_by',
      // I2 합치기: 복구로 다시 만든 행 표시 (I2 0007, D-I2-11·D-I2-14 — 실행기는 restored = false도 건다)
      'restored',
    ])
  })
})

describe('AC-N2-41 DM 자동 발송 동의', () => {
  it('효과가 나온 때 동의가 없으면 FAILED(NO_CONSENT) — 나중에 켜도 자동으로 보내지 않고, 수동 재전송은 된다', async () => {
    const w = await world()
    const s = await setup(w, { consent: false })
    await comment(w, s, '601', '1', 'buyer.one', '15')
    await drain(w)
    expect((await rows(w, s)).map((row) => [row.status, row.reason, row.message])).toEqual([['FAILED', 'NO_CONSENT', '자동 DM에 동의하기 전의 감사예요.']])
    expect((await client(w, s.seller.cookie).post('/api/instagram/consent', { on: true })).status).toBe(200)
    await drain(w)
    expect(w.fake.dms).toEqual([])
    const row = (await rows(w, s))[0] as RowView
    const resent = await client(w, s.seller.cookie).post(`/api/instagram/dms/${String(row.id)}/resend`, { requestId: rid('rs') })
    expect(resent.status, resent.text).toBe(200)
    await drain(w)
    expect(w.fake.dms.map((dm) => dm.commentId)).toEqual(['601'])
  })

  it('끄면 기다리던 행이 FAILED(NO_CONSENT), 끊으면 동의도 꺼진다', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '602', '1', 'buyer.one', '15')
    expect((await rows(w, s)).map((row) => row.status)).toEqual(['WAITING'])
    expect((await client(w, s.seller.cookie).post('/api/instagram/consent', { on: false })).status).toBe(200)
    await drain(w)
    expect((await rows(w, s)).map((row) => [row.status, row.reason])).toEqual([['FAILED', 'NO_CONSENT']])
    expect(w.fake.dms).toEqual([])
  })
})

describe('AC-N2-16·23 끊기와 기다리던 DM 행', () => {
  it('인스타 연결을 끊으면 기다리던 행은 FAILED(NO_CONSENT), 라이브 연결을 끊으면 그 회차의 기다리던 행은 FAILED(NO_LINK)', async () => {
    const w = await world()
    const s = await setup(w)
    const api = client(w, s.seller.cookie)
    await comment(w, s, '651', '1', 'buyer.one', '15')
    expect((await api.post(`/api/broadcasts/${s.b}/live/unlink`, { requestId: rid('u') })).status).toBe(200)
    expect((await rows(w, s)).map((row) => [row.status, row.reason, row.message])).toEqual([['FAILED', 'NO_LINK', '이어진 인스타그램 라이브가 없어요.']])
    await linkLive(w, s.seller, s.b, s.live)
    await comment(w, s, '652', '2', 'buyer.two', '28')
    expect((await api.post('/api/instagram/disconnect', {})).status).toBe(200)
    expect((await rows(w, s)).map((row) => [row.comment, row.status, row.reason])).toEqual([
      ['ig:651', 'FAILED', 'NO_LINK'],
      ['ig:652', 'FAILED', 'NO_CONSENT'],
    ])
    await drain(w)
    expect(w.fake.dms).toEqual([])
    // 이미 기록한 채팅·판정은 그대로, 같은 계정으로 다시 연결하면 그 회차에 이어서 기록한다
    expect(await connectInstagram(w, s.seller, { accounts: [s.account.id] })).toBe('CONNECTED')
    await comment(w, s, '653', '3', 'buyer.three', '안녕')
    expect((await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'chat' and seller_id = $1`, [s.seller.sellerId]))?.rows[0]?.n).toBe(3)
  })
})

describe('AC-N2-42 받는 댓글·보내지 않는 경우 (G-ENG-N2-02)', () => {
  it('"15 28"·변환·승계는 그 댓글에 DM 하나씩, 문자찜·직접 배정은 건너뜀, 취소 전후 댓글 101에 DM 1개', async () => {
    const w = await world()
    const s = await setup(w, { products: [[15, '핑크프릴', 10000], [28, '라울', 5000], [31, '방울복랑 금', 15000]] })
    await comment(w, s, '17900000000000101', '6024400000000001', 'pink.mom', '15 28')
    await comment(w, s, '17900000000000102', '01012345678', 'cactus_kim', '15')
    await comment(w, s, '17900000000000103', '6024400000000003', 'succulent.jj', '31번이요ㅎ 제가 살게요')
    await comment(w, s, '17900000000000104', '6024400000000004', 'dduk.mom', '안녕하세요')
    await write(w, s, { type: 'host.convertMessage', b: s.b, msg: 'ig:17900000000000103', no: 31, reason: '댓글 확인' })
    await drain(w)
    expect(w.fake.dms.map((dm) => [dm.commentId, dm.text])).toEqual([
      ['17900000000000101', '15번 핑크프릴 10,000원 pink.mom님 구매 감사합니다\n28번 라울 5,000원 pink.mom님 구매 감사합니다'],
      ['17900000000000103', '31번 방울복랑 금 15,000원 succulent.jj님 구매 감사합니다'],
    ])
    // A 15번 취소 → B 승계 → 댓글 102에 DM
    await write(w, s, { type: 'host.cancel', b: s.b, no: 15, buyer: 'ig:6024400000000001', reason: '구매자 요청' })
    await register(w, s.seller, s.b, 40, '미니마', 800)
    await write(w, s, { type: 'sms', b: s.b, no: 40, received: '12:00' })
    await register(w, s.seller, s.b, 41, '성미인', 8000)
    await write(w, s, { type: 'host.assign', b: s.b, no: 41, buyer: 'ig:6024400000000004', reason: '댓글로 주문 확인' })
    // ID 칸에 숫자만인 IGSID를 접두어와 함께 — 휴대폰 번호 ID로 보지 않는다
    await write(w, s, { type: 'host.confirm', b: s.b, no: 15, buyer: 'ig:01012345678' })
    await drain(w)
    expect(w.fake.dms.map((dm) => dm.commentId)).toEqual(['17900000000000101', '17900000000000103', '17900000000000102'])
    expect(w.fake.dms.filter((dm) => dm.commentId === '17900000000000101')).toHaveLength(1)
    const list = await rows(w, s)
    expect(list.map((row) => [row.product.split('/')[1], row.comment, row.status, row.reason])).toEqual([
      ['15', 'ig:17900000000000101', 'SENT', null],
      ['28', 'ig:17900000000000101', 'SENT', null],
      ['31', 'ig:17900000000000103', 'SENT', null],
      ['15', 'ig:17900000000000102', 'SENT', null],
      ['40', null, 'SKIPPED', 'NO_RECIPIENT'],
      ['41', null, 'SKIPPED', 'NO_RECIPIENT'],
    ])
    expect(list.find((row) => row.reason === 'NO_RECIPIENT')?.message).toBe('댓글로 생긴 찜이 아니라 DM을 보낼 곳이 없어요.')
    // 보낸 감사는 그대로, 승계자 새 감사 — 엔진은 감사 넷이 실행 완료
    const state = (await w.server.writer.read(s.seller.sellerId, '2026-10-19')).state
    expect(listEffects(state).filter((effect) => effect.kind === 'POST_THANKS').map((effect) => [effect.product.split('/')[1], effect.status])).toEqual([
      ['15', 'DONE'],
      ['28', 'DONE'],
      ['31', 'DONE'],
      ['15', 'DONE'],
      ['40', 'PENDING'],
      ['41', 'PENDING'],
    ])
  })

  it('영상 댓글 효과는 SKIPPED(NOT_SUPPORTED), 실시간 감사를 끈 회차는 행이 없다', async () => {
    const w = await world()
    const s = await setup(w, { settings: { 'thanks.videoComment': 'PER_SALE' } })
    await comment(w, s, '701', '1', 'buyer.one', '15')
    await drain(w)
    expect((await rows(w, s)).map((row) => [row.status, row.reason, row.message])).toEqual([
      ['SENT', null, null],
      ['SKIPPED', 'NOT_SUPPORTED', '인스타그램에는 공개 댓글로 감사를 남길 수 없어요.'],
    ])
    const off = await liveBroadcast(w, s.seller, { 'thanks.liveChat': false, 'thanks.videoComment': 'OFF' })
    expect((await client(w, s.seller.cookie).post(`/api/broadcasts/${s.b}/live/unlink`, { requestId: rid('u') })).status).toBe(200)
    await linkLive(w, s.seller, off, s.live)
    await register(w, s.seller, off, 15, '다른', 1000)
    await comment(w, s, '702', '2', 'buyer.two', '15')
    await drain(w)
    expect((await rows(w, s)).length).toBe(2)
    expect(w.fake.dms).toHaveLength(1)
  })
})

describe('AC-N2-43 댓글 하나에 DM 하나', () => {
  it('(가) "15 28" → DM 1개(두 줄), 두 행 SENT, 게시 보고 2개', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '801', '1', 'pink.mom', '15 28')
    await drain(w)
    expect(w.fake.dms).toHaveLength(1)
    const list = await rows(w, s)
    expect(list.map((row) => row.status)).toEqual(['SENT', 'SENT'])
    expect(list[0]?.together).toEqual([list[1]?.id])
    expect(await thanksReports(w, s.seller.sellerId)).toHaveLength(2)
  })

  it('(나) 같은 댓글 사람의 28번이 대기였다가 승계로 확정 → 새 행 ONE_REPLY, DM 그대로', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '802', '9', 'first.buyer', '28')
    await comment(w, s, '803', '1', 'pink.mom', '15 28')
    await drain(w)
    expect(w.fake.dms.map((dm) => dm.commentId)).toEqual(['802', '803'])
    await write(w, s, { type: 'host.cancel', b: s.b, no: 28, buyer: 'ig:9', reason: '취소' })
    await drain(w)
    expect(w.fake.dms).toHaveLength(2)
    const last = (await rows(w, s)).at(-1) as RowView
    expect([last.comment, last.status, last.reason, last.message]).toEqual(['ig:803', 'FAILED', 'ONE_REPLY', '이 댓글에는 이미 DM을 보냈어요. 댓글 하나에 DM은 한 번만 보낼 수 있어요. 인스타그램에서 직접 보내 주세요.'])
    // 수동으로도 다시 보낼 수 없다
    const resent = await client(w, s.seller.cookie).post(`/api/instagram/dms/${String(last.id)}/resend`, { requestId: rid('rs') })
    expect(resent.status).toBe(409)
    expect(resent.body.error).toMatchObject({ code: 'DM_NOT_RESENDABLE' })
  })

  it('(다) 첫 DM이 REJECTED로 끝난 댓글에서 나중 효과는 보낸다', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '804', '9', 'first.buyer', '28')
    await drain(w)
    w.fake.fail('send', 'REJECTED')
    await comment(w, s, '805', '1', 'pink.mom', '15 28')
    await drain(w)
    expect((await rows(w, s)).filter((row) => row.comment === 'ig:805').map((row) => [row.status, row.reason])).toEqual([['FAILED', 'REJECTED']])
    await write(w, s, { type: 'host.cancel', b: s.b, no: 28, buyer: 'ig:9', reason: '취소' })
    await drain(w)
    expect(w.fake.dms.map((dm) => [dm.commentId, dm.text])).toEqual([
      ['804', '28번 라울 5,000원 first.buyer님 구매 감사합니다'],
      ['805', '28번 라울 5,000원 pink.mom님 구매 감사합니다'],
    ])
  })

  it('보내는 중에 생긴 같은 댓글의 행은 결과를 기다리고(PREVIOUS), SENT로 끝나면 ONE_REPLY', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '806', '9', 'first.buyer', '28')
    await drain(w)
    await comment(w, s, '807', '1', 'pink.mom', '15 28')
    // 보내기 요청이 끝나기 전에 같은 댓글의 새 효과가 생긴다
    const original = w.server.instagram.meta?.privateReply.bind(w.server.instagram.meta)
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    if (w.server.instagram.meta === null || original === undefined) throw new Error('메타 어댑터가 없다')
    w.server.instagram.meta.privateReply = async (...args) => {
      await gate
      return original(...args)
    }
    const running = w.server.instagram.dms.runOnce()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await write(w, s, { type: 'host.cancel', b: s.b, no: 28, buyer: 'ig:9', reason: '취소' })
    expect((await rows(w, s)).filter((row) => row.comment === 'ig:807').map((row) => [row.status, row.reason])).toEqual([
      ['SENDING', null],
      ['WAITING', 'PREVIOUS'],
    ])
    ;(release as unknown as () => void)()
    await running
    await drain(w)
    expect((await rows(w, s)).filter((row) => row.comment === 'ig:807').map((row) => [row.status, row.reason])).toEqual([
      ['SENT', null],
      ['FAILED', 'ONE_REPLY'],
    ])
    expect(w.fake.dms.filter((dm) => dm.commentId === '807')).toHaveLength(1)
  })
})

describe('AC-N2-44 DM 글', () => {
  it('공백 → 한 칸, 보이지 않는 글자 삭제, 앞뒤·이어진 공백 정리, 190자 넘으면 189자 + …', () => {
    expect(dmLine('15번\n핑크\t프릴  10,000원 pink.mom님   구매  감사합니다 ')).toBe('15번 핑크 프릴 10,000원 pink.mom님 구매 감사합니다')
    expect(dmLine('a​b‮c\u0007d﻿e­')).toBe('abcde')
    expect(dmLine('　  앞뒤   ')).toBe('앞뒤')
    const long = '가'.repeat(DM_LINE_MAX)
    expect(dmLine(long)).toBe(long)
    expect(dmLine(`${long}나`)).toBe(`${'가'.repeat(189)}…`)
    expect([...dmLine('😀'.repeat(200))].length).toBe(190)
    expect(dmText(['1', '2', '3', '4', '5', '6'])).toBe('1\n2\n3\n4\n5')
  })

  it('문자찜의 메모·전화번호·뒤 4자리는 어떤 DM에도 없다 (인스타 구매자와 합친 뒤에도)', async () => {
    const w = await world()
    const s = await setup(w, { products: [[15, '핑크프릴', 10000], [28, '라울', 5000], [29, '하나 더', 3000]] })
    await write(w, s, { type: 'sms', b: s.b, no: 28, received: '12:00', memo: '비밀메모 집앞', phone: '010-1234-5678' })
    const smsBuyer = ((await client(w, s.seller.cookie).get('/api/days/2026-10-19')).body.buyers as { id: string }[]).find((buyer) => buyer.id.startsWith('sms:'))?.id as string
    await comment(w, s, '901', '1', 'pink.mom', '15')
    await write(w, s, { type: 'buyer.merge', from: smsBuyer, into: 'ig:1', reason: '같은 사람' })
    await comment(w, s, '902', '1', 'pink.mom', '29')
    await drain(w)
    expect(w.fake.dms).toHaveLength(2)
    for (const dm of w.fake.dms) for (const secret of ['비밀메모', '집앞', '5678', '010', '문자찜']) expect(dm.text).not.toContain(secret)
  })
})

describe('AC-N2-45 보내기 직전 확인', () => {
  it('취소됐으면 SKIPPED(CANCELLED), 이미 완료면 SENT(보내지 않음)', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '1001', '1', 'pink.mom', '15')
    await comment(w, s, '1002', '2', 'cactus', '28')
    await write(w, s, { type: 'host.cancel', b: s.b, no: 15, buyer: 'ig:1', reason: '취소' })
    // 28번 감사는 다른 길로 이미 보고됨
    const state = (await w.server.writer.read(s.seller.sellerId, '2026-10-19')).state
    const effectId = listEffects(state).find((effect) => effect.kind === 'POST_THANKS' && effect.product.endsWith('/28'))?.id as string
    const reported = await w.server.writer.write({
      sellerId: s.seller.sellerId,
      date: '2026-10-19',
      rehearsal: false,
      createScope: false,
      requestId: null,
      build: () => [{ fields: { type: 'effect.thanksSent', effectId }, actor: { kind: 'server' } }],
    })
    expect(reported.kind).toBe('ok')
    await drain(w)
    expect(w.fake.dms).toEqual([])
    expect((await rows(w, s)).map((row) => [row.comment, row.status, row.reason, row.message])).toEqual([
      ['ig:1001', 'SKIPPED', 'CANCELLED', '확정이 풀린 판매라 보내지 않았어요.'],
      ['ig:1002', 'SENT', null, null],
    ])
    expect(await thanksReports(w, s.seller.sellerId)).toEqual([effectId])
  })

  it('"15 28" 중 하나가 취소되면 남은 줄만 보낸다', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '1003', '1', 'pink.mom', '15 28')
    await write(w, s, { type: 'host.cancel', b: s.b, no: 15, buyer: 'ig:1', reason: '취소' })
    await drain(w)
    expect(w.fake.dms.map((dm) => dm.text)).toEqual(['28번 라울 5,000원 pink.mom님 구매 감사합니다'])
  })
})

describe('AC-N2-46 보냄과 게시 보고', () => {
  it('메타 메시지 ID·보낸 시각, 효과마다 effect.thanksSent(조치자 server) 한 번, 잠금, effect.failed 0건', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '1101', '1', 'pink.mom', '15 28')
    await drain(w)
    await drain(w)
    const list = await rows(w, s)
    expect(list.map((row) => [row.status, row.metaMessageId, row.sentAt])).toEqual(list.map(() => ['SENT', w.fake.dms[0]?.messageId, new Date(w.clock.now()).toISOString()]))
    const events = await eventTypes(w, s.seller.sellerId)
    expect(events.filter((event) => event.type === 'effect.thanksSent').map((event) => event.actor)).toEqual(['server', 'server'])
    expect(events.filter((event) => event.type === 'effect.failed')).toEqual([])
    const state = (await w.server.writer.read(s.seller.sellerId, '2026-10-19')).state
    expect(listClaims(state).map((claim) => claim.locked)).toEqual([true, true])
    // 방송자 취소는 잠금과 상관없이 되고, 보낸 DM은 그대로
    await write(w, s, { type: 'host.cancel', b: s.b, no: 15, buyer: 'ig:1', reason: '취소' })
    await drain(w)
    expect(w.fake.dms).toHaveLength(1)
  })

  it('보고 기록이 실패하면 보고만 다시 한다 — DM 1번', async () => {
    let failReports = 0
    const w = await world({
      overrides: {
        hooks: {
          beforeCommit: (records) => {
            if (failReports > 0 && records.some((record) => record.type === 'effect.thanksSent')) {
              failReports -= 1
              throw new Error('보고 저장 실패')
            }
          },
        },
      },
    })
    const s = await setup(w)
    await comment(w, s, '1102', '1', 'pink.mom', '15')
    // 보낸 직후의 보고와 같은 차례의 다시 보고 둘 다 실패
    failReports = 2
    await w.server.instagram.dms.runOnce()
    expect(w.fake.dms).toHaveLength(1)
    expect(await thanksReports(w, s.seller.sellerId)).toEqual([])
    await drain(w)
    expect(w.fake.dms).toHaveLength(1)
    expect(await thanksReports(w, s.seller.sellerId)).toHaveLength(1)
  })
})

describe('AC-N2-47 다시 시도', () => {
  it('5xx: 2·4·8·16·32초 뒤 최대 5번, 그래도 안 되면 GAVE_UP (보내기 시도 6번)', async () => {
    const w = await world()
    const s = await setup(w)
    w.fake.fail('send', 'SERVER_ERROR', 6)
    await comment(w, s, '1201', '1', 'pink.mom', '15')
    await drain(w)
    for (const delay of [2, 4, 8, 16, 32]) {
      const row = (await rows(w, s))[0] as RowView
      expect([row.status, row.reason, row.message]).toEqual(['WAITING', 'RETRY', '보내지 못해 잠시 뒤 다시 보내요.'])
      expect(row.nextAt).toBe(new Date(w.clock.now() + delay * 1000).toISOString())
      w.clock.advance(delay * 1000 - 1)
      await drain(w)
      expect((await rows(w, s))[0]?.attempts).toBe(row.attempts)
      w.clock.advance(1)
      await drain(w)
    }
    const row = (await rows(w, s))[0] as RowView
    expect([row.status, row.reason, row.message, row.attempts]).toEqual(['FAILED', 'GAVE_UP', '여러 번 보내지 못했어요.', 6])
    expect(w.fake.count('send')).toBe(6)
    expect(w.fake.dms).toEqual([])
  })

  it.each(['TOO_MANY', 'RATE_LIMIT'] as const)('%s는 다시 시도해 보낸다', async (fault) => {
    const w = await world()
    const s = await setup(w)
    w.fake.fail('send', fault)
    await comment(w, s, '1202', '1', 'pink.mom', '15')
    await drain(w)
    w.clock.advance(2000)
    await drain(w)
    expect(w.fake.dms).toHaveLength(1)
    expect(w.fake.count('send')).toBe(2)
  })

  it.each([
    ['NO_PERMISSION', 'NO_PERMISSION', 'DM을 보낼 권한이 없어요. 인스타그램 연결을 다시 해 주세요.'],
    ['ONE_REPLY', 'ONE_REPLY', '이 댓글에는 이미 DM을 보냈어요. 댓글 하나에 DM은 한 번만 보낼 수 있어요. 인스타그램에서 직접 보내 주세요.'],
    ['REJECTED', 'REJECTED', '인스타그램이 받지 않았어요.'],
    ['LIVE_ENDED', 'LIVE_ENDED', '인스타그램 라이브가 끝나 DM을 보낼 수 없어요.'],
  ] as const)('%s는 다시 시도하지 않는다 (시도 1번, 바로 FAILED)', async (fault, reason, message) => {
    const w = await world()
    const s = await setup(w)
    w.fake.fail('send', fault)
    await comment(w, s, '1203', '1', 'pink.mom', '15')
    await drain(w)
    w.clock.advance(60_000)
    await drain(w)
    expect(w.fake.count('send')).toBe(1)
    expect((await rows(w, s)).map((row) => [row.status, row.reason, row.message])).toEqual([['FAILED', reason, message]])
  })

  it('보내기 연결 거절(메타에 닿지 않음)은 대화 조회 없이 WAITING(RETRY) → 2초 뒤 다시 보내 DM 1 (TD-N2-002)', async () => {
    const w = await world()
    const s = await setup(w)
    const original = globalThis.fetch
    let refused = 0
    globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (refused === 0 && url.startsWith(w.fake.url) && url.includes('/messages')) {
        refused += 1
        return Promise.reject(new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { code: 'ECONNREFUSED', syscall: 'connect' }) }))
      }
      return original(input, init)
    }) as typeof fetch
    try {
      await comment(w, s, '1207', '1', 'pink.mom', '15')
      await drain(w)
      expect(refused).toBe(1)
      expect((await rows(w, s)).map((row) => [row.status, row.reason, row.attempts, row.nextAt])).toEqual([['WAITING', 'RETRY', 1, new Date(w.clock.now() + 2000).toISOString()]])
      expect(w.fake.count('conversation')).toBe(0)
      w.clock.advance(2000)
      await drain(w)
      expect(w.fake.dms.map((dm) => dm.commentId)).toEqual(['1207'])
      expect((await rows(w, s)).map((row) => row.status)).toEqual(['SENT'])
      expect(w.fake.count('conversation')).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })

  it('보내기 연결이 요청을 받은 뒤 끊기면(보냈을 수 있음) 바로 다시 보내지 않고 대화 조회로 확인한다', async () => {
    const w = await world()
    const s = await setup(w)
    w.fake.fail('send', 'DROP')
    await comment(w, s, '1208', '1', 'pink.mom', '15')
    await drain(w)
    expect(w.fake.count('conversation')).toBe(1)
    expect((await rows(w, s)).map((row) => [row.status, row.reason, row.attempts])).toEqual([['WAITING', 'RETRY', 1]])
    w.clock.advance(2000)
    await drain(w)
    expect(w.fake.dms.map((dm) => dm.commentId)).toEqual(['1208'])
  })

  it('라이브가 실제로 끝나면 메타가 거절해 LIVE_ENDED', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '1204', '1', 'pink.mom', '15')
    w.fake.endLive(s.live)
    await drain(w)
    expect((await rows(w, s)).map((row) => [row.status, row.reason])).toEqual([['FAILED', 'LIVE_ENDED']])
  })

  it('토큰 무효 → 다시 연결 필요·WAITING(RECONNECT), 같은 계정으로 다시 연결하면 기한 안의 DM을 보낸다', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '1205', '1', 'pink.mom', '15')
    w.fake.fail('send', 'TOKEN_INVALID')
    await drain(w)
    expect((await rows(w, s)).map((row) => [row.status, row.reason, row.message])).toEqual([['WAITING', 'RECONNECT', '인스타그램 연결을 다시 하면 보내요.']])
    expect(((await client(w, s.seller.cookie).get('/api/instagram')).body.connection as { status: string }).status).toBe('RECONNECT_NEEDED')
    await drain(w)
    expect(w.fake.count('send')).toBe(1)
    // 그동안에도 웹훅 댓글은 평소대로 기록한다 (AC-N2-14)
    await comment(w, s, '1206', '2', 'other', '안녕')
    expect((await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'chat' and seller_id = $1`, [s.seller.sellerId]))?.rows[0]?.n).toBe(2)
    w.clock.advance(5 * 60 * 1000)
    expect(await connectInstagram(w, s.seller, { accounts: [s.account.id] })).toBe('CONNECTED')
    await drain(w)
    expect(w.fake.dms.map((dm) => dm.commentId)).toEqual(['1205'])
  })
})

describe('AC-N2-48 타임아웃·재시작 — 두 번 보내지 않음', () => {
  it('(가) DM은 받지만 응답 없음 → 대화 조회로 SENT, DM 1', async () => {
    // 보내기 시간 초과를 직접 본다 (SA-N2-007 — 그 밖의 시험은 TEST_TIMEOUTS)
    const w = await world({ timeouts: SHORT_SEND_TIMEOUT })
    const s = await setup(w)
    w.fake.fail('send', 'HANG_AFTER')
    await comment(w, s, '1301', '1', 'pink.mom', '15')
    await drain(w)
    expect(w.fake.dms).toHaveLength(1)
    expect(w.fake.count('conversation')).toBe(1)
    expect((await rows(w, s)).map((row) => [row.status, row.metaMessageId])).toEqual([['SENT', w.fake.dms[0]?.messageId]])
    expect(await thanksReports(w, s.seller.sellerId)).toHaveLength(1)
  })

  it('(나) 받지 않고 응답 없음 → 확인에 없음 → 다시 시도로 DM 1', async () => {
    // 보내기 시간 초과를 직접 본다 (SA-N2-007 — 그 밖의 시험은 TEST_TIMEOUTS)
    const w = await world({ timeouts: SHORT_SEND_TIMEOUT })
    const s = await setup(w)
    w.fake.fail('send', 'HANG')
    await comment(w, s, '1302', '1', 'pink.mom', '15')
    await drain(w)
    expect((await rows(w, s)).map((row) => [row.status, row.reason, row.attempts])).toEqual([['WAITING', 'RETRY', 1]])
    w.clock.advance(2000)
    await drain(w)
    expect(w.fake.dms).toHaveLength(1)
    expect((await rows(w, s)).map((row) => row.status)).toEqual(['SENT'])
  })

  it('(다) 보내기 요청 직후 서버를 죽였다 살림 → 임대가 지나면 확인부터 → DM 1', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '1303', '1', 'pink.mom', '15')
    const meta = w.server.instagram.meta
    if (meta === null) throw new Error('메타 어댑터가 없다')
    const original = meta.privateReply.bind(meta)
    // 요청은 메타에 닿았고(DM 기록), 응답을 받기 전에 프로세스가 죽는다 (영원히 돌아오지 않는다)
    meta.privateReply = async (...args) => {
      await original(...args)
      return new Promise(() => {})
    }
    void w.server.instagram.dms.runOnce()
    for (let i = 0; i < 100 && w.fake.dms.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(w.fake.dms).toHaveLength(1)
    w.server.close()
    const restarted = startServer(w.database, w.masterKey, { clock: w.clock, instagram: w.fake.settings({ redirectUri: 'https://api.livejjim.test/api/instagram/callback', timeouts: TEST_TIMEOUTS }), dmAutoRun: false })
    extra.push(restarted)
    await restarted.server.instagram.dms.drain()
    expect(w.fake.count('conversation')).toBe(0)
    w.clock.advance(60_000)
    await restarted.server.instagram.dms.drain()
    expect(w.fake.count('conversation')).toBe(1)
    expect(w.fake.dms).toHaveLength(1)
    expect((await rows(restarted as IgWorld, s)).map((row) => row.status)).toEqual(['SENT'])
    expect(await thanksReports(restarted, s.seller.sellerId)).toHaveLength(1)
  })

  it('(라) 응답 없음 + 대화 조회 실패 → UNCONFIRMED, 자동으로 다시 보내지 않음', async () => {
    // 보내기 시간 초과를 직접 본다 (SA-N2-007 — 그 밖의 시험은 TEST_TIMEOUTS)
    const w = await world({ timeouts: SHORT_SEND_TIMEOUT })
    const s = await setup(w)
    w.fake.fail('send', 'HANG')
    w.fake.fail('conversation', 'SERVER_ERROR')
    await comment(w, s, '1304', '1', 'pink.mom', '15')
    await drain(w)
    w.clock.advance(60_000)
    await drain(w)
    expect((await rows(w, s)).map((row) => [row.status, row.reason, row.message])).toEqual([['FAILED', 'UNCONFIRMED', '보내졌는지 확인하지 못했어요. 인스타그램에서 확인하고 없으면 다시 보내 주세요.']])
    expect(w.fake.count('send')).toBe(1)
    expect(w.fake.dms.length).toBeLessThanOrEqual(1)
    expect(await thanksReports(w, s.seller.sellerId)).toEqual([])
  })
})

describe('AC-N2-49 기한', () => {
  it('"다시 연결 필요"인 채 10분이 지나면 EXPIRED, 그 뒤 다시 연결해도 자동으로 보내지 않는다', async () => {
    const w = await world()
    const s = await setup(w)
    await w.server.instagram.connections.markReconnect(s.seller.sellerId)
    await comment(w, s, '1401', '1', 'pink.mom', '15')
    await drain(w)
    expect((await rows(w, s)).map((row) => [row.status, row.reason])).toEqual([['WAITING', 'RECONNECT']])
    w.clock.advance(10 * 60 * 1000)
    await drain(w)
    expect((await rows(w, s)).map((row) => [row.status, row.reason, row.message])).toEqual([['FAILED', 'EXPIRED', '너무 늦어 보내지 않았어요.']])
    expect(await connectInstagram(w, s.seller, { accounts: [s.account.id] })).toBe('CONNECTED')
    await drain(w)
    expect(w.fake.dms).toEqual([])
  })
})

describe('AC-N2-50 수동 재전송', () => {
  it('그 댓글의 다시 보낼 수 있는 FAILED 행을 모아 DM 하나로, 기한 없이, 같은 요청 번호는 한 번만', async () => {
    const w = await world()
    const s = await setup(w, { consent: false })
    await comment(w, s, '1501', '1', 'pink.mom', '15 28')
    w.clock.advance(30 * 60 * 1000)
    expect(((await client(w, s.seller.cookie).post('/api/instagram/consent', { on: true })).status)).toBe(200)
    const [first] = await rows(w, s)
    const api = client(w, s.seller.cookie)
    expect((await api.post(`/api/instagram/dms/${String(first?.id)}/resend`, {})).status).toBe(400)
    const requestId = rid('rs')
    const resent = await api.post(`/api/instagram/dms/${String(first?.id)}/resend`, { requestId })
    expect(resent.status).toBe(200)
    expect(resent.body.result).toBe('QUEUED')
    expect((await api.post(`/api/instagram/dms/${String(first?.id)}/resend`, { requestId })).body).toEqual(resent.body)
    await drain(w)
    expect(w.fake.dms.map((dm) => dm.text)).toEqual(['15번 핑크프릴 10,000원 pink.mom님 구매 감사합니다\n28번 라울 5,000원 pink.mom님 구매 감사합니다'])
    // SENT 행은 다시 보낼 수 없다
    expect((await api.post(`/api/instagram/dms/${String(first?.id)}/resend`, { requestId: rid('rs') })).body.error).toMatchObject({ code: 'DM_NOT_RESENDABLE', message: '다시 보낼 수 없는 DM이에요.' })
  })

  it('취소된 효과 → SKIPPED("확정이 풀린 판매라 보내지 않아요."), 그 댓글에 SENT가 있으면 ONE_REPLY, UNCONFIRMED는 다시 보낼 수 있다', async () => {
    // 보내기 시간 초과를 직접 본다 (SA-N2-007 — 그 밖의 시험은 TEST_TIMEOUTS)
    const w = await world({ timeouts: SHORT_SEND_TIMEOUT })
    const s = await setup(w, { consent: false })
    const api = client(w, s.seller.cookie)
    await comment(w, s, '1502', '1', 'pink.mom', '15')
    await write(w, s, { type: 'host.cancel', b: s.b, no: 15, buyer: 'ig:1', reason: '취소' })
    const cancelled = (await rows(w, s))[0] as RowView
    const skipped = await api.post(`/api/instagram/dms/${String(cancelled.id)}/resend`, { requestId: rid('rs') })
    expect([skipped.status, skipped.body.result, skipped.body.message]).toEqual([200, 'SKIPPED', '확정이 풀린 판매라 보내지 않아요.'])
    expect((skipped.body.rows as RowView[]).map((row) => [row.status, row.reason])).toEqual([['SKIPPED', 'CANCELLED']])

    expect((await api.post('/api/instagram/consent', { on: true })).status).toBe(200)
    w.fake.fail('send', 'HANG')
    w.fake.fail('conversation', 'SERVER_ERROR')
    await comment(w, s, '1503', '2', 'cactus', '28')
    await drain(w)
    const unconfirmed = (await rows(w, s)).find((row) => row.comment === 'ig:1503') as RowView
    expect(unconfirmed.reason).toBe('UNCONFIRMED')
    expect((await api.post(`/api/instagram/dms/${String(unconfirmed.id)}/resend`, { requestId: rid('rs') })).body.result).toBe('QUEUED')
    await drain(w)
    expect(w.fake.dms.map((dm) => dm.commentId)).toEqual(['1503'])
  })

  it('고른 행의 효과가 이미 완료면 "이미 보낸 감사예요."', async () => {
    const w = await world()
    const s = await setup(w, { consent: false })
    await comment(w, s, '1510', '1', 'pink.mom', '15')
    const row = (await rows(w, s))[0] as RowView
    const state = (await w.server.writer.read(s.seller.sellerId, '2026-10-19')).state
    const effectId = listEffects(state).find((effect) => effect.kind === 'POST_THANKS')?.id as string
    expect((await w.server.writer.write({ sellerId: s.seller.sellerId, date: '2026-10-19', rehearsal: false, createScope: false, requestId: null, build: () => [{ fields: { type: 'effect.thanksSent', effectId }, actor: { kind: 'server' } }] })).kind).toBe('ok')
    const result = await client(w, s.seller.cookie).post(`/api/instagram/dms/${String(row.id)}/resend`, { requestId: rid('rs') })
    expect([result.status, result.body.result, result.body.message]).toEqual([200, 'ALREADY_SENT', '이미 보낸 감사예요.'])
    expect(w.fake.dms).toEqual([])
  })

  it('연결·권한·이어진 라이브·같은 계정이 있어야 하고, 다른 판매자의 행은 404, 라이브가 끝났으면 LIVE_ENDED', async () => {
    const w = await world()
    const s = await setup(w, { consent: false })
    const api = client(w, s.seller.cookie)
    await comment(w, s, '1504', '1', 'pink.mom', '15')
    const row = (await rows(w, s))[0] as RowView
    const other = await addSeller(w)
    expect((await client(w, other.cookie).post(`/api/instagram/dms/${String(row.id)}/resend`, { requestId: rid('rs') })).status).toBe(404)
    expect((await api.post(`/api/broadcasts/${s.b}/live/unlink`, { requestId: rid('u') })).status).toBe(200)
    expect((await api.post(`/api/instagram/dms/${String(row.id)}/resend`, { requestId: rid('rs') })).body.error).toEqual({ code: 'NO_LINK', message: '이어진 인스타그램 라이브가 없어요.' })
    await linkLive(w, s.seller, s.b, s.live)
    await w.server.instagram.connections.markReconnect(s.seller.sellerId)
    expect((await api.post(`/api/instagram/dms/${String(row.id)}/resend`, { requestId: rid('rs') })).body.error).toEqual({ code: 'RECONNECT_NEEDED', message: '인스타그램 연결을 다시 해 주세요.' })
    expect(await connectInstagram(w, s.seller, { accounts: [s.account.id], declined: ['instagram_manage_messages'] })).toBe('CONNECTED')
    expect((await api.post(`/api/instagram/dms/${String(row.id)}/resend`, { requestId: rid('rs') })).body.error).toEqual({ code: 'NO_PERMISSION', message: 'DM을 보낼 권한이 없어요. 인스타그램 연결을 다시 해 주세요.' })
    expect(await connectInstagram(w, s.seller, { accounts: [s.account.id] })).toBe('CONNECTED')
    w.fake.endLive(s.live)
    expect((await api.post(`/api/instagram/dms/${String(row.id)}/resend`, { requestId: rid('rs') })).body.result).toBe('QUEUED')
    await drain(w)
    expect((await rows(w, s)).map((item) => [item.status, item.reason])).toEqual([['FAILED', 'LIVE_ENDED']])
  })

  it('이은 계정이 지금 계정과 다르면 NOT_MY_ACCOUNT', async () => {
    const w = await world()
    const s = await setup(w, { consent: false })
    await comment(w, s, '1505', '1', 'pink.mom', '15')
    const row = (await rows(w, s))[0] as RowView
    const api = client(w, s.seller.cookie)
    expect((await api.post('/api/instagram/disconnect', {})).status).toBe(200)
    const second = w.fake.addAccount({ username: 'second.shop' })
    expect(await connectInstagram(w, s.seller, { accounts: [second.id] })).toBe('CONNECTED')
    expect((await api.post(`/api/instagram/dms/${String(row.id)}/resend`, { requestId: rid('rs') })).body.error).toEqual({ code: 'NOT_MY_ACCOUNT', message: '지금 연결한 인스타그램 계정의 라이브가 아니라 보내지 않았어요.' })
  })
})

describe('AC-N2-51 실행기 하나·DM 목록·실시간 알림', () => {
  it('실행기 둘(같은 DB)이 동시에 돌아도 댓글마다 DM 1번', async () => {
    const w = await world()
    const s = await setup(w, { products: Array.from({ length: 10 }, (_, i) => [i + 1, `상품${String(i + 1)}`, 1000] as [number, string, number]) })
    for (let i = 1; i <= 10; i++) await comment(w, s, String(1600 + i), String(i), `buyer${String(i)}`, String(i))
    const second = startServer(w.database, w.masterKey, { clock: w.clock, instagram: w.fake.settings({ redirectUri: 'https://api.livejjim.test/api/instagram/callback', timeouts: TEST_TIMEOUTS }), dmAutoRun: false })
    extra.push(second)
    await Promise.all([w.server.instagram.dms.drain(), second.server.instagram.dms.drain(), w.server.instagram.dms.drain()])
    expect(w.fake.dms.map((dm) => dm.commentId).sort()).toEqual(Array.from({ length: 10 }, (_, i) => String(1601 + i)).sort())
    expect(await thanksReports(w, s.seller.sellerId)).toHaveLength(10)
  })

  it('DM 목록 필드, 리허설 범위는 빈 목록, 행 상태가 바뀌면 SSE(FAILED·SENT 모두 행으로)', async () => {
    const w = await world()
    const s = await setup(w)
    await comment(w, s, '1701', '1', 'pink.mom', '15')
    await drain(w)
    const [row] = await rows(w, s)
    expect(row).toEqual({
      id: expect.any(Number),
      broadcast: s.b,
      product: `${s.b}/15`,
      buyer: 'ig:1',
      comment: 'ig:1701',
      line: '15번 핑크프릴 10,000원 pink.mom님 구매 감사합니다',
      status: 'SENT',
      reason: null,
      message: null,
      attempts: 0,
      nextAt: null,
      sentAt: new Date(w.clock.now()).toISOString(),
      metaMessageId: w.fake.dms[0]?.messageId,
      together: [],
      createdAt: new Date(w.clock.now()).toISOString(),
    })
    expect((await client(w, s.seller.cookie).get('/api/instagram/dms?date=2026-10-19&rehearsal=true')).body).toEqual({ date: '2026-10-19', rehearsal: true, rows: [] })
    const dmNotices = w.published.filter((item) => item.sellerId === s.seller.sellerId && item.data.kind === 'DM').map((item) => (item.data.rows as RowView[]).map((view) => view.status))
    expect(dmNotices).toEqual([['WAITING'], ['SENDING'], ['SENT']])
  })
})

describe('AC-N2-52 DM 실패는 판매 상태를 바꾸지 않는다', () => {
  it('모든 DM이 실패한 방송의 범위 상태 = 같은 로그를 코어로 재생한 상태', async () => {
    const w = await world()
    const s = await setup(w)
    w.fake.fail('send', 'REJECTED', 10)
    await comment(w, s, '1801', '1', 'pink.mom', '15')
    await comment(w, s, '1802', '2', 'cactus', '15 28')
    await drain(w)
    expect((await rows(w, s)).every((row) => row.status === 'FAILED')).toBe(true)
    const state = (await w.server.writer.read(s.seller.sellerId, '2026-10-19')).state
    expect(JSON.stringify(await replay(w, s.seller.sellerId))).toBe(JSON.stringify(state))
    expect(listClaims(state).map((claim) => [claim.status, claim.locked])).toEqual([
      ['CONFIRMED', false],
      ['WAITLISTED', false],
      ['CONFIRMED', false],
    ])
  })
})
