// 봇 계정 여럿·공식 API 넘김 (D-YT-SEND-12·13) — 흉내 보내기로 고르기·쉼·넘김 규칙만 본다(네트워크 없음).
import { describe, expect, it } from 'vitest'
import { CHAT_SEND_MESSAGES, readYoutubeChatSend } from '../src/config.ts'
import type { LogRecord } from '../src/log.ts'
import { parseAccounts } from '../src/youtube/chat-send/create.ts'
import { isBlockedResponse } from '../src/youtube/chat-send/innertube-sender.ts'
import { officialFailure } from '../src/youtube/chat-send/official-sender.ts'
import { AUTH_REST_MS, BLOCKED_REST_MS, ChatSenderPool, HOLD_IDLE_MS, RATE_REST_MS } from '../src/youtube/chat-send/pool.ts'
import { ChatSendError, FailoverSender, chatSendRoute, type ChatSender, type ChatSendFailure, type ChatSendResult, type ChatSendTarget } from '../src/youtube/chat-send/sender.ts'
import { ChannelMismatchError } from '../src/youtube/connect.ts'
import { GoogleError } from '../src/youtube/google.ts'

const ch = (n: number) => `UCbot${String(n).padStart(19, '0')}`
const target = (videoId: string): ChatSendTarget => ({ videoId, channelId: 'UCseller000000000000000', liveChatId: '' })

class Clock {
  t = 1_000_000
  now = () => this.t
  sleep = async () => {}
}

class Stub implements ChatSender {
  readonly route = 'innertube' as const
  readonly needsLiveChatId = false
  readonly authorChannelId: string
  readonly calls: string[] = []
  /** 영상마다 계속 낼 실패 (없으면 성공) */
  fail: ChatSendFailure | null = null
  constructor(n: number) {
    this.authorChannelId = ch(n)
  }
  async send(t: ChatSendTarget, text: string): Promise<ChatSendResult> {
    this.calls.push(`${t.videoId}:${text}`)
    if (this.fail !== null) throw new ChatSendError(this.fail)
    return { messageId: `Ch-${this.authorChannelId}-${String(this.calls.length)}` }
  }
  async close() {}
}

function pool(n: number) {
  const clock = new Clock()
  const stubs = Array.from({ length: n }, (_, i) => new Stub(i + 1))
  const logs: LogRecord[] = []
  const created = new ChatSenderPool(stubs, clock)
  created.setLog((record) => logs.push(record))
  return { clock, stubs, logs, pool: created }
}

describe('D-YT-SEND-12 봇 계정 풀', () => {
  it('방송마다 가장 적게 맡은 계정을 붙이고, 그 방송은 같은 계정으로 — 작성자는 그 계정', async () => {
    const { stubs, pool: p } = pool(2)
    expect((await p.send(target('A'), '1')).authorChannelId).toBe(ch(1))
    expect((await p.send(target('B'), '1')).authorChannelId).toBe(ch(2))
    await p.send(target('A'), '2')
    await p.send(target('B'), '2')
    expect(stubs[0]?.calls).toEqual(['A:1', 'A:2'])
    expect(stubs[1]?.calls).toEqual(['B:1', 'B:2'])
    expect(p.assigned('A')).toBe(ch(1))
    expect(p.authorChannelIds).toEqual([ch(1), ch(2)])
  })

  it('D-YT-SEND-23 끝난 라이브는 계정을 잡지 않는다: 20분 넘게 올리지 않은 방송은 맡은 수에서 빠져 다음 라이브도 1번 계정 (운영 2026-11-23 — 2번으로 갔다)', async () => {
    const { clock, pool: p } = pool(2)
    expect((await p.send(target('A'), '1')).authorChannelId).toBe(ch(1))
    // A가 아직 올리는 중(20분 안)이면 동시 라이브 B는 2번
    clock.t += HOLD_IDLE_MS - 1
    expect((await p.send(target('B'), '1')).authorChannelId).toBe(ch(2))
    // A는 20분 넘게 조용하고 B는 아직 올리는 중 → 새 라이브 C는 놀고 있는 1번
    clock.t += 2
    await p.send(target('B'), '2')
    expect((await p.send(target('C'), '1')).authorChannelId).toBe(ch(1))
    expect(p.assigned('B')).toBe(ch(2))
  })

  it('D-YT-SEND-23 운영 그대로: 1번이 맡았던 라이브가 끝나고 다음 라이브가 오면 2번이 아니라 1번', async () => {
    const { clock, pool: p } = pool(2)
    for (let i = 0; i < 31; i += 1) expect((await p.send(target('A'), String(i))).authorChannelId).toBe(ch(1))
    clock.t += 56 * 60 * 1000
    expect((await p.send(target('B'), '1')).authorChannelId).toBe(ch(1))
    // 오래 조용했던 A도 다시 올리면 맡던 1번 그대로 (작성자가 바뀌지 않게)
    expect((await p.send(target('A'), 'again')).authorChannelId).toBe(ch(1))
  })

  it('D-YT-SEND-23 채팅이 끝났다(ended)는 답을 받은 라이브는 바로 계정을 놓는다', async () => {
    const { stubs, pool: p } = pool(2)
    await p.send(target('A'), '1')
    ;(stubs[0] as Stub).fail = 'ended'
    await expect(p.send(target('A'), '2')).rejects.toMatchObject({ kind: 'ended' })
    expect(p.assigned('A')).toBeNull()
    ;(stubs[0] as Stub).fail = null
    expect((await p.send(target('B'), '1')).authorChannelId).toBe(ch(1))
  })

  it('로그인 풀림(auth) → 같은 감사를 다음 계정으로 한 번, 그 계정은 10분 쉼·경보, 방송도 새 계정으로', async () => {
    const { clock, stubs, logs, pool: p } = pool(2)
    await p.send(target('A'), '1')
    ;(stubs[0] as Stub).fail = 'auth'
    const result = await p.send(target('A'), '2')
    expect(result.authorChannelId).toBe(ch(2))
    expect(stubs[0]?.calls).toEqual(['A:1', 'A:2'])
    expect(stubs[1]?.calls).toEqual(['A:2'])
    expect(p.assigned('A')).toBe(ch(2))
    expect(p.available()).toBe(1)
    expect(logs).toEqual([expect.objectContaining({ code: 'CHAT_SEND_ACCOUNT_DOWN', errorKind: 'auth', count: 1 })])
    ;(stubs[0] as Stub).fail = null
    clock.t += AUTH_REST_MS
    expect(p.available()).toBe(2)
    // 쉼이 끝나면 새 방송을 다시 맡는다 (A는 계정 2에 그대로)
    expect((await p.send(target('B'), '1')).authorChannelId).toBe(ch(1))
    expect((await p.send(target('A'), '3')).authorChannelId).toBe(ch(2))
  })

  it('속도 제한(rate) → 다음 계정, 1분 쉼', async () => {
    const { clock, stubs, pool: p } = pool(2)
    ;(stubs[0] as Stub).fail = 'rate'
    expect((await p.send(target('A'), '1')).authorChannelId).toBe(ch(2))
    expect(p.available()).toBe(1)
    clock.t += RATE_REST_MS
    expect(p.available()).toBe(2)
  })

  for (const kind of ['timeout', 'network', 'unverified', 'server', 'ended'] as const) {
    it(`${kind} → 다른 계정으로 넘기지 않고 그대로 던진다 (두 번 올리지 않음)`, async () => {
      const { stubs, pool: p } = pool(2)
      ;(stubs[0] as Stub).fail = kind
      const error = await p.send(target('A'), '1').catch((e: unknown) => e)
      expect((error as ChatSendError).kind).toBe(kind)
      expect(stubs[1]?.calls).toEqual([])
      expect(p.available()).toBe(2)
    })
  }

  // D-YT-SEND-14 (실물: 채널 없는 계정은 send_message 400 badRequest — 글이 틀린 400과 같은 모양)
  it('거절(400) → 다음 계정으로 한 번 더, 올라가면 거절한 계정은 10분 쉼·경보, 방송은 올린 계정에', async () => {
    const { stubs, logs, pool: p } = pool(2)
    ;(stubs[0] as Stub).fail = 'rejected'
    const result = await p.send(target('A'), '1')
    expect(result.authorChannelId).toBe(ch(2))
    expect(p.assigned('A')).toBe(ch(2))
    expect(p.available()).toBe(1)
    expect(logs).toEqual([expect.objectContaining({ code: 'CHAT_SEND_ACCOUNT_DOWN', errorKind: 'rejected', count: 1 })])
  })

  it('모든 계정이 거절(400) → 글 탓 — rejected를 던지고 아무도 쉬지 않는다', async () => {
    const { stubs, logs, pool: p } = pool(2)
    for (const stub of stubs) stub.fail = 'rejected'
    expect(((await p.send(target('A'), '1').catch((e: unknown) => e)) as ChatSendError).kind).toBe('rejected')
    expect(stubs.map((stub) => stub.calls.length)).toEqual([1, 1])
    expect(p.available()).toBe(2)
    expect(logs).toEqual([])
  })

  it('서버 막힘(blocked) → 모든 계정 5분 쉼·blocked, 그동안은 부르지도 않고 blocked', async () => {
    const { clock, stubs, logs, pool: p } = pool(3)
    ;(stubs[0] as Stub).fail = 'blocked'
    expect(((await p.send(target('A'), '1').catch((e: unknown) => e)) as ChatSendError).kind).toBe('blocked')
    expect(stubs[1]?.calls).toEqual([])
    expect(p.available()).toBe(0)
    expect(logs.at(-1)).toMatchObject({ code: 'CHAT_SEND_ACCOUNT_DOWN', errorKind: 'blocked', count: 0 })
    expect(((await p.send(target('B'), '1').catch((e: unknown) => e)) as ChatSendError).kind).toBe('blocked')
    expect(stubs.map((stub) => stub.calls.length)).toEqual([1, 0, 0])
    ;(stubs[0] as Stub).fail = null
    clock.t += BLOCKED_REST_MS
    expect((await p.send(target('B'), '1')).messageId).not.toBeNull()
  })

  it('모든 계정이 로그인 풀림 → blocked (쓸 수 있는 계정 없음)', async () => {
    const { stubs, pool: p } = pool(2)
    for (const stub of stubs) stub.fail = 'auth'
    expect(((await p.send(target('A'), '1').catch((e: unknown) => e)) as ChatSendError).kind).toBe('blocked')
    expect(stubs.map((stub) => stub.calls.length)).toEqual([1, 1])
  })

  it('계정 채널이 겹치거나 길이 다르면 만들지 않는다', () => {
    expect(() => new ChatSenderPool([new Stub(1), new Stub(1)], new Clock())).toThrow()
    expect(() => new ChatSenderPool([], new Clock())).toThrow()
  })
})

describe('D-YT-SEND-13 공식 API 넘김', () => {
  const official = () => {
    const stub = new Stub(9)
    return Object.assign(stub, { route: 'official' as const }) as unknown as Stub
  }

  for (const kind of ['auth', 'rate', 'blocked'] as const) {
    it(`봇 길이 ${kind}(올라가지 않음 확실) → 공식으로 한 번, 작성자 = 공식 봇 채널, 경보`, async () => {
      const primary = new Stub(1)
      primary.fail = kind
      const fallback = official()
      const logs: LogRecord[] = []
      const sender = new FailoverSender(primary, fallback)
      sender.setLog((record) => logs.push(record))
      const result = await sender.send(target('A'), '감사')
      expect(result.authorChannelId).toBe(ch(9))
      expect(fallback.calls).toEqual(['A:감사'])
      expect(logs).toEqual([expect.objectContaining({ code: 'CHAT_SEND_FAILOVER', route: 'innertube', errorKind: kind })])
    })
  }

  for (const kind of ['timeout', 'network', 'unverified', 'server', 'rejected', 'ended'] as const) {
    it(`봇 길이 ${kind} → 넘기지 않는다 (공식 0번)`, async () => {
      const primary = new Stub(1)
      primary.fail = kind
      const fallback = official()
      const error = await new FailoverSender(primary, fallback).send(target('A'), '감사').catch((e: unknown) => e)
      expect((error as ChatSendError).kind).toBe(kind)
      expect(fallback.calls).toEqual([])
    })
  }

  it('길에 넘김을 붙이면 우리 글 작성자에 풀 계정 모두와 공식 봇 채널이 든다', () => {
    const p = new ChatSenderPool([new Stub(1), new Stub(2)], new Clock())
    const route = chatSendRoute(p, ['s1']).withFallback(official())
    expect(route.authorsFor('s1')).toEqual([ch(1), ch(2), ch(9)])
    expect(route.authorsFor('s2')).toEqual([])
  })

  it('공식 API 오류 → 실패 종류', () => {
    expect(officialFailure(new GoogleError('http', 403, 'quotaExceeded')).kind).toBe('rate')
    expect(officialFailure(new GoogleError('http', 403, 'liveChatEnded')).kind).toBe('ended')
    expect(officialFailure(new GoogleError('http', 403, 'insufficientPermissions')).kind).toBe('auth')
    expect(officialFailure(new GoogleError('http', 503, null)).kind).toBe('server')
    expect(officialFailure(new GoogleError('timeout', null, null)).kind).toBe('timeout')
    expect(officialFailure(new GoogleError('http', 400, 'messageTextInvalid')).kind).toBe('rejected')
    expect(officialFailure(new ChannelMismatchError()).kind).toBe('auth')
  })
})

describe('D-YT-SEND-12 서버 막힘 알아보기', () => {
  const response = (url: string, status: number, type: string) => ({ url, status, headers: new Headers({ 'content-type': type }) })
  it('/sorry로 돌려보냄·HTML 429는 막힘, JSON 429(계정 속도 제한)·200은 아님', () => {
    expect(isBlockedResponse(response('https://www.google.com/sorry/index?continue=x', 429, 'text/html'))).toBe(true)
    expect(isBlockedResponse(response('https://www.youtube.com/sorry/index', 200, 'text/html'))).toBe(true)
    expect(isBlockedResponse(response('https://www.youtube.com/youtubei/v1/live_chat/send_message', 429, 'text/html; charset=UTF-8'))).toBe(true)
    expect(isBlockedResponse(response('https://www.youtube.com/youtubei/v1/live_chat/send_message', 429, 'application/json'))).toBe(false)
    expect(isBlockedResponse(response('https://www.youtube.com/youtubei/v1/live_chat/send_message', 200, 'application/json'))).toBe(false)
  })
})

describe('D-YT-SEND-12·13 설정', () => {
  const base = { LIVEJJIM_YT_SEND_ROUTE: 'innertube', LIVEJJIM_YT_SEND_SELLERS: '*' }
  it('계정 목록 파일 + 공식 넘김', () => {
    expect(readYoutubeChatSend({ ...base, LIVEJJIM_YT_SEND_ACCOUNTS_FILE: '/run/secrets/bots.json', LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID: ch(9) })).toEqual({
      ok: true,
      send: { route: 'innertube', sellers: '*', single: null, accountsFile: '/run/secrets/bots.json', chromiumPath: null, official: { channelId: ch(9) } },
    })
  })
  it('계정 하나와 목록을 함께 적거나, nightbot에 목록이면 시작하지 않는다', () => {
    expect(readYoutubeChatSend({ ...base, LIVEJJIM_YT_SEND_ACCOUNTS_FILE: '/a.json', LIVEJJIM_YT_SEND_CHANNEL_ID: ch(1) })).toEqual({ ok: false, message: CHAT_SEND_MESSAGES.ACCOUNTS })
    expect(readYoutubeChatSend({ ...base, LIVEJJIM_YT_SEND_ROUTE: 'nightbot', LIVEJJIM_YT_SEND_ACCOUNTS_FILE: '/a.json' })).toEqual({ ok: false, message: CHAT_SEND_MESSAGES.ACCOUNTS })
  })
  // D-YT-SEND-21: 봇 연결은 시스템 판매자에 둔다 — 판매자 ID 칸(옛 LIVEJJIM_YT_SEND_OFFICIAL_SELLER)은 읽지 않고 채널 ID만
  it('공식 넘김은 봇 채널 ID만 (형식이 틀리면 시작하지 않는다, 옛 판매자 ID 칸은 읽지 않는다)', () => {
    const one = { ...base, LIVEJJIM_YT_SEND_CHANNEL_ID: ch(1), LIVEJJIM_YT_SEND_SECRET_FILE: '/s' }
    expect(readYoutubeChatSend({ ...one, LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID: 'bad' })).toEqual({ ok: false, message: CHAT_SEND_MESSAGES.OFFICIAL })
    expect(readYoutubeChatSend({ ...one, LIVEJJIM_YT_SEND_OFFICIAL_SELLER: 's_bot' })).toMatchObject({ ok: true, send: { official: null } })
    expect(readYoutubeChatSend({ ...one, LIVEJJIM_YT_SEND_OFFICIAL_SELLER: 's_bot', LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID: ch(9) })).toMatchObject({ ok: true, send: { official: { channelId: ch(9) } } })
  })
  // D-YT-SEND-20·21: 공식 API 봇이 기본 길 — 봇 채널만, 비공식 계정 칸은 비워야
  it('official-bot: 봇 채널이 있어야 하고 비공식 계정 칸은 쓰지 않는다', () => {
    const ob = { LIVEJJIM_YT_SEND_ROUTE: 'official-bot', LIVEJJIM_YT_SEND_SELLERS: '*', LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID: ch(9) }
    expect(readYoutubeChatSend(ob)).toEqual({ ok: true, send: { route: 'official-bot', sellers: '*', single: null, accountsFile: null, chromiumPath: null, official: { channelId: ch(9) } } })
    expect(readYoutubeChatSend({ ...ob, LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID: '' })).toEqual({ ok: false, message: CHAT_SEND_MESSAGES.OFFICIAL_BOT })
    expect(readYoutubeChatSend({ ...ob, LIVEJJIM_YT_SEND_ACCOUNTS_FILE: '/a.json' })).toEqual({ ok: false, message: CHAT_SEND_MESSAGES.OFFICIAL_BOT })
  })

  it('계정 목록 파일 모양', () => {
    expect(parseAccounts(JSON.stringify([{ channelId: ch(1), secretFile: '/a' }, { channelId: ch(2), secretFile: '/b' }]))).toEqual([
      { channelId: ch(1), secretFile: '/a' },
      { channelId: ch(2), secretFile: '/b' },
    ])
    expect(() => parseAccounts('[]')).toThrow()
    expect(() => parseAccounts(JSON.stringify([{ channelId: 'x', secretFile: '/a' }]))).toThrow()
    expect(() => parseAccounts(JSON.stringify([{ channelId: ch(1), secretFile: '/a' }, { channelId: ch(1), secretFile: '/b' }]))).toThrow()
  })
})
