// 요금 화면 /billing (N5, SPEC §7 화면 9, BILLING_RULES BL-6·BL-7·BL-9·BL-10, AC-N5-50~59). 요금 기능이 켜져 있을 때만 있다.
// 위에서부터: 알림 띠(BL-9 1) → 이용 상태 네 칸 → 이용권 사기(결제 결과 문장·요금 표) → 사업자 정보 → 결제 내역(다시 확인·7일 환불, 약관) → 쓴 내역.
// - 결제: "사기" → 결제 전 확인 창(수단·안내·약관 체크) → "결제하기" → 서버가 주문을 만든다 → 결제 창(운영: 포트원 V2 SDK, 시험: 시험 결제 창) →
//   창이 닫히면(성공·실패·닫기 모두) 서버에 확인 → 서버 결과 문장(BL-9 4)만 보인다. 결제 창이 돌려준 성공 여부를 믿지 않는다(BL-6 3).
// - 휴대폰은 결제 창이 `/billing?paymentId=…`로 돌아온다 — 그 결제 ID로 확인을 요청하고 주소에서 지운다.
// - 다른 기기·웹훅으로 상태가 바뀌면 요금 알림으로 새로 받는다. 결과 문장의 주문이 결제 대기에서 바뀌었으면 문장도 맞춘다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { BillingConfig, ConfirmView, OrderCreated, OrderItem, OrderState, PriceItem, RefundView } from '../api/billing-types.ts'
import { BUSINESS_REQUIRED, confirmTone, orderStateSentence, type Tone } from '../lib/billing-words.ts'
import { PAYMENT_WINDOW_FAILED, openPortOnePayment } from '../lib/portone.ts'
import type { BillingRoute, Navigate } from '../lib/router.ts'
import { useWide } from '../lib/use-wide.ts'
import { useBillingStore } from './billing-context.tsx'
import { BillingBanners } from './BillingNotices.tsx'
import { PaymentHistory, PriceList, PurchaseDialog, RefundDialog, StatusCells, TermsDetails, TestPaymentDialog, UsageHistory } from './BillingParts.tsx'
import { BusinessSection } from './BusinessSection.tsx'
import { ErrorNote } from './ErrorNote.tsx'

export interface BillingPageProps {
  readonly config: Extract<BillingConfig, { readonly enabled: true }>
  readonly route: BillingRoute
  readonly navigate: Navigate
}

/** 결제 확인 결과 (서버 문장) */
interface PayResult {
  readonly paymentId: string
  readonly state: OrderState
  readonly message: string
  readonly itemName: string
  readonly lookupFailed: boolean
}

/** 결과 문장 하나 (결제·환불) */
interface Note {
  readonly message: string
  readonly tone: Tone
}

const noteOf = (error: ApiError): Note => ({ message: error.message, tone: 'danger' })

export function BillingPage({ config, route, navigate }: BillingPageProps) {
  const { store, snapshot } = useBillingStore(true, true)
  const wide = useWide()
  const status = snapshot.status
  const [buying, setBuying] = useState<PriceItem | null>(null)
  const [testOrder, setTestOrder] = useState<OrderCreated | null>(null)
  const [result, setResult] = useState<PayResult | null>(null)
  const [payNote, setPayNote] = useState<Note | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [windowOpen, setWindowOpen] = useState(false)
  const [refunding, setRefunding] = useState<OrderItem | null>(null)
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundNote, setRefundNote] = useState<Note | null>(null)
  const [openBusiness, setOpenBusiness] = useState(0)
  const resultRef = useRef<HTMLDivElement>(null)
  const refundRef = useRef<HTMLDivElement>(null)
  const refundRequest = useRef<{ paymentId: string; requestId: string } | null>(null)

  /** 서버에 그 결제를 확인한다 (결제 창이 닫힌 뒤·"다시 확인"·휴대폰이 돌아온 뒤) */
  const confirm = useCallback(
    async (paymentId: string) => {
      setConfirming(true)
      setPayNote(null)
      const requestId = newRequestId()
      try {
        const view = await withRetry(() => post<ConfirmView>(`/api/billing/orders/${encodeURIComponent(paymentId)}/confirm`, { requestId }))
        setResult({ paymentId: view.paymentId, state: view.state, message: view.message, itemName: view.itemName, lookupFailed: view.result === 'LOOKUP_FAILED' })
      } catch (error) {
        if (!isApiError(error)) throw error
        setResult(null)
        setPayNote(noteOf(error))
      } finally {
        setConfirming(false)
        void store?.reload()
        resultRef.current?.focus()
      }
    },
    [store],
  )

  // 휴대폰 결제 창이 돌아왔다: 주소의 결제 ID로 확인하고 주소에서 지운다 (쿼리의 다른 값은 쓰지 않는다)
  const returned = useRef<string | null>(null)
  useEffect(() => {
    const paymentId = route.paymentId
    if (paymentId === undefined || returned.current === paymentId) return
    returned.current = paymentId
    navigate({ name: 'billing' }, { replace: true })
    void confirm(paymentId)
  }, [route.paymentId, navigate, confirm])

  // 결과 문장의 주문이 다른 길(웹훅·다른 기기의 다시 확인·환불)로 바뀌었으면 문장을 맞춘다 — 앞으로만(결제 대기 → 정해짐, 결제 완료 → 환불함)
  const payments = snapshot.payments.items
  useEffect(() => {
    if (result === null || payments === null) return
    const order = payments.find((item): item is OrderItem => item.type === 'order' && item.paymentId === result.paymentId)
    if (order === undefined || order.state === result.state) return
    const forward = (result.state === 'PENDING' && order.state !== 'PENDING') || (result.state === 'GRANTED' && order.state === 'REFUNDED')
    if (forward) setResult({ ...result, state: order.state, message: orderStateSentence(order.state, result.itemName), lookupFailed: false })
  }, [payments, result])

  /** 서버가 주문을 만들었다: 결제 창을 연다 (시험 결제면 시험 결제 창 — 운영 구성에서는 열리지 않는다) */
  const onOrder = async (order: OrderCreated) => {
    setBuying(null)
    setResult(null)
    setPayNote(null)
    if (config.testPayment) {
      setTestOrder(order)
      return
    }
    setWindowOpen(true)
    const outcome = await openPortOnePayment(order, { storeId: config.storeId, channelKey: config.channelKey })
    setWindowOpen(false)
    if (outcome.kind === 'unavailable') {
      setPayNote({ message: PAYMENT_WINDOW_FAILED, tone: 'danger' })
      void store?.reload()
      return
    }
    await confirm(order.paymentId)
  }

  /** 시험 결제 창이 닫혔다 (어떤 선택이든) → 서버 확인 */
  const onTestDone = () => {
    const order = testOrder
    setTestOrder(null)
    if (order !== null) void confirm(order.paymentId)
  }

  const refund = async () => {
    const order = refunding
    if (order === null || refundBusy) return
    if (refundRequest.current?.paymentId !== order.paymentId) refundRequest.current = { paymentId: order.paymentId, requestId: newRequestId() }
    const { requestId } = refundRequest.current
    setRefundBusy(true)
    setRefundNote(null)
    try {
      const view = await withRetry(() => post<RefundView>(`/api/billing/orders/${encodeURIComponent(order.paymentId)}/refund`, { requestId }))
      refundRequest.current = null
      setRefundNote({ message: view.message, tone: 'success' })
    } catch (error) {
      if (!isApiError(error)) throw error
      if (!error.transient) refundRequest.current = null
      setRefundNote(noteOf(error))
    } finally {
      setRefundBusy(false)
      setRefunding(null)
      void store?.reload()
      refundRef.current?.focus()
    }
  }

  if (status === null) {
    return (
      <main className="page page-wide billing-page">
        <h1>요금</h1>
        {snapshot.error !== null ? <ErrorNote error={snapshot.error} onRetry={() => void store?.reload()} retryLabel="다시 불러오기" /> : <p>불러오는 중…</p>}
      </main>
    )
  }

  const canBuy = status.business?.complete === true
  const busy = confirming || windowOpen || testOrder !== null
  return (
    <main className="page page-wide billing-page">
      <h1>요금</h1>
      <BillingBanners banners={status.banners} />
      {snapshot.error !== null ? <ErrorNote error={snapshot.error} onRetry={() => void store?.reload()} retryLabel="다시 불러오기" /> : null}

      <section className="stack-tight" aria-labelledby="billing-status-title">
        <h2 id="billing-status-title" className="section-title">
          이용 상태
        </h2>
        <StatusCells status={status} />
      </section>

      <section className="stack-tight" aria-labelledby="billing-buy-title">
        <h2 id="billing-buy-title" className="section-title">
          이용권 사기
        </h2>
        <div ref={resultRef} tabIndex={-1} className="billing-result-area">
          {confirming ? <p role="status">결제를 확인하는 중이에요…</p> : null}
          {windowOpen ? <p role="status">결제 창이 열려 있어요. 결제를 마치거나 창을 닫으면 확인해요.</p> : null}
          {result !== null && !confirming ? (
            <div className="billing-result stack-tight" role="status" data-tone={confirmTone(result.state, result.lookupFailed)}>
              <p>{result.message}</p>
              {result.state === 'PENDING' ? (
                <div className="row">
                  <button type="button" className="button" disabled={busy} onClick={() => void confirm(result.paymentId)}>
                    다시 확인
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {payNote !== null && !confirming ? (
            <p className="billing-result" role="alert" data-tone={payNote.tone}>
              {payNote.message}
            </p>
          ) : null}
        </div>
        {!canBuy ? (
          <div className="billing-note stack-tight" data-tone="warning">
            <p>{BUSINESS_REQUIRED}</p>
            <div className="row">
              <button type="button" className="button" onClick={() => setOpenBusiness((n) => n + 1)}>
                사업자 정보 적기
              </button>
            </div>
          </div>
        ) : null}
        <PriceList items={status.items} canBuy={canBuy} disabled={busy} onBuy={setBuying} />
      </section>

      <section className="stack-tight" aria-labelledby="billing-business-title">
        <h2 id="billing-business-title" className="section-title">
          사업자 정보
        </h2>
        <BusinessSection business={status.business} openSignal={openBusiness} onSaved={() => void store?.reload()} />
      </section>

      <section className="stack-tight" aria-labelledby="billing-payments-title">
        <h2 id="billing-payments-title" className="section-title">
          결제 내역
        </h2>
        <div ref={refundRef} tabIndex={-1} className="billing-result-area">
          {refundNote !== null ? (
            <p className="billing-result" role={refundNote.tone === 'success' ? 'status' : 'alert'} data-tone={refundNote.tone}>
              {refundNote.message}
            </p>
          ) : null}
        </div>
        <PaymentHistory
          list={snapshot.payments}
          now={status.now}
          wide={wide}
          checkingId={result?.state === 'PENDING' ? result.paymentId : null}
          busy={busy || refundBusy}
          onRecheck={(paymentId) => void confirm(paymentId)}
          onRefund={(order) => {
            setRefundNote(null)
            setRefunding(order)
          }}
          onMore={() => void store?.loadMore('payments')}
        />
        <TermsDetails />
      </section>

      <section className="stack-tight" aria-labelledby="billing-usage-title">
        <h2 id="billing-usage-title" className="section-title">
          쓴 내역
        </h2>
        <UsageHistory list={snapshot.usage} wide={wide} onMore={() => void store?.loadMore('usage')} />
      </section>

      {buying !== null ? <PurchaseDialog item={buying} status={status} onClose={() => setBuying(null)} onOrder={(order) => void onOrder(order)} /> : null}
      {testOrder !== null ? <TestPaymentDialog order={testOrder} onDone={onTestDone} /> : null}
      {refunding !== null ? <RefundDialog order={refunding} busy={refundBusy} onClose={() => setRefunding(null)} onRefund={() => void refund()} /> : null}
    </main>
  )
}
