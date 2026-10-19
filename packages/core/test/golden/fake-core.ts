// 가짜 코어 (테스트 대역). 러너가 틀린 기대에서 실제로 실패하는지 확인할 때 쓴다.
// - 파서: 넘긴 함수가 없으면 NotImplementedError를 던진다.
// - 엔진: snapshot을 주면 "적용한 이벤트 목록"을 상태로 갖는 결정적 엔진이 된다. 없으면 미구현.
import { NotImplementedError, type SettingsOverride } from '@livejjim/core'
import type { GoldenCore, GoldenEngineCore, GoldenEvent, GoldenSnapshot } from './types.ts'

export interface FakeCoreOptions {
  readonly parser?: {
    readonly chat?: (text: string, settings: SettingsOverride) => unknown
    readonly amount?: (text: string, settings: SettingsOverride) => unknown
    readonly koreanNumber?: (text: string) => unknown
    readonly quickInput?: (text: string, settings: SettingsOverride) => unknown
  }
  /** 고정 스냅샷, 또는 지금까지 적용한 이벤트로 스냅샷을 만드는 함수 */
  readonly snapshot?: GoldenSnapshot | ((events: readonly GoldenEvent[]) => GoldenSnapshot)
  /** 엔진 동작 일부를 바꾼다 (숨은 상태·예외 흉내 등) */
  readonly engine?: Partial<GoldenEngineCore>
}

export function emptySnapshot(overrides: Partial<GoldenSnapshot> = {}): GoldenSnapshot {
  return {
    buyerKeys: {},
    broadcasts: {},
    products: {},
    buyers: {},
    settlements: {},
    effects: [],
    claims: [],
    pending: {},
    cancelRequests: [],
    ...overrides,
  }
}

interface FakeState {
  readonly events: readonly GoldenEvent[]
}

export function createFakeCore(options: FakeCoreOptions = {}): GoldenCore {
  const notImplemented = (feature: string) => (): never => {
    throw new NotImplementedError(feature)
  }
  const { snapshot } = options
  const baseEngine: GoldenEngineCore =
    snapshot === undefined
      ? { start: notImplemented('가짜 엔진'), apply: notImplemented('가짜 엔진'), observe: notImplemented('가짜 엔진') }
      : {
          start: (): FakeState => ({ events: [] }),
          apply: (state, event) => ({ state: { events: [...(state as FakeState).events, event] }, effects: [] }),
          observe: (state) => (typeof snapshot === 'function' ? snapshot((state as FakeState).events) : snapshot),
        }
  return {
    parser: {
      chat: options.parser?.chat ?? notImplemented('가짜 chat'),
      amount: options.parser?.amount ?? notImplemented('가짜 amount'),
      koreanNumber: options.parser?.koreanNumber ?? notImplemented('가짜 korean-number'),
      quickInput: options.parser?.quickInput ?? notImplemented('가짜 quick-input'),
    },
    engine: { ...baseEngine, ...options.engine },
  }
}
