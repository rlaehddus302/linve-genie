// 입금 확인 신호를 앱 전체에 준다 (N3, AC-N3-40). 로그인한 동안 하나 — 메뉴의 "입금 확인 3"과 입금 확인 화면이 같은 것을 본다.
// 실시간 연결은 출력 기록(PrintProvider)이 이 탭의 기기 ID로 연 페이지 연결을 함께 쓴다 — 그 연결이 열린 뒤에 붙는다
// (기기 ID를 정하기 전에 연결을 따로 열지 않게).
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { streamUrl } from '../lib/device.ts'
import { DepositStore, INITIAL_SIGNAL, type DepositSignal } from '../lib/deposit-store.ts'
import { sharedStream } from '../lib/stream.ts'
import { usePrintApi } from './print-context.tsx'

export const DepositContext = createContext<DepositStore | null>(null)

export function DepositProvider({ children }: { readonly children: ReactNode }) {
  const print = usePrintApi()
  const ready = print !== null
  const [store, setStore] = useState<DepositStore | null>(null)
  useEffect(() => {
    if (!ready) return
    const stream = sharedStream(streamUrl)
    const next = new DepositStore({ openStream: () => stream.open(), reconnect: () => stream.ensure() })
    next.start()
    setStore(next)
    return () => {
      next.stop()
      setStore(null)
    }
  }, [ready])
  return <DepositContext.Provider value={store}>{children}</DepositContext.Provider>
}

export function useDepositStore(): DepositStore | null {
  return useContext(DepositContext)
}

const noop = () => () => {}
const initial = () => INITIAL_SIGNAL

/** 확인 필요 수·다시 받을 판 (앱이 아직 만들지 않았으면 처음 값) */
export function useDepositSignal(): DepositSignal {
  const store = useDepositStore()
  return useSyncExternalStore(store?.subscribe ?? noop, store?.getSnapshot ?? initial)
}
