// 알기 쉬운 오류 (UX-03, AC-S05-71): 서버의 문장(message, problems[].message, hint)을 그대로 보이고
// 오류 코드·HTTP 상태는 "자세히" 안에 접어 둔다. 잠시 뒤 다시 하면 되는 실패에는 "다시 보내기".
import type { ReactNode } from 'react'
import type { ApiError } from '../api/client.ts'

export interface ErrorNoteProps {
  readonly error: ApiError
  /** 칸 옆에 따로 보인 문제(field)는 여기서 빼고 보인다 */
  readonly omitFields?: readonly string[]
  readonly onRetry?: () => void
  readonly retryLabel?: string
  /** 서버 문장 바로 아래 덧붙이는 화면 안내 (글로만 — 예: 입금 붙여넣기 머리 줄 없음, D-QL3R2-05) */
  readonly extra?: ReactNode
}

export function ErrorNote({ error, omitFields = [], onRetry, retryLabel = '다시 보내기', extra }: ErrorNoteProps) {
  // 위 문장과 같은 문제 문장은 두 번 보이지 않는다 (예: 합치기·떼어 내기 409 — D-I2-20)
  const problems = error.problems.filter((problem) => (problem.field === null || !omitFields.includes(problem.field)) && !(problem.message === error.message && problem.hint === undefined))
  return (
    <div className="error-note" role="alert" data-tone="danger">
      <p>{error.message}</p>
      {extra !== undefined ? <p className="error-extra">{extra}</p> : null}
      {problems.length > 0 ? (
        <ul className="plain-list">
          {problems.map((problem, index) => (
            <li key={index}>
              {problem.message}
              {problem.hint !== undefined ? ` ${problem.hint}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {onRetry !== undefined ? (
        <button type="button" className="button" onClick={onRetry}>
          {retryLabel}
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

/** 칸 아래 문장 (그 칸의 서버 문제 + hint) */
export function FieldError({ error, field, id }: { readonly error: ApiError | null; readonly field: string; readonly id?: string }) {
  const problem = error?.problemFor(field)
  if (problem === undefined) return null
  return (
    <p className="field-error" role="alert" id={id}>
      {problem.message}
      {problem.hint !== undefined ? ` ${problem.hint}` : ''}
    </p>
  )
}

/** 새 화면(I2)의 연결 끊김 문장 (AC-I2-82) */
export const RECONNECT_MESSAGE = '인터넷 연결을 확인하고 다시 눌러 주세요.'

/**
 * 새 화면(I2)의 요청 오류 (AC-I2-80·82): 연결이 끊기면 "인터넷 연결을 확인하고 다시 눌러 주세요.", 그 밖은 서버 문장 그대로(칸 문제는 칸 옆에 — omitFields).
 * 기술 상세는 "자세히" 안에 오류 번호(HTTP 상태)만 접어 둔다 — 영어 오류 코드는 화면 글자에 넣지 않는다.
 */
export function RequestError({ error, onRetry, retryLabel = '다시 시도', omitFields = [] }: { readonly error: ApiError; readonly onRetry?: () => void; readonly retryLabel?: string; readonly omitFields?: readonly string[] }) {
  const problems = error.network ? [] : error.problems.filter((problem) => (problem.field === null || !omitFields.includes(problem.field)) && problem.message !== error.message)
  const retry = onRetry !== undefined && (error.network || error.transient)
  return (
    <div className="error-note" role="alert" data-tone="danger">
      <p>{error.network ? RECONNECT_MESSAGE : error.message}</p>
      {problems.length > 0 ? (
        <ul className="plain-list">
          {problems.map((problem, index) => (
            <li key={index}>
              {problem.message}
              {problem.hint !== undefined ? ` ${problem.hint}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {retry ? (
        <button type="button" className="button" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
      <details className="details">
        <summary>자세히</summary>
        <p>오류 번호 {error.status === 0 ? '연결 없음' : String(error.status)}</p>
      </details>
    </div>
  )
}
