// 요금 화면 조각 (N5, AC-N5-51~55·58·59): 이용 상태 네 칸, 요금 표, 결제 전 확인 창, 시험 결제 창, 환불 확인 창, 약관, 결제 내역, 쓴 내역.
// 값은 서버 요금 상태·내역 그대로이고 화면이 다시 계산하지 않는다(BL-4 6) — 낱말(lib/billing-words.ts)로만 바꾼다.
// 폭 48rem 이상이면 결제 내역·쓴 내역은 열 머리가 있는 표, 좁으면 카드(AC-N5-59). 상태는 색 + 낱말(D-102).
import { formatWon } from '@livejjim/core'
import { useRef, useState } from 'react'
import { isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { BillingStatus, OrderCreated, OrderItem, PayMethod, PaymentItem, PriceItem, UsageItem } from '../api/billing-types.ts'
import type { ListState } from '../lib/billing-store.ts'
import {
  KIND_ORDER,
  KIND_WORD,
  METHOD_WORD,
  ORDER_STATE_TONE,
  ORDER_STATE_WORD,
  TERMS,
  TERMS_CHECK,
  TRANSFER_RECEIPT_NOTE,
  balanceWords,
  beforePayNotices,
  documentWords,
  flatWords,
  passWords,
  priceLine,
  refundQuestion,
  usageLine,
  usageWords,
  when,
  windowWords,
} from '../lib/billing-words.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

// ── 이용 상태 (AC-N5-51) ─────────────────────────────────────────────────

/** 맨 위 네 칸: 정액제 · 방송 일권 · 주문 건권 · 라벨 장권. 초과·남은 7일 이하는 주의(색 + 낱말) */
export function StatusCells({ status }: { readonly status: BillingStatus }) {
  const flatSoon = status.banners.some((banner) => banner.kind === 'FLAT_REMAINING')
  const cell = (label: string, value: string, tone: 'warning' | null, extra?: string) => (
    <div className="billing-cell" {...(tone === null ? {} : { 'data-tone': tone })}>
      <dt>{label}</dt>
      <dd>
        <span className="billing-cell-value">{value}</span>
        {extra !== undefined ? <span>{extra}</span> : null}
      </dd>
    </div>
  )
  return (
    <dl className="billing-status" aria-label="이용 상태">
      {cell('정액제', flatWords(status.flat), flatSoon ? 'warning' : null)}
      {cell('방송 일권', balanceWords('DAYS', status.balances.DAYS), status.balances.DAYS < 0 ? 'warning' : null, status.window === null ? undefined : windowWords(status.window))}
      {cell('주문 건권', balanceWords('ORDERS', status.balances.ORDERS), status.balances.ORDERS < 0 ? 'warning' : null)}
      {cell('라벨 장권', balanceWords('LABELS', status.balances.LABELS), status.balances.LABELS < 0 ? 'warning' : null)}
    </dl>
  )
}

// ── 요금 표 (AC-N5-52) ───────────────────────────────────────────────────

/** 판매 중인 항목을 종류별로 "이름 · 30,000원 (부가세 포함)". canBuy가 아니면(사업자 정보 없음) "사기" 대신 위의 안내가 있다 */
export function PriceList({ items, canBuy, disabled, onBuy }: { readonly items: readonly PriceItem[]; readonly canBuy: boolean; readonly disabled: boolean; readonly onBuy: (item: PriceItem) => void }) {
  if (items.length === 0) return <p>지금 살 수 있는 이용권이 없어요.</p>
  return (
    <div className="billing-prices">
      {KIND_ORDER.map((kind) => {
        const group = items.filter((item) => item.kind === kind)
        if (group.length === 0) return null
        return (
          <section key={kind} className="stack-tight" aria-label={KIND_WORD[kind]}>
            <h3 className="sub-title">{KIND_WORD[kind]}</h3>
            <ul className="plain-list stack-tight">
              {group.map((item) => (
                <li key={item.id} className="billing-price-row">
                  <span>{priceLine(item)}</span>
                  {canBuy ? (
                    <button type="button" className="button" disabled={disabled} aria-label={`${item.name} 사기`} onClick={() => onBuy(item)}>
                      사기
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

// ── 약관 (BL-10) ─────────────────────────────────────────────────────────

/** 약관 초안 펼쳐 보기 (결제 전 확인 창·결제 내역 아래) */
export function TermsDetails() {
  return (
    <details className="details billing-terms">
      <summary>이용권 약관과 환불 규정 펼쳐 보기</summary>
      <ol className="billing-terms-list">
        {TERMS.map((clause) => (
          <li key={clause.title}>
            <strong>{clause.title}</strong> {clause.text}
          </li>
        ))}
      </ol>
    </details>
  )
}

// ── 결제 전 확인 창 (AC-N5-52) ───────────────────────────────────────────

export interface PurchaseDialogProps {
  readonly item: PriceItem
  readonly status: BillingStatus
  readonly onClose: () => void
  /** 결제 주문 만들기 (같은 요청 번호로 다시 보내면 같은 주문). 만들면 창을 닫는 것은 부르는 쪽 */
  readonly onOrder: (order: OrderCreated) => void
}

/**
 * 항목·금액, 수단(카드 기본·계좌이체), 결제 전 안내(BL-9 5), 약관 펼쳐 보기, 약관 체크(기본 해제 — 체크 전엔 "결제하기"를 누를 수 없다),
 * "결제하기"·"닫기"(처음 포커스 "닫기").
 */
export function PurchaseDialog({ item, status, onClose, onOrder }: PurchaseDialogProps) {
  const [method, setMethod] = useState<PayMethod>('CARD')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const pending = useRef<{ key: string; requestId: string } | null>(null)
  const notices = beforePayNotices(item, status)

  const submit = async () => {
    if (busy || !agreed) return
    // 같은 수단으로 다시 누르면(보내지 못한 뒤) 같은 요청 번호 — 서버는 같은 주문을 돌려준다
    const key = method
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const { requestId } = pending.current
    setBusy(true)
    setError(null)
    try {
      const order = await withRetry(() => post<OrderCreated>('/api/billing/orders', { requestId, itemId: item.id, method, agreed: true }))
      pending.current = null
      onOrder(order)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      if (!caught.transient) pending.current = null
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`${item.name} 사기`}
      onClose={onClose}
      wide
      actions={
        <button type="button" className="button button-primary" disabled={!agreed || busy} onClick={() => void submit()}>
          결제하기
        </button>
      }
    >
      <p className="billing-price">{priceLine(item)}</p>
      <fieldset className="fieldset">
        <legend>결제 수단</legend>
        <label className="choice">
          <input type="radio" name="billing-method" checked={method === 'CARD'} onChange={() => setMethod('CARD')} />
          {METHOD_WORD.CARD}
        </label>
        <label className="choice">
          <input type="radio" name="billing-method" checked={method === 'TRANSFER'} onChange={() => setMethod('TRANSFER')} />
          {METHOD_WORD.TRANSFER}
        </label>
        {method === 'TRANSFER' ? <p className="hint">{TRANSFER_RECEIPT_NOTE}</p> : null}
      </fieldset>
      {notices.map((notice) => (
        <p key={notice} className="billing-note" data-tone="warning">
          {notice}
        </p>
      ))}
      <TermsDetails />
      <label className="choice">
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        {TERMS_CHECK}
      </label>
      {busy ? <p role="status">결제 창을 여는 중이에요…</p> : null}
      {error !== null ? <ErrorNote error={error} {...(error.transient ? { onRetry: () => void submit() } : {})} /> : null}
    </Modal>
  )
}

// ── 시험 결제 창 (AC-N5-58) ──────────────────────────────────────────────

type TestAction = { readonly action: 'PAID'; readonly method: PayMethod } | { readonly action: 'FAILED' } | { readonly action: 'CHANGED_AMOUNT' }

const TEST_CHOICES: readonly { readonly label: string; readonly act: TestAction }[] = [
  { label: '결제 완료(카드)', act: { action: 'PAID', method: 'CARD' } },
  { label: '결제 완료(계좌이체)', act: { action: 'PAID', method: 'TRANSFER' } },
  { label: '결제 실패', act: { action: 'FAILED' } },
  { label: '금액을 바꿔 결제', act: { action: 'CHANGED_AMOUNT' } },
]

/** 시험 결제 창 제목 */
export const TEST_PAYMENT_TITLE = '시험 결제 — 실제로 돈이 나가지 않아요'

/**
 * 시험 결제일 때만(client-config) 결제 창 대신 열린다. 고르면 가짜 결제 서버에서 그 결제를 완료·실패·금액 바꿔 완료한 뒤 닫힌다 —
 * 닫히면(어떤 선택이든, "창 닫기"도) 부르는 쪽이 서버에 확인한다(운영과 같은 흐름). 처음 포커스는 "창 닫기".
 */
export function TestPaymentDialog({ order, onDone }: { readonly order: OrderCreated; readonly onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const choose = async (act: TestAction) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await post(`/api/billing/test/payments/${encodeURIComponent(order.paymentId)}`, { requestId: newRequestId(), ...act })
      onDone()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      setBusy(false)
    }
  }
  return (
    <Modal
      title={TEST_PAYMENT_TITLE}
      onClose={() => {
        if (!busy) onDone()
      }}
      closeLabel="창 닫기"
      actions={TEST_CHOICES.map((choice) => (
        <button key={choice.label} type="button" className="button" disabled={busy} onClick={() => void choose(choice.act)}>
          {choice.label}
        </button>
      ))}
    >
      <p>
        {order.orderName} · {formatWon(order.amount)}
      </p>
      <p className="hint">고른 대로 결제된 것처럼 하고 서버에 확인해요.</p>
      {error !== null ? <ErrorNote error={error} /> : null}
    </Modal>
  )
}

// ── 환불 확인 창 (AC-N5-54) ──────────────────────────────────────────────

/** "'<항목 이름>' 결제(30,000원)를 취소하고 이용권을 거둬요. 되돌릴 수 없어요." — 처음 포커스 "닫기", 두 번째 버튼 "환불" */
export function RefundDialog({ order, busy, onClose, onRefund }: { readonly order: OrderItem; readonly busy: boolean; readonly onClose: () => void; readonly onRefund: () => void }) {
  return (
    <Modal
      title="환불할까요?"
      onClose={() => {
        if (!busy) onClose()
      }}
      actions={
        <button type="button" className="button button-danger" disabled={busy} onClick={onRefund}>
          환불
        </button>
      }
    >
      <p>{refundQuestion(order.itemName, order.amount)}</p>
      {busy ? <p role="status">환불하는 중이에요…</p> : null}
    </Modal>
  )
}

// ── 결제 내역 (AC-N5-54) ─────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

/** 결제 수단: 결제된 수단을 알면 그 수단, 아니면 주문한 수단 */
function methodOf(order: OrderItem): string {
  return order.paidMethod === 'CARD' || order.paidMethod === 'TRANSFER' ? METHOD_WORD[order.paidMethod] : METHOD_WORD[order.method]
}

/** 하루 넘은 결제 대기 주문 (목록에서 접는다) — 서버 시각 기준 */
export function isStalePending(item: PaymentItem, now: string): boolean {
  return item.type === 'order' && item.state === 'PENDING' && Date.parse(now) - Date.parse(item.createdAt) > DAY_MS
}

export interface PaymentHistoryProps {
  readonly list: ListState<PaymentItem>
  readonly now: string
  readonly wide: boolean
  /** 결과 문장에 "다시 확인"이 있는 주문 (목록에는 두지 않는다 — 같은 버튼이 두 번 보이지 않게) */
  readonly checkingId: string | null
  readonly busy: boolean
  readonly onRecheck: (paymentId: string) => void
  readonly onRefund: (order: OrderItem) => void
  readonly onMore: () => void
}

function OrderActions({ order, checkingId, busy, onRecheck, onRefund }: { readonly order: OrderItem } & Pick<PaymentHistoryProps, 'checkingId' | 'busy' | 'onRecheck' | 'onRefund'>) {
  const recheck = order.state === 'PENDING' && order.paymentId !== checkingId
  const refund = order.refundable && !order.refunding
  if (!recheck && !refund && !order.refunding) return null
  return (
    <span className="row">
      {recheck ? (
        <button type="button" className="button" disabled={busy} aria-label={`${order.itemName} 다시 확인`} onClick={() => onRecheck(order.paymentId)}>
          다시 확인
        </button>
      ) : null}
      {refund ? (
        <button type="button" className="button" disabled={busy} aria-label={`${order.itemName} 환불`} onClick={() => onRefund(order)}>
          환불
        </button>
      ) : null}
      {order.refunding ? <span className="tag" data-tone="info">환불 처리 중</span> : null}
    </span>
  )
}

function StateTag({ order }: { readonly order: OrderItem }) {
  return (
    <span className="tag" data-tone={ORDER_STATE_TONE[order.state]}>
      {ORDER_STATE_WORD[order.state]}
    </span>
  )
}

const operatorWords = (item: Extract<PaymentItem, { type: 'operator' }>): string => `운영자가 준 이용권 · ${item.reason}${item.revoked ? ' · 거둠' : ''}`

function PaymentCards(props: PaymentHistoryProps & { readonly items: readonly PaymentItem[]; readonly label: string }) {
  return (
    <ul className="plain-list billing-cards" aria-label={props.label}>
      {props.items.map((item) =>
        item.type === 'operator' ? (
          <li key={`g:${item.grantId}`} className="billing-card">
            <p>
              <strong>{passWords(item.kind, item.quantity)}</strong>
            </p>
            <p>{when(item.at)}</p>
            <p>{operatorWords(item)}</p>
          </li>
        ) : (
          <li key={`o:${item.paymentId}`} className="billing-card">
            <p>
              <strong>{item.itemName}</strong> · {formatWon(item.amount)} · {methodOf(item)}
            </p>
            <p>{when(item.createdAt)}</p>
            <p className="row">
              <StateTag order={item} />
              {item.document !== null ? <span>{documentWords(item.document)}</span> : null}
            </p>
            <OrderActions order={item} checkingId={props.checkingId} busy={props.busy} onRecheck={props.onRecheck} onRefund={props.onRefund} />
          </li>
        ),
      )}
    </ul>
  )
}

function PaymentTable(props: PaymentHistoryProps & { readonly items: readonly PaymentItem[]; readonly label: string }) {
  return (
    <div className="table-scroll">
      <table className="list-table billing-table" aria-label={props.label}>
        <thead>
          <tr>
            <th scope="col">시각</th>
            <th scope="col">항목</th>
            <th scope="col" className="num">
              금액
            </th>
            <th scope="col">수단</th>
            <th scope="col">상태</th>
            <th scope="col">증빙</th>
            <th scope="col">할 일</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) =>
            item.type === 'operator' ? (
              <tr key={`g:${item.grantId}`}>
                <td>{when(item.at)}</td>
                <td>{passWords(item.kind, item.quantity)}</td>
                <td colSpan={4}>{operatorWords(item)}</td>
                <td />
              </tr>
            ) : (
              <tr key={`o:${item.paymentId}`}>
                <td>{when(item.createdAt)}</td>
                <td>{item.itemName}</td>
                <td className="num">{formatWon(item.amount)}</td>
                <td>{methodOf(item)}</td>
                <td>
                  <StateTag order={item} />
                </td>
                <td>{item.document !== null ? documentWords(item.document) : ''}</td>
                <td>
                  <OrderActions order={item} checkingId={props.checkingId} busy={props.busy} onRecheck={props.onRecheck} onRefund={props.onRefund} />
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}

/** 결제 내역: 최근 것 먼저, 하루 넘은 결제 대기 주문은 접는다, "더 보기"로 이어 받는다 */
export function PaymentHistory(props: PaymentHistoryProps) {
  const { list, now, wide } = props
  if (list.items === null) return list.error !== null ? <ErrorNote error={list.error} /> : <p>불러오는 중…</p>
  const shown = list.items.filter((item) => !isStalePending(item, now))
  const stale = list.items.filter((item) => isStalePending(item, now))
  const Rows = wide ? PaymentTable : PaymentCards
  return (
    <div className="stack-tight">
      {list.items.length === 0 ? <p>아직 결제한 이용권이 없어요.</p> : null}
      {shown.length > 0 ? <Rows {...props} items={shown} label="결제 내역" /> : null}
      {stale.length > 0 ? (
        <details className="details">
          <summary>하루 넘게 결제 대기인 주문 {stale.length}건 보기</summary>
          <Rows {...props} items={stale} label="하루 넘게 결제 대기인 주문" />
        </details>
      ) : null}
      {list.error !== null ? <ErrorNote error={list.error} /> : null}
      {list.next !== null ? (
        <div className="row">
          <button type="button" className="button" disabled={list.loadingMore} onClick={props.onMore}>
            결제 내역 더 보기
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ── 쓴 내역 (AC-N5-55) ───────────────────────────────────────────────────

export function UsageHistory({ list, wide, onMore }: { readonly list: ListState<UsageItem>; readonly wide: boolean; readonly onMore: () => void }) {
  if (list.items === null) return list.error !== null ? <ErrorNote error={list.error} /> : <p>불러오는 중…</p>
  return (
    <div className="stack-tight">
      {list.items.length === 0 ? <p>아직 쓴 이용권이 없어요.</p> : null}
      {list.items.length > 0 && wide ? (
        <div className="table-scroll">
          <table className="list-table billing-table" aria-label="쓴 내역">
            <thead>
              <tr>
                <th scope="col">시각</th>
                <th scope="col">쓴 것</th>
                <th scope="col">방송</th>
                <th scope="col">상품</th>
                <th scope="col">24시간 창</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => {
                const words = usageWords(item)
                return (
                  <tr key={item.id}>
                    <td>{words.at}</td>
                    <td>{words.what}</td>
                    <td>{words.broadcast ?? ''}</td>
                    <td className="cell-name">{words.product ?? ''}</td>
                    <td>{words.until ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {list.items.length > 0 && !wide ? (
        <ul className="plain-list billing-cards" aria-label="쓴 내역">
          {list.items.map((item) => (
            <li key={item.id} className="billing-card">
              {usageLine(item)}
            </li>
          ))}
        </ul>
      ) : null}
      {list.error !== null ? <ErrorNote error={list.error} /> : null}
      {list.next !== null ? (
        <div className="row">
          <button type="button" className="button" disabled={list.loadingMore} onClick={onMore}>
            쓴 내역 더 보기
          </button>
        </div>
      ) : null}
    </div>
  )
}
