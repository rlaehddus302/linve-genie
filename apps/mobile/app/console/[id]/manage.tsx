// 방송 관리 경로 (/console/<방송 ID>/manage, D-UX4-57): 방송 화면 위에 진짜로 쌓인다. 방송 연결·프린터는 이 위에 또 쌓는다.
// 방송을 끝내면 홈으로 돌아간다(쌓인 방송 화면까지 걷는다).
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useRef, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ManageScreen } from '../../../src/screens/console/StackScreens.tsx'
import { useSession } from '../../../src/services.tsx'
import { PALETTE } from '../../../src/ui/kit/tokens.ts'
import { KitInsets } from '../../../src/ui/kit/safe-area.tsx'

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
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <ManageScreen broadcastId={id} onBack={back} refresh={visits} openLink={(closed) => router.push({ pathname: '/link/[id]', params: { id, ...(closed ? { closed: '1' } : {}) } })} openLabels={() => router.push('/label-print')} openTool={(tool) => router.push({ pathname: '/console/[id]/tool/[name]', params: { id, name: tool } })} />
      </KitInsets>
    </SafeAreaView>
  )
}
