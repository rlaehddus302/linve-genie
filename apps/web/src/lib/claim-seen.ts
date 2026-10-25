// 찜을 이 탭이 처음 받은 시각 (D-MOB2-15). 시간이 지난 보류 찜 판단(D-MOB2-06)은 서버 시각(찜의 at)과 휴대폰 시계를 견주지 않고
// (지금 − 이 탭이 그 찜을 처음 받은 때)로 잰다 — 둘 다 이 기기 시계라 시계 차이가 없다. 처음 받은 때는 실제 들어온 때보다
// 늘 같거나 늦어 화면이 엔진보다 먼저 "시간 지남"이라 하지 않는다(늦게 바뀌는 쪽만).
// - 전체 조회(스냅샷)든 실시간 증분이든 그 찜이 이 탭의 자료에 처음 들어온 때의 Date.now()를 남긴다. 같은 찜이 다시 와도 처음 값 그대로.
// - 탭 메모리에만(새로고침하면 다시 잰다). 한 탭의 화면들(콘솔·구매자·문자찜 …)이 같은 기록을 써 낱말이 같다.
import type { ScopeData, SeenAt } from './scope-data.ts'

export class ClaimSeen {
  readonly #at = new Map<string, number>()
  /** 이미 훑은 찜 목록(같은 Map이면 다시 훑지 않는다 — 증분은 바뀐 목록만 새 Map) */
  readonly #done = new WeakSet<ScopeData['claims']>()

  /** 자료의 찜 중 처음 보는 것에 지금 시각을 남기고, 기록을 붙인 자료를 돌려준다 */
  note<T extends ScopeData>(data: T, now: number): T {
    if (!this.#done.has(data.claims)) {
      for (const id of data.claims.keys()) {
        const key = seenKey(data, id)
        if (!this.#at.has(key)) this.#at.set(key, now)
      }
      this.#done.add(data.claims)
    }
    return { ...data, seen: this.view(data) }
  }

  /** 그 범위(날짜·리허설)의 찜 ID → 처음 받은 시각 */
  view(scope: Pick<ScopeData, 'date' | 'rehearsal'>): SeenAt {
    const at = this.#at
    return { get: (id: string) => at.get(seenKey(scope, id)) }
  }
}

function seenKey(scope: Pick<ScopeData, 'date' | 'rehearsal'>, id: string): string {
  return `${scope.date}|${scope.rehearsal ? 'r' : 'l'}|${id}`
}

/** 이 탭 하나의 기록 (저장소마다 따로 두지 않는다 — 화면을 옮겨도 처음 받은 때가 그대로) */
export const TAB_CLAIM_SEEN = new ClaimSeen()
