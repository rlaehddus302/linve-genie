// 구매 내역 확인서 데이터 (STL-04·STL-05, R-12, D-206·D-207). 엔진 상태 → 순수 데이터(JSON으로 옮길 수 있는 값만).
// 금액은 코어 정산 결과(getSettlement)를 그대로 옮긴다. 문서가 하는 계산은 "남은 금액 = 최종 − 받은 금액"(부분 입금일 때) 하나뿐이다.
// 줄 가격의 합이 코어 상품 합계와 다르면(프로그램 오류) 확인서를 만들지 않는다 — 틀린 숫자를 구매자에게 보내지 않는다.
// 개인정보: 전화번호 전체·전화번호 키·문자찜 ref·구매자 ID·채널 ID·조정 사유·입금 메모를 담지 않는다(DAT-06). 문자 구매자는 뒤 4자리만.
import {
  currentBuyerOf,
  formatWon,
  getBuyer,
  getSettlement,
  listBroadcasts,
  listClaims,
  listProducts,
  listSettlements,
  type EngineState,
  type PaymentStatus,
  type SettlementInfo,
} from '@livejjim/core'
import { formatKoreanDate, formatKstDateTime, isDateString, isEpochMs } from './kst.ts'
import { compareCodePoints, printedName, stripInvisible } from './text.ts'

export const RECEIPT_TITLE = '구매 내역 확인서'
export const REHEARSAL_TITLE = '구매 내역 확인서 (리허설)'
export const REHEARSAL_NOTE = '리허설(연습)에서 만든 문서예요. 실제 거래가 아니에요.'
/** STL-05 고지 문장 — PDF 모든 쪽 하단, 이미지 맨 아래에 글자 그대로 */
export const LEGAL_NOTICE = '본 문서는 거래 확인용이며 세금계산서·현금영수증 등 세법상 적격증빙이 아닙니다'
export const EMPTY_VARIETY = '품종 미입력'

/** 가게 설정 (저장은 I2). 없으면 그 칸이 없다 */
export interface ShopSettings {
  readonly name?: string | null
  readonly account?: { readonly bank?: string | null; readonly number?: string | null; readonly holder?: string | null } | null
  /** 입금 안내 문장 (예: 입금자명은 닉네임으로 적어 주세요) */
  readonly accountNote?: string | null
}

export interface ReceiptLine {
  /** 회차 = 방송 제목 */
  readonly session: string
  readonly no: number
  /** 품종 (빈 이름은 "품종 미입력") */
  readonly name: string
  /** 찜 시점 가격 스냅샷 (R-10, D-013) */
  readonly price: number
  readonly priceText: string
}

export type ShippingNote = '직접 수령' | '합배송' | '따로 정함' | '무료 배송'

/** 금액 줄 하나 (표시용 글자와 코어 값) */
export interface ReceiptRow {
  readonly key: 'itemCount' | 'subtotal' | 'shipping' | 'adjustment' | 'total' | 'received' | 'remaining' | 'paid' | 'refundDue'
  readonly label: string
  readonly text: string
}

export interface ReceiptData {
  readonly title: string
  /** 리허설 범위에서 만든 확인서의 안내 줄 (아니면 null) */
  readonly rehearsalNote: string | null
  /** 가게 이름 (설정이 없으면 null — 그 줄이 없다) */
  readonly shopName: string | null
  /** 구매자 표시 이름 = 지금의 구매자 표시 이름(합친 결과) */
  readonly buyerName: string
  /** 문자 구매자의 휴대폰 끝자리 4개 (없으면 null) */
  readonly phoneLast4: string | null
  /** 방송 날짜 YYYY-MM-DD (정산 묶음 날짜, R-12) */
  readonly date: string
  /** 주문 날짜 `2026년 10월 18일` */
  readonly orderDate: string
  /** 회차 = 품목이 있는 방송 제목들(선언 순) */
  readonly sessions: readonly string[]
  /** 상품 줄: 방송 선언 순 → 번호 순 → 확정 순 */
  readonly lines: readonly ReceiptLine[]
  readonly itemCount: number
  /** 아래 금액은 코어 getSettlement 값 그대로 */
  readonly subtotal: number
  readonly shipping: number
  readonly shippingNote: ShippingNote | null
  readonly adjustments: number
  readonly total: number
  readonly payment: PaymentStatus
  readonly received: number
  readonly refundDue: number
  /** 남은 금액 = 최종 − 받은 금액 (부분 입금일 때만, 아니면 null) — 문서가 하는 유일한 계산 */
  readonly remaining: number | null
  /** 금액 줄 (상품 수·상품 합계·배송비·할인/추가·최종 결제 금액·입금 상태) */
  readonly rows: readonly ReceiptRow[]
  /** 입금 계좌 안내 (설정이 없으면 null — 그 칸이 없다) */
  readonly account: { readonly text: string; readonly note: string | null } | null
  /** 만든 시각 KST `2026년 10월 18일 23:30` */
  readonly createdAt: string
  /** STL-05 고지 */
  readonly notice: string
}

export type ReceiptErrorCode = 'INVALID_INPUT' | 'NO_ITEMS' | 'AMOUNT_MISMATCH'

export interface ReceiptError {
  readonly code: ReceiptErrorCode
  /** 판매자에게 보여 줄 쉬운 문장 */
  readonly message: string
}

export type ReceiptResult = { readonly ok: true; readonly receipt: ReceiptData } | { readonly ok: false; readonly error: ReceiptError }
export type ReceiptsResult = { readonly ok: true; readonly receipts: readonly ReceiptData[] } | { readonly ok: false; readonly error: ReceiptError }

export interface ReceiptScope {
  /** 엔진 상태 (서버의 범위 상태) */
  readonly state: EngineState
  /** 방송 날짜 YYYY-MM-DD */
  readonly date: string
  readonly shop?: ShopSettings | null
  /** 리허설 범위에서 만드는가 */
  readonly rehearsal: boolean
  /** 만든 시각 (UTC 밀리초, 부르는 쪽이 넘긴다) */
  readonly createdAt: number
}

export interface ReceiptInput extends ReceiptScope {
  /** 구매자 키 (합쳐진 구매자여도 된다 — 지금의 구매자로 푼다) */
  readonly buyer: string
}

const fail = (code: ReceiptErrorCode, message: string): { readonly ok: false; readonly error: ReceiptError } => ({ ok: false, error: { code, message } })

const NO_ITEMS_MESSAGE = '구매 내역이 없어 확인서를 만들 수 없어요.'
const MISMATCH_MESSAGE = '확인서 금액이 정산 금액과 맞지 않아 확인서를 만들지 않았어요. 정산 화면의 금액을 확인하고 고객센터에 알려 주세요.'

/** 배송비 옆 표시 (D-206): 예외면 그 이름, 예외 없이 0원(품목 있음)이면 무료 배송 */
function shippingNote(settlement: SettlementInfo): ShippingNote | null {
  switch (settlement.shippingOverride) {
    case 'PICKUP':
      return '직접 수령'
    case 'COMBINED':
      return '합배송'
    case 'FIXED':
      return '따로 정함'
    default:
      return settlement.shipping === 0 && settlement.items.length > 0 ? '무료 배송' : null
  }
}

const trimmedOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

function accountOf(shop: ShopSettings | null | undefined): ReceiptData['account'] {
  const account = shop?.account
  const number = trimmedOrNull(account?.number)
  if (number === null) return null
  const bank = trimmedOrNull(account?.bank)
  const holder = trimmedOrNull(account?.holder)
  const text = `${[bank, number].filter((part) => part !== null).join(' ')}${holder === null ? '' : ` (예금주 ${holder})`}`
  return { text, note: trimmedOrNull(shop?.accountNote) }
}

/** 금액 줄 (D-206 표시 규칙). 계산은 남은 금액 하나 */
function rowsOf(settlement: SettlementInfo, itemCount: number, note: ShippingNote | null): { rows: ReceiptRow[]; remaining: number | null } {
  const rows: ReceiptRow[] = [
    { key: 'itemCount', label: '상품 수', text: `${String(itemCount)}개` },
    { key: 'subtotal', label: '상품 합계', text: formatWon(settlement.subtotal) },
    { key: 'shipping', label: note === null ? '배송비' : `배송비 (${note})`, text: formatWon(settlement.shipping) },
  ]
  if (settlement.adjustments < 0) rows.push({ key: 'adjustment', label: '할인', text: formatWon(settlement.adjustments) })
  if (settlement.adjustments > 0) rows.push({ key: 'adjustment', label: '추가', text: `+${formatWon(settlement.adjustments)}` })
  rows.push({ key: 'total', label: '최종 결제 금액', text: formatWon(settlement.total) })
  let remaining: number | null = null
  switch (settlement.payment) {
    case 'UNPAID':
      break
    case 'PARTIAL':
      remaining = settlement.total - settlement.received
      rows.push({ key: 'received', label: '받은 금액', text: formatWon(settlement.received) }, { key: 'remaining', label: '남은 금액', text: formatWon(remaining) })
      break
    case 'PAID':
      rows.push({ key: 'received', label: '받은 금액', text: formatWon(settlement.received) }, { key: 'paid', label: '입금 상태', text: '입금 완료' })
      break
    case 'OVERPAID':
      rows.push({ key: 'received', label: '받은 금액', text: formatWon(settlement.received) }, { key: 'refundDue', label: '환불할 금액', text: formatWon(settlement.refundDue) })
      break
  }
  return { rows, remaining }
}

/** 받은 값이 확인서를 만들 수 있는 입력인가 */
function checkScope(scope: ReceiptScope): ReceiptError | null {
  if (typeof scope !== 'object' || scope === null || typeof scope.state !== 'object' || scope.state === null) return { code: 'INVALID_INPUT', message: '정산 기록을 읽지 못했어요.' }
  if (!isDateString(scope.date)) return { code: 'INVALID_INPUT', message: '날짜를 2026-10-18처럼 적어 주세요.' }
  if (!isEpochMs(scope.createdAt)) return { code: 'INVALID_INPUT', message: '만든 시각이 올바르지 않아요.' }
  return null
}

/** (지금의 구매자, 날짜) 묶음 → 확인서 데이터. 품목이 없거나 줄 합이 맞지 않으면 오류 */
function receiptOf(scope: ReceiptScope, root: string): ReceiptResult {
  const { state, date } = scope
  const settlement = getSettlement(state, root, date)
  if (settlement.items.length === 0) return fail('NO_ITEMS', NO_ITEMS_MESSAGE)
  const buyer = getBuyer(state, settlement.buyer)
  if (buyer === null) return fail('NO_ITEMS', NO_ITEMS_MESSAGE)
  const broadcasts = listBroadcasts(state)
  const order = new Map(broadcasts.map((broadcast, i) => [broadcast.id, i]))
  const titleOf = new Map(broadcasts.map((broadcast) => [broadcast.id, broadcast.title]))
  const dateOf = new Map(broadcasts.map((broadcast) => [broadcast.id, broadcast.date]))
  // 확정 찜(지금의 구매자, 그 날짜 방송) — 생성 순서로 오므로 같은 상품 안에서는 확정 순
  const claims = listClaims(state).filter((claim) => claim.status === 'CONFIRMED' && claim.currentBuyer === settlement.buyer && dateOf.get(claim.broadcast) === date)
  const sorted = claims
    .map((claim, n) => ({ claim, n }))
    .sort((a, b) => (order.get(a.claim.broadcast) as number) - (order.get(b.claim.broadcast) as number) || a.claim.no - b.claim.no || a.n - b.n)
  const productNames = new Map<string, string>()
  for (const product of listProducts(state)) productNames.set(product.key, product.name)
  const lines: ReceiptLine[] = []
  for (const { claim } of sorted) {
    const price = claim.price
    if (price === null) return fail('AMOUNT_MISMATCH', MISMATCH_MESSAGE)
    const name = (productNames.get(claim.product) ?? '').trim()
    lines.push({ session: titleOf.get(claim.broadcast) ?? '', no: claim.no, name: name === '' ? EMPTY_VARIETY : name, price, priceText: formatWon(price) })
  }
  // INV-5와 같은 조건: 줄 가격의 합 = 코어 상품 합계, 줄 수 = 코어 품목 수. 다르면 만들지 않는다(표시에 쓰지 않는 검사)
  if (!linesMatchSettlement(lines, settlement)) return fail('AMOUNT_MISMATCH', MISMATCH_MESSAGE)
  const sessions: string[] = []
  const seen = new Set<string>()
  for (const { claim } of sorted) {
    if (seen.has(claim.broadcast)) continue
    seen.add(claim.broadcast)
    sessions.push(titleOf.get(claim.broadcast) ?? '')
  }
  const note = shippingNote(settlement)
  const { rows, remaining } = rowsOf(settlement, lines.length, note)
  return {
    ok: true,
    receipt: {
      title: scope.rehearsal ? REHEARSAL_TITLE : RECEIPT_TITLE,
      rehearsalNote: scope.rehearsal ? REHEARSAL_NOTE : null,
      shopName: trimmedOrNull(scope.shop?.name),
      buyerName: buyer.display,
      phoneLast4: buyer.phoneLast4,
      date,
      orderDate: formatKoreanDate(date),
      sessions,
      lines,
      itemCount: lines.length,
      subtotal: settlement.subtotal,
      shipping: settlement.shipping,
      shippingNote: note,
      adjustments: settlement.adjustments,
      total: settlement.total,
      payment: settlement.payment,
      received: settlement.received,
      refundDue: settlement.refundDue,
      remaining,
      rows,
      account: accountOf(scope.shop),
      createdAt: formatKstDateTime(scope.createdAt),
      notice: LEGAL_NOTICE,
    },
  }
}

/** 줄과 코어 묶음이 맞는가 (줄 수 = 품목 수, 줄 가격 합 = 상품 합계) — 확인서를 만들지 말지 정하는 검사일 뿐 표시에 쓰지 않는다 */
export function linesMatchSettlement(lines: readonly ReceiptLine[], settlement: Pick<SettlementInfo, 'items' | 'subtotal'>): boolean {
  if (lines.length !== settlement.items.length) return false
  let sum = 0
  for (const line of lines) sum += line.price
  return sum === settlement.subtotal
}

/**
 * 한 사람 확인서 데이터 (D-206). 구매자 키는 합쳐진 구매자여도 된다 — 지금의 구매자로 푼다.
 * 품목이 없는 묶음(과입금만 남은 묶음 포함)·모르는 구매자는 NO_ITEMS, 줄 합이 코어 상품 합계와 다르면 AMOUNT_MISMATCH.
 */
export function buildReceipt(input: ReceiptInput): ReceiptResult {
  const problem = checkScope(input)
  if (problem !== null) return { ok: false, error: problem }
  if (typeof input.buyer !== 'string' || input.buyer === '') return fail('NO_ITEMS', NO_ITEMS_MESSAGE)
  const root = currentBuyerOf(input.state, input.buyer)
  if (root === null) return fail('NO_ITEMS', NO_ITEMS_MESSAGE)
  return receiptOf(input, root)
}

/** 글자를 빼는 글꼴 (DocumentFont.sanitize — 전원 일괄 순서를 찍힌 이름으로 정할 때) */
export interface NameSanitizer {
  sanitize(text: string): string
}

/**
 * 전원 일괄 (D-207, I2 D-I2-04): 그 날짜에 품목이 있는 묶음 전부, 확인서에 **찍힌** 구매자 이름(글꼴로 그릴 수 없는 글자·제어 글자를 뺀 뒤,
 * 비면 "(이름 없음)")의 코드 포인트 순 → 같으면 구매자 ID 순(Intl·localeCompare를 쓰지 않는다). 글꼴을 넘기지 않으면 제어·서식 글자만 뺀 이름으로 정한다
 * (전원 PDF는 renderBatchPdf가 그리는 글꼴을 넘긴다). 품목 없는 묶음(과입금 등)은 빠진다.
 * 하나라도 줄 합이 맞지 않으면 전체를 만들지 않는다(틀린 숫자를 내보내지 않는다).
 */
export function buildReceipts(scope: ReceiptScope, font?: NameSanitizer | null): ReceiptsResult {
  const problem = checkScope(scope)
  if (problem !== null) return { ok: false, error: problem }
  const sanitize = font === undefined || font === null ? stripInvisible : (text: string) => font.sanitize(text)
  const roots = listSettlements(scope.state)
    .filter((settlement) => settlement.date === scope.date && settlement.items.length > 0)
    .map((settlement) => ({ id: settlement.buyer, printed: printedName(getBuyer(scope.state, settlement.buyer)?.display ?? '', sanitize) }))
    .sort((a, b) => compareCodePoints(a.printed, b.printed) || compareCodePoints(a.id, b.id))
  if (roots.length === 0) return fail('NO_ITEMS', '그 날짜에 구매 내역이 있는 구매자가 없어요.')
  const receipts: ReceiptData[] = []
  for (const root of roots) {
    const result = receiptOf(scope, root.id)
    if (!result.ok) return result
    receipts.push(result.receipt)
  }
  return { ok: true, receipts }
}
