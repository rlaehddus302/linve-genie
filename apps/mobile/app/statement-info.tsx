// 정산 정보 경로 (전체 탭 "정산 정보"에서 연다, D-RETRO-60): 정산서에 찍는 계좌·전화번호·방송 이름·배송비.
import { Redirect, useRouter } from 'expo-router'
import { StatementInfoScreen } from '../src/screens/StatementInfo.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function StatementInfoRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  // 위 안전 영역은 FormPage가 직접 띄운다
  return (
    <RouteFrame selfTop>
      <StatementInfoScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))} />
    </RouteFrame>
  )
}
