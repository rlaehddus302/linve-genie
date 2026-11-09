// 라벨 단계 하나 경로 (/label-setup?step=connect|design|test, D-UX4-80): 라벨 프린트 화면에서 방송 시작 라벨 단계의 그 화면 하나를 그대로 연다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { View } from 'react-native'
import { LabelSetupScreen, type LabelSetupStep } from '../src/screens/LabelSetupScreen.tsx'
import { useSession } from '../src/services.tsx'
import { PALETTE } from '../src/ui/kit/tokens.ts'
import { KitInsets } from '../src/ui/kit/safe-area.tsx'

const isStep = (value: unknown): value is LabelSetupStep => value === 'connect' || value === 'design' || value === 'test'

export default function LabelSetupRoute() {
  const { step } = useLocalSearchParams<{ step?: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  if (!isStep(step)) return <Redirect href="/label-print" />
  const back = () => (router.canGoBack() ? router.back() : router.replace('/label-print'))
  return (
    <View style={{ flex: 1, backgroundColor: PALETTE.light.surface }}>
      <KitInsets belowStatusBar={false}>
        <LabelSetupScreen only={step} onBack={back} onDone={back} />
      </KitInsets>
    </View>
  )
}
