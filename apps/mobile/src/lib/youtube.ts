// 유튜브 낱말·판단 (웹 apps/web/src/lib/youtube.ts·extension.ts와 같은 문장 — test/web-sync.test.ts가 견준다).
// 서버가 방송 주소만으로 채팅을 읽는다(YT-11, D-YT-SRV-03·06·07·09·11). 판정은 하지 않고 서버가 준 상태·문장을 고르기만 한다.
import type { CollectorView, LinkRecordView, LiveBroadcastItem, YoutubeWebChat } from '@livejjim/web/src/api/types.ts'

export const NOT_CONFIGURED_MESSAGE = '유튜브 연동을 준비하지 않은 서버예요.'
export const WEB_CHAT_OFF_MESSAGE = '지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.'
export const WEB_CHAT_RESUMED = '유튜브 채팅을 다시 받고 있어요. 막힌 동안 손으로 넣은 주문과 겹치지 않는지 봐 주세요.'
export const WEB_TROUBLE_FALLBACK = {
  BLOCKED: '유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요.',
  FORMAT: '유튜브가 바뀌어 채팅을 자동으로 읽지 못하고 있어요. 주문은 손으로 넣어 주세요.',
  OPERATOR_OFF: WEB_CHAT_OFF_MESSAGE,
} as const
export const STOP_WARNING_PREFIX = '유튜브 채팅을 받지 못하고 있어요'
export const WARN_REASONS: ReadonlySet<string> = new Set(['RECONNECT', 'NOT_CONNECTED', 'NOT_MY_CHANNEL', 'QUOTA', 'CHAT_DISABLED', 'FORBIDDEN', 'CHAT_NOT_FOUND'])
export const RETRYING_WARN_MS = 10_000
export const SERVER_ROUTE_SERVER = '서버 연결로 받는 중'
export const FIRST_CHANNEL_GROUP = '처음 잇는 채널 확인'
export const RECENT_TITLE = '최근 이은 채널의 방송'
export const RECENT_AGAIN = '다시 찾기'
export const RECENT_EMPTY = '최근 이은 채널에 지금 하는 방송이 없어요. 방송 주소를 붙여 넣어 주세요.'
export const RECENT_SEARCHING = '최근 이은 채널에서 지금 방송을 찾는 중…'
export const NO_BROADCAST_TITLE = '(제목 없음)'
export const NO_CHANNEL_NAME = '(이름 없음)'
export const CHANNEL_NAME_MAX = 40
export const INVITED_CONFIRM_CODE = 'INVITED_CONFIRM_NEEDED'
/** 앱에서의 대비 경로 안내 — 휴대폰만 쓰는 판매자: 문자찜·음성·댓글 붙여넣기(웹) (D-YT-SRV-09, NFR-09) */
export const MOBILE_FALLBACK_HINT = '아래 문자찜 칸이나 음성으로 넣을 수 있어요.'
export const OFFICIAL_LINK_HINT = '유튜브 방송 잇기는 웹에서 해 주세요.'

export function channelName(title: unknown): string {
  const text = typeof title === 'string' ? title.trim() : ''
  if (text === '') return NO_CHANNEL_NAME
  const chars = Array.from(text)
  return chars.length > CHANNEL_NAME_MAX ? `${chars.slice(0, CHANNEL_NAME_MAX).join('')}…` : text
}

export const firstChannelQuestion = (name: string): string => `처음 잇는 채널이에요 (채널: ${name}). 이 방송이 맞나요?`
export const broadcastChannelLine = (name: string): string => `유튜브 방송 · ${name}`

export function linkedChannelName(link: LinkRecordView | null): string | null {
  return link === null ? null : channelName(link.broadcastChannelTitle)
}

export function recentLine(item: LiveBroadcastItem): string {
  const title = item.title.trim() === '' ? NO_BROADCAST_TITLE : item.title
  return `${channelName(item.channelTitle)} · ${title}`
}

export function webChatTrouble(collector: CollectorView | null): boolean {
  if (collector === null || collector.reason === null) return false
  if (collector.status === 'RETRYING') return collector.reason === 'BLOCKED' || collector.reason === 'FORMAT'
  return collector.status === 'STOPPED' && collector.reason === 'OPERATOR_OFF'
}

/** 콘솔 맨 위 경고 문장 (웹 collectorWarning의 message와 같다). 없으면 null */
export function warningLine(collector: CollectorView | null, retryingLong: boolean): string | null {
  if (collector === null) return null
  if (webChatTrouble(collector)) return collector.reasonMessage ?? WEB_TROUBLE_FALLBACK[collector.reason as keyof typeof WEB_TROUBLE_FALLBACK]
  const stopped = collector.status === 'STOPPED' && collector.reason !== null && WARN_REASONS.has(collector.reason)
  const retrying = collector.status === 'RETRYING' && retryingLong
  if (!stopped && !retrying) return null
  return `${STOP_WARNING_PREFIX} — ${collector.reasonMessage ?? collector.statusMessage}`
}

export type ResumeStep = { readonly trouble: boolean; readonly resumed: boolean }

export function resumeStep(previous: ResumeStep, collector: CollectorView | null): ResumeStep {
  if (webChatTrouble(collector)) return { trouble: true, resumed: false }
  if (collector === null) return { trouble: false, resumed: false }
  if (collector.status === 'LIVE') return { trouble: false, resumed: previous.resumed || previous.trouble }
  if (collector.status === 'RETRYING' || collector.status === 'STARTING') return previous
  return { trouble: false, resumed: false }
}

export function readModeOf(body: { readonly webChat?: unknown; readonly oauth?: unknown }): { readonly webChat: YoutubeWebChat | null; readonly oauth: boolean } {
  const raw = body.webChat
  const webChat = typeof raw === 'object' && raw !== null && typeof (raw as { on?: unknown }).on === 'boolean' ? { on: (raw as { on: boolean }).on } : null
  return { webChat, oauth: body.oauth !== false }
}
