// 택배 접수 경로 (더보기에서 연다, D-APPX-01).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ParcelsScreen } from '../src/screens/ParcelsScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function ParcelsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <ParcelsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} nav={{ openSettle: () => router.replace('/settle'), openSettings: () => router.push('/settings') }} />
      </KitInsets>
    </SafeAreaView>
  )
}
