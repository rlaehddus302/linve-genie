// 인스타그램 live_comments 웹훅 (PLT-01, DAT-02, NFR-03·04·06, INV-3, D-072, D-N2-02~D-N2-04·D-N2-07·D-N2-08, AC-N2-22~24·30~39).
// - GET 확인 요청: hub.mode=subscribe이고 hub.verify_token이 설정값과 같으면(상수 시간 비교) hub.challenge를 그대로(text/plain). 아니면 403.
// - POST: 본문 원래 바이트의 HMAC-SHA256(앱 시크릿)을 X-Hub-Signature-256과 상수 시간 비교 — 없음·형식 틀림·다름은 401(아무것도 기록·세지 않는다).
//   1MB를 넘으면 413(서명 계산 전에), 서명은 맞는데 JSON이 아니면 400. 설정이 없으면 GET·POST 모두 503.
// - object = instagram의 live_comments 변경만 다룬다. 연결된 계정(entry[].id)이 아니면 건너뛴다. 모양이 틀린 변경은 기록하지 않고 센다.
// - 댓글 → chat (수집 경로·조치자 collector): id = ig:<댓글 ID>, ch = ig:<IGSID>, nick = username 그대로(모양이 아니면 시청자),
//   text 그대로, owner = 보낸 사람이 연결 계정일 때만, publishedAt 없음(at = 서버 시계).
// - 받은 순서대로 기록하고, 다룰 댓글이 모두 커밋된(또는 기록하지 않기로 정해진) 뒤에만 200. 저장이 실패하면 500(메타가 다시 보낸다 — 댓글 ID로 중복 없음).
// - 웹훅 원문은 저장하지 않는다. 로그에는 코드·수만 남긴다(본문·username·IGSID·댓글 ID·미디어 ID·서명 없음).
import { createHmac, timingSafeEqual } from 'node:crypto'
import { hasControlChar } from '../api-fields.ts'
import type { LiveLinks } from '../live-links.ts'
import type { LogSink } from '../log.ts'
import { INSTAGRAM_PREFIX, prefixedKey } from '../platform.ts'
import type { SellerLocks } from '../seller-locks.ts'
import type { Service } from '../service.ts'
import type { Clock } from '../time.ts'
import type { Db } from '../db/database.ts'
import type { InstagramSettings } from './config.ts'
import type { InstagramConnections } from './connection.ts'
import { constantTimeEqual } from './crypto.ts'
import type { LiveNotices } from './notices.ts'
import { bumpLinkCounter, bumpSellerMalformed, countUnlinked, type ConnectionRow } from './store.ts'
import { instagramNick } from './text.ts'

/** 웹훅 본문 상한 (1MB) */
export const WEBHOOK_BODY_LIMIT = 1024 * 1024
/** entry.time이 받은 시각보다 이만큼 넘게 이르면 늦게 받은 댓글 (D-N2-04) */
export const LATE_AFTER_MS = 60_000

const SIGNATURE_RE = /^sha256=[0-9a-f]{64}$/

export interface WebhookDeps {
  readonly db: Db
  readonly settings: InstagramSettings | null
  readonly connections: InstagramConnections
  readonly links: LiveLinks
  readonly locks: SellerLocks
  readonly service: Service
  readonly clock: Clock
  readonly log: LogSink
  readonly notices: LiveNotices
}

/** 받은 댓글 하나 (모양 검사를 통과한 것) */
interface Comment {
  readonly id: string
  readonly ch: string
  readonly fromId: string
  readonly username: unknown
  readonly text: string
  readonly liveId: string
}

type ChangeResult = 'done' | 'save_failed'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 변경 value → 댓글 (모양이 틀리면 null, AC-N2-35) */
function parseComment(value: unknown): { comment: Comment | null; liveId: string | null } {
  if (!isRecord(value)) return { comment: null, liveId: null }
  const from = isRecord(value.from) ? value.from : null
  const media = isRecord(value.media) ? value.media : null
  const liveId = media !== null && typeof media.id === 'string' && media.id !== '' && !hasControlChar(media.id) ? media.id : null
  const id = prefixedKey(INSTAGRAM_PREFIX, value.id)
  const ch = prefixedKey(INSTAGRAM_PREFIX, from?.id)
  if (id === null || ch === null || liveId === null || typeof value.text !== 'string' || hasControlChar(id) || hasControlChar(ch)) return { comment: null, liveId }
  return { comment: { id, ch, fromId: from?.id as string, username: from?.username, text: value.text, liveId }, liveId }
}

export class InstagramWebhook {
  readonly #deps: WebhookDeps

  constructor(deps: WebhookDeps) {
    this.#deps = deps
  }

  /** GET 확인 요청 (AC-N2-30) */
  verify(query: { readonly mode?: string; readonly token?: string; readonly challenge?: string }): { readonly status: 200 | 403 | 503; readonly body: string } {
    const settings = this.#deps.settings
    if (settings === null) return { status: 503, body: '' }
    if (query.mode !== 'subscribe' || query.token === undefined || query.challenge === undefined) return { status: 403, body: '' }
    return constantTimeEqual(query.token, settings.verifyToken) ? { status: 200, body: query.challenge } : { status: 403, body: '' }
  }

  /** 서명 검사 (원래 바이트, AC-N2-31) */
  signatureOk(raw: Uint8Array, header: string | undefined): boolean {
    const settings = this.#deps.settings
    if (settings === null || header === undefined || !SIGNATURE_RE.test(header)) return false
    const expected = `sha256=${createHmac('sha256', settings.appSecret).update(raw).digest('hex')}`
    return timingSafeEqual(Buffer.from(header, 'utf8'), Buffer.from(expected, 'utf8'))
  }

  /** POST (서명은 이미 맞다). 상태 코드를 돌려준다: 200 · 400 · 500 */
  async receive(raw: Uint8Array): Promise<200 | 400 | 500> {
    let body: unknown
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
    } catch {
      return 400
    }
    if (!isRecord(body) || body.object !== 'instagram' || !Array.isArray(body.entry)) return 200
    const connections = new Map<string, ConnectionRow | null>()
    for (const entry of body.entry) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '') continue
      let connection = connections.get(entry.id)
      if (connection === undefined) {
        connection = await this.#deps.connections.byAccount(entry.id)
        connections.set(entry.id, connection)
      }
      // 연결된 계정이 아님(끊은 계정 포함) → 기록하지 않는다
      if (connection === null) continue
      const sentAt = typeof entry.time === 'number' && Number.isFinite(entry.time) ? entry.time * 1000 : null
      for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
        if (!isRecord(change) || change.field !== 'live_comments') continue
        const result = await this.#change(connection, change.value, sentAt)
        if (result === 'save_failed') return 500
      }
    }
    return 200
  }

  async #change(connection: ConnectionRow, value: unknown, sentAt: number | null): Promise<ChangeResult> {
    const { sellerId } = connection
    const parsed = parseComment(value)
    return this.#deps.locks.run(sellerId, async (): Promise<ChangeResult> => {
      if (parsed.comment === null) {
        await this.#malformed(connection, parsed.liveId)
        return 'done'
      }
      const comment = parsed.comment
      // 끝낸 회차에 들어가려던 댓글은 다시 정한다 (기다리는 회차가 있으면 거기로 — 1부·2부)
      for (let attempt = 0; attempt < 3; attempt++) {
        const target = await this.#deps.links.resolveTarget(sellerId, connection.accountId, comment.liveId)
        if (target.kind !== 'linked') {
          await this.#unlinked(sellerId, comment.liveId, target.kind === 'many')
          return 'done'
        }
        const owner = comment.fromId === connection.accountId || (typeof comment.username === 'string' && comment.username.toLowerCase() === connection.username.toLowerCase())
        const outcome = await this.#deps.service.ingestOpenChat(sellerId, {
          b: target.broadcastId,
          id: comment.id,
          ch: comment.ch,
          nick: instagramNick(comment.username),
          text: comment.text,
          ...(owner ? { owner: true } : {}),
        })
        switch (outcome.status) {
          case 'recorded':
            await this.#late(sellerId, target.linkId, target.broadcastId, sentAt)
            this.#deps.notices.collection(sellerId, target.broadcastId)
            return 'done'
          case 'duplicate':
          case 'not_found':
            return 'done'
          case 'rejected':
            // 엔진 입력 검사에 걸린 댓글 (예: 받을 수 없는 글자) — 기록하지 않기로 정해진 것. 형식 틀린 댓글로 센다
            await bumpLinkCounter(this.#deps.db, sellerId, target.linkId, 'malformed')
            await bumpSellerMalformed(this.#deps.db, sellerId)
            this.#deps.log({ level: 'warn', code: 'IG_COMMENT_SKIPPED' })
            this.#deps.notices.collection(sellerId, target.broadcastId)
            return 'done'
          case 'save_failed':
            return 'save_failed'
          case 'ended':
            continue
        }
      }
      await this.#unlinked(sellerId, comment.liveId, false)
      return 'done'
    })
  }

  /** 늦게 받은 댓글 (AC-N2-36): entry.time이 받은 시각보다 60초 넘게 이르면 세고 알린다(1분에 한 번까지) */
  async #late(sellerId: string, linkId: number, broadcastId: string, sentAt: number | null): Promise<void> {
    if (sentAt === null || this.#deps.clock.now() - sentAt <= LATE_AFTER_MS) return
    await bumpLinkCounter(this.#deps.db, sellerId, linkId, 'late')
    this.#deps.notices.notice(sellerId, 'LATE_COMMENTS', broadcastId, { broadcast: broadcastId })
  }

  /** 이어지지 않은 라이브의 댓글 (AC-N2-22·24): 기록하지 않고 수만 센다 */
  async #unlinked(sellerId: string, liveId: string, many: boolean): Promise<void> {
    const count = await countUnlinked(this.#deps.db, sellerId, 'INSTAGRAM', liveId, new Date(this.#deps.clock.now()))
    if (many) this.#deps.notices.notice(sellerId, 'MANY_WAITING', '', { liveId, count })
    else this.#deps.notices.notice(sellerId, 'UNLINKED_COMMENTS', liveId, { liveId, count })
  }

  /** 모양이 틀린 변경 (AC-N2-35): 판매자 단위로 센다. 그 라이브가 회차에 이어져 있으면 회차의 수도 */
  async #malformed(connection: ConnectionRow, liveId: string | null): Promise<void> {
    await bumpSellerMalformed(this.#deps.db, connection.sellerId)
    this.#deps.log({ level: 'warn', code: 'IG_COMMENT_SKIPPED' })
    if (liveId === null) return
    const broadcastId = await this.#deps.links.linkedBroadcast(connection.sellerId, liveId)
    if (broadcastId === null) return
    const link = await this.#deps.links.openLink(connection.sellerId, broadcastId)
    if (link !== null) {
      await bumpLinkCounter(this.#deps.db, connection.sellerId, link, 'malformed')
      this.#deps.notices.collection(connection.sellerId, broadcastId)
    }
  }
}
