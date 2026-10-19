// 골든 러너의 공개 타입. 러너는 코어를 이 인터페이스(GoldenCore)로만 부른다.
// 실제 코어는 core-adapter.ts가 이 모양으로 감싸고, 러너 자체 테스트는 가짜 코어를 넣는다.
import type { SettingsOverride } from '@livejjim/core'
import type { ClaimStatus, EffectKind, PaymentStatus, ProductStatus, RejectReason, SuiteName, Target } from './contract.ts'

// ── 코어 → 러너 ──────────────────────────────────────────────────────────

/** 파서 suite별 호출. 결과는 러너가 README 규칙으로 비교한다(형식이 틀리면 불일치). */
export interface GoldenParserCore {
  chat(text: string, settings: SettingsOverride): unknown
  amount(text: string, settings: SettingsOverride): unknown
  koreanNumber(text: string): unknown
  quickInput(text: string, settings: SettingsOverride): unknown
}

export interface GoldenBroadcast {
  readonly id: string
  readonly date: string
  readonly title: string
}

export interface GoldenSetup {
  readonly broadcasts: readonly GoldenBroadcast[]
  /** 시나리오 settings 그대로(점 표기). 빠진 키는 코어가 DOMAIN_RULES 기본값을 쓴다. */
  readonly settings: SettingsOverride
}

/**
 * 러너가 엔진에 넘기는 이벤트 (README "이벤트 종류와 필드" + 변환 규칙).
 * - `seq`: `assert`를 뺀 1부터의 순번. 재수신 사본도 자기 seq를 받는다.
 * - `at`: UTC 밀리초. chat의 `publishedAt`도 UTC 밀리초(없으면 at과 같음).
 * - `received`(sms): 원문 그대로(`HH:MM` 또는 `HH:MM:SS`). 날짜 해석은 코어(D-023, S03).
 * - 그 밖의 필드는 YAML에 적힌 값 그대로.
 */
export interface GoldenEvent {
  readonly seq: number
  readonly at: number
  readonly type: string
  readonly [field: string]: unknown
}

export interface GoldenApplyResult {
  readonly state: unknown
  readonly effects: readonly unknown[]
}

export interface InvariantViolation {
  readonly id: string
  readonly message: string
}

/** 엔진 호출. 상태는 직렬화 가능한 순수 데이터여야 한다(결정성 검사에서 직렬화한다). */
export interface GoldenEngineCore {
  start(setup: GoldenSetup): unknown
  apply(state: unknown, event: GoldenEvent): GoldenApplyResult
  /** 현재 상태를 골든 expect로 비교할 수 있는 모양으로 보여 준다. */
  observe(state: unknown): GoldenSnapshot
  /** 불변식 INV-1~12 검사 자리 (S02에서 붙인다). 위반은 불일치로 센다. */
  invariants?(state: unknown, snapshot: GoldenSnapshot): readonly InvariantViolation[]
}

export interface GoldenCore {
  readonly parser: GoldenParserCore
  readonly engine: GoldenEngineCore
}

// ── 관찰 스냅샷 (expect 비교 대상) ───────────────────────────────────────
// 구매자는 모두 "지금의 구매자 ID"로 적는다. 골든의 구매자 키(채널 ID, sms:<ref>)는 buyerKeys로 푼다.

export interface ProductView {
  readonly status: ProductStatus
  /** 확정 구매자 ID (재고 1이면 0~1명) */
  readonly winners: readonly string[]
  /** 대기 구매자 ID, 1순위부터 */
  readonly waitlist: readonly string[]
  readonly conflict: boolean
  readonly price: number
  readonly priceHistory: readonly { readonly from: number; readonly to: number }[]
}

export interface BuyerView {
  readonly display: string
  readonly nameHistory: readonly string[]
  /** 확정 찜의 상품 키 */
  readonly items: readonly string[]
  readonly subtotal: number
  readonly byBroadcast: Readonly<Record<string, number>>
  /** 이 구매자 자신의 전화번호 뒤 4자리 (숫자 4자리 문자열, 없으면 null — S03b, D-061) */
  readonly phoneLast4: string | null
}

export interface SettlementView {
  readonly subtotal: number
  readonly shipping: number
  readonly adjustments: number
  readonly total: number
  readonly refundDue: number
  readonly payment: PaymentStatus
}

export type EffectStatus = 'PENDING' | 'DONE' | 'CANCELLED' | 'SKIPPED'

export interface EffectView {
  readonly kind: EffectKind
  /** PENDING = 아직 실행 대상, DONE = 실행 완료 보고됨, CANCELLED·SKIPPED = 실행 대상 아님 */
  readonly status: EffectStatus
  readonly target?: Target
  readonly product?: string
  readonly buyer?: string
  readonly text?: string
  readonly confirmVersion?: number
}

export interface ClaimView {
  /** 지금의 상품 키(번호 변경 반영). 보류 찜은 상품이 없어도 된다. */
  readonly product: string
  readonly buyer: string
  readonly status: ClaimStatus
  readonly reason?: RejectReason
}

export interface GoldenSnapshot {
  /** 구매자 키 → 지금의 구매자 ID (합치기·전화번호 연결 반영) */
  readonly buyerKeys: Readonly<Record<string, string>>
  /** 지금의 상품 키 `<방송>/<번호>` → 상품 */
  readonly products: Readonly<Record<string, ProductView>>
  /** 구매자 ID → 구매자 */
  readonly buyers: Readonly<Record<string, BuyerView>>
  /** `<구매자 ID>@<YYYY-MM-DD>` → 정산 묶음. 없는 묶음은 품목 없는 묶음(금액 0, UNPAID)으로 본다. */
  readonly settlements: Readonly<Record<string, SettlementView>>
  /** 지금까지 나온 효과 전부(실행·취소 여부 무관) */
  readonly effects: readonly EffectView[]
  /** 생성된 찜 전부, 생성 순서. claimCount = 길이 */
  readonly claims: readonly ClaimView[]
  /** 상품 키 → 보류 찜 구매자 ID (판정 순위 순) */
  readonly pending: Readonly<Record<string, readonly string[]>>
  readonly cancelRequests: readonly { readonly product: string; readonly buyer: string }[]
}

// ── 러너 → 사용자 ────────────────────────────────────────────────────────

export type ItemStatus = 'pass' | 'mismatch' | 'not-implemented' | 'determinism' | 'runner-error'

export interface Problem {
  /** 중간 검사면 `events[n]`, 결정성 위반이면 처음 달라진 지점 */
  readonly where?: string
  /** expect 경로 (예: `products.b1/15.winner`) */
  readonly path?: string
  readonly expected?: unknown
  readonly actual?: unknown
  readonly message?: string
}

interface ItemBase {
  readonly file: string
  readonly docIndex: number
  readonly status: ItemStatus
  /** 미구현일 때 허용 목록에 있었는지 */
  readonly allowed: boolean
  /** 허용 목록에 들어 있는지 (상태와 무관) */
  readonly listed: boolean
  readonly problems: readonly Problem[]
}

export interface ParserItemResult extends ItemBase {
  readonly kind: 'parser'
  readonly suite: SuiteName
  readonly caseIndex: number
  readonly input: string
}

export interface ScenarioItemResult extends ItemBase {
  readonly kind: 'scenario'
  readonly id: string
  readonly title: string
}

export type ItemResult = ParserItemResult | ScenarioItemResult

export interface ReadError {
  /** 파일 경로 (허용 목록 오류면 그 파일) */
  readonly file: string
  /** 문서 번호(1부터). 파일 전체 오류면 없음 */
  readonly docIndex?: number
  /** 시나리오 ID 또는 suite 이름 */
  readonly label?: string
  readonly issues: readonly ReadIssue[]
}

export interface ReadIssue {
  /** 문서 안 경로 (예: `events[3].at`) */
  readonly path?: string
  readonly line?: number
  readonly message: string
}

export interface FileSummary {
  readonly file: string
  readonly parserCases: number
  readonly scenarios: number
  readonly readErrors: number
}

export interface GoldenTotals {
  readonly files: number
  readonly parserCases: number
  readonly scenarios: number
  readonly pass: number
  readonly mismatch: number
  readonly notImplementedAllowed: number
  readonly notImplementedDisallowed: number
  readonly readError: number
  readonly determinism: number
  readonly runnerError: number
}

export interface GoldenReport {
  readonly goldenLabel: string
  readonly allowlist: { readonly file: string; readonly present: boolean; readonly sprint?: string }
  readonly files: readonly FileSummary[]
  readonly readErrors: readonly ReadError[]
  readonly items: readonly ItemResult[]
  readonly warnings: readonly string[]
  readonly totals: GoldenTotals
  /** 실패가 하나도 없으면 true (경고는 실패가 아니다) */
  readonly ok: boolean
}
