// 손님 기록 화면 조각 (CRM1, SPEC BUY-06·BUY-07, D-CRM1-06·D-CRM1-08): 꼬리표, 구매자 자세히의 "손님 기록" 칸, 메모 칸.
// - 꼬리표는 글자 + 색(UX-04): "단골"(차분한 색)·"입금 늦음 주의"(주의 색)·"차단".
// - 메모·이름은 늘 글자로만(React 기본 이스케이프, 절대 규칙 7). 메모 저장은 바로(5초 대기 조치 아님), 이벤트가 아니다.
// - 판매자 계정만 부르는 경로다(보조자 403) — 보조자 화면은 구매자 화면에 오지 않는다.
import { useEffect, useId, useState } from 'react'
import { get, isApiError, put, type ApiError } from '../api/client.ts'
import {
  BLOCKED_WORD,
  CAUTION_WORD,
  CUSTOMER_LOAD_FAILED,
  MEMO_CLEARED,
  MEMO_HINT,
  MEMO_MAX,
  MEMO_SAVED,
  MEMO_TOO_LONG,
  NO_PHONE_MEMO,
  REGULAR_WORD,
  codePoints,
  dayCustomerPath,
  memberLabel,
  memoSavedWords,
  summaryLines,
  type CustomerSummary,
  type DayCustomerView,
  type DayMember,
  type MemoView,
} from '../lib/customers.ts'
import { useUnsavedGuard } from '../lib/leave-guard.ts'
import { RequestError } from './ErrorNote.tsx'

/** 꼬리표 (기록이 없으면 아무것도) — 차단은 부르는 쪽이 따로 */
export function CustomerTags({ summary, blocked = false }: { readonly summary: Pick<CustomerSummary, 'regular' | 'caution'> | undefined; readonly blocked?: boolean }) {
  return (
    <>
      {summary?.regular === true ? <span className="tag tag-regular">{REGULAR_WORD}</span> : null}
      {summary?.caution === true ? <span className="tag tag-caution">{CAUTION_WORD}</span> : null}
      {blocked ? <span className="tag tag-alert">{BLOCKED_WORD}</span> : null}
    </>
  )
}

/** 손님 기록 칸의 숫자 줄 + 꼬리표 */
export function SummaryFacts({ summary, today }: { readonly summary: CustomerSummary; readonly today: string }) {
  const lines = summaryLines(summary, today)
  return (
    <>
      <ul className="plain-list customer-facts">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {summary.regular || summary.caution ? (
        <p className="cell-marks">
          <CustomerTags summary={summary} />
        </p>
      ) : null}
    </>
  )
}

/**
 * 구매자 자세히의 "손님 기록" 칸 (실제 날짜만, "지난 구매" 위, AC-CRM1-15·21·23): 숫자 줄·꼬리표·묶음 구성원마다 메모 칸.
 * refreshKey가 바뀌면 다시 받는다(합치기·떼어 내기·입금). 없는 날짜·구매자(404)면 칸을 두지 않는다.
 */
export function CustomerRecord({ date, buyer, today, refreshKey }: { readonly date: string; readonly buyer: string; readonly today: string | null; readonly refreshKey: string }) {
  const [view, setView] = useState<DayCustomerView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setError(null)
    get<DayCustomerView>(dayCustomerPath(date, buyer)).then(
      (result) => {
        if (alive) setView(result)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [date, buyer, refreshKey, attempt])
  // 없는 날짜·구매자는 칸이 없다 (보일 숫자가 없다)
  if (error !== null && error.status === 404 && view === null) return null
  const base = today ?? date
  return (
    <section className="stack-tight customer-record" aria-label="손님 기록">
      <h3 className="sub-title">손님 기록</h3>
      {view === null && error === null ? <p role="status">불러오는 중…</p> : null}
      {view !== null ? (
        <>
          <SummaryFacts summary={view.summary} today={base} />
          {view.members.map((member) => (
            <MemberMemo key={`${member.buyer}|${member.memo?.savedAt ?? ''}`} member={member} today={base} />
          ))}
        </>
      ) : null}
      {error !== null && error.status !== 404 ? (
        <>
          <p>{CUSTOMER_LOAD_FAILED}</p>
          <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" />
        </>
      ) : null}
    </section>
  )
}

function MemberMemo({ member, today }: { readonly member: DayMember; readonly today: string }) {
  const label = memberLabel(member)
  if (member.customer === null) {
    return (
      <div className="stack-tight memo-box">
        <h4 className="sub-title">메모 · {label}</h4>
        <p className="hint">{NO_PHONE_MEMO}</p>
      </div>
    )
  }
  return <MemoEditor customer={member.customer} label={label} memo={member.memo} today={today} />
}

/**
 * 메모 칸 하나 (BUY-07, D-CRM1-08): 마지막 메모와 "10월 26일(월) 저장", 글 칸, "메모 저장"(바로), 안내 "연락처·주소는 적지 마세요.".
 * 빈 글로 저장하면 지운다. 서버가 거절하면(번호·길이·제어 글자) 칸 아래 서버 문장 — 친 글은 그대로 둔다.
 */
export function MemoEditor({ customer, label, memo: initial, today }: { readonly customer: string; readonly label: string; readonly memo: MemoView | null; readonly today: string }) {
  const id = useId()
  const [memo, setMemo] = useState<MemoView | null>(initial)
  const [text, setText] = useState(initial?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const saved = memo?.text ?? ''
  const dirty = text.trim() !== saved
  useUnsavedGuard(dirty)
  const tooLong = codePoints(text.trim()) > MEMO_MAX
  const problem = error?.problemFor('text')
  const message = tooLong ? MEMO_TOO_LONG : problem?.message
  const save = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const result = await put<{ memo: MemoView | null }>(`/api/customers/${customer}/memo`, { text })
      setMemo(result.memo)
      setText(result.memo?.text ?? '')
      setDone(result.memo === null ? MEMO_CLEARED : MEMO_SAVED)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack-tight memo-box">
      <h4 className="sub-title" id={`${id}-title`}>
        메모 · {label}
      </h4>
      {memo !== null ? (
        <div className="memo-saved">
          <p className="memo-text">{memo.text}</p>
          <p className="hint">{memoSavedWords(memo.savedAt, today)}</p>
        </div>
      ) : (
        <p className="hint">메모 없음</p>
      )}
      <div className="field">
        <label htmlFor={`${id}-text`}>메모 — {label}</label>
        <textarea
          id={`${id}-text`}
          className="input memo-input"
          rows={3}
          value={text}
          aria-invalid={message !== undefined}
          aria-describedby={message === undefined ? `${id}-hint` : `${id}-hint ${id}-error`}
          onChange={(event) => {
            setText(event.target.value)
            setDone(null)
            if (error !== null) setError(null)
          }}
        />
        <p className="hint" id={`${id}-hint`}>
          {MEMO_HINT} ({String(codePoints(text.trim()))}/{String(MEMO_MAX)}자)
        </p>
        {message !== undefined ? (
          <p className="field-error" role="alert" id={`${id}-error`}>
            {message}
            {problem?.hint !== undefined && !tooLong ? ` ${problem.hint}` : ''}
          </p>
        ) : null}
      </div>
      <div className="row">
        <button type="button" className="button" aria-label={`메모 저장 — ${label}`} disabled={busy || tooLong} onClick={() => void save()}>
          {busy ? '저장하는 중…' : '메모 저장'}
        </button>
      </div>
      {done !== null ? (
        <p className="notice" role="status" data-tone="success">
          {done}
        </p>
      ) : null}
      {error !== null && problem === undefined ? <RequestError error={error} onRetry={() => void save()} /> : null}
    </div>
  )
}
