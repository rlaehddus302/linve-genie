// 손님 정산 자세히 경로 (/settle-buyer?date=&key=, D-UX4-58): 주문 탭 위에 진짜로 쌓인다 — 화면 넘김·밀어서 뒤로 가기는 휴대폰이 한다.
// 이 기기에서 문자를 못 보내면 다음 할 일 카드가 영수증 보내기 화면(/receipts)을 연다 (D-UX4-123).
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SettleBuyerScreen } from '../src/screens/SettleScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function SettleBuyerRoute() {
  const { session } = useSession()
  const router = useRouter()
  const { date, key } = useLocalSearchParams<{ date?: string; key?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  if (typeof date !== 'string' || typeof key !== 'string') return <Redirect href="/settle" />
  return (
    <RouteFrame>
        <SettleBuyerScreen date={date} settlementKey={key} onBack={() => (router.canGoBack() ? router.back() : router.replace('/settle'))} onOpenReceipts={() => router.push('/receipts')} />
      </RouteFrame>
  )
}
