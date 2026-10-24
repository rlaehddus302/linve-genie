// 로그아웃 버튼과 확인 창 (MOB1 D-MOB1-05, AC-MOB1-05·06).
// - 자리: 휴대폰(48rem 미만) 판매자는 "더보기" 목록 맨 끝("설정" 다음), PC·보조자는 위 줄 그대로 — 자리는 TopBar가 정한다.
// - 누르면 끝내지 않은 방송(실제·리허설)이 있는지 그때 한 번 받아 본다. 위험하면(끝내지 않은 방송이 있음 · 이 기기가 출력 기기 · 확인하지 못함)
//   창 "로그아웃할까요?"를 띄운다 — 처음 포커스는 "로그인 유지"(누르거나 Esc면 닫기만). 그 밖이면 지금처럼 바로 로그아웃한다.
// - 확인하지 못하면 묻는 쪽이 안전하다 — 묻지 않고 로그아웃하지 않는다. 보조자 계정은 묻지 않는다(지금 그대로).
// - 답을 기다리는 동안 (D-MOB1-15, AC-MOB1-06): LOGOUT_WAIT_MS 안에 답이 오면(실패 포함) 위 규칙 그대로. 그 안에 답이 없으면
//   그때 바로 "확인하지 못했어요." 창을 띄운다. 창이 뜬 뒤에는 어떤 답이 와도 저절로 로그아웃하지 않는다 — 본문만 바꾼다
//   (위험하면 그 문장들, 위험이 없으면 "끝내지 않은 방송이 없어요."). 제목·버튼·포커스는 그대로이고 판매자가 "로그아웃"을 눌러야 끝난다.
//   창을 닫은 뒤(또는 화면을 떠난 뒤) 온 답은 버린다. 짧게 기다리는 까닭은 빠른 망에서 위험 없는 로그아웃마다 창이 번쩍이지 않게 하려는 것이다.
// - 창 자리 (D-MOB1-16): 휴대폰 폭에서는 이 창만 화면 아래쪽에 붙인다(엄지 쪽 — "더보기" 맨 끝에서 열기 때문). PC는 위쪽 그대로.
import { useEffect, useRef, useState } from 'react'
import { get } from '../api/client.ts'
import type { BroadcastItem } from '../api/types.ts'
import { Modal } from './Modal.tsx'
import { labelsEnabledOf } from '../lib/print-store.ts'
import { usePrintApi, usePrintState } from './print-context.tsx'

export const LOGOUT_TITLE = '로그아웃할까요?'
export const LOGOUT_KEEP = '로그인 유지'
export const LOGOUT_LIVE = '아직 끝내지 않은 방송이 있어요. 로그아웃하면 이 기기에서는 다시 로그인해야 찜·채팅을 볼 수 있어요. 방송과 찜은 그대로예요.'
export const LOGOUT_STATION = '이 기기가 라벨을 출력하는 기기예요. 로그아웃하면 라벨 출력이 멈춰요.'
export const LOGOUT_UNKNOWN = '방송 중인지 확인하지 못했어요.'
/** 창이 뜬 뒤 늦게 온 답이 "위험 없음"일 때의 본문 (D-MOB1-15) */
export const LOGOUT_NONE = '끝내지 않은 방송이 없어요.'
/** 방송 목록 답을 이만큼 기다린 뒤에도 없으면 "확인하지 못함" 창을 먼저 띄운다 (ms) */
export const LOGOUT_WAIT_MS = 700

export interface LogoutRiskInput {
  /** 방송 목록 (받지 못했으면 null) */
  readonly broadcasts: readonly Pick<BroadcastItem, 'ended'>[] | null
  /** 이 기기가 출력 기기인가 (라벨 켜짐일 때만 true) */
  readonly station: boolean
}

/** 확인 창에 보일 문장 (차례대로). 빈 목록이면 묻지 않고 바로 로그아웃한다 */
export function logoutRisks({ broadcasts, station }: LogoutRiskInput): readonly string[] {
  const lines: string[] = []
  if (broadcasts === null) lines.push(LOGOUT_UNKNOWN)
  else if (broadcasts.some((item) => !item.ended)) lines.push(LOGOUT_LIVE)
  if (station) lines.push(LOGOUT_STATION)
  return lines
}

export interface LogoutButtonProps {
  readonly onLogout: () => void
  /** 보조자 계정 — 묻지 않는다 */
  readonly assistant: boolean
  readonly className: string
}

export function LogoutButton({ onLogout, assistant, className }: LogoutButtonProps) {
  const api = usePrintApi()
  const print = usePrintState()
  const [checking, setChecking] = useState(false)
  const [lines, setLines] = useState<readonly string[] | null>(null)
  // 누를 때마다 하나씩 — 창을 닫거나 화면을 떠나면 바뀌어 늦게 온 답을 버린다
  const turn = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 이번 누름에서 창이 이미 떴는가 — 떴으면 늦은 답으로 저절로 로그아웃하지 않는다
  const shown = useRef(false)

  const stopTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(
    () => () => {
      turn.current += 1
      stopTimer()
    },
    [],
  )

  const station = (): boolean => {
    if (api === null || labelsEnabledOf(print) !== true) return false
    const queue = print.overview?.queue ?? null
    return queue !== null && api.station.isMine(queue)
  }

  const close = () => {
    turn.current += 1
    shown.current = false
    stopTimer()
    setChecking(false)
    setLines(null)
  }

  const press = async () => {
    if (checking || lines !== null) return
    if (assistant) {
      onLogout()
      return
    }
    turn.current += 1
    const mine = turn.current
    shown.current = false
    setChecking(true)
    stopTimer()
    timer.current = setTimeout(() => {
      timer.current = null
      if (turn.current !== mine) return
      shown.current = true
      setLines(logoutRisks({ broadcasts: null, station: station() }))
    }, LOGOUT_WAIT_MS)
    let broadcasts: readonly BroadcastItem[] | null
    try {
      broadcasts = (await get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')).broadcasts
    } catch {
      broadcasts = null
    }
    if (turn.current !== mine) return
    stopTimer()
    setChecking(false)
    const risks = logoutRisks({ broadcasts, station: station() })
    if (shown.current) {
      // 창이 떠 있다 — 판매자가 끝맺는다. 본문만 맞춘다
      setLines(risks.length === 0 ? [LOGOUT_NONE] : risks)
      return
    }
    if (risks.length === 0) onLogout()
    else {
      shown.current = true
      setLines(risks)
    }
  }

  return (
    <>
      <button type="button" className={className} disabled={checking} onClick={() => void press()}>
        로그아웃
      </button>
      {lines === null ? null : (
        <Modal
          title={LOGOUT_TITLE}
          onClose={close}
          closeLabel={LOGOUT_KEEP}
          unlocked
          phoneBottom
          actions={
            <button
              type="button"
              className="button button-danger"
              onClick={() => {
                close()
                onLogout()
              }}
            >
              로그아웃
            </button>
          }
        >
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Modal>
      )}
    </>
  )
}
