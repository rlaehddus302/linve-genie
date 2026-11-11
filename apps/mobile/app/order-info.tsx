// 손님 정보 입력 경로 (/order-info?date=&buyer=&field=, D-UX4-126): 주문 상세의 빨간 "모름 >"을 누르면 그 위에 진짜로 쌓인다 — 화면 넘김·밀어서 뒤로 가기는 휴대폰이 한다.
// field는 처음 물을 칸(name·phone·address). 저장하면 주문 상세로 돌아간다(주문 화면들은 알림을 받아 다시 받는다).
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { OrderInfoScreen, type OrderInfoField } from '../src/screens/OrderInfoScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

const FIELDS: readonly OrderInfoField[] = ['name', 'phone', 'address']
const isField = (value: unknown): value is OrderInfoField => typeof value === 'string' && (FIELDS as readonly string[]).includes(value)

export default function OrderInfoRoute() {
  const { session } = useSession()
  const router = useRouter()
  const params = useLocalSearchParams<{ date?: string; buyer?: string; field?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  const { date, buyer, field } = params
  if (typeof date !== 'string' || typeof buyer !== 'string' || !isField(field)) return <Redirect href="/settle" />
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/settle'))
  return (
    <RouteFrame>
      <OrderInfoScreen key={`${date}/${buyer}/${field}`} date={date} buyer={buyer} field={field} onBack={leave} onSaved={leave} />
    </RouteFrame>
  )
}
