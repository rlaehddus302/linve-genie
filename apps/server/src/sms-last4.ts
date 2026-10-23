// 음성 문자찜의 뒤 4자리로 구매자 정하기 (V1, SPEC ORD-08 AC9, D-V1-03·D-V1-10, AC-V1-10~12).
// - 판정은 하지 않는다. 그 범위의 엔진 상태를 코어 조회 함수(listBuyers)로 읽어 "뒤 4자리가 같은 문자 구매자"를 지금의 구매자로 묶어 셀 뿐이다.
// - 없으면 새 문자 구매자의 키(phoneKey)를 범위·뒤 4자리를 담은 글의 HMAC으로 만든다 — 정규화한 전화번호(숫자만)와 겹칠 수 없고,
//   날짜·리허설 여부가 글에 들어 있어 다른 범위와 이어지지 않는다. 판매자마다 키가 달라 다른 판매자와도 이어지지 않는다.
// - 뒤 4자리·키·이름은 로그에 남기지 않는다(이 파일은 로그를 쓰지 않는다).
import { listBuyers, listClaims, type ClaimStatus, type EngineState } from '@livejjim/core'

/** 반각 숫자 정확히 4개 (전각·3자리·5자리·영문 섞임은 아님) */
const LAST4_RE = /^[0-9]{4}$/

export function isLast4(value: unknown): value is string {
  return typeof value === 'string' && LAST4_RE.test(value)
}

export const LAST4_MESSAGE = '끝자리는 숫자 네 개로 적어 주세요.'
export const LAST4_ONE_OF_MESSAGE = '끝자리·전화번호·구매자 중 하나만 보내 주세요.'

/** 409 BUYER_AMBIGUOUS 문장 (acceptance AC-V1-10 그대로) */
export function ambiguousMessage(last4: string): string {
  return `끝자리 ${last4} 손님이 여러 명이에요. 누구인지 골라 주세요.`
}

/** 409 BUYER_AMBIGUOUS 문장 — 후보가 한 사람인데 말한 이름이 그 사람의 표시 이름과 다를 때 (D-V1-14, AC-V1-13) */
export function nameMismatchMessage(last4: string): string {
  return `끝자리 ${last4} 손님의 이름이 달라요. 누구인지 골라 주세요.`
}

export const NEW_BUYER_MESSAGE = '새 손님으로 넣기는 끝자리와 함께 보내 주세요.'
export const NEW_BUYER_ONE_OF_MESSAGE = '새 손님으로 넣을 때는 전화번호나 구매자를 함께 보내지 않아요.'
export const VOICE_MESSAGE = '음성으로 넣었는지는 예로만 적을 수 있어요.'

/** 고르기 후보 하나 — 구매자 ID·표시 이름·뒤 4자리·그 범위의 활성 찜 번호만 (키·전화번호 없음, AC-V1-12·13) */
export interface Last4Candidate {
  readonly buyer: string
  readonly display: string
  readonly phoneLast4: string
  /** 그 범위에서 이 지금의 구매자의 활성 찜(확정·대기·보류·충돌) 상품 번호, 처음 찜한 순서, 같은 번호는 한 번 (D-V1-14) */
  readonly claims: readonly number[]
}

const ACTIVE: ReadonlySet<ClaimStatus> = new Set<ClaimStatus>(['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT'])

/** 지금의 구매자마다 그 범위의 활성 찜 상품 번호 (처음 찜한 순서 = 찜 생성 순서, 같은 번호는 처음 한 번) */
function activeClaimNumbers(state: EngineState): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const claim of listClaims(state)) {
    if (!ACTIVE.has(claim.status)) continue
    const list = out.get(claim.currentBuyer) ?? []
    if (!list.includes(claim.no)) list.push(claim.no)
    out.set(claim.currentBuyer, list)
  }
  return out
}

/**
 * 그 범위 상태에서 뒤 4자리가 같은 문자 구매자를 지금의 구매자로 묶은 목록 (지금의 구매자가 처음 생긴 순서).
 * 합쳐진 두 문자 구매자는 한 사람이다. 지금의 구매자가 유튜브 구매자여도(문자 구매자를 그쪽에 합쳤으면) 그 사람이 후보다
 */
export function last4Candidates(state: EngineState, last4: string): Last4Candidate[] {
  const buyers = listBuyers(state)
  const order = new Map(buyers.map((buyer, index) => [buyer.id, index]))
  const byId = new Map(buyers.map((buyer) => [buyer.id, buyer]))
  const current = new Set<string>()
  for (const buyer of buyers) if (buyer.kind === 'sms' && buyer.phoneLast4 === last4) current.add(buyer.current)
  if (current.size === 0) return []
  const claims = activeClaimNumbers(state)
  return [...current]
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map((id) => ({ buyer: id, display: byId.get(id)?.display ?? '', phoneLast4: last4, claims: claims.get(id) ?? [] }))
}

/**
 * 말한 이름이 그 후보의 표시 이름과 같은지 (D-V1-14): 표시 이름이 정확히 `문자찜(<메모 앞뒤 공백 제거>)`일 때만 같다.
 * 이름 없음(`문자찜`)·`문자찜(확인 필요)`·다른 이름·유튜브 닉네임(합친 사람)은 모두 다르다. 메모가 없거나 공백뿐이면 이름을 말하지 않은 것(null)
 */
export function spokenName(memo: unknown): string | null {
  if (typeof memo !== 'string') return null
  const name = memo.trim()
  return name === '' ? null : name
}

export function sameName(candidate: Last4Candidate, name: string): boolean {
  return candidate.display === `문자찜(${name})`
}

/**
 * 끝자리 키를 만들 글 (HMAC의 입력 — 저장하지 않는다). 영문 머리와 '|'가 있어 숫자만인 정규화 전화번호와 겹칠 수 없다.
 * 범위 = 날짜 + 리허설 여부 (D-081)
 */
export function last4KeyText(date: string, rehearsal: boolean, last4: string): string {
  return `livejjim/sms-last4/v1|${date}|${rehearsal ? 'rehearsal' : 'live'}|${last4}`
}

/**
 * "새 손님으로 넣기"(newBuyer, D-V1-14)의 키를 만들 글 — 범위·뒤 4자리·그 문자찜 ref. 그 문자찜에만 쓰는 키라 다른 문자찜과 이어지지 않는다
 * (머리가 last4KeyText와 달라 그 키와도 겹치지 않는다)
 */
export function newBuyerKeyText(date: string, rehearsal: boolean, last4: string, ref: string): string {
  return `livejjim/sms-last4-new/v1|${date}|${rehearsal ? 'rehearsal' : 'live'}|${last4}|${ref}`
}
