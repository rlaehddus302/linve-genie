// 한 가게의 하루 라이브 기록을 다른 가게로 옮겨 담기 (D-IDLOGIN-03, 사용자 2026-11-20 "db에서 지금까지 모든 방송 이력 보고 두 계정에 적절하게 나눠서 넣어"):
// 같은 라이브를 여러 계정이 따로 받아 둔 기록 가운데, 그 라이브 주인 가게(예: 보스삼촌 → 보스다육)에 없는 날의 기록을 그 가게에 복사한다.
// - 받는 가게에 그 날짜의 실제 범위가 이미 있으면 하지 않는다(섞지 않는다). 봉인한 범위·리허설은 하지 않는다.
// - 원래 가게의 기록은 그대로 둔다(복사 — 지우지 않는다).
// - 범위·방송 ID는 새로 만들고, 이벤트 본문의 방송 ID를 새 ID로 바꾼 뒤 요약값을 다시 계산한다. 요청 번호·문자 ref는 겹치지 않게 앞에 copy-를 붙인다.
// - 이벤트를 손으로 쓴 계정은 다른 가게 계정이라 비운다. 발송함은 다시 만든 것으로만(restored — 라벨·감사 메시지를 다시 내지 않는다, 유튜브에 아무것도 쓰지 않는다).
// - 지난 라이브 목록의 플랫폼·채널 이름을 위해 유튜브·틱톡 잇기 기록도 복사하되, 늘 끊은 것으로 넣는다(복사본에서 채팅 받기가 다시 시작되지 않는다).
// - 넣은 뒤 재생 무결성 검사로 확인한다. 하나라도 어긋나면 트랜잭션을 되돌린다.
import { applyEvent, type EngineEvent, type EngineState } from '@livejjim/core'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { checkReplay, type ScopeCheck } from './check-replay.ts'
import type { Db } from './db/database.ts'
import { broadcasts, chatRaw, events, outbox, scopes, tiktokLinks, youtubeLinks } from './db/schema.ts'
import { randomIds, type IdSource } from './ids.ts'
import { emptyState } from './runtime.ts'
import { mergeRaw } from './store.ts'
import { eventDigest, splitChatRaw } from './writer.ts'

export interface CopyScopeInput {
  readonly fromSellerId: string
  readonly toSellerId: string
  readonly date: string
}

export type CopyScopeResult =
  | { readonly ok: true; readonly dryRun: boolean; readonly events: number; readonly broadcasts: readonly { readonly from: string; readonly to: string; readonly title: string }[]; readonly check: ScopeCheck | null }
  | { readonly ok: false; readonly message: string; readonly check?: ScopeCheck }

class Rollback extends Error {
  readonly check: ScopeCheck
  constructor(check: ScopeCheck) {
    super('재생 검사 어긋남')
    this.check = check
  }
}

export async function copyScope(db: Db, input: CopyScopeInput, options: { readonly apply: boolean; readonly ids?: Pick<IdSource, 'scope' | 'broadcast'>; readonly now?: Date } = { apply: false }): Promise<CopyScopeResult> {
  if (input.fromSellerId === input.toSellerId) return { ok: false, message: '같은 가게로는 옮기지 않아요.' }
  const [source] = await db.select().from(scopes).where(and(eq(scopes.sellerId, input.fromSellerId), eq(scopes.date, input.date), eq(scopes.rehearsal, false))).limit(1)
  if (source === undefined) return { ok: false, message: '옮길 기록이 없어요.' }
  if (source.sealedAt !== null) return { ok: false, message: '봉인한 날짜는 옮기지 않아요.' }
  const [target] = await db.select({ id: scopes.id }).from(scopes).where(and(eq(scopes.sellerId, input.toSellerId), eq(scopes.date, input.date), eq(scopes.rehearsal, false))).limit(1)
  if (target !== undefined) return { ok: false, message: '받는 가게에 그 날짜 기록이 이미 있어요(섞지 않아요).' }

  const ids = options.ids ?? randomIds
  const sourceBroadcasts = await db.select().from(broadcasts).where(and(eq(broadcasts.sellerId, input.fromSellerId), eq(broadcasts.scopeId, source.id))).orderBy(asc(broadcasts.startSeq))
  const idMap = new Map(sourceBroadcasts.map((row) => [row.id, ids.broadcast()]))
  const swap = (text: string): string => {
    let out = text
    for (const [from, to] of idMap) out = out.split(from).join(to)
    return out
  }
  const rows = await db
    .select({ event: events, nick: chatRaw.nick, text: chatRaw.text })
    .from(events)
    .leftJoin(chatRaw, and(eq(chatRaw.scopeId, events.scopeId), eq(chatRaw.seq, events.seq)))
    .where(and(eq(events.sellerId, input.fromSellerId), eq(events.scopeId, source.id)))
    .orderBy(asc(events.seq))
  const summary = sourceBroadcasts.map((row) => ({ from: row.id, to: idMap.get(row.id) ?? '', title: row.title }))
  if (!options.apply) return { ok: true, dryRun: true, events: rows.length, broadcasts: summary, check: null }

  const scopeId = ids.scope()
  const now = options.now ?? new Date()
  try {
    await db.transaction(async (tx) => {
      await tx.insert(scopes).values({ id: scopeId, sellerId: input.toSellerId, date: source.date, rehearsal: false, seq: source.seq, createdAt: source.createdAt, youtubeChat: source.youtubeChat })
      let state: EngineState = emptyState()
      for (const { event, nick, text } of rows) {
        // 따로 둔 채팅 본문·이름을 합쳐 방송 ID를 바꾸고 다시 나눈다
        const merged = swap(event.raw ? mergeRaw(event.body, nick, text) : event.body)
        const body = JSON.parse(merged) as Record<string, unknown>
        const split = event.type === 'chat' ? splitChatRaw(body) : null
        const stored = split === null ? merged : JSON.stringify(split.body)
        await tx.insert(events).values({
          sellerId: input.toSellerId,
          scopeId,
          seq: event.seq,
          type: event.type,
          body: stored,
          at: event.at,
          receivedAt: event.receivedAt,
          actor: event.actor,
          accountId: null,
          requestId: event.requestId === null ? null : `copy-${event.requestId}`,
          chatBroadcast: event.chatBroadcast === null ? null : swap(event.chatBroadcast),
          chatMessageId: event.chatMessageId,
          smsRef: event.smsRef === null ? null : `copy-${event.smsRef}`,
          changed: event.changed,
          failed: event.failed,
          digest: eventDigest(scopeId, event.seq, event.type, stored, event.failed, split?.raw ?? null),
          chatSource: event.chatSource,
          raw: split !== null,
        })
        if (split !== null) await tx.insert(chatRaw).values({ sellerId: input.toSellerId, scopeId, seq: event.seq, nick: split.raw.nick, text: split.raw.text })
        if (event.failed) continue
        const result = applyEvent(state, JSON.parse(merged) as EngineEvent)
        state = result.state
        // 다시 만든 발송함: 실행하지 않음 (라벨·감사 메시지를 다시 내지 않는다)
        for (const effect of result.effects) {
          await tx.insert(outbox).values({ sellerId: input.toSellerId, scopeId, effectId: effect.id, seq: event.seq, kind: effect.kind, body: JSON.stringify(effect), rehearsal: false, restored: true, createdAt: now })
        }
      }
      for (const row of sourceBroadcasts) {
        await tx.insert(broadcasts).values({ ...row, id: idMap.get(row.id) ?? row.id, sellerId: input.toSellerId, scopeId })
      }
      const sourceIds = [...idMap.keys()]
      if (sourceIds.length > 0) {
        const youtube = await tx.select().from(youtubeLinks).where(and(eq(youtubeLinks.sellerId, input.fromSellerId), inArray(youtubeLinks.broadcastId, sourceIds)))
        for (const row of youtube) {
          await tx.insert(youtubeLinks).values({
            ...row,
            id: `copy-${row.id}-${scopeId}`,
            sellerId: input.toSellerId,
            scopeId,
            broadcastId: idMap.get(row.broadcastId) ?? row.broadcastId,
            requestId: null,
            linkedBy: null,
            unlinkedBy: null,
            unlinkedAt: row.unlinkedAt ?? row.chatEndedAt ?? now,
            chatEndedAt: row.chatEndedAt ?? row.unlinkedAt ?? now,
          })
        }
        const tiktok = await tx.select().from(tiktokLinks).where(and(eq(tiktokLinks.sellerId, input.fromSellerId), inArray(tiktokLinks.broadcastId, sourceIds)))
        for (const { id: _id, ...row } of tiktok) {
          await tx.insert(tiktokLinks).values({
            ...row,
            sellerId: input.toSellerId,
            scopeId,
            broadcastId: idMap.get(row.broadcastId) ?? row.broadcastId,
            state: 'UNLINKED',
            actorAccountId: null,
            unlinkedBy: null,
            endedAt: row.endedAt ?? row.unlinkedAt ?? now,
            unlinkedAt: row.unlinkedAt ?? row.endedAt ?? now,
            extStatusAt: null,
            extScreen: null,
          })
        }
      }
      const [check] = await checkReplay(tx as unknown as Db, { sellerId: input.toSellerId, date: source.date, rehearsal: false })
      if (check === undefined || !check.ok) throw new Rollback(check ?? ({ ok: false } as ScopeCheck))
    })
  } catch (error) {
    if (error instanceof Rollback) return { ok: false, message: '옮긴 기록이 재생 검사에 어긋나 되돌렸어요.', check: error.check }
    throw error
  }
  const [check] = await checkReplay(db, { sellerId: input.toSellerId, date: source.date, rehearsal: false })
  return { ok: true, dryRun: false, events: rows.length, broadcasts: summary, check: check ?? null }
}
