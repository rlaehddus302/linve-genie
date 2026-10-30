// 프린터 고르기 창의 내용 (APP-03) — 찾은 기기를 판매자가 고르기 쉽게: 가까운(신호 센) 프린터가 위, 기기 이름 아래에 기종 이름·신호 낱말.
// 이름 없는 기기는 보이지 않는다(무엇인지 알 수 없다). 어떤 기기를 넣을지·차례·낱말은 @livejjim/mobile-ble pickEntries가 정한다 — 여기는 보이기만.
// 기기 이름은 블루투스로 받은 글이라 글자로만 보인다(react-native Text — HTML로 풀지 않는다).
// 실험 기종 줄(L-12 이름으로 프로필이 정해지는 줄)은 "실험" 꼬리표를 단다 — 숨기지도 확인됨처럼 보이지도 않는다(PRN2 L-7 지원 단계). NIIMBOT 줄은 표시 없음.
import type { PickEntry } from '@livejjim/mobile-ble'
import { View } from 'react-native'
import { EXPERIMENTAL_WORD } from '../lib/words.ts'
import { BigButton, Body, Card, Hint, Row, Tag } from '../ui/parts.tsx'

export const PICK_TITLE = '라벨 프린터를 골라 주세요'
export const PICK_SEARCHING = '가까운 프린터를 찾고 있어요. 프린터 전원을 켜 주세요.'
export const PICK_ORDER_HINT = '가까운 프린터가 위에 있어요. 프린터에 붙은 이름과 같은지 확인해 주세요.'

export function PrinterPickList({ entries, onPick, onClose }: { readonly entries: readonly PickEntry[]; readonly onPick: (entry: PickEntry) => void; readonly onClose: () => void }) {
  return (
    <Card label="라벨 프린터 고르기">
      <Body big bold>
        {PICK_TITLE}
      </Body>
      {entries.length === 0 ? <Hint>{PICK_SEARCHING}</Hint> : <Hint>{PICK_ORDER_HINT}</Hint>}
      {entries.map((entry) => (
        <View key={entry.device.id} style={{ gap: 4 }}>
          <BigButton label={entry.title} ariaLabel={`${entry.title} — ${entry.detail}`} onPress={() => onPick(entry)} />
          <Row wrap>
            {entry.experimental ? <Tag tone="warning">{EXPERIMENTAL_WORD}</Tag> : null}
            <Hint>{entry.detail}</Hint>
          </Row>
        </View>
      ))}
      <BigButton label="닫기" onPress={onClose} />
    </Card>
  )
}
