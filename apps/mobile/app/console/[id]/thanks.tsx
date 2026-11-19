// 올라간 감사 채팅 경로 (/console/<방송 ID>/thanks, D-THANKSFIX-01): 라이브 관리 위에 쌓인다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ThanksPosts } from '../../../src/screens/console/ThanksPosts.tsx'
import { useSession } from '../../../src/services.tsx'
import { RouteFrame } from '../../../src/ui/kit/route-frame.tsx'

export default function ThanksPostsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { session } = useSession()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  return (
    <RouteFrame>
      <ThanksPosts broadcastId={id} onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/console/[id]', params: { id } }))} />
    </RouteFrame>
  )
}
