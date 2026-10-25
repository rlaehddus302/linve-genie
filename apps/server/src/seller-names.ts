// 판매자 품종 사전 (V3, DOMAIN_RULES R-23, D-V3-49, AC-V3-55).
// - 판매자가 주인 배지 채팅에 쓴 "93번🍀[청개구리] ₩70,000 [용용]님 감사합니다🍀"를 읽어(음성 패키지의 판매자 글 하위 경로 readSellerNote — 서버에 규칙을 두지 않는다)
//   (ㄱ) 그 판매자 품종 사전에 이름을 넣고 (ㄴ) 그 방송 같은 번호 상품의 품종이 비었고 가격이 글의 ₩ 가격과 같으면 상품 고치기(product.update, 품종만)를 낸다.
// - 부르는 곳: Service.ingestYoutubeBatch — 채팅 이벤트를 먼저 기록한 뒤(절대 규칙 3), 이번에 새로 기록한 채팅 중 주인 배지가 확실한 것만.
// - 모든 질의에 판매자 ID 조건을 건다. 로그에는 채팅 글·닉네임·품종 글을 남기지 않는다(코드·방송·번호·결과만).
import { and, desc, eq, notInArray } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { sellerNames } from './db/schema.ts'

/** 판매자 품종 사전 상한 (판매 이력 사전 상한과 같음 — D-I4-06, R-23) */
export const SELLER_NAMES_MAX = 2000

/** 상품에 한 일 (로그·시험용 — 화면에 보이지 않는다) */
export type SellerNoteOutcome = 'FILLED' | 'NO_PRODUCT' | 'HAS_NAME' | 'PRICE_DIFFERS' | 'NOT_FILLED'

/**
 * 이름을 배운다: 같은 이름이면 줄을 늘리지 않고 본 시각만 고친다. 상한을 넘으면 오래 안 본 것부터 지운다.
 * 돌려주는 값: 새로 생긴 이름인지
 */
export async function learnSellerName(db: Db, sellerId: string, name: string, now: Date, max = SELLER_NAMES_MAX): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(sellerNames)
      .values({ sellerId, name, learnedAt: now, seenAt: now })
      .onConflictDoNothing({ target: [sellerNames.sellerId, sellerNames.name] })
      .returning({ id: sellerNames.id })
    if (inserted.length === 0) {
      await tx
        .update(sellerNames)
        .set({ seenAt: now })
        .where(and(eq(sellerNames.sellerId, sellerId), eq(sellerNames.name, name)))
      return false
    }
    // 상한 넘음: 최근 본 순서로 max개만 남긴다
    const keep = tx
      .select({ id: sellerNames.id })
      .from(sellerNames)
      .where(eq(sellerNames.sellerId, sellerId))
      .orderBy(desc(sellerNames.seenAt), desc(sellerNames.id))
      .limit(max)
    await tx.delete(sellerNames).where(and(eq(sellerNames.sellerId, sellerId), notInArray(sellerNames.id, keep)))
    return true
  })
}

/** 그 판매자의 배운 이름, 최근 본 것부터 (최대 SELLER_NAMES_MAX개) */
export async function listSellerNames(db: Db, sellerId: string): Promise<string[]> {
  const rows = await db
    .select({ name: sellerNames.name })
    .from(sellerNames)
    .where(eq(sellerNames.sellerId, sellerId))
    .orderBy(desc(sellerNames.seenAt), desc(sellerNames.id))
    .limit(SELLER_NAMES_MAX)
  return rows.map((row) => row.name)
}
