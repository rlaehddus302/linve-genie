// 알림 띠 (AC-S05-30, D-088·D-I1-08): 충돌 · 취소 요청 · 승계 결정 필요 · 출력 멈춤 · 버릴 라벨 · 보류 찜 · 확인 필요. 0인 항목은 숨기고 모두 0이면 "알림 없음".
// 출력 기기 없음(라벨이 쌓이는데 찍는 기기가 없음)은 띠 아래 짧은 줄 — "라벨이 안 나가요 · 프린터를 연결해 주세요"(D-QL3R1-04).
import { View } from 'react-native'
import type { QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import type { AlertCounts } from '../../lib/derive.ts'
import { ALERTS_NONE, ALERT_WORD, NO_STATION_SHORT, PRINT_ALERT_WORD } from '../../lib/words.ts'
import { Body, Notice, Row, Tag } from '../../ui/parts.tsx'

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

export function AlertStrip({ counts, queue, rehearsal, ended }: { readonly counts: AlertCounts; readonly queue: QueueSummary | null; readonly rehearsal: boolean; readonly ended: boolean }) {
  const items = alertItems(counts, queue, rehearsal)
  return (
    <View aria-label="알림" role="region" style={{ gap: 6 }}>
      {items.length === 0 ? (
        <Body muted>{ALERTS_NONE}</Body>
      ) : (
        <Row wrap>
          {items.map((item) => (
            <Tag key={item.key} tone={item.tone}>
              {item.text}
            </Tag>
          ))}
        </Row>
      )}
      {noStation(queue, rehearsal, ended) ? (
        <Notice tone="danger" alert>
          {NO_STATION_SHORT}
        </Notice>
      ) : null}
    </View>
  )
}
