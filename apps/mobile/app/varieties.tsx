// 내 품종 경로 (설정 → 음성에서 연다, D-V3-127).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { VarietiesScreen } from '../src/screens/VarietiesScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function VarietiesRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <VarietiesScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
      </KitInsets>
    </SafeAreaView>
  )
}
