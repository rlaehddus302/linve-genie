// 휴대폰 알림 받기 (SMS3 ORD-13·PAY-02, D-SMS3-04·12·14, D-DEP2-06, AC-SMS3-28~32) — 화면 낱말·순수 함수·서버 부르기.
// 문구는 SPEC ORD-13 "화면 문구"·DEPOSIT_RULES DP-8 그대로. 문자 본문·기기 이름은 React 기본 이스케이프로만 보인다(여기서 HTML을 만들지 않는다).
// 받기 토큰 원문은 만든 응답에서 화면 상태로만 잠깐 들고 있다 — 저장소·주소·로그에 남기지 않는다(C-07).
import { formatWon } from '@livejjim/core'
import { SERVICE_NAME } from '../brand.ts'
import { get, newRequestId, post, put, withRetry } from '../api/client.ts'
import type { BankAlertView, InboxCardView, InboxReviewReason, InboxSettingsView } from '../api/inbox-types.ts'
import { kstClockWords, kstDateTimeWords, kstStamp } from './kst.ts'

// ── 주소 (서버 계약이 바뀌면 여기만) ──────────────────────────────────────

export const INBOX_PATHS = {
  settings: '/api/inbox/settings',
  token: '/api/inbox/token',
  cards: (broadcast: string) => `/api/inbox/cards?${new URLSearchParams({ b: broadcast }).toString()}`,
  card: (id: string, action: InboxAction) => `/api/inbox/cards/${encodeURIComponent(id)}/${action}`,
  alerts: '/api/deposits/alerts',
  closeAlert: (id: number) => `/api/deposits/alerts/${String(id)}/close`,
} as const

export type InboxAction = 'insert' | 'approve' | 'ignore'

// ── 설정 "휴대폰 알림 받기" (AC-SMS3-28) ────────────────────────────────────

export const INBOX_SECTION_TITLE = '휴대폰 알림 받기'
export const INBOX_INTRO = `판매자 휴대폰에 온 손님 문자와 은행 입금 알림을 ${SERVICE_NAME}가 자동으로 받아요. 손님 문자는 문자찜으로, 은행 알림은 입금 확인으로 가요.`
export const INBOX_OFF = '꺼져 있어요'
export const INBOX_OFF_NEW = '꺼져 있어요. 켜면 받기 토큰이 만들어져요.'
export const INBOX_ON = '켜져 있어요'
export const INBOX_TURN_ON = '켜고 토큰 만들기'
export const INBOX_TURN_ON_AGAIN = '다시 켜기'
export const INBOX_RENEW = '토큰 다시 만들기'
export const INBOX_TURN_OFF = '끄기'
export const INBOX_COPY = '복사하기'
export const INBOX_COPIED = '복사했어요. 휴대폰 앱이나 단축어에 붙여 넣어 주세요.'
export const INBOX_COPY_FAILED = '복사하지 못했어요. 토큰 글자를 길게 눌러 직접 복사해 주세요.'
/** 토큰은 이 화면에서 한 번만 보인다 */
export const INBOX_TOKEN_ONCE = '이 토큰은 지금 한 번만 보여요. 화면을 떠나면 다시 볼 수 없어요. 잃어버리면 "토큰 다시 만들기"를 눌러 주세요.'
/** 다시 만들기 확인 창 (AC-SMS3-28 그대로) */
export const INBOX_RENEW_QUESTION = '전에 쓰던 휴대폰·단축어는 더 이상 보내지 못해요. 새 토큰을 휴대폰 앱이나 단축어에 다시 넣어 주세요.'
export const INBOX_RENEW_CONFIRM = '새로 만들기'
export const INBOX_OFF_QUESTION = '끄면 휴대폰에서 보낸 문자와 은행 알림을 받지 않아요. 다시 켜면 넣어 둔 토큰으로 다시 받아요.'
export const INBOX_OFF_CONFIRM = '끌게요'
export const INBOX_NEVER = '아직 받은 것이 없어요.'
export const INBOX_ANDROID_HINT = `안드로이드: ${SERVICE_NAME} 앱 → 설정 → "휴대폰 알림 받기"에서 켜고, 알림 읽기를 허용해 주세요. 앱이 토큰을 알아서 넣어요.`
export const INBOX_IPHONE_HINT = '아이폰: 은행 앱 알림은 받을 수 없어요. 단축어로 손님 문자와 은행 문자만 보낼 수 있어요.'
export const INBOX_SHORTCUT_LINK = '아이폰 단축어 만들기 안내'
/** 단축어 만들기 안내 (아이폰은 앱이 다른 앱 알림을 읽을 수 없다 — D-SMS3-02 ③) */
export const INBOX_SHORTCUT_STEPS: readonly string[] = [
  '단축어 앱 → 자동화 → 새로 만들기 → "메시지"를 고르세요.',
  '"메시지에 다음이 포함된 경우"는 비워 두고 "즉시 실행"을 켜세요.',
  `동작에 "URL 콘텐츠 가져오기"를 넣고 주소에 아래 ${SERVICE_NAME} 받는 주소를 넣으세요.`,
  '방법은 POST, 머리글 이름 Authorization, 값은 "Bearer " 뒤에 위 토큰을 붙여 넣으세요.',
  '본문에 보낸 사람·내용·받은 시각을 이어 주세요. 끝나면 손님 문자 하나로 시험해 보세요.',
]

/** 마지막으로 받은 줄: "마지막으로 받은 시각 10월 31일 오후 8:01 · 김사장 갤럭시" */
export function lastReceivedWords(view: Pick<InboxSettingsView, 'lastReceivedAt' | 'lastDevice'>): string {
  if (view.lastReceivedAt === null) return INBOX_NEVER
  const at = kstDateTimeWords(view.lastReceivedAt)
  const device = view.lastDevice?.trim() ?? ''
  return `마지막으로 받은 시각 ${at}${device === '' ? '' : ` · ${device}`}`
}

// ── 콘솔 "문자 확인" 칸 (AC-SMS3-30) ───────────────────────────────────────

export const INBOX_PANEL_TITLE = '문자 확인'
export const INBOX_NAME_ONLY = '이름만 와서 누가 보냈는지 몰라요'
export const INBOX_FROM_SMS = '문자로 받음'
export const INBOX_NO_CLAIM = '취소할 찜이 없어요'
export const INBOX_PICK_NUMBER = '넣을 번호를 먼저 골라 주세요.'

/** 확인 필요 사유 문장 (ORD-13 "화면 문구"). NO_NUMBER는 수용 기준 AC-SMS3-17·30 문장. 모르는 사유는 서버 문장 */
export function inboxReasonWords(card: Pick<InboxCardView, 'kind' | 'why' | 'numbers' | 'message'>): string {
  const no = card.numbers[0]
  if (card.kind === 'CANCEL') return no === undefined ? '찜 취소를 원해요' : `${String(no)}번 취소를 원해요`
  const reason: InboxReviewReason | null = card.why
  switch (reason) {
    case 'UNCLEAR':
      return '번호는 있는데 확실하지 않아요'
    case 'NO_NUMBER':
      return INBOX_NAME_ONLY
    case 'OPTIONS':
      return '옵션 방송이라 직접 골라 주세요'
    case 'NOT_ON_SALE':
      return no === undefined ? '지금 판매 중이 아니에요' : `${String(no)}번은 지금 판매 중이 아니에요`
    default:
      return card.message.trim() === '' ? '확인해 주세요' : card.message
  }
}

/** 보낸 사람 줄: "뒤 4자리 5678" 또는 이름만 */
export function inboxSenderWords(card: Pick<InboxCardView, 'last4'>): string {
  return card.last4 === null ? INBOX_NAME_ONLY : `뒤 4자리 ${card.last4}`
}

/** 카드 받은 시각 "20:01:05" (KST) */
export function inboxTimeWords(card: Pick<InboxCardView, 'receivedAt'>): string {
  return kstClockWords(card.receivedAt)
}

/** 받은 순서(오래된 것 먼저, 새것 아래). 같은 시각이면 서버 순서 그대로 */
export function orderCards(items: readonly InboxCardView[]): InboxCardView[] {
  return items
    .map((item, index) => ({ item, index, at: Date.parse(item.receivedAt) }))
    .sort((a, b) => (Number.isFinite(a.at) && Number.isFinite(b.at) && a.at !== b.at ? a.at - b.at : a.index - b.index))
    .map((entry) => entry.item)
}

// ── 받기 멈춤 알림 (AC-SMS3-31) ───────────────────────────────────────────

export const INBOX_STALL = '휴대폰에서 문자가 오지 않고 있어요. 앱의 알림 읽기가 켜져 있는지 확인해 주세요.'
/** 방송 시작 뒤 이만큼 받은 것이 없으면 */
export const INBOX_STALL_MS = 10 * 60 * 1000

/**
 * 받기 멈춤 알림을 보일까: 토큰이 켜진 판매자, 끝나지 않은 실제 방송, 방송 시작 뒤 10분이 넘었고
 * 마지막으로 받은 때(방송 시작 전이면 시작 시각부터)부터 10분이 넘었다. 무엇이든 받으면 다시 10분을 잰다.
 */
export interface InboxReceiving {
  readonly enabled: boolean
  readonly lastReceivedAt: string | null
  /** 재기 시작한 때 (방송 시작 시각 — 모르면 콘솔을 연 때: 늦게 보일 수는 있어도 일찍 보이지 않는다) */
  readonly startedAt: string | null
}

export function inboxStalled(
  receiving: InboxReceiving | null,
  live: { readonly rehearsal: boolean; readonly ended: boolean },
  now: number,
): boolean {
  if (receiving === null || !receiving.enabled || live.rehearsal || live.ended || receiving.startedAt === null) return false
  const started = Date.parse(receiving.startedAt)
  if (!Number.isFinite(started)) return false
  const last = receiving.lastReceivedAt === null ? Number.NaN : Date.parse(receiving.lastReceivedAt)
  const from = Number.isFinite(last) && last > started ? last : started
  return now - from > INBOX_STALL_MS
}

/** 이 방송에서 닫은 받기 멈춤 알림 (그 방송에서 다시 안 보인다 — 탭을 닫아도 이 기기에서는) */
const STALL_KEY = 'livejjim.inbox.stallClosed'

export function stallClosed(broadcast: string): boolean {
  try {
    return (globalThis.localStorage?.getItem(STALL_KEY) ?? '').split(',').includes(broadcast)
  } catch {
    return false
  }
}

export function closeStall(broadcast: string): void {
  try {
    const held = (globalThis.localStorage?.getItem(STALL_KEY) ?? '').split(',').filter((id) => id !== '' && id !== broadcast)
    // 오래된 것은 버린다 (최근 20개)
    globalThis.localStorage?.setItem(STALL_KEY, [...held.slice(-19), broadcast].join(','))
  } catch {
    // 저장하지 못하면 이 화면이 열린 동안만 닫힌다
  }
}

// ── 입금 확인 화면 "은행 알림" 줄 (AC-SMS3-23·32, DP-8) ─────────────────────

export const BANK_NOTICE_TITLE = '은행 알림'
export const BANK_NOTICE_CLOSE = '확인했어요'
export const BANK_UNREADABLE = '읽지 못한 은행 알림이에요. 은행 앱에서 확인하고 필요하면 정산에서 손으로 적어 주세요'

/** 줄 문장 (DP-8 그대로). 모르는 종류는 서버 문장 */
export function bankNoticeWords(notice: BankAlertView): string {
  if (notice.kind === 'CANCEL') {
    const amount = notice.amount === null ? '' : formatWon(notice.amount)
    const name = notice.name?.trim() ?? ''
    const what = [amount, name].filter((part) => part !== '').join(' ')
    return `입금 취소 알림이 왔어요: ${what}. 이 입금을 확인했다면 되돌려 주세요`
  }
  if (notice.kind === 'UNREADABLE') return BANK_UNREADABLE
  return notice.message
}

/** 줄 꼬리: "신한 · 10/31 20:05:00" (은행 이름·받은 시각) */
export function bankNoticeMeta(notice: Pick<BankAlertView, 'bankName' | 'receivedAt'>): string {
  const bank = notice.bankName.trim()
  const at = kstStamp(notice.receivedAt)
  return [bank, at].filter((part) => part !== '').join(' · ')
}

/** 입금자명 비교 (앞뒤·가운데 공백 무시) */
const nameKey = (name: string): string => name.replace(/\s+/gu, '')

/**
 * 입금 취소 알림과 같은 금액·같은 이름의 확인한 입금 (되돌리기로 가는 링크 — 저절로 되돌리지 않는다, AC-SMS3-32).
 * 이름이 없는 알림은 아무것도 고르지 않는다(다른 입금을 되돌리게 하지 않는다).
 */
export function cancelMatches<T extends { readonly amount: number; readonly name: string; readonly applied: unknown }>(notice: BankAlertView, deposits: readonly T[]): T[] {
  if (notice.kind !== 'CANCEL' || notice.amount === null || notice.name === null || nameKey(notice.name) === '') return []
  const want = nameKey(notice.name)
  return deposits.filter((deposit) => deposit.applied !== null && deposit.amount === notice.amount && nameKey(deposit.name) === want)
}

// ── 서버 부르기 ──────────────────────────────────────────────────────────

export function fetchInboxSettings(): Promise<InboxSettingsView> {
  return get<{ inbox: InboxSettingsView }>(INBOX_PATHS.settings).then((result) => result.inbox)
}

/** 만들기·다시 만들기 — 자동으로 다시 보내지 않는다(다시 보내면 방금 받은 토큰이 또 무효가 된다) */
export function createInboxToken(): Promise<{ readonly token: string; readonly inbox: InboxSettingsView }> {
  return post<{ token: string; inbox: InboxSettingsView }>(INBOX_PATHS.token, {})
}

/** 켜기·끄기 */
export function setInboxEnabled(enabled: boolean): Promise<InboxSettingsView> {
  return put<{ inbox: InboxSettingsView }>(INBOX_PATHS.settings, { enabled }).then((result) => result.inbox)
}

export function fetchInboxCards(broadcast: string): Promise<readonly InboxCardView[]> {
  return get<{ cards: InboxCardView[] }>(INBOX_PATHS.cards(broadcast)).then((result) => result.cards)
}

export interface InsertInput {
  readonly no: number
  /** 옵션 방송만 */
  readonly qty?: number
  readonly options?: Readonly<Record<string, string>>
}

/** 카드 처리 — 누를 때 만든 요청 번호로, 닿지 못하면 같은 번호로 다시 (서버는 한 번만 처리). 무시는 요청 번호가 없다 */
export function sendCardAction(id: string, action: InboxAction, input?: InsertInput): Promise<unknown> {
  const body = action === 'ignore' ? {} : { requestId: newRequestId(), ...(input === undefined ? {} : input) }
  return withRetry(() => post<unknown>(INBOX_PATHS.card(id, action), body))
}

export function fetchBankAlerts(): Promise<readonly BankAlertView[]> {
  return get<{ alerts: BankAlertView[] }>(INBOX_PATHS.alerts).then((result) => result.alerts)
}

export function closeBankAlert(id: number): Promise<unknown> {
  return withRetry(() => post<unknown>(INBOX_PATHS.closeAlert(id), {}))
}

/** 휴대폰 알림으로 넣은 문자찜의 엔진 ref 머리 (서버 약속 — 찜 보기에 ref가 오면 "문자로 받음") */
export const INBOX_REF_PREFIX = 'ibx_'

/** SSE `inbox` 알림 */
export type InboxStreamEvent =
  | { readonly kind: 'cards'; readonly b: string | null }
  | { readonly kind: 'received'; readonly lastReceivedAt: string | null; readonly lastDevice: string | null }
  | { readonly kind: 'settings' }

export function parseInboxEvent(raw: unknown): InboxStreamEvent | null {
  try {
    const data = JSON.parse(String(raw)) as unknown
    if (typeof data !== 'object' || data === null) return null
    const record = data as Record<string, unknown>
    const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
    switch (record.kind) {
      case 'cards':
        return { kind: 'cards', b: text(record.b) }
      case 'received':
        return { kind: 'received', lastReceivedAt: text(record.lastReceivedAt), lastDevice: text(record.lastDevice) }
      case 'settings':
        return { kind: 'settings' }
      default:
        return null
    }
  } catch {
    return null
  }
}

/**
 * 휴대폰 알림으로 넣은 문자찜의 찜 ID ("문자로 받음"): 찜 보기에 엔진 ref가 오고 `ibx_`로 시작하면.
 * 찜 보기에 ref가 없는 서버면 빈 모음 — 표시만 빠지고 판정·보드는 그대로다.
 */
export function inboxClaimIds(claims: Iterable<{ readonly id: string; readonly origin: string }>): ReadonlySet<string> {
  const out = new Set<string>()
  for (const claim of claims) {
    const ref = (claim as { readonly ref?: unknown }).ref
    if (claim.origin === 'sms' && typeof ref === 'string' && ref.startsWith(INBOX_REF_PREFIX)) out.add(claim.id)
  }
  return out
}
