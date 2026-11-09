// 새 방송 1단계 경로 (/new-broadcast): 판매 종류 고르기 (D-UX3-09). 쌓인 화면 — 밀어서 뒤로 가기가 된다.
import { Redirect, useRouter } from 'expo-router'
import { newBroadcastNav } from '../../src/lib/new-broadcast-nav.ts'
import { NewBroadcastCategoryScreen } from '../../src/screens/NewBroadcastScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { RouteFrame } from '../../src/ui/kit/route-frame.tsx'

export default function NewBroadcastRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  // 위 안전 영역은 FormPage가 직접 띄운다
  return (
    <RouteFrame selfTop>
        <NewBroadcastCategoryScreen nav={newBroadcastNav(router)} />
      </RouteFrame>
  )
}
