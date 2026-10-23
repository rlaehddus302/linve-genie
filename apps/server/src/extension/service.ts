// 크롬 확장으로 채팅 읽기 — 서버 쪽 (X1 YT-10, D-X1-05~D-X1-13). 감사 채팅 올리기(선택, D-X1-17~24)는 thanks.ts.
// - 연결 (AC4): 설정 "확장 연결" → 8자리 일회용 코드(10분, 한 번만, 판매자 계정만) → 확장이 코드를 넣어 토큰을 받는다.
//   토큰은 해시로만 둔다. 판매자마다 하나 — 새 토큰을 받거나 "다시 만들기"를 하면 앞 토큰은 바로 끊긴다. "끊기"·30일 쓰지 않음도 끊는다.
// - 보내기 (AC5): 요청 하나에 50개까지. 토큰마다 초당 5요청·분당 600메시지(이 서버 안에서 센다).
// - 회차 잇기 (AC6): 영상 ID가 YT-02로 끝나지 않은 실제 회차에 이어져 있으면 그 회차로 자동(AUTO). 아니면 확장 팝업에서 오늘의 끝나지 않은
//   실제 회차를 고른다(PICK). 다른 영상에 이어진 회차·다른 회차에 이어진 영상은 거절. 잇기 전에는 아무것도 기록하지 않는다.
// - 받는 범위 (AC2): 이은 시각보다 먼저 게시된 것·회차를 끝낸 뒤 게시된 것은 기록하지 않고, 끝낸 뒤 10분이 지나면 요청을 받지 않는다.
//   기록은 공식 수집기와 같은 '채팅' 이벤트·같은 기록 함수(ingestYoutubeBatch) — 경로 표시(chat_source = extension)만 다르다.
// - 중복 없음 (AC3, D-X1-06): 같은 메시지 ID는 한 번만(공식 경로와 같은 키). 다른 경로의 같은 작성자·같은 정리 본문·게시 시각 3초 이내도 한 번만.
// - 상태 (AC7): 상태가 30초 넘게 없으면 STALE, 탭이 뒤로 가면 HIDDEN, 읽지 못함만 1분 이어지면 UNREADABLE. 바뀌면 실시간 알림(event: extension).
// - 개인정보 (AC9): 닉네임은 YT-03 이름 정리(ingestYoutubeBatch가 한다). 로그에는 종류·판매자만 — 토큰·닉네임·본문은 남기지 않는다.
import { SERVICE_NAME } from '../brand.ts'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { Db } from '../db/database.ts'
import { errorKind, type LogSink } from '../log.ts'
import { newSessionToken, tokenHash } from '../secrets.ts'
import type { Service } from '../service.ts'
import { findBroadcast, listBroadcastRows, type BroadcastRow } from '../store.ts'
import { kstDate } from '../time.ts'
import { activeLink, openLinksForVideo } from '../youtube/store.ts'
import { LIVE_CHAT_MAX } from '../youtube/texts.ts'
import type { Timer } from '../youtube/timer.ts'
import { isOurPost } from '../youtube/outbox-store.ts'
import type { ExtensionThanks, ThanksView } from './thanks.ts'
import {
  activeBindings,
  activeToken,
  bindingById,
  bindingOfBroadcast,
  bindingOfVideo,
  clearStatus,
  insertBinding,
  insertToken,
  markChatReceived,
  readStatus,
  replaceCode,
  revokeActive,
  revokeIdle,
  tokenByHash,
  touchToken,
  unbind,
  useCode,
  writeStatus,
  type BindingRow,
  type StatusRow,
} from './store.ts'

export const CODE_TTL_MS = 10 * 60 * 1000
export const CODE_DIGITS = 8
export const TOKEN_IDLE_MS = 30 * 24 * 60 * 60 * 1000
/** 마지막 사용 시각을 고쳐 쓰는 간격 (요청마다 쓰지 않는다) */
export const TOUCH_EVERY_MS = 60 * 1000
export const BATCH_MAX = 50
export const REQUESTS_PER_SECOND = 5
export const MESSAGES_PER_MINUTE = 600
export const STATUS_STALE_MS = 30 * 1000
export const UNREADABLE_MS = 60 * 1000
/** 회차를 끝낸 뒤 받는 기간 (YT-03과 같다) */
export const AFTER_END_MS = 10 * 60 * 1000
/** 서버 시계보다 앞선 게시 시각은 서버 시각으로 (확장 PC 시계가 빨라도 판정 순서는 서버 도착 시각으로 — R-1) */
export const FUTURE_SLACK_MS = 0

export type ExtensionState = 'NONE' | 'RECEIVING' | 'STALE' | 'HIDDEN' | 'UNREADABLE'

/** 화면에 보일 문장 (쉬운 한국어, D-X1-12) */
export const EXTENSION_MESSAGES = {
  RECEIVING: '확장으로 받는 중',
  STALE: '확장에서 채팅이 오지 않아요',
  HIDDEN: '유튜브 채팅 창을 앞으로 꺼내 두세요',
  UNREADABLE: '유튜브 화면이 바뀌어 채팅을 읽지 못해요',
  MANUAL: '주문은 손으로 넣어 주세요',
  DISCONNECTED: `연결이 끊겼어요. ${SERVICE_NAME} 설정에서 다시 연결해 주세요.`,
  CODE_INVALID: '연결 코드가 맞지 않거나 시간이 지났어요. 설정에서 새 코드를 받아 주세요.',
  CODE_LIMITED: '코드를 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요.',
  RATE_LIMITED: '한꺼번에 너무 많이 보냈어요. 잠시 뒤에 다시 보낼게요.',
  NOT_BOUND: '이 방송의 채팅을 어느 회차로 받을지 골라 주세요.',
  ENDED: '이 회차는 끝났어요. 채팅을 더 받지 않아요.',
  OTHER_VIDEO: '이 회차는 이미 다른 유튜브 방송에 이어져 있어요.',
  VIDEO_TAKEN: '이 유튜브 방송은 이미 다른 회차에 이어져 있어요.',
  NOT_OPEN: '오늘의 끝나지 않은 실제 방송만 고를 수 있어요.',
} as const

export type BindRejection = 'OTHER_VIDEO' | 'VIDEO_TAKEN' | 'NOT_OPEN'

export interface ExtensionView {
  /** 살아 있는 토큰이 있는지 */
  readonly connected: boolean
  readonly connectedAt: string | null
  readonly lastUsedAt: string | null
  readonly state: ExtensionState
  /** 상태 문장 (NONE이면 null) */
  readonly message: string | null
  /** 경고 상태면 손 입력 안내 (D-X1-12) */
  readonly manual: string | null
  /** 확장이 이어 받는 회차들 (끝나지 않은 것) */
  readonly broadcasts: readonly string[]
  readonly statusAt: string | null
  readonly lastChatAt: string | null
  /** 확장이 붙들 수 있는 수를 넘어 버린 채팅 수 (확장이 센 값) */
  readonly dropped: number
  /** 확장으로 감사 채팅 올리기 (X1 AC11~AC17): 스위치·회차별 경고 (멈춤 "확장으로 감사 글을 올리지 못하고 있어요" · 채널 주인 아님) */
  readonly thanks: ThanksView
}

export interface IncomingChat {
  readonly id: string
  readonly ch: string
  readonly nick: string
  readonly text: string
  readonly at: number
  /** 확장이 본 방송자 표시 (주인 배지·author-type=owner) — 회차 채널과 같을 때만 인정 (D-X1-29) */
  readonly owner?: true
}

export interface StatusInput {
  readonly videoId: string | null
  readonly hidden: boolean
  readonly read: number
  readonly unread: number
  readonly dropped: number
}

export type IngestOutcome =
  | { readonly kind: 'ok'; readonly recorded: number; readonly skipped: number; readonly ownerDenied: number; readonly broadcast: string }
  | { readonly kind: 'not_bound' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'save_failed' }

export type BindOutcome = { readonly kind: 'ok'; readonly broadcast: string } | { readonly kind: 'rejected'; readonly reason: BindRejection }

export interface ExtensionDeps {
  readonly db: Db
  readonly service: Service
  readonly timer: Timer
  readonly log: LogSink
  readonly publish: (sellerId: string, view: ExtensionView) => void
  /** 감사 올리기 (X1 AC11~AC17) */
  readonly thanks: ExtensionThanks
}

/** 확장 토큰이 가리키는 판매자 */
export interface ExtensionCaller {
  readonly sellerId: string
  readonly tokenId: string
}

const codeHash = (code: string) => createHash('sha256').update(`ext-code:${code}`, 'utf8').digest('base64url')
const isoOrNull = (date: Date | null | undefined) => (date === null || date === undefined ? null : date.toISOString())

/** 토큰 하나의 보내기 수 (이 서버 안, 지난 1초 요청·지난 1분 메시지) */
interface Usage {
  requests: number[]
  messages: { at: number; n: number }[]
}

export class ExtensionService {
  readonly #deps: ExtensionDeps
  readonly #usage = new Map<string, Usage>()
  /** 판매자마다 다음 상태 확인 예약 (STALE·UNREADABLE이 되는 때 알린다) */
  readonly #checks = new Map<string, AbortController>()
  /** 판매자마다 마지막으로 알린 상태 (같은 상태는 다시 알리지 않는다) */
  readonly #published = new Map<string, string>()
  #closed = false

  constructor(deps: ExtensionDeps) {
    this.#deps = deps
    deps.thanks.onChanged = (sellerId) => this.#notify(sellerId)
  }

  get thanks(): ExtensionThanks {
    return this.#deps.thanks
  }

  #now(): number {
    return this.#deps.timer.now()
  }

  // ── 연결 (AC4) ──────────────────────────────────────────────────────────

  /** 새 연결 코드 (판매자 계정만 — 경로가 보조자를 막는다). 같은 판매자의 앞 코드는 못 쓰게 된다 */
  async issueCode(sellerId: string, accountId: string): Promise<{ code: string; expiresAt: string }> {
    const now = this.#now()
    for (;;) {
      const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0')
      try {
        await replaceCode(this.#deps.db, { codeHash: codeHash(code), sellerId, accountId, now: new Date(now), expiresAt: new Date(now + CODE_TTL_MS) })
        return { code, expiresAt: new Date(now + CODE_TTL_MS).toISOString() }
      } catch (error) {
        // 다른 판매자의 살아 있는(또는 쓴) 코드와 겹쳤다 — 새로 뽑는다 (그 밖의 오류는 그대로)
        if ((error as { code?: string } | null)?.code !== '23505' && (error as { cause?: { code?: string } } | null)?.cause?.code !== '23505') throw error
      }
    }
  }

  /** 다시 만들기: 지금 토큰을 바로 끊고 새 코드를 낸다 */
  async renew(sellerId: string, accountId: string): Promise<{ code: string; expiresAt: string }> {
    await revokeActive(this.#deps.db, sellerId, 'RENEWED', new Date(this.#now()))
    this.#notify(sellerId)
    return this.issueCode(sellerId, accountId)
  }

  /** 끊기: 그 토큰의 다음 요청부터 거절한다 */
  async disconnect(sellerId: string): Promise<boolean> {
    const revoked = await revokeActive(this.#deps.db, sellerId, 'DISCONNECTED', new Date(this.#now()))
    if (revoked !== null) {
      this.#usage.delete(revoked)
      await clearStatus(this.#deps.db, sellerId)
    }
    this.#notify(sellerId)
    return revoked !== null
  }

  /** 코드 → 토큰 (한 번만). 판매자의 앞 토큰은 끊는다 */
  async exchange(code: string): Promise<string | null> {
    if (!new RegExp(`^\\d{${String(CODE_DIGITS)}}$`).test(code)) return null
    const now = new Date(this.#now())
    const token = newSessionToken()
    const issued = await this.#deps.db.transaction(async (tx) => {
      const used = await useCode(tx, codeHash(code), now)
      if (used === null) return null
      await revokeActive(tx, used.sellerId, 'RENEWED', now)
      await insertToken(tx, { id: `ext_${randomBytes(12).toString('base64url')}`, sellerId: used.sellerId, tokenHash: tokenHash(token), createdBy: used.accountId, now })
      return used.sellerId
    })
    if (issued === null) return null
    this.#notify(issued)
    return token
  }

  /** Bearer 토큰 → 판매자 (끊긴·30일 쓰지 않은 토큰은 null) */
  async authenticate(token: string): Promise<ExtensionCaller | null> {
    if (token === '' || token.length > 128) return null
    const row = await tokenByHash(this.#deps.db, tokenHash(token))
    if (row === null || row.revokedAt !== null) return null
    const now = this.#now()
    if (row.lastUsedAt.getTime() <= now - TOKEN_IDLE_MS) {
      await revokeIdle(this.#deps.db, row.sellerId, row.id, new Date(now - TOKEN_IDLE_MS + 1), new Date(now))
      this.#notify(row.sellerId)
      return null
    }
    if (now - row.lastUsedAt.getTime() >= TOUCH_EVERY_MS) await touchToken(this.#deps.db, row.sellerId, row.id, new Date(now))
    return { sellerId: row.sellerId, tokenId: row.id }
  }

  // ── 속도 제한 (AC5) ─────────────────────────────────────────────────────

  /** 이 요청을 받아도 되는지 (요청 1개·메시지 n개를 센다). 안 되면 다시 보낼 때까지 기다릴 밀리초 */
  admit(tokenId: string, messages: number): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = this.#now()
    const usage = this.#usage.get(tokenId) ?? { requests: [], messages: [] }
    usage.requests = usage.requests.filter((at) => at > now - 1000)
    usage.messages = usage.messages.filter((entry) => entry.at > now - 60_000)
    if (usage.requests.length >= REQUESTS_PER_SECOND) {
      this.#usage.set(tokenId, usage)
      return { ok: false, retryAfterMs: Math.max(1, (usage.requests[0] as number) + 1000 - now) }
    }
    const sent = usage.messages.reduce((sum, entry) => sum + entry.n, 0)
    if (messages > 0 && sent + messages > MESSAGES_PER_MINUTE) {
      this.#usage.set(tokenId, usage)
      return { ok: false, retryAfterMs: Math.max(1, (usage.messages[0]?.at ?? now) + 60_000 - now) }
    }
    usage.requests.push(now)
    if (messages > 0) usage.messages.push({ at: now, n: messages })
    this.#usage.set(tokenId, usage)
    // 오래 쓰지 않은 토큰의 수는 버린다 (메모리 상한)
    if (this.#usage.size > 10_000) for (const [key, value] of this.#usage) if (value.requests.every((at) => at <= now - 60_000)) this.#usage.delete(key)
    return { ok: true }
  }

  // ── 회차 잇기 (AC6) ─────────────────────────────────────────────────────

  /** 오늘(KST)의 끝나지 않은 실제 회차 */
  async #openToday(sellerId: string): Promise<BroadcastRow[]> {
    const today = kstDate(this.#now())
    return (await listBroadcastRows(this.#deps.db, sellerId)).filter((row) => !row.rehearsal && row.endedAt === null && row.date === today)
  }

  /** 끝난 회차의 잇기를 놓는다 (같은 영상·회차를 다시 이을 수 있게) */
  async #releaseEnded(sellerId: string): Promise<void> {
    const now = new Date(this.#now())
    for (const binding of await activeBindings(this.#deps.db, sellerId)) {
      const broadcast = await findBroadcast(this.#deps.db, sellerId, binding.broadcastId)
      if (broadcast === null || (broadcast.endedAt !== null && broadcast.endedAt.getTime() + AFTER_END_MS <= now.getTime())) await unbind(this.#deps.db, sellerId, binding.id, now)
    }
  }

  /** 영상 ID → 이어진 잇기. 없으면 YT-02 연결로 자동으로 잇는다(끝나지 않은 실제 회차). 그래도 없으면 null */
  async #resolve(caller: ExtensionCaller, videoId: string): Promise<BindingRow | null> {
    const { db } = this.#deps
    const existing = await bindingOfVideo(db, caller.sellerId, videoId)
    if (existing !== null) return existing
    await this.#releaseEnded(caller.sellerId)
    const linked = (await openLinksForVideo(db, caller.sellerId, [videoId]))[0]
    if (linked === undefined) return null
    const broadcast = await findBroadcast(db, caller.sellerId, linked.broadcastId)
    if (broadcast === null || broadcast.rehearsal || broadcast.endedAt !== null) return null
    // 그 회차를 확장에서 이미 다른 영상으로 이었으면 자동으로 잇지 않는다
    if ((await bindingOfBroadcast(db, caller.sellerId, linked.broadcastId)) !== null) return null
    const link = await activeLink(db, caller.sellerId, linked.broadcastId)
    if (link === null) return null
    const linkedAt = new Date(Math.max(link.linkedAt.getTime(), link.startedAt?.getTime() ?? 0))
    try {
      await insertBinding(db, { id: `extb_${randomBytes(12).toString('base64url')}`, sellerId: caller.sellerId, tokenId: caller.tokenId, videoId, broadcastId: linked.broadcastId, how: 'AUTO', linkedAt })
    } catch {
      // 다른 요청이 그사이 이었다 — 그것을 읽는다
    }
    return bindingOfVideo(db, caller.sellerId, videoId)
  }

  /** 팝업이 보일 것: 이어진 회차(있으면)와 고를 수 있는 회차 목록 */
  async candidates(caller: ExtensionCaller, videoId: string): Promise<{ bound: { id: string; date: string; title: string } | null; broadcasts: { id: string; date: string; title: string }[] }> {
    const binding = await this.#resolve(caller, videoId)
    const bound = binding === null ? null : await findBroadcast(this.#deps.db, caller.sellerId, binding.broadcastId)
    const open = await this.#openToday(caller.sellerId)
    return {
      bound: bound === null ? null : { id: bound.id, date: bound.date, title: bound.title },
      broadcasts: open.map((row) => ({ id: row.id, date: row.date, title: row.title })),
    }
  }

  /** 팝업에서 고른 회차에 잇는다 */
  async bind(caller: ExtensionCaller, videoId: string, broadcastId: string): Promise<BindOutcome | { kind: 'not_found' }> {
    const { db } = this.#deps
    await this.#releaseEnded(caller.sellerId)
    const broadcast = await findBroadcast(db, caller.sellerId, broadcastId)
    if (broadcast === null) return { kind: 'not_found' }
    if (!(await this.#openToday(caller.sellerId)).some((row) => row.id === broadcastId)) return { kind: 'rejected', reason: 'NOT_OPEN' }
    const link = await activeLink(db, caller.sellerId, broadcastId)
    if (link !== null && link.videoId !== videoId) return { kind: 'rejected', reason: 'OTHER_VIDEO' }
    const videoLinks = await openLinksForVideo(db, caller.sellerId, [videoId])
    if (videoLinks.some((row) => row.broadcastId !== broadcastId)) return { kind: 'rejected', reason: 'VIDEO_TAKEN' }
    const ofVideo = await bindingOfVideo(db, caller.sellerId, videoId)
    if (ofVideo !== null) return ofVideo.broadcastId === broadcastId ? { kind: 'ok', broadcast: broadcastId } : { kind: 'rejected', reason: 'VIDEO_TAKEN' }
    if ((await bindingOfBroadcast(db, caller.sellerId, broadcastId)) !== null) return { kind: 'rejected', reason: 'OTHER_VIDEO' }
    const now = this.#now()
    // YT-02로 이미 이은 회차면 그 이은 시각부터, 아니면 지금부터 받는다 (잇기 전 채팅은 기록하지 않는다)
    const linkedAt = link === null ? now : Math.max(link.linkedAt.getTime(), link.startedAt?.getTime() ?? 0)
    try {
      await insertBinding(db, { id: `extb_${randomBytes(12).toString('base64url')}`, sellerId: caller.sellerId, tokenId: caller.tokenId, videoId, broadcastId, how: 'PICK', linkedAt: new Date(linkedAt) })
    } catch {
      const again = await bindingOfVideo(db, caller.sellerId, videoId)
      if (again?.broadcastId === broadcastId) return { kind: 'ok', broadcast: broadcastId }
      return { kind: 'rejected', reason: again === null ? 'OTHER_VIDEO' : 'VIDEO_TAKEN' }
    }
    this.#notify(caller.sellerId)
    return { kind: 'ok', broadcast: broadcastId }
  }

  // ── 채팅 받기 (AC1·AC2·AC3·AC5) ─────────────────────────────────────────

  async ingest(caller: ExtensionCaller, videoId: string, chats: readonly IncomingChat[]): Promise<IngestOutcome> {
    const { db, service } = this.#deps
    const binding = await this.#resolve(caller, videoId)
    if (binding === null) return { kind: 'not_bound' }
    const broadcast = await findBroadcast(db, caller.sellerId, binding.broadcastId)
    if (broadcast === null || broadcast.rehearsal) return { kind: 'not_bound' }
    const now = this.#now()
    if (broadcast.endedAt !== null && now >= broadcast.endedAt.getTime() + AFTER_END_MS) return { kind: 'ended' }
    const linkedAt = binding.linkedAt.getTime()
    // 판매자 채널이 올린 우리 글(공식·확장 감사)은 채팅으로 기록하지 않는다 — 공식 수집기와 같음(AC-Y1-26)
    const own = await this.#deps.thanks.ownChannels(caller.sellerId, binding.broadcastId)
    const since = new Date(now - 10 * 60 * 1000)
    // 방송자 글(D-X1-29): 확장의 방송자 표시는 그 채널이 회차의 방송 채널일 때만 인정 — 공식 경로의 isChatOwner와 같은 'owner'로 기록한다.
    // 다르면 일반 시청자로 기록하고 센다(로그 없음). 회차 채널을 아직 모르면(이은 채널·유튜브 연결·감사에서 본 채널 모두 없음) 표시를 믿는다 — 판매자 글이 찜이 되는 쪽이 더 위험하다
    const castChannel = await this.#deps.thanks.broadcastChannel(caller.sellerId, binding.broadcastId)
    let ownerDenied = 0
    let skipped = 0
    const recordable: { id: string; ch: string; nick: string; text: string; publishedAt: number; owner?: true }[] = []
    for (const chat of chats) {
      const publishedAt = Math.min(chat.at, now + FUTURE_SLACK_MS)
      const text = cutText(chat.text)
      if (publishedAt < linkedAt || text.trim() === '' || (own.has(chat.ch) && (await isOurPost(db, caller.sellerId, binding.broadcastId, chat.id, text, since)))) {
        skipped += 1
        continue
      }
      let owner = false
      if (chat.owner === true) {
        owner = castChannel === null || castChannel === chat.ch
        if (!owner) ownerDenied += 1
      }
      recordable.push({ id: chat.id, ch: chat.ch, nick: chat.nick, text, publishedAt, ...(owner ? { owner: true as const } : {}) })
    }
    const outcome = await service.ingestYoutubeBatch(
      caller.sellerId,
      binding.broadcastId,
      recordable,
      // 범위 락 안에서: 이 잇기가 아직 살아 있고 토큰도 살아 있다 (그사이 끊었으면 기록하지 않는다)
      async (tx) => (await bindingById(tx, caller.sellerId, binding.id)) !== null && (await activeToken(tx, caller.sellerId))?.id === caller.tokenId,
      'extension',
    )
    if (outcome.status === 'not_found' || outcome.status === 'unlinked') return { kind: 'not_bound' }
    if (outcome.status !== 'ok') {
      this.#deps.log({ level: 'warn', code: 'EXT_SAVE_FAILED', seller: caller.sellerId })
      return { kind: 'save_failed' }
    }
    if (chats.length > 0) {
      await markChatReceived(db, caller.sellerId, new Date(now))
      this.#notify(caller.sellerId)
    }
    return { kind: 'ok', recorded: outcome.recorded, skipped: skipped + (recordable.length - outcome.recorded), ownerDenied, broadcast: binding.broadcastId }
  }

  // ── 상태 (AC7) ──────────────────────────────────────────────────────────

  async status(caller: ExtensionCaller, input: StatusInput): Promise<ExtensionView> {
    const { db } = this.#deps
    const now = this.#now()
    const before = await readStatus(db, caller.sellerId)
    const same = before !== null && before.tokenId === caller.tokenId
    const reset = !same || input.read < before.readCount || input.unread < before.unreadCount
    let unreadSince: Date | null
    if (reset) unreadSince = input.unread > 0 && input.read === 0 ? new Date(now) : null
    else if (input.read > before.readCount) unreadSince = null
    else if (input.unread > before.unreadCount) unreadSince = before.unreadSince ?? new Date(now)
    else unreadSince = before.unreadSince
    const row: StatusRow = {
      tokenId: caller.tokenId,
      videoId: input.videoId,
      statusAt: new Date(now),
      hidden: input.hidden,
      readCount: input.read,
      unreadCount: input.unread,
      dropped: input.dropped,
      unreadSince,
      lastChatAt: same ? before.lastChatAt : null,
    }
    await writeStatus(db, caller.sellerId, row)
    const view = await this.view(caller.sellerId)
    this.#publishIfChanged(caller.sellerId, view)
    this.#schedule(caller.sellerId, row)
    return view
  }

  /** 판매자 화면이 보는 확장 상태 (지금 시각으로 계산) */
  async view(sellerId: string): Promise<ExtensionView> {
    const { db } = this.#deps
    const now = this.#now()
    const token = await activeToken(db, sellerId)
    const status = token === null ? null : await readStatus(db, sellerId)
    const live: string[] = []
    if (token !== null) {
      for (const binding of await activeBindings(db, sellerId)) {
        const broadcast = await findBroadcast(db, sellerId, binding.broadcastId)
        if (broadcast !== null && broadcast.endedAt === null) live.push(binding.broadcastId)
      }
    }
    const state: ExtensionState = token === null || status === null || status.tokenId !== token.id ? 'NONE' : stateOf(status, live.length > 0, now)
    const warning = state === 'STALE' || state === 'HIDDEN' || state === 'UNREADABLE'
    return {
      connected: token !== null,
      connectedAt: isoOrNull(token?.createdAt),
      lastUsedAt: isoOrNull(token?.lastUsedAt),
      state,
      message: state === 'NONE' ? null : EXTENSION_MESSAGES[state],
      manual: warning ? EXTENSION_MESSAGES.MANUAL : null,
      broadcasts: live,
      statusAt: isoOrNull(status?.statusAt),
      lastChatAt: isoOrNull(status?.lastChatAt),
      dropped: status?.dropped ?? 0,
      thanks: await this.#deps.thanks.view(sellerId),
    }
  }

  /** 다음에 상태가 바뀔 때(30초 상태 없음·1분 읽지 못함) 다시 보고 알린다 */
  #schedule(sellerId: string, row: StatusRow): void {
    if (this.#closed) return
    this.#checks.get(sellerId)?.abort()
    const controller = new AbortController()
    this.#checks.set(sellerId, controller)
    const now = this.#now()
    const at = [row.statusAt.getTime() + STATUS_STALE_MS + 1, ...(row.unreadSince === null ? [] : [row.unreadSince.getTime() + UNREADABLE_MS])].filter((t) => t > now)
    if (at.length === 0) return
    const wait = Math.min(...at) - now
    void this.#deps.timer.sleep(wait, controller.signal).then(async () => {
      if (controller.signal.aborted || this.#closed) return
      try {
        const view = await this.view(sellerId)
        this.#publishIfChanged(sellerId, view)
        const fresh = await readStatus(this.#deps.db, sellerId)
        if (fresh !== null && !controller.signal.aborted) this.#schedule(sellerId, fresh)
      } catch (error) {
        this.#deps.log({ level: 'warn', code: 'EXT_NOTIFY_FAILED', seller: sellerId, errorKind: errorKind(error) })
      }
    })
  }

  #publishIfChanged(sellerId: string, view: ExtensionView): void {
    const key = JSON.stringify([view.connected, view.state, view.broadcasts, view.dropped, view.thanks])
    if (this.#published.get(sellerId) === key) return
    this.#published.set(sellerId, key)
    this.#deps.publish(sellerId, view)
  }

  /** 상태가 바뀌었을 수 있다 — 지금 상태를 알린다 (실패해도 요청은 그대로) */
  #notify(sellerId: string): void {
    void this.view(sellerId)
      .then((view) => this.#publishIfChanged(sellerId, view))
      .catch((error: unknown) => this.#deps.log({ level: 'warn', code: 'EXT_NOTIFY_FAILED', seller: sellerId, errorKind: errorKind(error) }))
  }

  close(): void {
    this.#closed = true
    for (const controller of this.#checks.values()) controller.abort()
    this.#checks.clear()
  }
}

/** 상태 → 화면 상태 (경고가 겹치면 상태 없음 > 뒤로 간 탭 > 읽지 못함) */
export function stateOf(status: StatusRow, hasLiveBroadcast: boolean, now: number): ExtensionState {
  if (hasLiveBroadcast && now - status.statusAt.getTime() > STATUS_STALE_MS) return 'STALE'
  if (now - status.statusAt.getTime() > STATUS_STALE_MS) return 'NONE'
  if (status.hidden) return 'HIDDEN'
  if (status.unreadSince !== null && now - status.unreadSince.getTime() >= UNREADABLE_MS) return 'UNREADABLE'
  return 'RECEIVING'
}

/** 본문 길이: YT-03(유튜브 실시간 채팅 200자)과 같게 자른다 */
export function cutText(text: string): string {
  const chars = Array.from(text)
  return chars.length > LIVE_CHAT_MAX ? chars.slice(0, LIVE_CHAT_MAX).join('') : text
}
