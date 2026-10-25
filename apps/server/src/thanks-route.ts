// 여러 플랫폼 회차의 감사 경로 (R-13 "여러 플랫폼 회차의 감사", YT-04·YT-05·YT-06, D-N2b-2-09, AC-N2b-2-10~12).
// 엔진 효과는 같다. 효과(POST_THANKS)마다 그 찜의 구매자 자신(합치기 전 — 효과의 buyer)의 키로 보낼 곳을 정한다:
//   ig:  → 인스타그램 DM 길 (DM 행은 instagram/dm.ts가 같은 트랜잭션에서 만든다 — 유튜브 실행기는 DM 행이 있는 발송함 행을 집지 않는다)
//   tt:  → 보내지 않는다 — 발송함 행을 SKIPPED(NOT_SUPPORTED)로 (틱톡에 글을 올리지 않는다, D-904 — 실패가 아니다)
//   band: → 보내지 않는다 — 같은 SKIPPED(NOT_SUPPORTED) (밴드에 글을 쓰지 않는다, BND1 D-BND1-02). 밴드 글 연결 기록도 "다른 플랫폼 연결 기록"으로 센다
//   그 밖(유튜브 채널·sms:) → 그 회차에 유튜브 연결 기록이 있거나(끊은 것 포함) 인스타그램·틱톡 연결 기록이 하나도 없으면 유튜브 발송함(그대로),
//                             아니면 SKIPPED(NO_RECIPIENT) — 유튜브 실행기가 집지 않아 "방송을 잇지 않음" 실패가 쌓이지 않는다
// 경로는 효과가 기록되는 트랜잭션에서 정하고 그 뒤 연결이 바뀌어도 다시 정하지 않는다. 리허설 범위는 아무것도 하지 않는다(발송함 행은 실행하지 않는다).
// 건너뛴 감사는 게시 보고(effect.thanksSent)를 쓰지 않는다 — 그 확정은 잠기지 않는다(엔진 규칙 그대로).
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { bandLinks, liveLinks, outbox, tiktokLinks, youtubeLinks } from './db/schema.ts'
import { BAND_PREFIX, INSTAGRAM_PREFIX, TIKTOK_PREFIX } from './platform.ts'
import type { TxHookContext } from './writer.ts'

/** 감사가 가는 곳 */
export type ThanksRoute = 'YOUTUBE' | 'INSTAGRAM_DM' | 'SKIP_NOT_SUPPORTED' | 'SKIP_NO_RECIPIENT'

/** 회차의 연결 기록 (끊은 것 포함) */
export interface BroadcastPlatforms {
  readonly youtube: boolean
  /** 인스타그램·틱톡·밴드 연결 기록이 있는지 */
  readonly other: boolean
}

/** 구매자 자신의 키 → 감사가 가는 곳 (순수 함수) */
export function thanksRoute(buyer: string, platforms: BroadcastPlatforms): ThanksRoute {
  if (buyer.startsWith(INSTAGRAM_PREFIX)) return 'INSTAGRAM_DM'
  if (buyer.startsWith(TIKTOK_PREFIX) || buyer.startsWith(BAND_PREFIX)) return 'SKIP_NOT_SUPPORTED'
  return platforms.youtube || !platforms.other ? 'YOUTUBE' : 'SKIP_NO_RECIPIENT'
}

async function broadcastPlatforms(tx: Db, sellerId: string, broadcastIds: readonly string[]): Promise<Map<string, BroadcastPlatforms>> {
  const ids = [...broadcastIds]
  const [yt, ig, tt, band] = await Promise.all([
    tx.selectDistinct({ b: youtubeLinks.broadcastId }).from(youtubeLinks).where(and(eq(youtubeLinks.sellerId, sellerId), inArray(youtubeLinks.broadcastId, ids))),
    tx.selectDistinct({ b: liveLinks.broadcastId }).from(liveLinks).where(and(eq(liveLinks.sellerId, sellerId), inArray(liveLinks.broadcastId, ids))),
    tx.selectDistinct({ b: tiktokLinks.broadcastId }).from(tiktokLinks).where(and(eq(tiktokLinks.sellerId, sellerId), inArray(tiktokLinks.broadcastId, ids))),
    tx.selectDistinct({ b: bandLinks.broadcastId }).from(bandLinks).where(and(eq(bandLinks.sellerId, sellerId), inArray(bandLinks.broadcastId, ids))),
  ])
  const youtube = new Set(yt.map((row) => row.b))
  const other = new Set([...ig, ...tt, ...band].map((row) => row.b))
  return new Map(ids.map((b) => [b, { youtube: youtube.has(b), other: other.has(b) }]))
}

/** 기록 트랜잭션 안 (ScopeWriter txHook): 틱톡·밴드 구매자·보낼 곳 없는 감사의 발송함 행을 건너뜀으로 적는다 */
export async function routeThanks(tx: Db, ctx: TxHookContext): Promise<null> {
  if (ctx.rehearsal) return null
  const effects = ctx.records.flatMap((record) => record.effects).filter((effect) => effect.kind === 'POST_THANKS')
  if (effects.length === 0) return null
  const platforms = await broadcastPlatforms(tx, ctx.sellerId, [...new Set(effects.map((effect) => effect.broadcast))])
  const skips = new Map<'NOT_SUPPORTED' | 'NO_RECIPIENT', { id: string; target: string | null; broadcast: string }[]>()
  for (const effect of effects) {
    const route = thanksRoute(effect.buyer, platforms.get(effect.broadcast) ?? { youtube: false, other: false })
    if (route !== 'SKIP_NOT_SUPPORTED' && route !== 'SKIP_NO_RECIPIENT') continue
    const reason = route === 'SKIP_NOT_SUPPORTED' ? 'NOT_SUPPORTED' : 'NO_RECIPIENT'
    skips.set(reason, [...(skips.get(reason) ?? []), { id: effect.id, target: effect.target, broadcast: effect.broadcast }])
  }
  for (const [reason, list] of skips) {
    for (const item of list) {
      await tx
        .update(outbox)
        .set({ state: 'SKIPPED', reason, target: item.target, broadcastId: item.broadcast })
        .where(and(eq(outbox.sellerId, ctx.sellerId), eq(outbox.scopeId, ctx.scopeId), eq(outbox.effectId, item.id)))
    }
  }
  return null
}
