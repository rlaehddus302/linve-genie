// 상품 추가 경로 (/console/<방송 ID>/add, D-UX4-57): 방송 화면 위에 진짜로 쌓인다 — 화면 넘김·밀어서 뒤로 가기는 휴대폰이 한다.
// no: 번호를 채워 연다 — 등록 안 된 번호의 찜 알림에서 (D-RETRO-23)
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ProductAddScreen } from '../../../src/screens/console/StackScreens.tsx'
import { useSession } from '../../../src/services.tsx'
import { RouteFrame } from '../../../src/ui/kit/route-frame.tsx'

export default function ProductAddRoute() {
  const { id, no } = useLocalSearchParams<{ id: string; no?: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/console/[id]', params: { id } }))
  const startNo = typeof no === 'string' && /^\d{1,9}$/.test(no) ? Number(no) : undefined
  return (
    <RouteFrame>
        <ProductAddScreen broadcastId={id} onBack={back} {...(startNo === undefined ? {} : { startNo })} />
      </RouteFrame>
  )
}
