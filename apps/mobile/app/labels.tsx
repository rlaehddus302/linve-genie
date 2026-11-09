// 라벨 프린터 화면 (D-UX3-39): 탭이 아니라 뒤로 가기가 있는 화면 — 전체 탭·홈 "라벨 뽑기"·방송 화면·시작 안내에서 연다. 전에는 아래 탭 "라벨"이었다(D-UX3-01).
import { Redirect, useRouter } from 'expo-router'
import { LabelsScreen } from '../src/screens/LabelsScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function LabelsRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
        <LabelsScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </RouteFrame>
  )
}
