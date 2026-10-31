// 결제 대기 자동 재확인 차례 (BL-6 9, D-PAY-08, AC-PAY2-06~08). 서버 시작 때 한 번(꺼져 있던 동안 지난 칸을 한 번에), 그 뒤 RECHECK_EVERY_MS마다.
// 어디까지 했는지는 DB(billing_orders.recheck_done)에 있다 — 다시 켜도 칸을 두 번 하지 않는다. 요금 기능이 꺼져 있으면 돌지 않는다.
import { errorKind, type LogSink } from '../log.ts'
import type { Timer } from '../youtube/timer.ts'
import type { BillingService, RecheckPass } from './service.ts'

/** 자동 재확인을 찾는 간격 (가장 짧은 칸 1분보다 짧게) */
export const RECHECK_EVERY_MS = 20_000

export class BillingRechecker {
  readonly #billing: BillingService
  readonly #timer: Timer
  readonly #log: LogSink
  #loop: Promise<void> | null = null
  #stopped = false
  #wake = new AbortController()

  constructor(options: { readonly billing: BillingService; readonly timer: Timer; readonly log: LogSink }) {
    this.#billing = options.billing
    this.#timer = options.timer
    this.#log = options.log
  }

  start(): void {
    if (this.#loop !== null || !this.#billing.enabled) return
    this.#stopped = false
    this.#loop = (async () => {
      while (!this.#stopped) {
        await this.runOnce()
        if (this.#stopped) break
        this.#wake = new AbortController()
        await this.#timer.sleep(RECHECK_EVERY_MS, this.#wake.signal)
      }
    })()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#wake.abort()
    await this.#loop
    this.#loop = null
  }

  /** 한 차례 (실패해도 다음 차례에 다시) */
  async runOnce(): Promise<RecheckPass> {
    try {
      return await this.#billing.recheckDue()
    } catch (error) {
      this.#log({ level: 'warn', code: 'BILLING_FAILED', errorKind: errorKind(error) })
      return { checked: 0 }
    }
  }
}
