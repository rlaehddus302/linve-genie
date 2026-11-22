// 새 방송 라벨 단계 한 화면 경로 (/new-broadcast/label-step?id=&step=connect|design|device, D-LABEL-ROUTE-01): 묻기 화면 위에 하나씩 쌓인다.
// 뒤로(머리 ‹ · 왼쪽 끝 밀기 · 안드로이드 뒤로)는 아래 단계 화면으로. 다 하면 잇기가 끝난 뒤 방송 화면.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { useLabelFlowRoute } from '../../src/lib/label-flow-nav.ts'
import { LabelSetupScreen, type LabelFlowStep } from '../../src/screens/LabelSetupScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { RouteFrame } from '../../src/ui/kit/route-frame.tsx'

const isStep = (value: unknown): value is Exclude<LabelFlowStep, 'ask'> => value === 'connect' || value === 'design' || value === 'device'

export default function NewBroadcastLabelStepRoute() {
  const { id, step } = useLocalSearchParams<{ id?: string; step?: string }>()
  const { session } = useSession()
  const flow = useLabelFlowRoute(useRouter(), id, isStep(step) ? step : 'connect')
  if (session.state === 'out' || typeof id !== 'string' || !isStep(step)) return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame selfTop>
      <LabelSetupScreen step={step} focused={flow.focused} openStep={flow.openStep} onBack={flow.back} onDone={flow.done} />
    </RouteFrame>
  )
}
