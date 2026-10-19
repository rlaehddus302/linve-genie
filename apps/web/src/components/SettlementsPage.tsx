// 정산 (SPEC §7 화면 4, STL-01·02·03·07·09, R-12, D-058, D-092, AC-S06-30~36).
// - 날짜 하나(구매자 화면과 같은 고르기)의 묶음 목록(코어 listSettlements — 그날의 지금의 구매자마다)과 위 요약, 상태 거르기·이름 찾기.
// - 자세히: 방송별 품목·합계, 계산 줄, 받은 금액·남은 금액·환불 필요, 기록 목록, 입력 넷(입금·배송비·할인/추가·환불) — 모두 확인 뒤 바로 보낸다.
// - 금액 칸은 원 단위(AC-S06-36). 입금 날짜는 적은 때로 남는다(실제 입금일은 메모).
// - 자세히의 포장 라벨(AC-I1-35): 쪽마다 미리 보기·출력·그림 파일·PDF·재출력 필요. 리허설 범위는 라벨이 없다(AC-I1-36).
import { containsPhoneRun, formatWon, type PaymentStatus } from '@livejjim/core'
import { useMemo, useRef, useState } from 'react'
import { isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import type { Claim, Settlement, WriteResult } from '../api/types.ts'
import { claimsOf } from '../lib/buyers.ts'
import type { ConsoleSnapshot, ConsoleStore } from '../lib/console-store.ts'
import { BuyerNames } from '../lib/derive.ts'
import { kstShort } from '../lib/kst.ts'
import { ADJUST_RANGE, PAYMENT_RANGE, SHIPPING_RANGE, readAmount, refundRange } from '../lib/money.ts'
import { routePath, type Navigate, type ScopeRoute } from '../lib/router.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import { settlementKey } from '../lib/scope-data.ts'
import { filterSettlements, previewWith, remainingOf, sortSettlements, summarize, type PaymentFilter } from '../lib/settlement.ts'
import { useScopeStore } from '../lib/use-store.ts'
import { PAYMENT_WORD, SHIPPING_WORD, paymentWord, recordKindWord, signedWon } from '../lib/words.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { PackingLabels } from './LabelParts.tsx'
import { AmountField, FieldNote, WriteError, serverProblem, useSender } from './forms.tsx'
import { LiveNotices } from './LiveNotices.tsx'
import { Modal } from './Modal.tsx'
import { ReasonField } from './ReasonField.tsx'
import { ScopePicker, useScopeChoice } from './ScopePicker.tsx'

export const REHEARSAL_SETTLEMENT = '리허설 — 실제 정산이 아니에요'
export const PAYMENT_DATE_NOTE = '입금 날짜는 적은 때로 남아요. 실제 입금일이 다르면 메모에 적어 주세요.'
export const REFUND_NOTE = '입금을 잘못 적었으면 같은 금액을 환불로 적어 바로잡아요.'
export const PHONE_IN_TEXT = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'
export const ADJUST_REASONS: readonly string[] = ['단골 할인', '포장 추가', '도서산간']
export const REFUND_REASONS: readonly string[] = ['환불함', '입금액 잘못 적음']

const FILTERS: readonly { readonly key: PaymentFilter; readonly word: string }[] = [
  { key: 'ALL', word: '전체' },
  { key: 'UNPAID', word: PAYMENT_WORD.UNPAID },
  { key: 'PARTIAL', word: PAYMENT_WORD.PARTIAL },
  { key: 'PAID', word: PAYMENT_WORD.PAID },
  { key: 'OVERPAID', word: PAYMENT_WORD.OVERPAID },
]

export function SettlementsPage({ route, navigate }: { readonly route: ScopeRoute; readonly navigate: Navigate }) {
  const choice = useScopeChoice(route, navigate)
  const scope = choice.scope
  const key = scope === null ? null : `${scope.date}|${String(scope.rehearsal)}`
  const { store, snapshot } = useScopeStore(key, () => ({ scope: scope ?? { date: '', rehearsal: false } }))
  return (
    <main className="page page-wide settlements-page">
      <h1>정산</h1>
      <div className="row scope-row">
        <ScopePicker route={route} navigate={navigate} days={choice.days} error={choice.error} onRetry={choice.retry} />
      </div>
      {route.rehearsal ? (
        <p className="rehearsal-banner" role="note">
          {REHEARSAL_SETTLEMENT}
        </p>
      ) : null}
      {scope === null ? (
        choice.days !== null ? <p>아직 판매 기록이 없어요.</p> : null
      ) : snapshot.phase === 'missing' ? (
        <p>아직 판매 기록이 없어요.</p>
      ) : snapshot.phase === 'error' && snapshot.error !== null ? (
        <ErrorNote error={snapshot.error} onRetry={() => window.location.reload()} retryLabel="다시 열기" />
      ) : store === null || snapshot.data === null ? (
        <>
          <div className="page-sticky">
            <LiveNotices snapshot={snapshot} onRetry={() => void store?.retryNow()} />
          </div>
          <p role="status">불러오는 중…</p>
        </>
      ) : (
        <ReadySettlements key={key} route={route} navigate={navigate} store={store} snapshot={snapshot} data={snapshot.data} />
      )}
    </main>
  )
}

interface ReadyProps {
  readonly route: ScopeRoute
  readonly navigate: Navigate
  readonly store: ConsoleStore
  readonly snapshot: ConsoleSnapshot
  readonly data: ScopeData
}

/** 정산 쓰기 (settlement.* — 날짜 범위로, 같은 요청 번호로 재시도 → 응답 seq까지 따라잡기) */
function useCommand(store: ConsoleStore, data: ScopeData) {
  return useMemo(
    () =>
      async (event: Readonly<Record<string, unknown>>, requestId: string = newRequestId()): Promise<WriteResult> => {
        let result: WriteResult
        try {
          result = await withRetry(() => post<WriteResult>(withQuery('/api/events', { date: data.date, rehearsal: data.rehearsal }), { requestId, ...event }))
        } catch (error) {
          // 서버가 처리하지 못한 입력은 "확인 필요"에 남았다 — 알림을 기다리지 않고 따라잡는다
          if (isApiError(error) && error.code === 'PROCESSING_FAILED') void store.catchUp()
          throw error
        }
        await store.sync(result.seq)
        return result
      },
    [store, data.date, data.rehearsal],
  )
}

function ReadySettlements({ route, navigate, store, snapshot, data }: ReadyProps) {
  const names = useMemo(() => new BuyerNames(data.buyers), [data.buyers])
  const command = useCommand(store, data)
  const open = (buyer: string | undefined) => navigate({ name: 'settlements', date: data.date, rehearsal: data.rehearsal, ...(buyer === undefined ? {} : { buyer }) })
  const selected = route.buyer === undefined ? undefined : data.settlements.get(settlementKey({ buyer: data.buyers.get(route.buyer)?.current ?? route.buyer, date: data.date }))
  return (
    <>
      <div className="page-sticky">
        <LiveNotices snapshot={snapshot} onRetry={() => void store.retryNow()} />
      </div>
      {route.buyer === undefined ? (
        <SettlementList data={data} names={names} onOpen={open} />
      ) : selected === undefined ? (
        <div className="stack-tight">
          <p>그 구매자의 정산 묶음이 없어요.</p>
          <button type="button" className="button" onClick={() => open(undefined)}>
            정산 목록으로
          </button>
        </div>
      ) : (
        <SettlementDetail key={selected.buyer} data={data} names={names} settlement={selected} command={command} onBack={() => open(undefined)} />
      )}
    </>
  )
}

// ── 목록 (AC-S06-30) ────────────────────────────────────────────────────

function shippingWords(settlement: Settlement): string {
  return settlement.shippingOverride === null ? formatWon(settlement.shipping) : `${SHIPPING_WORD[settlement.shippingOverride]} ${formatWon(settlement.shipping)}`
}

function SettlementList({ data, names, onOpen }: { readonly data: ScopeData; readonly names: BuyerNames; readonly onOpen: (buyer: string) => void }) {
  const [filter, setFilter] = useState<PaymentFilter>('ALL')
  const [query, setQuery] = useState('')
  const all = useMemo(() => [...data.settlements.values()].filter((item) => item.date === data.date), [data.settlements, data.date])
  const nameOf = (buyer: string) => names.name(buyer)
  const summary = useMemo(() => summarize(all), [all])
  const list = useMemo(() => sortSettlements(filterSettlements(all, filter, query, nameOf), nameOf), [all, filter, query, names])
  const statusLine = (['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID'] as const satisfies readonly PaymentStatus[]).map((status) => `${PAYMENT_WORD[status]} ${String(summary.byStatus[status])}`).join(' · ')
  return (
    <section className="stack" aria-label="정산 목록">
      <section className="card stack-tight" aria-label="정산 요약">
        <p>
          묶음 {summary.count}개 · {statusLine}
        </p>
        <dl className="facts">
          <div>
            <dt>최종 금액 합</dt>
            <dd>{formatWon(summary.total)}</dd>
          </div>
          <div>
            <dt>받은 금액 합</dt>
            <dd>{formatWon(summary.received)}</dd>
          </div>
          <div>
            <dt>남은 금액 합</dt>
            <dd>{formatWon(summary.remaining)}</dd>
          </div>
          <div>
            <dt>환불 필요 합</dt>
            <dd>{formatWon(summary.refundDue)}</dd>
          </div>
        </dl>
      </section>
      <div className="toolbar">
        <div className="row" role="group" aria-label="입금 상태로 거르기">
          {FILTERS.map((item) => (
            <button key={item.key} type="button" className="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
              {item.word}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="settlement-search">이름 찾기</label>
          <input id="settlement-search" className="input" type="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>
      {list.length === 0 ? <p>{all.length === 0 ? '그날 정산할 묶음이 없어요.' : '맞는 묶음이 없어요.'}</p> : null}
      <ul className="plain-list settlement-grid" aria-label="정산 묶음">
        {list.map((item) => (
          <li key={item.buyer}>
            <a
              className="list-link settlement-card"
              href={routePath({ name: 'settlements', date: data.date, rehearsal: data.rehearsal, buyer: item.buyer })}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey) return
                event.preventDefault()
                onOpen(item.buyer)
              }}
            >
              <strong className="buyer-name">{names.name(item.buyer)}</strong>
              <span className={`tag pay-${item.payment}`}>{paymentWord(item.payment, item.refundDue)}</span>
              <span>상품 {item.items.length}개 · {formatWon(item.subtotal)}</span>
              <span>배송비 {shippingWords(item)}</span>
              <span>조정 {signedWon(item.adjustments)}</span>
              <span>최종 {formatWon(item.total)}</span>
              <span>받은 금액 {formatWon(item.received)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── 자세히 (AC-S06-31) ──────────────────────────────────────────────────

type Command = (event: Readonly<Record<string, unknown>>, requestId?: string) => Promise<WriteResult>
type InputKind = 'payment' | 'shipping' | 'adjust' | 'refund'

interface DetailProps {
  readonly data: ScopeData
  readonly names: BuyerNames
  readonly settlement: Settlement
  readonly command: Command
  readonly onBack: () => void
}

function SettlementDetail({ data, names, settlement, command, onBack }: DetailProps) {
  const [input, setInput] = useState<InputKind | null>(null)
  const buyer = data.buyers.get(settlement.buyer)
  const claims = useMemo(() => claimsOf(data, settlement.buyer).filter((claim) => claim.status === 'CONFIRMED'), [data, settlement.buyer])
  const groups = useMemo(() => {
    const map = new Map<string, Claim[]>()
    for (const claim of claims) map.set(claim.broadcast, [...(map.get(claim.broadcast) ?? []), claim])
    const order = [...data.broadcasts.keys()]
    return [...map.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
  }, [claims, data.broadcasts])
  const remaining = remainingOf(settlement)
  const empty = settlement.items.length === 0
  return (
    <section className="stack settlement-detail" aria-label="정산 자세히">
      <button type="button" className="button back-button" onClick={onBack}>
        정산 목록으로
      </button>
      <h2 className="section-title">{names.name(settlement.buyer)}</h2>
      {buyer !== undefined && buyer.merged.length > 0 ? <p>합친 구매자: {buyer.merged.map((id) => names.name(id)).join(', ')}</p> : null}
      <p>
        <span className={`tag pay-${settlement.payment}`}>{paymentWord(settlement.payment, settlement.refundDue)}</span>
      </p>

      <section className="stack-tight" aria-label="품목">
        <h3 className="sub-title">품목</h3>
        {empty ? <p>취소되어 품목이 없어요</p> : null}
        {groups.map(([b, list]) => {
          const title = data.broadcasts.get(b)?.title ?? ''
          const sum = list.reduce((total, claim) => total + (claim.price ?? 0), 0)
          return (
            <div key={b} className="stack-tight">
              <h4 className="sub-title">{title}</h4>
              <ul className="plain-list">
                {list.map((claim) => {
                  const product = data.products.get(claim.product)
                  const name = product === undefined ? '' : product.name.trim() === '' ? '품종 미입력' : product.name
                  return (
                    <li key={claim.id}>
                      {claim.no}번 {name} {claim.price === null ? '' : formatWon(claim.price)}
                      {claim.buyer !== settlement.buyer ? ` · ${names.name(claim.buyer)}` : ''}
                    </li>
                  )
                })}
              </ul>
              <p>
                {title} 합계 {formatWon(sum)}
              </p>
            </div>
          )
        })}
      </section>

      <section className="stack-tight" aria-label="금액">
        <p className="total-line">
          상품 합계 {formatWon(settlement.subtotal)} + 배송비 {formatWon(settlement.shipping)}
          {settlement.shippingOverride !== null ? `(${SHIPPING_WORD[settlement.shippingOverride]})` : ''} + 조정 {signedWon(empty ? 0 : settlement.adjustments)} = 최종{' '}
          {formatWon(settlement.total)}
        </p>
        <p>
          받은 금액 {formatWon(settlement.received)} · 남은 금액 {formatWon(remaining)} · 환불 필요 {formatWon(settlement.refundDue)}
        </p>
      </section>

      <PackingLabels date={settlement.date} buyer={settlement.buyer} rehearsal={data.rehearsal} />

      <div className="row" role="group" aria-label="정산 입력">
        <button type="button" className="button button-primary" onClick={() => setInput('payment')}>
          입금 적기
        </button>
        <button type="button" className="button" onClick={() => setInput('shipping')}>
          배송비 바꾸기
        </button>
        <button type="button" className="button" onClick={() => setInput('adjust')}>
          할인·추가
        </button>
        <button type="button" className="button" onClick={() => setInput('refund')}>
          환불 적기
        </button>
      </div>

      <section className="stack-tight" aria-label="정산 기록">
        <h3 className="sub-title">기록</h3>
        {settlement.records.length === 0 ? <p>아직 기록이 없어요.</p> : null}
        <ul className="plain-list stack-tight">
          {settlement.records.map((record) => (
            <li key={record.seq} className="claim-row">
              <p>
                <strong>{recordKindWord(record.kind, record.amount)}</strong>{' '}
                {record.kind === 'shipping'
                  ? `${SHIPPING_WORD[record.mode ?? 'DEFAULT']}${record.mode === 'FIXED' && record.amount !== null ? ` ${formatWon(record.amount)}` : ''}`
                  : record.amount === null
                    ? ''
                    : formatWon(Math.abs(record.amount))}
                {record.reason !== null ? ` · ${record.reason}` : ''}
                {record.memo !== null ? ` · ${record.memo}` : ''}
                {` · 기록한 때 ${kstShort(record.at)}`}
                {record.buyer !== settlement.buyer ? ` · ${names.name(record.buyer)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {input === 'payment' ? <PaymentDialog settlement={settlement} command={command} onClose={() => setInput(null)} /> : null}
      {input === 'shipping' ? <ShippingDialog data={data} settlement={settlement} command={command} onClose={() => setInput(null)} /> : null}
      {input === 'adjust' ? <AdjustDialog data={data} settlement={settlement} command={command} onClose={() => setInput(null)} /> : null}
      {input === 'refund' ? <RefundDialog settlement={settlement} command={command} onClose={() => setInput(null)} /> : null}
    </section>
  )
}

interface InputDialogProps {
  readonly settlement: Settlement
  readonly command: Command
  readonly onClose: () => void
}

// ── 입금 (AC-S06-32) ────────────────────────────────────────────────────

function PaymentDialog({ settlement, command, onClose }: InputDialogProps) {
  const remaining = remainingOf(settlement)
  const [amount, setAmount] = useState(remaining > 0 ? String(remaining) : '')
  const [memo, setMemo] = useState('')
  const [tried, setTried] = useState(false)
  const [confirming, setConfirming] = useState<number | null>(null)
  const amountField = useRef<HTMLInputElement>(null)
  const sender = useSender(command)
  const read = readAmount(amount, PAYMENT_RANGE)
  const memoProblem = memo.trim() !== '' && containsPhoneRun(memo) ? PHONE_IN_TEXT : null

  const send = async (value: number) => {
    const result = await sender.send({ type: 'settlement.payment', buyer: settlement.buyer, date: settlement.date, amount: value, ...(memo.trim() === '' ? {} : { memo: memo.trim() }) })
    if (result !== null) onClose()
  }
  const submit = () => {
    setTried(true)
    if (read.kind !== 'ok' || memoProblem !== null) {
      amountField.current?.focus()
      return
    }
    if (read.amount !== remaining) {
      setConfirming(read.amount)
      return
    }
    void send(read.amount)
  }

  if (confirming !== null) {
    return (
      <Modal
        key="confirm"
        title="입금 금액 확인"
        closeLabel="고치기"
        onClose={() => {
          setConfirming(null)
          setTimeout(() => amountField.current?.focus(), 0)
        }}
        actions={
          <button type="button" className="button button-primary" disabled={sender.busy} onClick={() => void send(confirming)}>
            {formatWon(confirming)} 적기
          </button>
        }
      >
        <p>
          남은 금액({formatWon(remaining)})과 달라요. {formatWon(confirming)}으로 적을까요?
        </p>
        {sender.busy ? <p role="status">보내는 중…</p> : null}
        {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void send(confirming)} omitFields={['memo', 'amount']} /> : null}
        {serverProblem(sender.error, 'memo') !== null ? <p className="field-error">{serverProblem(sender.error, 'memo')}</p> : null}
      </Modal>
    )
  }
  return (
    <Modal
      key="form"
      title="입금 적기"
      onClose={onClose}
      actions={
        <button type="button" className="button button-primary" disabled={sender.busy} onClick={submit}>
          {sender.busy ? '보내는 중…' : '입금 적기'}
        </button>
      }
    >
      <form
        className="stack-tight"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <p>
          남은 금액 {formatWon(remaining)} · 최종 {formatWon(settlement.total)} · 받은 금액 {formatWon(settlement.received)}
        </p>
        <AmountField label="입금 금액" value={amount} onChange={setAmount} range={PAYMENT_RANGE} showEmpty={tried} inputRef={amountField} serverMessage={serverProblem(sender.error, 'amount')} />
        <div className="field">
          <label htmlFor="payment-memo">메모(선택)</label>
          <input id="payment-memo" className="input" autoComplete="off" placeholder="10/18 국민" value={memo} onChange={(event) => setMemo(event.target.value)} />
        </div>
        <FieldNote id="payment-memo-error" message={memoProblem ?? serverProblem(sender.error, 'memo')} />
        <p className="hint">{PAYMENT_DATE_NOTE}</p>
        <button type="submit" hidden />
      </form>
      {sender.error !== null ? <WriteError error={sender.error} onRetry={submit} omitFields={['memo', 'amount']} /> : null}
    </Modal>
  )
}

// ── 배송비 (AC-S06-33) ──────────────────────────────────────────────────

type ShippingChoice = 'DEFAULT' | 'PICKUP' | 'COMBINED' | 'FIXED'

function ShippingDialog({ data, settlement, command, onClose }: InputDialogProps & { readonly data: ScopeData }) {
  const [mode, setMode] = useState<ShippingChoice | null>(null)
  const [amount, setAmount] = useState('')
  const [tried, setTried] = useState(false)
  const sender = useSender(command)
  const choices: ShippingChoice[] = [...(settlement.shippingOverride === null ? [] : (['DEFAULT'] as const)), 'PICKUP', 'COMBINED', 'FIXED']
  const read = readAmount(amount, SHIPPING_RANGE)
  const fixedAmount = mode === 'FIXED' && read.kind === 'ok' ? read.amount : null
  const preview = mode === null || (mode === 'FIXED' && fixedAmount === null) ? null : previewWith(data, settlement, { kind: 'shipping', mode, amount: mode === 'FIXED' ? fixedAmount : null })
  const submit = async () => {
    setTried(true)
    if (mode === null || (mode === 'FIXED' && fixedAmount === null)) return
    const result = await sender.send({ type: 'settlement.shippingOverride', buyer: settlement.buyer, date: settlement.date, mode, ...(mode === 'FIXED' ? { amount: fixedAmount } : {}) })
    if (result !== null) onClose()
  }
  const word = (choice: ShippingChoice) => (choice === 'DEFAULT' ? '기본 배송비로' : SHIPPING_WORD[choice])
  return (
    <Modal
      title="배송비 바꾸기"
      onClose={onClose}
      actions={
        <button type="button" className="button button-primary" disabled={sender.busy || mode === null} onClick={() => void submit()}>
          {sender.busy ? '보내는 중…' : '배송비 바꾸기'}
        </button>
      }
    >
      <p>
        지금 배송비 {shippingWords(settlement)}
      </p>
      <div className="choice-list-plain" role="radiogroup" aria-label="배송비">
        {choices.map((choice) => (
          <label key={choice} className="choice">
            <input type="radio" name="shipping-mode" checked={mode === choice} onChange={() => setMode(choice)} />
            <span>{word(choice)}</span>
          </label>
        ))}
      </div>
      {mode === 'FIXED' ? <AmountField label="배송비 금액" value={amount} onChange={setAmount} range={SHIPPING_RANGE} showEmpty={tried} serverMessage={serverProblem(sender.error, 'amount')} /> : null}
      {preview !== null ? (
        <p className="notice" role="status">
          배송비 {formatWon(settlement.shipping)} → {formatWon(preview.shipping)}, 최종 {formatWon(settlement.total)} → {formatWon(preview.total)}
        </p>
      ) : null}
      {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void submit()} omitFields={['amount']} /> : null}
    </Modal>
  )
}

// ── 할인·추가 (AC-S06-34) ───────────────────────────────────────────────

function AdjustDialog({ data, settlement, command, onClose }: InputDialogProps & { readonly data: ScopeData }) {
  const [sign, setSign] = useState<'minus' | 'plus'>('minus')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [empty, setEmpty] = useState(false)
  const [tried, setTried] = useState(false)
  const reasonField = useRef<HTMLInputElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const sender = useSender(command)
  const read = readAmount(amount, ADJUST_RANGE)
  const signed = read.kind === 'ok' ? (sign === 'minus' ? -read.amount : read.amount) : null
  const preview = signed === null ? null : previewWith(data, settlement, { kind: 'adjust', amount: signed })
  const floored = preview !== null && settlement.items.length > 0 && settlement.subtotal + preview.shipping + preview.adjustments < 0
  const reasonProblem = reason.trim() !== '' && containsPhoneRun(reason) ? PHONE_IN_TEXT : null
  const verb = sign === 'minus' ? '할인 적기' : '추가 적기'
  const submit = async () => {
    setTried(true)
    if (signed === null) return
    const value = reason.trim()
    if (value === '') {
      setEmpty(true)
      reasonField.current?.focus()
      return
    }
    if (reasonProblem !== null) return
    const result = await sender.send({ type: 'settlement.adjust', buyer: settlement.buyer, date: settlement.date, amount: signed, reason: value })
    if (result !== null) onClose()
  }
  return (
    <Modal
      title="할인·추가"
      onClose={onClose}
      actions={
        <button ref={submitButton} type="button" className="button button-primary" disabled={sender.busy} onClick={() => void submit()}>
          {sender.busy ? '보내는 중…' : verb}
        </button>
      }
    >
      <div className="row" role="radiogroup" aria-label="할인 또는 추가">
        <label className="choice">
          <input type="radio" name="adjust-sign" checked={sign === 'minus'} onChange={() => setSign('minus')} />
          <span>할인</span>
        </label>
        <label className="choice">
          <input type="radio" name="adjust-sign" checked={sign === 'plus'} onChange={() => setSign('plus')} />
          <span>추가</span>
        </label>
      </div>
      <AmountField label={sign === 'minus' ? '할인 금액' : '추가 금액'} value={amount} onChange={setAmount} range={ADJUST_RANGE} showEmpty={tried} serverMessage={serverProblem(sender.error, 'amount')} />
      {preview !== null ? (
        <p className="notice" role="status">
          최종 {formatWon(settlement.total)} → {formatWon(preview.total)}
        </p>
      ) : null}
      {floored ? <p className="warning">할인이 금액보다 커서 최종 금액은 0원이에요.</p> : null}
      <ReasonField
        value={reason}
        onChange={(value) => {
          setReason(value)
          setEmpty(false)
        }}
        onPicked={() => submitButton.current?.focus()}
        reasons={ADJUST_REASONS}
        empty={empty}
        problem={reasonProblem}
        error={sender.error}
        inputRef={reasonField}
        onEnter={() => void submit()}
      />
      {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void submit()} omitFields={['reason', 'amount']} /> : null}
    </Modal>
  )
}

// ── 환불 (AC-S06-35) ────────────────────────────────────────────────────

function RefundDialog({ settlement, command, onClose }: InputDialogProps) {
  const [amount, setAmount] = useState(settlement.payment === 'OVERPAID' && settlement.refundDue > 0 ? String(settlement.refundDue) : '')
  const [reason, setReason] = useState('')
  const [empty, setEmpty] = useState(false)
  const [tried, setTried] = useState(false)
  const reasonField = useRef<HTMLInputElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const sender = useSender(command)
  const range = refundRange(settlement.received)
  const read = readAmount(amount, range)
  const reasonProblem = reason.trim() !== '' && containsPhoneRun(reason) ? PHONE_IN_TEXT : null
  const submit = async () => {
    setTried(true)
    if (read.kind !== 'ok') return
    const value = reason.trim()
    if (value === '') {
      setEmpty(true)
      reasonField.current?.focus()
      return
    }
    if (reasonProblem !== null) return
    const result = await sender.send({ type: 'settlement.refund', buyer: settlement.buyer, date: settlement.date, amount: read.amount, reason: value })
    if (result !== null) onClose()
  }
  return (
    <Modal
      title="환불 적기"
      onClose={onClose}
      actions={
        <button ref={submitButton} type="button" className="button button-primary" disabled={sender.busy} onClick={() => void submit()}>
          {sender.busy ? '보내는 중…' : '환불 적기'}
        </button>
      }
    >
      <p>
        받은 금액 {formatWon(settlement.received)}
        {settlement.refundDue > 0 ? ` · 환불 필요 ${formatWon(settlement.refundDue)}` : ''}
      </p>
      <AmountField label="환불 금액" value={amount} onChange={setAmount} range={range} showEmpty={tried} serverMessage={serverProblem(sender.error, 'amount')} />
      <p className="hint">{REFUND_NOTE}</p>
      <ReasonField
        value={reason}
        onChange={(value) => {
          setReason(value)
          setEmpty(false)
        }}
        onPicked={() => submitButton.current?.focus()}
        reasons={REFUND_REASONS}
        empty={empty}
        problem={reasonProblem}
        error={sender.error}
        inputRef={reasonField}
        onEnter={() => void submit()}
      />
      {sender.error !== null ? <WriteError error={sender.error} onRetry={() => void submit()} omitFields={['reason', 'amount']} /> : null}
    </Modal>
  )
}
