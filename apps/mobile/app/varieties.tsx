// 내 품종 경로 (설정 → 음성에서 연다, D-V3-127).
import { Redirect, useRouter } from 'expo-router'
import { VarietiesScreen } from '../src/screens/VarietiesScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function VarietiesRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
        <VarietiesScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
      </RouteFrame>
  )
}
