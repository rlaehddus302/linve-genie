// 구매자 확인서 공유 링크 (RCP-02, N4b D-N4b-01·02·05·06).
// - 링크 = `<앱 주소>/r/<토큰>`, 토큰은 암호학적 무작위 32바이트의 base64url(43글자). DB에는 찾기용 SHA-256 해시와 판매자 키에서 나눈 키로
//   암호화한 토큰만 둔다(같은 링크를 다시 복사할 때 판매자 세션으로만 푼다). 토큰 원문·링크 주소는 로그·오류에 남기지 않는다.
// - (판매자, 실제 범위 날짜, 구매자 ID)마다 쓸 수 있는(끊기지 않고 끝나는 시각 전) 링크는 하나 — (판매자, 날짜) 어드바이저리 락 안에서 확인하고 만든다.
//   만든 때부터 14×24시간. 지우지 않는다(끊기만). 리허설 범위에는 만들지 않는다.
// - 만들기·전부 만들기·끊기는 요청 번호로 멱등이다 — 처음 답의 모양(링크 ID·상태·시각)을 기록해 두고 같은 요청 번호면 그 답을 다시 만든다.
// - 링크를 열 때(open)는 받은 토큰의 해시로만 기록을 찾는다. 그 구매자가 지금 그 날짜의 지금의 구매자(합쳐지지 않음)이고 품목이 있을 때만 확인서를 낸다.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { currentBuyerOf, getBuyer, getSettlement, isValidDate, type EngineState } from '@livejjim/core'
import type { ReceiptData } from '@livejjim/documents'
import { and, desc, eq, sql } from 'drizzle-orm'
import { ClosingService, type ApiProblem, type Outcome } from './closing.ts'
import type { Db } from './db/database.ts'
import { receiptLinkRequests, receiptLinks } from './db/schema.ts'
import type { LogSink } from './log.ts'
import { openSellerKey, openText, sealText } from './secrets.ts'
import { findSeller } from './store.ts'
import type { Clock } from './time.ts'
import type { ScopeWriter } from './writer.ts'

/** 링크가 열리는 기간: 만든 때부터 14×24시간 (D-N4b-01) */
export const RECEIPT_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** 토큰 모양: 32바이트의 base64url (43글자, `=` 없음) */
export const RECEIPT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export const RECEIPT_LINK_MESSAGES = {
  rehearsal: '리허설 방송은 공유 링크를 만들지 않아요.',
  noItems: '확인서를 만들 상품이 없어요.',
  request: '이미 받은 입력이에요.',
} as const

/** 링크 상태 (가장 최근 링크 기준 — 화면 문구는 화면이 정한다): 없음 · 있음 · 기간 지남 · 끊김 */
export type ReceiptLinkStatus = 'NONE' | 'ACTIVE' | 'EXPIRED' | 'REVOKED'

/** 묶음 하나의 링크 (API 답) */
export interface ReceiptLinkView {
  readonly buyer: string
  readonly status: ReceiptLinkStatus
  /** 있음일 때만 링크 주소 */
  readonly url: string | null
  /** 끝나는 시각 (ISO, 없음이면 null) */
  readonly expiresAt: string | null
  /** 끊은 시각 (끊김일 때만) */
  readonly revokedAt: string | null
}

type LinkRow = typeof receiptLinks.$inferSelect

/** 기록해 두는 답 한 줄 (토큰 원문 없음 — 링크 ID로 다시 만든다) */
interface StoredView {
  readonly buyer: string
  readonly status: ReceiptLinkStatus
  readonly linkId: string | null
  readonly expiresAt: string | null
  readonly revokedAt: string | null
}

type StoredResult = { readonly kind: 'CREATE'; readonly created: boolean; readonly link: StoredView } | { readonly kind: 'CREATE_ALL'; readonly created: number; readonly links: StoredView[] } | { readonly kind: 'REVOKE'; readonly revoked: boolean; readonly link: StoredView }

export interface ReceiptLinkDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly masterKey: Buffer
  /** 앱 주소 (링크 주소 앞 — Origin 검사와 같은 값) */
  readonly appOrigin: string
  readonly closing: ClosingService
  readonly log: LogSink
}

/** 열린 링크: 그 구매자의 지금 확인서 (만든 시각 = 연 때의 서버 시각) */
export interface OpenedLink {
  readonly sellerId: string
  readonly date: string
  readonly buyer: string
  readonly expiresAt: number
  readonly receipt: ReceiptData
  readonly createdAt: number
}

const KEY_INFO = 'livejjim/receipt-link-key/v1'
const tokenAad = (sellerId: string, linkId: string) => `livejjim/receipt-link/v1/${sellerId}/${linkId}`

/** 토큰 → 찾기용 해시 (SHA-256 base64url) */
export function receiptTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url')
}

const problem = (status: number, code: ApiProblem['code'], message: string): { kind: 'error'; error: ApiProblem } => ({ kind: 'error', error: { status, code, message } })
const ok = <T>(value: T): Outcome<T> => ({ kind: 'ok', value })
const NOT_FOUND = { kind: 'not_found' } as const

/** 그 날짜에 그 구매자가 지금의 구매자이고 품목이 있는가 (확인서를 만들 수 있는 묶음) */
export function linkableBuyer(state: EngineState, date: string, buyer: string): boolean {
  if (getBuyer(state, buyer) === null || currentBuyerOf(state, buyer) !== buyer) return false
  return getSettlement(state, buyer, date).items.length > 0
}

export class ReceiptLinkService {
  readonly #deps: ReceiptLinkDeps
  readonly #keys = new Map<string, Buffer>()

  constructor(deps: ReceiptLinkDeps) {
    this.#deps = deps
  }

  /** 판매자 키에서 나눈 링크 암호화 키 (판매자 키 = 마스터 키로 암호화해 둔 판매자 비밀 키) */
  async #key(sellerId: string): Promise<Buffer> {
    const cached = this.#keys.get(sellerId)
    if (cached !== undefined) return cached
    const seller = await findSeller(this.#deps.db, sellerId)
    if (seller === null) throw new Error('판매자가 없다')
    const key = createHmac('sha256', openSellerKey(this.#deps.masterKey, sellerId, seller.phoneKeyEnc)).update(KEY_INFO, 'utf8').digest()
    this.#keys.set(sellerId, key)
    return key
  }

  /** 범위 상태 (없는 범위면 null) */
  async #scope(sellerId: string, date: string, rehearsal: boolean): Promise<EngineState | null> {
    if (!isValidDate(date)) return null
    const runtime = await this.#deps.writer.read(sellerId, date, rehearsal)
    return runtime.seq === 0 || runtime.scopeId === null ? null : runtime.state
  }

  #status(row: LinkRow | undefined, now: number): ReceiptLinkStatus {
    if (row === undefined) return 'NONE'
    if (row.revokedAt !== null) return 'REVOKED'
    return now >= row.expiresAt.getTime() ? 'EXPIRED' : 'ACTIVE'
  }

  #stored(buyer: string, row: LinkRow | undefined, now: number): StoredView {
    const status = this.#status(row, now)
    return {
      buyer,
      status,
      linkId: row?.id ?? null,
      expiresAt: row === undefined ? null : row.expiresAt.toISOString(),
      revokedAt: row?.revokedAt?.toISOString() ?? null,
    }
  }

  /** 기록한 답 한 줄 → API 답 (있음이면 판매자 키로 토큰을 풀어 주소를 다시 만든다) */
  async #view(sellerId: string, stored: StoredView): Promise<ReceiptLinkView> {
    let url: string | null = null
    if (stored.status === 'ACTIVE' && stored.linkId !== null) {
      const rows = await this.#deps.db
        .select({ tokenEnc: receiptLinks.tokenEnc })
        .from(receiptLinks)
        .where(and(eq(receiptLinks.sellerId, sellerId), eq(receiptLinks.id, stored.linkId)))
        .limit(1)
      const row = rows[0]
      if (row !== undefined) url = `${this.#deps.appOrigin}/r/${openText(await this.#key(sellerId), tokenAad(sellerId, stored.linkId), row.tokenEnc)}`
    }
    return { buyer: stored.buyer, status: stored.status, url, expiresAt: stored.expiresAt, revokedAt: stored.revokedAt }
  }

  /**
   * 그 날짜 구매자들의 지금 링크: 쓸 수 있는 링크가 있으면 그것(구매자마다 많아야 하나), 없으면 가장 최근에 만든 링크.
   * 같은 시각에 끊고 다시 만든 링크도 쓸 수 있는 쪽을 고른다 (만든 시각이 같으면 무작위 ID 순서에 기대지 않는다)
   */
  async #latest(db: Db, sellerId: string, date: string, now: number): Promise<Map<string, LinkRow>> {
    const rows = await db
      .select()
      .from(receiptLinks)
      .where(and(eq(receiptLinks.sellerId, sellerId), eq(receiptLinks.date, date)))
      .orderBy(desc(receiptLinks.createdAt), desc(receiptLinks.id))
    const latest = new Map<string, LinkRow>()
    for (const row of rows) {
      const known = latest.get(row.buyer)
      if (known === undefined || (this.#status(known, now) !== 'ACTIVE' && this.#status(row, now) === 'ACTIVE')) latest.set(row.buyer, row)
    }
    return latest
  }

  /** 새 링크 하나 (트랜잭션 안 — 암호화 키는 트랜잭션 전에 받아 둔다: 트랜잭션 밖 DB 연결을 기다리지 않게) */
  async #insert(tx: Db, key: Buffer, sellerId: string, accountId: string, date: string, buyer: string, now: number): Promise<LinkRow> {
    const id = `rl_${randomUUID()}`
    const token = randomBytes(32).toString('base64url')
    const row = {
      id,
      sellerId,
      date,
      buyer,
      tokenHash: receiptTokenHash(token),
      tokenEnc: sealText(key, tokenAad(sellerId, id), token),
      createdAt: new Date(now),
      createdBy: accountId,
      expiresAt: new Date(now + RECEIPT_LINK_TTL_MS),
      revokedAt: null,
      revokedBy: null,
    }
    await tx.insert(receiptLinks).values(row)
    return row
  }

  /**
   * (판매자, 날짜) 락 안에서: 같은 요청 번호면 처음 답, 아니면 work로 새 답을 만들어 요청 번호와 함께 기록한다.
   * 요청 번호가 다른 날짜·다른 일에 쓰였으면 REQUEST_ERROR
   */
  async #locked<T extends StoredResult>(sellerId: string, date: string, requestId: string, kind: T['kind'], work: (tx: Db, now: number) => Promise<T | { kind: 'error'; error: ApiProblem }>): Promise<Outcome<T>> {
    const db = this.#deps.db
    return db.transaction(async (tx): Promise<Outcome<T>> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`receipt-links/${sellerId}/${date}`}, 0))`)
      const prior = await tx
        .select({ date: receiptLinkRequests.date, kind: receiptLinkRequests.kind, result: receiptLinkRequests.result })
        .from(receiptLinkRequests)
        .where(and(eq(receiptLinkRequests.sellerId, sellerId), eq(receiptLinkRequests.requestId, requestId)))
        .limit(1)
      const first = prior[0]
      if (first !== undefined) {
        if (first.date !== date || first.kind !== kind) return problem(409, 'REQUEST_ERROR', RECEIPT_LINK_MESSAGES.request)
        return ok(JSON.parse(first.result) as T)
      }
      const now = this.#deps.clock.now()
      const result = await work(tx, now)
      if (result.kind === 'error') return result
      const inserted = await tx
        .insert(receiptLinkRequests)
        .values({ sellerId, requestId, date, kind, result: JSON.stringify(result), createdAt: new Date(now) })
        .onConflictDoNothing({ target: [receiptLinkRequests.sellerId, receiptLinkRequests.requestId] })
        .returning({ id: receiptLinkRequests.id })
      // 다른 날짜의 같은 요청 번호가 그 사이 기록됐다 — 이 트랜잭션은 되돌린다
      if (inserted.length === 0) throw new RequestTaken()
      return ok(result)
    })
  }

  async #run<T extends StoredResult>(sellerId: string, date: string, requestId: string, kind: T['kind'], work: (tx: Db, now: number) => Promise<T | { kind: 'error'; error: ApiProblem }>): Promise<Outcome<T>> {
    try {
      return await this.#locked(sellerId, date, requestId, kind, work)
    } catch (error) {
      if (error instanceof RequestTaken) return problem(409, 'REQUEST_ERROR', RECEIPT_LINK_MESSAGES.request)
      throw error
    }
  }

  /** 범위 확인: 없는 범위 404, 리허설 범위 409 (기록 없음) */
  async #realScope(sellerId: string, date: string, rehearsal: boolean): Promise<Outcome<EngineState>> {
    const state = await this.#scope(sellerId, date, rehearsal)
    if (state === null) return NOT_FOUND
    if (rehearsal) return problem(409, 'REHEARSAL_RECEIPT_LINK', RECEIPT_LINK_MESSAGES.rehearsal)
    return ok(state)
  }

  /**
   * 링크 만들기 (AC-N4b-10): 쓸 수 있는 링크가 있으면 그 링크(새로 만들지 않음), 없으면 새 링크. 저장된 뒤에만 답한다.
   * 품목이 없는 묶음·합쳐진 구매자·없는 구매자는 409 (기록 없음)
   */
  async create(sellerId: string, accountId: string, date: string, rehearsal: boolean, requestId: string, buyer: string): Promise<Outcome<{ created: boolean; link: ReceiptLinkView }>> {
    const scope = await this.#realScope(sellerId, date, rehearsal)
    if (scope.kind !== 'ok') return scope
    const state = scope.value
    const key = await this.#key(sellerId)
    const result = await this.#run(sellerId, date, requestId, 'CREATE', async (tx, now) => {
      if (!linkableBuyer(state, date, buyer)) return problem(409, 'NO_ITEMS', RECEIPT_LINK_MESSAGES.noItems)
      const current = (await this.#latest(tx, sellerId, date, now)).get(buyer)
      if (current !== undefined && this.#status(current, now) === 'ACTIVE') return { kind: 'CREATE' as const, created: false, link: this.#stored(buyer, current, now) }
      const row = await this.#insert(tx, key, sellerId, accountId, date, buyer, now)
      return { kind: 'CREATE' as const, created: true, link: this.#stored(buyer, row, now) }
    })
    if (result.kind !== 'ok') return result
    return ok({ created: result.value.created, link: await this.#view(sellerId, result.value.link) })
  }

  /**
   * 링크 전부 만들기 (AC-N4b-11): 품목 있는 묶음(일괄 순서) 중 쓸 수 있는 링크가 없는 것에만 새 링크 — 한 트랜잭션.
   * 답 = 새로 만든 수와 묶음마다의 링크(목록과 같은 모양)
   */
  async createAll(sellerId: string, accountId: string, date: string, rehearsal: boolean, requestId: string): Promise<Outcome<{ created: number; links: ReceiptLinkView[] }>> {
    const scope = await this.#realScope(sellerId, date, rehearsal)
    if (scope.kind !== 'ok') return scope
    const state = scope.value
    const order = ClosingService.batchOrder(state, date)
    const key = await this.#key(sellerId)
    const result = await this.#run(sellerId, date, requestId, 'CREATE_ALL', async (tx, now) => {
      const latest = await this.#latest(tx, sellerId, date, now)
      let created = 0
      const links: StoredView[] = []
      for (const buyer of order) {
        const current = latest.get(buyer)
        if (current !== undefined && this.#status(current, now) === 'ACTIVE') {
          links.push(this.#stored(buyer, current, now))
          continue
        }
        const row = await this.#insert(tx, key, sellerId, accountId, date, buyer, now)
        created++
        links.push(this.#stored(buyer, row, now))
      }
      return { kind: 'CREATE_ALL' as const, created, links }
    })
    if (result.kind !== 'ok') return result
    return ok({ created: result.value.created, links: await Promise.all(result.value.links.map((link) => this.#view(sellerId, link))) })
  }

  /**
   * 링크 끊기 (AC-N4b-13): (날짜, 구매자)의 쓸 수 있는 링크에 끊은 시각·계정을 저장. 없으면 성공(바뀐 것 없음). 기록은 지우지 않는다
   */
  async revoke(sellerId: string, accountId: string, date: string, rehearsal: boolean, requestId: string, buyer: string): Promise<Outcome<{ revoked: boolean; link: ReceiptLinkView }>> {
    const scope = await this.#realScope(sellerId, date, rehearsal)
    if (scope.kind !== 'ok') return scope
    const result = await this.#run(sellerId, date, requestId, 'REVOKE', async (tx, now) => {
      const current = (await this.#latest(tx, sellerId, date, now)).get(buyer)
      if (current === undefined || this.#status(current, now) !== 'ACTIVE') return { kind: 'REVOKE' as const, revoked: false, link: this.#stored(buyer, current, now) }
      const revokedAt = new Date(now)
      await tx
        .update(receiptLinks)
        .set({ revokedAt, revokedBy: accountId })
        .where(and(eq(receiptLinks.sellerId, sellerId), eq(receiptLinks.id, current.id)))
      return { kind: 'REVOKE' as const, revoked: true, link: this.#stored(buyer, { ...current, revokedAt, revokedBy: accountId }, now) }
    })
    if (result.kind !== 'ok') return result
    return ok({ revoked: result.value.revoked, link: await this.#view(sellerId, result.value.link) })
  }

  /**
   * 링크 목록 (AC-N4b-12): 품목 있는 묶음마다 한 줄(일괄 순서), 가장 최근 링크의 상태. 리허설 범위는 빈 목록. 없는 범위는 not_found
   */
  async list(sellerId: string, date: string, rehearsal: boolean): Promise<Outcome<ReceiptLinkView[]>> {
    const state = await this.#scope(sellerId, date, rehearsal)
    if (state === null) return NOT_FOUND
    if (rehearsal) return ok([])
    const now = this.#deps.clock.now()
    const latest = await this.#latest(this.#deps.db, sellerId, date, now)
    return ok(await Promise.all(ClosingService.batchOrder(state, date).map((buyer) => this.#view(sellerId, this.#stored(buyer, latest.get(buyer), now)))))
  }

  /** 그 날짜 구매자들의 링크 상태 (영수증 보내기 화면의 구매자 줄과 함께 — 리허설이면 빈 맵) */
  async statuses(sellerId: string, date: string, buyers: readonly string[]): Promise<Map<string, ReceiptLinkView>> {
    const now = this.#deps.clock.now()
    const latest = await this.#latest(this.#deps.db, sellerId, date, now)
    const out = new Map<string, ReceiptLinkView>()
    for (const buyer of buyers) out.set(buyer, await this.#view(sellerId, this.#stored(buyer, latest.get(buyer), now)))
    return out
  }

  /**
   * 링크 열기 (AC-N4b-20·22): 토큰 모양 → 해시로만 기록 찾기 → 끊김·기간 지남 → 그 범위의 지금의 구매자·품목 → 지금 확인서.
   * 열 수 없으면 null (까닭을 나누지 않는다)
   */
  async open(token: string): Promise<OpenedLink | null> {
    if (!RECEIPT_TOKEN_RE.test(token)) return null
    const rows = await this.#deps.db.select().from(receiptLinks).where(eq(receiptLinks.tokenHash, receiptTokenHash(token))).limit(1)
    const row = rows[0]
    if (row === undefined || row.revokedAt !== null) return null
    const now = this.#deps.clock.now()
    if (now >= row.expiresAt.getTime()) return null
    const state = await this.#scope(row.sellerId, row.date, false)
    if (state === null || !linkableBuyer(state, row.date, row.buyer)) return null
    const outcome = await this.#deps.closing.receipt(row.sellerId, row.date, false, row.buyer)
    if (outcome.kind !== 'ok') return null
    return { sellerId: row.sellerId, date: row.date, buyer: row.buyer, expiresAt: row.expiresAt.getTime(), receipt: outcome.value.receipt, createdAt: outcome.value.createdAt }
  }
}

/** 같은 요청 번호가 다른 트랜잭션에서 먼저 기록됨 */
class RequestTaken extends Error {
  constructor() {
    super('요청 번호가 이미 있다')
    this.name = 'RequestTaken'
  }
}
