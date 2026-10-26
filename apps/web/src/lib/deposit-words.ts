// 입금 확인 화면 낱말 (DEPOSIT_RULES DP-8, AC-N3-41·44·45·46·47·50). 서버의 영어 값은 이 표의 낱말로만 보인다.
import { formatWon } from '@livejjim/core'
import type { BundleView, DepositActionView, DepositLinkView, DepositPrecision, DepositStatus, PasteRowState, ReviewReason, SourceKind, UnreadableWhy } from '../api/deposit-types.ts'
import { dateWords, dateYear, kstStamp } from './kst.ts'
import { paymentWord } from './words.ts'

export const DEPOSIT_STATUS_WORD: Readonly<Record<DepositStatus, string>> = {
  REVIEW: '확인 필요',
  AUTO_APPLIED: '자동 확인됨',
  APPLIED: '확인함',
  IGNORED: '무시함',
}

export const SOURCE_KIND_WORD: Readonly<Record<SourceKind, string>> = {
  POPBILL: '계좌조회',
  PASTE: '붙여넣기',
  FAKE: '시험용 입금',
}

/** 입금 이름 "입금 번호 12" (D-MOB2-05 — "#"은 판매자가 모르는 말) */
export const depositLabel = (no: number): string => `입금 번호 ${String(no)}`

/**
 * 저장된 메모·사유 글을 보일 때만 바꿔 읽는다 (D-MOB2-05 ②): 정확히 "입금 #{숫자}"가 낱말 경계로 있을 때만
 * "입금 번호 {숫자}"로. 기록 자체(이벤트·백업·서버가 새로 적는 메모)는 그대로다.
 * "#12 국민"·"입금#12"·"입금 #12번"은 그대로 둔다(판매자가 손으로 쓴 글일 수 있다).
 */
export function storedMemoWords(text: string): string {
  return text.replace(/(^|[^\p{L}\p{N}_#])입금 #(\d+)(?![\p{L}\p{N}_])/gu, (_match, before: string, no: string) => `${before}입금 번호 ${no}`)
}

/** 원천 표시: 종류 낱말, 판매자가 붙인 표시 이름이 다르면 함께 ("계좌조회 · 국민 1234") */
export function sourceWords(source: { readonly kind: SourceKind; readonly label: string }): string {
  const kind = SOURCE_KIND_WORD[source.kind] ?? ''
  const label = source.label.trim()
  return label === '' || label === kind ? kind : `${kind} · ${label}`
}

/** 사유 문장 (DP-8 그대로) */
export function reasonWords(reason: ReviewReason, twin: number | null): string {
  switch (reason) {
    case 'POSSIBLE_DUPLICATE':
      // D-QL3R1-10 (3): 두 결정을 합친 문장 — "입금 번호 {n}" + "도 같은 입금이에요"(조사가 숫자에 따라 틀리지 않게)
      return twin === null ? '같은 입금이 두 번 들어왔을 수 있어요' : `같은 입금이 두 번 들어왔을 수 있어요 (${depositLabel(twin)}도 같은 입금이에요)`
    case 'SAME_NAME':
      return '같은 이름의 구매자가 여럿이에요'
    case 'MULTIPLE':
      return '금액과 이름이 맞는 묶음이 여럿이에요'
    case 'NAME_MISMATCH':
      return '금액은 맞는데 이름이 달라요'
    case 'AMOUNT_MISMATCH':
      return '이름은 맞는데 금액이 달라요'
    case 'NO_MATCH':
      return '맞는 묶음을 찾지 못했어요'
    case 'ONE_MATCH':
      return '맞는 묶음이 하나 있어요. 확인해 주세요'
    default:
      return '확인해 주세요'
  }
}

/** 빈 입금자명은 "(이름 없음)" (AC-N3-41) */
export const NO_NAME = '(이름 없음)'

export function depositName(name: string): string {
  return name.trim() === '' ? NO_NAME : name
}

/** 입금 시각 (KST): 초까지 받은 입금은 "10/18 21:03:15", 분까지면 "10/18 21:03" */
export function depositTime(at: string, precision: DepositPrecision): string {
  return kstStamp(at, precision === 'minute')
}

export const BEFORE_SALE = '입금 시각이 이 묶음의 판매보다 먼저예요.'

export interface BundleChange {
  /** "미입금 → 입금 완료" (바뀌지 않으면 "그대로(입금 완료)") */
  readonly text: string
  /** 과입금이 새로 생기거나 환불 필요가 늘었다 — 주의 색 */
  readonly warning: boolean
}

/** 이 입금을 확정하면 바뀔 입금 상태 (서버가 코어로 계산한 after) */
export function bundleChange(bundle: Pick<BundleView, 'payment' | 'refundDue' | 'after'>): BundleChange | null {
  const after = bundle.after
  if (after === null) return null
  const from = paymentWord(bundle.payment, bundle.refundDue)
  const to = paymentWord(after.payment, after.refundDue)
  const warning = after.payment === 'OVERPAID' && (bundle.payment !== 'OVERPAID' || after.refundDue > bundle.refundDue)
  return { text: from === to ? `그대로(${from})` : `${from} → ${to}`, warning }
}

/** 제안 묶음 한 줄: "다육이맘 · 2026년 10월 18일 묶음 · 남은 금액 14,000원" */
export function bundleWords(bundle: Pick<BundleView, 'name' | 'date' | 'remaining'>): string {
  return `${bundle.name} · ${dateYear(bundle.date)} 묶음 · 남은 금액 ${formatWon(bundle.remaining)}`
}

/** 확정 창의 줄: "다육이맘 · 2026년 10월 18일 묶음 · 14,000원 입금 · 미입금 → 입금 완료" (AC-N3-42) */
export function confirmLine(bundle: BundleView, amount: number): string {
  const change = bundleChange(bundle)
  return `${bundle.name} · ${dateYear(bundle.date)} 묶음 · ${formatWon(amount)} 입금${change === null ? '' : ` · ${change.text}`}`
}

/**
 * 정산 기록의 입금 연결 (AC-N3-47, D-MOB2-05): 입금 확인으로 적은 입금은 "자동 입금 확인 · 김영희 · 10/18 21:03 · 입금 번호 12"
 * (판매자 확정은 "입금 내역으로 확인 · …", 되돌린 것은 끝에 " · 되돌림"), 되돌림 환불은 "입금 확인 되돌림 · 입금 번호 12"
 */
export function depositLinkWords(link: DepositLinkView): string {
  const label = depositLabel(link.deposit.no)
  if (link.kind === 'refund') return `입금 확인 되돌림 · ${label}`
  const how = link.auto ? '자동 입금 확인' : '입금 내역으로 확인'
  return `${how} · ${depositName(link.deposit.name)} · ${depositTime(link.deposit.at, link.deposit.precision)} · ${label}${link.reverted ? ' · 되돌림' : ''}`
}

/** 되돌리기 확인 문장 (AC-N3-44) */
export function revertQuestion(buyerName: string, date: string, amount: number): string {
  return `${buyerName} · ${dateWords(date)} 묶음에 적은 ${formatWon(amount)} 입금을 되돌려요. 같은 금액의 환불 기록이 남고 이 입금은 확인 필요로 돌아가요.`
}

export const PASTE_STATE_WORD: Readonly<Record<PasteRowState, string>> = {
  NEW: '새 입금',
  EXISTING: '이미 있는 입금',
  OLD: '오래된 입금',
  FUTURE: '시각이 지금보다 늦은 입금',
}

export const UNREADABLE_WORD: Readonly<Record<UnreadableWhy, string>> = {
  BAD_AMOUNT: '금액을 읽지 못했어요',
  BAD_TIME: '시각을 읽지 못했어요(분까지 필요해요)',
}

/** 붙여넣기 결과 문장: "새 입금 5건 — 자동 확인 3건, 확인 필요 2건 (이미 있던 입금 1건)" (AC-N3-45) */
export function pasteResultWords(summary: { readonly new: number; readonly auto: number; readonly review: number; readonly existing: number }): string {
  return `새 입금 ${String(summary.new)}건 — 자동 확인 ${String(summary.auto)}건, 확인 필요 ${String(summary.review)}건 (이미 있던 입금 ${String(summary.existing)}건)`
}

/** 처리 기록 낱말 (AC-N3-31·44) */
export function depositActionWord(action: DepositActionView['action']): string {
  switch (action) {
    case 'RECEIVED':
      return '받음'
    case 'AUTO':
      return '자동 확인'
    case 'CONFIRM':
      return '확정'
    case 'IGNORE':
      return '무시'
    case 'REOPEN':
      return '다시 확인 필요로'
    case 'REVERT':
      return '되돌리기'
    default:
      return '처리'
  }
}

/** 입금 자동 확인이 한 일의 "누가" (AC-N3-20·31) */
export const AUTO_ACTOR = '입금 자동 확인'

export function depositActorWord(actor: DepositActionView['actor']): string {
  if (actor.kind === 'auto') return AUTO_ACTOR
  if (actor.kind === 'account') return actor.loginId ?? '판매자'
  return '서버'
}

/** 팝빌 은행 코드 → 은행 이름 (계좌조회 원천 추가·목록). 목록에 없는 코드는 "은행 코드 0000" */
export const BANKS: readonly { readonly code: string; readonly name: string }[] = [
  { code: '0004', name: '국민은행' },
  { code: '0088', name: '신한은행' },
  { code: '0020', name: '우리은행' },
  { code: '0081', name: '하나은행' },
  { code: '0011', name: '농협은행' },
  { code: '0003', name: '기업은행' },
  { code: '0090', name: '카카오뱅크' },
  { code: '0089', name: '케이뱅크' },
  { code: '0092', name: '토스뱅크' },
  { code: '0071', name: '우체국' },
  { code: '0045', name: '새마을금고' },
  { code: '0048', name: '신협' },
  { code: '0007', name: '수협은행' },
  { code: '0002', name: '산업은행' },
  { code: '0023', name: 'SC제일은행' },
  { code: '0027', name: '씨티은행' },
  { code: '0031', name: '아이엠뱅크(대구)' },
  { code: '0032', name: '부산은행' },
  { code: '0034', name: '광주은행' },
  { code: '0035', name: '제주은행' },
  { code: '0037', name: '전북은행' },
  { code: '0039', name: '경남은행' },
]

export function bankName(code: string | null): string {
  if (code === null) return ''
  return BANKS.find((bank) => bank.code === code)?.name ?? `은행 코드 ${code}`
}

/** 받아 오는 주기 낱말 */
export function intervalWords(minutes: number): string {
  return `${String(minutes)}분마다`
}
