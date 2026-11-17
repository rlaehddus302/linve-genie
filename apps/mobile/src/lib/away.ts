// 자리를 비운 동안 (APP-04, D-APP-16): 앱이 뒤로 갔다 앞으로 돌아오면 콘솔 맨 위에 한 줄
// "자리를 비운 동안 찜 n건·음성 n개"(0인 것은 빼고, 모두 0이면 줄 없음)를 10초 보인다.
// - 찜 n건: 뒤로 갈 때 알던 찜 ID와 돌아와 따라잡은 뒤의 찜 ID를 견준다(새로 생긴 찜 수).
// - 음성 n개: 뒤에 있는 동안 받아 처리한 음성 결과 수.
// 라벨 장 수는 뺐다 (D-PRINTALL-01, 사용자 지시 2026-11-17 "'자리를 비운 동안 라벨 57장' 알림 … 존재 가치 없으면 지우고"): 라벨은 앱이 뒤로 가도
// 이어 찍히고, 남은 라벨은 라벨 탭 [대기 중인 라벨 모두 출력하기]에서 본다. 옛 D-RETRO-141(누르면 대기 라벨 뽑기로 감)도 함께 없앴다.
import { awayLine } from './words.ts'

export const AWAY_LINE_MS = 10_000

export interface AwayCounts {
  readonly claims: number
  readonly voice: number
}

export interface AwaySnapshot {
  /** 보일 한 줄 (없으면 null) */
  readonly line: string | null
  /** 줄이 사라질 시각 (밀리초) */
  readonly until: number
}

const NO_LINE: AwaySnapshot = { line: null, until: 0 }

export class AwayTracker {
  #claimsBefore: ReadonlySet<string> | null = null
  #voice = 0
  #leftAt: number | null = null
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

  /** 앞으로 돌아와 따라잡은 뒤: 줄을 정한다 */
  back(claimIds: Iterable<string>, now: number): AwayCounts | null {
    if (this.#leftAt === null) return null
    const before = this.#claimsBefore ?? new Set<string>()
    let claims = 0
    for (const id of claimIds) if (!before.has(id)) claims++
    const counts: AwayCounts = { claims, voice: this.#voice }
    this.#claimsBefore = null
    this.#leftAt = null
    this.#voice = 0
    const line = awayLine(counts)
    this.#snapshot = line === null ? NO_LINE : { line, until: now + AWAY_LINE_MS }
    this.#emit()
    return counts
  }

  /** 10초가 지났으면 줄을 지운다 */
  tick(now: number): void {
    if (this.#snapshot.line !== null && now >= this.#snapshot.until) {
      this.#snapshot = NO_LINE
      this.#emit()
    }
  }
}
