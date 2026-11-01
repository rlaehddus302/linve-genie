// 방송 리포트 경로 (더보기 "방송 리포트"·정산 날짜에서 연다). ?date=YYYY-MM-DD로 날짜를 고를 수 있다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ReportScreen } from '../src/screens/ReportScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function ReportRoute() {
  const { session } = useSession()
  const router = useRouter()
  const { date } = useLocalSearchParams<{ date?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <ReportScreen initialDate={typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined} onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
      </KitInsets>
    </SafeAreaView>
  )
}
