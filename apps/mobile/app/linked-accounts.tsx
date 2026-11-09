// 연동된 소셜 계정 경로 (설정 → 계정에서 연다, D-UX3-61).
import { Redirect, useRouter } from 'expo-router'
import { LinkedAccountsScreen } from '../src/screens/LinkedAccountsScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function LinkedAccountsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
        <LinkedAccountsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
      </RouteFrame>
  )
}
