// 방송 중 경로 (/console/<방송 ID>). 로그인이 풀리면 첫 화면으로. 방송을 끝내면 홈으로 돌아간다. 아래 고정 버튼이 홈 막대를 피하도록 아래 안전 영역을 넘긴다.
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { View } from 'react-native'
import { ConsoleScreen } from '../../src/screens/ConsoleScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { PALETTE } from '../../src/ui/kit/tokens.ts'
import { KitInsets } from '../../src/ui/kit/safe-area.tsx'

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
    // 상태 막대까지 방송 화면이 그린다 (D-UX4-51): 위에 겹쳐 뜨는 상품 추가·방송 관리 화면이 상태 막대 바탕까지 덮어야 한다 — 방송 화면은 맨 위에 상태 막대만큼 띄운다
    <View style={{ flex: 1, backgroundColor: PALETTE.light.background }}>
      <KitInsets belowStatusBar={false}>
        <ConsoleScreen broadcastId={id} seller onBack={home} onEnded={home} refresh={visits} openLink={(closed) => router.push({ pathname: '/link/[id]', params: { id, ...(closed ? { closed: '1' } : {}) } })} openReviews={() => router.push(`/reviews?broadcast=${encodeURIComponent(id)}`)} openLabels={() => router.push('/labels?from=console')} />
      </KitInsets>
    </View>
  )
}
