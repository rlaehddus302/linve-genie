// 바로 연결할 수 없는 브라우저의 까닭과 문장 (LABEL_RULES L-12 6, NFR-05, 프린터 골든 G-PRT-N1-81~95, D-N1-08).
// 블루투스 연결 방법이 없을 때만 쓴다. 사용자 에이전트 글과 터치 점 수로 정하고, 글자 그대로(대소문자를 가려) 찾는다.

export const UNSUPPORTED_REASONS = ['IOS', 'IN_APP', 'OTHER'] as const
export type UnsupportedReason = (typeof UNSUPPORTED_REASONS)[number]

/** 아이폰·아이패드 표시 (아이패드 데스크톱 모드는 `Macintosh` + 터치 점 2개 이상) */
const IOS_MARKERS = ['iPhone', 'iPad', 'iPod'] as const
/** 앱 안 브라우저 표시 (흔한 앱 몇 개와 안드로이드 웹뷰 표시 — D-N1-08) */
export const IN_APP_MARKERS = ['KAKAOTALK', 'Instagram', 'FBAN', 'FBAV', 'NAVER(inapp', 'Line/', 'DaumApps', '; wv)'] as const

/**
 * 까닭 (L-12 6): ① iPhone·iPad·iPod이 있거나 Macintosh가 있으면서 터치 점이 2개 이상이면 IOS(아이폰은 크롬으로 열어도 안 되므로 먼저 본다).
 * ② 아니면 앱 안 브라우저 표시가 하나라도 있으면 IN_APP. ③ 아니면 OTHER.
 */
export function unsupportedReason(userAgent: unknown, maxTouchPoints: unknown = 0): UnsupportedReason {
  const ua = typeof userAgent === 'string' ? userAgent : ''
  const touch = typeof maxTouchPoints === 'number' && Number.isFinite(maxTouchPoints) ? maxTouchPoints : 0
  if (IOS_MARKERS.some((m) => ua.includes(m)) || (ua.includes('Macintosh') && touch >= 2)) return 'IOS'
  if (IN_APP_MARKERS.some((m) => ua.includes(m))) return 'IN_APP'
  return 'OTHER'
}

/** 까닭마다의 문장 (L-12 6 — 글자 그대로). {앱}은 프로필의 대체 경로 앱이다 */
export function unsupportedMessage(reason: UnsupportedReason, app: string): string {
  switch (reason) {
    case 'IOS':
      return `아이폰·아이패드에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 ${app}에서 인쇄해 주세요.`
    case 'IN_APP':
      return `카카오톡·인스타그램 같은 앱 안에서 연 화면에서는 프린터에 바로 연결할 수 없어요. 크롬에서 열거나, 라벨을 그림 파일로 저장해 ${app}에서 인쇄해 주세요.`
    case 'OTHER':
      return `이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 ${app}에서 인쇄해 주세요.`
  }
}
