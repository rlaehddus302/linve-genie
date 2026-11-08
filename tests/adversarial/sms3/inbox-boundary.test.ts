// SMS3 적대 시험 (test-domain): 휴대폰 알림 받는 입구(/api/inbox/messages)·문자 확인 카드 — AC-SMS3-33.
// - 토큰 경계: 옛 토큰·끈 토큰·남의 판매자 토큰·머리글 변형, 토큰으로 다른 API(토큰 다시 만들기·끄기) 부르기, 남의 카드 처리
// - 같은 id·같은 문자 동시 요청, 같은 카드 동시 넣기(두 사람이 함께 누름)
// - 승인 없는 취소 없음: 남의 번호·뒤 4자리만 같은 번호·이름만 온 취소 문자, 취소 문자만으로는 엔진 기록 없음, 같은 카드 동시 승인
// - 방송 창: 끝난 뒤 10분 경계, 휴대폰 시각(receivedAt)으로 창을 속이기, 방송 시작 직전에 온 문자의 재전송
// - 저장 실패 뒤 같은 id로 다시 보내면 들어간다(유실 없음)
// 기대는 SPEC ORD-13 C-02·C-04~C-07, DOMAIN_RULES R-26, D-SMS3-07·08·12 문장으로 정한다.
// D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자는 토큰을 만들거나 끄지 못하고(403), 설정 읽기에도 토큰이 없다"를 뺐다
import type { ClaimInfo } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { kst } from '../../../apps/server/test/deposit-support.ts'
import { SMS3_DAY, cards, claimsOf, inboxWorld, liveSale, makeToken, send, sendRaw, sms, statuses } from '../../../apps/server/test/sms3-support.ts'
import { ORIGIN, addSeller, client, createBroadcast, dumpAllTables, expectOk, login, rid, writeEvent, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

const ACTIVE = new Set(['CONFIRMED', 'WAITLISTED', 'HELD', 'CONFLICT'])
const active = (claims: readonly ClaimInfo[]): ClaimInfo[] => claims.filter((claim) => ACTIVE.has(claim.status))
const seqOf = async (world: TestServer, seller: Seller): Promise<number> => (await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).seq

async function endBroadcast(world: TestServer, seller: Seller, b: string): Promise<void> {
  await expectOk(client(world, seller.cookie).post(`/api/broadcasts/${b}/end`, { requestId: rid('end') }))
}

describe('토큰 경계 (C-02)', () => {
  it('판매자 A의 토큰으로 보낸 문자는 A의 방송에만 — B의 방송·카드·입금엔 아무것도 없고, B 세션으로 A의 카드를 보거나 처리할 수 없다', async () => {
    const a = await inboxWorld()
    const { world } = a
    const b = await addSeller(world)
    const tokenB = await makeToken(world, b)
    const saleA = await liveSale(world, a.seller, [15])
    const saleB = await liveSale(world, b, [15])
    expect(await statuses(world, a.token, [sms('x1', '010-1234-5678', '15'), sms('x2', '010-1234-5678', '15 있나요?')])).toEqual(['SAVED', 'SAVED'])
    expect(await claimsOf(world, b)).toEqual([])
    expect(await cards(world, b, saleB.id)).toEqual([])
    // B 세션이 A 방송 ID로 카드를 읽어도 빈 목록
    expect(await cards(world, b, saleA.id)).toEqual([])
    const [cardA] = await cards(world, a.seller, saleA.id)
    const apiB = client(world, b.cookie)
    expect((await apiB.post(`/api/inbox/cards/${cardA?.id as string}/insert`, { requestId: rid('in'), no: 15 })).status).toBe(404)
    expect((await apiB.post(`/api/inbox/cards/${cardA?.id as string}/ignore`, {})).status).toBe(404)
    expect((await apiB.post(`/api/inbox/cards/${cardA?.id as string}/approve`, { requestId: rid('ap') })).status).toBe(404)
    expect((await cards(world, a.seller, saleA.id)).map((card) => card.id)).toEqual([cardA?.id])
    // B의 토큰은 B 것으로만
    expect(await statuses(world, tokenB, [sms('x1', '010-1234-5678', '15')])).toEqual(['SAVED'])
    expect(active(await claimsOf(world, a.seller))).toHaveLength(1)
    expect(active(await claimsOf(world, b))).toHaveLength(1)
  })

  it('머리글 변형(소문자 bearer·두 칸·= 덧붙임·두 토큰·Basic·토큰만·쿼리·쿠키 세션)은 모두 401이고 아무것도 처리하지 않는다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const body = JSON.stringify({ device: '폰', messages: [sms('h1', '010-1234-5678', '15')] })
    const variants = [`bearer ${token}`, `Bearer  ${token}`, `Bearer ${token}=`, `Bearer ${token}, Bearer ${token}`, `Basic ${token}`, token, `Bearer ${token.toUpperCase()}`, `Bearer ${token.slice(0, -1)}`, 'Bearer ', `Bearer ${'A'.repeat(600)}`]
    for (const authorization of variants) {
      const response = await sendRaw(world, null, body, authorization)
      expect(response.status, authorization.slice(0, 20)).toBe(401)
      expect(response.body).toMatchObject({ error: { code: 'TOKEN_INVALID' } })
    }
    const viaQuery = await world.server.app.request(`/api/inbox/messages?token=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    expect(viaQuery.status).toBe(401)
    const viaCookie = await world.server.app.request('/api/inbox/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: seller.cookie, Origin: ORIGIN }, body })
    expect(viaCookie.status).toBe(401)
    expect(await claimsOf(world, seller)).toEqual([])
  })

  it('받기 토큰으로는 다른 API를 부를 수 없다 — 토큰 다시 만들기·끄기·카드·입금 모두 401이고 토큰은 그대로 통한다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const headers = { Authorization: `Bearer ${token}`, Origin: ORIGIN, 'Content-Type': 'application/json' }
    const calls: [string, string, string | undefined][] = [
      ['POST', '/api/inbox/token', '{}'],
      ['PUT', '/api/inbox/settings', '{"enabled":false}'],
      ['GET', '/api/inbox/settings', undefined],
      ['GET', '/api/inbox/cards?b=x', undefined],
      ['GET', '/api/deposits?status=REVIEW', undefined],
      ['GET', '/api/deposits/alerts', undefined],
      ['POST', '/api/broadcasts', JSON.stringify({ requestId: rid('bc'), date: SMS3_DAY })],
    ]
    for (const [method, path, body] of calls) {
      const response = await world.server.app.request(path, { method, headers, ...(body === undefined ? {} : { body }) })
      expect(response.status, `${method} ${path}`).toBe(401)
    }
    expect(await statuses(world, token, [sms('t1', '010-1234-5678', '15')])).toEqual(['SAVED'])
    expect(active(await claimsOf(world, seller))).toHaveLength(1)
  })

  it('옛 토큰·끈 토큰: 다시 만들면 옛 토큰 401, 끄면 401, 다시 켜면 마지막 토큰만, 꺼진 채 다시 만들면 켜지고 그 전 토큰은 401', async () => {
    const { world, seller, token: t1 } = await inboxWorld()
    await liveSale(world, seller, [15, 16, 17, 18])
    const api = client(world, seller.cookie)
    const t2 = await makeToken(world, seller)
    expect(t2).not.toBe(t1)
    expect((await send(world, t1, [sms('o1', '010-1234-5678', '15')])).status).toBe(401)
    expect((await send(world, t2, [sms('o2', '010-1234-5678', '15')])).status).toBe(200)
    await expectOk(api.put('/api/inbox/settings', { enabled: false }))
    const off = await send(world, t2, [sms('o3', '010-1234-5678', '16')])
    expect(off.status).toBe(403) // D-SMS3-27: 맞는 토큰 + 받기 꺼짐은 403 INBOX_OFF (401은 토큰 문제만)
    expect(off.body).toMatchObject({ error: { code: 'INBOX_OFF' } })
    expect((await send(world, t1, [sms('o4', '010-1234-5678', '16')])).status).toBe(401)
    await expectOk(api.put('/api/inbox/settings', { enabled: true }))
    expect((await send(world, t1, [sms('o5', '010-1234-5678', '16')])).status).toBe(401)
    expect((await send(world, t2, [sms('o6', '010-1234-5678', '16')])).status).toBe(200)
    await expectOk(api.put('/api/inbox/settings', { enabled: false }))
    const t3 = await makeToken(world, seller)
    expect(((await expectOk(api.get('/api/inbox/settings'))).body.inbox as { enabled: boolean }).enabled).toBe(true)
    expect((await send(world, t2, [sms('o7', '010-1234-5678', '17')])).status).toBe(401)
    expect((await send(world, t3, [sms('o8', '010-1234-5678', '17')])).status).toBe(200)
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no).sort()).toEqual([15, 16, 17])
    // 다른 판매자의 토큰과 같은 토큰이 나오지 않고, 응답·DB·로그에 토큰 원문이 없다
    const dump = await dumpAllTables(world.database)
    for (const token of [t1, t2, t3]) {
      expect(dump).not.toContain(token)
      expect(JSON.stringify(world.logs)).not.toContain(token)
    }
    expect(JSON.stringify((await expectOk(api.get('/api/inbox/settings'))).body)).not.toContain(t3)
  })
})

describe('같은 id·같은 문자 동시 요청 (C-06)', () => {
  it('다른 id 20개·같은 보낸 곳·같은 본문을 동시에 → SAVED 하나, 찜 하나', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const at = '2026-10-31T20:00:10+09:00'
    const all = await Promise.all(Array.from({ length: 20 }, (_, i) => send(world, token, [sms(`dup-${String(i)}`, '010-1234-5678', '15 홍길동', at)])))
    const flat = all.map((response) => (response.body.results as { status: string }[])[0]?.status)
    expect(flat.filter((status) => status === 'SAVED')).toHaveLength(1)
    expect(flat.filter((status) => status === 'DUPLICATE')).toHaveLength(19)
    expect(await claimsOf(world, seller)).toHaveLength(1)
  })

  it('같은 id 20개 동시 — 확인 필요 문자도 카드 하나', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    await Promise.all(Array.from({ length: 20 }, () => send(world, token, [sms('same-card', '010-1234-5678', '15 있나요?')])))
    expect(await cards(world, seller, sale.id)).toHaveLength(1)
  })

  it('한 요청 안에 같은 id 두 번 → 두 번째 DUPLICATE, 찜 하나', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('twice', '010-1234-5678', '15'), sms('twice', '010-9999-9999', '15')])).toEqual(['SAVED', 'DUPLICATE'])
    expect(await claimsOf(world, seller)).toHaveLength(1)
  })
})

describe('같은 카드 동시 처리', () => {
  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "판매자와 보조자가 동시에 넣기"를 판매자의 두 기기(로그인 두 번)로 바꿨다
  it('이름만 온 문자 카드(NO_NUMBER)를 판매자가 두 기기에서 동시에 "넣기" → 찜 하나, 하나는 이미 처리함', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('nn', '홍길동', '15')])).toEqual(['SAVED'])
    const [card] = await cards(world, seller, sale.id)
    const helper = client(world, await login(world, seller.loginId, seller.password))
    const owner = client(world, seller.cookie)
    const results = await Promise.all([
      owner.post(`/api/inbox/cards/${card?.id as string}/insert`, { requestId: rid('in'), no: 15 }),
      helper.post(`/api/inbox/cards/${card?.id as string}/insert`, { requestId: rid('in'), no: 15 }),
    ])
    // 먼저 피해(찜 수)를 본다 — 카드 하나가 두 번 넣어지면 찜이 둘
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no)).toHaveLength(1)
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  })

  it('확인 필요 카드를 동시에 다른 번호로 두 번 "넣기" → 찜 하나', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16])
    expect(await statuses(world, token, [sms('uc', '010-1234-5678', '15 16 있나요?')])).toEqual(['SAVED'])
    const [card] = await cards(world, seller, sale.id)
    const owner = client(world, seller.cookie)
    const results = await Promise.all([
      owner.post(`/api/inbox/cards/${card?.id as string}/insert`, { requestId: rid('in'), no: 15 }),
      owner.post(`/api/inbox/cards/${card?.id as string}/insert`, { requestId: rid('in'), no: 16 }),
    ])
    // 먼저 피해(찜 수)를 본다 — 카드 하나가 두 번 넣어지면 찜이 둘
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no)).toHaveLength(1)
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
  })
})

describe('승인 없는 취소 없음 (D-SMS3-12 ②)', () => {
  it('취소 문자만으로는 엔진 기록이 없다 — 여러 취소 모양 모두', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15, 16])
    expect(await statuses(world, token, [sms('own', '010-1234-5678', '15 16 홍길동')])).toEqual(['SAVED'])
    const before = await seqOf(world, seller)
    const texts = ['15 취소', '15번 취소요', '홍길동 15 취소해주세요', '15 16 취소', '취소 15', '15 취소 홍길동', '16 취소할게요 ㅠㅠ', '15 취소!!!', '１５ 취소']
    const out = await statuses(world, token, texts.map((text, i) => sms(`cx${String(i)}`, '010-1234-5678', text)))
    expect(out.every((status) => status === 'SAVED')).toBe(true)
    expect(await seqOf(world, seller)).toBe(before)
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no)).toEqual([15, 16])
  })

  it('다른 손님(다른 번호·뒤 4자리만 같은 번호)의 "15 취소"를 승인해도 1등 손님의 찜은 그대로 — 취소할 찜이 없어요, 기록 없음', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('first', '010-1111-5678', '15 홍길동')])).toEqual(['SAVED'])
    expect(await statuses(world, token, [sms('other', '010-2222-3333', '15 취소'), sms('same4', '010-9999-5678', '15 취소 홍길동')])).toEqual(['SAVED', 'SAVED'])
    const before = await seqOf(world, seller)
    const api = client(world, seller.cookie)
    for (const card of await cards(world, seller, sale.id)) {
      const response = await api.post(`/api/inbox/cards/${card.id}/approve`, { requestId: rid('ap') })
      expect(response.status).toBe(409)
      expect(response.body).toMatchObject({ error: { code: 'NO_CLAIM' } })
    }
    expect(await seqOf(world, seller)).toBe(before)
    expect(active(await claimsOf(world, seller))).toHaveLength(1)
  })

  it('이름만 온 "15 취소"는 연락처 이름이 1등 손님의 메모와 같아도 승인으로 취소되지 않는다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('first', '010-1111-2222', '15 홍길동')])).toEqual(['SAVED'])
    expect(await statuses(world, token, [sms('byname', '홍길동', '15 취소')])).toEqual(['SAVED'])
    const [card] = await cards(world, seller, sale.id)
    expect(card).toMatchObject({ kind: 'CANCEL', last4: null })
    const before = await seqOf(world, seller)
    const response = await client(world, seller.cookie).post(`/api/inbox/cards/${card?.id as string}/approve`, { requestId: rid('ap') })
    expect(response.status).toBe(409)
    expect(await seqOf(world, seller)).toBe(before)
    expect(active(await claimsOf(world, seller))).toHaveLength(1)
  })

  it('손으로 넣은 다른 사람의 문자찜(같은 메모)은 취소 승인 대상이 아니다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    await expectOk(writeEvent(world, seller, { type: 'sms', b: sale.id, no: 15, memo: '홍길동', phone: '010-4444-5555' }))
    expect(await statuses(world, token, [sms('cx', '010-1234-5678', '15 취소 홍길동')])).toEqual(['SAVED'])
    const [card] = await cards(world, seller, sale.id)
    expect((await client(world, seller.cookie).post(`/api/inbox/cards/${card?.id as string}/approve`, { requestId: rid('ap') })).status).toBe(409)
    expect(active(await claimsOf(world, seller))).toHaveLength(1)
  })

  it('같은 취소 카드를 동시에 두 번 승인 → 취소 하나, 대기 승계 한 번 (대기 2순위는 그대로)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    expect(await statuses(world, token, [sms('a', '010-1111-1111', '15'), sms('b', '010-2222-2222', '15'), sms('c', '010-3333-3333', '15')])).toEqual(['SAVED', 'SAVED', 'SAVED'])
    expect(await statuses(world, token, [sms('ac', '010-1111-1111', '15 취소')])).toEqual(['SAVED'])
    const [card] = await cards(world, seller, sale.id)
    const api = client(world, seller.cookie)
    const results = await Promise.all([api.post(`/api/inbox/cards/${card?.id as string}/approve`, { requestId: rid('ap') }), api.post(`/api/inbox/cards/${card?.id as string}/approve`, { requestId: rid('ap') })])
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect((await claimsOf(world, seller)).map((claim) => claim.status)).toEqual(['CANCELLED', 'CONFIRMED', 'WAITLISTED'])
  })
})

describe('방송 창 (D-SMS3-07 — 서버 도착 시각 기준)', () => {
  it('끝난 뒤 10분 경계: 9분 59.999초는 끝난 방송, 10분 0.001초는 IGNORED', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16])
    await endBroadcast(world, seller, sale.id)
    world.clock.advance(10 * 60_000 - 1)
    expect(await statuses(world, token, [sms('in', '010-1234-5678', '15')])).toEqual(['SAVED'])
    world.clock.advance(2)
    expect(await statuses(world, token, [sms('out', '010-1234-5678', '16')])).toEqual(['IGNORED'])
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no)).toEqual([15])
  })

  it('휴대폰 시각(receivedAt)을 방송 중으로 적어도 창은 서버 도착 시각 — 끝난 지 30분 뒤면 IGNORED', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    world.clock.advance(5 * 60_000)
    await endBroadcast(world, seller, sale.id)
    world.clock.advance(30 * 60_000)
    expect(await statuses(world, token, [sms('late', '010-1234-5678', '15', '2026-10-31T20:01:00+09:00')])).toEqual(['IGNORED'])
    expect(await claimsOf(world, seller)).toEqual([])
  })

  it('끝난 실제 방송(10분 안)과 진행 중 리허설이 함께 있으면 손님 문자는 실제 방송으로, 리허설엔 넣지 않는다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    await endBroadcast(world, seller, sale.id)
    world.clock.advance(60_000)
    const rehearsal = await createBroadcast(world, seller, { date: SMS3_DAY, rehearsal: true })
    await expectOk(writeEvent(world, seller, { type: 'product.register', b: rehearsal.id, no: 15, name: '연습', price: 10_000 }))
    expect(await statuses(world, token, [sms('r1', '010-1234-5678', '15')])).toEqual(['SAVED'])
    expect(active(await claimsOf(world, seller)).map((claim) => claim.broadcast)).toEqual([sale.id])
    const { listClaims } = await import('@livejjim/core')
    expect(listClaims((await world.server.writer.read(seller.sellerId, SMS3_DAY, true)).state)).toEqual([])
  })

  it('방송 시작 직전에 온 "15"를 손님이 시작 뒤 다시 보내면(60초 안, 새 id) 찜이 된다 — 무시한 문자가 같은 문자 합치기로 다음 문자를 먹지 않는다', async () => {
    const { world, seller, token } = await inboxWorld()
    const t = kst('2026-10-31 20:00')
    expect(await statuses(world, token, [sms('early', '010-1234-5678', '15', new Date(t).toISOString())])).toEqual(['IGNORED'])
    world.clock.advance(20_000)
    await liveSale(world, seller, [15])
    world.clock.advance(10_000)
    const again = await statuses(world, token, [sms('again', '010-1234-5678', '15', new Date(t + 30_000).toISOString())])
    expect(again).toEqual(['SAVED'])
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no)).toEqual([15])
  })

  it('KST 자정을 넘긴 방송(10/31 23:50 시작)의 00:05 문자는 그 방송(10/31)으로 들어간다', async () => {
    const { world, seller, token } = await inboxWorld()
    world.clock.set(kst('2026-10-31 23:50'))
    await liveSale(world, seller, [15])
    world.clock.set(kst('2026-11-01 00:05'))
    expect(await statuses(world, token, [sms('mid', '010-1234-5678', '15')])).toEqual(['SAVED'])
    expect(active(await claimsOf(world, seller, SMS3_DAY)).map((claim) => claim.no)).toEqual([15])
  })
})

describe('저장 실패 뒤 다시 보내기 (C-04 500 → 같은 id로)', () => {
  it('문자찜 저장이 한 번 실패해 500이면, 같은 id로 다시 보낼 때 찜이 들어간다 (DUPLICATE로 잃지 않는다)', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const service = world.server.service as unknown as { writeInboxSms: (...args: unknown[]) => Promise<unknown> }
    const original = service.writeInboxSms.bind(service)
    let failOnce = true
    service.writeInboxSms = async (...args: unknown[]) => {
      if (failOnce) {
        failOnce = false
        throw new Error('db down')
      }
      return original(...args)
    }
    const first = await send(world, token, [sms('retry', '010-1234-5678', '15 홍길동')])
    expect(first.status).toBe(500)
    const second = await send(world, token, [sms('retry', '010-1234-5678', '15 홍길동')])
    expect(second.status).toBe(200)
    expect((second.body.results as { status: string }[])[0]?.status).toBe('SAVED')
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no)).toEqual([15])
  })

  it('은행 알림 저장이 한 번 실패해 500이면, 같은 id로 다시 보낼 때 입금이 하나 저장된다', async () => {
    const { world, seller, token } = await inboxWorld()
    const deposits = world.server.deposits as unknown as { receiveNotice: (...args: unknown[]) => Promise<unknown> }
    const original = deposits.receiveNotice.bind(deposits)
    let failOnce = true
    deposits.receiveNotice = async (...args: unknown[]) => {
      if (failOnce) {
        failOnce = false
        throw new Error('db down')
      }
      return original(...args)
    }
    const message = sms('dep-retry', '1588-9999', '[KB] 10/31 20:05 김영희 입금 14,000 잔액 1,028,000')
    expect((await send(world, token, [message])).status).toBe(500)
    expect(await statuses(world, token, [message])).toEqual(['SAVED'])
    const list = (await expectOk(client(world, seller.cookie).get('/api/deposits?status=REVIEW'))).body.deposits as unknown[]
    expect(list).toHaveLength(1)
  })
})
