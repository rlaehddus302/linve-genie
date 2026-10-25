// 크롬 확장으로 틱톡 댓글 받기 — 서버 쪽 (TTX, PLT-02 확장 대비책, D-TTX-01~14). 읽기만 — 틱톡에 무엇을 보내는 길은 없다.
// - 받는 조건 (D-TTX-06·10): 화면 아이디 = 그 판매자의 틱톡 연결 아이디(ASCII 소문자, 다르면 403 NOT_OWN_LIVE) · 운영자 스위치 켜짐 ·
//   동의가 지금 판 · 끊지 않은 틱톡 연결이 있는 끝나지 않은 실제 회차(판매자마다 많아야 하나). 아니면 기록 0이고 코드로 까닭을 알린다.
// - 거르개는 직접 연결과 같은 것 + NO_AUTHOR(createExtensionCommentFilter), 레코드 → chat은 같은 함수(tiktokChatFields), 출처도 같은 'other'
//   — 경로로 다르게 다루지 않는다(D-TTX-12, AC-TTX-30). 시각은 서버가 받은 시각, 확장이 보낸 owner·시각 칸은 쓰지 않는다(D-TTX-06·14).
// - 한 번에 한 경로 (D-TTX-07): 묶음이 닿은 순간 그 연결의 직접 연결이 받는 중(CONNECTED)이면 기록하지 않고 대기(standby)로 센다.
// - 중복 (D-TTX-05): 같은 (회차, tt:<댓글 ID>)는 두 번 기록하지 않는다 — 기록 트랜잭션 안에서 이미 기록된 ID를 읽는다(직접 연결과 확장 사이에도).
// - 저장이 확정되기 전에는 "받음"을 답하지 않는다. 저장 실패는 500 — 확장이 같은 순서로 다시 보낸다(같은 묶음을 다시 보내도 한 번만).
// - 상태 (D-TTX-09): 확장이 10초마다 보내는 틱톡 상태를 그 연결에 둔다. 연결 보기의 extension 칸이 받는 길 한 줄·경고·수를 계산한다.
// - 로그에는 코드와 수만 — 닉네임·본문·틱톡 아이디·토큰을 남기지 않는다(D-TTX-13).
// - 확장이 버린 댓글 (D-TTX-16): 상태의 dropped(0~10,000)를 그 판매자의 이어진 연결의 saveFailed에 더한다 → 저장 실패 알림.
//   다시 보내는 중인 실패(TTX_SAVE_FAILED·429)는 세지 않는다 — 다시 보내기가 성공하면 붙여 넣은 댓글과 겹쳐 이중 찜이 된다.
// - 막혔을 때 안내 (D-TTX-17): 확장을 이은 판매자 + 직접 연결 막힘·멈춤 + 이 회차 확장 상태 없음이면 hint 한 줄.
import { getBroadcast } from '@livejjim/core'
import { SERVICE_NAME } from '../brand.ts'
import type { Db } from '../db/database.ts'
import { errorKind, type LogSink } from '../log.ts'
import { findBroadcast } from '../store.ts'
import type { Clock } from '../time.ts'
import { asciiLower, createExtensionCommentFilter, type TikTokCommentRecord, type TikTokExtensionDropCode } from '../tiktok/index.ts'
import type { Draft, Rejection, ScopeWriter } from '../writer.ts'
import { tiktokChatFields } from './chat.ts'
import type { TikTokLive } from './live.ts'
import {
  bumpTiktokCounter,
  addTiktokExtDropped,
  bumpTiktokExtCounter,
  clearTiktokExtStatus,
  findTiktokId,
  findTiktokLink,
  linkedTiktokExtStatuses,
  sellerOpenTiktokLink,
  writeTiktokExtStatus,
  type TiktokLinkRow,
} from './store.ts'

/** 확장 묶음 하나의 항목 수 상한 (D-TTX-08 — 51개는 400) */
export const EXT_TIKTOK_BATCH_MAX = 50
/** 확장 상태가 이만큼 넘게 없으면 조용함 (D-TTX-09) */
export const EXT_TIKTOK_STALE_MS = 30_000
/** 읽지 못함만 이만큼 이어지면 경고 */
export const EXT_TIKTOK_UNREADABLE_MS = 60_000
/** 상태 수가 담을 수 있는 가장 큰 값 */
export const EXT_TIKTOK_COUNT_MAX = 1_000_000_000
/** 상태 하나에 실을 수 있는 버린 댓글 수 상한 (D-TTX-16 — 넘으면 400) */
export const EXT_TIKTOK_DROPPED_MAX = 10_000
/** 같은 묶음 안 경합(다른 쪽이 같은 메시지를 먼저 기록)일 때 다시 쓰는 수 */
const DUPLICATE_RETRIES = 3

/** 콘솔 틱톡 칸 받는 길 한 줄 (acceptance "화면 문구" 글자 그대로) */
export const EXT_TIKTOK_ROUTES = {
  DIRECT: '서버 연결로 받는 중',
  DIRECT_STANDBY: '서버 연결로 받는 중 · 확장은 대기 중',
  EXTENSION: '확장으로 받는 중',
} as const

/** 콘솔 틱톡 칸 확장 경고 */
export const EXT_TIKTOK_WARNINGS = {
  STALE: '확장에서 틱톡 댓글이 오지 않아요. 크롬에서 내 틱톡 방송 화면을 다시 열어 주세요.',
  HIDDEN: '틱톡 방송 화면을 앞으로 꺼내 두세요',
  UNREADABLE: '틱톡 화면이 바뀌어 댓글을 읽지 못해요. 댓글을 직접 붙여 넣어 주세요.',
  ELSEWHERE: '확장이 내 틱톡 방송 화면에 있지 않아요. 내 방송 화면을 열어 주세요.',
} as const

/** 직접 연결이 막혔을 때 확장을 이은 판매자에게 보이는 안내 한 줄 (D-TTX-17 — 경고 모양 아님) */
export const EXT_TIKTOK_HINT = 'PC 크롬에서 내 틱톡 방송 화면을 열어 두면 확장이 댓글을 대신 받아요.'

/** 확장 팝업 틱톡 줄 (서버 응답의 message — 확장이 글자 그대로 보여도 된다) */
export const EXT_TIKTOK_MESSAGES = {
  RECORDING: `틱톡 댓글을 ${SERVICE_NAME}로 보내고 있어요.`,
  STANDBY: '서버 연결로 받고 있어 확장은 기다려요.',
  NOT_OWN_LIVE: '지금 화면은 내 틱톡 방송이 아니에요. 댓글을 보내지 않아요.',
  NO_TIKTOK_ID: `${SERVICE_NAME} 설정에서 내 틱톡 아이디를 먼저 넣어 주세요.`,
  NOT_LINKED: `${SERVICE_NAME} 콘솔에서 방송을 틱톡에 먼저 이어 주세요.`,
  NO_CONSENT: `틱톡 연결이 꺼져 있어요. ${SERVICE_NAME} 설정에서 안내를 읽고 켜 주세요.`,
  PLATFORM_NOT_READY: '지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.',
  OVERFLOW: `놓친 틱톡 댓글이 있어요. ${SERVICE_NAME}에서 댓글을 붙여 넣어 주세요.`,
  ELSEWHERE_PAGE: '내 틱톡 방송 화면을 열면 댓글을 보내요.',
  SAVE_FAILED: '저장하지 못했어요. 다시 보낼게요.',
} as const

/** 확장이 보내지 못하는 까닭 (기록 0) */
export type ExtTiktokBlock = 'PLATFORM_NOT_READY' | 'NO_CONSENT' | 'NO_TIKTOK_ID' | 'NOT_LINKED'

/** 확장 화면 종류: 내 방송 · 남의 방송 · 그 밖의 틱톡 화면 */
export type ExtTiktokScreen = 'OWN' | 'OTHER' | 'ELSEWHERE'
export const EXT_TIKTOK_SCREENS: readonly ExtTiktokScreen[] = ['OWN', 'OTHER', 'ELSEWHERE']

/** 확장 쪽 상태 (AC-TTX-19): 받는 중·대기·뒤로 감·읽지 못함·다른 화면·조용함·없음 */
export type ExtTiktokState = 'RECEIVING' | 'STANDBY' | 'HIDDEN' | 'UNREADABLE' | 'ELSEWHERE' | 'STALE' | 'NONE'

/** 회차의 틱톡 연결 보기의 extension 칸 */
export interface TikTokExtensionView {
  readonly state: ExtTiktokState
  /** "확장으로 받는 중"인가 — 이때 붙여넣기 알림 띠(직접 연결 막힘·멈춤·missed 때문)를 띄우지 않는다 (D-TTX-09, AC-TTX-21) */
  readonly active: boolean
  /** 받는 길 한 줄 (EXT_TIKTOK_ROUTES 중 하나) — 상태가 한 번도 없던 회차·받는 길이 없으면 null */
  readonly route: string | null
  /** 확장 경고 문장 (EXT_TIKTOK_WARNINGS 중 하나) — 직접 연결이 받는 중이면 null */
  readonly warning: string | null
  /** 막혔을 때 확장 안내 한 줄 (EXT_TIKTOK_HINT) — 이 회차 확장 상태가 없고(NONE) 부르는 쪽이 조건을 맞췄을 때만 (D-TTX-17) */
  readonly hint: string | null
  readonly screen: ExtTiktokScreen | null
  readonly hidden: boolean
  /** 마지막 확장 상태 시각 (UTC ISO) */
  readonly statusAt: string | null
  /** 확장 경로로 기록한 수 · 대기로 센 수 · 확장이 센 읽지 못한 수 */
  readonly recorded: number
  readonly standby: number
  readonly unread: number
}

const asScreen = (value: string | null): ExtTiktokScreen | null => (value !== null && (EXT_TIKTOK_SCREENS as readonly string[]).includes(value) ? (value as ExtTiktokScreen) : null)

/**
 * 연결 기록 + 직접 연결 상태 → extension 칸 (순수 함수 — 지금 시각은 부르는 쪽이 넘긴다).
 * directConnected = 직접 연결이 받는 중, open = 그 연결이 이어져 있고 운영자 스위치·동의가 맞음(D-TTX-06 조건),
 * hintable = 확장을 이은 판매자이고 직접 연결이 막힘·멈춤(D-TTX-17 조건 — 부르는 쪽이 판단한다)
 */
export function extensionViewOf(
  row: Pick<TiktokLinkRow, 'extRecorded' | 'extStandby' | 'extStatusAt' | 'extScreen' | 'extHidden' | 'extUnread' | 'extUnreadSince'>,
  directConnected: boolean,
  open: boolean,
  now: number,
  hintable = false,
): TikTokExtensionView {
  const counts = { recorded: row.extRecorded, standby: row.extStandby, unread: row.extUnread }
  const screen = asScreen(row.extScreen)
  if (row.extStatusAt === null) return { state: 'NONE', active: false, route: null, warning: null, hint: hintable && !directConnected ? EXT_TIKTOK_HINT : null, screen: null, hidden: false, statusAt: null, ...counts }
  const statusAt = row.extStatusAt.toISOString()
  // 겹치면 조용함 > 다른 화면 > 뒤로 감 > 읽지 못함
  let health: Exclude<ExtTiktokState, 'STANDBY' | 'NONE'>
  if (now - row.extStatusAt.getTime() > EXT_TIKTOK_STALE_MS) health = 'STALE'
  else if (screen !== 'OWN') health = 'ELSEWHERE'
  else if (row.extHidden) health = 'HIDDEN'
  else if (row.extUnreadSince !== null && now - row.extUnreadSince.getTime() >= EXT_TIKTOK_UNREADABLE_MS) health = 'UNREADABLE'
  else health = 'RECEIVING'
  const base = { hint: null, screen, hidden: row.extHidden, statusAt, ...counts }
  if (directConnected) {
    // 직접 연결 우선 (D-TTX-07): 확장이 30초 안에 상태를 보냈으면 "확장은 대기 중"
    const fresh = health !== 'STALE'
    return { state: health === 'RECEIVING' ? 'STANDBY' : health, active: false, route: fresh ? EXT_TIKTOK_ROUTES.DIRECT_STANDBY : EXT_TIKTOK_ROUTES.DIRECT, warning: null, ...base }
  }
  const active = health === 'RECEIVING' && open
  return { state: health, active, route: active ? EXT_TIKTOK_ROUTES.EXTENSION : null, warning: open && health !== 'RECEIVING' ? EXT_TIKTOK_WARNINGS[health] : null, ...base }
}

/** 받는 길을 정하는 칸만 (바뀌었을 때만 알린다) */
const viewKey = (view: TikTokExtensionView | null): string => (view === null ? 'null' : JSON.stringify([view.state, view.active, view.route, view.warning, view.hint]))

/** 확장에게 알려 주는 지금 상태 (GET /ext/tiktok · POST /ext/tiktok/status 응답) */
export interface ExtTiktokInfo {
  /** 판매자의 틱톡 아이디 (이어진 연결의 것, 없으면 설정의 것) — 확장이 화면 주소의 아이디와 비교한다 (D-TTX-03) */
  readonly tiktokId: string | null
  /** 보내면 어떻게 되나: recording 기록 · standby 대기 · blocked 기록 0 (code가 까닭) */
  readonly mode: 'recording' | 'standby' | 'blocked'
  readonly code: ExtTiktokBlock | null
  readonly message: string
  /** 이어진 회차 (없으면 null) */
  readonly broadcast: string | null
}

export type ExtTiktokIngestOutcome =
  | { readonly kind: 'recorded'; readonly recorded: number; readonly dropped: number; readonly duplicates: number; readonly broadcast: string }
  | { readonly kind: 'standby'; readonly standby: number; readonly dropped: number; readonly broadcast: string }
  | { readonly kind: 'blocked'; readonly code: Exclude<ExtTiktokBlock, 'NO_TIKTOK_ID'> | 'NOT_OWN_LIVE' }
  | { readonly kind: 'save_failed' }

export interface ExtTiktokStatusInput {
  readonly screen: ExtTiktokScreen
  readonly hidden: boolean
  readonly read: number
  readonly unread: number
  /** 지난번 서버가 받아 적은 뒤 확장이 새로 버린 댓글 수 (D-TTX-16, 0~EXT_TIKTOK_DROPPED_MAX) */
  readonly dropped: number
}

export interface TikTokExtensionDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly log: LogSink
  readonly live: TikTokLive
}

interface Conditions {
  readonly link: TiktokLinkRow | null
  readonly tiktokId: string | null
  readonly block: ExtTiktokBlock | null
}

const rejection = (status: number, code: Rejection['code'], message: string): Rejection => ({ status, code, message, problems: [] })

/** 화면 아이디 → 비교할 값 (다듬고 ASCII 소문자). 글이 아니면 null */
const pageKey = (pageId: unknown): string | null => {
  if (typeof pageId !== 'string') return null
  const key = asciiLower(pageId.trim())
  return key === '' ? null : key
}

export class TikTokExtension {
  readonly #deps: TikTokExtensionDeps
  /** 판매자마다 다음 상태 확인 예약 (조용함·읽지 못함이 되는 때 알린다) */
  readonly #checks = new Map<string, () => void>()
  /** 판매자마다 마지막으로 알린 extension 칸 */
  readonly #published = new Map<string, string>()
  /** 판매자마다 연결 보기를 계산하는 중인지 · 그동안 들어온 다음 요청 (RA-TTX-06 — 묶음·상태가 몰려도 한 번에 하나만 계산) */
  readonly #refreshing = new Map<string, { b: string; force: boolean } | null>()
  #closed = false

  constructor(deps: TikTokExtensionDeps) {
    this.#deps = deps
  }

  #now(): number {
    return this.#deps.clock.now()
  }

  async #conditions(sellerId: string): Promise<Conditions> {
    const { db, live } = this.#deps
    const link = await sellerOpenTiktokLink(db, sellerId)
    const tiktokId = link?.tiktokId ?? (await findTiktokId(db, sellerId))
    let block: ExtTiktokBlock | null = null
    if (!live.operatorOn) block = 'PLATFORM_NOT_READY'
    else if (!(await live.consentCheck(sellerId))) block = 'NO_CONSENT'
    else if (link === null) block = tiktokId === null ? 'NO_TIKTOK_ID' : 'NOT_LINKED'
    return { link, tiktokId, block }
  }

  #info(conditions: Conditions): ExtTiktokInfo {
    const { link, tiktokId, block } = conditions
    if (block !== null || link === null) {
      const code = block ?? 'NOT_LINKED'
      return { tiktokId, mode: 'blocked', code, message: EXT_TIKTOK_MESSAGES[code], broadcast: link?.broadcastId ?? null }
    }
    const standby = this.#deps.live.directState(link.sellerId, link.id) === 'CONNECTED'
    return { tiktokId, mode: standby ? 'standby' : 'recording', code: null, message: standby ? EXT_TIKTOK_MESSAGES.STANDBY : EXT_TIKTOK_MESSAGES.RECORDING, broadcast: link.broadcastId }
  }

  /** 확장이 화면을 열 때·팝업이 볼 때 (GET /ext/tiktok) */
  async info(sellerId: string): Promise<ExtTiktokInfo> {
    return this.#info(await this.#conditions(sellerId))
  }

  /**
   * 묶음 하나 받기 (POST /ext/tiktok/chats). tokenAlive = 기록 트랜잭션 안에서 그 토큰이 아직 살아 있는지 (그사이 끊었으면 기록하지 않는다)
   */
  async ingest(sellerId: string, pageId: unknown, items: readonly unknown[], tokenAlive: (tx: Db) => Promise<boolean>): Promise<ExtTiktokIngestOutcome> {
    const conditions = await this.#conditions(sellerId)
    const { link, tiktokId, block } = conditions
    // 본인 방송 확인 (D-TTX-03): 아이디를 아는데 화면 아이디가 다르거나 없으면 다른 조건보다 먼저 403
    const page = pageKey(pageId)
    if (tiktokId !== null && page !== tiktokId) return { kind: 'blocked', code: 'NOT_OWN_LIVE' }
    if (block !== null || link === null) return { kind: 'blocked', code: block === 'NO_TIKTOK_ID' || block === null ? 'NOT_LINKED' : block }
    const receivedAt = new Date(this.#now())
    const filter = createExtensionCommentFilter(link.tiktokId)
    const records: TikTokCommentRecord[] = []
    const drops = new Map<TikTokExtensionDropCode, number>()
    for (const item of items) {
      const outcome = filter.accept(item, receivedAt)
      if ('record' in outcome) records.push(outcome.record)
      else drops.set(outcome.drop, (drops.get(outcome.drop) ?? 0) + 1)
    }
    const dropped = [...drops.values()].reduce((sum, n) => sum + n, 0)
    // 한 번에 한 경로: 직접 연결이 받는 중이면 기록하지 않고 대기로 센다 (D-TTX-07)
    if (this.#deps.live.directState(sellerId, link.id) === 'CONNECTED') {
      await bumpTiktokExtCounter(this.#deps.db, sellerId, link.id, 'extStandby', records.length)
      this.#refresh(sellerId, link.broadcastId)
      return { kind: 'standby', standby: records.length, dropped, broadcast: link.broadcastId }
    }
    if (records.length === 0) return { kind: 'recorded', recorded: 0, dropped, duplicates: 0, broadcast: link.broadcastId }
    return this.#record(sellerId, link, records, dropped, tokenAlive)
  }

  async #record(sellerId: string, link: TiktokLinkRow, records: readonly TikTokCommentRecord[], dropped: number, tokenAlive: (tx: Db) => Promise<boolean>): Promise<ExtTiktokIngestOutcome> {
    const { db, writer, log } = this.#deps
    const b = link.broadcastId
    const broadcast = await findBroadcast(db, sellerId, b)
    if (broadcast === null || broadcast.rehearsal || broadcast.endedAt !== null) return { kind: 'blocked', code: 'NOT_LINKED' }
    const scope = broadcast.date
    let drafted = 0
    const write = () => {
      drafted = 0
      return writer.write({
        sellerId,
        date: scope,
        rehearsal: false,
        createScope: false,
        requestId: null,
        chatBatch: { b, ids: records.map((record) => tiktokChatFields(record).id) },
        // 범위 락 안에서: 그 연결이 아직 이어져 있고(끊기·회차 끝내기와 겹치지 않음) 토큰도 살아 있다
        guard: async (tx) => {
          const current = await findTiktokLink(tx, sellerId, link.id)
          if (current === null || current.state !== 'LINKED') return rejection(409, 'NOT_LINKED', EXT_TIKTOK_MESSAGES.NOT_LINKED)
          return (await tokenAlive(tx)) ? null : rejection(409, 'NOT_LINKED', EXT_TIKTOK_MESSAGES.NOT_LINKED)
        },
        build: (ctx) => {
          if (getBroadcast(ctx.state, b)?.ended === true) return rejection(409, 'NOT_LINKED', EXT_TIKTOK_MESSAGES.NOT_LINKED)
          const seen = new Set(ctx.existingChats)
          const drafts: Draft[] = []
          for (const record of records) {
            const fields = tiktokChatFields(record)
            // 같은 (회차, tt: 메시지 ID)는 한 번만 — 직접 연결이 먼저 기록했어도, 같은 묶음을 다시 보냈어도 (D-TTX-05)
            if (seen.has(fields.id)) continue
            seen.add(fields.id)
            // 직접 연결과 같은 이벤트·같은 출처 (D-TTX-12)
            drafts.push({ fields: { type: 'chat', b, ...fields }, actor: { kind: 'collector' }, chat: { b, id: fields.id }, source: 'other', skipIfInvalid: true })
          }
          drafted = drafts.length
          return drafts
        },
      })
    }
    let outcome = await write()
    for (let i = 0; i < DUPLICATE_RETRIES && outcome.kind === 'duplicate'; i += 1) outcome = await write()
    if (outcome.kind === 'ok' || outcome.kind === 'empty') {
      const recorded = outcome.kind === 'ok' ? outcome.records.length : 0
      const built = outcome.kind === 'ok' ? drafted : 0
      try {
        await bumpTiktokExtCounter(db, sellerId, link.id, 'extRecorded', recorded)
        // 엔진 입력 검사로 건너뛴 수 — 직접 연결과 같은 칸 (D-N2b-2-17)
        if (built - recorded > 0) {
          log({ level: 'warn', code: 'TIKTOK_SKIPPED', seller: sellerId, count: built - recorded })
          await bumpTiktokCounter(db, sellerId, link.id, 'skipped', built - recorded)
        }
      } catch (error) {
        // 기록은 이미 확정됐다 — 수만 못 셌다
        log({ level: 'warn', code: 'TTX_COUNT_FAILED', seller: sellerId, errorKind: errorKind(error) })
      }
      this.#refresh(sellerId, b)
      return { kind: 'recorded', recorded, dropped, duplicates: records.length - built, broadcast: b }
    }
    if (outcome.kind === 'rejected' || outcome.kind === 'not_found') return { kind: 'blocked', code: 'NOT_LINKED' }
    log({ level: 'error', code: 'TTX_SAVE_FAILED', seller: sellerId, count: records.length })
    return { kind: 'save_failed' }
  }

  /** 확장 틱톡 상태 (POST /ext/tiktok/status, 10초마다). 이어진 연결이 있으면 그 연결에 둔다 */
  async status(sellerId: string, input: ExtTiktokStatusInput): Promise<ExtTiktokInfo> {
    const conditions = await this.#conditions(sellerId)
    const { link } = conditions
    if (link !== null) {
      // 확장이 버린 댓글 → 이어진 그 연결의 저장 실패 수 (D-TTX-16). 이어진 연결이 없으면 더하지 않는다
      const added = input.dropped > 0 && (await addTiktokExtDropped(this.#deps.db, sellerId, link.id, input.dropped))
      if (added) this.#deps.log({ level: 'warn', code: 'TTX_EXT_DROPPED', seller: sellerId, count: input.dropped })
      const now = this.#now()
      // 읽지 못함만 이어진 첫 시각 (유튜브 확장 상태와 같은 규칙): 수가 줄면(확장이 다시 뜸) 새로 센다
      const reset = link.extStatusAt === null || input.read < link.extRead || input.unread < link.extUnread
      let unreadSince: Date | null
      if (reset) unreadSince = input.unread > 0 && input.read === 0 ? new Date(now) : null
      else if (input.read > link.extRead) unreadSince = null
      else if (input.unread > link.extUnread) unreadSince = link.extUnreadSince ?? new Date(now)
      else unreadSince = link.extUnreadSince
      const status = { statusAt: new Date(now), screen: input.screen, hidden: input.hidden, read: input.read, unread: input.unread, unreadSince }
      if (await writeTiktokExtStatus(this.#deps.db, sellerId, link.id, status)) {
        this.#refresh(sellerId, link.broadcastId, added)
        this.#schedule(sellerId, link.broadcastId, status.statusAt.getTime(), unreadSince?.getTime() ?? null)
      } else if (added) this.#refresh(sellerId, link.broadcastId, true)
    }
    return this.#info(conditions)
  }

  /** 확장 연결(토큰)이 생기거나 끊겼다: 이어진 연결의 안내 한 줄(D-TTX-17)이 바뀌었을 수 있다 */
  async tokenChanged(sellerId: string): Promise<void> {
    try {
      const link = await sellerOpenTiktokLink(this.#deps.db, sellerId)
      if (link !== null) this.#refresh(sellerId, link.broadcastId)
    } catch (error) {
      this.#deps.log({ level: 'warn', code: 'TTX_REFRESH_FAILED', seller: sellerId, errorKind: errorKind(error) })
    }
  }

  /**
   * 서버가 다시 켜지면 "조용함"·"읽지 못함" 예약을 다시 건다 (RA-TTX-03): 이어진 연결 중 확장 상태가 있는 것마다.
   * 이미 지난 때는 보기를 읽을 때 그대로 계산되므로 예약하지 않는다(#schedule이 거른다)
   */
  async resume(): Promise<number> {
    let scheduled = 0
    try {
      for (const link of await linkedTiktokExtStatuses(this.#deps.db)) {
        if (this.#closed) break
        if (link.extStatusAt === null) continue
        this.#schedule(link.sellerId, link.broadcastId, link.extStatusAt.getTime(), link.extUnreadSince?.getTime() ?? null)
        if (this.#checks.has(link.sellerId)) scheduled += 1
      }
    } catch (error) {
      this.#deps.log({ level: 'warn', code: 'TTX_RESUME_FAILED', errorKind: errorKind(error) })
    }
    return scheduled
  }

  /** 확장 연결을 끊었다 (끊기): 이어진 연결의 확장 상태를 비운다 — 판매자가 끊은 것을 "오지 않아요"로 알리지 않는다 */
  async disconnected(sellerId: string): Promise<void> {
    try {
      const cleared = await clearTiktokExtStatus(this.#deps.db, sellerId)
      this.#checks.get(sellerId)?.()
      this.#checks.delete(sellerId)
      for (const b of cleared) this.#refresh(sellerId, b)
    } catch (error) {
      this.#deps.log({ level: 'warn', code: 'TTX_CLEAR_FAILED', seller: sellerId, errorKind: errorKind(error) })
    }
  }

  /** 다음에 상태가 바뀔 때(30초 상태 없음·1분 읽지 못함) 다시 보고 알린다 */
  #schedule(sellerId: string, b: string, statusAt: number, unreadSince: number | null): void {
    if (this.#closed) return
    this.#checks.get(sellerId)?.()
    const now = this.#now()
    const at = [statusAt + EXT_TIKTOK_STALE_MS + 1, ...(unreadSince === null ? [] : [unreadSince + EXT_TIKTOK_UNREADABLE_MS])].filter((t) => t > now)
    if (at.length === 0) return
    let cancelled = false
    const cancel = this.#deps.live.tiktokClock.setTimer(Math.min(...at) - now, () => {
      if (cancelled || this.#closed) return
      this.#checks.delete(sellerId)
      this.#refresh(sellerId, b)
      // 조용함 뒤에는 더 바뀔 것이 없다. 읽지 못함까지 남았으면 다시 예약
      if (unreadSince !== null && unreadSince + EXT_TIKTOK_UNREADABLE_MS > this.#now()) this.#schedule(sellerId, b, statusAt, unreadSince)
    })
    this.#checks.set(sellerId, () => {
      cancelled = true
      cancel()
    })
  }

  /**
   * extension 칸이 바뀌었으면 연결 보기를 알린다 (SSE event: tiktok, kind LINK). force = 다른 칸(저장 실패 수)이 바뀌어 꼭 알린다.
   * 같은 판매자의 계산이 진행 중이면 기다렸다가 한 번만 다시 계산한다 (RA-TTX-06)
   */
  #refresh(sellerId: string, b: string, force = false): void {
    if (this.#closed) return
    if (this.#refreshing.has(sellerId)) {
      const pending = this.#refreshing.get(sellerId) ?? null
      this.#refreshing.set(sellerId, { b, force: force || (pending?.force ?? false) })
      return
    }
    this.#refreshing.set(sellerId, null)
    void this.#deps.live
      .view(sellerId, b)
      .then((view) => {
        const key = `${b}:${viewKey(view?.extension ?? null)}`
        if (!force && this.#published.get(sellerId) === key) return
        this.#published.set(sellerId, key)
        this.#deps.live.publishLink(sellerId, b)
      })
      .catch(() => undefined)
      .finally(() => {
        const next = this.#refreshing.get(sellerId) ?? null
        this.#refreshing.delete(sellerId)
        if (next !== null) this.#refresh(sellerId, next.b, next.force)
      })
  }

  close(): void {
    this.#closed = true
    for (const cancel of this.#checks.values()) cancel()
    this.#checks.clear()
  }
}
