// 앱으로 들어오는 주소를 화면 이동 전에 고른다 (expo-router native intent, D-UX3-66).
// 간편 로그인 창이 돌아오는 livejjim://auth?ticket=… 은 로그인 창(expo-web-browser)이 받으므로 화면을 바꾸지 않는다.
import { routeForSystemPath } from '../src/lib/auth-return.ts'

export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  return routeForSystemPath(path, initial)
}
