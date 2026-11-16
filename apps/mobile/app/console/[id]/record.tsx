// 끝난 라이브 기록 경로 (/console/<방송 ID>/record, D-UX4-157): 정산 내역서 오른쪽 위 [라이브 기록]이 다른 쌓인 화면처럼 오른쪽에서 밀려 들어오게 연다.
// 뒤로(머리 ‹ · 안드로이드 뒤로 단추 · 아이폰 왼쪽 끝 밀기)는 아래 정산 내역서로 돌아간다 — 휴대폰 화면 쌓기가 그대로 한다. 옛: 같은 화면 안에서 애니메이션 없이 바뀌고 뒤로는 홈.
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { ConsoleScreen } from '../../../src/screens/ConsoleScreen.tsx'
import { useSession } from '../../../src/services.tsx'
import { RouteFrame } from '../../../src/ui/kit/route-frame.tsx'

export default function ConsoleRecordRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useSession()
  const router = useRouter()
  // 쌓인 화면에서 돌아오면 잇기 상태를 다시 받게 올린다 (방송 화면 경로와 같음, D-UX3-09)
  const [visits, setVisits] = useState(0)
  const [focused, setFocused] = useState(true)
  const first = useRef(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      if (first.current) first.current = false
      else setVisits((count) => count + 1)
      return () => setFocused(false)
    }, []),
  )
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  // 정산 내역서로: 그 위에 쌓였으면 돌아가고, 아니면(바로 열린 주소) 정산 내역서로 바꾼다
  const sales = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/console/[id]', params: { id } }))
  return (
    <RouteFrame>
      <ConsoleScreen broadcastId={id} seller startPage="record" onBack={sales} focused={focused} refresh={visits} openLink={(closed) => router.push({ pathname: '/link/[id]', params: { id, ...(closed ? { closed: '1' } : {}) } })} openReviews={() => router.push(`/reviews?broadcast=${encodeURIComponent(id)}`)} openLabels={() => router.push('/labels?from=console')} openAdd={() => router.push({ pathname: '/console/[id]/add', params: { id } })} openAddAt={(no) => router.push({ pathname: '/console/[id]/add', params: { id, no: String(no) } })} openManage={() => router.push({ pathname: '/console/[id]/manage', params: { id } })} openStatement={(buyer) => router.push({ pathname: '/console/[id]/statement', params: { id, buyer } })} openSearch={() => router.push({ pathname: '/console/[id]/search', params: { id } })} />
    </RouteFrame>
  )
}
