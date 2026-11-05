// 택배 접수 경로 (더보기에서 연다, D-APPX-01).
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ParcelsScreen } from '../src/screens/ParcelsScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function ParcelsRoute() {
  const { session } = useSession()
  const router = useRouter()
  // 포장 화면 [택배 화면으로]: 그 날짜부터 (D-UX3-35)
  const params = useLocalSearchParams<{ date?: string }>()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <ParcelsScreen initialDate={typeof params.date === 'string' ? params.date : undefined} onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} nav={{ openSettle: (date, buyer) => router.replace({ pathname: '/settle', params: { date, buyer } }), openSettings: () => router.push('/shop-settings') }} />
      </KitInsets>
    </SafeAreaView>
  )
}
