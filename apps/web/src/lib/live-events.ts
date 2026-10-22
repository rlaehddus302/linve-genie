// 범위 저장소를 쓰지 않는 화면(설정·시작 마법사)의 실시간 알림 (AC-I3-04·13·37·92, Y1 계약 6).
// SSE `youtube`(연결·사용량 등)를 받아 넘기고, 끊겼다 다시 붙으면(두 번째 `ready`부터) 그사이 놓친 상태를 다시 받으라고 알린다.
// 브라우저가 다시 붙지 않는 닫힘(세션 만료 등)이면 조금 뒤 새로 연다. 화면이 내려가면 닫는다.
// 연결은 페이지의 실시간 연결 하나를 함께 쓴다(출력 기록·범위 저장소와 같은 연결, lib/stream.ts — 기기 ID를 밝힌다).
import { useEffect, useRef } from 'react'
import type { InstagramEvent, ScopeSeq, TikTokEvent, YoutubeEvent } from '../api/types.ts'
import type { EventSourceLike } from './console-store.ts'
import { streamUrl } from './device.ts'
import { sharedStream } from './stream.ts'

const REOPEN_MS = 2000

/** SSE `instagram`·`tiktok` 알림 (N2b-2) */
export type PlatformStreamEvent = { readonly type: 'instagram'; readonly event: InstagramEvent } | { readonly type: 'tiktok'; readonly event: TikTokEvent }

/** `instagram`·`tiktok` 알림의 data → 알림 (kind가 없으면 null) */
export function parsePlatformEvent(type: 'instagram' | 'tiktok', raw: unknown): PlatformStreamEvent | null {
  try {
    const data = JSON.parse(String(raw)) as unknown
    if (typeof data !== 'object' || data === null || typeof (data as { kind?: unknown }).kind !== 'string') return null
    return type === 'instagram' ? { type, event: data as InstagramEvent } : { type, event: data as TikTokEvent }
  } catch {
    return null
  }
}

export interface LiveHandlers {
  readonly onYoutube?: (event: YoutubeEvent) => void
  /** 인스타그램·틱톡 알림 (설정 화면) */
  readonly onPlatform?: (event: PlatformStreamEvent) => void
  /** 끊겼다 다시 붙음 — 열린 화면의 상태를 다시 받는다 (놓친 알림 따라잡기) */
  readonly onReconnect?: () => void
  /** 범위 기록이 늘었다 (SSE `change` — 확인 필요 목록이 다시 읽는다, D-O2-14) */
  readonly onChange?: (change: ScopeSeq & { readonly type: string }) => void
  /** 택배가 바뀐 묶음(`{ date, buyer }`)·택배 설정(`{ settings: true }`) (SSE `parcel` — T1 택배 화면이 다시 읽는다) */
  readonly onParcel?: (event: { readonly date?: string; readonly buyer?: string; readonly settings?: boolean }) => void
  /** 포장 기록이 바뀐 묶음 (SSE `packing` `{ date, buyer }`) */
  readonly onPacking?: (event: { readonly date: string; readonly buyer?: string }) => void
}

export function parseYoutubeEvent(raw: unknown): YoutubeEvent | null {
  try {
    const data = JSON.parse(String(raw)) as unknown
    if (typeof data !== 'object' || data === null || typeof (data as { kind?: unknown }).kind !== 'string') return null
    return data as YoutubeEvent
  } catch {
    return null
  }
}

function parseObject(raw: unknown): Record<string, unknown> | null {
  try {
    const data = JSON.parse(String(raw)) as unknown
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export class LiveEvents {
  readonly #open: (url: string) => EventSourceLike
  readonly #handlers: () => LiveHandlers
  #stream: EventSourceLike | null = null
  #timer: ReturnType<typeof setTimeout> | undefined
  #ready = 0
  #stopped = false

  constructor(handlers: () => LiveHandlers, open: (url: string) => EventSourceLike = () => sharedStream(streamUrl).open()) {
    this.#handlers = handlers
    this.#open = open
  }

  start(): void {
    if (this.#stopped || this.#stream !== null) return
    const stream = this.#open('/api/stream')
    this.#stream = stream
    stream.addEventListener('ready', () => {
      this.#ready++
      if (this.#ready > 1) this.#handlers().onReconnect?.()
    })
    stream.addEventListener('youtube', (event) => {
      const data = parseYoutubeEvent(event.data)
      if (data !== null) this.#handlers().onYoutube?.(data)
    })
    stream.addEventListener('change', (event) => {
      const handler = this.#handlers().onChange
      if (handler === undefined) return
      try {
        const data = JSON.parse(String(event.data)) as ScopeSeq & { type: string }
        if (typeof data === 'object' && data !== null && typeof data.date === 'string') handler(data)
      } catch {
        // 읽지 못한 알림은 버린다 (다음 알림·다시 붙을 때 다시 읽는다)
      }
    })
    for (const type of ['instagram', 'tiktok'] as const) {
      stream.addEventListener(type, (event) => {
        const data = parsePlatformEvent(type, event.data)
        if (data !== null) this.#handlers().onPlatform?.(data)
      })
    }
    stream.addEventListener('parcel', (event) => {
      const handler = this.#handlers().onParcel
      if (handler === undefined) return
      const data = parseObject(event.data)
      if (data !== null) handler({ ...(typeof data.date === 'string' ? { date: data.date } : {}), ...(typeof data.buyer === 'string' ? { buyer: data.buyer } : {}), ...(data.settings === true ? { settings: true } : {}) })
    })
    stream.addEventListener('packing', (event) => {
      const handler = this.#handlers().onPacking
      if (handler === undefined) return
      const data = parseObject(event.data)
      if (data !== null && typeof data.date === 'string') handler({ date: data.date, ...(typeof data.buyer === 'string' ? { buyer: data.buyer } : {}) })
    })
    stream.onerror = () => {
      if (this.#stopped || this.#stream !== stream || stream.readyState !== 2) return
      stream.close()
      this.#stream = null
      this.#timer = setTimeout(() => this.start(), REOPEN_MS)
    }
  }

  stop(): void {
    this.#stopped = true
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#stream?.close()
    this.#stream = null
  }
}

/** 화면이 열린 동안 실시간 알림을 받는다 (처리기는 늘 최신 것을 부른다) */
export function useLiveEvents(handlers: LiveHandlers, enabled = true): void {
  const ref = useRef(handlers)
  ref.current = handlers
  useEffect(() => {
    if (!enabled) return
    const live = new LiveEvents(() => ref.current)
    live.start()
    return () => live.stop()
  }, [enabled])
}
