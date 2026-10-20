// 재생 무결성 검사의 요금 대조 (AC-N5-26, BL-INV-2·3·4·6). 읽기만 한다(고치지 않는다).
// 범위마다 재생한 마지막 상태와 출력 기록으로 요금 쓴 기록을 다시 계산해 원장과 대조한다:
//   - 주문 건: 그 범위의 ORDERS 방식 방송에서 확정 횟수 ≥ 1인 상품 = ORDERS 쓴 기록 (키 ORDERS:<날짜>:<상품 ID>)
//   - 라벨 장: 그 범위의 DAY·ORDERS 방식 방송의 상품 라벨 출력함 작업 = LABELS 쓴 기록 (키 LABELS:<날짜>:<작업 ID>).
//     출력 중에 폐기된 뒤 출력함이 된 작업(폐기 표시가 붙은 출력함)은 출력함이 된 때 폐기였는지 기록으로 가릴 수 없어 양쪽 다 받는다.
//   - 방송 일: 방송 일을 쓴 이용 방식마다 DAYS:<방송> 쓴 기록이 있고, 그 반대도 맞고, 두 창(24시간)이 겹치지 않는다
//   - 리허설 범위의 방송에는 이용 방식이 없다. 쓴 기록의 방송은 그 범위의 맞는 이용 방식을 가진다(이용 방식 없는 방송의 쓴 기록 없음)
// 다르면 키(방송 ID·상품 ID·작업 ID만 — 개인정보 없음)를 돌려준다.
import { listProducts, type EngineState } from '@livejjim/core'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { billingModes, billingUsage, broadcasts, printJobs, printLabels } from '../db/schema.ts'
import { DAY_WINDOW_MS } from './rules.ts'

export interface BillingScope {
  readonly id: string
  readonly sellerId: string
  readonly date: string
  readonly rehearsal: boolean
}

/** 그 범위의 요금 대조. 다른 키 목록 (같으면 빈 목록) */
export async function checkBillingScope(db: Db, scope: BillingScope, state: EngineState): Promise<string[]> {
  const diffs: string[] = []
  const modes = await db
    .select({ broadcastId: billingModes.broadcastId, mode: billingModes.mode, usedDay: billingModes.usedDay })
    .from(billingModes)
    .where(and(eq(billingModes.sellerId, scope.sellerId), eq(billingModes.scopeId, scope.id)))
  if (scope.rehearsal) {
    // 리허설 방송에는 이용 방식이 없다 (BL-INV-6)
    for (const mode of modes) diffs.push(`MODE:${mode.broadcastId}`)
    return diffs
  }
  const modeOf = new Map(modes.map((mode) => [mode.broadcastId, mode]))
  const usage = await db
    .select({ kind: billingUsage.kind, key: billingUsage.key, broadcastId: billingUsage.broadcastId, at: billingUsage.at })
    .from(billingUsage)
    .where(and(eq(billingUsage.sellerId, scope.sellerId), eq(billingUsage.date, scope.date)))
  const actual = new Set(usage.map((row) => row.key))

  // 쓴 기록마다 그 범위의 맞는 이용 방식 (이용 방식 없는 방송·리허설 방송의 쓴 기록 없음)
  for (const row of usage) {
    const mode = row.broadcastId === null ? undefined : modeOf.get(row.broadcastId)
    const fits =
      mode !== undefined &&
      ((row.kind === 'DAYS' && mode.usedDay && row.key === `DAYS:${mode.broadcastId}`) ||
        (row.kind === 'ORDERS' && mode.mode === 'ORDERS') ||
        (row.kind === 'LABELS' && (mode.mode === 'DAY' || mode.mode === 'ORDERS')))
    if (!fits) diffs.push(row.key)
  }

  // 방송 일: 방송 일을 쓴 시작마다 쓴 기록 하나, 창이 겹치지 않는다 (BL-INV-2)
  for (const mode of modes) if (mode.usedDay && !actual.has(`DAYS:${mode.broadcastId}`)) diffs.push(`DAYS:${mode.broadcastId}`)
  const days = usage.filter((row) => row.kind === 'DAYS')
  if (days.length > 0) {
    const all = await db
      .select({ key: billingUsage.key, at: billingUsage.at })
      .from(billingUsage)
      .where(and(eq(billingUsage.sellerId, scope.sellerId), eq(billingUsage.kind, 'DAYS')))
    for (const row of days) {
      if (all.some((other) => other.key !== row.key && Math.abs(other.at.getTime() - row.at.getTime()) < DAY_WINDOW_MS)) diffs.push(row.key)
    }
    // 그 방송의 시작 기록(방송 행)이 있다
    for (const row of days) {
      if (row.broadcastId === null) continue
      const found = await db
        .select({ id: broadcasts.id })
        .from(broadcasts)
        .where(and(eq(broadcasts.sellerId, scope.sellerId), eq(broadcasts.id, row.broadcastId), eq(broadcasts.scopeId, scope.id)))
        .limit(1)
      if (found.length === 0) diffs.push(row.key)
    }
  }

  // 주문 건 (BL-INV-3)
  const expectedOrders = new Set(
    listProducts(state)
      .filter((product) => modeOf.get(product.broadcast)?.mode === 'ORDERS' && product.confirmVersion >= 1)
      .map((product) => `ORDERS:${scope.date}:${product.id}`),
  )
  for (const key of expectedOrders) if (!actual.has(key)) diffs.push(key)
  for (const row of usage) if (row.kind === 'ORDERS' && !expectedOrders.has(row.key)) diffs.push(row.key)

  // 라벨 장 (BL-INV-4)
  const printed = await db
    .select({ jobId: printJobs.jobId, voided: printJobs.voided, broadcast: printLabels.broadcast })
    .from(printJobs)
    .innerJoin(printLabels, and(eq(printLabels.id, printJobs.labelId), eq(printLabels.sellerId, scope.sellerId)))
    .where(and(eq(printJobs.sellerId, scope.sellerId), eq(printJobs.scopeId, scope.id), eq(printJobs.kind, 'product'), eq(printJobs.status, 'DONE')))
  const either = new Set<string>()
  const expectedLabels = new Set<string>()
  for (const job of printed) {
    const mode = job.broadcast === null ? undefined : modeOf.get(job.broadcast)?.mode
    if (mode !== 'DAY' && mode !== 'ORDERS') continue
    const key = `LABELS:${scope.date}:${job.jobId}`
    if (job.voided) either.add(key)
    else expectedLabels.add(key)
  }
  for (const key of expectedLabels) if (!actual.has(key)) diffs.push(key)
  for (const row of usage) if (row.kind === 'LABELS' && !expectedLabels.has(row.key) && !either.has(row.key)) diffs.push(row.key)

  return [...new Set(diffs)].sort()
}
