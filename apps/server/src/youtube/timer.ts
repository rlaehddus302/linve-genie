// 시계·기다리기 (Y1 워커: 수집기·발송함·봉인). 기다림이 있는 기준(백오프·기한·창·봉인)은 시험에서 주입한 시계로 빠르게 돈다.
// - Timer: now()(UTC 밀리초)와 sleep(ms, signal). 운영은 실제 setTimeout, 시험은 ManualTimer(advance로 시계를 옮기면 그때까지의 sleep이 풀린다).
// - 태평양 시간(America/Los_Angeles, 서머타임 반영) 날짜·자정 (할당량 하루, AC-Y1-51)과 KST 날짜 계산은 실행 환경 시간대와 상관없다.
import type { Clock } from '../time.ts'

export interface Timer extends Clock {
  /** ms 뒤에 풀린다. signal이 끊기면 바로 풀린다(오류 없이) */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

/** 실제 타이머 (시계는 주입할 수 있다 — 기다림은 실제 시간) */
export function realTimer(clock: Clock = { now: () => Date.now() }): Timer {
  return {
    now: () => clock.now(),
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal?.aborted === true) {
          resolve()
          return
        }
        const handle = setTimeout(done, Math.max(0, ms))
        handle.unref?.()
        function done() {
          signal?.removeEventListener('abort', done)
          clearTimeout(handle)
          resolve()
        }
        signal?.addEventListener('abort', done, { once: true })
      }),
  }
}

interface Sleeper {
  readonly at: number
  readonly resolve: () => void
  readonly order: number
}

/**
 * 시험용 시계: advance(ms)로 시계를 옮기면 그 사이에 깰 sleep을 시각 순으로 풀고, 풀릴 때마다 대기 중인 작업이 한 바퀴 돌게 한다.
 * set·advance는 now()를 바꾼다(서버 시계 Clock로도 쓴다)
 */
export class ManualTimer implements Timer {
  #now: number
  #sleepers: Sleeper[] = []
  #order = 0

  constructor(start: number) {
    this.#now = start
  }

  now(): number {
    return this.#now
  }

  /** 기다리는 sleep 수 (시험용) */
  get pending(): number {
    return this.#sleepers.length
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal?.aborted === true) {
        resolve()
        return
      }
      const sleeper: Sleeper = {
        at: this.#now + Math.max(0, ms),
        order: this.#order++,
        resolve: () => {
          signal?.removeEventListener('abort', abort)
          resolve()
        },
      }
      const abort = () => {
        this.#sleepers = this.#sleepers.filter((item) => item !== sleeper)
        resolve()
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.#sleepers.push(sleeper)
    })
  }

  /** 시계를 그 시각으로 (뒤로는 가지 않는다) — 그 사이 sleep을 시각 순으로 푼다 */
  async set(ms: number): Promise<void> {
    await this.advance(Math.max(0, ms - this.#now))
  }

  /** ms만큼 시계를 옮긴다. 깰 시각이 된 sleep을 하나씩 풀고 그 뒤 작업이 돌 틈(setImmediate)을 준다 */
  async advance(ms: number): Promise<void> {
    const target = this.#now + ms
    for (;;) {
      const due = this.#sleepers.filter((sleeper) => sleeper.at <= target).sort((a, b) => a.at - b.at || a.order - b.order)[0]
      if (due === undefined) break
      this.#sleepers = this.#sleepers.filter((sleeper) => sleeper !== due)
      this.#now = Math.max(this.#now, due.at)
      due.resolve()
      await settle()
    }
    this.#now = target
    await settle()
  }
}

/** 대기 중인 프로미스 작업이 돌 틈 (I/O 한 바퀴) */
export function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

// ── 태평양 시간 (America/Los_Angeles) ─────────────────────────────────────
// 미국 서머타임(2007년부터): 3월 둘째 일요일 02:00 PST(= 10:00 UTC) 시작, 11월 첫째 일요일 02:00 PDT(= 09:00 UTC) 끝.

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** 그 해 그 달의 n번째 일요일 (UTC 날짜 밀리초, 0시) */
function nthSunday(year: number, month: number, n: number): number {
  const first = Date.UTC(year, month, 1)
  const weekday = new Date(first).getUTCDay()
  const offset = (7 - weekday) % 7
  return first + (offset + (n - 1) * 7) * DAY
}

/** 그 순간의 태평양 시간 UTC 차이 (밀리초, PDT −7시간 · PST −8시간) */
export function pacificOffset(ms: number): number {
  const year = new Date(ms).getUTCFullYear()
  const start = nthSunday(year, 2, 2) + 10 * HOUR
  const end = nthSunday(year, 10, 1) + 9 * HOUR
  return ms >= start && ms < end ? -7 * HOUR : -8 * HOUR
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** 태평양 시간 날짜 YYYY-MM-DD (할당량 하루, AC-Y1-51) */
export function pacificDay(ms: number): string {
  const d = new Date(ms + pacificOffset(ms))
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** 다음 태평양 자정 (UTC 밀리초) — 다음 초기화 시각 */
export function nextPacificMidnight(ms: number): number {
  const day = pacificDay(ms)
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const localMidnight = Date.UTC(y, m - 1, d + 1)
  // 자정은 서머타임 바뀜(02:00)과 겹치지 않는다. PST로 먼저 보고, 그 순간이 PDT면 PDT로
  const asPst = localMidnight + 8 * HOUR
  return pacificOffset(asPst) === -7 * HOUR ? localMidnight + 7 * HOUR : asPst
}

/** 그 날짜(KST) + days일의 0시(KST)의 UTC 밀리초 (봉인 시각, AC-Y1-61) */
export function kstMidnightAfter(date: string, days: number): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d + days) - 9 * HOUR
}
