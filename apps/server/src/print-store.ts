// 출력 기록 저장소 (I1, LABEL_RULES L-11). 모든 질의에 판매자 ID 조건을 건다(SYS-02).
// - 출력 기록을 바꾸는 트랜잭션은 먼저 그 판매자의 대기열 줄을 잠근다(lockQueue — FOR UPDATE). 그 뒤에 라벨·작업·시도 줄을 바꾼다(잠금 순서가 늘 같다).
// - 출력 작업은 실제 범위에만 있다. 효과를 작업으로 바꾸는 조회(autoLabelEffects)는 리허설인지를 인자로 받지 않고 rehearsal = false로 고정한다(RA-S05-002, L-11 14).
// - 트랜잭션 안에서는 트랜잭션 객체(tx)를 넘긴다(PGlite는 연결이 하나다).
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { accounts, labelSwitches, labelTemplates, outbox, printAttempts, printJobs, printLabels, printQueues, printRequests, scopes } from './db/schema.ts'

export type QueueRow = typeof printQueues.$inferSelect
export type LabelRow = typeof printLabels.$inferSelect
export type JobRow = typeof printJobs.$inferSelect
export type AttemptRow = typeof printAttempts.$inferSelect

/** 멈춘 까닭 (L-8 3, L-11 8) */
export type PauseReason = 'DISCONNECTED' | 'PRINTER_ERROR' | 'SELLER' | 'LABEL_ERROR'
export type JobStatus = 'WAITING' | 'PRINTING' | 'DONE' | 'CANCELLED'
export type JobReason = 'auto' | 'manual' | 'reprint' | 'packing'

// ── 대기열 줄 ────────────────────────────────────────────────────────────

/** 판매자의 대기열 줄을 (없으면 만들고) 잠근다. 트랜잭션 안에서만 쓴다 */
export async function lockQueue(tx: Db, sellerId: string, now: Date): Promise<QueueRow> {
  await tx.insert(printQueues).values({ sellerId, updatedAt: now }).onConflictDoNothing({ target: printQueues.sellerId })
  const rows = await tx.select().from(printQueues).where(eq(printQueues.sellerId, sellerId)).for('update')
  const row = rows[0]
  if (row === undefined) throw new Error('대기열 줄을 만들지 못했다')
  return row
}

/** 대기열 줄 읽기 (잠그지 않는다 — 없으면 null) */
export async function readQueue(db: Db, sellerId: string): Promise<QueueRow | null> {
  const rows = await db.select().from(printQueues).where(eq(printQueues.sellerId, sellerId)).limit(1)
  return rows[0] ?? null
}

export type QueuePatch = Partial<Pick<QueueRow, 'deviceId' | 'deviceName' | 'printerConnected' | 'releasing' | 'paused' | 'backlog' | 'nextOrder' | 'frontOrder' | 'labelsEnabled'>>

/** 라벨 기능이 꺼져 있는지 (잠그지 않고 읽는다 — 미리 거르기용. 줄이 없으면 켬, N4a L-12 1). 정하는 값은 잠근 줄의 labelsEnabled다 */
export async function labelsOff(db: Db, sellerId: string): Promise<boolean> {
  return (await readQueue(db, sellerId))?.labelsEnabled === false
}

/** 대기열 줄을 고치고 rev를 1 올린다. 새 rev를 돌려준다 (잠근 트랜잭션 안에서) */
export async function updateQueue(tx: Db, sellerId: string, patch: QueuePatch, now: Date): Promise<number> {
  const rows = await tx
    .update(printQueues)
    .set({ ...patch, rev: sql`${printQueues.rev} + 1`, updatedAt: now })
    .where(eq(printQueues.sellerId, sellerId))
    .returning({ rev: printQueues.rev })
  return rows[0]?.rev ?? 0
}

/** 대기·출력 중·버릴 라벨 장 수 (실제 범위만) */
export async function queueCounts(db: Db, sellerId: string): Promise<{ waiting: number; printing: number; discard: number }> {
  const rows = await db
    .select({
      waiting: sql<number>`count(*) filter (where ${printJobs.status} = 'WAITING')::int`,
      printing: sql<number>`count(*) filter (where ${printJobs.status} = 'PRINTING')::int`,
      discard: sql<number>`count(*) filter (where ${printJobs.status} = 'DONE' and ${printJobs.voided} and ${printJobs.discardedAt} is null)::int`,
    })
    .from(printJobs)
    .where(and(eq(printJobs.sellerId, sellerId), sql`(${printJobs.status} in ('WAITING', 'PRINTING') or (${printJobs.voided} and ${printJobs.discardedAt} is null))`))
  const row = rows[0]
  return { waiting: Number(row?.waiting ?? 0), printing: Number(row?.printing ?? 0), discard: Number(row?.discard ?? 0) }
}

// ── 효과 → 작업 (L-11 2) ─────────────────────────────────────────────────

export interface LabelEffectRow {
  readonly effectId: string
  readonly seq: number
  readonly body: string
  readonly date: string
}

/**
 * 범위의 seq 구간에서 나온 상품 라벨 효과(PRINT_PRODUCT_LABEL) 발송함 행, 나온 순서. **실제 범위만** —
 * 리허설인지를 인자로 받지 않고 발송함 행과 범위 행 모두 rehearsal = false로 묶는다(RA-S05-002, D-I1-08, L-11 14).
 * 리허설 범위 ID를 넘겨도 아무 행도 돌려주지 않는다
 */
export async function autoLabelEffects(db: Db, sellerId: string, scopeId: string, fromSeq: number, toSeq: number): Promise<LabelEffectRow[]> {
  return db
    .select({ effectId: outbox.effectId, seq: outbox.seq, body: outbox.body, date: scopes.date })
    .from(outbox)
    .innerJoin(scopes, and(eq(scopes.id, outbox.scopeId), eq(scopes.sellerId, sellerId), eq(scopes.rehearsal, false)))
    .where(
      and(
        eq(outbox.sellerId, sellerId),
        eq(outbox.scopeId, scopeId),
        eq(outbox.rehearsal, false),
        eq(outbox.kind, 'PRINT_PRODUCT_LABEL'),
        gte(outbox.seq, fromSeq),
        lte(outbox.seq, toSeq),
      ),
    )
    .orderBy(asc(outbox.id))
}

export type NewLabel = typeof printLabels.$inferInsert
export type NewJob = typeof printJobs.$inferInsert

/** 라벨 키 줄을 넣는다 (이미 있으면 그대로). 넣은 줄의 ID를 키 순서와 상관없이 돌려준다 */
export async function insertLabels(tx: Db, rows: readonly NewLabel[]): Promise<{ id: number; key: string }[]> {
  if (rows.length === 0) return []
  return tx.insert(printLabels).values([...rows]).onConflictDoNothing().returning({ id: printLabels.id, key: printLabels.key })
}

/** 작업을 넣는다 (같은 범위의 같은 작업 ID면 넣지 않는다 — 같은 효과가 두 번 작업이 되지 않는다, L-8 1) */
export async function insertJobs(tx: Db, rows: readonly NewJob[]): Promise<number[]> {
  if (rows.length === 0) return []
  const inserted = await tx.insert(printJobs).values([...rows]).onConflictDoNothing({ target: [printJobs.sellerId, printJobs.scopeId, printJobs.jobId] }).returning({ id: printJobs.id })
  return inserted.map((row) => row.id)
}

/** 효과 본문(발송함 행 body)에서 쓰는 칸 */
export interface LabelEffectBody {
  readonly id: string
  readonly claim: string
  readonly broadcast: string
  readonly no: number
  /** 찜의 구매자 자신 */
  readonly buyer: string
  readonly confirmVersion: number
}

/**
 * 발송함 행 → 자동 출력 작업 (L-11 2, D-I1-02). 이벤트 기록·발송함 행과 **같은 트랜잭션**에서 부른다.
 * 범위의 seq 구간에서 나온 PRINT_PRODUCT_LABEL 효과마다 작업 하나: 작업 ID = 효과 ID, 라벨 키 = (찜, 확정버전), 까닭 auto, 대기, 만든 순서.
 * 라벨 키의 구매자는 buyerOf(효과, 그 효과를 낸 이벤트의 seq) — 그 순간의 L-9 구매자.
 * 효과는 autoLabelEffects로 읽는다 — 실제 범위만(rehearsal = false 고정). 리허설 범위 ID를 넘겨도 작업이 생기지 않는다.
 * 같은 효과는 한 번만 작업이 된다(범위·작업 ID 유일). 만든 라벨 키·작업의 ID를 돌려준다
 */
export async function createAutoJobs(
  tx: Db,
  sellerId: string,
  scopeId: string,
  fromSeq: number,
  toSeq: number,
  buyerOf: (effect: LabelEffectBody, seq: number) => string,
  now: Date,
): Promise<{ labels: number[]; jobs: number[] }> {
  const effects = await autoLabelEffects(tx, sellerId, scopeId, fromSeq, toSeq)
  if (effects.length === 0) return { labels: [], jobs: [] }
  const queue = await lockQueue(tx, sellerId, now)
  // 라벨 기능이 꺼져 있으면 효과가 있어도 작업(·라벨 키)을 만들지 않는다 — 이 기록 트랜잭션 안에서 잠근 줄의 값으로 정한다 (N4a L-12 3, L-11 2, D-N4a-01).
  // 켬/끔을 바꾸는 요청도 같은 줄을 잠그므로, 바꾸기에 성공 응답이 나간 뒤 기록되는 이벤트는 반드시 바뀐 값을 따른다. 나중에 켜도 이 효과로 작업을 만들지 않는다
  if (!queue.labelsEnabled) return { labels: [], jobs: [] }
  const parsed = effects.map((row) => ({ row, effect: JSON.parse(row.body) as LabelEffectBody }))
  const keyOf = (effect: LabelEffectBody) => `${effect.claim}@${String(effect.confirmVersion)}`
  const inserted = await insertLabels(
    tx,
    parsed.map(({ row, effect }) => ({
      sellerId,
      scopeId,
      date: row.date,
      key: keyOf(effect),
      kind: 'product',
      claim: effect.claim,
      version: effect.confirmVersion,
      broadcast: effect.broadcast,
      no: effect.no,
      buyer: buyerOf(effect, row.seq),
      effectId: row.effectId,
      createdAt: now,
    })),
  )
  const labels = new Map<string, { id: number; voided: boolean }>(inserted.map((row) => [row.key, { id: row.id, voided: false }]))
  for (const { effect } of parsed) {
    const key = keyOf(effect)
    if (labels.has(key)) continue
    // 이미 있던 라벨 키 (같은 효과를 다시 넣는 경우 등): 폐기됐으면 새 작업은 출력 안 함 + 폐기로만 남긴다 (L-8 4)
    const existing = await findLabel(tx, sellerId, scopeId, key)
    if (existing !== null) labels.set(key, { id: existing.id, voided: existing.voidedAt !== null })
  }
  let order = queue.nextOrder
  const jobs = await insertJobs(
    tx,
    parsed.flatMap(({ row, effect }) => {
      const label = labels.get(keyOf(effect))
      if (label === undefined) return []
      return [
        {
          sellerId,
          scopeId,
          labelId: label.id,
          date: row.date,
          jobId: row.effectId,
          kind: 'product',
          reason: 'auto',
          status: label.voided ? 'CANCELLED' : 'WAITING',
          voided: label.voided,
          queueOrder: order++,
          createdAt: now,
        },
      ]
    }),
  )
  await updateQueue(tx, sellerId, { nextOrder: order }, now)
  return { labels: inserted.map((row) => row.id), jobs }
}

// ── 라벨 키 ──────────────────────────────────────────────────────────────

/** 라벨 키를 효과와 묶는다 (아직 묶이지 않은 것만 — 켠 뒤 손으로 출력, N4a L-11 3·7, L-12 8) */
export async function bindLabelEffect(tx: Db, sellerId: string, labelId: number, effectId: string): Promise<void> {
  await tx
    .update(printLabels)
    .set({ effectId })
    .where(and(eq(printLabels.sellerId, sellerId), eq(printLabels.id, labelId), isNull(printLabels.effectId)))
}

export async function findLabel(db: Db, sellerId: string, scopeId: string, key: string): Promise<LabelRow | null> {
  const rows = await db
    .select()
    .from(printLabels)
    .where(and(eq(printLabels.sellerId, sellerId), eq(printLabels.scopeId, scopeId), eq(printLabels.key, key)))
    .limit(1)
  return rows[0] ?? null
}

export async function findLabelById(db: Db, sellerId: string, id: number): Promise<LabelRow | null> {
  const rows = await db
    .select()
    .from(printLabels)
    .where(and(eq(printLabels.sellerId, sellerId), eq(printLabels.id, id)))
    .limit(1)
  return rows[0] ?? null
}

/** 범위의 아직 폐기되지 않은 상품 라벨 키 (상태로 폐기할지 볼 것) */
export async function liveProductLabels(db: Db, sellerId: string, scopeId: string): Promise<Pick<LabelRow, 'id' | 'claim' | 'version' | 'broadcast' | 'no'>[]> {
  return db
    .select({ id: printLabels.id, claim: printLabels.claim, version: printLabels.version, broadcast: printLabels.broadcast, no: printLabels.no })
    .from(printLabels)
    .where(and(eq(printLabels.sellerId, sellerId), eq(printLabels.scopeId, scopeId), eq(printLabels.kind, 'product'), isNull(printLabels.voidedAt)))
}

/** 범위의 라벨 키 전부 (종류를 주면 그 종류만), 만든 순서 */
export async function scopeLabels(db: Db, sellerId: string, scopeId: string, kind?: 'product' | 'packing'): Promise<LabelRow[]> {
  return db
    .select()
    .from(printLabels)
    .where(and(eq(printLabels.sellerId, sellerId), eq(printLabels.scopeId, scopeId), kind === undefined ? undefined : eq(printLabels.kind, kind)))
    .orderBy(asc(printLabels.id))
}

export async function labelsByIds(db: Db, sellerId: string, ids: readonly number[]): Promise<LabelRow[]> {
  if (ids.length === 0) return []
  return db
    .select()
    .from(printLabels)
    .where(and(eq(printLabels.sellerId, sellerId), inArray(printLabels.id, [...ids])))
    .orderBy(asc(printLabels.id))
}

/**
 * 라벨 키 폐기 (L-8 4, L-11 5) — 되돌리지 않는다. 대기 작업 → 출력 안 함 + 폐기, 출력 중 → 폐기 표시(결과를 기다린다),
 * 출력함 → 폐기 표시(버릴 라벨), 출력 안 함 → 폐기 표시. 바뀐 라벨 키·작업 ID를 돌려준다 (이미 폐기된 것은 빼고)
 */
export async function voidLabels(tx: Db, sellerId: string, labelIds: readonly number[], now: Date): Promise<{ labels: number[]; jobs: number[] }> {
  if (labelIds.length === 0) return { labels: [], jobs: [] }
  const labels = await tx
    .update(printLabels)
    .set({ voidedAt: now })
    .where(and(eq(printLabels.sellerId, sellerId), inArray(printLabels.id, [...labelIds]), isNull(printLabels.voidedAt)))
    .returning({ id: printLabels.id })
  const jobs = await tx
    .update(printJobs)
    .set({ voided: true, status: sql`case when ${printJobs.status} = 'WAITING' then 'CANCELLED' else ${printJobs.status} end` })
    .where(and(eq(printJobs.sellerId, sellerId), inArray(printJobs.labelId, [...labelIds]), eq(printJobs.voided, false)))
    .returning({ id: printJobs.id })
  return { labels: labels.map((row) => row.id), jobs: jobs.map((row) => row.id) }
}

// ── 작업 ─────────────────────────────────────────────────────────────────

export interface JobWithLabel {
  readonly job: JobRow
  readonly label: LabelRow
}

/** 판매자의 모든 실제 범위를 통틀어 대기 맨 앞 작업 (L-11 4). 리허설 범위는 보지 않는다 */
export async function headWaitingJob(db: Db, sellerId: string): Promise<JobWithLabel | null> {
  const rows = await db
    .select({ job: printJobs, label: printLabels })
    .from(printJobs)
    .innerJoin(printLabels, and(eq(printLabels.id, printJobs.labelId), eq(printLabels.sellerId, sellerId)))
    .innerJoin(scopes, and(eq(scopes.id, printJobs.scopeId), eq(scopes.sellerId, sellerId), eq(scopes.rehearsal, false)))
    .where(and(eq(printJobs.sellerId, sellerId), eq(printJobs.status, 'WAITING')))
    .orderBy(asc(printJobs.queueOrder), asc(printJobs.id))
    .limit(1)
  return rows[0] ?? null
}

/** 출력 중 작업 (판매자마다 많아야 하나) */
export async function printingJob(db: Db, sellerId: string): Promise<JobRow | null> {
  const rows = await db
    .select()
    .from(printJobs)
    .where(and(eq(printJobs.sellerId, sellerId), eq(printJobs.status, 'PRINTING')))
    .limit(1)
  return rows[0] ?? null
}

/** (범위 날짜, 작업 ID)로 작업 찾기 — 다른 판매자의 것이면 null */
export async function findJob(db: Db, sellerId: string, date: string, jobId: string): Promise<JobWithLabel | null> {
  const rows = await db
    .select({ job: printJobs, label: printLabels })
    .from(printJobs)
    .innerJoin(printLabels, and(eq(printLabels.id, printJobs.labelId), eq(printLabels.sellerId, sellerId)))
    .where(and(eq(printJobs.sellerId, sellerId), eq(printJobs.date, date), eq(printJobs.jobId, jobId)))
    .limit(1)
  return rows[0] ?? null
}

export async function jobsWithLabels(db: Db, sellerId: string, ids: readonly number[]): Promise<JobWithLabel[]> {
  if (ids.length === 0) return []
  return db
    .select({ job: printJobs, label: printLabels })
    .from(printJobs)
    .innerJoin(printLabels, and(eq(printLabels.id, printJobs.labelId), eq(printLabels.sellerId, sellerId)))
    .where(and(eq(printJobs.sellerId, sellerId), inArray(printJobs.id, [...ids])))
    .orderBy(asc(printJobs.id))
}

/** 대기·출력 중 작업 (출력 중 먼저, 대기는 순서대로) */
export async function activeJobs(db: Db, sellerId: string): Promise<JobWithLabel[]> {
  return db
    .select({ job: printJobs, label: printLabels })
    .from(printJobs)
    .innerJoin(printLabels, and(eq(printLabels.id, printJobs.labelId), eq(printLabels.sellerId, sellerId)))
    .where(and(eq(printJobs.sellerId, sellerId), inArray(printJobs.status, ['WAITING', 'PRINTING'])))
    .orderBy(sql`case when ${printJobs.status} = 'PRINTING' then 0 else 1 end`, asc(printJobs.queueOrder), asc(printJobs.id))
}

/** 버릴 라벨: 출력함이 폐기됐고 아직 "버렸어요"를 누르지 않은 작업, 폐기된 순서와 상관없이 만든 순서 */
export async function discardJobs(db: Db, sellerId: string): Promise<JobWithLabel[]> {
  return db
    .select({ job: printJobs, label: printLabels })
    .from(printJobs)
    .innerJoin(printLabels, and(eq(printLabels.id, printJobs.labelId), eq(printLabels.sellerId, sellerId)))
    .where(and(eq(printJobs.sellerId, sellerId), eq(printJobs.status, 'DONE'), eq(printJobs.voided, true), isNull(printJobs.discardedAt)))
    .orderBy(asc(printJobs.id))
}

/** 라벨 키들의 작업 전부, 만든 순서 */
export async function jobsOfLabels(db: Db, sellerId: string, labelIds: readonly number[]): Promise<JobRow[]> {
  if (labelIds.length === 0) return []
  return db
    .select()
    .from(printJobs)
    .where(and(eq(printJobs.sellerId, sellerId), inArray(printJobs.labelId, [...labelIds])))
    .orderBy(asc(printJobs.id))
}

/** 모든 대기 작업 ID (모두 빼기) */
export async function waitingJobIds(db: Db, sellerId: string): Promise<number[]> {
  const rows = await db
    .select({ id: printJobs.id })
    .from(printJobs)
    .where(and(eq(printJobs.sellerId, sellerId), eq(printJobs.status, 'WAITING')))
  return rows.map((row) => row.id)
}

/** 작업 고치기 (판매자 조건) */
export async function updateJob(tx: Db, sellerId: string, id: number, patch: Partial<typeof printJobs.$inferInsert>): Promise<void> {
  await tx
    .update(printJobs)
    .set(patch)
    .where(and(eq(printJobs.sellerId, sellerId), eq(printJobs.id, id)))
}

/** 대기 작업들을 출력 안 함으로 (기록은 남는다). 바뀐 작업 ID */
export async function cancelWaiting(tx: Db, sellerId: string, ids: readonly number[]): Promise<number[]> {
  if (ids.length === 0) return []
  const rows = await tx
    .update(printJobs)
    .set({ status: 'CANCELLED' })
    .where(and(eq(printJobs.sellerId, sellerId), inArray(printJobs.id, [...ids]), eq(printJobs.status, 'WAITING')))
    .returning({ id: printJobs.id })
  return rows.map((row) => row.id)
}

// ── 시도 ─────────────────────────────────────────────────────────────────

export async function insertAttempt(tx: Db, row: typeof printAttempts.$inferInsert): Promise<void> {
  await tx.insert(printAttempts).values(row)
}

export async function findAttempt(db: Db, sellerId: string, token: string, lock = false): Promise<AttemptRow | null> {
  const query = db
    .select()
    .from(printAttempts)
    .where(and(eq(printAttempts.sellerId, sellerId), eq(printAttempts.token, token)))
    .limit(1)
  const rows = lock ? await query.for('update') : await query
  return rows[0] ?? null
}

/** 그 작업의 결과가 아직 없는 시도 (출력 중 작업의 지금 시도) */
export async function openAttempt(db: Db, sellerId: string, jobRef: number): Promise<AttemptRow | null> {
  const rows = await db
    .select()
    .from(printAttempts)
    .where(and(eq(printAttempts.sellerId, sellerId), eq(printAttempts.jobRef, jobRef), isNull(printAttempts.result)))
    .orderBy(desc(printAttempts.id))
    .limit(1)
  return rows[0] ?? null
}

export async function finishAttempt(tx: Db, sellerId: string, id: number, result: string, now: Date): Promise<void> {
  await tx
    .update(printAttempts)
    .set({ result, endedAt: now })
    .where(and(eq(printAttempts.sellerId, sellerId), eq(printAttempts.id, id), isNull(printAttempts.result)))
}

/** 출력함 작업들의 이력 (작업마다 출력함이 된 시각·기기) — 작업 줄에 있다 */
export async function printedJobsOfScope(db: Db, sellerId: string, scopeId: string): Promise<JobRow[]> {
  return db
    .select()
    .from(printJobs)
    .where(and(eq(printJobs.sellerId, sellerId), eq(printJobs.scopeId, scopeId), isNotNull(printJobs.printedAt)))
    .orderBy(asc(printJobs.printedAt), asc(printJobs.id))
}

// ── 템플릿 (L-11 13) ─────────────────────────────────────────────────────

export interface TemplateRow {
  readonly body: string
  readonly version: number
}

export async function readTemplate(db: Db, sellerId: string, kind: 'product' | 'packing', lock = false): Promise<TemplateRow | null> {
  const query = db
    .select({ body: labelTemplates.body, version: labelTemplates.version })
    .from(labelTemplates)
    .where(and(eq(labelTemplates.sellerId, sellerId), eq(labelTemplates.kind, kind)))
    .limit(1)
  const rows = lock ? await query.for('update') : await query
  return rows[0] ?? null
}

export async function writeTemplate(tx: Db, sellerId: string, kind: 'product' | 'packing', body: string, version: number, now: Date): Promise<void> {
  await tx
    .insert(labelTemplates)
    .values({ sellerId, kind, body, version, updatedAt: now })
    .onConflictDoUpdate({ target: [labelTemplates.sellerId, labelTemplates.kind], set: { body, version, updatedAt: now } })
}

// ── 요청 번호 ────────────────────────────────────────────────────────────

export async function findPrintRequest(db: Db, sellerId: string, requestId: string): Promise<string | null> {
  const rows = await db
    .select({ result: printRequests.result })
    .from(printRequests)
    .where(and(eq(printRequests.sellerId, sellerId), eq(printRequests.requestId, requestId)))
    .limit(1)
  return rows[0]?.result ?? null
}

export async function insertPrintRequest(tx: Db, sellerId: string, requestId: string, result: string, now: Date): Promise<void> {
  await tx.insert(printRequests).values({ sellerId, requestId, result, createdAt: now })
}

// ── 라벨 기능 켬/끔 바꾼 기록 (N4a, L-12 2) ─────────────────────────────

export interface LabelSwitchRow {
  readonly id: number
  readonly enabled: boolean
  readonly changedAt: Date
  readonly loginId: string
}

/** 바꾼 기록 한 줄을 남긴다 (켬/끔을 바꾸는 잠근 트랜잭션 안에서). 남긴 줄 ID */
export async function insertLabelSwitch(tx: Db, sellerId: string, enabled: boolean, accountId: string, now: Date): Promise<number> {
  const rows = await tx.insert(labelSwitches).values({ sellerId, enabled, accountId, changedAt: now }).returning({ id: labelSwitches.id })
  const row = rows[0]
  if (row === undefined) throw new Error('바꾼 기록을 남기지 못했다')
  return row.id
}

/** 바꾼 기록 (새것 먼저, limit줄). id를 주면 그 줄만 — 바꾼 계정의 로그인 아이디와 함께, 판매자 조건 */
export async function labelSwitchHistory(db: Db, sellerId: string, limit: number, id?: number): Promise<LabelSwitchRow[]> {
  return db
    .select({ id: labelSwitches.id, enabled: labelSwitches.enabled, changedAt: labelSwitches.changedAt, loginId: accounts.loginId })
    .from(labelSwitches)
    .innerJoin(accounts, and(eq(accounts.id, labelSwitches.accountId), eq(accounts.sellerId, sellerId)))
    .where(and(eq(labelSwitches.sellerId, sellerId), id === undefined ? undefined : eq(labelSwitches.id, id)))
    .orderBy(desc(labelSwitches.id))
    .limit(limit)
}
