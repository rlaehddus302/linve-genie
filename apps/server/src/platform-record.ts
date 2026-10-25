// 플랫폼 댓글 묶음 기록 (플랫폼 공통 — BND1 밴드가 쓴다). 수집 경로와 같은 기록(조치자 collector·출처 other·같은 (판매자, 방송, 메시지 ID)는 한 번만)이다.
// - 한 묶음 = 한 트랜잭션. 넘긴 차례대로 기록해 seq가 그 차례가 된다(D-BND1-06). 같은 판매자의 다른 기록과 범위 락으로 한 줄로 섞인다.
// - guard는 범위 락을 잡은 트랜잭션 안에서 부른다(그 연결이 아직 읽는 상태인지·유튜브가 이어지지 않았는지) — 끊기·끝내기와 겹치지 않는다.
// - 이미 기록된 같은 메시지 ID는 다시 기록하지 않는다(2차 방어 — 본 댓글 표에 적기 전에 멈춘 경우, AC-BND1-34 (다)).
// - 엔진 입력 검사에 걸린 댓글은 그 하나만 기록하지 않는다(skipIfInvalid — 틱톡과 같다, D-N2b-2-17).
import { getBroadcast } from '@livejjim/core'
import type { Db } from './db/database.ts'
import type { Draft, Rejection, ScopeWriter } from './writer.ts'

export interface PlatformChat {
  readonly id: string
  readonly ch: string
  readonly nick: string
  readonly text: string
  readonly owner: boolean
}

export interface PlatformRecordJob {
  readonly sellerId: string
  readonly date: string
  readonly b: string
  /** 기록 차례 */
  readonly chats: readonly PlatformChat[]
  /** 범위 락 안에서: 기록해도 되는지 (false면 아무것도 쓰지 않는다) */
  readonly guard: (tx: Db) => Promise<boolean>
}

export type PlatformRecordOutcome =
  /** recorded = 이번에 기록한 메시지 ID(차례대로), existing = 이미 기록돼 있던 것, skipped = 엔진 입력 검사로 뺀 것 */
  | { readonly kind: 'ok'; readonly recorded: readonly string[]; readonly existing: readonly string[]; readonly skipped: readonly string[] }
  /**
   * 기록 거절 — code = 거절 코드(writer·엔진의 것: BROADCAST_ENDED·SEALED·NOT_LINKED(guard)·NOT_FOUND(범위 없음)·STATE_FORMAT 등).
   * 부르는 쪽은 회차 끝(BROADCAST_ENDED·SEALED)과 그 밖을 가른다 (D-BND1-22)
   */
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'save_failed' }

const STOPPED: Rejection = { status: 409, code: 'NOT_LINKED', message: '이어진 연결이 없어요.', problems: [] }

export async function recordPlatformChats(writer: ScopeWriter, job: PlatformRecordJob): Promise<PlatformRecordOutcome> {
  const { sellerId, date, b, chats } = job
  if (chats.length === 0) return { kind: 'ok', recorded: [], existing: [], skipped: [] }
  let existing: string[] = []
  let drafted: string[] = []
  const attempt = () => {
    existing = []
    drafted = []
    return writer.write({
      sellerId,
      date,
      rehearsal: false,
      createScope: false,
      requestId: null,
      chatBatch: { b, ids: chats.map((chat) => chat.id) },
      guard: async (tx) => ((await job.guard(tx)) ? null : STOPPED),
      build: (ctx) => {
        if (getBroadcast(ctx.state, b)?.ended === true) return { ...STOPPED, code: 'BROADCAST_ENDED' }
        const seen = new Set(ctx.existingChats)
        const drafts: Draft[] = []
        for (const chat of chats) {
          if (seen.has(chat.id)) {
            if (ctx.existingChats.has(chat.id)) existing.push(chat.id)
            continue
          }
          seen.add(chat.id)
          drafted.push(chat.id)
          drafts.push({ fields: { type: 'chat', b, id: chat.id, ch: chat.ch, nick: chat.nick, text: chat.text, owner: chat.owner }, actor: { kind: 'collector' }, chat: { b, id: chat.id }, source: 'other', skipIfInvalid: true })
        }
        return drafts
      },
    })
  }
  let outcome = await attempt()
  // 락 밖 경합(다른 쪽이 같은 메시지를 먼저 기록) — 다시 계산하면 이미 기록된 것으로 빠진다
  for (let i = 0; i < 2 && outcome.kind === 'duplicate'; i += 1) outcome = await attempt()
  if (outcome.kind === 'empty') return { kind: 'ok', recorded: [], existing: chats.map((chat) => chat.id), skipped: [] }
  if (outcome.kind === 'ok') {
    const done = new Set(outcome.records.map((record) => (record.event as unknown as { id?: unknown }).id).filter((id): id is string => typeof id === 'string'))
    return { kind: 'ok', recorded: drafted.filter((id) => done.has(id)), existing, skipped: drafted.filter((id) => !done.has(id)) }
  }
  if (outcome.kind === 'rejected') return { kind: 'rejected', code: outcome.rejection.code }
  if (outcome.kind === 'not_found') return { kind: 'rejected', code: 'NOT_FOUND' }
  return { kind: 'save_failed' }
}
