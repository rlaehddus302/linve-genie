// 새 방송 3단계 경로 (/new-broadcast/labels?id=): 라벨을 뽑을지 묻는다 (D-UX3-19). 프린터 연결·라벨 디자인·출력 기기는 그 위에 따로 쌓는 화면이다
// (/new-broadcast/label-step?step=, D-LABEL-ROUTE-01). 끝나면 방송 화면.
// 링크 화면은 잇기를 기다리지 않고 이 화면을 연다 (D-LINK-ASYNC-01): 잇기가 끝나야 방송 화면으로 가고, 못 이으면 링크 화면으로 돌아가 까닭을 본다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { useLabelFlowRoute } from '../../src/lib/label-flow-nav.ts'
import { LabelSetupScreen } from '../../src/screens/LabelSetupScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { RouteFrame } from '../../src/ui/kit/route-frame.tsx'

export default function NewBroadcastLabelsRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { session } = useSession()
  const flow = useLabelFlowRoute(useRouter(), id, 'ask')
  if (session.state === 'out' || typeof id !== 'string') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame selfTop>
      <LabelSetupScreen step="ask" focused={flow.focused} openStep={flow.openStep} onBack={flow.back} onDone={flow.done} />
    </RouteFrame>
  )
}
