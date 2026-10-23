// 크롬 확장 화면 낱말·판단 (X1 YT-10 AC4·AC7·AC8, D-X1-11·12). 서버 상태 값(영어)은 여기서만 보고 화면엔 문장만 보인다.
import type { CollectorView, ExtensionThanksWarning, ExtensionView } from '../api/types.ts'

export const EXTENSION_ROUTE = {
  OFFICIAL: '공식 연결로 받는 중',
  EXTENSION: '확장으로 받는 중',
  BOTH: '공식 연결·확장 둘 다로 받는 중',
} as const

export const EXTENSION_INTRO = '유튜브 공식 연결이 안 될 때를 위한 보조 방법이에요. PC 크롬에 라이브지니 확장을 깔고 아래 코드를 넣으면, 확장이 내 유튜브 라이브 채팅을 읽어 보내요. 감사 채팅은 아래 "확장으로 감사 채팅 올리기"를 켠 경우에만 확장으로도 올려요.'

// ── 확장으로 감사 채팅 올리기 (AC11~AC17, D-X1-17~24) ──
export const EXTENSION_THANKS_TITLE = '확장으로 감사 채팅 올리기'
export const EXTENSION_THANKS_HELP = '유튜브 공식 연결로 감사 글을 올릴 수 없을 때, 확장이 판매자님이 로그인한 유튜브 채팅 창에 감사 글을 대신 올려요. 공식 연결로 올릴 수 있으면 공식 연결로만 올려요.'
export const EXTENSION_THANKS_ON = '켜져 있어요. 유튜브 채팅 창을 방송 채널 계정으로 로그인해 열어 두세요.'
export const EXTENSION_THANKS_OFF = '꺼져 있어요. 확장은 채팅을 읽기만 해요.'
export const EXTENSION_THANKS_NEEDS_CONSENT = '감사 글이 나가려면 위 "감사 메시지"의 "실시간 채팅 자동 게시"도 켜져 있어야 해요(유튜브 연결 필요).'
/** 켤 때 설명 창 (SPEC YT-10 AC11 문장) */
export const EXTENSION_THANKS_QUESTION = '판매자님 유튜브 계정으로 채팅에 감사 글을 올려요. 유튜브가 자동 글쓰기를 막을 수 있어요.'
export const EXTENSION_THANKS_RULES = [
  '라이브지니가 만든 감사 글만 올려요. 여러 건이면 한 글로 묶고, 글 사이는 3초 넘게 띄워요.',
  '판매자님이 채팅 칸에 글을 쓰는 중이면 기다렸다가 올려요. 쓰던 글은 지우지 않아요.',
  '방송 채널 계정으로 로그인한 채팅 창에서만 올려요.',
  '3번 연달아 못 올리면 멈추고 방송 화면에 알려요.',
] as const
export const EXTENSION_THANKS_PAUSED_HINT = '못 올린 감사는 유튜브 칸의 감사 메시지 목록에서 확인해 주세요. 다시 해 보려면 "다시 켜기"를 눌러 주세요.'
export const EXTENSION_THANKS_OWNER_HINT = '유튜브 채팅 창에서 방송 채널 계정으로 로그인해 주세요.'
export const EXTENSION_THANKS_VIA = '크롬 확장으로'

/** 이 방송의 감사 올리기 경고 (끝난 방송·꺼짐이면 없음) */
export function thanksWarnings(view: ExtensionView | null, broadcastId: string): readonly ExtensionThanksWarning[] {
  if (view === null || !view.connected || view.thanks === undefined || !view.thanks.enabled) return []
  return view.thanks.warnings.filter((warning) => warning.broadcast === broadcastId)
}
export const EXTENSION_CODE_HELP = '확장 아이콘을 눌러 이 코드를 넣어 주세요. 10분 안에 한 번만 쓸 수 있어요.'
export const EXTENSION_CODE_EXPIRED = '코드 시간이 지났어요. "새 코드 받기"를 눌러 주세요.'
export const EXTENSION_RENEW_QUESTION = '지금 연결된 확장은 바로 끊기고 새 코드가 나와요. 확장에 새 코드를 넣어야 다시 받아요.'
export const EXTENSION_DISCONNECT_QUESTION = '끊으면 확장이 보내는 채팅을 더 받지 않아요. 이미 받은 찜은 그대로예요.'
export const EXTENSION_DROPPED = '확장에서 놓친 채팅이 있어요. 놓친 주문은 손으로 넣어 주세요.'

/** 8자리 코드를 읽기 쉽게 "1234 5678" */
export function codeWords(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code
}

/** 경고 상태인가 (오지 않음·숨은 탭·읽지 못함) */
export function extensionWarning(view: ExtensionView | null): boolean {
  return view !== null && view.connected && (view.state === 'STALE' || view.state === 'HIDDEN' || view.state === 'UNREADABLE')
}

/** 이 방송을 확장으로 받는 중인가 */
export function extensionReceiving(view: ExtensionView | null, broadcastId: string): boolean {
  return view !== null && view.connected && view.state === 'RECEIVING' && view.broadcasts.includes(broadcastId)
}

/** 이 방송에 확장이 이어져 있는가 (경고를 이 방송 콘솔에 보일지) */
export function extensionOnBroadcast(view: ExtensionView | null, broadcastId: string): boolean {
  return view !== null && view.connected && view.broadcasts.includes(broadcastId)
}

/** 콘솔 유튜브 칸의 받는 경로 한 줄 (AC8). 둘 다 아니면 null */
export function routeWords(collector: CollectorView | null, view: ExtensionView | null, broadcastId: string): string | null {
  const official = collector !== null && collector.status === 'LIVE'
  const extension = extensionReceiving(view, broadcastId)
  if (official && extension) return EXTENSION_ROUTE.BOTH
  if (official) return EXTENSION_ROUTE.OFFICIAL
  if (extension) return EXTENSION_ROUTE.EXTENSION
  return null
}

/** SSE `extension` data → 상태 (모양이 틀리면 null) */
export function parseExtensionEvent(raw: unknown): ExtensionView | null {
  try {
    const data = JSON.parse(String(raw)) as unknown
    if (typeof data !== 'object' || data === null) return null
    const view = data as Partial<ExtensionView>
    if (typeof view.connected !== 'boolean' || typeof view.state !== 'string' || !Array.isArray(view.broadcasts)) return null
    if (view.thanks !== undefined && (typeof view.thanks !== 'object' || view.thanks === null || typeof view.thanks.enabled !== 'boolean' || !Array.isArray(view.thanks.warnings))) return null
    return data as ExtensionView
  } catch {
    return null
  }
}
