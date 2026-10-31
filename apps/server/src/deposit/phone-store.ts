// 휴대폰 알림 입금의 잔액 기록·은행 알림 줄 저장소 (SMS3 DEPOSIT_RULES DP-9 9, D-DEP2-04·06). 모든 질의에 판매자 ID 조건을 건다(SYS-02).
// 본문은 받지도 두지도 않는다 — 잔액 기록은 (은행, 알림 시각, 잔액), 은행 알림 줄은 (종류, 은행, 금액, 이름, 시각)만(DP-INV-8).
import { and, asc, desc, eq, gte, isNull, lt, lte } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { bankAlerts, bankBalances } from '../db/schema.ts'

export type BankAlertKind = 'CANCEL' | 'UNREADABLE'

export interface BankAlertRow {
  readonly id: number
  readonly kind: BankAlertKind
  readonly bank: string
  readonly amount: number | null
  readonly name: string | null
  readonly at: Date | null
  readonly receivedAt: Date
}

/** 같은 은행의 이 시각까지(같은 시각은 먼저 받은 것 — 이미 저장된 것은 모두 먼저 받았다)의 가장 늦은 잔액 (없으면 null) */
export async function previousBalance(db: Db, sellerId: string, bank: string, at: Date): Promise<number | null> {
  const rows = await db
    .select({ balance: bankBalances.balance })
    .from(bankBalances)
    .where(and(eq(bankBalances.sellerId, sellerId), eq(bankBalances.bank, bank), lte(bankBalances.at, at)))
    .orderBy(desc(bankBalances.at), desc(bankBalances.id))
    .limit(1)
  return rows[0]?.balance ?? null
}

export async function insertBalance(db: Db, sellerId: string, row: { bank: string; at: Date; balance: number }, now: Date): Promise<void> {
  await db.insert(bankBalances).values({ sellerId, bank: row.bank, at: row.at, balance: row.balance, createdAt: now })
}

export async function insertAlert(db: Db, sellerId: string, row: { kind: BankAlertKind; bank: string; amount: number | null; name: string | null; at: Date | null }, now: Date): Promise<number> {
  const rows = await db
    .insert(bankAlerts)
    .values({ sellerId, kind: row.kind, bank: row.bank, amount: row.amount, name: row.name, at: row.at, receivedAt: now })
    .returning({ id: bankAlerts.id })
  return (rows[0] as { id: number }).id
}

/** 보이는 은행 알림 줄: 닫지 않았고 since(받은 지 30일 안) 뒤에 받은 것, 새것 먼저 */
export async function openAlerts(db: Db, sellerId: string, since: Date): Promise<BankAlertRow[]> {
  const rows = await db
    .select({ id: bankAlerts.id, kind: bankAlerts.kind, bank: bankAlerts.bank, amount: bankAlerts.amount, name: bankAlerts.name, at: bankAlerts.at, receivedAt: bankAlerts.receivedAt })
    .from(bankAlerts)
    .where(and(eq(bankAlerts.sellerId, sellerId), isNull(bankAlerts.closedAt), gte(bankAlerts.receivedAt, since)))
    .orderBy(desc(bankAlerts.receivedAt), desc(bankAlerts.id))
    .limit(200)
  return rows as BankAlertRow[]
}

/** 줄 닫기 ("확인했어요"). 그 판매자의 열린 줄이 아니면 false */
export async function closeAlert(db: Db, sellerId: string, id: number, now: Date): Promise<boolean> {
  const rows = await db
    .update(bankAlerts)
    .set({ closedAt: now })
    .where(and(eq(bankAlerts.sellerId, sellerId), eq(bankAlerts.id, id), isNull(bankAlerts.closedAt)))
    .returning({ id: bankAlerts.id })
  return rows.length === 1
}

/** 받은 지 30일이 지난 은행 알림 줄·잔액 기록 지우기 (보이지 않는 줄을 쌓아 두지 않는다) */
export async function pruneOld(db: Db, sellerId: string, before: Date): Promise<void> {
  await db.delete(bankAlerts).where(and(eq(bankAlerts.sellerId, sellerId), lt(bankAlerts.receivedAt, before)))
  await db.delete(bankBalances).where(and(eq(bankBalances.sellerId, sellerId), lt(bankBalances.createdAt, before)))
}

/** 시험·점검용: 그 판매자의 잔액 기록 (시각 순) */
export async function balancesOf(db: Db, sellerId: string): Promise<{ bank: string; at: Date; balance: number }[]> {
  return db
    .select({ bank: bankBalances.bank, at: bankBalances.at, balance: bankBalances.balance })
    .from(bankBalances)
    .where(eq(bankBalances.sellerId, sellerId))
    .orderBy(asc(bankBalances.at), asc(bankBalances.id))
}
