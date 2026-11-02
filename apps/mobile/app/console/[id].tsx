// 방송 중 경로 (/console/<방송 ID>). 로그인이 풀리면 첫 화면으로. 방송을 끝내면 홈으로 돌아간다. 아래 고정 버튼이 홈 막대를 피하도록 아래 안전 영역을 넘긴다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ConsoleScreen } from '../../src/screens/ConsoleScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { PALETTE } from '../../src/ui/kit/tokens.ts'
import { KitInsets } from '../../src/ui/kit/safe-area.tsx'

export default function ConsoleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in' || typeof id !== 'string') return null
  const seller = session.me.role !== 'ASSISTANT'
  // 홈으로: 홈 위에 쌓였으면 돌아가고(홈이 다시 보일 때 방송 목록을 다시 받는다), 아니면 홈으로 바꾼다. 방송을 끝낸 뒤에도 같은 길 (D-UX2-07)
  const home = () => (router.canGoBack() ? router.back() : router.replace('/'))
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: PALETTE.light.background }} edges={['top']}>
      <KitInsets>
        <ConsoleScreen broadcastId={id} seller={seller} onBack={home} onEnded={home} {...(seller ? { openReviews: (rehearsal: boolean) => router.push(`/reviews?broadcast=${encodeURIComponent(id)}${rehearsal ? '&rehearsal=true' : ''}`), openLabels: () => router.push('/labels?from=console') } : {})} />
      </KitInsets>
    </SafeAreaView>
  )
}
