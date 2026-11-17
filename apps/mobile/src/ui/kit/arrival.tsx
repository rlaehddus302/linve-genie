// 화면이 다 넘어온 뒤에 키보드 (D-FOCUS-01, 사용자 지시 2026-11-17 "검색 화면으로 넘어갈 때 키보드가 이미 떠있는 상태로 되는데 … 이 화면에 넘어오고 나서
// 키보드를 띄워. 그리고 이건 앞으로 모든 상황에서도 동일하게 전역으로 처리해."):
// 쌓인 화면(경로)·겹친 화면(SlidePage)·판(FullSheet·BottomSheet)은 "다 넘어왔다"를 알린다. 스스로 초점을 받는 칸(autoFocus)은 그때 초점을 받는다 —
// 넘어오는 동안 키보드가 같이 올라오지 않는다. 이미 넘어온 화면 안에서 새로 생긴 칸(단계 바꿈)은 바로 초점 — 키보드가 내려갔다 다시 오르지 않는다.
// 앱 안 모든 칸은 autoFocus를 react-native TextInput에 바로 주지 않고 FocusInput(또는 TextField·UnderlineField·SearchField)으로 준다 — test/focus-after-arrival.test.tsx가 지킨다.
import { createContext, forwardRef, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Platform, TextInput, type TextInputInstance, type TextInputProps } from 'react-native'

const ArrivedContext = createContext(true)

/** 화면 넘김이 끝났다는 소식이 끝내 오지 않을 때(첫 화면·넘김 없는 화면) 기다리는 가장 긴 시간 (D-UX4-112의 550보다 조금 길게) */
export const ARRIVAL_FALLBACK_MS = 700

/** 경로 화면의 넘김 소식 (expo-router 쌓기의 navigation) */
export interface ArrivalNavigation {
  readonly addListener: (event: 'transitionEnd', callback: (event: { readonly data?: { readonly closing?: boolean } }) => void) => () => void
}

/** 경로 화면 하나를 감싼다: 들어오는 넘김이 끝나면(또는 기다림이 다하면) 다 넘어왔다 */
export function ScreenArrivalProvider({ navigation, children }: { readonly navigation: ArrivalNavigation; readonly children: ReactNode }) {
  const [arrived, setArrived] = useState(Platform.OS === 'web')
  useEffect(() => {
    if (arrived) return
    const done = () => setArrived(true)
    const off = navigation.addListener('transitionEnd', (event) => {
      if (event.data?.closing !== true) done()
    })
    const fallback = setTimeout(done, ARRIVAL_FALLBACK_MS)
    return () => {
      off()
      clearTimeout(fallback)
    }
  }, [navigation, arrived])
  return <ArrivedContext.Provider value={arrived}>{children}</ArrivedContext.Provider>
}

/** 겹친 화면·판이 스스로 다 들어왔는지 알린다 — 감싼 화면도 다 넘어왔을 때만 다 넘어왔다 */
export function ArrivalProvider({ arrived, children }: { readonly arrived: boolean; readonly children: ReactNode }) {
  const outer = useContext(ArrivedContext)
  return <ArrivedContext.Provider value={outer && arrived}>{children}</ArrivedContext.Provider>
}

/** 지금 화면이 다 넘어왔는지 (앱 뼈대 밖·시험·웹은 늘 그렇다) */
export function useScreenArrived(): boolean {
  return useContext(ArrivedContext)
}

/**
 * autoFocus 대신: 다 넘어온 화면에서 생긴 칸은 바로(autoFocus 그대로), 넘어오는 중에 생긴 칸은 다 넘어온 뒤에 초점을 준다.
 * 돌려준 값을 TextInput의 autoFocus에 준다.
 */
export function useDeferredAutoFocus(ref: { readonly current: { focus: () => void } | null }, on: boolean): boolean {
  const arrived = useScreenArrived()
  const native = Platform.OS !== 'web'
  // 칸이 생길 때 이미 다 넘어와 있었는지 — 그 뒤로는 바뀌지 않는다
  const [arrivedAtMount] = useState(arrived)
  useEffect(() => {
    if (!on || !native || arrivedAtMount || !arrived) return
    ref.current?.focus()
  }, [on, native, arrivedAtMount, arrived, ref])
  return on && (!native || arrivedAtMount)
}

/** react-native TextInput과 같다 — autoFocus만 화면이 다 넘어온 뒤에 */
export const FocusInput = forwardRef<TextInputInstance, TextInputProps>(function FocusInput({ autoFocus, ...input }, outer) {
  const inner = useRef<TextInputInstance | null>(null)
  const focusNow = useDeferredAutoFocus(inner, autoFocus === true)
  return (
    <TextInput
      {...input}
      ref={(node) => {
        inner.current = node
        if (typeof outer === 'function') outer(node)
        else if (outer !== null) outer.current = node
      }}
      autoFocus={focusNow}
    />
  )
})
