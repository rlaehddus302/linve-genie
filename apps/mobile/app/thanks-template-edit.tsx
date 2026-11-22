// 찜 감사 채팅 양식 직접 만들기 경로 (/thanks-template-edit, D-THANKS-FMT-01): 블록을 꾹 눌러 옮기고 사이사이에 글자를 넣는다. 저장하면 양식 화면으로 돌아간다.
import { Redirect, useRouter } from 'expo-router'
import { ThanksTemplateEditor } from '../src/screens/ThanksTemplateScreen.tsx'
import { useSession } from '../src/services.tsx'
import { RouteFrame } from '../src/ui/kit/route-frame.tsx'

export default function ThanksTemplateEditRoute() {
  const { session } = useSession()
  const router = useRouter()
  if (session.state === 'out') return <Redirect href="/" />
  if (session.state !== 'in') return null
  const back = () => (router.canGoBack() ? router.back() : router.replace('/thanks-template'))
  return (
    <RouteFrame>
      <ThanksTemplateEditor onBack={back} onSaved={back} />
    </RouteFrame>
  )
}
