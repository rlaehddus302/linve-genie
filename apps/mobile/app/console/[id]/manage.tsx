// 방송 관리 경로 (/console/<방송 ID>/manage, D-UX4-57): 방송 화면 위에 진짜로 쌓인다. 방송 연결·프린터는 이 위에 또 쌓는다.
// 방송을 끝내면 해당 방송의 판매 명세로 돌아간다. 라벨 줄(D-UX4-130)은 한 단계 화면(/label-setup?step=)·출력 상태(/labels)를 바로 쌓는다.
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ManageScreen } from '../../../src/screens/console/StackScreens.tsx'
import { useSession } from '../../../src/services.tsx'
import { RouteFrame } from '../../../src/ui/kit/route-frame.tsx'

export default function ManageRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useSession()
  const router = useRouter()
  // 방송 연결 화면에서 돌아오면 잇기 상태를 다시 받게 올린다 (D-UX3-09)
  const [visits, setVisits] = useState(0)
  const first = useRef(true)
  useFocusEffect(
    useCallback(() => {
      if (first.current) first.current = false
      else setVisits((count) => count + 1)
    }, []),
  )
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/console/[id]', params: { id } }))
  return (
    <RouteFrame>
        <ManageScreen broadcastId={id} onBack={back} refresh={visits} openLink={(closed) => router.push({ pathname: '/link/[id]', params: { id, ...(closed ? { closed: '1' } : {}) } })} labels={{ openStep: (step) => router.push({ pathname: '/label-setup', params: { step } }), openStatus: () => router.push('/labels?from=console'), openDirect: () => router.push({ pathname: '/console/[id]/print-history', params: { id, mode: 'direct' } }), openHistory: () => router.push({ pathname: '/console/[id]/print-history', params: { id } }) }} onEnded={() => router.dismissTo({ pathname: '/console/[id]', params: { id, ended: '1' } })} />
      </RouteFrame>
  )
}
