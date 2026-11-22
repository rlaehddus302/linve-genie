// 새 방송 3단계 경로 (/new-broadcast/labels?id=): 라벨을 뽑을지 묻고 프린터 연결·라벨 꾸미기·테스트 인쇄 (D-UX3-19). 끝나면 방송 화면.
// 링크 화면은 잇기를 기다리지 않고 이 화면을 연다 (D-LINK-ASYNC-01): 잇기가 끝나야 방송 화면으로 가고, 못 이으면 링크 화면으로 돌아가 까닭을 본다.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { newBroadcastNav } from '../../src/lib/new-broadcast-nav.ts'
import { markNewLiveStarted, newLinkSettled } from '../../src/lib/new-link.ts'
import { LabelSetupScreen } from '../../src/screens/LabelSetupScreen.tsx'
import { useSession } from '../../src/services.tsx'
import { RouteFrame } from '../../src/ui/kit/route-frame.tsx'

export default function NewBroadcastLabelsRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { session } = useSession()
  const router = useRouter()
  const nav = newBroadcastNav(router)
  const navRef = useRef(nav)
  navRef.current = nav
  const leaving = useRef(false)
  // 못 이었으면 링크 화면(바로 아래 쌓인 화면)으로 — 그 화면이 옮길까요·처음 채널·오류를 보인다. 먼저 뒤로 나갔으면 아무것도 하지 않는다
  useEffect(() => {
    if (typeof id !== 'string') return
    let here = true
    void newLinkSettled(id).then((result) => {
      if (here && result === 'failed') navRef.current.back()
    })
    return () => {
      here = false
    }
  }, [id])
  if (session.state === 'out' || typeof id !== 'string') return <Redirect href="/" />
  if (session.state !== 'in') return null
  // 잇기가 끝난 뒤에 방송 화면으로 (두 번 눌러도 한 번만). 못 이었으면 위에서 링크 화면으로 돌아간다
  const done = () => {
    if (leaving.current) return
    leaving.current = true
    void newLinkSettled(id).then((result) => {
      if (result === 'ok') {
        // 라이브 화면으로 가며 새 라이브 화면들이 닫힌다 — 링크 화면이 이 회차의 연결을 끊지 않게 먼저 알린다 (D-DRAFT-02)
        markNewLiveStarted(id)
        nav.openConsole(id)
      }
      else leaving.current = false
    })
  }
  return (
    <RouteFrame selfTop>
      <LabelSetupScreen onBack={nav.back} onDone={done} />
    </RouteFrame>
  )
}
