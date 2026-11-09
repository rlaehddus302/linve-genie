// 새 방송 3단계 경로 (/new-broadcast/labels?id=): 라벨을 뽑을지 묻고 프린터 연결·라벨 꾸미기·테스트 인쇄 (D-UX3-19). 끝나면 방송 화면.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { newBroadcastNav } from '../../src/lib/new-broadcast-nav.ts'
import { LabelSetupScreen } from '../../src/screens/LabelSetupScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { RouteFrame } from '../../src/ui/kit/route-frame.tsx'

export default function NewBroadcastLabelsRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out' || typeof id !== 'string') return <Redirect href="/" />
  if (session.state !== 'in') return null
  const nav = newBroadcastNav(router)
  return (
    <RouteFrame selfTop>
        <LabelSetupScreen onBack={nav.back} onDone={() => nav.openConsole(id)} />
      </RouteFrame>
  )
}
