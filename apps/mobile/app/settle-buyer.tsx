// 주문 상세 경로 (/settle-buyer?date=&buyer=, D-UX4-58 → D-UX4-125): 주문 탭 위에 진짜로 쌓인다 — 화면 넘김·밀어서 뒤로 가기는 휴대폰이 한다.
// 성함·휴대폰 번호·주소 줄은 손님 정보 화면(/order-info, D-UX4-126)을 쌓는다.
// 옛 링크(/settle-buyer?date=&key=["buyer","date"])도 그 열쇠를 읽어 그대로 연다. 지난 거래 줄은 그날 상세를 새로 쌓는다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { parseOrderKey } from '../src/lib/orders.ts'
import { OrderDetailScreen } from '../src/screens/OrderDetailScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function SettleBuyerRoute() {
  const { session } = useSession()
  const router = useRouter()
  const params = useLocalSearchParams<{ date?: string; buyer?: string; key?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  const old = typeof params.key === 'string' ? parseOrderKey(params.key) : null
  const date = typeof params.date === 'string' ? params.date : old?.date
  const buyer = typeof params.buyer === 'string' ? params.buyer : old?.buyer
  if (date === undefined || buyer === undefined) return <Redirect href="/settle" />
  return (
    <RouteFrame>
        <OrderDetailScreen
          key={`${date}/${buyer}`}
          date={date}
          buyer={buyer}
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/settle'))}
          onOpenOrder={(nextDate, nextBuyer) => router.push({ pathname: '/settle-buyer', params: { date: nextDate, buyer: nextBuyer } })}
          onOpenShopSettings={() => router.push('/shop-settings')}
          onOpenReceipts={() => router.push('/receipts')}
          onEditInfo={(field) => router.push({ pathname: '/order-info', params: { date, buyer, field } })}
        />
      </RouteFrame>
  )
}
