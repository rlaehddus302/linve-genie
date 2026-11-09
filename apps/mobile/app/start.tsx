// 시작 안내 경로 (홈 "시작 준비"에서 연다, D-APPX-03).
import { Redirect, useRouter } from 'expo-router'
import { StartScreen } from '../src/screens/StartScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function StartRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  const home = () => (router.canGoBack() ? router.back() : router.replace('/'))
  return (
    <RouteFrame>
        <StartScreen
          nav={{
            onClose: home,
            openShopSettings: () => router.push('/shop-settings'),
            openLabels: () => router.push('/labels?from=start'),
          }}
        />
      </RouteFrame>
  )
}
