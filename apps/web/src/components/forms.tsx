// 새 화면(문자찜 입력·구매자·정산)이 함께 쓰는 입력 조각 (AC-S06-02·36·82).
// - 쓰기는 누를 때 만든 요청 번호로 보내고, 같은 내용을 다시 보내면(저장하지 못한 뒤 "다시 보내기") 같은 요청 번호를 쓴다(AC-S05-63).
// - 오류는 "무엇이 잘못됐고 → 무엇을 하면 되는지": 칸 오류는 그 칸 아래, 네트워크·SAVE_FAILED는 "저장하지 못했어요. 다시 보내기",
//   PROCESSING_FAILED는 "확인 필요", 그 밖은 서버 문장. 기술 상세는 접어 둔다.
import { useCallback, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { isApiError, newRequestId, type ApiError } from '../api/client.ts'
import type { WriteResult } from '../api/types.ts'
import type { AmountRead } from '../lib/money.ts'
import { ErrorNote } from './ErrorNote.tsx'

export interface Sender {
  readonly busy: boolean
  readonly error: ApiError | null
  /** 보낸다. 저장되면 결과, 아니면 null (오류는 error에) */
  send(event: Readonly<Record<string, unknown>>): Promise<WriteResult | null>
  /** 마지막으로 보내지 못한 것을 같은 요청 번호로 다시 */
  resend(): Promise<WriteResult | null>
  /**
   * 보내지 못해 남겨 둔 요청 번호를 바뀐 내용(event)에 그대로 잇는다 — 다음에 그 내용을 보내면 같은 요청 번호 (D-MOB2-09:
   * 비운 받은 시각을 처음 누른 시각으로 채워 다시 보내도 서버가 처음 것을 기록했으면 처음 기록·응답을 돌려준다). 남긴 것이 없으면 false
   */
  carry(event: Readonly<Record<string, unknown>>): boolean
  clearError(): void
}

/** 바로 보내는 쓰기 하나 (command = 같은 요청 번호로 재시도 → 응답 seq까지 따라잡기) */
export function useSender(command: (event: Readonly<Record<string, unknown>>, requestId?: string) => Promise<WriteResult>): Sender {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const pending = useRef<{ key: string; requestId: string; event: Readonly<Record<string, unknown>> } | null>(null)
  const busyRef = useRef(false)

  const run = useCallback(
    async (event: Readonly<Record<string, unknown>>): Promise<WriteResult | null> => {
      if (busyRef.current) return null
      const key = JSON.stringify(event)
      if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId(), event }
      const { requestId } = pending.current
      busyRef.current = true
      setBusy(true)
      setError(null)
      try {
        const result = await command(event, requestId)
        pending.current = null
        return result
      } catch (caught) {
        if (!isApiError(caught)) throw caught
        setError(caught)
        // 다시 보내도 되는 실패만 요청 번호를 남긴다(같은 번호로 다시 보내기)
        if (!caught.transient) pending.current = null
        return null
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [command],
  )

  return {
    busy,
    error,
    send: run,
    resend: async () => (pending.current === null ? null : run(pending.current.event)),
    carry: (event) => {
      if (pending.current === null) return false
      pending.current = { key: JSON.stringify(event), requestId: pending.current.requestId, event }
      return true
    },
    clearError: () => setError(null),
  }
}

/**
 * 저절로 다시 보낼 실패의 문장 (MOB2 D-MOB2-18): 아래에 AUTO_RESEND_NOTE가 함께 보이므로 "눌러 주세요"를 빼고 저장 못 함·연결 확인만.
 * 누르기는 AUTO_RESEND_NOTE가 "눌러도 돼요"로 말한다
 */
export function autoResendFailWords(error: ApiError): string {
  return error.network ? '저장하지 못했어요. 인터넷 연결을 확인해 주세요.' : '저장하지 못했어요.'
}

/**
 * 쓰기 오류 (AC-S06-82). autoResend: 이 실패가 저절로 다시 보낼 목록에 있고 AUTO_RESEND_NOTE가 함께 보일 때만 true (MOB2 D-MOB2-18) —
 * 그 밖(저절로 보내지 않는 실패·다른 화면)은 지금 문장 그대로
 */
export function WriteError({ error, onRetry, omitFields = [], autoResend = false }: { readonly error: ApiError; readonly onRetry?: () => void; readonly omitFields?: readonly string[]; readonly autoResend?: boolean }) {
  if (error.retryable) {
    return (
      <div className="error-note" role="alert" data-tone="danger">
        <p>{autoResend ? autoResendFailWords(error) : <>저장하지 못했어요. {error.network ? '인터넷 연결을 확인하고 ' : ''}&quot;다시 보내기&quot;를 눌러 주세요.</>}</p>
        {onRetry !== undefined ? (
          <button type="button" className="button" onClick={onRetry}>
            다시 보내기
          </button>
        ) : null}
        <details className="details">
          <summary>자세히</summary>
          <p>
            오류 번호 {error.status === 0 ? '연결 없음' : String(error.status)} · {error.code}
          </p>
        </details>
      </div>
    )
  }
  if (error.code === 'PROCESSING_FAILED') {
    return (
      <div className="error-note" role="alert" data-tone="danger">
        <p>확인 필요: {error.message}</p>
        <details className="details">
          <summary>자세히</summary>
          <p>오류 번호 {String(error.status)} · {error.code}</p>
        </details>
      </div>
    )
  }
  const shown = error.problems.filter((problem) => problem.field === null || !omitFields.includes(problem.field))
  if (error.status === 400 && error.problems.length > 0 && shown.length === 0) return null
  return <ErrorNote error={error} omitFields={omitFields} {...(error.transient && onRetry !== undefined ? { onRetry } : {})} />
}

/** 칸 아래 문장 (화면이 먼저 찾은 문제 또는 그 칸의 서버 문제) */
export function FieldNote({ id, message }: { readonly id: string; readonly message: string | null }) {
  if (message === null) return null
  return (
    <p className="field-error" role="alert" id={id}>
      {message}
    </p>
  )
}

/** 서버 오류의 그 칸 문장 (+hint) */
export function serverProblem(error: ApiError | null, field: string): string | null {
  const problem = error?.problemFor(field)
  return problem === undefined ? null : `${problem.message}${problem.hint !== undefined ? ` ${problem.hint}` : ''}`
}

export interface AmountFieldProps {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  /** 서버가 읽은 칸 상태 (money.ts useAmount — 답이 오기 전에는 pending) */
  readonly read: AmountRead
  /** 서버가 이 칸을 거절했을 때 */
  readonly serverMessage?: string | null
  /** 보내려다 막혔을 때만 빈 칸 문장을 보인다 */
  readonly showEmpty?: boolean
  readonly inputRef?: RefObject<HTMLInputElement | null>
  readonly children?: ReactNode
}

/** 금액 칸 (AC-S06-36): 서버가 원 단위로 읽은 금액을 칸 옆에 "14,000원", 읽지 못하거나 범위 밖이면 그 문장 (SRV1 — 읽기는 서버) */
export function AmountField({ label, value, onChange, read, serverMessage = null, showEmpty = false, inputRef }: AmountFieldProps) {
  const id = useId()
  const message = read.kind === 'invalid' ? read.message : read.kind === 'empty' && showEmpty ? '금액을 적어 주세요.' : serverMessage
  return (
    <div className="stack-tight">
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <span className="amount-row">
          <input
            id={id}
            ref={inputRef}
            className="input amount-input"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            aria-invalid={message !== null}
            aria-describedby={message === null ? `${id}-read` : `${id}-read ${id}-error`}
            onChange={(event) => onChange(event.target.value)}
          />
          <span id={`${id}-read`} className="amount-read" aria-live="polite">
            {read.kind === 'ok' ? read.words : ''}
          </span>
        </span>
      </div>
      <FieldNote id={`${id}-error`} message={message} />
    </div>
  )
}
