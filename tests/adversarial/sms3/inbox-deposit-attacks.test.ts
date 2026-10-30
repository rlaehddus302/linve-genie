// SMS3 적대 시험 (test-domain): 휴대폰 알림 입금 (DEPOSIT_RULES DP-9 8·9, DP-INV-6·7·8) — AC-SMS3-33.
// - 같은 입금을 문자와 앱 알림으로(동시·시각 정밀도 다름·한쪽만 잔액) → 두 번 확인(정산 두 번) 없음
// - 믿지 않는 곳(비슷한 번호·비슷한 패키지·메신저)의 입금은 자동 확인되지 않음, 믿지 않는 곳의 잔액은 잔액 이어짐에 쓰이지 않음 (DP-INV-6)
// - 휴대폰 번호·이름에서 온 은행 모양 문자는 입금이 아님 (C-05)
// - 믿을 출금·입금 취소·읽지 못함은 입금 번호가 되지 않음, 믿지 않는 곳의 것은 아무것도 저장 안 됨 (DP-INV-7)
// - 본문·제목·보낸 번호 원문·토큰이 DB·로그·SSE 어디에도 없음 (DP-INV-8, C-07) — 오류 응답 길(400·413·429·500) 포함
import { describe, expect, it } from 'vitest'
import { balancesOf } from '../../../apps/server/src/deposit/phone-store.ts'
import { settlementEvents } from '../../../apps/server/test/deposit-support.ts'
import { SMS3_DAY, app, claimsOf, inboxWorld, liveSale, send, sendRaw, sms, statuses } from '../../../apps/server/test/sms3-support.ts'
import { client, dumpAllTables, expectOk, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

interface Item {
  readonly no: number
  readonly status: string
  readonly name: string
  readonly amount: number
  readonly source: { kind: string }
  readonly review?: { reason: string }
}

async function list(world: TestServer, seller: Seller, status: string): Promise<Item[]> {
  return (await expectOk(client(world, seller.cookie).get(`/api/deposits?status=${status}`))).body.deposits as Item[]
}
async function allDeposits(world: TestServer, seller: Seller): Promise<Item[]> {
  return [...(await list(world, seller, 'REVIEW')), ...(await list(world, seller, 'AUTO_APPLIED')), ...(await list(world, seller, 'APPLIED')), ...(await list(world, seller, 'IGNORED'))]
}
async function payments(world: TestServer, seller: Seller): Promise<number> {
  return (await settlementEvents(world, seller, SMS3_DAY)).filter((event) => event.type === 'settlement.payment').length
}

const SHINHAN = '1577-8000'
const SHINHAN_APP = 'com.shinhan.sbanking'
const notice = (time: string, amount: string, balance: string, name = '김영희') => `[Web발신]\n신한10/31 ${time}\n110-***-123456\n입금 ${amount}\n잔액 ${balance}\n ${name}`

/** 실제 방송 15번을 휴대폰 문자로 김영희(010-2222-3333)가 1등 → 묶음 14,000원 */
async function soldToYounghee() {
  const w = await inboxWorld()
  const sale = await liveSale(w.world, w.seller, [15])
  expect(await statuses(w.world, w.token, [sms('buy', '010-2222-3333', '15 김영희')])).toEqual(['SAVED'])
  w.world.clock.advance(60_000)
  return { ...w, sale }
}

describe('같은 입금이 문자와 앱 알림으로 — 두 번 확인 없음 (DP-9 8, DP-INV-4)', () => {
  it('문자와 앱 알림을 서로 다른 요청으로 동시에 → 입금 하나, 정산 기록 하나', async () => {
    const { world, seller, token } = await soldToYounghee()
    const [a, b] = await Promise.all([
      send(world, token, [sms('s1', SHINHAN, notice('20:05', '14,000', '1,028,000'))]),
      send(world, token, [app('a1', SHINHAN_APP, '신한 10/31 20:05', '입금 14,000 잔액 1,028,000 김영희')]),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    expect(await allDeposits(world, seller)).toHaveLength(1)
    expect(await payments(world, seller)).toBe(1)
  })

  it('앱 알림(시각 글 없음 — 받은 시각 초까지)이 먼저, 같은 거래의 문자(분까지)가 뒤에 → 자동 확인은 한 번뿐', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [app('a1', SHINHAN_APP, '신한 입금', '입금 14,000 잔액 1,028,000 김영희', '2026-10-31T20:05:07+09:00')])).toEqual(['SAVED'])
    expect(await statuses(world, token, [sms('s1', SHINHAN, notice('20:05', '14,000', '1,028,000'), '2026-10-31T20:05:05+09:00')])).toEqual(['SAVED'])
    expect(await list(world, seller, 'AUTO_APPLIED')).toHaveLength(1)
    expect(await payments(world, seller)).toBe(1)
  })

  it('문자(잔액 있음)와 앱 알림(잔액 없음)이 같은 입금을 알림 → 자동 확인은 한 번뿐', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [sms('s1', SHINHAN, notice('20:05', '14,000', '1,028,000')), app('a1', SHINHAN_APP, '입금 14,000원', '김영희', '2026-10-31T20:05:20+09:00')])).toEqual(['SAVED', 'SAVED'])
    expect(await list(world, seller, 'AUTO_APPLIED')).toHaveLength(1)
    expect(await payments(world, seller)).toBe(1)
  })

  it('은행 대표번호 문자 둘(같은 은행의 다른 대표번호)로 같은 거래 → 입금 하나', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [sms('s1', '1577-8000', notice('20:05', '14,000', '1,028,000')), sms('s2', '1599-8000', notice('20:05', '14,000', '1,028,000'))])).toEqual(['SAVED', 'SAVED'])
    expect(await allDeposits(world, seller)).toHaveLength(1)
    expect(await payments(world, seller)).toBe(1)
  })
})

describe('믿지 않는 곳은 자동 확인되지 않는다 (DP-INV-6)', () => {
  const UNTRUSTED: [string, 'SMS' | 'APP', string][] = [
    ['u1', 'SMS', '1600-0000'],
    ['u2', 'SMS', '1577-8001'],
    ['u3', 'SMS', '1577-80000'],
    ['u4', 'SMS', '02-1577-8000'],
    ['u5', 'SMS', '+1 1577-8000'],
    ['u6', 'APP', 'com.kakao.talk'],
    ['u7', 'APP', 'com.shinhan.sbanking.fake'],
    ['u8', 'APP', 'COM.SHINHAN.SBANKING'],
    ['u9', 'APP', 'com.shinhan.sbаnking'],
    ['u10', 'APP', ' com.shinhan.sbanking'],
    ['u11', 'APP', 'com.samsung.android.messaging'],
  ]

  for (const [id, channel, from] of UNTRUSTED) {
    it(`${channel} ${JSON.stringify(from)}의 입금 알림 → 확인 필요 UNTRUSTED_SOURCE, 정산 기록 없음`, async () => {
      const { world, seller, token } = await soldToYounghee()
      const message = channel === 'SMS' ? sms(id, from, notice('20:05', '14,000', '1,028,000')) : app(id, from, '신한 10/31 20:05', '입금 14,000 잔액 1,028,000 김영희')
      expect(await statuses(world, token, [message])).toEqual(['SAVED'])
      expect(await list(world, seller, 'AUTO_APPLIED')).toEqual([])
      const [item] = await list(world, seller, 'REVIEW')
      expect(item?.review?.reason).toBe('UNTRUSTED_SOURCE')
      expect(await payments(world, seller)).toBe(0)
    })
  }

  it('믿지 않는 곳의 잔액(입금·출금)은 잔액 기록이 되지 않는다 — 가짜 잔액으로 진짜 입금을 막거나 이어 붙이지 못한다', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(
      await statuses(world, token, [
        sms('f1', '1600-0000', '신한10/31 20:01 입금 9,000 잔액 2,000,000 박철수'),
        sms('f2', '1600-0000', '신한10/31 20:02 출금 5,000 잔액 3,000,000'),
        app('f3', 'com.kakao.talk', '신한 10/31 20:03', '입금 9,000 잔액 5,000,000 박철수'),
      ]),
    ).toEqual(['SAVED', 'IGNORED', 'SAVED'])
    expect(await balancesOf(world.database.db, seller.sellerId)).toEqual([])
    expect(await statuses(world, token, [sms('real', SHINHAN, notice('20:05', '14,000', '1,028,000'))])).toEqual(['SAVED'])
    expect((await list(world, seller, 'AUTO_APPLIED')).map((item) => item.name)).toEqual(['김영희'])
  })

  it('잔액이 이어지지 않은 입금(BALANCE_GAP)은 목록을 다시 열어도·같은 묶음이 남아 있어도 자동 확인이 되지 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [sms('w', SHINHAN, '신한 10/31 20:03 출금 5,000원 잔액 1,009,000'), sms('d', SHINHAN, notice('20:05', '14,000', '1,028,000'))])).toEqual(['SAVED', 'SAVED'])
    for (let round = 0; round < 3; round++) {
      const [item] = await list(world, seller, 'REVIEW')
      expect(item?.review?.reason).toBe('BALANCE_GAP')
    }
    expect(await list(world, seller, 'AUTO_APPLIED')).toEqual([])
    expect(await payments(world, seller)).toBe(0)
  })

  it('휴대폰 번호·이름에서 온 은행 모양 문자는 입금이 아니다 (+82 휴대폰·전각 휴대폰·연락처 이름 "신한은행")', async () => {
    const { world, seller, token } = await soldToYounghee()
    const froms = ['010-2222-3333', '+82 10-2222-3333', '０１０-９９９９-８８８８', '신한은행', '신한', 'KB국민']
    await statuses(world, token, froms.map((from, i) => sms(`fake${String(i)}`, from, notice('20:05', '14,000', '1,028,000'))))
    await statuses(world, token, froms.map((from, i) => sms(`fake2${String(i)}`, from, '[KB] 김영희 입금 14,000')))
    expect(await allDeposits(world, seller)).toEqual([])
    expect(await balancesOf(world.database.db, seller.sellerId)).toEqual([])
    expect(await payments(world, seller)).toBe(0)
  })

  it('앱 알림 채널로 보낸 은행 대표번호(보낸 곳 1577-8000)는 믿지 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [app('ap', SHINHAN, '신한 10/31 20:05', '입금 14,000 잔액 1,028,000 김영희')])).toEqual(['SAVED'])
    expect(await list(world, seller, 'AUTO_APPLIED')).toEqual([])
    expect(await payments(world, seller)).toBe(0)
  })
})

describe('출금·입금 취소·읽지 못함은 입금이 아니다 (DP-INV-7)', () => {
  it('믿을 곳의 입금 취소 여러 표기·출금·카드 승인·결제·읽지 못함 → 입금 번호 없음, 정산 기록 없음', async () => {
    const { world, seller, token } = await soldToYounghee()
    const texts = [
      '신한10/31 20:05 입금취소 14,000 김영희',
      '신한10/31 20:05 입금 취소 14,000원 김영희',
      '신한10/31 20:05 입 금 취 소 14,000 김영희',
      '신한10/31 20:05 14,000원 입금취소 김영희',
      '신한10/31 20:05 출금 14,000 김영희 잔액 1,000,000',
      '신한10/31 20:05 체크카드 승인 14,000 김영희',
      '신한10/31 20:05 결제 14,000원 김영희',
      '신한10/31 20:05 지급 14,000 김영희',
      '신한10/31 20:05 김영희 입금 14,000 출금 14,000',
      '신한10/31 20:05 입금 0 김영희',
      '신한10/31 20:05 입금 100,000,001 김영희',
    ]
    await statuses(world, token, texts.map((text, i) => sms(`k${String(i)}`, SHINHAN, text)))
    await statuses(world, token, [app('ka', SHINHAN_APP, '입금취소 14,000원', '김영희'), app('kb', SHINHAN_APP, '입금 취소', '14,000원 김영희')])
    expect(await allDeposits(world, seller)).toEqual([])
    expect(await payments(world, seller)).toBe(0)
  })

  it('믿지 않는 곳의 출금·입금 취소·읽지 못함은 은행 알림 줄도 잔액 기록도 남기지 않는다', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(
      await statuses(world, token, [
        sms('x1', '1600-0000', '입금취소 14,000 김영희 잔액 1,000'),
        sms('x2', '1600-0000', '입금 14,000 출금 14,000'),
        app('x3', 'com.kakao.talk', '입금취소', '14,000원 김영희'),
        app('x4', 'com.kakao.talk', '출금 5,000', '잔액 100'),
      ]),
    ).toEqual(['IGNORED', 'IGNORED', 'IGNORED', 'IGNORED'])
    const alerts = (await expectOk(client(world, seller.cookie).get('/api/deposits/alerts'))).body.alerts as unknown[]
    expect(alerts).toEqual([])
    expect(await balancesOf(world.database.db, seller.sellerId)).toEqual([])
    expect(await allDeposits(world, seller)).toEqual([])
  })

  it('입금 취소 알림 뒤에도 이미 자동 확인된 입금은 그대로 (자동 되돌리기 없음 — 판매자가 DP-6 되돌리기로)', async () => {
    const { world, seller, token } = await soldToYounghee()
    expect(await statuses(world, token, [sms('d', SHINHAN, notice('20:05', '14,000', '1,028,000'))])).toEqual(['SAVED'])
    const before = (await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).seq
    expect(await statuses(world, token, [sms('c', SHINHAN, '신한10/31 20:07 입금취소 14,000 잔액 1,014,000 김영희')])).toEqual(['SAVED'])
    expect((await world.server.writer.read(seller.sellerId, SMS3_DAY, false)).seq).toBe(before)
    expect(await list(world, seller, 'AUTO_APPLIED')).toHaveLength(1)
  })
})

describe('본문·번호·토큰이 DB·로그 어디에도 없다 (DP-INV-8, C-07)', () => {
  it('여러 갈래(문자찜·카드·취소 요청·입금·출금·입금 취소·읽지 못함·믿지 않는 곳·거름·찜 아님)와 오류 길(400·413·429) 뒤 DB 덤프·로그 전체에 없다', async () => {
    const { world, seller, token } = await inboxWorld({ rateLimit: 40 })
    const sale = await liveSale(world, seller, [15, 16, 17])
    const secrets = {
      mobileA: '010-4321-8765',
      mobileB: '01055557777',
      mobileC: '+82 10-6666-1212',
      cardText: '16 있나요 비밀카드글QX',
      cancelText: '15 취소 부탁드려요 비밀취소글QZ',
      skipText: '(광고) 비밀광고글QW 17',
      noneText: '안녕하세요 비밀인사글QV',
      title: '비밀제목QT9 신한', // 숫자가 든 토큰은 입금자명이 되지 않는다(DP-9 7) — 이름 칸에 들어가는 것은 본문 저장이 아니다
      bankTail: 'MEMOQR77',
      badBody: '비밀오류글QB',
    }
    await statuses(world, token, [
      sms('p1', secrets.mobileA, '15 홍길동'),
      sms('p2', secrets.mobileB, secrets.cardText),
      sms('p3', secrets.mobileA, secrets.cancelText),
      sms('p4', secrets.mobileC, secrets.skipText),
      sms('p5', secrets.mobileC, secrets.noneText),
      sms('p6', SHINHAN, `신한10/31 20:05 입금 14,000 잔액 1,028,000 홍길동 ${secrets.bankTail}`),
      app('p7', SHINHAN_APP, secrets.title, `출금 5,000 잔액 1,023,000 ${secrets.bankTail}`),
      app('p8', 'com.kakaobank.channel', secrets.title, `입금취소 14,000원 ${secrets.bankTail}`),
      sms('p9', '1588-9999', `입금 14,000 출금 1 ${secrets.bankTail}`),
      sms('p10', '1600-0000', `입금 9,000 ${secrets.bankTail} 잔액 1`),
      sms('p11', '홍길동', `16 ${secrets.bankTail}`),
    ])
    // 오류 길: 모양 틀림(400) · 너무 큼(413) · 한도(429) — 본문에 비밀을 담는다
    const bad = await sendRaw(world, token, JSON.stringify({ device: '폰', messages: [{ id: 'b1', channel: 'MMS', from: secrets.mobileA, title: null, text: secrets.badBody, receivedAt: null }] }))
    expect(bad.status).toBe(400)
    expect(bad.text).not.toContain(secrets.badBody)
    const big = await sendRaw(world, token, JSON.stringify({ device: '폰', messages: [sms('b2', secrets.mobileA, `${secrets.badBody}${'가'.repeat(300_000)}`)] }))
    expect(big.status).toBe(413)
    const many = await send(world, token, Array.from({ length: 20 }, (_, i) => sms(`r${String(i)}`, secrets.mobileA, `${secrets.badBody} ${String(i)}`)))
    const many2 = await send(world, token, Array.from({ length: 20 }, (_, i) => sms(`s${String(i)}`, secrets.mobileA, `${secrets.badBody} ${String(i)}`)))
    expect([many.status, many2.status]).toContain(429)
    expect(many2.text).not.toContain(secrets.badBody)
    // 카드는 화면에 보여야 한다(암호화 저장 — 평문은 DB에 없다)
    expect((await expectOk(client(world, seller.cookie).get(`/api/inbox/cards?b=${sale.id}`))).text).toContain('비밀카드글QX')
    const dump = await dumpAllTables(world.database)
    const logs = JSON.stringify(world.logs)
    const forbidden = [
      token,
      '01043218765',
      '010-4321-8765',
      '43218765',
      '01055557777',
      '55557777',
      '01066661212',
      '+82 10-6666-1212',
      '66661212',
      '비밀카드글QX',
      '비밀취소글QZ',
      '비밀광고글QW',
      '비밀인사글QV',
      '비밀제목QT',
      'MEMOQR77',
      '비밀오류글QB',
      '부탁드려요',
    ]
    for (const secret of forbidden) {
      expect(dump.includes(secret), `DB에 ${secret}`).toBe(false)
      expect(logs.includes(secret), `로그에 ${secret}`).toBe(false)
    }
    // 은행 알림·입금 표에는 은행 알림 본문 칸이 없다
    const pg = world.database.pglite as unknown as { query: <T>(sql: string) => Promise<{ rows: T[] }> }
    const columns = await pg.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('bank_alerts','bank_balances') order by 1, 2`,
    )
    expect(columns.rows.filter((row) => /text|body|title|raw/.test(row.column_name))).toEqual([])
    // 문자찜은 들어갔다(시험이 헛돌지 않았다)
    expect((await claimsOf(world, seller)).length).toBeGreaterThan(0)
  })

  it('기기 이름에 휴대폰 번호·스크립트를 넣어도 로그엔 없다', async () => {
    const { world, seller, token } = await inboxWorld()
    await liveSale(world, seller, [15])
    const response = await send(world, token, [sms('dv', '010-1234-5678', '15')], '<b>010-9876-5432</b>')
    expect(response.status).toBe(200)
    expect(JSON.stringify(world.logs)).not.toContain('9876')
  })
})
