// 휴대폰 알림 받기 (SMS3 — SPEC ORD-13 약속 C-01~C-07·PAY-02, DOMAIN_RULES R-26, DEPOSIT_RULES DP-9, D-SMS3-01~14·D-DEP2-01~07).
// - 받기 토큰(C-02): 32바이트 무작위, 해시만 저장. 다시 만들면 옛 토큰 바로 무효, 끄면 모든 요청 401, 이 입구에만 통한다.
// - 입구(C-04) 한 곳: 메시지마다 위에서부터 가른다(C-05) — 앱 알림·은행 대표번호·휴대폰 아닌 번호 → DP-9(입금 서비스), 휴대폰·이름 → R-26(코어 parseSmsText).
//   판정·읽기 규칙은 코어(parseSmsText)와 입금 순수 함수(readBankNotice)만 부른다 — 여기에 복제하지 않는다.
// - 같은 것 합치기(C-06): 같은 id 24시간, 같은 문자(보낸 곳·본문) 받은 시각 60초 안, 은행 입금은 외부 키. 판매자마다 한 줄로 처리한다(동시 요청 안전).
// - 문자찜은 지금의 sms 이벤트로 바로(요청 번호 inbox-<id>-<번호>), 판매 중이 아니면 NOT_ON_SALE 카드, 취소 요청·확인 필요는 카드(판매자가 넣기·승인·무시).
// - 개인정보(C-07, DP-INV-8): 본문·번호·이름·토큰은 로그에 남기지 않는다. 카드의 본문·보낸 번호·보낸 이름만 판매자에 묶어 암호화하고,
//   처리하면 바로, 처리하지 않으면 방송이 끝나고 24시간 뒤 지운다. 넣은 문자찜·거른 문자·찜 아닌 문자·은행 알림의 본문은 저장하지 않는다.
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { SMS_EXCLUDED_WORDS, activeClaimId, listClaims, buyerOfRef, containsPhoneRun, currentBuyerOf, getBroadcast, normalizePhone, parseSmsText, type SmsTextResult } from '@livejjim/core'
import { hasUnsafeText, isPlainObject, own, ownKeys } from '../api-fields.ts'
import type { Db } from '../db/database.ts'
import { kstIso } from '../deposit/calendar.ts'
import { BANK_APPS, readBankNotice, senderDigits, trustedBank } from '../deposit/notice.ts'
import type { DepositService } from '../deposit/service.ts'
import type { ErrorCode } from '../errors.ts'
import { errorKind, type LogSink } from '../log.ts'
import { openSellerText, sealSellerText, sha256Hex } from '../secrets.ts'
import type { Service } from '../service.ts'
import type { GeneratorTimer } from '../generator.ts'
import type { Clock } from '../time.ts'
import { parsePhoneAt } from '../try/sms-test.ts'
import type { Actor, ScopeWriter, WriteOutcome, WriteResult } from '../writer.ts'
import {
  broadcastStart,
  claimCard,
  findCard,
  inboxSmsSeqs,
  findSettings,
  finishCard,
  insertCard,
  inboxSellerIds,
  insertSmsSeen,
  markSeen,
  openCards,
  pruneSeen,
  purgeCards,
  realBroadcast,
  releaseCard,
  saveToken,
  seenSince,
  sellerOfToken,
  setEnabled,
  smsRefsOfPhoneKey,
  smsSeenNear,
  touchReceived,
  windowBroadcast,
  type CardRow,
  type CardWhy,
} from './store.ts'

// ── 정한 값 ──────────────────────────────────────────────────────────────

/** 한 요청의 메시지 수 (C-04 0~20건) */
export const INBOX_MESSAGES_MAX = 20
/** 읽는 본문 길이 (C-04 — 넘으면 앞 1,000자) */
export const INBOX_TEXT_MAX = 1000
/** 보낸 곳·제목 길이 (기기 상한 packages/mobile-notice NOTICE_FROM_MAX_CHARS·NOTICE_TITLE_MAX_CHARS와 같음 — 넘으면 앞부분만) */
export const INBOX_FROM_MAX = 200
export const INBOX_TITLE_MAX = 200
/** id 길이 (C-04 1~64자) */
export const INBOX_ID_MAX = 64
/** 기기 이름 길이 (C-04 1~30자) */
export const INBOX_DEVICE_MAX = 30
/** 판매자마다 1분 120건 (C-04) */
export const INBOX_RATE_LIMIT = 120
export const INBOX_RATE_WINDOW_MS = 60_000
/** 같은 id는 24시간 (C-06) */
export const INBOX_SEEN_MS = 24 * 3_600_000
/** 같은 문자는 받은 시각 60초 안 (C-06) */
export const INBOX_SAME_SMS_MS = 60_000
/** 끝난 방송으로 받는 시간 (D-SMS3-07 — 끝난 뒤 10분) */
export const INBOX_AFTER_END_MS = 10 * 60_000
/** 처리하지 않은 카드를 두는 시간 (방송이 끝나고 24시간, C-07) */
export const INBOX_CARD_KEEP_MS = 24 * 3_600_000
/** 주기 정리 간격 (받은 id·같은 문자 표지 24시간, 처리 안 한 카드 방송 끝나고 24시간, 은행 알림 줄 30일 — 요청이 오지 않아도 지운다) */
export const INBOX_SWEEP_MS = 30 * 60_000

/** 화면 문구 (ORD-13 "화면 문구" — 화면이 그대로 보인다) */
export const INBOX_MESSAGES = {
  UNCLEAR: '번호는 있는데 확실하지 않아요',
  NO_NUMBER: '이름만 와서 누가 보냈는지 몰라요',
  OPTIONS: '옵션 방송이라 직접 골라 주세요',
  NOT_ON_SALE: '{no}번은 지금 판매 중이 아니에요',
  CANCEL: '{no}번 취소를 원해요',
  noClaim: '취소할 찜이 없어요',
  cardDone: '이미 처리한 문자예요.',
  noToken: '먼저 토큰을 만들어 주세요.',
  tokenInvalid: '받기 토큰이 맞지 않아요. 설정에서 토큰을 다시 넣어 주세요.',
  tooMany: '보낸 것이 너무 많아요. 1분 뒤에 다시 보내 주세요.',
  badRequest: '보낸 내용의 형식이 올바르지 않아요.',
  notCancel: '취소 요청 카드만 승인할 수 있어요.',
  notReview: '확인 필요 카드만 넣을 수 있어요.',
  /** 이름만 온 문자의 취소 요청은 승인하지 않는다 (D-SMS3-19) */
  nameOnlyCancel: '이름만 와서 누가 보냈는지 몰라요. 보드에서 직접 취소해 주세요',
} as const

export type InboxStatus = 'SAVED' | 'DUPLICATE' | 'IGNORED'

export interface InboxView {
  readonly enabled: boolean
  readonly hasToken: boolean
  readonly tokenCreatedAt: string | null
  readonly lastReceivedAt: string | null
  readonly lastDevice: string | null
}

export interface CardView {
  readonly id: string
  readonly b: string
  readonly kind: 'REVIEW' | 'CANCEL'
  readonly why: CardWhy | null
  readonly numbers: readonly number[]
  readonly memo: string | null
  readonly last4: string | null
  readonly sender: string | null
  readonly text: string
  readonly receivedAt: string
  readonly message: string
  /** "승인" 단추를 보일지 — 번호가 온 취소 요청만 true. 이름만 온 취소 요청·확인 필요 카드는 false (D-SMS3-19) */
  readonly canApprove: boolean
}

export interface InboxMessageInput {
  readonly id: string
  readonly channel: 'SMS' | 'APP'
  readonly from: string | null
  readonly title: string | null
  readonly text: string
  readonly receivedAt: unknown
}

export interface InboxRequest {
  readonly device: string
  readonly messages: readonly InboxMessageInput[]
}

export type InboxOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly status: number; readonly code: ErrorCode; readonly message: string; readonly extra?: Readonly<Record<string, unknown>> }

const fail = (status: number, code: ErrorCode, message: string, extra?: Readonly<Record<string, unknown>>): InboxOutcome<never> => ({ ok: false, status, code, message, ...(extra === undefined ? {} : { extra }) })

/** 기기에 주는 거르기 목록 (C-03·D-SMS3-11): R-26 3 거를 낱말 9개, DP-9 1 표의 은행 앱 패키지 9개 */
export const INBOX_FILTERS = Object.freeze({ skipWords: [...SMS_EXCLUDED_WORDS], bankApps: [...BANK_APPS] })

const MESSAGE_KEYS = ['id', 'channel', 'from', 'title', 'text', 'receivedAt']
const chars = (text: string): number => [...text].length
const cut = (text: string, max: number): string => (text.length <= max ? text : [...text].slice(0, max).join(''))
/** 글의 방향을 바꾸는 글자 (카드 이름·본문 위장 막기, RA-SMS3-010) — 본문·제목에서 지운다 */
const BIDI_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu
/** 화면에 보이는 보낸 이름에서 지우는 글자: 제어 글자 + 방향 글자 */
const DISPLAY_UNSAFE_RE = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu
/** 카드에 보일 보낸 이름 (가르기·믿을 보낸 곳 검사는 받은 그대로의 from으로 한다 — 지운 글로 은행 번호가 되지 않게) */
const displaySender = (from: string | null): string | null => {
  if (from === null) return null
  const clean = from.replace(DISPLAY_UNSAFE_RE, '').trim()
  return clean === '' ? null : clean
}

/** 요청 본문 검사 (C-04): 하나라도 틀리면 null(400 — 아무것도 처리하지 않는다) */
export function parseInboxRequest(raw: unknown): InboxRequest | null {
  if (!isPlainObject(raw)) return null
  if (ownKeys(raw).some((key) => key !== 'device' && key !== 'messages')) return null
  const device = own(raw, 'device')
  const messages = own(raw, 'messages')
  if (typeof device !== 'string' || chars(device) < 1 || chars(device) > INBOX_DEVICE_MAX || hasUnsafeText(device) || device.trim() === '') return null
  if (!Array.isArray(messages) || messages.length > INBOX_MESSAGES_MAX) return null
  const out: InboxMessageInput[] = []
  for (const item of messages as unknown[]) {
    if (!isPlainObject(item)) return null
    if (ownKeys(item).some((key) => !MESSAGE_KEYS.includes(key))) return null
    const id = own(item, 'id')
    const channel = own(item, 'channel')
    const from = own(item, 'from') ?? null
    const title = own(item, 'title') ?? null
    const text = own(item, 'text')
    const receivedAt = own(item, 'receivedAt') ?? null
    if (typeof id !== 'string' || chars(id) < 1 || chars(id) > INBOX_ID_MAX || !id.isWellFormed()) return null
    if (channel !== 'SMS' && channel !== 'APP') return null
    if (from !== null && typeof from !== 'string') return null
    if (title !== null && typeof title !== 'string') return null
    if (typeof text !== 'string') return null
    if (receivedAt !== null && typeof receivedAt !== 'string' && typeof receivedAt !== 'number') return null
    // 보낸 곳·제목은 기기 상한까지, 본문·제목의 방향 글자는 지운다 (RA-SMS3-010)
    out.push({
      id,
      channel,
      from: from === null ? null : cut(from, INBOX_FROM_MAX),
      title: title === null ? null : cut(title, INBOX_TITLE_MAX).replace(BIDI_RE, ''),
      text: text.replace(BIDI_RE, ''),
      receivedAt,
    })
  }
  return { device: device.trim(), messages: out }
}

/** Authorization 머리글의 토큰 (`Bearer <토큰>` 아니면 null) */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9._~+/-]{16,512}=*)$/.exec(header ?? '')
  return match === null ? null : (match[1] as string)
}

/** 토큰 해시 (DB엔 이것만) */
export const inboxTokenHash = (token: string): string => sha256Hex(`inbox-token/${token}`)

/** 보낸 곳 종류 (C-05): 은행 대표번호 · 휴대폰 · 이름만 · 그 밖 번호 */
function senderKind(from: string | null): { kind: 'BANK' | 'MOBILE' | 'NAME' | 'OTHER'; phone: string | null } {
  if (trustedBank('SMS', from) !== null) return { kind: 'BANK', phone: null }
  if (typeof from !== 'string') return { kind: 'NAME', phone: null }
  const digits = senderDigits(from)
  const phone = normalizePhone(digits)
  if (phone !== null) return { kind: 'MOBILE', phone }
  // R-26 1: 숫자를 하나 이상 담고 숫자·공백·+·-·(·)·.·#·*로만 되어 있으면 휴대폰 아님
  const numberShaped = digits.length > 0 && [...from].every((char) => /[0-9０-９+\-().#*]/u.test(char) || (/\s/u.test(char) && char !== '﻿'))
  return { kind: numberShaped ? 'OTHER' : 'NAME', phone: null }
}

interface Sealed {
  readonly text: string
  readonly phone: string | null
  readonly sender: string | null
}

const SEAL_PURPOSE = 'inbox-card'

export interface InboxDeps {
  readonly db: Db
  readonly service: Service
  readonly writer: ScopeWriter
  readonly deposits: DepositService
  readonly clock: Clock
  readonly masterKey: Buffer
  readonly log: LogSink
  /** 실시간 알림 (event: inbox — 본문·번호는 담지 않는다) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 1분 한도 (시험만 바꾼다) */
  readonly rateLimit?: number
  /** 주기 정리 타이머 (기본 실제 setTimeout — 시험은 sweep()을 직접 부른다) */
  readonly timer?: GeneratorTimer
  readonly sweepMs?: number
}

export class InboxService {
  readonly #deps: InboxDeps
  readonly #queues = new Map<string, Promise<unknown>>()
  /** 판매자 → 받은 메시지 시각들 (1분 한도) */
  readonly #rate = new Map<string, number[]>()

  #cancelSweep: (() => void) | null = null
  #closed = false

  constructor(deps: InboxDeps) {
    this.#deps = deps
  }

  /**
   * 주기 정리를 건다 (C-07·D-SMS3-17·AC-SMS3-18): 요청·화면 열기가 없어도 처리 안 한 카드(본문)는 방송 끝나고 24시간,
   * 은행 알림 줄은 받은 지 30일, 받은 id·같은 문자 표지는 24시간 뒤 지운다
   */
  start(): void {
    if (this.#closed || this.#cancelSweep !== null || this.#deps.timer === undefined) return
    const timer = this.#deps.timer
    // 켤 때 한 번 (서버가 오래 꺼져 있었으면 바로 지운다)
    void this.sweep()
    const next = () => {
      this.#cancelSweep = timer.schedule(this.#deps.sweepMs ?? INBOX_SWEEP_MS, () => {
        void this.sweep().finally(() => {
          if (!this.#closed) next()
        })
      })
    }
    next()
  }

  close(): void {
    this.#closed = true
    this.#cancelSweep?.()
    this.#cancelSweep = null
  }

  /** 정리 한 번 — 판매자마다 따로(한 판매자가 실패해도 다음은 한다, 경보는 판매자 ID·까닭 종류만) */
  async sweep(): Promise<void> {
    let sellerIds: string[]
    try {
      sellerIds = await inboxSellerIds(this.#deps.db)
    } catch (error) {
      this.#deps.log({ level: 'warn', code: 'INBOX_SWEEP_FAILED', errorKind: errorKind(error) })
      return
    }
    for (const sellerId of sellerIds) {
      try {
        await this.#serial(sellerId, () => pruneSeen(this.#deps.db, sellerId, new Date(this.#now() - INBOX_SEEN_MS)))
        await this.purge(sellerId)
        await this.#deps.deposits.pruneOldAlerts(sellerId)
      } catch (error) {
        this.#deps.log({ level: 'warn', code: 'INBOX_SWEEP_FAILED', seller: sellerId, errorKind: errorKind(error) })
      }
    }
  }

  #now(): number {
    return this.#deps.clock.now()
  }

  /** 판매자마다 한 줄 (같은 id 동시 요청 — 하나만 처리) */
  #serial<T>(sellerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(sellerId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    this.#queues.set(sellerId, settled)
    void settled.then(() => {
      if (this.#queues.get(sellerId) === settled) this.#queues.delete(sellerId)
    })
    return run
  }

  // ── 설정 (C-02) ──────────────────────────────────────────────────────

  async view(sellerId: string): Promise<InboxView> {
    const row = await findSettings(this.#deps.db, sellerId)
    return {
      enabled: row?.enabled === true && row.tokenHash !== null,
      hasToken: row?.tokenHash !== null && row?.tokenHash !== undefined,
      tokenCreatedAt: row?.tokenCreatedAt?.toISOString() ?? null,
      lastReceivedAt: row?.lastReceivedAt?.toISOString() ?? null,
      lastDevice: row?.lastDevice ?? null,
    }
  }

  /** 토큰 만들기·다시 만들기: 새 토큰(이 응답에만)과 설정. 켜짐이 되고, 처음이면 휴대폰 알림 원천을 둔다(D-DEP2-01) */
  async makeToken(sellerId: string): Promise<{ token: string; inbox: InboxView }> {
    const token = randomBytes(32).toString('base64url')
    await saveToken(this.#deps.db, sellerId, inboxTokenHash(token), new Date(this.#now()))
    await this.#deps.deposits.ensurePhoneSource(sellerId)
    this.#deps.publish(sellerId, { kind: 'settings' })
    return { token, inbox: await this.view(sellerId) }
  }

  async setEnabled(sellerId: string, enabled: boolean): Promise<InboxOutcome<InboxView>> {
    const row = await findSettings(this.#deps.db, sellerId)
    if (enabled && (row === null || row.tokenHash === null)) return fail(409, 'NO_TOKEN', INBOX_MESSAGES.noToken)
    if (row !== null) await setEnabled(this.#deps.db, sellerId, enabled, new Date(this.#now()))
    this.#deps.publish(sellerId, { kind: 'settings' })
    return { ok: true, value: await this.view(sellerId) }
  }

  /** 토큰 → 켜진 판매자 (아니면 null) */
  async authenticate(header: string | undefined): Promise<string | null> {
    const token = bearerToken(header)
    if (token === null) return null
    return sellerOfToken(this.#deps.db, inboxTokenHash(token))
  }

  // ── 받는 입구 (C-04) ───────────────────────────────────────────────────

  /** 1분 한도: 이 요청의 메시지를 더해도 한도 안이면 세고 true, 넘으면 세지 않고 false */
  #allow(sellerId: string, count: number): boolean {
    const now = this.#now()
    const recent = (this.#rate.get(sellerId) ?? []).filter((at) => at > now - INBOX_RATE_WINDOW_MS)
    if (recent.length + count > (this.#deps.rateLimit ?? INBOX_RATE_LIMIT)) {
      this.#rate.set(sellerId, recent)
      return false
    }
    for (let i = 0; i < count; i++) recent.push(now)
    if (recent.length === 0) this.#rate.delete(sellerId)
    else this.#rate.set(sellerId, recent)
    return true
  }

  /** 받은 요청 하나 처리 (토큰·모양은 이미 확인했다). 결과는 메시지마다 상태뿐 — 읽은 결과는 없다(D-SMS3-05) */
  async receive(sellerId: string, request: InboxRequest): Promise<InboxOutcome<{ results: { id: string; status: InboxStatus }[]; filters: typeof INBOX_FILTERS }>> {
    if (!this.#allow(sellerId, request.messages.length)) return fail(429, 'TOO_MANY', INBOX_MESSAGES.tooMany)
    if (request.messages.length === 0) return { ok: true, value: { results: [], filters: INBOX_FILTERS } }
    const results = await this.#serial(sellerId, async () => {
      const nowMs = this.#now()
      await pruneSeen(this.#deps.db, sellerId, new Date(nowMs - INBOX_SEEN_MS))
      const out: { id: string; status: InboxStatus }[] = []
      for (const message of request.messages) out.push({ id: message.id, status: await this.#one(sellerId, message, nowMs) })
      await touchReceived(this.#deps.db, sellerId, request.device, new Date(nowMs))
      return out
    })
    const view = await this.view(sellerId)
    this.#deps.publish(sellerId, { kind: 'received', lastReceivedAt: view.lastReceivedAt, lastDevice: view.lastDevice })
    return { ok: true, value: { results, filters: INBOX_FILTERS } }
  }

  async #one(sellerId: string, message: InboxMessageInput, nowMs: number): Promise<InboxStatus> {
    const { db } = this.#deps
    const idHash = sha256Hex(`inbox-id/${sellerId}/${message.id}`)
    if (await seenSince(db, sellerId, idHash, new Date(nowMs - INBOX_SEEN_MS))) return 'DUPLICATE'
    const status = await this.#route(sellerId, message, nowMs)
    await markSeen(db, sellerId, idHash, new Date(nowMs))
    return status
  }

  /** 가르기 (C-05) */
  async #route(sellerId: string, message: InboxMessageInput, nowMs: number): Promise<InboxStatus> {
    const text = cut(message.text, INBOX_TEXT_MAX)
    const title = message.title === null ? null : cut(message.title, INBOX_TITLE_MAX)
    const receivedMs = parsePhoneAt(message.receivedAt, new Date(nowMs))?.getTime() ?? nowMs
    if (message.channel === 'APP') return this.#notice(sellerId, message, 'APP', title, text, receivedMs)
    const sender = senderKind(message.from)
    if (sender.kind === 'BANK' || sender.kind === 'OTHER') return this.#notice(sellerId, message, 'SMS', null, text, receivedMs)
    return this.#sms(sellerId, message, text, receivedMs, nowMs, sender.phone)
  }

  /** 은행 알림 (DP-9): 읽기는 순수 함수, 저장·맞추기는 입금 서비스 */
  async #notice(sellerId: string, message: InboxMessageInput, channel: 'SMS' | 'APP', title: string | null, text: string, receivedMs: number): Promise<InboxStatus> {
    const notice = readBankNotice({ channel, from: message.from, title, text, receivedAt: kstIso(receivedMs) })
    return this.#deps.deposits.receiveNotice(sellerId, message.id, notice)
  }

  /** 손님 문자 (R-26) */
  async #sms(sellerId: string, message: InboxMessageInput, text: string, receivedMs: number, nowMs: number, phone: string | null): Promise<InboxStatus> {
    const { db } = this.#deps
    const now = new Date(nowMs)
    // 같은 문자 (C-06): 보낸 곳(휴대폰 번호 정리값 또는 이름 글)·본문이 같고 받은 시각 60초 안 — 표지는 HMAC만
    const senderKey = phone === null ? `name:${message.from ?? ''}` : `tel:${phone}`
    const sig = createHmac('sha256', this.#deps.masterKey).update(`inbox-sms/${sellerId}/${senderKey}/${text}`, 'utf8').digest('base64url')
    if (await smsSeenNear(db, sellerId, sig, new Date(receivedMs - INBOX_SAME_SMS_MS), new Date(receivedMs + INBOX_SAME_SMS_MS))) return 'DUPLICATE'
    // 같은 문자 표지는 실제로 받아 처리한(SAVED) 뒤에만 남긴다 — 방송 창 밖·찜 아님으로 무시한 문자, 저장이 실패한 문자가
    // 60초 안의 다음 문자(새 id)를 DUPLICATE로 먹지 않게 (AC-SMS3-13 방송 없음이면 아무것도 저장되지 않음)
    const status = await this.#smsBody(sellerId, message, text, receivedMs, now, phone)
    if (status === 'SAVED') await insertSmsSeen(db, sellerId, sig, new Date(receivedMs), now)
    return status
  }

  async #smsBody(sellerId: string, message: InboxMessageInput, text: string, receivedMs: number, now: Date, phone: string | null): Promise<InboxStatus> {
    const { db } = this.#deps
    const nowMs = now.getTime()
    // 방송 창 (D-SMS3-07): 끝나지 않은 실제 방송, 없으면 끝난 지 10분 안의 실제 방송
    const broadcast = await windowBroadcast(db, sellerId, new Date(nowMs - INBOX_AFTER_END_MS))
    if (broadcast === null) return 'IGNORED'
    const runtime = await this.#deps.writer.read(sellerId, broadcast.date, false)
    const settings = getBroadcast(runtime.state, broadcast.id)?.settings
    const result: SmsTextResult = parseSmsText(
      { from: message.from, text },
      settings === undefined ? {} : { parseMode: settings['claim.parseMode'], multiNumber: settings['claim.multiNumber'], maxNumber: settings['claim.maxNumber'] },
    )
    const rawMemo = (result as { readonly memo?: unknown }).memo
    const memo = typeof rawMemo === 'string' ? rawMemo : null
    const card = async (kind: 'REVIEW' | 'CANCEL', why: CardWhy | null, numbers: readonly number[]) => {
      const sealed: Sealed = { text, phone, sender: phone === null ? displaySender(message.from) : null }
      await insertCard(db, {
        id: `ic_${randomUUID()}`,
        sellerId,
        broadcastId: broadcast.id,
        kind,
        why,
        numbers,
        memo,
        last4: phone === null ? null : phone.slice(-4),
        sealed: sealSellerText(this.#deps.masterKey, SEAL_PURPOSE, sellerId, JSON.stringify(sealed)),
        receivedAt: new Date(receivedMs),
        now,
      })
    }
    if ('claims' in result && Array.isArray(result.claims)) {
      let carded = false
      for (const no of result.claims) {
        const outcome = await this.#deps.service.writeInboxSms(sellerId, { kind: 'server' }, {
          b: broadcast.id,
          requestId: `inbox-${idPart(message.id)}-${String(no)}`,
          no,
          receivedMs,
          memo,
          phone,
          checkOnSale: true,
        })
        if (outcome.kind === 'ok' || outcome.kind === 'duplicate') continue
        if (outcome.kind === 'rejected') {
          // 판매 중이 아님 → 확인 필요 NOT_ON_SALE. 그 밖의 거절(엔진 입력 검사 등)도 버리지 않고 판매자가 보게 확인 필요로 둔다
          await card('REVIEW', outcome.rejection.code === 'NOT_ON_SALE' ? 'NOT_ON_SALE' : 'UNCLEAR', [no])
          carded = true
          continue
        }
        // 저장 실패 — 다시 보내면 같은 요청 번호로 한 번만 들어간다(받은 id로 표시하지 않게 오류로 올린다)
        throw new InboxSaveError()
      }
      if (carded) this.#deps.publish(sellerId, { kind: 'cards', b: broadcast.id })
      return 'SAVED'
    }
    if ('cancels' in result && Array.isArray(result.cancels)) {
      for (const no of result.cancels) await card('CANCEL', null, [no])
      this.#deps.publish(sellerId, { kind: 'cards', b: broadcast.id })
      return 'SAVED'
    }
    if ('review' in result && Array.isArray(result.review)) {
      await card('REVIEW', result.why as CardWhy, result.review)
      this.#deps.publish(sellerId, { kind: 'cards', b: broadcast.id })
      return 'SAVED'
    }
    return 'IGNORED'
  }

  // ── 문자 확인 카드 ─────────────────────────────────────────────────────

  /** 처리 안 한 카드 지우기 (방송이 끝나고 24시간 — C-07) */
  async purge(sellerId: string): Promise<void> {
    const removed = await purgeCards(this.#deps.db, sellerId, new Date(this.#now() - INBOX_CARD_KEEP_MS))
    for (const b of removed) this.#deps.publish(sellerId, { kind: 'cards', b })
  }

  #open(sellerId: string, row: CardRow): Sealed | null {
    if (row.sealed === null) return null
    try {
      const value = JSON.parse(openSellerText(this.#deps.masterKey, SEAL_PURPOSE, sellerId, row.sealed)) as Sealed
      return { text: typeof value.text === 'string' ? value.text : '', phone: typeof value.phone === 'string' ? value.phone : null, sender: typeof value.sender === 'string' ? value.sender : null }
    } catch (error) {
      this.#deps.log({ level: 'warn', code: 'INBOX_CARD_UNREADABLE', errorKind: errorKind(error) })
      return null
    }
  }

  #cardView(sellerId: string, row: CardRow): CardView {
    const sealed = this.#open(sellerId, row)
    const numbers = (JSON.parse(row.numbers) as unknown[]).filter((value): value is number => typeof value === 'number')
    const first = String(numbers[0] ?? '')
    const message = row.kind === 'CANCEL' ? INBOX_MESSAGES.CANCEL.replace('{no}', first) : row.why === 'NOT_ON_SALE' ? INBOX_MESSAGES.NOT_ON_SALE.replace('{no}', first) : INBOX_MESSAGES[row.why ?? 'UNCLEAR']
    return {
      id: row.id,
      b: row.broadcastId,
      kind: row.kind,
      why: row.why,
      numbers,
      memo: row.memo,
      last4: row.last4,
      sender: sealed?.sender ?? null,
      text: sealed?.text ?? '',
      receivedAt: row.receivedAt.toISOString(),
      message,
      canApprove: row.kind === 'CANCEL' && row.last4 !== null,
    }
  }

  /**
   * 그 방송의 처리 안 한 카드 (받은 순서) + 휴대폰 알림으로 넣은 찜 ID("문자로 받음" 표시 — ref가 ibx_인 sms 이벤트가 만든 찜, 코어 listClaims의 seq로 맞춘다)
   * + 방송 시작 시각(받기 멈춤 알림 — 방송 행을 만든 시각, 모르면 null)
   */
  async cards(sellerId: string, broadcastId: string): Promise<{ cards: CardView[]; inboxClaimIds: string[]; startedAt: string | null }> {
    await this.purge(sellerId)
    const rows = await openCards(this.#deps.db, sellerId, broadcastId)
    const start = await broadcastStart(this.#deps.db, sellerId, broadcastId)
    let inboxClaimIds: string[] = []
    if (start !== null && !start.rehearsal) {
      const seqs = await inboxSmsSeqs(this.#deps.db, sellerId, start.date)
      if (seqs.size > 0) {
        const state = (await this.#deps.writer.read(sellerId, start.date, false)).state
        inboxClaimIds = listClaims(state)
          .filter((claim) => claim.origin === 'sms' && claim.broadcast === broadcastId && seqs.has(claim.seq))
          .map((claim) => claim.id)
      }
    }
    return { cards: rows.map((row) => this.#cardView(sellerId, row)), inboxClaimIds, startedAt: start?.startedAt.toISOString() ?? null }
  }

  async #openCard(sellerId: string, id: string, kind: 'REVIEW' | 'CANCEL'): Promise<InboxOutcome<CardRow>> {
    await this.purge(sellerId)
    const row = await findCard(this.#deps.db, sellerId, id)
    if (row === null) return fail(404, 'NOT_FOUND', '찾을 수 없어요.')
    if (row.status !== 'OPEN' && row.status !== 'BUSY') return fail(409, 'CARD_DONE', INBOX_MESSAGES.cardDone)
    if (row.kind !== kind) return fail(400, 'INVALID_INPUT', kind === 'CANCEL' ? INBOX_MESSAGES.notCancel : INBOX_MESSAGES.notReview)
    return { ok: true, value: row }
  }

  /**
   * 카드를 잡고(조건부 UPDATE OPEN → BUSY, 바뀐 행 1일 때만) 기록한다 — 판매자·보조자가 동시에 눌러도 한 요청만 엔진에 적는다.
   * 다른 요청이 잡았으면 409 CARD_DONE. 기록이 거절·실패하면 카드를 놓아 처리 안 한 채로 남긴다
   */
  async #withCard<T>(sellerId: string, row: CardRow, task: () => Promise<InboxOutcome<T>>): Promise<InboxOutcome<T>> {
    const claimedAt = new Date(this.#now())
    if (!(await claimCard(this.#deps.db, sellerId, row.id, claimedAt))) return fail(409, 'CARD_DONE', INBOX_MESSAGES.cardDone)
    let done: InboxOutcome<T>
    try {
      done = await task()
    } catch (error) {
      await releaseCard(this.#deps.db, sellerId, row.id, claimedAt)
      throw error
    }
    if (!done.ok) await releaseCard(this.#deps.db, sellerId, row.id, claimedAt)
    return done
  }

  /**
   * 확인 필요 카드 "넣기": 판매자가 고른 번호로 지금의 문자찜과 같은 sms 이벤트(보낸 번호 → R-11 구매자, 이름만 온 문자는 메모 = 보낸 이름의 새 문자 구매자).
   * 옵션 방송은 extra(qty·options)를 지금 옵션 문자찜 입력과 같이 넘긴다. 판매 중이 아니면 409 NOT_ON_SALE(카드는 남는다)
   */
  async insert(sellerId: string, actor: Actor, id: string, input: { requestId: string; no: number; extra: Readonly<Record<string, unknown>> }): Promise<InboxOutcome<{ result: WriteResult; card: string }>> {
    const opened = await this.#openCard(sellerId, id, 'REVIEW')
    if (!opened.ok) return opened
    const row = opened.value
    const sealed = this.#open(sellerId, row)
    const phone = sealed?.phone ?? null
    const memo = phone === null ? (sealed?.sender ?? row.memo) : row.memo
    const done = await this.#withCard(sellerId, row, async () => {
      const outcome = await this.#deps.service.writeInboxSms(sellerId, actor, {
        b: row.broadcastId,
        requestId: input.requestId,
        no: input.no,
        receivedMs: row.receivedAt.getTime(),
        memo: memo === null ? null : cut(memo.trim(), 40),
        phone,
        checkOnSale: true,
        extra: input.extra,
      })
      return this.#written(sellerId, row, outcome)
    })
    if (!done.ok) return done
    return { ok: true, value: { result: done.value, card: row.id } }
  }

  /** 취소 요청 카드 "승인": 그 번호의 문자 구매자의 그 번호 찜을 방송자 취소(엔진 승계 R-8 그대로). 찜이 없으면 409 NO_CLAIM, 기록 없음 */
  async approve(sellerId: string, actor: Actor, id: string, requestId: string): Promise<InboxOutcome<{ result: WriteResult; card: string }>> {
    const opened = await this.#openCard(sellerId, id, 'CANCEL')
    if (!opened.ok) return opened
    const row = opened.value
    // 이름만 온 문자의 취소 요청은 승인하지 않는다 — 누가 보냈는지 모른다(D-SMS3-19). 엔진 기록 없음, 카드는 무시로 닫는다
    if (row.last4 === null) return fail(409, 'NAME_ONLY', INBOX_MESSAGES.nameOnlyCancel)
    const no = (JSON.parse(row.numbers) as number[])[0]
    const sealed = this.#open(sellerId, row)
    const broadcast = await realBroadcast(this.#deps.db, sellerId, row.broadcastId)
    if (broadcast === null || typeof no !== 'number' || sealed === null) return fail(409, 'NO_CLAIM', INBOX_MESSAGES.noClaim)
    if (sealed.phone === null) return fail(409, 'NAME_ONLY', INBOX_MESSAGES.nameOnlyCancel)
    const phone = sealed.phone
    const done = await this.#withCard(sellerId, row, async () => this.#approveWrite(sellerId, actor, row, broadcast.date, no, phone, requestId))
    if (!done.ok) return done
    return { ok: true, value: { result: done.value, card: row.id } }
  }

  async #approveWrite(sellerId: string, actor: Actor, row: CardRow, date: string, no: number, phone: string, requestId: string): Promise<InboxOutcome<WriteResult>> {
    const refs = await smsRefsOfPhoneKey(this.#deps.db, sellerId, date, await this.#deps.service.phoneKeyFor(sellerId, phone))
    const outcome = await this.#deps.writer.write({
      sellerId,
      date,
      rehearsal: false,
      createScope: false,
      requestId,
      build: (ctx) => {
        for (const ref of refs) {
          const buyer = buyerOfRef(ctx.state, ref)
          if (buyer === null) continue
          const root = currentBuyerOf(ctx.state, buyer) ?? buyer
          if (activeClaimId(ctx.state, row.broadcastId, no, root) === null) continue
          return [{ fields: { type: 'host.cancel', b: row.broadcastId, no, buyer: root, reason: '문자 취소 요청 승인' }, actor, requestId }]
        }
        return { status: 409, code: 'NO_CLAIM', message: INBOX_MESSAGES.noClaim, problems: [] }
      },
    })
    return this.#written(sellerId, row, outcome)
  }

  /** 카드 "무시": 기록 없음, 본문을 지우고 카드가 사라진다 */
  async ignore(sellerId: string, id: string): Promise<InboxOutcome<{ card: string }>> {
    await this.purge(sellerId)
    const row = await findCard(this.#deps.db, sellerId, id)
    if (row === null) return fail(404, 'NOT_FOUND', '찾을 수 없어요.')
    // 넣기·승인과 같이 카드를 먼저 잡는다 — 처리 중인 카드를 무시로 닫지 않는다
    if (!(await claimCard(this.#deps.db, sellerId, id, new Date(this.#now())))) return fail(409, 'CARD_DONE', INBOX_MESSAGES.cardDone)
    if (!(await finishCard(this.#deps.db, sellerId, id, 'IGNORED', new Date(this.#now()), 'BUSY'))) return fail(409, 'CARD_DONE', INBOX_MESSAGES.cardDone)
    this.#deps.publish(sellerId, { kind: 'cards', b: row.broadcastId })
    return { ok: true, value: { card: id } }
  }

  /** 엔진 기록 결과 → 카드 처리 (기록했거나 같은 요청 번호의 처음 결과면 카드를 닫고 본문을 지운다) */
  async #written(sellerId: string, row: CardRow, outcome: WriteOutcome): Promise<InboxOutcome<WriteResult>> {
    switch (outcome.kind) {
      case 'ok':
      case 'duplicate': {
        const result = outcome.result
        if (result === null) return fail(409, 'REQUEST_ERROR', '이미 받은 입력이에요.')
        await finishCard(this.#deps.db, sellerId, row.id, 'DONE', new Date(this.#now()), 'BUSY')
        this.#deps.publish(sellerId, { kind: 'cards', b: row.broadcastId })
        return { ok: true, value: result }
      }
      case 'rejected':
        return { ok: false, status: outcome.rejection.status, code: outcome.rejection.code, message: outcome.rejection.message, ...(outcome.rejection.extra === undefined ? {} : { extra: outcome.rejection.extra }) }
      case 'not_found':
        return fail(404, 'NOT_FOUND', '찾을 수 없어요.')
      default:
        return fail(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
    }
  }
}

/** 저장 실패 (요청 전체를 500으로 — 기기가 같은 id로 다시 보낸다) */
export class InboxSaveError extends Error {
  constructor() {
    super('inbox save failed')
    this.name = 'InboxSaveError'
  }
}

/** 엔진 요청 번호의 id 칸: id가 영문·숫자·_·-이고 휴대폰 번호 모양을 담지 않으면 그대로, 아니면 해시 (요청 번호 64자 안) */
function idPart(id: string): string {
  if (/^[A-Za-z0-9_-]{1,40}$/.test(id) && !containsPhoneRun(id)) return id
  return `h${sha256Hex(`inbox-req/${id}`).slice(0, 39)}`
}
