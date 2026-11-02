// 가벼운 손맛(햅틱, D-UX3-07): 아래 탭처럼 "눌렸다"를 손끝으로도 알리는 곳. 기기에서만 — production이 expo-haptics를 끼운다. 시험·웹은 아무 일 없음.
let tap: () => void = () => {}

export function setHaptic(fn: () => void): void {
  tap = fn
}

export function tapHaptic(): void {
  try {
    tap()
  } catch {
    // 손맛은 못 줘도 된다
  }
}
