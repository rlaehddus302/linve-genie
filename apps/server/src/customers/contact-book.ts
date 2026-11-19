// 판매자가 적은 손님 연락처 (D-CONTACT-01, 사용자 지시 2026-11-20 "전화기록부처럼 같은 번호면 같은 사람인 걸 알게끔 … 같은 사람 정보 입력 두 번 안 하게").
// 판매 엔진 밖이다 — 엔진 이벤트·발송함을 쓰지 않고 판정·금액을 바꾸지 않는다.
// - 열쇠 = 엔진 전화번호 키(판매자 키 HMAC — 번호 전체가 같을 때만 같다. 끝자리만 같은 다른 사람에게 붙지 않는다).
// - 판매자가 주문 손님 정보·택배 배송지를 적거나(판매자 출처) 이 연락처로 [배송지 확인]을 누르면 그 번호의 연락처를 새 값으로 바꾸고,
//   그 묶음의 채팅 손님 계정(유튜브·인스타그램·틱톡·밴드 구매자 키)을 그 번호에 잇는다(한 계정은 번호 하나 — 새로 적으면 바뀐다).
// - 다음 주문: 묶음에 저장한 배송지가 없으면 묶음 구성원의 전화번호 키(문자찜)와 이은 계정에서 번호를 찾고, 연락처가 있는 번호가 정확히 하나일 때만 쓴다
//   (둘 이상이면 누구인지 애매해 쓰지 않는다 — CR-0 6과 같은 쪽). 보이기만 하고 묶음에 복사하지 않는다 — 택배는 판매자가 확인해야 접수(CR-4와 같다).
// - 연락처는 마스터 키로 암호화(판매자 ID를 함께 묶는다). 로그에는 판매자 ID·오류 종류만, 번호·키·이름은 남기지 않는다.
// - 마지막으로 쓴 지 1년이 지나면 지운다(영수증 문자 번호 기억과 같은 기간·청소).
import { randomBytes } from 'node:crypto'
import { buyerPhoneKeys, getBuyer, normalizePhone, type EngineState } from '@livejjim/core'
import { and, eq, inArray, lt } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { buyerContactLinks, buyerContacts } from '../db/schema.ts'
import { errorKind, type LogSink } from '../log.ts'
import { openSellerText, sealSellerText } from '../secrets.ts'
import { iso, type Clock } from '../time.ts'

const PURPOSE = 'buyer-contact'
/** 마지막으로 쓴 지 이만큼 지나면 지운다 (영수증 문자 번호 기억 PHONE_KEEP_MS와 같다) */
export const CONTACT_KEEP_MS = 365 * 24 * 60 * 60 * 1000
/** 연락처 ID 머리 (장부 줄 ID — 32자리 16진수 — 와 헷갈리지 않게) */
export const CONTACT_ID_PREFIX = 'bk_'
/** 연락처 ID 모양 */
export const CONTACT_ID_RE = /^bk_[0-9a-f]{32}$/

/** 다섯 칸 (배송지 여섯 칸에서 배송 메모를 뺀 것 — 장부 연락처와 같다) */
export interface BookContact {
  readonly name: string
  readonly phone: string
  readonly address: string
  readonly detail: string
  readonly zip: string
}

export interface BookEntry extends BookContact {
  readonly id: string
  /** 고친 시각 (UTC ISO — [배송지 확인]에 그대로 보낸다) */
  readonly updatedAt: string
}

/** 묶음 하나의 찾을 열쇠: 구성원의 전화번호 키(문자찜)·채팅 손님 계정 */
export interface BundleKeys {
  readonly phoneKeys: readonly string[]
  readonly chatKeys: readonly string[]
}

export interface ContactBookDeps {
  readonly db: Db
  readonly clock: Clock
  readonly masterKey: Buffer
  /** 정규화한 번호 → 엔진 전화번호 키 (판매자 키 HMAC) */
  readonly phoneKeyFor: (sellerId: string, normalizedPhone: string) => Promise<string>
  readonly log: LogSink
}

const SMS_PREFIX = 'sms:'

/** 묶음(지금의 구매자 + 합친 구매자)의 찾을 열쇠 — 상태만으로 정해진다 (순수) */
export function bundleKeysOf(state: EngineState, buyer: string): BundleKeys {
  const info = getBuyer(state, buyer)
  if (info === null) return { phoneKeys: [], chatKeys: [] }
  const chatKeys: string[] = []
  for (const id of [buyer, ...info.merged]) {
    const member = getBuyer(state, id)
    if (member !== null && member.kind === 'youtube' && !id.startsWith(SMS_PREFIX) && !chatKeys.includes(id)) chatKeys.push(id)
  }
  return { phoneKeys: buyerPhoneKeys(state, buyer), chatKeys }
}

/** 찾은 번호 키 중 연락처가 있는 것이 정확히 하나면 그 키 (순수 — 둘 이상·없음은 null) */
export function onlyKey(candidates: Iterable<string>, has: (key: string) => boolean): string | null {
  const found = new Set<string>()
  for (const key of candidates) if (has(key)) found.add(key)
  return found.size === 1 ? ([...found][0] as string) : null
}

const clean = (contact: BookContact): BookContact => ({ name: contact.name.trim(), phone: contact.phone, address: contact.address.trim(), detail: contact.detail.trim(), zip: contact.zip.trim() })

export class ContactBook {
  readonly #deps: ContactBookDeps

  constructor(deps: ContactBookDeps) {
    this.#deps = deps
  }

  #seal(sellerId: string, contact: BookContact): string {
    return sealSellerText(this.#deps.masterKey, PURPOSE, sellerId, JSON.stringify(clean(contact)))
  }

  #open(sellerId: string, sealed: string): BookContact | null {
    try {
      const value = JSON.parse(openSellerText(this.#deps.masterKey, PURPOSE, sellerId, sealed)) as Partial<BookContact>
      if (typeof value.name !== 'string' || typeof value.phone !== 'string' || typeof value.address !== 'string') return null
      return { name: value.name, phone: value.phone, address: value.address, detail: typeof value.detail === 'string' ? value.detail : '', zip: typeof value.zip === 'string' ? value.zip : '' }
    } catch {
      return null
    }
  }

  /** 번호 → 전화번호 키 (휴대폰 번호가 아니면 null) */
  async keyOf(sellerId: string, phone: string): Promise<string | null> {
    const normalized = normalizePhone(phone)
    return normalized === null ? null : this.#deps.phoneKeyFor(sellerId, normalized)
  }

  /**
   * 판매자가 적은(또는 확인한) 연락처 기억: 그 번호의 연락처를 새 값으로, 묶음의 채팅 손님 계정을 그 번호에 잇는다.
   * 휴대폰 번호가 아니거나 성함·주소가 비면 하지 않는다. 실패해도 배송지 저장은 그대로 — 로그만(값 없음). 범위 트랜잭션 밖에서 부른다
   */
  async remember(sellerId: string, keys: BundleKeys, contact: BookContact): Promise<void> {
    const normalized = normalizePhone(contact.phone)
    if (normalized === null || contact.name.trim() === '' || contact.address.trim() === '') return
    try {
      const phoneKey = await this.#deps.phoneKeyFor(sellerId, normalized)
      const now = new Date(this.#deps.clock.now())
      const contactEnc = this.#seal(sellerId, { ...contact, phone: normalized })
      await this.#deps.db.transaction(async (tx) => {
        await tx
          .insert(buyerContacts)
          .values({ sellerId, id: `${CONTACT_ID_PREFIX}${randomBytes(16).toString('hex')}`, phoneKey, contactEnc, updatedAt: now })
          .onConflictDoUpdate({ target: [buyerContacts.sellerId, buyerContacts.phoneKey], set: { contactEnc, updatedAt: now } })
        for (const buyerKey of keys.chatKeys) {
          await tx
            .insert(buyerContactLinks)
            .values({ sellerId, buyerKey, phoneKey, updatedAt: now })
            .onConflictDoUpdate({ target: [buyerContactLinks.sellerId, buyerContactLinks.buyerKey], set: { phoneKey, updatedAt: now } })
        }
      })
    } catch (error) {
      this.#deps.log({ level: 'warn', code: 'BUYER_CONTACT_SAVE_FAILED', seller: sellerId, errorKind: errorKind(error) })
    }
  }

  /** 묶음마다 이어 쓸 연락처 (연락처가 있는 번호가 정확히 하나인 묶음만). db는 트랜잭션이어도 된다 */
  async forBundles(db: Db, sellerId: string, bundles: ReadonlyMap<string, BundleKeys>): Promise<Map<string, BookEntry>> {
    const out = new Map<string, BookEntry>()
    const chat = [...new Set([...bundles.values()].flatMap((keys) => keys.chatKeys))]
    const linked = new Map<string, string>()
    if (chat.length > 0) {
      const rows = await db
        .select({ buyerKey: buyerContactLinks.buyerKey, phoneKey: buyerContactLinks.phoneKey })
        .from(buyerContactLinks)
        .where(and(eq(buyerContactLinks.sellerId, sellerId), inArray(buyerContactLinks.buyerKey, chat)))
      for (const row of rows) linked.set(row.buyerKey, row.phoneKey)
    }
    const candidates = new Map<string, string[]>()
    for (const [buyer, keys] of bundles) {
      const list = [...keys.phoneKeys, ...keys.chatKeys.map((key) => linked.get(key)).filter((key): key is string => key !== undefined)]
      if (list.length > 0) candidates.set(buyer, list)
    }
    const all = [...new Set([...candidates.values()].flat())]
    if (all.length === 0) return out
    const rows = await db
      .select({ id: buyerContacts.id, phoneKey: buyerContacts.phoneKey, contactEnc: buyerContacts.contactEnc, updatedAt: buyerContacts.updatedAt })
      .from(buyerContacts)
      .where(and(eq(buyerContacts.sellerId, sellerId), inArray(buyerContacts.phoneKey, all)))
    const byKey = new Map<string, BookEntry>()
    for (const row of rows) {
      const contact = this.#open(sellerId, row.contactEnc)
      if (contact !== null) byKey.set(row.phoneKey, { ...contact, id: row.id, updatedAt: iso(row.updatedAt.getTime()) })
    }
    for (const [buyer, list] of candidates) {
      const key = onlyKey(list, (candidate) => byKey.has(candidate))
      if (key !== null) out.set(buyer, byKey.get(key) as BookEntry)
    }
    return out
  }

  /** 한 묶음 (상태로 열쇠를 만든다) */
  async forBundle(db: Db, sellerId: string, state: EngineState, buyer: string): Promise<BookEntry | null> {
    return (await this.forBundles(db, sellerId, new Map([[buyer, bundleKeysOf(state, buyer)]]))).get(buyer) ?? null
  }

  /** 번호로 찾기 (판매자가 손님 정보에 번호를 적을 때 — 번호 전체가 같아야 한다). 없거나 휴대폰 번호가 아니면 null */
  async byPhone(sellerId: string, phone: string): Promise<BookEntry | null> {
    const phoneKey = await this.keyOf(sellerId, phone)
    if (phoneKey === null) return null
    const rows = await this.#deps.db
      .select({ id: buyerContacts.id, contactEnc: buyerContacts.contactEnc, updatedAt: buyerContacts.updatedAt })
      .from(buyerContacts)
      .where(and(eq(buyerContacts.sellerId, sellerId), eq(buyerContacts.phoneKey, phoneKey)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    const contact = this.#open(sellerId, row.contactEnc)
    return contact === null ? null : { ...contact, id: row.id, updatedAt: iso(row.updatedAt.getTime()) }
  }

  /** 1년 넘게 쓰지 않은 연락처·계정 잇기 지우기 (하루 한 번 청소에서). 지운 연락처 수 */
  async sweep(): Promise<number> {
    const before = new Date(this.#deps.clock.now() - CONTACT_KEEP_MS)
    await this.#deps.db.delete(buyerContactLinks).where(lt(buyerContactLinks.updatedAt, before))
    const rows = await this.#deps.db.delete(buyerContacts).where(lt(buyerContacts.updatedAt, before)).returning({ id: buyerContacts.id })
    return rows.length
  }
}
