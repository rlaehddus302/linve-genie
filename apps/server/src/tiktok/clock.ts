// 틱톡 연결 객체의 시계·타이머 (주입한다 — 시험은 가짜 시계로 다시 시도 간격·시간 초과·60초 유지를 빠르게 돈다).

export interface TikTokClock {
  /** 지금 시각 (UTC 밀리초) */
  now(): number
  /** ms 뒤에 fn을 한 번 부른다. 돌려준 함수를 부르면 취소한다 */
  setTimer(ms: number, fn: () => void): () => void
}

/** 실제 시계. 타이머가 프로세스를 붙잡지 않게 unref한다 */
export const systemTikTokClock: TikTokClock = {
  now: () => Date.now(),
  setTimer(ms, fn) {
    const timer = setTimeout(fn, ms)
    timer.unref()
    return () => clearTimeout(timer)
  },
}
