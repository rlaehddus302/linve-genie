// 사유 칸 (AC-S05-34): 빠른 선택("시청자 요청"·"장난 찜"·"번호 착오"·"입금 안 함")과 직접 입력. 비면 보낼 수 없다.
// 서버가 사유를 거절하면(휴대폰 번호 등, D-079 ⑥) 서버 문장과 hint를 칸 아래에 보인다.
import { useId, type RefObject } from 'react'
import type { ApiError } from '../api/client.ts'
import { QUICK_REASONS } from '../lib/words.ts'

export const REASON_REQUIRED = '사유를 적어 주세요.'

export interface ReasonFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly empty: boolean
  readonly error: ApiError | null | undefined
  readonly inputRef?: RefObject<HTMLInputElement | null>
  readonly onEnter?: () => void
}

export function ReasonField({ value, onChange, empty, error, inputRef, onEnter }: ReasonFieldProps) {
  const errorId = useId()
  const problem = error?.problemFor('reason')
  const message = empty ? REASON_REQUIRED : problem === undefined ? null : `${problem.message}${problem.hint !== undefined ? ` ${problem.hint}` : ''}`
  return (
    <div className="stack-tight">
      <div className="row" role="group" aria-label="자주 쓰는 이유">
        {QUICK_REASONS.map((reason) => (
          <button key={reason} type="button" className="button button-small" aria-pressed={value === reason} onClick={() => onChange(reason)}>
            {reason}
          </button>
        ))}
      </div>
      <label className="field">
        <span>사유</span>
        <input
          ref={inputRef}
          className="input"
          value={value}
          aria-invalid={message !== null}
          aria-describedby={message !== null ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && onEnter !== undefined) {
              event.preventDefault()
              onEnter()
            }
          }}
        />
      </label>
      {message !== null ? (
        <p className="field-error" role="alert" id={errorId}>
          {message}
        </p>
      ) : null}
    </div>
  )
}
