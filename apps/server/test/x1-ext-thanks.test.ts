// X1 크롬 확장으로 감사 채팅 올리기 — 서버 (YT-10 AC11~AC17, D-X1-17~D-X1-24): AC-X1-26·28·29·31·32의 서버 몫과 AC-X1-27의 서버 확인,
// AC-X1-25 (다른 경로 중복은 서버 도착 시각 차 10초 이하만, D-X1-28).
import { afterEach, describe, expect, it } from 'vitest'
import { client, createBroadcast, expectOk, login, writeEvent } from './support.ts'
import { connectSeller, drive, linkedBroadcast, youtubeWorld, type Connected, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
afterEach(async () => {
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

const VIDEO = 'abcdefghijk'

interface Res {
  readonly status: number
  readonly body: Record<string, unknown>
  readonly text: string
}

async function ext(w: YoutubeWorld, path: string, token: string, body: unknown): Promise<Res> {
  // 토큰마다 초당 5요청 (AC-X1-10) — 요청 사이 시계를 조금 옮긴다
  await w.timer.advance(250)
  const response = await w.server.app.request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>), text }
}

let counter = 0
const buyer = (n: number) => `UCbuyer${String(n).padStart(16, '0')}`

async function chat(w: YoutubeWorld, token: string, text: string, nick = '구매자', ch = buyer(1)) {
  const sent = await ext(w, '/ext/chats', token, { v: VIDEO, messages: [{ id: `m${String(++counter)}`, ch, nick, text, at: w.timer.now() }] })
  expect(sent.status, sent.text).toBe(200)
}

const runner = (w: YoutubeWorld) => {
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  return youtube.outbox
}
const run = (w: YoutubeWorld) => drive(w, runner(w).runOnce())

interface OutboxRow {
  id: number
  state: string
  reason: string | null
  text: string
  viaExtension: boolean
}
async function rows(w: YoutubeWorld, connected: Connected, date: string): Promise<OutboxRow[]> {
  const response = await client(w, connected.seller.cookie).get(`/api/days/${date}/outbox`)
  expect(response.status, response.text).toBe(200)
  return response.body.rows as OutboxRow[]
}

/**
 * 판매자(유튜브 연결·실시간 채팅 동의) + YT-02로 잇지 않은 오늘 회차 + 확장 연결(그 회차에 VIDEO를 이음) + 상품 1~9번 + 묶음 창 0초.
 * thanks: 확장 감사 올리기 스위치를 켤지
 */
async function setup(options: { thanks?: boolean; consent?: boolean } = {}) {
  const w = await youtubeWorld()
  worlds.push(w)
  const connected = await connectSeller(w, { publish: options.consent === false ? false : 'LIVE_CHAT' })
  const api = client(w, connected.seller.cookie)
  expect((await api.patch('/api/settings', { settings: { 'print.autoOnConfirm': false } })).status).toBeLessThan(500)
  const b = await createBroadcast(w, connected.seller)
  const issued = await api.post('/api/extension/code', {})
  const exchanged = await w.server.app.request('/ext/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: issued.body.code }) })
  const token = ((await exchanged.json()) as { token: string }).token
  expect((await ext(w, '/ext/bind', token, { v: VIDEO, broadcast: b.id })).status).toBe(200)
  if (options.thanks !== false) {
    const on = await api.post('/api/extension/thanks', { enabled: true, agreed: true })
    expect(on.status, on.text).toBe(200)
  }
  for (let no = 1; no <= 9; no++) await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no, name: `품종${String(no)}`, price: 10000 }))
  const me = connected.channel.id
  return { w, connected, b, token, me, api }
}

const take = (w: YoutubeWorld, token: string, me: string | null, owner: string | null = me) => ext(w, '/ext/thanks/take', token, { v: VIDEO, me, owner })

describe('AC-X1-26 스위치 (YT-10 AC11, D-X1-17·18)', () => {
  it('새 판매자는 꺼짐. 켜기는 agreed 없이 400, 보조자는 403. 꺼져 있으면 확장에 0건이고 감사는 공식 규칙대로(이은 방송 없음) 끝난다', async () => {
    const { w, connected, b, token, me, api } = await setup({ thanks: false })
    const view = (await api.get('/api/extension')).body.extension as { thanks: { enabled: boolean } }
    expect(view.thanks.enabled).toBe(false)
    const noAgree = await api.post('/api/extension/thanks', { enabled: true })
    expect(noAgree.status).toBe(400)
    const created = await api.post('/api/assistants', { name: '엄마' })
    const assistant = await login(w, (created.body.assistant as { loginId: string }).loginId, created.body.password as string)
    expect((await client(w, assistant).post('/api/extension/thanks', { enabled: true, agreed: true })).status).toBe(403)

    await chat(w, token, '3')
    await run(w)
    const taken = await take(w, token, me)
    expect(taken.body.state).toBe('OFF')
    const list = await rows(w, connected, b.date)
    expect(list).toHaveLength(1)
    expect(list[0]?.state).toBe('FAILED')
    expect(list[0]?.reason).toBe('NO_LINK')
    expect(list[0]?.viaExtension).toBe(false)
  })

  it('YT-04 실시간 채팅 동의가 없으면 확장에 0건 (NO_CONSENT)', async () => {
    const { w, connected, b, token, me } = await setup({ consent: false })
    await chat(w, token, '3')
    await run(w)
    expect((await take(w, token, me)).body.state).toBe('NONE')
    expect((await rows(w, connected, b.date))[0]?.reason).toBe('NO_CONSENT')
  })

  it('켜기 전에 생긴 감사·10분 지난 감사·확정이 풀린 감사는 주지 않는다', async () => {
    const { w, connected, b, token, me, api } = await setup({ thanks: false })
    await chat(w, token, '1', '먼저', buyer(1))
    await w.timer.advance(1000)
    expect((await api.post('/api/extension/thanks', { enabled: true, agreed: true })).status).toBe(200)
    await w.timer.advance(1000)
    await chat(w, token, '2', '늦게', buyer(2))
    await chat(w, token, '3', '취소', buyer(3))
    await run(w)
    const list = await rows(w, connected, b.date)
    expect(list.map((row) => [row.state, row.reason])).toEqual([
      ['FAILED', 'NO_LINK'],
      ['WAITING', 'EXTENSION'],
      ['WAITING', 'EXTENSION'],
    ])
    // 3번 확정을 푼다 → 가져갈 때 건너뜀
    await expectOk(writeEvent(w, connected.seller, { type: 'host.cancel', b: b.id, no: 3, buyer: buyer(3), reason: '취소' }))
    const first = await take(w, token, me)
    expect(first.body.state).toBe('POST')
    const post = first.body.post as { ids: number[]; text: string }
    expect(post.ids).toEqual([list[1]?.id])
    expect(post.text).toContain('늦게님')
    expect((await ext(w, '/ext/thanks/result', token, { ids: post.ids, result: 'NOT_POSTED' })).status).toBe(200)
    await w.timer.advance(10 * 60 * 1000)
    expect((await take(w, token, me)).body.state).toBe('NONE')
    const after = await rows(w, connected, b.date)
    expect(after.map((row) => [row.state, row.reason])).toEqual([
      ['FAILED', 'NO_LINK'],
      ['FAILED', 'EXPIRED'],
      ['SKIPPED', 'CANCELLED'],
    ])
  })
})

describe('AC-X1-28 한쪽 경로만 (YT-10 AC13, D-X1-19)', () => {
  it('회차가 공식으로 이어졌고 연결이 살아 있으면 확장에 0건, 공식만 게시', async () => {
    const w = await youtubeWorld()
    worlds.push(w)
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const api = client(w, connected.seller.cookie)
    await api.patch('/api/settings', { settings: { 'print.autoOnConfirm': false } })
    const { b, live } = await linkedBroadcast(w, connected)
    const issued = await api.post('/api/extension/code', {})
    const token = ((await (await w.server.app.request('/ext/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: issued.body.code }) })).json()) as { token: string }).token
    expect((await ext(w, '/ext/bind', token, { v: live.videoId as string, broadcast: b.id })).status).toBe(200)
    expect((await api.post('/api/extension/thanks', { enabled: true, agreed: true })).status).toBe(200)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 3, name: '핑크', price: 10000 }))
    const sent = await ext(w, '/ext/chats', token, { v: live.videoId, messages: [{ id: 'o1', ch: buyer(1), nick: '홍길동', text: '3', at: w.timer.now() }] })
    expect(sent.status, sent.text).toBe(200)
    await run(w)
    const taken = await ext(w, '/ext/thanks/take', token, { v: live.videoId, me: connected.channel.id, owner: connected.channel.id })
    expect(taken.body.state).toBe('NONE')
    expect(w.fake.posted).toHaveLength(1)
    expect((await rows(w, connected, b.date))[0]?.viaExtension).toBe(false)
  })

  it('공식이 없으면 확장이 맡고, 맡은 뒤 공식 연결이 생겨도 공식 실행기는 그 건을 올리지 않는다', async () => {
    const { w, connected, b, token, me, api } = await setup()
    await chat(w, token, '3')
    await run(w)
    // 이제 공식으로 잇는다 (같은 영상)
    const live = w.fake.addBroadcast(connected.channel.id, { title: '라이브', status: 'live' })
    await api.post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'late-link', video: `https://www.youtube.com/watch?v=${live.videoId as string}` })
    await run(w)
    await run(w)
    expect(w.fake.posted).toHaveLength(0)
    const list = await rows(w, connected, b.date)
    expect(list[0]?.viaExtension).toBe(true)
    expect(list[0]?.reason).toBe('EXTENSION')
    // 확장이 가져가 올림 → 게시됨, 공식 게시는 0
    const post = (await take(w, token, me)).body.post as { ids: number[] }
    expect((await ext(w, '/ext/thanks/result', token, { ids: post.ids, result: 'POSTED' })).status).toBe(200)
    await run(w)
    expect((await rows(w, connected, b.date))[0]?.state).toBe('SENT')
    expect(w.fake.posted).toHaveLength(0)
  })

  it('스위치를 끄면 확장에 맡겨 기다리던 감사는 보내지 못함(EXT_OFF)', async () => {
    const { w, connected, b, token, me, api } = await setup()
    await chat(w, token, '3')
    await run(w)
    expect((await api.post('/api/extension/thanks', { enabled: false })).status).toBe(200)
    expect((await take(w, token, me)).body.state).toBe('OFF')
    const list = await rows(w, connected, b.date)
    expect([list[0]?.state, list[0]?.reason]).toEqual(['FAILED', 'EXT_OFF'])
  })

  it('가져간 뒤 결과가 없으면 60초 뒤 확인 필요(UNCONFIRMED)이고 어떤 경로로도 다시 가지 않는다', async () => {
    const { w, connected, b, token, me } = await setup()
    await chat(w, token, '3')
    await run(w)
    const taken = await take(w, token, me)
    expect(taken.body.state).toBe('POST')
    await w.timer.advance(61_000)
    await run(w)
    const list = await rows(w, connected, b.date)
    expect(list[0]?.state).toBe('FAILED')
    expect(list[0]?.reason).toBe('UNCONFIRMED')
    await w.timer.advance(5000)
    expect((await take(w, token, me)).body.state).toBe('NONE')
    await run(w)
    expect(w.fake.posted).toHaveLength(0)
  })
})

describe('AC-X1-27 채널 주인만 (YT-10 AC12, D-X1-20)', () => {
  it('로그인 채널 ≠ 방송 채널, 하나를 못 읽음, 유튜브 연결 채널과 다름 → 주지 않고 경고. 같으면 준다', async () => {
    const { w, token, me, api } = await setup()
    await chat(w, token, '3')
    await run(w)
    for (const [who, owner] of [
      ['UCother0000000000000000', me],
      [null, me],
      [me, null],
      ['UCother0000000000000000', 'UCother0000000000000000'],
    ] as const) {
      const taken = await take(w, token, who, owner)
      expect(taken.body.state).toBe('NOT_OWNER')
      expect(taken.body.message).toBe('방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요')
    }
    const view = (await api.get('/api/extension')).body.extension as { thanks: { warnings: { kind: string; message: string }[] } }
    expect(view.thanks.warnings.map((item) => item.kind)).toEqual(['OWNER'])
    const ok = await take(w, token, me)
    expect(ok.body.state).toBe('POST')
    const cleared = (await api.get('/api/extension')).body.extension as { thanks: { warnings: unknown[] } }
    expect(cleared.thanks.warnings).toEqual([])
  })
})

describe('AC-X1-29 묶기·길이·서버가 만든 글만 (YT-10 AC14, D-X1-21)', () => {
  it('감사 4건이 1초 안에 → 묶음 규칙대로 한 글(끝말 한 번). 닉네임 태그·줄바꿈은 정리된 글자 그대로. 글 사이 3초', async () => {
    const { w, connected, b, token, me } = await setup()
    await chat(w, token, '1', '<b>홍\n길동</b>', buyer(1))
    await chat(w, token, '2', '둘', buyer(2))
    await chat(w, token, '3', '셋', buyer(3))
    await chat(w, token, '4', '넷', buyer(4))
    await run(w)
    const taken = await take(w, token, me)
    expect(taken.body.state).toBe('POST')
    const post = taken.body.post as { ids: number[]; text: string }
    expect(post.ids).toHaveLength(4)
    expect(post.text).not.toContain('\n')
    expect(post.text).toContain('<b>홍 길동</b>님')
    expect(post.text.match(/구매 감사합니다/g)).toHaveLength(1)
    expect(Array.from(post.text).length).toBeLessThanOrEqual(200)
    const listed = await rows(w, connected, b.date)
    expect(listed.every((row) => row.state === 'SENDING')).toBe(true)

    // 결과 → 3초 안에는 다음 글 없음
    expect((await ext(w, '/ext/thanks/result', token, { ids: post.ids, result: 'POSTED' })).status).toBe(200)
    await chat(w, token, '5', '다섯', buyer(5))
    await run(w)
    const soon = await take(w, token, me)
    expect(soon.body.state).toBe('NONE')
    expect(soon.body.afterMs).toBeGreaterThan(0)
    expect(soon.body.afterMs).toBeLessThanOrEqual(3000)
    await w.timer.advance(3000)
    expect((await take(w, token, me)).body.state).toBe('POST')
  })

  it('결과를 기다리는 글이 있으면 다음 글을 주지 않는다 (하나씩)', async () => {
    const { w, token, me } = await setup()
    await chat(w, token, '1', '하나', buyer(1))
    await run(w)
    expect((await take(w, token, me)).body.state).toBe('POST')
    await chat(w, token, '2', '둘', buyer(2))
    await run(w)
    await w.timer.advance(5000)
    expect((await take(w, token, me)).body.state).toBe('NONE')
  })
})

describe('AC-X1-31 두 번 금지·게시 확인 (YT-10 AC16, D-X1-23)', () => {
  it('게시됨 → 묶인 모든 행 SENT·게시 보고 한 번. 같은 결과를 두 번 알려도 한 번만', async () => {
    const { w, connected, b, token, me } = await setup()
    await chat(w, token, '1', '하나', buyer(1))
    await chat(w, token, '2', '둘', buyer(2))
    await run(w)
    const post = (await take(w, token, me)).body.post as { ids: number[]; text: string }
    const first = await ext(w, '/ext/thanks/result', token, { ids: post.ids, result: 'POSTED' })
    expect(first.status, first.text).toBe(200)
    const again = await ext(w, '/ext/thanks/result', token, { ids: post.ids, result: 'POSTED' })
    expect(again.status).toBe(200)
    await run(w)
    await run(w)
    const list = await rows(w, connected, b.date)
    expect(list.map((row) => row.state)).toEqual(['SENT', 'SENT'])
    const reports = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'effect.thanksSent'`)
    expect(reports?.rows[0]?.n).toBe(2)
    expect(w.fake.posted).toHaveLength(0)
  })

  it('확인 필요는 다시 주지 않는다. 안 올림(넣기 전에 멈춤)은 다시 맡을 수 있다', async () => {
    const { w, connected, b, token, me } = await setup()
    await chat(w, token, '1', '하나', buyer(1))
    await run(w)
    const post = (await take(w, token, me)).body.post as { ids: number[] }
    expect((await ext(w, '/ext/thanks/result', token, { ids: post.ids, result: 'NOT_POSTED' })).status).toBe(200)
    expect((await rows(w, connected, b.date))[0]?.reason).toBe('EXTENSION')
    const again = (await take(w, token, me)).body.post as { ids: number[] }
    expect(again.ids).toEqual(post.ids)
    expect((await ext(w, '/ext/thanks/result', token, { ids: again.ids, result: 'UNCONFIRMED' })).status).toBe(200)
    // 나중에 POSTED가 와도 확인 필요 그대로 (판매자가 YT-06 화면에서 고른다)
    await ext(w, '/ext/thanks/result', token, { ids: again.ids, result: 'POSTED' })
    expect((await rows(w, connected, b.date))[0]?.reason).toBe('UNCONFIRMED')
    await w.timer.advance(5000)
    expect((await take(w, token, me)).body.state).toBe('NONE')
  })

  it('다른 판매자의 발송함 ID·공식 경로 행은 404', async () => {
    const { w, token } = await setup()
    expect((await ext(w, '/ext/thanks/result', token, { ids: [999999], result: 'POSTED' })).status).toBe(404)
    expect((await ext(w, '/ext/thanks/result', token, { ids: [1], result: 'MAYBE' })).status).toBe(400)
  })

  it('확장이 읽어 보낸 판매자 채널의 우리 감사 글은 채팅으로 기록하지 않는다', async () => {
    const { w, token, me } = await setup()
    await chat(w, token, '3', '홍길동', buyer(1))
    await run(w)
    const post = (await take(w, token, me)).body.post as { ids: number[]; text: string }
    const before = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'chat'`)
    const echoed = await ext(w, '/ext/chats', token, { v: VIDEO, messages: [{ id: 'own1', ch: me, nick: '구피 가게', text: post.text, at: w.timer.now() }] })
    expect(echoed.status).toBe(200)
    const after = await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from events where type = 'chat'`)
    expect(after?.rows[0]?.n).toBe(before?.rows[0]?.n)
  })
})

describe('AC-X1-32 실패 반복 (YT-10 AC17, D-X1-24)', () => {
  it('연달아 3번 확인 필요 → 그 회차 멈춤·경고, "다시 켜기"로 다시 맡음. 게시됨이 끼면 셈 처음부터', async () => {
    const { w, b, token, me, api } = await setup()
    const fail = async (no: number, result: 'UNCONFIRMED' | 'POSTED') => {
      await chat(w, token, String(no), `구매${String(no)}`, buyer(no))
      await run(w)
      await w.timer.advance(3000)
      const post = (await take(w, token, me)).body.post as { ids: number[] }
      expect((await ext(w, '/ext/thanks/result', token, { ids: post.ids, result })).status).toBe(200)
    }
    await fail(1, 'UNCONFIRMED')
    await fail(2, 'UNCONFIRMED')
    await fail(3, 'POSTED')
    await fail(4, 'UNCONFIRMED')
    await fail(5, 'UNCONFIRMED')
    let view = (await api.get('/api/extension')).body.extension as { thanks: { warnings: { kind: string; message: string; broadcast: string }[] } }
    expect(view.thanks.warnings).toEqual([])
    await fail(6, 'UNCONFIRMED')
    view = (await api.get('/api/extension')).body.extension as { thanks: { warnings: { kind: string; message: string; broadcast: string }[] } }
    expect(view.thanks.warnings).toEqual([{ broadcast: b.id, kind: 'PAUSED', message: '확장으로 감사 글을 올리지 못하고 있어요' }])
    await w.timer.advance(3000)
    expect((await take(w, token, me)).body.state).toBe('PAUSED')
    const resumed = await api.post('/api/extension/thanks/resume', { broadcast: b.id })
    expect(resumed.status, resumed.text).toBe(200)
    await chat(w, token, '7', '일곱', buyer(7))
    await run(w)
    expect((await take(w, token, me)).body.state).toBe('POST')
  })
})

describe('AC-X1-25 다른 경로 중복은 서버 도착 10초 이하만 (D-X1-28)', () => {
  it('ID 모양이 다른 같은 채팅: 도착 4초 차 → 1건, 11초 차 → 2건', async () => {
    const { w, connected, b, token } = await setup({ thanks: false })
    const at = w.timer.now()
    const official = (id: string, text: string, publishedAt: number) => w.server.ingestChat(connected.seller.sellerId, { b: b.id, id, ch: buyer(9), nick: '같은', text, publishedAt })
    expect((await official('yt-A', '9', at)).status).toBe('recorded')
    await w.timer.advance(4000)
    expect((await ext(w, '/ext/chats', token, { v: VIDEO, messages: [{ id: 'dom-A', ch: buyer(9), nick: '같은', text: '9', at: at + 2000 }] })).body.recorded).toBe(0)
    const at2 = w.timer.now()
    expect((await official('yt-B', '8', at2)).status).toBe('recorded')
    await w.timer.advance(11_000)
    expect((await ext(w, '/ext/chats', token, { v: VIDEO, messages: [{ id: 'dom-B', ch: buyer(9), nick: '같은', text: '8', at: at2 + 2000 }] })).body.recorded).toBe(1)
  })
})
