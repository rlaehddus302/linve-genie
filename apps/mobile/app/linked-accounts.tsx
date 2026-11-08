// 연동된 소셜 계정 경로 (설정 → 계정에서 연다, D-UX3-61).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinkedAccountsScreen } from '../src/screens/LinkedAccountsScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function LinkedAccountsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <LinkedAccountsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))} />
      </KitInsets>
    </SafeAreaView>
  )
}
