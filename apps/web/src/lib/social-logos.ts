// 간편 로그인 공식 로고 모양 (D-UX3-28 — 사용자 지시 2026-11-05 "긴 버튼에 왼쪽에 각 공식로고"). 웹(SVG)과 앱(react-native-svg)이 같은 경로를 쓴다.
// 공급자 안내서의 색: 카카오 바탕 #FEE500·말풍선 #000000, 네이버 바탕 #03C75A·N 흰색, 구글 흰 바탕·회색 테두리·네 색 G,
// Apple 검은 바탕·흰 사과·흰 글자(Apple 휴먼 인터페이스 지침 Sign in with Apple, D-UX3-34).
import type { LoginProvider } from './social-login.ts'

export interface LogoPath {
  readonly d: string
  readonly fill: string
}

export interface SocialLogo {
  readonly viewBox: string
  readonly paths: readonly LogoPath[]
}

export const SOCIAL_LOGOS: Readonly<Record<LoginProvider, SocialLogo>> = {
  kakao: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M12 3C6.48 3 2 6.54 2 10.9c0 2.82 1.87 5.3 4.69 6.7-.15.53-.98 3.4-1.01 3.62 0 0-.02.17.09.24.11.06.24.01.24.01.32-.04 3.7-2.42 4.29-2.83.55.08 1.12.12 1.7.12 5.52 0 10-3.54 10-7.86S17.52 3 12 3z',
        fill: '#000000',
      },
    ],
  },
  naver: {
    viewBox: '0 0 24 24',
    paths: [{ d: 'M15.56 12.75 8.17 2H2v20h6.44V11.25L15.83 22H22V2h-6.44z', fill: '#FFFFFF' }],
  },
  google: {
    viewBox: '0 0 48 48',
    paths: [
      { d: 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z', fill: '#EA4335' },
      { d: 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z', fill: '#4285F4' },
      { d: 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z', fill: '#FBBC05' },
      { d: 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z', fill: '#34A853' },
    ],
  },
  apple: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701',
        fill: '#FFFFFF',
      },
    ],
  },
}

/** 단추 색 (공급자 안내서) */
export const SOCIAL_COLORS: Readonly<Record<LoginProvider, { readonly background: string; readonly text: string; readonly border: string; readonly pressed: string }>> = {
  kakao: { background: '#FEE500', text: '#191919', border: '#FEE500', pressed: 'rgba(0, 0, 0, 0.08)' },
  naver: { background: '#03C75A', text: '#FFFFFF', border: '#03C75A', pressed: 'rgba(0, 0, 0, 0.12)' },
  // 구글 테두리는 옅게 (D-UX3-29 — 사용자 지시 "구글 로그인 버튼 테두리 너무 진함", KREAM 흰 단추처럼)
  google: { background: '#FFFFFF', text: '#1F1F1F', border: '#E5E8EB', pressed: 'rgba(0, 0, 0, 0.06)' },
  apple: { background: '#000000', text: '#FFFFFF', border: '#000000', pressed: 'rgba(255, 255, 255, 0.16)' },
}
