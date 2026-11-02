// 구매자 경로 (더보기에서 연다, D-APPX-03). 보조자는 열지 않는다(SYS-04).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BuyersScreen } from '../src/screens/BuyersScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function BuyersRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  if (session.me.role === 'ASSISTANT') return <Redirect href="/more" />
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <BuyersScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
      </KitInsets>
    </SafeAreaView>
  )
}
