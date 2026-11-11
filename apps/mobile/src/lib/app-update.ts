// 앱 화면 새 버전 받기 (D-OTA-01, 사용자 지시 2026-11-12 "ui 수정하면 실제 휴대폰에 업데이트 되는데에 얼마나 걸려? 그리고 최대한 빨리하는 방법 없어?" → "네, 만들어").
// 앱을 켤 때와 뒤에 갔다 돌아올 때 운영 서버(livegenie.kr/app-updates)에 새 화면 묶음이 있는지 묻고, 있으면 조용히 받아 둔다.
// 받은 것은 다음에 앱을 켤 때 저절로 바뀐다. 그 전에 바꾸려면 홈의 [지금 바꾸기] — 사장님이 누를 때만 앱이 잠깐 다시 켜진다
// (방송·포장 중에 저절로 다시 켜지면 하던 일이 끊기니 저절로는 하지 않는다).
// 실제 받기는 expo-updates(src/native/updates.ts가 setUpdatesApi로 넣는다). 시험·개발 빌드는 넣지 않아 아무 일도 없다.
import { useEffect, useSyncExternalStore } from 'react'
import { useAppForeground } from './use-app-state.ts'

export interface UpdatesApi {
  /** 새 묶음이 있는지 묻고, 있으면 받아 둔다. 받아 둔 새 것이 있으면 true */
  readonly fetchNew: () => Promise<boolean>
  /** 받아 둔 것으로 앱을 다시 켠다 */
  readonly reload: () => Promise<void>
}

/** 뒤에 갔다 돌아올 때 너무 자주 묻지 않는다 */
export const UPDATE_CHECK_GAP_MS = 60_000

type Phase = 'idle' | 'checking' | 'ready' | 'later'

let api: UpdatesApi | null = null
let phase: Phase = 'idle'
let lastCheck = Number.NEGATIVE_INFINITY
const listeners = new Set<() => void>()

function setPhase(next: Phase): void {
  if (phase === next) return
  phase = next
  for (const listener of listeners) listener()
}

export function setUpdatesApi(next: UpdatesApi | null): void {
  api = next
}

/** 시험용: 처음 상태로 */
export function resetAppUpdate(): void {
  api = null
  lastCheck = Number.NEGATIVE_INFINITY
  setPhase('idle')
}

/** 새 묶음을 묻고 받아 둔다. 실패(인터넷 없음·서버 오류)는 조용히 넘긴다 — 다음에 다시 묻는다 */
export async function checkAppUpdate(now: number): Promise<void> {
  const current = api
  if (current === null || phase !== 'idle' || now - lastCheck < UPDATE_CHECK_GAP_MS) return
  lastCheck = now
  setPhase('checking')
  const found = await current.fetchNew().catch(() => false)
  setPhase(found ? 'ready' : 'idle')
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 앱 뿌리에 한 번: 켤 때·앞으로 돌아올 때 묻는다 */
export function useAppUpdateWatch(): void {
  useEffect(() => {
    void checkAppUpdate(Date.now())
  }, [])
  useAppForeground({ onForeground: () => void checkAppUpdate(Date.now()) })
}

export interface AppUpdateState {
  /** 받아 둔 새 버전이 있고 [나중에]를 누르지 않았다 */
  readonly ready: boolean
  readonly apply: () => void
  readonly later: () => void
}

export function useAppUpdate(): AppUpdateState {
  const now = useSyncExternalStore(subscribe, () => phase, () => phase)
  return {
    ready: now === 'ready',
    apply: () => void api?.reload().catch(() => undefined),
    later: () => setPhase('later'),
  }
}
