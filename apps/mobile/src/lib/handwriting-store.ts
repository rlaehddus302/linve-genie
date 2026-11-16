// 손글씨 설정·배운 모양 (D-HANDWRITE-01): 이 휴대폰에만 둔다(앱 저장소 — 서버로 보내지 않는다).
// - 멈추면 바로 넣기 (기본 꺼짐 — 판매자가 [넣기]로 확인하는 쪽이 안전)
// - 배운 모양: 판매자가 후보를 눌러 고친 글씨. 숫자마다 몇 개, 정규화한 점 32개뿐(획 원본·시각·화면 내용 없음)
import { useSyncExternalStore } from 'react'
import { addLearned, makeTemplate, packLearned, unpackLearned, type DigitTemplate, type InkStroke } from './handwriting.ts'
import { baseTemplates } from './handwriting-templates.ts'

export const HANDWRITING_KEY = 'livegenie.handwriting.v1'

/** 앱 저장소에서 쓰는 부분 (AsyncStorage) */
export interface HandwritingStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

interface HandwritingState {
  readonly autoInsert: boolean
  readonly learned: readonly DigitTemplate[]
  readonly templates: readonly DigitTemplate[]
}

const fresh = (): HandwritingState => ({ autoInsert: false, learned: [], templates: baseTemplates() })

let state: HandwritingState = fresh()
let storage: HandwritingStorage | null = null
const listeners = new Set<() => void>()

function set(next: { readonly autoInsert: boolean; readonly learned: readonly DigitTemplate[] }, save = true): void {
  state = { ...next, templates: next.learned === state.learned ? state.templates : [...baseTemplates(), ...next.learned] }
  for (const listener of listeners) listener()
  if (save) void storage?.setItem(HANDWRITING_KEY, JSON.stringify({ autoInsert: state.autoInsert, learned: packLearned(state.learned) })).catch(() => undefined)
}

export function subscribeHandwriting(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getHandwriting = (): HandwritingState => state

export function useHandwriting(): HandwritingState {
  return useSyncExternalStore(subscribeHandwriting, getHandwriting, getHandwriting)
}

export function setAutoInsert(on: boolean): void {
  if (on !== state.autoInsert) set({ autoInsert: on, learned: state.learned })
}

/** 고친 글씨를 배운다 (빈 목록이면 아무 일 없음) */
export function learnDigits(items: readonly { readonly digit: string; readonly strokes: readonly InkStroke[] }[]): void {
  if (items.length === 0) return
  set({ autoInsert: state.autoInsert, learned: addLearned(state.learned, items.map((item) => makeTemplate(item.digit, item.strokes))) })
}

/** 배운 모양을 모두 잊는다 */
export function forgetLearned(): void {
  if (state.learned.length > 0) set({ autoInsert: state.autoInsert, learned: [] })
}

/** 앱을 켤 때 한 번: 저장한 값을 되살리고, 바꿀 때마다 쓴다. 못 읽으면 기본(꺼짐·배운 것 없음) */
export async function wireHandwriting(store: HandwritingStorage): Promise<void> {
  storage = store
  try {
    const raw = await store.getItem(HANDWRITING_KEY)
    if (raw === null) return
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
    const saved = parsed as { autoInsert?: unknown; learned?: unknown }
    set({ autoInsert: saved.autoInsert === true, learned: unpackLearned(typeof saved.learned === 'string' ? saved.learned : null) }, false)
  } catch {
    // 못 읽으면 기본
  }
}

/** 시험마다 처음으로 */
export function resetHandwriting(): void {
  storage = null
  state = fresh()
  for (const listener of listeners) listener()
}
