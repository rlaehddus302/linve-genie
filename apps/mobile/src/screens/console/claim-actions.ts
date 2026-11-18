// 찜 삭제·상품 삭제 (D-UX4-25, 사용자 지시 2026-11-09 "찜 삭제 누르면 … 삭제하면 그 다음 대기 1이 찜되게", "상품 삭제 메뉴").
// 앱은 판정하지 않는다 — 엔진의 방송자 취소(host.cancel)·승계(host.promote)·판매 종료(product.close)를 차례로 보낼 뿐이다.
// - 찜 삭제 = 방송자 취소. 1등이 빠지면 엔진이 그 방송의 승계 설정대로 한다(기본 AUTO = 대기 1이 바로 찜).
//   승계 설정이 ASK라 "다음 손님을 정해야 해요"로 남으면, 판매자가 "삭제"를 누른 뜻대로 대기 1을 1등으로 올린다(겹친 상품·옵션 상품은 정하기 창에 둔다).
// - 상품 삭제 = 그 상품의 살아 있는 찜을 모두 취소한 뒤 판매 종료(CLOSED, 소프트 삭제 R-2). 대기·보류·겹침을 먼저, 1등을 맨 나중에 —
//   1등을 먼저 지우면 대기가 승계로 1등이 되고 라벨·감사가 나간 뒤 다시 지워진다.
// D-RETRO-53 (복기 F6 "취소하거나 되돌리거나 여러 가지로"): 찜으로 올리기 · 찜 되돌리기 — 엔진에 이미 있는 승계(host.promote)·직접 배정(host.assign, 교체는 대기 1번으로)만 보낸다.
// - 찜으로 올리기(대기 찜): 자리가 비었으면 승계, 찼고 1등이 한 명이면 그 1등을 대기 1번으로 내리는 교체 배정.
// - 찜 되돌리기(취소·안 된 찜): 그 손님을 다시 배정한다. 자리가 찼고 1등이 한 명이면 같은 교체. 엔진에 "취소를 무르는" 이벤트는 없다 — 새 찜이 생기고 지워진 찜 기록은 그대로 남는다.
// - 옵션 상품·겹친 상품·판매 중이 아닌 상품·1등이 여럿인 꽉 찬 상품·차단한 손님은 하지 않는다(상품 자세히·정하기 창에서 한다).
// D-RETRO-54 (복기 F7 "상품을 눌러 임의로 문자찜 등록"): 찜 넣기 = 문자찜(sms) 쓰기 — 음성 문자찜과 같은 길(이름은 메모, 끝 네 자리는 last4, 고른 손님은 buyer).
//   전화번호 전체는 받지도 보내지도 않는다. 판정(찜·대기)은 서버가 받은 순서대로 한다.
//   D-CLAIMADD-03: 고른 손님이 채팅 손님이고 [닉네임으로 보이기]를 켰으면 named — 라벨·감사 채팅 이름만 그 닉네임(엔진 sms named).
import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import type { Claim, Product, WriteResult } from '@livejjim/web/src/api/types.ts'
import { isApiError } from '../../api/client.ts'
import { claimsOfProduct, productSlots } from '../../lib/derive.ts'
import { isTentative } from '../../lib/tentative.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import type { ConsoleApi } from './context.ts'

export const CLAIM_DELETE_REASON = '판매자가 찜을 삭제했어요'
export const PROMOTE_AFTER_DELETE_REASON = '찜 삭제 뒤 다음 대기 손님'
export const PRODUCT_DELETE_REASON = '판매자가 상품을 삭제했어요'
/** 상품 삭제 팝업을 닫고 지우는 동안 메뉴 줄 자리 (D-DEL-FREEZE-01) */
export const PRODUCT_DELETING = '상품을 지우고 있어요'
/** 새 찜이 들어와 판매 종료가 되지 않았을 때 */
export const PRODUCT_DELETE_RACE = '그사이 새 찜이 들어와 지우지 못했어요. 다시 눌러 주세요.'

/** 지울 수 있는(살아 있는) 찜 */
export const ACTIVE_CLAIM: ReadonlySet<Claim['status']> = new Set(['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT'])

/** 찜을 가리키는 조치의 변형 고르기 (옵션 상품, R-19) */
function pickOf(claim: Claim): Record<string, unknown> {
  return claim.options === null || claim.options.length === 0 ? {} : { options: Object.fromEntries(claim.options.map(([name, label]) => [name, label])) }
}

const latestOf = (api: ConsoleApi): ScopeData => api.latest?.() ?? api.data

/** 찜 하나 삭제 — 1등이었고 승계가 방송자 결정으로 남으면 대기 1을 1등으로 */
export async function deleteClaim(api: ConsoleApi, claim: Claim): Promise<void> {
  await api.command({ type: 'host.cancel', b: claim.broadcast, no: claim.no, buyer: claim.currentBuyer, reason: CLAIM_DELETE_REASON, ...pickOf(claim) })
  if (claim.status !== 'CONFIRMED') return
  const product = latestOf(api).products.get(claim.product)
  if (product === undefined || product.hasOptions) return
  const slots = productSlots(product)
  const next = slots.waitlist[0]
  if (!slots.awaitingSuccession || slots.conflict || next === undefined) return
  await api.command({ type: 'host.promote', b: claim.broadcast, no: claim.no, buyer: next, reason: PROMOTE_AFTER_DELETE_REASON })
}

const DELETE_ORDER: Readonly<Record<string, number>> = { WAITLISTED: 0, PENDING: 1, CONFLICT: 2, CONFIRMED: 3 }

/** 상품 삭제 — 살아 있는 찜을 모두 취소하고 판매 종료. 새 찜이 끼어들어 닫히지 않으면 PRODUCT_DELETE_RACE */
export async function deleteProduct(api: ConsoleApi, product: Product): Promise<void> {
  const claims = claimsOfProduct(latestOf(api), product)
    .filter((claim) => ACTIVE_CLAIM.has(claim.status))
    .sort((a, b) => (DELETE_ORDER[a.status] ?? 9) - (DELETE_ORDER[b.status] ?? 9))
  for (const claim of claims) await api.command({ type: 'host.cancel', b: claim.broadcast, no: claim.no, buyer: claim.currentBuyer, reason: PRODUCT_DELETE_REASON, ...pickOf(claim) })
  const result = await api.command({ type: 'product.close', b: product.broadcast, no: product.no })
  const after = latestOf(api).products.get(product.key)
  if (!result.changed && after !== undefined && after.status !== 'CLOSED') throw new Error(PRODUCT_DELETE_RACE)
}

// ── 찜으로 올리기 · 찜 되돌리기 (D-RETRO-53) ─────────────────────────

export const CLAIM_RAISE_REASON = '판매자가 대기 손님을 찜으로 올렸어요'
export const CLAIM_RESTORE_REASON = '판매자가 지워진 찜을 되돌렸어요'
/** 보냈지만 바뀐 것이 없을 때 (그사이 상태가 달라졌다) — 되돌리기 띠와 같은 문장 */
export const CLAIM_NOT_APPLIED = '적용되지 않았어요. 지금 상태를 확인해 주세요.'

/** 끝난 찜 (취소됨·안 됨) — 되돌릴 수 있는지 볼 찜 */
export const ENDED_CLAIM: ReadonlySet<Claim['status']> = new Set(['CANCELLED', 'REJECTED'])

export interface RaisePlan {
  /** promote: 대기 찜을 찜으로 올리기 · restore: 끝난 찜 되돌리기 */
  readonly kind: 'promote' | 'restore'
  /** 자리를 내주고 대기 1번으로 내려갈 지금 1등 (자리가 비어 있으면 null) */
  readonly replace: string | null
}

/**
 * 이 찜을 찜(1등)으로 올리거나 되돌릴 수 있는지와 방법. 할 수 없으면 null.
 * 앱이 판정하는 것이 아니라 "보내도 아무 일도 없는 조치"(R-9)를 단추로 내놓지 않으려는 것 — 실제 결과는 엔진이 정한다.
 */
export function raisePlan(data: ScopeData, claim: Claim): RaisePlan | null {
  const kind = claim.status === 'WAITLISTED' ? 'promote' : ENDED_CLAIM.has(claim.status) ? 'restore' : null
  if (kind === null) return null
  const product = data.products.get(claim.product)
  // 판정받은 그 상품이 그 번호로 판매 중일 때만 (번호를 옮겼거나 상품 없이 끝난 찜은 아님)
  if (product === undefined || claim.productId !== product.id || product.no !== claim.no) return null
  if (product.hasOptions || (product.status !== 'OPEN' && product.status !== 'SOLD')) return null
  const slots = productSlots(product)
  if (slots.conflict) return null
  if (data.buyers.get(claim.currentBuyer)?.blocked === true) return null
  if (kind === 'restore') {
    // 그 손님이 그 상품에 이미 살아 있는 찜이 있으면 되돌릴 것이 없다
    for (const other of data.claims.values()) if (other.product === claim.product && other.currentBuyer === claim.currentBuyer && ACTIVE_CLAIM.has(other.status)) return null
  }
  if (slots.winners.length < product.stock) return { kind, replace: null }
  // 자리가 찼다: 1등이 한 명일 때만 그 1등을 대기 1번으로 내린다 (여럿이면 누구를 내릴지 앱이 고르지 않는다)
  const winner = slots.winners[0]
  const winnerClaim = slots.winnerClaims[0] === undefined ? undefined : data.claims.get(slots.winnerClaims[0])
  if (slots.winners.length !== 1 || winner === undefined || winner === claim.currentBuyer) return null
  // 대기로 내려가지 못하는 1등(차단·수량 2 이상)은 건드리지 않는다 (R-9 D-049, R-19 D-O1-05)
  if (data.buyers.get(winner)?.blocked === true || (winnerClaim !== undefined && winnerClaim.qty > 1)) return null
  if (kind === 'restore') {
    // 되돌리면 대기가 한 명 는다 — 대기 한도를 넘겨 맨 끝 대기 손님이 밀려나는 일은 만들지 않는다
    const max = data.broadcasts.get(claim.broadcast)?.settings['waitlist.max']
    if (typeof max === 'number' && slots.waitlist.length >= max) return null
  }
  return { kind, replace: winner }
}

/** 찜으로 올리기·되돌리기를 보낸다. 그사이 상태가 달라져 할 수 없거나 바뀐 것이 없으면 CLAIM_NOT_APPLIED */
export async function raiseClaim(api: ConsoleApi, claim: Claim): Promise<void> {
  const latest = latestOf(api)
  const now = latest.claims.get(claim.id) ?? claim
  const plan = raisePlan(latest, now)
  if (plan === null) throw new Error(CLAIM_NOT_APPLIED)
  const reason = plan.kind === 'promote' ? CLAIM_RAISE_REASON : CLAIM_RESTORE_REASON
  const result = plan.kind === 'promote' && plan.replace === null
    ? await api.command({ type: 'host.promote', b: now.broadcast, no: now.no, buyer: now.currentBuyer, reason })
    : await api.command({ type: 'host.assign', b: now.broadcast, no: now.no, buyer: now.currentBuyer, reason, ...(plan.replace === null ? {} : { replace: plan.replace, replaceTo: 'WAITLIST' }) })
  if (!result.changed) throw new Error(CLAIM_NOT_APPLIED)
}

// ── 찜 넣기 (D-RETRO-54) ────────────────────────────────────────────

export interface SmsClaimInput {
  /** 손님 이름 (문자 손님의 표시 이름 "문자찜(이름)"이 된다). 비우면 빈 글 */
  readonly name: string
  /** 전화번호 끝 네 자리 (숫자 4개) 또는 빈 글 — 전체 번호는 받지 않는다 */
  readonly last4: string
  /** 이미 있는 손님을 골랐으면 그 손님 ID (이름·끝 네 자리 대신) */
  readonly buyer: string | null
  /** 끝 네 자리가 같은 손님이 있어도 새 손님으로 넣기 */
  readonly newBuyer?: boolean
  /**
   * 닉네임으로 보이기 (D-CLAIMADD-03): 고른 손님(buyer)이 채팅 손님일 때만 싣는다 — 감사 채팅 이름이 "문자찜" 대신 그 닉네임(라벨은 이것과 상관없이 닉네임, D-CLAIMADD-04).
   * 판정(찜·대기)·정산은 같다. 기본은 끔(문자찜으로 — 닉네임을 드러내지 않는다)
   */
  readonly named?: boolean
}

/** 끝 네 자리가 같은 손님 후보 (서버 409 BUYER_AMBIGUOUS — 손님 ID·찜한 번호만) */
export interface SmsCandidate {
  readonly buyer: string
  readonly claims: readonly number[]
}

export type SmsClaimOutcome =
  | { readonly kind: 'ok'; readonly result: WriteResult }
  | { readonly kind: 'ambiguous'; readonly message: string; readonly candidates: readonly SmsCandidate[] }

/** 보낼 문자찜 쓰기 — 고른 손님이면 buyer만(닉네임으로 보이기면 named도), 아니면 이름(memo)·끝 네 자리(last4). 빈 칸은 넣지 않는다 */
export function smsClaimEvent(product: Pick<Product, 'broadcast' | 'no'>, input: SmsClaimInput): Readonly<Record<string, unknown>> {
  const base = { type: 'sms', b: product.broadcast, no: product.no }
  if (input.buyer !== null) return { ...base, buyer: input.buyer, ...(input.named === true ? { named: true } : {}) }
  const name = input.name.trim()
  return { ...base, ...(name === '' ? {} : { memo: name }), ...(input.last4 === '' ? {} : { last4: input.last4, ...(input.newBuyer === true ? { newBuyer: true } : {}) }) }
}

function candidatesOf(value: unknown): SmsCandidate[] {
  if (!Array.isArray(value)) return []
  const out: SmsCandidate[] = []
  for (const item of value as readonly unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const { buyer, claims } = item as { readonly buyer?: unknown; readonly claims?: unknown }
    if (typeof buyer !== 'string') continue
    out.push({ buyer, claims: Array.isArray(claims) ? (claims as readonly unknown[]).filter((no): no is number => typeof no === 'number') : [] })
  }
  return out
}

/** 그 상품에 문자찜을 넣는다. 끝 네 자리가 같은 손님이 여럿이면(또는 이름이 다르면) 고르기 후보를 돌려준다 */
export async function addSmsClaim(api: ConsoleApi, product: Pick<Product, 'broadcast' | 'no'>, input: SmsClaimInput, requestId?: string): Promise<SmsClaimOutcome> {
  try {
    return { kind: 'ok', result: await api.command(smsClaimEvent(product, input), requestId) }
  } catch (caught) {
    if (isApiError(caught) && caught.code === 'BUYER_AMBIGUOUS') {
      const candidates = candidatesOf(caught.details.candidates)
      if (candidates.length > 0) return { kind: 'ambiguous', message: caught.message, candidates }
    }
    throw caught
  }
}

/** 메뉴 판이 다 닫힌 뒤 다음 판을 연다 — 판 닫힘(SHEET_OUT_MS 200) + 아이폰이 판을 내리는 시간 (D-UX3-26) */
export const SHEET_HANDOFF_MS = 400

/** 아래 판을 닫고 그다음 팝업을 띄울 때 — 아이폰은 판(Modal)이 닫히는 동안 새 판을 띄우지 못한다. 웹은 바로 */
export function useSheetHandoff(): (next: () => void) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])
  return (next) => {
    if (Platform.OS === 'web') {
      next()
      return
    }
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      next()
    }, SHEET_HANDOFF_MS)
  }
}

// ── 같은 물건 더 팔기 (D-STK-02, 사용자 지시 2026-11-16 "동일 상품 번호에 여러 개가 있을 수 있다 … 뒷사람도 라벨 뽑을 수 있도록") ──
// 엔진의 재고(R-10 재고 변경, ORD-11)만 쓴다: 재고를 하나 늘리면 엔진이 대기 1순위를 확정하고(선착순 그대로) 그 손님의 라벨·감사 효과가 나온다.
// 앱은 누구를 올릴지 고르지 않는다 — 대기 1번이 아닌 손님을 먼저 팔려면 앞 손님 찜을 지운 뒤 누른다. 묻는 팝업에 찜이 될 손님 이름을 미리 보이고,
// 보내기 직전 최신 상태에서 그 손님이 여전히 대기 1번인지 다시 본다(그사이 바뀌었으면 보내지 않는다 — 다른 손님이 조용히 찜이 되지 않게).

export const SELL_MORE = '같은 물건 더 팔기'
export const SELL_FEWER = '하나 덜 팔기'
export const SELL_TO_THIS = '이 손님에게도 팔기'
/** 재고 상한 (웹 개수 칸과 같다 — D-STK-01) */
export const STOCK_MAX = 999
/** 보내기 직전에 대기 1번이 바뀌었을 때 */
export const SELL_MORE_CHANGED = '그사이 대기 손님이 바뀌었어요. 다시 눌러 주세요.'

export interface SellMorePlan {
  /** 보낼 새 재고 */
  readonly stock: number
  /** 이 조치로 찜이 될 대기 1번 손님 (자리가 남아 있거나 대기가 없으면 null — 다음에 찜하는 손님이 찜이 된다) */
  readonly next: string | null
}

const sellable = (product: Product): boolean =>
  !product.hasOptions && product.status !== 'CLOSED' && !isTentative(product) && product.price !== null && !productSlots(product).conflict

/**
 * 같은 물건을 하나 더 팔 수 있는지와 그 결과. 할 수 없으면 null.
 * 옵션 상품(변형 재고 표)·판매 종료·확인 중·가격 없는 상품·겹친 상품은 하지 않는다. 자리가 비었는데 대기 손님이 있으면(승계 결정 필요)
 * "누가 살지 정하기"·"찜으로 올리기"가 먼저다 — 늘려도 그 빈 자리는 그대로라 판매자가 뜻과 다르게 보게 된다.
 */
export function sellMorePlan(product: Product): SellMorePlan | null {
  if (!sellable(product) || product.stock >= STOCK_MAX) return null
  const slots = productSlots(product)
  const full = slots.winners.length >= product.stock
  if (!full && slots.waitlist.length > 0) return null
  return { stock: product.stock + 1, next: full ? (slots.waitlist[0] ?? null) : null }
}

/** 하나 덜 팔기: 재고가 2 이상이고 아직 빈 자리가 있을 때만 (확정 수보다 적게 줄이지 않는다 — R-10). 할 수 없으면 null, 되면 보낼 새 재고 */
export function sellFewerStock(product: Product): number | null {
  if (!sellable(product) || product.stock < 2) return null
  const taken = Math.max(productSlots(product).winners.length, product.confirmedUnits)
  return taken < product.stock ? product.stock - 1 : null
}

/** 재고 2 이상인 상품의 "같은 물건 3개 중 1개 남음" (재고 1·옵션 상품은 null — AC-ORD11-07과 같은 말) */
export function stockWords(product: Product): string | null {
  if (product.hasOptions || product.stock < 2) return null
  const left = Math.max(0, product.stock - Math.max(productSlots(product).winners.length, product.confirmedUnits))
  return `같은 물건 ${String(product.stock)}개 중 ${String(left)}개 남음`
}

/** 같은 물건 더 팔기 팝업의 설명 (next: 찜이 될 손님 이름, 없으면 null) */
export function sellMoreDescription(next: string | null, stock: number): string {
  const who = next === null ? '다음에 찜하는 손님도 찜이 돼요.' : `대기 1번 ${next} 님도 찜이 되어 라벨을 뽑을 수 있어요.`
  return `${who}\n이 번호는 같은 물건 ${String(stock)}개를 팔아요.`
}

/**
 * 같은 물건을 하나 더 판다(product.update 재고 +1). expectNext: 팝업에 보인 찜이 될 손님(없으면 null) — 최신 상태에서 다르면 보내지 않는다.
 * 할 수 없거나 바뀐 것이 없으면 오류 문장
 */
export async function sellMore(api: ConsoleApi, product: Product, expectNext: string | null): Promise<void> {
  const latest = latestOf(api).products.get(product.key) ?? product
  const plan = sellMorePlan(latest)
  if (plan === null) throw new Error(CLAIM_NOT_APPLIED)
  if (plan.next !== expectNext) throw new Error(SELL_MORE_CHANGED)
  const result = await api.command({ type: 'product.update', b: latest.broadcast, no: latest.no, stock: plan.stock })
  if (!result.changed) throw new Error(CLAIM_NOT_APPLIED)
}

/** 하나 덜 판다(product.update 재고 −1). 빈 자리가 없어졌으면 CLAIM_NOT_APPLIED */
export async function sellFewer(api: ConsoleApi, product: Product): Promise<void> {
  const latest = latestOf(api).products.get(product.key) ?? product
  const stock = sellFewerStock(latest)
  if (stock === null) throw new Error(CLAIM_NOT_APPLIED)
  const result = await api.command({ type: 'product.update', b: latest.broadcast, no: latest.no, stock })
  if (!result.changed) throw new Error(CLAIM_NOT_APPLIED)
}
