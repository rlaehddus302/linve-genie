import { NotImplementedError } from './not-implemented.ts'
import type { SettingsOverride } from './settings.ts'

/** 방송(회차). 상품 번호는 방송 안에서 유일하다 (R-0). */
export interface BroadcastInfo {
  readonly id: string
  /** 방송 날짜 YYYY-MM-DD (KST). 정산 묶음 날짜가 된다 (R-12). */
  readonly date: string
  readonly title: string
}

export interface EngineSetup {
  readonly broadcasts: readonly BroadcastInfo[]
  /** 시작 시점 스냅샷으로 모든 방송에 적용할 설정 (DOMAIN_RULES 기본값 위에 덮어쓴다) */
  readonly settings: SettingsOverride
}

/**
 * 엔진 입력 이벤트 (R-1). 형태는 S02에서 확정한다.
 * - `seq`: 서버 일련번호(1부터), `at`: 서버 도착 시각(UTC 밀리초). 코어는 시계를 읽지 않는다.
 */
export interface EngineEvent {
  readonly seq: number
  readonly at: number
  readonly type: string
  readonly [field: string]: unknown
}

/** 직렬화 가능한 순수 데이터. 형태는 S02에서 확정한다. */
export type EngineState = Readonly<Record<string, unknown>>

export interface ApplyResult {
  readonly state: EngineState
  readonly effects: readonly unknown[]
}

/** 새 엔진 상태. S02에서 구현한다. */
export function initEngine(_setup: EngineSetup): EngineState {
  throw new NotImplementedError('판정 엔진(initEngine)')
}

/** apply(state, event) → { state, effects } (R-0). S02에서 구현한다. */
export function applyEvent(_state: EngineState, _event: EngineEvent): ApplyResult {
  throw new NotImplementedError('판정 엔진(applyEvent)')
}
