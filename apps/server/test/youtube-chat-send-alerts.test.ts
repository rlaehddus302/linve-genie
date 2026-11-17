// D-YT-SEND-22 감사 채팅 봇 로그인 확인·운영자 문자 알림. 가짜 감사 받는 곳(계정 목록·보내기)과 가짜 문자 — 유튜브·문자 업체 실제 주소로는 아무것도 보내지 않는다.
// - 로그인 확인은 읽기만(계정 목록): 고른 계정이 있으면 ok, 풀린 쿠키(실물: 200에 계정 없음)는 auth, /sorry는 blocked.
// - 풀은 풀린 계정을 쉬게 하고 운영 로그를 남기고, 문자 알림은 그 로그를 보고 운영자에게 한 통(같은 일은 정한 시간에 한 번).
// - 서버는 시작 1분 뒤와 그 뒤 6시간마다 확인한다.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readOpsAlertPhone } from '../src/config.ts'
import type { LogRecord } from '../src/log.ts'
import type { SmsSender } from '../src/social/phone.ts'
import { BOT_ALERT_TEXTS, BotAlerts, ENGINE_ALERT_MS, LOGIN_ALERT_MS, ROUTE_ALERT_MS } from '../src/youtube/chat-send/bot-alerts.ts'
import { FakeChatSend, fakeBotCookie } from '../src/youtube/chat-send/fake-chat-send.ts'
import { InnertubeChatSender } from '../src/youtube/chat-send/innertube-sender.ts'
import { ChatSenderPool } from '../src/youtube/chat-send/pool.ts'
import { chatSendRoute } from '../src/youtube/chat-send/sender.ts'
import { BOT_SELLER_ID } from '../src/youtube/connect.ts'
import { BOT_CHECK_EVERY_MS, BOT_CHECK_FIRST_MS } from '../src/youtube/system.ts'
import { webWorld, type WebWorld } from './youtube-web-support.ts'

const bot = (n: number) => `UCbot${String(n).padStart(19, '0')}`
const PHONE = '01012345678'

let fake: FakeChatSend
beforeAll(async () => {
  fake = await FakeChatSend.start()
})
afterAll(async () => {
  await fake.close()
})
afterEach(() => {
  fake.loggedOut.clear()
  fake.innertubeAccountFaults.clear()
})

function smsBox(fail = false): SmsSender & { sent: { to: string; text: string }[] } {
  const sent: { to: string; text: string }[] = []
  return {
    sent,
    send: async (to, text) => {
      if (fail) throw new Error('문자 실패')
      sent.push({ to, text })
    },
  }
}

const clockTimer = () => {
  let now = 1_800_000_000_000
  return { now: () => now, sleep: async () => {}, advance: (ms: number) => (now += ms) }
}

function pool(log: LogRecord[]) {
  const timer = clockTimer()
  const senders = [1, 2].map((n) => new InnertubeChatSender({ cookie: fakeBotCookie(n), authorChannelId: bot(n), timer, fetch: fake.youtubeFetch, gapMs: 0, timeoutMs: 2000 }))
  const p = new ChatSenderPool(senders, timer)
  p.setLog((record) => log.push(record))
  return { pool: p, senders }
}

describe('D-YT-SEND-22 봇 로그인 확인 (읽기만)', () => {
  it('로그인돼 있으면 ok, 쿠키가 풀리면 auth, 서버 막힘이면 blocked — 보내기는 하지 않는다', async () => {
    const { senders } = pool([])
    const [one] = senders
    if (one === undefined) throw new Error('계정 없음')
    expect(await one.checkLogin()).toBe('ok')
    fake.loggedOut.add('bot-1')
    expect(await one.checkLogin()).toBe('auth')
    fake.loggedOut.clear()
    fake.innertubeAccountFaults.set('bot-1', { kind: 'blocked' })
    expect(await one.checkLogin()).toBe('blocked')
    expect(fake.posts).toHaveLength(0)
  })

  it('풀은 풀린 계정만 쉬게 하고 운영 로그(계정 번호)를 남긴다', async () => {
    const log: LogRecord[] = []
    const { pool: p } = pool(log)
    fake.loggedOut.add('bot-2')
    expect(await p.checkAccounts()).toEqual([
      { number: 1, state: 'ok' },
      { number: 2, state: 'auth' },
    ])
    expect(p.available()).toBe(1)
    expect(log).toEqual([expect.objectContaining({ code: 'CHAT_SEND_ACCOUNT_DOWN', errorKind: 'auth', count: 2 })])
  })

  it('서버 막힘이면 모든 계정을 쉬게 하고 남은 계정은 확인하지 않는다', async () => {
    const log: LogRecord[] = []
    const { pool: p } = pool(log)
    fake.innertubeAccountFaults.set('bot-1', { kind: 'blocked' })
    expect(await p.checkAccounts()).toEqual([{ number: 1, state: 'blocked' }])
    expect(p.available()).toBe(0)
    expect(log).toEqual([expect.objectContaining({ code: 'CHAT_SEND_ACCOUNT_DOWN', errorKind: 'blocked', count: 0 })])
  })
})

describe('D-YT-SEND-22 운영자 문자 알림', () => {
  it('계정 로그인 풀림·못 올림·서버 막힘·공식 넘김·공식 봇 연결 풀림마다 한 통, 같은 일은 정한 시간 안에 다시 보내지 않는다', async () => {
    const sms = smsBox()
    const timer = clockTimer()
    const alerts = new BotAlerts({ sms, phone: PHONE, now: timer.now })
    alerts.observe({ level: 'error', code: 'CHAT_SEND_ACCOUNT_DOWN', route: 'innertube', errorKind: 'auth', count: 2 })
    alerts.observe({ level: 'error', code: 'CHAT_SEND_ACCOUNT_DOWN', route: 'innertube', errorKind: 'auth', count: 2 })
    alerts.observe({ level: 'error', code: 'CHAT_SEND_ACCOUNT_DOWN', route: 'innertube', errorKind: 'rejected', count: 1 })
    alerts.observe({ level: 'error', code: 'CHAT_SEND_ACCOUNT_DOWN', route: 'innertube', errorKind: 'blocked', count: 0 })
    alerts.observe({ level: 'error', code: 'CHAT_SEND_FAILOVER', route: 'innertube', errorKind: 'blocked' })
    alerts.observe({ level: 'error', code: 'CHAT_SEND_FAILOVER', route: 'innertube', errorKind: 'auth' })
    alerts.observe({ level: 'warn', code: 'YOUTUBE_RECONNECT_NEEDED', seller: BOT_SELLER_ID })
    // 판매자 연결의 다시 연결 필요는 판매자 화면이 알린다 — 운영자 문자 아님
    alerts.observe({ level: 'warn', code: 'YOUTUBE_RECONNECT_NEEDED', seller: 'sel_someone' })
    await Promise.resolve()
    expect(sms.sent.map((item) => item.text)).toEqual([BOT_ALERT_TEXTS.login(2), BOT_ALERT_TEXTS.rejected(1), BOT_ALERT_TEXTS.blocked(), BOT_ALERT_TEXTS.failover(), BOT_ALERT_TEXTS.official()])
    expect(sms.sent.every((item) => item.to === PHONE)).toBe(true)
    // 넘김은 6시간 뒤, 로그인 풀림은 12시간 뒤에 다시 보낸다
    timer.advance(ROUTE_ALERT_MS)
    alerts.observe({ level: 'error', code: 'CHAT_SEND_FAILOVER', route: 'innertube', errorKind: 'auth' })
    alerts.observe({ level: 'error', code: 'CHAT_SEND_ACCOUNT_DOWN', route: 'innertube', errorKind: 'auth', count: 2 })
    timer.advance(LOGIN_ALERT_MS - ROUTE_ALERT_MS)
    alerts.observe({ level: 'error', code: 'CHAT_SEND_ACCOUNT_DOWN', route: 'innertube', errorKind: 'auth', count: 2 })
    await Promise.resolve()
    expect(sms.sent.slice(5).map((item) => item.text)).toEqual([BOT_ALERT_TEXTS.failover(), BOT_ALERT_TEXTS.login(2)])
  })

  it('문자 보내기가 실패해도 던지지 않는다', async () => {
    const alerts = new BotAlerts({ sms: smsBox(true), phone: PHONE, now: () => 0 })
    expect(() => alerts.observe({ level: 'error', code: 'CHAT_SEND_FAILOVER', route: 'innertube', errorKind: 'auth' })).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(alerts.sent).toBe(1)
  })

  it('문자 내용에 쿠키·채널·판매자 정보가 없고 쉬운 한국어다', () => {
    for (const text of [BOT_ALERT_TEXTS.login(1), BOT_ALERT_TEXTS.rejected(2), BOT_ALERT_TEXTS.blocked(), BOT_ALERT_TEXTS.failover(), BOT_ALERT_TEXTS.official()]) {
      expect(text).not.toMatch(/UC[A-Za-z0-9_-]{22}|SAPISID|sel_|sys_/)
    }
  })

  it('운영자 휴대폰 설정: 비면 끔, 010 번호(하이픈 허용)만, 틀리면 끄고 경고', () => {
    expect(readOpsAlertPhone({})).toEqual({ phone: null, invalid: false })
    expect(readOpsAlertPhone({ LIVEJJIM_OPS_ALERT_PHONE: '010-1234-5678' })).toEqual({ phone: '01012345678', invalid: false })
    expect(readOpsAlertPhone({ LIVEJJIM_OPS_ALERT_PHONE: '02-123-4567' })).toEqual({ phone: null, invalid: true })
    expect(readOpsAlertPhone({ LIVEJJIM_OPS_ALERT_PHONE: 'abc' })).toEqual({ phone: null, invalid: true })
  })
})

describe('D-ALERTFLOAT-01 엔진이 처리하지 못한 입력 → 운영자 문자 (판매자 화면의 "확인 필요" 대신)', () => {
  it('ENGINE_FAILED 로그를 보면 날짜·번호만 담아 한 통, 1시간 안의 다음 것은 보내지 않는다', () => {
    const sms = smsBox()
    const timer = clockTimer()
    const alerts = new BotAlerts({ sms, phone: PHONE, now: timer.now })
    alerts.observe({ level: 'error', code: 'ENGINE_FAILED', seller: 's1', date: '2026-11-17', seq: 42, errorKind: 'unknown' } as LogRecord)
    alerts.observe({ level: 'error', code: 'ENGINE_FAILED', seller: 's1', date: '2026-11-17', seq: 43, errorKind: 'unknown' } as LogRecord)
    expect(alerts.sent).toBe(1)
    expect(BOT_ALERT_TEXTS.engine('2026-11-17', 42)).toContain('2026-11-17 42번')
    expect(BOT_ALERT_TEXTS.engine('2026-11-17', 42)).not.toContain('s1')
    timer.advance(ENGINE_ALERT_MS)
    alerts.observe({ level: 'error', code: 'ENGINE_FAILED', seller: 's1', date: '2026-11-17', seq: 44, errorKind: 'unknown' } as LogRecord)
    expect(alerts.sent).toBe(2)
  })
})

describe('D-YT-SEND-22 서버: 시작 1분 뒤·6시간마다 확인 → 풀리면 운영자 문자', () => {
  const worlds: WebWorld[] = []
  afterEach(async () => {
    for (const w of worlds.splice(0)) {
      await w.server.youtube?.stop()
      w.server.close()
      await w.server.stop()
      await w.web.close()
    }
  })

  it('봇 계정 2 로그인이 풀리면 확인에서 찾아 쉬게 하고 운영자에게 문자 한 통', async () => {
    const sms = smsBox()
    let current: WebWorld | null = null
    const timer = { now: () => (current as WebWorld).timer.now(), sleep: (ms: number, signal?: AbortSignal) => (current as WebWorld).timer.sleep(ms, signal) }
    const botPool = new ChatSenderPool(
      [1, 2].map((n) => new InnertubeChatSender({ cookie: fakeBotCookie(n), authorChannelId: bot(n), timer, fetch: fake.youtubeFetch, gapMs: 0, timeoutMs: 2000 })),
      timer,
    )
    const w = await webWorld({ chatSend: chatSendRoute(botPool, '*'), overrides: { opsAlert: { sms, phone: PHONE } } })
    current = w
    worlds.push(w)
    const youtube = w.server.youtube
    if (youtube === undefined || youtube === null) throw new Error('유튜브 없음')
    fake.loggedOut.add('bot-2')
    // 확인 반복만 돌린다 (수집기·발송함 바퀴는 이 시험과 상관없다 — 시계를 6시간 옮겨도 빠르게)
    youtube.startBotCheck()
    const before = fake.calls.accountCheck
    await w.timer.advance(BOT_CHECK_FIRST_MS - 1000)
    expect(fake.calls.accountCheck).toBe(before)
    await w.timer.advance(1000)
    await expect.poll(() => fake.calls.accountCheck).toBe(before + 2)
    await expect.poll(() => sms.sent.map((item) => item.text)).toEqual([BOT_ALERT_TEXTS.login(2)])
    expect(botPool.available()).toBe(1)
    // 6시간 뒤 다시 확인 (풀린 그대로여도 12시간 안이라 문자는 다시 보내지 않는다)
    await w.timer.advance(BOT_CHECK_EVERY_MS)
    await expect.poll(() => fake.calls.accountCheck).toBe(before + 4)
    expect(sms.sent).toHaveLength(1)
    expect(fake.posts).toHaveLength(0)
  })
})
