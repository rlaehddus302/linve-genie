// 음성 문자찜의 뒤 4자리로 구매자 정하기 (V1, SPEC ORD-08 AC9, D-V1-03·D-V1-10, AC-V1-10~12).
// - 판정은 하지 않는다. 그 범위의 엔진 상태를 코어 조회 함수(listBuyers)로 읽어 "뒤 4자리가 같은 문자 구매자"를 지금의 구매자로 묶어 셀 뿐이다.
// - 없으면 새 문자 구매자의 키(phoneKey)를 범위·뒤 4자리를 담은 글의 HMAC으로 만든다 — 정규화한 전화번호(숫자만)와 겹칠 수 없고,
//   날짜·리허설 여부가 글에 들어 있어 다른 범위와 이어지지 않는다. 판매자마다 키가 달라 다른 판매자와도 이어지지 않는다.
// - 뒤 4자리·키·이름은 로그에 남기지 않는다(이 파일은 로그를 쓰지 않는다).
import { listBuyers, type EngineState } from '@livejjim/core'

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

/** 고르기 후보 하나 — 구매자 ID·표시 이름·뒤 4자리만 (키·전화번호 없음, AC-V1-12) */
export interface Last4Candidate {
  readonly buyer: string
  readonly display: string
  readonly phoneLast4: string
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
  return [...current]
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map((id) => ({ buyer: id, display: byId.get(id)?.display ?? '', phoneLast4: last4 }))
}

/**
 * 끝자리 키를 만들 글 (HMAC의 입력 — 저장하지 않는다). 영문 머리와 '|'가 있어 숫자만인 정규화 전화번호와 겹칠 수 없다.
 * 범위 = 날짜 + 리허설 여부 (D-081)
 */
export function last4KeyText(date: string, rehearsal: boolean, last4: string): string {
  return `livejjim/sms-last4/v1|${date}|${rehearsal ? 'rehearsal' : 'live'}|${last4}`
}
