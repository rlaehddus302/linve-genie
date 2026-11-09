// 라벨 프린트 경로 (/label-print, D-UX4-80): 방송 관리 "라벨 프린트"가 쌓아 연다. 한 단계는 /label-setup?step=, 출력 상태·농도는 /labels.
import { Redirect, useRouter } from 'expo-router'
import { View } from 'react-native'
import { LabelPrintScreen } from '../src/screens/LabelPrintScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

export default function LabelPrintRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  // 위 안전 영역은 FormPage가 직접 띄운다
  return (
    <View style={{ flex: 1, backgroundColor: PALETTE.light.surface }}>
      <KitInsets belowStatusBar={false}>
        <LabelPrintScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} openStep={(step) => router.push({ pathname: '/label-setup', params: { step } })} openStatus={() => router.push('/labels?from=console')} />
      </KitInsets>
    </View>
  )
}
