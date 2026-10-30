// 손님 장부 서비스 (KP1, CUSTOMER_RULES CR-1~CR-8, D-KP1-01~08). 판정 엔진 밖이다 — 엔진 이벤트·발송함을 쓰지 않고, 문자·알림톡을 보내지 않는다.
// - 표지(marker) = CRM1과 같은 글: 채팅 구매자 `c:<구매자 키>`, 전화번호가 있는 문자 구매자 `p:<전화번호 키>`(facts.ts). 표지는 서버 안에서만 쓴다.
// - 묶음 구성원 = 지금의 구매자 + 그 아래 합친 구매자(코어 getBuyer merged). 채팅 구매자의 표지는 상태에서 바로, 문자 구매자의 표지는 그날 재료(facts — 문자찜 본문의
//   전화번호 키)에서 얻는다. 재료는 범위 줄(writer.serial) 밖에서만 읽는다 — 범위 줄 안(배송지 저장 트랜잭션)에서 쓸 표지는 부르는 쪽이 미리 받아 넘긴다.
// - 장부 쓰기는 판매자 장부 락(ledger-store.ts)을 잡은 한 트랜잭션에서 하고, 동의 기록을 같은 트랜잭션에 덧붙인다.
// - 로그에는 판매자 ID·개수·오류 종류만 — 연락처·표지·코드 글·채팅 본문은 남기지 않는다(CR-8).
import { randomInt } from 'node:crypto'
import { getBroadcast, getBuyer, getSettlement, type EngineState } from '@livejjim/core'
import { buildCustomersXlsx, type CustomerXlsxRow, type CustomersXlsxResult } from '@livejjim/documents'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { customerExports, ledgerLines } from '../db/schema.ts'
import type { StreamHub } from '../hub.ts'
import { errorKind, type LogSink } from '../log.ts'
import { phoneLast4 } from '../parcel/rules.ts'
import { PLATFORM_NAMES, platformOfKey } from '../platform.ts'
import { readShop } from '../shop.ts'
import { iso, kstDate, type Clock } from '../time.ts'
import type { WorkPool } from '../work-pool.ts'
import type { TxHookContext } from '../writer.ts'
import { factsFor, realScopes, type ScopeRow } from './facts.ts'
import { LINK_CODE_TTL_MS, badgeSpoken, customerBadge, ledgerDeleteOn, ledgerMonthsWord, maskRecipient, matchLinkCode, pickLinkCode, showLedgerPrefill, type LedgerMonths } from './ledger-rules.ts'
import {
  claimCode,
  consentInTx,
  deleteLine,
  dropOldCodes,
  finishCodesOfLine,
  finishExpiredCodes,
  insertCode,
  lineIdsOfMarkers,
  linesByIds,
  linesOfMarkers,
  liveCodes,
  lockLedger,
  markerHolder,
  markersOfLines,
  moveMarker,
  newLedgerId,
  openCodeOfLine,
  openContact,
  readLedgerSettings,
  RECENT_CODE_MS,
  recentCodes,
  sweepLines,
  sweepSellers,
  writeLedgerSettings,
  type LedgerContact,
  type LedgerSettings,
  type LineRow,
} from './ledger-store.ts'
import type { CustomerService } from './service.ts'

export type { LedgerContact, LedgerSettings } from './ledger-store.ts'

/** 묶음 배송지 칸의 "확인 전" 장부 연락처 (판매자에겐 다섯 칸 전부, CR-4) */
export interface LedgerPrefill {
  readonly ledgerId: string
  /** 줄을 고친 시각 (UTC ISO — [배송지 확인]에 그대로 보낸다) */
  readonly updatedAt: string
  readonly name: string
  readonly phone: string
  readonly address: string
  readonly detail: string
  readonly zip: string
}

/** 손님 자세히의 장부 칸 (가린 이름·끝 4자리만 — 가정) */
export interface CustomerLedgerView {
  readonly ledgerId: string
  readonly name: string
  readonly phoneLast4: string
  /** 지우는 날 (KST 날짜) */
  readonly keepUntil: string
  readonly consentDate: string
  /** 손님이 연결 코드로 이은 계정 ("유튜브 홍길동(끝 1234)") */
  readonly linked: readonly { readonly label: string; readonly linkedAt: string }[]
}

/** 확인서 링크 쪽 장부 거리 (CR-2·CR-5) */
export interface LinkLedgerView {
  /** 동의 칸을 보일 수 있다 (구성원 표지 ≥ 1, 봉인 아님 — 양식이 보이는지는 화면이 본다) */
  readonly consent: { readonly shop: string; readonly monthsWord: string } | null
  /** 구성원 표지가 든 장부 줄이 정확히 하나일 때의 장부 칸 */
  readonly line: {
    readonly name: string
    readonly last4: string
    readonly code: { readonly code: string; readonly expiresAt: number } | null
    readonly claim: { readonly platform: string; readonly name: string; readonly last4: string } | null
  } | null
}

/** refused = 코드를 친 계정이 이미 다른 장부 줄에 동의로 들어 있어 잇지 않았다 (RA-KP1-007). none = 조건이 그사이 깨져 아무것도 하지 않았다 (D-KP1-39) */
export type LinkLedgerAction = 'deleted' | 'code' | 'full' | 'linked' | 'unlinked' | 'refused' | 'none'

export interface BadgesView {
  readonly show: boolean
  readonly badges: readonly { readonly buyer: string; readonly text: string | null; readonly spoken: string | null }[]
}

export interface LedgerDeps {
  readonly db: Db
  readonly clock: Clock
  readonly masterKey: Buffer
  readonly hub: Pick<StreamHub, 'publishNamed'>
  readonly log: LogSink
  readonly customers: CustomerService
  /** 범위 상태 읽기 (확인서 링크 장부 칸 — 범위 줄 밖에서 부른다) */
  readonly readState: (sellerId: string, date: string) => Promise<EngineState>
  /** 코드 고르기 난수 (기본 crypto.randomInt — 시험은 정해진 값) */
  readonly randomIndex?: (n: number) => number
  /** 손님 엑셀을 만들 작업 풀 (판매대장과 같은 documents 풀 — RA-KP1-008). 없으면 요청 안에서 만든다 */
  readonly work?: Pick<WorkPool, 'run'>
}

const SMS_PREFIX = 'sms:'

/** 정리 작업: 한 트랜잭션에서 지우는 줄 수 (RA-KP1-003) */
export const SWEEP_BATCH = 100
/** 정리 후보: 동의한 지 이만큼 지난 줄만 (가장 짧은 보관 6개월 ≥ 181일보다 하루 짧게, RA-KP1-009) */
export const SWEEP_MIN_AGE_MS = 180 * 24 * 60 * 60 * 1000

/** 연결 코드 후보 채팅 (커밋 뒤 읽는다 — 메모리에만, 로그 금지) */
interface CodeCandidate {
  readonly marker: string
  readonly platform: string
  readonly name: string
  readonly last4: string
  readonly text: string
}

/** 공백을 지운 글이 한글 네 글자인지 (두 낱말 코드 모양 — DB를 묻기 전에 거른다) */
const CODE_SHAPE_RE = /^[가-힣]{4}$/u
const codeShaped = (text: string) => text.length <= 64 && CODE_SHAPE_RE.test(text.normalize('NFC').replace(/\s/gu, ''))

export class LedgerService {
  readonly #deps: LedgerDeps
  /** 판매자마다 채팅 코드 읽기를 차례로 (처음 맞은 채팅 하나가 쓴다) */
  readonly #claimQueues = new Map<string, Promise<void>>()

  constructor(deps: LedgerDeps) {
    this.#deps = deps
  }

  #now(): Date {
    return new Date(this.#deps.clock.now())
  }

  #changed(sellerId: string, what: 'settings' | 'ledger'): void {
    this.#deps.hub.publishNamed(sellerId, 'customers', { what })
  }

  // ── 설정 (CR-3·CR-7) ─────────────────────────────────────────────────

  settings(sellerId: string): Promise<LedgerSettings> {
    return readLedgerSettings(this.#deps.db, sellerId)
  }

  async saveSettings(sellerId: string, value: LedgerSettings): Promise<LedgerSettings> {
    await writeLedgerSettings(this.#deps.db, sellerId, value, this.#now())
    this.#changed(sellerId, 'settings')
    return this.settings(sellerId)
  }

  // ── 표지 ─────────────────────────────────────────────────────────────

  async #scope(sellerId: string, date: string): Promise<ScopeRow | null> {
    return (await realScopes(this.#deps.db, sellerId)).find((scope) => scope.date === date) ?? null
  }

  async #hasLines(sellerId: string): Promise<boolean> {
    const rows = await this.#deps.db.select({ id: ledgerLines.id }).from(ledgerLines).where(eq(ledgerLines.sellerId, sellerId)).limit(1)
    return rows.length > 0
  }

  /**
   * 그날 문자 구매자 ID → 표지 (재료의 전화번호 키). 범위 줄 밖에서 부른다.
   * force가 아니면 판매자에게 장부 줄이 하나도 없을 때 재료를 세우지 않고 빈 표를 준다(보일 것이 없다)
   */
  async knownMarkers(sellerId: string, date: string, force = false): Promise<ReadonlyMap<string, string>> {
    const out = new Map<string, string>()
    if (!force && !(await this.#hasLines(sellerId))) return out
    const scope = await this.#scope(sellerId, date)
    if (scope === null) return out
    const facts = await factsFor(this.#deps.customers.factsDeps(), sellerId, scope)
    if (facts === null) return out
    for (const buyer of facts.buyers.values()) if (buyer.marker !== null) out.set(buyer.id, buyer.marker)
    return out
  }

  /** 묶음 구성원의 표지 (채팅 구매자는 상태에서, 문자 구매자는 known에서). 순서대로, 겹침 없이 */
  static memberMarkers(state: EngineState, buyer: string, known: ReadonlyMap<string, string>): string[] {
    const info = getBuyer(state, buyer)
    if (info === null) return []
    const out: string[] = []
    for (const id of [buyer, ...info.merged]) {
      const member = getBuyer(state, id)
      const marker = member?.kind === 'youtube' ? `c:${id}` : id.startsWith(SMS_PREFIX) ? (known.get(id) ?? null) : null
      if (marker !== null && !out.includes(marker)) out.push(marker)
    }
    return out
  }

  // ── 묶음 배송지 "확인 전" (CR-4, AC-KP1-08) ──────────────────────────

  /**
   * 묶음마다 장부 연락처를 "확인 전"으로 보일지와 그 값 (실제·봉인 안 된 날짜의 묶음만 — 부르는 쪽이 리허설·봉인을 뺀다).
   * 묶음 구성원 표지가 든 줄(연락처가 풀리는 것)이 정확히 하나이고 showLedgerPrefill이 참일 때만
   */
  async prefills(
    db: Db,
    sellerId: string,
    date: string,
    state: EngineState,
    bundles: readonly { buyer: string; saved: 'NONE' | 'UNCONFIRMED' | 'CONFIRMED' }[],
    known: ReadonlyMap<string, string>,
  ): Promise<Map<string, LedgerPrefill>> {
    const out = new Map<string, LedgerPrefill>()
    const wanted = bundles.filter((bundle) => bundle.saved === 'NONE')
    if (wanted.length === 0) return out
    const markersOf = new Map(wanted.map((bundle) => [bundle.buyer, LedgerService.memberMarkers(state, bundle.buyer, known)]))
    const all = [...markersOf.values()].flat()
    if (all.length === 0) return out
    const lineOf = await lineIdsOfMarkers(db, sellerId, all)
    if (lineOf.size === 0) return out
    const lines = new Map((await linesByIds(db, sellerId, [...new Set(lineOf.values())])).map((line) => [line.id, line]))
    const contacts = new Map<string, LedgerContact | null>()
    const contactOf = (line: LineRow) => {
      if (!contacts.has(line.id)) contacts.set(line.id, openContact(this.#deps.masterKey, sellerId, line.id, line.contactEnc))
      return contacts.get(line.id) ?? null
    }
    for (const bundle of wanted) {
      const ids = [...new Set((markersOf.get(bundle.buyer) ?? []).map((marker) => lineOf.get(marker)).filter((id) => id !== undefined))]
      const usable = ids.map((id) => lines.get(id)).filter((line): line is LineRow => line !== undefined && contactOf(line) !== null)
      const settlement = getSettlement(state, bundle.buyer, date)
      const shipping = settlement.items.length === 0 ? 'NONE' : (settlement.shippingOverride ?? 'NONE')
      if (!showLedgerPrefill({ items: settlement.items.length, shipping, saved: bundle.saved, lines: usable.length }).ledger) continue
      const line = usable[0] as LineRow
      const contact = contactOf(line) as LedgerContact
      out.set(bundle.buyer, { ledgerId: line.id, updatedAt: iso(line.updatedAt.getTime()), ...contact })
    }
    return out
  }

  /** [배송지 확인]용: 그 묶음의 장부 줄 (정확히 하나일 때만) + 연락처 — 범위 트랜잭션 안에서 부른다 */
  async lineForBundle(tx: Db, sellerId: string, state: EngineState, buyer: string, known: ReadonlyMap<string, string>): Promise<{ line: LineRow; contact: LedgerContact } | null> {
    const lines = await linesOfMarkers(tx, sellerId, LedgerService.memberMarkers(state, buyer, known))
    const usable = lines.map((line) => ({ line, contact: openContact(this.#deps.masterKey, sellerId, line.id, line.contactEnc) })).filter((item) => item.contact !== null)
    if (usable.length !== 1) return null
    return usable[0] as { line: LineRow; contact: LedgerContact }
  }

  // ── 동의 (CR-2, AC-KP1-03) ───────────────────────────────────────────

  /**
   * 확인서 링크 배송지 저장과 같은 트랜잭션에서 부른다: 구성원 표지가 하나도 없으면 아무것도 하지 않고 false.
   * 연락처 = 이번 다섯 칸(배송 메모 없음), 개월 = 지금 설정
   */
  async consentInTx(tx: Db, input: { sellerId: string; date: string; state: EngineState; buyer: string; known: ReadonlyMap<string, string>; contact: LedgerContact; now: Date }): Promise<boolean> {
    const markers = LedgerService.memberMarkers(input.state, input.buyer, input.known)
    if (markers.length === 0) return false
    const settings = await readLedgerSettings(tx, input.sellerId)
    const contact: LedgerContact = { name: input.contact.name, phone: input.contact.phone, address: input.contact.address, detail: input.contact.detail, zip: input.contact.zip }
    await consentInTx(tx, this.#deps.masterKey, { sellerId: input.sellerId, date: input.date, markers, contact, months: settings.months, now: input.now })
    return true
  }

  /** 커밋 뒤 알림 (장부가 바뀌었다 — 값 없음) */
  published(sellerId: string): void {
    this.#changed(sellerId, 'ledger')
  }

  // ── 확인서 링크 장부 칸 (CR-2·CR-3·CR-5) ─────────────────────────────

  async #sealed(sellerId: string, date: string): Promise<boolean> {
    const scope = await this.#scope(sellerId, date)
    return scope === null || scope.sealedAt !== null
  }

  /** 링크 묶음의 표지와 (정확히 하나면) 장부 줄 */
  async #linkLine(sellerId: string, date: string, buyer: string): Promise<{ markers: string[]; line: LineRow | null; state: EngineState } | null> {
    if (await this.#sealed(sellerId, date)) return null
    const state = await this.#deps.readState(sellerId, date)
    const markers = LedgerService.memberMarkers(state, buyer, await this.knownMarkers(sellerId, date, true))
    if (markers.length === 0) return { markers, line: null, state }
    const lines = await linesOfMarkers(this.#deps.db, sellerId, markers)
    return { markers, line: lines.length === 1 ? (lines[0] as LineRow) : null, state }
  }

  /** 링크 화면의 장부 거리 (리허설·봉인 날짜·표지 없음이면 동의 칸도 장부 칸도 없다) */
  async linkView(sellerId: string, date: string, buyer: string): Promise<LinkLedgerView> {
    const found = await this.#linkLine(sellerId, date, buyer)
    if (found === null || found.markers.length === 0) return { consent: null, line: null }
    const settings = await this.settings(sellerId)
    const shop = (await readShop(this.#deps.db, sellerId)).name
    const consent = { shop, monthsWord: ledgerMonthsWord(settings.months) }
    const line = found.line
    if (line === null) return { consent, line: null }
    const contact = openContact(this.#deps.masterKey, sellerId, line.id, line.contactEnc)
    if (contact === null) return { consent, line: null }
    const now = this.#deps.clock.now()
    const open = await openCodeOfLine(this.#deps.db, sellerId, line.id)
    const live = open !== null && open.expiresAt.getTime() > now
    return {
      consent,
      line: {
        name: maskRecipient(contact.name),
        last4: phoneLast4(contact.phone),
        code: live && open.state === 'LIVE' ? { code: open.code, expiresAt: open.expiresAt.getTime() } : null,
        claim:
          live && open.state === 'CLAIMED' && open.claimedPlatform !== null && open.claimedName !== null && open.claimedLast4 !== null
            ? { platform: open.claimedPlatform, name: open.claimedName, last4: open.claimedLast4 }
            : null,
      },
    }
  }

  /**
   * 링크의 장부 동작 (지우기·코드 받기·코드 확인). 그 링크 묶음의 장부 줄이 정확히 하나일 때만 — 아니면 'none'.
   * 트랜잭션 안에서 장부 락을 잡고 줄이 그대로인지 다시 본다
   */
  async linkAction(sellerId: string, date: string, buyer: string, action: { kind: 'delete' } | { kind: 'code' } | { kind: 'answer'; yes: boolean }): Promise<LinkLedgerAction> {
    const found = await this.#linkLine(sellerId, date, buyer)
    if (found === null || found.line === null) return 'none'
    const lineId = found.line.id
    const { db } = this.#deps
    const now = this.#now()
    const result = await db.transaction(async (tx): Promise<LinkLedgerAction> => {
      await lockLedger(tx, sellerId)
      const lines = await linesOfMarkers(tx, sellerId, found.markers)
      if (lines.length !== 1 || lines[0]?.id !== lineId) return 'none'
      if (action.kind === 'delete') {
        await deleteLine(tx, sellerId, lineId, { type: 'WITHDRAW', reason: null, accountId: null, route: 'RECEIPT_LINK', orderDate: date, at: now })
        return 'deleted'
      }
      if (action.kind === 'code') {
        await finishCodesOfLine(tx, sellerId, lineId)
        // 최근에 끝난 코드와도 겹치지 않게 (TD-KP1-002)
        const taken = new Set(await recentCodes(tx, sellerId, new Date(now.getTime() - RECENT_CODE_MS)))
        const code = pickLinkCode(taken, this.#deps.randomIndex ?? ((n) => randomInt(n)))
        if (code === null) return 'full'
        await insertCode(tx, { id: newLedgerId(), sellerId, lineId, code, now, expiresAt: new Date(now.getTime() + LINK_CODE_TTL_MS) })
        return 'code'
      }
      const open = await openCodeOfLine(tx, sellerId, lineId)
      if (open === null || open.state !== 'CLAIMED' || open.expiresAt.getTime() <= now.getTime() || open.claimedMarker === null) return 'none'
      if (action.yes) {
        // 이미 다른 장부 줄에 동의로 들어 있는 계정은 코드로 옮기지 않는다 — 꾀어 코드를 치게 해 남의 줄을 빼앗지 못하게 (RA-KP1-007, CR-0 6 "애매하면 쓰지 않는다")
        const held = await markerHolder(tx, sellerId, open.claimedMarker)
        if (held !== null && held.lineId !== lineId && held.source === 'CONSENT') {
          await finishCodesOfLine(tx, sellerId, lineId)
          return 'refused'
        }
        await moveMarker(tx, { sellerId, marker: open.claimedMarker, lineId, platform: open.claimedPlatform, name: open.claimedName, last4: open.claimedLast4, now })
      }
      await finishCodesOfLine(tx, sellerId, lineId)
      return action.yes ? 'linked' : 'unlinked'
    })
    if (result === 'deleted' || result === 'linked') this.published(sellerId)
    return result
  }

  // ── 판매자 손님 자세히 (CR-3·CR-5, AC-KP1-07·11) ─────────────────────

  /** 줄마다 지우는 날 (마지막 주문 = 줄 표지 중 품목 있는 묶음의 가장 늦은 실제 날짜) */
  async #deleteOns(sellerId: string, lines: readonly LineRow[], months: LedgerMonths): Promise<Map<string, string>> {
    return (await this.#deleteOnsCounted(sellerId, lines, months)).deleteOns
  }

  /** #deleteOns + 봉인 장부를 읽지 못해 빠진 날 수 (quiet = 공용 재료 캐시를 건드리지 않음 — 정리 작업) */
  async #deleteOnsCounted(sellerId: string, lines: readonly LineRow[], months: LedgerMonths, quiet = false): Promise<{ deleteOns: Map<string, string>; unreadable: number }> {
    const out = new Map<string, string>()
    if (lines.length === 0) return { deleteOns: out, unreadable: 0 }
    const markers = await markersOfLines(this.#deps.db, sellerId, lines.map((line) => line.id))
    const facts = await this.#deps.customers.markerFacts(
      sellerId,
      markers.map((row) => row.marker),
      { quiet },
    )
    const last = new Map<string, string>()
    for (const row of markers) {
      for (const bundle of facts.byMarker.get(row.marker)?.bundles ?? []) {
        if (bundle.items < 1) continue
        const before = last.get(row.lineId)
        if (before === undefined || bundle.date > before) last.set(row.lineId, bundle.date)
      }
    }
    for (const line of lines) {
      const consentMonths = [6, 12, 24, 36].includes(line.consentMonths) ? (line.consentMonths as LedgerMonths) : 6
      out.set(line.id, ledgerDeleteOn({ lastOrder: last.get(line.id) ?? null, consentOrder: line.consentDate, consentMonths, settingMonths: months }).deleteOn)
    }
    return { deleteOns: out, unreadable: facts.unreadable }
  }

  /** 그 손님(표지)의 장부 칸. 줄이 없거나 연락처가 풀리지 않으면 null */
  async customerLedger(sellerId: string, marker: string): Promise<CustomerLedgerView | null> {
    const line = (await linesOfMarkers(this.#deps.db, sellerId, [marker]))[0]
    if (line === undefined) return null
    const contact = openContact(this.#deps.masterKey, sellerId, line.id, line.contactEnc)
    if (contact === null) return null
    const settings = await this.settings(sellerId)
    const keepUntil = (await this.#deleteOns(sellerId, [line], settings.months)).get(line.id) as string
    const linked = (await markersOfLines(this.#deps.db, sellerId, [line.id]))
      .filter((row) => row.source === 'CODE' && row.labelPlatform !== null && row.labelName !== null)
      .map((row) => ({ label: `${row.labelPlatform as string} ${row.labelName as string}${row.labelLast4 === null ? '' : `(끝 ${row.labelLast4})`}`, linkedAt: iso(row.linkedAt.getTime()) }))
    return { ledgerId: line.id, name: maskRecipient(contact.name), phoneLast4: phoneLast4(contact.phone), keepUntil, consentDate: line.consentDate, linked }
  }

  /** 판매자가 손님 자세히에서 지움 (SELLER_DELETE). 없는 손님 'not_found', 이 손님 줄이 아니거나 이미 없으면 'no_ledger' */
  async sellerDelete(sellerId: string, accountId: string, customerId: string, ledgerId: string): Promise<'deleted' | 'no_ledger' | 'not_found'> {
    const marker = await this.#deps.customers.markerOfId(sellerId, customerId)
    if (marker === null) return 'not_found'
    const now = this.#now()
    const done = await this.#deps.db.transaction(async (tx) => {
      await lockLedger(tx, sellerId)
      const lineId = (await lineIdsOfMarkers(tx, sellerId, [marker])).get(marker)
      if (lineId !== ledgerId) return false
      return deleteLine(tx, sellerId, lineId, { type: 'SELLER_DELETE', reason: null, accountId, route: null, orderDate: null, at: now })
    })
    if (!done) return 'no_ledger'
    this.published(sellerId)
    return 'deleted'
  }

  // ── 콘솔 손님 표시 (CR-7, AC-KP1-14·16) ──────────────────────────────

  /** 구매자들의 꼬리표 (물은 순서대로). 실제 범위가 없는 날짜면 null */
  async badges(sellerId: string, date: string, buyers: readonly string[]): Promise<BadgesView | null> {
    const scope = await this.#scope(sellerId, date)
    if (scope === null) return null
    const settings = await this.settings(sellerId)
    if (!settings.consoleBadges) return { show: false, badges: buyers.map((buyer) => ({ buyer, text: null, spoken: null })) }
    const facts = await factsFor(this.#deps.customers.factsDeps(), sellerId, scope)
    const markerOf = (buyer: string): string | null => {
      const known = facts?.buyers.get(buyer)
      if (known !== undefined) return known.marker
      return buyer.startsWith(SMS_PREFIX) ? null : `c:${buyer}`
    }
    const markers = buyers.map(markerOf)
    const summary = await this.#deps.customers.markerFacts(
      sellerId,
      markers.filter((marker) => marker !== null),
    )
    return {
      show: true,
      badges: buyers.map((buyer, i) => {
        const marker = markers[i] ?? null
        const found = marker === null ? undefined : summary.byMarker.get(marker)
        const { text } = customerBadge({
          show: true,
          rehearsal: false,
          known: marker !== null,
          earlier: found?.bundles.some((bundle) => bundle.date < date) === true,
          regular: found?.summary.regular === true,
          caution: found?.summary.caution === true,
          purchaseTotal: found?.summary.purchaseTotal ?? 0,
        })
        return { buyer, text, spoken: text === null ? null : badgeSpoken(text) }
      }),
    }
  }

  // ── 채팅에서 연결 코드 읽기 (CR-5, AC-KP1-10) ────────────────────────

  /**
   * 기록 트랜잭션 안에서 부른다 — DB를 쓰지 않는다. 실제 회차의 채팅(방송자 글·옵션 방송 빼고)만 골라 커밋 뒤에 코드를 찾는다.
   * 판정·기록에 영향 없음: 이벤트를 쓰지 않고, 실패해도 기록은 그대로다
   */
  txHook(_tx: Db, ctx: TxHookContext): Promise<(() => void) | null> {
    if (ctx.rehearsal) return Promise.resolve(null)
    const candidates: CodeCandidate[] = []
    ctx.records.forEach((record, i) => {
      const event = record.event
      if (event.type !== 'chat' || record.failed || event.owner === true) return
      if (!codeShaped(event.text)) return
      const state = ctx.states[i] ?? ctx.before
      // 옵션 방송은 낱말이 상품 이름과 겹칠 수 있어 읽지 않는다 (D-KP1-06)
      const mode = getBroadcast(state, event.b)?.settings['claim.parseMode']
      if (mode === undefined || mode === 'OPTIONS') return
      const platform = platformOfKey(event.ch)
      if (platform === null) return
      candidates.push({ marker: `c:${event.ch}`, platform: PLATFORM_NAMES[platform], name: event.nick, last4: event.ch.slice(-4), text: event.text })
    })
    if (candidates.length === 0) return Promise.resolve(null)
    const sellerId = ctx.sellerId
    return Promise.resolve(() => {
      void this.claimFromChat(sellerId, candidates)
    })
  }

  /** 커밋 뒤: 살아 있는 코드와 맞는 채팅이 있으면 그 코드를 CLAIMED로 (한 번만). 판매자마다 차례로 */
  claimFromChat(sellerId: string, candidates: readonly CodeCandidate[]): Promise<void> {
    const previous = this.#claimQueues.get(sellerId) ?? Promise.resolve()
    const run = previous.then(() => this.#claim(sellerId, candidates))
    const settled = run.catch((error: unknown) => {
      this.#deps.log({ level: 'warn', code: 'LEDGER_CODE_FAILED', seller: sellerId, errorKind: errorKind(error) })
    })
    this.#claimQueues.set(sellerId, settled)
    void settled.then(() => {
      if (this.#claimQueues.get(sellerId) === settled) this.#claimQueues.delete(sellerId)
    })
    return settled
  }

  async #claim(sellerId: string, candidates: readonly CodeCandidate[]): Promise<void> {
    const now = this.#now()
    let codes = (await liveCodes(this.#deps.db, sellerId)).filter((row) => row.expiresAt.getTime() > now.getTime())
    for (const candidate of candidates) {
      if (codes.length === 0) return
      const { code } = matchLinkCode({ text: candidate.text, codes: codes.map((row) => row.code) })
      if (code === null) continue
      const row = codes.find((item) => item.code === code)
      if (row === undefined) continue
      await claimCode(this.#deps.db, { sellerId, id: row.id, marker: candidate.marker, platform: candidate.platform, name: candidate.name, last4: candidate.last4, now })
      codes = codes.filter((item) => item.id !== row.id)
    }
  }

  // ── 손님 엑셀 (CR-6, AC-KP1-12·13) ───────────────────────────────────

  /** "모든 손님" 전부 → 엑셀. 받은 기록(누가·언제·연락처 열)을 남긴다 */
  async exportXlsx(sellerId: string, accountId: string, includeContact: boolean, signal?: AbortSignal): Promise<CustomersXlsxResult> {
    const { today, rows } = await this.#deps.customers.allRows(sellerId)
    const contacts = new Map<string, NonNullable<CustomerXlsxRow['contact']>>()
    if (includeContact) {
      const lineOf = await lineIdsOfMarkers(
        this.#deps.db,
        sellerId,
        rows.map((item) => item.marker),
      )
      const lines = await linesByIds(this.#deps.db, sellerId, [...new Set(lineOf.values())])
      const settings = await this.settings(sellerId)
      const deleteOns = await this.#deleteOns(sellerId, lines, settings.months)
      const byId = new Map(lines.map((line) => [line.id, line]))
      for (const [marker, lineId] of lineOf) {
        const line = byId.get(lineId)
        const contact = line === undefined ? null : openContact(this.#deps.masterKey, sellerId, line.id, line.contactEnc)
        if (contact === null) continue
        contacts.set(marker, { recipient: contact.name, phone: contact.phone, address: contact.address, addressDetail: contact.detail, zip: contact.zip, keepUntil: deleteOns.get(lineId) ?? '' })
      }
    }
    const xlsxRows: CustomerXlsxRow[] = rows.map(({ row, marker, memo }) => ({
      name: row.name,
      kind: row.kindLabel,
      totalWon: row.purchaseTotal,
      purchaseCount: row.purchaseDays,
      lastPurchaseDate: row.lastPurchase,
      unpaidCount: row.unpaidDays,
      regular: row.regular,
      lateWarning: row.caution,
      memo,
      contact: includeContact ? (contacts.get(marker) ?? null) : null,
    }))
    // 이벤트 루프 밖(작업 워커)에서 만든다 — 밀려 있으면 WorkBusy, 못 끝내면 WorkFailed (부르는 쪽이 429·500으로)
    const input = { date: today, rows: xlsxRows, includeContact }
    const work = this.#deps.work
    const result = work === undefined ? await buildCustomersXlsx(input) : await work.run<CustomersXlsxResult>(sellerId, 'customersXlsx', input, signal === undefined ? {} : { signal })
    await this.#deps.db.insert(customerExports).values({ sellerId, accountId, contact: includeContact, at: this.#now() })
    return result
  }

  // ── 정리 (CR-3, AC-KP1-06) ───────────────────────────────────────────

  /**
   * 한 차례: 기한 지난 코드 끝내기, 지우는 날이 된 줄 지우기(EXPIRE '기간 지남'). 지운 줄 수.
   * - 후보 판매자·줄만 본다: 동의 날짜가 오늘 − 180일 이하인 줄 (지우는 날 ≥ 동의 + 6개월 ≥ 181일 — RA-KP1-009).
   *   재료는 공용 캐시를 건드리지 않고 읽는다(방송 중 판매자 재료를 밀어내지 않게).
   * - 그 판매자 봉인 장부 중 읽지 못한 날이 하나라도 있으면 이번 정리에서 그 판매자 줄을 지우지 않는다(마지막 주문을 앞당겨 일찍 지우지 않게 — RA-KP1-002).
   * - 지우기는 SWEEP_BATCH줄마다 따로 트랜잭션(장부 락을 오래 쥐지 않는다 — 링크 저장이 범위 줄 안에서 기다리지 않게, RA-KP1-003)
   */
  async sweepOnce(): Promise<{ lines: number; codes: number }> {
    const { db } = this.#deps
    const now = this.#now()
    const today = kstDate(now.getTime())
    const codes = await finishExpiredCodes(db, now)
    await dropOldCodes(db, new Date(now.getTime() - RECENT_CODE_MS))
    const before = kstDate(now.getTime() - SWEEP_MIN_AGE_MS)
    let removed = 0
    for (const sellerId of await sweepSellers(db, before)) {
      try {
        const settings = await this.settings(sellerId)
        const lines = await sweepLines(db, sellerId, before)
        const { deleteOns, unreadable } = await this.#deleteOnsCounted(sellerId, lines, settings.months, true)
        if (unreadable > 0) {
          this.#deps.log({ level: 'warn', code: 'LEDGER_SWEEP_SKIPPED', seller: sellerId, count: unreadable })
          continue
        }
        const due = lines.filter((line) => today >= (deleteOns.get(line.id) ?? '9999-12-31'))
        if (due.length === 0) continue
        let count = 0
        for (let at = 0; at < due.length; at += SWEEP_BATCH) {
          const batch = due.slice(at, at + SWEEP_BATCH)
          count += await db.transaction(async (tx) => {
            await lockLedger(tx, sellerId)
            let done = 0
            for (const line of batch) {
              // 그사이 새 동의·표지 옮김·합치기로 바뀐 줄은 다음 차례에 다시 센다
              const still = await tx
                .select({ id: ledgerLines.id })
                .from(ledgerLines)
                .where(and(eq(ledgerLines.sellerId, sellerId), eq(ledgerLines.id, line.id), eq(ledgerLines.updatedAt, line.updatedAt)))
              if (still.length === 0) continue
              if (await deleteLine(tx, sellerId, line.id, { type: 'EXPIRE', reason: '기간 지남', accountId: null, route: null, orderDate: null, at: now })) done += 1
            }
            return done
          })
        }
        if (count > 0) {
          removed += count
          this.published(sellerId)
        }
      } catch (error) {
        this.#deps.log({ level: 'error', code: 'LEDGER_SWEEP_FAILED', seller: sellerId, errorKind: errorKind(error) })
      }
    }
    if (removed > 0 || codes > 0) this.#deps.log({ level: 'info', code: 'LEDGER_SWEPT', count: removed })
    return { lines: removed, codes }
  }
}

