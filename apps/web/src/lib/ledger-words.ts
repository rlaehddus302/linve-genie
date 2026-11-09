// 손님 장부 타입·문구 (KP1, CR-2~CR-7) — React·실시간 알림 없이 쓰는 조각(앱 손님·설정 화면도 같이 쓴다, D-APPX-03).
export type LedgerMonths = 6 | 12 | 24 | 36

export const LEDGER_MONTHS: readonly LedgerMonths[] = [6, 12, 24, 36]
export const DEFAULT_LEDGER_MONTHS: LedgerMonths = 12

/** 설정 "손님 관리"의 장부 칸 (CR-3·CR-7) */
export interface LedgerSettings {
  readonly months: LedgerMonths
  /**
   * 방송 화면에 손님 표시. null = 판매자가 아직 정하지 않음(UX-KP1-006 — 정하기 전에는 보이지 않는다).
   * 서버가 아직 null을 주지 않으면(옛 서버) 받은 참·거짓 그대로다.
   */
  readonly consoleBadges: boolean | null
}

export const DEFAULT_LEDGER_SETTINGS: LedgerSettings = { months: DEFAULT_LEDGER_MONTHS, consoleBadges: null }

/** 콘솔 채팅 줄 꼬리표 하나 (CR-7) — text가 null이면 꼬리표 없음 */
export interface CustomerBadge {
  readonly buyer: string
  readonly text: string | null
  readonly spoken: string | null
}

export interface BadgesView {
  /** 설정 "방송 화면에 손님 표시"가 켜져 있다 */
  readonly show: boolean
  readonly badges: readonly CustomerBadge[]
}

/** 묶음 자세히의 "지난 주문 배송지" — 타입은 api/parcel-types.ts에 둔다 (DOM 없는 타입 검사 설정이 그 파일을 읽는다) */
export type { LedgerPrefill } from '../api/parcel-types.ts'

/** 손님 자세히의 장부 칸 (CR-3·CR-5) — 가린 이름·끝 4자리만 */
export interface CustomerLedgerView {
  readonly ledgerId: string
  /** 가린 받는 분 (홍*동) */
  readonly name: string
  readonly phoneLast4: string
  /** 지우는 날 (KST 날짜) */
  readonly keepUntil: string
  /** 가장 최근 동의 묶음 날짜 */
  readonly consentDate: string
  /** 손님이 연결 코드로 직접 이은 계정 */
  readonly linked: readonly { readonly label: string; readonly linkedAt: string }[]
}

// ── 문구 ──────────────────────────────────────────────────────────────

export const LEDGER_MONTH_WORDS: Readonly<Record<LedgerMonths, string>> = { 6: '6개월', 12: '1년', 24: '2년', 36: '3년' }
export const LEDGER_MONTHS_LABEL = '저장한 배송지 보관 기간'
export const LEDGER_MONTHS_HELP = '손님이 다음 주문에도 쓰겠다고 고른 배송지를 이 기간 동안 보관해요. 마지막 주문 뒤 기간이 지나면 저절로 지워요.'
export const CONSOLE_BADGES_LABEL = '라이브 화면에 손님 표시'
export const CONSOLE_BADGES_HELP = '라이브 화면을 녹화하거나 송출 화면에 띄운다면 꺼 주세요. 손님에게 보이면 안 되는 표시예요.'
/** 아직 정하지 않았을 때 (UX-KP1-006) */
export const CONSOLE_BADGES_UNDECIDED = '아직 정하지 않았어요. 정하기 전에는 라이브 화면에 보이지 않아요.'
/** 콘솔에서 처음 한 번 묻는 띠 (UX-KP1-006) */
export const CONSOLE_BADGES_ASK = '라이브 화면에 손님 표시를 보일까요? 이 화면을 라이브에 내보내면 손님도 볼 수 있어요.'
// 꼬리표 글 그대로("단골"·"입금 늦음 주의"·"처음")를 쓰지 않는다 — 꼬리표가 없는 콘솔에 그 낱말이 보이면 손님 표시로 헷갈린다(CRM1 AC-CRM1-19)
export const CONSOLE_BADGES_ASK_DETAIL = '채팅 이름 옆에 자주 사는 손님, 입금이 늦었던 손님, 처음 온 손님을 알려 주는 작은 표시예요. 나중에 설정 "손님 관리"에서 바꿀 수 있어요.'
export const CONSOLE_BADGES_SHOW = '보이기'
export const CONSOLE_BADGES_HIDE = '안 보이기'
export const CONSOLE_BADGES_ASK_FAILED = '저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'
/** 보관 기간을 줄일 때 확인 (UX-KP1-002) — 몇 명인지 못 받으면 수 없이 */
export const LEDGER_SHRINK_TITLE = '보관 기간을 줄일까요?'
export const LEDGER_SHRINK_ASK = '이미 기간이 지난 손님의 저장한 배송지는 1시간 안에 지워져요. 되돌릴 수 없어요.'
/** 확인 창 문장: 서버가 센 수(n)가 있으면 수와 함께 */
export function shrinkAsk(n: number | null): string {
  if (n === null) return LEDGER_SHRINK_ASK
  if (n === 0) return '지금 줄여도 바로 지워지는 손님은 없어요. 앞으로는 줄인 기간이 지나면 저장한 배송지가 지워져요. 되돌릴 수 없어요.'
  return `지금 줄이면 손님 ${n.toLocaleString('ko-KR')}명의 저장한 배송지가 1시간 안에 지워져요. 되돌릴 수 없어요.`
}
export const LEDGER_SHRINK_OK = '줄이기'
export const LEDGER_SHRINK_KEEP = '그대로 두기'
export const LEDGER_SHRINK_NOTE = '기간을 줄이면 이미 기간이 지난 손님의 저장한 배송지가 1시간 안에 지워져요. 되돌릴 수 없어요. [저장]을 누르면 몇 명인지 한 번 더 물어봐요.'
export const CONSOLE_BADGES_DETAIL = '켜면 라이브 화면 채팅에 "입금 늦음 주의"·"단골 · 누적"·"처음"이 보여요. 끄면 1등 옆 "입금 늦음 주의"도 함께 사라져요.'
export const PREFILL_TITLE = '지난 주문 배송지예요 — 확인해 주세요'
export const PREFILL_HELP = '손님이 지난 주문 때 저장해 둔 배송지예요. 맞으면 [배송지 확인]을 눌러 주세요. 바뀌었으면 [고치기]로 고쳐 주세요.'
export const PREFILL_CONFIRMED = '지난 주문 배송지로 확인했어요.'
export const XLSX_BUTTON = '엑셀로 받기'
export const XLSX_TITLE = '손님 엑셀로 받기'
export const XLSX_HELP = '모든 손님을 누적 큰 순으로 받아요. 거르기·찾기와 상관없이 전부 들어가요.'
export const XLSX_CONTACT_LABEL = '연락처·주소도 넣기'
export const XLSX_CONTACT_HELP = '배송지 저장에 동의한 손님만 들어가요.'
export const XLSX_CONTACT_WARNING = '연락처가 든 파일은 다른 사람에게 보내지 마세요.'
export const XLSX_BUSY = '엑셀을 만드는 중…'
export const LINKED_PREFIX = '이 손님이 직접 이은 계정: '
export const LEDGER_TITLE = '저장한 배송지'
export const LEDGER_NONE = '저장해 둔 배송지가 없어요. 손님이 확인서 링크에서 "다음 주문에도 이 배송지 쓰기"를 고르면 생겨요.'
export const LEDGER_DELETE = '저장한 배송지 지우기'
export const LEDGER_DELETE_TITLE = '저장한 배송지 지우기'
export const LEDGER_DELETE_ASK = '이 손님의 저장한 배송지를 지울까요? 지우면 되돌릴 수 없어요. 지난 주문의 배송지와 손님 기록은 그대로예요.'
export const LEDGER_DELETED = '저장한 배송지를 지웠어요.'
export const SELLER_CANNOT_WRITE = '저장한 배송지는 손님이 확인서 링크에서 직접 고를 때만 생겨요. 판매자가 대신 만들 수 없어요.'
