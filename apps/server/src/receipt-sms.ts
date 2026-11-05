// 영수증 문자 보내기 (D-REAL-03 — RCP-02 "구매자에게 보낼 공유 링크"를 우리가 문자로 보낸다).
// - 번호: 문자찜 손님은 문자찜이 올 때 번호를 판매자 키로 암호화해 기억한다(key = 엔진 전화번호 키 — 날짜를 넘어 같다).
//   번호를 모르는 손님(유튜브·틱톡 등)은 판매자가 넣은 번호로 보내고 `d:<날짜>:<구매자 ID>`로 기억한다. 원문은 로그·응답에 없다(끝 4자리만).
// - 보내는 글: "[가게 이름] 주문 확인서예요" + 그 손님의 확인서 링크(없으면 만든다 — 14일, receipt-links.ts). 링크 하나만 담는다.
// - 요청 번호로 한 번만(같은 번호면 처음 결과). 같은 손님에게 1분 안에 다시 보내지 않고, 판매자마다 24시간 500통까지.
// - 리허설 범위·봉인 날짜·품목 없는 묶음은 보내지 않는다(링크 만들기와 같은 규칙). 보조자는 쓸 수 없다(경로에서 막는다).
import { createHash } from 'node:crypto'
import { buyerPhoneKeys, isValidDate, normalizePhone } from '@livejjim/core'
import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm'
import type { ApiProblem, Outcome } from './closing.ts'
import type { Db } from './db/database.ts'
import { buyerPhones, receiptSmsSends } from './db/schema.ts'
import { errorKind, type LogSink } from './log.ts'
import { linkableBuyer, type ReceiptLinkService } from './receipt-links.ts'
import { openSellerText, sealSellerText } from './secrets.ts'
import { readShop } from './shop.ts'
import type { Clock } from './time.ts'
import type { ScopeWriter } from './writer.ts'

/** 문자 한 통 보내기 (솔라피 — social/phone.ts의 SmsSender와 같은 모양). 접수되지 않으면 던진다 */
export interface ReceiptSmsSender {
  send(to: string, text: string): Promise<void>
}

export const RESEND_GAP_MS = 60 * 1000
export const SELLER_DAY_MAX = 500
export const PHONE_KEEP_MS = 365 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const PHONE_PURPOSE = 'buyer-phone'

export const RECEIPT_SMS_MESSAGES = {
  off: '문자 보내기가 아직 준비되지 않았어요. 링크를 복사해 보내 주세요.',
  rehearsal: '리허설 방송은 문자를 보내지 않아요.',
  noItems: '확인서를 만들 상품이 없어요.',
  noPhone: '이 손님의 휴대폰 번호를 몰라요. 번호를 넣어 주세요.',
  badPhone: '휴대폰 번호를 010으로 시작하는 숫자로 적어 주세요.',
  tooSoon: '방금 보냈어요. 1분 뒤에 다시 보낼 수 있어요.',
  dayMax: `오늘은 문자를 ${String(SELLER_DAY_MAX)}통 보냈어요. 내일 다시 보내거나 링크를 복사해 보내 주세요.`,
  failed: '문자를 보내지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  linkFailed: '확인서 링크를 만들지 못했어요. 다시 눌러 주세요.',
  request: '이미 받은 입력이에요.',
} as const

/** 보내는 글 (링크 하나, 짧게 — 90바이트 안이면 단문) */
export function receiptSmsText(shopName: string, url: string): string {
  const shop = shopName.trim().replace(/[\r\n]+/g, ' ').slice(0, 20)
  return `${shop === '' ? '' : `[${shop}] `}주문 확인서예요.\n${url}`
}

/** 판매자가 넣은 번호의 기억 키 */
export const manualPhoneKey = (date: string, buyer: string): string => `d:${date}:${buyer}`

export interface ReceiptSmsDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly masterKey: Buffer
  readonly links: ReceiptLinkService
  /** 없으면 문자 보내기를 끈다 (솔라피 키·보내는 번호가 없는 서버) */
  readonly sender: ReceiptSmsSender | null
  readonly log: LogSink
}

/** 구매자 줄에 붙는 문자 상태 */
export interface ReceiptSmsView {
  /** 아는 번호의 끝 4자리 (모르면 null) */
  readonly last4: string | null
  /** 마지막으로 보낸 시각 (ISO, 보낸 적 없으면 null) */
  readonly sentAt: string | null
}

export interface ReceiptSmsResult {
  readonly buyer: string
  readonly last4: string
  readonly sentAt: string
}

const problem = (status: number, code: ApiProblem['code'], message: string): { kind: 'error'; error: ApiProblem } => ({ kind: 'error', error: { status, code, message } })

export class ReceiptSmsService {
  readonly #deps: ReceiptSmsDeps

  constructor(deps: ReceiptSmsDeps) {
    this.#deps = deps
  }

  get available(): boolean {
    return this.#deps.sender !== null
  }

  /** 번호 기억 (문자찜이 올 때·판매자가 넣을 때). 실패해도 문자찜은 그대로 — 로그만 */
  async remember(sellerId: string, key: string, phone: string): Promise<void> {
    const normalized = normalizePhone(phone)
    if (normalized === null) return
    const now = new Date(this.#deps.clock.now())
    try {
      const phoneEnc = sealSellerText(this.#deps.masterKey, PHONE_PURPOSE, sellerId, normalized)
      await this.#deps.db
        .insert(buyerPhones)
        .values({ sellerId, key, phoneEnc, last4: normalized.slice(-4), updatedAt: now })
        .onConflictDoUpdate({ target: [buyerPhones.sellerId, buyerPhones.key], set: { phoneEnc, last4: normalized.slice(-4), updatedAt: now } })
    } catch (error) {
      this.#deps.log({ level: 'warn', code: 'BUYER_PHONE_SAVE_FAILED', seller: sellerId, errorKind: errorKind(error) })
    }
  }

  /** 1년 넘게 쓰지 않은 번호 지우기 (하루 한 번 청소에서) */
  async sweep(): Promise<number> {
    const before = new Date(this.#deps.clock.now() - PHONE_KEEP_MS)
    const rows = await this.#deps.db.delete(buyerPhones).where(lt(buyerPhones.updatedAt, before)).returning({ key: buyerPhones.key })
    return rows.length
  }

  /** 그 날짜 구매자들의 번호 키 목록 (가장 최근에 넣은 것이 앞) */
  #keysOf(state: Parameters<typeof buyerPhoneKeys>[0], date: string, buyer: string): string[] {
    return [manualPhoneKey(date, buyer), ...buyerPhoneKeys(state, buyer)]
  }

  /** 아는 번호 하나 (가장 최근에 넣은 것) — 없으면 null */
  async #phoneOf(sellerId: string, keys: readonly string[]): Promise<{ readonly phone: string; readonly last4: string } | null> {
    if (keys.length === 0) return null
    const rows = await this.#deps.db
      .select({ phoneEnc: buyerPhones.phoneEnc, last4: buyerPhones.last4 })
      .from(buyerPhones)
      .where(and(eq(buyerPhones.sellerId, sellerId), inArray(buyerPhones.key, [...keys])))
      .orderBy(desc(buyerPhones.updatedAt))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return { phone: openSellerText(this.#deps.masterKey, PHONE_PURPOSE, sellerId, row.phoneEnc), last4: row.last4 }
  }

  /** 구매자 줄의 문자 상태 (리허설·없는 범위는 빈 맵) */
  async statuses(sellerId: string, date: string, buyers: readonly string[]): Promise<Map<string, ReceiptSmsView>> {
    const result = new Map<string, ReceiptSmsView>()
    if (!isValidDate(date) || buyers.length === 0) return result
    const runtime = await this.#deps.writer.read(sellerId, date, false)
    if (runtime.seq === 0) return result
    const keysByBuyer = new Map(buyers.map((buyer) => [buyer, this.#keysOf(runtime.state, date, buyer)]))
    const allKeys = [...new Set([...keysByBuyer.values()].flat())]
    const phoneRows =
      allKeys.length === 0
        ? []
        : await this.#deps.db
            .select({ key: buyerPhones.key, last4: buyerPhones.last4, updatedAt: buyerPhones.updatedAt })
            .from(buyerPhones)
            .where(and(eq(buyerPhones.sellerId, sellerId), inArray(buyerPhones.key, allKeys)))
    const sendRows = await this.#deps.db
      .select({ buyer: receiptSmsSends.buyer, sentAt: receiptSmsSends.sentAt })
      .from(receiptSmsSends)
      .where(and(eq(receiptSmsSends.sellerId, sellerId), eq(receiptSmsSends.date, date), eq(receiptSmsSends.ok, true)))
    for (const buyer of buyers) {
      const keys = new Set(keysByBuyer.get(buyer))
      const phone = phoneRows.filter((row) => keys.has(row.key)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
      const sent = sendRows.filter((row) => row.buyer === buyer).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0]
      result.set(buyer, { last4: phone?.last4 ?? null, sentAt: sent?.sentAt.toISOString() ?? null })
    }
    return result
  }

  /**
   * 한 손님에게 확인서 문자 보내기. phone이 있으면 그 번호로 보내고 기억한다(판매자가 넣은 번호), 없으면 아는 번호로.
   * 같은 요청 번호면 처음 결과(보내지 않음)
   */
  async send(sellerId: string, accountId: string, date: string, rehearsal: boolean, requestId: string, buyer: string, phone: string | null): Promise<Outcome<ReceiptSmsResult>> {
    const deps = this.#deps
    if (deps.sender === null) return problem(503, 'UNAVAILABLE', RECEIPT_SMS_MESSAGES.off)
    if (rehearsal) return problem(409, 'REHEARSAL_RECEIPT_LINK', RECEIPT_SMS_MESSAGES.rehearsal)
    if (!isValidDate(date)) return { kind: 'not_found' }
    const prior = await deps.db
      .select({ date: receiptSmsSends.date, buyer: receiptSmsSends.buyer, last4: receiptSmsSends.last4, ok: receiptSmsSends.ok, sentAt: receiptSmsSends.sentAt })
      .from(receiptSmsSends)
      .where(and(eq(receiptSmsSends.sellerId, sellerId), eq(receiptSmsSends.requestId, requestId)))
      .limit(1)
    const first = prior[0]
    if (first !== undefined) {
      if (first.date !== date || first.buyer !== buyer) return problem(409, 'REQUEST_ERROR', RECEIPT_SMS_MESSAGES.request)
      if (!first.ok) return problem(502, 'SMS_FAILED', RECEIPT_SMS_MESSAGES.failed)
      return { kind: 'ok', value: { buyer, last4: first.last4, sentAt: first.sentAt.toISOString() } }
    }
    let typed: string | null = null
    if (phone !== null) {
      typed = normalizePhone(phone)
      if (typed === null) return problem(400, 'BAD_REQUEST', RECEIPT_SMS_MESSAGES.badPhone)
    }
    const runtime = await deps.writer.read(sellerId, date, false)
    if (runtime.seq === 0) return { kind: 'not_found' }
    if (!linkableBuyer(runtime.state, date, buyer)) return problem(409, 'NO_ITEMS', RECEIPT_SMS_MESSAGES.noItems)
    if (typed !== null) await this.remember(sellerId, manualPhoneKey(date, buyer), typed)
    const known = typed !== null ? { phone: typed, last4: typed.slice(-4) } : await this.#phoneOf(sellerId, this.#keysOf(runtime.state, date, buyer))
    if (known === null) return problem(409, 'NO_PHONE', RECEIPT_SMS_MESSAGES.noPhone)
    const now = deps.clock.now()
    const recent = await deps.db
      .select({ id: receiptSmsSends.id })
      .from(receiptSmsSends)
      .where(and(eq(receiptSmsSends.sellerId, sellerId), eq(receiptSmsSends.date, date), eq(receiptSmsSends.buyer, buyer), eq(receiptSmsSends.ok, true), gt(receiptSmsSends.sentAt, new Date(now - RESEND_GAP_MS))))
      .limit(1)
    if (recent.length > 0) return problem(429, 'TOO_MANY', RECEIPT_SMS_MESSAGES.tooSoon)
    const today = await deps.db
      .select({ id: receiptSmsSends.id })
      .from(receiptSmsSends)
      .where(and(eq(receiptSmsSends.sellerId, sellerId), gt(receiptSmsSends.sentAt, new Date(now - DAY_MS))))
      .limit(SELLER_DAY_MAX)
    if (today.length >= SELLER_DAY_MAX) return problem(429, 'TOO_MANY', RECEIPT_SMS_MESSAGES.dayMax)
    // 확인서 링크: 쓸 수 있는 링크가 있으면 그것, 없으면 새로 (링크 요청 번호는 이 요청 번호에서 나눈다 — 다시 눌러도 같은 링크)
    const linkRequest = `sms_${createHash('sha256').update(requestId, 'utf8').digest('base64url').slice(0, 40)}`
    const link = await deps.links.create(sellerId, accountId, date, false, linkRequest, buyer)
    if (link.kind !== 'ok') return link
    const url = link.value.link.url
    if (url === null) return problem(409, 'NO_ITEMS', RECEIPT_SMS_MESSAGES.linkFailed)
    const shop = await readShop(deps.db, sellerId)
    let ok = true
    try {
      await deps.sender.send(known.phone, receiptSmsText(shop.name, url))
    } catch (error) {
      ok = false
      deps.log({ level: 'warn', code: 'RECEIPT_SMS_FAILED', seller: sellerId, date, errorKind: errorKind(error) })
    }
    const sentAt = new Date(deps.clock.now())
    await deps.db
      .insert(receiptSmsSends)
      .values({ sellerId, requestId, date, buyer, last4: known.last4, ok, sentAt, sentBy: accountId })
      .onConflictDoNothing({ target: [receiptSmsSends.sellerId, receiptSmsSends.requestId] })
    if (!ok) return problem(502, 'SMS_FAILED', RECEIPT_SMS_MESSAGES.failed)
    deps.log({ level: 'info', code: 'RECEIPT_SMS_SENT', seller: sellerId, date })
    return { kind: 'ok', value: { buyer, last4: known.last4, sentAt: sentAt.toISOString() } }
  }
}
