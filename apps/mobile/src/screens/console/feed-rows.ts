// 찜 기록의 줄 만들기 (화면 없이 값만): 손님별 줄(D-UX3-79) · 번호별 줄(D-RETRO-50).
// 판정은 하지 않는다 — 상태·대기 순서·1등은 서버 값(범위 자료) 그대로 낱말로만 바꾼다. 닉네임은 이름 표기(BuyerNames — 닉네임 뒤 영문 숨기기 설정을 따른다)를 글자로만 쓴다.
import type { Claim } from '@livejjim/web/src/api/types.ts'
import { claimWord, productSlots, waitPosition, type BuyerNames } from '../../lib/derive.ts'
import type { BuyerSort, NumberSort } from '../../lib/feed-view.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import type { Palette, TonePair } from '../../ui/kit/tokens.ts'

export interface FeedNo {
  readonly id: string
  readonly no: number
  /** 찜을 받은 시각 (문자찜은 문자를 받은 시각) — 순서에만 쓴다 */
  readonly at: number
  readonly status: Claim['status']
  /** 꼬리표 낱말: 찜 · 대기 n · 보류 · 겹침 · 취소됨 … */
  readonly word: string
  readonly tone: FeedTone
  /** 이미 다른 손님이 1등인 상품을 찜했다 — 그 1등 이름 */
  readonly takenBy: string | null
  /** 그 번호의 상품이 목록에 있다(판매 종료한 상품은 아님) — 끝난 찜도 눌러 상품을 볼 수 있다 */
  readonly hasProduct: boolean
}

export interface FeedBuyer {
  /** 손님 ID */
  readonly key: string
  /** 채팅 닉네임, 문자 손님은 "문자-0937" */
  readonly buyer: string
  /** 이 손님의 가장 최근 찜 시각 */
  readonly latest: number
  /** 찜한 순서 (이름순 보기에서는 번호 오름차순) */
  readonly nos: readonly FeedNo[]
}

/** 꼬리표 색: 찜 금색 · 대기 회색 · 보류 주황 · 겹침 빨강 · 그 밖 회색 */
export type FeedTone = 'win' | 'wait' | 'pending' | 'conflict' | 'other'

const timeOf = (value: string | number): number => (typeof value === 'number' ? value : Date.parse(value))

function noTone(status: Claim['status']): FeedTone {
  if (status === 'CONFIRMED') return 'win'
  if (status === 'WAITLISTED') return 'wait'
  if (status === 'PENDING') return 'pending'
  if (status === 'CONFLICT') return 'conflict'
  return 'other'
}

/** 꼬리표 낱말 — 상품 줄과 같은 말 (1등은 "찜", D-UX3-78) */
export function noWord(data: ScopeData, claim: Claim): string {
  if (claim.status === 'CONFIRMED') return '찜'
  if (claim.status === 'WAITLISTED') {
    const position = waitPosition(data, claim)
    return position === null ? '대기' : `대기 ${String(position)}`
  }
  if (claim.status === 'PENDING') return '보류'
  if (claim.status === 'CONFLICT') return '겹침'
  return claimWord(data, claim)
}

/** 찜을 받은 시각 (순서용): 문자찜은 문자를 받은 시각, 그 밖은 순위 시각 */
function claimAt(claim: Claim): number {
  const received = claim.received === null ? Number.NaN : Date.parse(claim.received)
  return Number.isFinite(received) ? received : timeOf(claim.rankTime)
}

/** 꼬리표 바탕·글자 (키트 색 쌍, 대비 4.5:1 이상 — tokens 대비 시험) */
export function tagColors(p: Palette, danger: TonePair, tone: FeedTone): TonePair {
  if (tone === 'win') return { bg: p.goldBg, fg: p.goldText }
  if (tone === 'pending') return { bg: p.warnBg, fg: p.warnText }
  if (tone === 'conflict') return danger
  return { bg: p.soft, fg: p.textSub }
}

/** 줄 왼쪽 이름: 문자 손님은 "문자-끝 4자리"(전체 번호는 쓰지 않는다), 끝 4자리를 모르면 이름 표기 그대로 */
export function feedBuyerName(data: ScopeData, names: Pick<BuyerNames, 'name'>, buyerId: string): string {
  const buyer = data.buyers.get(buyerId)
  if (buyer?.kind === 'sms' && buyer.phoneLast4 !== null) return `문자-${buyer.phoneLast4}`
  return names.name(buyerId)
}

/** 이름 오름차순 (가나다 — 한글 음절은 글자 번호 순서가 가나다순이라 휴대폰 언어 설정과 상관없이 같다) */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * 찜 → 손님별 줄. only: 그 상태의 찜만 (보류 찜 보기).
 * sort: 최근순(기본 — 가장 최근에 찜한 손님이 맨 아래, 한 손님 안은 찜한 순서) · 이름순(이름 오름차순, 한 손님 안은 번호 오름차순 — D-RETRO-51)
 */
export function feedRows(data: ScopeData, names: Pick<BuyerNames, 'name'>, broadcastId: string, only?: Claim['status'], sort: BuyerSort = 'recent'): FeedBuyer[] {
  const groups = new Map<string, FeedNo[]>()
  for (const claim of data.claims.values()) {
    if (claim.broadcast !== broadcastId || claim.status === 'DUPLICATE') continue
    if (only !== undefined && claim.status !== only) continue
    const product = data.products.get(claim.product)
    const winners = product === undefined ? [] : productSlots(product).winners
    const takenBy = claim.status === 'WAITLISTED' && winners.length > 0 && winners[0] !== claim.currentBuyer ? names.name(winners[0]!) : null
    const item: FeedNo = {
      id: claim.id,
      no: claim.no,
      at: claimAt(claim),
      status: claim.status,
      word: noWord(data, claim),
      tone: noTone(claim.status),
      takenBy,
      hasProduct: product !== undefined && product.status !== 'CLOSED',
    }
    const list = groups.get(claim.currentBuyer)
    if (list === undefined) groups.set(claim.currentBuyer, [item])
    else list.push(item)
  }
  const rows: FeedBuyer[] = []
  for (const [key, list] of groups) {
    const byTime = [...list].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    const nos = sort === 'name' ? [...byTime].sort((a, b) => a.no - b.no) : byTime
    rows.push({ key, buyer: feedBuyerName(data, names, key), latest: byTime.at(-1)!.at, nos })
  }
  if (sort === 'name') return rows.sort((a, b) => byText(a.buyer, b.buyer) || a.key.localeCompare(b.key))
  return rows.sort((a, b) => a.latest - b.latest || a.key.localeCompare(b.key))
}

/** 꼬리표 하나의 읽기 낱말 (화면 읽기·시험용) */
export function noLabel(item: FeedNo): string {
  const base = `${String(item.no)} ${item.word}`
  return item.takenBy === null ? base : `${base} · 이미 찜됨 · 1등 ${item.takenBy}`
}

// ── 번호별 (D-RETRO-50) ─────────────────────────────────────────────

/** 번호 줄의 손님 꼬리표 하나 */
export interface FeedChip {
  /** 찜 ID */
  readonly id: string
  /** 손님 이름 (문자 손님은 "문자-0937") */
  readonly buyer: string
  readonly status: Claim['status']
  readonly tone: FeedTone
  /** 꼬리표 낱말: 찜 · 대기 n · 보류 · 겹침 · 취소됨 … (손님별 보기와 같은 말) */
  readonly word: string
  readonly at: number
  /** 그 번호의 상품이 목록에 있다(판매 종료한 상품은 아님) */
  readonly hasProduct: boolean
}

export interface FeedNumber {
  /** 상품 키 `<방송>/<번호>` */
  readonly key: string
  readonly no: number
  /** 품종 (없으면 빈 글) */
  readonly name: string
  /** 가격 (아직 상품이 없는 번호면 null) */
  readonly price: number | null
  /** 이 번호에 가장 최근에 온 찜 시각 */
  readonly latest: number
  /** 찜(확정) → 겹침 → 보류 → 대기(순번) → 끝난 찜(취소·안 됨, 받은 순서) */
  readonly chips: readonly FeedChip[]
  /** 줄을 접어도 늘 보이는 앞쪽 꼬리표 수 (찜·겹침·보류) */
  readonly keep: number
}

const CHIP_ORDER: Readonly<Record<FeedTone, number>> = { win: 0, conflict: 1, pending: 2, wait: 3, other: 4 }

/** 줄을 접었을 때 보이는 꼬리표 수 — 넘치면 "+n명" (D-RETRO-50: 손님이 많아도 줄이 길어지지 않게) */
export const NUMBER_CHIP_LIMIT = 6

/** 번호 줄 하나에서 접었을 때 보일 꼬리표와 숨은 수: 찜·겹침·보류는 늘 보이고, 나머지는 한도까지 */
export function shownChips(row: Pick<FeedNumber, 'chips' | 'keep'>, expanded: boolean): { readonly shown: readonly FeedChip[]; readonly more: number } {
  const count = expanded ? row.chips.length : Math.min(row.chips.length, Math.max(row.keep, NUMBER_CHIP_LIMIT))
  return { shown: row.chips.slice(0, count), more: row.chips.length - count }
}

/** 찜 → 번호별 줄. sort: 번호순(기본 — 오름차순) · 최근순(가장 최근에 찜이 온 번호가 맨 아래) */
export function numberRows(data: ScopeData, names: Pick<BuyerNames, 'name'>, broadcastId: string, sort: NumberSort = 'number'): FeedNumber[] {
  const groups = new Map<string, { no: number; chips: (FeedChip & { readonly rank: number })[] }>()
  for (const claim of data.claims.values()) {
    if (claim.broadcast !== broadcastId || claim.status === 'DUPLICATE') continue
    const tone = noTone(claim.status)
    // 대기는 순번 순서(서버 값), 찜은 서버가 준 1등 순서, 그 밖은 받은 순서
    const product = data.products.get(claim.product)
    const winnerIndex = product === undefined ? -1 : productSlots(product).winnerClaims.indexOf(claim.id)
    const rank = tone === 'wait' ? (waitPosition(data, claim) ?? Number.MAX_SAFE_INTEGER) : tone === 'win' && winnerIndex >= 0 ? winnerIndex : Number.MAX_SAFE_INTEGER
    const chip = { id: claim.id, buyer: feedBuyerName(data, names, claim.currentBuyer), status: claim.status, tone, word: noWord(data, claim), at: claimAt(claim), hasProduct: product !== undefined && product.status !== 'CLOSED', rank }
    const group = groups.get(claim.product)
    if (group === undefined) groups.set(claim.product, { no: claim.no, chips: [chip] })
    else group.chips.push(chip)
  }
  const rows: FeedNumber[] = []
  for (const [key, group] of groups) {
    const product = data.products.get(key)
    const chips = [...group.chips].sort((a, b) => CHIP_ORDER[a.tone] - CHIP_ORDER[b.tone] || a.rank - b.rank || a.at - b.at || a.id.localeCompare(b.id))
    rows.push({
      key,
      no: group.no,
      name: product === undefined ? '' : product.name.trim(),
      price: product === undefined ? null : product.price,
      latest: Math.max(...chips.map((chip) => chip.at)),
      chips: chips.map(({ id, buyer, status, tone, word, at, hasProduct }) => ({ id, buyer, status, tone, word, at, hasProduct })),
      keep: chips.filter((chip) => chip.tone === 'win' || chip.tone === 'conflict' || chip.tone === 'pending').length,
    })
  }
  if (sort === 'recent') return rows.sort((a, b) => a.latest - b.latest || a.no - b.no)
  return rows.sort((a, b) => a.no - b.no || a.key.localeCompare(b.key))
}

/** 번호 줄 꼬리표의 글·읽기 낱말: "홍길동 찜" · "김영희 대기 1" */
export const chipLabel = (chip: Pick<FeedChip, 'buyer' | 'word'>): string => `${chip.buyer} ${chip.word}`
