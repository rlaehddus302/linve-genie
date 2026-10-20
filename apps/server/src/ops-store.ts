// 운영 상태의 합친 숫자 (SYS-05, D-I3-16, AC-I3-81). 운영자가 서버 전체를 보는 질의라 판매자 ID 조건이 없다 —
// 대신 판매자를 가리는 값(판매자 ID·가게 이름·채널·방송 제목·닉네임·채팅·토큰·IP)은 하나도 꺼내지 않고 상태·이유별 개수만 센다.
import { and, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { events, outbox, youtubeCollectors } from './db/schema.ts'

/** 수집 상태별 수 (STOPPED는 이유별) */
export async function collectorCounts(db: Db): Promise<Record<string, number | Record<string, number>>> {
  const rows = await db
    .select({ status: youtubeCollectors.status, reason: youtubeCollectors.reason, n: sql<number>`count(*)::int` })
    .from(youtubeCollectors)
    .groupBy(youtubeCollectors.status, youtubeCollectors.reason)
  const out: Record<string, number | Record<string, number>> = {}
  for (const row of rows) {
    const status = statusName(row.status)
    if (status === 'STOPPED' || status === 'RETRYING' || status === 'STARTING') {
      const byReason = (out[status] ?? {}) as Record<string, number>
      const reason = reasonName(row.reason)
      byReason[reason] = (byReason[reason] ?? 0) + Number(row.n)
      out[status] = byReason
    } else {
      out[status] = ((out[status] as number | undefined) ?? 0) + Number(row.n)
    }
  }
  return out
}

/** 발송함(실제 범위의 감사·요약 댓글 — 복구로 다시 만든 행은 실행하지 않으므로 빼고, D-I2-11) — 그 시각 범위에 생긴 행의 상태·이유별 수와, 지금 남은 일(WAITING·SENDING) 수 */
export async function outboxCounts(db: Db, from: Date, to: Date): Promise<{ byState: Record<string, Record<string, number>>; pending: { WAITING: number; SENDING: number } }> {
  const kinds = ['POST_THANKS', 'SUMMARY_COMMENT']
  const rows = await db
    .select({ state: outbox.state, reason: outbox.reason, n: sql<number>`count(*)::int` })
    .from(outbox)
    .where(and(eq(outbox.rehearsal, false), eq(outbox.restored, false), inArray(outbox.kind, kinds), gte(outbox.createdAt, from), lt(outbox.createdAt, to)))
    .groupBy(outbox.state, outbox.reason)
  const byState: Record<string, Record<string, number>> = {}
  for (const row of rows) {
    const state = row.state === null ? 'NEW' : statusName(row.state)
    const reason = reasonName(row.reason)
    const bucket = byState[state] ?? {}
    bucket[reason] = (bucket[reason] ?? 0) + Number(row.n)
    byState[state] = bucket
  }
  const pendingRows = await db
    .select({ state: outbox.state, n: sql<number>`count(*)::int` })
    .from(outbox)
    .where(and(eq(outbox.rehearsal, false), eq(outbox.restored, false), inArray(outbox.kind, kinds), inArray(outbox.state, ['WAITING', 'SENDING'])))
    .groupBy(outbox.state)
  const pending = { WAITING: 0, SENDING: 0 }
  for (const row of pendingRows) if (row.state === 'WAITING' || row.state === 'SENDING') pending[row.state] = Number(row.n)
  return { byState, pending }
}

/** 그 시각 뒤에 기록된 처리 실패 표시 이벤트 수 */
export async function failedEventCount(db: Db, since: Date): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.failed, true), gt(events.receivedAt, since)))
  return Number(rows[0]?.n ?? 0)
}

/** 가벼운 질의 하나 (준비 확인) */
export async function ping(db: Db): Promise<void> {
  await db.execute(sql`select 1`)
}

/** 상태·이유 값은 서버가 정한 영문 코드만 내보낸다 (모양이 다르면 OTHER) */
function statusName(value: string): string {
  return /^[A-Z_]{1,32}$/.test(value) ? value : 'OTHER'
}

function reasonName(value: string | null): string {
  if (value === null) return 'NONE'
  return /^[A-Z_]{1,32}$/.test(value) ? value : 'OTHER'
}
