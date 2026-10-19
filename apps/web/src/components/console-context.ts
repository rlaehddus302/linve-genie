// 콘솔 안의 화면 조각이 같이 쓰는 값과 동작
import type { SaleSettings } from '@livejjim/core'
import { createContext, useContext } from 'react'
import type { ApiError } from '../api/client.ts'
import type { WriteResult } from '../api/types.ts'
import type { BuyerNames } from '../lib/derive.ts'
import type { ScopeData } from '../lib/scope-data.ts'

/** 열린 창 (위에 쌓인다) */
export type Dialog =
  | { readonly kind: 'product'; readonly key: string }
  | { readonly kind: 'edit'; readonly product: string; readonly name: string; readonly price: number; readonly line: string | null }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'cancelRequests' }
  | { readonly kind: 'succession' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'attention' }
  | { readonly kind: 'reason'; readonly spec: ReasonSpec }
  | { readonly kind: 'assign'; readonly spec: AssignSpec }
  | { readonly kind: 'convert'; readonly messageId: string }
  | { readonly kind: 'confirm'; readonly spec: ConfirmSpec }

/** 사유를 받는 조치 (AC-S05-34) */
export interface ReasonSpec {
  readonly title: string
  /** 먼저 알릴 문장 (차단 확인·대기자 정리 등) */
  readonly warning?: string
  readonly submitLabel: string
  readonly initialReason?: string
  readonly error?: ApiError | null
  /** 사유를 받아 5초 대기 조치를 넣는다 */
  readonly onSubmit: (reason: string) => void
}

/** 직접 배정·교체 (AC-S05-34, R-9) */
export interface AssignSpec {
  readonly product: string
  /** 정해진 구매자 (대기자 "1등으로"), 없으면 고른다 */
  readonly buyer?: string
  /** 정해진 교체 대상 (1등의 "다른 사람으로 바꾸기") */
  readonly replace?: string
  readonly initial?: { readonly buyer?: string; readonly replace?: string; readonly replaceTo?: 'WAITLIST' | 'CANCEL'; readonly reason?: string }
  readonly error?: ApiError | null
}

export interface ConfirmSpec {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly onConfirm: () => Promise<void> | void
}

/** 5초 뒤에 보내는 방송자 조치 */
export interface HostActionInput {
  /** "15번 홍길동 취소" */
  readonly label: string
  /** 엔진 이벤트 필드 (type 포함, requestId 제외) */
  readonly event: Readonly<Record<string, unknown>>
  readonly claims?: readonly string[]
  readonly products?: readonly string[]
  /** 메시지 → 찜이면 그 메시지 ID (메시지 옆에 진행을 보인다) */
  readonly message?: string
  /** 서버가 거절하면 창을 다시 연다 (사유의 휴대폰 번호 등, D-079 ⑥) */
  readonly reopen?: (error: ApiError) => void
  /** 보낸 뒤 결과 */
  readonly onResult?: (result: WriteResult) => void
}

export interface ConsoleApi {
  readonly b: string
  readonly date: string
  readonly rehearsal: boolean
  readonly ended: boolean
  readonly data: ScopeData
  readonly names: BuyerNames
  /** 보내기 전(5초 대기 중)인 찜 ID·상품 키 */
  readonly waiting: { readonly claims: ReadonlySet<string>; readonly products: ReadonlySet<string> }
  readonly delayMs: number
  settingsOf(b: string): SaleSettings | null
  openDialog(dialog: Dialog): void
  closeTop(): void
  closeAll(): void
  queueHost(input: HostActionInput): void
  /**
   * 바로 보내는 쓰기 (상품 명령) — 같은 요청 번호로 재시도, 응답 seq까지 따라잡은 뒤 돌아온다.
   * requestId를 주면 그 번호로 보낸다(실패 뒤 "다시 보내기")
   */
  command(event: Readonly<Record<string, unknown>>, requestId?: string): Promise<WriteResult>
  /** 빠른 입력칸에 글자를 넣고 포커스 */
  fillQuick(text: string): void
  /** 현재 상품을 바꾼다 */
  select(key: string): void
}

export const ConsoleContext = createContext<ConsoleApi | null>(null)

export function useConsoleApi(): ConsoleApi {
  const api = useContext(ConsoleContext)
  if (api === null) throw new Error('콘솔 밖에서 쓸 수 없다')
  return api
}

/** "15번" 또는 다른 방송이면 "2부 15번" */
export function productLabel(api: Pick<ConsoleApi, 'b' | 'data'>, broadcast: string, no: number): string {
  if (broadcast === api.b) return `${String(no)}번`
  const title = api.data.broadcasts.get(broadcast)?.title
  return title === undefined ? `${String(no)}번` : `${title} ${String(no)}번`
}
