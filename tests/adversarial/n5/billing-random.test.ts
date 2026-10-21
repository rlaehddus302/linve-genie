// N5 적대 테스트 (test-domain): 요금 기능을 켠 서버에 무작위 처리 열을 넣고 매 단계 불변식을 본다 (AC-N5-20~27·31·34·36, BL-INV-1~6).
// 섞는 것: 운영자 부여, 결제(완료·실패·금액 바꿈·조회 실패·웹훅 중복), 7일 환불, 실제·리허설 방송 시작(지난 날짜 포함·같은 요청 재전송),
// 상품 등록·채팅·문자찜(끝낸 뒤 늦은 문자찜 포함)·번호 변경·방송 끝, 라벨 출력, 서버 재시작, 주입 시계로 1시간·24시간·7일·30일 넘기기.
// 매 단계: 시작 응답 = 직전 미리 보기(BL-4 6), 거절은 새 실제 방송 시작의 NO_PASS뿐(BL-0 1), 환불 성공 ⇔ 직전 결제 내역의 "환불할 수 있는지"(BL-7 1),
// 결제 ID당 이용권·증빙 하나(BL-INV-1), 방송 일 창이 겹치지 않음(BL-INV-2), 리허설·이용 방식 없는 방송의 쓴 기록 없음(BL-INV-6),
// 잔량 = 받은 양 − 쓴 수(BL-3 1). 끝에 재생 무결성 검사의 요금 대조가 모두 같다(BL-INV-3·4, AC-N5-26).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { checkReplay } from '@livejjim/server'
import { printer } from '../i1/helpers.ts'
import { D, H, api, billingHarness, buy, kstDate, rid, rows, type BillingHarness, type Shop } from './helpers.ts'

const ITEMS = ['flat-30', 'days-1', 'days-10', 'orders-100', 'labels-100'] as const

type Op =
  | { t: 'grant'; kind: 'FLAT_30D' | 'DAYS' | 'ORDERS' | 'LABELS'; qty: number }
  | { t: 'buy'; item: (typeof ITEMS)[number]; method: 'CARD' | 'TRANSFER'; variant: 'ok' | 'mismatch' | 'fail' | 'lookup' | 'webhook' }
  | { t: 'refund'; pick: number }
  | { t: 'start'; rehearsal: boolean; past: boolean; resend: boolean }
  | { t: 'register'; pick: number; no: number; stock: number }
  | { t: 'chat'; pick: number; no: number; ch: number }
  | { t: 'sms'; pick: number; no: number }
  | { t: 'renumber'; pick: number; from: number; to: number }
  | { t: 'end'; pick: number }
  | { t: 'print' }
  | { t: 'tick'; ms: number }
  | { t: 'restart' }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { arbitrary: fc.record({ t: fc.constant('grant' as const), kind: fc.constantFrom('FLAT_30D' as const, 'DAYS' as const, 'ORDERS' as const, 'LABELS' as const), qty: fc.integer({ min: 1, max: 2 }) }), weight: 2 },
  {
    arbitrary: fc.record({
      t: fc.constant('buy' as const),
      item: fc.constantFrom(...ITEMS),
      method: fc.constantFrom('CARD' as const, 'TRANSFER' as const),
      variant: fc.constantFrom('ok' as const, 'ok' as const, 'mismatch' as const, 'fail' as const, 'lookup' as const, 'webhook' as const),
    }),
    weight: 3,
  },
  { arbitrary: fc.record({ t: fc.constant('refund' as const), pick: fc.nat() }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('start' as const), rehearsal: fc.boolean(), past: fc.boolean(), resend: fc.boolean() }), weight: 4 },
  { arbitrary: fc.record({ t: fc.constant('register' as const), pick: fc.nat(), no: fc.integer({ min: 1, max: 4 }), stock: fc.integer({ min: 1, max: 2 }) }), weight: 4 },
  { arbitrary: fc.record({ t: fc.constant('chat' as const), pick: fc.nat(), no: fc.integer({ min: 1, max: 5 }), ch: fc.integer({ min: 1, max: 4 }) }), weight: 6 },
  { arbitrary: fc.record({ t: fc.constant('sms' as const), pick: fc.nat(), no: fc.integer({ min: 1, max: 5 }) }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('renumber' as const), pick: fc.nat(), from: fc.integer({ min: 1, max: 4 }), to: fc.integer({ min: 5, max: 7 }) }), weight: 1 },
  { arbitrary: fc.record({ t: fc.constant('end' as const), pick: fc.nat() }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('print' as const) }), weight: 3 },
  { arbitrary: fc.record({ t: fc.constant('tick' as const), ms: fc.constantFrom(H, 23 * H, D, 7 * D, 30 * D) }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('restart' as const) }), weight: 1 },
)

interface Bc {
  id: string
  date: string
  rehearsal: boolean
}

let smsN = 0

async function run(ops: readonly Op[]): Promise<void> {
  const h: BillingHarness = await billingHarness()
  try {
    const shopA = await h.account(`rnd${String(Date.now() % 100000)}${String(++smsN)}`)
    const shop: Shop = shopA
    const a = api(h, shop)
    expect((await a.business()).status).toBe(200)
    const bcs: Bc[] = []
    const payments: string[] = []
    let lastStartRequest: string | null = null
    let lastStartOk = false
    let device = false
    const log: string[] = []
    const real = () => bcs.filter((b) => !b.rehearsal)
    const pick = <T>(xs: readonly T[], n: number): T | undefined => (xs.length === 0 ? undefined : xs[n % xs.length])

    for (const op of ops) {
      log.push(JSON.stringify(op))
      const where = () => log.join('\n')
      switch (op.t) {
        case 'grant':
          await h.server.billing.grantByOperator(shop.sellerId, { kind: op.kind, quantity: op.kind === 'FLAT_30D' ? null : op.qty, reason: '시험' })
          break
        case 'buy': {
          if (op.variant === 'ok') {
            payments.push(await buy(h, shop, op.item, op.method))
            break
          }
          const created = await a.order(op.item, op.method)
          expect(created.status, created.text).toBe(200)
          const id = created.body.paymentId as string
          const amount = created.body.amount as number
          payments.push(id)
          if (op.variant === 'mismatch') h.test.portone.pay(id, amount - 1000, op.method)
          else if (op.variant === 'fail') h.test.portone.fail(id, amount, op.method)
          else h.test.portone.pay(id, amount, op.method)
          if (op.variant === 'lookup') h.test.portone.lookupFailure = true
          const confirmed = await a.confirm(id)
          h.test.portone.lookupFailure = false
          expect(confirmed.status, confirmed.text).toBe(200)
          if (op.variant === 'webhook') {
            // 확인과 웹훅 둘이 겹쳐도 한 번 (BL-6 6)
            const w = await h.server.billing.testWebhook(id)
            expect(w).toBe(200)
            expect(await h.server.billing.testWebhook(id)).toBe(200)
          }
          break
        }
        case 'refund': {
          const id = pick(payments, op.pick)
          if (id === undefined) break
          const list = await a.payments('?limit=100')
          const item = (list.body.items as { type: string; paymentId?: string; refundable?: boolean }[]).find((x) => x.paymentId === id)
          const r = await a.refund(id)
          if (item?.refundable === true) expect(r.status, `${where()}\n${r.text}`).toBe(200)
          else expect(r.status, `${where()}\n${r.text}`).toBe(409)
          break
        }
        case 'start': {
          const before = await a.status()
          const preview = before.start as { allowed: boolean; mode?: string; useDay?: boolean }
          const date = op.past ? '2026-10-18' : kstDate(h.clock.now())
          if (op.resend && lastStartRequest !== null && lastStartOk && !op.rehearsal) {
            const again = await a.start({ date }, lastStartRequest)
            // 성공한 시작의 같은 요청 번호 재전송은 처음 결과 — 방송 일을 다시 쓰지 않는다
            expect(again.status, again.text).toBe(200)
            const after = await a.status()
            expect((after.balances as Record<string, number>).DAYS, where()).toBe((before.balances as Record<string, number>).DAYS)
            break
          }
          // 거절된 요청 번호를 다시 보내면(이용권을 산 뒤) 새 시작이다 (AC-N5-20)
          const requestId: string = op.resend && lastStartRequest !== null && !lastStartOk && !op.rehearsal ? lastStartRequest : rid('bc')
          const res = await a.start({ date, ...(op.rehearsal ? { rehearsal: true } : {}) }, requestId)
          if (op.rehearsal) {
            expect(res.status, `${where()}\n${res.text}`).toBe(200)
            expect(res.body.billing).toBeUndefined()
          } else if (!preview.allowed) {
            expect(res.status, `${where()}\n${res.text}`).toBe(422)
            expect((res.body.error as { code: string }).code).toBe('NO_PASS')
            lastStartRequest = requestId
            lastStartOk = false
            break
          } else {
            if (res.status !== 200) {
              // 같은 범위에 끝내지 않은 방송이 있으면 엔진이 받지 않을 수 있다 — 그때 요금 기록은 없어야 한다
              expect(res.status, `${where()}\n${res.text}`).not.toBe(422)
              break
            }
            expect(res.body.billing, `${where()}\n${res.text}`).toEqual({ mode: preview.mode, usedDay: preview.useDay })
            lastStartRequest = requestId
            lastStartOk = true
          }
          if (res.status === 200) {
            const b = res.body.broadcast as { id: string; date: string }
            bcs.push({ id: b.id, date: b.date, rehearsal: op.rehearsal })
          }
          break
        }
        case 'register': {
          const b = pick(bcs, op.pick)
          if (b === undefined) break
          const r = await a.event({ type: 'product.register', b: b.id, no: op.no, name: `품종${String(op.no)}`, price: 5000, stock: op.stock }, b.date + (b.rehearsal ? '' : ''))
          expect(r.status, `${where()}\n${r.text}`).not.toBe(422)
          break
        }
        case 'chat': {
          const b = pick(bcs, op.pick)
          if (b === undefined) break
          await h.server.ingestChat(shop.sellerId, { b: b.id, id: `rc-${String(++smsN)}`, ch: `UC_${String(op.ch)}`, nick: `손님${String(op.ch)}`, text: String(op.no) })
          break
        }
        case 'sms': {
          const b = pick(real(), op.pick)
          if (b === undefined) break
          const r = await a.event({ type: 'sms', b: b.id, no: op.no, received: '20:00', ref: `ref${String(++smsN)}` }, b.date)
          expect(r.status, `${where()}\n${r.text}`).not.toBe(422)
          break
        }
        case 'renumber': {
          const b = pick(bcs, op.pick)
          if (b === undefined) break
          const r = await a.event({ type: 'product.renumber', b: b.id, from: op.from, to: op.to }, b.date)
          expect(r.status, `${where()}\n${r.text}`).not.toBe(422)
          break
        }
        case 'end': {
          const b = pick(bcs, op.pick)
          if (b === undefined) break
          const r = await a.end(b.id)
          expect(r.status, `${where()}\n${r.text}`).not.toBe(422)
          break
        }
        case 'print': {
          const p = printer(h, shop.cookie)
          if (!device) {
            await p.become()
            device = true
          }
          const o = await p.overview()
          if (o.queue.pause !== null) {
            const restarted = await p.restart()
            if (restarted.status !== 200) break
          }
          await p.printOne()
          break
        }
        case 'tick':
          h.clock.t += op.ms
          // 세션이 끝났을 수 있다 — 다시 로그인 (판매자가 다시 들어온 것)
          shop.cookie = await h.login(shop.loginId)
          break
        case 'restart':
          h.server.close()
          h.server = h.restart()
          device = false
          break
      }

      // ── 매 단계 불변식 ──
      const grantsPerPayment = await rows<{ n: number }>(h, `select count(*)::int as n from billing_grants where payment_id is not null group by payment_id having count(*) > 1`)
      expect(grantsPerPayment, `BL-INV-1 이용권 중복\n${where()}`).toEqual([])
      const docsPerPayment = await rows<{ n: number }>(h, `select count(*)::int as n from billing_documents group by payment_id having count(*) > 1`)
      expect(docsPerPayment, `BL-INV-1 증빙 중복\n${where()}`).toEqual([])
      const days = await rows<{ at: Date; key: string }>(h, `select at, key from billing_usage where kind = 'DAYS' order by at`)
      for (let i = 1; i < days.length; i++) {
        const gap = new Date(days[i]?.at as Date).getTime() - new Date(days[i - 1]?.at as Date).getTime()
        expect(gap, `BL-INV-2 창 겹침\n${where()}`).toBeGreaterThanOrEqual(D)
      }
      const st = await a.status()
      const granted = await rows<{ kind: string; q: number }>(
        h,
        `select g.kind, coalesce(sum(g.quantity), 0)::int as q from billing_grants g where not exists (select 1 from billing_revocations r where r.grant_id = g.id) group by g.kind`,
      )
      const usedRows = await rows<{ kind: string; n: number }>(h, `select kind, count(*)::int as n from billing_usage group by kind`)
      for (const kind of ['DAYS', 'ORDERS', 'LABELS']) {
        const want = (granted.find((x) => x.kind === kind)?.q ?? 0) - (usedRows.find((x) => x.kind === kind)?.n ?? 0)
        expect((st.balances as Record<string, number>)[kind], `잔량 ${kind}\n${where()}`).toBe(want)
      }
    }

    // ── 끝: 재생 무결성 검사의 요금 대조 (BL-INV-3·4·6) ──
    const checks = await checkReplay(h.database.db, { sellerId: shop.sellerId })
    for (const check of checks) expect({ date: check.date, rehearsal: check.rehearsal, ok: check.ok, billing: check.billing, diff: check.firstDiff }, log.join('\n')).toMatchObject({ ok: true, billing: [] })
    // 리허설 방송에는 이용 방식이 없다
    const rehearsalModes = await rows<{ n: number }>(
      h,
      `select count(*)::int as n from billing_modes m join broadcasts b on b.id = m.broadcast_id where b.id in (${bcs.filter((b) => b.rehearsal).map((b) => `'${b.id}'`).join(',') || "''"})`,
    )
    expect(rehearsalModes[0]?.n ?? 0).toBe(0)
  } finally {
    await h.close()
  }
}

describe('N5 무작위 처리 열 (BL-INV-1~6, AC-N5-20~27·31·34·36)', () => {
  it('운영자 부여·결제·환불·방송 시작·판매·라벨·재시작·시계 넘기기를 섞어도 요금 불변식이 지켜진다', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 10, maxLength: 45 }), async (ops) => {
        await run(ops)
      }),
      { numRuns: 25, endOnFailure: true },
    )
  }, 600_000)
})
