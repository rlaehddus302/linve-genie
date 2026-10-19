// 판매자 작업 (AC-S04-21·27·31·33·50~52). 판정은 모두 packages/core가 한다 — 여기서는 이벤트를 만들고 기록 경로에 넘기고 조회 함수를 부른다.
import {
  checkSettings,
  getBuyer,
  isValidDate,
  listBroadcasts,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  normalizePhone,
  phoneLast4,
  resolveSettings,
  type EngineState,
  type SaleSettings,
} from '@livejjim/core'
import { eq } from 'drizzle-orm'
import { API_EVENTS, CHAT_FIELDS, hasControlChar, isPlainObject, own, ownKeys } from './api-fields.ts'
import type { Db } from './db/database.ts'
import { sellers } from './db/schema.ts'
import type { FieldProblem } from './errors.ts'
import type { IdSource } from './ids.ts'
import { fieldMessage, safeFieldName, unknownFieldProblems } from './messages.ts'
import type { AttentionItem } from './runtime.ts'
import { openSellerKey, phoneKeyOf } from './secrets.ts'
import {
  eventByRequestId,
  findBroadcast,
  findScopeId,
  findSeller,
  historyRows,
  insertBroadcast,
  listBroadcastRows,
  markBroadcastEnded,
  previousScopeDate,
  scopeSeqs,
} from './store.ts'
import { iso, kstDate, kstTime, withIsoTimes, type Clock } from './time.ts'
import { resultOf, type Actor, type Draft, type Rejection, type ScopeWriter, type WriteOutcome, type WriteResult } from './writer.ts'

/** 차단 이어받기 사유 (AC-S04-27) */
export const INHERITED_BLOCK_REASON = '이전 방송에서 차단한 시청자'

const TITLE_MAX = 100

export interface ServiceOptions {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly masterKey: Buffer
  readonly clock: Clock
  readonly ids: IdSource
}

export type ChatIngestOutcome =
  | { readonly status: 'recorded'; readonly date: string; readonly seq: number; readonly changed: boolean; readonly failed: boolean; readonly effects: readonly string[] }
  | { readonly status: 'duplicate' }
  | { readonly status: 'rejected'; readonly problems: readonly FieldProblem[] }
  | { readonly status: 'not_found' }
  | { readonly status: 'save_failed' }

export interface ScopeView {
  readonly date: string
  readonly seq: number
  readonly broadcasts: unknown
  readonly products: unknown
  readonly claims: unknown
  readonly pending: unknown
  readonly buyers: unknown
  readonly settlements: unknown
  readonly effects: unknown
  readonly cancelRequests: unknown
  readonly attention: readonly AttentionItem[]
}

export interface HistoryItem {
  readonly seq: number
  readonly type: string
  readonly at: string
  readonly receivedAt: string
  readonly actor: { readonly kind: string; readonly loginId: string | null }
  readonly reason: string | null
  readonly fields: Readonly<Record<string, unknown>>
  readonly failed: boolean
}

const rejection = (status: number, code: Rejection['code'], message: string, problems: readonly FieldProblem[] = []): Rejection => ({ status, code, message, problems })
const invalidInput = (problems: readonly FieldProblem[]): Rejection => rejection(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems)

/** 엔진 상태의 차단 목록 (구매자로 기록되지 않은 채널 차단도 포함). 영속 맵의 잎을 훑는다 */
function blockedIds(state: EngineState): string[] {
  const ids: string[] = []
  for (const branch of Object.values(state.blocked.root)) {
    for (const twig of Object.values(branch)) {
      for (const leaf of Object.values(twig)) for (const [id, value] of leaf) if (value === true) ids.push(id)
    }
  }
  return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export class Service {
  readonly #options: ServiceOptions
  readonly #sellerKeys = new Map<string, Buffer>()

  constructor(options: ServiceOptions) {
    this.#options = options
  }

  get writer(): ScopeWriter {
    return this.#options.writer
  }

  async #sellerKey(sellerId: string): Promise<Buffer> {
    const cached = this.#sellerKeys.get(sellerId)
    if (cached !== undefined) return cached
    const seller = await findSeller(this.#options.db, sellerId)
    if (seller === null) throw new Error('판매자가 없다')
    const key = openSellerKey(this.#options.masterKey, sellerId, seller.phoneKeyEnc)
    this.#sellerKeys.set(sellerId, key)
    return key
  }

  // ── 설정 (AC-S04-50) ──────────────────────────────────────────────────

  async #settingsOverride(db: Db, sellerId: string): Promise<Record<string, unknown>> {
    const seller = await findSeller(db, sellerId)
    if (seller === null) throw new Error('판매자가 없다')
    const parsed: unknown = JSON.parse(seller.settings)
    return isPlainObject(parsed) ? parsed : {}
  }

  async settings(sellerId: string): Promise<SaleSettings> {
    return resolveSettings(await this.#settingsOverride(this.#options.db, sellerId))
  }

  /** 설정 일부 바꾸기. 코어 checkSettings로 검사하고, MANUAL은 아직 지원하지 않는다. 바꾼 설정은 다음에 만드는 방송부터 들어간다 */
  async updateSettings(sellerId: string, body: unknown): Promise<{ ok: true; settings: SaleSettings } | { ok: false; rejection: Rejection }> {
    if (!isPlainObject(body)) return { ok: false, rejection: rejection(400, 'NOT_JSON', '보낸 내용의 형식이 올바르지 않아요.') }
    const extra = ownKeys(body).filter((key) => key !== 'settings')
    if (extra.length > 0) return { ok: false, rejection: rejection(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra)) }
    const changes = own(body, 'settings')
    const problems = checkSettings(changes).map((problem) => {
      const key = problem.key === null ? null : safeFieldName(problem.key)
      return { field: key === null ? 'settings' : `settings.${key}`, message: problem.message }
    })
    if (problems.length > 0) return { ok: false, rejection: invalidInput(problems) }
    const record = changes as Record<string, unknown>
    if (own(record, 'settlement.groupBy') === 'MANUAL') {
      return { ok: false, rejection: rejection(400, 'NOT_SUPPORTED', '아직 지원하지 않는 설정이에요.', [{ field: 'settings.settlement.groupBy', message: '아직 지원하지 않아요.' }]) }
    }
    const saved = await this.#options.db.transaction(async (tx) => {
      await tx.select({ id: sellers.id }).from(sellers).where(eq(sellers.id, sellerId)).for('update')
      const next = { ...(await this.#settingsOverride(tx, sellerId)), ...record }
      if (checkSettings(next).length > 0 || next['settlement.groupBy'] === 'MANUAL') return null
      await tx.update(sellers).set({ settings: JSON.stringify(next) }).where(eq(sellers.id, sellerId))
      return next
    })
    if (saved === null) return { ok: false, rejection: invalidInput([{ field: 'settings', message: '판매 규칙 설정을 확인해 주세요.' }]) }
    return { ok: true, settings: resolveSettings(saved) }
  }

  // ── 요청 번호 (AC-S04-25) ─────────────────────────────────────────────

  /** 그 요청 번호로 이미 기록한 결과 (없으면 null). 같은 요청 번호면 내용이 달라도 처음 결과를 돌려준다 */
  async priorResult(sellerId: string, requestId: string): Promise<WriteResult | null> {
    const record = await eventByRequestId(this.#options.db, sellerId, requestId)
    return record === null ? null : resultOf(this.#options.db, sellerId, record)
  }

  // ── 방송 만들기·끝내기 (AC-S04-21·27) ─────────────────────────────────

  async createBroadcast(sellerId: string, actor: Actor, requestId: string, input: { date?: string; title?: string }): Promise<WriteOutcome> {
    const { writer, db, ids } = this.#options
    const date = input.date ?? kstDate(this.#options.clock.now())
    const settings = resolveSettings(await this.#settingsOverride(db, sellerId))
    const b = ids.broadcast()
    return writer.write({
      sellerId,
      date,
      createScope: true,
      requestId,
      prepare: async () => {
        const previous = await previousScopeDate(db, sellerId, date)
        if (previous === null) return []
        const state = (await writer.read(sellerId, previous)).state
        return blockedIds(state).filter((id) => !id.startsWith('sms:'))
      },
      build: (ctx, prepared) => {
        const title = input.title ?? `${String(listBroadcasts(ctx.state).length + 1)}부`
        const drafts: Draft[] = [{ fields: { type: 'broadcast.start', b, date, title, settings: { ...settings } }, actor, requestId }]
        if (ctx.isNewScope) {
          for (const buyer of (prepared as string[] | undefined) ?? []) {
            drafts.push({ fields: { type: 'host.blockBuyer', buyer, reason: INHERITED_BLOCK_REASON }, actor: { kind: 'server' } })
          }
        }
        return drafts
      },
      afterInsert: async (tx, scopeId, records, now) => {
        const first = records[0]
        if (first === undefined || !first.changed) return
        const event = first.event as unknown as { b: string; date: string; title: string }
        await insertBroadcast(tx, { id: event.b, sellerId, scopeId, date: event.date, title: event.title, startSeq: first.seq, now })
      },
    })
  }

  /** 방송 만들기 요청 본문 검사 (날짜·제목) */
  static broadcastInput(body: Record<string, unknown>): { ok: true; date?: string; title?: string } | { ok: false; rejection: Rejection } {
    const problems: FieldProblem[] = []
    const date = own(body, 'date')
    const title = own(body, 'title')
    if (date !== undefined && !isValidDate(date)) problems.push({ field: 'date', message: fieldMessage('date') })
    if (title !== undefined && (typeof title !== 'string' || title.trim() === '' || title.length > TITLE_MAX || hasControlChar(title))) {
      problems.push({ field: 'title', message: `제목은 ${String(TITLE_MAX)}자 이하의 글자로 적어 주세요.` })
    }
    if (problems.length > 0) return { ok: false, rejection: invalidInput(problems) }
    return { ok: true, ...(date === undefined ? {} : { date: date as string }), ...(title === undefined ? {} : { title: (title as string).trim() }) }
  }

  async endBroadcast(sellerId: string, actor: Actor, requestId: string, broadcastId: string): Promise<WriteOutcome> {
    const row = await findBroadcast(this.#options.db, sellerId, broadcastId)
    if (row === null) return { kind: 'not_found' }
    return this.#options.writer.write({
      sellerId,
      date: row.date,
      createScope: false,
      requestId,
      build: () => [{ fields: { type: 'broadcast.end', b: broadcastId }, actor, requestId }],
      afterInsert: async (tx, _scopeId, records) => {
        const first = records[0]
        if (first !== undefined && first.changed) await markBroadcastEnded(tx, sellerId, broadcastId, new Date(first.event.at))
      },
    })
  }

  // ── 이벤트 쓰기 (AC-S04-31·51) ────────────────────────────────────────

  /**
   * 화면이 보낸 이벤트 쓰기. body = { requestId, type, ...그 종류의 필드 }, queryDate = 방송이 없는 종류의 범위 날짜.
   * 요청 번호는 호출하는 쪽(API)이 이미 확인했다.
   */
  async writeEvent(
    sellerId: string,
    actor: Actor,
    requestId: string,
    body: Record<string, unknown>,
    queryDate: string | undefined,
  ): Promise<WriteOutcome | { kind: 'phone'; outcome: WriteOutcome; phoneLast4: string | null }> {
    const type = own(body, 'type')
    const spec = typeof type === 'string' && Object.hasOwn(API_EVENTS, type) ? API_EVENTS[type] : undefined
    if (spec === undefined || typeof type !== 'string') return { kind: 'rejected', rejection: invalidInput([{ field: 'type', message: fieldMessage('type') }]) }
    const allowed = new Set(['requestId', 'type', ...spec.fields])
    const unknown = ownKeys(body).filter((key) => !allowed.has(key))
    if (unknown.length > 0) return { kind: 'rejected', rejection: rejection(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(unknown)) }
    const fields: Record<string, unknown> = { type }
    for (const field of spec.fields) {
      const value = own(body, field)
      if (value !== undefined && field !== 'phone') Object.defineProperty(fields, field, { value, enumerable: true, writable: true, configurable: true })
    }

    // 범위 정하기: 방송이 있는 종류는 그 방송의 날짜, 없는 종류는 요청에 적은 날짜 (D-069)
    let date: string
    if (spec.broadcast) {
      if (queryDate !== undefined) return { kind: 'rejected', rejection: invalidInput([{ field: 'date', message: '방송이 있는 입력에는 날짜를 따로 적지 않아요.' }]) }
      const b = own(body, 'b')
      if (typeof b !== 'string' || b === '') return { kind: 'rejected', rejection: invalidInput([{ field: 'b', message: fieldMessage('b') }]) }
      const row = await findBroadcast(this.#options.db, sellerId, b)
      if (row === null) return { kind: 'not_found' }
      date = row.date
    } else {
      if (queryDate === undefined || !isValidDate(queryDate)) return { kind: 'rejected', rejection: invalidInput([{ field: 'date', message: "어느 날짜의 입력인지 '2026-10-18'처럼 적어 주세요." }]) }
      date = queryDate
      const eventDate = own(body, 'date')
      if (type.startsWith('settlement.') && isValidDate(eventDate) && eventDate !== date) {
        return { kind: 'rejected', rejection: invalidInput([{ field: 'date', message: '고른 날짜와 같은 날짜만 적을 수 있어요.' }]) }
      }
    }

    if (type === 'sms') return this.#writeSms(sellerId, actor, requestId, date, body, fields)
    return this.#options.writer.write({
      sellerId,
      date,
      createScope: false,
      requestId,
      build: () => [{ fields, actor, requestId }],
    })
  }

  /** 문자찜: 허용 필드로 새 이벤트를 만든다. ref는 서버가 만들고, 전화번호는 판매자 키의 HMAC과 뒤 4자리로만 담는다 (AC-S04-31) */
  async #writeSms(
    sellerId: string,
    actor: Actor,
    requestId: string,
    date: string,
    body: Record<string, unknown>,
    fields: Record<string, unknown>,
  ): Promise<WriteOutcome | { kind: 'phone'; outcome: WriteOutcome; phoneLast4: string | null }> {
    const phone = own(body, 'phone')
    if (phone !== undefined && typeof phone !== 'string') return { kind: 'rejected', rejection: invalidInput([{ field: 'phone', message: fieldMessage('phone') }]) }
    const normalized = typeof phone === 'string' ? normalizePhone(phone) : null
    const phoneFields = normalized === null ? {} : { phoneKey: phoneKeyOf(await this.#sellerKey(sellerId), normalized), phoneLast4: phoneLast4(normalized) }
    const ref = this.#smsRef()
    const outcome = await this.#options.writer.write({
      sellerId,
      date,
      createScope: false,
      requestId,
      build: (ctx) => [
        {
          fields: { ...fields, ref, received: own(body, 'received') ?? kstTime(ctx.at), ...phoneFields },
          actor,
          requestId,
          smsRef: ref,
          validate: (state, event) => {
            const buyer = (event as unknown as { buyer?: string }).buyer
            if (buyer !== undefined && getBuyer(state, buyer) === null) {
              return rejection(400, 'BUYER_NOT_FOUND', '고른 구매자를 찾지 못했어요.', [{ field: 'buyer', message: '고른 구매자를 찾지 못했어요.' }])
            }
            return null
          },
        },
      ],
    })
    return { kind: 'phone', outcome, phoneLast4: normalized === null ? null : phoneLast4(normalized) }
  }

  /** 문자찜 ref (영문만이라 휴대폰 번호 모양이 될 수 없다. 바꿔 끼운 ID 생성기가 숫자를 섞어도 번호 모양이면 다시 만든다) */
  #smsRef(): string {
    for (let i = 0; i < 10; i++) {
      const ref = this.#options.ids.smsRef()
      if (/^[A-Za-z0-9_-]{1,64}$/.test(ref) && normalizePhone(ref) === null) return ref
    }
    throw new Error('문자찜 ref를 만들지 못했다')
  }

  // ── 채팅 수집 함수 (AC-S04-33) ────────────────────────────────────────

  /**
   * 채팅 한 건을 받는다 (S05 리허설·S10 수집기가 쓴다 — 브라우저 API는 없다). 허용 필드로 새 엔진 이벤트를 만들어 같은 기록 경로를 탄다.
   * 같은 (판매자, 방송, 메시지 ID)는 한 번만 기록한다. 조치자는 수집기다.
   */
  async ingestChat(sellerId: string, input: unknown): Promise<ChatIngestOutcome> {
    if (!isPlainObject(input)) return { status: 'rejected', problems: [{ field: null, message: '채팅은 객체여야 해요.' }] }
    const unknown = ownKeys(input).filter((key) => !CHAT_FIELDS.includes(key))
    if (unknown.length > 0) return { status: 'rejected', problems: unknownFieldProblems(unknown) }
    const b = own(input, 'b')
    const id = own(input, 'id')
    if (typeof b !== 'string' || b === '') return { status: 'rejected', problems: [{ field: 'b', message: fieldMessage('b') }] }
    if (typeof id !== 'string' || id === '' || id.length > 256 || hasControlChar(id)) return { status: 'rejected', problems: [{ field: 'id', message: '메시지 ID를 확인해 주세요.' }] }
    const row = await findBroadcast(this.#options.db, sellerId, b)
    if (row === null) return { status: 'not_found' }
    const fields: Record<string, unknown> = { type: 'chat' }
    for (const field of CHAT_FIELDS) {
      const value = own(input, field)
      if (value !== undefined) fields[field] = value
    }
    const outcome = await this.#options.writer.write({
      sellerId,
      date: row.date,
      createScope: false,
      requestId: null,
      chat: { b, id },
      build: () => [{ fields, actor: { kind: 'collector' }, chat: { b, id } }],
    })
    switch (outcome.kind) {
      case 'ok':
        return { status: 'recorded', date: outcome.result.date, seq: outcome.result.seq, changed: outcome.result.changed, failed: outcome.result.failed, effects: outcome.result.effects }
      case 'duplicate':
        return { status: 'duplicate' }
      case 'rejected':
        return { status: 'rejected', problems: outcome.rejection.problems }
      case 'not_found':
        return { status: 'not_found' }
      case 'save_failed':
        return { status: 'save_failed' }
    }
  }

  // ── 조회 (AC-S04-52) ──────────────────────────────────────────────────

  async broadcasts(sellerId: string): Promise<{ id: string; date: string; title: string; ended: boolean; endedAt: string | null }[]> {
    const rows = await listBroadcastRows(this.#options.db, sellerId)
    return rows.map((row) => ({ id: row.id, date: row.date, title: row.title, ended: row.endedAt !== null, endedAt: row.endedAt === null ? null : row.endedAt.toISOString() }))
  }

  scopes(sellerId: string): Promise<{ date: string; seq: number }[]> {
    return scopeSeqs(this.#options.db, sellerId)
  }

  /** 범위(날짜) 조회. 값은 코어 조회 함수의 결과(시각은 ISO). 없는 범위면 null */
  async scopeView(sellerId: string, date: string): Promise<ScopeView | null> {
    const runtime = await this.#options.writer.read(sellerId, date)
    if (runtime.seq === 0) return null
    const state = runtime.state
    return withIsoTimes({
      date,
      seq: runtime.seq,
      broadcasts: listBroadcasts(state),
      products: listProducts(state),
      claims: listClaims(state),
      pending: listPending(state),
      buyers: listBuyers(state),
      settlements: listSettlements(state),
      effects: listEffects(state),
      cancelRequests: listCancelRequests(state),
      attention: [...runtime.attention],
    })
  }

  /** 이력 조회: seq 순, after 뒤부터 limit개. 전화번호 키는 빼고 낸다. 없는 범위면 null */
  async history(sellerId: string, date: string, after: number, limit: number): Promise<HistoryItem[] | null> {
    const scopeId = await findScopeId(this.#options.db, sellerId, date)
    if (scopeId === null) return null
    const rows = await historyRows(this.#options.db, sellerId, scopeId, after, limit)
    if (rows.length === 0 && after === 0) return null
    return rows.map((row) => {
      const event = JSON.parse(row.body) as Record<string, unknown>
      const fields: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(event)) {
        if (key === 'type' || key === 'seq' || key === 'at' || key === 'reason' || key === 'phoneKey') continue
        Object.defineProperty(fields, key, { value, enumerable: true, writable: true, configurable: true })
      }
      const reason = event.reason
      return {
        seq: row.seq,
        type: row.type,
        at: iso(Number(event.at)),
        receivedAt: row.receivedAt.toISOString(),
        actor: { kind: row.actor, loginId: row.actor === 'account' ? row.loginId : null },
        reason: typeof reason === 'string' ? reason : null,
        fields,
        failed: row.failed,
      }
    })
  }
}
