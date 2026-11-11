// 홈 맨 위 "새 버전이 준비됐어요" (D-OTA-01): 받아 둔 새 화면이 있을 때만. [나중에]는 왼쪽, [지금 바꾸기]는 오른쪽(D-UX4-01).
// [지금 바꾸기]는 앱을 잠깐 다시 켠다 — 사장님이 누를 때만. [나중에]면 다음에 앱을 켤 때 저절로 바뀐다.
import { View } from 'react-native'
import { useAppUpdate } from '../lib/app-update.ts'
import { BigButton, ButtonRow, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'

export const UPDATE_READY_TITLE = '새 버전이 준비됐어요'
export const UPDATE_READY_SUB = '바꾸면 앱이 잠깐 다시 켜져요. 나중에 하면 다음에 앱을 켤 때 바뀌어요.'

export function UpdateReady() {
  const { p } = useKit()
  const { ready, apply, later } = useAppUpdate()
  if (!ready) return null
  return (
    <View role="group" aria-label={UPDATE_READY_TITLE} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', padding: SPACE.lg, gap: SPACE.md }}>
      <View style={{ gap: SPACE.xs }}>
        <Txt step="title" weight="bold">{UPDATE_READY_TITLE}</Txt>
        <Txt step="caption" color="textSub">{UPDATE_READY_SUB}</Txt>
      </View>
      <ButtonRow>
        <BigButton key="later" kind="secondary" label="나중에" onPress={later} />
        <BigButton key="apply" label="지금 바꾸기" onPress={apply} />
      </ButtonRow>
    </View>
  )
}
