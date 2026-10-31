// 손님 장부 화면 조각 (KP1 CR-2~CR-5·CR-7, AC-KP1-04·07·08·11·15).
// - 설정 "손님 관리"의 장부 칸: 보관 기간(6개월·1년·2년·3년)·"방송 화면에 손님 표시"(켜기·끄기 + 설명). 저장은 설정 화면 아래 저장 막대 하나.
// - 묶음 자세히의 "지난 주문 배송지예요 — 확인해 주세요" + 다섯 칸 + [배송지 확인]·[고치기]. 판매자 저장엔 동의 칸이 없다(AC-KP1-04).
// - 손님 자세히의 "저장한 배송지" 칸(UX-KP1-014 — 판매자 화면엔 "장부" 낱말을 쓰지 않는다): 가린 받는 분·연락처 끝 4자리·보관 끝나는 날, "이 손님이 직접 이은 계정: …", [저장한 배송지 지우기] + 확인 창.
// - 이름·주소·계정 이름은 React 기본 이스케이프로만 그린다. 장부를 만드는 판매자 길은 없다.
import { useEffect, useId, useRef, useState } from 'react'
import { isApiError, type ApiError } from '../api/client.ts'
import { customerDate } from '../lib/customers.ts'
import { kstDate } from '../lib/kst.ts'
import {
  CONSOLE_BADGES_DETAIL,
  CONSOLE_BADGES_HELP,
  CONSOLE_BADGES_LABEL,
  CONSOLE_BADGES_UNDECIDED,
  LEDGER_DELETE,
  LEDGER_DELETE_ASK,
  LEDGER_DELETE_TITLE,
  LEDGER_DELETED,
  LEDGER_MONTHS,
  LEDGER_MONTHS_HELP,
  LEDGER_MONTHS_LABEL,
  LEDGER_MONTH_WORDS,
  LEDGER_NONE,
  LEDGER_SHRINK_KEEP,
  LEDGER_SHRINK_NOTE,
  LEDGER_SHRINK_OK,
  LEDGER_SHRINK_TITLE,
  LEDGER_TITLE,
  LINKED_PREFIX,
  PREFILL_HELP,
  PREFILL_TITLE,
  deleteCustomerLedger,
  fetchShrinkPreview,
  shrinkAsk,
  fetchLedgerSettings,
  saveLedgerSettings,
  type CustomerLedgerView,
  type LedgerMonths,
  type LedgerPrefill,
  type LedgerSettings,
} from '../lib/ledger.ts'
import { phoneWords } from '../lib/parcel-words.ts'
import { RequestError } from './ErrorNote.tsx'
import { Lock } from './Lock.tsx'
import { Modal } from './Modal.tsx'

// ── 설정 "손님 관리"의 장부 칸 ───────────────────────────────────────

export interface LedgerDraft {
  /** 받은 설정 (아직 없으면 null) */
  readonly settings: LedgerSettings | null
  readonly draft: LedgerSettings | null
  readonly dirty: boolean
  readonly loadError: ApiError | null
  readonly error: ApiError | null
  readonly change: (patch: Partial<LedgerSettings>) => void
  readonly retry: () => void
  /**
   * 바뀌었으면 보낸다: 'none'(바뀐 것 없음·[그대로 두기])·'saved'·'failed'.
   * 보관 기간을 줄였으면 보내기 전에 서버가 센 곧 지워질 손님 수를 받아, 1명 이상(또는 세지 못함)이면 확인 창을 띄우고 답을 기다린다(D-KP1-45).
   */
  readonly save: () => Promise<'none' | 'saved' | 'failed'>
  /** 줄이기 확인 창 (없으면 null) — willDelete가 null이면 수를 받지 못함 */
  readonly shrinkAsk: { readonly from: LedgerMonths; readonly to: LedgerMonths; readonly willDelete: number | null } | null
  /** 확인 창 답: true = [줄이기], false = [그대로 두기](기간을 저장된 값으로 되돌리고 보내지 않는다) */
  readonly answerShrink: (ok: boolean) => void
}

export function useLedgerDraft(): LedgerDraft {
  const [settings, setSettings] = useState<LedgerSettings | null>(null)
  const [draft, setDraft] = useState<LedgerSettings | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const busy = useRef(false)
  const [shrinkAsk, setShrinkAsk] = useState<LedgerDraft['shrinkAsk']>(null)
  const answer = useRef<((ok: boolean) => void) | null>(null)
  const dirty = settings !== null && draft !== null && (settings.months !== draft.months || settings.consoleBadges !== draft.consoleBadges)

  useEffect(() => {
    let alive = true
    fetchLedgerSettings().then(
      (result) => {
        if (!alive) return
        setSettings(result)
        setDraft(result)
        setLoadError(null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setLoadError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  return {
    settings,
    draft,
    dirty,
    loadError,
    error,
    change: (patch) => {
      setDraft((current) => (current === null ? current : { ...current, ...patch }))
      setError(null)
    },
    retry: () => setAttempt((n) => n + 1),
    shrinkAsk,
    answerShrink: (ok) => {
      const resolve = answer.current
      answer.current = null
      setShrinkAsk(null)
      resolve?.(ok)
    },
    save: async () => {
      if (busy.current || draft === null || settings === null || !dirty) return 'none'
      busy.current = true
      setError(null)
      try {
        if (draft.months < settings.months) {
          let willDelete: number | null
          try {
            willDelete = await fetchShrinkPreview(draft.months)
          } catch {
            willDelete = null // 세지 못하면 수 없이 묻는다 (지워질 수 있으니 묻는 쪽)
          }
          if (willDelete === null || willDelete >= 1) {
            const ok = await new Promise<boolean>((resolve) => {
              answer.current = resolve
              setShrinkAsk({ from: settings.months, to: draft.months, willDelete })
            })
            if (!ok) {
              const keep = settings.months
              setDraft((current) => (current === null ? current : { ...current, months: keep }))
              return 'none'
            }
          }
        }
        const saved = await saveLedgerSettings(draft)
        setSettings(saved)
        setDraft(saved)
        return 'saved'
      } catch (caught) {
        if (!isApiError(caught)) throw caught
        setError(caught)
        return 'failed'
      } finally {
        busy.current = false
      }
    },
  }
}

/** 보관 기간·방송 화면에 손님 표시 칸 (설정 "손님 관리" 안) */
export function LedgerSettingsFields({ ledger }: { readonly ledger: LedgerDraft }) {
  const id = useId()
  if (ledger.draft === null) {
    return ledger.loadError !== null ? <RequestError error={ledger.loadError} onRetry={ledger.retry} retryLabel="다시 불러오기" /> : <p role="status">저장한 배송지 설정을 불러오는 중…</p>
  }
  const draft = ledger.draft
  const savedMonths = ledger.settings?.months ?? draft.months
  const ask = ledger.shrinkAsk
  const shrunk = draft.months < savedMonths
  const monthsProblem = ledger.error?.problemFor('months')
  const badgesProblem = ledger.error?.problemFor('consoleBadges')
  const outside = ledger.error !== null && monthsProblem === undefined && badgesProblem === undefined
  return (
    <div className="stack-tight ledger-settings kp1-seller">
      <fieldset className="field ledger-months" aria-describedby={`${id}-months-help`}>
        <legend>{LEDGER_MONTHS_LABEL}</legend>
        <div className="row ledger-month-row">
          {LEDGER_MONTHS.map((months) => (
            <label key={months} className="choice ledger-choice">
              <input type="radio" name={`${id}-months`} value={String(months)} checked={draft.months === months} onChange={() => ledger.change({ months })} />
              <span>{LEDGER_MONTH_WORDS[months]}</span>
            </label>
          ))}
        </div>
        <p className="hint" id={`${id}-months-help`}>
          {LEDGER_MONTHS_HELP}
        </p>
        {shrunk ? (
          <p className="notice" role="note" data-tone="warning">
            {LEDGER_SHRINK_NOTE}
          </p>
        ) : null}
        {monthsProblem !== undefined ? (
          <p className="field-error" role="alert">
            {monthsProblem.message}
          </p>
        ) : null}
      </fieldset>
      <div className="field">
        <label className="choice ledger-choice">
          <input
            type="checkbox"
            checked={draft.consoleBadges === true}
            aria-describedby={`${draft.consoleBadges === null ? `${id}-badges-undecided ` : ''}${id}-badges-help ${id}-badges-detail`}
            onChange={(event) => ledger.change({ consoleBadges: event.target.checked })}
          />
          <span>{CONSOLE_BADGES_LABEL}</span>
        </label>
        {draft.consoleBadges === null ? (
          <p className="notice" role="note" data-tone="warning" id={`${id}-badges-undecided`}>
            {CONSOLE_BADGES_UNDECIDED}
          </p>
        ) : null}
        <p className="hint" id={`${id}-badges-help`}>
          {CONSOLE_BADGES_HELP}
        </p>
        <p className="hint" id={`${id}-badges-detail`}>
          {CONSOLE_BADGES_DETAIL}
        </p>
        {badgesProblem !== undefined ? (
          <p className="field-error" role="alert">
            {badgesProblem.message}
          </p>
        ) : null}
      </div>
      {outside && ledger.error !== null ? <RequestError error={ledger.error} /> : null}
      {ask !== null ? (
        <Modal
          title={LEDGER_SHRINK_TITLE}
          className="kp1-seller"
          onClose={() => ledger.answerShrink(false)}
          closeLabel={LEDGER_SHRINK_KEEP}
          actions={
            <button type="button" className="button button-danger button-tall" onClick={() => ledger.answerShrink(true)}>
              {LEDGER_SHRINK_OK}
            </button>
          }
        >
          <p>
            {LEDGER_MONTH_WORDS[ask.from]} → {LEDGER_MONTH_WORDS[ask.to]}
          </p>
          <p>{shrinkAsk(ask.willDelete)}</p>
        </Modal>
      ) : null}
    </div>
  )
}

// ── 묶음 자세히의 "지난 주문 배송지" (CR-4, AC-KP1-08) ───────────────

export function LedgerPrefillBlock({ prefill, busy, onConfirm, onEdit }: { readonly prefill: LedgerPrefill; readonly busy: boolean; readonly onConfirm: () => void; readonly onEdit: () => void }) {
  return (
    <section className="stack-tight ledger-prefill kp1-seller" aria-label={PREFILL_TITLE}>
      <p className="notice" role="note" data-tone="warning">
        <strong>{PREFILL_TITLE}</strong>
      </p>
      <dl className="facts address-facts">
        <div>
          <dt>받는 분</dt>
          <dd>{prefill.name}</dd>
        </div>
        <div>
          <dt>연락처</dt>
          <dd>{phoneWords(prefill.phone)}</dd>
        </div>
        <div>
          <dt>주소</dt>
          <dd className="address-text">{prefill.address}</dd>
        </div>
        <div>
          <dt>상세 주소</dt>
          <dd className="address-text">{prefill.detail === '' ? '없음' : prefill.detail}</dd>
        </div>
        <div>
          <dt>우편번호</dt>
          <dd>{prefill.zip === '' ? '없음' : prefill.zip}</dd>
        </div>
      </dl>
      <p className="row">
        <span className="tag" data-tone="warning">
          확인 전
        </span>
      </p>
      <p className="hint">{PREFILL_HELP}</p>
      <Lock>
        <div className="row" role="group" aria-label="지난 주문 배송지">
          <button type="button" className="button button-primary button-tall" disabled={busy} onClick={onConfirm}>
            배송지 확인
          </button>
          <button type="button" className="button button-tall" disabled={busy} onClick={onEdit}>
            고치기
          </button>
        </div>
      </Lock>
    </section>
  )
}

/** [고치기] 양식의 처음 값: 장부 다섯 칸 + 빈 메모 (계약 §3.3) */
export function prefillAddress(prefill: LedgerPrefill) {
  return { name: prefill.name, phone: prefill.phone, address: prefill.address, detail: prefill.detail, zip: prefill.zip, memo: '' }
}

// ── 손님 자세히의 장부 칸 (AC-KP1-07·11) ─────────────────────────────

/** "이 손님이 직접 이은 계정: 유튜브 홍길동(끝 1234) · 10월 31일" (여럿이면 ", "로) */
export function linkedLine(linked: CustomerLedgerView['linked'], today: string): string | null {
  if (linked.length === 0) return null
  return `${LINKED_PREFIX}${linked.map((item) => `${item.label} · ${customerDate(kstDate(item.linkedAt), today)}`).join(', ')}`
}

export function CustomerLedgerSection({ customerId, ledger, today, onDeleted }: { readonly customerId: string; readonly ledger: CustomerLedgerView | null; readonly today: string; readonly onDeleted: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState(false)
  const running = useRef(false)

  const remove = async () => {
    if (ledger === null || running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await deleteCustomerLedger(customerId, ledger.ledgerId)
      setAsking(false)
      setDone(true)
      onDeleted()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setAsking(false)
      setError(caught)
      // 이미 지운 장부(409 NO_LEDGER) — 지금 모습을 다시 받는다
      if (caught.status === 409) onDeleted()
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const linked = ledger === null ? null : linkedLine(ledger.linked, today)
  return (
    <section className="stack-tight customer-ledger kp1-seller" aria-label={LEDGER_TITLE}>
      <h3 className="sub-title">{LEDGER_TITLE}</h3>
      {ledger === null ? (
        <p>{LEDGER_NONE}</p>
      ) : (
        <>
          <dl className="facts">
            <div>
              <dt>받는 분</dt>
              <dd>{ledger.name}</dd>
            </div>
            <div>
              <dt>연락처</dt>
              <dd>끝 {ledger.phoneLast4}</dd>
            </div>
            <div>
              <dt>손님이 저장한 날</dt>
              <dd>{customerDate(ledger.consentDate, today)}</dd>
            </div>
            <div>
              <dt>보관 끝나는 날</dt>
              <dd>{customerDate(ledger.keepUntil, today)}</dd>
            </div>
          </dl>
          {linked !== null ? <p>{linked}</p> : null}
          <Lock>
            <div className="row">
              <button
                type="button"
                className="button button-tall"
                disabled={busy}
                onClick={() => {
                  setDone(false)
                  setError(null)
                  setAsking(true)
                }}
              >
                {LEDGER_DELETE}
              </button>
            </div>
          </Lock>
        </>
      )}
      {done ? (
        <p className="notice" role="status" data-tone="success">
          {LEDGER_DELETED}
        </p>
      ) : null}
      {error !== null ? <RequestError error={error} /> : null}
      {asking && ledger !== null ? (
        <Modal
          title={LEDGER_DELETE_TITLE}
          className="kp1-seller"
          onClose={() => setAsking(false)}
          closeLabel="그대로 두기"
          closeDisabled={busy}
          actions={
            <button type="button" className="button button-danger button-tall" disabled={busy} onClick={() => void remove()}>
              지우기
            </button>
          }
        >
          <p>{LEDGER_DELETE_ASK}</p>
          {busy ? <p role="status">지우는 중…</p> : null}
        </Modal>
      ) : null}
    </section>
  )
}
