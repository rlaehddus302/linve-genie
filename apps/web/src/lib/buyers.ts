// 구매자 화면의 값 고르기 (BUY-01 AC2, BUY-03, BUY-04, R-11, D-090·D-091). 판정은 하지 않는다 — 코어 조회 결과(buyers·claims·settlements)를 고르고 낱말로 바꾼다.
// 합치기 미리 보기는 엔진 규칙(R-11 "구매자 합치기")을 그대로 읽어 보이기만 한다: 보내는 것은 buyer.merge이고 결과는 엔진이 정한다.
import type { Buyer, Claim, Settlement } from '../api/types.ts'
import { claimWord, type BuyerNames } from './derive.ts'
import type { ScopeData } from './scope-data.ts'
import { settlementKey } from './scope-data.ts'

/** 채널 ID 끝 4자리 (유튜브 구매자) */
export function channelTail(buyer: Buyer): string {
  return buyer.id.slice(-4)
}

/** 찾기 결과 한 줄: 지금의 구매자와, 찾기에 걸린 구매자(합쳐진 구매자면 다르다) */
export interface BuyerHit {
  readonly current: Buyer
  readonly matched: Buyer
}

const fold = (text: string): string => text.trim().toLowerCase()

function matches(buyer: Buyer, query: string, digits: boolean): boolean {
  if (fold(buyer.display).includes(query)) return true
  if (buyer.nameHistory.some((name) => fold(name).includes(query))) return true
  if (!digits) return false
  if (buyer.phoneLast4 === query) return true
  return buyer.kind === 'youtube' && fold(channelTail(buyer)) === query
}

/**
 * 구매자 찾기 (AC-S06-21): 그날 기록된 모든 구매자(찜 없는 시청자 포함)에서 표시 이름·닉네임 이력·메모 이력(부분 일치, 대소문자·앞뒤 공백 무시),
 * 숫자 4자리면 뒤 4자리와 채널 ID 끝 4자리도. 합쳐진 구매자가 걸리면 지금의 구매자 줄로(matched에 걸린 구매자).
 * 같은 지금의 구매자는 한 줄만.
 */
export function searchBuyers(buyers: ReadonlyMap<string, Buyer>, text: string, limit = 50): BuyerHit[] {
  const query = fold(text)
  if (query === '') return []
  const digits = /^\d{4}$/.test(query)
  const out: BuyerHit[] = []
  const seen = new Set<string>()
  for (const buyer of buyers.values()) {
    if (!matches(buyer, query, digits)) continue
    const current = buyers.get(buyer.current) ?? buyer
    if (seen.has(current.id)) continue
    seen.add(current.id)
    out.push({ current, matched: buyer })
    if (out.length >= limit) break
  }
  return out
}

/** 그날 지금의 구매자 중 같은 표시 이름의 수 */
export function sameNameCounts(buyers: ReadonlyMap<string, Buyer>): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const buyer of buyers.values()) {
    if (buyer.mergedInto !== null) continue
    counts.set(buyer.display, (counts.get(buyer.display) ?? 0) + 1)
  }
  return counts
}

/** 구분 표시 (D-090): 같은 표시 이름이 둘 이상이면 "같은 닉네임 n명 · 끝 1234", 문자 구매자는 뒤 4자리가 있으면 "뒤 4자리 5678" */
export function distinguishWords(buyer: Buyer, counts: ReadonlyMap<string, number>): string[] {
  const words: string[] = []
  const same = counts.get(buyer.display) ?? 0
  if (same >= 2) words.push(`같은 닉네임 ${String(same)}명`)
  if (buyer.kind === 'youtube') {
    if (same >= 2) words.push(`끝 ${channelTail(buyer)}`)
  } else if (buyer.phoneLast4 !== null) words.push(`뒤 4자리 ${buyer.phoneLast4}`)
  return words
}

export type BuyerSort = 'name' | 'total'

/**
 * 구매자 목록 (AC-S06-20): 기본은 그날 확정 찜이 있는 지금의 구매자, all이면 그날 기록된 지금의 구매자 전부.
 * 합쳐진 구매자는 따로 줄을 만들지 않는다. 정렬: 표시 이름 순 또는 합계 큰 순(같으면 이름 순).
 */
export function buyerList(buyers: ReadonlyMap<string, Buyer>, options: { readonly all: boolean; readonly sort: BuyerSort }): Buyer[] {
  const out: Buyer[] = []
  for (const buyer of buyers.values()) {
    if (buyer.mergedInto !== null) continue
    if (!options.all && buyer.items.length === 0) continue
    out.push(buyer)
  }
  const byName = (a: Buyer, b: Buyer) => a.display.localeCompare(b.display, 'ko') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return out.sort(options.sort === 'total' ? (a, b) => b.subtotal - a.subtotal || byName(a, b) : byName)
}

/** (지금의 구매자, 날짜)의 정산 묶음 */
export function settlementOf(data: ScopeData, buyer: string): Settlement | undefined {
  return data.settlements.get(settlementKey({ buyer, date: data.date }))
}

const ACTIVE = new Set(['CONFIRMED', 'CONFLICT', 'WAITLISTED', 'PENDING'])
const STATUS_ORDER: Readonly<Record<string, number>> = { CONFIRMED: 0, CONFLICT: 1, WAITLISTED: 2, PENDING: 3 }

/** 지금의 구매자(합친 구매자 포함)의 찜 */
export function claimsOf(data: ScopeData, current: string): Claim[] {
  const out: Claim[] = []
  for (const claim of data.claims.values()) if (claim.currentBuyer === current) out.push(claim)
  return out.sort((a, b) => a.seq - b.seq)
}

export function isActive(claim: Claim): boolean {
  return ACTIVE.has(claim.status)
}

/** 한 상품에 두 활성 찜이 있을 때 앞선 쪽 (R-11: 1등 > 충돌 > 대기 앞 순번 > 보류 판정 순위) */
function ahead(data: ScopeData, a: Claim, b: Claim): boolean {
  const byStatus = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
  if (byStatus !== 0) return byStatus < 0
  if (a.status === 'WAITLISTED') {
    const order = data.products.get(a.product)?.waitlistClaims ?? []
    return order.indexOf(a.id) < order.indexOf(b.id)
  }
  if (a.status === 'PENDING') {
    const order = data.pending.get(a.product)?.claims ?? []
    const ia = order.indexOf(a.id)
    const ib = order.indexOf(b.id)
    if (ia >= 0 && ib >= 0) return ia < ib
  }
  return a.seq < b.seq
}

export interface DuplicateLine {
  readonly product: string
  readonly broadcast: string
  readonly no: number
  /** 중복으로 정리될 찜 */
  readonly claim: Claim
  /** "16번: 홍길동의 대기 2번 찜이 중복으로 정리돼요" */
  readonly text: string
}

export type MergeBlock =
  | { readonly kind: 'bothWinners'; readonly products: readonly { readonly product: string; readonly broadcast: string; readonly no: number; readonly text: string }[] }
  | { readonly kind: 'fromMerged'; readonly text: string }
  | { readonly kind: 'cycle'; readonly text: string }
  | { readonly kind: 'same'; readonly text: string }

export interface MergePlan {
  /** 옮겨 갈 구매자 (from) */
  readonly from: Buyer
  /** 남는 구매자 (into) */
  readonly into: Buyer
  /** 합친 뒤의 지금의 구매자 (into의 지금의 구매자) */
  readonly target: Buyer
  readonly movingCount: number
  readonly movingTotal: number
  readonly afterTotal: number
  readonly duplicates: readonly DuplicateLine[]
  readonly blocks: readonly MergeBlock[]
}

/** 받침이 있으면 "은", 없으면 "는" (한글이 아니면 "은(는)") */
export function topicParticle(word: string): string {
  for (let i = word.length - 1; i >= 0; i--) {
    const code = word.charCodeAt(i)
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? '는' : '은'
  }
  return '은(는)'
}

/**
 * 합치기 미리 보기 (AC-S06-23, D-091): 옮겨 갈 확정 찜 수·합계, 합친 뒤 합계, 중복으로 정리될 찜, 막는 경우.
 * productLabel은 "15번"(다른 방송이면 "2부 15번").
 */
export function planMerge(data: ScopeData, names: BuyerNames, fromId: string, intoId: string, productLabel: (broadcast: string, no: number) => string): MergePlan | null {
  const from = data.buyers.get(fromId)
  const into = data.buyers.get(intoId)
  if (from === undefined || into === undefined) return null
  const target = data.buyers.get(into.current) ?? into
  const blocks: MergeBlock[] = []
  const fromName = names.name(from.id)
  if (from.id === into.id) blocks.push({ kind: 'same', text: '같은 구매자끼리는 합칠 수 없어요.' })
  if (from.mergedInto !== null) {
    const parentName = names.name(from.mergedInto)
    blocks.push({ kind: 'fromMerged', text: `${fromName}${topicParticle(fromName)} 이미 ${parentName}에 합쳐져 있어요. 먼저 떼어 내 주세요.` })
  } else if (target.id === from.id && from.id !== into.id) {
    const intoName = names.name(into.id)
    blocks.push({ kind: 'cycle', text: `${intoName}${topicParticle(intoName)} 이미 ${fromName}에 합쳐져 있어요.` })
  }
  const targetActive = new Map<string, Claim>()
  for (const claim of data.claims.values()) if (claim.currentBuyer === target.id && isActive(claim)) targetActive.set(claim.product, claim)
  const both: { product: string; broadcast: string; no: number; text: string }[] = []
  const duplicates: DuplicateLine[] = []
  if (from.mergedInto === null && target.id !== from.id) {
    for (const claim of data.claims.values()) {
      if (claim.currentBuyer !== from.id || !isActive(claim)) continue
      const other = targetActive.get(claim.product)
      if (other === undefined) continue
      const label = productLabel(claim.broadcast, claim.no)
      if (claim.status === 'CONFIRMED' && other.status === 'CONFIRMED') {
        both.push({ product: claim.product, broadcast: claim.broadcast, no: claim.no, text: `${label}에 두 사람 모두 1등이에요. 먼저 한 사람의 찜을 취소해 주세요.` })
        continue
      }
      const drop = ahead(data, claim, other) ? other : claim
      duplicates.push({
        product: claim.product,
        broadcast: claim.broadcast,
        no: claim.no,
        claim: drop,
        text: `${label}: ${names.name(drop.buyer)}의 ${claimWord(data, drop)} 찜이 중복으로 정리돼요`,
      })
    }
  }
  if (both.length > 0) blocks.unshift({ kind: 'bothWinners', products: both.sort((a, b) => a.no - b.no) })
  return {
    from,
    into,
    target,
    movingCount: from.items.length,
    movingTotal: from.subtotal,
    afterTotal: target.subtotal + from.subtotal,
    duplicates: duplicates.sort((a, b) => a.no - b.no),
    blocks,
  }
}

/** 합치기 방향 기본 (D-091): 둘 중 하나만 유튜브 구매자면 유튜브 쪽이 남는다, 아니면 자세히를 열어 둔 구매자가 남는다 */
export function defaultInto(opened: Buyer, other: Buyer): Buyer {
  if (opened.kind !== other.kind) return opened.kind === 'youtube' ? opened : other
  return opened
}
