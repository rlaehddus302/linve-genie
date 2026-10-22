// N5 적대 테스트 (test-domain): 결제·환불·웹훅 공격 (AC-N5-10·25·31~36·41, BL-6·BL-7, BL-INV-1·5·8).
// 다른 판매자 결제 ID, 확인 요청에 금액·상태 끼워 넣기, 서명 위조·옛 시각·다른 비밀값·본문 바꾼 웹훅, 같은 결제 동시 스무 번,
// 금액 다른 결제 + 취소 실패, 조회가 멈춘 동안 판매 쓰기, 환불과 방송 시작 동시, 환불 두 번 동시, 충전·넘기기·출금 경로 찾기.
// 지금은 모두 통과한다(회귀로 남긴다).
import { describe, expect, it } from 'vitest'
import { TEST_WEBHOOK_SECRET, signWebhook, signedWebhook, testBilling, type LookupResult, type PaymentGateway } from '@livejjim/server'
import { D, api, billingHarness, buy, call, rid, rows, type BillingHarness } from './helpers.ts'

const DAY = '2026-10-18'

async function webhook(h: BillingHarness, signed: { body: string; headers: Record<string, string> }) {
  const res = await h.server.app.request('/api/billing/webhook', { method: 'POST', headers: signed.headers, body: signed.body })
  return { status: res.status, text: await res.text() }
}

describe('결제 공격 (AC-N5-10·31·32·34, BL-INV-1·8)', () => {
  it('다른 판매자의 결제 ID로 확인·환불·시험 조작 → 없는 결제와 같은 404, 그 판매자 주문은 그대로', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('payatk1')
      const b = await h.account('payatk2')
      const paid = await buy(h, a, 'days-1')
      const pending = await api(h, a).order('days-10')
      const pendingId = pending.body.paymentId as string
      const ghost = 'lj' + '0'.repeat(32)
      for (const id of [paid, pendingId]) {
        const confirmed = await api(h, b).confirm(id)
        const missing = await api(h, b).confirm(ghost)
        expect(confirmed.status).toBe(404)
        expect(confirmed.text).toBe(missing.text)
        expect((await api(h, b).refund(id)).status).toBe(404)
        expect((await call(h.server, b.cookie, 'POST', `/api/billing/test/payments/${id}`, { action: 'PAID' })).status).toBe(404)
        expect((await call(h.server, b.cookie, 'POST', `/api/billing/test/payments/${id}/webhook`, {})).status).toBe(404)
      }
      expect(((await api(h, b).payments()).body.items as unknown[]).length).toBe(0)
      expect((await api(h, b).status()).balances).toEqual({ DAYS: 0, ORDERS: 0, LABELS: 0 })
      const states = await rows<{ state: string }>(h, 'select state from billing_orders where payment_id = $1', [pendingId])
      expect(states[0]?.state).toBe('PENDING')
    } finally {
      await h.close()
    }
  })

  it('확인 요청에 금액·상태를 끼워 넣으면 400이고 조회도 하지 않는다. 결제 창이 돌려준 값은 판단에 쓰이지 않는다', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('payatk3')
      const s = api(h, a)
      expect((await s.business()).status).toBe(200)
      const created = await s.order('flat-30')
      const id = created.body.paymentId as string
      const lookups = h.test.portone.lookups
      for (const extra of [{ amount: 30000 }, { state: 'PAID' }, { status: 'PAID' }, { paymentId: id }, { txId: 'x' }]) {
        const r = await s.confirm(id, extra)
        expect(r.status, r.text).toBe(400)
        expect((r.body.error as { code: string }).code).toBe('UNKNOWN_FIELD')
      }
      expect(h.test.portone.lookups).toBe(lookups)
      // 결제 창이 "성공"이라 했어도 결제 서버가 결제 없음이면 기다림이고 이용권은 없다
      const r = await call(h.server, a.cookie, 'POST', `/api/billing/orders/${id}/confirm?amount=30000&status=PAID&paymentStatus=PAID`, { requestId: rid('cf') })
      expect(r.body.result).toBe('WAIT')
      expect((await s.status()).flat).toMatchObject({ active: false })
    } finally {
      await h.close()
    }
  })

  it('웹훅 위조: 다른 비밀값·옛 시각(5분 1초)·서명 뒤 본문 바꿈·다른 결제 ID의 서명 → 400, 기록·조회 없음', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('payatk4')
      const s = api(h, a)
      expect((await s.business()).status).toBe(200)
      const created = await s.order('flat-30')
      const id = created.body.paymentId as string
      h.test.portone.pay(id, created.body.amount as number, 'CARD')
      const lookups = h.test.portone.lookups
      const now = h.clock.now()
      const other = `whsec_${Buffer.from('attacker-guess-secret').toString('base64')}`
      expect((await webhook(h, signedWebhook(other, id, now))).status).toBe(400)
      expect((await webhook(h, signedWebhook(TEST_WEBHOOK_SECRET, id, now - 5 * 60_000 - 1000))).status).toBe(400)
      expect((await webhook(h, signedWebhook(TEST_WEBHOOK_SECRET, id, now + 5 * 60_000 + 1000))).status).toBe(400)
      const genuine = signedWebhook(TEST_WEBHOOK_SECRET, 'lj' + 'f'.repeat(32), now)
      // 서명은 남의(모르는) 결제 ID 본문에 했는데 본문만 이 결제 ID로 바꿈
      expect((await webhook(h, { headers: genuine.headers, body: genuine.body.replace('lj' + 'f'.repeat(32), id) })).status).toBe(400)
      // 서명 머리말을 다른 본문의 서명으로 바꿔 끼움
      const mine = signedWebhook(TEST_WEBHOOK_SECRET, id, now)
      expect((await webhook(h, { body: mine.body, headers: { ...mine.headers, 'webhook-signature': genuine.headers['webhook-signature'] ?? '' } })).status).toBe(400)
      // 시각 머리말만 바꿈 (서명은 옛 시각으로)
      const ts = String(Math.floor(now / 1000) + 1)
      expect((await webhook(h, { body: mine.body, headers: { ...mine.headers, 'webhook-timestamp': ts } })).status).toBe(400)
      // 서명 없음·빈 서명·v2 서명
      expect((await webhook(h, { body: mine.body, headers: { ...mine.headers, 'webhook-signature': '' } })).status).toBe(400)
      const v2 = `v2,${(mine.headers['webhook-signature'] ?? '').slice(3)}`
      expect((await webhook(h, { body: mine.body, headers: { ...mine.headers, 'webhook-signature': v2 } })).status).toBe(400)
      expect(h.test.portone.lookups).toBe(lookups)
      expect((await rows<{ n: number }>(h, 'select count(*)::int as n from billing_grants'))[0]?.n).toBe(0)
      // 진짜 서명은 받는다 (서명 여러 개 중 하나만 맞아도) — 응답에 내부 상태가 없다
      const ok = await webhook(h, { body: mine.body, headers: { ...mine.headers, 'webhook-signature': `v1,AAAA ${mine.headers['webhook-signature'] ?? ''}` } })
      expect(ok.status).toBe(200)
      expect(JSON.parse(ok.text)).toEqual({ ok: true })
      expect((await s.status()).flat).toMatchObject({ active: true })
      // 같은 웹훅을 다시 받아도 한 번 (같은 id·시각 재전송)
      expect((await webhook(h, mine)).status).toBe(200)
      expect((await rows<{ n: number }>(h, 'select count(*)::int as n from billing_grants'))[0]?.n).toBe(1)
      // 서명 문자열 모양 확인 (Standard Webhooks v1)
      expect(signWebhook(TEST_WEBHOOK_SECRET, 'msg', 1, '{}')).toMatch(/^v1,[A-Za-z0-9+/]+=*$/)
    } finally {
      await h.close()
    }
  })

  it('같은 계좌이체 결제의 확인 열 번·웹훅 열 번이 동시에 와도 이용권 하나·증빙 하나 (BL-INV-1)', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('payatk5')
      const s = api(h, a)
      expect((await s.business()).status).toBe(200)
      const created = await s.order('days-10', 'TRANSFER')
      const id = created.body.paymentId as string
      h.test.portone.pay(id, created.body.amount as number, 'TRANSFER')
      const now = h.clock.now()
      const jobs: Promise<unknown>[] = []
      for (let i = 0; i < 10; i++) {
        jobs.push(s.confirm(id))
        jobs.push(webhook(h, signedWebhook(TEST_WEBHOOK_SECRET, id, now + i)))
      }
      await Promise.all(jobs)
      expect((await rows<{ n: number }>(h, 'select count(*)::int as n from billing_grants where payment_id = $1', [id]))[0]?.n).toBe(1)
      expect((await rows<{ n: number }>(h, 'select count(*)::int as n from billing_documents where payment_id = $1', [id]))[0]?.n).toBe(1)
      expect(h.test.issuer.issued.filter((x) => x.paymentId === id)).toHaveLength(1)
      expect((await s.status()).balances).toMatchObject({ DAYS: 10 })
    } finally {
      await h.close()
    }
  })

  it('금액이 다른 결제 + 취소 실패 → 확인 필요, 다시 확인·웹훅이 와도 취소는 한 번만 요청하고 이용권은 없다', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('payatk6')
      const s = api(h, a)
      expect((await s.business()).status).toBe(200)
      const created = await s.order('orders-500', 'TRANSFER')
      const id = created.body.paymentId as string
      h.test.portone.pay(id, (created.body.amount as number) - 1, 'TRANSFER')
      h.test.portone.cancelFailure = true
      const first = await s.confirm(id)
      expect(first.body).toMatchObject({ result: 'CANCEL_MISMATCH', state: 'NEEDS_REVIEW' })
      h.test.portone.cancelFailure = false
      await Promise.all([s.confirm(id), s.confirm(id), webhook(h, signedWebhook(TEST_WEBHOOK_SECRET, id, h.clock.now()))])
      expect(h.test.portone.cancelCalls.get(id)).toBe(1)
      expect((await s.status()).balances).toMatchObject({ ORDERS: 0 })
      expect((await rows<{ n: number }>(h, 'select count(*)::int as n from billing_documents'))[0]?.n).toBe(0)
    } finally {
      await h.close()
    }
  })
})

describe('환불 공격 (AC-N5-25·36, BL-7 4, BL-INV-5)', () => {
  it('하나뿐인 방송 일권의 환불과 새 실제 방송 시작이 동시면 둘 중 하나만 된다 — 환불한 이용권으로 시작하지 않고 쓴 이용권을 환불하지 않는다', async () => {
    for (let round = 0; round < 6; round++) {
      const h = await billingHarness()
      try {
        const a = await h.account(`payrace${String(round)}`)
        const s = api(h, a)
        const paid = await buy(h, a, 'days-1')
        const order = round % 2 === 0 ? [s.refund(paid), s.start({ date: DAY })] : [s.start({ date: DAY }), s.refund(paid)]
        const [x, y] = await Promise.all(order)
        const refund = round % 2 === 0 ? x : y
        const start = round % 2 === 0 ? y : x
        const both = [refund?.status, start?.status]
        expect(both, `${refund?.text ?? ''}\n${start?.text ?? ''}`).not.toEqual([200, 200])
        expect(both.filter((v) => v === 200)).toHaveLength(1)
        const st = await s.status()
        if (refund?.status === 200) {
          expect(start?.status).toBe(422)
          expect(st.balances).toMatchObject({ DAYS: 0 })
          expect((await rows<{ n: number }>(h, `select count(*)::int as n from billing_usage`))[0]?.n).toBe(0)
        } else {
          expect(start?.body.billing).toEqual({ mode: 'DAY', usedDay: true })
          expect((await rows<{ n: number }>(h, `select count(*)::int as n from billing_revocations`))[0]?.n).toBe(0)
        }
      } finally {
        await h.close()
      }
    }
  })

  it('환불 두 번 동시(다른 요청 번호)·같은 요청 번호 재전송 → 결제 취소는 한 번, 회수 하나', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('payatk7')
      const s = api(h, a)
      const paid = await buy(h, a, 'flat-30', 'TRANSFER')
      const results = await Promise.all([s.refund(paid), s.refund(paid), s.refund(paid, 'same-refund'), s.refund(paid, 'same-refund')])
      expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1)
      for (const r of results) expect([200, 409], r.text).toContain(r.status)
      expect(h.test.portone.cancelCalls.get(paid)).toBe(1)
      expect((await rows<{ n: number }>(h, 'select count(*)::int as n from billing_revocations'))[0]?.n).toBe(1)
      // 재전송은 처음 결과
      const again = await s.refund(paid, 'same-refund')
      if (results[2]?.status === 200) expect(again.body).toEqual(results[2].body)
      expect(h.test.portone.cancelCalls.get(paid)).toBe(1)
      expect((await s.status()).flat).toMatchObject({ active: false, chain: [] })
    } finally {
      await h.close()
    }
  })

  it('7일 경계: 부여 뒤 7×24시간 − 1ms는 환불, 정확히 7×24시간은 거절 (BL-7 1)', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('payatk8')
      const s = api(h, a)
      const p1 = await buy(h, a, 'labels-100')
      const p2 = await buy(h, a, 'labels-500')
      h.clock.t += 7 * D - 1
      a.cookie = await h.login(a.loginId)
      expect((await s.refund(p1)).status).toBe(200)
      h.clock.t += 1
      a.cookie = await h.login(a.loginId)
      const late = await s.refund(p2)
      expect(late.status).toBe(409)
      expect((late.body.error as { code: string }).code).toBe('REFUND_NOT_ALLOWED')
    } finally {
      await h.close()
    }
  })
})

describe('조회가 멈춰도 판매는 늦지 않는다 (AC-N5-25·35, BL-6 7)', () => {
  it('한 판매자의 결제 조회가 응답하지 않는 동안 같은 판매자·다른 판매자의 방송 시작·채팅·문자찜이 끝난다', async () => {
    let release: (value: LookupResult) => void = () => undefined
    const stuck = new Promise<LookupResult>((resolve) => {
      release = resolve
    })
    const base = testBilling()
    const gateway: PaymentGateway = { lookup: () => stuck, cancel: (id, reason) => base.gateway.cancel(id, reason) }
    const h = await billingHarness({}, { ...base, gateway })
    try {
      const a = await h.account('stall1')
      const b = await h.account('stall2')
      await h.server.billing.grantByOperator(a.sellerId, { kind: 'FLAT_30D', quantity: null, reason: '시험' })
      await h.server.billing.grantByOperator(b.sellerId, { kind: 'DAYS', quantity: 1, reason: '시험' })
      const sa = api(h, a)
      expect((await sa.business()).status).toBe(200)
      const created = await sa.order('days-1')
      let settled = false
      const pendingConfirm = sa.confirm(created.body.paymentId as string).then((r) => {
        settled = true
        return r
      })
      const timeout = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('판매 쓰기가 결제 조회를 기다렸다')), 5000))])
      const startA = await timeout(sa.start({ date: DAY }))
      expect(startA.status, startA.text).toBe(200)
      const bA = (startA.body.broadcast as { id: string }).id
      expect((await timeout(sa.event({ type: 'product.register', b: bA, no: 1, name: '라울', price: 5000 }))).status).toBe(200)
      expect((await timeout(h.server.ingestChat(a.sellerId, { b: bA, id: 'stall-c1', ch: 'UC_x1', nick: '손님', text: '1' }))).status).toBe('recorded')
      expect((await timeout(sa.event({ type: 'sms', b: bA, no: 1, received: '20:01' }))).status).toBe(200)
      const startB = await timeout(api(h, b).start({ date: DAY }))
      expect(startB.status, startB.text).toBe(200)
      expect(settled).toBe(false)
      release({ kind: 'error' })
      const confirmed = await pendingConfirm
      expect(confirmed.body.result).toBe('LOOKUP_FAILED')
    } finally {
      release({ kind: 'error' })
      await h.close()
    }
  })
})

describe('충전금·넘기기·출금 경로가 없다 (AC-N5-41, BL-0 3)', () => {
  it('충전·포인트·잔액·넘기기·출금·계좌 환불 같은 경로는 404이고, 요금 경로는 정해진 것뿐이다', async () => {
    const h = await billingHarness()
    try {
      const a = await h.account('nocharge')
      for (const path of ['charge', 'topup', 'points', 'balance', 'transfer', 'gift', 'withdraw', 'payout', 'cash', 'wallet', 'grants', 'orders/x/partial-refund']) {
        for (const method of ['GET', 'POST']) {
          const r = await call(h.server, a.cookie, method, `/api/billing/${path}`, method === 'POST' ? { requestId: rid('x') } : undefined)
          expect([404, 405], `${method} ${path} ${r.text}`).toContain(r.status)
        }
      }
    } finally {
      await h.close()
    }
  })
})
