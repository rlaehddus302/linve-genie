// 방송 관리 설정 하나 (/console/<방송 ID>/tool/<sms|voice|import|paste|chat>, D-UX4-60): 방송 관리 위에 진짜 전체 화면으로 쌓인다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { ConsoleToolScreen, isConsoleTool } from '../../../../src/screens/console/StackScreens.tsx'
import { useSession } from '../../../../src/services.tsx'
import { RouteFrame } from '../../../../src/ui/kit/route-frame.tsx'

export default function ConsoleToolRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  if (!isConsoleTool(name)) return <Redirect href={{ pathname: '/console/[id]/manage', params: { id } }} />
  return (
    <RouteFrame>
        <ConsoleToolScreen broadcastId={id} tool={name} onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/console/[id]/manage', params: { id } }))} />
      </RouteFrame>
  )
}
