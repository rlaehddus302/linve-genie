// 입금 확인 경로 (더보기·정산 화면 "입금 확인"에서 연다, D-APPX-01).
import { Redirect, useRouter } from 'expo-router'
import { DepositsScreen } from '../src/screens/DepositsScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function DepositsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
        <DepositsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
      </RouteFrame>
  )
}
