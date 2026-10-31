// 공개 요금 안내 `/pricing` (PAY2, SPEC §7 화면 18, BILLING_RULES BL-12, D-PAY-11): 로그인 없이 연다. 메뉴에 없고 소개·로그인 화면의 "요금 안내"로 온다.
// 서버 공개 요금 입구(PUBLIC_PRICING_PATH)의 `{ ready, items }`만 쓴다 — 판매자 세션과 상관없이 같은 답(로그인한 채 열어도 같은 내용).
// ready면 위에서 아래로: 제목 → 판매 중 이용권 표(이름·양·가격 + "부가세 포함", 요금 표 순서) → 결제 수단 → 증빙 → 자동 갱신 없음 → 환불 규정(BL-10 5)
// → 이용권 약관 전문(결제 화면과 같은 TERMS 상수) → 운영 사업자. ready가 아니면 제목·"요금은 준비 중이에요."·운영 사업자만.
// 금액은 코어 formatWon으로 쓰고 화면에서 다시 계산하지 않는다(BL-12 3). 항목 이름은 글자로만 그린다(React 기본 이스케이프).
// 앱에서 연 탭에서는 이 화면을 그리지 않는다 — App이 `/`로 바꿔 간다(BL-11 3).
import { formatWon } from '@livejjim/core'
import { useCallback, useEffect, useState } from 'react'
import { get, isApiError, type ApiError } from '../api/client.ts'
import type { PassKind, PriceItem } from '../api/billing-types.ts'
import { KIND_WORD, TERMS, UNIT_WORD } from '../lib/billing-words.ts'
import { LANDING_HEADINGS, operatorLines } from '../lib/landing.ts'
import { OPERATOR, type Operator } from '../operator.ts'
import { ErrorNote } from './ErrorNote.tsx'

/** 서버 공개 요금 입구 (로그인 없이, BL-12 1 — 경로는 dev-server와 맞춘 값, harness/sprints/PAY2/dev-notes.md) */
export const PUBLIC_PRICING_PATH = '/api/pricing'

export const PRICING_TITLE = '요금 안내'
export const PRICING_NOT_READY = '요금은 준비 중이에요.'
export const PRICING_METHODS = '카드·계좌이체'
export const PRICING_RECEIPTS = '카드 결제는 카드 매출전표, 계좌이체는 현금영수증(지출증빙)'
export const PRICING_NO_RENEW = '자동으로 갱신·결제되지 않아요.'
export const PRICING_VAT = '부가세 포함'

export interface PublicPricing {
  readonly ready: boolean
  readonly items: readonly PriceItem[]
}

const PASS_KINDS: readonly PassKind[] = ['FLAT_30D', 'DAYS', 'ORDERS', 'LABELS']

function readItem(value: unknown): PriceItem | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const { id, name, kind, quantity, price } = record
  if (typeof id !== 'string' || typeof name !== 'string' || typeof kind !== 'string' || !(PASS_KINDS as readonly string[]).includes(kind)) return null
  if (typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0) return null
  const amount = typeof quantity === 'number' && Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null
  if (kind !== 'FLAT_30D' && amount === null) return null
  return { id, name, kind: kind as PassKind, quantity: kind === 'FLAT_30D' ? null : amount, price }
}

/** 공개 요금 입구 응답 읽기. 모양이 다르면 준비 중 (가격을 잘못 보이지 않는다) */
export function readPublicPricing(value: unknown): PublicPricing {
  if (typeof value !== 'object' || value === null) return { ready: false, items: [] }
  const record = value as Record<string, unknown>
  if (record.ready !== true || !Array.isArray(record.items)) return { ready: false, items: [] }
  const items = record.items.map(readItem)
  if (items.some((item) => item === null)) return { ready: false, items: [] }
  return { ready: true, items: items as PriceItem[] }
}

/** 양: 정액제 "30일", 정량 "5일"·"100건"·"100장" */
export function amountWords(item: Pick<PriceItem, 'kind' | 'quantity'>): string {
  if (item.kind === 'FLAT_30D') return '30일'
  return `${String(item.quantity ?? 0)}${UNIT_WORD[item.kind]}`
}

const REFUND_CLAUSE = TERMS.find((clause) => clause.title === '청약철회·환불')

type Load = { readonly state: 'loading' } | { readonly state: 'ready'; readonly pricing: PublicPricing } | { readonly state: 'error'; readonly error: ApiError }

export function PricingPage({ operator = OPERATOR }: { readonly operator?: Operator }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const fetchPricing = useCallback(() => {
    let alive = true
    setLoad({ state: 'loading' })
    get<unknown>(PUBLIC_PRICING_PATH).then(
      (body) => {
        if (alive) setLoad({ state: 'ready', pricing: readPublicPricing(body) })
      },
      (error: unknown) => {
        if (!alive) return
        if (isApiError(error) && (error.network || error.status >= 500)) setLoad({ state: 'error', error })
        // 서버에 닿았는데 입구가 없다(옛 서버 등) — 준비 중
        else setLoad({ state: 'ready', pricing: { ready: false, items: [] } })
      },
    )
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => fetchPricing(), [fetchPricing])

  const operatorSection = (
    <section className="stack-tight" aria-labelledby="pricing-operator-title">
      <h2 id="pricing-operator-title">{LANDING_HEADINGS.operator}</h2>
      <ul className="landing-operator">
        {operatorLines(operator).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )

  return (
    <main className="page stack pricing">
      <h1>{PRICING_TITLE}</h1>
      {load.state === 'loading' ? <p>불러오는 중…</p> : null}
      {load.state === 'error' ? <ErrorNote error={load.error} onRetry={() => void fetchPricing()} retryLabel="다시 불러오기" /> : null}
      {load.state === 'ready' && !load.pricing.ready ? (
        <p className="notice" role="status">
          {PRICING_NOT_READY}
        </p>
      ) : null}
      {load.state === 'ready' && load.pricing.ready ? <PricingBody items={load.pricing.items} /> : null}
      {operatorSection}
    </main>
  )
}

function PricingBody({ items }: { readonly items: readonly PriceItem[] }) {
  return (
    <>
      <section className="stack-tight" aria-labelledby="pricing-items-title">
        <h2 id="pricing-items-title">이용권</h2>
        {items.length === 0 ? (
          <p>지금 살 수 있는 이용권이 없어요.</p>
        ) : (
          <table className="pricing-table">
            <thead>
              <tr>
                <th scope="col">이름</th>
                <th scope="col">양</th>
                <th scope="col">가격</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">
                    {item.name}
                    <span className="pricing-kind">{KIND_WORD[item.kind]}</span>
                  </th>
                  <td>{amountWords(item)}</td>
                  <td>
                    <span className="pricing-price">{formatWon(item.price)}</span>
                    <span className="pricing-vat">{PRICING_VAT}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="stack-tight" aria-labelledby="pricing-pay-title">
        <h2 id="pricing-pay-title">결제와 증빙</h2>
        <dl className="pricing-facts">
          <dt>결제 수단</dt>
          <dd>{PRICING_METHODS}</dd>
          <dt>증빙</dt>
          <dd>{PRICING_RECEIPTS}</dd>
        </dl>
        <p>{PRICING_NO_RENEW}</p>
      </section>
      {REFUND_CLAUSE !== undefined ? (
        <section className="stack-tight" aria-labelledby="pricing-refund-title">
          <h2 id="pricing-refund-title">환불 규정</h2>
          <p>{REFUND_CLAUSE.text}</p>
        </section>
      ) : null}
      <section className="stack-tight" aria-labelledby="pricing-terms-title">
        <h2 id="pricing-terms-title">이용권 약관</h2>
        <ol className="pricing-terms stack-tight">
          {TERMS.map((clause) => (
            <li key={clause.title}>
              <strong>{clause.title}</strong> {clause.text}
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
