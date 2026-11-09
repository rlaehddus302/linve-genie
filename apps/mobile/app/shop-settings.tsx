// 가게 설정 경로 (설정·더보기에서 연다, D-APPX-03).
import { Redirect, useRouter } from 'expo-router'
import { ShopSettingsScreen } from '../src/screens/ShopSettingsScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function ShopSettingsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
        <ShopSettingsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
      </RouteFrame>
  )
}
