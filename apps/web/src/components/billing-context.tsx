// 요금 기능 설정을 앱 전체에 준다 (N5, AC-N5-50·58). 로그인한 동안 /api/client-config의 billing을 한 번 받는다.
// - 꺼져 있으면(기본) 메뉴에 "요금"이 없고 /billing은 없는 화면이다. 홈에 미리 보기·알림 띠가 없다.
// - 시험 결제(testPayment)일 때만 시험 결제 창 코드가 열린다. 운영이면 포트원 공개 값(상점 ID·채널 키)을 쓴다.
// - 홈·요금 화면은 열린 동안 요금 상태 저장소 하나를 연다(useBillingStore) — 다른 화면(콘솔·문자찜·구매자·정산·라벨)은 요금을 받지 않는다(AC-N5-57).
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { get, isApiError, type ApiError } from '../api/client.ts'
import type { BillingConfig } from '../api/billing-types.ts'
import { BillingStore, LOADING_BILLING, type BillingSnapshot } from '../lib/billing-store.ts'
import { streamUrl } from '../lib/device.ts'
import { sharedStream } from '../lib/stream.ts'

export type BillingConfigState =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly config: BillingConfig }
  | { readonly state: 'error'; readonly error: ApiError; readonly retry: () => void }

export const BILLING_OFF: BillingConfig = { enabled: false, testPayment: false }

/** client-config의 billing 항목 읽기. 모양이 다르면 꺼짐 (운영 결제 창은 공개 값이 모두 있을 때만) */
export function readBillingConfig(value: unknown): BillingConfig {
  if (typeof value !== 'object' || value === null) return BILLING_OFF
  const record = value as Record<string, unknown>
  if (record.enabled !== true) return BILLING_OFF
  if (record.testPayment === true) return { enabled: true, testPayment: true }
  const storeId = record.storeId
  const channelKey = record.channelKey
  if (typeof storeId === 'string' && storeId !== '' && typeof channelKey === 'string' && channelKey !== '') return { enabled: true, testPayment: false, storeId, channelKey }
  return BILLING_OFF
}

const BillingConfigContext = createContext<BillingConfigState>({ state: 'ready', config: BILLING_OFF })

export function BillingConfigProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<BillingConfigState>({ state: 'loading' })
  const load = useCallback(() => {
    let alive = true
    setState({ state: 'loading' })
    get<{ billing?: unknown }>('/api/client-config').then(
      (config) => {
        if (alive) setState({ state: 'ready', config: readBillingConfig(config.billing) })
      },
      (error: unknown) => {
        if (!alive) return
        // 서버에 닿았는데 설정이 없다(옛 서버 등)면 꺼짐. 닿지 못했으면 다시 불러오기를 보인다
        if (isApiError(error) && (error.network || error.status >= 500)) setState({ state: 'error', error, retry: () => void load() })
        else setState({ state: 'ready', config: BILLING_OFF })
      },
    )
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => load(), [load])
  return <BillingConfigContext.Provider value={state}>{children}</BillingConfigContext.Provider>
}

export function useBillingConfigState(): BillingConfigState {
  return useContext(BillingConfigContext)
}

/** 요금 기능 설정 (받기 전·받지 못했으면 null) */
export function useBillingConfig(): BillingConfig | null {
  const state = useBillingConfigState()
  return state.state === 'ready' ? state.config : null
}

const noop = () => () => {}
const loading = () => LOADING_BILLING

/** 요금 상태 저장소 (요금 기능이 켜져 있을 때만 연다). lists = 결제 내역·쓴 내역도 받는다 */
export function useBillingStore(enabled: boolean, lists: boolean): { readonly store: BillingStore | null; readonly snapshot: BillingSnapshot } {
  const [store, setStore] = useState<BillingStore | null>(null)
  useEffect(() => {
    if (!enabled) {
      setStore(null)
      return
    }
    const next = new BillingStore({ openStream: () => sharedStream(streamUrl).open(), lists })
    setStore(next)
    next.start()
    return () => next.stop()
  }, [enabled, lists])
  const snapshot = useSyncExternalStore(store?.subscribe ?? noop, store?.getSnapshot ?? loading)
  return { store: enabled ? store : null, snapshot: enabled ? snapshot : LOADING_BILLING }
}
