// 엑셀 판매대장의 행 (STL-06, R-6, D-088, D-208). 엔진 범위 목록 → 행(순수 데이터).
// 한 행 = 고른 방송의 상품마다 확정 찜 하나(재고 2 이상이면 확정 순서대로 여러 행), 확정이 없는 상품은 한 행.
// 취소·대기·거절 찜은 행이 없다. 금액·상태·찜 시각은 코어 조회 값 그대로이고 대장은 합계를 계산하지 않는다(D-208).
// 리허설 범위는 넣지 않는다(오류). 날짜·시각은 글(KST)이다 — 엑셀·실행 환경의 시간대 변환이 끼지 않는다(NFR-07).
import {
  getBuyer,
  getSettlement,
  listBroadcasts,
  listClaims,
  listProducts,
  type ClaimInfo,
  type ClaimOrigin,
  type EngineState,
  type PaymentStatus,
  type ProductInfo,
  type ProductStatus,
  type SaleSettings,
} from '@livejjim/core'
import { productTitle } from '@livejjim/core/format'
import { compareCodePoints, optionText } from './text.ts'
import { formatKstLedgerTime, isDateString } from './kst.ts'

/** 첫 줄 열 이름 (SPEC STL-06, 이 순서·글자 그대로) */
export const LEDGER_COLUMNS = Object.freeze(['방송 날짜', '회차', '상품 번호', '품종', '가격', '구매자', '채널', '찜 시각', '상태', '입금', '배송'] as const)
/** 옵션 방송이 든 대장의 첫 줄 (SPEC STL-06 옵션, O3 D-O3-07) — `품종` 뒤에 옵션·수량·단가 */
export const LEDGER_OPTION_COLUMNS = Object.freeze(['방송 날짜', '회차', '상품 번호', '품종', '옵션', '수량', '단가', '가격', '구매자', '채널', '찜 시각', '상태', '입금', '배송'] as const)
export const LEDGER_SHEET_NAME = '판매대장'

export type LedgerChannel = '유튜브' | '문자' | '직접 배정'
export type LedgerPayment = '미입금' | '부분 입금' | '입금 완료' | '과입금'

export interface LedgerRow {
  /** 방송 날짜 YYYY-MM-DD (글) */
  readonly date: string
  /** 회차 = 방송 제목 */
  readonly session: string
  /** 상품 번호 (수) */
  readonly no: number
  /** 품종 = 지금 이름 */
  readonly name: string
  /**
   * 가격 (수, 원): 확정 행은 찜 금액(찜 시점 단가 스냅샷 × 수량 — 옵션 없는 수량 1이면 가격 스냅샷), 확정 없는 행은 지금 가격.
   * 가격이 빈 확인 중 상품(아직 가격을 듣지 못함)의 확정 없는 행은 빈칸 "" — 0원으로 적지 않는다 (D-RECOG-22)
   */
  readonly price: number | ''
  /**
   * 옵션 칸 (O3, D-O3-07·08) — 대장에 든 방송 중 옵션 방송이 있을 때만 세 칸이 모두 있다(없으면 O3 전과 같은 행 객체).
   * 확정 행: 옵션 글(없으면 "")·찜 수량·단가 스냅샷. 확정 없는 행: 셋 다 ""
   */
  readonly variant?: string
  readonly qty?: number | ''
  readonly unitPrice?: number | ''
  /** 지금의 구매자 표시 이름 (문자 구매자에 뒤 4자리가 있으면 ` / 끝자리 1234`). 확정 없는 행은 "" */
  readonly buyer: string
  readonly channel: LedgerChannel | ''
  /** 찜 시각 = R-6 실제 시각의 KST 글 (분까지만 적은 문자찜은 분까지). 확정 없는 행은 "" */
  readonly claimedAt: string
  /** 확정 행 "1등", 확정 없는 행은 상품 상태 말(D-088) */
  readonly status: string
  /** 그 구매자의 그 날짜 정산 묶음 입금 상태 말. 확정 없는 행은 "" */
  readonly payment: LedgerPayment | ''
  /** 포장·배송 상태 말 (I2 D-I2-05 — 부르는 쪽이 넘긴 값, 넘기지 않으면 빈칸). 확정 없는 행은 "" */
  readonly shipping: string
}

export interface LedgerScope {
  readonly state: EngineState
  /** 리허설 범위인가 (리허설 기록은 대장에 넣지 않는다) */
  readonly rehearsal: boolean
}

export interface LedgerInput {
  /** 엔진 범위 목록 (날짜가 다른 상태 여럿을 함께 넘길 수 있다) */
  readonly scopes: readonly LedgerScope[]
  /** 기간 시작·끝 방송 날짜 (YYYY-MM-DD, 둘 다 포함) */
  readonly from: string
  readonly to: string
  /** 고른 방송 ID (생략·null이면 기간 안 모든 방송) */
  readonly broadcasts?: readonly string[] | null
  /**
   * 확정 행의 "배송" 칸 값 (I2 D-I2-05·AC-I2-33): (지금의 구매자 ID, 방송 날짜) → 그 묶음의 포장·배송 상태 말. 생략하면 빈칸.
   * 포장·배송 기록은 서버에 있어 부르는 쪽이 넘긴다. 문자열이 아닌 값은 빈칸으로 본다
   */
  readonly shipping?: ((buyer: string, date: string) => string) | null
}

export type LedgerErrorCode = 'INVALID_INPUT' | 'PERIOD_INVALID' | 'REHEARSAL' | 'UNKNOWN_BROADCAST' | 'AMOUNT_MISSING'

export interface LedgerError {
  readonly code: LedgerErrorCode
  readonly message: string
}

export type LedgerResult =
  | {
      readonly ok: true
      readonly rows: readonly LedgerRow[]
      /** 대장에 든 방송(기간 ∩ 고른 방송) 중 옵션 방송(claim.parseMode=OPTIONS)이 있는가 — 있으면 첫 줄이 LEDGER_OPTION_COLUMNS (O3, D-O3-07) */
      readonly options: boolean
    }
  | { readonly ok: false; readonly error: LedgerError }

/** 상품 상태 말 (D-088) */
export const PRODUCT_STATUS_WORDS: Readonly<Record<ProductStatus, string>> = Object.freeze({
  READY: '공개 전',
  OPEN: '판매 중',
  SOLD: '판매 완료',
  HOLD: '일시 중지',
  CLOSED: '판매 종료',
})

export const PAYMENT_WORDS: Readonly<Record<PaymentStatus, LedgerPayment>> = Object.freeze({
  UNPAID: '미입금',
  PARTIAL: '부분 입금',
  PAID: '입금 완료',
  OVERPAID: '과입금',
})

/** 찜의 출처 → 채널 (D-208): 채팅·메시지 변환 → 유튜브, 문자찜 → 문자, 직접 배정 → 직접 배정 */
export const CHANNEL_WORDS: Readonly<Record<ClaimOrigin, LedgerChannel>> = Object.freeze({
  chat: '유튜브',
  convert: '유튜브',
  sms: '문자',
  assign: '직접 배정',
})

const fail = (code: LedgerErrorCode, message: string): LedgerResult => ({ ok: false, error: { code, message } })

interface SelectedBroadcast {
  readonly scope: number
  readonly order: number
  readonly id: string
  readonly date: string
  readonly title: string
  readonly options: boolean
}

/** 확정 행 (찜 하나). options면 옵션 칸 세 개를 더하고 가격은 찜 금액 */
function claimRow(
  state: EngineState,
  broadcast: SelectedBroadcast,
  productName: string,
  claim: ClaimInfo,
  payments: Map<string, LedgerPayment>,
  shipping: (buyer: string) => string,
  options: boolean,
): LedgerRow {
  const buyer = getBuyer(state, claim.currentBuyer)
  const display = buyer?.display ?? ''
  const last4 = buyer?.phoneLast4 ?? null
  let payment = payments.get(claim.currentBuyer)
  if (payment === undefined) {
    payment = PAYMENT_WORDS[getSettlement(state, claim.currentBuyer, broadcast.date).payment]
    payments.set(claim.currentBuyer, payment)
  }
  const row: LedgerRow = {
    date: broadcast.date,
    session: broadcast.title,
    no: claim.no,
    name: productName,
    price: claim.price as number,
    buyer: last4 === null ? display : `${display} / 끝자리 ${last4}`,
    channel: CHANNEL_WORDS[claim.origin],
    claimedAt: formatKstLedgerTime(claim.rankTime, claim.rankMinute),
    status: '1등',
    payment,
    shipping: shipping(claim.currentBuyer),
  }
  if (!options) return row
  // 금액은 코어 값 그대로: 단가 = 단가 스냅샷, 가격 = 찜 금액(ClaimInfo.amount) — 대장이 곱하지 않는다 (D-208)
  // 옵션 글은 L-2로 다듬은 글 — 확인서·라벨과 같은 글 (D-O3-13)
  return { ...row, price: claim.amount as number, variant: claim.variant === null ? '' : optionText(claim.variant), qty: claim.qty, unitPrice: claim.price as number }
}

/** 옵션 방송인가 (claim.parseMode=OPTIONS 스냅샷, D-O3-07) */
function isOptionBroadcast(settings: SaleSettings): boolean {
  return settings['claim.parseMode'] === 'OPTIONS'
}

/** 그 상품의 확정 찜, 확정 순 — 옵션 상품의 1등은 변형에 있어(D-O1-01) 모든 변형의 1등을 확정버전 순으로 모은다 (D-O3-08) */
function confirmedClaimsOf(product: ProductInfo, claims: ReadonlyMap<string, ClaimInfo>): ClaimInfo[] {
  const confirmed = (ids: readonly string[]): ClaimInfo[] =>
    ids.map((id) => claims.get(id)).filter((claim): claim is ClaimInfo => claim !== undefined && claim.status === 'CONFIRMED')
  if (!product.hasOptions) return confirmed(product.winnerClaims)
  return confirmed(product.variants.flatMap((variant) => variant.winnerClaims)).sort((a, b) => (a.confirmVersion ?? 0) - (b.confirmVersion ?? 0))
}

/**
 * 판매대장 행 (D-208). 순서: 방송 날짜 → 그날 방송 선언 순(범위 순 → 선언 순) → 상품 번호 → 확정 순.
 * 오류: 리허설 범위가 있음, 기간 시작 > 끝, 날짜 형식, 고른 방송이 넘긴 범위에 없음(엉뚱한 빈 대장을 막는다).
 */
export function buildLedger(input: LedgerInput): LedgerResult {
  if (typeof input !== 'object' || input === null || !Array.isArray(input.scopes)) return fail('INVALID_INPUT', '판매 기록을 읽지 못했어요.')
  if (!isDateString(input.from) || !isDateString(input.to)) return fail('INVALID_INPUT', '기간을 2026-10-19처럼 적어 주세요.')
  if (input.from > input.to) return fail('PERIOD_INVALID', '기간의 시작 날짜가 끝 날짜보다 늦어요.')
  if (input.scopes.some((scope) => scope.rehearsal !== false)) return fail('REHEARSAL', '리허설 기록은 판매대장에 넣지 않아요.')
  const selected = input.broadcasts === undefined || input.broadcasts === null ? null : new Set(input.broadcasts)
  if (selected !== null && [...selected].some((id) => typeof id !== 'string')) return fail('INVALID_INPUT', '고른 방송을 읽지 못했어요.')

  const all: SelectedBroadcast[] = input.scopes.flatMap((scope, index) =>
    listBroadcasts(scope.state).map((broadcast, order) => ({
      scope: index,
      order,
      id: broadcast.id,
      date: broadcast.date,
      title: broadcast.title,
      options: isOptionBroadcast(broadcast.settings),
    })),
  )
  if (selected !== null) {
    const known = new Set(all.map((broadcast) => broadcast.id))
    const missing = [...selected].filter((id) => !known.has(id))
    if (missing.length > 0) return fail('UNKNOWN_BROADCAST', '고른 방송 중 판매 기록에 없는 방송이 있어요. 방송을 다시 골라 주세요.')
  }
  const broadcasts = all
    .filter((broadcast) => broadcast.date >= input.from && broadcast.date <= input.to && (selected === null || selected.has(broadcast.id)))
    .sort((a, b) => compareCodePoints(a.date, b.date) || a.scope - b.scope || a.order - b.order)

  // 대장에 든 방송 중 옵션 방송이 하나라도 있으면 모든 행에 옵션 칸 (D-O3-07)
  const options = broadcasts.some((broadcast) => broadcast.options)
  const rows: LedgerRow[] = []
  const claimsByScope = new Map<number, ReadonlyMap<string, ClaimInfo>>()
  for (const broadcast of broadcasts) {
    const state = (input.scopes[broadcast.scope] as LedgerScope).state
    let found = claimsByScope.get(broadcast.scope)
    if (found === undefined) {
      found = new Map(listClaims(state).map((claim) => [claim.id, claim]))
      claimsByScope.set(broadcast.scope, found)
    }
    const claims = found
    // 입금 상태는 (구매자, 그 방송 날짜) 묶음의 것 — 방송마다 새로 묻는다(같은 범위에 날짜가 다른 방송이 있을 수 있다)
    const payments = new Map<string, LedgerPayment>()
    // 배송 칸도 (구매자, 그 방송 날짜) 묶음의 것 (I2 D-I2-05)
    const shippingWords = new Map<string, string>()
    const shippingOf = (buyer: string): string => {
      let word = shippingWords.get(buyer)
      if (word === undefined) {
        const value = typeof input.shipping === 'function' ? input.shipping(buyer, broadcast.date) : ''
        word = typeof value === 'string' ? value : ''
        shippingWords.set(buyer, word)
      }
      return word
    }
    const products = listProducts(state)
      .filter((product) => product.broadcast === broadcast.id)
      .sort((a, b) => a.no - b.no)
    for (const product of products) {
      const winners = confirmedClaimsOf(product, claims)
      if (winners.length === 0) {
        const empty: LedgerRow = {
          date: broadcast.date,
          session: broadcast.title,
          no: product.no,
          name: productTitle(product.name, product.pieces),
          price: product.price ?? '',
          buyer: '',
          channel: '',
          claimedAt: '',
          status: PRODUCT_STATUS_WORDS[product.status],
          payment: '',
          shipping: '',
        }
        rows.push(options ? { ...empty, variant: '', qty: '', unitPrice: '' } : empty)
        continue
      }
      // 찜 금액·단가 스냅샷은 코어 값만 — 확정 찜에 없으면 대장을 만들지 않는다(가격 스냅샷·단가 × 수량으로 채우지 않는다, D-O3-15)
      if (winners.some((claim) => !Number.isSafeInteger(claim.amount) || !Number.isSafeInteger(claim.price))) return fail('AMOUNT_MISSING', '판매 금액을 확인할 수 없어 판매대장을 만들지 않았어요.')
      for (const claim of winners) rows.push(claimRow(state, broadcast, productTitle(product.name, product.pieces), claim, payments, shippingOf, options))
    }
  }
  return { ok: true, rows, options }
}

/** 행에 옵션 칸이 있는가 (옵션 방송이 든 buildLedger의 행) */
export function hasOptionColumns(row: LedgerRow): boolean {
  return Object.hasOwn(row, 'qty')
}

/** 대장 첫 줄 (옵션 칸이 있으면 14열, 아니면 O3 전 11열) */
export function ledgerColumns(options: boolean): readonly string[] {
  return options ? LEDGER_OPTION_COLUMNS : LEDGER_COLUMNS
}

/** 행 → 열 순서의 값 (빈 값은 ""). 그 행에 옵션 칸이 있으면 14열, 없으면 O3 전 11열 (Array.map에 그대로 넘겨도 된다) */
export function ledgerRowValues(row: LedgerRow): (string | number)[] {
  return ledgerRowValuesWith(row, hasOptionColumns(row))
}

/**
 * 행 → 열 순서의 값, 열 모양을 정해서. options면 14열 — 옵션 칸이 없는 행(옵션 방송이 없는 날짜의 행을 이어 붙인 경우)은
 * 확정 행이면 옵션 "" · 수량 1 · 단가 = 가격, 확정 없는 행이면 셋 다 "" 로 채운다 (D-O3-08 — 옵션 없는 찜은 수량 1, 단가 = 가격 스냅샷)
 */
export function ledgerRowValuesWith(row: LedgerRow, options: boolean): (string | number)[] {
  const head = [row.date, row.session, row.no, row.name]
  const tail = [row.price, row.buyer, row.channel, row.claimedAt, row.status, row.payment, row.shipping]
  if (!options) return [...head, ...tail]
  if (hasOptionColumns(row)) return [...head, row.variant ?? '', row.qty ?? '', row.unitPrice ?? '', ...tail]
  const confirmed = row.status === '1등'
  return [...head, '', confirmed ? 1 : '', confirmed ? row.price : '', ...tail]
}
