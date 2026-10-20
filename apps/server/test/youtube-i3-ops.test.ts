// AC-I3-81·82 유튜브 워커의 운영 상태·경보 (SYS-05, DAT-02, D-073, D-I3-16):
// 확인하지 못한 감사 OUTBOX_UNCONFIRMED, 다시 시도를 다 쓴 감사 OUTBOX_GAVE_UP, 저절로 이어받지 않는 수집 멈춤 COLLECTOR_STOPPED, 구글 할당량 초과 QUOTA_EXCEEDED —
// 정해진 코드·셈·판매자 ID·범위 날짜만(채팅·닉네임·토큰·전화번호·IP·오류 메시지 없음). 운영 상태는 합친 숫자만.
import { afterEach, describe, expect, it } from 'vitest'
import type { LogRecord } from '../src/log.ts'
import { client, expectOk, writeEvent } from './support.ts'
import { connectSeller, drive, linkedBroadcast, until, youtubeWorld, type Connected, type YoutubeWorld } from './youtube-support.ts'

const TOKEN = 'ops-token-for-youtube-tests-0123456789'
const worlds: YoutubeWorld[] = []
async function world(): Promise<YoutubeWorld> {
  const created = await youtubeWorld({ overrides: { opsToken: TOKEN } })
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

async function rowState(w: YoutubeWorld, connected: Connected, date: string): Promise<{ state: string; reason: string | null } | undefined> {
  return ((await client(w, connected.seller.cookie).get(`/api/days/${date}/outbox`)).body.rows as { state: string; reason: string | null }[])[0]
}

const alerts = (w: YoutubeWorld) => w.logs.filter((record): record is LogRecord => record.level === 'alert')

async function oneSale(w: YoutubeWorld, nick = '비밀닉네임') {
  const connected = await connectSeller(w, { publish: 'LIVE_CHAT', channelTitle: '비밀채널이름' })
  const linked = await linkedBroadcast(w, connected, { title: '비밀방송제목', settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
  await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: linked.b.id, no: 15, name: '비밀상품', price: 10000 }))
  const outcome = await w.server.ingestChat(connected.seller.sellerId, { b: linked.b.id, id: 'c1', ch: 'UCsecretViewer0000000000', nick, text: '15', publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
  return { connected, ...linked }
}

const SECRETS = ['비밀닉네임', '비밀채널이름', '비밀방송제목', '비밀상품', 'UCsecretViewer', 'fake-at-', 'fake-rt-', 'Bearer']

describe('AC-I3-82 유튜브 워커 경보', () => {
  it('확인하지 못한 감사 → OUTBOX_UNCONFIRMED (판매자 ID·범위 날짜만)', async () => {
    const w = await world()
    const { connected, b } = await oneSale(w)
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    w.fake.fail('liveChatMessages.list', { status: 503 }, 20)
    await run(w)
    await runUntil(w, async () => (await rowState(w, connected, b.date))?.state === 'FAILED')
    expect(alerts(w)).toContainEqual({ level: 'alert', code: 'OUTBOX_UNCONFIRMED', count: 1, seller: connected.seller.sellerId, date: b.date })
    const text = JSON.stringify(alerts(w))
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret)
  })

  it('다시 시도를 다 쓴 감사 → OUTBOX_GAVE_UP', async () => {
    const w = await world()
    const { connected, b } = await oneSale(w)
    w.fake.fail('liveChatMessages.insert', { status: 503 }, 10)
    await run(w)
    await runUntil(w, async () => (await rowState(w, connected, b.date))?.reason === 'GAVE_UP', 5000)
    expect(alerts(w)).toContainEqual({ level: 'alert', code: 'OUTBOX_GAVE_UP', count: 1, seller: connected.seller.sellerId, date: b.date })
  })

  it('구글 할당량 초과 → QUOTA_EXCEEDED, 같은 판매자는 10분에 한 번(그 사이 수는 다음 count)', async () => {
    const w = await world()
    const { connected, b } = await oneSale(w)
    w.fake.fail('liveChatMessages.insert', { status: 403, reason: 'quotaExceeded' }, 3)
    await run(w)
    await youtubeOf(w).quota.markExceeded(connected.seller.sellerId)
    await youtubeOf(w).quota.markExceeded(connected.seller.sellerId)
    const quota = alerts(w).filter((record) => record.code === 'QUOTA_EXCEEDED')
    expect(quota).toEqual([{ level: 'alert', code: 'QUOTA_EXCEEDED', count: 1, seller: connected.seller.sellerId }])
    await w.timer.advance(10 * 60 * 1000)
    await youtubeOf(w).quota.markExceeded(connected.seller.sellerId)
    expect(alerts(w).filter((record) => record.code === 'QUOTA_EXCEEDED').at(-1)).toEqual({ level: 'alert', code: 'QUOTA_EXCEEDED', count: 3, seller: connected.seller.sellerId })
    expect(b.date).toBe('2026-10-19')
  })

  it('저절로 이어받지 않는 수집 멈춤(채팅 꺼짐) → COLLECTOR_STOPPED, 저절로 이어받는 멈춤(다시 연결 필요)은 경보가 아니다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b } = await linkedBroadcast(w, connected, { title: '비밀방송제목' })
    w.fake.fail('liveChatMessages.streamList', { status: 403, reason: 'liveChatDisabled' })
    youtubeOf(w).collectors.start()
    await until(w, async () => ((await client(w, connected.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { reason: string | null }).reason === 'CHAT_DISABLED', { step: 100 })
    expect(alerts(w)).toContainEqual({ level: 'alert', code: 'COLLECTOR_STOPPED', count: 1, seller: connected.seller.sellerId })
    expect(w.server.health.view().collector.lastSuccessAt).not.toBeNull()
    // 다시 연결 필요(RECONNECT)로 멈춘 수집은 경보가 아니다 (판매자 화면에 경고가 뜨고 다시 연결하면 이어받는다)
    const other = await connectSeller(w)
    await linkedBroadcast(w, other)
    await youtubeOf(w).connections.markReconnect(other.seller.sellerId)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(alerts(w).filter((record) => record.code === 'COLLECTOR_STOPPED' && record.seller === other.seller.sellerId)).toEqual([])
  })
})

describe('AC-I3-81 운영 상태 — 유튜브 숫자', () => {
  it('수집 상태별·발송함 상태·이유별 수, 남은 일, 오늘 프로젝트 할당량 — 판매자를 가리는 값은 없다', async () => {
    const w = await world()
    const { connected } = await oneSale(w)
    w.fake.fail('liveChatMessages.insert', { status: 400, reason: 'messageTextInvalid' })
    await run(w)
    const response = await w.server.app.request('/ops/status', { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(response.status).toBe(200)
    const text = await response.text()
    for (const secret of [...SECRETS, connected.seller.sellerId, connected.channel.id, connected.seller.loginId]) expect(text, secret).not.toContain(secret)
    const body = JSON.parse(text) as {
      collectors: Record<string, unknown>
      outbox: { date: string; byState: Record<string, Record<string, number>>; pending: { WAITING: number; SENDING: number } }
      quota: { day: string; used: number; limit: number; exceeded: boolean }
      workers: { outbox: { lastSuccessAt: string | null; consecutiveFailures: number } }
    }
    expect(body.outbox).toEqual({ date: '2026-10-19', byState: { FAILED: { REJECTED: 1 } }, pending: { WAITING: 0, SENDING: 0 } })
    expect(body.collectors).toEqual({ STARTING: { NONE: 1 } })
    expect(body.quota).toMatchObject({ limit: 10_000, exceeded: false })
    expect(body.quota.used).toBeGreaterThan(0)
    expect(body.workers.outbox.consecutiveFailures).toBe(0)
    expect(body.workers.outbox.lastSuccessAt).not.toBeNull()
  })
})
