// A1 적대 시험 (test-domain, AC-A1-30): 서버 API·가짜 LLM 서버로 AI 확인 필요 제안을 공격한다. 통과한 공격은 회귀로 남긴다.
// - 응답 공격: 머리글만 오고 본문이 멈춘 답(시간 초과), 깊은 중첩·__proto__·constructor 답 — 서버가 죽지 않고 제안 없음, 기록 불변
// - 가리기: 서버가 실제로 보낸 본문에 스펙 기준 휴대폰 번호·닉네임·@ 부르기가 없다
// - 제안 → [이대로 주문]: 보이는 제안(규칙·AI)은 늘 기존 바로잡기가 받는 값이다(입력 오류가 나지 않는다)
// - 기록 불변(AC-A1-07): 목록·제안 받기(성공·실패·이상한 답·상한)·켜기·끄기를 무작위 순서로
// - 로그(AC-A1-10): 키·댓글 글·모델 글이 로그에 없다
import { createServer as createHttpServer, type Server } from 'node:http'
import { listClaims, listProducts, listReviews } from '@livejjim/core'
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeLlm } from '../../../apps/server/src/assist/fake-llm.ts'
import { assistWorld, byText, chat, enableAssist, eventCount, reviews, sentTexts, shortsBroadcast, suggest } from '../../../apps/server/test/a1-support.ts'
import { client, expectOk, newWorld, writeEvent, addSeller, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

const opened: Server[] = []
afterEach(async () => {
  for (const server of opened.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

/** 머리글(200)과 본문 앞부분만 보내고 멈추는 서버 — 받은 요청 수를 센다 */
async function stallingServer(): Promise<{ url: string; calls: () => number }> {
  let calls = 0
  const server = createHttpServer((request, response) => {
    calls++
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write('{"id":"msg_stall","type":"message","content":[{"type":"text","text":"{\\"suggestions\\":[')
    // 끝내지 않는다
  })
  opened.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('주소 없음')
  return { url: `http://127.0.0.1:${String(address.port)}`, calls: () => calls }
}

/** 판정 결과만 견준다 */
async function judged(world: TestServer, seller: Seller, date: string): Promise<{ seq: number; view: string }> {
  const runtime = await world.server.writer.read(seller.sellerId, date)
  return { seq: runtime.seq, view: JSON.stringify({ claims: listClaims(runtime.state), reviews: listReviews(runtime.state), products: listProducts(runtime.state) }) }
}

const SECRET_WORDS = ['엠사이즈', '큰거요', '홍길동', 'fake-assist-key', 'suggestions']

describe('응답 공격 — 서버가 죽지 않고 제안 없음 (AC-A1-06·30)', () => {
  it('머리글은 바로 오고 본문이 멈춘 답: 시간 제한 안에 FAILED, 캐시 없음, 사용량 1, 목록·규칙 제안 그대로', async () => {
    const stall = await stallingServer()
    const world = await newWorld({ assist: { apiKey: 'stall-key', baseUrl: stall.url, allowInsecure: true, timeoutMs: 400 } })
    const seller = await addSeller(world)
    const b = await shortsBroadcast(world, seller)
    await chat(world, seller, b.id, '반바지 미디엄')
    await chat(world, seller, b.id, '반바지 엠사이즈')
    await enableAssist(world, seller)
    const before = await judged(world, seller, b.date)
    const started = Date.now()
    const response = await expectOk(suggest(world, seller))
    // 시간 측정은 느슨하게: 끝나지 않는 본문을 끝없이 기다리지 않는다는 것만 본다(시험 시간 제한 60초 안)
    expect(Date.now() - started).toBeLessThan(30_000)
    expect(response.body).toEqual({ result: 'FAILED', called: 1 })
    expect(stall.calls()).toBe(1)
    const cache = await world.database.pglite?.query('select * from assist_cache')
    expect(cache?.rows).toHaveLength(0)
    expect((await expectOk(client(world, seller.cookie).get('/api/assist/settings'))).body.usedToday).toBe(1)
    const rows = await reviews(world, seller)
    expect(byText(rows, '반바지 미디엄').suggestion).toMatchObject({ source: 'RULE' })
    expect(byText(rows, '반바지 엠사이즈').suggestion).toBeNull()
    expect(await judged(world, seller, b.date)).toEqual(before)
    const logs = JSON.stringify(world.logs)
    for (const word of [...SECRET_WORDS, 'stall-key', 'msg_stall']) expect(logs, word).not.toContain(word)
  })

  it('깊은 중첩·__proto__·constructor·1e1 답: DONE, 그 항목만 제안 없음, 서버는 다음 요청을 정상 처리', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    for (const text of ['반바지 일번', '반바지 이번', '반바지 삼번', '반바지 사번']) await chat(world, seller, b.id, text)
    await enableAssist(world, seller)
    const depth = 20_000
    const answers = [
      `{"suggestions":[{"id":"1","no":21,"options":{"사이즈":"M"},"qty":1,"x":${'['.repeat(depth)}${']'.repeat(depth)}},{"id":"2","no":21,"options":{"사이즈":"M","__proto__":"L"},"qty":1},{"id":"3","no":21,"options":{"사이즈":"M"},"qty":1,"constructor":{}},{"id":"4","no":21,"options":{"사이즈":"L"},"qty":1e1}]}`,
    ]
    fake.failNext({ kind: 'raw', text: answers[0] as string })
    const before = await judged(world, seller, b.date)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    for (const row of await reviews(world, seller)) expect(row.suggestion, row.text ?? '').toBeNull()
    expect(({} as Record<string, unknown>).사이즈).toBeUndefined()
    // 같은 글은 다시 묻지 않는다(제안 없음 캐시) — 새 글은 다음 요청에서 정상
    await chat(world, seller, b.id, '반바지 엠사이즈')
    fake.answer('반바지 엠사이즈', { no: 21, options: { 사이즈: 'M' }, qty: 1 })
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    expect(sentTexts(fake, 1)).toEqual(['반바지 엠사이즈'])
    expect(byText(await reviews(world, seller), '반바지 엠사이즈').suggestion).toEqual({ no: 21, options: { 사이즈: 'M' }, qty: 1, source: 'AI' })
    expect((await judged(world, seller, b.date)).seq).toBe(before.seq + 1)
  })
})

describe('가리기 — 서버가 실제로 보낸 본문 (AC-A1-05·30, DAT-06)', () => {
  it('전각 숫자·붙임표·점·붙여 쓴 번호(글자에 붙음)와 닉네임이 본문에 없다 — 확인 필요가 되는 모양만 보낸다', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    const texts = [
      '반바지 엠사이즈０１０-１２３４-５６７８',
      '반바지 엠사이즈010-2345-6789',
      '반바지 엠사이즈010.3456.7890',
      '반바지 엠사이즈01045678901',
      '반바지 엠사이즈０１０５６７８９０１２',
    ]
    for (const [index, text] of texts.entries()) await chat(world, seller, b.id, text, `홍길동${String(index)}`, `UCnick${String(index).padStart(18, '0')}`)
    const listed = (await reviews(world, seller)).filter((row) => row.reason === 'UNKNOWN_WORD')
    expect(listed.length).toBeGreaterThanOrEqual(3)
    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller))).body).toEqual({ result: 'DONE', called: 1 })
    const sent = sentTexts(fake, 0)
    // 가린 글이 모두 같아 한 번만 묻는다 (같은 (가린 글, 읽은 번호)는 한 번)
    expect(sent).toEqual(['반바지 엠사이즈***'])
    const raw = fake.requests[0]?.raw ?? ''
    for (const banned of ['5678', '6789', '7890', '8901', '9012', '홍길동', 'UCnick']) expect(raw, banned).not.toContain(banned)
  })
})

describe('제안 → [이대로 주문]: 보이는 제안은 늘 기존 바로잡기가 받는다 (AC-A1-07·20)', () => {
  it('규칙 제안·별칭으로 답한 AI 제안·선택지 하나뿐인 항목을 채운 AI 제안·수량 2 — 바로잡기 200, 그 줄이 사라지고 찜 하나', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    await expectOk(
      writeEvent(world, seller, {
        type: 'product.register',
        b: b.id,
        no: 31,
        name: '수건',
        price: 8000,
        options: [
          { name: '색상', choices: [{ label: '흰색', aliases: ['화이트'] }, { label: '검정' }] },
          { name: '크기', choices: [{ label: '대형' }] },
        ],
        stocks: { '흰색/대형': 5, '검정/대형': 5 },
      }),
    )
    const texts = ['반바지 미디엄', '반바지 엠사이즈', '수건 하양 두장', '수건 화이트색']
    for (const text of texts) await chat(world, seller, b.id, text)
    fake.answer('반바지 엠사이즈', { no: 21, options: { 사이즈: '미디움' }, qty: 1 })
    fake.answer('수건 하양 두장', { no: 31, options: { 색상: '화이트' }, qty: 2 })
    fake.answer('수건 화이트색', { no: 31, options: { 색상: '흰색', 크기: '대형' }, qty: 1 })
    await enableAssist(world, seller)
    expect((await expectOk(suggest(world, seller))).body.result).toBe('DONE')
    const rows = await reviews(world, seller)
    const shown = rows.filter((row) => row.suggestion !== null)
    expect(shown.length).toBeGreaterThanOrEqual(3)
    for (const row of shown) {
      const suggestion = row.suggestion as { no: number; options?: Record<string, string>; qty: number }
      const before = await eventCount(world)
      const response = await writeEvent(world, seller, {
        type: 'host.resolveReview',
        b: b.id,
        item: row.item,
        no: suggestion.no,
        ...(suggestion.options === undefined ? {} : { options: suggestion.options }),
        qty: suggestion.qty,
      })
      expect(response.status, `${row.text ?? ''} ${response.text}`).toBe(200)
      expect(await eventCount(world)).toBe(before + 1)
    }
    const after = await reviews(world, seller)
    for (const row of shown) expect(after.find((left) => left.item === row.item), row.text ?? '').toBeUndefined()
  })
})

describe('기록 불변 — 무작위 순서 (AC-A1-07)', () => {
  it('목록·제안 받기(성공·5xx·이상한 답·느림·상한)·켜기·끄기·설정 보기를 아무 순서로 해도 이벤트·seq·판정 결과가 같다', async () => {
    const { world, fake, seller } = await assistWorld({ daily: 4, timeoutMs: 300 })
    const b = await shortsBroadcast(world, seller)
    for (const text of ['반바지 미디엄', '반바지 엠사이즈', '반바지 큰거요', '반바지', '반바지 라아지', '반바지 쓰몰']) await chat(world, seller, b.id, text)
    const events = await eventCount(world)
    const before = await judged(world, seller, b.date)
    type Op = 'list' | 'suggest' | 'fail500' | 'raw' | 'slow' | 'on' | 'off' | 'view' | 'newChatlessSuggest'
    const op = fc.constantFrom<Op>('list', 'suggest', 'fail500', 'raw', 'slow', 'on', 'off', 'view', 'newChatlessSuggest')
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 8 }), async (ops) => {
        fake.reset()
        for (const step of ops) {
          const api = client(world, seller.cookie)
          if (step === 'list') await reviews(world, seller)
          else if (step === 'view') await expectOk(api.get('/api/assist/settings'))
          else if (step === 'on') await enableAssist(world, seller)
          else if (step === 'off') await expectOk(api.put('/api/assist/settings', { enabled: false }))
          else {
            if (step === 'fail500') fake.failNext({ kind: 'status', status: 503 })
            if (step === 'raw') fake.failNext({ kind: 'raw', text: '{"suggestions":[{"id":"1","no":21,"options":{"사이즈":"L"},"qty":99}]}' })
            if (step === 'slow') fake.failNext({ kind: 'slow', delayMs: 800 })
            const response = await expectOk(suggest(world, seller, step === 'newChatlessSuggest' ? { rehearsal: false, broadcast: b.id } : { rehearsal: false }))
            expect(['DONE', 'OFF', 'LIMIT', 'FAILED', 'BUSY']).toContain(response.body.result)
          }
        }
        expect(await eventCount(world)).toBe(events)
        expect(await judged(world, seller, b.date)).toEqual(before)
      }),
      { numRuns: 12 },
    )
    // 상한(4) 넘게 부르지 않았다
    expect((await expectOk(client(world, seller.cookie).get('/api/assist/settings'))).body.usedToday as number).toBeLessThanOrEqual(4)
    const logs = JSON.stringify(world.logs)
    for (const word of SECRET_WORDS) expect(logs, word).not.toContain(word)
  })
})

describe('격리 — 다른 판매자 (AC-A1-09·30)', () => {
  it('B가 A의 방송으로 목록·제안 받기를 하면 404이고 A 쪽 호출·캐시·사용량·설정이 그대로', async () => {
    const { world, fake, seller: a } = await assistWorld()
    const sellerB = await addSeller(world)
    const b = await shortsBroadcast(world, a)
    await chat(world, a, b.id, '반바지 엠사이즈')
    await enableAssist(world, a)
    await enableAssist(world, sellerB)
    const bApi = client(world, sellerB.cookie)
    expect((await bApi.post('/api/assist/suggest', { rehearsal: false, broadcast: b.id })).status).toBe(404)
    expect((await bApi.get(`/api/reviews?broadcast=${b.id}`)).status).toBe(404)
    expect((await expectOk(bApi.post('/api/assist/suggest', { rehearsal: false }))).body).toEqual({ result: 'DONE', called: 0 })
    expect(fake.calls).toBe(0)
    expect((await expectOk(suggest(world, a))).body).toEqual({ result: 'DONE', called: 1 })
    expect((await expectOk(bApi.get('/api/assist/settings'))).body.usedToday).toBe(0)
    await expectOk(bApi.put('/api/assist/settings', { enabled: false }))
    expect((await expectOk(client(world, a.cookie).get('/api/assist/settings'))).body).toMatchObject({ enabled: true, usedToday: 1 })
    expect(await reviews(world, sellerB)).toEqual([])
  })

  it('판매자 넷이 동시에 여러 번 불러도 판매자 상한·서버 전체 상한을 넘는 호출이 없다', async () => {
    const fake = await FakeLlm.start()
    try {
      const world = await newWorld({ assist: fake.setup({ dailyLimit: 2, globalLimit: 5 }) })
      const sellers: Seller[] = []
      for (let i = 0; i < 4; i++) {
        const seller = await addSeller(world)
        const b = await shortsBroadcast(world, seller)
        for (let j = 0; j < 3; j++) await chat(world, seller, b.id, `반바지 이상한말${String(j)}`)
        await enableAssist(world, seller)
        sellers.push(seller)
      }
      // 판매자마다 묶음 크기 1로 부르는 효과를 내려고 차례로 세 번씩, 판매자끼리는 동시에
      await Promise.all(
        sellers.map(async (seller) => {
          for (let k = 0; k < 3; k++) await Promise.all([suggest(world, seller), suggest(world, seller)])
        }),
      )
      expect(fake.calls).toBeLessThanOrEqual(5)
      for (const seller of sellers) expect((await expectOk(client(world, seller.cookie).get('/api/assist/settings'))).body.usedToday as number).toBeLessThanOrEqual(2)
    } finally {
      await fake.close()
    }
  })
})

describe('API 규칙 (D-074) — 설정 바꾸기·제안 받기', () => {
  it('다른 Origin·Origin 없음·JSON 아님·64KB 넘음·모르는 항목·__proto__·불리언이 아닌 동의는 4xx이고 아무것도 바뀌지 않는다, 받은 값을 되돌려 보내지 않는다', async () => {
    const { world, fake, seller } = await assistWorld()
    const b = await shortsBroadcast(world, seller)
    await chat(world, seller, b.id, '반바지 엠사이즈')
    const api = client(world, seller.cookie)
    const json = (body: unknown, extra: Record<string, string> = {}) => ({ method: 'PUT', headers: { Origin: 'https://app.livejjim.test', 'Content-Type': 'application/json', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    const attempts: [string, RequestInit][] = [
      ['다른 Origin', json({ enabled: true, consent: true }, { Origin: 'https://evil.example' })],
      ['Origin 없음', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, consent: true }) }],
      ['JSON 아님', json('enabled=true&consent=true', { 'Content-Type': 'application/x-www-form-urlencoded' })],
      ['64KB 넘음', json({ enabled: true, consent: true, pad: 'x'.repeat(70_000) })],
      ['모르는 항목', json({ enabled: true, consent: true, secretEcho: '반바지엠사이즈비밀' })],
      ['__proto__', json('{"enabled":true,"__proto__":{"consent":true}}')],
      ['글자 동의', json({ enabled: true, consent: 'true' })],
      ['숫자 동의', json({ enabled: true, consent: 1 })],
      ['글자 켬', json({ enabled: 'true', consent: true })],
      ['동의 false', json({ enabled: true, consent: false })],
      ['배열 본문', json([{ enabled: true, consent: true }])],
    ]
    for (const [name, init] of attempts) {
      const response = await api.raw('/api/assist/settings', init)
      expect(response.status, name).toBeGreaterThanOrEqual(400)
      expect(response.status, name).toBeLessThan(500)
      const text = await response.text()
      expect(text, name).not.toContain('반바지엠사이즈비밀')
      expect(text, name).not.toContain('evil.example')
    }
    const view = await expectOk(api.get('/api/assist/settings'))
    expect(view.body).toMatchObject({ enabled: false, consentedAt: null, usedToday: 0 })
    expect(view.headers.get('cache-control') ?? '').toContain('no-store')
    // 로그인 없이·다른 Origin의 제안 받기는 부르지 않는다
    expect((await client(world, null).get('/api/assist/settings')).status).toBe(401)
    await enableAssist(world, seller)
    const foreign = await api.raw('/api/assist/suggest', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ rehearsal: false }) })
    expect(foreign.status).toBe(403)
    const strange = await api.post('/api/assist/suggest', { rehearsal: 'false' })
    expect(strange.status).toBe(400)
    const longId = await api.post('/api/assist/suggest', { rehearsal: false, broadcast: 'b'.repeat(5000) })
    expect(longId.status).toBe(404)
    expect(longId.text).not.toContain('bbbb')
    expect(fake.calls).toBe(0)
    const ok = await expectOk(api.post('/api/assist/suggest', { rehearsal: false }))
    expect(ok.headers.get('cache-control') ?? '').toContain('no-store')
    expect(fake.calls).toBe(1)
  })
})
