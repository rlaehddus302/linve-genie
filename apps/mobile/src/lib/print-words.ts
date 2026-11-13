// 라벨 뽑기 고침의 화면 문구 (11월 12일 라이브 복기 F1·F2·F3, D-RETRO-40~44). 쉬운 한국어만 — 개발 용어·영어 상태값을 보이지 않는다.
import type { PrintWaitingOutcome } from './label-queue.ts'

// ── F1 대기 라벨 뽑기 ──
/** 라이브 관리 "라벨·프린터" 줄: 대기 중인 라벨 수와 뽑기 */
export const waitingRowTitle = (count: number): string => `대기 ${String(count)}장 지금 뽑기`
export const WAITING_BUSY = '확인하는 중'
/** 프린터가 이어져 있지 않을 때 — 아래에 [다시 연결] */
export const WAITING_NEED_PRINTER = '프린터가 연결되어 있지 않아요. 먼저 다시 연결해 주세요.'
export const WAITING_RECONNECT = '다시 연결'
export const WAITING_RECONNECT_FAILED = '프린터에 연결하지 못했어요. 프린터 전원을 확인하고 다시 눌러 주세요.'
export const WAITING_FAILED = '라벨을 뽑지 못했어요. 다시 눌러 주세요.'

/** "지금 뽑기"를 누른 뒤 한 줄 (프린터 연결이 필요하면 따로 그린다 — null) */
export function waitingResult(outcome: PrintWaitingOutcome): { readonly tone: 'success' | 'info' | 'danger'; readonly text: string } | null {
  switch (outcome.kind) {
    case 'started':
      return { tone: 'success', text: `라벨 ${String(outcome.count)}장을 차례로 뽑고 있어요.` }
    case 'empty':
      return { tone: 'info', text: '뽑을 라벨이 없어요.' }
    case 'off':
      return { tone: 'info', text: '라벨 뽑기가 꺼져 있어요. 먼저 켜 주세요.' }
    case 'other':
      return outcome.printing
        ? { tone: 'success', text: `출력 기기('${outcome.name}')에서 차례로 뽑아요.` }
        : { tone: 'danger', text: `출력 기기('${outcome.name}')에서 프린터를 다시 연결해 주세요.` }
    case 'error':
      return { tone: 'danger', text: outcome.message }
    case 'needPrinter':
      return null
  }
}

// ── F1-2 라벨 없는 판매 ──
/** 라벨 뽑기를 꺼 둔 동안 확정돼 라벨이 없는 판매 */
export const missingRowTitle = (count: number): string => `라벨 없는 판매 ${String(count)}건 뽑기`
export const MISSING_BUSY = '넣는 중'
export const missingQueued = (count: number): string => (count > 0 ? `라벨 ${String(count)}장을 출력 대기열에 넣었어요.` : '새로 넣을 라벨이 없어요. 이미 다 넣었어요.')
export const MISSING_FAILED = '라벨을 대기열에 넣지 못했어요. 다시 눌러 주세요.'

// ── F2 방송 중 계속 다시 잇기 ──
/** 방송 중에는 그치지 않는다 — 총 횟수 없이 몇 번째인지만 */
export const keepReconnectingMessage = (attempt: number): string => `프린터에 다시 연결하고 있어요. 라이브 중에는 연결될 때까지 계속 해 봐요. (${String(attempt)}번째)`

// ── F3 고쳐 다시 뽑기 ──
export const FIX_QUESTION = '상품 정보도 같이 고칠까요?'
export const FIX_LABEL_ONLY = '이 라벨만'
export const FIX_PRODUCT_TOO = '상품도 고치기'
/** 무엇이 상품에 들어가는지 (품종·가격 중 고친 것). 가격은 입금 전 찜에도 적용된다고 알린다 */
export function fixDescription(change: { readonly name?: string; readonly price?: string }): string {
  const parts = [change.name === undefined ? null : `품종 '${change.name}'`, change.price === undefined ? null : `가격 ${change.price}`].filter((part): part is string => part !== null)
  return `상품도 고치면 상품 목록과 정산도 같이 바뀌어요. (${parts.join(', ')})${change.price === undefined ? '' : ' 가격은 입금 전인 찜에도 적용돼요.'}`
}
/** 번호·닉네임은 라벨에만 */
export const FIX_NUMBER_LABEL_ONLY = '번호와 닉네임은 이 라벨 한 장에만 적용돼요. 상품 번호는 상품 수정에서 바꿔 주세요.'
/** 수량이 여럿이거나 옵션이 있는 찜의 가격은 상품 가격과 달라 상품에 넣지 않는다 */
export const FIX_PRICE_LABEL_ONLY = '수량이 여럿이거나 옵션이 있는 찜이라 가격은 이 라벨 한 장에만 적용돼요.'
export const FIX_DONE = '상품을 고치고 출력 대기열에 넣었어요.'
/** 상품이 이미 그 값이었다 (바뀐 것이 없다) */
export const FIX_DONE_SAME = '상품은 이미 그 값이라 그대로 두고, 출력 대기열에 넣었어요.'
/**
 * 그 찜의 금액이 바뀌지 않았다 — 이미 입금된 찜이거나(엔진은 입금 전 찜만 바꾼다), 상품 가격이 벌써 그 값이라 바뀐 것이 없을 때.
 * 어느 쪽인지 앱은 가리지 못해 둘 다 말한다
 */
export const FIX_AMOUNT_KEPT = '이 찜의 정산 금액은 그대로예요. 이미 입금된 찜이거나 상품 가격이 벌써 그 값이라 바뀌지 않았어요. 라벨에는 새 가격이 찍혀요.'
export const FIX_PRODUCT_FAILED = '상품을 고치지 못했어요. 다시 눌러 주세요.'
