// 확인 필요 경로 (더보기·방송 화면 알림에서 연다, D-APPX-03). `?broadcast=` 그 방송만 (리허설은 앱에서 뺐다, D-UX3-86).
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ReviewsScreen } from '../src/screens/ReviewsScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function ReviewsRoute() {
  const { session } = useSession()
  const router = useRouter()
  const params = useLocalSearchParams<{ broadcast?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  const broadcast = typeof params.broadcast === 'string' && params.broadcast !== '' ? params.broadcast : undefined
  return (
    <RouteFrame>
        <ReviewsScreen
          query={broadcast === undefined ? {} : { broadcast }}
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
          openSettings={() => router.push('/settings')}
        />
      </RouteFrame>
  )
}
