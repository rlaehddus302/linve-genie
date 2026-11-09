// 방송 화면 맨 아래 창 고르기 (D-UX4-71, 사용자 지시 2026-11-10 "화면 밑에 음성인식을 보여줄건지 채팅문자를 보여줄건지 아무것도 안 보여줄건지 관리에서 선택"):
// 들린 말(기본) · 채팅·문자 · 안 보기. 이 휴대폰에만 둔다(앱 저장소 — 서버로 보내지 않는다). 듣기 자체는 고른 것과 상관없이 그대로다.
import { useSyncExternalStore } from 'react'

export type DockChoice = 'voice' | 'talk' | 'none'

/** 고르는 줄마다 한 줄 설명 (D-UX4-89, 사용자 지시 2026-11-10 "화면 아래 창 설명 좀 추가해봐") */
export const DOCK_CHOICES: readonly { readonly value: DockChoice; readonly label: string; readonly description: string }[] = [
  { value: 'voice', label: '들린 말', description: '라이브에서 알아들은 말을 바로 보여줘요' },
  { value: 'talk', label: '채팅·문자', description: '손님이 보낸 채팅과 문자를 바로 보여줘요' },
  { value: 'none', label: '안 보기', description: '아래 창 없이 목록을 넓게 봐요' },
]

/** 관리 화면 줄 이름 */
export const DOCK_TITLE = '화면 아래 창'
/** 아래 창 제목 밑 설명 (D-UX4-89) — 듣기는 고른 것과 상관없이 그대로라는 것도 알린다 */
export const DOCK_DESCRIPTION = '라이브 화면 맨 아래에 무엇을 띄울지 골라요.\n어느 것을 골라도 듣기는 계속돼요.'

export const DOCK_CHOICE_KEY = 'livejjim.console.dock'

export const dockLabel = (choice: DockChoice): string => DOCK_CHOICES.find((item) => item.value === choice)?.label ?? '들린 말'

const isChoice = (value: unknown): value is DockChoice => value === 'voice' || value === 'talk' || value === 'none'

/** 앱 저장소에서 쓰는 부분 (AsyncStorage) */
export interface DockChoiceStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

let current: DockChoice = 'voice'
let storage: DockChoiceStorage | null = null
const listeners = new Set<() => void>()

export const getDockChoice = (): DockChoice => current

export function subscribeDockChoice(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setDockChoice(next: DockChoice): void {
  if (!isChoice(next) || next === current) return
  current = next
  for (const listener of listeners) listener()
  void storage?.setItem(DOCK_CHOICE_KEY, next).catch(() => undefined)
}

/** 앱을 켤 때 한 번: 저장한 값을 되살리고, 바꿀 때마다 쓴다. 저장소가 실패해도 기본(들린 말)으로 간다 */
export async function wireDockChoice(store: DockChoiceStorage): Promise<void> {
  storage = store
  try {
    const saved = await store.getItem(DOCK_CHOICE_KEY)
    if (isChoice(saved) && saved !== current) {
      current = saved
      for (const listener of listeners) listener()
    }
  } catch {
    // 못 읽으면 기본
  }
}

/** 시험용: 처음 상태로 */
export function resetDockChoice(): void {
  current = 'voice'
  storage = null
  for (const listener of listeners) listener()
}

/** 지금 고른 아래 창 */
export const useDockChoice = (): DockChoice => useSyncExternalStore(subscribeDockChoice, getDockChoice, getDockChoice)
