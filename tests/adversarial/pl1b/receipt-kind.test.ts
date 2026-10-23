// PL1B 적대 시험 (test-domain): 사업자 정보 저장의 증빙 종류 (AC-PL1B-91 a, AC-PL1B-01, BL-8 1·6, D-PL1-07).
// - 정확히 'TAX_INVOICE'만 "세금계산서는 지금은 발급할 수 없어요 …", 그 밖의 비슷한 글·다른 형식은 "계좌이체 증빙은 …" — 모두 422, 저장 없음
// - 이미 저장된 사업자 정보는 거절 뒤에도 그대로(상호·갱신 시각 포함), DB 종류는 늘 CASH_RECEIPT
// - 속성: 아무 JSON 값을 receiptKind로 보내도 200(없음·'CASH_RECEIPT')이 아니면 422이고 저장된 종류는 CASH_RECEIPT뿐
// - 본문 한도(64KB)를 넘으면 읽기 전에 413 — 이때도 저장 없음
// - 다른 칸과 함께 틀리면 422이고 problems에 모든 칸이 든다
import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { api, billingHarness, buy, call, rid, rows, type BillingHarness } from '../n5/helpers.ts'

const TAX = '세금계산서는 지금은 발급할 수 없어요. 현금영수증(지출증빙)으로 발행해요.'
const OTHER = '계좌이체 증빙은 현금영수증(지출증빙)만 발행해요.'

let h: BillingHarness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

interface Problem {
  field: string
  message: string
}
const problemsOf = (body: Record<string, unknown>): Problem[] => ((body.error as { problems?: Problem[] } | undefined)?.problems ?? [])

async function businessRows(x: BillingHarness, sellerId: string) {
  return rows<{ receipt_kind: string; masked: string; sealed: string; updated_at: unknown }>(x, 'select receipt_kind, masked, sealed, updated_at from billing_business where seller_id = $1', [sellerId])
}

describe('사업자 정보 증빙 종류 (AC-PL1B-91 a)', () => {
  it('처음 저장에서 비슷한 글·다른 형식은 모두 422(문장 "계좌이체 증빙은 …")이고 행이 생기지 않는다; 정확히 TAX_INVOICE만 세금계산서 문장', async () => {
    h = await billingHarness()
    const a = await h.account('rk1')
    const s = api(h, a)
    const odd: unknown[] = [
      ' TAX_INVOICE',
      'TAX_INVOICE ',
      'TAX_INVOICE\u0000',
      'TAX_INVOICE​',
      'Tax_Invoice',
      'tax_invoice',
      'ＴＡＸ_ＩＮＶＯＩＣＥ',
      'cash_receipt',
      ' CASH_RECEIPT',
      'CASH_RECEIPT\u0000',
      'BOTH',
      '',
      1,
      0,
      true,
      false,
      null,
      ['TAX_INVOICE'],
      ['CASH_RECEIPT'],
      { kind: 'CASH_RECEIPT' },
      {},
      // 아주 긴 글 — 본문 한도(64KB) 안
      'TAX_INVOICE'.repeat(4_000),
      'CASH_RECEIPT'.repeat(4_000),
      '<script>alert(1)</script>',
    ]
    for (const receiptKind of odd) {
      const r = await s.business({ receiptKind })
      expect(r.status, `${JSON.stringify(receiptKind).slice(0, 40)} → ${r.text.slice(0, 200)}`).toBe(422)
      expect(problemsOf(r.body)).toEqual([{ field: 'receiptKind', message: OTHER }])
      // 응답에 보낸 긴 글·태그를 그대로 되돌려 주지 않는다
      expect(r.text.length).toBeLessThan(2_000)
      expect(r.text).not.toContain('<script>')
    }
    const tax = await s.business({ receiptKind: 'TAX_INVOICE' })
    expect(tax.status).toBe(422)
    expect(problemsOf(tax.body)).toEqual([{ field: 'receiptKind', message: TAX }])
    // 본문 한도를 넘는 글은 읽기 전에 413 — 이때도 저장 없음
    const huge = await s.business({ receiptKind: 'TAX_INVOICE'.repeat(10_000) })
    expect(huge.status).toBe(413)
    expect(await businessRows(h, a.sellerId)).toEqual([])
    expect((await s.status()).business).toBeNull()
  })

  it('이미 저장된 사업자 정보: 거절은 아무것도 바꾸지 않는다(상호·가린 번호·봉인값·갱신 시각) — 같은 requestId로 다시 보내도', async () => {
    h = await billingHarness()
    const a = await h.account('rk2')
    const s = api(h, a)
    const ok = await s.business({ name: '처음 상호' })
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body).toMatchObject({ receiptKind: 'CASH_RECEIPT', name: '처음 상호' })
    const before = await businessRows(h, a.sellerId)
    expect(before.map((r) => r.receipt_kind)).toEqual(['CASH_RECEIPT'])
    h.clock.t += 60_000
    for (const receiptKind of ['TAX_INVOICE', ' TAX_INVOICE', 'Tax_Invoice', 'TAX_INVOICE\u0000', ['TAX_INVOICE'], { a: 1 }, 'x'.repeat(50_000)]) {
      const requestId = rid('biz')
      for (let i = 0; i < 2; i++) {
        const r = await call(h.server, a.cookie, 'PUT', '/api/billing/business', { requestId, businessNumber: '220-81-62517', name: '바뀐 상호', ceo: '바뀐대표', receiptKind })
        expect(r.status, r.text.slice(0, 200)).toBe(422)
      }
    }
    expect(await businessRows(h, a.sellerId)).toEqual(before)
    expect((await s.status()).business).toMatchObject({ name: '처음 상호', receiptKind: 'CASH_RECEIPT' })
  })

  it('다른 칸과 함께 틀리면 422이고 problems에 모든 칸 문장 — 증빙 칸만 고치면 400으로 바뀐다', async () => {
    h = await billingHarness()
    const a = await h.account('rk3')
    const s = api(h, a)
    const both = await s.business({ businessNumber: '1234567890', name: '', receiptKind: 'TAX_INVOICE' })
    expect(both.status).toBe(422)
    const fields = problemsOf(both.body).map((p) => p.field).sort()
    expect(fields).toEqual(['businessNumber', 'name', 'receiptKind'])
    expect(problemsOf(both.body).find((p) => p.field === 'receiptKind')?.message).toBe(TAX)
    const onlyOther = await s.business({ businessNumber: '1234567890', receiptKind: 'CASH_RECEIPT' })
    expect(onlyOther.status).toBe(400)
    expect(problemsOf(onlyOther.body).map((p) => p.field)).toEqual(['businessNumber'])
    expect(await businessRows(h, a.sellerId)).toEqual([])
  })

  it('속성: 아무 JSON 값을 receiptKind로 보내도 없음·"CASH_RECEIPT"만 200, 나머지는 422 — 저장된 종류는 늘 CASH_RECEIPT', async () => {
    h = await billingHarness()
    const x = h
    const a = await x.account('rk4')
    const s = api(x, a)
    const near = fc.constantFrom('TAX_INVOICE', 'CASH_RECEIPT').chain((base) =>
      fc.tuple(fc.string({ maxLength: 2 }), fc.string({ maxLength: 2 })).map(([p, q]) => `${p}${base}${q}`),
    )
    const value = fc.oneof(near, fc.jsonValue({ maxDepth: 2 }), fc.constant(undefined), fc.constant('CASH_RECEIPT'), fc.constant('TAX_INVOICE'))
    let accepted = 0
    await fc.assert(
      fc.asyncProperty(value, fc.string({ minLength: 1, maxLength: 20 }).filter((t) => t.trim() === t && ![...t].some((ch) => (ch.codePointAt(0) ?? 0) < 0x20 || ch === '\u007f')), async (receiptKind, name) => {
        const body: Record<string, unknown> = { name }
        if (receiptKind !== undefined) body.receiptKind = receiptKind
        const r = await s.business(body)
        const good = receiptKind === undefined || receiptKind === 'CASH_RECEIPT'
        if (good) {
          // 이름 칸 규칙에 걸리면 400 — 증빙 칸 때문은 아니다
          expect([200, 400]).toContain(r.status)
          if (r.status === 200) {
            accepted++
            expect(r.body.receiptKind).toBe('CASH_RECEIPT')
          } else expect(problemsOf(r.body).some((p) => p.field === 'receiptKind')).toBe(false)
        } else {
          expect(r.status, `${JSON.stringify(receiptKind)} → ${r.text.slice(0, 200)}`).toBe(422)
          const msg = problemsOf(r.body).find((p) => p.field === 'receiptKind')?.message
          expect(msg).toBe(receiptKind === 'TAX_INVOICE' ? TAX : OTHER)
        }
        const kinds = (await businessRows(x, a.sellerId)).map((row) => row.receipt_kind)
        expect(kinds.every((k) => k === 'CASH_RECEIPT')).toBe(true)
      }),
      { numRuns: 60, seed: 20261024 },
    )
    expect(accepted).toBeGreaterThan(0)
  })

  it('옛 저장값 TAX_INVOICE: 조회는 CASH_RECEIPT, 거절된 저장은 옛 행을 건드리지 않고, 성공한 저장은 CASH_RECEIPT로 덮는다; 그 뒤 계좌이체 증빙도 현금영수증', async () => {
    h = await billingHarness()
    const a = await h.account('rk5')
    const s = api(h, a)
    expect((await s.business()).status).toBe(200)
    await rows(h, "update billing_business set receipt_kind = 'TAX_INVOICE' where seller_id = $1", [a.sellerId])
    const legacy = await businessRows(h, a.sellerId)
    expect((await s.status()).business).toMatchObject({ receiptKind: 'CASH_RECEIPT' })
    // 옛 값이 있어도 다시 TAX_INVOICE를 보내 '그대로 두기'는 안 된다
    for (const receiptKind of ['TAX_INVOICE', 'Tax_Invoice', ['TAX_INVOICE']]) expect((await s.business({ receiptKind })).status).toBe(422)
    expect(await businessRows(h, a.sellerId)).toEqual(legacy)
    // 이 상태(옛 TAX_INVOICE)로 계좌이체 → 새 증빙 요청은 현금영수증
    const paid = await buy(h, a, 'days-10', 'TRANSFER')
    const docs = await rows<{ kind: string }>(h, 'select kind from billing_documents where payment_id = $1', [paid])
    expect(docs.map((d) => d.kind)).toEqual(['CASH_RECEIPT'])
    const saved = await s.business({ receiptKind: 'CASH_RECEIPT' })
    expect(saved.status).toBe(200)
    expect((await businessRows(h, a.sellerId)).map((r) => r.receipt_kind)).toEqual(['CASH_RECEIPT'])
  })
})
