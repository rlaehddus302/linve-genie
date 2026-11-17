// 휴대폰 안 손글씨 읽기 연결 (D-HANDWRITE-02) — 아이폰은 기기 글자 읽기, 안드로이드는 ML Kit(처음 한 번 한국어 모델을 받는다).
// 앱을 켤 때 production.tsx가 네이티브 모듈을 끼운다. 모듈이 없는 빌드(이 모듈 전 앱·웹·시험)는 null — [손글씨] 단추를 숨긴다.
// 획은 휴대폰 밖으로 보내지 않는다.
import { useSyncExternalStore } from 'react'
import type { InkNative } from '@livejjim/mobile-ink'
import { flattenInk, type InkStroke } from './handwriting.ts'

export const INK_LANGUAGE = 'ko'

let reader: InkNative | null = null
let ready: Promise<boolean> | null = null
const listeners = new Set<() => void>()

export function wireInkReader(next: InkNative | null): void {
  reader = next
  ready = null
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const current = (): InkNative | null => reader

/** 손글씨를 읽을 수 있는 앱인가 (모듈이 있는가) */
export function useInkReader(): boolean {
  return useSyncExternalStore(subscribe, current, current) !== null
}

/** 읽을 준비 — 한 번만 (실패하면 다음에 다시 해 본다) */
export function prepareInk(): Promise<boolean> {
  const now = reader
  if (now === null) return Promise.resolve(false)
  if (ready === null) {
    const trying = now.prepare(INK_LANGUAGE).then((ok) => ok, () => false)
    ready = trying
    void trying.then((ok) => {
      if (!ok && ready === trying) ready = null
    })
  }
  return ready
}

/** 획을 읽는다 → 후보 글. 준비가 안 됐거나 못 읽으면 빈 목록 */
export async function readInk(strokes: readonly InkStroke[], width: number, height: number, hints: readonly string[]): Promise<string[]> {
  const now = reader
  if (now === null || strokes.length === 0) return []
  if (!(await prepareInk())) return []
  try {
    const out = await now.recognize(flattenInk(strokes), width, height, INK_LANGUAGE, hints)
    return Array.isArray(out) ? out.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
