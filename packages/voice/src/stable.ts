// 굳은 중간 글 (사용자 결정, 실방송 V3: "계속 듣는중이면 결국 등록이 안되잖아. 1~2초 정도 지난 말이면 그냥 확정된 단어잖아.")
// 판매자가 쉬지 않고 말하면 크롬은 중간 결과(회색)를 오래 들고 있다가 늦게 최종을 내거나 고쳐 쓴다.
// 중간 결과의 앞 낱말들이 1,000ms 넘게 그대로면(마지막 낱말 빼고) 그 앞부분은 최종 결과처럼 받는다(같은 조각 읽기·기다리는 번호·가격 고침·번호 옮기기 모두).
// 순수 함수: 시계를 읽지 않고(now를 받는다) 넘긴 상태를 바꾸지 않는다.

/** 낱말이 이만큼 그대로면 굳은 것으로 본다 (밀리초) — 1,000ms면 굳음, 999ms면 아직 */
export const STABLE_MS = 1_000

/** 지금 결과(크롬 결과 하나)의 중간 글 상태 */
export interface StableState {
  /** 마지막 중간 글의 낱말 (공백으로 나눈 그대로) */
  readonly tokens: readonly string[]
  /** 낱말마다 그 자리·그 앞 낱말이 모두 지금과 같아진 첫 시각 */
  readonly since: readonly number[]
  /** 이 결과에서 이미 최종처럼 넘긴 앞 낱말 수 */
  readonly taken: number
}

export const STABLE_EMPTY: StableState = Object.freeze({ tokens: Object.freeze([]), since: Object.freeze([]), taken: 0 })

export interface StableStep {
  readonly state: StableState
  /** 이번에 새로 굳어 최종처럼 넘길 글 (없으면 null) */
  readonly confirm: string | null
  /** 아직 굳지 않은 중간 글 (넘긴 앞부분을 뺀 것, 없으면 '') */
  readonly interim: string
  /** 다음에 다시 볼 시각 (아직 굳지 않은 낱말이 굳는 때, 없으면 null) */
  readonly nextAt: number | null
}

const words = (text: unknown): string[] => (typeof text === 'string' ? text.split(/\s+/).filter((word) => word !== '') : [])
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function validState(state: StableState | null | undefined): StableState {
  if (state === null || state === undefined || !Array.isArray(state.tokens) || !Array.isArray(state.since) || state.tokens.length !== state.since.length) return STABLE_EMPTY
  const taken = Number.isSafeInteger(state.taken) && state.taken >= 0 ? state.taken : 0
  return { tokens: state.tokens, since: state.since, taken }
}

/** 굳은 낱말 수: 앞에서부터 since + 1,000 ≤ now인 낱말이 이어진 만큼 (마지막 낱말은 부르는 쪽이 뺀다) */
function stableCount(since: readonly number[], now: number): number {
  let k = 0
  while (k < since.length && (since[k] as number) + STABLE_MS <= now) k++
  return k
}

/**
 * 중간 결과가 왔을 때(또는 text = 지난 중간 글 그대로로 다시 볼 때): 앞 낱말이 같으면 그 시각을 이어 가고, 달라진 자리부터는 now로 다시 센다.
 * 이미 넘긴 앞부분(taken)은 크롬이 고쳐 써도 되돌리지 않는다. 다만 첫 낱말부터 달라지면 새 결과로 보고 처음부터 센다(넘긴 글은 그대로 — 같은 번호 규칙이 겹침을 받는다).
 */
export function stepStable(input: StableState | null | undefined, text: unknown, now: number): StableStep {
  try {
    const state = validState(input)
    const tokens = words(text)
    if (!isTime(now)) return { state, confirm: null, interim: tokens.slice(state.taken).join(' '), nextAt: null }
    let same = 0
    while (same < tokens.length && same < state.tokens.length && tokens[same] === state.tokens[same]) same++
    const since = tokens.map((_, i) => (i < same ? (state.since[i] as number) : now))
    let taken = state.taken
    if (taken > 0 && same === 0 && tokens.length > 0) taken = 0
    // 마지막 낱말은 아직 자라는 중일 수 있어 넘기지 않는다 (`50` → `50만` — 굳은 줄 알고 넘기면 가격이 갈린다)
    const count = Math.min(stableCount(since, now), Math.max(0, tokens.length - 1))
    let confirm: string | null = null
    if (count > taken) {
      confirm = tokens.slice(taken, count).join(' ')
      taken = count
    }
    const waiting = since.slice(taken, Math.max(taken, tokens.length - 1)).filter(isTime)
    const nextAt = waiting.length === 0 ? null : Math.min(...waiting) + STABLE_MS
    return { state: { tokens, since, taken }, confirm, interim: tokens.slice(taken).join(' '), nextAt }
  } catch {
    return { state: STABLE_EMPTY, confirm: null, interim: typeof text === 'string' ? text : '', nextAt: null }
  }
}

/**
 * 최종 결과가 왔을 때: 이미 넘긴 앞 낱말 수만큼 떼고 남은 글을 최종으로 쓴다. 상태는 처음으로.
 * 최종이 앞부분을 고쳐 썼어도 넘긴 낱말 수만큼 뗀다(넘긴 글로 한 등록은 되돌리지 않는다).
 */
export function finishStable(input: StableState | null | undefined, finalText: unknown): { readonly state: StableState; readonly text: string } {
  try {
    const state = validState(input)
    const tokens = words(finalText)
    return { state: STABLE_EMPTY, text: tokens.slice(state.taken).join(' ') }
  } catch {
    return { state: STABLE_EMPTY, text: typeof finalText === 'string' ? finalText : '' }
  }
}
