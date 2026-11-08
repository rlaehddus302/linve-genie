// 앱 안 우체국 화면 경로 (D-UX3-37 — 택배 화면 "우체국에 직접 접수하기"에서 연다). kind = COUNTER(들고 가기)·VISIT(가지러 오기)
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { EpostScreen } from '../src/screens/EpostScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function EpostRoute() {
  const { session } = useSession()
  const router = useRouter()
  const params = useLocalSearchParams<{ date?: string; kind?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  const date = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null
  if (date === null) return <Redirect href={{ pathname: '/packing', params: { view: 'parcels' } }} />
  const kind = params.kind === 'VISIT' ? 'VISIT' : 'COUNTER'
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top', 'bottom']}>
      <KitInsets>
        <EpostScreen date={date} kind={kind} onBack={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/packing', params: { view: 'parcels', date } }))} />
      </KitInsets>
    </SafeAreaView>
  )
}
