// 알기 쉬운 오류 (UX-03, AC-S05-71): 서버의 문장(message, problems[].message, hint)을 그대로 보이고
// 오류 코드·HTTP 상태는 "자세히" 안에 접어 둔다. 잠시 뒤 다시 하면 되는 실패에는 "다시 보내기".
import type { ApiError } from '../api/client.ts'

export interface ErrorNoteProps {
  readonly error: ApiError
  /** 칸 옆에 따로 보인 문제(field)는 여기서 빼고 보인다 */
  readonly omitFields?: readonly string[]
  readonly onRetry?: () => void
  readonly retryLabel?: string
}

export function ErrorNote({ error, omitFields = [], onRetry, retryLabel = '다시 보내기' }: ErrorNoteProps) {
  const problems = error.problems.filter((problem) => problem.field === null || !omitFields.includes(problem.field))
  return (
    <div className="error-note" role="alert" data-tone="danger">
      <p>{error.message}</p>
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
