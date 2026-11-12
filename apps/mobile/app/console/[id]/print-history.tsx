import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { useSession } from '../../../src/services.tsx'
import { ScopeConsole } from '../../../src/screens/console/scope.tsx'
import { PrintHistory } from '../../../src/screens/PrintHistory.tsx'
import { RouteFrame } from '../../../src/ui/kit/route-frame.tsx'
import { Loading } from '../../../src/ui/parts.tsx'

export default function PrintHistoryRoute() {
  const { id, mode } = useLocalSearchParams<{ id: string; mode?: string }>()
  const router = useRouter()
  const { session } = useSession()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  return <RouteFrame><ScopeConsole broadcastId={id} waiting={<Loading />}>{({ broadcast, snapshot }) => broadcast.rehearsal ? <Redirect href="/" /> : <PrintHistory id={id} date={broadcast.date} direct={mode === 'direct'} sealed={snapshot.data?.sealed ?? true} onBack={() => router.canGoBack() ? router.back() : router.replace('/')} />}</ScopeConsole></RouteFrame>
}
