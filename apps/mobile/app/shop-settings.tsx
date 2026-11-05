// 가게 설정 경로 (설정·더보기에서 연다, D-APPX-03).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ShopSettingsScreen } from '../src/screens/ShopSettingsScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function ShopSettingsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <ShopSettingsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
      </KitInsets>
    </SafeAreaView>
  )
}
