// 디자인 토큰 (모바일 개편 바탕, 새 시안 D-UX2-01): 색(밝게·어둡게) · 글자 크기 단계 · 간격 · 모서리 · 그림자 · 누르는 크기.
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
  /** 아래 탭·고정 버튼 위 구분선 (장식용) */
  readonly line: string
  /** 테두리 버튼 선 (장식용 — 글자가 뜻을 전한다) */
  readonly outline: string
  /** 방금 올라온 상품 줄 바탕 */
  readonly freshBg: string
  /** 테두리 없는 회색 단추 바탕 (토스식 "송금" 단추, D-UX3-02) */
  readonly soft: string
  /** 누르는 동안 바탕 (D-UX3-03): 흰 줄·옅은 바탕 → pressed, 각 단추 → 그 색의 진한 색 */
  readonly pressed: string
  readonly softPressed: string
  readonly primaryPressed: string
  readonly secondaryPressed: string
  readonly dangerPressed: string
  /** 주의 줄 누름 (잠깐 보이는 색이라 대비 쌍에 넣지 않는다) */
  readonly warnPressed: string
  /** 확인이 필요한 줄 바탕·글자 */
  readonly warnBg: string
  readonly warnText: string
  readonly warnStrong: string
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface TonePair {
  readonly bg: string
  readonly fg: string
}

/**
 * 색 (D-UX2-01, 사장님이 고른 새 시안): 밝은 테마 하나만 쓴다. 바탕 옅은 회색-초록, 카드 흰색, 강조 초록, 주의 주황.
 * 어두운 모드도 같은 밝은 색을 쓴다 — 방송 중 화면이 휴대폰 설정에 따라 바뀌지 않게.
 */
const LIGHT: Palette = {
  background: '#F7F8F6',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F3F1',
  text: '#16201A',
  textSub: '#5B665E',
  border: '#EEF0EC',
  borderStrong: '#7D8780',
  primary: '#1F7A4D',
  onPrimary: '#FFFFFF',
  primaryText: '#1F7A4D',
  secondary: '#E6F2EB',
  onSecondary: '#155C39',
  danger: '#B42318',
  onDanger: '#FFFFFF',
  dangerText: '#B42318',
  backdrop: '#000000',
  toast: '#16201A',
  onToast: '#FFFFFF',
  toastAction: '#8FD3AE',
  focus: '#1F7A4D',
  line: '#E3E6E1',
  outline: '#D5DAD3',
  freshBg: '#E6F2EB',
  soft: '#E9ECE8',
  pressed: '#E8EBE7',
  softPressed: '#D9DED8',
  primaryPressed: '#17603C',
  secondaryPressed: '#CFE5D8',
  dangerPressed: '#8E1B12',
  warnPressed: '#FCE6C6',
  warnBg: '#FFF4E5',
  warnText: '#B54708',
  warnStrong: '#8A3A06',
}

export const PALETTE: Readonly<Record<Scheme, Palette>> = { light: LIGHT, dark: LIGHT }

const LIGHT_TONES: Readonly<Record<Tone, TonePair>> = {
  neutral: { bg: '#EEF0EC', fg: '#16201A' },
  info: { bg: '#EAF1F7', fg: '#1F4E79' },
  success: { bg: '#E6F2EB', fg: '#155C39' },
  warning: { bg: '#FFF4E5', fg: '#8A3A06' },
  danger: { bg: '#FDECEA', fg: '#B42318' },
}

/** 상태 꼬리표·알림 상자 색 쌍 (바탕 + 글자) */
export const TONES: Readonly<Record<Scheme, Readonly<Record<Tone, TonePair>>>> = { light: LIGHT_TONES, dark: LIGHT_TONES }

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
  /** 방송 중 상품 줄의 품종·가격 (멀리서도 읽히게) */
  lead: 22,
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

/** 모서리: 숫자 배지 14 · 줄·버튼 16 · 카드 20 · 시트 24 */
export const RADIUS = { sm: 10, md: 14, lg: 16, xl: 20, xxl: 24, pill: 999 } as const

/** 누르는 크기: 최소 52, 큰 버튼 60, 숫자판 키 64. 서로 붙은 것은 gap(8) 이상 띄운다. */
export const TOUCH = { min: 52, button: 60, key: 64, gap: 8 } as const

/** 시스템 큰 글자를 이 배율까지만 따른다 (안드로이드 최대 200%). */
export const MAX_FONT_SCALE = 2

/** 이 배율 이상이면 가로로 놓던 것(제목|값, 버튼 둘)을 세로로 쌓는다. */
export const STACK_AT_SCALE = 1.5

export const SHADOW = {
  /** 새 시안은 그림자 없이 흰 카드만 (D-UX2-01) */
  card: { shadowColor: '#000000', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  sheet: { shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  toast: { shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
} as const

/**
 * 누르는 동안 바탕 (D-UX3-03, 토스식): 흐리게 하지 않고 놓인 바탕보다 한 단계 진하게.
 * 모르는 바탕이면 흰 줄 눌림 색.
 */
export function pressedFill(p: Palette, base: string): string {
  if (base === p.primary) return p.primaryPressed
  if (base === p.danger) return p.dangerPressed
  if (base === p.soft) return p.softPressed
  if (base === p.secondary || base === p.freshBg) return p.secondaryPressed
  if (base === p.warnBg) return p.warnPressed
  return p.pressed
}

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
    { name: '설명/회색단추(아래 탭 고른 칸)', fg: p.textSub, bg: p.soft, min: 4.5 },
    { name: '설명/바탕', fg: p.textSub, bg: p.background, min: 4.5 },
    { name: '설명/카드', fg: p.textSub, bg: p.surface, min: 4.5 },
    { name: '설명/옅은바탕', fg: p.textSub, bg: p.surfaceAlt, min: 4.5 },
    { name: '주버튼', fg: p.onPrimary, bg: p.primary, min: 4.5 },
    { name: '주색글자/카드', fg: p.primaryText, bg: p.surface, min: 4.5 },
    { name: '주색글자/바탕', fg: p.primaryText, bg: p.background, min: 4.5 },
    { name: '보조버튼', fg: p.onSecondary, bg: p.secondary, min: 4.5 },
    { name: '보조버튼 눌림', fg: p.onSecondary, bg: p.secondaryPressed, min: 4.5 },
    { name: '회색단추', fg: p.text, bg: p.soft, min: 4.5 },
    { name: '회색단추 눌림', fg: p.text, bg: p.softPressed, min: 4.5 },
    { name: '주버튼 눌림', fg: p.onPrimary, bg: p.primaryPressed, min: 4.5 },
    { name: '위험버튼 눌림', fg: p.onDanger, bg: p.dangerPressed, min: 4.5 },
    { name: '본문/눌림', fg: p.text, bg: p.pressed, min: 4.5 },
    { name: '설명/눌림', fg: p.textSub, bg: p.pressed, min: 4.5 },
    { name: '위험버튼', fg: p.onDanger, bg: p.danger, min: 4.5 },
    { name: '위험글자/카드', fg: p.dangerText, bg: p.surface, min: 4.5 },
    { name: '위험글자/바탕', fg: p.dangerText, bg: p.background, min: 4.5 },
    { name: '알림막대', fg: p.onToast, bg: p.toast, min: 4.5 },
    { name: '알림막대 되돌리기', fg: p.toastAction, bg: p.toast, min: 4.5 },
    { name: '입력칸 테두리/카드', fg: p.borderStrong, bg: p.surface, min: 3 },
    { name: '입력칸 테두리/옅은바탕', fg: p.borderStrong, bg: p.surfaceAlt, min: 3 },
    { name: '초점선/카드', fg: p.focus, bg: p.surface, min: 3 },
    { name: '주색글자/옅은초록', fg: p.primaryText, bg: p.freshBg, min: 4.5 },
    { name: '본문/옅은초록', fg: p.text, bg: p.freshBg, min: 4.5 },
    { name: '설명/옅은초록', fg: p.textSub, bg: p.freshBg, min: 4.5 },
    { name: '주의글자/주의바탕', fg: p.warnText, bg: p.warnBg, min: 4.5 },
    { name: '주의진한글자/주의바탕', fg: p.warnStrong, bg: p.warnBg, min: 4.5 },
    { name: '본문/주의바탕', fg: p.text, bg: p.warnBg, min: 4.5 },
    { name: '설명/주의바탕', fg: p.textSub, bg: p.warnBg, min: 4.5 },
  ]
  for (const [tone, pair] of Object.entries(TONES[scheme])) pairs.push({ name: `상태 ${tone}`, fg: pair.fg, bg: pair.bg, min: 4.5 })
  return pairs
}
