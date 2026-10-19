// 화면 폭이 PC(768px 이상)인가 (D-I4-03): 음성 카드를 빠른 입력칸과 함께 고정 영역에 두고 Enter로 등록하는지 가른다.
import { useSyncExternalStore } from 'react'
import { WIDE_MIN_WIDTH } from './voice.ts'

const QUERY = `(min-width: ${String(WIDE_MIN_WIDTH)}px)`

function media(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
}

function subscribe(listener: () => void): () => void {
  const list = media()
  if (list === null) {
    window.addEventListener('resize', listener)
    return () => window.removeEventListener('resize', listener)
  }
  list.addEventListener('change', listener)
  return () => list.removeEventListener('change', listener)
}

function snapshot(): boolean {
  const list = media()
  return list === null ? window.innerWidth >= WIDE_MIN_WIDTH : list.matches
}

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, snapshot)
}
