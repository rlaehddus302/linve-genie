// SMS3 적대 시험 2라운드 (test-domain): 고치기 2라운드 새 규칙 깨뜨리기.
// - D-DEP2-12·13: 국제·해외·국외발신 변형, 잔액 이어짐 위조(믿지 않는 곳·국제발신 문자의 잔액)
// - D-SMS3-27: 403 INBOX_OFF와 401 경계 (순서 401→403→413→400→429)
// - D-SMS3-29: 12시간 넘은 방송은 창 아님 (11:59:59 / 12:00:01), 입금은 받음
// - D-SMS3-30: LATE 경계 (방송 시작 1초 전, 서버 도착 10분 ±1초, 미래 시각 자르기)
// - D-SMS3-31: REJECTED·STATE_FORMAT 500 뒤 같은 id 다시 보내기 — 카드·찜 중복 없음
// - D-DEP2-14: bal: 키 분 단위 — 문자+앱 같은 입금 하나
// - D-SMS3-28: 한도 1분 600건
import type { ClaimInfo } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { balancesOf } from '../../../apps/server/src/deposit/phone-store.ts'
import { kst, settlementEvents } from '../../../apps/server/test/deposit-support.ts'
import { SMS3_DAY, app, cards, claimsOf, inboxWorld, liveSale, send, sendRaw, sms, statuses } from '../../../apps/server/test/sms3-support.ts'
import { client, expectOk, rid, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

const ACTIVE = new Set(['CONFIRMED', 'WAITLISTED', 'HELD', 'CONFLICT'])
const active = (claims: readonly ClaimInfo[]): ClaimInfo[] => claims.filter((claim) => ACTIVE.has(claim.status))
const SHINHAN = '1577-8000'
const SHINHAN_APP = 'com.shinhan.sbanking'
const notice = (time: string, amount: string, balance: string, name = '김영희') => `[Web발신]\n신한10/31 ${time}\n110-***-123456\n입금 ${amount}\n잔액 ${balance}\n ${name}`
const iso = (kstText: string): string => new Date(kst(kstText)).toISOString()

interface Item {
  readonly status: string
  readonly review?: { reason: string }
}
async function list(world: TestServer, seller: Seller, status: string): Promise<Item[]> {
  return (await expectOk(client(world, seller.cookie).get(`/api/deposits?status=${status}`))).body.deposits as Item[]
}
async function allDeposits(world: TestServer, seller: Seller): Promise<Item[]> {
  return [...(await list(world, seller, 'REVIEW')), ...(await list(world, seller, 'AUTO_APPLIED')), ...(await list(world, seller, 'APPLIED'))]
}
async function payments(world: TestServer, seller: Seller): Promise<number> {
  return (await settlementEvents(world, seller, SMS3_DAY)).filter((event) => event.type === 'settlement.payment').length
}
async function soldToYounghee() {
  const w = await inboxWorld()
  const sale = await liveSale(w.world, w.seller, [15])
  expect(await statuses(w.world, w.token, [sms('buy', '010-2222-3333', '15 김영희')])).toEqual(['SAVED'])
  w.world.clock.advance(60_000)
  return { ...w, sale }
}
/** 믿는 신한 출금 알림으로 앞선 잔액 1,014,000을 만든다 (D-DEP2-13) */
async function prime(world: TestServer, token: string): Promise<void> {
  expect(await statuses(world, token, [sms('prime', SHINHAN, '신한10/31 20:01 출금 5,000원 잔액 1,014,000')])).toEqual(['SAVED'])
}
async function settings(world: TestServer, seller: Seller): Promise<Record<string, unknown>> {
  return (await expectOk(client(world, seller.cookie).get('/api/inbox/settings'))).body.inbox as Record<string, unknown>
}

describe('국제·해외·국외발신 변형 (D-DEP2-12)', () => {
  const MARKS = ['[국제발신]', '국제발신', '[해외발신]', '해외발신', '[국외발신]', '국외발신', '국 제 발 신', '해\t외\n발 신', '국 외 발 신', '[ 국제발신 ]', '국　제발신', '[국​제발신]', '해외‍발신', '국⁠외발신']
  for (const [i, mark] of MARKS.entries()) {
    it(`문자에 ${JSON.stringify(mark)} → 확인 필요 UNTRUSTED_SOURCE, 자동 확인 없음, 잔액 기록 없음`, async () => {
      const { world, seller, token } = await soldToYounghee()
      expect(await statuses(world, token, [sms(`i${String(i)}`, SHINHAN, `${mark}\n신한10/31 20:05\n110-***-123456\n입금 14,000\n잔액 1,028,000\n 김영희`)])).toEqual(['SAVED'])
      expect(await list(world, seller, 'AUTO_APPLIED')).toEqual([])
      expect((await list(world, seller, 'REVIEW'))[0]?.review?.reason).toBe('UNTRUSTED_SOURCE')
      expect(await balancesOf(world.database.db, seller.sellerId)).toEqual([])
      expect(await payments(world, seller)).toBe(0)
    })
  }

  it('앱 알림 제목·본문에 국제발신이 들어도 믿지 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [app('ia', SHINHAN_APP, '국제발신 신한 10/31 20:05', '입금 14,000 잔액 1,028,000 김영희'), app('ib', SHINHAN_APP, '신한 10/31 20:06', '입금 14,000 잔액 1,042,000 김영희 해 외 발 신')])).toEqual(['SAVED', 'SAVED'])
    expect(await list(world, seller, 'AUTO_APPLIED')).toEqual([])
    expect(await payments(world, seller)).toBe(0)
  })

  it('국제발신 문자의 출금 알림도 잔액 기록이 되지 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [sms('iw', SHINHAN, '[국제발신] 신한10/31 20:01 출금 5,000원 잔액 1,014,000')])
    expect(await balancesOf(world.database.db, seller.sellerId)).toEqual([])
  })
})

describe('잔액 이어짐 위조 (D-DEP2-13, DP-INV-6)', () => {
  it('국제발신 문자의 잔액이 앞선 잔액이 되지 않는다 → 진짜 입금은 BALANCE_GAP', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [sms('forged', SHINHAN, '[국제발신] 신한10/31 20:01 출금 5,000원 잔액 1,014,000')])
    expect(await statuses(world, token, [sms('real', SHINHAN, notice('20:05', '14,000', '1,028,000'))])).toEqual(['SAVED'])
    expect(await list(world, seller, 'AUTO_APPLIED')).toEqual([])
    expect((await list(world, seller, 'REVIEW'))[0]?.review?.reason).toBe('BALANCE_GAP')
    expect(await payments(world, seller)).toBe(0)
  })

  it('믿지 않는 곳(비슷한 번호·메신저·앱 대표번호)의 잔액들이 앞선 잔액이 되지 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [
      sms('f1', '1577-8001', '신한10/31 20:01 출금 5,000원 잔액 1,014,000'),
      sms('f2', '1600-0000', '신한10/31 20:02 입금 5,000 잔액 1,014,000 박철수'),
      app('f3', 'com.kakao.talk', '신한 10/31 20:03', '출금 5,000 잔액 1,014,000'),
      app('f4', SHINHAN, '신한 10/31 20:03', '출금 5,000 잔액 1,014,000'),
      app('f5', 'com.shinhan.sbanking.fake', '신한 10/31 20:03', '출금 5,000 잔액 1,014,000'),
    ])
    expect(await balancesOf(world.database.db, seller.sellerId)).toEqual([])
    await statuses(world, token, [sms('real', SHINHAN, notice('20:05', '14,000', '1,028,000'))])
    expect(await list(world, seller, 'AUTO_APPLIED')).toEqual([])
    expect((await list(world, seller, 'REVIEW'))[0]?.review?.reason).toBe('BALANCE_GAP')
  })

  it('다른 은행의 앞선 잔액은 이어짐이 아니다 (KB 잔액 + 신한 입금)', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [sms('kb', '1588-9999', '[KB] 10/31 20:01 출금 5,000 잔액 1,014,000')])
    await statuses(world, token, [sms('real', SHINHAN, notice('20:05', '14,000', '1,028,000'))])
    expect(await list(world, seller, 'AUTO_APPLIED')).toEqual([])
    expect((await list(world, seller, 'REVIEW'))[0]?.review?.reason).toBe('BALANCE_GAP')
  })

  it('잔액이 하나 모자라거나 남아도(±1원) 자동 확인이 아니다, 정확히 맞으면 자동 확인', async () => {
    for (const [prev, expected] of [['1,013,999', 0], ['1,014,001', 0], ['1,014,000', 1]] as const) {
      const { world, seller, token } = await soldToYounghee()
      await statuses(world, token, [sms('p', SHINHAN, `신한10/31 20:01 출금 5,000원 잔액 ${prev}`)])
      await statuses(world, token, [sms('real', SHINHAN, notice('20:05', '14,000', '1,028,000'))])
      expect(await list(world, seller, 'AUTO_APPLIED'), prev).toHaveLength(expected)
      expect(await payments(world, seller), prev).toBe(expected)
    }
  })

  it('확인 필요로 저장된 입금의 잔액이 다음 입금의 앞선 잔액 — 이어지면 다음은 자동 확인되지만, 처음 것이 두 번 확인되지는 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [sms('first', SHINHAN, notice('20:05', '14,000', '1,028,000'))]) // 앞선 잔액 없음 → 확인 필요
    expect((await list(world, seller, 'REVIEW'))[0]?.review?.reason).toBe('BALANCE_GAP')
    await statuses(world, token, [sms('second', SHINHAN, notice('20:06', '3,000', '1,031,000', '박철수'))])
    expect(await payments(world, seller)).toBe(0) // 박철수는 찜 없음 + 김영희는 확인 필요 그대로
  })

  it('같은 입금을 앞선 잔액 없이 문자·앱이 번갈아 와도 정산은 0번 또는 1번 (두 번 아님)', async () => {
    const { world, seller, token } = await soldToYounghee()
    await statuses(world, token, [sms('s', SHINHAN, notice('20:05', '14,000', '1,028,000')), app('a', SHINHAN_APP, '신한 10/31 20:05', '입금 14,000 잔액 1,028,000 김영희')])
    expect(await payments(world, seller)).toBe(0)
    expect(await allDeposits(world, seller)).toHaveLength(1)
  })
})

describe('403 INBOX_OFF와 401 경계 (D-SMS3-27)', () => {
  it('끄면 맞는 토큰은 403 INBOX_OFF — 틀린·옛·없는 토큰은 여전히 401, 순서는 401→403→413→400→429', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const api = client(world, seller.cookie)
    await expectOk(api.put('/api/inbox/settings', { enabled: false }))
    const good = JSON.stringify({ device: '폰', messages: [sms('o1', '010-1234-5678', '15')] })
    const off = await sendRaw(world, token, good)
    expect(off.status).toBe(403)
    expect(off.body).toMatchObject({ error: { code: 'INBOX_OFF' } })
    // 틀린 토큰은 꺼진 동안에도 401
    for (const authorization of [`Bearer ${token.slice(0, -1)}x`, 'Bearer nope', 'Bearer ', `bearer ${token}`]) {
      expect((await sendRaw(world, null, good, authorization)).status, authorization.slice(0, 15)).toBe(401)
    }
    expect((await sendRaw(world, null, good)).status).toBe(401)
    // 꺼진 채 맞는 토큰: 큰 본문·모양 틀림·0건·한도 모두 403이 먼저 (아무것도 처리하지 않음)
    expect((await sendRaw(world, token, JSON.stringify({ device: '폰', messages: [sms('big', '010-1234-5678', '가'.repeat(300_000))] }))).status).toBe(403)
    expect((await sendRaw(world, token, '{깨진')).status).toBe(403)
    expect((await sendRaw(world, token, JSON.stringify({ device: '폰', messages: [] }))).status).toBe(403)
    expect((await sendRaw(world, token, JSON.stringify({ device: 1, messages: 'x' }))).status).toBe(403)
    expect(await claimsOf(world, seller)).toEqual([])
    // 다시 켜면 같은 토큰으로 200 — 토큰 해시를 지우지 않았다
    await expectOk(api.put('/api/inbox/settings', { enabled: true }))
    expect(await statuses(world, token, [sms('o1', '010-1234-5678', '15')])).toEqual(['SAVED'])
    // 켜진 채: 413 → 400 순서 확인
    expect((await sendRaw(world, token, JSON.stringify({ device: '폰', messages: [sms('big2', '010-1234-5678', '가'.repeat(300_000))] }))).status).toBe(413)
    expect((await sendRaw(world, token, '{깨진')).status).toBe(400)
  })

  it('끄고 토큰을 다시 만들면: 새 토큰으로 켜지고 200, 옛 토큰은 401(403 아님)', async () => {
    const { world, seller, token: t1 } = await inboxWorld()
    await liveSale(world, seller, [15])
    const api = client(world, seller.cookie)
    await expectOk(api.put('/api/inbox/settings', { enabled: false }))
    expect((await send(world, t1, [])).status).toBe(403)
    const t2 = (await expectOk(api.post('/api/inbox/token', {}))).body.token as string
    expect((await send(world, t1, [])).status).toBe(401)
    expect((await send(world, t2, [])).status).toBe(200)
  })

  it('꺼진 동안 설정은 hasToken 그대로, 끄고 켜는 사이 온 문자는 처리되지 않고 켠 뒤 같은 id로 보내면 들어간다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const api = client(world, seller.cookie)
    await expectOk(api.put('/api/inbox/settings', { enabled: false }))
    expect(await settings(world, seller)).toMatchObject({ enabled: false, hasToken: true })
    expect((await send(world, token, [sms('keep', '010-1234-5678', '15')])).status).toBe(403)
    await expectOk(api.put('/api/inbox/settings', { enabled: true }))
    expect(await statuses(world, token, [sms('keep', '010-1234-5678', '15')])).toEqual(['SAVED'])
    expect(active(await claimsOf(world, seller))).toHaveLength(1)
  })

  it('틀린 토큰 IP 429(20번)는 꺼진 판매자의 맞는 토큰 403을 막지 않는다', async () => {
    const { world, token, seller } = await inboxWorld()
    await expectOk(client(world, seller.cookie).put('/api/inbox/settings', { enabled: false }))
    for (let i = 0; i < 5; i++) expect((await send(world, 'wrong-token', [])).status).toBe(401)
    expect((await send(world, token, [])).status).toBe(403)
  })
})

describe('12시간 넘은 방송은 창이 아니다 (D-SMS3-29)', () => {
  it('11:59:59는 아직 창(SAVED) — 12:00:01은 IGNORED, 설정에 알림, 다른 방송(리허설)으로 넘기지 않음, 입금은 받음', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15, 16, 17])
    world.clock.advance(12 * 3_600_000 - 1000)
    expect(await statuses(world, token, [sms('in', '010-1111-1111', '15')])).toEqual(['SAVED'])
    expect((await settings(world, seller)).staleBroadcast).toBeNull()
    world.clock.advance(2000)
    expect(await statuses(world, token, [sms('out1', '010-2222-2222', '16 홍길동')])).toEqual(['IGNORED'])
    const stale = (await settings(world, seller)).staleBroadcast as { count: number; message: string; b: string } | null
    expect(stale?.count).toBe(1)
    expect(stale?.message).toContain('12시간')
    expect(JSON.stringify(stale)).not.toContain('홍길동')
    expect(await statuses(world, token, [sms('out2', '010-3333-3333', '17'), sms('out3', '010-4444-4444', '취소 15')])).toEqual(['IGNORED', 'IGNORED'])
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no)).toEqual([15])
    expect(((await settings(world, seller)).staleBroadcast as { count: number }).count).toBe(3)
    // 입금은 그대로 받는다
    expect(await statuses(world, token, [sms('dep', SHINHAN, '신한11/01 08:00 입금 14,000 잔액 1,028,000 김영희')])).toEqual(['SAVED'])
    expect(await allDeposits(world, seller)).toHaveLength(1)
  })

  it('방송을 끝내면 알림이 사라지고, 닫으면 사라졌다가 새 문자가 오면 다시 나온다 (본문은 어디에도 없음)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16])
    world.clock.advance(13 * 3_600_000)
    await statuses(world, token, [sms('o1', '010-1111-1111', '15 비밀글ZXQ')])
    expect(((await settings(world, seller)).staleBroadcast as { count: number }).count).toBe(1)
    const api = client(world, seller.cookie)
    const closed = await expectOk(api.post('/api/inbox/stale/close', {}))
    expect((closed.body.inbox as { staleBroadcast: unknown }).staleBroadcast).toBeNull()
    await statuses(world, token, [sms('o2', '010-2222-2222', '16')])
    expect((await settings(world, seller)).staleBroadcast).not.toBeNull()
    expect(JSON.stringify(await expectOk(api.get(`/api/inbox/cards?b=${sale.id}`)))).not.toContain('비밀글ZXQ')
    await expectOk(api.post(`/api/broadcasts/${sale.id}/end`, { requestId: rid('end') }))
    expect((await settings(world, seller)).staleBroadcast).toBeNull()
  })

  it('12시간 넘은 방송이 있어도 거기서 읽힌 문자는 카드도 찜도 만들지 않고, 같은 id를 다시 보내도(DUPLICATE 아닌) 같은 결과', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    world.clock.advance(13 * 3_600_000)
    expect(await statuses(world, token, [sms('o1', '010-1111-1111', '15 있나요?')])).toEqual(['IGNORED'])
    expect(['IGNORED', 'DUPLICATE']).toContain((await statuses(world, token, [sms('o1', '010-1111-1111', '15 있나요?')]))[0])
    expect(await cards(world, seller, sale.id)).toEqual([])
    expect(await claimsOf(world, seller)).toEqual([])
  })

  it('보조자는 알림 닫기 403', async () => {
    const { world, seller } = await inboxWorld()
    const made = await expectOk(client(world, seller.cookie).post('/api/assistants', { name: '도우미' }))
    const { login } = await import('../../../apps/server/test/support.ts')
    const cookie = await login(world, (made.body.assistant as { loginId: string }).loginId, made.body.password as string)
    expect((await client(world, cookie).post('/api/inbox/stale/close', {})).status).toBe(403)
  })
})

describe('늦게 온 문자 LATE 경계 (D-SMS3-30)', () => {
  it('방송 시작 1초 전에 받은 문자는 LATE 카드(찜 없음), 시작 정각은 바로 들어간다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16])
    world.clock.advance(5 * 60_000)
    expect(await statuses(world, token, [sms('l1', '010-1111-1111', '15 홍길동', '2026-10-31T19:59:59+09:00')])).toEqual(['SAVED'])
    expect(active(await claimsOf(world, seller))).toEqual([])
    const [card] = await cards(world, seller, sale.id)
    expect(card).toMatchObject({ why: 'LATE', kind: 'REVIEW' })
    expect(card?.message).toContain('늦게 온 문자')
    expect(card?.message).toContain('10월 31일 19:59:59')
    expect(await statuses(world, token, [sms('l2', '010-2222-2222', '16', '2026-10-31T20:00:00+09:00')])).toEqual(['SAVED'])
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no)).toEqual([16])
  })

  it('서버 도착보다 정확히 10분 이른 것은 바로, 10분 1초 이르면 LATE, 9분 59초는 바로', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16, 17])
    world.clock.advance(30 * 60_000) // 도착 20:30:00
    await statuses(world, token, [sms('a', '010-1111-1111', '15', '2026-10-31T20:20:00+09:00')])
    await statuses(world, token, [sms('b', '010-2222-2222', '16', '2026-10-31T20:19:59+09:00')])
    await statuses(world, token, [sms('c', '010-3333-3333', '17', '2026-10-31T20:20:01+09:00')])
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no).sort()).toEqual([15, 17])
    const found = await cards(world, seller, sale.id)
    expect(found.map((card) => [card.why, card.numbers])).toEqual([['LATE', [16]]])
  })

  it('LATE 카드는 late:true·arrivedAt = 서버 도착이고, 넣어도 이중으로 들어가지 않으며 같은 문자를 다시 보내면 DUPLICATE', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    world.clock.advance(5 * 60_000)
    const arrival = new Date(world.clock.now()).toISOString()
    await statuses(world, token, [sms('l1', '010-1111-1111', '15 홍길동', '2026-10-31T19:00:00+09:00')])
    expect(await statuses(world, token, [sms('l1', '010-1111-1111', '15 홍길동', '2026-10-31T19:00:00+09:00')])).toEqual(['DUPLICATE'])
    const found = await cards(world, seller, sale.id)
    expect(found).toHaveLength(1)
    const card = found[0] as unknown as { id: string; late: boolean; arrivedAt: string; receivedAt: string; canApprove: boolean }
    expect(card.late).toBe(true)
    expect(card.arrivedAt).toBe(arrival)
    expect(card.receivedAt).toBe(new Date(kst('2026-10-31 19:00')).toISOString())
    expect(card.canApprove).toBe(false)
    const api = client(world, seller.cookie)
    world.clock.advance(60_000)
    await expectOk(api.post(`/api/inbox/cards/${card.id}/insert`, { requestId: rid('in'), no: 15 }))
    expect((await api.post(`/api/inbox/cards/${card.id}/insert`, { requestId: rid('in'), no: 15 })).status).toBeGreaterThanOrEqual(400)
    expect(active(await claimsOf(world, seller))).toHaveLength(1)
  })

  it('미래 시각(휴대폰 시계 빠름)은 서버 도착 시각으로 잘라서 순서를 앞당기지 못한다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    world.clock.advance(5 * 60_000) // 20:05
    expect(await statuses(world, token, [sms('g1', '010-1111-1111', '15 먼저', '2026-10-31T21:05:00+09:00')])).toEqual(['SAVED'])
    world.clock.advance(60_000)
    expect(await statuses(world, token, [sms('g2', '010-2222-2222', '15 나중', '2026-10-31T20:06:00+09:00')])).toEqual(['SAVED'])
    const claims = await claimsOf(world, seller)
    const winner = claims.find((claim) => claim.status === 'CONFIRMED')
    const loser = claims.find((claim) => claim.status === 'WAITLISTED')
    expect(winner?.seq).toBeLessThan(loser?.seq as number)
    expect(winner?.rankTime).toBeLessThanOrEqual(kst('2026-10-31 20:05:30')) // 서버 도착(20:05)으로 잘렸다
  })

  it('먼 미래·한 시간 뒤 밀리초는 서버 도착 시각으로 바로 들어가고, 24시간 넘게 지난 원래 값은 LATE 카드 (D-SMS3-30: 원래 값 그대로 판정)', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16, 17])
    world.clock.advance(5 * 60_000)
    await statuses(world, token, [sms('f1', '010-1111-1111', '15', '2030-01-01T00:00:00+09:00'), sms('f2', '010-2222-2222', '16', Date.parse('2026-10-31T20:05:00+09:00') + 3_600_000), sms('f3', '010-3333-3333', '17', '2020-01-01T00:00:00+09:00')])
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no).sort()).toEqual([15, 16])
    expect((await cards(world, seller, sale.id)).map((card) => [card.why, card.numbers])).toEqual([['LATE', [17]]])
  })

  it('LATE 문자의 취소 요청은 늘 CANCEL 카드(late 아님), 확인 필요 사유는 그대로 + late 표시', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    world.clock.advance(5 * 60_000)
    await statuses(world, token, [sms('c1', '010-1111-1111', '15 취소', '2026-10-31T19:00:00+09:00'), sms('u1', '010-2222-2222', '15 있나요?', '2026-10-31T19:00:00+09:00')])
    const found = (await cards(world, seller, sale.id)) as unknown as { kind: string; why: string | null; late: boolean }[]
    expect(found.find((card) => card.kind === 'CANCEL')?.late).toBe(false)
    expect(found.find((card) => card.kind === 'REVIEW')).toMatchObject({ late: true })
    expect(found.find((card) => card.kind === 'REVIEW')?.why).not.toBe('LATE')
  })
})

describe('REJECTED·STATE_FORMAT 뒤 같은 id 다시 보내기 (D-SMS3-31)', () => {
  type Writer = { writeInboxSms: (...args: unknown[]) => Promise<unknown> }

  it('엔진 거절(봉인 등)은 REJECTED 카드 하나 — 같은 id를 다시 보내도 카드·찜이 늘지 않는다', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    const service = world.server.service as unknown as Writer
    const original = service.writeInboxSms.bind(service)
    service.writeInboxSms = async () => ({ kind: 'rejected', rejection: { code: 'SEALED', message: 'x' } })
    expect(await statuses(world, token, [sms('rj', '010-1111-1111', '15 홍길동')])).toEqual(['SAVED'])
    expect(await statuses(world, token, [sms('rj', '010-1111-1111', '15 홍길동')])).toEqual(['DUPLICATE'])
    service.writeInboxSms = original
    const found = await cards(world, seller, sale.id)
    expect(found.map((card) => [card.why, card.numbers])).toEqual([['REJECTED', [15]]])
    expect(found[0]?.message).toBe('15번은 바로 넣지 못했어요. 보드에서 확인해 주세요')
    expect(await claimsOf(world, seller)).toEqual([])
  })

  it('STATE_FORMAT은 500, 카드 없음 — 같은 id로 다시 보내면 SAVED 한 번, 찜 하나, 카드 없음', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15])
    const service = world.server.service as unknown as Writer
    const original = service.writeInboxSms.bind(service)
    let fail = true
    service.writeInboxSms = async (...args: unknown[]) => {
      if (fail) {
        fail = false
        return { kind: 'rejected', rejection: { code: 'STATE_FORMAT', message: 'x' } }
      }
      return original(...args)
    }
    const first = await send(world, token, [sms('sf', '010-1111-1111', '15 홍길동')])
    expect(first.status).toBe(500)
    expect(await cards(world, seller, sale.id)).toEqual([])
    expect(await claimsOf(world, seller)).toEqual([])
    expect(await statuses(world, token, [sms('sf', '010-1111-1111', '15 홍길동')])).toEqual(['SAVED'])
    expect(await statuses(world, token, [sms('sf', '010-1111-1111', '15 홍길동')])).toEqual(['DUPLICATE'])
    expect(active(await claimsOf(world, seller))).toHaveLength(1)
    expect(await cards(world, seller, sale.id)).toEqual([])
  })

  it('두 번호 문자 "15 16": 15는 들어가고 16에서 STATE_FORMAT 500 → 다시 보내면 15는 한 번, 16이 들어가고 카드 없음', async () => {
    const { world, seller, token } = await inboxWorld()
    const sale = await liveSale(world, seller, [15, 16])
    const service = world.server.service as unknown as Writer
    const original = service.writeInboxSms.bind(service)
    let fail = true
    service.writeInboxSms = async (...args: unknown[]) => {
      const input = args[2] as { no: number }
      if (fail && input.no === 16) {
        fail = false
        return { kind: 'rejected', rejection: { code: 'STATE_FORMAT', message: 'x' } }
      }
      return original(...args)
    }
    // 번호 둘을 모두 찜으로 읽는 설정이 아니면 이 시험은 의미가 없으므로 먼저 확인한다
    const first = await send(world, token, [sms('mn', '010-1111-1111', '15 16')])
    if (first.status === 200) {
      expect(active(await claimsOf(world, seller)).length).toBeGreaterThan(0)
      return
    }
    expect(first.status).toBe(500)
    expect(await statuses(world, token, [sms('mn', '010-1111-1111', '15 16')])).toEqual(['SAVED'])
    const numbers = active(await claimsOf(world, seller)).map((claim) => claim.no).sort()
    expect(numbers).toEqual([15, 16])
    expect(await cards(world, seller, sale.id)).toEqual([])
  })

  it('같은 요청 안의 다른 문자는 영향받지 않는다 (500은 요청 전체 — 앞서 처리한 것은 다시 오면 DUPLICATE)', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15, 16])
    const service = world.server.service as unknown as Writer
    const original = service.writeInboxSms.bind(service)
    let fail = true
    service.writeInboxSms = async (...args: unknown[]) => {
      const input = args[2] as { no: number }
      if (fail && input.no === 16) {
        fail = false
        return { kind: 'rejected', rejection: { code: 'STATE_FORMAT', message: 'x' } }
      }
      return original(...args)
    }
    const batch = [sms('m1', '010-1111-1111', '15 홍길동'), sms('m2', '010-2222-2222', '16 김철수')]
    expect((await send(world, token, batch)).status).toBe(500)
    const again = await send(world, token, batch)
    expect(again.status).toBe(200)
    expect((again.body.results as { status: string }[]).map((r) => r.status)).toEqual(['DUPLICATE', 'SAVED'])
    expect(active(await claimsOf(world, seller)).map((claim) => claim.no).sort()).toEqual([15, 16])
  })
})

describe('bal: 키 분 단위 (D-DEP2-14)', () => {
  it('같은 분 안 서로 다른 초의 앱 알림 둘 + 같은 분 문자 → 입금 하나, 정산 한 번', async () => {
    const { world, seller, token } = await soldToYounghee()
    await prime(world, token)
    await statuses(world, token, [
      app('a1', SHINHAN_APP, '신한 입금', '입금 14,000 잔액 1,028,000 김영희', iso('2026-10-31 20:05:07')),
      app('a2', SHINHAN_APP, '신한 입금', '입금 14,000 잔액 1,028,000 김영희', iso('2026-10-31 20:05:55')),
      sms('s1', SHINHAN, notice('20:05', '14,000', '1,028,000')),
    ])
    expect(await allDeposits(world, seller)).toHaveLength(1)
    expect(await payments(world, seller)).toBe(1)
  })

  it('분 경계를 넘는 같은 거래(문자 20:05, 앱 알림 20:06:01) → 정산은 두 번 되지 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    await prime(world, token)
    await statuses(world, token, [sms('s1', SHINHAN, notice('20:05', '14,000', '1,028,000')), app('a1', SHINHAN_APP, '신한 입금', '입금 14,000 잔액 1,028,000 김영희', iso('2026-10-31 20:06:01'))])
    expect(await payments(world, seller)).toBe(1)
  })

  it('같은 분 다른 금액·다른 잔액은 별개 입금이고 서로 가리지 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    await prime(world, token)
    await statuses(world, token, [sms('s1', SHINHAN, notice('20:05', '14,000', '1,028,000')), sms('s2', SHINHAN, notice('20:05', '3,000', '1,031,000', '박철수'))])
    expect(await allDeposits(world, seller)).toHaveLength(2)
    expect(await payments(world, seller)).toBe(1)
  })
})

describe('한도 1분 600건 (D-SMS3-28)', () => {
  it('600건까지 200, 601번째는 429, 묶음이 넘치면 통째 429(그 안의 문자 처리 안 됨), 1분 뒤 같은 id로 처리', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    let sent = 0
    for (let r = 0; r < 29; r++) {
      const batch = Array.from({ length: 20 }, () => sms(`n${String(sent++)}`, '010-9999-0000', '안녕하세요'))
      expect((await send(world, token, batch)).status).toBe(200)
    }
    // 580건. 21건짜리는 400(최대 20건)이므로 20건 → 600
    expect((await send(world, token, Array.from({ length: 20 }, () => sms(`n${String(sent++)}`, '010-9999-0000', '안녕하세요')))).status).toBe(200)
    const over = await send(world, token, [sms('over', '010-1111-1111', '15 홍길동')])
    expect(over.status).toBe(429)
    expect(over.body).toMatchObject({ error: { code: 'TOO_MANY' } })
    expect(await claimsOf(world, seller)).toEqual([])
    world.clock.advance(60_001)
    expect(await statuses(world, token, [sms('over', '010-1111-1111', '15 홍길동')])).toEqual(['SAVED'])
  })

  it('599건 뒤 2건 묶음은 통째 429, 1건 묶음은 200', async () => {
    const { world, token } = await inboxWorld()
    let sent = 0
    for (let r = 0; r < 29; r++) await send(world, token, Array.from({ length: 20 }, () => sms(`n${String(sent++)}`, '010-9999-0000', '안녕하세요')))
    expect((await send(world, token, Array.from({ length: 19 }, () => sms(`n${String(sent++)}`, '010-9999-0000', '안녕하세요')))).status).toBe(200)
    const two = await send(world, token, [sms('t1', '010-9999-0000', '안녕하세요'), sms('t2', '010-9999-0000', '안녕하세요')])
    expect(two.status).toBe(429)
    expect((await send(world, token, [sms('t1', '010-9999-0000', '안녕하세요')])).status).toBe(200)
    expect((await send(world, token, [sms('t3', '010-9999-0000', '안녕하세요')])).status).toBe(429)
  })
})
