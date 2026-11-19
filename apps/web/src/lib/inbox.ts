// 휴대폰 알림 받기 (SMS3 ORD-13·PAY-02, D-SMS3-04·12·14, D-DEP2-06, AC-SMS3-28~32) — 화면 낱말·순수 함수·서버 부르기.
// 문구는 SPEC ORD-13 "화면 문구"·DEPOSIT_RULES DP-8 그대로. 문자 본문·기기 이름은 React 기본 이스케이프로만 보인다(여기서 HTML을 만들지 않는다).
// 받기 토큰 원문은 만든 응답에서 화면 상태로만 잠깐 들고 있다 — 저장소·주소·로그에 남기지 않는다(C-07).
import { formatWon } from '@livejjim/core'
import { SERVICE_NAME } from '../brand.ts'
import { get, newRequestId, post, put, withRetry } from '../api/client.ts'
import type { BankAlertView, InboxCardView, InboxReviewReason, InboxStaleNotice, InboxSettingsView } from '../api/inbox-types.ts'
import { kstClockWords, kstDateTimeWords, kstMonthDayClock, kstStamp } from './kst.ts'

// ── 주소 (서버 계약이 바뀌면 여기만) ──────────────────────────────────────

export const INBOX_PATHS = {
  settings: '/api/inbox/settings',
  token: '/api/inbox/token',
  cards: (broadcast: string) => `/api/inbox/cards?${new URLSearchParams({ b: broadcast }).toString()}`,
  card: (id: string, action: InboxAction) => `/api/inbox/cards/${encodeURIComponent(id)}/${action}`,
  alerts: '/api/deposits/alerts',
  closeAlert: (id: number) => `/api/deposits/alerts/${String(id)}/close`,
  closeStale: '/api/inbox/stale/close',
} as const

export type InboxAction = 'insert' | 'approve' | 'ignore'

// ── 설정 "휴대폰 알림 받기" (AC-SMS3-28) ────────────────────────────────────
// D-SMS3-39: 판매자에게 보이는 말은 "토큰" 대신 "받기 열쇠"(코드·서버 이름 token은 그대로). Authorization·Bearer는 접힌 안내 안 코드 글꼴로만.

export const INBOX_SECTION_TITLE = '휴대폰 알림 받기'
export const INBOX_INTRO = `판매자 휴대폰에 온 손님 문자와 은행 입금 알림을 ${SERVICE_NAME}가 자동으로 받아요. 손님 문자는 문자찜으로, 은행 알림은 입금 확인으로 가요.`
export const INBOX_OFF = '꺼져 있어요'
export const INBOX_OFF_NEW = '꺼져 있어요. 켜면 받기 열쇠가 만들어져요.'
export const INBOX_ON = '켜져 있어요'
export const INBOX_TURN_ON = '켜고 받기 열쇠 만들기'
export const INBOX_TURN_ON_AGAIN = '다시 켜기'
export const INBOX_RENEW = '받기 열쇠 다시 만들기'
export const INBOX_TURN_OFF = '끄기'
export const INBOX_COPY = '복사하기'
export const INBOX_COPIED = '복사했어요. 휴대폰 앱이나 단축어에 붙여 넣어 주세요.'
export const INBOX_COPY_FAILED = '복사하지 못했어요. 받기 열쇠 글자를 길게 눌러 직접 복사해 주세요.'
/** 받기 열쇠(토큰)는 이 화면에서 한 번만 보인다 */
export const INBOX_TOKEN_ONCE = '이 받기 열쇠는 지금 한 번만 보여요. 화면을 떠나면 다시 볼 수 없어요. 잃어버리면 "받기 열쇠 다시 만들기"를 눌러 주세요.'
/** 다시 만들기 확인 창 (AC-SMS3-28 그대로) */
export const INBOX_RENEW_QUESTION = '전에 쓰던 휴대폰·단축어는 더 이상 보내지 못해요. 새 받기 열쇠를 휴대폰 앱이나 단축어에 다시 넣어 주세요.'
export const INBOX_RENEW_CONFIRM = '새로 만들기'
export const INBOX_OFF_QUESTION = '끄면 휴대폰에서 보낸 문자와 은행 알림을 받지 않아요. 다시 켜면 넣어 둔 받기 열쇠로 다시 받아요.'
export const INBOX_OFF_CONFIRM = '끌게요'
export const INBOX_NEVER = '아직 받은 것이 없어요.'
export const INBOX_ANDROID_HINT = `안드로이드: ${SERVICE_NAME} 앱 → 설정 → "휴대폰 알림 받기"에서 켜고, 알림 읽기를 허용해 주세요. 앱이 받기 열쇠를 알아서 넣어요.`
export const INBOX_IPHONE_HINT = '아이폰: 은행 앱 알림은 받을 수 없어요. 단축어로 손님 문자와 은행 문자만 보낼 수 있어요.'
/**
 * 아이폰 단축어 안내 첫 줄 (UX-SMS3-002): 컴퓨터에서 복사한 글은 아이폰에 붙여 넣을 수 없다 — 아이폰 사파리로 이 설정 화면을 열어
 * 토큰을 만들고 받는 주소·헤더 값을 복사해 붙여 넣는다(웹은 휴대폰 폭에서도 된다). 앱(apps/mobile PhoneNoticeCard)도 같은 뜻.
 */
export const INBOX_IPHONE_FIRST = '아이폰 사파리로 이 설정 화면을 열어 복사해 붙여 넣으세요. 컴퓨터에서 복사한 글은 아이폰에 붙여 넣을 수 없어요. 받기 열쇠도 아이폰에서 만들면 바로 복사할 수 있어요.'
/** 단축어 안내의 값 글꼴 설명 (UX-SMS3-001) */
export const INBOX_VALUE_NOTE = '회색 상자 안의 글자만 그대로 적어 주세요(따옴표는 적지 않아요).'
export const INBOX_COPY_ADDRESS = '받는 주소 복사'
/** 단축어 헤더 값 "Bearer <토큰>"을 한 번에 (띄어쓰기 실수 없이) */
export const INBOX_COPY_HEADER = '헤더 값 복사 (Bearer 붙음)'
export const INBOX_COPIED_ADDRESS = '받는 주소를 복사했어요. 단축어 URL 칸에 붙여 넣어 주세요.'
export const INBOX_COPIED_HEADER = '헤더 값을 복사했어요. 단축어에서 더한 헤더의 값 칸에 붙여 넣어 주세요.'
export const INBOX_COPY_FAILED_ANY = '복사하지 못했어요. 글자를 길게 눌러 직접 복사해 주세요.'
/** 이 칸은 누르면 바로 바뀐다 — 설정 아래 "저장"과 상관없다 (UX-SMS3-011) */
export const INBOX_INSTANT = '이 칸은 누르면 바로 저장돼요. 아래 "저장"은 누르지 않아도 돼요.'
export const INBOX_SHORTCUT_LINK = '아이폰 단축어 만들기 안내'
/**
 * 단축어 만들기 안내 (아이폰은 앱이 다른 앱 알림을 읽을 수 없다 — D-SMS3-02 ③, 판매자에게 보이는 아이폰 안내는 이것 하나 — D-SMS3-23).
 * 기기 입구(ORD-13 C-04)는 JSON `{ device, messages: [{ id, channel, from, text, receivedAt }] }`만 받는다 — 모양이 다르면 400이라 문자를 모두 잃는다.
 * 그래서 단축어 화면에 실제로 넣는 칸 이름·값을 그대로 적는다. 앱(apps/mobile PhoneNoticeCard)도 같은 글을 보인다 — 바꾸면 둘 다. `…`로 감싼 글은 단축어 화면에 글자 그대로 넣는 값이다(화면은 코드 글꼴로 보인다).
 */
export const INBOX_SHORTCUT_STEPS: readonly string[] = [
  '단축어 앱 → 자동화 → 새로 만들기 → "메시지"를 고르세요. 보낸 사람·내용 조건은 비워 두고 "즉시 실행"을 켜세요.',
  `동작에 "URL 콘텐츠 가져오기"를 넣고, URL에 ${SERVICE_NAME} 설정 "휴대폰 알림 받기"의 받는 주소를 넣으세요.`,
  '동작을 펼쳐 방법을 `POST`로 바꾸세요.',
  '헤더에 하나를 더하세요. 키는 `Authorization`, 값은 `Bearer` 뒤에 한 칸 띄고 설정에서 만든 받기 열쇠를 붙여 넣으세요.',
  '요청 본문을 `JSON`으로 고르고 칸 두 개를 더하세요. `device`(텍스트) = 휴대폰 이름(예: 내 아이폰), `messages`(배열).',
  '`messages` 안에 "사전" 하나를 더하고, 그 안에 칸 다섯 개를 넣으세요.',
  '`id`(텍스트) = "현재 날짜"(날짜 형식 "사용자 지정" `yyyyMMddHHmmss` — 초까지)와 단축어 입력의 "보낸 사람"을 이어 붙인 글 — 문자마다 달라야 해요.',
  '`id`에 고정 글(예: 내 문자)을 넣지 마세요. 그러면 하루 동안 같은 문자로 보고 그 뒤 손님 문자를 하나도 받지 못해요.',
  '`channel`(텍스트) = `SMS`',
  '`from`(텍스트) = 단축어 입력의 "보낸 사람"',
  '`text`(텍스트) = 단축어 입력의 "내용"',
  '`receivedAt`(텍스트) = 현재 날짜 (날짜 형식은 "ISO 8601")',
  '칸 이름은 위 영어 글자를 대소문자까지 똑같이 적어 주세요. 하나라도 다르면 문자를 하나도 받지 못해요.',
  '다 만들면 손님 문자 하나로 시험해 보세요. 설정 "휴대폰 알림 받기"의 "마지막으로 받은 시각"이 바뀌면 잘 된 거예요.',
]

/** 안내 한 단계를 글·값 조각으로 (`…`로 감싼 조각은 단축어에 그대로 넣는 값) */
export function shortcutStepParts(step: string): { readonly text: string; readonly value: boolean }[] {
  return step
    .split('`')
    .map((text, index) => ({ text, value: index % 2 === 1 }))
    .filter((part) => part.text !== '')
}

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
/** 이름만 온 문자 카드의 연락처 이름 줄 꼬리 (UX-SMS3-004) — "연락처 이름: 김영희 (전화번호는 오지 않았어요)" */
export const INBOX_NO_PHONE = '(전화번호는 오지 않았어요)'
export const INBOX_FROM_SMS = '문자로 받음'
export const INBOX_NO_CLAIM = '취소할 찜이 없어요'
export const INBOX_PICK_NUMBER = '넣을 번호를 먼저 골라 주세요.'

/** 확인 필요 사유 문장 (ORD-13 "화면 문구"). NO_NUMBER는 수용 기준 AC-SMS3-17·30 문장. 모르는 사유는 서버 문장 */
export function inboxReasonWords(card: Pick<InboxCardView, 'kind' | 'why' | 'numbers' | 'message' | 'receivedAt'>): string {
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
    case 'LATE':
      return inboxLateWords(card.receivedAt)
    case 'REJECTED':
      return `${no === undefined ? '' : `${String(no)}번은 `}바로 넣지 못했어요. 보드에서 확인해 주세요`
    case 'PAUSED':
      return '잠깐 멈춤 중에 온 문자예요. 넣으려면 직접 넣어 주세요'
    default:
      return card.message.trim() === '' ? '확인해 주세요' : card.message
  }
}

/**
 * 늦게 온 문자 (D-SMS3-30): "늦게 온 문자예요 (휴대폰이 10월 31일 오후 7:59:50에 받음). 넣으면 지금 받은 순서로 들어가요".
 * 휴대폰이 받은 시각(원래 값)은 며칠 전일 수 있어 날짜를 붙인다(KST). 카드의 다른 시각과 같은 오전/오후 모양 하나로 (UX-SMS3-008).
 * 넣으면 받은 시각은 서버 도착 시각이다(서버가 정한다).
 */
export function inboxLateWords(receivedAt: string): string {
  const at = kstMonthDayWords(receivedAt)
  return `늦게 온 문자예요 (휴대폰이 ${at === '' ? '먼저' : `${at}에`} 받음). 넣으면 지금 받은 순서로 들어가요`
}

/** 늦게 온 문자 카드의 덧붙임 줄 — "지금 받은 순서"가 맨 뒤라는 뜻 (UX-SMS3-008) */
export const INBOX_LATE_LAST = '먼저 온 찜을 앞지르지 않고 맨 뒤 순서로 들어가요.'

/** KST "10월 31일 오후 7:59:50" (날짜 + 오전/오후 시각, 초까지) */
export function kstMonthDayWords(value: string): string {
  const stamp = kstMonthDayClock(value)
  const clock = kstClockWords(value)
  if (stamp === '' || clock === '') return ''
  return `${stamp.split(' ').slice(0, 2).join(' ')} ${clock}`
}

/** 이름만 온 문자(전화번호 없음)의 연락처 이름 — 넣으면 메모가 된다 (서버: 메모 = 보낸 이름, 40자까지). 없으면 null */
export function nameOnlySender(card: Pick<InboxCardView, 'last4' | 'sender'>): string | null {
  if (card.last4 !== null && card.last4.trim() !== '') return null
  const name = card.sender?.trim() ?? ''
  return name === '' ? null : name
}

/** 이름만 온 문자 카드에서 넣으면 보드에 보일 이름 "넣으면 '문자찜(김영희)'으로 들어가요" (UX-SMS3-004) */
export function nameOnlyInsertWords(card: Pick<InboxCardView, 'last4' | 'sender'>): string | null {
  const name = nameOnlySender(card)
  return name === null ? null : `넣으면 '문자찜(${[...name].slice(0, 40).join('')})'으로 들어가요`
}

/** 이름만 온 문자의 취소 요청 안내 (D-SMS3-19) — "승인" 없이 이 문장과 "무시"만 */
export const INBOX_CANCEL_NAME_ONLY = `${INBOX_NAME_ONLY}. 보드에서 직접 취소해 주세요`

/** 승인할 수 없는 취소 요청: 이름만 온 문자(뒤 4자리 없음)는 보낸 손님을 정할 수 없다 (D-SMS3-19). 서버가 승인 불가 값을 주면 그것도 따른다 */
export function cancelNeedsBoard(card: Pick<InboxCardView, 'kind' | 'last4'> & { readonly approvable?: unknown; readonly canApprove?: unknown }): boolean {
  if (card.kind !== 'CANCEL') return false
  if (card.approvable === false || card.canApprove === false) return true
  return card.last4 === null || card.last4.trim() === ''
}

/** 보낸 사람 줄: "뒤 4자리 5678" 또는 이름만 */
export function inboxSenderWords(card: Pick<InboxCardView, 'last4'>): string {
  return card.last4 === null ? INBOX_NAME_ONLY : `뒤 4자리 ${card.last4}`
}

/** 늦게 온 문자에서 나온 카드 (D-SMS3-30) */
export function cardIsLate(card: Pick<InboxCardView, 'why' | 'late'>): boolean {
  return card.late === true || card.why === 'LATE'
}

/** 카드 받은 시각 "오후 8:01:05" (KST). 늦게 온 문자는 휴대폰이 받은 원래 시각이 며칠 전일 수 있어 날짜까지 "10월 29일 오후 8:01:05" (D-SMS3-30, 오전/오후 한 모양 — UX-SMS3-008) */
export function inboxTimeWords(card: Pick<InboxCardView, 'receivedAt'> & Partial<Pick<InboxCardView, 'why' | 'late'>>): string {
  return cardIsLate({ why: card.why ?? null, late: card.late }) ? kstMonthDayWords(card.receivedAt) : kstClockWords(card.receivedAt)
}

/** 늦게 온 카드가 서버에 온 시각 "오후 8:20:01 도착" (없으면 빈 글) */
export function inboxArrivedWords(card: Pick<InboxCardView, 'why' | 'late' | 'arrivedAt'>): string {
  if (!cardIsLate(card) || card.arrivedAt === undefined) return ''
  const at = kstClockWords(card.arrivedAt)
  return at === '' ? '' : `${at} 도착`
}

/** 받은 순서(오래된 것 먼저, 새것 아래). 같은 시각이면 서버 순서 그대로 */
export function orderCards(items: readonly InboxCardView[]): InboxCardView[] {
  return items
    // 늦게 온 문자는 서버에 온 때가 받은 순서다 (휴대폰이 받은 원래 시각은 며칠 전일 수 있다, D-SMS3-30)
    .map((item, index) => ({ item, index, at: Date.parse(cardIsLate(item) && item.arrivedAt !== undefined ? item.arrivedAt : item.receivedAt) }))
    .sort((a, b) => (Number.isFinite(a.at) && Number.isFinite(b.at) && a.at !== b.at ? a.at - b.at : a.index - b.index))
    .map((entry) => entry.item)
}

// ── 받기 멈춤 알림 (AC-SMS3-31) ───────────────────────────────────────────

export const INBOX_STALL = '휴대폰에서 문자가 오지 않고 있어요. 앱의 알림 읽기가 켜져 있는지 확인해 주세요.'
/** 받기 멈춤 덧붙임 — 위 문장(스펙 그대로)은 안드로이드 앱 말이라 아이폰 단축어 판매자 몫을 한 줄 더한다 (UX-SMS3-011) */
export const INBOX_STALL_IPHONE = '아이폰은 단축어 앱의 자동화가 켜져 있는지 확인해 주세요.'
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

// ── 12시간 넘은 방송 알림 (D-SMS3-29, AC-SMS3-31) ─────────────────────────

export const INBOX_STALE = '끝내지 않은 방송이 12시간 넘게 이어져 손님 문자를 넣지 않았어요. 방송을 끝내 주세요.'

/**
 * 12시간 알림의 덧붙임 줄 (UX-SMS3-007): 어느 방송인지(이름을 알면 이름, 시작 시각)와 넣지 않은 손님 문자 수.
 * "'1부' 방송 (10월 30일 오전 8:00 시작) · 넣지 않은 손님 문자 3통". 아무것도 모르면 빈 글
 */
export function staleDetailWords(stale: Pick<InboxStaleNotice, 'startedAt' | 'count'>, title?: string | null): string {
  const name = title?.trim() ?? ''
  const started = stale.startedAt === null ? '' : kstDateTimeWords(stale.startedAt)
  const which = name !== '' ? `'${name}' 방송${started === '' ? '' : ` (${started} 시작)`}` : started === '' ? '' : `${started}에 시작한 방송`
  const count = stale.count > 0 ? `넣지 않은 손님 문자 ${String(stale.count)}통` : ''
  return [which, count].filter((part) => part !== '').join(' · ')
}

/** 서버가 준 12시간 넘은 방송 알림을 읽는다 — 모양이 다르거나 없으면 null(알림 없음). 문구는 스펙 그대로(화면이 정한다) */
export function readStaleNotice(raw: unknown): InboxStaleNotice | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record.b !== 'string' || record.b === '') return null
  const time = (value: unknown): string | null => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null)
  const count = typeof record.count === 'number' && Number.isInteger(record.count) && record.count > 0 ? record.count : 0
  return { b: record.b, startedAt: time(record.startedAt), lastAt: time(record.lastAt), count, message: INBOX_STALE }
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
/** 입금 취소 알림의 입금자명이 빈 글일 때 (DP-8, D-DEP2-15) */
export const BANK_NO_NAME = '이름 모름'
export const BANK_UNREADABLE = '읽지 못한 은행 알림이에요. 은행 앱에서 확인하고 필요하면 정산에서 손으로 적어 주세요'

/** 줄 문장 (DP-8 그대로). 모르는 종류는 서버 문장 */
export function bankNoticeWords(notice: BankAlertView): string {
  if (notice.kind === 'CANCEL') {
    const amount = notice.amount === null ? '' : formatWon(notice.amount)
    // 입금자명이 빈 글이면 "이름 모름" (DP-8, D-DEP2-15)
    const given = notice.name?.trim() ?? ''
    const name = given === '' ? BANK_NO_NAME : given
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

/** "문자 확인" 칸 읽기: 카드 · 휴대폰 알림으로 넣은 찜 ID("문자로 받음") · 방송 시작 시각(받기 멈춤 알림) */
export interface InboxCardsResult {
  readonly cards: readonly InboxCardView[]
  readonly claimIds: ReadonlySet<string>
  readonly startedAt: string | null
  /** 12시간 넘은 방송 알림 (설정과 같은 값 — 방송과 상관없이 판매자 것, D-SMS3-29) */
  readonly stale: InboxStaleNotice | null
}

/** 서버 응답을 읽는다 — 모양이 다른 값(옛 서버)은 빈 것으로 (표시만 빠지고 판정·보드는 그대로) */
export function readInboxCards(raw: { readonly cards?: unknown; readonly inboxClaimIds?: unknown; readonly startedAt?: unknown; readonly staleBroadcast?: unknown }): InboxCardsResult {
  const cards = Array.isArray(raw.cards) ? (raw.cards as InboxCardView[]) : []
  const claimIds = new Set<string>()
  if (Array.isArray(raw.inboxClaimIds)) for (const id of raw.inboxClaimIds as unknown[]) if (typeof id === 'string') claimIds.add(id)
  const startedAt = typeof raw.startedAt === 'string' && Number.isFinite(Date.parse(raw.startedAt)) ? raw.startedAt : null
  return { cards, claimIds, startedAt, stale: readStaleNotice(raw.staleBroadcast) }
}

export function fetchInboxCards(broadcast: string): Promise<InboxCardsResult> {
  return get<{ cards?: unknown; inboxClaimIds?: unknown; startedAt?: unknown; staleBroadcast?: unknown }>(INBOX_PATHS.cards(broadcast)).then(readInboxCards)
}

/** 12시간 넘은 방송 알림 닫기 (판매자만 — 닫은 뒤 또 넣지 않은 문자가 오면 서버가 다시 준다) */
export function closeStaleNotice(): Promise<InboxSettingsView> {
  return withRetry(() => post<{ inbox: InboxSettingsView }>(INBOX_PATHS.closeStale, {})).then((result) => result.inbox)
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
 * 휴대폰 알림으로 넣은 문자찜의 찜 ID ("문자로 받음"): 서버 cards 응답의 `inboxClaimIds`에 있는 문자찜,
 * 또는 찜 보기에 엔진 ref가 오고 `ibx_`로 시작하면. 둘 다 없으면 빈 모음 — 표시만 빠지고 판정·보드는 그대로다.
 */
export function inboxClaimIds(claims: Iterable<{ readonly id: string; readonly origin: string }>, fromServer: ReadonlySet<string> = new Set()): ReadonlySet<string> {
  const out = new Set<string>()
  for (const claim of claims) if (claim.origin === 'sms' && fromServer.has(claim.id)) out.add(claim.id)
  for (const claim of claims) {
    const ref = (claim as { readonly ref?: unknown }).ref
    if (claim.origin === 'sms' && typeof ref === 'string' && ref.startsWith(INBOX_REF_PREFIX)) out.add(claim.id)
  }
  return out
}
