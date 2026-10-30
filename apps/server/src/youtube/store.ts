// 유튜브 연결 표의 질의 (방송 잇기·수집기·우리 메시지·알림). 모두 판매자 ID 조건을 건다(SYS-02).
// 워커가 판매자를 가리지 않고 할 일을 찾는 질의(수집할 것·요약할 것)는 그 행의 판매자 ID를 함께 돌려주고, 이어서 쓰는 질의는 그 판매자 ID를 건다.
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { broadcasts, events, outbox, scopes, youtubeCollectors, youtubeConnections, youtubeLinks, youtubeNotices, youtubeOwnMessages } from '../db/schema.ts'

// ── 방송 잇기 ────────────────────────────────────────────────────────────

export interface LinkRow {
  readonly id: string
  readonly sellerId: string
  readonly scopeId: string
  readonly broadcastId: string
  readonly videoId: string
  readonly liveChatId: string
  /** 글 올리는 계정 = 이을 때 연결돼 있던 사장님 채널 (D-PHN-17·19) */
  readonly channelId: string
  /** 방송 채널 = 영상의 채널. INV1 전 기록(빈 칸)은 글 올리는 계정과 같다고 읽는다 (D-INV1-01) */
  readonly broadcastChannelId: string
  /** 방송 채널 이름 (바깥 글, 모르면 null — 옛 기록) */
  readonly broadcastChannelTitle: string | null
  readonly linkedAt: Date
  /** 유튜브 방송의 실제 시작 시각 (null = 예정, AC-Y1-94) */
  readonly startedAt: Date | null
  readonly linkedBy: string | null
  readonly requestId: string | null
  readonly unlinkedAt: Date | null
  readonly chatEndedAt: Date | null
  readonly summaryAt: Date | null
}

/** 초대 방송인가: 방송 채널 ≠ 글 올리는 계정 (D-PHN-17) */
export function isInvitedLink(link: Pick<LinkRow, 'channelId' | 'broadcastChannelId'>): boolean {
  return link.broadcastChannelId !== link.channelId
}

const linkColumns = {
  id: youtubeLinks.id,
  sellerId: youtubeLinks.sellerId,
  scopeId: youtubeLinks.scopeId,
  broadcastId: youtubeLinks.broadcastId,
  videoId: youtubeLinks.videoId,
  liveChatId: youtubeLinks.liveChatId,
  channelId: youtubeLinks.channelId,
  // 옛 기록(빈 칸)은 글 올리는 계정과 같다 (D-INV1-01) — 유튜브를 다시 부르거나 고쳐 쓰지 않는다
  broadcastChannelId: sql<string>`coalesce(${youtubeLinks.broadcastChannelId}, ${youtubeLinks.channelId})`,
  broadcastChannelTitle: youtubeLinks.broadcastChannelTitle,
  linkedAt: youtubeLinks.linkedAt,
  startedAt: youtubeLinks.startedAt,
  linkedBy: youtubeLinks.linkedBy,
  requestId: youtubeLinks.requestId,
  unlinkedAt: youtubeLinks.unlinkedAt,
  chatEndedAt: youtubeLinks.chatEndedAt,
  summaryAt: youtubeLinks.summaryAt,
}

/** 그 방송에 지금 이어진 유튜브 방송 */
export async function activeLink(db: Db, sellerId: string, broadcastId: string): Promise<LinkRow | null> {
  const rows = await db
    .select(linkColumns)
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.broadcastId, broadcastId), isNull(youtubeLinks.unlinkedAt)))
    .limit(1)
  return rows[0] ?? null
}

/** 판매자의 끊지 않은 유튜브 연결 전부 (회차 연결 조회 — 플랫폼마다, AC-N2b-2-05) */
export async function activeLinksOfSeller(db: Db, sellerId: string): Promise<LinkRow[]> {
  return db
    .select(linkColumns)
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), isNull(youtubeLinks.unlinkedAt)))
    .orderBy(asc(youtubeLinks.linkedAt))
}

export async function linkById(db: Db, sellerId: string, linkId: string): Promise<LinkRow | null> {
  const rows = await db
    .select(linkColumns)
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.id, linkId)))
    .limit(1)
  return rows[0] ?? null
}

/** 그 방송의 가장 최근 연결 (끊은 것 포함 — 발송함 행의 채팅 ID 등) */
export async function latestLink(db: Db, sellerId: string, broadcastId: string): Promise<LinkRow | null> {
  const rows = await db
    .select(linkColumns)
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.broadcastId, broadcastId)))
    .orderBy(desc(youtubeLinks.linkedAt))
    .limit(1)
  return rows[0] ?? null
}

/**
 * 그 방송에 그 영상을 이었던 가장 최근 연결 (끊은 것 포함). 공식 잇기를 끊어도 영상의 방송 채널은 그대로라,
 * 확장이 같은 영상을 계속 받을 때 방송 채널(초대 방송인지)을 알 때 쓴다 (AC-INV1-10, TD-INV1-009)
 */
export async function latestLinkOfVideo(db: Db, sellerId: string, broadcastId: string, videoId: string): Promise<LinkRow | null> {
  const rows = await db
    .select(linkColumns)
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.broadcastId, broadcastId), eq(youtubeLinks.videoId, videoId)))
    .orderBy(desc(youtubeLinks.linkedAt))
    .limit(1)
  return rows[0] ?? null
}

export async function linkByRequest(db: Db, sellerId: string, requestId: string): Promise<LinkRow | null> {
  const rows = await db
    .select(linkColumns)
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.requestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

/** 그 영상이 이어진, 끝나지 않은 이 판매자의 라이브찜 방송 (끊지 않은 연결) */
export async function openLinksForVideo(db: Db, sellerId: string, videoIds: readonly string[]): Promise<{ videoId: string; broadcastId: string }[]> {
  if (videoIds.length === 0) return []
  return db
    .select({ videoId: youtubeLinks.videoId, broadcastId: youtubeLinks.broadcastId })
    .from(youtubeLinks)
    .innerJoin(broadcasts, and(eq(broadcasts.id, youtubeLinks.broadcastId), eq(broadcasts.sellerId, sellerId)))
    .where(and(eq(youtubeLinks.sellerId, sellerId), inArray(youtubeLinks.videoId, [...videoIds]), isNull(youtubeLinks.unlinkedAt), isNull(broadcasts.endedAt)))
}

/**
 * 판매자가 실제 회차에 이은 적 있는 방송 채널, 최근 이은 순서 (YT-11 서버 잇기 — 확인한 채널·최근 채널 찾기, D-YT-SRV-03).
 * 끊은 연결도 센다(이은 적이 있다). 리허설에는 잇지 않으므로 모든 연결이 실제 회차다. 이름은 그 채널을 가장 최근에 이을 때 본 것
 */
export async function linkedChannels(db: Db, sellerId: string, limit?: number): Promise<{ id: string; title: string | null }[]> {
  const channel = sql<string>`coalesce(${youtubeLinks.broadcastChannelId}, ${youtubeLinks.channelId})`
  const rows = await db
    .select({ id: channel, title: youtubeLinks.broadcastChannelTitle, linkedAt: youtubeLinks.linkedAt })
    .from(youtubeLinks)
    .where(eq(youtubeLinks.sellerId, sellerId))
    .orderBy(desc(youtubeLinks.linkedAt))
  const out: { id: string; title: string | null }[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.id === '' || seen.has(row.id)) continue
    seen.add(row.id)
    out.push({ id: row.id, title: row.title })
    if (limit !== undefined && out.length >= limit) break
  }
  return out
}

export async function insertLink(
  db: Db,
  row: {
    id: string
    sellerId: string
    scopeId: string
    broadcastId: string
    videoId: string
    liveChatId: string
    channelId: string
    /** 방송 채널(영상의 채널)과 이름 (D-PHN-17) */
    broadcastChannelId: string
    broadcastChannelTitle: string | null
    /** 유튜브 방송의 실제 시작 시각 (예정이면 null) */
    startedAt: Date | null
    linkedBy: string
    requestId: string | null
    now: Date
    /** 예정 방송(startedAt null)의 첫 상태 확인 시각 — 잇는 그 순간부터 '시작되면 받아요'(STARTING·NOT_STARTED, AC-Y1-94·AC-I3-24) */
    upcomingCheckAt?: Date
    /** 수집 방식 — 서버 웹 읽기(YT-11)는 WEB, 없으면 옛 공식 STREAM */
    mode?: 'STREAM' | 'WEB'
  },
): Promise<void> {
  await db.insert(youtubeLinks).values({
    id: row.id,
    sellerId: row.sellerId,
    scopeId: row.scopeId,
    broadcastId: row.broadcastId,
    videoId: row.videoId,
    liveChatId: row.liveChatId,
    channelId: row.channelId,
    broadcastChannelId: row.broadcastChannelId,
    broadcastChannelTitle: row.broadcastChannelTitle,
    linkedAt: row.now,
    startedAt: row.startedAt,
    linkedBy: row.linkedBy,
    requestId: row.requestId,
  })
  await db.insert(youtubeCollectors).values({
    linkId: row.id,
    sellerId: row.sellerId,
    scopeId: row.scopeId,
    broadcastId: row.broadcastId,
    mode: row.mode ?? 'STREAM',
    status: 'STARTING',
    // 예정 방송은 잇기 응답부터 '시작되면 받아요'로 — 수집기가 나중에 같은 값을 적으므로 잇기 응답(낡은 '시작하는 중')이 알림보다 늦게 닿아도 덮지 않는다
    ...(row.startedAt === null && row.upcomingCheckAt !== undefined ? { reason: 'NOT_STARTED', resumeAt: row.upcomingCheckAt } : {}),
    updatedAt: row.now,
  })
}

export async function unlinkRow(db: Db, sellerId: string, linkId: string, by: string | null, now: Date): Promise<boolean> {
  const rows = await db
    .update(youtubeLinks)
    .set({ unlinkedAt: now, unlinkedBy: by })
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.id, linkId), isNull(youtubeLinks.unlinkedAt)))
    .returning({ id: youtubeLinks.id })
  return rows.length > 0
}

/** 예정이던 유튜브 방송이 시작됐다 (실제 시작 시각, AC-Y1-94). 처음 한 번만 적는다 */
export async function markLinkStarted(db: Db, sellerId: string, linkId: string, startedAt: Date): Promise<void> {
  await db
    .update(youtubeLinks)
    .set({ startedAt })
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.id, linkId), isNull(youtubeLinks.startedAt)))
}

export async function markChatEnded(db: Db, sellerId: string, linkId: string, now: Date): Promise<void> {
  await db
    .update(youtubeLinks)
    .set({ chatEndedAt: now })
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.id, linkId), isNull(youtubeLinks.chatEndedAt)))
}

export interface SummaryCandidate {
  readonly link: LinkRow
  readonly date: string
  readonly endedAt: Date
}

/** 방송 후 요약을 만들 때가 된 연결: 끊지 않은 연결, 요약을 아직 만들지 않음, 실제 방송, 끝낸 지 delay 지남 */
export async function summaryCandidates(db: Db, endedBefore: Date): Promise<SummaryCandidate[]> {
  const rows = await db
    .select({ ...linkColumns, date: broadcasts.date, endedAt: broadcasts.endedAt })
    .from(youtubeLinks)
    .innerJoin(broadcasts, and(eq(broadcasts.id, youtubeLinks.broadcastId), eq(broadcasts.sellerId, youtubeLinks.sellerId)))
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, youtubeLinks.sellerId), eq(scopes.rehearsal, false), isNull(scopes.sealedAt)))
    .where(and(isNull(youtubeLinks.unlinkedAt), isNull(youtubeLinks.summaryAt), isNotNull(broadcasts.endedAt), lte(broadcasts.endedAt, endedBefore)))
  return rows.map(({ date, endedAt, ...link }) => ({ link, date, endedAt: endedAt as Date }))
}

export async function markSummaryDone(db: Db, sellerId: string, linkId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(youtubeLinks)
    .set({ summaryAt: now })
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.id, linkId), isNull(youtubeLinks.summaryAt)))
    .returning({ id: youtubeLinks.id })
  return rows.length > 0
}

// ── 수집기 ───────────────────────────────────────────────────────────────

export interface CollectorRow {
  readonly linkId: string
  readonly sellerId: string
  readonly scopeId: string
  readonly broadcastId: string
  readonly pageToken: string | null
  readonly mode: string
  readonly status: string
  readonly reason: string | null
  readonly firstDone: boolean
  readonly gap: boolean
  readonly skippedBeforeLink: number
  readonly recorded: number
  readonly lastMessageAt: Date | null
  readonly resumeAt: Date | null
  readonly leaseOwner: string | null
  readonly leaseUntil: Date | null
}

const collectorColumns = {
  linkId: youtubeCollectors.linkId,
  sellerId: youtubeCollectors.sellerId,
  scopeId: youtubeCollectors.scopeId,
  broadcastId: youtubeCollectors.broadcastId,
  pageToken: youtubeCollectors.pageToken,
  mode: youtubeCollectors.mode,
  status: youtubeCollectors.status,
  reason: youtubeCollectors.reason,
  firstDone: youtubeCollectors.firstDone,
  gap: youtubeCollectors.gap,
  skippedBeforeLink: youtubeCollectors.skippedBeforeLink,
  recorded: youtubeCollectors.recorded,
  lastMessageAt: youtubeCollectors.lastMessageAt,
  resumeAt: youtubeCollectors.resumeAt,
  leaseOwner: youtubeCollectors.leaseOwner,
  leaseUntil: youtubeCollectors.leaseUntil,
}

export async function collectorOf(db: Db, sellerId: string, linkId: string): Promise<CollectorRow | null> {
  const rows = await db
    .select(collectorColumns)
    .from(youtubeCollectors)
    .where(and(eq(youtubeCollectors.sellerId, sellerId), eq(youtubeCollectors.linkId, linkId)))
    .limit(1)
  return rows[0] ?? null
}

/** 그 판매자의 수집기 전부 (상태 알림·멈춤) */
export function sellerCollectors(db: Db, sellerId: string): Promise<CollectorRow[]> {
  return db.select(collectorColumns).from(youtubeCollectors).where(eq(youtubeCollectors.sellerId, sellerId))
}

/**
 * 저절로 다시 돌지 않는 멈춤 이유: 다시 시작할 수 없음(끊음·봉인)·판매자가 손으로 다시 시작해야 함(채팅 꺼짐·권한 없음·채팅 없음).
 * 다시 시작은 상태를 STARTING으로 바꾸므로 그때 후보로 돌아온다
 */
export const STOPPED_FOR_GOOD: readonly string[] = ['UNLINKED', 'SEALED', 'CHAT_DISABLED', 'FORBIDDEN', 'CHAT_NOT_FOUND']

/**
 * 돌 수 있는 수집기 후보: 끊지 않은 연결, 끝나지 않은 상태(끝남·채팅 끝남·위의 이유로 멈춤 제외), 임대가 비었거나 지났거나 내 것.
 * 끝난 수집기는 후보에서 빠지므로 과거 방송이 쌓여도 5초마다 훑는 양이 늘지 않는다 (AC-Y1-12·28)
 */
export async function collectorCandidates(db: Db, owner: string, now: Date): Promise<CollectorRow[]> {
  return db
    .select(collectorColumns)
    .from(youtubeCollectors)
    .innerJoin(youtubeLinks, and(eq(youtubeLinks.id, youtubeCollectors.linkId), eq(youtubeLinks.sellerId, youtubeCollectors.sellerId), isNull(youtubeLinks.unlinkedAt)))
    .where(
      and(
        inArray(youtubeCollectors.status, ['STARTING', 'LIVE', 'RETRYING', 'STOPPED']),
        or(ne(youtubeCollectors.status, 'STOPPED'), isNull(youtubeCollectors.reason), notInArray(youtubeCollectors.reason, [...STOPPED_FOR_GOOD])),
        or(isNull(youtubeCollectors.leaseUntil), lt(youtubeCollectors.leaseUntil, now), eq(youtubeCollectors.leaseOwner, owner)),
      ),
    )
    .orderBy(asc(youtubeCollectors.updatedAt))
}

/** 임대 잡기 (한 문장 — 둘이 동시에 잡아도 하나만 행을 돌려받는다) */
export async function acquireLease(db: Db, sellerId: string, linkId: string, owner: string, now: Date, until: Date): Promise<boolean> {
  const rows = await db
    .update(youtubeCollectors)
    .set({ leaseOwner: owner, leaseUntil: until })
    .where(
      and(
        eq(youtubeCollectors.sellerId, sellerId),
        eq(youtubeCollectors.linkId, linkId),
        or(isNull(youtubeCollectors.leaseUntil), lt(youtubeCollectors.leaseUntil, now), eq(youtubeCollectors.leaseOwner, owner)),
      ),
    )
    .returning({ linkId: youtubeCollectors.linkId })
  return rows.length > 0
}

/** 임대 늘리기 (내 것일 때만). 잃었으면 false */
export async function renewLease(db: Db, sellerId: string, linkId: string, owner: string, until: Date): Promise<boolean> {
  const rows = await db
    .update(youtubeCollectors)
    .set({ leaseUntil: until })
    .where(and(eq(youtubeCollectors.sellerId, sellerId), eq(youtubeCollectors.linkId, linkId), eq(youtubeCollectors.leaseOwner, owner)))
    .returning({ linkId: youtubeCollectors.linkId })
  return rows.length > 0
}

export async function releaseLease(db: Db, sellerId: string, linkId: string, owner: string): Promise<void> {
  await db
    .update(youtubeCollectors)
    .set({ leaseOwner: null, leaseUntil: null })
    .where(and(eq(youtubeCollectors.sellerId, sellerId), eq(youtubeCollectors.linkId, linkId), eq(youtubeCollectors.leaseOwner, owner)))
}

export interface CollectorChange {
  readonly pageToken?: string | null
  readonly mode?: string
  readonly status?: string
  readonly reason?: string | null
  readonly firstDone?: boolean
  readonly gap?: boolean
  readonly resumeAt?: Date | null
  readonly lastMessageAt?: Date | null
}

/**
 * 수집기 상태를 바꾼다. owner를 주면 그 임대를 가진 때만(다른 서버가 이어받았으면 바꾸지 않는다). 더할 수(addRecorded·addSkipped)는 칸에 더한다.
 * 바뀌었으면 true
 */
export async function updateCollector(
  db: Db,
  sellerId: string,
  linkId: string,
  change: CollectorChange & { readonly addRecorded?: number; readonly addSkipped?: number },
  now: Date,
  owner?: string,
): Promise<boolean> {
  const { addRecorded, addSkipped, ...rest } = change
  const rows = await db
    .update(youtubeCollectors)
    .set({
      ...rest,
      ...(addRecorded === undefined || addRecorded === 0 ? {} : { recorded: sql`${youtubeCollectors.recorded} + ${addRecorded}` }),
      ...(addSkipped === undefined || addSkipped === 0 ? {} : { skippedBeforeLink: sql`${youtubeCollectors.skippedBeforeLink} + ${addSkipped}` }),
      updatedAt: now,
    })
    .where(and(eq(youtubeCollectors.sellerId, sellerId), eq(youtubeCollectors.linkId, linkId), ...(owner === undefined ? [] : [eq(youtubeCollectors.leaseOwner, owner)])))
    .returning({ linkId: youtubeCollectors.linkId })
  return rows.length > 0
}

/** 그 방송에 기록된 유튜브 채팅 수 (수집 상태의 기록한 메시지 수 — 죽었다 살아나도 정확하다) */
export async function recordedChats(db: Db, sellerId: string, broadcastId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.chatBroadcast, broadcastId), eq(events.chatSource, 'youtube')))
  return Number(rows[0]?.n ?? 0)
}

/** 지금 연결 (수집기·발송함이 채널을 확인한다) */
export async function connectionChannel(db: Db, sellerId: string): Promise<{ channelId: string; status: string; canPublish: boolean } | null> {
  const rows = await db
    .select({ channelId: youtubeConnections.channelId, status: youtubeConnections.status, canPublish: youtubeConnections.canPublish })
    .from(youtubeConnections)
    .where(eq(youtubeConnections.sellerId, sellerId))
    .limit(1)
  return rows[0] ?? null
}

/** 유튜브에 연결된 판매자 전부 (연결됨·다시 연결 필요 — 할당량 모드를 호출이 없어도 다시 판정한다, AC-Y1-97) */
export async function connectedSellerIds(db: Db): Promise<string[]> {
  const rows = await db.select({ sellerId: youtubeConnections.sellerId }).from(youtubeConnections)
  return rows.map((row) => row.sellerId)
}

// ── 우리 채널이 쓴 메시지 (게시 확인) ──────────────────────────────────────
// 게시 확인에서 우리 메시지를 고르는 것(짝짓기)은 outbox-store.ts claimRemote가 발송함 행과 함께 한 트랜잭션에서 한다 (AC-Y1-93)

export async function insertOwnMessage(db: Db, row: { sellerId: string; scopeId: string; liveChatId: string; messageId: string; text: string; publishedAt: Date }): Promise<void> {
  await db.insert(youtubeOwnMessages).values(row).onConflictDoNothing({ target: [youtubeOwnMessages.sellerId, youtubeOwnMessages.messageId] })
}

// ── 지운 메시지·차단 알림 ──────────────────────────────────────────────────

export interface NoticeRow {
  readonly id: number
  readonly broadcastId: string
  readonly kind: string
  readonly messageId: string | null
  readonly channelId: string
  readonly nick: string
  readonly wasOrder: boolean
  readonly wasCancel: boolean
  readonly banType: string | null
  readonly banSeconds: number | null
  readonly createdAt: Date
}

/** 알림 하나 (같은 삭제·차단이면 아무 일도 없다). 새로 남겼으면 그 행 */
export async function insertNotice(
  db: Db,
  row: {
    sellerId: string
    scopeId: string
    broadcastId: string
    kind: 'DELETED' | 'BANNED'
    dedupeKey: string
    messageId: string | null
    channelId: string
    nick: string
    wasOrder: boolean
    wasCancel: boolean
    banType: string | null
    banSeconds: number | null
    now: Date
  },
): Promise<NoticeRow | null> {
  const { now, ...values } = row
  const rows = await db
    .insert(youtubeNotices)
    .values({ ...values, createdAt: now })
    .onConflictDoNothing({ target: [youtubeNotices.sellerId, youtubeNotices.dedupeKey] })
    .returning({
      id: youtubeNotices.id,
      broadcastId: youtubeNotices.broadcastId,
      kind: youtubeNotices.kind,
      messageId: youtubeNotices.messageId,
      channelId: youtubeNotices.channelId,
      nick: youtubeNotices.nick,
      wasOrder: youtubeNotices.wasOrder,
      wasCancel: youtubeNotices.wasCancel,
      banType: youtubeNotices.banType,
      banSeconds: youtubeNotices.banSeconds,
      createdAt: youtubeNotices.createdAt,
    })
  return rows[0] ?? null
}

export function scopeNotices(db: Db, sellerId: string, scopeId: string): Promise<NoticeRow[]> {
  return db
    .select({
      id: youtubeNotices.id,
      broadcastId: youtubeNotices.broadcastId,
      kind: youtubeNotices.kind,
      messageId: youtubeNotices.messageId,
      channelId: youtubeNotices.channelId,
      nick: youtubeNotices.nick,
      wasOrder: youtubeNotices.wasOrder,
      wasCancel: youtubeNotices.wasCancel,
      banType: youtubeNotices.banType,
      banSeconds: youtubeNotices.banSeconds,
      createdAt: youtubeNotices.createdAt,
    })
    .from(youtubeNotices)
    .where(and(eq(youtubeNotices.sellerId, sellerId), eq(youtubeNotices.scopeId, scopeId)))
    .orderBy(asc(youtubeNotices.id))
}

/**
 * 판매자의 발송함 행(감사·요약 댓글)이 리허설 범위의 것인지 — 판매자 조작(게시됨 확인·알림에서 빼기)의 409 판단용, 행 내용은 돌려주지 않는다.
 * 실행기는 쓰지 않는다(실행기의 질의는 outbox-store.ts — 늘 실제 범위만). 없으면 null — 복구·가져오기가 다시 만든 행(실행하지 않는 행, D-I2-11)도 없는 것으로 본다
 */
export async function outboxRowRehearsal(db: Db, sellerId: string, id: number): Promise<boolean | null> {
  const rows = await db
    .select({ rehearsal: outbox.rehearsal })
    .from(outbox)
    .where(and(eq(outbox.sellerId, sellerId), eq(outbox.id, id), eq(outbox.restored, false), inArray(outbox.kind, ['POST_THANKS', 'SUMMARY_COMMENT'])))
    .limit(1)
  return rows[0]?.rehearsal ?? null
}
