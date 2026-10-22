// 아이폰·아이패드 홈 화면 앱인가 (D-I5-05). 기기 이름(UA)은 읽지 않고 기능 값 navigator.standalone만 본다(D-036) —
// 그 값은 아이폰·아이패드 홈 화면 앱에서만 true다. 값이 없거나 true가 아니면 false.
export function isHomeScreenApp(nav: unknown = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (typeof nav !== 'object' || nav === null) return false
  try {
    return (nav as { readonly standalone?: unknown }).standalone === true
  } catch {
    return false
  }
}
