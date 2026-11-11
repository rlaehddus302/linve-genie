// 이 주문 배송비 바꾸기 경로 (/order-shipping?date=&buyer=, D-UX4-128, 사용자 지시 2026-11-11 "배송비 우리가 만든 키보드로 입력하게 해"):
// 주문 상세 [배송비 바꾸기] → "이 주문 배송비 바꾸기"를 고르면 그 위에 진짜로 쌓인다 — 화면 넘김·밀어서 뒤로 가기는 휴대폰이 한다.
// 저장하면 주문 상세로 돌아간다(주문 화면들은 알림을 받아 다시 받는다).
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { OrderShippingScreen } from '../src/screens/OrderShippingScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function OrderShippingRoute() {
  const { session } = useSession()
  const router = useRouter()
  const params = useLocalSearchParams<{ date?: string; buyer?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  const { date, buyer } = params
  if (typeof date !== 'string' || typeof buyer !== 'string') return <Redirect href="/settle" />
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settle'))
  return (
    <RouteFrame>
      <OrderShippingScreen key={`${date}/${buyer}`} date={date} buyer={buyer} onBack={leave} onSaved={leave} />
    </RouteFrame>
  )
}
