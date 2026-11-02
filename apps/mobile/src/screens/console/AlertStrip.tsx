// 알림 (AC-S05-30, D-088·D-I1-08, D-UX2-03): 충돌 · 취소 요청 · 승계 결정 필요 · 출력 멈춤 · 버릴 라벨 · 보류 찜 · 확인 필요. 방송 중 화면은 상품 줄에 없는 것만 한 줄로 보이고 모두 0이면 숨긴다.
// 출력 기기 없음(라벨이 쌓이는데 찍는 기기가 없음)은 띠 아래 짧은 줄 — "라벨이 안 나가요 · 프린터를 연결해 주세요"(D-QL3R1-04).
import { View } from 'react-native'
import type { QueueSummary } from '@livejjim/web/src/api/print-types.ts'
import type { AlertCounts } from '../../lib/derive.ts'
import { ALERT_WORD, NO_STATION_SHORT, PRINT_ALERT_WORD } from '../../lib/words.ts'
import { BigButton } from '../../ui/kit/index.ts'
import { Notice } from '../../ui/parts.tsx'

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

/**
 * 리스트 위 경고 한 줄 (D-UX2-03): 상품 줄에 이미 보이는 충돌·승계는 빼고, 나머지(취소 요청·출력 멈춤·버릴 라벨·보류 찜·확인 필요)만 한 줄로.
 * 모두 없으면 아무것도 그리지 않는다. 라벨이 안 나가면 그 아래 한 줄.
 */
export function AlertStrip({ counts, queue, rehearsal, ended, onReviews }: { readonly counts: AlertCounts; readonly queue: QueueSummary | null; readonly rehearsal: boolean; readonly ended: boolean; readonly onReviews?: () => void }) {
  const items = alertItems(counts, queue, rehearsal).filter((item) => item.key !== 'conflict' && item.key !== 'succession')
  const station = noStation(queue, rehearsal, ended)
  if (items.length === 0 && !station) return null
  return (
    <View aria-label="알림" role="region" style={{ gap: 6 }}>
      {items.length > 0 ? (
        <Notice tone={items.some((item) => item.tone === 'danger') ? 'danger' : 'warning'}>{`확인할 것: ${items.map((item) => item.text).join(' · ')}`}</Notice>
      ) : null}
      {counts.attention > 0 && onReviews !== undefined ? <BigButton kind="outline" label="확인 필요 보기" onPress={onReviews} /> : null}
      {station ? (
        <Notice tone="danger" alert>
          {NO_STATION_SHORT}
        </Notice>
      ) : null}
    </View>
  )
}
