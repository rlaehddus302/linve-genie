// 영수증 문자 (D-REAL-03 → D-REAL-05): 우리 서버는 보내지 않는다. 받는 번호·보낼 글(확인서 링크)을 판매자 앱에 주면
// 앱이 판매자 휴대폰 문자 앱을 채워 열고, 판매자가 보내기를 누르면 판매자 번호로 간다(답장·전화가 판매자에게). 보냈다는 표시만 따로 받는다.
// - 번호: 문자찜 손님은 문자찜이 올 때 번호를 판매자 키로 암호화해 기억한다(key = 엔진 전화번호 키 — 날짜를 넘어 같다).
//   번호를 모르는 손님(유튜브·틱톡 등)은 판매자가 넣은 번호로 보내고 `d:<날짜>:<구매자 ID>`로 기억한다. 원문은 로그·응답에 없다(끝 4자리만).
// - 보내는 글: "[가게 이름] 주문 확인서예요" + 그 손님의 확인서 링크(없으면 만든다 — 14일, receipt-links.ts). 링크 하나만 담는다.
// - 보냄 표시는 요청 번호로 한 번만(같은 번호면 처음 결과). 판매자 요금제로 나가므로 우리 쪽 발송 상한은 없다.
// - 리허설 범위·봉인 날짜·품목 없는 묶음은 보내지 않는다(링크 만들기와 같은 규칙). 보조자는 쓸 수 없다(경로에서 막는다).
import { createHash } from 'node:crypto'
import { buyerPhoneKeys, isValidDate, normalizePhone, type EngineState } from '@livejjim/core'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import type { ApiProblem, Outcome } from './closing.ts'
import type { Db } from './db/database.ts'
import { buyerPhones, receiptSmsSends } from './db/schema.ts'
import { errorKind, type LogSink } from './log.ts'
import { linkableBuyer, type ReceiptLinkService } from './receipt-links.ts'
import { openSellerText, sealSellerText } from './secrets.ts'
import { readShop } from './shop.ts'
import type { Clock } from './time.ts'
import type { ScopeWriter } from './writer.ts'

export const PHONE_KEEP_MS = 365 * 24 * 60 * 60 * 1000
const PHONE_PURPOSE = 'buyer-phone'

export const RECEIPT_SMS_MESSAGES = {
  rehearsal: '리허설 방송은 문자를 보내지 않아요.',
  noItems: '확인서를 만들 상품이 없어요.',
  noPhone: '이 손님의 휴대폰 번호를 몰라요. 번호를 넣어 주세요.',
  badPhone: '휴대폰 번호를 010으로 시작하는 숫자로 적어 주세요.',
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
  readonly log: LogSink
}

/** 구매자 줄에 붙는 문자 상태 */
export interface ReceiptSmsView {
  /** 아는 번호의 끝 4자리 (모르면 null) */
  readonly last4: string | null
  /** 마지막으로 보낸 시각 (ISO, 보낸 적 없으면 null) */
  readonly sentAt: string | null
}

/** 판매자 문자 앱에 채울 것 (번호 원문은 이 응답에만 — 로그·DB에는 없다) */
export interface ReceiptSmsDraft {
  readonly buyer: string
  readonly phone: string
  readonly last4: string
  readonly text: string
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

  /**
   * 봉인 직전: 문자찜 번호(전화번호 키)를 그 손님 키(`d:<날짜>:<구매자>`)로도 옮겨 둔다 — 봉인 상태에는 전화번호 키가 없어 봉인 뒤에도
   * 같은 번호로 보내고 줄에 끝자리를 보이게(봉인 직전과 같게). 판매자가 넣은 번호가 이미 있으면 그대로, 옮긴 행은 원래 시각을 지킨다
   */
  async pinBeforeSeal(tx: Db, sellerId: string, date: string, state: EngineState, buyers: readonly string[]): Promise<void> {
    for (const buyer of buyers) {
      const keys = buyerPhoneKeys(state, buyer)
      if (keys.length === 0) continue
      const rows = await tx
        .select({ key: buyerPhones.key, phoneEnc: buyerPhones.phoneEnc, last4: buyerPhones.last4, updatedAt: buyerPhones.updatedAt })
        .from(buyerPhones)
        .where(and(eq(buyerPhones.sellerId, sellerId), inArray(buyerPhones.key, [manualPhoneKey(date, buyer), ...keys])))
      if (rows.some((row) => row.key === manualPhoneKey(date, buyer))) continue
      const latest = [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
      if (latest === undefined) continue
      await tx
        .insert(buyerPhones)
        .values({ sellerId, key: manualPhoneKey(date, buyer), phoneEnc: latest.phoneEnc, last4: latest.last4, updatedAt: latest.updatedAt })
        .onConflictDoNothing({ target: [buyerPhones.sellerId, buyerPhones.key] })
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
   * 한 손님에게 보낼 문자 준비: 받는 번호(phone이 있으면 그 번호를 기억하고 쓴다, 없으면 아는 번호)와 글(확인서 링크 — 없으면 만든다).
   * 같은 요청 번호면 같은 링크
   */
  async prepare(sellerId: string, accountId: string, date: string, rehearsal: boolean, requestId: string, buyer: string, phone: string | null): Promise<Outcome<ReceiptSmsDraft>> {
    const deps = this.#deps
    if (rehearsal) return problem(409, 'REHEARSAL_RECEIPT_LINK', RECEIPT_SMS_MESSAGES.rehearsal)
    if (!isValidDate(date)) return { kind: 'not_found' }
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
    // 확인서 링크: 쓸 수 있는 링크가 있으면 그것, 없으면 새로 (링크 요청 번호는 이 요청 번호에서 나눈다 — 다시 눌러도 같은 링크)
    const linkRequest = `sms_${createHash('sha256').update(requestId, 'utf8').digest('base64url').slice(0, 40)}`
    const link = await deps.links.create(sellerId, accountId, date, false, linkRequest, buyer)
    if (link.kind !== 'ok') return link
    const url = link.value.link.url
    if (url === null) return problem(409, 'NO_ITEMS', RECEIPT_SMS_MESSAGES.linkFailed)
    const shop = await readShop(deps.db, sellerId)
    return { kind: 'ok', value: { buyer, phone: known.phone, last4: known.last4, text: receiptSmsText(shop.name, url) } }
  }

  /** 판매자 문자 앱에서 보냈다는 표시 (같은 요청 번호면 처음 결과) */
  async markSent(sellerId: string, accountId: string, date: string, rehearsal: boolean, requestId: string, buyer: string): Promise<Outcome<ReceiptSmsResult>> {
    const deps = this.#deps
    if (rehearsal) return problem(409, 'REHEARSAL_RECEIPT_LINK', RECEIPT_SMS_MESSAGES.rehearsal)
    if (!isValidDate(date)) return { kind: 'not_found' }
    const prior = await deps.db
      .select({ date: receiptSmsSends.date, buyer: receiptSmsSends.buyer, last4: receiptSmsSends.last4, sentAt: receiptSmsSends.sentAt })
      .from(receiptSmsSends)
      .where(and(eq(receiptSmsSends.sellerId, sellerId), eq(receiptSmsSends.requestId, requestId)))
      .limit(1)
    const first = prior[0]
    if (first !== undefined) {
      if (first.date !== date || first.buyer !== buyer) return problem(409, 'REQUEST_ERROR', RECEIPT_SMS_MESSAGES.request)
      return { kind: 'ok', value: { buyer, last4: first.last4, sentAt: first.sentAt.toISOString() } }
    }
    const runtime = await deps.writer.read(sellerId, date, false)
    if (runtime.seq === 0) return { kind: 'not_found' }
    const known = await this.#phoneOf(sellerId, this.#keysOf(runtime.state, date, buyer))
    if (known === null) return problem(409, 'NO_PHONE', RECEIPT_SMS_MESSAGES.noPhone)
    const sentAt = new Date(deps.clock.now())
    await deps.db
      .insert(receiptSmsSends)
      .values({ sellerId, requestId, date, buyer, last4: known.last4, ok: true, sentAt, sentBy: accountId })
      .onConflictDoNothing({ target: [receiptSmsSends.sellerId, receiptSmsSends.requestId] })
    deps.log({ level: 'info', code: 'RECEIPT_SMS_SENT', seller: sellerId, date })
    return { kind: 'ok', value: { buyer, last4: known.last4, sentAt: sentAt.toISOString() } }
  }
}
