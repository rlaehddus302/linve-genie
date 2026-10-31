// 운영자 명령의 일 (AC-N5-12, BL-1 출처·BL-8 5). 명령(commands/billing-grant.ts·billing-list.ts)과 시험이 쓴다.
// - 이용권 부여: 판매자 로그인 아이디·종류·양·사유로 OPERATOR 이용권을 덧붙인다(명령마다 새 이용권).
// - 목록: 확인 필요 결제(밖에서 취소된 결제 포함), 자동 재확인을 모두 마친 결제 대기 주문(PAY2 BL-6 9 — 옛 "1시간 넘게" 기준을 대체), 결과를 남기지 못하고 멈춘 환불(RA-N5-01),
//   발행 대기·발행 실패·취소 요청 증빙(손으로 발행하는 데 필요한 사업자 정보 — 표준 출력에만, 서버 로그엔 없다).
import { formatWon } from '@livejjim/core'
import { normalizeLoginId } from '../accounts.ts'
import type { Db } from '../db/database.ts'
import { openSellerText } from '../secrets.ts'
import { findAccountByLogin } from '../store.ts'
import type { PassKind } from './rules.ts'
import { BUSINESS_PURPOSE, RECHECK_SLOTS_MS, checkOperatorGrant, operatorGrant } from './service.ts'
import { allRefundingOrders, documentsToHandle, exhaustedPendingOrders, ordersInState, type DocumentRow, type OrderRow } from './store.ts'

export type GrantCommandResult = { readonly ok: true; readonly sellerId: string; readonly grantId: string; readonly kind: PassKind; readonly quantity: number | null } | { readonly ok: false; readonly message: string }

/** 이용권 부여 명령 (같은 명령을 두 번 실행하면 두 장 — 운영자가 일부러 하는 일) */
export async function grantForLogin(db: Db, input: { loginId: string; kind: unknown; quantity: unknown; reason: unknown }, now: number): Promise<GrantCommandResult> {
  const checked = checkOperatorGrant({ kind: input.kind, quantity: input.quantity, reason: input.reason })
  if (!checked.ok) return checked
  const account = await findAccountByLogin(db, normalizeLoginId(input.loginId))
  if (account === null) return { ok: false, message: '그 아이디의 판매자가 없어요.' }
  const grantId = await operatorGrant(db, account.sellerId, { kind: checked.kind, quantity: checked.quantity, reason: checked.reason }, now)
  return { ok: true, sellerId: account.sellerId, grantId, kind: checked.kind, quantity: checked.quantity }
}

export interface DocumentToHandle {
  readonly document: DocumentRow
  /** 손으로 발행할 받는 쪽 (복호화 — 표준 출력에만) */
  readonly recipient: { readonly businessNumber: string; readonly name: string | null; readonly ceo: string | null; readonly email: string | null } | null
}

export interface OperatorLists {
  readonly review: readonly OrderRow[]
  readonly stalePending: readonly OrderRow[]
  /** 환불 중인데 결제 취소를 맡은 기한이 지난 결제 (취소가 됐는지 결제 조회로 아직 맞추지 못했다 — 그 이용권은 쓰지 않는다) */
  readonly stuckRefunds: readonly OrderRow[]
  readonly documents: readonly DocumentToHandle[]
}

/**
 * 운영자 목록 "결제 대기"의 기준 (PAY2 D-PAY-08): 자동 재확인 마지막 칸(만든 시각 + 24시간). 목록에는 그 칸까지 자동 재확인을 모두 마친(쓴 칸 5) 결제 대기 주문만 보인다 —
 * 시각만 지난 주문(서버가 꺼져 있어 아직 확인하지 못함)은 다음 자동 재확인이 먼저 한다
 */
export const STALE_PENDING_MS = RECHECK_SLOTS_MS[RECHECK_SLOTS_MS.length - 1] as number

export async function operatorLists(db: Db, masterKey: Buffer, now: number): Promise<OperatorLists> {
  const review = await ordersInState(db, 'NEEDS_REVIEW')
  const stalePending = await exhaustedPendingOrders(db, RECHECK_SLOTS_MS.length)
  const stuckRefunds = (await allRefundingOrders(db)).filter((order) => order.refundHoldUntil !== null && order.refundHoldUntil.getTime() <= now)
  const documents = (await documentsToHandle(db)).map((document) => {
    return { document, recipient: openRecipient(masterKey, document) }
  })
  return { review, stalePending, stuckRefunds, documents }
}

function openRecipient(masterKey: Buffer, document: DocumentRow): DocumentToHandle['recipient'] {
  try {
    const parsed = JSON.parse(openSellerText(masterKey, BUSINESS_PURPOSE, document.sellerId, document.recipientSealed)) as Record<string, unknown>
    const text = (key: string) => (typeof parsed[key] === 'string' ? (parsed[key] as string) : null)
    return { businessNumber: text('businessNumber') ?? '', name: text('name'), ceo: text('ceo'), email: text('email') }
  } catch {
    return null
  }
}

const KIND_WORDS: Readonly<Record<string, string>> = { TAX_INVOICE: '세금계산서', CASH_RECEIPT: '현금영수증(지출증빙)' }
const DOC_STATUS: Readonly<Record<string, string>> = { PENDING: '발행 대기', ISSUED: '발행됨', FAILED: '발행 실패' }
const CANCEL_STATUS: Readonly<Record<string, string>> = { REQUESTED: '취소 요청', CANCELLED: '취소됨', FAILED: '취소 실패' }

/** 운영자 목록을 표준 출력 줄로 */
export function formatOperatorLists(lists: OperatorLists): string[] {
  const lines: string[] = []
  const order = (row: OrderRow) => `판매자 ${row.sellerId} · 결제 ${row.paymentId} · ${row.itemName} · ${formatWon(row.amount)} · 만든 때 ${row.createdAt.toISOString()}`
  lines.push(`확인 필요 결제 ${String(lists.review.length)}건`)
  for (const row of lists.review) lines.push(`  ${order(row)}`)
  lines.push(`자동 재확인을 마친 결제 대기 ${String(lists.stalePending.length)}건 (포트원 콘솔에서 결제됐는지 확인 — 판매자의 '다시 확인'·웹훅은 계속 돼요)`)
  for (const row of lists.stalePending) lines.push(`  ${order(row)}`)
  lines.push(`결과를 모르는 환불 ${String(lists.stuckRefunds.length)}건 (포트원 콘솔에서 취소됐는지 확인 — 판매자가 결제 내역을 열거나 웹훅이 오면 서버가 다시 맞춰요)`)
  for (const row of lists.stuckRefunds) lines.push(`  ${order(row)} · 취소를 맡은 기한 ${row.refundHoldUntil?.toISOString() ?? ''}`)
  lines.push(`처리할 증빙 ${String(lists.documents.length)}건`)
  for (const { document, recipient } of lists.documents) {
    const state = document.cancel === null ? (DOC_STATUS[document.status] ?? document.status) : `${DOC_STATUS[document.status] ?? document.status} · ${CANCEL_STATUS[document.cancel] ?? document.cancel}`
    const who =
      recipient === null
        ? '받는 쪽을 풀지 못했어요(마스터 키 확인)'
        : `사업자등록번호 ${recipient.businessNumber} · 상호 ${recipient.name ?? '(없음)'} · 대표자 ${recipient.ceo ?? '(없음)'} · 이메일 ${recipient.email ?? '(없음)'}`
    lines.push(
      `  판매자 ${document.sellerId} · 결제 ${document.paymentId} · ${KIND_WORDS[document.kind] ?? document.kind} · ${state} · 금액 ${formatWon(document.amount)} · 공급가액 ${formatWon(document.supply)} · 세액 ${formatWon(document.vat)} · ${who} · 만든 때 ${document.createdAt.toISOString()}`,
    )
  }
  return lines
}
