// 방송 화면을 나가도 듣는 방송 하나 (D-UX3-48). 화면 부품은 StreamAudio.tsx의 KeptStreamAudio.
import type { StreamAudio } from '../screens/console/StreamAudio.tsx'
import { ListenSourceStore } from './listen-source.ts'

/** 방송 화면을 나가도 듣는 방송 (D-UX3-48, 사용자 지시 2026-11-06 "나가도 계속 듣게") — 앱 전체에 하나, 앱 뿌리(KeptStreamAudio)가 듣기를 붙잡는다 */
export class StreamKeep {
  #kept: { readonly broadcastId: string; readonly title: string } | null = null
  #audio: { readonly broadcastId: string; readonly stream: StreamAudio } | null = null
  readonly #listeners = new Set<() => void>()
  /** 판매자가 고른 듣는 곳 (D-RETRO-70) — 듣기를 붙잡는 앱 뿌리와 화면들이 같이 본다 */
  readonly listen = new ListenSourceStore()
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  #emit(): void { for (const listener of [...this.#listeners]) listener() }
  getKept = (): { readonly broadcastId: string; readonly title: string } | null => this.#kept
  getAudio = (): { readonly broadcastId: string; readonly stream: StreamAudio } | null => this.#audio
  /** 방송 중인 방송 화면이 열렸다 — 이 방송을 듣는다(다른 방송을 듣던 중이면 바꾼다) */
  keep(broadcastId: string, title: string): void {
    if (this.#kept?.broadcastId === broadcastId && this.#kept.title === title) return
    if (this.#kept?.broadcastId !== broadcastId) this.#audio = null
    this.#kept = { broadcastId, title }
    this.#emit()
  }
  /** 방송이 끝났다·로그아웃 — 그 방송 듣기를 놓는다 */
  release(broadcastId?: string): void {
    // 로그아웃(방송을 가리지 않고 놓음)이면 고른 듣는 곳도 잊는다 — 다른 계정에 남지 않게
    if (broadcastId === undefined) this.listen.reset()
    if (this.#kept === null || (broadcastId !== undefined && this.#kept.broadcastId !== broadcastId)) return
    this.#kept = null
    this.#audio = null
    this.#emit()
  }
  publish(broadcastId: string, stream: StreamAudio): void {
    if (this.#kept?.broadcastId !== broadcastId) return
    this.#audio = { broadcastId, stream }
    this.#emit()
  }
}
