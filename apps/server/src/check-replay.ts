// 재생 무결성 검사 (DAT-02, INV-4, D-072, AC-S04-29). 읽기만 한다(DB를 바꾸지 않는다).
// 범위마다 이벤트 로그를 처음부터 재생(실패 표시는 건너뜀)해 다음을 대조한다:
//   (1) 저장된 스냅샷 전부와 그 seq에서의 재생 상태(확인 필요 목록 포함), (2) 발송함의 효과 전부와 재생이 낸 효과(ID·내용·seq),
//   (3) 마지막 상태의 checkInvariants, (4) seq 빈틈, (5) 실패 표시 입력 수(보고만).
// 더해서 이벤트 행의 요약값(digest)으로 기록이 바뀌었는지 보고, 표시 없는 재생 오류도 불일치로 본다.
// 결과는 범위마다 한 줄이고, 이벤트 내용·개인정보는 넣지 않는다(범위·seq·부분 이름·개수만).
import { STATE_FORMAT, applyEvent, checkInvariants, type EngineEvent, type EngineState } from '@livejjim/core'
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { events, outbox, scopes, snapshots } from './db/schema.ts'
import { FAILED_INPUT_MESSAGE, REPLAY_SKIPPED_MESSAGE, emptyState, type AttentionItem } from './runtime.ts'
import { eventDigest } from './writer.ts'

export type CheckPart = 'seq' | '이벤트' | '재생 오류' | '스냅샷' | '발송함' | '불변식'

export interface ScopeCheck {
  readonly sellerId: string
  readonly date: string
  readonly ok: boolean
  readonly events: number
  readonly snapshots: number
  /** 형식 번호가 지금 코어와 달라 대조하지 않은 스냅샷 수 (쓰이지 않는다) */
  readonly otherFormatSnapshots: number
  readonly outbox: number
  readonly failedMarked: number
  /** 처음 다른 곳 (모두 같으면 null) */
  readonly firstDiff: { readonly seq: number; readonly part: CheckPart } | null
}

export interface CheckFilter {
  readonly sellerId?: string
  readonly date?: string
}

const PART_ORDER: readonly CheckPart[] = ['seq', '이벤트', '재생 오류', '스냅샷', '발송함', '불변식']

/** 키를 정렬한 JSON (객체 키 순서와 상관없이 같은 값이면 같은 문자열) */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (typeof value !== 'object' || value === null) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    Object.defineProperty(out, key, { value: sortKeys((value as Record<string, unknown>)[key]), enumerable: true, writable: true, configurable: true })
  }
  return out
}

export async function checkReplay(db: Db, filter: CheckFilter = {}): Promise<ScopeCheck[]> {
  const conditions = []
  if (filter.sellerId !== undefined) conditions.push(eq(scopes.sellerId, filter.sellerId))
  if (filter.date !== undefined) conditions.push(eq(scopes.date, filter.date))
  const scopeRows = await db
    .select({ id: scopes.id, sellerId: scopes.sellerId, date: scopes.date })
    .from(scopes)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(scopes.sellerId), asc(scopes.date))
  const results: ScopeCheck[] = []
  for (const scope of scopeRows) results.push(await checkScope(db, scope))
  return results
}

async function checkScope(db: Db, scope: { id: string; sellerId: string; date: string }): Promise<ScopeCheck> {
  const where = (table: typeof events | typeof outbox | typeof snapshots) => and(eq(table.sellerId, scope.sellerId), eq(table.scopeId, scope.id))
  const eventRows = await db
    .select({ seq: events.seq, type: events.type, body: events.body, failed: events.failed, digest: events.digest })
    .from(events)
    .where(where(events))
    .orderBy(asc(events.seq))
  const snapshotRows = await db
    .select({ seq: snapshots.seq, format: snapshots.format, state: snapshots.state, attention: snapshots.attention })
    .from(snapshots)
    .where(where(snapshots))
    .orderBy(asc(snapshots.seq))
  const outboxRows = await db.select({ effectId: outbox.effectId, seq: outbox.seq, body: outbox.body }).from(outbox).where(where(outbox))

  const diffs: { seq: number; part: CheckPart }[] = []
  const diff = (seq: number, part: CheckPart) => diffs.push({ seq, part })

  // (4) seq 빈틈과 기록 요약값
  eventRows.forEach((row, index) => {
    if (row.seq !== index + 1) diff(Math.min(row.seq, index + 1), 'seq')
    if (eventDigest(scope.id, row.seq, row.type, row.body, row.failed) !== row.digest) diff(row.seq, '이벤트')
  })

  // 재생
  const current = snapshotRows.filter((row) => row.format === STATE_FORMAT)
  let nextSnapshot = 0
  let state: EngineState = emptyState()
  let attention: AttentionItem[] = []
  const produced = new Map<string, { seq: number; body: string }>()
  const compareSnapshotsUpTo = (seq: number) => {
    while (nextSnapshot < current.length && (current[nextSnapshot]?.seq ?? Infinity) <= seq) {
      const snapshot = current[nextSnapshot] as (typeof current)[number]
      nextSnapshot++
      if (snapshot.seq !== seq) {
        diff(snapshot.seq, '스냅샷') // 로그에 없는 seq의 스냅샷
        continue
      }
      try {
        const same = canonicalJson(JSON.parse(snapshot.state)) === canonicalJson(state) && canonicalJson(JSON.parse(snapshot.attention)) === canonicalJson(attention)
        if (!same) diff(snapshot.seq, '스냅샷')
      } catch {
        diff(snapshot.seq, '스냅샷')
      }
    }
  }
  compareSnapshotsUpTo(0)
  for (const row of eventRows) {
    if (row.failed) {
      attention = [...attention, { seq: row.seq, message: FAILED_INPUT_MESSAGE }]
    } else {
      try {
        const result = applyEvent(state, JSON.parse(row.body) as EngineEvent)
        state = result.state
        for (const effect of result.effects) produced.set(effect.id, { seq: row.seq, body: canonicalJson(effect) })
      } catch {
        diff(row.seq, '재생 오류')
        attention = [...attention, { seq: row.seq, message: REPLAY_SKIPPED_MESSAGE }]
      }
    }
    compareSnapshotsUpTo(row.seq)
  }
  const lastSeq = eventRows.at(-1)?.seq ?? 0
  for (const snapshot of current.slice(nextSnapshot)) diff(snapshot.seq, '스냅샷')

  // (2) 발송함
  const stored = new Map(outboxRows.map((row) => [row.effectId, row]))
  for (const [id, effect] of produced) {
    const row = stored.get(id)
    if (row === undefined || row.seq !== effect.seq) diff(effect.seq, '발송함')
    else {
      try {
        if (canonicalJson(JSON.parse(row.body)) !== effect.body) diff(effect.seq, '발송함')
      } catch {
        diff(effect.seq, '발송함')
      }
    }
  }
  for (const row of outboxRows) if (!produced.has(row.effectId)) diff(row.seq, '발송함')

  // (3) 불변식
  if (checkInvariants(state).length > 0) diff(lastSeq, '불변식')

  const first = diffs.sort((a, b) => a.seq - b.seq || PART_ORDER.indexOf(a.part) - PART_ORDER.indexOf(b.part))[0] ?? null
  return {
    sellerId: scope.sellerId,
    date: scope.date,
    ok: first === null,
    events: eventRows.length,
    snapshots: current.length,
    otherFormatSnapshots: snapshotRows.length - current.length,
    outbox: outboxRows.length,
    failedMarked: eventRows.filter((row) => row.failed).length,
    firstDiff: first,
  }
}

/** 범위 한 줄 (내용·개인정보 없음) */
export function formatCheck(check: ScopeCheck): string {
  const counts = `이벤트 ${String(check.events)} · 스냅샷 ${String(check.snapshots)} · 발송함 ${String(check.outbox)} · 실패 표시 ${String(check.failedMarked)}`
  const other = check.otherFormatSnapshots > 0 ? ` · 형식이 다른 스냅샷 ${String(check.otherFormatSnapshots)}(대조 안 함)` : ''
  const verdict = check.firstDiff === null ? '일치' : `불일치 — 처음 다른 곳: seq ${String(check.firstDiff.seq)} (${check.firstDiff.part})`
  return `판매자 ${check.sellerId} · ${check.date} · ${verdict} (${counts}${other})`
}
