// 찜 감사 채팅 양식 경로 (/thanks-template, D-THANKS-FMT-01): 라이브 관리 "찜 감사 채팅 양식"이 쌓아 연다. [직접 만들기]는 /thanks-template-edit를 또 쌓는다.
import { Redirect, useRouter } from 'expo-router'
import { ThanksTemplateScreen } from '../src/screens/ThanksTemplateScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function ThanksTemplateRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  return (
    <RouteFrame>
      <ThanksTemplateScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} openCustom={() => router.push('/thanks-template-edit')} />
    </RouteFrame>
  )
}
