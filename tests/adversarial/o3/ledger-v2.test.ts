// O3 봉인 장부 판 2 (test-domain, D-O3-12·D-O3-15, AC-O3-26, SPEC DAT-04 "봉인 장부의 옵션").
// - 무작위 옵션 방송(결정적 PRNG, 실제 코어)으로 장부를 만들고, 저장 글(JSON) → readLedger → sealedView를 거친 뒤에도
//   판매 행마다 key·variant·options·qty·amount가 코어 ClaimInfo 그대로이고, 상품 행의 variants가 코어 VariantInfo 그대로인지 본다.
//   봉인 뒤 옵션 판매 줄(무엇을 몇 개 얼마에)이 하나도 빠지거나 바뀌지 않아야 한다.
// - 옛 판 `/1`은 그 판의 뜻(수량 1·찜 금액 = 가격·옵션 없음·variants 빈 목록)으로만 읽고, `/1` 글에 엉뚱한 qty·amount·variant가 남아 있어도 따르지 않는다.
// - `/2`인데 qty·amount가 정수가 아니거나(문자열·음수·소수·안전 정수 밖·null·빠짐) 모르는 판이면 읽을 수 없는 장부 — 빈 값을 채워 넣지 않는다.
import { listClaims, listProducts, type ClaimInfo } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { LEDGER_FORMAT, buildLedger, readLedger, sealedView } from '../../../apps/server/src/youtube/seal.ts'
import { D1, optionScenario, play } from './scenarios.ts'

const SEALED_AT = Date.parse('2026-11-24T15:00:00Z')
const SEEDS: readonly number[] = Array.from({ length: 30 }, (_, i) => 77 + i * 104_729)
const pickSale = (row: Record<string, unknown>) => ({ id: row.id, key: row.key, variant: row.variant, options: row.options, qty: row.qty, amount: row.amount, price: row.price, no: row.no, broadcast: row.broadcast })
const pickClaim = (c: ClaimInfo) => ({ id: c.id, key: c.key, variant: c.variant, options: c.options, qty: c.qty, amount: c.amount, price: c.price, no: c.no, broadcast: c.broadcast })
/** JSON 저장을 거친 모양 (튜플 → 배열) */
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('D-O3-12 봉인 장부 판 2 — 저장·다시 읽기 뒤에도 옵션 판매 줄이 코어 그대로 (AC-O3-26)', () => {
  it('시드마다: 옵션 판매(수량 2 이상·변형)가 실제로 있고, 장부 → 글 → readLedger → sealedView의 판매 줄 = 코어 확정 찜', () => {
    let optionSales = 0
    let multiQty = 0
    for (const seed of SEEDS) {
      const { state } = play(optionScenario(seed))
      const confirmed = listClaims(state).filter((c) => c.status === 'CONFIRMED')
      const ledger = buildLedger(D1, state, new Map(), SEALED_AT)
      expect(ledger.format, String(seed)).toBe(LEDGER_FORMAT)
      expect(LEDGER_FORMAT).toBe('livejjim-ledger/2')
      const text = JSON.stringify(ledger)
      const read = readLedger(text)
      expect(read, `seed ${String(seed)}: 방금 쓴 판 2 장부를 못 읽음`).not.toBeNull()
      if (read === null) continue
      // 다시 읽기는 아무것도 채우거나 바꾸지 않는다
      expect(read, String(seed)).toEqual(JSON.parse(text))
      const want = viaJson(confirmed.map(pickClaim))
      expect(read.sales.map(pickSale), String(seed)).toEqual(want)
      for (const sale of read.sales) {
        expect(Number.isSafeInteger(sale.amount) && (sale.amount as number) >= 0, `${String(seed)} ${String(sale.id)} amount`).toBe(true)
        expect(Number.isSafeInteger(sale.qty) && (sale.qty as number) >= 1, `${String(seed)} ${String(sale.id)} qty`).toBe(true)
      }
      // 상품 행 variants = 코어 VariantInfo의 text·stock·winners, 옵션 없는 상품은 빈 목록
      const products = listProducts(state)
      expect(
        read.products.map((p) => p.variants),
        String(seed),
      ).toEqual(viaJson(products.map((p) => p.variants.map((v) => ({ text: v.text, stock: v.stock, winners: v.winners })))))
      // 봉인 조회의 찜에도 같은 칸
      const view = sealedView(D1, 1, text) as { claims: Record<string, unknown>[]; products: Record<string, unknown>[] } | null
      expect(view, String(seed)).not.toBeNull()
      expect(view?.claims.map(pickSale), String(seed)).toEqual(want)
      expect(view?.claims.every((c) => c.status === 'CONFIRMED')).toBe(true)
      // 판 2 글을 한 번 더 저장·읽어도 같다(같은 장부를 두 번 읽는 복원·재시작)
      expect(readLedger(JSON.stringify(read)), String(seed)).toEqual(read)
      optionSales += confirmed.filter((c) => c.variant !== null).length
      multiQty += confirmed.filter((c) => c.qty >= 2).length
    }
    // 공격이 헛돌지 않았다: 옵션 판매·수량 2 이상 판매가 실제로 장부에 들어갔다
    expect(optionSales).toBeGreaterThan(10)
    expect(multiQty).toBeGreaterThan(10)
  })

  it('찜 금액은 단가 × 수량으로 다시 계산한 값이 아니라 코어 값 — 단가를 바꾼(UNPAID_CLAIMS) 시드에서도 장부 amount = 코어 amount', () => {
    let checked = 0
    for (const seed of SEEDS) {
      const s = optionScenario(seed)
      if (!s.events.some((e) => e.type === 'product.update')) continue
      const { state } = play(s)
      const byId = new Map(listClaims(state).map((c) => [c.id, c]))
      const read = readLedger(JSON.stringify(buildLedger(D1, state, new Map(), SEALED_AT)))
      for (const sale of read?.sales ?? []) {
        expect(sale.amount).toBe(byId.get(String(sale.id))?.amount)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

// ── 옛 장부·깨진 장부 ─────────────────────────────

const base = {
  date: D1,
  sealedAt: '2026-11-24T15:00:00.000Z',
  broadcasts: [{ id: 'b1', date: D1, title: '다육 1부', endedAt: '2026-10-25T13:00:00.000Z' }],
  products: [
    { id: 'p7', key: 'b1/7', broadcast: 'b1', no: 7, name: '<b>핑크프릴</b>', price: 8000, stock: 1, status: 'SOLD', winners: ['UC_A'], priceHistory: [] },
    { id: 'p8', key: 'b1/8', broadcast: 'b1', no: 8, name: '라울', price: 12000, stock: 2, status: 'SOLD', winners: ['UC_A', 'UC_B'], priceHistory: [] },
  ],
  buyers: [],
  settlements: [],
}
const v1Sale = (id: string, no: number, buyer: string, price: number) => ({ id, product: `b1/${String(no)}`, productId: `p${String(no)}`, broadcast: 'b1', no, buyer, currentBuyer: buyer, buyerName: '=1+1', price, confirmVersion: 1, confirmedAt: null, origin: 'chat' })
const V1_SALES = [v1Sale('c1', 7, 'UC_A', 8000), v1Sale('c2', 8, 'UC_A', 12000), v1Sale('c3', 8, 'UC_B', 0)]

describe('D-O3-12 옛 판 `livejjim-ledger/1` 읽기', () => {
  it('판매마다 key = product·variant·options = null·qty 1·amount = price, 상품마다 variants = [] (0원 판매도 0원)', () => {
    const read = readLedger(JSON.stringify({ format: 'livejjim-ledger/1', ...base, sales: V1_SALES }))
    expect(read?.format).toBe('livejjim-ledger/2')
    expect(read?.sales).toEqual(V1_SALES.map((s) => ({ ...s, key: s.product, variant: null, options: null, qty: 1, amount: s.price })))
    expect(read?.products.map((p) => p.variants)).toEqual([[], []])
    // 판 1로 읽은 장부를 판 2로 저장·다시 읽어도 같다
    expect(readLedger(JSON.stringify(read))).toEqual(read)
  })

  it('판 1 글에 남은 엉뚱한 qty·amount·variant·options·variants를 따르지 않는다 (판 1은 옵션 판매가 없는 판)', () => {
    const odd = V1_SALES.map((s) => ({ ...s, key: `${s.product}#M`, variant: 'M', options: [['사이즈', 'M']], qty: 5, amount: 999_999 }))
    const products = base.products.map((p) => ({ ...p, variants: [{ text: 'M', stock: 9, winners: ['UC_A'] }] }))
    const read = readLedger(JSON.stringify({ format: 'livejjim-ledger/1', ...base, products, sales: odd }))
    expect(read?.sales.map((s) => [s.key, s.variant, s.options, s.qty, s.amount])).toEqual([
      ['b1/7', null, null, 1, 8000],
      ['b1/8', null, null, 1, 12000],
      ['b1/8', null, null, 1, 0],
    ])
    expect(read?.products.map((p) => p.variants)).toEqual([[], []])
    const view = sealedView(D1, 2, JSON.stringify({ format: 'livejjim-ledger/1', ...base, products, sales: odd })) as { claims: Record<string, unknown>[] }
    expect(view.claims.map((c) => [c.qty, c.amount, c.variant])).toEqual([
      [1, 8000, null],
      [1, 12000, null],
      [1, 0, null],
    ])
  })

  it('판 1인데 가격 스냅샷이 정수 원이 아니면 금액을 지어내지 않는다 — 읽지 않거나, 읽어도 amount가 정수 원이 아닌 줄이 없다', () => {
    for (const price of [undefined, null, '8000', -1, 1.5]) {
      const sales = [{ ...v1Sale('c1', 7, 'UC_A', 8000), price }]
      const read = readLedger(JSON.stringify({ format: 'livejjim-ledger/1', ...base, sales }))
      if (read !== null) for (const s of read.sales) expect(Number.isSafeInteger(s.amount) && (s.amount as number) >= 0, String(price)).toBe(true)
    }
  })
})

describe('D-O3-12·D-O3-15 판 2인데 칸이 깨졌거나 모르는 판 → 읽을 수 없는 장부 (채우지 않는다)', () => {
  const v2Sale = { ...v1Sale('c1', 7, 'UC_A', 17000), key: 'b1/7#105/검정색', variant: '105/검정색', options: [['사이즈', '105'], ['색상', '검정색']], qty: 2, amount: 34000 }
  const v2Products = base.products.map((p) => ({ ...p, variants: [] }))
  const v2 = (sales: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ format: 'livejjim-ledger/2', ...base, products: v2Products, sales, ...extra })

  it('대조: 성한 판 2 장부는 그대로 읽힌다 (같은 칸 그대로)', () => {
    const read = readLedger(v2([v2Sale, { ...v2Sale, id: 'c2', qty: 1, amount: 0 }]))
    expect(read?.sales).toEqual([v2Sale, { ...v2Sale, id: 'c2', qty: 1, amount: 0 }])
  })

  const bad: readonly [string, Record<string, unknown>][] = [
    ['amount 문자열', { amount: '34000' }],
    ['qty 문자열', { qty: '2' }],
    ['amount 음수', { amount: -34000 }],
    ['amount 소수', { amount: 34000.5 }],
    ['amount 안전 정수 밖', { amount: 2 ** 53 }],
    ['qty 0', { qty: 0 }],
    ['qty 음수', { qty: -2 }],
    ['qty 소수', { qty: 1.5 }],
    ['qty true', { qty: true }],
    ['amount null', { amount: null }],
    ['qty null', { qty: null }],
    ['amount 객체', { amount: { won: 34000 } }],
  ]
  for (const [title, patch] of bad) {
    it(`${title} → readLedger·sealedView 모두 null`, () => {
      // 깨진 줄이 맨 뒤 하나뿐이어도 장부 전체를 읽지 않는다 (앞 줄만 살려 판매를 빠뜨리지 않는다)
      const text = v2([v2Sale, { ...v2Sale, id: 'c9', ...patch }])
      expect(readLedger(text)).toBeNull()
      expect(sealedView(D1, 3, text)).toBeNull()
    })
  }

  it('amount·qty 칸이 아예 없는 판매 줄 → null (단가 × 수량·가격 스냅샷으로 채우지 않는다)', () => {
    const { amount: _a, ...noAmount } = v2Sale
    const { qty: _q, ...noQty } = v2Sale
    const { amount: _b, qty: _c, ...neither } = v2Sale
    for (const row of [noAmount, noQty, neither]) {
      const text = v2([v2Sale, row])
      expect(readLedger(text), JSON.stringify(row)).toBeNull()
      expect(sealedView(D1, 3, text)).toBeNull()
    }
  })

  it('모르는 판·판 글 모양이 조금 다른 것 → null', () => {
    for (const format of ['livejjim-ledger/9', 'livejjim-ledger/3', 'livejjim-ledger/0', ' livejjim-ledger/2', 'livejjim-ledger/2 ', 'LIVEJJIM-LEDGER/2', 'livejjim-ledger/2.0', 'livejjim-ledger/02', 'livejjim-ledger/', 2, null, undefined]) {
      const text = JSON.stringify({ ...base, products: v2Products, sales: [v2Sale], format })
      expect(readLedger(text), String(format)).toBeNull()
      expect(sealedView(D1, 3, text), String(format)).toBeNull()
    }
  })

  it('판 2 장부의 sales·products가 목록이 아니면 null', () => {
    for (const extra of [{ sales: { 0: v2Sale } }, { sales: null }, { products: 'x' }, { sales: [v2Sale, 'c2'] }, { sales: [v2Sale, null] }]) {
      const text = JSON.stringify({ format: 'livejjim-ledger/2', ...base, products: v2Products, sales: [v2Sale], ...extra })
      expect(readLedger(text), JSON.stringify(extra)).toBeNull()
    }
  })
})
