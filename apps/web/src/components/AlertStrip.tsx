// 알림 띠 (AC-S05-30, D-088): 충돌 · 취소 요청 · 승계 결정 필요 · 보류 찜 · 확인 필요. 0인 항목은 숨기고, 모두 0이면 "알림 없음".
import type { AlertCounts } from '../lib/derive.ts'
import { ALERT_WORD } from '../lib/words.ts'

export type AlertKind = 'conflict' | 'cancelRequests' | 'succession' | 'pending' | 'attention'

/** Alt+1이 여는 순서 (D-087): 충돌 → 취소 요청 → 승계 결정 필요 → 확인 필요 */
export function firstAlert(counts: AlertCounts): AlertKind | null {
  if (counts.conflict > 0) return 'conflict'
  if (counts.cancelRequest > 0) return 'cancelRequests'
  if (counts.succession > 0) return 'succession'
  if (counts.attention > 0) return 'attention'
  return null
}

export function AlertStrip({ counts, onOpen }: { readonly counts: AlertCounts; readonly onOpen: (kind: AlertKind) => void }) {
  const items: { kind: AlertKind; word: string; count: number }[] = [
    { kind: 'conflict', word: ALERT_WORD.conflict, count: counts.conflict },
    { kind: 'cancelRequests', word: ALERT_WORD.cancelRequest, count: counts.cancelRequest },
    { kind: 'succession', word: ALERT_WORD.succession, count: counts.succession },
    { kind: 'pending', word: ALERT_WORD.pending, count: counts.pending },
    { kind: 'attention', word: ALERT_WORD.attention, count: counts.attention },
  ]
  const shown = items.filter((item) => item.count > 0)
  return (
    <section className="alerts" aria-label="알림">
      {shown.length === 0 ? (
        <p className="alerts-none">알림 없음</p>
      ) : (
        <ul className="alerts-list">
          {shown.map((item) => (
            <li key={item.kind}>
              <button type="button" className={item.kind === 'pending' ? 'button alert-item alert-soft' : 'button alert-item'} onClick={() => onOpen(item.kind)}>
                {item.word} {item.count}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
