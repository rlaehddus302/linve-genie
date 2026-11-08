// 손님 기록 화면 조각 (CRM1, SPEC BUY-06·BUY-07, D-CRM1-06·D-CRM1-08): 꼬리표, 구매자 자세히의 "손님 기록" 칸, 메모 칸.
// - 꼬리표는 글자 + 색(UX-04): "단골"(차분한 색)·"입금 늦음 주의"(주의 색)·"차단".
// - 메모·이름은 늘 글자로만(React 기본 이스케이프, 절대 규칙 7). 메모 저장은 바로(5초 대기 조치 아님), 이벤트가 아니다.
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
import { Modal } from './Modal.tsx'

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
            <MemberMemo key={`${member.buyer}|${member.customer ?? ''}`} member={member} today={base} />
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

/** 쓰는 중에 다른 기기가 메모를 바꿨을 때 (TE-CRM1-004) — 친 글은 그대로 두고 알린다 */
export const MEMO_CHANGED_ELSEWHERE = '다른 기기에서 이 손님 메모를 바꿨어요. 위에 보이는 것이 지금 저장된 메모예요. 쓰던 글을 남기려면 "메모 저장"을 눌러 주세요.'

/** 빈 글로 저장할 때 묻는 창 (D-CRM1-16 (1), U-CRM1-02) */
export const MEMO_CLEAR_TITLE = '메모를 지울까요?'
export const MEMO_CLEAR_MESSAGE = '지우면 이 손님 메모가 보이지 않아요. 잘못 비웠다면 "그대로 두기"를 눌러 주세요.'
export const MEMO_CLEAR_CONFIRM = '지우기'
export const MEMO_CLEAR_KEEP = '그대로 두기'

const memoKey = (memo: MemoView | null): string => (memo === null ? '' : `${memo.savedAt}|${memo.text}`)

/**
 * 메모 칸 하나 (BUY-07, D-CRM1-08): 마지막 메모와 "10월 26일(월) 저장", 글 칸, "메모 저장"(바로), 안내 "연락처·주소는 적지 마세요.".
 * 저장된 메모가 있는데 빈 글로 저장하면 "메모를 지울까요?"를 묻는다 — [지우기]면 지우고, [그대로 두기]면 저장하지 않고 칸에 저장된 글을 되돌린다(D-CRM1-16 (1)). 서버가 거절하면(번호·길이·제어 글자) 칸 아래 서버 문장 — 친 글은 그대로 둔다.
 * 다시 받은 메모(다른 기기 저장)는 저장된 메모 자리에 바로 보이고, 글 칸은 저장하지 않은 글이 없을 때만 따라간다 —
 * 쓰는 중이면 친 글을 그대로 두고 MEMO_CHANGED_ELSEWHERE로 알린다(D-CRM1-08 "나중 것이 마지막"은 저장끼리의 순서, 입력을 지우지 않는다 — TE-CRM1-004).
 */
export function MemoEditor({ customer, label, memo: initial, today }: { readonly customer: string; readonly label: string; readonly memo: MemoView | null; readonly today: string }) {
  const id = useId()
  const [memo, setMemo] = useState<MemoView | null>(initial)
  const [text, setText] = useState(initial?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [changedElsewhere, setChangedElsewhere] = useState(false)
  const [seen, setSeen] = useState(memoKey(initial))
  const [asking, setAsking] = useState(false)
  const saved = memo?.text ?? ''
  const dirty = text.trim() !== saved
  // 부르는 쪽이 새 메모를 받아 오면(다른 기기 저장) 그린 중에 맞춘다
  if (seen !== memoKey(initial)) {
    setSeen(memoKey(initial))
    const incoming = initial?.text ?? ''
    if (memoKey(initial) !== memoKey(memo)) setMemo(initial)
    if (!dirty) {
      setText(incoming)
      setChangedElsewhere(false)
    } else if (text.trim() !== incoming) {
      setChangedElsewhere(true)
      setDone(null)
    } else setChangedElsewhere(false)
  }
  useUnsavedGuard(dirty)
  const tooLong = codePoints(text.trim()) > MEMO_MAX
  const problem = error?.problemFor('text')
  const message = tooLong ? MEMO_TOO_LONG : problem?.message
  const save = async () => {
    if (busy) return
    setAsking(false)
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const result = await put<{ memo: MemoView | null }>(`/api/customers/${customer}/memo`, { text })
      setMemo(result.memo)
      setText(result.memo?.text ?? '')
      setChangedElsewhere(false)
      setDone(result.memo === null ? MEMO_CLEARED : MEMO_SAVED)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  // 저장된 메모를 빈 글로 덮으면 먼저 묻는다 (한 손 엄지로 잘못 비운 메모는 화면에서 되살릴 길이 없다)
  const askOrSave = () => {
    if (busy) return
    if (text.trim() === '' && memo !== null) {
      setDone(null)
      setAsking(true)
      return
    }
    void save()
  }
  const keep = () => {
    setAsking(false)
    setText(memo?.text ?? '')
    setError(null)
    setChangedElsewhere(false)
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
        <button type="button" className="button" aria-label={`메모 저장 — ${label}`} disabled={busy || tooLong} onClick={askOrSave}>
          {busy ? '저장하는 중…' : '메모 저장'}
        </button>
      </div>
      {changedElsewhere && dirty ? (
        <p className="notice" role="status" data-tone="warning">
          {MEMO_CHANGED_ELSEWHERE}
        </p>
      ) : null}
      {done !== null ? (
        <p className="notice" role="status" data-tone="success">
          {done}
        </p>
      ) : null}
      {error !== null && problem === undefined ? <RequestError error={error} onRetry={() => void save()} /> : null}
      {asking ? (
        <Modal
          title={MEMO_CLEAR_TITLE}
          onClose={keep}
          closeLabel={MEMO_CLEAR_KEEP}
          unlocked
          actions={
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void save()}>
              {MEMO_CLEAR_CONFIRM}
            </button>
          }
        >
          <p>{MEMO_CLEAR_MESSAGE}</p>
          <p className="hint">{label}</p>
        </Modal>
      ) : null}
    </div>
  )
}
