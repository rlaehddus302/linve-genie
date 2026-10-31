// 손님 장부·방송 일정 정리 작업 (KP1 CR-3·CR-5·MR-6, AC-KP1-06·24). 서버 시작 때 한 번, 그 뒤 1시간마다 (CustomerArchiver와 같은 타이머 방식 — 시험은 가짜 시계).
// 1. 지우는 날 0시(KST)가 지난 장부 줄 지우기(EXPIRE '기간 지남') 2. 기한 지난 연결 코드 끝내기 (LedgerService.sweepOnce)
// 3·4. 알림 신청 기한 지남·지난 일정 지우기 (방송 일정 쪽 sweepSchedule — server.ts가 넘긴다)
// 한쪽이 실패해도 다른 쪽은 돈다. 로그에는 개수·오류 종류만.
import { errorKind, type LogSink } from '../log.ts'
import type { Timer } from '../youtube/timer.ts'
import type { LedgerService } from './ledger.ts'

/** 정리 간격 (1시간, CR-3) */
export const LEDGER_SWEEP_EVERY_MS = 60 * 60 * 1000

export interface LedgerSweeperOptions {
  readonly ledger: LedgerService
  readonly timer: Timer
  readonly log: LogSink
  /** 방송 일정 정리 (schedule/sweep.ts sweepSchedule(db, now)) — 없으면 장부만 */
  readonly schedule?: (now: Date) => Promise<void>
}

export class LedgerSweeper {
  readonly #options: LedgerSweeperOptions
  #loop: Promise<void> | null = null
  #stopped = false
  #wake = new AbortController()

  constructor(options: LedgerSweeperOptions) {
    this.#options = options
  }

  start(): void {
    if (this.#loop !== null) return
    this.#stopped = false
    this.#loop = (async () => {
      while (!this.#stopped) {
        await this.runOnce()
        if (this.#stopped) break
        this.#wake = new AbortController()
        await this.#options.timer.sleep(LEDGER_SWEEP_EVERY_MS, this.#wake.signal)
      }
    })()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#wake.abort()
    await this.#loop
    this.#loop = null
  }

  /** 한 차례 (실패해도 던지지 않는다 — 다음 차례에 다시) */
  async runOnce(): Promise<void> {
    const { ledger, timer, log, schedule } = this.#options
    try {
      await ledger.sweepOnce()
    } catch (error) {
      log({ level: 'error', code: 'LEDGER_SWEEP_FAILED', errorKind: errorKind(error) })
    }
    if (schedule === undefined) return
    try {
      await schedule(new Date(timer.now()))
    } catch (error) {
      log({ level: 'error', code: 'LEDGER_SWEEP_FAILED', errorKind: errorKind(error) })
    }
  }
}
