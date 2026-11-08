// 앱 글꼴 Pretendard (D-UX3-69, 사용자 결정 2026-11-08): 시스템 글꼴은 아이폰(SF Pro + Apple SD Gothic Neo)과
// 안드로이드(Noto·삼성 글꼴)가 한글 폭이 6~9% 달라 같은 글자 크기도 안드로이드가 커 보였다. Pretendard는 아이폰과 폭이 97~101%.
// 굵기마다 파일 하나(assets/fonts, app.json expo-font 플러그인이 앱에 넣는다). 파일 이름 = 글꼴 PostScript 이름이라
// 아이폰은 그 이름으로, 안드로이드는 assets/fonts 파일 이름으로 같은 글꼴을 찾는다.
// 기기에서는 fontWeight를 함께 주지 않는다 — 안드로이드는 굵기를 또 주면 이미 굵은 글꼴을 한 번 더 굵게 그릴 수 있다.
// 웹(시험·expo web)은 글꼴 파일을 싣지 않으니 실제로 그리는 굵기를 준다.
// D-UX3-70: Pretendard는 같은 굵기에서 예전 아이폰 글꼴보다 4~6% 굵어(600·700·800) 중간·굵게·아주 굵게만 한 단계 가볍게 그린다.
import { Platform } from 'react-native'
import type { WEIGHT } from './tokens.ts'

export type FontWeight = (typeof WEIGHT)[keyof typeof WEIGHT] | '900'

interface Face {
  /** 앱에 넣은 글꼴 파일(확장자 뺀 이름 = PostScript 이름) */
  readonly file: string
  /** 그 파일의 실제 굵기 */
  readonly weight: FontWeight
}

/** 앱 굵기 → 실제로 그리는 글꼴 (중간 600→500, 굵게 700→600, 아주 굵게 800→700, D-UX3-70) */
export const PRETENDARD: Readonly<Record<FontWeight, Face>> = {
  '400': { file: 'Pretendard-Regular', weight: '400' },
  '500': { file: 'Pretendard-Medium', weight: '500' },
  '600': { file: 'Pretendard-Medium', weight: '500' },
  '700': { file: 'Pretendard-SemiBold', weight: '600' },
  '800': { file: 'Pretendard-Bold', weight: '700' },
  '900': { file: 'Pretendard-Black', weight: '900' },
}

export interface FontStyle {
  readonly fontFamily: string
  readonly fontWeight?: FontWeight
}

/** 글자 스타일에 펼쳐 넣는다: `style={{ fontSize: 16, ...font('700') }}` */
export function font(weight: FontWeight = '400', os: string = Platform.OS): FontStyle {
  const face = PRETENDARD[weight]
  return os === 'web' ? { fontFamily: face.file, fontWeight: face.weight } : { fontFamily: face.file }
}
