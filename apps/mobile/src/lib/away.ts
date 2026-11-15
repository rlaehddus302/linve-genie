// 자리를 비운 동안 (APP-04, D-APP-16): 앱이 뒤로 갔다 앞으로 돌아오면 콘솔 맨 위에 한 줄
// "자리를 비운 동안 라벨 n장·찜 n건·음성 n개"(0인 것은 빼고, 모두 0이면 줄 없음)를 10초 보인다.
// - 찜 n건: 뒤로 갈 때 알던 찜 ID와 돌아와 따라잡은 뒤의 찜 ID를 견준다(새로 생긴 찜 수).
// - 라벨 n장: 돌아온 뒤 서버 대기열에 남아 있던 장 수(대기 + 출력 중) — 이어 찍는다. 라벨 출력이 꺼져 있으면 화면이 0을 넘긴다(D-RETRO-141).
// - 음성 n개: 뒤에 있는 동안 받아 처리한 음성 결과 수.
// 라벨이 남아 있는 동안 (D-RETRO-141, 사용자 메모 11-13 "누르면 넘어가든 해야 할 듯"): 줄을 누르면 대기 라벨 뽑기로 간다. 남은 장 수는 뽑히는 대로
// 줄어들고(늘지는 않는다 — 자리를 비운 동안의 것만), 다 뽑거나 라벨 출력을 끄면 라벨 몫이 빠진다. 라벨이 남아 있으면 10초가 지나도 줄을 거두지 않는다.
import { awayLine } from './words.ts'

export const AWAY_LINE_MS = 10_000

export interface AwayCounts {
  readonly labels: number
  readonly claims: number
  readonly voice: number
}

export interface AwaySnapshot {
  /** 보일 한 줄 (없으면 null) */
  readonly line: string | null
  /** 줄이 사라질 시각 (밀리초) — 라벨이 남아 있으면 그 뒤에도 남는다 */
  readonly until: number
  /** 줄에 든 라벨 장 수 (0이면 누를 것이 없다) */
  readonly labels: number
}

const NO_LINE: AwaySnapshot = { line: null, until: 0, labels: 0 }

export class AwayTracker {
  #claimsBefore: ReadonlySet<string> | null = null
  #voice = 0
  #leftAt: number | null = null
  #counts: AwayCounts | null = null
  #snapshot: AwaySnapshot = NO_LINE
  readonly #listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): AwaySnapshot => this.#snapshot

  #emit(): void {
    for (const listener of [...this.#listeners]) listener()
  }

  /** 앱이 뒤로 갔다 */
  leave(claimIds: Iterable<string>, now: number): void {
    this.#claimsBefore = new Set(claimIds)
    this.#voice = 0
    this.#leftAt = now
  }

  get away(): boolean {
    return this.#leftAt !== null
  }

  /** 뒤에 있는 동안 음성 결과를 하나 처리했다 */
  noteVoice(): void {
    if (this.#leftAt !== null) this.#voice++
  }

  /** 앞으로 돌아와 따라잡은 뒤: 줄을 정한다. labelsWaiting은 라벨 출력이 꺼져 있으면 0을 넘긴다 */
  back(claimIds: Iterable<string>, labelsWaiting: number, now: number): AwayCounts | null {
    if (this.#leftAt === null) return null
    const before = this.#claimsBefore ?? new Set<string>()
    let claims = 0
    for (const id of claimIds) if (!before.has(id)) claims++
    const counts: AwayCounts = { labels: Math.max(0, labelsWaiting), claims, voice: this.#voice }
    this.#claimsBefore = null
    this.#leftAt = null
    this.#voice = 0
    const line = awayLine(counts)
    this.#counts = line === null ? null : counts
    this.#snapshot = line === null ? NO_LINE : { line, until: now + AWAY_LINE_MS, labels: counts.labels }
    this.#emit()
    return counts
  }

  /**
   * 지금 남은 라벨 장 수 (대기 + 출력 중, 라벨 출력이 꺼져 있으면 0): 줄의 라벨 몫을 줄인다(늘리지 않는다).
   * 다 뽑혀 0이 되면 라벨 몫을 빼고, 10초가 이미 지났으면 줄을 거둔다
   */
  labelsNow(remaining: number, now: number): void {
    const counts = this.#counts
    if (counts === null || counts.labels === 0) return
    const labels = Math.max(0, Math.min(counts.labels, remaining))
    if (labels === counts.labels) return
    const next: AwayCounts = { ...counts, labels }
    const line = awayLine(next)
    if (line === null || (labels === 0 && now >= this.#snapshot.until)) {
      this.#counts = null
      this.#snapshot = NO_LINE
    } else {
      this.#counts = next
      this.#snapshot = { line, until: this.#snapshot.until, labels }
    }
    this.#emit()
  }

  /** 10초가 지났으면 줄을 지운다 — 라벨이 남아 있으면 둔다(다 뽑으면 labelsNow가 거둔다) */
  tick(now: number): void {
    if (this.#snapshot.line !== null && this.#snapshot.labels === 0 && now >= this.#snapshot.until) {
      this.#counts = null
      this.#snapshot = NO_LINE
      this.#emit()
    }
  }
}
