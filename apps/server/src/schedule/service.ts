// 방송 일정·공개 일정 페이지·방송 알림 신청 (SPEC SCH-01~SCH-03, MESSAGE_RULES MR-6, KP1 AC-KP1-20~24).
// - 모든 쿼리에 판매자 ID 조건을 건다(공개 페이지는 토큰 해시로 판매자를 찾은 뒤 그 판매자 조건으로만).
// - 공개 토큰: 32바이트 base64url(43자). 찾기는 SHA-256 base64url(token_hash), 판매자 화면 주소용 원문은 판매자·용도로 묶은 암호문(token_enc).
//   끄면 토큰 칸을 지우고(옛 주소 404), 다시 켜거나 새로 만들면 새 토큰.
// - 알림 신청 번호: 원문은 판매자·용도로 묶은 암호문, 같은 번호 찾기는 전화번호 키 = phoneKeyOf(판매자 키, 'alert:' + 정규화 번호)
//   (손님 표지 `p:` 키와 이어지지 않게 — MR-8 구매를 동의로 보지 않음). 그만 받기면 두 칸을 바로 null. 번호는 응답·로그에 없다.
// - 문자·알림톡을 보내는 길이 없다(MR-0 1 — KP1의 모든 신청은 PENDING). 엔진 이벤트·발송함을 쓰지 않는다.
import { randomBytes } from 'node:crypto'
import { and, asc, count, eq, gte, inArray, isNotNull, or, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { alertConsents, alertSubscribers, scheduleItems, schedulePages } from '../db/schema.ts'
import { consentStatus, MR_CONSENT_1, type ConsentRecordType } from '../messaging/rules.ts'
import { kstIso } from '../deposit/calendar.ts'
import { receiptTokenHash } from '../receipt-links.ts'
import { openSellerKey, openSellerText, phoneKeyOf, SecretError, sealSellerText } from '../secrets.ts'
import { findSeller } from '../store.ts'
import type { Clock } from '../time.ts'
import { SCHEDULE_MAX, type ScheduleItemInput, type SchedulePageInput } from './rules.ts'

export const SCHEDULE_TOKEN_PURPOSE = 'schedule-page-token'
export const ALERT_PHONE_PURPOSE = 'alert-phone'
/** 공개 주소 토큰 모양 (32바이트 base64url) */
export const SCHEDULE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export const ALERT_ROUTE = 'SCHEDULE_PAGE'

export interface ScheduleItemView {
  readonly id: string
  /** KST 날짜 YYYY-MM-DD */
  readonly date: string
  /** KST 시각 HH:MM */
  readonly time: string
  /** UTC ISO */
  readonly startsAt: string
  readonly title: string
  readonly intro: string
}

export interface ScheduleView {
  readonly page: { readonly enabled: boolean; readonly url: string | null; readonly channelUrl: string | null }
  /** 다가오는 것만, 시각 순 */
  readonly items: ScheduleItemView[]
  readonly max: typeof SCHEDULE_MAX
}

export interface AlertCounts {
  readonly pending: number
  readonly active: number
  readonly withdrawn: number
}

/** 공개 페이지에 그릴 것 (가게 이름은 부르는 쪽이 읽는다) */
export interface PublicSchedule {
  readonly sellerId: string
  readonly channelUrl: string | null
  readonly items: ScheduleItemView[]
}

export interface ScheduleDeps {
  readonly db: Db
  readonly clock: Clock
  readonly masterKey: Buffer
  /** 화면 앱 주소 (공개 주소 앞부분) */
  readonly appOrigin: string
}

export type ItemOutcome = { readonly kind: 'ok'; readonly view: ScheduleView } | { readonly kind: 'not_found' } | { readonly kind: 'full' }

const newId = () => randomBytes(16).toString('hex')
const newToken = () => randomBytes(32).toString('base64url')
/** 판매자 일정 직렬 처리 키 (다가오는 일정 10개 상한을 동시 요청에도 지킨다) */
const scheduleLockKey = (sellerId: string) => sql`hashtextextended(${`${sellerId}/schedule`}, 0)`
/** 판매자 알림 신청 직렬 처리 키 (같은 번호의 신청·그만 받기를 차례로) */
const alertLockKey = (sellerId: string) => sql`hashtextextended(${`${sellerId}/alerts`}, 0)`

function itemView(row: { id: string; startsAt: Date; title: string; intro: string }): ScheduleItemView {
  const text = kstIso(row.startsAt.getTime())
  return { id: row.id, date: text.slice(0, 10), time: text.slice(11, 16), startsAt: row.startsAt.toISOString(), title: row.title, intro: row.intro }
}

/** 한 번호의 동의 기록 → 지금 상태 (MR-6 순수 함수) */
export function alertStatusOf(now: number, records: readonly { type: string; at: Date }[]): ReturnType<typeof consentStatus> {
  return consentStatus({ now: new Date(now).toISOString(), records: records.map((record) => ({ type: record.type as ConsentRecordType, at: record.at.toISOString() })) })
}

export class ScheduleService {
  readonly #deps: ScheduleDeps

  constructor(deps: ScheduleDeps) {
    this.#deps = deps
  }

  /** 서버 시계 지금 (UTC 밀리초 — 지난 시각 검사) */
  now(): number {
    return this.#deps.clock.now()
  }

  async #upcoming(sellerId: string): Promise<ScheduleItemView[]> {
    const now = new Date(this.#deps.clock.now())
    const rows = await this.#deps.db
      .select({ id: scheduleItems.id, startsAt: scheduleItems.startsAt, title: scheduleItems.title, intro: scheduleItems.intro })
      .from(scheduleItems)
      .where(and(eq(scheduleItems.sellerId, sellerId), gte(scheduleItems.startsAt, now)))
      .orderBy(asc(scheduleItems.startsAt), asc(scheduleItems.createdAt), asc(scheduleItems.id))
    return rows.map(itemView)
  }

  /** 판매자 화면의 일정 설정 */
  async view(sellerId: string): Promise<ScheduleView> {
    const rows = await this.#deps.db.select().from(schedulePages).where(eq(schedulePages.sellerId, sellerId)).limit(1)
    const row = rows[0]
    let url: string | null = null
    if (row?.enabled === true && row.tokenEnc !== null) {
      try {
        url = `${this.#deps.appOrigin}/s/${openSellerText(this.#deps.masterKey, SCHEDULE_TOKEN_PURPOSE, sellerId, row.tokenEnc)}`
      } catch (error) {
        // 풀 수 없는 원문은 없는 것과 같다 (주소를 다시 만들면 된다)
        if (!(error instanceof SecretError)) throw error
      }
    }
    return { page: { enabled: row?.enabled === true, url, channelUrl: row?.channelUrl ?? null }, items: await this.#upcoming(sellerId), max: SCHEDULE_MAX }
  }

  #tokenFields(sellerId: string): { tokenHash: string; tokenEnc: string } {
    const token = newToken()
    return { tokenHash: receiptTokenHash(token), tokenEnc: sealSellerText(this.#deps.masterKey, SCHEDULE_TOKEN_PURPOSE, sellerId, token) }
  }

  /** 공개 켜기·끄기·채널 주소. 끄면 토큰을 지운다(옛 주소 404), 꺼져 있다가 켜면 새 토큰 */
  async savePage(sellerId: string, input: SchedulePageInput): Promise<ScheduleView> {
    const updatedAt = new Date(this.#deps.clock.now())
    await this.#deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${scheduleLockKey(sellerId)})`)
      const rows = await tx.select().from(schedulePages).where(eq(schedulePages.sellerId, sellerId)).limit(1)
      const current = rows[0]
      let token: { tokenHash: string | null; tokenEnc: string | null }
      if (!input.enabled) token = { tokenHash: null, tokenEnc: null }
      else if (current?.enabled === true && current.tokenHash !== null && current.tokenEnc !== null) token = { tokenHash: current.tokenHash, tokenEnc: current.tokenEnc }
      else token = this.#tokenFields(sellerId)
      const fields = { enabled: input.enabled, channelUrl: input.channelUrl, ...token, updatedAt }
      await tx.insert(schedulePages).values({ sellerId, ...fields }).onConflictDoUpdate({ target: schedulePages.sellerId, set: fields })
    })
    return this.view(sellerId)
  }

  /** 새 공개 주소 (켜져 있을 때만 — 옛 주소는 바로 404). 꺼져 있으면 그대로 */
  async renewPage(sellerId: string): Promise<ScheduleView> {
    const updatedAt = new Date(this.#deps.clock.now())
    await this.#deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${scheduleLockKey(sellerId)})`)
      await tx
        .update(schedulePages)
        .set({ ...this.#tokenFields(sellerId), updatedAt })
        .where(and(eq(schedulePages.sellerId, sellerId), eq(schedulePages.enabled, true)))
    })
    return this.view(sellerId)
  }

  /** 일정 더하기 (다가오는 일정 10개까지) */
  async addItem(sellerId: string, input: ScheduleItemInput): Promise<ItemOutcome> {
    const now = new Date(this.#deps.clock.now())
    const added = await this.#deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${scheduleLockKey(sellerId)})`)
      const counted = await tx
        .select({ n: count() })
        .from(scheduleItems)
        .where(and(eq(scheduleItems.sellerId, sellerId), gte(scheduleItems.startsAt, now)))
      if ((counted[0]?.n ?? 0) >= SCHEDULE_MAX) return false
      await tx.insert(scheduleItems).values({ id: newId(), sellerId, startsAt: new Date(input.startsAt), title: input.title, intro: input.intro, createdAt: now, updatedAt: now })
      return true
    })
    return added ? { kind: 'ok', view: await this.view(sellerId) } : { kind: 'full' }
  }

  /** 다가오는 일정 고치기 (지난 일정·남의 일정·없는 일정은 not_found) */
  async editItem(sellerId: string, id: string, input: ScheduleItemInput): Promise<ItemOutcome> {
    const now = new Date(this.#deps.clock.now())
    const changed = await this.#deps.db
      .update(scheduleItems)
      .set({ startsAt: new Date(input.startsAt), title: input.title, intro: input.intro, updatedAt: now })
      .where(and(eq(scheduleItems.sellerId, sellerId), eq(scheduleItems.id, id), gte(scheduleItems.startsAt, now)))
      .returning({ id: scheduleItems.id })
    return changed.length === 0 ? { kind: 'not_found' } : { kind: 'ok', view: await this.view(sellerId) }
  }

  /** 일정 지우기 (남의 일정·없는 일정은 not_found) */
  async deleteItem(sellerId: string, id: string): Promise<ItemOutcome> {
    const removed = await this.#deps.db
      .delete(scheduleItems)
      .where(and(eq(scheduleItems.sellerId, sellerId), eq(scheduleItems.id, id)))
      .returning({ id: scheduleItems.id })
    return removed.length === 0 ? { kind: 'not_found' } : { kind: 'ok', view: await this.view(sellerId) }
  }

  /** 상태별 신청 수 (번호 목록 없음 — AC-KP1-23) */
  async alertCounts(sellerId: string): Promise<AlertCounts> {
    const rows = await this.#deps.db
      .select({ subscriber: alertConsents.subscriberId, type: alertConsents.type, at: alertConsents.at })
      .from(alertConsents)
      .where(eq(alertConsents.sellerId, sellerId))
      .orderBy(asc(alertConsents.id))
    const bySubscriber = new Map<string, { type: string; at: Date }[]>()
    for (const row of rows) {
      const list = bySubscriber.get(row.subscriber)
      if (list === undefined) bySubscriber.set(row.subscriber, [{ type: row.type, at: row.at }])
      else list.push({ type: row.type, at: row.at })
    }
    const now = this.#deps.clock.now()
    const counts = { pending: 0, active: 0, withdrawn: 0 }
    for (const records of bySubscriber.values()) {
      const { status } = alertStatusOf(now, records)
      if (status === 'PENDING') counts.pending += 1
      else if (status === 'ACTIVE') counts.active += 1
      else if (status === 'WITHDRAWN') counts.withdrawn += 1
    }
    return counts
  }

  // ── 공개 페이지 ────────────────────────────────────────────────────────

  /** 토큰 → 켜진 공개 페이지의 판매자·다가오는 일정. 모르는·꺼진·옛 토큰은 null */
  async openPage(token: string): Promise<PublicSchedule | null> {
    if (!SCHEDULE_TOKEN_RE.test(token)) return null
    const rows = await this.#deps.db
      .select({ sellerId: schedulePages.sellerId, channelUrl: schedulePages.channelUrl })
      .from(schedulePages)
      .where(and(eq(schedulePages.tokenHash, receiptTokenHash(token)), eq(schedulePages.enabled, true)))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null
    return { sellerId: row.sellerId, channelUrl: row.channelUrl, items: await this.#upcoming(row.sellerId) }
  }

  async #phoneKey(sellerId: string, normalized: string): Promise<string> {
    const seller = await findSeller(this.#deps.db, sellerId)
    if (seller === null) throw new Error('판매자가 없다')
    return phoneKeyOf(openSellerKey(this.#deps.masterKey, sellerId, seller.phoneKeyEnc), `alert:${normalized}`)
  }

  /** 알림 받기 신청 (정규화한 휴대폰 번호, 동의 칸을 고른 뒤에만 부른다) → AGREE(MR-CONSENT-1·SCHEDULE_PAGE). 신청 시각을 돌려준다 */
  async subscribe(sellerId: string, normalized: string): Promise<number> {
    const phoneKey = await this.#phoneKey(sellerId, normalized)
    const at = this.#deps.clock.now()
    await this.#deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${alertLockKey(sellerId)})`)
      const found = await tx
        .select({ id: alertSubscribers.id })
        .from(alertSubscribers)
        .where(and(eq(alertSubscribers.sellerId, sellerId), eq(alertSubscribers.phoneKey, phoneKey)))
        .limit(1)
      let subscriberId = found[0]?.id
      if (subscriberId === undefined) {
        subscriberId = newId()
        const phoneEnc = sealSellerText(this.#deps.masterKey, ALERT_PHONE_PURPOSE, sellerId, normalized)
        await tx.insert(alertSubscribers).values({ id: subscriberId, sellerId, phoneKey, phoneEnc, createdAt: new Date(at) })
      }
      await tx.insert(alertConsents).values({ sellerId, subscriberId, type: 'AGREE', wording: MR_CONSENT_1.id, route: ALERT_ROUTE, at: new Date(at) })
    })
    return at
  }

  /** 그만 받기 (정규화한 번호). 있으면 WITHDRAW + 번호 원문·키를 바로 지움. 없어도 같은 결과(있는지 알려 주지 않는다). 처리 시각을 돌려준다 */
  async unsubscribe(sellerId: string, normalized: string): Promise<number> {
    const phoneKey = await this.#phoneKey(sellerId, normalized)
    const at = this.#deps.clock.now()
    await this.#deps.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${alertLockKey(sellerId)})`)
      const found = await tx
        .select({ id: alertSubscribers.id })
        .from(alertSubscribers)
        .where(and(eq(alertSubscribers.sellerId, sellerId), eq(alertSubscribers.phoneKey, phoneKey)))
      if (found.length === 0) return
      const ids = found.map((row) => row.id)
      await tx.insert(alertConsents).values(ids.map((subscriberId) => ({ sellerId, subscriberId, type: 'WITHDRAW', wording: null, route: null, at: new Date(at) })))
      await tx
        .update(alertSubscribers)
        .set({ phoneKey: null, phoneEnc: null })
        .where(and(eq(alertSubscribers.sellerId, sellerId), inArray(alertSubscribers.id, ids)))
    })
    return at
  }
}

/** 시험용: 번호가 남은 신청 수 (판매자 조건) */
export async function storedPhones(db: Db, sellerId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(alertSubscribers)
    .where(and(eq(alertSubscribers.sellerId, sellerId), or(isNotNull(alertSubscribers.phoneKey), isNotNull(alertSubscribers.phoneEnc))))
  return rows[0]?.n ?? 0
}
