// AC-I3-36 발송함 정리 — 게시됨 확인("유튜브에 올라가 있어요")·알림에서 빼기 (YT-06, R-7 3, R-13, INV-11, D-I3-05).
// 확인하지 못한 감사(FAILED(UNCONFIRMED))를 판매자가 유튜브에서 본 뒤 게시됨으로 적으면 그 메시지의 행 모두 SENT·게시 보고(조치자 = 판매자 계정) —
// 공개 감사가 나간 확정은 잠겨 늦게 온 선순위 문자찜이 자동으로 밀어내지 못한다(충돌). 다시 게시하지 않는다.
import { afterEach, describe, expect, it } from 'vitest'
import { client, createBroadcast, expectOk, login, writeEvent } from './support.ts'
import { connectSeller, drive, linkedBroadcast, youtubeWorld, type Connected, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
async function world(): Promise<YoutubeWorld> {
  const created = await youtubeWorld()
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

const NO_LABEL = { 'print.autoOnConfirm': false }

interface Row {
  id: number
  target: string
  state: string
  reason: string | null
  text: string
  messageId: string | null
  postedAt: string | null
  groupWith: number[]
  confirmedBySeller: boolean
  dismissed: boolean
  dismissedAt: string | null
}

function youtubeOf(w: YoutubeWorld) {
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  return youtube
}
const run = (w: YoutubeWorld) => drive(w, youtubeOf(w).outbox.runOnce())

async function runUntil(w: YoutubeWorld, predicate: () => Promise<boolean>, step = 2000, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await predicate()) return
    await w.timer.advance(step)
    await run(w)
  }
  if (!(await predicate())) throw new Error('기다린 조건이 되지 않았다')
}

async function rows(w: YoutubeWorld, connected: Connected, date: string): Promise<Row[]> {
  const response = await client(w, connected.seller.cookie).get(`/api/days/${date}/outbox`)
  expect(response.status).toBe(200)
  return response.body.rows as Row[]
}

async function chat(w: YoutubeWorld, connected: Connected, b: string, id: string, ch: string, nick: string, text: string) {
  const outcome = await w.server.ingestChat(connected.seller.sellerId, { b, id, ch, nick, text, publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
}

async function product(w: YoutubeWorld, connected: Connected, b: string, no: number, name: string, price: number) {
  await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b, no, name, price }))
}

async function thanksReports(w: YoutubeWorld): Promise<{ actor: string; account_id: string | null; body: string }[]> {
  return ((await w.database.pglite?.query<{ actor: string; account_id: string | null; body: string }>(`select actor, account_id, body from events where type = 'effect.thanksSent' order by id`))?.rows ?? [])
}

/** 15번·16번을 두 시청자가 사서 묶음 창(30초)에 함께 들어간 감사 둘 — 게시는 받고 응답 없음 + 모든 조회 실패 → 묶음 둘 다 UNCONFIRMED */
async function unconfirmedPair(w: YoutubeWorld, settings: Record<string, unknown> = {}) {
  const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
  const linked = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 30, ...settings } })
  await product(w, connected, linked.b.id, 15, '핑크프릴', 10000)
  await product(w, connected, linked.b.id, 16, '라울', 5000)
  await chat(w, connected, linked.b.id, 'c1', 'UCviewer1', '홍길동', '15')
  await chat(w, connected, linked.b.id, 'c2', 'UCviewer2', '김철수', '16')
  w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
  w.fake.fail('liveChatMessages.list', { status: 503 }, 40)
  await run(w)
  await runUntil(w, async () => (await rows(w, connected, linked.b.date)).every((row) => row.state === 'FAILED'))
  const list = await rows(w, connected, linked.b.date)
  expect(list.map((row) => [row.state, row.reason])).toEqual([
    ['FAILED', 'UNCONFIRMED'],
    ['FAILED', 'UNCONFIRMED'],
  ])
  expect(list[0]?.groupWith).toEqual([list[1]?.id])
  w.fake.clearFaults()
  return { connected, ...linked, list }
}

const PAIR_TEXT = '15번 핑크프릴 10,000원 홍길동님, 16번 라울 5,000원 김철수님 구매 감사합니다'

describe('AC-I3-36 게시됨 확인', () => {
  it('타임아웃 → UNCONFIRMED(묶음 둘) → 게시됨 확인 → 두 행 SENT·게시 보고 2개(조치자 판매자)·다시 게시 0 → 늦게 온 선순위 문자찜은 자동 역전이 아니라 충돌', async () => {
    const w = await world()
    const { connected, b, liveChatId, list } = await unconfirmedPair(w, { 'contention.policy': 'RECEIVED_TIME' })
    expect(w.fake.messages(liveChatId).filter((message) => message.text === PAIR_TEXT)).toHaveLength(1)
    expect(await thanksReports(w)).toEqual([])
    const api = client(w, connected.seller.cookie)
    const confirmed = await api.post(`/api/outbox/${String(list[1]?.id)}/confirm-posted`, { requestId: 'cp-1' })
    expect(confirmed.status, confirmed.text).toBe(200)
    const confirmedRows = confirmed.body.rows as Row[]
    expect(confirmedRows.map((row) => [row.id, row.state, row.reason, row.messageId, row.confirmedBySeller])).toEqual([
      [list[0]?.id, 'SENT', null, null, true],
      [list[1]?.id, 'SENT', null, null, true],
    ])
    expect(confirmedRows[0]?.postedAt).toBe(new Date(w.timer.now()).toISOString())
    const reports = await thanksReports(w)
    expect(reports).toHaveLength(2)
    for (const report of reports) expect([report.actor, report.account_id]).toEqual(['account', connected.seller.accountId])
    // 실행기를 더 돌려도 다시 게시하지 않고 보고도 더 생기지 않는다
    for (let i = 0; i < 5; i++) {
      await w.timer.advance(60_000)
      await run(w)
    }
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    expect(w.fake.messages(liveChatId).filter((message) => message.text === PAIR_TEXT)).toHaveLength(1)
    expect(await thanksReports(w)).toHaveLength(2)
    // 15번의 1등(홍길동)은 공개 감사가 나간 확정이라 잠겼다 — 실제 시각이 더 이른 문자찜이 늦게 와도 자동으로 밀어내지 않고 충돌
    const view = await api.get(`/api/days/${b.date}`)
    const claim = (view.body.claims as { buyer: string; no: number; locked: boolean }[]).find((item) => item.buyer === 'UCviewer1')
    expect(claim?.locked).toBe(true)
    await expectOk(writeEvent(w, connected.seller, { type: 'sms', b: b.id, no: 15, received: '11:59', phone: '010-5555-6666' }))
    const after = await api.get(`/api/days/${b.date}`)
    const p15 = (after.body.products as { no: number; winners: string[]; conflict: boolean }[]).find((item) => item.no === 15)
    expect(p15?.conflict).toBe(true)
    expect(p15?.winners).toEqual(['UCviewer1'])
  })

  it('같은 요청 번호로 두 번 → 처음 결과, 보고 2개 그대로 / 다른 요청 번호로 이미 게시된 행 → 409 CONFIRM_NOT_ALLOWED', async () => {
    const w = await world()
    const { connected, list } = await unconfirmedPair(w)
    const api = client(w, connected.seller.cookie)
    const first = await api.post(`/api/outbox/${String(list[0]?.id)}/confirm-posted`, { requestId: 'cp-same' })
    expect(first.status).toBe(200)
    const again = await api.post(`/api/outbox/${String(list[0]?.id)}/confirm-posted`, { requestId: 'cp-same' })
    expect(again.status).toBe(200)
    expect((again.body.rows as Row[]).map((row) => [row.id, row.state, row.confirmedBySeller])).toEqual((first.body.rows as Row[]).map((row) => [row.id, row.state, row.confirmedBySeller]))
    expect(await thanksReports(w)).toHaveLength(2)
    const other = await api.post(`/api/outbox/${String(list[1]?.id)}/confirm-posted`, { requestId: 'cp-other' })
    expect(other.status).toBe(409)
    expect(other.body).toEqual({ error: { code: 'CONFIRM_NOT_ALLOWED', message: '확인하지 못한 감사만 올라가 있다고 적을 수 있어요.' } })
    // 같은 요청 번호를 다른 행에 쓰면 거절
    expect((await api.post(`/api/outbox/${String(list[1]?.id)}/confirm-posted`, { requestId: 'cp-same' })).status).toBe(409)
    expect(await thanksReports(w)).toHaveLength(2)
    // 요청 번호가 없으면 400
    expect((await api.post(`/api/outbox/${String(list[1]?.id)}/confirm-posted`, {})).status).toBe(400)
  })

  it('확정이 이미 풀린 효과도 보고는 기록한다 (엔진이 잠금 없이 실행 완료로 둔다 — R-13 늦은 보고)', async () => {
    const w = await world()
    const { connected, b, list } = await unconfirmedPair(w)
    await expectOk(writeEvent(w, connected.seller, { type: 'host.cancel', b: b.id, no: 15, buyer: 'UCviewer1', reason: '취소' }))
    const confirmed = await client(w, connected.seller.cookie).post(`/api/outbox/${String(list[0]?.id)}/confirm-posted`, { requestId: 'cp-late' })
    expect(confirmed.status).toBe(200)
    expect(await thanksReports(w)).toHaveLength(2)
    const view = await client(w, connected.seller.cookie).get(`/api/days/${b.date}`)
    const effects = view.body.effects as { status: string; buyer: string }[]
    expect(effects.filter((effect) => effect.status === 'DONE')).toHaveLength(2)
  })

  it('보내는 중(실행기가 집은 SENDING) 행은 409 — 실행기와 경합 없이 한쪽만, 확인 중에도 다시 게시 없음', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCviewer1', '홍길동', '15')
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    await run(w)
    const [row] = await rows(w, connected, b.date)
    expect(row?.state).toBe('SENDING')
    const api = client(w, connected.seller.cookie)
    expect((await api.post(`/api/outbox/${String(row?.id)}/confirm-posted`, { requestId: 'cp-s' })).body).toEqual({ error: { code: 'CONFIRM_NOT_ALLOWED', message: '확인하지 못한 감사만 올라가 있다고 적을 수 있어요.' } })
    expect((await api.post(`/api/outbox/${String(row?.id)}/dismiss`, {})).body).toEqual({ error: { code: 'DISMISS_NOT_ALLOWED', message: '보내지 못한 감사만 알림에서 뺄 수 있어요.' } })
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENDING', confirmedBySeller: false, dismissed: false })
  })
})

describe('AC-I3-36 알림에서 빼기', () => {
  it('FAILED 행만 — 상태·이유 그대로 "알림에서 뺌"(시각), 다시 빼도 같은 결과, SSE outbox. 뺀 행을 다시 보내면 게시 1번·표시는 지워진다', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCviewer1', '홍길동', '15')
    w.fake.fail('liveChatMessages.insert', { status: 400, reason: 'messageTextInvalid' })
    await run(w)
    const [row] = await rows(w, connected, b.date)
    expect(row).toMatchObject({ state: 'FAILED', reason: 'REJECTED', dismissed: false, dismissedAt: null })
    const published: unknown[] = []
    const original = w.server.hub.publishYoutube.bind(w.server.hub)
    w.server.hub.publishYoutube = (sellerId, data) => {
      published.push(data)
      original(sellerId, data)
    }
    const api = client(w, connected.seller.cookie)
    const dismissed = await api.post(`/api/outbox/${String(row?.id)}/dismiss`, {})
    expect(dismissed.status, dismissed.text).toBe(200)
    expect(dismissed.body.row).toMatchObject({ id: row?.id, state: 'FAILED', reason: 'REJECTED', dismissed: true, dismissedAt: new Date(w.timer.now()).toISOString() })
    expect(published).toContainEqual({ kind: 'outbox', date: b.date, ids: [row?.id], state: 'FAILED', reason: 'REJECTED', dismissed: true })
    const firstAt = (dismissed.body.row as Row).dismissedAt
    await w.timer.advance(5000)
    const again = await api.post(`/api/outbox/${String(row?.id)}/dismiss`, {})
    expect(again.status).toBe(200)
    expect((again.body.row as Row).dismissedAt).toBe(firstAt)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'REJECTED', dismissed: true })
    // 다시 보내기는 그대로 된다 — 게시 1번
    const resent = await api.post(`/api/outbox/${String(row?.id)}/resend`, { requestId: 'rs-dismissed' })
    expect(resent.status, resent.text).toBe(200)
    expect(resent.body.row).toMatchObject({ state: 'WAITING', dismissed: false, dismissedAt: null })
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT', dismissed: false })
    expect(w.fake.posted.filter((post) => post.liveChatId === liveChatId)).toHaveLength(1)
  })

  it('동의하지 않아 보내지 않은 행(NO_CONSENT)도 뺄 수 있다 — 게시됨 확인은 409', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCviewer1', '홍길동', '15')
    await run(w)
    const [row] = await rows(w, connected, b.date)
    expect(row).toMatchObject({ state: 'FAILED', reason: 'NO_CONSENT' })
    const api = client(w, connected.seller.cookie)
    expect((await api.post(`/api/outbox/${String(row?.id)}/confirm-posted`, { requestId: 'cp-nc' })).status).toBe(409)
    expect((await api.post(`/api/outbox/${String(row?.id)}/dismiss`, {})).status).toBe(200)
  })
})

describe('AC-I3-36·97 판매자만·격리·리허설·봉인', () => {
  it('남의·없는 행 404, 리허설 행 409, 봉인한 범위 409 SEALED, 모르는 필드 400', async () => {
    // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다
    const w = await world()
    const { connected, b, list } = await unconfirmedPair(w)
    const other = await connectSeller(w)
    const theirs = client(w, other.seller.cookie)
    for (const path of [`/api/outbox/${String(list[0]?.id)}/confirm-posted`, `/api/outbox/${String(list[0]?.id)}/dismiss`]) {
      const response = await theirs.post(path, path.endsWith('dismiss') ? {} : { requestId: 'x-1' })
      expect(response.status, path).toBe(404)
    }
    const api = client(w, connected.seller.cookie)
    expect((await api.post('/api/outbox/999999/dismiss', {})).status).toBe(404)
    expect((await api.post('/api/outbox/abc/dismiss', {})).status).toBe(404)
    expect((await api.post(`/api/outbox/${String(list[0]?.id)}/dismiss`, { why: 1 })).status).toBe(400)
    // 리허설 행
    const rehearsal = await createBroadcast(w, connected.seller, { rehearsal: true })
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: rehearsal.id, no: 1, name: '연습', price: 1000 }))
    await expectOk(api.post(`/api/broadcasts/${rehearsal.id}/rehearsal/chat`, { requestId: 'rv-1', nick: '연습생', text: '1' }))
    const rehearsalRows = await w.database.pglite?.query<{ id: number }>(`select id from outbox where rehearsal = true and kind = 'POST_THANKS'`)
    const rehearsalId = rehearsalRows?.rows[0]?.id
    expect(rehearsalId).toBeTypeOf('number')
    for (const path of [`/api/outbox/${String(rehearsalId)}/confirm-posted`, `/api/outbox/${String(rehearsalId)}/dismiss`]) {
      const response = await api.post(path, path.endsWith('dismiss') ? {} : { requestId: 'r-1' })
      expect(response.status, path).toBe(409)
      expect(response.body).toEqual({ error: { code: 'REHEARSAL_OUTBOX', message: '리허설 감사 메시지는 유튜브에 올리지 않아요.' } })
    }
    // 봉인한 범위 (30일 뒤)
    await w.timer.advance(31 * 24 * 60 * 60 * 1000)
    expect(await w.server.sealer.runOnce()).toBe(1)
    // 세션(30일)이 지나 다시 로그인
    const later = client(w, await login(w, connected.seller.loginId, connected.seller.password))
    for (const path of [`/api/outbox/${String(list[0]?.id)}/confirm-posted`, `/api/outbox/${String(list[0]?.id)}/dismiss`]) {
      const response = await later.post(path, path.endsWith('dismiss') ? {} : { requestId: 's-1' })
      expect(response.status, path).toBe(409)
      expect((response.body.error as { code: string }).code).toBe('SEALED')
    }
    expect(b.date).toBe('2026-10-19')
  })
})
