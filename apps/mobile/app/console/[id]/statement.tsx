// 구매자 정산서 경로 (/console/<방송 ID>/statement?buyer=, D-UX4-198): 정산서 목록 위에 진짜로 쌓인다 — 화면 넘김·왼쪽 끝 밀어 뒤로 가기·안드로이드 뒤로는 휴대폰이 한다.
// 옛(D-UX4-192·195): 목록 위에 손으로 그린 겹친 화면이 밀려 들어오다 가끔 중간에 멈췄다. 모두에게 보내기 차례에서는 같은 화면에서 손님만 바꾼다(setParams).
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { BuyerStatementScreen } from '../../../src/screens/console/BuyerStatement.tsx'
import { useSession } from '../../../src/services.tsx'
import { RouteFrame } from '../../../src/ui/kit/route-frame.tsx'

export default function BuyerStatementRoute() {
  const { id, buyer } = useLocalSearchParams<{ id: string; buyer?: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/console/[id]', params: { id } }))
  if (typeof buyer !== 'string' || buyer === '') return <Redirect href={{ pathname: '/console/[id]', params: { id } }} />
  return (
    <RouteFrame>
      <BuyerStatementScreen broadcastId={id} buyer={buyer} onBack={back} onBuyer={(next) => router.setParams({ buyer: next })} />
    </RouteFrame>
  )
}
