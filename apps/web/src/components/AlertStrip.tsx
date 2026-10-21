// 알림 띠 (AC-S05-30, AC-S06-61, AC-I1-32, AC-I3-30, D-088·D-I1-08): 충돌 · 취소 요청 · 승계 결정 필요 · 출력 멈춤(까닭 문장) · 버릴 라벨 · 보류 찜 · 확인 필요 · 감사 실패.
// 0인 항목은 숨기고, 모두 0이면 "알림 없음". 출력 멈춤·버릴 라벨은 판매자의 출력 기록(모든 기기 같음)이다.
// "감사 실패"는 판매자가 할 일이 있는 감사 발송 실패만 센다(동의하지 않음·방송을 잇지 않음은 세지 않는다 — D-I3-05).
// 휴대폰에서는 한 줄로 접히고("알림 5 펼치기") 펼친 동안만 늘어난다. 접은 동안에도 알림 항목은 그대로 있다(한 줄에 들어가는 것만 보인다) —
// 펼치기 버튼은 "알림" 영역 밖에 둔다(영역의 글자는 PC와 같다).
import type { AlertCounts } from '../lib/derive.ts'
import { PRINT_ALERT_WORD } from '../lib/print-words.ts'
import { ALERT_WORD } from '../lib/words.ts'

export type AlertKind = 'conflict' | 'cancelRequests' | 'succession' | 'printPause' | 'discard' | 'pending' | 'attention' | 'thanks' | 'reviews'

/** 알림 띠 낱말 "감사 실패" (AC-I3-30) */
export const THANKS_FAILED_WORD = '감사 실패'

/** 출력 알림 (판매자의 출력 기록): 멈춘 까닭 문장(멈추지 않았으면 null)·버릴 라벨 장 수 */
export interface PrintAlerts {
  readonly pause: string | null
  readonly discard: number
}

const NO_PRINT_ALERTS: PrintAlerts = { pause: null, discard: 0 }

/** Alt+1이 여는 순서 (D-087·D-I1-08, AC-I3-30): 충돌 → 취소 요청 → 승계 결정 필요 → 출력 멈춤 → 버릴 라벨 → 확인 필요 → 감사 실패 */
export function firstAlert(counts: AlertCounts, print: PrintAlerts = NO_PRINT_ALERTS, thanksFailed = 0): AlertKind | null {
  if (counts.conflict > 0) return 'conflict'
  if (counts.cancelRequest > 0) return 'cancelRequests'
  if (counts.succession > 0) return 'succession'
  if (print.pause !== null) return 'printPause'
  if (print.discard > 0) return 'discard'
  if (counts.attention > 0) return 'attention'
  if (thanksFailed > 0) return 'thanks'
  return null
}

export interface AlertStripProps {
  readonly counts: AlertCounts
  readonly print?: PrintAlerts
  /** 감사 실패 수 (리허설·유튜브 없는 서버는 0) */
  readonly thanksFailed?: number
  /** 이 방송의 확인 필요 항목 수 (옵션 방송만 — "확인 필요 n건", 누르면 확인 필요 목록, D-O2-03) */
  readonly reviews?: number
  readonly onOpen: (kind: AlertKind) => void
  /** 휴대폰에서 펼쳤는가 */
  readonly expanded?: boolean
  readonly onToggle?: () => void
}

export function AlertStrip({ counts, print = NO_PRINT_ALERTS, thanksFailed = 0, reviews = 0, onOpen, expanded = false, onToggle }: AlertStripProps) {
  const items: { kind: AlertKind; word: string; count: number; text?: string }[] = [
    { kind: 'conflict', word: ALERT_WORD.conflict, count: counts.conflict },
    { kind: 'cancelRequests', word: ALERT_WORD.cancelRequest, count: counts.cancelRequest },
    { kind: 'succession', word: ALERT_WORD.succession, count: counts.succession },
    { kind: 'printPause', word: PRINT_ALERT_WORD.paused, count: print.pause === null ? 0 : 1, text: `${PRINT_ALERT_WORD.paused} · ${print.pause ?? ''}` },
    { kind: 'discard', word: PRINT_ALERT_WORD.discard, count: print.discard },
    { kind: 'pending', word: ALERT_WORD.pending, count: counts.pending },
    { kind: 'attention', word: ALERT_WORD.attention, count: counts.attention },
    { kind: 'thanks', word: THANKS_FAILED_WORD, count: thanksFailed },
    { kind: 'reviews', word: ALERT_WORD.attention, count: reviews, text: `${ALERT_WORD.attention} ${String(reviews)}건` },
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
                  {item.text ?? `${item.word} ${String(item.count)}`}
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
