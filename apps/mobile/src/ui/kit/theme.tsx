// 디자인 바탕 연결: 밝은 색(어두운 모드도 같은 색, D-UX2-01), 글자 확대 배율, 글자 조각(Txt), 안전 영역.
// 시스템 큰 글자는 MAX_FONT_SCALE(2배)까지만 따라가고, 배율이 크면 가로로 놓던 것을 세로로 쌓는다.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Text, useWindowDimensions, type TextProps } from 'react-native'
import { HEADLINE_LINE, LINE, MAX_FONT_SCALE, PALETTE, STACK_AT_SCALE, TONES, TYPE, WEIGHT, type Palette, type Scheme, type TypeStep } from './tokens.ts'

interface ThemeOverride {
  readonly scheme?: Scheme
  /** 견본·시험에서 글자 배율을 강제로 정한다. 있으면 시스템 배율 대신 이 값으로 글자를 직접 키운다. */
  readonly fontScale?: number
}

const OverrideContext = createContext<ThemeOverride>({})

export function ThemeOverrideProvider({ scheme, fontScale, children }: ThemeOverride & { readonly children: ReactNode }) {
  const outer = useContext(OverrideContext)
  return <OverrideContext.Provider value={{ scheme: scheme ?? outer.scheme, fontScale: fontScale ?? outer.fontScale }}>{children}</OverrideContext.Provider>
}

export interface Kit {
  readonly scheme: Scheme
  readonly p: Palette
  readonly tones: (typeof TONES)[Scheme]
  /** 시스템 배율을 2배로 자른 값 */
  readonly fontScale: number
  /** 배율이 커서 가로 배치를 세로로 바꿔야 하는가 */
  readonly stacked: boolean
  /** 강제 배율을 쓰는 중인가 (견본·시험) */
  readonly forced: boolean
}

export function useKit(): Kit {
  const { fontScale: systemScale } = useWindowDimensions()
  const override = useContext(OverrideContext)
  // 밝은 테마만 (D-UX2-01): 휴대폰이 어두운 모드여도 같은 밝은 색. 견본·시험만 강제로 고를 수 있다
  const scheme: Scheme = override.scheme ?? 'light'
  const raw = override.fontScale ?? systemScale
  const fontScale = Math.min(Math.max(raw, 1), MAX_FONT_SCALE)
  return { scheme, p: PALETTE[scheme], tones: TONES[scheme], fontScale, stacked: fontScale >= STACK_AT_SCALE, forced: override.fontScale !== undefined }
}

const BottomInsetContext = createContext(0)
const TopInsetContext = createContext(0)

/** 아래쪽 안전 영역(홈 막대) 높이를 아래 조각들에 알린다. 기기 값은 safe-area.tsx(KitInsets)가 넣는다 — 시험에서는 0. top은 전체 화면 판(FullSheet)이 상태 막대를 피할 때 쓴다 */
export function BottomInsetProvider({ bottom, top = 0, children }: { readonly bottom: number; readonly top?: number; readonly children: ReactNode }) {
  return (
    <TopInsetContext.Provider value={top}>
      <BottomInsetContext.Provider value={bottom}>{children}</BottomInsetContext.Provider>
    </TopInsetContext.Provider>
  )
}

export function useBottomInset(): number {
  return useContext(BottomInsetContext)
}

export function useTopInset(): number {
  return useContext(TopInsetContext)
}

/** 맨 위 상태 막대 자리를 흰색으로 칠해 달라는 화면 수 — 바탕이 흰 화면(번호 확인 등)이 떠 있으면 위도 흰색 (D-UX3-50) */
const TopWhiteContext = createContext<(delta: 1 | -1) => void>(() => undefined)

/** 상태 막대 자리(SafeAreaView 위쪽)의 바탕을 정한다: 흰 화면이 하나라도 떠 있으면 흰색 */
export function useTopWhiteCount(): readonly [number, (delta: 1 | -1) => void] {
  const [count, setCount] = useState(0)
  const change = useCallback((delta: 1 | -1) => setCount((now) => Math.max(0, now + delta)), [])
  return [count, change] as const
}

export function TopWhiteProvider({ change, children }: { readonly change: (delta: 1 | -1) => void; readonly children: ReactNode }) {
  return <TopWhiteContext.Provider value={change}>{children}</TopWhiteContext.Provider>
}

/** 이 화면이 보이는 동안 맨 위 상태 막대 자리도 흰색으로 */
export function useWhiteTop(): void {
  const change = useContext(TopWhiteContext)
  useEffect(() => {
    change(1)
    return () => change(-1)
  }, [change])
}

const TabBarRoomContext = createContext(0)

/** 아래 탭이 내용 위에 떠 있을 때(D-UX3-13) 그 높이 — 스크롤 내용은 이만큼 아래를 더 비워 마지막 줄이 탭에 가리지 않게 한다. 탭 밖 화면은 0 */
export function TabBarRoomProvider({ room, children }: { readonly room: number; readonly children: ReactNode }) {
  return <TabBarRoomContext.Provider value={room}>{children}</TabBarRoomContext.Provider>
}

export function useTabBarRoom(): number {
  return useContext(TabBarRoomContext)
}

export type TxtColor = keyof Pick<Palette, 'text' | 'textSub' | 'primaryText' | 'dangerText' | 'onPrimary' | 'onDanger' | 'onSecondary' | 'onToast' | 'warnText' | 'warnStrong'>

export interface TxtProps extends Omit<TextProps, 'style'> {
  readonly step?: TypeStep
  readonly weight?: keyof typeof WEIGHT
  readonly color?: TxtColor
  /** 팔레트에 없는 색(상태 꼬리표 글자)을 직접 줄 때. 대비는 tokens의 TONES가 시험으로 지킨다. */
  readonly ink?: string
  readonly center?: boolean
}

/** 모든 글은 이것으로: 크기 단계·줄 높이·색·큰 글자 상한을 한 곳에서 지킨다. */
export function Txt({ step = 'body', weight = 'regular', color = 'text', ink, center, children, ...rest }: TxtProps) {
  const { p, fontScale, forced } = useKit()
  const base = TYPE[step]
  const size = forced ? base * fontScale : base
  return (
    <Text
      {...rest}
      allowFontScaling={!forced}
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={{ fontSize: size, lineHeight: Math.round(size * (step === 'headline' ? HEADLINE_LINE : LINE)), fontWeight: WEIGHT[weight], color: ink ?? p[color], textAlign: center === true ? 'center' : undefined }}
    >
      {children}
    </Text>
  )
}
