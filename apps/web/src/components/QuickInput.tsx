// 빠른 입력칸 (AC-S05-10~12, PRD-01, PRD-03 AC3, D-084): 콘솔 위쪽에 늘 보이고, 콘솔을 열면 포커스가 여기 있다.
// 치는 동안 첫 토큰이 그 방송의 상품 번호면 그 상품을 바로 옆에 보인다. 오류면 번호·품종·가격 고치기 칸을 연다.
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { ApiError } from '../api/client.ts'
import { productKey } from '../lib/derive.ts'
import { previewNumber, type FixField } from '../lib/quick.ts'
import { useConsoleApi } from './console-context.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { ProductSummary } from './ProductBoard.tsx'

export interface FixState {
  readonly no: string
  readonly name: string
  readonly price: string
  readonly focus: FixField
  readonly message: string
  /** 고치기 칸을 연 빠른 입력 줄 */
  readonly line: string
  /** 칸을 열거나 다시 오류가 날 때마다 바뀐다 (커서를 다시 보낸다) */
  readonly version: number
}

export interface Registration {
  readonly id: number
  readonly line: string
  readonly no: number
  readonly status: 'sending' | 'retrying' | 'failed'
  readonly error: ApiError | null
}

export interface QuickInputProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly onEnter: (line: string) => void
  readonly fix: FixState | null
  readonly onFixChange: (patch: Partial<Pick<FixState, 'no' | 'name' | 'price'>>) => void
  readonly onFixSubmit: () => void
  readonly onFixClose: () => void
  readonly registrations: readonly Registration[]
  readonly onRetry: (id: number) => void
  readonly error: ApiError | null
}

export function QuickInput(props: QuickInputProps) {
  const api = useConsoleApi()
  const { value, inputRef, fix } = props
  const fixRefs = {
    no: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
    price: useRef<HTMLInputElement>(null),
  }

  useEffect(() => {
    if (fix === null) return
    const field = fixRefs[fix.focus].current
    field?.focus()
    field?.select()
  }, [fix?.version])

  const no = previewNumber(value)
  const preview = no === null ? undefined : api.data.products.get(productKey(api.b, no))
  const sending = props.registrations.some((item) => item.status !== 'failed')
  const failed = props.registrations.filter((item) => item.status === 'failed')

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    props.onEnter(event.currentTarget.value)
  }

  const onFixKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      props.onFixSubmit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      props.onFixClose()
    }
  }

  return (
    <div className="quick">
      <div className="quick-row">
        <label className="quick-label" htmlFor="quick-input">
          빠른 입력
        </label>
        <input
          id="quick-input"
          ref={inputRef}
          className="input quick-input"
          value={value}
          autoComplete="off"
          enterKeyHint="enter"
          placeholder="15 핑크프릴 10000"
          aria-describedby="quick-help"
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {sending ? (
          <span className="quick-status" role="status">
            등록하는 중…
          </span>
        ) : null}
      </div>
      <p id="quick-help" className="hint">
        번호 품종 가격을 적고 Enter. 번호만 적으면 그 상품을 찾아요.
      </p>
      {preview !== undefined ? (
        <div className="quick-preview" role="status" aria-label="찾은 상품">
          <ProductSummary product={preview} />
        </div>
      ) : null}
      {props.error !== null ? <ErrorNote error={props.error} /> : null}
      {failed.map((item) => (
        <div key={item.id} className="error-note" role="alert">
          <p>
            {SAVE_FAILED_LINE}: {item.line}
          </p>
          {item.error !== null ? <p>{item.error.message}</p> : null}
          <button type="button" className="button" onClick={() => props.onRetry(item.id)}>
            다시 보내기
          </button>
        </div>
      ))}
      {fix !== null ? (
        <fieldset className="fix" aria-label="고치기 칸">
          <legend>고치기 — Enter 등록 · Esc 닫기</legend>
          <p className="field-error" role="alert">
            {fix.message}
          </p>
          <div className="fix-fields">
            <label className="field">
              <span>번호</span>
              <input
                ref={fixRefs.no}
                className="input"
                inputMode="numeric"
                value={fix.no}
                onChange={(event) => props.onFixChange({ no: event.target.value })}
                onKeyDown={onFixKeyDown}
              />
            </label>
            <label className="field">
              <span>품종</span>
              <input ref={fixRefs.name} className="input" value={fix.name} onChange={(event) => props.onFixChange({ name: event.target.value })} onKeyDown={onFixKeyDown} />
            </label>
            <label className="field">
              <span>가격</span>
              <input
                ref={fixRefs.price}
                className="input"
                value={fix.price}
                onChange={(event) => props.onFixChange({ price: event.target.value })}
                onKeyDown={onFixKeyDown}
              />
            </label>
          </div>
          <div className="row">
            <button type="button" className="button button-primary" onClick={props.onFixSubmit}>
              등록
            </button>
            <button type="button" className="button" onClick={props.onFixClose}>
              닫기
            </button>
          </div>
        </fieldset>
      ) : null}
    </div>
  )
}

const SAVE_FAILED_LINE = '저장하지 못했어요. 다시 보내기를 눌러 주세요'
