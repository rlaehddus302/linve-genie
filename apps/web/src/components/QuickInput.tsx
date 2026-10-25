// 빠른 입력칸 (AC-S05-10~12, PRD-01, PRD-03 AC3, D-084): 콘솔 위쪽에 늘 보이고, 콘솔을 열면 포커스가 여기 있다.
// 치는 동안 첫 토큰이 그 방송의 상품 번호면 그 상품을 바로 옆에 보인다. 오류면 번호·품종·가격 고치기 칸을 연다.
// FB1 D-FB1-01 (AC-FB1-02): 도움말 줄에 그 방송의 가격 단위 한 줄, 친 줄이 새 상품 등록으로 읽히면 Enter 전에 "등록하면: …",
// 고치기 칸 가격 옆에 읽은 가격 "= …원".
// MOB1 D-MOB1-09(AC-MOB1-17): 끝난 방송·봉인 날짜(closed)에는 빠른 입력 줄(입력칸·개수·옵션·도움말·단위 줄·"등록하면" 줄)이 없다 —
// 상품 자세히의 "고치기"로 여는 고치기 칸·오류·"고칠까요?"는 그대로. 방송이 끝나면 치던 글은 버린다(보내지 않음 — 콘솔이 비운다). 해석은 Enter와 같은 함수(그 방송 스냅샷의 price.unit) — 품종은 React 글자로만 들어간다.
import { AUTO_RESEND_NOTE, RESENDING_WORD } from '../lib/resend-board.ts'
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import type { ApiError } from '../api/client.ts'
import { productKey } from '../lib/derive.ts'
import { editQuestion, fixPricePreview, previewNumber, quickSettings, registerPreview, unitLine, type FixField } from '../lib/quick.ts'
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
  /** 연결이 돌아와 저절로 다시 보내는 중인가 (D-MOB2-07 — "다시 보내는 중…") */
  readonly auto?: boolean
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
  /** 개수 칸이 1이 아니었으면 그 개수 (AC-ORD11-08) */
  readonly stock?: number
}

/** 옵션 없는 상품의 "개수" 칸 (AC-ORD11-01·03·04, D-STK-01). 붙인 옵션이 있으면 없다(AC-ORD11-09) */
export interface CountField {
  readonly value: string
  readonly onChange: (value: string) => void
  /** "개수는 1~999개로 적어 주세요." */
  readonly problem: string | null
  readonly inputRef: RefObject<HTMLInputElement | null>
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
  /**
   * 가격 단위 한 줄을 이 안(고정 영역)에 그리는가. 휴대폰은 false — 고정 영역 35% 이하(UX-04, TE-FB1-001)라
   * 콘솔이 고정 영역 바로 아래에 QuickUnitLine으로 그린다. 기본 true(PC). "등록하면: …" 줄도 함께 옮긴다(FB1 D-FB1-18 (a))
   */
  readonly unitInside?: boolean
  /** 끝난 방송·봉인 날짜 — 빠른 입력 줄을 그리지 않는다(고치기 칸은 그대로, D-MOB1-09) */
  readonly closed?: boolean
  /** 개수 칸 (없으면 보이지 않는다 — 옵션을 붙였을 때) */
  readonly count?: CountField
  /** 옵션 방송만: "옵션 추가" 버튼과 붙은 옵션 요약 (D-O2-05). 번호 방송에는 없다 */
  readonly options?: {
    readonly summary: string | null
    readonly onOpen: () => void
    readonly onClear: () => void
  }
}

/**
 * 휴대폰 콘솔의 가격 단위 한 줄 (AC-FB1-02, D-FB1-01) — 고정 영역 바로 아래, 화면을 따라 내려가지 않는다.
 * 고정 영역에 두면 두 줄로 꺾여 35%를 넘는다(UX-04, TE-FB1-001·U-FB1-01). 문장은 PC와 같다.
 * FB1 D-FB1-18 (a): 늘 있는 "등록하면: …" 한 줄도 휴대폰에선 고정 영역에 두면 35%를 넘어(n2b2 layout 293px > 284px) 같은 자리로 — 단위 줄 위.
 * value: 빠른 입력칸의 글 (미리 보기는 칸 안과 같은 코어 해석)
 */
export function QuickUnitLine({ value }: { readonly value: string }) {
  const api = useConsoleApi()
  const settings = api.settingsOf(api.b)
  const quick = settings === null ? null : quickSettings(settings)
  const willRegister = quick === null ? null : registerPreview(value, quick, (n) => api.data.products.get(productKey(api.b, n)))
  return (
    <>
      <RegisterLine text={willRegister} />
      {quick === null ? null : <p className="hint quick-unit quick-unit-below">{unitLine(quick['price.unit'])}</p>}
    </>
  )
}

/** "등록하면: …" 한 줄 (D-FB1-18 (a)): 늘 있다(미리 보기가 없으면 빈 글) — 높이 한 줄 고정, 길면 끝을 "…"로. 치는 동안 아래 요소가 움직이지 않는다 */
function RegisterLine({ text }: { readonly text: string | null }) {
  // 빈 줄 표시(data-empty): 휴대폰은 미리 보기가 있을 때만 자리를 차지한다(QL2 D-QL2-11 (2)) — PC는 늘 한 줄 자리 그대로
  const empty = text === null || text === ''
  return (
    <p className="quick-will-register" role="status" data-empty={empty ? 'yes' : undefined}>
      {text ?? ''}
    </p>
  )
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
  const quick = settings === null ? null : quickSettings(settings)
  const willRegister = quick === null ? null : registerPreview(value, quick, (n) => api.data.products.get(productKey(api.b, n)))
  const fixPrice = quick === null || fix === null ? null : fixPricePreview(fix.price, quick)
  const sending = props.registrations.some((item) => item.status !== 'failed')
  const resending = props.registrations.some((item) => item.status !== 'failed' && item.auto === true)
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

  const closed = props.closed === true
  return (
    <div className="quick">
      {closed ? null : (
        <>
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
        {props.count !== undefined ? <CountInput id="quick-count" field={props.count} onEnter={() => props.onEnter(inputRef.current?.value ?? value)} /> : null}
        {props.options !== undefined ? (
          <button type="button" className="button" onClick={props.options.onOpen}>
            옵션 추가
          </button>
        ) : null}
        {sending ? (
          <span className="quick-status" role="status">
            {resending ? RESENDING_WORD : '등록하는 중…'}
          </span>
        ) : null}
      </div>
      {props.count?.problem != null ? (
        <p id="quick-count-problem" className="field-error" role="alert">
          {props.count.problem}
        </p>
      ) : null}
      {props.options !== undefined && props.options.summary !== null ? (
        <div className="row quick-options" role="group" aria-label="붙은 옵션">
          <span role="status">{props.options.summary}</span>
          <span className="hint">Enter로 등록하면 함께 들어가요</span>
          <button type="button" className="button button-small" onClick={props.options.onOpen}>
            옵션 고치기
          </button>
          <button type="button" className="button button-small" onClick={props.options.onClear}>
            옵션 떼기
          </button>
        </div>
      ) : null}
      <p id="quick-help" className="hint quick-help">
        번호 품종 가격을 적고 Enter. 번호만 적으면 그 상품을 찾아요.{props.count !== undefined ? ' 같은 번호로 여러 개를 팔면 옆 개수 칸을 바꿔요.' : ''}
      </p>
      {quick !== null && props.unitInside !== false ? <p className="hint quick-unit">{unitLine(quick['price.unit'])}</p> : null}
      {/* FB1 D-FB1-18 (a): PC는 칸 바로 아래(고정 영역 안), 휴대폰은 고정 영역 바로 아래(QuickUnitLine) */}
      {props.unitInside !== false ? <RegisterLine text={willRegister} /> : null}
      {preview !== undefined ? (
        <div className="quick-preview" role="status" aria-label="찾은 상품">
          <ProductSummary product={preview} />
        </div>
      ) : null}
        </>
      )}
      {props.error !== null ? <ErrorNote error={props.error} /> : null}
      {failed.map((item) => (
        <div key={item.id} className="error-note" role="alert" data-tone="danger">
          <p>
            {SAVE_FAILED_LINE}: {item.line}
          </p>
          {item.error !== null ? <p>{item.error.message}</p> : null}
          {/* 기록되지 않았음이 확실한 실패만 연결이 돌아오면 저절로 한 번 다시 보낸다 (D-MOB2-07) */}
          {item.error?.retryable === true ? <p>{AUTO_RESEND_NOTE}</p> : null}
          <button type="button" className="button" onClick={() => props.onRetry(item.id)}>
            다시 보내기
          </button>
        </div>
      ))}
      {props.asks.length > 0 ? (
        <ul className="plain-list stack-tight" aria-label="고칠까요?">
          {props.asks.map((ask, index) => {
            // 화면의 주 버튼은 많아야 하나 (D-101): 고치기 칸이 없을 때 맨 앞 물음의 버튼만
            const askClass = fix === null && index === 0 ? 'button button-primary' : 'button'
            // 그 번호의 지금 상품과 다시 본다 (AC-S06-67, D-095)
            const current = api.data.products.get(productKey(api.b, ask.no))
            if (current === undefined) {
              return (
                <li key={ask.id} className="quick-ask">
                  <span role="status">
                    {ask.no}번은 지금 없어요. 이 줄로 새로 등록할까요? 친 줄: {ask.line}
                  </span>
                  <span className="row">
                    <button type="button" className={askClass} aria-label={`${ask.line} 등록하기`} onClick={() => props.onAskRegister(ask.id)}>
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
                  <button type="button" className={askClass} aria-label={`${ask.line} 고치기`} onClick={() => props.onAsk(ask.id)}>
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
              {fixPrice !== null ? <span className="fix-price">{fixPrice}</span> : null}
            </label>
            {props.count !== undefined ? (
              <label className="field">
                <span>개수</span>
                <input
                  className="input"
                  inputMode="numeric"
                  autoComplete="off"
                  value={props.count.value}
                  aria-invalid={props.count.problem !== null}
                  aria-describedby={props.count.problem !== null ? 'quick-count-problem' : undefined}
                  onChange={(event) => props.count?.onChange(event.target.value)}
                  onKeyDown={onFixKeyDown}
                />
              </label>
            ) : null}
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

/** 빠른 입력 줄 옆 "개수" 칸: 숫자 자판으로 열리고 Enter는 빠른 입력 줄의 Enter와 같다 */
function CountInput({ id, field, onEnter }: { readonly id: string; readonly field: CountField; readonly onEnter: () => void }) {
  return (
    <span className="quick-count">
      <label htmlFor={id}>개수</label>
      <input
        id={id}
        ref={field.inputRef}
        className="input quick-count-input"
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="enter"
        value={field.value}
        aria-invalid={field.problem !== null}
        aria-describedby={field.problem !== null ? 'quick-count-problem' : undefined}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => field.onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          onEnter()
        }}
      />
      <span className="hint quick-count-unit">개</span>
    </span>
  )
}

const SAVE_FAILED_LINE = '저장하지 못했어요. 다시 보내기를 눌러 주세요'
