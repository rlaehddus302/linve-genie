// 찜 기록의 줄 만들기 (화면 없이 값만): 손님별 줄(D-UX3-79) · 찾기(D-UX4-152) · 이름순 한글 먼저(D-UX4-153).
// 번호별 줄(D-RETRO-50)은 D-UX4-151로 걷었다 — 번호로 누가 찜했는지는 상품 탭 [찜 된 것만](D-UX4-141)과 찜 기록 찾기 칸에서 본다.
// 판정은 하지 않는다 — 상태·대기 순서·1등은 서버 값(범위 자료) 그대로 낱말로만 바꾼다. 닉네임은 이름 표기(BuyerNames — 닉네임 뒤 영문 숨기기 설정을 따른다)를 글자로만 쓴다.
import type { Claim } from '@livejjim/web/src/api/types.ts'
import { kstTime } from '@livejjim/web/src/lib/kst.ts'
import { claimWord, productSlots, waitPosition, type BuyerNames } from '../../lib/derive.ts'
import type { BuyerSort } from '../../lib/feed-view.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import type { Palette, TonePair } from '../../ui/kit/tokens.ts'
import { ACTIVE_CLAIM } from './claim-actions.ts'

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
export function claimAt(claim: Pick<Claim, 'received' | 'rankTime'>): number {
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

// ── 이름순: 한글 → 영문 → 숫자 → 기호 (D-UX4-153 — D-RETRO-51의 글자 번호 순서를 바꿈) ──────────
// 옛: 글자 번호 순서 그대로라 영문·숫자 이름(글자 번호가 작다)이 한글 이름보다 앞에 섰다.
// 글자마다 무리를 먼저 견주고(한글 0 · 영문 1 · 숫자 2 · 그 밖 3), 같은 무리면 글자 번호 순서(영문은 대소문자 무시) — 한글 음절은 글자 번호 순서가 가나다순이다.
// 휴대폰 언어 설정(localeCompare)에 기대지 않아 아이폰·갤럭시가 같은 차례다(D-RETRO-140과 같은 까닭). 유튜브 아이디 앞의 "@"·띄어쓰기는 견주지 않는다.

/** 이름 글자의 무리: 한글 0 · 영문 1 · 숫자 2 · 그 밖(기호·그림 글자 등) 3 */
export function nameCharRank(code: number): number {
  // 한글 음절 · 한글 자모 · 호환 자모
  if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3131 && code <= 0x318e)) return 0
  // 영문 (악센트 붙은 라틴 글자 포함, × ÷ 제외)
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0xc0 && code <= 0x24f && code !== 0xd7 && code !== 0xf7)) return 1
  if (code >= 0x30 && code <= 0x39) return 2
  return 3
}

/** 견줄 이름: 넓은 글자를 보통 글자로(NFKC), 소문자, 앞의 "@"와 띄어쓰기를 뺀다 */
const sortKey = (name: string): number[] => Array.from(name.normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/^@+/, ''), (char) => char.codePointAt(0) ?? 0)

/** 이름순 견주기 (한글 먼저 — D-UX4-153). 같으면 0 */
export function compareNames(a: string, b: string): number {
  const x = sortKey(a)
  const y = sortKey(b)
  const length = Math.min(x.length, y.length)
  for (let index = 0; index < length; index += 1) {
    const p = x[index]!
    const q = y[index]!
    if (p === q) continue
    return nameCharRank(p) - nameCharRank(q) || p - q
  }
  return x.length - y.length || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * 찜 → 손님별 줄. only: 그 상태의 찜만 (보류 찜 보기).
 * sort: 최근순(기본 — 가장 최근에 찜한 손님이 맨 아래, 한 손님 안은 찜한 순서) · 이름순(한글 → 영문 → 숫자·기호, 같은 무리는 가나다·알파벳 순 — D-UX4-153, 한 손님 안은 번호 오름차순 — D-RETRO-51)
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
  if (sort === 'name') return rows.sort((a, b) => compareNames(a.buyer, b.buyer) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return rows.sort((a, b) => a.latest - b.latest || a.key.localeCompare(b.key))
}

/** 꼬리표 하나의 읽기 낱말 (화면 읽기·시험용) */
export function noLabel(item: FeedNo): string {
  const base = `${String(item.no)} ${item.word}`
  return item.takenBy === null ? base : `${base} · 이미 찜됨 · 1등 ${item.takenBy}`
}

/** 찜 기록 시각: 한국 시각 "13:05:42" — 초까지 (D-UX4-154). 읽을 수 없는 시각이면 빈 글 */
export const feedClock = (at: number): string => kstTime(at)

// ── 찾기 (D-UX4-152): 한 칸에서 번호 또는 닉네임 ───────────────────────────

/** 찾는 글을 견줄 꼴로: 넓은 글자를 보통 글자로(NFKC), 소문자, 띄어쓰기를 모두 뺀다 */
export const searchText = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/\s+/g, '')

/**
 * 이 손님 줄이 찾는 글에 맞는지 (화면 없이 값만).
 * - 빈 글(띄어쓰기만 포함)은 모두 맞는다.
 * - 닉네임(보이는 이름 — 문자 손님은 "문자-0937")에 찾는 글이 들어 있으면 맞는다. 대소문자·띄어쓰기는 보지 않는다.
 * - 숫자만 쳤으면 그 번호를 찜한 손님도 맞는다 — 번호는 꼭 같은 번호만(15를 치면 150번대는 아니다). 앞의 0은 보지 않는다(015 = 15).
 */
export function feedMatches(row: Pick<FeedBuyer, 'buyer' | 'nos'>, query: string): boolean {
  const wanted = searchText(query)
  if (wanted === '') return true
  if (searchText(row.buyer).includes(wanted)) return true
  if (!/^\d{1,9}$/.test(wanted)) return false
  const no = Number(wanted)
  return row.nos.some((item) => item.no === no)
}

/** 찾는 글에 맞는 줄만 (차례는 그대로) */
export function filterFeed<T extends Pick<FeedBuyer, 'buyer' | 'nos'>>(rows: readonly T[], query: string): T[] {
  return searchText(query) === '' ? [...rows] : rows.filter((row) => feedMatches(row, query))
}

/**
 * 찜 꼬리표를 누를 수 있는지 (찜 메뉴 ClaimMenu가 내놓는 줄이 하나라도 있을 때만 — D-UX4-154).
 * 라이브 중: 살아 있는 찜(삭제·올리기), 또는 끝난 찜이어도 그 상품이 목록에 있으면(되돌리기·상품 보기).
 * 끝난·봉인한 라이브: 메뉴에는 [상품 보기]만 남으므로 그 상품이 목록에 있고 상품 보기를 열 수 있을 때만.
 */
export function feedPickable(item: Pick<FeedNo, 'status' | 'hasProduct'>, closed: boolean, canOpenProduct: boolean): boolean {
  if (closed) return item.hasProduct && canOpenProduct
  return ACTIVE_CLAIM.has(item.status) || item.hasProduct
}
