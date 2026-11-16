// 손님별 합계 경로 (/console/<방송 ID>/totals, D-BUYERSUM-01): 라이브 화면 [찜 기록] 탭의 "손님별 합계 ›"를 누르면 라이브 화면 위에 진짜로 쌓인다 —
// 화면 넘김·왼쪽 끝 밀어 뒤로·안드로이드 뒤로는 휴대폰이 한다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { BuyerTotalsScreen } from '../../../src/screens/console/BuyerTotals.tsx'
import { useSession } from '../../../src/services.tsx'
import { RouteFrame } from '../../../src/ui/kit/route-frame.tsx'

export default function BuyerTotalsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/console/[id]', params: { id } }))
  return (
    <RouteFrame>
      <BuyerTotalsScreen broadcastId={id} onBack={back} />
    </RouteFrame>
  )
}
