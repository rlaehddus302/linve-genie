// 자리를 비운 동안 (APP-04, D-APP-16): 앱이 뒤로 갔다 앞으로 돌아오면 콘솔 맨 위에 한 줄
// "자리를 비운 동안 라벨 n장·찜 n건·음성 n개"(0인 것은 빼고, 모두 0이면 줄 없음)를 10초 보인다.
// - 찜 n건: 뒤로 갈 때 알던 찜 ID와 돌아와 따라잡은 뒤의 찜 ID를 견준다(새로 생긴 찜 수).
// - 라벨 n장: 돌아온 뒤 서버 대기열에 남아 있던 장 수(대기 + 출력 중) — 이어 찍는다.
// - 음성 n개: 뒤에 있는 동안 받아 처리한 음성 결과 수.
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
  /** 줄이 사라질 시각 (밀리초) */
  readonly until: number
}

export class AwayTracker {
  #claimsBefore: ReadonlySet<string> | null = null
  #voice = 0
  #leftAt: number | null = null
  #snapshot: AwaySnapshot = { line: null, until: 0 }
  readonly #listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  getSnapshot = (): AwaySnapshot => this.#snapshot

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

  /** 앞으로 돌아와 따라잡은 뒤: 줄을 정한다 */
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
    this.#snapshot = { line, until: line === null ? 0 : now + AWAY_LINE_MS }
    for (const listener of [...this.#listeners]) listener()
    return counts
  }

  /** 10초가 지났으면 줄을 지운다 */
  tick(now: number): void {
    if (this.#snapshot.line !== null && now >= this.#snapshot.until) {
      this.#snapshot = { line: null, until: 0 }
      for (const listener of [...this.#listeners]) listener()
    }
  }
}
