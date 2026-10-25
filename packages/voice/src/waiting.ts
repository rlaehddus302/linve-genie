// 기다리는 번호 (DOMAIN_RULES R-17 8 6, D-V3-67, AC-V3-72): 번호만 들린 조각을 기억했다가 다음 덩어리의 '원' 가격으로 등록한다.
// 덩어리 사이 상태 { no, since }는 부르는 쪽(화면)이 들고 넘긴다. 순수 함수: 시계를 읽지 않고(now를 받는다) 넘긴 값을 바꾸지 않는다.

/** 기다리는 번호 — since = 그 번호를 들은 시각(UTC 밀리초) */
export interface WaitingNumber {
  readonly no: number
  readonly since: number
}

/** 이어 받는 시간 (밀리초) — 60,000ms면 받고 60,001ms면 카드 */
export const WAITING_MS = 60_000

/** 이번 조각을 읽은 것 (readSegments 결과에서 화면이 만든다) */
export interface WaitingPiece {
  /** 조각의 확정 번호가 'N번' 표시(합친 번호 포함)면 그 값 — '번' 없는 번호·번호 없음은 null */
  readonly markerNo: number | null
  /** 조각의 원 가격 줄 확정 가격(원까지 들림) — 없거나 빠른 꼴 가격이면 null */
  readonly wonPrice: number | null
  /** 이 조각으로 이미 등록(또는 같은 번호 R-22)했는가 — 번호와 원 가격이 짝지어짐 */
  readonly paired: boolean
}

export interface WaitingResult {
  /** 기다리는 번호와 이번 조각의 원 가격을 짝지어 등록할 값 (표시 "이어 받음") */
  readonly take: { readonly no: number; readonly price: number } | null
  /** "가격 못 들은 번호" 카드로 보낼 번호 (다른 N번이 먼저 왔거나 60초 지남) */
  readonly card: number | null
  /** 다음 상태 */
  readonly waiting: WaitingNumber | null
}

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNo = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

/** 60초가 지났는가 (지금 − since > 60,000ms) */
export function waitingExpired(waiting: WaitingNumber | null, now: number): boolean {
  return waiting !== null && isTime(now) && isTime(waiting.since) && now - waiting.since > WAITING_MS
}

/**
 * 조각 하나가 끝났을 때 (D-V3-67):
 * - 기다리는 번호가 있고 이번 조각에 'N번'이 없고 원 가격이 있고 60초 안 → 이어 받음(take), 기다림 끝
 * - 다른 'N번'이 든 조각이 먼저 오거나 60초가 지남 → 기다리던 번호는 카드(card)
 * - 이번 조각이 'N번'만(원 가격 없음, 짝 없음)이고 그 번호의 상품이 없으면 → 새 기다리는 번호. '번' 없는 번호·있는 번호는 기다리지 않는다
 */
export function stepWaiting(input: { readonly waiting: WaitingNumber | null; readonly now: number; readonly piece: WaitingPiece; readonly exists: (no: number) => boolean }): WaitingResult {
  const { piece, now } = input
  let waiting = input.waiting !== null && isNo(input.waiting.no) && isTime(input.waiting.since) ? input.waiting : null
  let card: number | null = null
  if (waiting !== null && waitingExpired(waiting, now)) {
    card = waiting.no
    waiting = null
  }
  if (waiting !== null) {
    if (piece.markerNo === null && piece.wonPrice !== null) return { take: { no: waiting.no, price: piece.wonPrice }, card, waiting: null }
    if (piece.markerNo !== null && piece.markerNo !== waiting.no) {
      card = waiting.no
      waiting = null
    } else if (piece.markerNo === waiting.no && piece.paired) waiting = null
  }
  if (piece.markerNo !== null && !piece.paired && piece.wonPrice === null && isNo(piece.markerNo) && waiting?.no !== piece.markerNo) {
    const markerNo = piece.markerNo
    const exists = ((): boolean => {
      try {
        return input.exists(markerNo)
      } catch {
        return true
      }
    })()
    if (!exists) waiting = { no: markerNo, since: now }
  }
  return { take: null, card, waiting }
}
