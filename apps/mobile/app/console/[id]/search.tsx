// 라이브 화면 찾기 경로 (/console/<방송 ID>/search, D-UX4-204 · 상품·찜 기록 하나로 D-UX4-205): 머리 돋보기를 누르면 라이브 화면 위에 진짜로 쌓인다 —
// 화면 넘김·왼쪽 끝 밀어 뒤로·안드로이드 뒤로는 휴대폰이 한다. 결과를 누르면 돌아가 라이브 화면이 그 상품을 연다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ConsoleSearchScreen } from '../../../src/screens/console/ConsoleSearch.tsx'
import { useSession } from '../../../src/services.tsx'
import { RouteFrame } from '../../../src/ui/kit/route-frame.tsx'

export default function ConsoleSearchRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/console/[id]', params: { id } }))
  return (
    <RouteFrame>
      <ConsoleSearchScreen broadcastId={id} onBack={back} />
    </RouteFrame>
  )
}
