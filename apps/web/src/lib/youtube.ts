// 유튜브 화면 낱말·판단 (YT-01~08, D-I3-02~07). 판정은 하지 않는다 — 서버가 준 상태·문장을 고르고 화면 낱말로 바꾸기만 한다.
// 서버가 돌려주는 문장(수집 상태·발송함 사유·잇기 오류)은 화면이 고치지 않고 그대로 보인다(AC-I3 머리말).
import type { ApiError } from '../api/client.ts'
import type { CollectorView, LinkRecordView, LiveBroadcastItem, OutboxRow, OutboxTarget, QuotaMode, YoutubeConnection, YoutubeWebChat } from '../api/types.ts'

/** 준비 안 된 서버 (503 YOUTUBE_NOT_CONFIGURED의 서버 문장과 같다, AC-I3-01·20) */
export const NOT_CONFIGURED_MESSAGE = '유튜브 연동을 준비하지 않은 서버예요.'
export const RECONNECT_NEEDED_MESSAGE = '유튜브 연결을 다시 해 주세요.'
export const CONNECT_FIRST_MESSAGE = '유튜브를 먼저 연결해 주세요.'
/** 콘솔 유튜브 칸 — 연결 안 됨 (AC-I3-20) */
export const CONSOLE_NOT_CONNECTED = '유튜브 채널을 먼저 연결해 주세요.'
export const REHEARSAL_YOUTUBE = '리허설 방송은 유튜브와 잇지 않아요. 가짜 채팅으로 연습해요.'

/** 구글에서 돌아온 결과 문장 (AC-I3-02 — 서버 CALLBACK_MESSAGES와 같은 문장) */
export const CALLBACK_RESULT_MESSAGES: Readonly<Record<string, string>> = {
  connected: '유튜브 채널을 연결했어요.',
  STATE_INVALID: '연결 시간이 지났어요. 다시 시도해 주세요.',
  ACCESS_DENIED: '구글에서 연결을 허락하지 않았어요. 다시 시도해 주세요.',
  NO_CHANNEL: '이 구글 계정에는 유튜브 채널이 없어요.',
  CHANNEL_TAKEN: '이 채널은 연결할 수 없어요. 운영자에게 문의해 주세요.',
  CHANNEL_MISMATCH: '처음 연결한 채널과 달라요. 바꾸려면 먼저 연결을 끊어 주세요.',
  GOOGLE_FAILED: '구글에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
}
export const CALLBACK_UNKNOWN_MESSAGE = '연결 결과를 알 수 없어요. 아래 연결 상태를 확인해 주세요.'

export function callbackMessage(code: string): string {
  return Object.hasOwn(CALLBACK_RESULT_MESSAGES, code) ? (CALLBACK_RESULT_MESSAGES[code] as string) : CALLBACK_UNKNOWN_MESSAGE
}

/** 돌아온 결과가 성공인가 (문장 꾸밈만 — 연결 상태는 늘 서버로 다시 읽는다) */
export const callbackSucceeded = (code: string): boolean => code === 'connected'

// ── 감사 메시지 (YT-04·05·07, D-I3-03) ─────────────────────────────────────

/** 대상마다 요약 한 줄 (AC-I3-13) — 저장된 규칙(만들기)과 지금 동의로 */
export const SUMMARY_AUTO = '다음 방송부터 자동으로 남겨요'
export const SUMMARY_MANUAL = '감사 메시지를 만들기만 하고 자동으로 올리지 않아요. 감사 메시지 목록에서 하나씩 보낼 수 있어요.'
export const SUMMARY_OFF = '감사 메시지를 만들지 않아요.'

export function consentSummary(make: boolean, consent: boolean): string {
  if (!make) return SUMMARY_OFF
  return consent ? SUMMARY_AUTO : SUMMARY_MANUAL
}

/** 미리 보기 (AC-I3-14) */
export const PREVIEW_SINGLE = '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다'
export const PREVIEW_BATCH = '15번 핑크프릴 10,000원 홍길동님, 16번 라울 5,000원 김철수님 구매 감사합니다'
export const PREVIEW_SMS_NOTE = "문자찜으로 산 분은 '문자찜'으로 나가요. 메모·전화번호는 절대 나가지 않아요."

/** 동의 설명 창의 대상 낱말 (AC-I3-11) */
export const CONSENT_PLACE: Readonly<Record<'LIVE_CHAT' | 'VIDEO_COMMENT', string>> = {
  LIVE_CHAT: '실시간 채팅에',
  VIDEO_COMMENT: '방송 영상 댓글로',
}
export const CONSENT_NAME: Readonly<Record<'LIVE_CHAT' | 'VIDEO_COMMENT', string>> = {
  LIVE_CHAT: '실시간 채팅',
  VIDEO_COMMENT: '영상 댓글',
}
export const CONSENT_OFF_DONE = '껐어요. 기다리던 감사 메시지는 보내지 않아요.'

/** 발송함 대상 낱말 (AC-I3-31) */
export const TARGET_WORD: Readonly<Record<OutboxTarget, string>> = {
  LIVE_CHAT: '실시간 채팅',
  VIDEO_COMMENT: '영상 댓글',
  SUMMARY: '요약 댓글',
}

/** 알림 띠 "감사 실패"가 세는 사유 — 판매자가 할 일이 있는 실패만 (D-I3-05, AC-I3-30) */
export const ALERT_REASONS: ReadonlySet<string> = new Set(['UNCONFIRMED', 'GAVE_UP', 'REJECTED', 'NO_PERMISSION', 'NOT_MY_CHANNEL', 'EXPIRED'])

/** 알림 띠가 세는 행: 보내지 못함 + 할 일이 있는 사유 + 알림에서 빼지 않음 */
export function needsAttention(row: OutboxRow): boolean {
  return row.state === 'FAILED' && row.reason !== null && ALERT_REASONS.has(row.reason) && row.dismissed !== true
}

/** 알림 띠 "감사 실패 n" */
export function thanksFailedCount(rows: readonly OutboxRow[]): number {
  let count = 0
  for (const row of rows) if (needsAttention(row)) count++
  return count
}

export interface OutboxGroups {
  /** 확인이 필요한 감사 (알림 띠가 세는 행) */
  readonly attention: readonly OutboxRow[]
  /** 자동으로 보내지 않은 감사 (동의 없음·방송 안 이음·채팅 끝남·봉인, 알림에서 뺀 행) */
  readonly notSent: readonly OutboxRow[]
  /** 기다리는 중·보내는 중 */
  readonly pending: readonly OutboxRow[]
  /** 보냄 (게시됨·건너뜀) */
  readonly sent: readonly OutboxRow[]
}

/** 감사 메시지 목록의 묶음 (AC-I3-31) — 같은 묶음 안에서는 최근 행이 위 */
export function outboxGroups(rows: readonly OutboxRow[]): OutboxGroups {
  const attention: OutboxRow[] = []
  const notSent: OutboxRow[] = []
  const pending: OutboxRow[] = []
  const sent: OutboxRow[] = []
  for (const row of [...rows].sort((a, b) => b.id - a.id)) {
    if (row.state === 'FAILED') (needsAttention(row) ? attention : notSent).push(row)
    else if (row.state === 'WAITING' || row.state === 'SENDING') pending.push(row)
    else sent.push(row)
  }
  return { attention, notSent, pending, sent }
}

/** "다시 보내기"를 보이는 행: 보내지 못함 (확인하지 못한 감사는 확인 창을 거친다) */
export const canResend = (row: OutboxRow): boolean => row.state === 'FAILED'

/** "이미 올라갔을 수 있어요" 안내 (AC-I3-33) */
export function unconfirmedWarning(target: OutboxTarget): string {
  return `이미 올라갔을 수 있어요. ${target === 'LIVE_CHAT' ? '유튜브 채팅' : '영상 댓글'}에서 먼저 확인해 주세요.`
}

export const NOT_MY_CHANNEL_HINT = '그 방송을 이은 유튜브 채널로 다시 연결하면 보낼 수 있어요.'
export const NOT_MY_CHANNEL_MESSAGE = '지금 연결한 유튜브 채널의 방송이 아니라 보내지 않았어요.'
export const NO_PERMISSION_DIALOG = '글쓰기 권한이 없어요. 구글 화면에서 허락한 뒤 다시 보내 주세요.'
export const SEALED_READ_ONLY = '30일이 지나 봉인한 날짜예요. 볼 수만 있어요.'
export const REHEARSAL_OUTBOX = '리허설 감사 메시지는 유튜브에 올리지 않아요.'

/** 상품 키 `<방송>/<번호>`의 번호 */
export function productNo(product: string | null): number | null {
  if (product === null) return null
  const no = Number(product.slice(product.lastIndexOf('/') + 1))
  return Number.isInteger(no) && no > 0 ? no : null
}

// ── 할당량 (YT-08, D-I3-06) ───────────────────────────────────────────────

export const QUOTA_MODE_SENTENCE: Readonly<Record<QuotaMode, string>> = {
  NORMAL: '감사 메시지를 바로 보내요',
  BATCH: '유튜브 사용량이 얼마 남지 않아 감사 메시지를 묶어서 보내요',
  PAUSED: '오늘 유튜브 사용량이 거의 다 되어 감사 메시지를 멈췄어요. 채팅은 계속 받아요',
}
/** 보통으로 돌아왔을 때 한 번 띄우는 알림 (AC-I3-38) */
export const QUOTA_BACK_TO_NORMAL = '유튜브 사용량이 다시 채워져 감사 메시지를 바로 보내요.'

/** 모드가 바뀌었을 때 띄울 알림 문장 (같은 모드면 null — 서버를 다시 시작한 뒤 같은 모드를 다시 알려도 띄우지 않는다) */
export function quotaChangeNotice(previous: QuotaMode | null, next: QuotaMode): string | null {
  if (previous === null || previous === next) return null
  return next === 'NORMAL' ? QUOTA_BACK_TO_NORMAL : QUOTA_MODE_SENTENCE[next]
}

// ── 수집 상태 (YT-03, D-I3-04) ────────────────────────────────────────────

/** 경고를 띄우는 멈춤 이유 (AC-I3-25) — 판매자가 끊음(UNLINKED)·봉인(SEALED)은 경고가 아니다 */
export const WARN_REASONS: ReadonlySet<string> = new Set(['RECONNECT', 'NOT_CONNECTED', 'NOT_MY_CHANNEL', 'QUOTA', 'CHAT_DISABLED', 'FORBIDDEN', 'CHAT_NOT_FOUND'])
/** "다시 연결하는 중"이 이만큼 이어져야 경고를 띄운다 (깜빡임 방지) */
export const RETRYING_WARN_MS = 10_000
export const STOP_WARNING_PREFIX = '유튜브 채팅을 받지 못하고 있어요'

export interface CollectorWarning {
  readonly message: string
  /** "다시 연결하기" (설정 유튜브 칸으로) */
  readonly reconnect: boolean
  /** "채팅 다시 받기" */
  readonly restartable: boolean
  /**
   * 서버가 읽는 유튜브 채팅(YT-11)의 경고 — 대비 경로 버튼(댓글 붙여넣기·손으로 넣기, 확장을 이은 판매자는 확장 안내)을 함께 보인다 (D-YT-SRV-09).
   * 옛 공식 읽기의 경고에는 없다(undefined)
   */
  readonly fallback?: true
}

/**
 * 콘솔 고정 영역의 수집 멈춤 경고 (AC-I3-25). retryingLong = "다시 연결하는 중"이 10초 넘게 이어졌는가.
 * 끝난 방송·채팅이 끝남·시작하는 중(예정 방송)·마침은 경고가 없다.
 * 서버 읽기의 막힘·형식 바뀜(다시 연결하는 중 + BLOCKED·FORMAT)과 운영자 끔(멈춤 + OPERATOR_OFF)은 10초를 기다리지 않고 바로,
 * 서버 문장 그대로 띄운다 (YT-11 AC5·AC6, D-YT-SRV-06·07)
 */
export function collectorWarning(collector: CollectorView | null, retryingLong: boolean): CollectorWarning | null {
  if (collector === null) return null
  const web = collector.mode === WEB_MODE
  if (webChatTrouble(collector)) {
    return { message: collector.reasonMessage ?? WEB_TROUBLE_FALLBACK[collector.reason as WebTroubleReason], reconnect: false, restartable: collector.restartable, fallback: true }
  }
  const stopped = collector.status === 'STOPPED' && collector.reason !== null && WARN_REASONS.has(collector.reason)
  const retrying = collector.status === 'RETRYING' && retryingLong
  if (!stopped && !retrying) return null
  const detail = collector.reasonMessage ?? collector.statusMessage
  // 서버 읽기는 구글 연결과 상관없다 — "다시 연결하기"를 보이지 않는다 (D-YT-SRV-10)
  const reconnect = !web && (collector.reason === 'RECONNECT' || collector.reason === 'NOT_CONNECTED')
  return {
    message: `${STOP_WARNING_PREFIX} — ${detail}`,
    reconnect,
    // 다시 연결해야 하는 멈춤은 연결을 고치면 저절로 이어받는다 — 할 일 버튼은 "다시 연결하기" 하나만 (헷갈리지 않게)
    restartable: collector.restartable && !reconnect,
    ...(web ? { fallback: true as const } : {}),
  }
}

// ── 서버가 읽는 유튜브 채팅 (YT-11, D-YT-SRV-03·06·07·09·11) ───────────────────

/** 수집기 받는 방식 값 — 서버가 유튜브 웹으로 읽음 (화면에는 보이지 않는다) */
export const WEB_MODE = 'WEB'

/** 설정·시작 마법사 유튜브 칸 첫 줄 (D-YT-SRV-11) */
export const WEB_CHAT_INTRO = '방송할 때 방송 주소만 넣으면 채팅을 받아요.'
/** 구글 연결을 선택 칸으로 내린 제목·설명 (D-YT-SRV-11·13 — 감사 채팅은 공식으로만, 기본 꺼짐) */
export const GOOGLE_FOR_THANKS_TITLE = '감사 채팅을 올리려면 (선택)'
export const GOOGLE_FOR_THANKS = '구글 연결은 감사 채팅을 올릴 때만 필요해요. 연결하지 않아도 채팅은 받아요.'
/** 구글 연결을 쓸 수 없는 서버 (oauth=false) — 연결 버튼 대신 */
export const GOOGLE_NOT_READY = '이 서버에서는 감사 채팅을 올리는 구글 연결을 쓰지 않아요. 채팅은 방송 주소만으로 받아요.'
/** 구글 연결이 다시 필요할 때 (서버 읽기 — 채팅은 멈추지 않는다, D-YT-SRV-10) */
export const RECONNECT_FOR_THANKS = '감사 채팅을 올리는 구글 연결을 다시 해 주세요. 채팅은 그대로 받아요.'
/** 감사 자동 게시 동의 칸: 구글 연결 없음 (서버 읽기) */
export const CONNECT_FOR_THANKS = '감사 채팅을 올리려면 유튜브 칸에서 구글 연결을 먼저 해 주세요.'
/** 운영자가 서버 읽기를 끔 (YT-11 AC6 — 서버 YOUTUBE_WEB_CHAT_OFF·OPERATOR_OFF 문장과 같다) */
export const WEB_CHAT_OFF_MESSAGE = '지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.'

/** 바로 경고하는 서버 읽기 이유 (D-YT-SRV-06·07) */
export type WebTroubleReason = 'BLOCKED' | 'FORMAT' | 'OPERATOR_OFF'
/** 서버가 문장을 주지 않았을 때만 쓰는 같은 문장 (서버 COLLECTOR_REASON_MESSAGES와 같다) */
export const WEB_TROUBLE_FALLBACK: Readonly<Record<WebTroubleReason, string>> = {
  BLOCKED: '유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요.',
  FORMAT: '유튜브가 바뀌어 채팅을 자동으로 읽지 못하고 있어요. 주문은 손으로 넣어 주세요.',
  OPERATOR_OFF: WEB_CHAT_OFF_MESSAGE,
}

/** 서버 읽기가 막힘·형식 바뀜(다시 연결하는 중)이거나 운영자가 꺼서 멈췄는가 — 바로 경고 */
export function webChatTrouble(collector: CollectorView | null): boolean {
  if (collector === null || collector.reason === null) return false
  if (collector.status === 'RETRYING') return collector.reason === 'BLOCKED' || collector.reason === 'FORMAT'
  return collector.status === 'STOPPED' && collector.reason === 'OPERATOR_OFF'
}

/** 막힌 뒤 다시 받기 시작했을 때 유튜브 칸에 남기는 한 줄 (YT-11 AC5 — 화면이 상태 전환으로 띄운다, 서버에 남는 표시 없음) */
export const WEB_CHAT_RESUMED = '유튜브 채팅을 다시 받고 있어요. 막힌 동안 손으로 넣은 주문과 겹치지 않는지 봐 주세요.'
/** 대비 경로 — 확장을 이은 판매자에게만 (D-YT-SRV-09, NFR-09) */
export const EXTENSION_FALLBACK = 'PC 크롬에서 유튜브 채팅 창을 열어 두면 확장이 대신 받아요.'
/** 대비 경로 버튼 */
export const FALLBACK_PASTE = '댓글 붙여넣기'
export const FALLBACK_HAND = '손으로 넣기'
/** 유튜브 경고에서 연 붙여넣기 창의 안내 (틱톡과 같은 '닉네임: 댓글' 줄, PLT-02) */
export const YOUTUBE_PASTE_GUIDE = "유튜브 채팅 창의 글을 '닉네임: 댓글' 한 줄씩 붙여 넣어 주세요."

export type ResumeStep = { readonly trouble: boolean; readonly resumed: boolean }

/**
 * 막힘이 풀렸는가 (상태 전환만 본다): 막힘·형식 바뀜·운영자 끔을 본 뒤 "받는 중"이 되면 resumed.
 * 막힌 뒤 연결 오류로 다시 시도하는 중·시작하는 중은 막힘을 기억한다. 멈춤·끝·끊음이면 잊는다.
 */
export function resumeStep(previous: ResumeStep, collector: CollectorView | null): ResumeStep {
  if (webChatTrouble(collector)) return { trouble: true, resumed: false }
  if (collector === null) return { trouble: false, resumed: false }
  if (collector.status === 'LIVE') return { trouble: false, resumed: previous.resumed || previous.trouble }
  if (collector.status === 'RETRYING' || collector.status === 'STARTING') return previous
  return { trouble: false, resumed: false }
}

/** 처음 잇는 채널 확인 줄 (D-YT-SRV-03 — INV1 확인 줄을 대신함). 이름은 글자로만 */
export function firstChannelQuestion(name: string): string {
  return `처음 잇는 채널이에요 (채널: ${name}). 이 방송이 맞나요?`
}
/** 확인 줄 묶음 이름 */
export const FIRST_CHANNEL_GROUP = '처음 잇는 채널 확인'

/** 콘솔 유튜브 칸 한 줄 (D-YT-SRV-03 — "초대받은 방송 · {이름}"을 대신해 늘 보인다) */
export function broadcastChannelLine(name: string): string {
  return `유튜브 방송 · ${name}`
}

/** 이은 방송의 채널 이름 (서버 읽기 — 늘). 이은 것이 없으면 null */
export function linkedChannelName(link: LinkRecordView | null): string | null {
  if (link === null) return null
  return channelName(link.broadcastChannelTitle)
}

/** 최근 채널 찾기 (D-YT-SRV-03 목록 ②) */
export const RECENT_TITLE = '최근 이은 채널의 방송'
export const RECENT_AGAIN = '다시 찾기'
export const RECENT_EMPTY = '최근 이은 채널에 지금 하는 방송이 없어요. 방송 주소를 붙여 넣어 주세요.'
export const RECENT_SEARCHING = '최근 이은 채널에서 지금 방송을 찾는 중…'
/** 방송 제목이 비었을 때 */
export const NO_BROADCAST_TITLE = '(제목 없음)'

/** 최근 채널 방송 한 줄 "{채널 이름} · {방송 제목}" — 둘 다 바깥 글(글자로만) */
export function recentLine(item: LiveBroadcastItem): string {
  const title = item.title.trim() === '' ? NO_BROADCAST_TITLE : item.title
  return `${channelName(item.channelTitle)} · ${title}`
}

/** 연결 응답에서 서버 읽기·구글 연결 가능 여부를 읽는다 (옛 서버: webChat 없음 → null, oauth 없음 → true) */
export function readModeOf(body: { readonly webChat?: unknown; readonly oauth?: unknown }): { readonly webChat: YoutubeWebChat | null; readonly oauth: boolean } {
  const raw = body.webChat
  const webChat = typeof raw === 'object' && raw !== null && typeof (raw as { on?: unknown }).on === 'boolean' ? { on: (raw as { on: boolean }).on } : null
  return { webChat, oauth: body.oauth !== false }
}

/** 연결이 쓸 수 있는 상태인가 (연결됨 또는 다시 연결 필요 — 사용량을 보인다) */
export const hasChannel = (connection: YoutubeConnection | null): boolean => connection !== null && connection.status !== 'NOT_CONNECTED'

// ── 봉인 예고 (DAT-06, D-I3-07) ───────────────────────────────────────────

/** 봉인 시각 몇 전부터 경고 상자를 띄우나 (AC-I3-40) */
export const SEAL_WARN_BEFORE_MS = 7 * 24 * 60 * 60 * 1000
export const SEAL_WARNING = '30일이 지나면 채팅 내용을 지우고 기록을 봉인해요. 그 뒤로는 입금·배송비 같은 기록을 고칠 수 없어요. 그 전에 정산을 마쳐 주세요.'

/** 지금이 봉인 7일 전 이후인가 */
export function sealSoon(sealAt: string, now: number = Date.now()): boolean {
  const at = Date.parse(sealAt)
  return Number.isFinite(at) && now >= at - SEAL_WARN_BEFORE_MS
}

// ── 초대받은 방송 (YT-02, INV1 D-PHN-17·D-INV1-02~04) ───────────────────────

/** 서버가 "내 채널 아님 — 확인 필요"로 잇지 않았을 때의 코드 (409, 본문에 channel: { id, title }·videoId) */
export const INVITED_CONFIRM_CODE = 'INVITED_CONFIRM_NEEDED'
/** 확인한 뒤 다시 보내는 잇기 요청의 확인 표시 칸 — 값은 JSON true만 (D-INV1-02) */
export const INVITED_CONFIRM_FIELD = 'confirmInvited'
/** 채널 이름이 비었을 때 (D-INV1-03) */
export const NO_CHANNEL_NAME = '(이름 없음)'
/** 화면에서 채널 이름을 이만큼 넘으면 줄임표로 자른다 (저장값은 자르지 않는다, D-INV1-03) */
export const CHANNEL_NAME_MAX = 40

/** 화면에 보일 채널 이름: 글자가 아니거나 비면 "(이름 없음)", 길면 줄임표. 글자로만 넣는다(React 이스케이프) */
export function channelName(title: unknown): string {
  const text = typeof title === 'string' ? title.trim() : ''
  if (text === '') return NO_CHANNEL_NAME
  const chars = Array.from(text)
  return chars.length > CHANNEL_NAME_MAX ? `${chars.slice(0, CHANNEL_NAME_MAX).join('')}…` : text
}

/** 확인 줄 (AC-INV1-05) */
export function invitedQuestion(name: string): string {
  return `내 채널 방송이 아니에요 (채널: ${name}). 초대받은 방송이 맞나요?`
}

/** 콘솔 유튜브 칸 한 줄 (AC-INV1-05) */
export function invitedLine(name: string): string {
  return `초대받은 방송 · ${name}`
}

export interface InvitedConfirm {
  /** 서버가 다시 알려 준 영상 ID (없으면 null — 그때는 보낸 영상을 쓴다) */
  readonly videoId: string | null
  /** 화면에 보일 채널 이름 */
  readonly name: string
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** 잇기 실패가 "내 채널 아님 — 확인 필요"인가. 맞으면 확인 줄에 쓸 값, 아니면 null */
export function invitedConfirmOf(error: ApiError): InvitedConfirm | null {
  if (error.code !== INVITED_CONFIRM_CODE) return null
  const channel = recordOf(error.details.channel)
  const title = channel !== null ? channel.title : error.details.channelTitle
  const videoId = typeof error.details.videoId === 'string' && error.details.videoId !== '' ? error.details.videoId : null
  return { videoId, name: channelName(title) }
}

/** 이은 방송이 초대 방송이면 그 채널 이름, 내 방송(옛 기록 포함)이면 null (D-INV1-01) */
export function invitedChannelName(link: LinkRecordView | null): string | null {
  if (link === null) return null
  // 서버가 알려 준 판단(invited)이 있으면 그대로 따른다
  if (link.invited === false) return null
  if (link.invited === true) return channelName(link.broadcastChannelTitle)
  const broadcastChannel = link.broadcastChannelId
  if (typeof broadcastChannel !== 'string' || broadcastChannel === '' || broadcastChannel === link.channelId) return null
  return channelName(link.broadcastChannelTitle)
}
