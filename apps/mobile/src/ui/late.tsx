// 서버에서 받은 뒤에야 생기는 묶음은 부드럽게 (D-UX4-112, 사용자 지시 2026-11-10 "서버에서 불러오느라 늦게 뜨는 것은 늦게 뜰 때
// 부드럽게 페이드인 되면서 위로 올라오는 애니메이션 (다른 항목에도 전역으로 똑같이 적용)").
// <Late>{있으면 ? <묶음 /> : null}</Late> — 화면이 처음 그려질 때 이미 있던 것(기억해 둔 자료)은 바로 보이고,
// 비어 있다가(불러오는 중) 나중에 생기면 Appear로 옅게 나타나며 조금 아래에서 올라온다. 한 번 비었다가 다시 생겨도 같다.
import { useState, type ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { Appear } from './kit/index.ts'

/** 이 자리가 처음 그려질 때 아직 없었거나, 그 뒤 한 번이라도 비었으면 참 — 그 뒤에 생기는 것은 늦게 온 것 */
export function useCameLate(ready: boolean): boolean {
  const [late, setLate] = useState(!ready)
  if (!ready && !late) setLate(true)
  return late
}

const isEmpty = (node: ReactNode): boolean => node === null || node === undefined || node === false || node === '' || (Array.isArray(node) && node.length === 0)

/** 안의 것이 없으면 아무것도 그리지 않고, 늦게 생기면 부드럽게 보인다 */
export function Late({ children, style, testID }: { readonly children?: ReactNode; readonly style?: StyleProp<ViewStyle>; readonly testID?: string }) {
  const has = !isEmpty(children)
  const late = useCameLate(has)
  if (!has) return null
  return (
    <Appear instant={!late} style={style} testID={testID}>
      {children}
    </Appear>
  )
}
