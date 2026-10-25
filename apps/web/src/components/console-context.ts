// 콘솔 안의 화면 조각이 같이 쓰는 값과 동작
import type { ResendBoard } from '../lib/resend-board.ts'
import type { SaleSettings } from '@livejjim/core'
import { createContext, useContext } from 'react'
import type { ApiError } from '../api/client.ts'
import type { LabelView } from '../api/print-types.ts'
import type { WriteResult } from '../api/types.ts'
import type { BuyerNames } from '../lib/derive.ts'
import type { ScopeData } from '../lib/scope-data.ts'

/** 열린 창 (위에 쌓인다) */
export type Dialog =
  | { readonly kind: 'product'; readonly key: string }
  | {
      readonly kind: 'edit'
      readonly product: string
      readonly name: string
      readonly price: number
      readonly line: string | null
      /** 빠른 입력 줄 옆 개수 칸이 1이 아니었으면 그 개수 (AC-ORD11-08) */
      readonly stock?: number
      /** 빠른 입력칸 아래에 남겨 둔 "고칠까요?"에서 열었으면 그 번호 — 예로 마치면 지운다, 아니요면 남는다 */
      readonly ask?: number
    }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'cancelRequests' }
  | { readonly kind: 'succession' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'attention' }
  | { readonly kind: 'reason'; readonly spec: ReasonSpec }
  | { readonly kind: 'assign'; readonly spec: AssignSpec }
  | { readonly kind: 'convert'; readonly messageId: string }
  | { readonly kind: 'confirm'; readonly spec: ConfirmSpec }
  /** 감사 메시지 목록 (AC-I3-31) */
  | { readonly kind: 'outbox' }
  /** 글쓰기 권한 받으러 구글로 가기 (다시 보내기 409 NO_PERMISSION, AC-I3-34) */
  | { readonly kind: 'youtubeAuthorize'; readonly url: string }
  /** 유튜브 방송 연결 끊기 확인 (AC-I3-26) */
  | { readonly kind: 'youtubeUnlink' }
  /** 출력 멈춤·버릴 라벨 (알림 띠, AC-I1-32) */
  | { readonly kind: 'printPause' }
  | { readonly kind: 'discard' }
  /** Alt+P: 그 상품의 1등 라벨 다시 출력 (AC-I1-33) */
  | { readonly kind: 'reprint'; readonly product: string | null }
  /** 상품 목록 가져오기 (I2 AC-I2-52) */
  | { readonly kind: 'import' }
  /** 빠른 입력 줄에 붙일 "옵션 추가" (옵션 방송, D-O2-05) */
  | { readonly kind: 'options' }
  /** 상품 상세의 "옵션 고치기" (D-O2-11) */
  | { readonly kind: 'editOptions'; readonly product: string }

/** 사유를 받는 조치 (AC-S05-34) */
export interface ReasonSpec {
  readonly title: string
  /** 먼저 알릴 문장 (차단 확인·대기자 정리 등) */
  readonly warning?: string
  readonly submitLabel: string
  readonly initialReason?: string
  readonly error?: ApiError | null
  /** 빠른 사유 단추(숫자 키 포함)를 누르면 그 사유로 바로 보낸다 — 찜 취소·무효 창만 (QL3R1 D-QL3R1-05). 없으면 보내기 단추로 포커스 */
  readonly submitOnPick?: boolean
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
  readonly initial?: {
    readonly buyer?: string
    readonly replace?: string
    readonly replaceTo?: 'WAITLIST' | 'CANCEL'
    readonly reason?: string
    readonly options?: Readonly<Record<string, string>>
    readonly qty?: string
  }
  readonly error?: ApiError | null
  /** 옵션 상품: 정해진 변형 (대기자 "1등으로"·1등 "다른 사람으로 바꾸기" — 그 찜의 변형, D-O2-08) */
  readonly options?: Readonly<Record<string, string>>
}

export interface ConfirmSpec {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly onConfirm: () => Promise<void> | void
  /** 아무것도 바꾸지 않는 버튼 (처음 포커스, 기본 "닫기") */
  readonly closeLabel?: string
  /** 확인 버튼 모양 (기본 위험 — 빨강) */
  readonly tone?: 'danger' | 'primary'
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
  /**
   * 서버가 입력을 거절하면 창을 다시 연다 (사유의 휴대폰 번호 등, D-079 ⑥). 판매자가 글 칸에 치는 중이면 바로 열지 않고
   * 되돌리기 띠에 버튼(label)을 둔다 — 치던 글자를 빼앗지 않게
   */
  readonly reopen?: { readonly label: string; readonly open: (error: ApiError) => void }
  /** 보낸 뒤 결과 */
  readonly onResult?: (result: WriteResult) => void
}

export interface ConsoleApi {
  /** 연결이 돌아오면 저절로 한 번 다시 보낼 실패 목록 (D-MOB2-07 — 콘솔·문자찜 화면). 없으면 저절로 보내지 않는다 */
  readonly resend?: ResendBoard
  readonly b: string
  readonly date: string
  readonly rehearsal: boolean
  readonly ended: boolean
  /** 30일이 지나 봉인한 날짜 — 볼 수만 있다 (쓰기는 보내지 않는다, AC-I3-41) */
  readonly sealed: boolean
  readonly data: ScopeData
  /**
   * 그리기와 상관없는 지금 자료 (창이 닫힌 뒤 저절로 다시 보내기 직전에 상품의 지금 상태를 본다 — RA-MOB2-01).
   * 없으면 그 확인을 건너뛴다
   */
  readonly latest?: () => ScopeData
  readonly names: BuyerNames
  /** 라벨 키 → 서버의 라벨 상태 (실제 범위만 — 리허설·콘솔 밖 화면은 없다, AC-I1-30) */
  readonly labels?: ReadonlyMap<string, LabelView>
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
  /**
   * 바로 보내는 쓰기 — command와 같지만 응답만 기다리고, 화면이 그 seq를 따라잡는 것은 시작만 한다(기다리지 않는다).
   * 응답 바로 칸을 비우는 문자찜 입력이 쓴다(D-SMS-01, AC-SMS-02). 따라잡았는지는 data.seq로 본다
   */
  write(event: Readonly<Record<string, unknown>>, requestId?: string): Promise<WriteResult>
  /** 빠른 입력칸에 글자를 넣고 포커스 */
  fillQuick(text: string): void
  /** 현재 상품을 바꾼다 */
  select(key: string): void
  /** 옵션 방송인가 (D-O2-03 — 옵션 칸·지금 상품·확인 필요는 옵션 방송에서만) */
  readonly options?: boolean
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

const NO_LABELS: ReadonlyMap<string, LabelView> = new Map()

/** 콘솔의 라벨 상태 (없으면 빈 목록) */
export function consoleLabels(api: Pick<ConsoleApi, 'labels'>): ReadonlyMap<string, LabelView> {
  return api.labels ?? NO_LABELS
}
