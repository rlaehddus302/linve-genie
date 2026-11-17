// 손글씨로 글자 넣기 (D-HANDWRITE-02, 판매자 2026-11-17 "손글씨는 숫자 말고 품종 같은 텍스트 넣을때만"):
// 판의 상태 — 순수 계산. 쓴 획은 잠깐 멈추면 휴대폰 안 손글씨 읽기(lib/ink-reader.ts)로 읽고, 가장 그럴듯한 글을 위 글 뒤에 붙인 뒤 판을 비운다.
// 그래서 작은 휴대폰에서도 두세 자씩 이어 쓸 수 있다("핑크" → "프릴" = "핑크프릴"). 다른 후보와 품종 이름은 "혹시" 단추로 바꾼다.
// 숫자(번호·가격·뒷자리)는 숫자판이 더 빠르고 틀릴 일이 없어 손글씨를 두지 않는다 (옛 D-HANDWRITE-01은 숫자만이었다).

/** 판 위의 한 점 — 자리(점)와 시각(ms) */
export interface InkPoint {
  readonly x: number
  readonly y: number
  readonly t: number
}
export type InkStroke = readonly InkPoint[]

/** 손을 뗀 뒤 이만큼 아무것도 안 쓰면 읽는다 */
export const SETTLE_MS = 700
/** "혹시" 후보 수 */
export const CHOICES_MAX = 5

export interface PadState {
  /** 읽어 붙인 글 (넣을 글) */
  readonly text: string
  /** 아직 읽지 않은 획 */
  readonly ink: readonly InkStroke[]
  /** 마지막 읽기의 다른 후보 — 누르면 위 글 전체가 그 글로 바뀐다 */
  readonly choices: readonly string[]
  /** 마지막 읽기에서 아무 글도 못 읽었다 */
  readonly missed: boolean
}

export const EMPTY_PAD: PadState = { text: '', ink: [], choices: [], missed: false }

export type PadAction =
  | { readonly type: 'stroke'; readonly stroke: InkStroke }
  /** 읽은 결과: strokes = 읽으려고 보낸 획(판 맨 앞부터), candidates = 읽은 글(그럴듯한 것부터), hints = 품종 이름 */
  | { readonly type: 'read'; readonly strokes: readonly InkStroke[]; readonly candidates: readonly string[]; readonly hints: readonly string[] }
  | { readonly type: 'pick'; readonly option: string }
  | { readonly type: 'space' }
  | { readonly type: 'back' }
  | { readonly type: 'clear' }

const squash = (text: string): string => text.replace(/\s+/gu, ' ').trim()
/** 비교용: 띄어쓰기·대소문자 무시 */
export const compact = (text: string): string => text.replace(/\s+/gu, '').toLowerCase()

/** 글자 하나 차이 (넣기·빼기·바꾸기 한 번) */
function oneEditApart(a: string, b: string): boolean {
  const x = Array.from(a)
  const y = Array.from(b)
  if (Math.abs(x.length - y.length) > 1) return false
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i += 1
  if (x.length === y.length) return x.slice(i + 1).join('') === y.slice(i + 1).join('') && i < x.length
  return x.length > y.length ? x.slice(i + 1).join('') === y.slice(i).join('') : x.slice(i).join('') === y.slice(i + 1).join('')
}

/**
 * 읽은 후보 → 위 글 전체의 후보 (첫째가 붙일 글).
 * - 앞 글(prefix) 뒤에 붙인다 (띄어쓰기는 판매자가 [띄우기]로)
 * - 품종 이름과 띄어쓰기·대소문자만 다르면 품종 이름 표기로, 그런 후보가 있으면 맨 앞으로 (손글씨 읽기보다 판매자가 판 이름이 맞을 일이 많다)
 * - 첫 후보로 시작하는 품종 이름, 한 글자만 다른 품종 이름을 뒤에 더한다
 */
export function rankReadings(prefix: string, candidates: readonly string[], hints: readonly string[], max = CHOICES_MAX + 1): string[] {
  const known = new Map<string, string>()
  for (const hint of hints) {
    const name = squash(hint)
    if (name !== '' && !known.has(compact(name))) known.set(compact(name), name)
  }
  const glued = candidates.map(squash).filter((text) => text !== '').map((text) => squash(`${prefix}${text}`))
  const named = glued.map((text) => known.get(compact(text)) ?? text)
  const hit = named.findIndex((text) => known.has(compact(text)))
  const ordered = hit > 0 ? [named[hit] ?? '', ...named.filter((_, index) => index !== hit)] : named
  const top = ordered[0]
  const extra: string[] = []
  if (top !== undefined && compact(top).length >= 2) {
    for (const [key, name] of known) {
      if (key !== compact(top) && (key.startsWith(compact(top)) || (Array.from(key).length >= 2 && oneEditApart(key, compact(top))))) extra.push(name)
    }
  }
  const out: string[] = []
  for (const text of [...ordered, ...extra]) {
    if (!out.some((seen) => compact(seen) === compact(text))) out.push(text)
    if (out.length >= max) break
  }
  return out
}

/** 판 맨 앞 획들이 보낸 획과 같은가 (읽는 동안 지우거나 새로 열었으면 버린다) */
const startsWith = (ink: readonly InkStroke[], strokes: readonly InkStroke[]): boolean => strokes.length > 0 && strokes.length <= ink.length && strokes.every((stroke, index) => ink[index] === stroke)

export function padReducer(state: PadState, action: PadAction): PadState {
  switch (action.type) {
    case 'stroke':
      if (action.stroke.length === 0) return state
      return { ...state, ink: [...state.ink, action.stroke], missed: false }
    case 'read': {
      if (!startsWith(state.ink, action.strokes)) return state
      const ink = state.ink.slice(action.strokes.length)
      const options = rankReadings(state.text, action.candidates, action.hints)
      const [first, ...rest] = options
      if (first === undefined) return { ...state, ink, choices: [], missed: true }
      return { text: first, ink, choices: rest.slice(0, CHOICES_MAX), missed: false }
    }
    case 'pick':
      return { ...state, text: action.option, choices: [], missed: false }
    case 'space':
      if (state.text === '' || state.text.endsWith(' ')) return state
      return { ...state, text: `${state.text} `, choices: [], missed: false }
    case 'back':
      if (state.ink.length > 0) return { ...state, ink: [], missed: false }
      return { ...state, text: Array.from(state.text).slice(0, -1).join(''), choices: [], missed: false }
    case 'clear':
      return EMPTY_PAD
  }
}

/** 넣을 글: 앞뒤 빈칸·겹친 빈칸 정리 */
export const insertText = (state: PadState): string => squash(state.text)

/** 네이티브로 넘기는 모양: 획마다 [x, y, t, …] (시각은 첫 점부터 잰 ms) */
export function flattenInk(strokes: readonly InkStroke[]): number[][] {
  const start = strokes[0]?.[0]?.t ?? 0
  return strokes.map((stroke) => stroke.flatMap((point) => [Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10, Math.max(0, Math.round(point.t - start))]))
}
