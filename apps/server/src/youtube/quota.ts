// 유튜브 할당량 (AC-Y1-50~53, D-Y09).
// - 호출마다 비용을 판매자·태평양 날짜·호출 종류별로 DB에 센다(서버를 다시 시작해도 이어서). 보낸 호출은 실패·타임아웃이어도 센다.
// - 남은 양 = min(예산 − 그 판매자 오늘 사용, 한도 − 프로젝트 오늘 사용), 0 아래로 내려가지 않는다.
// - 모드: NORMAL · BATCH(남은 양 < 예산의 20%) · PAUSED(남은 양 < 예산의 5%, 또는 오늘 구글이 quotaExceeded를 알렸음). 자정에 다시 계산한다.
// - 프로젝트 사용량은 모든 판매자의 합이다(구글 할당량은 프로젝트 하나를 함께 쓴다). 표시 API에는 그 숫자를 내지 않는다(SYS-02).
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { youtubeQuota } from '../db/schema.ts'
import { DEFAULT_COSTS, type ApiMethod } from './google.ts'
import { nextPacificMidnight, pacificDay } from './timer.ts'

export type QuotaMode = 'NORMAL' | 'BATCH' | 'PAUSED'

/** 오늘 구글이 할당량 초과를 알렸다는 표시 (호출 종류 칸에 둔다) */
export const QUOTA_EXCEEDED_MARK = '#quotaExceeded'

export interface QuotaSettings {
  /** 프로젝트 하루 한도 (기본 10,000) */
  readonly limit: number
  /** 판매자별 하루 예산 (기본 = 프로젝트 한도) */
  readonly sellerBudget: number
  readonly costs: Readonly<Record<ApiMethod, number>>
}

export const DEFAULT_QUOTA: QuotaSettings = { limit: 10_000, sellerBudget: 10_000, costs: DEFAULT_COSTS }

export interface QuotaView {
  /** 오늘 날짜 (태평양) */
  readonly day: string
  readonly used: number
  readonly remaining: number
  readonly budget: number
  /** 다음 초기화 시각 (UTC ISO) */
  readonly resetsAt: string
  readonly mode: QuotaMode
  /** 호출 종류별 횟수·단위 */
  readonly methods: readonly { readonly method: string; readonly calls: number; readonly units: number }[]
}

export class QuotaMeter {
  readonly #db: Db
  readonly #settings: QuotaSettings
  readonly #now: () => number
  /** 모드가 바뀌면 (판매자, 새 모드) */
  readonly #onMode: (sellerId: string, mode: QuotaMode) => void
  readonly #modes = new Map<string, QuotaMode>()

  constructor(db: Db, settings: QuotaSettings, now: () => number, onMode: (sellerId: string, mode: QuotaMode) => void) {
    this.#db = db
    this.#settings = settings
    this.#now = now
    this.#onMode = onMode
  }

  get settings(): QuotaSettings {
    return this.#settings
  }

  /** 호출 하나를 센다 (보내기 직전) */
  async count(sellerId: string, method: ApiMethod): Promise<void> {
    const cost = this.#settings.costs[method]
    await this.#add(sellerId, method, 1, cost)
    await this.#checkMode(sellerId)
  }

  async #add(sellerId: string, method: string, calls: number, units: number): Promise<void> {
    const day = pacificDay(this.#now())
    await this.#db
      .insert(youtubeQuota)
      .values({ sellerId, day, method, calls, units })
      .onConflictDoUpdate({
        target: [youtubeQuota.sellerId, youtubeQuota.day, youtubeQuota.method],
        set: { calls: sql`${youtubeQuota.calls} + ${calls}`, units: sql`${youtubeQuota.units} + ${units}` },
      })
  }

  /** 구글이 할당량 초과를 알렸다 (오늘은 멈춤, AC-Y1-52) */
  async markExceeded(sellerId: string): Promise<void> {
    await this.#add(sellerId, QUOTA_EXCEEDED_MARK, 1, 0)
    await this.#checkMode(sellerId)
  }

  async #checkMode(sellerId: string): Promise<void> {
    const mode = await this.mode(sellerId)
    const before = this.#modes.get(sellerId)
    this.#modes.set(sellerId, mode)
    if (before !== undefined && before !== mode) this.#onMode(sellerId, mode)
  }

  /** 그 판매자의 오늘 사용·프로젝트 오늘 사용·오늘 구글 초과 알림 */
  async #usage(sellerId: string, day: string): Promise<{ seller: number; project: number; exceeded: boolean }> {
    const rows = await this.#db
      .select({
        seller: sql<number>`coalesce(sum(case when ${youtubeQuota.sellerId} = ${sellerId} then ${youtubeQuota.units} else 0 end), 0)::int`,
        project: sql<number>`coalesce(sum(${youtubeQuota.units}), 0)::int`,
        exceeded: sql<number>`coalesce(sum(case when ${youtubeQuota.method} = ${QUOTA_EXCEEDED_MARK} then 1 else 0 end), 0)::int`,
      })
      .from(youtubeQuota)
      // 프로젝트 할당량은 모든 판매자가 함께 쓴다 — 합계만 읽는다(다른 판매자의 행을 내보내지 않는다)
      .where(eq(youtubeQuota.day, day))
    const row = rows[0]
    return { seller: Number(row?.seller ?? 0), project: Number(row?.project ?? 0), exceeded: Number(row?.exceeded ?? 0) > 0 }
  }

  /** 남은 양 (AC-Y1-51) */
  async remaining(sellerId: string): Promise<number> {
    const usage = await this.#usage(sellerId, pacificDay(this.#now()))
    return Math.max(0, Math.min(this.#settings.sellerBudget - usage.seller, this.#settings.limit - usage.project))
  }

  /** 지금 모드 (AC-Y1-52) */
  async mode(sellerId: string): Promise<QuotaMode> {
    const usage = await this.#usage(sellerId, pacificDay(this.#now()))
    return modeOf(this.#settings, usage)
  }

  /** 표시 (AC-Y1-53) — 그 판매자 것만 */
  async view(sellerId: string): Promise<QuotaView> {
    const now = this.#now()
    const day = pacificDay(now)
    const usage = await this.#usage(sellerId, day)
    const rows = await this.#db
      .select({ method: youtubeQuota.method, calls: youtubeQuota.calls, units: youtubeQuota.units })
      .from(youtubeQuota)
      .where(and(eq(youtubeQuota.sellerId, sellerId), eq(youtubeQuota.day, day)))
    const remaining = Math.max(0, Math.min(this.#settings.sellerBudget - usage.seller, this.#settings.limit - usage.project))
    return {
      day,
      used: usage.seller,
      remaining,
      budget: this.#settings.sellerBudget,
      resetsAt: new Date(nextPacificMidnight(now)).toISOString(),
      mode: modeOf(this.#settings, usage),
      methods: rows
        .filter((row) => row.method !== QUOTA_EXCEEDED_MARK)
        .map((row) => ({ method: row.method, calls: row.calls, units: row.units }))
        .sort((a, b) => a.method.localeCompare(b.method)),
    }
  }

  /** 자정 뒤 모드를 다시 계산해 바뀐 판매자에게 알린다 (워커가 부른다) */
  async recheck(sellerIds: readonly string[]): Promise<void> {
    for (const sellerId of sellerIds) await this.#checkMode(sellerId)
  }
}

export function modeOf(settings: QuotaSettings, usage: { seller: number; project: number; exceeded: boolean }): QuotaMode {
  const remaining = Math.max(0, Math.min(settings.sellerBudget - usage.seller, settings.limit - usage.project))
  if (usage.exceeded || remaining < settings.sellerBudget * 0.05) return 'PAUSED'
  if (remaining < settings.sellerBudget * 0.2) return 'BATCH'
  return 'NORMAL'
}
