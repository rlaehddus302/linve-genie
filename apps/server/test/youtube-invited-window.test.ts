// CH-17 초대 방송 감사 묶음 창 하한 (D-YT-SRV-18, AUTO).
// 초대받은 유튜버 방송(방송 채널 ≠ 글 올리는 계정, INV1)에서는 실시간 채팅 감사 창 = max(설정, 60초) — 남의 채팅창을 도배하지 않는다.
// 판단은 행을 처음 볼 때 그 회차 이은 기록으로(글 올리는 계정이 비면 초대 방송 아님 — D-YT-SRV-16). 내 방송은 설정 그대로.
// 할당량 묶음 모드와 겹치면 그대로 60초. 판매자 설정 값은 바꾸지 않는다. 가짜 유튜브 웹·가짜 구글만 쓴다.
import { afterEach, describe, expect, it } from 'vitest'
import { BATCH_MODE_WINDOW_SEC, INVITED_WINDOW_SEC, liveChatWindowSec } from '../src/youtube/outbox.ts'
import { addSeller, client, expectOk, writeEvent, type Seller } from './support.ts'
import { approve, callback, enableConsent, type YoutubeWorld } from './youtube-support.ts'
import { webLinked, webWorld, type WebWorld } from './youtube-web-support.ts'

const worlds: WebWorld[] = []
afterEach(async () => {
  const closing = worlds.splice(0)
  for (const item of closing) {
    await item.server.youtube?.collectors.stop()
    item.server.close()
    await item.server.stop()
  }
  for (const item of closing) {
    await item.web.close()
    await item.google?.close()
  }
})

function googleOf(w: WebWorld) {
  if (w.google === null) throw new Error('가짜 구글 없음')
  return w.google
}
const asYoutube = (w: WebWorld) => ({ ...w, fake: googleOf(w) }) as unknown as YoutubeWorld
function runner(w: WebWorld) {
  const outbox = w.server.youtube?.outbox
  if (outbox === undefined) throw new Error('유튜브가 없다')
  return outbox
}
/** 실행기 한 바퀴 — 시계를 움직이지 않는다(창 시각을 정확히 본다) */
const runOnce = (w: WebWorld) => runner(w).runOnce()

/** 사장님 구글 연결 + 실시간 채팅 게시 동의. 채널 ID를 정하면 그 채널(내 방송) */
async function connect(w: WebWorld, seller: Seller, channelId?: string) {
  const google = googleOf(w)
  const account = google.addAccount()
  const channel = google.addChannel(account, '사장님 채널', channelId)
  google.approval = { account, channel: channel.id }
  const started = await client(w, seller.cookie).post('/api/youtube/connection/start', {})
  expect(started.status, JSON.stringify(started.body)).toBe(200)
  expect(await callback(w, seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
  await enableConsent(asYoutube(w), seller, 'LIVE_CHAT')
  return channel
}

type Kind = 'invited' | 'own' | 'invited-later'

/**
 * 회차 준비 (설정은 회차를 만들기 전에).
 * - invited: 구글 연결(사장님 채널) 뒤 남의 채널 방송을 잇는다 → 글 올리는 계정 ≠ 방송 채널
 * - own: 방송 채널 = 사장님 채널
 * - invited-later: 연결 없이 이은 뒤(글 올리는 계정 빈칸) 다른 채널로 구글 연결
 */
async function setup(kind: Kind, windowSec: number) {
  const w = await webWorld({ google: true })
  worlds.push(w)
  const seller = await addSeller(w)
  expect((await client(w, seller.cookie).patch('/api/settings', { settings: { 'print.autoOnConfirm': false, 'thanks.batchWindowSec': windowSec } })).status).toBe(200)
  const video = w.web.addVideo()
  let channelId: string
  if (kind === 'own') channelId = (await connect(w, seller, video.channelId)).id
  else if (kind === 'invited') channelId = (await connect(w, seller)).id
  else channelId = ''
  const { b } = await webLinked(w, { seller, video })
  if (kind === 'invited-later') channelId = (await connect(w, seller)).id
  const chatId = googleOf(w).addBroadcast(video.channelId, { videoId: video.videoId }).liveChatId as string
  const link = (
    await w.database.pglite?.query<{ channel_id: string | null; broadcast_channel_id: string | null }>(`select channel_id, broadcast_channel_id from youtube_links where seller_id = $1`, [seller.sellerId])
  )?.rows[0]
  if (kind === 'own') expect(link).toMatchObject({ channel_id: channelId, broadcast_channel_id: video.channelId })
  if (kind === 'invited') {
    expect(link?.channel_id).toBe(channelId)
    expect(link?.broadcast_channel_id).not.toBe(channelId)
  }
  if (kind === 'invited-later') expect(link?.channel_id).toBeNull()
  return { w, seller, b, video, chatId, channelId }
}

let saleNo = 0
/** 상품 하나 + 시청자 찜 하나 (입력 우선 기록) */
async function sale(w: WebWorld, seller: Seller, b: string, nick: string) {
  saleNo++
  const no = 100 + saleNo
  await expectOk(writeEvent(w, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 10000 }))
  const outcome = await w.server.ingestChat(seller.sellerId, { b, id: `c${String(no)}`, ch: `UC${nick}`, nick, text: String(no), publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
}

interface Row {
  state: string
  reason: string | null
  nextAt: string | null
  target: string
}
async function rows(w: WebWorld, seller: Seller, date: string): Promise<Row[]> {
  const response = await client(w, seller.cookie).get(`/api/days/${date}/outbox`)
  expect(response.status).toBe(200)
  return (response.body.rows as Row[]).filter((row) => row.target === 'LIVE_CHAT')
}
const inserts = (w: WebWorld) => googleOf(w).callTimes.filter((call) => call.method === 'liveChatMessages.insert').map((call) => call.at)

/** 시계를 1초씩 움직이며 실행기를 돌린다 */
async function tick(w: WebWorld, seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await w.timer.advance(1000)
    await runOnce(w)
  }
}

describe('liveChatWindowSec (순수)', () => {
  it('설정 · 할당량 묶음 모드 · 초대 방송 하한', () => {
    expect(INVITED_WINDOW_SEC).toBe(60)
    expect(liveChatWindowSec(0, 'NORMAL', false)).toBe(0)
    expect(liveChatWindowSec(30, 'NORMAL', false)).toBe(30)
    expect(liveChatWindowSec(0, 'NORMAL', true)).toBe(60)
    expect(liveChatWindowSec(30, 'NORMAL', true)).toBe(60)
    expect(liveChatWindowSec(120, 'NORMAL', true)).toBe(120)
    expect(liveChatWindowSec(0, 'BATCH', false)).toBe(BATCH_MODE_WINDOW_SEC)
    // 겹쳐도 그대로 60
    expect(liveChatWindowSec(0, 'BATCH', true)).toBe(60)
    expect(liveChatWindowSec(30, 'BATCH', true)).toBe(60)
    expect(liveChatWindowSec(90, 'BATCH', true)).toBe(90)
  })
})

describe('D-YT-SRV-18 초대 방송 실시간 채팅 감사 창 ≥ 60초', () => {
  it('(가) 초대 방송 + 설정 0 → 판매 3건이 60초 창 하나에 묶여 게시 1번(메시지 1개). 60초 전엔 게시 0, 창 동안 기다림 이유 WINDOW', async () => {
    const { w, seller, b, chatId, channelId } = await setup('invited', 0)
    const t0 = w.timer.now()
    await sale(w, seller, b.id, '가')
    await runOnce(w)
    expect(await rows(w, seller, b.date)).toMatchObject([{ state: 'WAITING', reason: 'WINDOW', nextAt: new Date(t0 + 60_000).toISOString() }])
    await w.timer.advance(10_000)
    await sale(w, seller, b.id, '나')
    await w.timer.advance(10_000)
    await sale(w, seller, b.id, '다')
    await runOnce(w)
    expect((await rows(w, seller, b.date)).map((row) => [row.state, row.reason, row.nextAt])).toEqual(
      Array.from({ length: 3 }, () => ['WAITING', 'WINDOW', new Date(t0 + 60_000).toISOString()]),
    )
    // 59초까지 게시 없음
    await tick(w, 39)
    expect(w.timer.now() - t0).toBe(59_000)
    expect(inserts(w)).toEqual([])
    expect((await rows(w, seller, b.date)).every((row) => row.state === 'WAITING' && row.reason === 'WINDOW')).toBe(true)
    // 60초: 한 메시지로
    await tick(w, 1)
    expect(inserts(w)).toEqual([t0 + 60_000])
    const posted = googleOf(w).posted
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ liveChatId: chatId, authorChannelId: channelId })
    expect(posted[0]?.text).toContain('가님')
    expect(posted[0]?.text).toContain('나님')
    expect(posted[0]?.text).toContain('다님')
    expect((await rows(w, seller, b.date)).map((row) => row.state)).toEqual(['SENT', 'SENT', 'SENT'])
    // 판매자 설정 값은 그대로
    const settings = (await client(w, seller.cookie).get('/api/settings')).body.settings as Record<string, unknown>
    expect(settings['thanks.batchWindowSec']).toBe(0)
  })

  it('(나) 초대 방송 + 설정 120 → 창 120초', async () => {
    const { w, seller, b } = await setup('invited', 120)
    const t0 = w.timer.now()
    await sale(w, seller, b.id, '가')
    await runOnce(w)
    expect(await rows(w, seller, b.date)).toMatchObject([{ state: 'WAITING', reason: 'WINDOW', nextAt: new Date(t0 + 120_000).toISOString() }])
    await tick(w, 119)
    expect(inserts(w)).toEqual([])
    await tick(w, 1)
    expect(inserts(w)).toEqual([t0 + 120_000])
  })

  it('(다) 내 방송 + 설정 0 → 묶지 않고 한 건씩 바로 (회귀)', async () => {
    const { w, seller, b } = await setup('own', 0)
    const t0 = w.timer.now()
    await sale(w, seller, b.id, '가')
    await runOnce(w)
    await sale(w, seller, b.id, '나')
    await runOnce(w)
    expect(inserts(w)).toEqual([t0, t0])
    expect(googleOf(w).posted).toHaveLength(2)
    expect((await rows(w, seller, b.date)).map((row) => [row.state, row.reason])).toEqual([
      ['SENT', null],
      ['SENT', null],
    ])
  })

  it('(라) 연결 없이 이어 글 올리는 계정이 빈 회차는 처음 볼 때 초대 방송이 아니다 → 설정(0)대로 바로', async () => {
    const { w, seller, b, channelId, video } = await setup('invited-later', 0)
    const t0 = w.timer.now()
    await sale(w, seller, b.id, '가')
    await runOnce(w)
    expect(inserts(w)).toEqual([t0])
    expect((await rows(w, seller, b.date)).map((row) => [row.state, row.reason])).toEqual([['SENT', null]])
    // 첫 게시 때 글 올리는 계정을 적었다(D-YT-SRV-16) — 그 뒤에 처음 보는 행부터는 초대 방송
    const link = (await w.database.pglite?.query<{ channel_id: string | null }>(`select channel_id from youtube_links where seller_id = $1`, [seller.sellerId]))?.rows[0]
    expect(link?.channel_id).toBe(channelId)
    expect(channelId).not.toBe(video.channelId)
    await sale(w, seller, b.id, '나')
    await runOnce(w)
    expect(inserts(w)).toEqual([t0])
    expect((await rows(w, seller, b.date))[1]).toMatchObject({ state: 'WAITING', reason: 'WINDOW', nextAt: new Date(w.timer.now() + 60_000).toISOString() })
  })

  it('(마) 초대 방송에서 판매가 이어지면 연속 두 게시 사이가 60초 이상', async () => {
    const { w, seller, b } = await setup('invited', 0)
    // 20초마다 판매, 1초마다 실행기 — 약 4분. 한 창의 글이 200자를 넘지 않게(200자 분할은 한 창 안에서 이어 보낸다 — 불변)
    const nicks = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차']
    for (let s = 0; s < 240; s++) {
      if (s % 20 === 0) await sale(w, seller, b.id, `${nicks[(s / 20) % nicks.length] ?? '가'}${String(s)}`)
      await runOnce(w)
      await w.timer.advance(1000)
    }
    await tick(w, 70)
    const times = inserts(w)
    expect(times.length).toBeGreaterThanOrEqual(3)
    // 묶음마다 메시지 하나 (분할 없음)
    expect(googleOf(w).posted.every((post) => [...post.text].length <= 200)).toBe(true)
    for (let i = 1; i < times.length; i++) expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(60_000)
    expect((await rows(w, seller, b.date)).every((row) => row.state === 'SENT')).toBe(true)
  })

  it('할당량 묶음 모드와 겹치면 창은 그대로 60초 (설정 30)', async () => {
    const { w, seller, b } = await setup('invited', 30)
    const quota = w.server.youtube?.quota
    if (quota === undefined) throw new Error('유튜브가 없다')
    for (let i = 0; i < 410; i++) await quota.count(seller.sellerId, 'liveChatMessages.insert')
    expect(await quota.mode(seller.sellerId)).toBe('BATCH')
    const t0 = w.timer.now()
    await sale(w, seller, b.id, '가')
    await runOnce(w)
    expect(await rows(w, seller, b.date)).toMatchObject([{ state: 'WAITING', reason: 'WINDOW', nextAt: new Date(t0 + 60_000).toISOString() }])
  })
})
