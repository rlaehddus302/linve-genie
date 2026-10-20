// 범위 저장소를 쓰지 않는 화면(설정·시작 마법사)의 실시간 알림 (AC-I3-04·13·37·92, Y1 계약 6).
// SSE `youtube`(연결·사용량 등)를 받아 넘기고, 끊겼다 다시 붙으면(두 번째 `ready`부터) 그사이 놓친 상태를 다시 받으라고 알린다.
// 브라우저가 다시 붙지 않는 닫힘(세션 만료 등)이면 조금 뒤 새로 연다. 화면이 내려가면 닫는다.
// 연결은 페이지의 실시간 연결 하나를 함께 쓴다(출력 기록·범위 저장소와 같은 연결, lib/stream.ts — 기기 ID를 밝힌다).
import { useEffect, useRef } from 'react'
import type { YoutubeEvent } from '../api/types.ts'
import type { EventSourceLike } from './console-store.ts'
import { streamUrl } from './device.ts'
import { sharedStream } from './stream.ts'

const REOPEN_MS = 2000

export interface LiveHandlers {
  readonly onYoutube?: (event: YoutubeEvent) => void
  /** 끊겼다 다시 붙음 — 열린 화면의 상태를 다시 받는다 (놓친 알림 따라잡기) */
  readonly onReconnect?: () => void
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
