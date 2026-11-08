// 간편 로그인 창이 돌아오는 주소 (D-UX3-28·D-UX3-66). 서버 apps/server/src/social/service.ts APP_RETURN과 같다.
// 안드로이드는 Custom Tabs가 이 주소를 앱으로 넘기면 로그인 창(expo-web-browser)과 화면 이동(expo-router)이 둘 다 받는다.
// 로그인 창만 쓰고 화면 이동은 무시해야 "Unmatched Route"(없는 화면)가 뜨지 않는다 — app/+native-intent.tsx.
export const APP_RETURN = 'livejjim://auth'

/** 로그인 창이 돌아온 주소인가 (livejjim://auth · livejjim:///auth · /auth, 뒤에 ?… 또는 끝) */
export function isAuthReturnLink(path: string): boolean {
  return /^(?:livejjim:\/{2,3})?\/?auth(?:[/?#]|$)/i.test(path.trim())
}

/** 화면 이동이 받을 주소: 로그인 창 주소면 이동하지 않는다(앱이 이미 떠 있음 null, 처음 켜짐 '/') */
export function routeForSystemPath(path: string, initial: boolean): string | null {
  if (!isAuthReturnLink(path)) return path
  return initial ? '/' : null
}
