// 틱톡 켜기·잇기·연결 관리·댓글 기록 통합 시험 (N2b-2, AC-N2b-2-20~24·30~38·50~53). 가짜 웹캐스트·주입한 가짜 시계로 돈다 — 바깥 연결 없음.
import { getBroadcast, listBuyers, listClaims, listProducts } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeWebcast, flushTikTokTasks, libraryWebcast, TIKTOK_MISSED_MESSAGE, type LibraryConnectionConstructor } from '../src/tiktok/index.ts'
import { TIKTOK_NOTICE } from '../src/tiktok-live/notice.ts'
import { addSeller, client, rid, waitFor } from './support.ts'
import {
  chats,
  connected,
  consentOn,
  DATE,
  linkTiktok,
  logText,
  msgId,
  realBroadcast,
  restart,
  tiktokComment,
  tiktokSeller,
  ttWorld,
  unlinkTiktok,
  type TtWorld,
} from './tiktok-live-support.ts'

const worlds: TtWorld[] = []
async function world(options: Parameters<typeof ttWorld>[0] = {}): Promise<TtWorld> {
  const w = await ttWorld(options)
  worlds.push(w)
  return w
}
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close()
})

const register = async (w: TtWorld, cookie: string, b: string, no: number, price = 10_000) => {
  const response = await client(w, cookie).post('/api/events', { requestId: rid('reg'), type: 'product.register', b, no, name: `상품${String(no)}`, price })
  expect(response.status, response.text).toBe(200)
}
const linkView = async (w: TtWorld, cookie: string, b: string) => (await client(w, cookie).get(`/api/broadcasts/${b}/tiktok`)).body.link as Record<string, unknown> & { collection: Record<string, unknown> | null }
const state = async (w: TtWorld, sellerId: string) => (await w.server.writer.read(sellerId, DATE)).state

describe('AC-N2b-2-20 위험 고지 (판 TT-BETA-1)', () => {
  it('서버가 판·제목·여덟 줄·체크 상자·단추를 내보낸다. 고지 문장 전부에 영문 글자가 없다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const body = (await client(w, seller.cookie).get('/api/tiktok')).body.tiktok as Record<string, unknown>
    expect(body.notice).toEqual(TIKTOK_NOTICE)
    expect(TIKTOK_NOTICE).toMatchObject({ version: 'TT-BETA-1', title: '틱톡 라이브 연결(베타) 안내', checkbox: '안내를 읽었고, 위 내용에 동의해요', button: '켜기' })
    expect(TIKTOK_NOTICE.lines).toHaveLength(8)
    expect(TIKTOK_NOTICE.lines[0]).toBe('틱톡은 라이브 댓글을 읽는 공식 방법을 주지 않아요. 라이브지니는 누구나 볼 수 있는 내 라이브의 댓글을 비공식 방법으로 읽어요.')
    expect(TIKTOK_NOTICE.lines[7]).toBe('언제든 설정에서 끌 수 있어요. 끄면 틱톡 댓글을 바로 그만 받아요.')
    for (const text of [TIKTOK_NOTICE.title, ...TIKTOK_NOTICE.lines, TIKTOK_NOTICE.checkbox, TIKTOK_NOTICE.button]) expect(text, text).not.toMatch(/[A-Za-z]/)
  })
})

describe('AC-N2b-2-21·22 동의 기록 — 켬·끔을 쌓는다, 동의 확인 = 기록을 읽는다', () => {
  it('켬·끔을 한 줄씩 쌓고 지금 상태 = 마지막 기록. 판이 다르면 NOTICE_CHANGED·기록 없음. 같은 요청 번호 한 번', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    expect(((await api.get('/api/tiktok')).body.tiktok as Record<string, unknown>).consent).toBeNull()
    const stale = await consentOn(w, seller, 'TT-BETA-0')
    expect([stale.status, stale.body.error]).toEqual([409, { code: 'NOTICE_CHANGED', message: '안내가 바뀌었어요. 새 안내를 읽고 다시 켜 주세요.' }])
    const requestId = rid('tc')
    const on = await api.post('/api/tiktok/consent', { requestId, on: true, version: 'TT-BETA-1' })
    expect(on.status).toBe(200)
    expect((on.body.tiktok as Record<string, unknown>).consent).toEqual({ on: true, at: new Date(w.tclock.now()).toISOString(), version: 'TT-BETA-1' })
    expect((await api.post('/api/tiktok/consent', { requestId, on: true, version: 'TT-BETA-1' })).status).toBe(200)
    await w.tclock.advance(1000)
    const off = await api.post('/api/tiktok/consent', { requestId: rid('tc'), on: false })
    expect((off.body.tiktok as Record<string, unknown>).consent).toMatchObject({ on: false, version: null })
    const rows = await w.database.pglite?.query<{ on: boolean; notice_version: string | null; account_id: string }>(`select "on", notice_version, account_id from tiktok_consents where seller_id = $1 order by id`, [seller.sellerId])
    expect(rows?.rows).toEqual([
      { on: true, notice_version: 'TT-BETA-1', account_id: seller.accountId },
      { on: false, notice_version: null, account_id: seller.accountId },
    ])
    expect(await w.server.tiktok.consentCheck(seller.sellerId)).toBe(false)
    await consentOn(w, seller)
    expect(await w.server.tiktok.consentCheck(seller.sellerId)).toBe(true)
  })

  it('지금 판과 다른 판으로 켠 마지막 기록은 동의가 아니다 (판 상수를 바꾼 서버)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    expect((await consentOn(w, seller)).status).toBe(200)
    const changed = await restart(w, { noticeVersion: 'TT-BETA-2' })
    worlds.push(changed)
    expect(await changed.server.tiktok.consentCheck(seller.sellerId)).toBe(false)
    expect(((await client(changed, seller.cookie).get('/api/tiktok')).body.tiktok as { notice: { version: string } }).notice.version).toBe('TT-BETA-2')
  })

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다
  it('다른 판매자의 기록은 보이지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    await consentOn(w, seller)
    const other = await addSeller(w)
    expect(((await client(w, other.cookie).get('/api/tiktok')).body.tiktok as Record<string, unknown>).consent).toBeNull()
  })

  it('서버 시작 경로로 만든 연결은 동의한 판매자에게만 바깥 연결을 시도한다', async () => {
    const w = await world()
    const yes = await tiktokSeller(w, { tiktokId: 'shop_yes' })
    const b1 = await realBroadcast(w, yes.seller)
    expect((await linkTiktok(w, yes.seller, b1)).status).toBe(200)
    await connected(w, yes.seller, b1)
    expect(w.webcast.handles.map((h) => h.uniqueId)).toEqual(['shop_yes'])
    // 동의를 끈 판매자: 연결 기록을 직접 넣어도(다시 켜기 이어받기 경로) 바깥 연결 없이 OFF
    const no = await tiktokSeller(w, { tiktokId: 'shop_no' })
    const b2 = await realBroadcast(w, no.seller)
    expect((await linkTiktok(w, no.seller, b2)).status).toBe(200)
    await client(w, no.seller.cookie).post('/api/tiktok/consent', { requestId: rid('off'), on: false })
    const again = await restart(w)
    worlds.push(again)
    await again.server.tiktok.resume()
    await waitFor(async () => ((await linkView(again, no.seller.cookie, b2)).collection?.state ?? '') === 'OFF')
    expect((await linkView(again, no.seller.cookie, b2)).collection).toMatchObject({ state: 'OFF', reason: 'NO_CONSENT' })
    expect(w.webcast.handles.filter((h) => h.uniqueId === 'shop_no')).toHaveLength(1)
  })
})

describe('AC-N2b-2-23 끄면 바로 멈춘다', () => {
  it('응답 전에 연결을 멈춘다 — 그 뒤 댓글 기록 0, 연결은 남고 OFF/NO_CONSENT, 다시 켜도 저절로 잇지 않는다', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    expect((await linkTiktok(w, seller, b)).status).toBe(200)
    await connected(w, seller, b)
    const handle = w.webcast.last
    const off = await client(w, seller.cookie).post('/api/tiktok/consent', { requestId: rid('off'), on: false })
    expect(off.status).toBe(200)
    expect(handle?.closedByClient).toBe(true)
    handle?.chat({ msgId: msgId(), userId: '7101', uniqueId: 'buyer', nickname: '홍길동', comment: '15' })
    await w.server.tiktok.idle()
    expect(await chats(w, seller.sellerId)).toEqual([])
    const view = await linkView(w, seller.cookie, b)
    expect(view).toMatchObject({ state: 'LINKED', collection: { state: 'OFF', reason: 'NO_CONSENT', message: '틱톡 연결이 꺼져 있어요. 안내를 읽고 동의하면 켤 수 있어요.' } })
    expect(w.tclock.pendingTimers).toBe(0)
    await consentOn(w, seller)
    await w.tclock.advance(600_000)
    expect(w.webcast.attempts).toBe(1)
    expect((await linkView(w, seller.cookie, b)).collection?.state).toBe('OFF')
    expect(tiktokId).toBeTruthy()
  })
})

describe('AC-N2b-2-24 틱톡 아이디', () => {
  it('해석해 아이디만 저장, 실패면 저장하지 않고 그 문장. 이어진 동안은 바꾸거나 지울 수 없다(TIKTOK_LINKED). 바깥 연결 0', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const saved = await api.put('/api/tiktok/account', { tiktokId: 'https://www.tiktok.com/@Seller_Kim/live' })
    expect(saved.status).toBe(200)
    expect((saved.body.tiktok as Record<string, unknown>).tiktokId).toBe('seller_kim')
    const bad = await api.put('/api/tiktok/account', { tiktokId: 'https://vm.tiktok.com/ZMabc/' })
    expect([bad.status, bad.body.error]).toEqual([
      400,
      { code: 'INVALID_TIKTOK_ID', message: '짧은 공유 주소는 쓸 수 없어요. @로 시작하는 틱톡 아이디를 넣어 주세요.', problems: [{ field: 'tiktokId', message: '짧은 공유 주소는 쓸 수 없어요. @로 시작하는 틱톡 아이디를 넣어 주세요.' }] },
    ])
    expect(bad.text).not.toContain('ZMabc')
    expect(((await api.get('/api/tiktok')).body.tiktok as Record<string, unknown>).tiktokId).toBe('seller_kim')
    await consentOn(w, seller)
    w.webcast.account('seller_kim', 'LIVE')
    const b = await realBroadcast(w, seller)
    expect((await linkTiktok(w, seller, b)).status).toBe(200)
    for (const value of ['@other_one', null]) {
      const blocked = await api.put('/api/tiktok/account', { tiktokId: value })
      expect([blocked.status, blocked.body.error]).toEqual([409, { code: 'TIKTOK_LINKED', message: '먼저 틱톡 연결을 끊어 주세요.' }])
    }
    expect((await unlinkTiktok(w, seller, b)).status).toBe(200)
    expect(((await api.put('/api/tiktok/account', { tiktokId: null })).body.tiktok as Record<string, unknown>).tiktokId).toBeNull()
  })
})

describe('AC-N2b-2-30 틱톡 잇기', () => {
  it('받으면 연결(LINKED·이은 시각·조치자·그때 아이디)을 만들고 start() 한 번 — 가짜 웹캐스트 시도 1', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    const seqBefore = (await client(w, seller.cookie).get(`/api/days/${DATE}`)).body.seq
    const requestId = rid('tl')
    const linked = await linkTiktok(w, seller, b, requestId)
    expect(linked.status, linked.text).toBe(200)
    expect(linked.body.link).toMatchObject({ broadcast: b, platform: 'TIKTOK', state: 'LINKED', linkedAt: new Date(w.tclock.now()).toISOString(), actor: { kind: 'account', loginId: seller.loginId }, tiktokId })
    await connected(w, seller, b)
    expect(w.webcast.attempts).toBe(1)
    expect((await linkTiktok(w, seller, b, requestId)).body).toEqual(linked.body)
    expect(w.webcast.attempts).toBe(1)
    expect((await client(w, seller.cookie).get(`/api/days/${DATE}`)).body.seq).toBe(seqBefore)
  })

  it('받지 않는 경우 — 아무것도 바꾸지 않고 바깥 연결 0', async () => {
    const off = await world({ beta: 'off' })
    const s0 = await tiktokSeller(off)
    const b0 = await realBroadcast(off, s0.seller)
    expect((await linkTiktok(off, s0.seller, b0)).body.error).toEqual({ code: 'PLATFORM_NOT_READY', message: '지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.' })
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const b = await realBroadcast(w, seller)
    expect((await linkTiktok(w, seller, b)).body.error).toEqual({ code: 'NO_CONSENT', message: '틱톡 연결이 꺼져 있어요. 설정에서 안내를 읽고 켜 주세요.' })
    await consentOn(w, seller)
    expect((await linkTiktok(w, seller, b)).body.error).toEqual({ code: 'NO_TIKTOK_ID', message: '설정에서 내 틱톡 아이디를 먼저 넣어 주세요.' })
    await api.put('/api/tiktok/account', { tiktokId: '@shop_a' })
    w.webcast.account('shop_a', 'LIVE')
    const rehearsal = (await api.post('/api/broadcasts', { requestId: rid('bc'), date: DATE, rehearsal: true })).body.broadcast as { id: string }
    expect((await linkTiktok(w, seller, rehearsal.id)).body.error).toEqual({ code: 'REHEARSAL', message: '리허설 방송에는 라이브를 이을 수 없어요.' })
    const ended = await realBroadcast(w, seller)
    await api.post(`/api/broadcasts/${ended}/end`, { requestId: rid('end') })
    expect((await linkTiktok(w, seller, ended)).body.error).toEqual({ code: 'ENDED', message: '끝난 방송에는 라이브를 이을 수 없어요.' })
    const received = await realBroadcast(w, seller, { 'contention.policy': 'RECEIVED_TIME' })
    expect((await linkTiktok(w, seller, received)).body.error).toEqual({
      code: 'RECEIVED_TIME_NOT_ALLOWED',
      message: "틱톡 라이브는 실제 시각순으로 판정할 수 없어요. 판매 규칙을 '접수순'으로 바꾼 뒤 새 방송을 시작해 주세요.",
    })
    await api.patch('/api/settings', { settings: { 'contention.policy': 'ARRIVAL' } })
    expect(w.webcast.attempts).toBe(0)
    expect((await linkTiktok(w, seller, b)).status).toBe(200)
    expect((await linkTiktok(w, seller, b)).body.error).toEqual({ code: 'ALREADY_LINKED', message: '이 방송에는 이미 틱톡 라이브가 이어져 있어요. 먼저 연결을 끊어 주세요.' })
    const second = await realBroadcast(w, seller)
    expect((await linkTiktok(w, seller, second)).body.error).toEqual({ code: 'TIKTOK_IN_USE', message: '이미 다른 방송에 틱톡이 이어져 있어요. 먼저 그 방송의 틱톡 연결을 끊어 주세요.' })
    const rows = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from tiktok_links where seller_id = $1`, [seller.sellerId])
    expect(rows?.rows[0]?.n).toBe(1)
    expect((await client(w, (await addSeller(w)).cookie).post(`/api/broadcasts/${b}/live/link`, { requestId: rid('x'), platform: 'TIKTOK' })).status).toBe(404)
  })
})

describe('AC-N2b-2-31~33 연결 보기·상태 알림·끊기·회차를 끝내면 멈춤', () => {
  it('보기: 모듈 상태·댓글 수·마지막 시각, 상태 알림마다 그 판매자에게만 SSE, 끊으면 stop()·NONE·그 뒤 댓글 0·다른 회차를 이을 수 있다', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const other = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    await tiktokComment(w, tiktokId, { userId: '7101000000000000001', nickname: '홍길동', comment: '15' })
    const view = await linkView(w, seller.cookie, b)
    expect(view.collection).toEqual({
      state: 'CONNECTED',
      reason: null,
      message: '틱톡 댓글을 받고 있어요.',
      failures: 0,
      nextAttemptAt: null,
      missed: false,
      missedMessage: null,
      comments: 1,
      lastCommentAt: new Date(w.tclock.now()).toISOString(),
      notRecorded: 0,
      saveFailed: 0,
      saveFailedSeen: 0,
      skipped: 0,
      signNotice: null,
    })
    expect(w.published.filter((item) => item.sellerId === seller.sellerId && item.data.kind === 'LINK').length).toBeGreaterThan(0)
    expect(w.published.some((item) => item.sellerId === other.seller.sellerId)).toBe(false)
    // 끊김 → RETRYING 알림, 다시 연결됨
    w.webcast.last?.drop()
    await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
    expect((await linkView(w, seller.cookie, b)).collection).toMatchObject({ reason: 'NETWORK', missed: true, missedMessage: TIKTOK_MISSED_MESSAGE })
    await w.tclock.advance(5000)
    await connected(w, seller, b)
    // 끊기
    const handle = w.webcast.last
    const unlinked = await unlinkTiktok(w, seller, b)
    expect(unlinked.body.link).toMatchObject({ platform: 'TIKTOK', state: 'NONE' })
    expect(handle?.closedByClient).toBe(true)
    handle?.chat({ msgId: msgId(), userId: '7102', uniqueId: 'v', nickname: 'v', comment: '15' })
    await w.server.tiktok.idle()
    expect(await chats(w, seller.sellerId)).toHaveLength(1)
    expect(w.tclock.pendingTimers).toBe(0)
    const b2 = await realBroadcast(w, seller)
    expect((await linkTiktok(w, seller, b2)).status).toBe(200)
  })

  it('회차를 끝내면 응답 전에 stop(), 끝낸 뒤 온 댓글은 그 회차에 기록하지 않고 센다, 보기는 남고 "방송을 끝내 댓글 기록을 마쳤어요." 다음 회차를 이을 수 있다', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    const handle = w.webcast.last
    // 끝내기와 같은 순간 이미 온 댓글 — 기록 순서상 broadcast.end 뒤
    w.webcast.broadcast(tiktokId, { msgId: msgId(), userId: '7101', uniqueId: 'v', nickname: '늦은', comment: '15' })
    const ended = await client(w, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') })
    expect(ended.status).toBe(200)
    expect(handle?.closedByClient).toBe(true)
    await w.server.tiktok.idle()
    const recorded = await chats(w, seller.sellerId)
    const endSeq = (await w.database.pglite?.query<{ seq: number }>(`select seq from events where seller_id = $1 and type = 'broadcast.end'`, [seller.sellerId]))?.rows[0]?.seq as number
    expect(recorded.every((chat) => chat.seq < endSeq)).toBe(true)
    const view = await linkView(w, seller.cookie, b)
    expect(view).toMatchObject({ state: 'LINKED', collection: { state: 'FINISHED', message: '방송을 끝내 댓글 기록을 마쳤어요.' } })
    expect((view.collection?.notRecorded as number) + recorded.length).toBe(1)
    const b2 = await realBroadcast(w, seller)
    expect((await linkTiktok(w, seller, b2)).status).toBe(200)
  })
})

describe('AC-N2b-2-34 다시 연결 — 30초에 한 번', () => {
  it('이어져 있지 않으면 NOT_LINKED, 잇기·다시 연결 뒤 30,000ms 전에는 TOO_SOON(start 없음), 30,000ms 정각부터 받는다', async () => {
    // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다
    const w = await world()
    const { seller } = await tiktokSeller(w, { account: 'OFFLINE' })
    const b = await realBroadcast(w, seller)
    const api = client(w, seller.cookie)
    expect((await api.post(`/api/broadcasts/${b}/tiktok/reconnect`, {})).body.error).toEqual({ code: 'NOT_LINKED', message: '이어진 틱톡 라이브가 없어요.' })
    await linkTiktok(w, seller, b)
    await w.tclock.advance(0)
    const attempts = w.webcast.attempts
    await w.tclock.advance(29_999)
    expect((await api.post(`/api/broadcasts/${b}/tiktok/reconnect`, {})).body.error).toEqual({ code: 'TOO_SOON', message: '잠시 뒤 다시 눌러 주세요.' })
    expect(w.webcast.attempts).toBe(attempts)
    await w.tclock.advance(1)
    const again = await api.post(`/api/broadcasts/${b}/tiktok/reconnect`, {})
    expect(again.status, again.text).toBe(200)
    await w.tclock.advance(0)
    await waitFor(() => w.webcast.attempts === attempts + 1)
    expect((await api.post(`/api/broadcasts/${b}/tiktok/reconnect`, {})).body.error).toMatchObject({ code: 'TOO_SOON' })
  })
})

describe('AC-N2b-2-35 서버가 다시 켜지면 이어받기', () => {
  it('끝나지 않은 실제 회차의 이어진 연결을 start(시도 1)·missed true, 다시 연결을 누르면 missed 꺼짐, 같은 댓글 ID는 한 번만', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    const id = msgId()
    w.webcast.broadcast(tiktokId, { msgId: id, userId: '7101', uniqueId: 'v', nickname: '홍길동', comment: '15' })
    await w.server.tiktok.idle()
    // 끝난 회차·끊은 연결은 이어받지 않는다
    const s2 = await tiktokSeller(w)
    const ended = await realBroadcast(w, s2.seller)
    await linkTiktok(w, s2.seller, ended)
    await client(w, s2.seller.cookie).post(`/api/broadcasts/${ended}/end`, { requestId: rid('end') })
    const fresh = new FakeWebcast().account(tiktokId, 'LIVE').account(s2.tiktokId, 'LIVE')
    const again = await restart(w, { webcast: fresh })
    worlds.push(again)
    expect(await again.server.tiktok.resume()).toBe(1)
    await connected(again, seller, b)
    expect(fresh.attempts).toBe(1)
    expect(fresh.handles.map((h) => h.uniqueId)).toEqual([tiktokId])
    expect((await linkView(again, seller.cookie, b)).collection).toMatchObject({ state: 'CONNECTED', missed: true, missedMessage: TIKTOK_MISSED_MESSAGE })
    fresh.broadcast(tiktokId, { msgId: id, userId: '7101', uniqueId: 'v', nickname: '홍길동', comment: '15' })
    await again.server.tiktok.idle()
    expect(await chats(again, seller.sellerId)).toHaveLength(1)
    await again.tclock.advance(30_000)
    fresh.last?.drop()
    await waitFor(async () => (await linkView(again, seller.cookie, b)).collection?.state === 'RETRYING')
    expect((await client(again, seller.cookie).post(`/api/broadcasts/${b}/tiktok/reconnect`, {})).status).toBe(200)
    await connected(again, seller, b)
    expect((await linkView(again, seller.cookie, b)).collection?.missed).toBe(false)
  })

  it('운영자 꺼짐으로 다시 켜면 바깥 연결 없이 OFF/OPERATOR_OFF', async () => {
    const w = await world()
    const { seller } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    const fresh = new FakeWebcast()
    const again = await restart(w, { webcast: fresh, beta: 'off' })
    worlds.push(again)
    await again.server.tiktok.resume()
    await waitFor(async () => (await linkView(again, seller.cookie, b)).collection?.state === 'OFF')
    expect((await linkView(again, seller.cookie, b)).collection).toMatchObject({ state: 'OFF', reason: 'OPERATOR_OFF' })
    expect(fresh.attempts).toBe(0)
  })
})

describe('AC-N2b-2-36 판매자 격리', () => {
  it('판매자 둘 — 연결 객체 둘, 댓글은 자기 회차에만. A의 끄기·끊기는 B에 영향 없음. 다른 판매자 회차 404', async () => {
    const w = await world()
    const a = await tiktokSeller(w, { tiktokId: 'shop_a' })
    const bSeller = await tiktokSeller(w, { tiktokId: 'shop_b' })
    const ba = await realBroadcast(w, a.seller)
    const bb = await realBroadcast(w, bSeller.seller)
    await linkTiktok(w, a.seller, ba)
    await linkTiktok(w, bSeller.seller, bb)
    await connected(w, a.seller, ba)
    await connected(w, bSeller.seller, bb)
    expect(w.server.tiktok.connections).toBe(2)
    await tiktokComment(w, 'shop_a', { userId: '7101', nickname: 'A시청자', comment: '1' })
    await tiktokComment(w, 'shop_b', { userId: '7102', nickname: 'B시청자', comment: '2' })
    expect((await chats(w, a.seller.sellerId)).map((c) => [c.b, c.nick])).toEqual([[ba, 'A시청자']])
    expect((await chats(w, bSeller.seller.sellerId)).map((c) => [c.b, c.nick])).toEqual([[bb, 'B시청자']])
    await client(w, a.seller.cookie).post('/api/tiktok/consent', { requestId: rid('off'), on: false })
    await unlinkTiktok(w, a.seller, ba)
    expect((await linkView(w, bSeller.seller.cookie, bb)).collection?.state).toBe('CONNECTED')
    for (const [path, body] of [
      [`/api/broadcasts/${bb}/live/link`, { requestId: rid('x'), platform: 'TIKTOK' }],
      [`/api/broadcasts/${bb}/live/unlink`, { requestId: rid('x'), platform: 'TIKTOK' }],
      [`/api/broadcasts/${bb}/tiktok/reconnect`, {}],
      [`/api/broadcasts/${bb}/paste/preview`, { text: 'a: 1' }],
    ] as const) {
      expect((await client(w, a.seller.cookie).post(path, body)).status, path).toBe(404)
    }
    expect((await client(w, a.seller.cookie).get(`/api/broadcasts/${bb}/tiktok`)).status).toBe(404)
  })
})

describe('AC-N2b-2-37 받는 순서 = 기록 순서', () => {
  it('저장을 늦춰도 100개를 몰아 보내면 seq 순서 = 보낸 순서, 다른 입력과 섞여도 seq가 겹치지 않는다', async () => {
    let slow = false
    const w = await world({ overrides: { hooks: { beforeCommit: async () => (slow ? new Promise((resolve) => setTimeout(resolve, 3)) : undefined) } } })
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 1)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    slow = true
    const sent: string[] = []
    for (let i = 0; i < 100; i += 1) {
      const id = msgId()
      sent.push(`tt:${id}`)
      w.webcast.broadcast(tiktokId, { msgId: id, userId: String(7100 + i), uniqueId: `v${String(i)}`, nickname: `시청자${String(i)}`, comment: i % 10 === 0 ? '1' : '안녕' })
      if (i === 50) void client(w, seller.cookie).post('/api/events', { requestId: rid('sms'), type: 'sms', b, no: 1, received: '12:00' })
    }
    await w.server.tiktok.idle()
    await waitFor(async () => (await chats(w, seller.sellerId)).length === 100)
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((c) => c.id)).toEqual(sent)
    const seqs = (await w.database.pglite?.query<{ seq: number }>(`select seq from events where seller_id = $1 order by seq`, [seller.sellerId]))?.rows.map((r) => r.seq) ?? []
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('기록이 실패한 댓글(DB 오류)은 로그 코드만 남기고 연결은 계속된다 — 실패 수를 연결 보기에 센다', async () => {
    let failing = false
    const w = await world({
      overrides: {
        hooks: {
          beforeCommit: (records) => {
            if (failing && records.some((r) => r.type === 'chat')) throw new Error('planted-db-error')
          },
        },
      },
    })
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    failing = true
    await tiktokComment(w, tiktokId, { userId: '7101', nickname: 'PLANTED-NICK', comment: 'PLANTED-TEXT-15' })
    failing = false
    await tiktokComment(w, tiktokId, { userId: '7102', nickname: '다음', comment: '안녕' })
    const view = await linkView(w, seller.cookie, b)
    // 끝내 저장하지 못하면 판매자에게 알린다 — "받지 못했을 수 있음"이 켜지고 붙여넣기를 안내한다 (RA-N2b-2-02)
    expect(view.collection).toMatchObject({ state: 'CONNECTED', saveFailed: 1, comments: 1, missed: true, missedMessage: '저장하지 못한 틱톡 댓글이 1개 있어요. 틱톡 앱에서 확인해 댓글을 붙여 넣어 주세요.' })
    expect(w.logs.map((l) => l.code)).toContain('TIKTOK_SAVE_FAILED')
    expect(logText(w.logs)).not.toMatch(/PLANTED-NICK|PLANTED-TEXT-15|planted-db-error/)
    expect(w.published.some((p) => p.sellerId === seller.sellerId && JSON.stringify(p.data).includes('저장하지 못한 틱톡 댓글'))).toBe(true)
  })

  it('짧은 저장 실패(두 번 실패 뒤 성공)는 기다렸다가 다시 써서 댓글을 버리지 않는다 — 받은 순서 그대로 (RA-N2b-2-02)', async () => {
    let failures = 0
    const w = await world({
      overrides: {
        hooks: {
          beforeCommit: (records) => {
            if (failures > 0 && records.some((r) => r.type === 'chat')) {
              failures -= 1
              throw new Error('planted-db-error')
            }
          },
        },
      },
    })
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    failures = 2
    await tiktokComment(w, tiktokId, { userId: '7101', nickname: '첫째', comment: '15' })
    await tiktokComment(w, tiktokId, { userId: '7102', nickname: '둘째', comment: '16' })
    await w.server.tiktok.idle()
    const view = await linkView(w, seller.cookie, b)
    expect(view.collection).toMatchObject({ saveFailed: 0, comments: 2, missed: false, missedMessage: null })
    expect((await chats(w, seller.sellerId)).map((c) => c.nick)).toEqual(['첫째', '둘째'])
  })
})

describe('AC-N2b-2-38 운영자 스위치·라이브러리 환경 변수', () => {
  it('경고 코드 TIKTOK_BETA_INVALID(값 없이), 라이브러리 변수가 있으면 스위치가 켜져 있어도 꺼짐 — ready 아니오·잇기 PLATFORM_NOT_READY·로그 TIKTOK_LIBRARY_ENV(이름만)', async () => {
    const invalid = await world({ beta: 'planted-switch' })
    expect(invalid.logs.filter((l) => l.code === 'TIKTOK_BETA_INVALID')).toHaveLength(1)
    expect(logText(invalid.logs)).not.toContain('planted-switch')
    const w = await world({ libraryEnv: ['SIGN_API_URL'] })
    expect(w.logs.filter((l) => l.code === 'TIKTOK_LIBRARY_ENV').map((l) => l.reason)).toEqual(['SIGN_API_URL'])
    const { seller } = await tiktokSeller(w)
    const platforms = (await client(w, seller.cookie).get('/api/platforms')).body.platforms as { platform: string; ready: boolean }[]
    expect(platforms.find((p) => p.platform === 'TIKTOK')?.ready).toBe(false)
    const b = await realBroadcast(w, seller)
    expect((await linkTiktok(w, seller, b)).body.error).toMatchObject({ code: 'PLATFORM_NOT_READY' })
    expect(w.webcast.attempts).toBe(0)
  })
})

describe('AC-N2b-2-50~53 레코드 → chat 기록', () => {
  it('조치자 collector·at = 서버 기록 시각, 방송자 댓글은 찜 없음, 같은 (회차, tt:) 재수신은 한 번 — G-ENG-N2b-2-01과 같은 결과', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w, { tiktokId: 'dayook_shop' })
    const b = await realBroadcast(w, seller)
    await register(w, seller.cookie, b, 15)
    await register(w, seller.cookie, b, 16)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    await tiktokComment(w, tiktokId, { userId: '7101000000000000001', uniqueId: 'buyer_a', nickname: '@pink.mom', comment: '15' })
    await tiktokComment(w, tiktokId, { userId: '7999999999999999991', uniqueId: 'Dayook_Shop', nickname: '다육이네', comment: '16' })
    const rows = await w.database.pglite?.query<{ actor: string; at: string; received_at: string }>(`select actor, to_char(at, 'X') as at, received_at::text from events where seller_id = $1 and type = 'chat'`, [seller.sellerId])
    expect(rows?.rows.every((row) => row.actor === 'collector')).toBe(true)
    const recorded = await chats(w, seller.sellerId)
    expect(recorded.map((c) => [c.ch, c.nick, c.owner])).toEqual([
      ['tt:7101000000000000001', 'pink·mom', false],
      ['tt:7999999999999999991', '다육이네', true],
    ])
    const s = await state(w, seller.sellerId)
    expect(listClaims(s).map((c) => [c.buyer, c.status])).toEqual([['tt:7101000000000000001', 'CONFIRMED']])
    expect(listProducts(s).find((p) => p.no === 16)?.winnerClaims).toEqual([])
    expect(listBuyers(s).map((buyer) => buyer.id)).toContain('tt:7101000000000000001')
    expect(getBroadcast(s, b)?.ended).toBe(false)
  })

  it('중복 2차 방어: 모듈 기억(2만 개)을 넘겨 밀려난 ID를 다시 보내도 chat 하나', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    const first = msgId()
    w.webcast.broadcast(tiktokId, { msgId: first, userId: '7101', uniqueId: 'v', nickname: 'v', comment: '안녕' })
    await w.server.tiktok.idle()
    for (let i = 0; i < 20_000; i += 1) w.webcast.broadcast(tiktokId, { msgId: `9${String(i).padStart(18, '0')}`, userId: '7102', uniqueId: 'w', nickname: 'w', comment: '안녕' })
    await w.server.tiktok.idle()
    w.webcast.broadcast(tiktokId, { msgId: first, userId: '7101', uniqueId: 'v', nickname: 'v', comment: '안녕' })
    await w.server.tiktok.idle()
    const rows = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where seller_id = $1 and chat_message_id = $2`, [seller.sellerId, `tt:${first}`])
    expect(rows?.rows[0]?.n).toBe(1)
  }, 180_000)

  it('많은 댓글: 서로 다른 1만 개(50개씩 몰아 보내기 포함) → chat 1만 개, 빠짐·두 번 0, seq 순서 = 보낸 순서', async () => {
    const w = await world()
    const { seller, tiktokId } = await tiktokSeller(w)
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    await connected(w, seller, b)
    const sent: string[] = []
    for (let i = 0; i < 10_000; i += 1) {
      const id = `8${String(i).padStart(18, '0')}`
      sent.push(`tt:${id}`)
      w.webcast.broadcast(tiktokId, { msgId: id, userId: String(7000 + (i % 300)), uniqueId: 'v', nickname: '시청자', comment: '안녕' })
      if (i % 50 === 49) await flushTikTokTasks()
    }
    await w.server.tiktok.idle()
    const rows = await w.database.pglite?.query<{ id: string }>(`select chat_message_id as id from events where seller_id = $1 and type = 'chat' order by seq`, [seller.sellerId])
    expect(rows?.rows.map((r) => r.id)).toEqual(sent)
  }, 180_000)
})

describe('AC-N2b-2-41 실제 감싸개 경로 (서버 연결) — 늦게 열린 연결', () => {
  it('바꿔 끼운 라이브러리가 25초 뒤 성공해도 열린 연결은 많아야 하나, 버린 연결의 댓글은 기록 0', async () => {
    const opened = { now: 0, max: 0 }
    const libs: { state: string; emit: (event: string, ...args: unknown[]) => void }[] = []
    let tclockRef: { setTimer(ms: number, fn: () => void): () => void } | null = null
    class Slow {
      state = 'idle'
      #listeners = new Map<string, ((...args: unknown[]) => void)[]>()
      constructor() {
        libs.push(this)
      }
      connect() {
        return new Promise((resolve) => {
          tclockRef?.setTimer(25_000, () => {
            this.state = 'open'
            opened.now += 1
            opened.max = Math.max(opened.max, opened.now)
            resolve({})
          })
        })
      }
      disconnect() {
        if (this.state === 'open') opened.now -= 1
        this.state = 'closed'
      }
      on(event: string, listener: (...args: unknown[]) => void) {
        this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener])
        return this
      }
      emit(event: string, ...args: unknown[]) {
        for (const l of this.#listeners.get(event) ?? []) l(...args)
      }
    }
    const { FakeTikTokClock } = await import('../src/tiktok/index.ts')
    const tclock = new FakeTikTokClock(Date.UTC(2026, 9, 19, 3))
    tclockRef = tclock
    const w = await world({ tclock, factory: libraryWebcast({ Connection: Slow as unknown as LibraryConnectionConstructor, clock: tclock }) })
    const seller = await addSeller(w)
    await consentOn(w, seller)
    await client(w, seller.cookie).put('/api/tiktok/account', { tiktokId: '@slow_shop' })
    const b = await realBroadcast(w, seller)
    await linkTiktok(w, seller, b)
    await w.tclock.advance(20_000)
    await waitFor(async () => (await linkView(w, seller.cookie, b)).collection?.state === 'RETRYING')
    await w.tclock.advance(5000)
    libs[0]?.emit('chat', { common: { msgId: msgId() }, user: { userId: '7101', uniqueId: 'v', nickname: 'v' }, comment: '15' })
    await w.tclock.advance(60_000)
    await w.server.tiktok.idle()
    expect(opened.max).toBeLessThanOrEqual(1)
    expect(libs[0]?.state).toBe('closed')
    expect(await chats(w, seller.sellerId)).toEqual([])
  })
})
