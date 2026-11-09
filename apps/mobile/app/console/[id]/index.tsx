// 방송 중 경로 (/console/<방송 ID>). 로그인이 풀리면 첫 화면으로. 방송을 끝내면 홈으로 돌아간다. 아래 고정 버튼이 홈 막대를 피하도록 아래 안전 영역을 넘긴다.
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ConsoleScreen } from '../../../src/screens/ConsoleScreen.tsx'
import { useSession } from '../../../src/services.tsx'
import { RouteFrame } from '../../../src/ui/kit/route-frame.tsx'

export default function ConsoleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useSession()
  const router = useRouter()
  // 방송 연결 화면(쌓인 화면)에서 돌아오면 잇기 상태를 다시 받게 올린다 (D-UX3-09)
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
  // 홈으로: 홈 위에 쌓였으면 돌아가고(홈이 다시 보일 때 방송 목록을 다시 받는다), 아니면 홈으로 바꾼다. 방송을 끝낸 뒤에도 같은 길 (D-UX2-07)
  const home = () => (router.canGoBack() ? router.back() : router.replace('/'))
  return (
    // 상품 추가·방송 관리는 진짜 쌓인 화면이라(D-UX4-57) 방송 화면은 다른 경로처럼 상태 막대 아래에서 시작한다 (D-UX4-51 되돌림)
    <RouteFrame>
        <ConsoleScreen broadcastId={id} seller onBack={home} onEnded={home} refresh={visits} openLink={(closed) => router.push({ pathname: '/link/[id]', params: { id, ...(closed ? { closed: '1' } : {}) } })} openReviews={() => router.push(`/reviews?broadcast=${encodeURIComponent(id)}`)} openLabels={() => router.push('/labels?from=console')} openAdd={() => router.push({ pathname: '/console/[id]/add', params: { id } })} openManage={() => router.push({ pathname: '/console/[id]/manage', params: { id } })} />
      </RouteFrame>
  )
}
