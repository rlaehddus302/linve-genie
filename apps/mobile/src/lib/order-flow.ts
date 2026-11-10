// 주문 탭 흐름 (D-UX4-122, 사용자 지시 2026-11-11 "주문 탭 … 이 탭에서 하려는 행동이 뭔지부터 정의" → "이대로 만들어").
// 판매자가 주문 탭에 오는 까닭 = 이번 라이브 손님 한 명 한 명을 "돈 받았고 보낼 준비 끝"으로 만들기.
// 손님마다 세 단계: ① 정보 받기(배송지) → ② 확인서 보내기 → ③ 입금 확인. 셋이 끝나면 포장 탭으로.
// - 정보 받기는 택배로 보내는 손님에게만 있다(직접 수령·합배송·품목 없음은 null — 이 손님에겐 없는 단계).
// - 확인서는 품목 있는 손님에게만 있다(영수증 줄에 없으면 null).
// - 택배·영수증 줄을 못 받았으면 두 단계 모두 null(모름) — 그때는 "모두 끝났어요"를 말하지 않는다(판매자가 일을 놓치지 않게).
// - 입금 확인은 남은 금액 0이고 돌려줄 돈도 0이어야 끝(과입금은 돌려줄 때까지 할 일로 남긴다).
// 순수 함수 — 금액은 서버가 준 정수 원 그대로, 남은 금액만 뺀다(lib/settle remainingOf).
import type { ReceiptBuyers, Settlement } from '@livejjim/web/src/api/types.ts'
import type { ParcelDay } from '@livejjim/web/src/api/parcel-types.ts'
import { remainingOf } from './settle.ts'
import { formatWon } from './words.ts'

export type OrderStep = 'info' | 'receipt' | 'payment'

/** 단계 순서 (방송 뒤 흐름 — 홈 "오늘 할 일"과 같다, D-UX3-85) */
export const STEP_ORDER: readonly OrderStep[] = ['info', 'receipt', 'payment']

/** 단계 이름 (주문 탭 단계 칸·손님 줄) */
export const STEP_TITLE: Readonly<Record<OrderStep, string>> = { info: '정보 받기', receipt: '확인서 보내기', payment: '입금 확인' }

/** 손님 하나의 정보·확인서 단계 — true 끝남, false 남음, null 이 손님에겐 없거나 모름 */
export interface BuyerSteps {
  readonly info: boolean | null
  readonly receipt: boolean | null
}

/** 그 날짜 손님마다 정보·확인서 단계. 택배 줄이나 영수증 줄을 못 받았으면 null(모름) */
export function buyerStepsOf(parcels: ParcelDay | null, receipts: ReceiptBuyers | null): ReadonlyMap<string, BuyerSteps> | null {
  if (parcels === null || receipts === null) return null
  const out = new Map<string, BuyerSteps>()
  const parcelOf = new Map([...parcels.ready, ...parcels.excluded, ...parcels.booked].filter((row) => row.extra !== true).map((row) => [row.buyer, row] as const))
  const receiptOf = new Map(receipts.buyers.map((row) => [row.buyer, row] as const))
  for (const buyer of new Set([...parcelOf.keys(), ...receiptOf.keys()])) {
    const parcel = parcelOf.get(buyer)
    const receipt = receiptOf.get(buyer)
    const info = parcel === undefined || parcel.itemCount === 0 || parcel.shipping === 'PICKUP' || parcel.shipping === 'COMBINED' ? null : parcel.address !== 'NONE'
    const sent = receipt === undefined ? null : (receipt.link !== null && receipt.link.status !== 'NONE') || (receipt.sms != null && receipt.sms.sentAt !== null)
    out.set(buyer, { info, receipt: sent })
  }
  return out
}

/** 입금 단계가 끝났나: 덜 받은 돈도, 돌려줄 돈도 없다 */
export const paymentDone = (settlement: Settlement): boolean => remainingOf(settlement) === 0 && settlement.refundDue === 0

/** 이 손님의 다음 할 일 (정보 → 확인서 → 입금 순서, 다 끝났으면 null) */
export function nextStepOf(settlement: Settlement, steps: BuyerSteps | undefined): OrderStep | null {
  if (steps?.info === false) return 'info'
  if (steps?.receipt === false) return 'receipt'
  if (!paymentDone(settlement)) return 'payment'
  return null
}

/** 이 손님에게 그 단계가 남았나 */
export function stepLeft(step: OrderStep, settlement: Settlement, steps: BuyerSteps | undefined): boolean {
  if (step === 'info') return steps?.info === false
  if (step === 'receipt') return steps?.receipt === false
  return !paymentDone(settlement)
}

/** 손님 줄 오른쪽 아래 한 줄: 다음 할 일을 쉬운 말로 */
export function nextWords(settlement: Settlement, step: OrderStep | null): string {
  if (step === 'info') return '정보 받기'
  if (step === 'receipt') return '확인서 보내기'
  if (step === 'payment') {
    if (settlement.refundDue > 0) return `돌려줄 돈 ${formatWon(settlement.refundDue)}`
    if (settlement.payment === 'PARTIAL') return `남은 금액 ${formatWon(remainingOf(settlement))}`
    return '입금 기다림'
  }
  return '다 끝났어요'
}

export interface FlowSummary {
  /** 손님 수 (품목이나 기록이 있는 묶음) */
  readonly total: number
  /** 다 끝난 손님 수 */
  readonly done: number
  /** 단계마다 남은 손님 수 — 정보·확인서는 모르면 null */
  readonly left: Readonly<Record<OrderStep, number | null>>
  /** 아직 받을 돈 */
  readonly owed: number
  /** 정보·확인서 단계를 알고 있나 (모르면 "모두 끝났어요"를 말하지 않는다) */
  readonly known: boolean
}

export function flowSummary(list: readonly Settlement[], steps: ReadonlyMap<string, BuyerSteps> | null): FlowSummary {
  const stepOf = (s: Settlement) => steps?.get(s.buyer)
  const count = (step: OrderStep) => list.filter((s) => stepLeft(step, s, stepOf(s))).length
  return {
    total: list.length,
    done: list.filter((s) => nextStepOf(s, stepOf(s)) === null).length,
    left: { info: steps === null ? null : count('info'), receipt: steps === null ? null : count('receipt'), payment: count('payment') },
    owed: list.reduce((sum, s) => sum + remainingOf(s), 0),
    known: steps !== null,
  }
}

/** 지금 할 일 카드에 띄울 단계: 순서대로 처음 남은 단계 (없으면 null) */
export function firstOpenStep(summary: FlowSummary): OrderStep | null {
  return STEP_ORDER.find((step) => (summary.left[step] ?? 0) > 0) ?? null
}

/** 지금 할 일 카드 문장 */
export function todoWords(step: OrderStep, summary: FlowSummary): string {
  const n = String(summary.left[step] ?? 0)
  if (step === 'info') return `배송지를 못 받은 손님 ${n}명`
  if (step === 'receipt') return `확인서를 안 보낸 손님 ${n}명`
  return summary.owed > 0 ? `입금을 기다리는 손님 ${n}명 · 받을 돈 ${formatWon(summary.owed)}` : `돈을 돌려줄 손님 ${n}명`
}
