// 출력 기록·이 기기의 프린터를 앱 전체에 준다 (I1). 로그인한 동안 하나 — 화면을 옮겨도 출력 기기의 출력은 이어진다(AC-I1-23).
import type { LabelRenderEnv } from '@livejjim/label'
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { claimDeviceId, deviceId, streamUrl } from '../lib/device.ts'
import { kstToday } from '../lib/kst.ts'
import { labelEnv } from '../lib/label-env.ts'
import { renderJob, renderTest } from '../lib/label-render.ts'
import { PrintStore, labelsEnabledOf, type LabelSettingsSnapshot, type LabelsSnapshot, type PackingSnapshot, type PrintSnapshot } from '../lib/print-store.ts'
import { PrinterStation, browserWakeLock, type StationSnapshot, type TestPrinterHandle } from '../lib/printer-station.ts'
import { sharedStream } from '../lib/stream.ts'

export interface PrintApi {
  readonly store: PrintStore
  readonly station: PrinterStation
}

export const PrintContext = createContext<PrintApi | null>(null)

declare global {
  interface Window {
    /** 시험용 프린터 손잡이 — 서버가 시험 모드일 때만 생긴다 (AC-I1-50) */
    livejjimTestPrinter?: TestPrinterHandle
  }
}

/** 로그인한 화면을 감싼다: 출력 기록 저장소와 이 기기의 프린터를 만들고, 내려가면(로그아웃) 닫는다 */
export function PrintProvider({ children }: { readonly children: ReactNode }) {
  const [api, setApi] = useState<PrintApi | null>(null)
  useEffect(() => {
    let alive = true
    let made: PrintApi | null = null
    const initial = deviceId()
    void claimDeviceId().then((id) => {
      if (!alive) return
      const stream = sharedStream(streamUrl)
      // 복제한 탭이라 기기 ID가 바뀌었으면 실시간 연결도 새 ID로 다시 연다
      if (id !== initial) stream.restart()
      const store = new PrintStore({ openStream: () => stream.open(), reconnect: () => stream.ensure() })
      const station = new PrinterStation({
        store,
        deviceId: id,
        render: async (job) => renderJob(await labelEnv(), job),
        renderTest: async (input) => renderTest(await labelEnv(), input),
        prepare: async () => {
          await labelEnv()
        },
        requestWakeLock: browserWakeLock(),
        today: () => kstToday(),
        exposeTestHandle: (handle) => {
          if (handle === null) delete window.livejjimTestPrinter
          else window.livejjimTestPrinter = handle
        },
      })
      store.start()
      station.start()
      made = { store, station }
      setApi(made)
    })
    return () => {
      alive = false
      made?.station.stop()
      made?.store.stop()
    }
  }, [])
  return <PrintContext.Provider value={api}>{children}</PrintContext.Provider>
}

export function usePrintApi(): PrintApi | null {
  return useContext(PrintContext)
}

const LOADING: PrintSnapshot = { phase: 'loading', error: null, config: null, overview: null, templates: null, connection: 'connecting' }
const noop = () => () => {}

/** 출력 기록 (앱이 아직 만들지 않았으면 불러오는 중) */
export function usePrintState(): PrintSnapshot {
  const api = usePrintApi()
  return useSyncExternalStore(api?.store.subscribe ?? noop, api?.store.getSnapshot ?? (() => LOADING))
}

/**
 * 라벨 기능 켬/끔 (N4a, L-12 9): true 켬 · false 끔 · null 아직 모름(불러오는 중·불러오지 못함·앱이 저장소를 만들기 전).
 * 라벨 조작은 true일 때만 보인다 — 꺼 둔 판매자의 화면에 라벨 버튼이 잠깐이라도 나타나지 않게(AC-N4a-18)
 */
export function useLabelsEnabled(): boolean | null {
  return labelsEnabledOf(usePrintState())
}

const NO_STATION = () => null

/** 이 기기의 프린터 */
export function useStationState(): StationSnapshot | null {
  const api = usePrintApi()
  return useSyncExternalStore(api?.station.subscribe ?? noop, api?.station.getSnapshot ?? NO_STATION)
}

const EMPTY_LABELS: LabelsSnapshot = { phase: 'loading', error: null, labels: new Map() }

/** 그 날짜(실제 범위)의 라벨 상태. null이면 보지 않는다(리허설·날짜 모름) */
export function useScopeLabels(date: string | null): LabelsSnapshot {
  const api = usePrintApi()
  const store = api?.store ?? null
  const [, setTick] = useState(0)
  useEffect(() => {
    if (store === null || date === null) return
    return store.watchLabels(date, () => setTick((n) => n + 1))
  }, [store, date])
  if (store === null || date === null) return EMPTY_LABELS
  return store.labelsSnapshot(date)
}

const EMPTY_SETTINGS: LabelSettingsSnapshot = { phase: 'loading', error: null, settings: null }

/** 설정 화면의 라벨 기능 설정·바꾼 기록 (보는 동안 실시간으로 바뀐다) */
export function useLabelSettings(): LabelSettingsSnapshot {
  const api = usePrintApi()
  const store = api?.store ?? null
  const [, setTick] = useState(0)
  useEffect(() => {
    if (store === null) return
    return store.watchLabelSettings(() => setTick((n) => n + 1))
  }, [store])
  if (store === null) return EMPTY_SETTINGS
  return store.labelSettingsSnapshot()
}

const EMPTY_PACKING: PackingSnapshot = { phase: 'loading', error: null, view: null }

/** 정산 묶음의 포장 라벨 (실제 범위). date·buyer가 null이면 보지 않는다 */
export function usePackingLabel(date: string | null, buyer: string | null): PackingSnapshot {
  const api = usePrintApi()
  const store = api?.store ?? null
  const [, setTick] = useState(0)
  useEffect(() => {
    if (store === null || date === null || buyer === null) return
    return store.watchPacking(date, buyer, () => setTick((n) => n + 1))
  }, [store, date, buyer])
  if (store === null || date === null || buyer === null) return EMPTY_PACKING
  return store.packingSnapshot(date, buyer)
}

export type EnvState = { readonly state: 'loading' } | { readonly state: 'ready'; readonly env: LabelRenderEnv } | { readonly state: 'error' }

/** 라벨 렌더 환경 (내장 글꼴을 불러온 뒤) */
export function useLabelEnv(): EnvState {
  const [state, setState] = useState<EnvState>({ state: 'loading' })
  useEffect(() => {
    let alive = true
    labelEnv().then(
      (env) => {
        if (alive) setState({ state: 'ready', env })
      },
      () => {
        if (alive) setState({ state: 'error' })
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return state
}

/** 글꼴을 불러오지 못했을 때 */
export const FONT_ERROR = '라벨 글꼴을 불러오지 못했어요. 새로고침한 뒤 다시 해 주세요.'
