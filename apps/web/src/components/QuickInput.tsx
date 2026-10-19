// 빠른 입력칸 (AC-S05-10~12, PRD-01, PRD-03 AC3, D-084): 콘솔 위쪽에 늘 보이고, 콘솔을 열면 포커스가 여기 있다.
// 치는 동안 첫 토큰이 그 방송의 상품 번호면 그 상품을 바로 옆에 보인다. 오류면 번호·품종·가격 고치기 칸을 연다.
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { ApiError } from '../api/client.ts'
import { productKey } from '../lib/derive.ts'
import { editQuestion, previewNumber, quickSettings, type FixField } from '../lib/quick.ts'
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
  /** 커서를 고칠 칸으로 옮기는가 (늦게 판단한 줄인데 판매자가 다음 줄을 치는 중이면 옮기지 않는다) */
  readonly grab: boolean
}

export interface Registration {
  readonly id: number
  readonly line: string
  readonly no: number
  readonly status: 'sending' | 'retrying' | 'failed'
  readonly error: ApiError | null
}

/**
 * 늦게 판단한 같은 번호 줄(AC-S05-13): 앞 등록 응답을 기다리는 동안 판매자가 다음 줄을 치기 시작했으면 "고칠까요?" 창을 띄워
 * 글자를 빼앗지 않고 칸 아래에 남긴다 — 판매자가 "고치기"를 누를 때 그 창을 연다 (TE-S05-002)
 */
export interface EditAsk {
  readonly id: number
  /** 친 줄 */
  readonly line: string
  readonly no: number
  /** 상품 키 */
  readonly product: string
  readonly name: string
  readonly price: number
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
  /** 늦게 판단해 창을 띄우지 않은 "고칠까요?" */
  readonly asks: readonly EditAsk[]
  /** "고치기": 그 줄의 "고칠까요?" 창을 연다 */
  readonly onAsk: (id: number) => void
  /** "그대로 두기"·"지우기": 아무것도 보내지 않고 지운다 */
  readonly onAskDismiss: (id: number) => void
  /** "등록하기": 그 번호에 상품이 없어졌을 때 친 줄로 등록한다 (AC-S06-67) */
  readonly onAskRegister: (id: number) => void
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
    if (fix === null || !fix.grab) return
    const field = fixRefs[fix.focus].current
    field?.focus()
    field?.select()
  }, [fix?.version])

  // 번호 읽기는 등록과 같은 코어 해석(그 방송 스냅샷의 번호 최대·가격 단위)
  const settings = api.settingsOf(api.b)
  const no = settings === null ? previewNumber(value) : previewNumber(value, quickSettings(settings))
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
      <p id="quick-help" className="hint quick-help">
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
      {props.asks.length > 0 ? (
        <ul className="plain-list stack-tight" aria-label="고칠까요?">
          {props.asks.map((ask) => {
            // 그 번호의 지금 상품과 다시 본다 (AC-S06-67, D-095)
            const current = api.data.products.get(productKey(api.b, ask.no))
            if (current === undefined) {
              return (
                <li key={ask.id} className="quick-ask">
                  <span role="status">
                    {ask.no}번은 지금 없어요. 이 줄로 새로 등록할까요? 친 줄: {ask.line}
                  </span>
                  <span className="row">
                    <button type="button" className="button button-primary" aria-label={`${ask.line} 등록하기`} onClick={() => props.onAskRegister(ask.id)}>
                      등록하기
                    </button>
                    <button type="button" className="button" aria-label={`${ask.line} 지우기`} onClick={() => props.onAskDismiss(ask.id)}>
                      지우기
                    </button>
                  </span>
                </li>
              )
            }
            return (
              <li key={ask.id} className="quick-ask">
                <span role="status">
                  {editQuestion(ask.no, current.status === 'CLOSED')} 친 줄: {ask.line}
                </span>
                <span className="row">
                  <button type="button" className="button button-primary" aria-label={`${ask.line} 고치기`} onClick={() => props.onAsk(ask.id)}>
                    고치기
                  </button>
                  <button type="button" className="button" aria-label={`${ask.line} 그대로 두기`} onClick={() => props.onAskDismiss(ask.id)}>
                    그대로 두기
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
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
