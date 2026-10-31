// 라벨 화면 안에서 다른 칸으로 바로 가기 (PRN2 UX-PRN2-002·003): 프린터 칸·멈춤 띠의 단추가 내보내기·라벨 설정 칸을 열고 그리로 옮긴다.
// 칸들은 서로 형제라 상태를 나누지 않고 창(window) 알림 하나로 부른다 — 받는 칸이 없으면(마법사 등) 아무 일도 없다.

const OPEN_FILES = 'livejjim:open-label-files'
const PICK_SIZE = 'livejjim:pick-label-size'

export type LabelKind = 'product' | 'packing'

/** 내보내기의 "라벨마다 그림 파일로 저장" 목록을 펼치고 그리로 */
export function requestLabelFiles(): void {
  window.dispatchEvent(new Event(OPEN_FILES))
}

export function onLabelFiles(listener: () => void): () => void {
  window.addEventListener(OPEN_FILES, listener)
  return () => window.removeEventListener(OPEN_FILES, listener)
}

/** 라벨 설정의 "라벨 크기" 칸(그 종류)으로 */
export function requestPickLabelSize(kind: LabelKind): void {
  window.dispatchEvent(new CustomEvent<LabelKind>(PICK_SIZE, { detail: kind }))
}

export function onPickLabelSize(listener: (kind: LabelKind) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<LabelKind>).detail === 'packing' ? 'packing' : 'product')
  window.addEventListener(PICK_SIZE, handle)
  return () => window.removeEventListener(PICK_SIZE, handle)
}

/** 요소를 화면에 보이고 초점을 준다 (jsdom처럼 scrollIntoView가 없으면 초점만) */
export function bringIntoView(element: HTMLElement | null, focus: HTMLElement | null = element): void {
  if (element === null) return
  element.scrollIntoView?.({ block: 'start' })
  focus?.focus({ preventScroll: true })
}
