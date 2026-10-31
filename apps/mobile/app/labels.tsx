// 라벨·프린터 경로 (더보기·홈 "라벨 뽑기"에서 연다).
import { Redirect, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LabelsScreen } from '../src/screens/LabelsScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function LabelsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <LabelsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
      </KitInsets>
    </SafeAreaView>
  )
}
