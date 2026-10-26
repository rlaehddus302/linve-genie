// 구매자 화면의 값 고르기 (BUY-01 AC2, BUY-03, BUY-04, R-11, D-090·D-091). 판정은 하지 않는다 — 코어 조회 결과(buyers·claims·settlements)를 고르고 낱말로 바꾼다.
// 합치기 미리 보기는 서버가 코어 previewMerge로 계산한 값을 낱말로만 바꾼다(D-100): 막는 조건·남는 찜(R-11)을 화면에 두지 않는다.
import type { MergePreview } from '@livejjim/core'
import type { Buyer, Claim, Settlement } from '../api/types.ts'
import { claimWord, type BuyerNames } from './derive.ts'
import { claimStatusWord } from './words.ts'
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

/** 그 구매자(합쳐져 있으면 지금의 구매자로 따라가서)의 그 상품 활성 찜 */
export function activeClaimOf(data: ScopeData, buyer: string, product: string): Claim | undefined {
  const current = data.buyers.get(buyer)?.current ?? buyer
  for (const claim of data.claims.values()) if (claim.product === product && claim.currentBuyer === current && isActive(claim)) return claim
  return undefined
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

/** 목록 줄의 구분 표시 (D-090·D-098): 같은 표시 이름이 둘 이상이면 "같은 닉네임 n명" — 구분 글자(끝 1234·뒤 4자리·문자 시각)는 이름(BuyerNames)에 있다 */
export function distinguishWords(buyer: Buyer, counts: ReadonlyMap<string, number>): string[] {
  const same = counts.get(buyer.display) ?? 0
  return same >= 2 ? [`같은 닉네임 ${String(same)}명`] : []
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
/** 지금의 구매자(합친 구매자 포함)의 찜 */
export function claimsOf(data: ScopeData, current: string): Claim[] {
  const out: Claim[] = []
  for (const claim of data.claims.values()) if (claim.currentBuyer === current) out.push(claim)
  return out.sort((a, b) => a.seq - b.seq)
}

export function isActive(claim: Claim): boolean {
  return ACTIVE.has(claim.status)
}

/** 숫자를 읽을 때 받침이 있는지 (영·일·삼·육·칠·팔은 있다, 이·사·오·구는 없다) */
const DIGIT_FINAL: Readonly<Record<string, boolean>> = { '0': true, '1': true, '2': false, '3': true, '4': false, '5': false, '6': true, '7': true, '8': true, '9': false }

/**
 * 끝 글자에 받침이 있는지: 한글이면 그 글자, 숫자면 읽는 소리("· 2" → 이, "20:01:05" → 오). 괄호·기호·빈칸은 건너뛴다.
 * 영문 등 읽기를 정하지 못하면 null.
 */
export function hasFinalConsonant(word: string): boolean | null {
  for (let i = word.length - 1; i >= 0; i--) {
    const char = word[i] as string
    const code = char.charCodeAt(0)
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0
    const digit = DIGIT_FINAL[char]
    if (digit !== undefined) return digit
    if (/[\p{L}]/u.test(char)) return null
  }
  return null
}

/** 받침이 있으면 "은", 없으면 "는" (정하지 못하면 "은(는)") */
export function topicParticle(word: string): string {
  const final = hasFinalConsonant(word)
  return final === null ? '은(는)' : final ? '은' : '는'
}

/** 받침이 있으면 "을", 없으면 "를" (정하지 못하면 "을(를)") */
export function objectParticle(word: string): string {
  const final = hasFinalConsonant(word)
  return final === null ? '을(를)' : final ? '을' : '를'
}

/** 상품 키 `<방송>/<번호>` → 방송·번호 */
export function splitProductKey(key: string): { readonly broadcast: string; readonly no: number } {
  const at = key.lastIndexOf('/')
  return { broadcast: key.slice(0, at), no: Number(key.slice(at + 1)) }
}

/** 합치기 미리 보기 조회 응답 (GET /api/days/:date/merge-preview — 코어 previewMerge 그대로, D-100) */
export interface MergePreviewView {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly preview: MergePreview
}

/** 막힌 까닭 한 줄. 두 사람 모두 1등이면 상품마다 한 줄이고 그 상품 */
export interface MergeBlockLine {
  readonly text: string
  readonly product?: { readonly key: string; readonly broadcast: string; readonly no: number }
}

export interface MergeWords {
  /** 막힌 까닭 (막히지 않으면 빈 목록) */
  readonly blocks: readonly MergeBlockLine[]
  /** 중복으로 정리될 찜마다 "16번: 홍길동의 대기 2번 찜이 중복으로 정리돼요" */
  readonly duplicates: readonly { readonly claim: string; readonly text: string }[]
  /** 옮겨 갈 확정 찜 수·합계 */
  readonly movingCount: number
  readonly movingTotal: number
  /** 합친 뒤 합계 — 막히면 null (합치기가 일어나지 않는다, TE-S06-002) */
  readonly afterTotal: number | null
}

const SAME_BUYER = '같은 구매자끼리는 합칠 수 없어요.'
const UNKNOWN_BUYER = '구매자를 찾지 못했어요. 화면을 새로 불러와 주세요.'

/**
 * 서버가 계산한 합치기 미리 보기(코어 previewMerge, AC-S06b-33)를 낱말로만 바꾼다. 막는 조건·남는 찜은 화면이 정하지 않는다(R-11은 엔진 하나, D-100).
 * 중복 문장의 대기 순번·상태 낱말은 그 찜 ID로 범위 조회에서 찾는다. productLabel은 "15번"(다른 방송이면 "2부 15번").
 * now(usePendingNow): 시간이 지난 보류 찜을 다른 화면처럼 "보류 · 시간 지남"으로 (D-MOB2-15, RA-MOB2-07)
 */
export function mergeWords(data: ScopeData, names: BuyerNames, preview: MergePreview, productLabel: (broadcast: string, no: number) => string, now?: number): MergeWords {
  const fromName = names.name(preview.from)
  const blocks: MergeBlockLine[] = []
  switch (preview.blocked) {
    case 'BOTH_CONFIRMED':
      for (const key of preview.bothConfirmed) {
        const { broadcast, no } = splitProductKey(key)
        blocks.push({ text: `${productLabel(broadcast, no)}에 두 사람 모두 1등이에요. 먼저 한 사람의 찜을 취소해 주세요.`, product: { key, broadcast, no } })
      }
      break
    case 'FROM_MERGED': {
      const parent = data.buyers.get(preview.from)?.mergedInto
      const parentName = parent === null || parent === undefined ? names.name(preview.target ?? '') : names.name(parent)
      blocks.push({ text: `${fromName}${topicParticle(fromName)} 이미 ${parentName}에 합쳐져 있어요. 먼저 떼어 내 주세요.` })
      break
    }
    case 'CYCLE': {
      const intoName = names.name(preview.into)
      blocks.push({ text: `${intoName}${topicParticle(intoName)} 이미 ${fromName}에 합쳐져 있어요.` })
      break
    }
    case 'SAME_BUYER':
      blocks.push({ text: SAME_BUYER })
      break
    case 'UNKNOWN_BUYER':
      blocks.push({ text: UNKNOWN_BUYER })
      break
    case null:
      break
  }
  const duplicates = preview.duplicates.map((item) => {
    const { broadcast, no } = splitProductKey(item.product)
    const claim = data.claims.get(item.claim)
    const word = claim === undefined ? claimStatusWord(item.status, null, null) : claimWord(data, claim, now)
    return { claim: item.claim, text: `${productLabel(broadcast, no)}: ${names.name(item.buyer)}의 ${word} 찜이 중복으로 정리돼요` }
  })
  return {
    blocks,
    duplicates,
    movingCount: preview.moving.items.length,
    movingTotal: preview.moving.subtotal,
    afterTotal: preview.blocked === null && preview.after !== null ? preview.after.subtotal : null,
  }
}

/** 음성 문자찜에서 손님을 말하지 않아 생긴 구매자의 표시 이름 (메모 `확인 필요`, R-21 넣기·ORD-08 AC9) */
export const UNKNOWN_SMS_DISPLAY = '문자찜(확인 필요)'

/** 누구인지 확인해야 하는 문자 구매자인가 (표시 이름 "문자찜(확인 필요)") */
export function isUnknownSms(buyer: Buyer): boolean {
  return buyer.kind === 'sms' && buyer.display === UNKNOWN_SMS_DISPLAY
}

/**
 * 합치기 방향 기본 (D-091): 둘 중 하나만 유튜브 구매자면 유튜브 쪽이 남는다, 아니면 자세히를 열어 둔 구매자가 남는다.
 * 단 둘 중 하나만 "문자찜(확인 필요)"이면 상대(누구인지 아는 손님)가 남는다 — 정산 안내(AC-V1-29)의 링크로 확인 필요 구매자를
 * 열고 그대로 합쳐도 그 구매자가 손님에게 합쳐져 안내가 사라지고, 손님 이름이 "확인 필요"로 바뀌지 않는다 (TE-V1-002).
 */
export function defaultInto(opened: Buyer, other: Buyer): Buyer {
  if (opened.kind !== other.kind) return opened.kind === 'youtube' ? opened : other
  if (isUnknownSms(opened) !== isUnknownSms(other)) return isUnknownSms(opened) ? other : opened
  return opened
}
