// 라이브 시작 라벨 단계 경로들의 이동 (D-LABEL-ROUTE-01, 사용자 지시 2026-11-23 "라벨 프린터를 연결해 주세요 화면은 … 별도 화면으로 분리해"):
// 묻기(/new-broadcast/labels) 위에 프린터 연결·라벨 디자인·출력 기기(/new-broadcast/label-step?step=)를 하나씩 쌓는다 — 뒤로는 휴대폰 화면 쌓기가 한다.
// 링크 화면은 잇기를 기다리지 않고 라벨 단계를 연다 (D-LINK-ASYNC-01): 다 하면 잇기가 끝난 뒤 방송 화면으로,
// 못 이으면 맨 아래 묻기 화면이 쌓인 라벨 화면을 모두 걷어 링크 화면(바로 아래)으로 돌아가 까닭을 본다.
import { useFocusEffect, type useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LabelFlowStep } from '../screens/LabelSetupScreen.tsx'
import { newBroadcastNav } from './new-broadcast-nav.ts'
import { markNewLiveStarted, newLinkSettled } from './new-link.ts'

/** 묻기 위에 쌓여 있는 라벨 화면 수 (못 이었을 때 한꺼번에 걷는다) */
let stacked = 0

export function useLabelFlowRoute(router: ReturnType<typeof useRouter>, id: string | undefined, step: LabelFlowStep) {
  const nav = newBroadcastNav(router)
  const navRef = useRef(nav)
  navRef.current = nav
  const routerRef = useRef(router)
  routerRef.current = router
  const leaving = useRef(false)
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )
  useEffect(() => {
    if (step === 'ask') return
    stacked += 1
    return () => {
      stacked -= 1
    }
  }, [step])
  // 못 이었으면 링크 화면으로 — 그 화면이 옮길까요·처음 채널·오류를 보인다. 묻기 화면(맨 아래)만 맡는다. 먼저 뒤로 나갔으면 아무것도 하지 않는다
  useEffect(() => {
    if (step !== 'ask' || typeof id !== 'string') return
    let here = true
    void newLinkSettled(id).then((result) => {
      if (!here || result !== 'failed') return
      if (stacked > 0) routerRef.current.dismiss(stacked + 1)
      else navRef.current.back()
    })
    return () => {
      here = false
    }
  }, [id, step])
  const openStep = (next: LabelFlowStep) => {
    if (typeof id === 'string') router.push({ pathname: '/new-broadcast/label-step', params: { id, step: next } })
  }
  // 잇기가 끝난 뒤에 방송 화면으로 (두 번 눌러도 한 번만). 못 이었으면 위에서 링크 화면으로 돌아간다
  const done = () => {
    if (leaving.current || typeof id !== 'string') return
    leaving.current = true
    void newLinkSettled(id).then((result) => {
      if (result === 'ok') {
        // 라이브 화면으로 가며 새 라이브 화면들이 닫힌다 — 링크 화면이 이 회차의 연결을 끊지 않게 먼저 알린다 (D-DRAFT-02)
        markNewLiveStarted(id)
        navRef.current.openConsole(id)
      } else leaving.current = false
    })
  }
  return { focused, openStep, back: nav.back, done }
}
