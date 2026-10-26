// 확장이 쓰는 크롬 API의 모양 (필요한 것만). 권한은 storage 하나 — tabs·webRequest·cookies는 쓰지 않는다(D-X1-14).
/** 서비스 워커 → content script: "지금 상태를 보내 달라" (팝업을 열었는데 워커가 막 깨어나 프레임을 모를 때) */
export const ASK_STATUS = 'livegenieAskStatus'

export interface MessageSender {
  /** url은 host 권한이 있는 탭(youtube.com)만 크롬이 채운다 — 시청 페이지 주소에서 영상 ID를 꺼낼 때 쓴다 */
  readonly tab?: { readonly id?: number; readonly url?: string }
  /** 탭 안 프레임 번호 (0 = 맨 위 문서, 시청 페이지 안 채팅 iframe은 다른 수) */
  readonly frameId?: number
  /** 문서 번호 (크롬 106+) — 같은 iframe이 새 주소로 다시 열리면 바뀐다 */
  readonly documentId?: string
  readonly id?: string
  /** 보낸 곳 주소 (팝업이면 chrome-extension://<id>/popup.html, content script면 유튜브 주소) */
  readonly url?: string
}

export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string[]): Promise<void>
}

export interface ChromeLike {
  readonly runtime: {
    readonly id: string
    sendMessage(message: unknown): Promise<unknown>
    readonly onMessage: {
      addListener(listener: (message: unknown, sender: MessageSender, respond: (response: unknown) => void) => boolean | undefined): void
    }
  }
  readonly storage: {
    /** 디스크 — 토큰만 (채팅 내용은 두지 않는다) */
    readonly local: StorageArea
    /** 브라우저를 닫으면 지워지는 곳 — 못 보낸 채팅 (D-X1-27). 확장 페이지·워커만 읽는다(content script는 못 읽는 기본값) */
    readonly session: StorageArea
  }
  /** 탭 API (권한 없이 쓰는 것만: youtube.com host 권한으로 그 탭만 찾고, content script에 묻는다). 시험 가짜에는 없을 수 있다 */
  readonly tabs?: {
    query(info: { url: string | string[] }): Promise<readonly { readonly id?: number }[]>
    sendMessage(tabId: number, message: unknown): Promise<unknown>
  }
  readonly action: {
    setBadgeText(details: { text: string }): Promise<void>
    setBadgeBackgroundColor(details: { color: string }): Promise<void>
    setTitle(details: { title: string }): Promise<void>
  }
}

export function chromeApi(): ChromeLike {
  return (globalThis as unknown as { chrome: ChromeLike }).chrome
}
