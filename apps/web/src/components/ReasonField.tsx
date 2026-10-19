// 사유 칸 (AC-S05-34, AC-S06-63): 빠른 선택("1 시청자 요청"·"2 장난 찜"·"3 번호 착오"·"4 입금 안 함")과 직접 입력. 비면 보낼 수 없다.
// 빠른 선택은 창 안(글 칸 밖)에서 숫자 키로도 고른다(창이 data-key 버튼을 누른다). 고르면 포커스가 보내기 버튼으로 간다(onPicked).
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
  /** 빠른 선택 목록 (기본: 방송자 조치 사유) */
  readonly reasons?: readonly string[]
  /** 빠른 선택을 고른 뒤 (보내기 버튼으로 포커스) */
  readonly onPicked?: () => void
  /** 화면이 먼저 찾은 문제 (예: 휴대폰 번호) */
  readonly problem?: string | null
  /** 칸 이름 (기본 "사유") */
  readonly label?: string
}

export function ReasonField({ value, onChange, empty, error, inputRef, onEnter, reasons = QUICK_REASONS, onPicked, problem = null, label = '사유' }: ReasonFieldProps) {
  const errorId = useId()
  const serverProblem = error?.problemFor('reason')
  const message = empty
    ? REASON_REQUIRED
    : problem !== null
      ? problem
      : serverProblem === undefined
        ? null
        : `${serverProblem.message}${serverProblem.hint !== undefined ? ` ${serverProblem.hint}` : ''}`
  return (
    <div className="stack-tight">
      <div className="row" role="group" aria-label="자주 쓰는 이유">
        {reasons.map((reason, index) => (
          <button
            key={reason}
            type="button"
            className="button button-small"
            data-key={index < 9 ? String(index + 1) : undefined}
            aria-pressed={value === reason}
            onClick={() => {
              onChange(reason)
              onPicked?.()
            }}
          >
            {index < 9 ? `${String(index + 1)} ` : ''}
            {reason}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{label}</span>
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
