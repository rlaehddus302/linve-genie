// 확인 필요 목록 조회 (O2 AC-O2-30, D-O2-14, R-20 7, D-O1-10).
// - 항목은 코어 listReviews 그대로(원래 순위 — 출처 입력의 seq 순)이고, 서버는 화면이 쓸 재료만 붙인다:
//   댓글 글(채팅은 따로 둔 본문을 합친 이벤트 본문, 문자찜은 메모)·구매자 표시 이름·방송 날짜와 제목·(문자찜이면) 받은 시각과 전화번호 뒤 4자리.
//   전화번호 원문·전화번호 키는 담지 않는다(DAT-06).
// - 범위 = (판매자, 날짜, 리허설인지) (D-081). 실제 범위가 기본이고 ?rehearsal=true면 리허설 범위만. 방송을 주면 그 방송의 범위·그 방송의 항목만.
// - 옵션 방송이 있는 범위만 읽는다(확인 필요는 옵션 방송에만 생긴다). 읽기는 공용 범위 캐시에 넣지 않는다(지난 날짜가 지금 방송의 캐시를 밀어내지 않게).
// - 판정은 하지 않는다 — 코어 조회 함수(listReviews·listProducts·getBroadcast·getBuyer)만 부른다.
import { getBroadcast, getBuyer, listProducts, listReviews, type ReviewInfo } from '@livejjim/core'
import type { Db } from './db/database.ts'
import { eventBodiesAt, findBroadcast, optionScopes } from './store.ts'
import { withIsoTimes } from './time.ts'
import type { ScopeWriter } from './writer.ts'

export interface ReviewItem extends Omit<ReviewInfo, 'at'> {
  /** 받은 시각 (UTC ISO — 출처 입력의 at) */
  readonly at: string
  /** 그 항목이 있는 범위 */
  readonly date: string
  readonly rehearsal: boolean
  /** 방송 날짜·제목 */
  readonly broadcastDate: string
  readonly broadcastTitle: string
  /** 지금의 구매자 표시 이름 (신뢰할 수 없는 글 — 화면이 이스케이프한다) */
  readonly buyerName: string
  /** 댓글 글 (채팅) 또는 메모 (문자찜, 없으면 null) — 신뢰할 수 없는 글 */
  readonly text: string | null
  /** 문자찜의 받은 시각 글 ('14:05') — 채팅이면 null */
  readonly received: string | null
  /** 문자찜의 전화번호 뒤 4자리 (없으면 null) — 원문은 없다 */
  readonly phoneLast4: string | null
}

export interface ReviewsView {
  readonly rehearsal: boolean
  /** 원래 순위 순 (범위 날짜 순, 범위 안에서는 코어 순서) */
  readonly reviews: readonly ReviewItem[]
  /** 항목이 있는 방송(방송을 고르면 그 방송)의 상품 — 고르기 칸의 상품·옵션·변형 남은 수량 (코어 listProducts 그대로, 시각은 ISO) */
  readonly products: readonly Readonly<Record<string, unknown>>[]
  /** 그 방송들 (코어 getBroadcast 그대로 — 지금 상품 focus 포함, 시각은 ISO) */
  readonly broadcasts: readonly Readonly<Record<string, unknown>>[]
  /** 읽은 범위의 seq (실시간 알림의 seq와 견준다) */
  readonly scopes: readonly { readonly date: string; readonly rehearsal: boolean; readonly seq: number }[]
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * 확인 필요 목록. 방송을 주면 그 방송만 — 다른 판매자의 방송·없는 방송·리허설인지가 다른 방송이면 null(404)
 */
export async function reviewsView(
  deps: { readonly db: Db; readonly writer: ScopeWriter },
  sellerId: string,
  query: { readonly rehearsal: boolean; readonly broadcast?: string },
): Promise<ReviewsView | null> {
  const { db, writer } = deps
  let targets: { date: string; rehearsal: boolean; scopeId: string }[]
  if (query.broadcast !== undefined) {
    const row = await findBroadcast(db, sellerId, query.broadcast)
    if (row === null || row.rehearsal !== query.rehearsal) return null
    targets = [{ date: row.date, rehearsal: row.rehearsal, scopeId: row.scopeId }]
  } else {
    targets = await optionScopes(db, sellerId, query.rehearsal)
  }
  const reviews: ReviewItem[] = []
  const products: Readonly<Record<string, unknown>>[] = []
  const broadcasts: Readonly<Record<string, unknown>>[] = []
  const scopes: { date: string; rehearsal: boolean; seq: number }[] = []
  for (const target of targets) {
    const runtime = await writer.readDetached(sellerId, target.date, target.rehearsal)
    // 쓰기와 같이 쓰는 객체일 수 있다 — 상태와 seq를 함께 잡는다
    const { state, seq, scopeId } = runtime
    if (seq === 0 || scopeId === null) continue
    scopes.push({ date: target.date, rehearsal: target.rehearsal, seq })
    const items = listReviews(state).filter((review) => query.broadcast === undefined || review.broadcast === query.broadcast)
    const bodies = await eventBodiesAt(db, sellerId, scopeId, [...new Set(items.map((review) => review.seq))])
    const seen = new Set<string>()
    for (const review of items) {
      const broadcast = getBroadcast(state, review.broadcast)
      const body = bodies.get(review.seq) ?? {}
      const sms = review.origin === 'sms'
      reviews.push({
        ...review,
        at: new Date(review.at).toISOString(),
        date: target.date,
        rehearsal: target.rehearsal,
        broadcastDate: broadcast?.date ?? target.date,
        broadcastTitle: broadcast?.title ?? '',
        buyerName: getBuyer(state, review.currentBuyer)?.display ?? '',
        text: sms ? str(body.memo) : str(body.text),
        received: sms ? str(body.received) : null,
        phoneLast4: sms ? str(body.phoneLast4) : null,
      })
      seen.add(review.broadcast)
    }
    if (query.broadcast !== undefined) seen.add(query.broadcast)
    for (const b of seen) {
      const broadcast = getBroadcast(state, b)
      if (broadcast !== null) broadcasts.push(withIsoTimes(broadcast) as unknown as Record<string, unknown>)
    }
    if (seen.size > 0) {
      for (const product of listProducts(state)) if (seen.has(product.broadcast)) products.push(withIsoTimes(product) as unknown as Record<string, unknown>)
    }
  }
  return { rehearsal: query.rehearsal, reviews, products, broadcasts, scopes }
}
