// 구매자 경로 (더보기에서 연다, D-APPX-03).
import { Redirect, useRouter } from 'expo-router'
import { BuyersScreen } from '../src/screens/BuyersScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function BuyersRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
        <BuyersScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
      </RouteFrame>
  )
}
