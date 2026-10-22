// 서버 전체 틱톡 연결 시도 한도 (D-N2b-2-11 (다), AC-N2b-2-42, RA-N2b-1-02).
// 모든 판매자가 서버 주소 하나로 틱톡에 붙는다 — 한 판매자의 다시 시도가 서버 주소를 막아 다른 판매자까지 끊기지 않게,
// 서버 하나의 모든 연결 객체가 한도 하나를 나눈다: 지난 60,000ms 안에 시작한 시도가 30번이면 새 시도는 가장 오래된 시도가 60,000ms를 넘길 때까지 미룬다.
// 시계는 부르는 쪽이 넘긴다(연결 객체의 주입한 시계).

export const TIKTOK_ATTEMPTS_PER_WINDOW = 30
export const TIKTOK_ATTEMPT_WINDOW_MS = 60_000

export interface TikTokAttemptLimiter {
  /** 지금 시도할 수 있으면 자리를 잡고 0, 아니면 자리가 나는 때까지 남은 밀리초(자리는 잡지 않는다) */
  reserve(now: number): number
  /** 자리를 잡지 않고 남은 밀리초만 (0이면 지금 자리가 있다) */
  wait(now: number): number
  /** 지난 창 안의 시도 수 (시험·운영 상태) */
  used(now: number): number
}

export function createTikTokAttemptLimiter(max: number = TIKTOK_ATTEMPTS_PER_WINDOW, windowMs: number = TIKTOK_ATTEMPT_WINDOW_MS): TikTokAttemptLimiter {
  const limit = Math.max(1, Math.floor(max))
  /** 창 안의 시도 시각 (오름차순) */
  let times: number[] = []
  const prune = (now: number): void => {
    // 지난 windowMs 안 = (now − windowMs, now]. 정확히 windowMs 전 시도는 창 밖이다
    let drop = 0
    while (drop < times.length && (times[drop] as number) <= now - windowMs) drop += 1
    if (drop > 0) times = times.slice(drop)
  }
  const wait = (now: number): number => {
    prune(now)
    if (times.length < limit) return 0
    return Math.max(1, (times[times.length - limit] as number) + windowMs - now)
  }
  return {
    reserve(now) {
      const left = wait(now)
      if (left === 0) times.push(now)
      return left
    },
    wait,
    used(now) {
      prune(now)
      return times.length
    },
  }
}

/** 한도가 없는 것 (시험에서 한도를 보지 않을 때) */
export const UNLIMITED_TIKTOK_ATTEMPTS: TikTokAttemptLimiter = Object.freeze({ reserve: () => 0, wait: () => 0, used: () => 0 })
