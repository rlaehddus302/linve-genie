// 손글씨 판의 상태 (D-HANDWRITE-01) — 순수 계산. 쓰는 동안의 획은 바로 읽어 흐리게 보이고(live), 잠깐 멈추면(settle) 글자로 굳혀 위 글에 붙이고 판을 비운다.
// 그래서 작은 휴대폰에서도 한두 자씩 이어 쓸 수 있다. 마지막에 굳힌 조각은 후보를 눌러 바꿀 수 있다.
import { readDigits, type DigitTemplate, type InkReading, type InkStroke } from './handwriting.ts'

/** 손을 뗀 뒤 이만큼 아무것도 안 쓰면 글자로 굳힌다 */
export const SETTLE_MS = 650
/** 멈추면 바로 넣기: 굳힌 뒤 이만큼 더 아무것도 안 쓰면 칸에 넣는다 */
export const AUTO_INSERT_MS = 1100

export interface PadState {
  /** 굳힌 글 (넣을 글) */
  readonly text: string
  /** 아직 굳히지 않은 획 */
  readonly ink: readonly InkStroke[]
  /** ink를 읽은 것 (없으면 null) */
  readonly live: InkReading | null
  /** 마지막에 굳힌 조각: text의 from 자리부터가 이 읽기 — 후보로 바꿀 수 있다 */
  readonly last: { readonly reading: InkReading; readonly from: number } | null
}

export const EMPTY_PAD: PadState = { text: '', ink: [], live: null, last: null }

export type PadAction =
  | { readonly type: 'stroke'; readonly stroke: InkStroke; readonly templates: readonly DigitTemplate[]; readonly padHeight: number }
  | { readonly type: 'settle' }
  | { readonly type: 'pick'; readonly option: string }
  | { readonly type: 'back' }
  | { readonly type: 'clear' }

export function padReducer(state: PadState, action: PadAction): PadState {
  switch (action.type) {
    case 'stroke': {
      const ink = [...state.ink, action.stroke]
      const live = readDigits(ink, action.templates, action.padHeight)
      // 살짝 닿은 것뿐이면 획을 남기지 않는다
      if (live.text === '') return state
      return { ...state, ink, live }
    }
    case 'settle': {
      if (state.live === null || state.live.text === '') return { ...state, ink: [], live: null }
      return { text: state.text + state.live.text, ink: [], live: null, last: { reading: state.live, from: state.text.length } }
    }
    case 'pick': {
      if (state.live !== null) return { text: state.text + action.option, ink: [], live: null, last: { reading: state.live, from: state.text.length } }
      if (state.last === null) return state
      return { ...state, text: state.text.slice(0, state.last.from) + action.option }
    }
    case 'back': {
      // 쓰는 중이면(아직 굳히지 않은 획) 그 획들을, 아니면 마지막 글자를 지운다
      if (state.ink.length > 0) return { ...state, ink: [], live: null }
      return { ...state, text: state.text.slice(0, -1), last: null }
    }
    case 'clear':
      return EMPTY_PAD
  }
}

/** 후보 단추에 보일 글: 고르면 칸에 들어갈 전체 글 (지금 글은 빼고) */
export function padChoices(state: PadState): { readonly option: string; readonly shown: string }[] {
  if (state.live !== null) return state.live.options.slice(1).map((option) => ({ option, shown: state.text + option }))
  if (state.last === null) return []
  const current = state.text.slice(state.last.from)
  const head = state.text.slice(0, state.last.from)
  return state.last.reading.options.filter((option) => option !== current).map((option) => ({ option, shown: head + option }))
}

/** 지금 판이 읽고 있는 것까지 합친 글 (보이기용) */
export const padPreview = (state: PadState): { readonly fixed: string; readonly pending: string } => ({ fixed: state.text, pending: state.live?.text ?? '' })
