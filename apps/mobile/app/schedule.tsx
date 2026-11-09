// 방송 일정·알림 경로 (더보기 "방송 일정"에서 연다, D-APPX-01).
import { Redirect, useRouter } from 'expo-router'
import { ScheduleScreen } from '../src/screens/ScheduleScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function ScheduleRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
        <ScheduleScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
      </RouteFrame>
  )
}
