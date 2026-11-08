// 시작 안내 경로 (홈 "시작 준비"에서 연다, D-APPX-03).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StartScreen } from '../src/screens/StartScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function StartRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  const home = () => (router.canGoBack() ? router.back() : router.replace('/'))
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <StartScreen
          nav={{
            onClose: home,
            openShopSettings: () => router.push('/shop-settings'),
            openLabels: () => router.push('/labels?from=start'),
            openConsole: (id) => router.replace({ pathname: '/console/[id]', params: { id } }),
          }}
        />
      </KitInsets>
    </SafeAreaView>
  )
}
