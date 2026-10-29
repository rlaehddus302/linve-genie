// 화면 크기·색 (UX-01·UX-04): 기본 글자 18, 누르는 곳 52 이상, 상태는 색 + 글자로. 휴대폰 세로 폭 375 기준.
export const FONT = 18
export const FONT_SMALL = 16
export const FONT_BIG = 22
export const FONT_HUGE = 28
export const TOUCH = 52
export const GAP = 12

export const COLOR = {
  text: '#1a1a1a',
  muted: '#555555',
  background: '#ffffff',
  surface: '#f4f4f2',
  border: '#cfcfcf',
  primary: '#1f5f3b',
  primaryText: '#ffffff',
  success: '#e4f3e8',
  successText: '#145a32',
  warning: '#fff2cc',
  warningText: '#7a4b00',
  danger: '#c62828',
  dangerBg: '#fde8e8',
  info: '#e8f0fb',
  infoText: '#1a3f73',
} as const

export type Tone = 'info' | 'success' | 'warning' | 'danger'

export const TONE_BG: Readonly<Record<Tone, string>> = { info: COLOR.info, success: COLOR.success, warning: COLOR.warning, danger: COLOR.dangerBg }
export const TONE_TEXT: Readonly<Record<Tone, string>> = { info: COLOR.infoText, success: COLOR.successText, warning: COLOR.warningText, danger: COLOR.danger }
