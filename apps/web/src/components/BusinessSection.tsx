// 사업자 정보 (N5, BL-8 1·2, AC-N5-53, D-N5-10): 첫 결제 전에 받는다.
// - 칸: 사업자등록번호(숫자 키패드), 상호, 대표자 이름, 증빙 받을 이메일(선택).
// - 계좌이체 증빙은 현금영수증(지출증빙) 하나라 고르는 칸이 없다(PL1B, BL-8 1·6, D-PL1-07, AC-PL1B-05).
//   저장 본문의 `receiptKind`는 늘 `CASH_RECEIPT`. 조회의 옛 값(`TAX_INVOICE`)도 서버가 현금영수증으로 주지만, 화면도 늘 현금영수증으로 보인다.
// - 저장하면 번호는 서버가 가린 값(`123-45-*****`)만 보인다. "바꾸기"를 누르면 번호를 다시 모두 적는다 — 가린 값을 칸에 넣지 않는다.
// - 서버 오류 문장(칸마다 하나)을 그 칸 아래에 보인다. 휴대폰 번호 검사는 하지 않는다(판매자 자신의 정보).
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { isApiError, newRequestId, put, withRetry, type ApiError } from '../api/client.ts'
import type { BusinessView, ReceiptKind } from '../api/billing-types.ts'
import { RECEIPT_KIND_WORD, TAX_INVOICE_UNAVAILABLE, TRANSFER_RECEIPT_KIND_LINE } from '../lib/billing-words.ts'
import { FieldError } from './ErrorNote.tsx'
import { WriteError } from './forms.tsx'

const FIELDS = ['businessNumber', 'name', 'ceo', 'email', 'receiptKind'] as const
/** 계좌이체 증빙 — 지금은 이것 하나 (D-PL1-07) */
const TRANSFER_RECEIPT_KIND: ReceiptKind = 'CASH_RECEIPT'

export interface BusinessSectionProps {
  readonly business: BusinessView | null
  /** 바뀔 때마다 칸을 열고 첫 칸에 포커스 ("사업자 정보 적기") */
  readonly openSignal: number
  /** 저장한 뒤 (요금 상태를 새로 받는다) */
  readonly onSaved: () => void
}

export function BusinessSection({ business, openSignal, onSaved }: BusinessSectionProps) {
  const [editing, setEditing] = useState(false)
  /** 방금 저장한 값 — 요금 상태가 새로 올 때까지 보인다 */
  const [saved, setSaved] = useState<BusinessView | null>(null)
  const numberField = useRef<HTMLInputElement>(null)
  const shown = saved ?? business
  const formOpen = editing || shown === null || !shown.complete

  useEffect(() => setSaved(null), [business])

  const [focusWanted, setFocusWanted] = useState(false)

  useEffect(() => {
    if (openSignal === 0) return
    setEditing(true)
    setFocusWanted(true)
  }, [openSignal])

  // 칸이 그려진 뒤 번호 칸으로
  useEffect(() => {
    if (!focusWanted || !formOpen) return
    setFocusWanted(false)
    numberField.current?.scrollIntoView?.({ block: 'center' })
    numberField.current?.focus()
  }, [focusWanted, formOpen])

  if (!formOpen && shown !== null) {
    return (
      <div className="stack-tight">
        <dl className="facts">
          <div>
            <dt>사업자등록번호</dt>
            <dd>{shown.masked}</dd>
          </div>
          <div>
            <dt>상호</dt>
            <dd>{shown.name ?? ''}</dd>
          </div>
          <div>
            <dt>대표자</dt>
            <dd>{shown.ceo ?? ''}</dd>
          </div>
          <div>
            <dt>증빙 받을 이메일</dt>
            <dd>{shown.email ?? '없음'}</dd>
          </div>
          <div>
            <dt>계좌이체 증빙</dt>
            <dd>{RECEIPT_KIND_WORD[TRANSFER_RECEIPT_KIND]}</dd>
          </div>
        </dl>
        <div className="row">
          <button type="button" className="button" onClick={() => setEditing(true)}>
            바꾸기
          </button>
        </div>
      </div>
    )
  }
  return (
    <BusinessForm
      key={shown?.masked ?? 'new'}
      current={shown}
      numberField={numberField}
      onCancel={shown !== null && shown.complete ? () => setEditing(false) : null}
      onSaved={(view) => {
        setSaved(view)
        setEditing(false)
        onSaved()
      }}
    />
  )
}

interface BusinessFormProps {
  readonly current: BusinessView | null
  readonly numberField: RefObject<HTMLInputElement | null>
  readonly onCancel: (() => void) | null
  readonly onSaved: (view: BusinessView) => void
}

function BusinessForm({ current, numberField, onCancel, onSaved }: BusinessFormProps) {
  const ids = { number: useId(), name: useId(), ceo: useId(), email: useId() }
  const [number, setNumber] = useState('')
  const [name, setName] = useState(current?.name ?? '')
  const [ceo, setCeo] = useState(current?.ceo ?? '')
  const [email, setEmail] = useState(current?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const pending = useRef<{ key: string; requestId: string } | null>(null)

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (busy) return
    const body = { businessNumber: number, name: name.trim(), ceo: ceo.trim(), email: email.trim(), receiptKind: TRANSFER_RECEIPT_KIND }
    const key = JSON.stringify(body)
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const { requestId } = pending.current
    setBusy(true)
    setError(null)
    try {
      const view = await withRetry(() => put<BusinessView>('/api/billing/business', { requestId, ...body }))
      pending.current = null
      onSaved(view)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      if (!caught.transient) pending.current = null
      if (caught.problemFor('businessNumber') !== undefined) numberField.current?.focus()
      setBusy(false)
    }
  }

  const describedBy = (field: string, id: string) => (error?.problemFor(field) !== undefined ? `${id}-error` : undefined)

  return (
    <form className="stack-tight" aria-label="사업자 정보" onSubmit={(event) => void submit(event)}>
      {current !== null ? <p className="hint">적어 둔 번호: {current.masked} — 바꾸려면 번호를 다시 모두 적어 주세요.</p> : null}
      <div className="field">
        <label htmlFor={ids.number}>사업자등록번호</label>
        <input
          ref={numberField}
          id={ids.number}
          className="input"
          name="businessNumber"
          inputMode="numeric"
          autoComplete="off"
          placeholder="숫자 10자리"
          value={number}
          aria-invalid={error?.problemFor('businessNumber') !== undefined}
          aria-describedby={describedBy('businessNumber', ids.number)}
          onChange={(event) => setNumber(event.target.value)}
        />
        <FieldError error={error} field="businessNumber" id={`${ids.number}-error`} />
      </div>
      <div className="field">
        <label htmlFor={ids.name}>상호</label>
        <input
          id={ids.name}
          className="input"
          name="name"
          autoComplete="organization"
          value={name}
          aria-invalid={error?.problemFor('name') !== undefined}
          aria-describedby={describedBy('name', ids.name)}
          onChange={(event) => setName(event.target.value)}
        />
        <FieldError error={error} field="name" id={`${ids.name}-error`} />
      </div>
      <div className="field">
        <label htmlFor={ids.ceo}>대표자 이름</label>
        <input
          id={ids.ceo}
          className="input"
          name="ceo"
          autoComplete="name"
          value={ceo}
          aria-invalid={error?.problemFor('ceo') !== undefined}
          aria-describedby={describedBy('ceo', ids.ceo)}
          onChange={(event) => setCeo(event.target.value)}
        />
        <FieldError error={error} field="ceo" id={`${ids.ceo}-error`} />
      </div>
      <div className="field">
        <label htmlFor={ids.email}>증빙 받을 이메일 (선택)</label>
        <input
          id={ids.email}
          className="input"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          aria-invalid={error?.problemFor('email') !== undefined}
          aria-describedby={describedBy('email', ids.email)}
          onChange={(event) => setEmail(event.target.value)}
        />
        <FieldError error={error} field="email" id={`${ids.email}-error`} />
      </div>
      <div className="stack-tight">
        <p>{TRANSFER_RECEIPT_KIND_LINE}</p>
        <p className="hint">{TAX_INVOICE_UNAVAILABLE}</p>
        <FieldError error={error} field="receiptKind" />
      </div>
      {error !== null ? <WriteError error={error} omitFields={FIELDS} onRetry={() => void submit()} /> : null}
      <div className="row">
        <button type="submit" className="button button-primary" disabled={busy}>
          저장
        </button>
        {onCancel !== null ? (
          <button type="button" className="button" disabled={busy} onClick={onCancel}>
            취소
          </button>
        ) : null}
      </div>
    </form>
  )
}
