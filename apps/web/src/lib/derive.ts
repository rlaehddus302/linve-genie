// 범위 조회 결과에서 화면에 보일 값 고르기 (AC-S05-14·21·30). 판정은 하지 않는다 — 코어 조회 함수 결과를 고르고 낱말로 바꾸기만 한다.
import type { Buyer, Claim, Product } from '../api/types.ts'
import { kstTime } from './kst.ts'
import { saleOptionWords } from './sale-line.ts'
import type { ScopeData } from './scope-data.ts'
import { claimStatusWord } from './words.ts'

/** 상품 키 `<방송>/<번호>` */
export const productKey = (b: string, no: number): string => `${b}/${String(no)}`

/** 상품 ID(`p1`부터 생성 순)의 순번 — 등록 순서 */
function productOrder(product: Product): number {
  const n = Number(product.id.replace(/^\D+/, ''))
  return Number.isFinite(n) ? n : 0
}

/** 그 방송의 상품, 가장 최근 등록 순 (AC-S05-14) */
export function boardProducts(data: ScopeData, b: string): Product[] {
  const out: Product[] = []
  for (const product of data.products.values()) if (product.broadcast === b) out.push(product)
  return out.sort((x, y) => productOrder(y) - productOrder(x))
}

/** 그 방송에서 가장 최근에 등록한 상품 */
export function latestProduct(data: ScopeData, b: string): Product | undefined {
  let best: Product | undefined
  for (const product of data.products.values()) {
    if (product.broadcast !== b) continue
    if (best === undefined || productOrder(product) > productOrder(best)) best = product
  }
  return best
}

/** 이름 앞뒤를 잇는 글자 (D-098) — 괄호를 더하지 않는다 */
export const NAME_JOIN = ' · '

/** 알 수 없는 구매자 */
export const UNKNOWN_BUYER_NAME = '알 수 없는 구매자'

/**
 * 그 문자 구매자 자신을 만든 문자찜의 받은 시각 "20:01:05" (분까지 적었으면 "20:01", KST).
 * 새 문자 구매자는 그 문자찜이 늘 찜 하나를 만든다 — 그 구매자 자신의 찜 중 가장 앞 seq의 문자찜이다.
 */
function smsCreatedTimes(buyers: ReadonlyMap<string, Buyer>, claims: ReadonlyMap<string, Claim>, wanted: ReadonlySet<string>): Map<string, string> {
  const first = new Map<string, Claim>()
  if (wanted.size === 0) return new Map()
  for (const claim of claims.values()) {
    if (claim.origin !== 'sms' || !wanted.has(claim.buyer)) continue
    const seen = first.get(claim.buyer)
    if (seen === undefined || claim.seq < seen.seq) first.set(claim.buyer, claim)
  }
  const out = new Map<string, string>()
  for (const id of wanted) {
    const claim = first.get(id)
    if (claim !== undefined && buyers.has(id)) out.set(id, receivedClock(claim))
  }
  return out
}

/** 찜의 받은 시각(시각만): 분까지 적었으면 "20:01", 아니면 "20:01:05" (KST) */
export function receivedClock(claim: Pick<Claim, 'rankTime' | 'rankMinute'>): string {
  const time = kstTime(claim.rankTime)
  return claim.rankMinute ? time.slice(0, 5) : time
}

/** 구분 글자 하나 (D-098): 유튜브 "끝 1234", 뒤 4자리가 있는 문자 구매자 "뒤 4자리 5678", 전화번호 없는 문자 구매자 "문자 20:01:05" */
function tagOf(buyer: Buyer, smsTimes: ReadonlyMap<string, string>): string {
  if (buyer.kind === 'youtube') return `끝 ${buyer.id.slice(-4)}`
  if (buyer.phoneLast4 !== null) return `뒤 4자리 ${buyer.phoneLast4}`
  const time = smsTimes.get(buyer.id)
  return time === undefined ? '문자' : `문자 ${time}`
}

/**
 * 구매자 이름 표기 하나 (BUY-01 AC2, AC-S06b-20, D-098) — 모든 화면이 이 이름을 쓴다.
 * - 그 범위의 지금의 구매자 중 같은 표시 이름이 하나뿐이면 표시 이름 그대로.
 * - 둘 이상이면 `표시 이름 · 구분 글자`(유튜브 "끝 1234", 문자 "뒤 4자리 5678", 전화번호 없는 문자 "문자 20:01:05").
 *   합쳐진 구매자도 같은 규칙이고 "같은 이름 수"는 지금의 구매자 기준.
 * - 그래도 같은 표기가 둘 이상이면 생긴 순서(범위 조회의 구매자 순서 = 처음 기록된 순서)로 둘째부터 " · 2", " · 3".
 *   구분 글자가 붙었든 아니든, 합쳐진 구매자든 아니든 그날 모든 구매자의 마지막 표기끼리 본다 — 두 구매자가 한 이름으로 보이면
 *   엉뚱한 쪽과 합치거나 입금을 적거나 떼어 낸다(D-098 이유, SA-S06b-002). 예: 지금의 "홍길동"과 김철수에 합쳐진 "홍길동",
 *   구분 글자를 흉내 낸 닉네임 "홍길동 · 끝 1234"와 진짜 "홍길동 · 끝 1234".
 *   겹침은 화면에 보이는 모양으로 본다(sameLook) — 공백 여러 칸·보이지 않는 글자·호환 글자로만 다른 표기도 겹친 것이다.
 * 문자 구매자 ID·전화번호 원문은 넣지 않는다(AC-S06-80·81).
 */
export function buyerLabels(buyers: ReadonlyMap<string, Buyer>, claims: ReadonlyMap<string, Claim>): Map<string, string> {
  const counts = new Map<string, number>()
  for (const buyer of buyers.values()) if (buyer.mergedInto === null) counts.set(buyer.display, (counts.get(buyer.display) ?? 0) + 1)
  const tagged = (buyer: Buyer) => (counts.get(buyer.display) ?? 0) >= 2
  const wanted = new Set<string>()
  for (const buyer of buyers.values()) if (buyer.kind === 'sms' && buyer.phoneLast4 === null && tagged(buyer)) wanted.add(buyer.id)
  const smsTimes = smsCreatedTimes(buyers, claims, wanted)
  const labels = new Map<string, string>()
  /** 이미 정한 표기의 보이는 모양 */
  const taken = new Set<string>()
  /** 표기(보이는 모양)마다 다음에 붙여 볼 번호 */
  const nextNo = new Map<string, number>()
  for (const buyer of buyers.values()) {
    const base = tagged(buyer) ? `${buyer.display}${NAME_JOIN}${tagOf(buyer, smsTimes)}` : buyer.display
    const baseLook = sameLook(base)
    let label = base
    if (taken.has(baseLook)) {
      let n = nextNo.get(baseLook) ?? 2
      while (taken.has(sameLook(`${base}${NAME_JOIN}${String(n)}`))) n++
      nextNo.set(baseLook, n + 1)
      label = `${base}${NAME_JOIN}${String(n)}`
    }
    taken.add(sameLook(label))
    labels.set(buyer.id, label)
  }
  return labels
}

/**
 * 화면에서 같은 글자로 보이는지 견줄 모양: 호환 글자(NFKC)를 맞추고, 보이지 않는 글자(서식 글자 \p{Cf}, 빈칸으로 보이는
 * 한글 채움 문자 U+115F·U+1160·U+3164·U+FFA0)를 빼고, 공백 여러 칸을 한 칸으로(HTML은 한 칸으로 그린다).
 */
function sameLook(label: string): string {
  return label
    .normalize('NFKC')
    .replace(/[\p{Cf}ᅟᅠㅤﾠ]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** 구매자 이름 표기 (buyerLabels)를 ID로 찾는다 */
export class BuyerNames {
  readonly #labels: ReadonlyMap<string, string>
  readonly #counts = new Map<string, number>()
  readonly #buyers: ReadonlyMap<string, Buyer>
  constructor(buyers: ReadonlyMap<string, Buyer>, claims: ReadonlyMap<string, Claim>) {
    this.#buyers = buyers
    this.#labels = buyerLabels(buyers, claims)
    for (const buyer of buyers.values()) if (buyer.mergedInto === null) this.#counts.set(buyer.display, (this.#counts.get(buyer.display) ?? 0) + 1)
  }

  /** 구매자 ID → 이름 */
  name(id: string): string {
    return this.#labels.get(id) ?? UNKNOWN_BUYER_NAME
  }

  /** 그날 지금의 구매자 중 같은 표시 이름의 수 (목록의 "같은 닉네임 n명") */
  sameNameCount(id: string): number {
    const buyer = this.#buyers.get(id)
    return buyer === undefined ? 0 : (this.#counts.get(buyer.display) ?? 0)
  }
}

/** 대기 순번 (1부터, 대기 찜이 아니면 null). 옵션을 가진 찜은 그 변형의 대기 순번 (D-O1-01) */
export function waitPosition(data: ScopeData, claim: Claim): number | null {
  if (claim.status !== 'WAITLISTED') return null
  const product = data.products.get(claim.product)
  if (product === undefined) return null
  const list = claim.variant === null ? product.waitlistClaims : (variantOf(product, claim)?.waitlistClaims ?? [])
  const index = list.indexOf(claim.id)
  return index < 0 ? null : index + 1
}

/** 찜의 변형 (옵션 없는 찜이면 undefined) */
export function variantOf(product: Product, claim: Pick<Claim, 'key' | 'variant'>): Product['variants'][number] | undefined {
  if (claim.variant === null) return undefined
  return product.variants.find((variant) => variant.key === claim.key || variant.text === claim.variant)
}

/** 옵션 방송인가 (그 방송 설정 스냅샷의 claim.parseMode — D-O2-02·03) */
export function isOptionBroadcast(data: Pick<ScopeData, 'broadcasts'>, b: string): boolean {
  return data.broadcasts.get(b)?.settings['claim.parseMode'] === 'OPTIONS'
}

/** 판매 줄의 옵션 글·수량: " M", " L 2개" (옵션 없는 수량 1이면 빈 글) — D-O4-10 판매 줄 한 모양(sale-line) */
export function claimOptionWords(claim: Pick<Claim, 'variant' | 'qty'>): string {
  return saleOptionWords(claim)
}

/** 채팅 패널 안의 판정 표시용 옵션 글·수량: " M", " L ×2" — 판매 줄이 아니다(D-O2-12 그대로, D-O4-10) */
export function chatOptionWords(claim: Pick<Claim, 'variant' | 'qty'>): string {
  const variant = claim.variant === null ? '' : ` ${claim.variant}`
  return claim.qty > 1 ? `${variant} ×${String(claim.qty)}` : variant
}

/** 찜 조치 이벤트에 붙일 변형 (옵션을 가진 찜만 — R-19 "찜을 가리키는 방송자 조치", D-O1-02) */
export function claimOptionsField(claim: Pick<Claim, 'options'>): { readonly options?: Readonly<Record<string, string>> } {
  if (claim.options === null || claim.options.length === 0) return {}
  return { options: Object.fromEntries(claim.options.map(([name, label]) => [name, label])) }
}

/**
 * 찜의 지금 상태 낱말 (1등 · 대기 n번 · 보류 · 충돌 · …). 지금 시각 `now`(밀리초)를 주면 시간이 지난 보류 찜은
 * "보류 · 시간 지남"(D-MOB2-06 — 판정은 그대로, 화면 낱말만)
 */
export function claimWord(data: ScopeData, claim: Claim, now?: number): string {
  if (now !== undefined && isPendingTimedOut(data, claim, now)) return PENDING_TIMED_OUT_WORD
  return claimStatusWord(claim.status, claim.reason, waitPosition(data, claim))
}

// ── 시간이 지난 보류 찜 (D-MOB2-06, UX-04 — R-5 판정은 그대로) ─────────────

/** 시간이 지난 보류 찜의 낱말 */
export const PENDING_TIMED_OUT_WORD = '보류 · 시간 지남'
/** 문자찜 결과 카드 문장 끝 (시간이 지난 보류 찜) */
export const PENDING_TIMED_OUT_TAIL = ' — 지금 등록해도 판정되지 않아요. 판매를 시작한 뒤 문자찜을 다시 넣어 주세요' // D-MOB2-16 (3)
/** 방송 설정이 없을 때의 보류 찜 유효 시간(초) — 서버 기본값과 같다 */
const DEFAULT_PRE_OPEN_WINDOW_SEC = 30

/**
 * 순수 판단: 찜이 들어온 시각 `atMs`, 지금(또는 공개 시각) `nowMs`, 유효 시간 `windowSec`(초)에서 시간이 지났는가.
 * R-5 2(`at ≥ T − W`면 판정에 들어감, 경계 포함)의 반대 — `nowMs − atMs > windowSec × 1000`(밀리초로 비교). 경계 정각은 아직 유효.
 */
export function pendingWindowPassed(atMs: number, nowMs: number, windowSec: number): boolean {
  return nowMs - atMs > windowSec * 1000
}

/** 그 방송의 보류 찜 유효 시간(초) — 방송 설정 스냅샷의 claim.preOpenWindowSec */
export function preOpenWindowSec(data: Pick<ScopeData, 'broadcasts'>, b: string): number {
  const value = data.broadcasts.get(b)?.settings['claim.preOpenWindowSec']
  return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_PRE_OPEN_WINDOW_SEC
}

/**
 * 시간 지남을 잴 때의 시작 시각(밀리초): 이 탭이 그 찜을 처음 받은 시각(D-MOB2-15 — 둘 다 이 기기 시계라 시계 차이가 없다).
 * 자료에 처음 받은 시각 기록이 없으면(저장소를 거치지 않은 자료) 찜의 at. 기록은 있는데 그 찜이 없으면 null(아직 모름 — 시간 지남 아님)
 */
export function pendingStart(data: Pick<ScopeData, 'seen'>, claim: Pick<Claim, 'id' | 'at'>): number | null {
  if (data.seen !== undefined) return data.seen.get(claim.id) ?? null
  const at = Date.parse(claim.at)
  return Number.isFinite(at) ? at : null
}

/**
 * 시간이 지난 보류 찜인가: 상태 `PENDING`, 그 번호의 상품이 아직 판매 중이 아님(없음·`READY`),
 * (지금 − 이 탭이 그 찜을 처음 받은 시각) > 그 방송의 유효 시간 (D-MOB2-06·D-MOB2-15)
 */
export function isPendingTimedOut(
  data: Pick<ScopeData, 'broadcasts' | 'products' | 'seen'>,
  claim: Pick<Claim, 'id' | 'status' | 'at' | 'product' | 'broadcast'>,
  now: number,
): boolean {
  if (claim.status !== 'PENDING') return false
  const product = data.products.get(claim.product)
  if (product !== undefined && product.status !== 'READY') return false
  const start = pendingStart(data, claim)
  if (start === null) return false
  return pendingWindowPassed(start, now, preOpenWindowSec(data, claim.broadcast))
}

/**
 * 다음에 보류 찜 하나가 "시간 지남"으로 바뀌는 시각(밀리초) — 없으면 null. 화면은 이때 한 번 다시 그린다(1초마다 그리지 않는다).
 * 시간이 지나는 순간은 처음 받은 시각(pendingStart) + W×1000 + 1ms(경계 정각은 아직 유효).
 */
export function nextPendingFlip(data: Pick<ScopeData, 'broadcasts' | 'products' | 'pending' | 'claims' | 'seen'>, now: number): number | null {
  let best: number | null = null
  for (const slot of data.pending.values()) {
    for (const id of slot.claims) {
      const claim = data.claims.get(id)
      if (claim === undefined || claim.status !== 'PENDING') continue
      const start = pendingStart(data, claim)
      if (start === null) continue
      const flip = start + preOpenWindowSec(data, claim.broadcast) * 1000 + 1
      if (flip > now && (best === null || flip < best)) best = flip
    }
  }
  return best
}

const requestIndexCache = new WeakMap<ScopeData['cancelRequests'], ReadonlyMap<string, number>>()

/** 상품의 취소 요청 수 */
export function cancelRequestCount(data: ScopeData, product: Product): number {
  let index = requestIndexCache.get(data.cancelRequests)
  if (index === undefined) {
    const map = new Map<string, number>()
    for (const request of data.cancelRequests.values()) map.set(request.product, (map.get(request.product) ?? 0) + 1)
    requestIndexCache.set(data.cancelRequests, map)
    index = map
  }
  return index.get(product.key) ?? 0
}

/** 상품 단위로 모은 1등·대기·승계·충돌. 옵션 상품은 변형에만 있으니 변형을 합친다 (R-19 "변형과 재고 단위", D-O1-01) */
export interface ProductSlots {
  readonly winners: readonly string[]
  readonly winnerClaims: readonly string[]
  readonly waitlist: readonly string[]
  readonly waitlistClaims: readonly string[]
  readonly awaitingSuccession: boolean
  readonly conflict: boolean
}

const slotsCache = new WeakMap<Product, ProductSlots>()

export function productSlots(product: Product): ProductSlots {
  if (!product.hasOptions || product.variants.length === 0) return product
  const cached = slotsCache.get(product)
  if (cached !== undefined) return cached
  const slots: ProductSlots = {
    winners: [...product.winners, ...product.variants.flatMap((variant) => variant.winners)],
    winnerClaims: [...product.winnerClaims, ...product.variants.flatMap((variant) => variant.winnerClaims)],
    waitlist: [...product.waitlist, ...product.variants.flatMap((variant) => variant.waitlist)],
    waitlistClaims: [...product.waitlistClaims, ...product.variants.flatMap((variant) => variant.waitlistClaims)],
    awaitingSuccession: product.awaitingSuccession || product.variants.some((variant) => variant.awaitingSuccession),
    conflict: product.conflict || product.variants.some((variant) => variant.conflict),
  }
  slotsCache.set(product, slots)
  return slots
}

/** 승계·충돌을 정할 단위 하나: 상품 자체(variant 없음) 또는 그 변형 */
export interface DecisionUnit {
  readonly product: Product
  readonly variant: Product['variants'][number] | undefined
  readonly winnerClaims: readonly string[]
  readonly waitlistClaims: readonly string[]
  readonly waitlist: readonly string[]
}

const unitOf = (product: Product, variant: Product['variants'][number] | undefined): DecisionUnit =>
  variant === undefined
    ? { product, variant, winnerClaims: product.winnerClaims, waitlistClaims: product.waitlistClaims, waitlist: product.waitlist }
    : { product, variant, winnerClaims: variant.winnerClaims, waitlistClaims: variant.waitlistClaims, waitlist: variant.waitlist }

/** 승계 결정 필요한 단위 (상품 → 변형 순서) */
export function successionUnits(product: Product): DecisionUnit[] {
  const out: DecisionUnit[] = []
  if (product.awaitingSuccession) out.push(unitOf(product, undefined))
  // 옵션 없는 상품(옛 기록·봉인 날짜의 상품은 변형 칸이 없을 수 있다)은 변형을 보지 않는다
  if (!product.hasOptions) return out
  for (const variant of product.variants) if (variant.awaitingSuccession) out.push(unitOf(product, variant))
  return out
}

/** 충돌이 있는 단위 (상품 → 변형 순서) */
export function conflictUnits(product: Product): DecisionUnit[] {
  const out: DecisionUnit[] = []
  if (product.conflict) out.push(unitOf(product, undefined))
  if (!product.hasOptions) return out
  for (const variant of product.variants) if (variant.conflict) out.push(unitOf(product, variant))
  return out
}

/** 변형을 가리키는 방송자 조치의 options 칸 (변형이 없으면 빈 객체) */
export function variantOptionsField(variant: Product['variants'][number] | undefined): { readonly options?: Readonly<Record<string, string>> } {
  if (variant === undefined || variant.options.length === 0) return {}
  return { options: Object.fromEntries(variant.options.map(([name, label]) => [name, label])) }
}

/** 알림 띠 (AC-S05-30): 충돌 · 취소 요청 · 승계 결정 필요 · 보류 찜 · 확인 필요 */
export interface AlertCounts {
  readonly conflict: number
  readonly cancelRequest: number
  readonly succession: number
  readonly pending: number
  readonly attention: number
}

/**
 * 알림 수. 지금 시각 `now`(밀리초)를 받아 "보류 찜"은 시간이 지나지 않은 보류 찜만 센다(D-MOB2-06, 경계 정각은 셈 —
 * 1ms 넘기면 빠짐). `now`를 주지 않으면 시간을 보지 않고 모두 센다(지난 날짜 범위처럼 시계가 뜻이 없는 곳)
 */
export function alertCounts(data: ScopeData, now?: number): AlertCounts {
  let conflict = 0
  let succession = 0
  for (const product of data.products.values()) {
    conflict += conflictUnits(product).length
    succession += successionUnits(product).length
  }
  let pending = 0
  for (const slot of data.pending.values()) {
    if (data.products.has(slot.product)) continue
    if (now === undefined) {
      pending += slot.claims.length
      continue
    }
    for (const id of slot.claims) {
      const claim = data.claims.get(id)
      if (claim === undefined || !isPendingTimedOut(data, claim, now)) pending++
    }
  }
  return { conflict, cancelRequest: data.cancelRequests.size, succession, pending, attention: data.attention.length }
}

/** 보류 찜 묶음 하나 (번호마다) */
export interface PendingGroup {
  readonly product: string
  readonly broadcast: string
  readonly no: number
  readonly claims: Claim[]
}

/** 상품이 아직 없는 번호의 보류 찜 묶음 */
export function orphanPending(data: ScopeData): PendingGroup[] {
  const out: PendingGroup[] = []
  for (const slot of data.pending.values()) {
    if (data.products.has(slot.product)) continue
    const claims = slot.claims.map((id) => data.claims.get(id)).filter((claim): claim is Claim => claim !== undefined)
    out.push({ product: slot.product, broadcast: slot.broadcast, no: slot.no, claims })
  }
  return out.sort((a, b) => a.no - b.no)
}

/**
 * 보류 찜 창의 두 목록 (D-MOB2-06): `live` = 시간이 지나지 않은 찜이 하나라도 있는 번호(묶음 그대로),
 * `timedOut` = 시간이 지난 찜만 남은 번호(번호마다 그 수 — "번호 넣기" 없음)
 */
export function splitPending(data: ScopeData, now: number): { live: PendingGroup[]; timedOut: PendingGroup[] } {
  const live: PendingGroup[] = []
  const timedOut: PendingGroup[] = []
  for (const group of orphanPending(data)) {
    if (group.claims.length > 0 && group.claims.every((claim) => isPendingTimedOut(data, claim, now))) timedOut.push(group)
    else live.push(group)
  }
  return { live, timedOut }
}

/** 금액 표시 — 코어 formatWon 모양 */
export { formatWon } from '@livejjim/core'
