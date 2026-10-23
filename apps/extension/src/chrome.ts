// 확장이 쓰는 크롬 API의 모양 (필요한 것만). 권한은 storage 하나 — tabs·webRequest·cookies는 쓰지 않는다(D-X1-14).
export interface MessageSender {
  readonly tab?: { readonly id?: number }
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
  readonly action: {
    setBadgeText(details: { text: string }): Promise<void>
    setBadgeBackgroundColor(details: { color: string }): Promise<void>
    setTitle(details: { title: string }): Promise<void>
  }
}

export function chromeApi(): ChromeLike {
  return (globalThis as unknown as { chrome: ChromeLike }).chrome
}
