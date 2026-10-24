// 알림 띠 (AC-S05-30, AC-S06-61, AC-I1-32, AC-I3-30, D-088·D-I1-08): 충돌 · 취소 요청 · 승계 결정 필요 · 출력 멈춤(까닭 문장) · 버릴 라벨 · 보류 찜 · 확인 필요 · 감사 실패.
// 0인 항목은 숨기고, 모두 0이면 "알림 없음". 맨 앞에는 플랫폼 줄(틱톡 알림 줄·인스타그램 알림·붙여넣기 결과, N2b-2)이 붙는다. 출력 멈춤·버릴 라벨은 판매자의 출력 기록(모든 기기 같음)이다.
// "감사 실패"는 판매자가 할 일이 있는 감사 발송 실패만 센다(동의하지 않음·방송을 잇지 않음은 세지 않는다 — D-I3-05).
// 출력 기기 항목(끊김·출력 기기 없음 — MOB1 D-MOB1-08, `uncounted`)은 띠 맨 끝, 세는 알림 모두의 뒤에 붙는다(D-MOB1-14 — 접힌 휴대폰 띠에서
// 빨간 "출력 멈춤"을 가리지 않게). 플랫폼 줄은 그대로 맨 앞. Alt+1 순서와 알림 수에는 넣지 않는다.
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

/**
 * 띠 맨 앞에 붙는 플랫폼 줄 (N2b-2, AC-N2b-2-60·62·63, UX-04): 틱톡 알림 줄 · 인스타그램 알림 · 붙여넣기 결과.
 * 고정 영역에 줄을 더하지 않고 이 띠 안에 둔다 — 휴대폰에서는 띠와 함께 한 줄로 접히고(긴 문장은 말줄임, 전문은 이름·펼치기),
 * PC에서는 문장 그대로 보인다. `onClick`이 없으면 누르는 곳이 아닌 결과 문장(role=status)이다.
 */
export interface AlertLead {
  readonly key: string
  readonly text: string
  readonly onClick?: () => void
  /** 덜 급한 알림(인스타그램 알림)은 연한 색 */
  readonly soft?: boolean
  /** 알림 수("알림 n 펼치기")에 넣지 않는다 — 출력 기기 항목(MOB1 D-MOB1-08, AC-MOB1-13) */
  readonly uncounted?: boolean
  /** 그 줄 옆의 작은 단추 (틱톡 저장 실패 "확인했어요" — D-N2b-2-16) */
  readonly action?: { readonly label: string; readonly onClick: () => void; readonly busy?: boolean }
}

export interface AlertStripProps {
  /** 띠 맨 앞의 플랫폼 줄 (없으면 지금 띠 그대로) */
  readonly leads?: readonly AlertLead[]
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

export function AlertStrip({ leads = [], counts, print = NO_PRINT_ALERTS, thanksFailed = 0, reviews = 0, onOpen, expanded = false, onToggle }: AlertStripProps) {
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
  const pressable = leads.filter((lead) => lead.onClick !== undefined && lead.uncounted !== true).length
  const total = shown.reduce((sum, item) => sum + item.count, 0) + pressable
  // 플랫폼 줄은 맨 앞, 출력 기기 항목(uncounted)은 세는 알림 모두의 뒤 — 맨 끝 (D-MOB1-14, AC-MOB1-13)
  const front = leads.filter((lead) => lead.uncounted !== true)
  const tail = leads.filter((lead) => lead.uncounted === true)
  const renderLead = (lead: AlertLead) => (
    <li key={lead.key} className={lead.action !== undefined ? 'alert-lead alert-lead-with-action' : 'alert-lead'}>
      {lead.onClick !== undefined ? (
        <button type="button" className={lead.soft === true ? 'button alert-item alert-soft alert-lead-button' : 'button alert-item alert-lead-button'} onClick={lead.onClick}>
          <span className="alert-lead-text">{lead.text}</span>
        </button>
      ) : (
        <p className="alert-lead-note" role="status">
          {lead.text}
        </p>
      )}
      {lead.action !== undefined ? (
        <button type="button" className="button alert-lead-action" aria-busy={lead.action.busy === true} disabled={lead.action.busy === true} onClick={lead.action.onClick}>
          {lead.action.label}
        </button>
      ) : null}
    </li>
  )
  return (
    <div className={expanded ? 'alert-bar alert-bar-open' : 'alert-bar'}>
      <section id="alerts" className="alerts" aria-label="알림">
        {shown.length === 0 && leads.length === 0 ? (
          <p className="alerts-none">알림 없음</p>
        ) : (
          <ul className="alerts-list">
            {front.map(renderLead)}
            {shown.map((item) => (
              <li key={item.kind}>
                <button type="button" className={item.kind === 'pending' ? 'button alert-item alert-soft' : 'button alert-item'} onClick={() => onOpen(item.kind)}>
                  {item.text ?? `${item.word} ${String(item.count)}`}
                </button>
              </li>
            ))}
            {tail.map(renderLead)}
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
