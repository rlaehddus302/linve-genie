// 판정 순위 (R-6, D-052). 찜마다 키 하나로 정해 어느 세 찜에서도 순서가 고리처럼 뒤엉키지 않는다.
// - ARRIVAL: seq
// - RECEIVED_TIME: (T, r, seq). 정확한 시각 t → (t, 1). 분 단위 문자 [m, m+1분) → SMS면 (m, 0), YOUTUBE·HOST면 (m+1분, 0)
import type { SaleSettings } from '../settings.ts'

const MINUTE = 60_000

/** 찜마다의 순위 재료 (R-6 "찜마다의 순위 재료") */
export interface RankMaterial {
  readonly seq: number
  /** 실제 시각(UTC 밀리초). 분 단위 문자는 구간 시작 */
  readonly time: number
  /** 분 단위 문자 */
  readonly minute: boolean
}

export type ContentionSettings = Pick<SaleSettings, 'contention.policy' | 'contention.sameMinuteTieBreaker'>

/** RECEIVED_TIME 정렬 키 (T, r, seq) */
export function rankKey(material: RankMaterial, tieBreaker: SaleSettings['contention.sameMinuteTieBreaker']): readonly [number, number, number] {
  if (!material.minute) return [material.time, 1, material.seq]
  return [tieBreaker === 'SMS' ? material.time : material.time + MINUTE, 0, material.seq]
}

/** 음수면 a가 앞선다. 정책이 ARRIVAL이면 seq만 본다 */
export function compareRank(a: RankMaterial, b: RankMaterial, settings: ContentionSettings): number {
  if (settings['contention.policy'] !== 'RECEIVED_TIME') return a.seq - b.seq
  const tieBreaker = settings['contention.sameMinuteTieBreaker']
  const [ta, ra, sa] = rankKey(a, tieBreaker)
  const [tb, rb, sb] = rankKey(b, tieBreaker)
  return ta - tb || ra - rb || sa - sb
}

/**
 * 동률 (R-6): 분 단위 문자 [m, m+1분)과 정확한 시각 t 사이에서 m ≤ t < m+1분인 경우뿐이다.
 * 정확한 시각 쪽이 초까지 입력한 문자여도 같다. 분 단위끼리·정확한 시각끼리는 동률이 아니다(seq 순).
 */
export function isSameMinuteTie(a: RankMaterial, b: RankMaterial): boolean {
  if (a.minute === b.minute) return false
  const [minute, exact] = a.minute ? [a, b] : [b, a]
  return minute.time <= exact.time && exact.time < minute.time + MINUTE
}
