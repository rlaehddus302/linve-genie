// 같이 보는 라이브 (D-SHARE-LIVE-01, 사용자 지시 2026-11-17 "한 라이브에 대해서는 모든 정보를 공유하기로 했잖아. 라이브와 앱 계정은 1:N 관계"):
// - 다른 판매자 계정이 이미 이어 둔(끝나지 않은) 라이브를 이으면 새로 잇지 않고 먼저 이은 방송에 들어간다(live_joins 한 줄).
// - 들어간 동안 그 계정의 세션은 방송 주인 판매자로 처리한다(auth.session) — 상품 등록·수정·삭제·채팅·찜 목록·마이크 주인이 모두 한 기록.
// - 나가기: 판매자가 [나가기]를 누를 때, 새 라이브를 만들 때, 방송이 끝나고 12시간이 지났을 때(지난 라이브에서 다시 열었으면 연 때부터 12시간).
// - 들어간 라이브는 계정마다 따로 남긴다(live_join_visits, D-SHARE-LIVE-02) — 나간 뒤에도 원래 가게의 "지난 라이브"에 보이고 눌러 다시 연다.
// - 출시 때는 라이브 화면의 전화번호 주인만 라이브를 이을 수 있게 할 일(남은 일) — 지금은 여러 기기 시험을 위해 누구든 들어간다.
import { and, asc, eq, gt, isNull, ne, or } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { broadcasts, liveJoinVisits, liveJoins, sellers, tiktokLinks, youtubeLinks } from './db/schema.ts'

/** 방송이 끝난 뒤에도 같이 보는 시간 — 끝난 라이브의 정산·포장을 같이 보게 */
export const JOIN_AFTER_END_MS = 12 * 60 * 60 * 1000

export interface ActiveJoin {
  readonly ownerSellerId: string
  readonly ownerName: string
  readonly broadcastId: string
}

/** 이 계정이 지금 들어가 있는 라이브 (없으면 null) */
export async function activeJoin(db: Db, accountId: string, now: Date): Promise<ActiveJoin | null> {
  const rows = await db
    .select({ ownerSellerId: liveJoins.ownerSellerId, ownerName: sellers.name, broadcastId: liveJoins.broadcastId })
    .from(liveJoins)
    .innerJoin(broadcasts, and(eq(broadcasts.id, liveJoins.broadcastId), eq(broadcasts.sellerId, liveJoins.ownerSellerId)))
    .innerJoin(sellers, eq(sellers.id, liveJoins.ownerSellerId))
    // 끝나지 않았거나, 끝나고 12시간 안이거나, 들어간(지난 라이브에서 다시 연) 지 12시간 안 (D-SHARE-LIVE-02)
    .where(and(eq(liveJoins.accountId, accountId), isNull(liveJoins.leftAt), or(isNull(broadcasts.endedAt), gt(broadcasts.endedAt, new Date(now.getTime() - JOIN_AFTER_END_MS)), gt(liveJoins.joinedAt, new Date(now.getTime() - JOIN_AFTER_END_MS)))))
    .limit(1)
  return rows[0] ?? null
}

/** 라이브 열쇠: 유튜브 영상 번호 또는 틱톡 아이디 */
export type LiveKey = { readonly platform: 'youtube'; readonly videoId: string } | { readonly platform: 'tiktok'; readonly tiktokId: string }

/** 다른 판매자가 먼저 이어 둔, 끝나지 않은 방송 (가장 먼저 이은 것) */
export async function otherOpenLive(db: Db, sellerId: string, key: LiveKey): Promise<{ ownerSellerId: string; broadcastId: string } | null> {
  if (key.platform === 'youtube') {
    const rows = await db
      .select({ ownerSellerId: youtubeLinks.sellerId, broadcastId: youtubeLinks.broadcastId })
      .from(youtubeLinks)
      .innerJoin(broadcasts, and(eq(broadcasts.id, youtubeLinks.broadcastId), eq(broadcasts.sellerId, youtubeLinks.sellerId)))
      .where(and(eq(youtubeLinks.videoId, key.videoId), isNull(youtubeLinks.unlinkedAt), isNull(broadcasts.endedAt), ne(youtubeLinks.sellerId, sellerId)))
      .orderBy(asc(youtubeLinks.linkedAt))
      .limit(1)
    return rows[0] ?? null
  }
  const rows = await db
    .select({ ownerSellerId: tiktokLinks.sellerId, broadcastId: tiktokLinks.broadcastId })
    .from(tiktokLinks)
    .innerJoin(broadcasts, and(eq(broadcasts.id, tiktokLinks.broadcastId), eq(broadcasts.sellerId, tiktokLinks.sellerId)))
    .where(and(eq(tiktokLinks.tiktokId, key.tiktokId), eq(tiktokLinks.state, 'LINKED'), isNull(broadcasts.endedAt), ne(tiktokLinks.sellerId, sellerId)))
    .orderBy(asc(tiktokLinks.linkedAt))
    .limit(1)
  return rows[0] ?? null
}

/** 들어가기 (계정마다 한 줄 — 다시 들어가면 고쳐 쓴다) */
export async function joinLive(db: Db, row: { accountId: string; homeSellerId: string; ownerSellerId: string; broadcastId: string; now: Date }): Promise<void> {
  await db
    .insert(liveJoins)
    .values({ accountId: row.accountId, homeSellerId: row.homeSellerId, ownerSellerId: row.ownerSellerId, broadcastId: row.broadcastId, joinedAt: row.now, leftAt: null })
    .onConflictDoUpdate({ target: liveJoins.accountId, set: { homeSellerId: row.homeSellerId, ownerSellerId: row.ownerSellerId, broadcastId: row.broadcastId, joinedAt: row.now, leftAt: null } })
  // 같이 본 라이브 기록 — 처음 들어간 때만 (D-SHARE-LIVE-02)
  await db
    .insert(liveJoinVisits)
    .values({ accountId: row.accountId, broadcastId: row.broadcastId, homeSellerId: row.homeSellerId, ownerSellerId: row.ownerSellerId, joinedAt: row.now })
    .onConflictDoNothing()
}

/** 이 계정이 같이 본 라이브 (원래 가게 것만 — 다른 가게 계정으로 옮겼으면 빼고), 방송 주인별 (D-SHARE-LIVE-02) */
export async function visitedLives(db: Db, accountId: string, homeSellerId: string): Promise<{ ownerSellerId: string; ownerName: string; broadcastId: string }[]> {
  return db
    .select({ ownerSellerId: liveJoinVisits.ownerSellerId, ownerName: sellers.name, broadcastId: liveJoinVisits.broadcastId })
    .from(liveJoinVisits)
    .innerJoin(sellers, eq(sellers.id, liveJoinVisits.ownerSellerId))
    .where(and(eq(liveJoinVisits.accountId, accountId), eq(liveJoinVisits.homeSellerId, homeSellerId), ne(liveJoinVisits.ownerSellerId, homeSellerId)))
    .orderBy(asc(liveJoinVisits.joinedAt))
}

/**
 * 지난 라이브에서 같이 본 라이브를 다시 연다 (D-SHARE-LIVE-02): 같이 본 기록이 있는 방송이면 다시 들어간다(연 때부터 12시간). 기록이 없으면 null
 */
export async function reopenVisited(db: Db, session: { readonly accountId: string; readonly homeSellerId: string }, broadcastId: string, now: Date): Promise<JoinedView | null> {
  const visits = await visitedLives(db, session.accountId, session.homeSellerId)
  const visit = visits.find((one) => one.broadcastId === broadcastId)
  if (visit === undefined) return null
  const exists = await db.select({ id: broadcasts.id }).from(broadcasts).where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.sellerId, visit.ownerSellerId))).limit(1)
  if (exists.length === 0) return null
  await joinLive(db, { accountId: session.accountId, homeSellerId: session.homeSellerId, ownerSellerId: visit.ownerSellerId, broadcastId, now })
  return { broadcastId, shopName: visit.ownerName }
}

/** 나가기 — 들어간 라이브가 없으면 아무 일도 없다 */
export async function leaveLive(db: Db, accountId: string, now: Date): Promise<boolean> {
  const rows = await db.update(liveJoins).set({ leftAt: now }).where(and(eq(liveJoins.accountId, accountId), isNull(liveJoins.leftAt))).returning({ accountId: liveJoins.accountId })
  return rows.length > 0
}

/** 잇기 응답의 "같이 보는 라이브에 들어갔어요" 칸 */
export interface JoinedView {
  readonly broadcastId: string
  readonly shopName: string
}

/**
 * 잇기 전에 부른다: 다른 판매자가 이미 이어 둔 라이브면 그 방송에 들어가고 들어간 방송을 돌려준다. 아니면 null(그대로 잇는다).
 * session.sellerId는 원래 판매자여야 한다(이미 다른 라이브에 들어가 있으면 그 라이브 주인의 판매자다 — 그때는 이 계정의 원래 판매자로 따진다)
 */
export async function joinIfShared(db: Db, session: { readonly accountId: string; readonly homeSellerId: string; readonly sellerId: string }, key: LiveKey, now: Date): Promise<JoinedView | null> {
  const other = await otherOpenLive(db, session.homeSellerId, key)
  if (other === null) return null
  await joinLive(db, { accountId: session.accountId, homeSellerId: session.homeSellerId, ownerSellerId: other.ownerSellerId, broadcastId: other.broadcastId, now })
  const owner = await db.select({ name: sellers.name }).from(sellers).where(eq(sellers.id, other.ownerSellerId)).limit(1)
  return { broadcastId: other.broadcastId, shopName: owner[0]?.name ?? '' }
}
