// TTX 적대 시험 도우미 (test-domain): 확장 틱톡 대기열(apps/extension/src/tiktok-outbox.ts)을 불러오는 경계 (SA-TTX-01).
//
// 확장 소스는 브라우저 타입(Document·Element·MutationObserver — reader.ts·tiktok-reader.ts)을 쓴다. 루트 설정(tsconfig.json)은
// Node 타입만 쓰고, 여기에 DOM 타입을 더하면 서버 소스(Response 본문 등)와 부딪친다. 그래서 정적 import로 확장 소스를 끌어오지 않고
// 문자열 변수 경로로 동적으로 불러온다 — tsc는 따라가지 않고, vitest는 같은 파일을 그대로 불러 돌린다.
// 확장 소스의 타입 검사는 apps/extension/tsconfig.json(DOM 포함)이 맡는다. 여기 타입은 시험이 쓰는 모양만 적은 것이고,
// 실제 모듈이 이 모양과 다르면 loadOutbox()가 바로 실패한다(내보낸 이름·값 검사).
import type { Api, ApiResult } from '../../../apps/extension/src/api.ts'

export type { Api, ApiResult }

/** apps/extension/src/outbox.ts Timers와 같은 모양 */
export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

/** apps/extension/src/tiktok-reader.ts TikTokItem과 같은 모양 */
export interface TikTokItem {
  readonly commentId: string
  readonly userId: string
  readonly uniqueId: string
  readonly nickname: string
  readonly text: string
}

export interface TikTokHeld {
  readonly tab: number | null
  readonly pageId: string
  readonly item: TikTokItem
}

export interface TikTokOutboxSnapshot {
  readonly items: readonly TikTokHeld[]
  readonly dropped: number
  readonly unreported?: number
}

export interface TikTokDroppedReport {
  readonly count: number
  readonly epoch: number
}

export type TikTokOutboxEvent =
  | { readonly kind: 'sent'; readonly result: 'recorded' | 'standby' }
  | { readonly kind: 'blocked'; readonly code: string }
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'failing'; readonly message: string | null }

export interface TikTokOutbox {
  snapshot(): TikTokOutboxSnapshot
  readonly size: number
  readonly dropped: number
  readonly unreported: number
  takeDropped(): TikTokDroppedReport
  settleDropped(report: TikTokDroppedReport, accepted: boolean): void
  restore(snapshot: TikTokOutboxSnapshot): void
  add(tab: number | null, pageId: string, items: readonly TikTokItem[]): void
  dropTab(tab: number | null): void
  stop(): void
  resume(): void
  flush(): Promise<void>
}

export interface OutboxModule {
  readonly TT_BATCH_MAX: number
  readonly TT_HOLD_MAX: number
  readonly TT_DROPPED_REPORT_MAX: number
  readonly TikTokOutbox: new (
    api: Api,
    timers: Timers,
    onEvent: (event: TikTokOutboxEvent) => void,
    onChange?: (snapshot: TikTokOutboxSnapshot) => void,
  ) => TikTokOutbox
}

/** 문자열 변수라서 tsc가 따라가지 않는다 (위 설명) */
const OUTBOX_PATH: string = '../../../apps/extension/src/tiktok-outbox.ts'

export async function loadOutbox(): Promise<OutboxModule> {
  const mod = (await import(/* @vite-ignore */ OUTBOX_PATH)) as Record<string, unknown>
  for (const name of ['TT_BATCH_MAX', 'TT_HOLD_MAX', 'TT_DROPPED_REPORT_MAX']) {
    if (!Number.isSafeInteger(mod[name])) throw new Error(`확장 대기열 모듈에 ${name} 값이 없다`)
  }
  const ctor = mod['TikTokOutbox']
  if (typeof ctor !== 'function') throw new Error('확장 대기열 모듈에 TikTokOutbox가 없다')
  for (const method of ['snapshot', 'takeDropped', 'settleDropped', 'restore', 'add', 'dropTab', 'stop', 'resume', 'flush']) {
    if (typeof (ctor as { prototype: Record<string, unknown> }).prototype[method] !== 'function') throw new Error(`TikTokOutbox.${method}가 없다`)
  }
  return mod as unknown as OutboxModule
}
