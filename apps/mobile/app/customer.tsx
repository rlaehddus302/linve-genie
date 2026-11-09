// 손님 자세히 경로 (/customer?id=, D-UX4-58): 고객 탭 위에 진짜로 쌓인다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { CustomerDetailScreen } from '../src/screens/CustomersScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function CustomerRoute() {
  const { session } = useSession()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  if (typeof id !== 'string' || id === '') return <Redirect href="/customers" />
  return (
    <RouteFrame>
        <CustomerDetailScreen id={id} onBack={() => (router.canGoBack() ? router.back() : router.replace('/customers'))} />
      </RouteFrame>
  )
}
