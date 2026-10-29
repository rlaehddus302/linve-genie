// 중간 결과 안정 (DOMAIN_RULES R-17 8, D-V3-71, AC-V3-75): "듣는 중" 칸의 중간 결과 "148번 280"이 1,000ms 동안 바뀌지 않으면 바로 등록하고,
// 최종 글에서 그 가격이 사라지면 1,000ms 넘게 보였던 중간 후보로 등록한다. 순수 함수: 시각은 부르는 쪽(화면)이 넘긴다.
import { readSegments, type SegmentOptions, type SegmentPick } from './segments.ts'

/** 안정으로 보는 시간 (밀리초) — 999ms면 아직, 1,000ms면 확정 */
export const INTERIM_STABLE_MS = 1_000

/** 중간 결과 후보 — 최종이면 확정될 빠른 꼴 조각(D-V3-48·63, 판매 말투 D-V3-69 포함) */
export interface InterimCandidate {
  readonly no: number
  readonly price: number
  readonly name: string | null
}

/** 본 후보와 보인 시간 (since = 처음 본 시각, until = 마지막으로 같은 후보를 본 시각) */
export interface InterimSeen extends InterimCandidate {
  readonly since: number
  readonly until: number
}

/**
 * 중간 결과 글의 후보: 글 끝 조각이 최종이면 확정될 빠른 꼴(priceFrom 'quick')인데 중간 결과라 아직 확정이 아닌 것. 없으면 null.
 * (`N번 … 원` 짝은 중간 결과에서도 바로 확정이라 후보가 아니다)
 */
export function interimCandidate(text: unknown, options: SegmentOptions = {}): InterimCandidate | null {
  const asFinal = readSegments(text, { ...options, final: true })
  const last = asFinal.picks[asFinal.picks.length - 1]
  // 확정 아닌 조각(천원 단위 작은 수, D-V3-112)은 중간 결과로 등록하지 않는다 — 최종 결과에서 카드·묻기로
  if (last === undefined || last.priceFrom !== 'quick' || (last.check ?? null) !== null) return null
  const asInterim = readSegments(text, { ...options, final: false })
  if (asInterim.picks.some((pick) => pick.no === last.no && pick.price === last.price && pick.start === last.start)) return null
  return { no: last.no, price: last.price, name: last.name }
}

const same = (a: InterimCandidate, b: InterimCandidate): boolean => a.no === b.no && a.price === b.price

/**
 * 중간 결과가 올 때마다·타이머마다 부른다 (now = UTC 밀리초). 같은 후보(번호·수)면 보인 시간을 늘리고, 바뀌면 새로 센다.
 * stable = 1,000ms 이상 같은 후보 → 바로 등록할 것 (D-V3-71 (ㄱ)). candidate null이면 그대로(후보가 사라진 것은 최종에서 본다)
 */
export function trackInterim(seen: readonly InterimSeen[], candidate: InterimCandidate | null, now: number): { readonly seen: InterimSeen[]; readonly stable: InterimSeen | null } {
  const list = [...seen]
  if (candidate === null || !Number.isFinite(now)) return { seen: list, stable: null }
  const last = list[list.length - 1]
  if (last !== undefined && same(last, candidate)) {
    const updated: InterimSeen = { ...last, name: candidate.name ?? last.name, until: Math.max(last.until, now) }
    list[list.length - 1] = updated
    return { seen: list, stable: updated.until - updated.since >= INTERIM_STABLE_MS ? updated : null }
  }
  list.push({ ...candidate, since: now, until: now })
  return { seen: list, stable: null }
}

/**
 * 덩어리가 끝났을 때 (D-V3-71 (ㄴ)): 최종 글에서 그 번호의 가격이 사라졌거나 번호가 바뀌었으면, 1,000ms 이상 보였던 중간 후보(가장 나중 것)로 등록한다.
 * finalPicks = 최종 글의 readSegments picks. 이미 등록한 번호(registered)는 보지 않는다
 */
export function interimFallback(seen: readonly InterimSeen[], finalPicks: readonly SegmentPick[], registered: readonly number[] = []): InterimSeen | null {
  for (let i = seen.length - 1; i >= 0; i--) {
    const item = seen[i] as InterimSeen
    if (item.until - item.since < INTERIM_STABLE_MS) continue
    if (registered.includes(item.no)) continue
    if (finalPicks.some((pick) => pick.no === item.no)) continue
    return item
  }
  return null
}
