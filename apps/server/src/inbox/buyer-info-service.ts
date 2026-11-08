// 방송 뒤 손님 정보 문자 (ORD-14, D-REAL-11): 손님이 보낸 닉네임·성함·주소 문자를 7일 안 실제 방송의 손님과 맞춰
// 번호(영수증 문자)·배송지("확인 전" 손님 배송지)로 넣는다. 하나로 모이지 않으면 카드로 두고 판매자가 고른다.
// 본문·번호·이름·주소는 판매자 키로 암호화한 sealed에만 두고 받은 지 7일 뒤 카드째 지운다. 로그엔 코드·종류만.
import { randomUUID } from 'node:crypto'
import { buyerPhoneKeys, isValidDate, listSettlements, normalizePhone, type BuyerInfo, type EngineState } from '@livejjim/core'
import { and, desc, eq, gte, gt, inArray, lt, lte } from 'drizzle-orm'
import type { ApiProblem, Outcome } from '../closing.ts'
import type { Db } from '../db/database.ts'
import { buyerInfoCards, scopes } from '../db/schema.ts'
import { buyerLabel, buyersOf, nameCandidates } from '../deposit/bundles.ts'
import { errorKind, type LogSink } from '../log.ts'
import type { ParcelService } from '../parcel/service.ts'
import { ADDRESS_ERROR_FIELD, ADDRESS_ERROR_MESSAGES, readAddress } from '../parcel/rules.ts'
import { manualPhoneKey, type ReceiptSmsService } from '../receipt-sms.ts'
import { openSellerText, sealSellerText } from '../secrets.ts'
import { kstDate, type Clock } from '../time.ts'
import type { ScopeWriter } from '../writer.ts'
import { looksLikeName, matchKey, readBuyerInfo, type BuyerInfoText } from './buyer-info.ts'

const SEAL_PURPOSE = 'buyer-info-card'
const DAY_MS = 24 * 60 * 60 * 1000
/** 맞출 방송 날짜 범위 (받은 날 포함 지난 7일) · 카드 보관 */
export const BUYER_INFO_DAYS = 7
export const BUYER_INFO_KEEP_MS = BUYER_INFO_DAYS * DAY_MS
/** 고를 손님 목록 상한 */
const PICK_MAX = 300

/** 카드에 보이는 문장 (쉬운 말) */
export const BUYER_INFO_MESSAGES = {
  SAVED: '배송지를 넣었어요. 정산에서 배송지를 확인해 주세요.',
  KEPT: '이미 적은 배송지가 있어 배송지는 그대로 뒀어요.',
  REFUSED: '접수했거나 직접 수령·합배송인 손님이라 배송지는 넣지 않았어요.',
  NO_PHONE: '연락처를 몰라 배송지는 넣지 않았어요.',
  NO_MATCH: '어느 손님인지 찾지 못했어요. 손님을 골라 주세요.',
  MANY: '맞는 손님이 여럿이에요. 손님을 골라 주세요.',
  NO_NAME: '받는 분 이름을 읽지 못했어요. 이름을 적어 주세요.',
  INVALID: '받는 분·연락처·주소를 확인해 주세요.',
  notFound: '이 문자를 찾지 못했어요. 화면을 새로고침해 주세요.',
  done: '이미 처리한 문자예요.',
  buyerGone: '그 손님을 찾지 못했어요. 다시 골라 주세요.',
} as const

type Note = 'SAVED' | 'KEPT' | 'REFUSED' | 'NO_PHONE'
type Why = 'NO_MATCH' | 'MANY' | 'NO_NAME' | 'INVALID'

export interface BuyerChoice {
  readonly date: string
  readonly buyer: string
  readonly label: string
}

interface Sealed {
  readonly text: string
  /** 보낸 휴대폰 번호 (이름만 온 문자면 null) */
  readonly sender: string | null
  readonly nickname: string | null
  readonly name: string | null
  /** 연락처 (글 속 번호, 없으면 보낸 번호) */
  readonly phone: string | null
  readonly address: string
  readonly detail: string
  readonly candidates: readonly BuyerChoice[]
  readonly applied: BuyerChoice | null
}

export interface BuyerInfoCardView {
  readonly id: string
  /** OPEN 확인할 것 · APPLIED 넣음 */
  readonly status: 'OPEN' | 'APPLIED'
  readonly auto: boolean
  readonly receivedAt: string
  readonly last4: string | null
  readonly text: string
  readonly nickname: string | null
  readonly name: string | null
  readonly phone: string | null
  readonly address: string
  readonly detail: string
  readonly candidates: readonly BuyerChoice[]
  readonly applied: BuyerChoice | null
  /** 한 줄 안내 (왜 확인해야 하는지·배송지 결과) */
  readonly message: string
}

export interface BuyerInfoDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly masterKey: Buffer
  readonly clock: Clock
  readonly log: LogSink
  readonly receiptSms: ReceiptSmsService
  readonly parcels: ParcelService
  /** 엔진 전화번호 키 (service.phoneKeyFor) */
  readonly phoneKeyFor: (sellerId: string, normalizedPhone: string) => Promise<string>
  readonly publish: (sellerId: string) => void
}

export interface ApplyInput {
  readonly date: string
  readonly buyer: string
  readonly name: string
  readonly phone: string
  readonly address: string
  readonly detail: string
}

interface Candidate extends BuyerChoice {
  readonly byPhone: boolean
  readonly names: readonly string[]
}

const fail = (status: number, code: ApiProblem['code'], message: string, problems: ApiProblem['problems'] = []): Outcome<never> => ({ kind: 'error', error: { status, code, message, problems } })

export class BuyerInfoService {
  readonly #deps: BuyerInfoDeps

  constructor(deps: BuyerInfoDeps) {
    this.#deps = deps
  }

  /** 받은 날 포함 지난 7일의 실제 방송 날짜 (최근 것부터) */
  async #recentDates(sellerId: string, nowMs: number): Promise<string[]> {
    const rows = await this.#deps.db
      .select({ date: scopes.date })
      .from(scopes)
      .where(and(eq(scopes.sellerId, sellerId), eq(scopes.rehearsal, false), gt(scopes.seq, 0), gte(scopes.date, kstDate(nowMs - (BUYER_INFO_DAYS - 1) * DAY_MS)), lte(scopes.date, kstDate(nowMs))))
      .orderBy(desc(scopes.date))
    return rows.map((row) => row.date).filter(isValidDate)
  }

  /** 그 날짜의 품목 있는 손님 (지금의 구매자) */
  static #buyersOf(state: EngineState, date: string): { buyer: string; label: string; names: string[] }[] {
    const infos = new Map<string, BuyerInfo>(buyersOf(state).map((info) => [info.id, info]))
    const out: { buyer: string; label: string; names: string[] }[] = []
    for (const settlement of listSettlements(state)) {
      if (settlement.date !== date || settlement.items.length === 0) continue
      const root = infos.get(settlement.buyer)
      const members = root === undefined ? [settlement.buyer] : [root.id, ...root.merged]
      const label = buyerLabel(state, settlement.buyer)
      const names = [...nameCandidates(infos, members, new Map()), ...(root === undefined ? [] : [root.display]), label]
      out.push({ buyer: settlement.buyer, label, names })
    }
    return out
  }

  /** 맞출 손님 후보: 보낸 번호 또는 닉네임·이름이 같은 손님 (같은 구매자는 가장 최근 날짜 하나) */
  async #match(sellerId: string, info: BuyerInfoText, sender: string | null, nowMs: number): Promise<Candidate[]> {
    const tokens = new Set([info.nickname, info.name, ...info.words].filter((word): word is string => word !== null).map(matchKey).filter((key) => [...key].length >= 2))
    const phoneKey = sender === null ? null : await this.#deps.phoneKeyFor(sellerId, sender)
    const known = sender === null ? new Set<string>() : await this.#deps.receiptSms.keysWith(sellerId, sender)
    const out = new Map<string, Candidate>()
    for (const date of await this.#recentDates(sellerId, nowMs)) {
      const { state } = await this.#deps.writer.read(sellerId, date, false)
      for (const row of BuyerInfoService.#buyersOf(state, date)) {
        if (out.has(row.buyer)) continue
        const keys = buyerPhoneKeys(state, row.buyer)
        const byPhone = (phoneKey !== null && keys.includes(phoneKey)) || [manualPhoneKey(date, row.buyer), ...keys].some((key) => known.has(key))
        const names = row.names.map(matchKey).filter((key) => key !== '')
        const byName = names.some((name) => tokens.has(name))
        if (byPhone || byName) out.set(row.buyer, { date, buyer: row.buyer, label: row.label, byPhone, names })
      }
    }
    return [...out.values()]
  }

  /** 받는 분 이름: 꼬리표로 적은 이름, 없으면 그 손님 닉네임과 다른 한글 이름 모양 조각이 하나일 때 */
  static #nameFor(info: BuyerInfoText, candidate: Candidate | null): string | null {
    if (info.name !== null) return info.name
    const nick = new Set(candidate?.names ?? [])
    if (info.nickname !== null) nick.add(matchKey(info.nickname))
    const names = [...new Set(info.words.filter((word) => looksLikeName(word) && !nick.has(matchKey(word))))]
    return names.length === 1 ? (names[0] as string) : null
  }

  /**
   * 손님 정보 문자 받기 (inbox #smsBody에서). 주소를 못 읽으면 false(지금 그대로 처리). 받으면 true.
   * 하나로 모이면 바로 넣고(APPLIED), 아니면 카드(OPEN)
   */
  async receive(sellerId: string, input: { readonly text: string; readonly sender: string | null; readonly receivedMs: number; readonly nowMs: number }): Promise<boolean> {
    const info = readBuyerInfo(input.text)
    if (info === null) return false
    const sender = input.sender === null ? null : normalizePhone(input.sender)
    const candidates = await this.#match(sellerId, info, sender, input.nowMs)
    const byPhone = candidates.filter((c) => c.byPhone)
    const chosen = byPhone.length === 1 ? (byPhone[0] as Candidate) : byPhone.length === 0 && candidates.length === 1 ? (candidates[0] as Candidate) : null
    const name = BuyerInfoService.#nameFor(info, chosen)
    const phone = info.phone ?? sender
    const base = { text: input.text, sender, nickname: info.nickname, name, phone, address: info.address, detail: info.detail, candidates: candidates.map(({ date, buyer, label }) => ({ date, buyer, label })) }
    let status: 'OPEN' | 'APPLIED' = 'OPEN'
    let note: string = chosen === null ? (candidates.length === 0 ? 'NO_MATCH' : 'MANY') : 'NO_NAME'
    let applied: BuyerChoice | null = null
    if (chosen !== null && name !== null) {
      const put = await this.#put(sellerId, chosen.date, chosen.buyer, { name, phone: phone ?? '', address: info.address, detail: info.detail }, sender)
      if (put === 'INVALID') note = 'INVALID'
      else {
        status = 'APPLIED'
        note = put
        applied = { date: chosen.date, buyer: chosen.buyer, label: chosen.label }
      }
    }
    await this.#deps.db.insert(buyerInfoCards).values({
      id: `bi_${randomUUID()}`,
      sellerId,
      status,
      auto: status === 'APPLIED',
      date: applied?.date ?? null,
      buyer: applied?.buyer ?? null,
      note,
      last4: sender === null ? null : sender.slice(-4),
      sealed: this.#seal(sellerId, { ...base, applied }),
      receivedAt: new Date(input.receivedMs),
      createdAt: new Date(input.nowMs),
      handledAt: status === 'APPLIED' ? new Date(input.nowMs) : null,
    })
    this.#deps.publish(sellerId)
    return true
  }

  /** 넣기 공통: 번호 기억(판매자가 적은 번호는 그대로) + 배송지("확인 전" 손님 배송지 — 판매자가 적었거나 확인한 배송지는 덮지 않음) */
  async #put(sellerId: string, date: string, buyer: string, fields: { name: string; phone: string; address: string; detail: string }, sender: string | null): Promise<Note | 'INVALID'> {
    const raw = { name: fields.name, phone: fields.phone, address: fields.address, detail: fields.detail, zip: '', memo: '' }
    const read = readAddress(raw)
    const noPhone = fields.phone === '' && 'errors' in read && read.errors.every((code) => code === 'PHONE_EMPTY')
    if ('errors' in read && !noPhone) return 'INVALID'
    const remember = sender ?? (normalizePhone(fields.phone) === null ? null : fields.phone)
    if (remember !== null) await this.#deps.receiptSms.rememberIfNone(sellerId, manualPhoneKey(date, buyer), remember)
    if (noPhone) return 'NO_PHONE'
    const bundle = await this.#deps.parcels.bundle(sellerId, date, buyer)
    if (bundle.kind === 'ok') {
      const address = bundle.value.address
      if (address !== null && (address.source === 'SELLER' || (address.source === 'BUYER' && address.confirmed))) return 'KEPT'
    }
    try {
      const saved = await this.#deps.parcels.saveFromLink(sellerId, date, buyer, raw)
      if (saved.kind === 'saved') return 'SAVED'
      if (saved.kind === 'invalid') return 'INVALID'
      return 'REFUSED'
    } catch (error) {
      this.#deps.log({ level: 'warn', code: 'BUYER_INFO_ADDRESS_FAILED', seller: sellerId, errorKind: errorKind(error) })
      return 'REFUSED'
    }
  }

  #seal(sellerId: string, sealed: Sealed): string {
    return sealSellerText(this.#deps.masterKey, SEAL_PURPOSE, sellerId, JSON.stringify(sealed))
  }

  #open(sellerId: string, value: string): Sealed | null {
    try {
      return JSON.parse(openSellerText(this.#deps.masterKey, SEAL_PURPOSE, sellerId, value)) as Sealed
    } catch {
      return null
    }
  }

  #view(sellerId: string, row: typeof buyerInfoCards.$inferSelect): BuyerInfoCardView | null {
    const sealed = this.#open(sellerId, row.sealed)
    if (sealed === null || (row.status !== 'OPEN' && row.status !== 'APPLIED')) return null
    const note = (row.note ?? 'NO_MATCH') as Note | Why
    return {
      id: row.id,
      status: row.status,
      auto: row.auto,
      receivedAt: row.receivedAt.toISOString(),
      last4: row.last4,
      text: sealed.text,
      nickname: sealed.nickname,
      name: sealed.name,
      phone: sealed.phone,
      address: sealed.address,
      detail: sealed.detail,
      candidates: sealed.candidates,
      applied: sealed.applied,
      message: BUYER_INFO_MESSAGES[note] ?? BUYER_INFO_MESSAGES.NO_MATCH,
    }
  }

  /** 카드 목록 (확인할 것 먼저, 최근 받은 것부터) + 고를 손님 (7일 안 품목 있는 손님, 최근 날짜부터) */
  async list(sellerId: string): Promise<{ cards: BuyerInfoCardView[]; buyers: BuyerChoice[] }> {
    const nowMs = this.#deps.clock.now()
    const rows = await this.#deps.db
      .select()
      .from(buyerInfoCards)
      .where(and(eq(buyerInfoCards.sellerId, sellerId), inArray(buyerInfoCards.status, ['OPEN', 'APPLIED']), gte(buyerInfoCards.createdAt, new Date(nowMs - BUYER_INFO_KEEP_MS))))
      .orderBy(desc(buyerInfoCards.receivedAt))
    const cards = rows.map((row) => this.#view(sellerId, row)).filter((card): card is BuyerInfoCardView => card !== null)
    cards.sort((a, b) => (a.status === b.status ? 0 : a.status === 'OPEN' ? -1 : 1))
    const buyers: BuyerChoice[] = []
    if (cards.some((card) => card.status === 'OPEN')) {
      const seen = new Set<string>()
      for (const date of await this.#recentDates(sellerId, nowMs)) {
        const { state } = await this.#deps.writer.read(sellerId, date, false)
        for (const row of BuyerInfoService.#buyersOf(state, date)) {
          if (seen.has(row.buyer) || buyers.length >= PICK_MAX) continue
          seen.add(row.buyer)
          buyers.push({ date, buyer: row.buyer, label: row.label })
        }
      }
    }
    return { cards, buyers }
  }

  async #row(sellerId: string, id: string): Promise<typeof buyerInfoCards.$inferSelect | null> {
    const rows = await this.#deps.db.select().from(buyerInfoCards).where(and(eq(buyerInfoCards.sellerId, sellerId), eq(buyerInfoCards.id, id))).limit(1)
    return rows[0] ?? null
  }

  /** 판매자가 손님을 골라 넣기 (OPEN 카드만). 칸이 틀리면 400(카드 그대로) */
  async apply(sellerId: string, id: string, input: ApplyInput): Promise<Outcome<BuyerInfoCardView>> {
    const row = await this.#row(sellerId, id)
    if (row === null) return fail(404, 'NOT_FOUND', BUYER_INFO_MESSAGES.notFound)
    if (row.status !== 'OPEN') return fail(409, 'CARD_DONE', BUYER_INFO_MESSAGES.done)
    const sealed = this.#open(sellerId, row.sealed)
    if (sealed === null) return fail(404, 'NOT_FOUND', BUYER_INFO_MESSAGES.notFound)
    const raw = { name: input.name, phone: input.phone, address: input.address, detail: input.detail, zip: '', memo: '' }
    const read = readAddress(raw)
    if ('errors' in read) {
      return fail(400, 'INVALID_INPUT', BUYER_INFO_MESSAGES.INVALID, read.errors.map((code) => ({ field: ADDRESS_ERROR_FIELD[code], message: ADDRESS_ERROR_MESSAGES[code] })))
    }
    // 고른 손님이 7일 안 실제 방송의 품목 있는 손님인지
    const nowMs = this.#deps.clock.now()
    if (!(await this.#recentDates(sellerId, nowMs)).includes(input.date)) return fail(400, 'INVALID_INPUT', BUYER_INFO_MESSAGES.buyerGone)
    const { state } = await this.#deps.writer.read(sellerId, input.date, false)
    const target = BuyerInfoService.#buyersOf(state, input.date).find((row) => row.buyer === input.buyer)
    if (target === undefined) return fail(400, 'INVALID_INPUT', BUYER_INFO_MESSAGES.buyerGone)
    const put = await this.#put(sellerId, input.date, input.buyer, { name: read.ok.name, phone: read.ok.phone, address: read.ok.address, detail: read.ok.detail }, sealed.sender)
    if (put === 'INVALID') return fail(400, 'INVALID_INPUT', BUYER_INFO_MESSAGES.INVALID)
    const applied = { date: input.date, buyer: input.buyer, label: target.label }
    const next: Sealed = { ...sealed, name: read.ok.name, phone: read.ok.phone, address: read.ok.address, detail: read.ok.detail, applied }
    const updated = await this.#deps.db
      .update(buyerInfoCards)
      .set({ status: 'APPLIED', date: input.date, buyer: input.buyer, note: put, sealed: this.#seal(sellerId, next), handledAt: new Date(nowMs) })
      .where(and(eq(buyerInfoCards.sellerId, sellerId), eq(buyerInfoCards.id, id), eq(buyerInfoCards.status, 'OPEN')))
      .returning()
    const view = updated[0] === undefined ? null : this.#view(sellerId, updated[0])
    if (view === null) return fail(409, 'CARD_DONE', BUYER_INFO_MESSAGES.done)
    this.#deps.publish(sellerId)
    return { kind: 'ok', value: view }
  }

  /** 닫기: 확인할 카드는 무시(IGNORED), 넣은 카드는 목록에서 내림(CLOSED). 이미 닫혔으면 그대로 */
  async dismiss(sellerId: string, id: string): Promise<Outcome<{ id: string }>> {
    const row = await this.#row(sellerId, id)
    if (row === null) return fail(404, 'NOT_FOUND', BUYER_INFO_MESSAGES.notFound)
    if (row.status === 'OPEN' || row.status === 'APPLIED') {
      await this.#deps.db
        .update(buyerInfoCards)
        .set({ status: row.status === 'OPEN' ? 'IGNORED' : 'CLOSED', handledAt: new Date(this.#deps.clock.now()) })
        .where(and(eq(buyerInfoCards.sellerId, sellerId), eq(buyerInfoCards.id, id), eq(buyerInfoCards.status, row.status)))
      this.#deps.publish(sellerId)
    }
    return { kind: 'ok', value: { id } }
  }

  /** 받은 지 7일 넘은 카드 지우기 (하루 한 번 청소) */
  async sweep(): Promise<number> {
    const rows = await this.#deps.db
      .delete(buyerInfoCards)
      .where(lt(buyerInfoCards.createdAt, new Date(this.#deps.clock.now() - BUYER_INFO_KEEP_MS)))
      .returning({ id: buyerInfoCards.id })
    return rows.length
  }
}
