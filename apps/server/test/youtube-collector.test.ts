// AC-Y1-20~29 채팅 수집 (YT-03, NFR-03·04, D-Y04·D-Y05·D-Y10): 어댑터·대체, 메시지 → chat, 이어받기, 오류, 잇기 전·끝낸 뒤, 우리 감사 빼기,
// 삭제·차단 알림, 수집 상태·서버 전체에서 하나, 많은 채팅. 가짜 유튜브 서버에 실제 통신 방식(HTTP 스트림·폴링)으로 붙는다.
import { applyEvent, getProduct, initEngine, listClaims, type EngineEvent, type EngineState } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { checkReplay } from '../src/check-replay.ts'
import { MERGED_BODY, RAW_JOIN, client, createBroadcast, expectOk, writeEvent } from './support.ts'
import { connectSeller, linkedBroadcast, sibling, until, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

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

const at = (iso: string) => Date.parse(iso)

async function chatIds(w: YoutubeWorld): Promise<string[]> {
  const rows = await w.database.pglite?.query<{ id: string }>(`select chat_message_id as id from events where type = 'chat' order by seq`)
  return (rows?.rows ?? []).map((row) => row.id)
}

async function chatBodies(w: YoutubeWorld): Promise<Record<string, unknown>[]> {
  const rows = await w.database.pglite?.query<{ body: string }>(`select ${MERGED_BODY} as body from events e ${RAW_JOIN} where e.type = 'chat' order by e.seq`)
  return (rows?.rows ?? []).map((row) => JSON.parse(row.body) as Record<string, unknown>)
}

async function collector(w: YoutubeWorld, cookie: string, b: string): Promise<Record<string, unknown>> {
  return (await client(w, cookie).get(`/api/broadcasts/${b}/youtube`)).body.collector as Record<string, unknown>
}

async function replayDb(w: YoutubeWorld, date: string): Promise<EngineState> {
  const rows = await w.database.pglite?.query<{ body: string; failed: boolean }>(
    `select ${MERGED_BODY} as body, e.failed from events e ${RAW_JOIN} join scopes s on s.id = e.scope_id where s.date = $1 and s.rehearsal = false order by e.seq`,
    [date],
  )
  let state = initEngine({ broadcasts: [], settings: {} })
  for (const row of rows?.rows ?? []) if (!row.failed) state = applyEvent(state, JSON.parse(row.body) as EngineEvent).state
  return state
}

describe('AC-Y1-21 메시지 → chat 이벤트', () => {
  it('일반 채팅·슈퍼챗·멤버십 축하(댓글 있을 때만), 정리한 이름, 게시 시각, 채팅 소유자만 owner. 그 밖의 종류·같은 ID는 기록하지 않는다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    w.server.youtube?.collectors.start()
    const t = new Date(w.timer.now() + 1000).toISOString()
    w.fake.addMessage(liveChatId, { id: 'm1', author: 'UCviewerA', name: '@핑크맘\n15번 무료나눔', text: '15', publishedAt: t })
    w.fake.addMessage(liveChatId, { id: 'm2', author: 'UCviewerB', name: '후원자', type: 'superChatEvent', userComment: '16번 주세요', publishedAt: t })
    w.fake.addMessage(liveChatId, { id: 'm3', author: 'UCviewerC', name: '말없는후원', type: 'superChatEvent', publishedAt: t })
    w.fake.addMessage(liveChatId, { id: 'm4', author: 'UCviewerD', name: '멤버', type: 'memberMilestoneChatEvent', userComment: '17', publishedAt: t })
    w.fake.addMessage(liveChatId, { id: 'm5', author: 'UCviewerE', name: '스티커', type: 'superStickerEvent', publishedAt: t })
    w.fake.addMessage(liveChatId, { id: 'm6', author: 'UCviewerF', name: '새멤버', type: 'newSponsorEvent', publishedAt: t })
    w.fake.addMessage(liveChatId, { id: 'm7', author: 'UCmod', name: '운영자', text: '18', moderator: true, publishedAt: t })
    w.fake.addMessage(liveChatId, { id: 'm8', author: connected.channel.id, name: '구피 가게', text: '판매자 손 채팅', publishedAt: t })
    w.fake.addMessage(liveChatId, { id: 'm1', author: 'UCviewerA', name: '핑크맘', text: '15', publishedAt: t })
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 5, { step: 100 })
    const bodies = await chatBodies(w)
    expect(bodies.map(({ seq: _seq, at: _at, ...rest }) => rest)).toEqual([
      { type: 'chat', b: b.id, id: 'm1', ch: 'UCviewerA', nick: '핑크맘 15번 무료나눔', text: '15', publishedAt: at(t) },
      { type: 'chat', b: b.id, id: 'm2', ch: 'UCviewerB', nick: '후원자', text: '16번 주세요', publishedAt: at(t) },
      { type: 'chat', b: b.id, id: 'm4', ch: 'UCviewerD', nick: '멤버', text: '17', publishedAt: at(t) },
      { type: 'chat', b: b.id, id: 'm7', ch: 'UCmod', nick: '운영자', text: '18', publishedAt: at(t) },
      { type: 'chat', b: b.id, id: 'm8', ch: connected.channel.id, nick: '구피 가게', text: '판매자 손 채팅', owner: true, publishedAt: at(t) },
    ])
    // 조치자 수집기, 실제 범위, at = 서버 도착 시각
    const rows = await w.database.pglite?.query<{ actor: string; chat_source: string; raw: boolean }>(`select actor, chat_source, raw from events where type = 'chat'`)
    expect(rows?.rows.every((row) => row.actor === 'collector' && row.chat_source === 'youtube' && row.raw)).toBe(true)
  })
})

describe('AC-Y1-20 어댑터 셋과 대체 경로', () => {
  it('streamList가 지원하지 않는다고 하면(404) 폴링으로 바꿔 같은 지점부터. 폴링은 pollingIntervalMillis보다 자주 부르지 않는다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    w.fake.pollingIntervalMillis = 3000
    w.fake.fail('liveChatMessages.streamList', { status: 404, reason: 'notFound' })
    w.fake.addMessage(liveChatId, { author: 'UCa', name: '가', text: '안녕' })
    w.server.youtube?.collectors.start()
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).mode === 'POLL', { step: 100 })
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 1, { step: 100 })
    const before = w.fake.calls('liveChatMessages.list')
    const started = w.timer.now()
    w.fake.addMessage(liveChatId, { author: 'UCb', name: '나', text: '반가워요' })
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 2, { step: 500 })
    for (let i = 0; i < 20; i++) await w.timer.advance(500)
    const calls = w.fake.calls('liveChatMessages.list') - before
    const elapsed = w.timer.now() - started
    expect(calls).toBeLessThanOrEqual(Math.floor(elapsed / 3000) + 1)
    expect(w.fake.calls('liveChatMessages.streamList')).toBe(1)
  })

  it('응답을 하나도 받지 못한 채 연속 3번 실패하면 폴링으로', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    w.fake.fail('liveChatMessages.streamList', { status: 503, reason: 'backendError' }, 3)
    w.fake.addMessage(liveChatId, { author: 'UCa', name: '가', text: '안녕' })
    w.server.youtube?.collectors.start()
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 1, { step: 500 })
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ mode: 'POLL', status: 'LIVE' })
    expect(w.fake.calls('liveChatMessages.streamList')).toBe(3)
  })
})

describe('AC-Y1-23 이어받기 — 누락·중복 없음', () => {
  it('메시지 2,000건을 흘리는 동안 스트림을 묶음 중간에 5번 끊고, 묶음 기록 직후·지점 저장 직전에 수집기(서버)를 죽였다 살린다', async () => {
    let killed = false
    const holder: { kill?: () => void; ready?: () => boolean } = {}
    const w = await world({
      overrides: {
        collectorHooks: {
          beforeSaveToken: () => {
            // 메시지가 900건 넘게 흐른 뒤 처음 맞는 묶음: 기록은 커밋됐고 지점은 아직 — 여기서 서버가 죽는다
            if (!killed && holder.ready?.() === true) {
              killed = true
              holder.kill?.()
              throw new Error('죽음')
            }
          },
        },
      },
    })
    const connected = await connectSeller(w)
    const { b, live } = await linkedBroadcast(w, connected)
    const liveChatId = live.liveChatId as string
    const managerA = w.server.youtube?.collectors
    if (managerA === undefined) throw new Error('유튜브가 없다')
    holder.kill = () => void managerA.kill()
    holder.ready = () => w.fake.messages(liveChatId).length >= 900
    w.fake.pageSize = 50
    managerA.start()
    const sent: string[] = []
    let cuts = 0
    let revived: YoutubeWorld | null = null
    for (let batch = 0; batch < 20 || cuts < 5; batch++) {
      // 죽은 서버를 다시 살린다 (새 서버 B — A의 임대가 지난 뒤 이어받는다)
      if (killed && revived === null) {
        revived = sibling(w, 'B')
        extras.push(revived)
        revived.server.youtube?.collectors.start()
      }
      if (batch >= 60) break
      for (let i = 0; i < 100; i++) {
        const id = `msg${String(batch * 100 + i).padStart(5, '0')}`
        if (batch >= 20) break
        sent.push(id)
        w.fake.addMessage(liveChatId, { id, author: `UCv${String(i % 37)}`, name: `시청자${String(i % 37)}`, text: i % 9 === 0 ? `${String((i % 5) + 1)}` : '안녕하세요', publishedAt: w.timer.now() })
      }
      // 열린 스트림이 있을 때 다음 묶음 중간에 끊는다 (5번)
      if (batch % 3 === 1 && cuts < 5 && (w.fake.openStreams.get(liveChatId) ?? 0) > 0) {
        w.fake.fail('liveChatMessages.streamList', { kind: 'cut' })
        cuts += 1
      }
      await until(w, () => true, { max: 1 })
      for (let k = 0; k < 4; k++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        await w.timer.advance(1000)
      }
    }
    expect(cuts).toBe(5)
    expect(killed).toBe(true)
    await until(w, async () => (await chatIds(w)).length >= sent.length, { step: 1000, max: 2000 })
    const ids = await chatIds(w)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(sent)
    const checks = await checkReplay(w.database.db)
    expect(checks.every((check) => check.ok)).toBe(true)
    // 처음 + 끊긴 5번 + 죽은 뒤 다시: 스트림을 적어도 7번 열었다
    expect(w.fake.calls('liveChatMessages.streamList')).toBeGreaterThanOrEqual(7)
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ recorded: 2000 })
  }, 120_000)
})

describe('AC-I3-24·TE-I3-001 조용한 채팅 — 스트림이 열리면 채팅을 받는 중', () => {
  /** 그 판매자에게 보낸 유튜브 알림(SSE)을 모은다 */
  function watchYoutube(w: YoutubeWorld): Record<string, unknown>[] {
    const seen: Record<string, unknown>[] = []
    const hub = w.server.hub
    const original = hub.publishYoutube.bind(hub)
    hub.publishYoutube = (sellerId: string, data: Readonly<Record<string, unknown>>) => {
      seen.push({ ...data })
      original(sellerId, data)
    }
    return seen
  }

  it('채팅이 하나도 없는 라이브: 가짜가 첫 응답 묶음을 쓰지 않아도 스트림이 열리면 LIVE("채팅을 받는 중") + collector 알림, 받은 채팅 0개. 끊긴 뒤 다시 열려도(여전히 조용) LIVE', async () => {
    const w = await world()
    // 수집기 몫만 본다: 새 메시지가 없으면 스트림에 응답 묶음이 하나도 오지 않는다
    w.fake.streamGreeting = false
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    const seen = watchYoutube(w)
    w.server.youtube?.collectors.start()
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).status === 'LIVE')
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'LIVE', statusMessage: '채팅을 받는 중', reason: null, recorded: 0, lastMessageAt: null, mode: 'STREAM' })
    expect(w.fake.openStreams.get(liveChatId)).toBe(1)
    expect(seen.filter((data) => data.kind === 'collector').at(-1)).toMatchObject({ broadcast: b.id, collector: { status: 'LIVE', statusMessage: '채팅을 받는 중', recorded: 0 } })
    // 스트림이 끊긴다 → 다시 연결하는 중 → 다시 열리면(메시지는 여전히 없음) 채팅을 받는 중
    w.fake.dropStreams()
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).status === 'RETRYING')
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).status === 'LIVE', { step: 1000, max: 40 })
    expect(seen.filter((data) => data.kind === 'collector').map((data) => (data.collector as { status: string }).status).slice(-2)).toEqual(['RETRYING', 'LIVE'])
    // 시청자 채팅이 오면 받은 수가 는다
    w.fake.addMessage(liveChatId, { author: 'UCa', name: '가', text: '안녕하세요', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 1, { step: 250 })
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'LIVE', recorded: 1 })
    await w.server.youtube?.collectors.stop()
  })

  it('예정 방송이 시작되면(시작 뒤 채팅이 아직 없어도) 그 확인 바퀴에서 스트림을 열고 LIVE — 가짜는 실제 streamList처럼 연결 직후 빈 첫 응답을 준다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const b = await createBroadcast(w, connected.seller)
    const upcoming = w.fake.addBroadcast(connected.channel.id, { status: 'upcoming' })
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'quiet-up', video: upcoming.videoId })).status).toBe(200)
    w.server.youtube?.collectors.start()
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).reason === 'NOT_STARTED')
    w.fake.startBroadcast(upcoming.videoId, w.timer.now())
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).status === 'LIVE', { step: 1000, max: 60 })
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'LIVE', statusMessage: '채팅을 받는 중', reason: null, reasonMessage: null, recorded: 0 })
    await w.server.youtube?.collectors.stop()
  })
})

describe('AC-Y1-24 끊김·오류·다시 시작', () => {
  it('5xx·속도 제한은 5초부터 두 배씩 다시 시도("다시 연결하는 중"), 받으면 간격 초기화 (AC-Y1-24·94 — 처음엔 1초부터였다)', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    await client(w, connected.seller.cookie).get('/api/youtube/connection')
    w.fake.fail('liveChatMessages.streamList', { status: 500 })
    w.fake.fail('liveChatMessages.streamList', { status: 403, reason: 'rateLimitExceeded' })
    w.server.youtube?.collectors.start()
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).status === 'RETRYING', { step: 0, max: 200 })
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'RETRYING', statusMessage: '다시 연결하는 중' })
    w.fake.addMessage(liveChatId, { author: 'UCa', name: '가', text: '1' })
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 1, { step: 500 })
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'LIVE', statusMessage: '채팅을 받는 중' })
    // 스트림 열기 간격: 실패 뒤 5초, 다시 실패 뒤 10초
    const opens = w.fake.callTimes.filter((call) => call.method === 'liveChatMessages.streamList').map((call) => call.at)
    expect(opens.length).toBeGreaterThanOrEqual(3)
    expect((opens[1] as number) - (opens[0] as number)).toBeGreaterThanOrEqual(5000)
    expect((opens[2] as number) - (opens[1] as number)).toBeGreaterThanOrEqual(10_000)
  })

  it('이어받기 지점 거절: 지점 없이 다시 — 기록은 메시지 ID로 중복 없음, "일부를 받지 못했을 수 있어요"', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    w.server.youtube?.collectors.start()
    w.fake.addMessage(liveChatId, { id: 'a1', author: 'UCa', name: '가', text: '1', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 1, { step: 100 })
    w.fake.fail('liveChatMessages.streamList', { status: 400, reason: 'pageTokenInvalid' })
    w.fake.dropStreams()
    w.fake.addMessage(liveChatId, { id: 'a2', author: 'UCb', name: '나', text: '2', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 2, { step: 500 })
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ gap: true, gapMessage: '끊긴 동안의 채팅 일부를 받지 못했을 수 있어요.' })
    expect(await chatIds(w)).toEqual(['a1', 'a2'])
  })

  it('채팅 끝남·꺼짐·권한 없음·없음은 멈추고 문장을 준다. 끝남이 아닌 것은 다시 시작할 수 있다(같은 지점부터)', async () => {
    const cases: [string, { status: number; reason: string }, string, string, boolean][] = [
      ['끝남', { status: 403, reason: 'liveChatEnded' }, 'CHAT_ENDED', '유튜브 채팅이 끝났어요.', false],
      ['꺼짐', { status: 403, reason: 'liveChatDisabled' }, 'STOPPED', '채팅이 꺼져 있어요.', true],
      ['권한 없음', { status: 403, reason: 'forbidden' }, 'STOPPED', '채팅을 읽을 권한이 없어요.', true],
      ['없음', { status: 404, reason: 'liveChatNotFound' }, 'STOPPED', '채팅을 찾을 수 없어요.', true],
    ]
    for (const [label, fault, status, message, restartable] of cases) {
      const w = await world()
      const connected = await connectSeller(w)
      const { b, liveChatId } = await linkedBroadcast(w, connected)
      w.fake.fail('liveChatMessages.streamList', fault)
      w.server.youtube?.collectors.start()
      await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).status === status, { step: 100 })
      expect(await collector(w, connected.seller.cookie, b.id), label).toMatchObject({ status, statusMessage: message, restartable })
      const restart = await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/youtube/collector/restart`, {})
      if (!restartable) {
        expect(restart.body, label).toMatchObject({ error: { code: 'COLLECTOR_NOT_RESTARTABLE' } })
        // 유튜브 라이브가 끝나면 라이브찜 회차도 판매자가 끝낼 때와 같은 길로 저절로 끝낸다 (D-LIVE-AUTOEND — 전에는 끝내지 않았다)
        expect(((await client(w, connected.seller.cookie).get(`/api/days/${b.date}`)).body.broadcasts as { ended: boolean }[])[0]?.ended).toBe(true)
        continue
      }
      expect(restart.status, label).toBe(200)
      w.fake.addMessage(liveChatId, { author: 'UCa', name: '가', text: '안녕', publishedAt: w.timer.now() + 1 })
      await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 1, { step: 1000 })
    }
  }, 60_000)

  it('할당량 초과면 멈추고("오늘 유튜브 사용량을 다 썼어요.") 태평양 자정 뒤 저장한 지점부터 저절로 이어받는다', async () => {
    const w = await world({ start: Date.parse('2026-10-20T06:50:00Z') })
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    w.fake.fail('liveChatMessages.streamList', { status: 403, reason: 'quotaExceeded' })
    w.server.youtube?.collectors.start()
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).reason === 'QUOTA', { step: 100 })
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'STOPPED', statusMessage: '오늘 유튜브 사용량을 다 썼어요.', restartable: false })
    expect(((await client(w, connected.seller.cookie).get('/api/youtube/quota')).body.quota as { mode: string }).mode).toBe('PAUSED')
    w.fake.addMessage(liveChatId, { author: 'UCa', name: '가', text: '자정 뒤', publishedAt: w.timer.now() + 1 })
    await w.timer.set(Date.parse('2026-10-20T06:59:00Z'))
    expect((await collector(w, connected.seller.cookie, b.id)).status).toBe('STOPPED')
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 1, { step: 5000 })
    expect(w.timer.now()).toBeGreaterThanOrEqual(Date.parse('2026-10-20T07:00:00Z'))
  })
})

describe('AC-Y1-25 잇기 전 채팅·끝낸 뒤 채팅', () => {
  it('20:00 잇고 첫 응답의 19:59:50·20:00:05 → 20:00:05만. 20:30 끝내고 20:29:58·20:30:01 도착 → 20:29:58만. 20:40 뒤 멈춘다', async () => {
    const w = await world({ start: Date.parse('2026-10-19T11:00:00Z') }) // 20:00:00 KST
    const connected = await connectSeller(w)
    const b = (await expectOk(client(w, connected.seller.cookie).post('/api/broadcasts', { requestId: 'bc-25' }))).body.broadcast as { id: string; date: string }
    const live = w.fake.addBroadcast(connected.channel.id, { status: 'live' })
    const liveChatId = live.liveChatId as string
    w.fake.addMessage(liveChatId, { id: 'early', author: 'UCa', name: '가', text: '15', publishedAt: '2026-10-19T10:59:50.000Z' })
    w.fake.addMessage(liveChatId, { id: 'ok1', author: 'UCb', name: '나', text: '안녕', publishedAt: '2026-10-19T11:00:05.000Z' })
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'l25', video: live.videoId })).status).toBe(200)
    w.server.youtube?.collectors.start()
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 1, { step: 0, max: 200 })
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ recorded: 1, skippedBeforeLink: 1 })
    expect(await chatIds(w)).toEqual(['ok1'])
    // 20:30:00 끝낸다
    await w.timer.set(Date.parse('2026-10-19T11:30:00Z'))
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-25' })).status).toBe(200)
    await w.timer.set(Date.parse('2026-10-19T11:30:20Z'))
    w.fake.addMessage(liveChatId, { id: 'late-ok', author: 'UCc', name: '다', text: '늦게 도착', publishedAt: '2026-10-19T11:29:58.000Z' })
    w.fake.addMessage(liveChatId, { id: 'after-end', author: 'UCd', name: '라', text: '15', publishedAt: '2026-10-19T11:30:01.000Z' })
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).recorded === 2, { step: 0, max: 200 })
    expect(await chatIds(w)).toEqual(['ok1', 'late-ok'])
    // 20:40:00 뒤 멈춘다 — 가짜 서버 호출이 더 없다
    await w.timer.set(Date.parse('2026-10-19T11:40:01Z'))
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).status === 'FINISHED', { step: 0, max: 400 })
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'FINISHED', statusMessage: '방송을 끝내 수집을 마쳤어요.' })
    const calls = w.fake.calls('liveChatMessages.streamList') + w.fake.calls('liveChatMessages.list')
    for (let i = 0; i < 10; i++) await w.timer.advance(10_000)
    expect(w.fake.calls('liveChatMessages.streamList') + w.fake.calls('liveChatMessages.list')).toBe(calls)
  })
})

describe('AC-Y1-26 우리가 게시한 감사는 기록하지 않는다', () => {
  it('LOOSE·방송자 무시 끔: 17번(800원) 판매 → 감사 게시 → 가짜 서버가 돌려준 우리 메시지는 찜이 되지 않는다. 손으로 쓴 판매자 채팅은 owner', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: { 'claim.parseMode': 'LOOSE', 'claim.ignoreOwner': false } })
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 17, name: '미니마', price: 800 }))
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 18, name: '라울', price: 900, stock: 2 }))
    const youtube = w.server.youtube
    if (youtube === null) throw new Error('유튜브가 없다')
    youtube.collectors.start()
    w.fake.addMessage(liveChatId, { author: 'UCyounghee', name: '이영희', text: '17', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatIds(w)).length === 1, { step: 100 })
    await youtube.outbox.runOnce()
    await youtube.outbox.runOnce()
    expect(w.fake.posted.map((post) => post.text)).toEqual(['17번 미니마 800원 이영희님 구매 감사합니다'])
    // 우리 메시지가 채팅으로 돌아왔다 — 기록하지 않는다
    await until(w, async () => (await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from youtube_own_messages`))?.rows[0]?.n === 1, { step: 100 })
    const day = (await client(w, connected.seller.cookie).get(`/api/days/${b.date}`)).body
    expect((day.claims as unknown[]).length).toBe(1)
    expect(await chatIds(w)).toHaveLength(1)
    // 판매자가 손으로 쓴 18 → owner로 기록, 방송자 무시를 꺼서 판매자 찜이 된다(R-4 — 설정대로)
    w.fake.addMessage(liveChatId, { author: connected.channel.id, name: '구피 가게', text: '18', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatIds(w)).length === 2, { step: 100 })
    const bodies = await chatBodies(w)
    expect(bodies[1]).toMatchObject({ ch: connected.channel.id, owner: true, text: '18' })
    const state = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 17)?.winners).toEqual(['UCyounghee'])
    expect(listClaims(state).filter((claim) => claim.no === 17)).toHaveLength(1)
  })
})

describe('AC-Y1-27 지운 메시지·유튜브 차단 알림', () => {
  it('기록된 메시지가 지워지면 알림(주문이었는지), 기록되지 않은 메시지는 아무 일 없음, 차단 알림. 엔진은 그대로, 같은 알림은 하나', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    w.server.youtube?.collectors.start()
    w.fake.addMessage(liveChatId, { id: 'order1', author: 'UCa', name: '@가.나', text: '15', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatIds(w)).length === 1, { step: 100 })
    const before = await w.server.writer.read(connected.seller.sellerId, b.date)
    const seqBefore = before.seq
    w.fake.deleteMessage(liveChatId, 'order1')
    w.fake.deleteMessage(liveChatId, 'never-recorded')
    w.fake.banUser(liveChatId, { channelId: 'UCbad', name: 'bad\nguy', seconds: 300 })
    await until(w, async () => ((await client(w, connected.seller.cookie).get(`/api/days/${b.date}/youtube-notices`)).body.notices as unknown[]).length === 2, { step: 100 })
    // 같은 삭제가 또 와도 하나
    w.fake.deleteMessage(liveChatId, 'order1')
    for (let i = 0; i < 5; i++) await until(w, () => true, { max: 2 })
    const notices = (await client(w, connected.seller.cookie).get(`/api/days/${b.date}/youtube-notices`)).body.notices as Record<string, unknown>[]
    expect(notices.map(({ id: _id, at: _at, ...rest }) => rest)).toEqual([
      { kind: 'DELETED', broadcast: b.id, messageId: 'order1', channel: 'UCa', nick: '가·나', wasOrder: true, wasCancel: false, banType: null, banSeconds: null, message: '시청자가 메시지를 지웠어요. 그 메시지로 생긴 찜은 그대로예요.' },
      { kind: 'BANNED', broadcast: b.id, messageId: null, channel: 'UCbad', nick: 'bad guy', wasOrder: false, wasCancel: false, banType: 'TEMPORARY', banSeconds: 300, message: '유튜브에서 차단된 시청자예요. 라이브지니에서도 막으려면 차단해 주세요.' },
    ])
    const after = await w.server.writer.read(connected.seller.sellerId, b.date)
    expect(after.seq).toBe(seqBefore)
    expect(getProduct(after.state, b.id, 15)?.winners).toEqual(['UCa'])
    // 다른 판매자는 그 날짜의 알림을 보지 못한다
    const other = await connectSeller(w)
    expect((await client(w, other.seller.cookie).get(`/api/days/${b.date}/youtube-notices`)).body.notices).toEqual([])
  })
})

describe('AC-Y1-28 수집 상태·서버 전체에서 하나', () => {
  it('수집 관리자 둘이 같은 DB에 떠도 회차마다 스트림 하나·기록 중복 0. 하나가 죽으면 다른 하나가 30초 안에 이어받는다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    const second = sibling(w, 'B')
    extras.push(second)
    const a = w.server.youtube?.collectors
    const bm = second.server.youtube?.collectors
    if (a === undefined || bm === undefined) throw new Error('유튜브가 없다')
    a.start()
    bm.start()
    for (let i = 0; i < 30; i++) w.fake.addMessage(liveChatId, { author: `UC${String(i)}`, name: `n${String(i)}`, text: '안녕', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatIds(w)).length === 30, { step: 1000 })
    expect(w.fake.openStreams.get(liveChatId)).toBe(1)
    expect(a.running.length + bm.running.length).toBe(1)
    const holder = a.running.length === 1 ? a : bm
    const other = holder === a ? bm : a
    await holder.kill()
    const killedAt = w.timer.now()
    for (let i = 0; i < 30; i++) w.fake.addMessage(liveChatId, { author: `UCx${String(i)}`, name: `m${String(i)}`, text: '반가워요', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatIds(w)).length === 60, { step: 1000 })
    expect(other.running.length).toBe(1)
    expect(w.timer.now() - killedAt).toBeLessThanOrEqual(30_000)
    const ids = await chatIds(w)
    expect(new Set(ids).size).toBe(60)
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'LIVE', mode: 'STREAM', recorded: 60, lastMessageAt: expect.any(String) })
  })
})

describe('AC-Y1-29 많은 채팅 (NFR-04)', () => {
  it('한 방송 채팅 1만 건(초당 50건 몰림 포함): 빠짐·중복 없이 모두 기록, 재생 상태 = 서버 범위 상태', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    for (let no = 1; no <= 20; no++) await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no, name: `상품${String(no)}`, price: 1000 * no }))
    w.fake.pageSize = 500
    w.server.youtube?.collectors.start()
    // 수집기가 붙은 뒤에 몰린다 (지점 없는 첫 연결은 실제 API처럼 최근 메시지만 준다 — RA-I3-001)
    await until(w, () => (w.fake.openStreams.get(liveChatId) ?? 0) > 0)
    const sent: string[] = []
    for (let second = 0; second < 200; second++) {
      for (let i = 0; i < 50; i++) {
        const n = second * 50 + i
        const id = `big${String(n).padStart(6, '0')}`
        sent.push(id)
        w.fake.addMessage(liveChatId, { id, author: `UCbig${String(n % 400)}`, name: `시청자${String(n % 400)}`, text: n % 7 === 0 ? String((n % 20) + 1) : '안녕하세요', publishedAt: w.timer.now() + 1 })
      }
      if (second % 20 === 0) await until(w, () => true, { max: 1 })
    }
    await until(w, async () => (await chatIds(w)).length === sent.length, { step: 200, max: 4000, realMs: 20 })
    const ids = await chatIds(w)
    expect(ids).toEqual(sent)
    const server = (await w.server.writer.read(connected.seller.sellerId, b.date)).state
    expect(server).toEqual(await replayDb(w, b.date))
  }, 180_000)
})

describe('AC-Y1-13·25·28 서버가 둘일 때 다른 서버에서 한 조작', () => {
  it('수집기가 A에서 도는데 B가 회차를 끝내면: 메시지가 더 오지 않는 조용한 스트림이어도 A가 알아채 끝낸 뒤 10분에 멈춘다(스트림 0)', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    w.server.youtube?.collectors.start()
    w.fake.addMessage(liveChatId, { id: 'before', author: 'UCa', name: '가', text: '안녕', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatIds(w)).length === 1, { step: 100 })
    const other = sibling(w, 'B')
    extras.push(other)
    expect((await client(other, connected.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-b' })).status).toBe(200)
    const endedAt = w.timer.now()
    // B의 끝내기를 A가 같은 서버 알림 없이 알아챈다 (임대를 늘릴 때) — 그 뒤 메시지가 하나도 오지 않는다
    await until(w, async () => (await collector(w, connected.seller.cookie, b.id)).status === 'FINISHED', { step: 10_000, max: 200 })
    expect(w.timer.now() - endedAt).toBeGreaterThanOrEqual(10 * 60 * 1000)
    expect(w.timer.now() - endedAt).toBeLessThanOrEqual(10 * 60 * 1000 + 30_000)
    expect(await chatIds(w)).toEqual(['before'])
    expect(w.fake.openStreams.get(liveChatId) ?? 0).toBe(0)
  })

  it('수집기가 A에서 도는데 B가 회차의 유튜브 연결을 끊으면: A가 멈추고(스트림 0) 끊은 뒤 채팅은 그 회차에 기록되지 않는다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    const a = w.server.youtube?.collectors
    if (a === undefined) throw new Error('유튜브가 없다')
    a.start()
    w.fake.addMessage(liveChatId, { id: 'before', author: 'UCa', name: '가', text: '안녕', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatIds(w)).length === 1, { step: 100 })
    const other = sibling(w, 'B')
    extras.push(other)
    expect((await client(other, connected.seller.cookie).post(`/api/broadcasts/${b.id}/youtube/unlink`, {})).status).toBe(200)
    await w.timer.advance(1000)
    w.fake.addMessage(liveChatId, { id: 'after', author: 'UCb', name: '나', text: '15', publishedAt: w.timer.now() })
    // 가짜 서버가 스트림이 닫힌 것을 아는 때는 수집기가 끝난 때보다 조금 늦을 수 있다 (HTTP 연결 닫힘 — 부하가 크면 더)
    await until(w, () => a.running.length === 0 && (w.fake.openStreams.get(liveChatId) ?? 0) === 0, { step: 1000, max: 200 })
    expect(await chatIds(w)).toEqual(['before'])
    expect(w.fake.openStreams.get(liveChatId) ?? 0).toBe(0)
  })

  it('수집기가 A에서 도는데 B가 판매자의 유튜브 연결 자체를 끊으면: 끊은 뒤 채팅은 기록되지 않고 A는 "연결 안 됨"으로 멈춘다(스트림 0)', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b, liveChatId } = await linkedBroadcast(w, connected)
    const a = w.server.youtube?.collectors
    if (a === undefined) throw new Error('유튜브가 없다')
    a.start()
    w.fake.addMessage(liveChatId, { id: 'before', author: 'UCa', name: '가', text: '안녕', publishedAt: w.timer.now() + 1 })
    await until(w, async () => (await chatIds(w)).length === 1, { step: 100 })
    const other = sibling(w, 'B')
    extras.push(other)
    expect((await client(other, connected.seller.cookie).post('/api/youtube/connection/disconnect', {})).status).toBe(200)
    await w.timer.advance(1000)
    // 임대를 늘리기(5초) 전에 스트림이 바로 넘겨도 기록 트랜잭션 안에서 연결 상태로 거른다
    w.fake.addMessage(liveChatId, { id: 'after', author: 'UCb', name: '나', text: '15', publishedAt: w.timer.now() })
    // 가짜 서버가 스트림이 닫힌 것을 아는 때는 수집기가 끝난 때보다 조금 늦을 수 있다 (HTTP 연결 닫힘)
    await until(w, () => a.running.length === 0 && (w.fake.openStreams.get(liveChatId) ?? 0) === 0, { step: 500, max: 200 })
    expect(await chatIds(w)).toEqual(['before'])
    expect(await collector(w, connected.seller.cookie, b.id)).toMatchObject({ status: 'STOPPED', reason: 'NOT_CONNECTED' })
  })

  it('기록 직전 범위 락 안에서도 거른다: 끝낸 뒤 게시된 메시지·끊은 연결의 묶음은 기록하지 않는다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b } = await linkedBroadcast(w, connected)
    const sellerId = connected.seller.sellerId
    const service = w.server.service
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-tx' })).status).toBe(200)
    const endedAt = w.timer.now()
    const outcome = await service.ingestYoutubeBatch(sellerId, b.id, [
      { id: 'm-before', ch: 'UCa', nick: '가', text: '안녕', publishedAt: endedAt - 1 },
      { id: 'm-after', ch: 'UCb', nick: '나', text: '15', publishedAt: endedAt + 1 },
    ])
    expect(outcome).toEqual({ status: 'ok', recorded: 1 })
    expect(await chatIds(w)).toEqual(['m-before'])
    expect(await service.ingestYoutubeBatch(sellerId, b.id, [{ id: 'm-guard', ch: 'UCc', nick: '다', text: '안녕', publishedAt: endedAt - 1 }], () => Promise.resolve(false))).toEqual({ status: 'unlinked' })
    expect(await chatIds(w)).toEqual(['m-before'])
  })
})

describe('AC-Y1-12·28 수집 후보 — 끝난 수집기는 다시 훑지 않는다', () => {
  it('봉인·끊음·손으로 다시 시작해야 하는 멈춤은 후보에서 빠지고, 다시 시작하면 돌아온다. 저절로 이어받을 멈춤(다시 연결 필요)은 후보', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const { b } = await linkedBroadcast(w, connected)
    const { collectorCandidates } = await import('../src/youtube/store.ts')
    const db = w.database.db
    const candidates = async () => (await collectorCandidates(db, 'A', new Date(w.timer.now()))).length
    const setStatus = (status: string, reason: string | null) => w.database.pglite?.query(`update youtube_collectors set status = $1, reason = $2, lease_owner = null, lease_until = null`, [status, reason])
    expect(await candidates()).toBe(1)
    for (const reason of ['SEALED', 'CHAT_DISABLED', 'FORBIDDEN', 'CHAT_NOT_FOUND', 'UNLINKED']) {
      await setStatus('STOPPED', reason)
      expect(await candidates(), reason).toBe(0)
    }
    for (const status of ['FINISHED', 'CHAT_ENDED']) {
      await setStatus(status, null)
      expect(await candidates(), status).toBe(0)
    }
    for (const reason of ['RECONNECT', 'NOT_CONNECTED', 'NOT_MY_CHANNEL', 'QUOTA']) {
      await setStatus('STOPPED', reason)
      expect(await candidates(), reason).toBe(1)
    }
    // 손으로 다시 시작 → 후보로 돌아온다
    await setStatus('STOPPED', 'FORBIDDEN')
    expect(await candidates()).toBe(0)
    expect((await client(w, connected.seller.cookie).post(`/api/broadcasts/${b.id}/youtube/collector/restart`, {})).status).toBe(200)
    expect(await candidates()).toBe(1)
  })
})
