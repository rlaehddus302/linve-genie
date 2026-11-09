// 프린터 고르기 창의 내용 (APP-03) — 찾은 기기를 판매자가 고르기 쉽게: 가까운(신호 센) 프린터가 위, 기기 이름 아래에 기종 이름·신호 낱말.
// 이름 없는 기기는 보이지 않는다(무엇인지 알 수 없다). 어떤 기기를 넣을지·차례·낱말은 @livejjim/mobile-ble pickEntries가 정한다 — 여기는 보이기만.
// 기기 이름은 블루투스로 받은 글이라 글자로만 보인다(react-native Text — HTML로 풀지 않는다).
// 줄에 '기본·실험' 꼬리표를 달지 않는다 (D-UX3-19, 사용자 지시 2026-11-03 — 옛: 실험 기종 줄에 "실험" 꼬리표). 어느 프린터든 연결 뒤 테스트 인쇄로 확인한다.
// 토스식 다듬기 (D-UX3-94): 기기마다 큰 초록 단추를 쌓던 것을 줄(이름 · 기종·신호 · ›)로, 닫기는 아래 회색 단추 하나.
import type { PickEntry } from '@livejjim/mobile-ble'
import { ActivityIndicator, View } from 'react-native'
import { BigButton, Icon, Txt, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'

export const PICK_TITLE = '라벨 프린터를 골라 주세요'
export const PICK_SEARCHING = '가까운 프린터를 찾고 있어요. 프린터 전원을 켜 주세요.'
export const PICK_ORDER_HINT = '가까운 프린터가 위에 있어요. 프린터에 붙은 이름과 같은지 확인해 주세요.'

export function PrinterPickList({ entries, onPick, onClose }: { readonly entries: readonly PickEntry[]; readonly onPick: (entry: PickEntry) => void; readonly onClose: () => void }) {
  const { p } = useKit()
  return (
    <View role="group" aria-label="라벨 프린터 고르기" style={{ gap: SPACE.xl }}>
      <View style={{ gap: SPACE.sm }}>
        <Txt step="headline" weight="heavy" role="heading" aria-level={1}>
          {PICK_TITLE}
        </Txt>
        <Txt color="textSub">{entries.length === 0 ? PICK_SEARCHING : PICK_ORDER_HINT}</Txt>
      </View>
      {entries.length === 0 ? (
        <View style={{ paddingVertical: SPACE.xl, alignItems: 'center' }}>
          <ActivityIndicator color={p.textSub} />
        </View>
      ) : (
        <View style={{ marginHorizontal: -SPACE.sm }}>
          {entries.map((entry) => (
            <Tap key={entry.device.id} role="button" aria-label={`${entry.title} — ${entry.detail}`} onPress={() => onPick(entry)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: TOUCH.button, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt step="bodyLarge" weight="book">
                  {entry.title}
                </Txt>
                <Txt step="caption" color="textSub">
                  {entry.detail}
                </Txt>
              </View>
              <Icon name="chevron" color={p.textSub} size={18} />
            </Tap>
          ))}
        </View>
      )}
      <BigButton kind="outline" label="닫기" onPress={onClose} />
    </View>
  )
}
