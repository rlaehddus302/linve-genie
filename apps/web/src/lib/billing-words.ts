// 요금 화면 낱말·문장 (BILLING_RULES BL-9·BL-10, AC-N5-51~59). 서버 요금 상태의 값을 낱말로만 바꾼다 —
// 이용 방식·잔량·환불 가능 여부를 화면이 다시 계산하지 않는다(BL-4 6). 영어 값(FLAT·PENDING…)은 이 표의 낱말로만 보인다(UX-01).
// 시각은 KST "11/19 20:31"(NFR-07), 금액은 코어 formatWon "30,000원".
import { formatWon } from '@livejjim/core'
import type { Banner, BillingStatus, DocumentView, OrderState, PassKind, PayMethod, PriceItem, QuantityKind, ReceiptKind, StartPreview, UsageItem } from '../api/billing-types.ts'
import { kstShort } from './kst.ts'

/** 이용권 종류 낱말 (BL-9 3) */
export const KIND_WORD: Readonly<Record<PassKind, string>> = {
  FLAT_30D: '정액제',
  DAYS: '방송 일권',
  ORDERS: '주문 건권',
  LABELS: '라벨 장권',
}

/** 정량 이용권 단위 */
export const UNIT_WORD: Readonly<Record<QuantityKind, string>> = { DAYS: '일', ORDERS: '건', LABELS: '장' }

export const QUANTITY_KINDS: readonly QuantityKind[] = ['DAYS', 'ORDERS', 'LABELS']
/** 요금 표를 묶어 보이는 순서 */
export const KIND_ORDER: readonly PassKind[] = ['FLAT_30D', 'DAYS', 'ORDERS', 'LABELS']

/** 이용권 하나의 이름: "정액제 30일" · "방송 일권 5일" · "주문 건권 100건" · "라벨 장권 100장" (운영자가 준 이용권 — 요금 표 이름이 없다) */
export function passWords(kind: PassKind, quantity: number | null): string {
  if (kind === 'FLAT_30D') return '정액제 30일'
  return `${KIND_WORD[kind]} ${String(quantity ?? 0)}${UNIT_WORD[kind]}`
}

/** 잔량: "남은 3일" / 음수면 "초과 3건" (AC-N5-51 — 초과는 색만이 아니라 낱말로) */
export function balanceWords(kind: QuantityKind, balance: number): string {
  return balance < 0 ? `초과 ${String(-balance)}${UNIT_WORD[kind]}` : `남은 ${String(balance)}${UNIT_WORD[kind]}`
}

/** 시각 (KST "11/19 20:31") */
export const when = (iso: string): string => kstShort(iso)

/** `YYYY-MM-DD` → "10/20" (쓴 내역의 방송 날짜) */
export function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return m ? `${String(Number(m[2]))}/${String(Number(m[3]))}` : date
}

/** 정액제 칸: "이용 중 · 11/19 20:31까지" / "끝남 (11/19 20:31)" / "없음" (AC-N5-51) */
export function flatWords(flat: BillingStatus['flat']): string {
  if (flat.active && flat.until !== null) return `이용 중 · ${when(flat.until)}까지`
  if (flat.endedAt !== null) return `끝남 (${when(flat.endedAt)})`
  return '없음'
}

/** 열린 방송 일 창: "24시간 사용 중 · 10/21 20:00까지" */
export function windowWords(window: NonNullable<BillingStatus['window']>): string {
  return `24시간 사용 중 · ${when(window.until)}까지`
}

/** 이용권이 없어 실제 방송을 시작하지 못할 때 (BL-4 1.5 — 서버 422 NO_PASS 문장과 같다) */
export const NO_PASS_MESSAGE = '이용권이 없어 실제 방송을 시작할 수 없어요. 요금 화면에서 이용권을 산 뒤 다시 시작해 주세요. 리허설은 언제든 할 수 있어요.'
/** 요금 화면으로 가는 버튼 글자 (BL-9 1·2) */
export const OPEN_BILLING = '요금 화면 열기'

/** 알림 띠 문장 (BL-9 1) */
export function bannerSentence(banner: Banner): string {
  switch (banner.kind) {
    case 'FLAT_REMAINING':
      return `정액제가 ${String(banner.days)}일 남았어요 (${when(banner.until)}까지). 미리 연장하면 남은 기간 뒤에 30일이 이어져요.`
    case 'FLAT_ENDED':
      return `정액제가 끝났어요 (${when(banner.at)}). 새 실제 방송을 시작하려면 이용권이 필요해요.`
    case 'NO_PASS':
      return '이용권이 없어 새 실제 방송을 시작할 수 없어요. 리허설은 할 수 있어요.'
    case 'ORDERS_OVER':
      return `주문 건권을 ${String(banner.count)}건 넘게 썼어요. 다음에 사는 주문 건권에서 먼저 빠져요.`
    case 'LABELS_OVER':
      return `라벨 장권을 ${String(banner.count)}장 넘게 썼어요. 다음에 사는 라벨 장권에서 먼저 빠져요.`
  }
}

export type Tone = 'success' | 'warning' | 'danger' | 'info'

/** 알림 띠의 뜻 (D-102): 남은 7일 이하·초과 = 주의, 이용권 없음(정액 끝남 포함) = 위험 */
export function bannerTone(banner: Banner): Tone {
  return banner.kind === 'FLAT_ENDED' || banner.kind === 'NO_PASS' ? 'danger' : 'warning'
}

/** 새 방송 시작 미리 보기 문장 (BL-9 2). 이용권이 없으면 BL-4 1.5 문장 */
export function startSentence(start: StartPreview): string {
  if (!start.allowed) return NO_PASS_MESSAGE
  switch (start.mode) {
    case 'FLAT':
      return start.flatUntil === null ? '정액제로 시작해요.' : `정액제로 시작해요 (${when(start.flatUntil)}까지).`
    case 'DAY':
      if (start.useDay && start.days !== null) {
        return `방송 일권 1일을 써요 (남은 ${String(start.days.before)}일 → ${String(start.days.after)}일). 지금부터 24시간 안에 시작하는 방송은 더 빠지지 않아요.`
      }
      return start.windowUntil === null ? '방송 일권 24시간 안이에요. 더 빠지지 않아요.' : `방송 일권 24시간 안이에요 (${when(start.windowUntil)}까지). 더 빠지지 않아요.`
    case 'ORDERS':
      return `주문 건권으로 시작해요 (남은 ${String(start.orders ?? 0)}건). 1등이 나온 상품마다 1건씩 빠져요.`
  }
}

/** 요금 표 한 줄: "정액제 30일 · 30,000원 (부가세 포함)" (AC-N5-52) */
export function priceLine(item: Pick<PriceItem, 'name' | 'price'>): string {
  return `${item.name} · ${formatWon(item.price)} (부가세 포함)`
}

export const METHOD_WORD: Readonly<Record<PayMethod, string>> = { CARD: '카드', TRANSFER: '계좌이체' }

/** 결제 주문 상태 낱말 (BL-9 3) */
export const ORDER_STATE_WORD: Readonly<Record<OrderState, string>> = {
  PENDING: '결제 대기',
  FAILED: '결제 안 됨',
  GRANTED: '결제 완료',
  MISMATCH_CANCELLED: '금액이 달라 취소함',
  NEEDS_REVIEW: '확인 필요',
  REFUNDED: '환불함',
}

/** 결제 상태의 뜻 (AC-N5-59, D-102): 결제 완료·환불함 = 성공, 확인 필요 = 주의, 결제 안 됨·금액이 달라 취소함 = 위험, 결제 대기 = 보통 */
export const ORDER_STATE_TONE: Readonly<Record<OrderState, Tone>> = {
  PENDING: 'info',
  FAILED: 'danger',
  GRANTED: 'success',
  MISMATCH_CANCELLED: 'danger',
  NEEDS_REVIEW: 'warning',
  REFUNDED: 'success',
}

/** 계좌이체 증빙 종류 낱말 — 지금은 현금영수증(지출증빙) 하나라 고르는 칸이 없다(D-PL1-07). 세금계산서 낱말은 옛 기록 표시용으로 남긴다 */
export const RECEIPT_KIND_WORD: Readonly<Record<ReceiptKind, string>> = { TAX_INVOICE: '세금계산서', CASH_RECEIPT: '현금영수증(지출증빙)' }

const DOCUMENT_KIND_WORD: Readonly<Record<ReceiptKind, string>> = { TAX_INVOICE: '세금계산서', CASH_RECEIPT: '현금영수증' }
const DOCUMENT_STATUS_WORD: Readonly<Record<DocumentView['status'], string>> = { PENDING: '발행 대기', ISSUED: '발행됨', FAILED: '발행 실패' }
const DOCUMENT_CANCEL_WORD: Readonly<Record<NonNullable<DocumentView['cancel']>, string>> = { REQUESTED: '취소 요청', CANCELLED: '취소됨', FAILED: '취소 실패' }

/** 증빙: "세금계산서 발행 대기" / "세금계산서 발행됨 · TEST-…" / 환불하면 " · 취소됨" (AC-N5-54) */
export function documentWords(document: DocumentView): string {
  const parts = [`${DOCUMENT_KIND_WORD[document.kind]} ${DOCUMENT_STATUS_WORD[document.status]}`]
  if (document.approval !== null) parts.push(document.approval)
  if (document.cancel !== null) parts.push(DOCUMENT_CANCEL_WORD[document.cancel])
  return parts.join(' · ')
}

/** 계좌이체를 고르면 (AC-N5-52, D-PL1-07 — 간이과세자라 현금영수증 하나) */
export const TRANSFER_RECEIPT_NOTE = '현금영수증(지출증빙)을 발행해요.'
/** 사업자 정보 칸 아래 — 계좌이체 증빙 종류 (BL-8 6, AC-PL1B-05) */
export const TRANSFER_RECEIPT_KIND_LINE = '계좌이체 증빙: 현금영수증(지출증빙)'
/** 사업자 정보 칸 아래 — 세금계산서 안내 (BL-8 6, AC-PL1B-05) */
export const TAX_INVOICE_UNAVAILABLE = '세금계산서는 지금은 발급할 수 없어요. 카드로 결제하면 카드 매출전표가 증빙이에요.'
/** 약관 체크 (BL-10) */
export const TERMS_CHECK = '이용권 약관과 환불 규정을 읽었어요'
/** 사업자 정보 없음 (BL-9 4) */
export const BUSINESS_REQUIRED = '결제 전에 사업자 정보를 적어 주세요.'

/** 결제 전 안내 (BL-9 5): 그 종류가 초과 중이면 초과분, 정액 이용 중이면 이어지는 기간 */
export function beforePayNotices(item: Pick<PriceItem, 'kind'>, status: Pick<BillingStatus, 'balances' | 'flat'>): string[] {
  if (item.kind === 'FLAT_30D') {
    return status.flat.active && status.flat.until !== null ? [`남은 기간(${when(status.flat.until)}까지) 뒤에 30일이 이어져요.`] : []
  }
  const balance = status.balances[item.kind]
  if (balance >= 0) return []
  return [`지난 초과 ${String(-balance)}${UNIT_WORD[item.kind]}이 이번 ${KIND_WORD[item.kind]}에서 먼저 빠져요(이 이용권은 바로 쓴 것이 되어 7일 환불 대상이 아니에요).`]
}

/** 환불 확인 창 (BL-9 4): "'방송 일권 1일' 결제(5,000원)를 취소하고 이용권을 거둬요. 되돌릴 수 없어요." */
export function refundQuestion(itemName: string, amount: number): string {
  return `'${itemName}' 결제(${formatWon(amount)})를 취소하고 이용권을 거둬요. 되돌릴 수 없어요.`
}

/** 마지막 글자에 받침이 있으면 '을', 없으면 '를' (한글이 아니면 '을(를)') — 서버 결제 확인 문장과 같은 규칙 */
export function objectParticle(word: string): string {
  const last = word.trim().at(-1)
  if (last === undefined) return '을(를)'
  const code = last.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? '를' : '을'
  return '을(를)'
}

/**
 * 주문 상태의 BL-9 4 문장 — 결제 확인 응답의 문장(서버)이 정해진 뒤 다른 길(웹훅·다른 기기)로 상태가 바뀌었을 때 화면의 결과 문장을 맞춘다.
 * 서버 확인 응답의 문장과 같다(dev-notes 5).
 */
export function orderStateSentence(state: OrderState, itemName: string): string {
  switch (state) {
    case 'GRANTED':
      return `결제했어요. ${itemName}${objectParticle(itemName)} 받았어요.`
    case 'PENDING':
      return "결제를 확인하는 중이에요. 잠시 뒤 '다시 확인'을 눌러 주세요."
    case 'FAILED':
      return '결제가 되지 않았어요. 돈은 나가지 않았어요.'
    case 'MISMATCH_CANCELLED':
      return '결제 금액이 주문과 달라 결제를 취소했어요. 다시 시도해 주세요.'
    case 'NEEDS_REVIEW':
      return '결제를 자동으로 확인하지 못했어요. 운영자가 확인해요.'
    case 'REFUNDED':
      return '환불했어요. 결제 수단으로 돌려드려요.'
  }
}

/** 결제 확인 결과 문장의 뜻: 조회 실패는 주의, 그 밖은 주문 상태의 뜻 */
export function confirmTone(state: OrderState, lookupFailed: boolean): Tone {
  return lookupFailed ? 'warning' : ORDER_STATE_TONE[state]
}

/** 쓴 내역 한 줄의 조각 (AC-N5-55) */
export interface UsageWords {
  readonly at: string
  readonly what: string
  readonly broadcast: string | null
  readonly product: string | null
  readonly until: string | null
}

/**
 * 쓴 내역: "10/20 20:00 · 방송 일권 1일 · 1부(10/20) · 10/21 20:00까지" / "10/20 20:05 · 주문 1건 · 1부 15번 핑크프릴" /
 * "10/20 20:06 · 라벨 1장 · 1부 15번"
 */
export function usageWords(item: UsageItem): UsageWords {
  const at = when(item.at)
  const title = item.broadcast?.title ?? null
  const product = item.productNo === null ? null : [`${String(item.productNo)}번`, ...(item.kind === 'ORDERS' && item.productName !== null ? [item.productName] : [])].join(' ')
  switch (item.kind) {
    case 'DAYS':
      return {
        at,
        what: '방송 일권 1일',
        broadcast: item.broadcast === null ? null : `${item.broadcast.title}(${shortDate(item.broadcast.date)})`,
        product: null,
        until: item.windowUntil === null ? null : `${when(item.windowUntil)}까지`,
      }
    case 'ORDERS':
      return { at, what: '주문 1건', broadcast: title, product, until: null }
    case 'LABELS':
      return { at, what: '라벨 1장', broadcast: title, product, until: null }
  }
}

/** 쓴 내역 한 줄 (휴대폰 카드) */
export function usageLine(item: UsageItem): string {
  const words = usageWords(item)
  const target = [words.broadcast, words.product].filter((part): part is string => part !== null).join(' ')
  return [words.at, words.what, target === '' ? null : target, words.until].filter((part): part is string => part !== null).join(' · ')
}

/** 약관 초안 (BL-10 1~9 — 법률 검토 전. 법률 검토 메모는 화면에 보이지 않는다) */
export const TERMS: readonly { readonly title: string; readonly text: string }[] = [
  { title: '이용권', text: '회사는 정액제 30일 이용권과 정량 이용권(방송 일권·주문 건권·라벨 장권)을 판다. 이용권은 이 서비스를 쓸 수 있는 권리이며 돈·포인트·충전금이 아니다.' },
  { title: '정액제', text: '정액제 이용권은 결제가 확인된 때부터 30일(720시간) 동안 쓸 수 있다. 이용 중에 또 사면 남은 기간 뒤에 30일이 이어진다. 자동으로 갱신·결제되지 않는다.' },
  {
    title: '정량 이용권',
    text: '방송 일권 1일은 실제 방송을 시작한 때부터 24시간 동안 실제 방송을 시작할 수 있는 권리, 주문 건권 1건은 주문 건권으로 시작한 방송에서 1등이 처음 나온 상품 하나, 라벨 장권 1장은 정량 이용권으로 시작한 방송의 상품 라벨 한 장 출력이다. 정량 이용권은 기간 제한 없이 쓸 수 있다.',
  },
  {
    title: '방송 중 소진',
    text: '방송 중에 이용권 기간이 끝나거나 다 쓰여도 그 방송은 끝까지 쓸 수 있다. 이때 넘게 쓴 주문 건·라벨 장은 다음에 사는 같은 종류 이용권에서 먼저 뺀다. 리허설은 이용권 없이 쓸 수 있다.',
  },
  {
    title: '청약철회·환불',
    text: '결제한 때부터 7일 안에 전혀 쓰지 않은 이용권은 요금 화면에서 전액 환불(결제 취소)할 수 있다. 정액제는 그 기간에 실제 방송을 한 번이라도 시작했으면, 정량 이용권은 1단위라도 썼으면 쓴 것으로 본다. 쓴 이용권은 디지털 콘텐츠(용역)의 제공이 시작된 것으로 보아 청약철회가 제한된다. 환불은 결제한 수단의 결제 취소로 한다.',
  },
  { title: '양도·현금화 금지', text: '이용권은 다른 사람에게 넘기거나, 현금·포인트로 바꾸거나, 남은 양을 돈으로 돌려받을 수 없다(5의 환불은 예외).' },
  { title: '회사 책임', text: '회사의 잘못으로 이용권을 쓰지 못한 경우 회사는 쓰지 못한 만큼 이용권을 다시 준다.' },
  { title: '증빙', text: '계좌이체로 결제한 이용권은 현금영수증(지출증빙)을 발행한다. 카드 결제는 카드 매출전표가 증빙이다. 회사는 지금 세금계산서를 발행하지 않는다.' },
  { title: '가격', text: '가격은 요금 화면에 보이는 부가가치세 포함 금액이다. 바뀐 가격은 바뀐 뒤에 시작하는 결제부터 적용한다.' },
]
