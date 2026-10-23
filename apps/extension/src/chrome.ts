// 확장이 쓰는 크롬 API의 모양 (필요한 것만). 권한은 storage 하나 — tabs·webRequest·cookies는 쓰지 않는다(D-X1-14).
export interface MessageSender {
  readonly tab?: { readonly id?: number }
  readonly id?: string
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
    readonly local: {
      get(keys: string[]): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
      remove(keys: string[]): Promise<void>
    }
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
