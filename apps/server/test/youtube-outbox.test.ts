// AC-Y1-30~46 감사 메시지 발송함 (YT-04~07, R-13, D-Y01·D-Y06~D-Y08·D-Y12): 리허설 거르기, 동의, 직전 확인, 공개 문구, 게시 보고, 다시 시도,
// 타임아웃 확인(두 번 게시 없음), 기한, 수동 재전송, 실행기 둘·조회·알림, 묶음 창·문구·결과 공유, 영상 댓글, 방송 후 요약
import { readFileSync } from 'node:fs'
import { getProduct, listEffects } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { client, createBroadcast, expectOk, writeEvent } from './support.ts'
import { approve, callback, connectSeller, drive, linkedBroadcast, sibling, until, youtubeWorld, type Connected, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
const extras: { server: { close(): void; stop(): Promise<void> } }[] = []
async function world(options: Parameters<typeof youtubeWorld>[0] = {}): Promise<YoutubeWorld> {
  const created = await youtubeWorld(options)
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of extras.splice(0)) {
    item.server.close()
    await item.server.stop()
  }
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

/** 20:00:00 KST */
const EIGHT_PM = Date.parse('2026-10-19T11:00:00Z')

function runner(w: YoutubeWorld) {
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  return youtube.outbox
}

/** 한 바퀴 (보내는 동안 시계를 1초씩 옮긴다 — 응답 없음·타임아웃) */
const run = (w: YoutubeWorld) => drive(w, runner(w).runOnce())

interface Row {
  id: number
  target: string
  broadcast: string | null
  state: string
  reason: string | null
  reasonMessage: string | null
  text: string
  attempts: number
  messageId: string | null
  buyer: string | null
  product: string | null
  groupWith: number[]
  manual: boolean
  nextAt: string | null
  postedAt: string | null
}

async function rows(w: YoutubeWorld, connected: Connected, date: string): Promise<Row[]> {
  const response = await client(w, connected.seller.cookie).get(`/api/days/${date}/outbox`)
  expect(response.status).toBe(200)
  return response.body.rows as Row[]
}

async function eventTypes(w: YoutubeWorld): Promise<string[]> {
  return ((await w.database.pglite?.query<{ type: string }>(`select type from events order by id`))?.rows ?? []).map((row) => row.type)
}

/** 시청자 채팅으로 찜 (수집 함수 — 실제 범위의 채팅은 유튜브 채팅) */
async function chat(w: YoutubeWorld, connected: Connected, b: string, id: string, ch: string, nick: string, text: string) {
  const outcome = await w.server.ingestChat(connected.seller.sellerId, { b, id, ch, nick, text, publishedAt: w.timer.now() })
  expect(outcome.status).toBe('recorded')
  return outcome
}

async function product(w: YoutubeWorld, connected: Connected, b: string, no: number, name: string, price: number) {
  await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b, no, name, price }))
}

const NO_LABEL = { 'print.autoOnConfirm': false }

describe('AC-Y1-30 실행기는 리허설을 집지 않는다 (RA-S05-002)', () => {
  it('리허설 범위에 감사 행이 많고 실제 범위에 하나뿐 → 가짜 서버가 받은 게시는 실제 하나. 리허설 행·라벨 행은 상태가 그대로', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: true })
    const { b } = await linkedBroadcast(w, connected)
    const rehearsal = await createBroadcast(w, connected.seller, { rehearsal: true })
    for (let no = 1; no <= 10; no++) {
      await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: rehearsal.id, no, name: '연습', price: 1000 }))
      expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${rehearsal.id}/rehearsal/chat`, { requestId: `rv${String(no)}`, nick: `연습${String(no)}`, text: String(no) })).status).toBe(200)
    }
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'real1', 'UCreal', '홍길동', '15')
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 홍길동님 구매 감사합니다'])
    const states = (await w.database.pglite?.query<{ rehearsal: boolean; kind: string; state: string | null }>(`select rehearsal, kind, state from outbox order by id`))?.rows ?? []
    expect(states.filter((row) => row.rehearsal).length).toBeGreaterThanOrEqual(10)
    expect(states.filter((row) => row.rehearsal).every((row) => row.state === null)).toBe(true)
    expect(states.filter((row) => row.kind !== 'POST_THANKS').every((row) => row.state === null)).toBe(true)
    // 리허설 범위의 발송함 조회는 빈 목록
    expect((await client(w, connected.seller.cookie).get(`/api/days/${b.date}/outbox?rehearsal=true`)).body.rows).toEqual([])
  })

  it('코드 검사: 실행기는 발송함 표를 outbox-store의 함수로만 읽고 쓰며, 그 함수들은 rehearsal = false를 고정한다(바꾸는 매개변수 없음)', () => {
    const runnerSource = readFileSync(new URL('../src/youtube/outbox.ts', import.meta.url), 'utf8')
    expect(runnerSource).not.toMatch(/from '\.\.\/db\/schema\.ts'/)
    expect(runnerSource).not.toMatch(/\boutbox\./)
    expect(runnerSource).not.toMatch(/drizzle-orm/)
    const store = readFileSync(new URL('../src/youtube/outbox-store.ts', import.meta.url), 'utf8')
    expect(store).toContain('const REAL: SQL = and(eq(outbox.rehearsal, false)')
    expect(store).not.toMatch(/rehearsal\s*[:?]\s*boolean/)
    // 발송함 표를 읽거나 바꾸는 함수는 모두 REAL 조건을 건다. 요약 행 넣기는 rehearsal: false를 고정한다 (봉인은 seal.ts — 실행기가 아니다)
    const functions = store.split('\nexport ').slice(1)
    let checked = 0
    for (const fn of functions) {
      const name = /^(?:async )?function (\w+)/.exec(fn)?.[1]
      if (name === undefined) continue
      if (fn.includes('.insert(outbox)')) {
        expect(fn, name).toContain('rehearsal: false')
        checked += 1
      } else if (fn.includes('.update(outbox)') || fn.includes('.from(outbox)') || fn.includes('select(db)')) {
        expect(fn, name).toContain('REAL')
        checked += 1
      }
    }
    expect(checked).toBeGreaterThanOrEqual(12)
  })
})

describe('AC-Y1-31 게시 동의', () => {
  it('기본 꺼짐. 게시 권한이 없으면 켜지 않고 승인 주소(force-ssl·include_granted_scopes) — 승인을 마치면 켜지고, 거절하면 꺼진 그대로', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const api = client(w, connected.seller.cookie)
    const first = await api.put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: true })
    const url = new URL(first.body.authorizeUrl as string)
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.force-ssl')
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(((await api.get('/api/youtube/connection')).body.connection as { consent: { liveChat: { enabled: boolean } } }).consent.liveChat.enabled).toBe(false)
    // 거절
    w.fake.approval = { deny: true }
    expect(await callback(w, connected.seller.cookie, await approve(first.body.authorizeUrl as string))).toBe('ACCESS_DENIED')
    expect((await api.get('/api/youtube/connection')).body.connection).toMatchObject({ permissions: { publish: false }, consent: { liveChat: { enabled: false } } })
    // 승인 → 켜짐 (켠 시각)
    w.fake.approval = { account: connected.account, channel: connected.channel.id }
    const again = await api.put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: true })
    expect(await callback(w, connected.seller.cookie, await approve(again.body.authorizeUrl as string))).toBe('connected')
    expect((await api.get('/api/youtube/connection')).body.connection).toMatchObject({
      permissions: { read: true, publish: true },
      consent: { liveChat: { enabled: true, at: new Date(w.timer.now()).toISOString() }, videoComment: { enabled: false, at: null } },
    })
    // 권한이 있으면 영상 댓글은 바로 켜진다
    expect((await api.put('/api/youtube/consent', { target: 'VIDEO_COMMENT', enabled: true })).body.connection).toMatchObject({ consent: { videoComment: { enabled: true } } })
    // 모르는 필드·잘못된 대상
    expect((await api.put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: true, x: 1 })).status).toBe(400)
    expect((await api.put('/api/youtube/consent', { target: 'EMAIL', enabled: true })).status).toBe(400)
  })

  it('효과가 나온 때 동의가 없었으면 나중에 켜도 보내지 않는다(NO_CONSENT). 끄면 기다리던 행이 NO_CONSENT', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 60 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await product(w, connected, b.id, 16, '라울', 5000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    await w.timer.advance(1000)
    await (await import('./youtube-support.ts')).enableConsent(w, connected.seller, 'LIVE_CHAT')
    await w.timer.advance(1000)
    await chat(w, connected, b.id, 'c2', 'UCb', '나', '16')
    await runner(w).runOnce()
    const list = await rows(w, connected, b.date)
    expect(list.map((row) => [row.product, row.state, row.reason])).toEqual([
      [`${b.id}/15`, 'FAILED', 'NO_CONSENT'],
      [`${b.id}/16`, 'WAITING', 'WINDOW'],
    ])
    expect(list[0]?.reasonMessage).toBe('자동 게시에 동의하기 전의 감사예요.')
    // 끄면 기다리던 행이 보내지 못함
    expect((await client(w, connected.seller.cookie).put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: false })).status).toBe(200)
    expect((await rows(w, connected, b.date)).map((row) => [row.state, row.reason])).toEqual([
      ['FAILED', 'NO_CONSENT'],
      ['FAILED', 'NO_CONSENT'],
    ])
    await w.timer.advance(120_000)
    await runner(w).runOnce()
    expect(w.fake.posted).toEqual([])
  })
})

describe('AC-Y1-32 게시 직전 확인 (G-ENG-401 흐름)', () => {
  it('18번 D의 감사가 묶음 창에서 기다리는 동안 늦게 온 선순위 문자찜으로 역전 → D는 건너뜀, 문자찜 감사가 게시된다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'contention.policy': 'RECEIVED_TIME', 'thanks.batchWindowSec': 30 } })
    await product(w, connected, b.id, 18, '미니마', 800)
    await w.timer.set(Date.parse('2026-10-19T11:00:13Z'))
    await chat(w, connected, b.id, 'm4', 'UC_D', '박민수', '18')
    await runner(w).runOnce()
    await w.timer.set(Date.parse('2026-10-19T11:00:20Z'))
    await expectOk(writeEvent(w, connected.seller, { type: 'sms', b: b.id, no: 18, received: '20:00:05' }))
    await runner(w).runOnce()
    expect(w.fake.posted).toEqual([])
    await w.timer.set(Date.parse('2026-10-19T11:00:43Z'))
    await runner(w).runOnce()
    expect(w.fake.posted.map((post) => post.text)).toEqual(['18번 미니마 800원 문자찜님 구매 감사합니다'])
    const list = await rows(w, connected, b.date)
    expect(list.map((row) => [row.buyer, row.state, row.reason])).toEqual([
      ['UC_D', 'SKIPPED', 'CANCELLED'],
      [expect.stringMatching(/^sms:/), 'SENT', null],
    ])
  })

  it('판매 규칙 thanks.liveChat이 아니오면 행이 없다 — 동의만으로 게시되지 않는다', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: true })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.liveChat': false } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    await run(w)
    expect(await rows(w, connected, b.date)).toEqual([])
    expect(w.fake.posted).toEqual([])
  })
})

describe('AC-Y1-33 공개 문구', () => {
  it('문자찜 1등 → "문자찜님", 메모·전화번호·뒤 4자리는 어떤 게시 문구에도 없다. 정리한 이름(빈 이름 → 시청자)', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: true })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.videoComment': 'PER_SALE' } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await product(w, connected, b.id, 16, '라울', 5000)
    await expectOk(writeEvent(w, connected.seller, { type: 'sms', b: b.id, no: 15, received: '12:00', memo: '김영희 이모', phone: '010-4826-1937' }))
    await chat(w, connected, b.id, 'c2', 'UCz', '​', '16')
    await run(w)
    const texts = [...w.fake.posted.map((post) => post.text), ...w.fake.comments.map((comment) => comment.text)]
    expect(texts.sort()).toEqual(
      ['15번 핑크프릴 10,000원 문자찜님 구매 감사합니다', '15번 핑크프릴 10,000원 문자찜님 구매 감사합니다', '16번 라울 5,000원 시청자님 구매 감사합니다', '16번 라울 5,000원 시청자님 구매 감사합니다'].sort(),
    )
    for (const text of texts) {
      expect(text).not.toContain('김영희')
      expect(text).not.toContain('1937')
      expect(text).not.toContain('4826')
    }
  })
})

describe('AC-Y1-34 게시됨과 게시 보고', () => {
  it('묶음이어도 효과마다 effect.thanksSent(조치자 server). 보고 기록이 실패하면 보고만 다시 — 게시 1번. effect.failed는 없다', async () => {
    let failReport = true
    const w = await world({
      start: EIGHT_PM,
      overrides: {
        hooks: {
          beforeCommit: (records) => {
            if (failReport && records.some((record) => record.type === 'effect.thanksSent')) throw new Error('저장 실패')
          },
        },
      },
    })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 30 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await product(w, connected, b.id, 16, '라울', 5000)
    await chat(w, connected, b.id, 'c1', 'UC_A', '홍길동', '15')
    await chat(w, connected, b.id, 'c2', 'UC_B', '김철수', '16')
    await runner(w).runOnce()
    await w.timer.advance(31_000)
    await runner(w).runOnce()
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 홍길동님, 16번 라울 5,000원 김철수님 구매 감사합니다'])
    const sent = await rows(w, connected, b.date)
    expect(sent.map((row) => [row.state, row.messageId])).toEqual([
      ['SENT', w.fake.posted[0]?.id],
      ['SENT', w.fake.posted[0]?.id],
    ])
    expect(sent[0]?.groupWith).toEqual([sent[1]?.id])
    expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(0)
    failReport = false
    await runner(w).runOnce()
    await runner(w).runOnce()
    expect(w.fake.posted).toHaveLength(1)
    const reports = (await w.database.pglite?.query<{ body: string; actor: string }>(`select body, actor from events where type = 'effect.thanksSent' order by seq`))?.rows ?? []
    expect(reports.map((row) => [row.actor, (JSON.parse(row.body) as { effectId: string }).effectId])).toEqual([
      ['server', 'c1:POST_THANKS:LIVE_CHAT:1'],
      ['server', 'c2:POST_THANKS:LIVE_CHAT:1'],
    ])
    // 다시 돌려도 보고가 늘지 않는다
    await runner(w).runOnce()
    expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(2)
    expect(await eventTypes(w)).not.toContain('effect.failed')
    // 보고로 잠금: 늦게 온 선순위 문자찜은 충돌 (자동 역전 아님)
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(listEffects(state).filter((effect) => effect.status === 'DONE')).toHaveLength(2)
  })
})

describe('AC-Y1-35 다시 시도', () => {
  it('5xx·429·속도 제한: 2·4·8·16·32초 뒤 최대 5번, 그래도 안 되면 GAVE_UP(게시 시도 6번). 판매 상태는 그대로', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    const before = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    const faults = [{ status: 500 }, { status: 429 }, { status: 403, reason: 'rateLimitExceeded' }, { status: 403, reason: 'userRateLimitExceeded' }, { status: 503 }, { status: 502 }]
    for (const fault of faults) w.fake.fail('liveChatMessages.insert', fault)
    await runner(w).runOnce()
    const waits: number[] = []
    for (let i = 1; i <= 5; i++) {
      const row = (await rows(w, connected, b.date))[0] as Row
      expect(row).toMatchObject({ state: 'WAITING', reason: 'RETRY', attempts: i })
      const next = Date.parse(row.nextAt ?? '')
      waits.push((next - w.timer.now()) / 1000)
      await w.timer.set(next)
      await runner(w).runOnce()
    }
    expect(waits).toEqual([2, 4, 8, 16, 32])
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'GAVE_UP', reasonMessage: '여러 번 보내지 못했어요.' })
    expect(w.fake.calls('liveChatMessages.insert')).toBe(6)
    expect((await w.server.writer.read(connected.seller.sellerId, b.date)).state).toEqual(before)
  })

  it('다시 시도해도 소용없는 오류는 바로 보내지 못함(게시 시도 1번). 401은 새로 고쳐 한 번 더. 할당량 초과는 기다림 + 멈춤 모드', async () => {
    const cases: [{ status: number; reason?: string }, string][] = [
      [{ status: 403, reason: 'liveChatEnded' }, 'CHAT_ENDED'],
      [{ status: 403, reason: 'liveChatDisabled' }, 'CHAT_ENDED'],
      [{ status: 403, reason: 'forbidden' }, 'NO_PERMISSION'],
      [{ status: 403, reason: 'insufficientPermissions' }, 'NO_PERMISSION'],
      [{ status: 400, reason: 'messageTextInvalid' }, 'REJECTED'],
      [{ status: 404, reason: 'liveChatNotFound' }, 'REJECTED'],
    ]
    for (const [fault, reason] of cases) {
      const w = await world()
      const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
      const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
      await product(w, connected, b.id, 15, '핑크프릴', 10000)
      await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
      w.fake.fail('liveChatMessages.insert', fault)
      await runner(w).runOnce()
      await w.timer.advance(60_000)
      await runner(w).runOnce()
      expect((await rows(w, connected, b.date))[0], JSON.stringify(fault)).toMatchObject({ state: 'FAILED', reason })
      expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    }
    // 401 → 새로 고침 뒤 한 번 더 (세지 않음)
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    w.fake.expireAccessTokens()
    await runner(w).runOnce()
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT', attempts: 0 })
    expect(w.fake.calls('oauth.refresh')).toBe(1)
    // 할당량 초과 → 기다림(할당량), 모드 멈춤
    await product(w, connected, b.id, 16, '라울', 5000)
    await chat(w, connected, b.id, 'c2', 'UCb', '나', '16')
    w.fake.fail('liveChatMessages.insert', { status: 403, reason: 'quotaExceeded' })
    await runner(w).runOnce()
    expect((await rows(w, connected, b.date))[1]).toMatchObject({ state: 'WAITING', reason: 'QUOTA', attempts: 0 })
    expect(((await client(w, connected.seller.cookie).get('/api/youtube/quota')).body.quota as { mode: string }).mode).toBe('PAUSED')
  }, 60_000)
})

describe('AC-Y1-36 타임아웃·서버 재시작 — 두 번 게시 없음', () => {
  it('(가) 게시는 받고 응답 없음 → 확인으로 SENT, 게시 1번', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    await run(w)
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT', messageId: w.fake.posted[0]?.id })
    expect(w.fake.messages(liveChatId).filter((message) => message.text === '15번 핑크프릴 10,000원 가님 구매 감사합니다')).toHaveLength(1)
    expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(1)
    // 수집기가 돌지 않아 최근 채팅 조회 한 번
    expect(w.fake.calls('liveChatMessages.list')).toBe(1)
  })

  it('(나) 게시를 받지 않고 응답도 없음 → 확인 실패(30초) → 다시 시도로 게시 1번', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENDING' })
    for (let i = 0; i < 40 && (await rows(w, connected, b.date))[0]?.state !== 'SENT'; i++) {
      await w.timer.advance(2000)
      await run(w)
    }
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT', attempts: 1 })
    expect(w.fake.messages(liveChatId).filter((message) => message.text === '15번 핑크프릴 10,000원 가님 구매 감사합니다')).toHaveLength(1)
    expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(1)
  })

  it('(다) 게시 요청을 보낸 직후 서버가 죽었다 살아남 → 확인부터 해 게시 1번 (수집기가 본 우리 메시지로)', async () => {
    let die = true
    const w = await world({ overrides: { outboxHooks: { afterPost: () => (die ? Promise.reject(new Error('죽음')) : undefined) } } })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    w.server.youtube?.collectors.start()
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    await run(w)
    await runner(w).kill()
    die = false
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENDING' })
    const revived = sibling(w, 'B')
    extras.push(revived)
    const second = revived.server.youtube?.outbox
    if (second === undefined) throw new Error('유튜브가 없다')
    // 임대(60초)가 지난 뒤 이어받아 확인
    for (let i = 0; i < 80 && (await rows(w, connected, b.date))[0]?.state !== 'SENT'; i++) {
      await w.timer.advance(1000)
      await drive(w, second.runOnce())
    }
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT' })
    expect(w.fake.messages(liveChatId).filter((message) => message.text === '15번 핑크프릴 10,000원 가님 구매 감사합니다')).toHaveLength(1)
    expect(w.fake.calls('liveChatMessages.insert')).toBe(1)
    expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(1)
  })
})

describe('AC-Y1-37 기한', () => {
  it('"다시 연결 필요"인 채 10분이 지나면 실시간 채팅 감사가 EXPIRED, 다시 연결해도 자동으로 보내지 않는다', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    w.fake.revokeAll()
    await w.timer.advance(3600 * 1000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'WAITING', reason: 'RECONNECT' })
    await w.timer.advance(10 * 60 * 1000 + 1000)
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'EXPIRED', reasonMessage: '너무 늦어 보내지 않았어요.' })
    w.fake.approval = { account: connected.account, channel: connected.channel.id }
    expect(await callback(w, connected.seller.cookie, await approve((await client(w, connected.seller.cookie).post('/api/youtube/connection/start', {})).body.authorizeUrl as string))).toBe('connected')
    await run(w)
    expect(w.fake.calls('liveChatMessages.insert')).toBe(0)
  })
})

describe('AC-Y1-38 수동 재전송', () => {
  it('FAILED 행만, 같은 요청 번호는 한 번만, 한 건씩, 기한 없음, 동의 필요 없음. 취소된 효과는 보내지 않는다. 다른 판매자의 행은 404', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await product(w, connected, b.id, 16, '라울', 5000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    await chat(w, connected, b.id, 'c2', 'UCb', '나', '16')
    await run(w)
    const [first, second] = await rows(w, connected, b.date)
    expect(first).toMatchObject({ state: 'FAILED', reason: 'NO_CONSENT' })
    const api = client(w, connected.seller.cookie)
    // 게시 권한이 없으면 그 이유와 권한을 받을 승인 주소
    const noPermission = await api.post(`/api/outbox/${String(first?.id)}/resend`, { requestId: 'rs-0' })
    expect(noPermission.status).toBe(409)
    expect(noPermission.body).toMatchObject({ error: { code: 'NO_PERMISSION', message: '게시 권한이 없어요.' }, authorizeUrl: expect.stringContaining('force-ssl') })
    w.fake.approval = { account: connected.account, channel: connected.channel.id }
    expect(await callback(w, connected.seller.cookie, await approve(noPermission.body.authorizeUrl as string))).toBe('connected')
    // 기한(10분)이 지났어도 수동 재전송은 된다
    await w.timer.advance(30 * 60 * 1000)
    const resent = await api.post(`/api/outbox/${String(first?.id)}/resend`, { requestId: 'rs-1' })
    expect(resent.status).toBe(200)
    expect(resent.body.row).toMatchObject({ state: 'WAITING', manual: true })
    expect((await api.post(`/api/outbox/${String(first?.id)}/resend`, { requestId: 'rs-1' })).body).toEqual(resent.body)
    await run(w)
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 가님 구매 감사합니다'])
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT' })
    // SENT 행은 다시 보낼 수 없다
    expect((await api.post(`/api/outbox/${String(first?.id)}/resend`, { requestId: 'rs-2' })).body).toMatchObject({ error: { code: 'RESEND_NOT_ALLOWED' } })
    // 확정이 풀린 판매는 보내지 않는다
    await expectOk(writeEvent(w, connected.seller, { type: 'host.cancel', b: b.id, no: 16, buyer: 'UCb', reason: '취소 요청' }))
    const cancelled = await api.post(`/api/outbox/${String(second?.id)}/resend`, { requestId: 'rs-3' })
    expect(cancelled.body).toMatchObject({ error: { code: 'EFFECT_CANCELLED', message: '확정이 풀린 판매라 보내지 않아요.' } })
    expect((await rows(w, connected, b.date))[1]).toMatchObject({ state: 'SKIPPED' })
    // 다른 판매자의 행·없는 행은 404, 요청 번호 필수
    const other = await connectSeller(w)
    expect((await client(w, other.seller.cookie).post(`/api/outbox/${String(first?.id)}/resend`, { requestId: 'rs-4' })).status).toBe(404)
    expect((await api.post('/api/outbox/999999/resend', { requestId: 'rs-5' })).status).toBe(404)
    expect((await api.post(`/api/outbox/${String(first?.id)}/resend`, {})).status).toBe(400)
  })

  it('할당량 멈춤이면 "오늘 유튜브 사용량이 얼마 남지 않아 채팅 수집에 남겨 둬요."', async () => {
    const w = await world({ overrides: {} })
    const connected = await connectSeller(w, { publish: 'VIDEO_COMMENT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    await run(w)
    const [row] = await rows(w, connected, b.date)
    await w.server.youtube?.quota.markExceeded(connected.seller.sellerId)
    const response = await client(w, connected.seller.cookie).post(`/api/outbox/${String(row?.id)}/resend`, { requestId: 'rq-1' })
    expect(response.body).toMatchObject({ error: { code: 'QUOTA_PAUSED', message: '오늘 유튜브 사용량이 얼마 남지 않아 채팅 수집에 남겨 둬요.' } })
  })
})

describe('AC-Y1-39 실행기 둘·조회·실시간 알림', () => {
  it('실행기 둘이 같은 행들을 두고 동시에 돌아도 효과마다 게시 1번', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    for (let no = 1; no <= 10; no++) {
      await product(w, connected, b.id, no, `상품${String(no)}`, 1000)
      await chat(w, connected, b.id, `c${String(no)}`, `UC${String(no)}`, `구매자${String(no)}`, String(no))
    }
    const second = sibling(w, 'B')
    extras.push(second)
    const other = second.server.youtube?.outbox
    if (other === undefined) throw new Error('유튜브가 없다')
    await Promise.all([drive(w, runner(w).runOnce()), drive(w, other.runOnce()), drive(w, runner(w).runOnce()), drive(w, other.runOnce())])
    await Promise.all([drive(w, runner(w).runOnce()), drive(w, other.runOnce())])
    const texts = w.fake.posted.map((post) => post.text).sort()
    expect(texts).toHaveLength(10)
    expect(new Set(texts).size).toBe(10)
    expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(10)
  })

  it('목록 필드와 행 상태가 바뀌면 SSE(youtube · outbox)', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: NO_LABEL })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    const response = await client(w, connected.seller.cookie).raw('/api/stream', {})
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const read = (async () => {
      for (;;) {
        const chunk = await reader?.read()
        if (chunk === undefined || chunk.done) break
        text += decoder.decode(chunk.value)
        if (text.includes('"state":"SENT"')) break
      }
    })()
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    await run(w)
    await read
    await reader?.cancel()
    expect(text).toContain('event: youtube')
    expect(text).toContain('"kind":"outbox"')
    const [row] = await rows(w, connected, b.date)
    expect(row).toEqual({
      id: expect.any(Number),
      target: 'LIVE_CHAT',
      broadcast: b.id,
      product: `${b.id}/15`,
      buyer: 'UCa',
      text: '15번 핑크프릴 10,000원 가님 구매 감사합니다',
      state: 'SENT',
      stateMessage: '게시됨',
      reason: null,
      reasonMessage: null,
      attempts: 0,
      nextAt: null,
      postedAt: expect.any(String),
      messageId: w.fake.posted[0]?.id,
      manual: false,
      groupWith: [],
      // I3 (AC-I3-36): 판매자 게시됨 확인·알림에서 뺌 표시
      confirmedBySeller: false,
      dismissed: false,
      dismissedAt: null,
      // X1 (D-X1-19): 크롬 확장에 맡긴 행인지 — 공식으로 올린 행은 false
      viaExtension: false,
    })
  })
})

describe('AC-Y1-40·42 묶음 창·결과 공유', () => {
  it('창 30초: 20:00:10·20:00:11 확정 → 20:00:40에 메시지 하나(두 효과), 20:00:41 확정 → 새 창 20:01:11에 하나', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 30 } })
    for (const [no, name, price] of [
      [15, '핑크프릴', 10000],
      [16, '라울', 5000],
      [17, '성미인', 8000],
    ] as const)
      await product(w, connected, b.id, no, name, price)
    await w.timer.set(Date.parse('2026-10-19T11:00:10Z'))
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await runner(w).runOnce()
    await w.timer.set(Date.parse('2026-10-19T11:00:11Z'))
    await chat(w, connected, b.id, 'c2', 'UCb', '김철수', '16')
    await runner(w).runOnce()
    await w.timer.set(Date.parse('2026-10-19T11:00:39Z'))
    await runner(w).runOnce()
    expect(w.fake.posted).toHaveLength(0)
    await w.timer.set(Date.parse('2026-10-19T11:00:40Z'))
    await runner(w).runOnce()
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 홍길동님, 16번 라울 5,000원 김철수님 구매 감사합니다'])
    await w.timer.set(Date.parse('2026-10-19T11:00:41Z'))
    await chat(w, connected, b.id, 'c3', 'UCc', '이영희', '17')
    await runner(w).runOnce()
    await w.timer.set(Date.parse('2026-10-19T11:01:10Z'))
    await runner(w).runOnce()
    expect(w.fake.posted).toHaveLength(1)
    await w.timer.set(Date.parse('2026-10-19T11:01:11Z'))
    await runner(w).runOnce()
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 홍길동님, 16번 라울 5,000원 김철수님 구매 감사합니다', '17번 성미인 8,000원 이영희님 구매 감사합니다'])
  })

  it('다시 시도면 함께 기다리고, 다시 시도 직전에 취소된 효과는 빼고 문구를 다시 만든다', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 10 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await product(w, connected, b.id, 16, '라울', 5000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await chat(w, connected, b.id, 'c2', 'UCb', '김철수', '16')
    await runner(w).runOnce()
    w.fake.fail('liveChatMessages.insert', { status: 503 })
    await w.timer.advance(10_000)
    await runner(w).runOnce()
    const waiting = await rows(w, connected, b.date)
    expect(waiting.map((row) => [row.state, row.reason, row.attempts])).toEqual([
      ['WAITING', 'RETRY', 1],
      ['WAITING', 'RETRY', 1],
    ])
    await expectOk(writeEvent(w, connected.seller, { type: 'host.cancel', b: b.id, no: 16, buyer: 'UCb', reason: '취소' }))
    await w.timer.advance(2000)
    await runner(w).runOnce()
    expect(w.fake.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 홍길동님 구매 감사합니다'])
    expect((await rows(w, connected, b.date)).map((row) => row.state)).toEqual(['SENT', 'SKIPPED'])
  })

  it('할당량 묶음 모드면 창 = max(설정, 60)초', async () => {
    const w = await world({ start: EIGHT_PM, overrides: {} })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    // 남은 양 < 예산의 20%로
    const quota = w.server.youtube?.quota
    if (quota === undefined) throw new Error('유튜브가 없다')
    for (let i = 0; i < 410; i++) await quota.count(connected.seller.sellerId, 'liveChatMessages.insert')
    expect(await quota.mode(connected.seller.sellerId)).toBe('BATCH')
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await runner(w).runOnce()
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'WAITING', reason: 'WINDOW', nextAt: new Date(w.timer.now() + 60_000).toISOString() })
  })
})

describe('AC-Y1-45 판매마다 영상 댓글', () => {
  it('영상 댓글 효과마다 최상위 댓글 하나 (묶지 않음, 영상 댓글 동의 필요). 게시 보고도 한다', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'VIDEO_COMMENT' })
    const { b, live } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.liveChat': false, 'thanks.videoComment': 'PER_SALE', 'thanks.batchWindowSec': 30 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await product(w, connected, b.id, 16, '라울', 5000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await chat(w, connected, b.id, 'c2', 'UCb', '김철수', '16')
    await run(w)
    expect(w.fake.comments.map((comment) => [comment.videoId, comment.text])).toEqual([
      [live.videoId, '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다'],
      [live.videoId, '16번 라울 5,000원 김철수님 구매 감사합니다'],
    ])
    expect((await rows(w, connected, b.date)).map((row) => [row.target, row.state])).toEqual([
      ['VIDEO_COMMENT', 'SENT'],
      ['VIDEO_COMMENT', 'SENT'],
    ])
    expect((await eventTypes(w)).filter((type) => type === 'effect.thanksSent')).toHaveLength(2)
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 15)?.winners).toEqual(['UCa'])
  })

  it('타임아웃은 최근 댓글 조회로 확인 (게시 1번)', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'VIDEO_COMMENT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.liveChat': false, 'thanks.videoComment': 'PER_SALE' } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    w.fake.fail('commentThreads.insert', { kind: 'acceptHang' })
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT' })
    expect(w.fake.comments).toHaveLength(1)
    expect(w.fake.calls('commentThreads.list')).toBe(1)
  })

  it('할당량 묶음·멈춤 모드에서는 자동 게시하지 않고 기다린다', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'VIDEO_COMMENT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.liveChat': false, 'thanks.videoComment': 'PER_SALE' } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    const quota = w.server.youtube?.quota
    if (quota === undefined) throw new Error('유튜브가 없다')
    for (let i = 0; i < 410; i++) await quota.count(connected.seller.sellerId, 'liveChatMessages.insert')
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await run(w)
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'WAITING', reason: 'QUOTA' })
    expect(w.fake.comments).toHaveLength(0)
  })
})

describe('AC-Y1-46 방송 후 요약', () => {
  it('끝내고 10분 뒤 요약 댓글 하나 (번호 순, 품종 없으면 뺌, 문자찜은 문자찜). 같은 회차에 두 번 만들지 않는다. 보고 이벤트 없음', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'VIDEO_COMMENT' })
    const { b, live } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.liveChat': false, 'thanks.videoComment': 'SUMMARY' } })
    await product(w, connected, b.id, 16, '', 8000)
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await expectOk(writeEvent(w, connected.seller, { type: 'sms', b: b.id, no: 16, received: '12:00', memo: '비밀메모' }))
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-46' })).status).toBe(200)
    await run(w)
    await w.timer.advance(9 * 60 * 1000)
    await run(w)
    expect(w.fake.comments).toHaveLength(0)
    await w.timer.advance(61 * 1000)
    await run(w)
    await run(w)
    expect(w.fake.comments.map((comment) => [comment.videoId, comment.text])).toEqual([[live.videoId, '구매 감사합니다\n15번 핑크프릴 10,000원 홍길동님\n16번 8,000원 문자찜님']])
    const second = sibling(w, 'B')
    extras.push(second)
    await drive(w, (second.server.youtube?.outbox as NonNullable<typeof second.server.youtube>['outbox']).runOnce())
    await run(w)
    expect(w.fake.comments).toHaveLength(1)
    expect((await rows(w, connected, b.date)).map((row) => [row.target, row.state])).toEqual([['SUMMARY', 'SENT']])
    expect(await eventTypes(w)).not.toContain('effect.thanksSent')
  })

  it('동의가 없으면 만들되 FAILED(NO_CONSENT) — 수동 재전송 가능. 리허설·PER_SALE·OFF·이어진 방송 없는 회차는 만들지 않는다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.liveChat': false, 'thanks.videoComment': 'SUMMARY' } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    const unlinked = await createBroadcast(w, connected.seller)
    await product(w, connected, unlinked.id, 15, '핑크프릴', 10000)
    await w.server.ingestChat(connected.seller.sellerId, { b: unlinked.id, id: 'u1', ch: 'UCx', nick: 'x', text: '15' })
    for (const target of [b.id, unlinked.id]) expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${target}/end`, { requestId: `end-${target}` })).status).toBe(200)
    await w.timer.advance(11 * 60 * 1000)
    await run(w)
    expect((await rows(w, connected, b.date)).map((row) => [row.target, row.broadcast, row.state, row.reason])).toEqual([['SUMMARY', b.id, 'FAILED', 'NO_CONSENT']])
    await (await import('./youtube-support.ts')).enableConsent(w, connected.seller, 'VIDEO_COMMENT')
    const [row] = await rows(w, connected, b.date)
    expect((await client(w, connected.seller.cookie).post(`/api/outbox/${String(row?.id)}/resend`, { requestId: 'sum-1' })).status).toBe(200)
    await run(w)
    expect(w.fake.comments.map((comment) => comment.text)).toEqual(['구매 감사합니다\n15번 핑크프릴 10,000원 홍길동님'])
  })
})

describe('AC-Y1-32·42 직전 확인은 메시지마다 (R-13 실행 직전)', () => {
  it('200자로 나뉜 메시지: 앞 메시지가 응답 없이 10초 걸리는 동안 취소된 판매는 뒤 메시지에서 빠진다(SKIPPED, 게시 없음)', async () => {
    const w = await world({ start: EIGHT_PM })
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 10 } })
    // 항목 하나가 100자쯤 — 둘이면 200자를 넘어 메시지 둘로 나뉜다
    await product(w, connected, b.id, 15, `${'가'.repeat(80)}일`, 10000)
    await product(w, connected, b.id, 16, `${'가'.repeat(80)}이`, 5000)
    await chat(w, connected, b.id, 'c1', 'UCa', '홍길동', '15')
    await chat(w, connected, b.id, 'c2', 'UCb', '김철수', '16')
    await runner(w).runOnce()
    await w.timer.advance(10_000)
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    const running = runner(w).runOnce()
    await until(w, () => w.fake.calls('liveChatMessages.insert') >= 1)
    await expectOk(writeEvent(w, connected.seller, { type: 'host.cancel', b: b.id, no: 16, buyer: 'UCb', reason: '취소' }))
    await drive(w, running)
    expect(w.fake.posted.some((post) => post.text.includes('김철수'))).toBe(false)
    expect((await rows(w, connected, b.date)).find((row) => row.buyer === 'UCb')).toMatchObject({ state: 'SKIPPED', reason: 'CANCELLED' })
  })
})

describe('AC-Y1-31 동의를 끈 뒤에는 확인 중이던 행도 다시 보내지 않는다 (D-Y12)', () => {
  it('확인 중(SENDING)에 동의를 끄면 확인 실패 뒤 NO_CONSENT — 곧바로 다시 켜도 그 전에 생긴 행은 보내지 않는다', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    w.fake.fail('liveChatMessages.insert', { kind: 'hang' })
    await run(w)
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENDING' })
    const api = client(w, connected.seller.cookie)
    expect((await api.put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: false })).status).toBe(200)
    await w.timer.advance(1000)
    expect((await api.put('/api/youtube/consent', { target: 'LIVE_CHAT', enabled: true })).status).toBe(200)
    for (let i = 0; i < 30; i++) {
      await w.timer.advance(2000)
      await run(w)
    }
    expect(w.fake.posted).toEqual([])
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'FAILED', reason: 'NO_CONSENT' })
  })
})

describe('AC-Y1-36 타임아웃 확인 — 수집기가 돌아도 두 번 게시 없음', () => {
  it('(라) 회차를 끝낸 직후 올라간 감사가 응답 없이 끝나도(수집기는 끝낸 뒤 10분 동안 도는 중) 수집기가 본 우리 메시지로 확인해 게시 1번', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    const youtube = w.server.youtube
    if (youtube === null) throw new Error('유튜브가 없다')
    youtube.collectors.start()
    w.fake.addMessage(liveChatId, { author: 'UCa', name: '가', text: '15', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await rows(w, connected, b.date)).length === 1, { step: 100 })
    await w.timer.advance(1000)
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-own' })).status).toBe(200)
    await w.timer.advance(1000)
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    for (let i = 0; i < 40 && (await rows(w, connected, b.date))[0]?.state !== 'SENT'; i++) {
      await run(w)
      await w.timer.advance(1000)
    }
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT' })
    expect(w.fake.messages(liveChatId).filter((message) => message.text === '15번 핑크프릴 10,000원 가님 구매 감사합니다')).toHaveLength(1)
    // 끝낸 뒤 올라간 우리 글도 우리 메시지 기록에 들어가 확인에 쓰였다 (최근 채팅 조회 없음), 기록(chat)은 하지 않았다
    expect(w.fake.calls('liveChatMessages.list')).toBe(0)
    expect((await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from youtube_own_messages`))?.rows[0]?.n).toBe(1)
    expect((await eventTypes(w)).filter((type) => type === 'chat')).toHaveLength(1)
    await youtube.collectors.stop()
  })

  it('(마) 수집기가 도는 것으로 보여도 확인 시간 안에 우리 글을 못 받았으면, 실패로 세기 전에 최근 채팅을 한 번 본다(게시 1번)', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: { ...NO_LABEL, 'thanks.batchWindowSec': 0 } })
    await product(w, connected, b.id, 15, '핑크프릴', 10000)
    await chat(w, connected, b.id, 'c1', 'UCa', '가', '15')
    // 다른 서버의 수집기가 채팅을 받는 중인 것처럼 (임대 있음) — 그런데 우리 글은 전하지 않는다(스트림이 멈춤)
    await w.database.pglite?.query(`update youtube_collectors set status = 'LIVE', lease_owner = 'Z', lease_until = $1`, [new Date(w.timer.now() + 3_600_000).toISOString()])
    w.fake.fail('liveChatMessages.insert', { kind: 'acceptHang' })
    for (let i = 0; i < 40 && (await rows(w, connected, b.date))[0]?.state !== 'SENT'; i++) {
      await run(w)
      await w.timer.advance(2000)
    }
    expect((await rows(w, connected, b.date))[0]).toMatchObject({ state: 'SENT', attempts: 0 })
    expect(w.fake.messages(liveChatId).filter((message) => message.text === '15번 핑크프릴 10,000원 가님 구매 감사합니다')).toHaveLength(1)
    expect(w.fake.calls('liveChatMessages.list')).toBe(1)
  })
})
