// 정산서 손님 합치기 (D-STMT-JOIN-01, 판매자 요청 2026-11-20 "닉네임은 다르지만 같은 휴대폰 번호인 경우 … 정산서 합쳐줘야 해.
// 자동으로 휴대폰 번호 인식해서 같은 사람으로 묶어주고, 수동으로도 할 수 있게 (구제불능 2명 케이스)"):
// 같은 날 정산서에서 닉네임이 다른 구매자 여럿을 정산서 한 장(한 주문 · 배송비 한 번)으로 보인다.
// - 엔진 기록이 아니다 — 판정·금액(찜·구매자·정산 묶음)은 바뀌지 않고 정산서 화면·사진·엑셀/CSV·모두에게 보내기만 묶어 보인다
//   (엔진 구매자 합치기 buyer.merge는 같은 번호 확정 찜이 둘이면 막히고 판정을 바꾼다 — 정산서만 묶는 쪽이 판매자에게 안전하다, AUTO).
// - 자동: 판매자가 손대지 않은 구매자 가운데 아는 휴대폰 번호(문자찜 번호·판매자가 넣은 번호·손님 정보 문자 번호)가 같은 구매자끼리.
// - 수동: join(고른 구매자를 한 정산서로) · apart(그 정산서를 다시 한 명씩). 손댄 구매자는 자동 묶기에서 빠진다(판매자 결정이 이긴다).
// - 기록: statement_buyer_events에 덧붙이기만 한다. 같은 요청 번호면 처음 결과. 번호 원문은 응답·로그에 없다.
import { randomUUID } from 'node:crypto'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { statementBuyerEvents } from './db/schema.ts'

/** 한 정산서에 합칠 수 있는 구매자 수 */
export const JOIN_MAX = 10

export interface StatementJoinGroup {
  /** 정산서 한 장의 구매자들 — 첫째가 대표(번호를 아는 구매자가 앞) */
  readonly buyers: readonly string[]
  /** 휴대폰 번호가 같아 저절로 묶었다 (판매자가 손대지 않았다) */
  readonly auto: boolean
}

export const JOIN_MESSAGES = {
  count: `합칠 구매자를 2명에서 ${JOIN_MAX}명까지 골라 주세요.`,
  rehearsal: '연습 라이브 정산서는 합칠 수 없어요.',
} as const

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Reader = Db | Tx

const lockKey = (sellerId: string) => sql`hashtextextended(${`statement-joins/${sellerId}`}, 0)`

function parseIds(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** 그 날짜 판매자 결정을 접은 것: 구매자 → 묶음 표지(혼자 두기로 한 구매자는 자기 ID) */
export async function foldJoins(db: Reader, sellerId: string, date: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ kind: statementBuyerEvents.kind, link: statementBuyerEvents.link, ids: statementBuyerEvents.buyerIds })
    .from(statementBuyerEvents)
    .where(and(eq(statementBuyerEvents.sellerId, sellerId), eq(statementBuyerEvents.date, date)))
    .orderBy(asc(statementBuyerEvents.id))
  const links = new Map<string, string>()
  for (const row of rows) {
    const ids = parseIds(row.ids)
    if (row.kind === 'join') for (const id of ids) links.set(id, row.link)
    else if (row.kind === 'apart') for (const id of ids) links.set(id, `solo:${id}`)
  }
  return links
}

/**
 * 정산서 묶음 (순수): buyers = 정산서에 줄이 있는 구매자(지금의 구매자), links = 판매자 결정, phones = 구매자 → 아는 번호(정규화).
 * 판매자가 묶은 구매자끼리 먼저, 그다음 손대지 않은 구매자 가운데 번호가 같은 구매자끼리. 2명 이상인 묶음만 돌려준다.
 * 대표(첫째): 번호를 아는 구매자 → 구매자 ID 순 — 정산서 문자는 대표 번호로 간다
 */
export function resolveJoins(buyers: readonly string[], links: ReadonlyMap<string, string>, phones: ReadonlyMap<string, string>): StatementJoinGroup[] {
  const present = [...new Set(buyers)]
  const order = (ids: string[]) => ids.sort((a, b) => Number(phones.has(b)) - Number(phones.has(a)) || (a < b ? -1 : a > b ? 1 : 0))
  const manual = new Map<string, string[]>()
  const byPhone = new Map<string, string[]>()
  for (const id of present) {
    const link = links.get(id)
    if (link !== undefined) {
      const list = manual.get(link) ?? []
      list.push(id)
      manual.set(link, list)
      continue
    }
    const phone = phones.get(id)
    if (phone === undefined) continue
    const list = byPhone.get(phone) ?? []
    list.push(id)
    byPhone.set(phone, list)
  }
  const out: StatementJoinGroup[] = []
  for (const ids of manual.values()) if (ids.length >= 2) out.push({ buyers: order(ids), auto: false })
  for (const ids of byPhone.values()) if (ids.length >= 2) out.push({ buyers: order(ids), auto: true })
  return out.sort((a, b) => (a.buyers[0]! < b.buyers[0]! ? -1 : 1))
}

export type JoinKind = 'join' | 'apart'

/**
 * 판매자 결정 하나를 남긴다. join: 고른 구매자(2~10명)를 새 묶음 하나로(전에 든 묶음에서 빠진다). apart: 고른 구매자를 한 명씩.
 * 같은 요청 번호면 아무 일도 하지 않는다(처음 결과)
 */
export async function recordJoin(db: Db, sellerId: string, accountId: string | null, requestId: string, date: string, kind: JoinKind, buyers: readonly string[], now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${lockKey(sellerId)})`)
    const [prior] = await tx
      .select({ id: statementBuyerEvents.id })
      .from(statementBuyerEvents)
      .where(and(eq(statementBuyerEvents.sellerId, sellerId), eq(statementBuyerEvents.requestId, requestId)))
      .limit(1)
    if (prior !== undefined) return
    await tx.insert(statementBuyerEvents).values({
      sellerId,
      requestId,
      kind,
      date,
      link: kind === 'join' ? `j_${randomUUID()}` : '',
      buyerIds: JSON.stringify([...new Set(buyers)]),
      accountId,
      createdAt: now,
    })
  })
}

/** 고른 구매자 검사 — 형식만(정산서에 없는 구매자는 묶음 계산에서 저절로 빠진다) */
export function joinBuyersInput(value: unknown, kind: JoinKind): string[] | null {
  if (!Array.isArray(value)) return null
  const ids = value.filter((id): id is string => typeof id === 'string' && id !== '' && id.length <= 64 && !/[\p{Cc}]/u.test(id))
  if (ids.length !== value.length || new Set(ids).size !== ids.length) return null
  if (kind === 'join' ? ids.length < 2 || ids.length > JOIN_MAX : ids.length < 1 || ids.length > JOIN_MAX) return null
  return ids
}

export interface StatementJoinsDeps {
  readonly db: Db
  readonly clock: { now(): number }
  /** 그 날짜 정산서에 줄이 있는 구매자 (실제 범위만 — 없으면 빈 목록) */
  readonly buyers: (sellerId: string, date: string) => Promise<readonly string[]>
  /** 구매자 → 아는 번호(정규화). 번호 원문은 이 안에서만 쓴다 */
  readonly phones: (sellerId: string, date: string, buyers: readonly string[]) => Promise<ReadonlyMap<string, string>>
}

export class StatementJoins {
  readonly #deps: StatementJoinsDeps

  constructor(deps: StatementJoinsDeps) {
    this.#deps = deps
  }

  /** 그 날짜 정산서 묶음 (실제 범위) */
  async groups(sellerId: string, date: string): Promise<StatementJoinGroup[]> {
    const buyers = await this.#deps.buyers(sellerId, date)
    if (buyers.length < 2) return []
    const [links, phones] = await Promise.all([foldJoins(this.#deps.db, sellerId, date), this.#deps.phones(sellerId, date, buyers)])
    return resolveJoins(buyers, links, phones)
  }

  async change(sellerId: string, accountId: string | null, requestId: string, date: string, kind: JoinKind, buyers: readonly string[]): Promise<StatementJoinGroup[]> {
    await recordJoin(this.#deps.db, sellerId, accountId, requestId, date, kind, buyers, new Date(this.#deps.clock.now()))
    return this.groups(sellerId, date)
  }
}
