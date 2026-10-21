// 범위 상태 (메모리 프로젝션, D-072). 범위 = (판매자, 방송 날짜, 리허설인지) (D-069, D-081).
// - 범위를 처음 읽을 때 형식이 같은 마지막 스냅샷과 그 뒤 이벤트를 재생한다. 스냅샷 형식이 다르거나 읽을 수 없으면 처음부터 재생한다(AC-S04-28).
// - 재생은 실패 표시된 입력을 건너뛴다. 표시가 없는데 엔진이 오류를 내는 입력도 건너뛰고 경보하며 계속 재생한다(AC-S04-24).
// - 상태는 커밋된 이벤트로만 바뀐다. 다른 인스턴스가 쓴 이벤트는 다음에 읽거나 쓸 때 따라잡는다(catch-up).
// - 증분 조회(D-085)를 위해 최근 seq마다의 상태를 일정 개수(창)만큼 둔다. 상태는 영속 자료라 앞뒤 상태가 거의 모든 마디를 공유한다.
import { STATE_FORMAT, checkInvariants, initEngine, type ApplyResult, type EngineEvent, type EngineState } from '@livejjim/core'
import type { Db } from './db/database.ts'
import { errorKind, type LogSink } from './log.ts'
import { eventAtSeq, eventsAfter, findScopeId, latestSnapshot, scopeRow, type EventRow } from './store.ts'
import { newViewCaches, type ViewCaches } from './views.ts'

/** 엔진 호출 (시험에서 감싸 예외를 주입한다). 쓰기와 재생 모두 이 함수를 쓴다 */
export interface EngineAdapter {
  applyEvent(state: EngineState, event: EngineEvent): ApplyResult
}

/** 범위 조회의 "확인 필요" 항목 (AC-S04-24) */
export interface AttentionItem {
  readonly seq: number
  readonly message: string
}

export const FAILED_INPUT_MESSAGE = '처리하지 못한 입력이에요. 확인이 필요해요.'
export const REPLAY_SKIPPED_MESSAGE = '다시 불러올 때 처리하지 못해 건너뛴 입력이에요. 확인이 필요해요.'

/** seq 하나에서의 범위 상태 (증분 조회의 기준점, D-085) */
export interface StatePoint {
  readonly seq: number
  readonly state: EngineState
  /** 그 seq까지의 확인 필요 항목 수 (확인 필요 목록은 덧붙이기만 한다) */
  readonly attention: number
  /** 그 seq 이벤트가 이미 받은 메시지의 기록을 바꿨으면(host.convertMessage) 그 메시지 — 이어 받은 메시지를 다시 보낼 때 */
  readonly message: { readonly b: string; readonly id: string } | null
}

/** 증분 조회 기준점을 몇 개(최근 seq 몇 개)까지 두는지 기본값. 이보다 오래된 seq의 증분은 "전체를 다시 받으세요"다 */
export const DEFAULT_CHANGES_WINDOW = 1000

export interface ScopeRuntime {
  readonly sellerId: string
  readonly date: string
  /** 리허설 범위인지 (D-081) */
  readonly rehearsal: boolean
  scopeId: string | null
  state: EngineState
  /** 마지막으로 반영한 이벤트의 seq (이벤트가 없으면 0) */
  seq: number
  /** 마지막 이벤트의 at (범위 안에서 at이 줄지 않게) */
  lastAt: number
  attention: AttentionItem[]
  /** 마지막 스냅샷(또는 처음) 뒤로 반영한 이벤트 수 */
  sinceSnapshot: number
  /** 최근 seq마다의 상태, seq 오름차순 (마지막 = 지금). 길이는 window+1 이하 */
  points: StatePoint[]
  /** 기준점 창 크기 */
  readonly window: number
  /** 이 범위의 보기 계산 캐시 (범위마다 따로 — 이 상태가 메모리에서 내려가면 함께 사라진다, AC-S06-72) */
  readonly views: ViewCaches
}

export function emptyState(): EngineState {
  return initEngine({ broadcasts: [], settings: {} })
}

export function emptyRuntime(sellerId: string, date: string, rehearsal = false, window = DEFAULT_CHANGES_WINDOW): ScopeRuntime {
  const state = emptyState()
  return {
    sellerId,
    date,
    rehearsal,
    scopeId: null,
    state,
    seq: 0,
    lastAt: 0,
    attention: [],
    sinceSnapshot: 0,
    points: [{ seq: 0, state, attention: 0, message: null }],
    window,
    views: newViewCaches(),
  }
}

/** 이 이벤트가 이미 받은 메시지의 기록을 바꾸는지 (메시지 변환만 바꾼다 — 채팅은 새 메시지를 더할 뿐) */
export function touchedMessage(event: unknown): { b: string; id: string } | null {
  if (typeof event !== 'object' || event === null) return null
  const record = event as Record<string, unknown>
  if (record.type === 'host.convertMessage' && typeof record.b === 'string' && typeof record.msg === 'string') return { b: record.b, id: record.msg }
  // 확인 필요 항목 바로잡기·지우기 (O2): 채팅 출처 항목이면 그 메시지의 기록(확인 필요·주문)이 바뀐다. 문자찜 출처(`sms:<ref>`)는 메시지가 아니다
  if ((record.type === 'host.resolveReview' || record.type === 'host.dismissReview') && typeof record.b === 'string' && typeof record.item === 'string' && !record.item.startsWith('sms:')) {
    return { b: record.b, id: record.item }
  }
  return null
}

/** 지금 상태를 기준점으로 남긴다 (창을 넘으면 가장 오래된 것부터 버린다) */
export function recordPoint(runtime: ScopeRuntime, message: { b: string; id: string } | null): void {
  const last = runtime.points.at(-1)
  if (last !== undefined && last.seq >= runtime.seq) runtime.points.pop()
  runtime.points.push({ seq: runtime.seq, state: runtime.state, attention: runtime.attention.length, message })
  if (runtime.points.length > runtime.window + 1) runtime.points.splice(0, runtime.points.length - runtime.window - 1)
}

/** 기록된 이벤트 하나를 재생한다 (실패 표시는 건너뛴다). 상태·확인 필요·seq를 바꾼다 */
export function replayRow(runtime: ScopeRuntime, row: EventRow, engine: EngineAdapter, log: LogSink): void {
  let event: unknown = null
  if (row.failed) {
    runtime.attention = [...runtime.attention, { seq: row.seq, message: FAILED_INPUT_MESSAGE }]
  } else {
    try {
      event = JSON.parse(row.body)
      runtime.state = engine.applyEvent(runtime.state, event as EngineEvent).state
    } catch (error) {
      log({ level: 'error', code: 'REPLAY_SKIPPED', date: runtime.date, seq: row.seq, errorKind: errorKind(error) })
      runtime.attention = [...runtime.attention, { seq: row.seq, message: REPLAY_SKIPPED_MESSAGE }]
    }
  }
  runtime.seq = row.seq
  runtime.lastAt = Math.max(runtime.lastAt, row.at)
  runtime.sinceSnapshot += 1
  recordPoint(runtime, touchedMessage(event))
}

function parseAttention(text: string): AttentionItem[] | null {
  const value: unknown = JSON.parse(text)
  if (!Array.isArray(value)) return null
  const items: AttentionItem[] = []
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) return null
    const { seq, message } = item as Record<string, unknown>
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || typeof message !== 'string') return null
    items.push({ seq, message })
  }
  return items
}

/** 스냅샷을 쓸 수 있으면 그 상태, 아니면 null (형식·JSON·불변식·확인 필요 목록) */
function usableSnapshot(text: string, attentionText: string): { state: EngineState; attention: AttentionItem[] } | null {
  try {
    const state = JSON.parse(text) as EngineState
    if (typeof state !== 'object' || state === null || state.format !== STATE_FORMAT) return null
    if (checkInvariants(state).length > 0) return null
    const attention = parseAttention(attentionText)
    return attention === null ? null : { state, attention }
  } catch {
    return null
  }
}

/** DB에서 범위 상태를 처음 만든다 (형식이 같은 마지막 스냅샷 + 뒤 이벤트, 쓸 수 없으면 처음부터) */
export async function loadRuntime(
  db: Db,
  sellerId: string,
  date: string,
  rehearsal: boolean,
  engine: EngineAdapter,
  log: LogSink,
  window = DEFAULT_CHANGES_WINDOW,
): Promise<ScopeRuntime> {
  const runtime = emptyRuntime(sellerId, date, rehearsal, window)
  const scope = await scopeRow(db, sellerId, date, rehearsal)
  if (scope === null) return runtime
  const scopeId = scope.id
  runtime.scopeId = scopeId
  // 봉인한 범위(AC-Y1-61·62)는 재생하지 않는다 — 채팅 원문을 지워 다시 만들 수 없고, 조회는 봉인한 장부로 한다. 쓰기는 기록 경로가 409로 거절한다
  if (scope.sealedAt !== null) {
    runtime.seq = scope.seq
    runtime.points = []
    recordPoint(runtime, null)
    return runtime
  }
  const snapshot = await latestSnapshot(db, sellerId, scopeId, STATE_FORMAT)
  if (snapshot !== null) {
    const usable = usableSnapshot(snapshot.state, snapshot.attention)
    // 스냅샷 seq의 이벤트가 로그에 있어야 쓴다(로그보다 앞선 스냅샷은 쓰지 않는다). 마지막 at도 그 이벤트에서 읽는다
    const last = usable === null ? null : await eventAtSeq(db, sellerId, scopeId, snapshot.seq)
    if (usable !== null && last !== null) {
      runtime.state = usable.state
      runtime.attention = usable.attention
      runtime.seq = snapshot.seq
      runtime.lastAt = last.at
      // 스냅샷보다 앞선 seq의 상태는 없다 — 그 seq의 증분은 "전체를 다시 받으세요"
      runtime.points = []
      recordPoint(runtime, null)
    } else {
      log({ level: 'warn', code: 'SNAPSHOT_UNUSABLE', date, seq: snapshot.seq })
    }
  }
  for (const row of await eventsAfter(db, sellerId, scopeId, runtime.seq)) replayRow(runtime, row, engine, log)
  runtime.sinceSnapshot = 0
  return runtime
}

/** 다른 인스턴스가 쓴 이벤트를 따라잡는다 (범위 행이 새로 생겼으면 그것도) */
export async function catchUp(db: Db, runtime: ScopeRuntime, engine: EngineAdapter, log: LogSink): Promise<void> {
  if (runtime.scopeId === null) {
    runtime.scopeId = await findScopeId(db, runtime.sellerId, runtime.date, runtime.rehearsal)
    if (runtime.scopeId === null) return
  }
  for (const row of await eventsAfter(db, runtime.sellerId, runtime.scopeId, runtime.seq)) replayRow(runtime, row, engine, log)
}
