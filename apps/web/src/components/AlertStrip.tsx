// 알림 띠 (AC-S05-30, AC-S06-61, D-088): 충돌 · 취소 요청 · 승계 결정 필요 · 보류 찜 · 확인 필요. 0인 항목은 숨기고, 모두 0이면 "알림 없음".
// 휴대폰에서는 한 줄로 접히고("알림 5 펼치기") 펼친 동안만 늘어난다. 접은 동안에도 알림 항목은 그대로 있다(한 줄에 들어가는 것만 보인다) —
// 펼치기 버튼은 "알림" 영역 밖에 둔다(영역의 글자는 PC와 같다).
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

export interface AlertStripProps {
  readonly counts: AlertCounts
  readonly onOpen: (kind: AlertKind) => void
  /** 휴대폰에서 펼쳤는가 */
  readonly expanded?: boolean
  readonly onToggle?: () => void
}

export function AlertStrip({ counts, onOpen, expanded = false, onToggle }: AlertStripProps) {
  const items: { kind: AlertKind; word: string; count: number }[] = [
    { kind: 'conflict', word: ALERT_WORD.conflict, count: counts.conflict },
    { kind: 'cancelRequests', word: ALERT_WORD.cancelRequest, count: counts.cancelRequest },
    { kind: 'succession', word: ALERT_WORD.succession, count: counts.succession },
    { kind: 'pending', word: ALERT_WORD.pending, count: counts.pending },
    { kind: 'attention', word: ALERT_WORD.attention, count: counts.attention },
  ]
  const shown = items.filter((item) => item.count > 0)
  const total = shown.reduce((sum, item) => sum + item.count, 0)
  return (
    <div className={expanded ? 'alert-bar alert-bar-open' : 'alert-bar'}>
      <section id="alerts" className="alerts" aria-label="알림">
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
      {total > 0 && onToggle !== undefined ? (
        <button type="button" className="button alert-toggle" aria-expanded={expanded} aria-controls="alerts" onClick={onToggle}>
          {expanded ? `알림 ${String(total)} 접기` : `알림 ${String(total)} 펼치기`}
        </button>
      ) : null}
    </div>
  )
}
