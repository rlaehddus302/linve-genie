// AIY1 서버 시험 (CMT-06, R-20 10 "유튜브 채팅은 보내지 않는다", D-AIY1-01~06): 유튜브에서 온 줄(출처 youtube·extension·모름)은 AI로 보내지 않는다.
// 가짜 LLM 서버로 보낸 요청을 직접 보고, assist_calls·assist_cache·로그를 확인한다. 출처는 서버가 기록한 events.chat_source에서 읽는다.
import { describe, expect, it } from 'vitest'
import type { FakeLlm } from '../src/assist/fake-llm.ts'
import { client, expectOk, writeEvent, type Seller, type TestServer } from './support.ts'
import { assistWorld, byText, chat, enableAssist, optionBroadcast, reviews, sentTexts, shortsBroadcast, suggest, youtubeChat } from './a1-support.ts'

const pg = (world: TestServer) => {
  const db = world.database.pglite
  if (db === undefined || db === null) throw new Error('PGlite가 아니다')
  return db
}

async function count(world: TestServer, table: 'assist_calls' | 'assist_cache'): Promise<number> {
  const rows = await pg(world).query<{ n: number }>(`select count(*)::int as n from ${table}`)
  return rows.rows[0]?.n ?? 0
}

async function usedToday(world: TestServer, seller: Seller): Promise<number> {
  return (await expectOk(client(world, seller.cookie).get('/api/assist/settings'))).body.usedToday as number
}

/** 크롬 확장 경로로 받은 유튜브 채팅 (출처 extension) */
async function extensionChat(world: TestServer, seller: Seller, b: string, id: string, text: string, nick = '확장시청자', ch = 'UCextension000000000001'): Promise<void> {
  const outcome = await world.server.service.ingestYoutubeBatch(seller.sellerId, b, [{ id, ch, nick, text }], undefined, 'extension')
  expect(outcome).toEqual({ status: 'ok', recorded: 1 })
}

/** 그 글의 채팅 이벤트 출처를 직접 바꾼다 (시험 행 — 빈 값·모르는 값·예전 기록 흉내) */
async function setSource(world: TestServer, text: string, source: string | null): Promise<void> {
  const rows = await pg(world).query<{ seq: number }>(
    `update events set chat_source = $1 where id in (select e.id from events e left join chat_raw r on r.seller_id = e.seller_id and r.scope_id = e.scope_id and r.seq = e.seq where e.chat_message_id is not null and coalesce(r.text, e.body::json->>'text') = $2) returning seq`,
    [source, text],
  )
  expect(rows.rows.length, text).toBeGreaterThan(0)
}

/** 가짜 서버가 받은 요청 하나의 항목 id */
function sentIds(fake: FakeLlm, index: number): string[] {
  const body = fake.requests[index]?.body as { messages?: { content?: string }[] } | undefined
  const content = body?.messages?.[0]?.content ?? '{}'
  return ((JSON.parse(content) as { items?: { id: string }[] }).items ?? []).map((item) => item.id)
}

const allRaw = (fake: FakeLlm): string => fake.requests.map((request) => request.raw).join('\n')

describe('AC-AIY1-01 유튜브 줄만 있는 방송은 부르지 않는다', () => {
  it('출처 youtube·extension 줄만 있으면 호출 0번, DONE·called 0, assist_calls·assist_cache 새 줄 없음, 오늘 사용량 그대로', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    await youtubeChat(world, seller, b.id, '반바지 가나다')
    await extensionChat(world, seller, b.id, 'ext-1', '반바지 라마바')
    await enableAssist(world, seller)
    const used = await usedToday(world, seller)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 0 })
    expect((await expectOk(suggest(world, seller, { rehearsal: false, broadcast: b.id }))).body).toEqual({ result: 'DONE', called: 0 })
    expect(fake.calls).toBe(0)
    expect(await count(world, 'assist_calls')).toBe(0)
    expect(await count(world, 'assist_cache')).toBe(0)
    expect(await usedToday(world, seller)).toBe(used)
    const rows = await reviews(world, seller)
    expect(rows.map((row) => row.reason)).toEqual(['UNKNOWN_WORD', 'UNKNOWN_WORD'])
    for (const row of rows) {
      expect(row.suggestion).toBeNull()
      expect((row as unknown as Record<string, unknown>).excluded).toBe('YOUTUBE_POLICY')
    }
  })
})

describe('AC-AIY1-02 섞인 묶음은 유튜브 줄만 빼고 보낸다', () => {
  it('youtube A·extension B·other C·D → 요청 1개, 항목은 C·D만(id 1·2), A·B 글은 요청 어디에도 없음, assist_calls 1줄 items 2', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    await youtubeChat(world, seller, b.id, '반바지 가나다')
    await extensionChat(world, seller, b.id, 'ext-1', '반바지 라마바')
    await chat(world, seller, b.id, '반바지 사아자')
    await chat(world, seller, b.id, '반바지 차카타')
    await youtubeChat(world, seller, b.id, '반바지 미디엄') // 규칙으로 풀리는 유튜브 줄
    await enableAssist(world, seller)
    fake.answer('반바지 사아자', { no: 21, options: { 사이즈: 'M' }, qty: 1 })
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    expect(fake.calls).toBe(1)
    expect(sentTexts(fake, 0)).toEqual(['반바지 사아자', '반바지 차카타'])
    expect(sentIds(fake, 0)).toEqual(['1', '2'])
    for (const banned of ['가나다', '라마바', '미디엄']) expect(allRaw(fake), banned).not.toContain(banned)
    const calls = await pg(world).query<{ items: number }>('select items from assist_calls')
    expect(calls.rows).toEqual([{ items: 2 }])
    expect(await count(world, 'assist_cache')).toBe(2)
    const rows = await reviews(world, seller)
    expect(byText(rows, '반바지 사아자').suggestion).toEqual({ no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'AI' })
    expect(byText(rows, '반바지 가나다').suggestion).toBeNull()
    expect(byText(rows, '반바지 라마바').suggestion).toBeNull()
    expect(byText(rows, '반바지 미디엄').suggestion).toEqual({ no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'RULE' })
    const excluded = (text: string) => (byText(rows, text) as unknown as Record<string, unknown>).excluded
    expect(excluded('반바지 가나다')).toBe('YOUTUBE_POLICY')
    expect(excluded('반바지 라마바')).toBe('YOUTUBE_POLICY')
    expect(excluded('반바지 미디엄')).toBe('YOUTUBE_POLICY')
    expect(excluded('반바지 사아자')).toBeNull()
    expect(excluded('반바지 차카타')).toBeNull()
  })

  it('리허설 범위의 출처 rehearsal 줄은 A1처럼 보낸다', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller, { rehearsal: true })
    expect(b.rehearsal).toBe(true)
    await youtubeChat(world, seller, b.id, '반바지 리허설글')
    const source = await pg(world).query<{ chat_source: string | null }>('select chat_source from events where chat_message_id is not null')
    expect(source.rows).toEqual([{ chat_source: 'rehearsal' }])
    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller, { rehearsal: true }))).body).toEqual({ result: 'DONE', called: 1 })
    expect(sentTexts(fake, 0)).toEqual(['반바지 리허설글'])
    expect(((await reviews(world, seller, '?rehearsal=true'))[0] as unknown as Record<string, unknown>).excluded).toBeNull()
  })
})

describe('AC-AIY1-03 출처를 모르는 줄도 보내지 않는다', () => {
  it('chat_source가 null·모르는 값이면 보내지 않고 excluded YOUTUBE_POLICY. other 줄만 보낸다', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    await chat(world, seller, b.id, '반바지 빈출처')
    await chat(world, seller, b.id, '반바지 이상출처')
    await chat(world, seller, b.id, '반바지 빈글자출처')
    await chat(world, seller, b.id, '반바지 인스타')
    await setSource(world, '반바지 빈출처', null)
    await setSource(world, '반바지 이상출처', 'weird')
    await setSource(world, '반바지 빈글자출처', '')
    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    expect(sentTexts(fake, 0)).toEqual(['반바지 인스타'])
    for (const banned of ['빈출처', '이상출처', '빈글자출처']) expect(allRaw(fake), banned).not.toContain(banned)
    const rows = await reviews(world, seller)
    const excluded = (text: string) => (byText(rows, text) as unknown as Record<string, unknown>).excluded
    expect(excluded('반바지 빈출처')).toBe('YOUTUBE_POLICY')
    expect(excluded('반바지 이상출처')).toBe('YOUTUBE_POLICY')
    expect(excluded('반바지 빈글자출처')).toBe('YOUTUBE_POLICY')
    expect(excluded('반바지 인스타')).toBeNull()
  })
})

describe('AC-AIY1-04 화면 요청을 믿지 않는다', () => {
  it('본문에 source·includeYoutube·items가 있으면 400 UNKNOWN_FIELD, 호출 0, assist_calls 그대로', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    await youtubeChat(world, seller, b.id, '반바지 가나다')
    await chat(world, seller, b.id, '반바지 사아자')
    await enableAssist(world, seller)
    for (const extra of [{ source: 'other' }, { includeYoutube: true }, { items: ['1'] }]) {
      const response = await suggest(world, seller, { rehearsal: false, ...extra })
      expect(response.status, JSON.stringify(extra)).toBe(400)
      expect(response.body).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
    }
    expect(fake.calls).toBe(0)
    expect(await count(world, 'assist_calls')).toBe(0)
  })

  it('상한에 닿은 판매자여도 유튜브 줄만 있으면 LIMIT가 아니라 DONE·called 0 (거르기가 상한 세기보다 먼저). 인스타 줄이 있으면 LIMIT', async () => {
    const { world, fake, seller } = await assistWorld({ daily: 0 })
    const b = await shortsBroadcast(world, seller)
    await youtubeChat(world, seller, b.id, '반바지 가나다')
    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 0 })
    await chat(world, seller, b.id, '반바지 사아자')
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'LIMIT', called: 0 })
    expect(fake.calls).toBe(0)
    expect(await count(world, 'assist_calls')).toBe(0)
  })

  it('부르는 순간(beforeCall)마다 가짜 서버가 받은 요청에 유튜브 줄의 글이 없다', async () => {
    const seen: number[] = []
    let fakeRef: FakeLlm | null = null
    const { world, fake, seller } = await assistWorld({
      server: {
        assistHooks: {
          beforeCall: () => {
            seen.push((fakeRef as FakeLlm).requests.length)
          },
        },
      },
    })
    fakeRef = fake
    const b1 = await shortsBroadcast(world, seller, { title: '1부' })
    const b2 = await shortsBroadcast(world, seller, { title: '2부' })
    await youtubeChat(world, seller, b1.id, '반바지 가나다')
    await chat(world, seller, b1.id, '반바지 사아자')
    await extensionChat(world, seller, b2.id, 'ext-9', '반바지 라마바')
    await chat(world, seller, b2.id, '반바지 차카타')
    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 2 })
    expect(seen).toEqual([0, 1])
    expect(fake.requests.map((_, index) => sentTexts(fake, index))).toEqual([['반바지 사아자'], ['반바지 차카타']])
    for (const banned of ['가나다', '라마바']) expect(allRaw(fake), banned).not.toContain(banned)
  })
})

describe('AC-AIY1-05 계량·묶음·같은 글', () => {
  it('유튜브 줄 21개 + 인스타 줄 1개(배치 20) → 첫 호출로 인스타 줄이 보내진다', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    for (let i = 0; i < 21; i++) await youtubeChat(world, seller, b.id, `반바지 유튜브글${'가'.repeat(i + 1)}`)
    await chat(world, seller, b.id, '반바지 인스타글')
    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    expect(sentTexts(fake, 0)).toEqual(['반바지 인스타글'])
    expect(allRaw(fake)).not.toContain('유튜브글')
    expect((await pg(world).query<{ items: number }>('select items from assist_calls')).rows).toEqual([{ items: 1 }])
  })

  it('같은 가린 글·같은 번호의 유튜브 줄(앞)과 인스타 줄(뒤)이면 인스타 줄이 보내진다', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    await youtubeChat(world, seller, b.id, '반바지 같은글')
    await chat(world, seller, b.id, '반바지 같은글')
    await enableAssist(world, seller)
    fake.answer('반바지 같은글', { no: 21, options: { 사이즈: 'L' }, qty: 1 })
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    expect(sentTexts(fake, 0)).toEqual(['반바지 같은글'])
    const rows = (await reviews(world, seller)) as unknown as Record<string, unknown>[]
    // 앞 줄(유튜브)은 AI 제안 없음, 뒤 줄(인스타)은 AI 제안
    expect(rows.map((row) => [row.excluded, row.suggestion])).toEqual([
      ['YOUTUBE_POLICY', null],
      [null, { no: 21, options: { 사이즈: 'L' }, qty: 1, source: 'AI' }],
    ])
  })

  it('유튜브 줄만 있는 방송과 인스타 줄이 있는 방송이 한 범위에 있으면 호출 1번, 오늘 사용량 +1', async () => {
    const { world, fake, seller } = await assistWorld()
    const first = await shortsBroadcast(world, seller, { title: '1부' })
    const second = await shortsBroadcast(world, seller, { title: '2부' })
    await youtubeChat(world, seller, first.id, '반바지 가나다')
    await extensionChat(world, seller, first.id, 'ext-2', '반바지 라마바')
    await chat(world, seller, second.id, '반바지 사아자')
    await enableAssist(world, seller)
    const used = await usedToday(world, seller)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    expect(fake.calls).toBe(1)
    expect(await usedToday(world, seller)).toBe(used + 1)
  })
})

describe('AC-AIY1-06 유튜브 줄엔 AI 캐시 제안을 보이지 않는다', () => {
  it('AIY1 전에 생긴 캐시(그때 출처가 보낼 수 있던 줄) — 출처가 youtube면 규칙 제안 또는 null, 캐시 행은 그대로', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    await youtubeChat(world, seller, b.id, '반바지 예전글')
    // 예전 기록 흉내: 잠깐 other로 두고 캐시를 만든 뒤 youtube로 되돌린다
    await setSource(world, '반바지 예전글', 'other')
    await enableAssist(world, seller)
    fake.answer('반바지 예전글', { no: 21, options: { 사이즈: 'S' }, qty: 1 })
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    expect((await reviews(world, seller))[0]?.suggestion).toEqual({ no: 21, options: { 사이즈: 'S' }, qty: 1, source: 'AI' })
    await setSource(world, '반바지 예전글', 'youtube')
    const row = (await reviews(world, seller))[0] as unknown as Record<string, unknown>
    expect(row.suggestion).toBeNull()
    expect(row.excluded).toBe('YOUTUBE_POLICY')
    expect(await count(world, 'assist_cache')).toBe(1)
    // AI를 꺼도 같다
    await expectOk(client(world, seller.cookie).put('/api/assist/settings', { enabled: false }))
    expect((await reviews(world, seller))[0]?.suggestion).toBeNull()
  })

  it('같은 글의 인스타 줄로 생긴 캐시 — 인스타 줄은 AI, 유튜브 줄은 null. 규칙으로 풀리는 유튜브 줄은 RULE', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    await chat(world, seller, b.id, '반바지 공유글')
    await enableAssist(world, seller)
    fake.answer('반바지 공유글', { no: 21, options: { 사이즈: 'M' }, qty: 1 })
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    await youtubeChat(world, seller, b.id, '반바지 공유글')
    await youtubeChat(world, seller, b.id, '반바지 미디엄')
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 0 })
    const rows = (await reviews(world, seller)) as unknown as Record<string, unknown>[]
    expect(rows.map((row) => [row.text, row.excluded, row.suggestion])).toEqual([
      ['반바지 공유글', null, { no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'AI' }],
      ['반바지 공유글', 'YOUTUBE_POLICY', null],
      ['반바지 미디엄', 'YOUTUBE_POLICY', { no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'RULE' }],
    ])
    expect(await count(world, 'assist_cache')).toBe(1)
    expect(fake.calls).toBe(1)
  })
})

describe('AC-AIY1-07 목록 응답의 이유 코드', () => {
  for (const mode of ['키 없음', '꺼짐', '켜짐'] as const) {
    it(`${mode}: 유튜브 채팅 YOUTUBE_POLICY, 인스타 채팅 null, 문자찜 null, 사유·규칙 제안과 상관없음`, async () => {
      const { world, seller } = await assistWorld(mode === '키 없음' ? { key: false } : {})
      if (mode === '켜짐') await enableAssist(world, seller)
      const b = await shortsBroadcast(world, seller)
      await youtubeChat(world, seller, b.id, '반바지 미디엄') // UNKNOWN_WORD·규칙 제안 있음
      await youtubeChat(world, seller, b.id, '반바지') // OPTION_MISSING
      await chat(world, seller, b.id, '반바지 사아자')
      await expectOk(writeEvent(world, seller, { type: 'sms', b: b.id, no: 21, qty: 5, options: { 사이즈: 'L' }, received: '12:00', phone: '010-5555-6666', memo: '이모' }))
      const rows = (await reviews(world, seller)) as unknown as Record<string, unknown>[]
      expect(rows.map((row) => [row.origin, row.reason, row.excluded])).toEqual([
        ['chat', 'UNKNOWN_WORD', 'YOUTUBE_POLICY'],
        ['chat', 'OPTION_MISSING', 'YOUTUBE_POLICY'],
        ['chat', 'UNKNOWN_WORD', null],
        ['sms', 'STOCK_SHORT', null],
      ])
      expect(rows[0]?.suggestion).toEqual({ no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'RULE' })
    })
  }

  it('방송을 고른 목록도 같은 값', async () => {
    const { world, seller } = await assistWorld()
    const b = await optionBroadcast(world, seller)
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: b.id, no: 21, name: '반바지', price: 15000, options: [{ name: '사이즈', choices: [{ label: 'S' }] }] }))
    await youtubeChat(world, seller, b.id, '반바지 가나다')
    const response = await expectOk(client(world, seller.cookie).get(`/api/reviews?broadcast=${b.id}`))
    expect((response.body.reviews as Record<string, unknown>[]).map((row) => row.excluded)).toEqual(['YOUTUBE_POLICY'])
  })
})

describe('AC-AIY1-08 로그·기록에 원문이 없다', () => {
  it('섞인 묶음 시나리오의 로그에 유튜브 줄의 글·닉네임·채널 ID·메시지 ID가 없다. ASSIST_EXCLUDED는 판매자 ID·개수만', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    const yt = await world.server.ingestChat(seller.sellerId, { b: b.id, id: 'ytmsg-secret-1', ch: 'UCsecretyoutube00000001', nick: '유튜브비밀닉', text: '반바지 유튜브비밀글' })
    expect(yt.status).toBe('recorded')
    await extensionChat(world, seller, b.id, 'extmsg-secret-2', '반바지 확장비밀글', '확장비밀닉', 'UCsecretextension000002')
    await chat(world, seller, b.id, '반바지 사아자')
    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    // 유튜브 줄만 있는 방송도 한 번
    const only = await shortsBroadcast(world, seller, { title: '유튜브만' })
    await world.server.ingestChat(seller.sellerId, { b: only.id, id: 'ytmsg-secret-3', ch: 'UCsecretyoutube00000003', nick: '유튜브비밀닉3', text: '반바지 유튜브비밀글셋' })
    expect((await expectOk(suggest(world, seller, { rehearsal: false, broadcast: only.id }))).body).toEqual({ result: 'DONE', called: 0 })
    const logged = JSON.stringify(world.logs)
    const banned = ['유튜브비밀', '확장비밀', 'UCsecretyoutube', 'UCsecretextension', 'ytmsg-secret', 'extmsg-secret']
    for (const word of banned) {
      expect(logged, word).not.toContain(word)
      expect(allRaw(fake), word).not.toContain(word)
    }
    const excludedLogs = world.logs.filter((record) => record.code === 'ASSIST_EXCLUDED')
    expect(excludedLogs.length).toBeGreaterThan(0)
    for (const record of excludedLogs) {
      expect(Object.keys(record).sort()).toEqual(['code', 'count', 'level', 'seller'])
      expect(record.seller).toBe(seller.sellerId)
      expect(Number.isSafeInteger(record.count)).toBe(true)
    }
    expect(excludedLogs.map((record) => record.count)).toEqual([2, 1])
    const tables = JSON.stringify([(await pg(world).query('select * from assist_calls')).rows, (await pg(world).query('select * from assist_cache')).rows])
    for (const word of banned) expect(tables, word).not.toContain(word)
    expect(await count(world, 'assist_cache')).toBe(1)
  })
})

describe('AC-AIY1-09 키 없음·AI 꺼짐은 그대로', () => {
  it('키 없는 서버는 UNAVAILABLE, 꺼짐은 OFF — 외부 호출 0번', async () => {
    const noKey = await assistWorld({ key: false })
    const b1 = await shortsBroadcast(noKey.world, noKey.seller)
    await chat(noKey.world, noKey.seller, b1.id, '반바지 사아자')
    expect((await expectOk(suggest(noKey.world, noKey.seller))).body).toEqual({ result: 'UNAVAILABLE', called: 0 })
    expect(noKey.fake.calls).toBe(0)
    const off = await assistWorld()
    const b2 = await shortsBroadcast(off.world, off.seller)
    await chat(off.world, off.seller, b2.id, '반바지 사아자')
    expect((await expectOk(suggest(off.world, off.seller))).body).toEqual({ result: 'OFF', called: 0 })
    expect(off.fake.calls).toBe(0)
  })
})
