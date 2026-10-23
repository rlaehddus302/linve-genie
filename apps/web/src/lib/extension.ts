// 크롬 확장 화면 낱말·판단 (X1 YT-10 AC4·AC7·AC8, D-X1-11·12). 서버 상태 값(영어)은 여기서만 보고 화면엔 문장만 보인다.
import type { CollectorView, ExtensionView } from '../api/types.ts'

export const EXTENSION_ROUTE = {
  OFFICIAL: '공식 연결로 받는 중',
  EXTENSION: '확장으로 받는 중',
  BOTH: '공식 연결·확장 둘 다로 받는 중',
} as const

export const EXTENSION_INTRO = '유튜브 공식 연결이 안 될 때를 위한 보조 방법이에요. PC 크롬에 라이브지니 확장을 깔고 아래 코드를 넣으면, 확장이 내 유튜브 라이브 채팅을 읽어 보내요. 확장은 읽기만 하고, 감사 메시지는 공식 연결로만 보내요.'
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
    return data as ExtensionView
  } catch {
    return null
  }
}
