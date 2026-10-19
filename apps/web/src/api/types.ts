// 서버 응답 모양 (harness/sprints/S04·S05 dev-notes의 화면 계약). 조회 항목은 코어 조회 함수 결과이고 시각 필드(at·endedAt·rankTime)만 ISO 문자열이다.
import type {
  BroadcastDetails,
  BuyerInfo,
  CancelRequestInfo,
  ClaimInfo,
  EffectInfo,
  PendingInfo,
  ProductInfo,
  SettlementInfo,
} from '@livejjim/core'

type TimeKey = 'at' | 'endedAt' | 'rankTime'

/** 코어 조회 결과의 시각 필드(UTC 밀리초)를 ISO 문자열로 바꾼 모양 (서버 withIsoTimes와 같다) */
export type IsoTimes<T> = T extends readonly (infer U)[]
  ? readonly IsoTimes<U>[]
  : T extends object
    ? { readonly [K in keyof T]: K extends TimeKey ? (null extends T[K] ? string | null : string) : IsoTimes<T[K]> }
    : T

export type BroadcastView = IsoTimes<BroadcastDetails>
export type Product = IsoTimes<ProductInfo>
export type Claim = IsoTimes<ClaimInfo>
export type PendingSlot = IsoTimes<PendingInfo>
export type Buyer = IsoTimes<BuyerInfo>
export type Settlement = IsoTimes<SettlementInfo>
export type Effect = IsoTimes<EffectInfo>
export type CancelRequest = IsoTimes<CancelRequestInfo>

export interface Attention {
  readonly seq: number
  readonly message: string
}

/** 오류 본문의 문제 하나 */
export interface ApiProblem {
  readonly field: string | null
  readonly message: string
  readonly hint?: string
}

export interface Me {
  readonly seller: { readonly name: string }
  readonly loginId: string
}

/** 방송 목록 항목 (GET /api/broadcasts) */
export interface BroadcastItem {
  readonly id: string
  readonly date: string
  readonly title: string
  readonly rehearsal: boolean
  readonly ended: boolean
  readonly endedAt: string | null
}

/** 쓰기 결과 (모든 쓰기 공통) */
export interface WriteResult {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly type: string
  readonly changed: boolean
  readonly effects: readonly string[]
  readonly broadcast?: { readonly id: string; readonly date: string; readonly title: string; readonly rehearsal: boolean }
  readonly message?: { readonly id: string; readonly channel: string }
  /** 문자찜 응답만: 정규화한 번호의 뒤 4자리 (번호가 없거나 휴대폰 번호 모양이 아니면 null) */
  readonly phoneLast4?: string | null
  /**
   * 문자찜 응답만: 그 문자찜이 정한 구매자 자신의 ID (코어 buyerOfRef — 지금의 구매자가 아니다). 정하지 못했으면 null.
   * 같은 요청 번호의 재전송도 같은 값 (AC-S06b-11, D-099)
   */
  readonly buyer?: string | null
}

/** 범위 조회의 목록 이름 (증분 조회가 같은 이름으로 덮는다) */
export const VIEW_LISTS = ['broadcasts', 'products', 'claims', 'pending', 'buyers', 'settlements', 'effects', 'cancelRequests'] as const
export type ViewList = (typeof VIEW_LISTS)[number]

export interface ViewItems {
  readonly broadcasts: readonly BroadcastView[]
  readonly products: readonly Product[]
  readonly claims: readonly Claim[]
  readonly pending: readonly PendingSlot[]
  readonly buyers: readonly Buyer[]
  readonly settlements: readonly Settlement[]
  readonly effects: readonly Effect[]
  readonly cancelRequests: readonly CancelRequest[]
}

/** 범위 전체 조회 (GET /api/days/:date) */
export interface FullView extends ViewItems {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly attention: readonly Attention[]
}

/** 채팅 메시지 한 건 (메시지 조회·증분 조회) */
export interface ChatMessage {
  readonly id: string
  readonly broadcast: string
  readonly channel: string
  readonly nick: string
  readonly text: string
  readonly owner: boolean
  readonly seq: number
  readonly at: string
  readonly publishedAt: string
  readonly ignored: boolean
  readonly order: boolean
  readonly cancel: boolean
  readonly orders: readonly number[]
  readonly cancels: readonly number[]
  readonly mentions: readonly number[]
  readonly converted: readonly number[]
  readonly claims: readonly string[]
  readonly failed: boolean
}

/** 증분 조회 (GET /api/days/:date/changes?since=N) */
export interface Changes extends ViewItems {
  readonly date: string
  readonly rehearsal: boolean
  readonly since: number
  readonly seq: number
  readonly attention: readonly Attention[]
  readonly removed: {
    readonly broadcasts: readonly string[]
    readonly products: readonly string[]
    readonly claims: readonly string[]
    readonly pending: readonly string[]
    readonly buyers: readonly string[]
    readonly settlements: readonly { readonly buyer: string; readonly date: string }[]
    readonly effects: readonly string[]
    readonly cancelRequests: readonly string[]
  }
  readonly messages: readonly ChatMessage[]
  readonly messagesMore: boolean
}

export interface MessagesView {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly messages: readonly ChatMessage[]
  readonly more: boolean
}

/** 이력 한 줄 (GET /api/days/:date/history) */
export interface HistoryItem {
  readonly seq: number
  readonly type: string
  readonly at: string
  readonly receivedAt: string
  readonly actor: { readonly kind: string; readonly loginId: string | null }
  readonly reason: string | null
  readonly fields: Readonly<Record<string, unknown>>
  readonly failed: boolean
}

/** 리허설 가짜 채팅 생성기 상태 */
export interface GeneratorStatus {
  readonly b?: string
  readonly running: boolean
  readonly sent: number
  readonly total: number
  readonly perSecond: number
  readonly seed: number | null
  readonly duplicates: number
  readonly failed: number
  readonly stopReason: 'completed' | 'stopped' | 'ended' | 'shutdown' | null
}

/** SSE 알림 */
export interface ScopeSeq {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
}
