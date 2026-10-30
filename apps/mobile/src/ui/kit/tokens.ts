// 디자인 토큰 (모바일 개편 바탕): 색(밝게·어둡게) · 글자 크기 단계 · 간격 · 모서리 · 그림자 · 누르는 크기.
// 원칙(토스식 + 나이 드신 판매자): 본문 18 이상, 누르는 곳 52 이상·사이 8 이상, 글자-바탕 대비 4.5:1 이상,
// 상태는 색 + 글자(+기호)로. 시스템 큰 글자를 따라가되 MAX_FONT_SCALE까지만 키워 화면이 깨지지 않게 한다.
// 색 쌍 대비는 test/design-tokens.test.ts가 계산해서 지킨다.

export type Scheme = 'light' | 'dark'

export interface Palette {
  /** 화면 바탕 */
  readonly background: string
  /** 카드·시트 바탕 */
  readonly surface: string
  /** 옅은 바탕 (입력칸·눌림·숫자판 키) */
  readonly surfaceAlt: string
  readonly text: string
  /** 설명 글 (이것도 4.5:1 이상) */
  readonly textSub: string
  /** 구분선 (장식용) */
  readonly border: string
  /** 입력칸 테두리처럼 바탕과 구분돼야 하는 선 (3:1 이상) */
  readonly borderStrong: string
  readonly primary: string
  readonly onPrimary: string
  /** 링크·주색 글자 (카드 위 4.5:1 이상) */
  readonly primaryText: string
  /** 보조 버튼 바탕·글자 */
  readonly secondary: string
  readonly onSecondary: string
  readonly danger: string
  readonly onDanger: string
  /** 오류 문장 글자 */
  readonly dangerText: string
  readonly backdrop: string
  readonly toast: string
  readonly onToast: string
  readonly toastAction: string
  readonly focus: string
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface TonePair {
  readonly bg: string
  readonly fg: string
}

export const PALETTE: Readonly<Record<Scheme, Palette>> = {
  light: {
    background: '#f2f4f6',
    surface: '#ffffff',
    surfaceAlt: '#e8ebef',
    text: '#191f28',
    textSub: '#4e5968',
    border: '#d1d6db',
    borderStrong: '#6b7684',
    primary: '#1b64da',
    onPrimary: '#ffffff',
    primaryText: '#1957c2',
    secondary: '#e8f0fd',
    onSecondary: '#1957c2',
    danger: '#d22030',
    onDanger: '#ffffff',
    dangerText: '#c01c2b',
    backdrop: '#000000',
    toast: '#262c35',
    onToast: '#ffffff',
    toastAction: '#8fbcff',
    focus: '#1b64da',
  },
  dark: {
    background: '#101317',
    surface: '#1c2128',
    surfaceAlt: '#2b323b',
    text: '#f2f4f6',
    textSub: '#b0b8c1',
    border: '#3a424c',
    borderStrong: '#8b95a1',
    primary: '#2f6fe0',
    onPrimary: '#ffffff',
    primaryText: '#a9c8ff',
    secondary: '#22324d',
    onSecondary: '#a9c8ff',
    danger: '#c62837',
    onDanger: '#ffffff',
    dangerText: '#ff8f97',
    backdrop: '#000000',
    toast: '#e5e8eb',
    onToast: '#191f28',
    toastAction: '#1648a8',
    focus: '#8fbcff',
  },
}

/** 상태 꼬리표·알림 상자 색 쌍 (바탕 + 글자) */
export const TONES: Readonly<Record<Scheme, Readonly<Record<Tone, TonePair>>>> = {
  light: {
    neutral: { bg: '#e8ebef', fg: '#333d4b' },
    info: { bg: '#e8f0fd', fg: '#1648a8' },
    success: { bg: '#e3f5e9', fg: '#11632f' },
    warning: { bg: '#fff3d6', fg: '#7a4300' },
    danger: { bg: '#fdeaea', fg: '#b01825' },
  },
  dark: {
    neutral: { bg: '#2b323b', fg: '#e5e8eb' },
    info: { bg: '#1c2f50', fg: '#a9c8ff' },
    success: { bg: '#163823', fg: '#8fe0aa' },
    warning: { bg: '#3d2c0c', fg: '#ffd27a' },
    danger: { bg: '#45171b', fg: '#ffa3aa' },
  },
}

/** 글자 크기 단계 (dp, 시스템 큰 글자 배율 전). 본문은 18 이상. */
export const TYPE = {
  /** 꼬리표·도움말 — 가장 작은 글자 */
  caption: 16,
  /** 본문 */
  body: 18,
  /** 강조 본문·버튼·입력 */
  bodyLarge: 20,
  /** 묶음 제목 */
  section: 20,
  /** 카드·시트 제목 */
  title: 24,
  /** 화면 맨 위 질문형 제목 */
  headline: 28,
  /** 숫자 강조 (가격·건수) */
  number: 36,
} as const

export type TypeStep = keyof typeof TYPE

/** 줄 높이 배수 */
export const LINE = 1.4

export const WEIGHT = { regular: '400', medium: '600', bold: '700', heavy: '800' } as const

/** 간격 (4·8 단위) */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const

export const RADIUS = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const

/** 누르는 크기: 최소 52, 큰 버튼 60, 숫자판 키 64. 서로 붙은 것은 gap(8) 이상 띄운다. */
export const TOUCH = { min: 52, button: 60, key: 64, gap: 8 } as const

/** 시스템 큰 글자를 이 배율까지만 따른다 (안드로이드 최대 200%). */
export const MAX_FONT_SCALE = 2

/** 이 배율 이상이면 가로로 놓던 것(제목|값, 버튼 둘)을 세로로 쌓는다. */
export const STACK_AT_SCALE = 1.5

export const SHADOW = {
  card: { shadowColor: '#000000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  sheet: { shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  toast: { shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
} as const

/** 시트 뒤 반투명 막 투명도 */
export const BACKDROP_OPACITY = 0.5

/** 알림 막대가 떠 있는 시간 (ms). 되돌리기가 있으면 더 오래 둔다 — 천천히 읽는 분 기준. */
export const TOAST_MS = { plain: 4000, withUndo: 8000 } as const

export interface ContrastPair {
  readonly name: string
  readonly fg: string
  readonly bg: string
  /** 본문 4.5, 테두리·초점선 3 */
  readonly min: number
}

/** 화면에 실제로 함께 쓰는 글자-바탕 쌍 전부 (시험이 하나씩 계산한다). */
export function contrastPairs(scheme: Scheme): readonly ContrastPair[] {
  const p = PALETTE[scheme]
  const pairs: ContrastPair[] = [
    { name: '본문/바탕', fg: p.text, bg: p.background, min: 4.5 },
    { name: '본문/카드', fg: p.text, bg: p.surface, min: 4.5 },
    { name: '본문/옅은바탕', fg: p.text, bg: p.surfaceAlt, min: 4.5 },
    { name: '설명/바탕', fg: p.textSub, bg: p.background, min: 4.5 },
    { name: '설명/카드', fg: p.textSub, bg: p.surface, min: 4.5 },
    { name: '설명/옅은바탕', fg: p.textSub, bg: p.surfaceAlt, min: 4.5 },
    { name: '주버튼', fg: p.onPrimary, bg: p.primary, min: 4.5 },
    { name: '주색글자/카드', fg: p.primaryText, bg: p.surface, min: 4.5 },
    { name: '주색글자/바탕', fg: p.primaryText, bg: p.background, min: 4.5 },
    { name: '보조버튼', fg: p.onSecondary, bg: p.secondary, min: 4.5 },
    { name: '위험버튼', fg: p.onDanger, bg: p.danger, min: 4.5 },
    { name: '위험글자/카드', fg: p.dangerText, bg: p.surface, min: 4.5 },
    { name: '위험글자/바탕', fg: p.dangerText, bg: p.background, min: 4.5 },
    { name: '알림막대', fg: p.onToast, bg: p.toast, min: 4.5 },
    { name: '알림막대 되돌리기', fg: p.toastAction, bg: p.toast, min: 4.5 },
    { name: '입력칸 테두리/카드', fg: p.borderStrong, bg: p.surface, min: 3 },
    { name: '입력칸 테두리/옅은바탕', fg: p.borderStrong, bg: p.surfaceAlt, min: 3 },
    { name: '초점선/카드', fg: p.focus, bg: p.surface, min: 3 },
  ]
  for (const [tone, pair] of Object.entries(TONES[scheme])) pairs.push({ name: `상태 ${tone}`, fg: pair.fg, bg: pair.bg, min: 4.5 })
  return pairs
}
