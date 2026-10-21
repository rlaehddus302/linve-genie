// N5 적대 테스트 (test-domain): 개인정보·비밀값, 스위치 꺼짐, 운영 기동 거부, 재생 무결성 검사 (AC-N5-11·21·26·37·39, BL-0 7·BL-8 2·BL-6 8).
// - 데이터베이스 평문 검사(사업자등록번호 10자리·상호·대표자·이메일), 로그 모으기(비밀값·사업자 정보·조회 원문), 응답·실시간에는 가린 번호만
// - 이상한 글(제어 글자·아주 긴 글·수식 모양 `=`)
// - 꺼진 서버: 요금 경로 404(서명이 맞는 웹훅도), 쓴 기록 0 / 켠 뒤에도 그 전 방송은 세지 않음
// - 운영 기동 거부(자리 표시 요금 표·빈 포트원 설정·틀린 요금 표) — 문장에 비밀값이 없다
// - 재생 무결성 검사가 지운·더한 쓴 기록을 찾는다
// 지금은 모두 통과한다(회귀로 남긴다).
import { describe, expect, it } from 'vitest'
import { TEST_API_SECRET, TEST_WEBHOOK_SECRET, checkReplay, readBillingEnv, signedWebhook, testBilling } from '@livejjim/server'
import { dumpAll } from '../s04/helpers.ts'
import { printer } from '../i1/helpers.ts'
import { api, billingHarness, buy, call, rid, rows } from './helpers.ts'

const DAY = '2026-10-18'

describe('개인정보·비밀값 (AC-N5-37·39)', () => {
  it('결제·웹훅·환불·증빙·사업자 정보 흐름 뒤: DB·로그에 사업자등록번호·상호·대표자·이메일·비밀값 평문이 없고, 응답·실시간에는 가린 번호만', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('privacy1')
      const s = api(h, a)
      const shopName = '초록별다육농장상회'
      const ceo = '홍대표님이름'
      const email = 'secret.owner.mail@example.kr'
      const saved = await s.business({ businessNumber: '123 45 67891', name: shopName, ceo, email, receiptKind: 'CASH_RECEIPT' })
      expect(saved.status, saved.text).toBe(200)
      expect(saved.body).toMatchObject({ masked: '123-45-*****', name: shopName, ceo, email, receiptKind: 'CASH_RECEIPT', complete: true })
      const stream = await h.server.app.request('/api/stream', { headers: { Cookie: a.cookie } })
      const reader = stream.body?.getReader()
      const paid = await buy(h, a, 'days-10', 'TRANSFER')
      const created = await s.order('flat-30', 'TRANSFER')
      const id = created.body.paymentId as string
      h.test.portone.pay(id, created.body.amount as number, 'TRANSFER')
      await h.server.app.request('/api/billing/webhook', { method: 'POST', ...(() => {
        const w = signedWebhook(TEST_WEBHOOK_SECRET, id, h.clock.now())
        return { headers: w.headers, body: w.body }
      })() })
      expect((await s.refund(paid)).status).toBe(200)
      // 실패한 사업자 정보 저장(틀린 번호)도 로그에 값을 남기지 않는다
      expect((await s.business({ businessNumber: '1234567890' })).status).toBe(400)
      // 실시간 알림 몇 개를 읽는다
      let sse = ''
      if (reader !== undefined) {
        const deadline = Date.now() + 300
        while (Date.now() < deadline) {
          const chunk = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 100))])
          if (chunk === null || chunk.done) break
          sse += new TextDecoder().decode(chunk.value)
        }
        await reader.cancel()
      }
      const db = await dumpAll(h.database)
      const logs = JSON.stringify(h.logs)
      for (const secret of ['1234567891', '123-45-67891', '45-67891', shopName, ceo, email, TEST_API_SECRET, TEST_WEBHOOK_SECRET]) {
        expect(db.includes(secret), `DB에 평문: ${secret}`).toBe(false)
        expect(logs.includes(secret), `로그에: ${secret}`).toBe(false)
        expect(sse.includes(secret), `실시간에: ${secret}`).toBe(false)
      }
      // 결제 조회 원문(가짜 결제 서버 응답 칸)도 로그에 없다
      expect(logs).not.toContain('pgProvider')
      expect(logs).not.toContain('TOSSPAYMENTS')
      // 결제 내역·상태 응답에는 번호가 가려져 있다
      const all = JSON.stringify([await s.status(), (await s.payments()).body, (await s.usage()).body])
      expect(all).not.toContain('45-67891')
      expect(all).not.toContain('1234567891')
      expect(all).toContain('123-45-*****')
    } finally {
      await h.close()
    }
  })

  it('이상한 글: 수식 모양(=SUM)·이모지 50자 상호는 받고, 제어 글자·51자·줄바꿈은 거절, 받은 값을 오류에 되돌려 보내지 않는다', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('privacy2')
      const s = api(h, a)
      const formula = '=HYPERLINK("http://x","다육")'
      expect((await s.business({ name: formula, ceo: '+김대표' })).body).toMatchObject({ name: formula, ceo: '+김대표' })
      const emoji = '🌵'.repeat(50)
      expect((await s.business({ name: emoji })).status).toBe(200)
      for (const bad of [{ name: '🌵'.repeat(51) }, { name: '가게\n이름' }, { ceo: '김\u0007대표' }, { email: 'a@b\u0000.kr' }, { email: 'no-at-sign' }, { businessNumber: '１２３４５６７８９１' }]) {
        const r = await s.business(bad)
        expect(r.status, JSON.stringify(bad)).toBe(400)
        for (const value of Object.values(bad)) expect(r.text.includes(value), `오류에 받은 값이 섞임: ${r.text}`).toBe(false)
      }
      // 실패한 저장은 기존 값을 바꾸지 않는다
      expect((await s.status()).business).toMatchObject({ name: emoji })
    } finally {
      await h.close()
    }
  })
})

describe('스위치 꺼짐 (AC-N5-11·21, BL-0 7)', () => {
  it('꺼진 서버: 요금 경로 404(서명 맞는 웹훅도 세션 없이 404), 이용권 없이 시작·판매·라벨, 쓴 기록·이용 방식 0 — 켠 뒤에도 그 전 방송은 세지 않는다', async () => {
    const setup = testBilling({ enabled: false })
    const h = await billingHarness({}, setup)
    try {
      const a = await h.account('switch1')
      const s = api(h, a)
      for (const [method, path] of [
        ['GET', '/api/billing'],
        ['GET', '/api/billing/payments'],
        ['PUT', '/api/billing/business'],
        ['POST', '/api/billing/orders'],
        ['POST', '/api/billing/test/grants'],
        ['PUT', '/api/billing/test/gateway'],
      ] as const) {
        expect((await call(h.server, a.cookie, method, path, method === 'GET' ? undefined : { requestId: rid('x') })).status, path).toBe(404)
      }
      const w = signedWebhook(TEST_WEBHOOK_SECRET, 'lj' + '1'.repeat(32), h.clock.now())
      expect((await h.server.app.request('/api/billing/webhook', { method: 'POST', headers: w.headers, body: w.body })).status).toBe(404)
      const cfg = await call(h.server, a.cookie, 'GET', '/api/client-config')
      expect(cfg.body.billing).toEqual({ enabled: false, testPayment: false })
      const started = await s.start({ date: DAY })
      expect(started.status, started.text).toBe(200)
      expect(started.body).not.toHaveProperty('billing')
      const b = (started.body.broadcast as { id: string }).id
      expect((await s.event({ type: 'product.register', b, no: 1, name: '라울', price: 5000 })).status).toBe(200)
      await h.server.ingestChat(a.sellerId, { b, id: 'sw-1', ch: 'UC_s1', nick: '손님', text: '1' })
      const p = printer(h, a.cookie)
      await p.become()
      expect(await p.printOne()).not.toBeNull()
      expect((await rows<{ n: number }>(h, 'select (select count(*) from billing_usage)::int + (select count(*) from billing_modes)::int as n'))[0]?.n).toBe(0)

      // 켠다 (같은 DB, 새 인스턴스): 그 전 방송의 새 1등·출력은 세지 않는다
      h.server.close()
      h.server = h.restart({ billing: testBilling({ enabled: true }) })
      await h.server.billing.grantByOperator(a.sellerId, { kind: 'ORDERS', quantity: 5, reason: '시험' })
      expect((await s.event({ type: 'product.register', b, no: 2, name: '핑크', price: 5000 })).status).toBe(200)
      await h.server.ingestChat(a.sellerId, { b, id: 'sw-2', ch: 'UC_s2', nick: '손님2', text: '2' })
      const p2 = printer(h, a.cookie)
      await p2.become()
      await p2.printOne()
      expect(await rows(h, 'select key from billing_usage')).toEqual([])
      const checks = await checkReplay(h.database.db, { sellerId: a.sellerId })
      for (const check of checks) expect(check.billing).toEqual([])
    } finally {
      await h.close()
    }
  })
})

describe('운영 기동 거부 (AC-N5-11)', () => {
  const full = { LIVEJJIM_BILLING: 'on', PORTONE_STORE_ID: 'store-real', PORTONE_CHANNEL_KEY: 'channel-real', PORTONE_API_SECRET: 'api-SECRET-xyz', PORTONE_WEBHOOK_SECRET: 'whsec_c2VjcmV0LXZhbHVl' }
  const table = (items: unknown[], placeholder?: boolean) => JSON.stringify({ ...(placeholder === undefined ? {} : { placeholder }), items })
  const good = [{ id: 'flat-30', name: '정액제 30일', kind: 'FLAT_30D', price: 33000 }]

  it('켰는데 요금 표가 자리 표시(기본 표 포함)·포트원 값 하나라도 빈칸·공백이면 거부, 문장에 비밀값이 없다', () => {
    const r1 = readBillingEnv(full)
    expect(r1).toMatchObject({ ok: false, message: '요금 표가 자리 표시 값이에요. 운영 가격을 정한 뒤 켜 주세요.' })
    const env = { ...full, LIVEJJIM_BILLING_PRICES: '/prices.json' }
    const read = () => table(good)
    expect(readBillingEnv(env, read)).toMatchObject({ ok: true })
    for (const key of ['PORTONE_STORE_ID', 'PORTONE_CHANNEL_KEY', 'PORTONE_API_SECRET', 'PORTONE_WEBHOOK_SECRET']) {
      for (const blank of [undefined, '', '   ']) {
        const r = readBillingEnv({ ...env, [key]: blank }, read)
        expect(r, `${key}=${String(blank)}`).toMatchObject({ ok: false, message: '결제 설정이 비어 있어 요금 기능을 켤 수 없어요.' })
      }
    }
    expect(readBillingEnv({ ...env }, () => table(good, true))).toMatchObject({ ok: false })
    // 꺼져 있으면 포트원 값이 없어도 기동한다
    expect(readBillingEnv({ LIVEJJIM_BILLING: 'off' })).toMatchObject({ ok: true })
    expect(readBillingEnv({})).toMatchObject({ ok: true, billing: { enabled: false } })
  })

  it('틀린 요금 표는 꺼져 있어도 거부: 중복 ID·가격 범위·정량 양 없음·정액에 양·모르는 종류·소수 가격 — 받은 값·비밀값을 문장에 넣지 않는다', () => {
    const cases: unknown[][] = [
      [...good, { id: 'flat-30', name: '또', kind: 'FLAT_30D', price: 1000 }],
      [{ id: 'days-1', name: '일권', kind: 'DAYS', quantity: 1, price: 99 }],
      [{ id: 'days-1', name: '일권', kind: 'DAYS', quantity: 1, price: 10_000_001 }],
      [{ id: 'days-1', name: '일권', kind: 'DAYS', price: 5000 }],
      [{ id: 'flat', name: '정액', kind: 'FLAT_30D', quantity: 1, price: 5000 }],
      [{ id: 'x', name: '이상한', kind: 'POINTS', quantity: 1, price: 5000 }],
      [{ id: 'days-1', name: '일권', kind: 'DAYS', quantity: 1, price: 5000.5 }],
      [{ id: 'Days_1', name: '일권', kind: 'DAYS', quantity: 1, price: 5000 }],
      [{ id: 'days-1', name: '일권', kind: 'DAYS', quantity: 0, price: 5000 }],
    ]
    for (const items of cases) {
      for (const sw of ['on', 'off']) {
        const r = readBillingEnv({ ...full, LIVEJJIM_BILLING: sw, LIVEJJIM_BILLING_PRICES: '/p.json' }, () => table(items))
        expect(r.ok, JSON.stringify(items)).toBe(false)
        if (!r.ok) {
          expect(r.message.startsWith('요금 표를 확인해 주세요.'), r.message).toBe(true)
          expect(r.message).not.toContain('api-SECRET-xyz')
          expect(r.message).not.toContain('POINTS')
        }
      }
    }
    expect(readBillingEnv({ LIVEJJIM_BILLING: 'yes' })).toMatchObject({ ok: false })
  })
})

describe('재생 무결성 검사의 요금 대조 (AC-N5-26)', () => {
  it('주문 건 쓴 기록을 지우거나 리허설 방송에 쓴 기록을 더하면 그 키를 알리고 실패한다(고치지 않는다)', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('replay1')
      const s = api(h, a)
      await h.server.billing.grantByOperator(a.sellerId, { kind: 'ORDERS', quantity: 2, reason: '시험' })
      const started = await s.start({ date: DAY })
      expect(started.body.billing).toEqual({ mode: 'ORDERS', usedDay: false })
      const b = (started.body.broadcast as { id: string }).id
      for (const no of [1, 2, 3]) expect((await s.event({ type: 'product.register', b, no, name: `품종${String(no)}`, price: 5000 })).status).toBe(200)
      for (const no of [1, 2, 3]) await h.server.ingestChat(a.sellerId, { b, id: `rp-${String(no)}`, ch: `UC_r${String(no)}`, nick: '손님', text: String(no) })
      expect((await s.status()).balances).toMatchObject({ ORDERS: -1 })
      expect((await s.status()).banners).toContainEqual({ kind: 'ORDERS_OVER', count: 1 })
      const ok = await checkReplay(h.database.db, { sellerId: a.sellerId })
      expect(ok.every((c) => c.ok && c.billing.length === 0)).toBe(true)
      const [victim] = await rows<{ key: string }>(h, `select key from billing_usage where kind = 'ORDERS' order by key limit 1`)
      await rows(h, 'delete from billing_usage where key = $1', [victim?.key])
      const broken = await checkReplay(h.database.db, { sellerId: a.sellerId })
      const real = broken.find((c) => !c.rehearsal)
      expect(real?.ok).toBe(false)
      expect(real?.billing).toContain(victim?.key)
      // 고치지 않는다
      expect((await rows(h, 'select key from billing_usage where key = $1', [victim?.key])).length).toBe(0)
    } finally {
      await h.close()
    }
  })
})
