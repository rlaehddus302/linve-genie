// 설정 화면의 "라벨" 절 (N4a, SPEC RCP-01·§7 화면 8, LABEL_RULES L-12 1·2·6·7, D-N4a-01·02·05, AC-N4a-10~12·18).
// 다른 트랙이 설정 화면에 절을 더하기 쉽게 이 절 하나를 독립 컴포넌트로 둔다.
// - 지금 상태를 글자로("라벨 기능: 켜짐/꺼짐" — 색만으로 구분하지 않는다), 버튼 하나("라벨 끄기"/"라벨 켜기" — 보통 버튼), 설명 문장.
// - 끌 때는 확인 창 "라벨 기능 끄기"(처음 포커스 "닫기", 숫자 키 1 = 라벨 끄기, 대기 중인 라벨이 있으면 그 장 수). 켤 때는 창 없이 보내고 알린다.
// - 저장된 뒤에만 바뀐 상태·알림 문장을 보인다(NFR-03). 실패하면 서버 문장과 다시 해 볼 길, 상태는 그대로. 보내는 동안 버튼은 눌리지 않는다.
// - 창을 닫거나 조치를 마치면 포커스는 누른 버튼 자리(바뀐 버튼)로 돌아온다.
// - "바꾼 기록": 최근 20줄, 새것 먼저 — `2026-10-20 (화) 20:31 · 라벨 끔 · <로그인 아이디>` (KST, 연도·요일까지, D-102).
// - 다른 기기에서 바꾸면 실시간 labels 알림으로 상태·버튼·바꾼 기록이 1초 안에 바뀐다(저장소가 덮는다).
import { useEffect, useId, useRef, useState } from 'react'
import { isApiError, type ApiError } from '../api/client.ts'
import type { LabelSwitchEntry } from '../api/print-types.ts'
import { kstDayMinute } from '../lib/kst.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import { useLabelSettings, usePrintApi, usePrintState } from './print-context.tsx'

export const LABEL_SWITCH_HELP =
  '끄면 라벨 화면·프린터 연결·자동 출력·다시 출력·포장 라벨 출력·라벨 그림 파일 내려받기가 모두 숨겨져요. 판매 판정과 감사 메시지는 그대로예요. 방송 중에 바꿔도 바꾼 때부터 적용돼요.'
export const LABELS_TURNED_OFF = '라벨 기능을 껐어요.'
export const LABELS_TURNED_ON = "라벨 기능을 켰어요. 끈 동안 1등이 된 상품의 라벨은 저절로 출력되지 않아요. 필요하면 상품에서 '라벨 출력'을 눌러 주세요."
/** 끄기 확인 창의 묻는 문장 */
export const LABELS_OFF_QUESTION = '라벨 기능을 끌까요? 끈 뒤에 1등이 된 상품의 라벨은 출력하지 않고, 라벨 버튼이 모든 기기에서 사라져요.'
export const NO_SWITCH_HISTORY = '아직 바꾼 기록이 없어요.'

/** 끄기 확인 창: 대기 중인 라벨이 있을 때 (L-12 6·7) */
export function offWaitingWord(count: number): string {
  return `출력 대기 중인 라벨 ${String(count)}장은 출력하지 않고 남겨 둬요. 다시 켜면 '출력 시작'을 눌러 이어서 출력할 수 있어요.`
}

/** 바꾼 기록 한 줄 `2026-10-20 (화) 20:31 · 라벨 끔 · shop1` */
export function switchEntryWord(entry: LabelSwitchEntry): string {
  return `${kstDayMinute(entry.at)} · ${entry.enabled ? '라벨 켬' : '라벨 끔'} · ${entry.loginId}`
}

/** 라벨 기능의 지금 상태 (글자로) */
export const switchStateWord = (enabled: boolean): string => `라벨 기능: ${enabled ? '켜짐' : '꺼짐'}`

export function LabelSwitchSection() {
  const titleId = useId()
  const historyId = useId()
  const api = usePrintApi()
  const print = usePrintState()
  const snapshot = useLabelSettings()
  const settings = snapshot.settings
  const enabled = settings?.enabled ?? null
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 실패한 보내기 (보내려던 값) */
  const [failed, setFailed] = useState<{ readonly error: ApiError; readonly enabled: boolean } | null>(null)
  /** 마친 조치 (그 값일 때만 알림 문장을 보인다 — 다른 기기가 다시 바꾸면 지난 문장을 두지 않는다) */
  const [done, setDone] = useState<boolean | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  /** 포커스를 버튼으로 돌려놓을 차례 (창이 닫히고·버튼이 다시 눌릴 수 있게 된 뒤) */
  const [refocus, setRefocus] = useState(0)

  useEffect(() => {
    if (refocus > 0) button.current?.focus()
  }, [refocus])

  // 확인 창을 연 사이 다른 기기가 껐다: 물을 것이 없다
  useEffect(() => {
    if (asking && enabled === false) {
      setAsking(false)
      setFailed(null)
      setRefocus((n) => n + 1)
    }
  }, [asking, enabled])

  const send = async (next: boolean) => {
    if (api === null || busy) return
    setBusy(true)
    setFailed(null)
    setDone(null)
    let refocusButton = true
    try {
      await api.store.saveLabelsEnabled(next)
      setDone(next)
      setAsking(false)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setFailed({ error: caught, enabled: next })
      // 끄기 실패는 확인 창 안에 보인다 — 포커스는 창 안에 둔다 (창의 "라벨 끄기"가 다시 해 볼 길)
      refocusButton = next
    } finally {
      setBusy(false)
      if (refocusButton) setRefocus((n) => n + 1)
    }
  }

  const close = () => {
    setAsking(false)
    setFailed(null)
    setRefocus((n) => n + 1)
  }

  const waiting = print.overview?.queue.waiting ?? settings?.waiting ?? 0

  return (
    <section className="card stack label-switch" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        라벨
      </h2>
      {settings === null ? (
        snapshot.phase === 'error' && snapshot.error !== null ? (
          <ErrorNote error={snapshot.error} onRetry={() => api?.store.reloadLabelSettings()} retryLabel="다시 시도" />
        ) : (
          <p role="status">불러오는 중…</p>
        )
      ) : (
        <>
          <p className="switch-state">{switchStateWord(settings.enabled)}</p>
          <div className="row">
            <button
              ref={button}
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                if (settings.enabled) {
                  setFailed(null)
                  setAsking(true)
                } else void send(true)
              }}
            >
              {settings.enabled ? '라벨 끄기' : '라벨 켜기'}
            </button>
          </div>
          <p className="hint">{LABEL_SWITCH_HELP}</p>
          {busy && !asking ? <p role="status">보내는 중…</p> : null}
          {done !== null && done === settings.enabled ? <p role="status">{done ? LABELS_TURNED_ON : LABELS_TURNED_OFF}</p> : null}
          {failed !== null && !asking ? <ErrorNote error={failed.error} onRetry={() => void send(failed.enabled)} retryLabel="다시 시도" /> : null}
          <h3 id={historyId} className="sub-title">
            바꾼 기록
          </h3>
          {settings.history.length === 0 ? (
            <p>{NO_SWITCH_HISTORY}</p>
          ) : (
            <ol className="plain-list switch-history" aria-labelledby={historyId}>
              {settings.history.map((entry, index) => (
                <li key={`${entry.at}|${String(index)}`}>{switchEntryWord(entry)}</li>
              ))}
            </ol>
          )}
        </>
      )}
      {asking ? (
        <Modal
          title="라벨 기능 끄기"
          onClose={close}
          actions={
            <button type="button" className="button button-primary" data-key="1" disabled={busy} onClick={() => void send(false)}>
              <span aria-hidden="true">1 </span>라벨 끄기
            </button>
          }
        >
          <p>{LABELS_OFF_QUESTION}</p>
          {waiting > 0 ? <p>{offWaitingWord(waiting)}</p> : null}
          {busy ? <p role="status">보내는 중…</p> : null}
          {failed !== null ? <ErrorNote error={failed.error} /> : null}
        </Modal>
      ) : null}
    </section>
  )
}
