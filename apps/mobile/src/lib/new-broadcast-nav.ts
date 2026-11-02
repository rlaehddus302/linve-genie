// 새 방송 경로 화면들의 이동 (D-UX3-09): 쌓인 화면이라 밀어서 뒤로 가기가 된다. 방송을 만들면 새 방송 화면들을 걷어 내고 홈 위에 방송 화면을 쌓는다
// (방송 화면에서 뒤로 가면 홈 — 새 방송 화면으로 돌아가 같은 방송을 또 만들지 않게).
import type { useRouter } from 'expo-router'
import type { NewBroadcastNavigation } from '../screens/NewBroadcastScreen.tsx'

export function newBroadcastNav(router: ReturnType<typeof useRouter>): NewBroadcastNavigation {
  return {
    back: () => (router.canGoBack() ? router.back() : router.replace('/')),
    openAddress: (category) => router.push({ pathname: '/new-broadcast/address', params: { category } }),
    openConsole: (id) => {
      router.dismissTo('/')
      router.push({ pathname: '/console/[id]', params: { id } })
    },
  }
}
