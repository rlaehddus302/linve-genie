// 손님 정보 문자 경로 (ORD-14, D-REAL-11 — 정산 탭 위 줄에서 연다).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BuyerInfoScreen } from '../src/screens/BuyerInfoScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function BuyerInfoRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <BuyerInfoScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/settle'))} />
      </KitInsets>
    </SafeAreaView>
  )
}
