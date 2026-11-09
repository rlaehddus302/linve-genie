// 손님 정산 자세히 경로 (/settle-buyer?date=&key=, D-UX4-58): 주문 탭 위에 진짜로 쌓인다 — 화면 넘김·밀어서 뒤로 가기는 휴대폰이 한다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SettleBuyerScreen } from '../src/screens/SettleScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function SettleBuyerRoute() {
  const { session } = useSession()
  const router = useRouter()
  const { date, key } = useLocalSearchParams<{ date?: string; key?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  if (typeof date !== 'string' || typeof key !== 'string') return <Redirect href="/settle" />
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <SettleBuyerScreen date={date} settlementKey={key} onBack={() => (router.canGoBack() ? router.back() : router.replace('/settle'))} />
      </KitInsets>
    </SafeAreaView>
  )
}
