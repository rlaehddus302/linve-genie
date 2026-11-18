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
  /** 비어 있는 입력 칸 안의 라벨 글자 (토스 회색) */
  readonly placeholder: string
  /** 누르는 동안의 뒤로 화살표 — 바탕은 그대로, 화살표만 연하게 (D-UX3-51) */
  readonly iconPressed: string
  /** 입력 칸 [지우기] 동그라미 (장식 — 이름은 aria-label) */
  readonly clearCircle: string
  /** 누르는 동안의 [지우기] 동그라미 — 뒤로 ‹처럼 바탕·크기는 그대로, 색만 연하게 (D-UX4-147) */
  readonly clearPressed: string
  /** 내용 위에 뜬 아래 탭 바탕 — 은은한 반투명 흰색(흐림 위에 얹는다, D-UX3-13) */
  readonly glass: string
  /** 흐림이 없을 때(안드로이드) 아래 탭 바탕 — 흐림 없이 0.82면 뒤 글자가 또렷이 비쳐 거의 불투명하게 (D-UX3-68) */
  readonly glassNoBlur: string
  readonly tabLine: string
  readonly tabInk: string
  readonly segmentOff: string
  /** 확인이 필요한 줄 바탕·글자 */
  readonly warnBg: string
  readonly warnText: string
  readonly warnStrong: string
  /** 방송 상품 줄의 [찜 닉네임] 꼬리표 바탕·글자 — 금색 (D-UX3-78) */
  readonly goldBg: string
  readonly goldText: string
  /** 금색(찜) 알약 눌림 — 회색으로 바뀌지 않게 진한 금색 (D-PILLX-01) */
  readonly goldPressed: string
  /** 빨강(겹침) 알약 눌림 */
  readonly dangerSoftPressed: string
  /** 방송 상태 표시 (D-UX4-22, 사용자 지시 2026-11-09 "정상 상태면 밝은 초록색, 아니라면 밝은 빨간색"): 바탕·글자·점 */
  readonly liveOkBg: string
  readonly liveOkText: string
  readonly liveOkDot: string
  readonly liveBadBg: string
  readonly liveBadText: string
  readonly liveBadDot: string
  /** 다시 잇는 중 (주황, D-UX4-67) */
  readonly liveWarnBg: string
  readonly liveWarnText: string
  readonly liveWarnDot: string
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export interface TonePair {
  readonly bg: string
  readonly fg: string
}

/**
 * 색 (D-UX2-01, 사장님이 고른 새 시안 → D-UX3-07 토스 치수 그대로): 밝은 테마 하나만 쓴다. 바탕 회색(#F2F4F6), 카드 흰색, 글자 진회색, 강조 초록, 주의 주황.
 * 어두운 모드도 같은 밝은 색을 쓴다 — 방송 중 화면이 휴대폰 설정에 따라 바뀌지 않게.
 */
const LIGHT: Palette = {
  background: '#F2F4F6',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F4F6',
  text: '#191F28',
  textSub: '#4E5968',
  border: '#F2F4F6',
  borderStrong: '#6B7684',
  primary: '#1F7A4D',
  onPrimary: '#FFFFFF',
  primaryText: '#1F7A4D',
  secondary: '#E6F2EB',
  onSecondary: '#155C39',
  // 잘못 빨강 (D-UX3-59, 사용자 지시 2026-11-07 "오류 아이콘, 메시지 보면 색이 살짝 탁해. 좀 더 선명한 빨간색으로 … 전역 설정으로"):
  // 토스 빨강과 같은 색상(356°)에서 글자 대비 4.5(옅은 회색 바탕 #F2F4F6에서도)를 지키며 가장 맑게 — 회색기를 빼고 채도만 올렸다. 옛 #CF3441(D-UX3-51)·#B42318
  danger: '#DD1824',
  onDanger: '#FFFFFF',
  dangerText: '#DD1824',
  backdrop: '#000000',
  toast: '#191F28',
  onToast: '#FFFFFF',
  toastAction: '#8FD3AE',
  focus: '#1F7A4D',
  line: '#E5E8EB',
  outline: '#E5E8EB',
  freshBg: '#E6F2EB',
  soft: '#E5E8EB',
  pressed: '#E8EBED',
  softPressed: '#D1D6DB',
  primaryPressed: '#17603C',
  secondaryPressed: '#CFE5D8',
  dangerPressed: '#A42835',
  warnPressed: '#FCE6C6',
  placeholder: '#8B95A1',
  iconPressed: '#B0B8C1',
  clearCircle: '#B0B8C1',
  clearPressed: '#DDE1E6',
  glass: 'rgba(255,255,255,0.82)',
  glassNoBlur: 'rgba(255,255,255,0.96)',
  /** 아래 탭 테두리 (토스처럼 또렷한 얇은 회색 선, D-UX3-42) */
  tabLine: '#DDE1E6',
  /** 아래 탭 안 고른 칸 아이콘·글자 (토스처럼 진한 회색, D-UX3-43) */
  tabInk: '#333D4B',
  // 탭 안 위쪽 나누기(포장 · 택배)의 고르지 않은 이름 (D-UX3-60, 토스 "시장 뉴스"처럼 큰 글자 회색 — 큰 글자 대비 3 이상)
  segmentOff: '#6B7684',
  warnBg: '#FFF4E5',
  warnText: '#B54708',
  warnStrong: '#8A3A06',
  // 찜한 사람 꼬리표 금색 (D-UX3-78, 사용자 지시 2026-11-09 "배경 색은 금색 같은 색으로") — 글자 대비 4.5 이상
  goldBg: '#F8E3A3',
  goldText: '#5A4100',
  goldPressed: '#F0D27E',
  dangerSoftPressed: '#F9D5D1',
  // 방송 상태 (D-UX4-22): 점은 밝게, 글자는 옅은 바탕 위 대비 4.5 이상
  liveOkBg: '#E6F7EE',
  liveOkText: '#07803F',
  liveOkDot: '#00C471',
  liveBadBg: '#FEEDEE',
  liveBadText: '#D11422',
  liveBadDot: '#FF3B3B',
  liveWarnBg: '#FFF4E5',
  liveWarnText: '#B54708',
  liveWarnDot: '#FF9500',
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

/** 글자 크기 단계 (dp, 시스템 큰 글자 배율 전). 토스 화면 치수(D-UX3-07)에서 모두 한 단계(약 10%) 줄였다 — 사용자 지시 2026-11-09 "글자 크기 다 줄이셈", 카드가 커 한 화면에 너무 적게 보였다 (D-UX3-74). */
export const TYPE = {
  /** 아래 탭 글자 (토스 아래 탭처럼 작게, D-UX3-41) */
  tab: 11,
  /** 입력 칸 위 라벨·칸 아래 잘못 문장·도움말 (토스 "휴대폰 번호"·"…다시 확인해주세요.", D-UX3-51) */
  note: 12,
  /** 꼬리표·도움말 */
  caption: 13,
  /** 인증번호 "남은 시간" (토스 사진을 재어 15, D-UX3-56) */
  meta: 14,
  /** 본문 */
  body: 15,
  /** 줄 제목·단추·입력 */
  bodyLarge: 16,
  /** 카드 안 묶음 이름 */
  section: 16,
  /** 쌓인 화면 머리 가운데 제목·오른쪽 글자 단추 (토스 "나라사랑카드"·"관리" 사진을 재어 17, D-UX4-40) */
  nav: 17,
  /** 방송 중 상품 줄의 품종·가격 */
  lead: 18,
  /** 카드·시트 제목 */
  title: 20,
  /** 흰 설정 화면 맨 위 큰 제목 (토스 "비밀번호 · 보안" — 시뮬레이터 화면과 나란히 재어 21, D-UX4-100 · 옛 22 D-UX4-94) */
  pageTitle: 21,
  /** 화면 맨 위 질문형 제목 ("어떤 계좌로 보낼까요?") — 토스 사진 재기 22·굵게·줄 간격 1.24 (D-UX3-51, 옛 26) */
  headline: 20,
  /** 숫자 강조 */
  number: 24,
  /** 입력 칸 값·비어 있을 때 칸 안 라벨 (토스 "휴대폰 번호" 칸을 재어 22, D-UX3-51 — 옛 24) */
  input: 20,
  /** 상품 추가 큰 칸·숫자판·확인 문장 (토스 송금 "얼마나 옮길까요?" 사진을 재어 28, D-UX4-31) */
  amount: 28,
} as const

export type TypeStep = keyof typeof TYPE

/** 줄 높이 배수 */
export const LINE = 1.4
/** 질문형 제목의 줄 간격 (토스 두 줄 제목 재기 — 두 줄 사이 63px = 29.3, D-UX3-56. 옛 D-UX3-51 1.24는 폭을 393으로 잘못 알고 쟀다) */
export const HEADLINE_LINE = 1.33

/** book: 입력 칸 값 (토스 입력 글자 두께, D-UX3-51) */
export const WEIGHT = { regular: '400', book: '500', medium: '600', bold: '700', heavy: '800' } as const

/**
 * 입력 화면 틀 자리 (토스 사진을 재어, D-UX3-51 — 사용자 지시 2026-11-07 "뒤로가기 버튼의 크기, 위치 다름 … 제목의 크기, 위치가 다름"):
 * 뒤로(48 누름 자리)는 안전 영역 바로 아래에서 왼쪽 8, 제목은 뒤로 아래 31(D-UX3-56 — 폭 430 휴대폰 사진을 다시 재어, 옛 28)·왼쪽 24, 제목과 첫 입력 칸 사이 36.
 */
// backLeft 8 → 6 (D-UX4-100: 시뮬레이터 화면과 토스 사진을 같은 pt로 견주니 뒤로 ‹ 잉크가 토스(21.7)보다 2.3 오른쪽)
// backLeft 6 → 8 (D-UX4-130: 같은 휴대폰 사진 두 장을 견주니 뒤로 ‹ 잉크가 토스(23.8)보다 1.9 왼쪽 — 옛 D-UX4-100은 사진 폭을 393pt로 잘못 재었다)
export const PAGE = { backLeft: 8, titleTop: 31, side: 24, titleGap: 36 } as const

/** 간격 (4·8 단위) */
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const

/**
 * 회색 바탕 화면의 양옆 여백 — 흰 카드(묶음)가 화면 끝에서 이만큼 떨어진다 (D-UX4-74, 사용자 지시 2026-11-10 "섹션 너비를 좀 더 늘려줘 … 라이브 화면 안과 밖에서 섹션 너비가 달라", 토스 홈 카드 ≈ 12).
 * 탭 화면·쌓인 화면·설정·방송 화면이 모두 이것만 쓴다 (옛: 탭 20 · 설정·쌓인 화면 16 · 방송 화면 12).
 */
export const GUTTER = SPACE.md

/** 모서리: 숫자 배지 12 · 줄·버튼 16 · 카드 20 · 시트 24 (토스) */
export const RADIUS = { sm: 10, md: 12, lg: 16, xl: 20, xxl: 24, pill: 999 } as const

/** 누르는 크기: 줄 최소 48, 큰 버튼 54(토스 "확인"), 숫자판 키 60. 서로 붙은 것은 gap(8) 이상 띄운다. */
export const TOUCH = { min: 48, button: 54, key: 60, gap: 8 } as const

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
  if (base === p.goldBg) return p.goldPressed
  if (base === LIGHT_TONES.danger.bg) return p.dangerSoftPressed
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
    { name: '찜 꼬리표/금색', fg: p.goldText, bg: p.goldBg, min: 4.5 },
    { name: '찜 꼬리표/금색 눌림', fg: p.goldText, bg: p.goldPressed, min: 4.5 },
    { name: '겹침 꼬리표 눌림', fg: LIGHT_TONES.danger.fg, bg: p.dangerSoftPressed, min: 4.5 },
    { name: '라이브 상태 정상', fg: p.liveOkText, bg: p.liveOkBg, min: 4.5 },
    { name: '라이브 상태 문제', fg: p.liveBadText, bg: p.liveBadBg, min: 4.5 },
    { name: '라이브 상태 다시 연결하는 중', fg: p.liveWarnText, bg: p.liveWarnBg, min: 4.5 },
  ]
  for (const [tone, pair] of Object.entries(TONES[scheme])) pairs.push({ name: `상태 ${tone}`, fg: pair.fg, bg: pair.bg, min: 4.5 })
  return pairs
}
