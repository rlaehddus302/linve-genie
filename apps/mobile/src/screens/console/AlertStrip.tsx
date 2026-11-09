// 알림 (AC-S05-30, D-088·D-I1-08, D-UX2-03): 충돌 · 취소 요청 · 승계 결정 필요 · 출력 멈춤 · 버릴 라벨 · 보류 찜 · 확인 필요. 방송 중 화면은 상품 줄에 없는 것만 한 줄로 보이고 모두 0이면 숨긴다.
// 출력 기기 없음(라벨이 쌓이는데 찍는 기기가 없음)은 띠 아래 짧은 줄 — "라벨이 안 나가요 · 프린터를 연결해 주세요"(D-QL3R1-04).
import { View } from 'react-native'
import type { QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import type { AlertCounts } from '../../lib/derive.ts'
import { ALERT_WORD, NO_STATION_SHORT, PRINT_ALERT_WORD } from '../../lib/words.ts'
import { Txt, useKit, Tap } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, pressedFill } from '../../ui/kit/tokens.ts'

export interface AlertItem {
  readonly key: string
  readonly text: string
  readonly tone: 'warning' | 'danger' | 'info'
}

/** 띠 항목 (Alt+1 순서와 같다: 충돌 → 취소 요청 → 승계 → 출력 멈춤 → 버릴 라벨 → 보류 찜 → 확인 필요) */
export function alertItems(counts: AlertCounts, queue: QueueSummary | null, rehearsal: boolean): AlertItem[] {
  const out: AlertItem[] = []
  if (counts.conflict > 0) out.push({ key: 'conflict', text: `${ALERT_WORD.conflict} ${String(counts.conflict)}`, tone: 'danger' })
  if (counts.cancelRequest > 0) out.push({ key: 'cancel', text: `${ALERT_WORD.cancelRequest} ${String(counts.cancelRequest)}`, tone: 'warning' })
  if (counts.succession > 0) out.push({ key: 'succession', text: `${ALERT_WORD.succession} ${String(counts.succession)}`, tone: 'warning' })
  if (!rehearsal && queue !== null) {
    if (queue.pause !== null) out.push({ key: 'pause', text: `${PRINT_ALERT_WORD.paused} · ${queue.pause.message}`, tone: 'danger' })
    if (queue.discard > 0) out.push({ key: 'discard', text: `${PRINT_ALERT_WORD.discard} ${String(queue.discard)}장`, tone: 'warning' })
  }
  if (counts.pending > 0) out.push({ key: 'pending', text: `${ALERT_WORD.pending} ${String(counts.pending)}`, tone: 'info' })
  if (counts.attention > 0) out.push({ key: 'attention', text: `${ALERT_WORD.attention} ${String(counts.attention)}`, tone: 'warning' })
  return out
}

/** 라벨이 쌓이는데 출력 기기가 없거나 끊겼다 (실제 방송·라벨 켬·대기 있음) */
export function noStation(queue: QueueSummary | null, rehearsal: boolean, ended: boolean): boolean {
  if (rehearsal || ended || queue === null || !queue.labelsEnabled) return false
  if (queue.waiting + queue.printing === 0) return false
  return queue.device === null || !queue.device.live || !queue.device.printerConnected
}

/** 눌렀을 때 할 일 — 보류 찜 목록·확인 필요 화면·정하기·라벨(프린터) 화면 */
export type AlertAction = 'pending' | 'attention' | 'decide' | 'labels'

const ACTION: Readonly<Record<string, AlertAction>> = { conflict: 'decide', cancel: 'decide', succession: 'decide', pause: 'labels', discard: 'labels', pending: 'pending', attention: 'attention', station: 'labels' }

/**
 * 리스트 위 경고 칸 (D-LIVETEST-07): 한 줄에 작은 칸으로 — 칸마다 눌러서 바로 처리한다.
 * 보류 찜 → 보류 찜 목록, 확인 필요 → 확인 필요 화면, 충돌·취소 요청·승계 → 정하기, 출력 멈춤·버릴 라벨·라벨 안 나감 → 라벨·프린터 화면.
 * 모두 없으면 아무것도 그리지 않는다.
 */
export function AlertStrip({ counts, queue, rehearsal, ended, onAction }: { readonly counts: AlertCounts; readonly queue: QueueSummary | null; readonly rehearsal: boolean; readonly ended: boolean; readonly onAction: (action: AlertAction) => void }) {
  const { p, tones } = useKit()
  const items = alertItems(counts, queue, rehearsal)
  if (noStation(queue, rehearsal, ended)) items.unshift({ key: 'station', text: `${NO_STATION_SHORT} ›`, tone: 'danger' })
  if (items.length === 0) return null
  return (
    <View aria-label="알림" role="region" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
      {items.map((item) => {
        const pair = tones[item.tone]
        return (
          <Tap key={item.key} role="button" aria-label={item.text} onPress={() => onAction(ACTION[item.key] ?? 'pending')} style={({ pressed }) => ({ paddingVertical: 6, paddingHorizontal: SPACE.md, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: pressed ? pressedFill(p, pair.bg) : pair.bg })}>
            <Txt step="caption" weight="bold" ink={pair.fg}>{item.text}</Txt>
          </Tap>
        )
      })}
    </View>
  )
}
