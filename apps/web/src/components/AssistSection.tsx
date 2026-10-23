// 설정의 "AI 제안" 칸 (A1 CMT-06, D-A1-06·07, AC-A1-22).
// - 옵션 방송을 쓰는 판매자에게만 보인다: 판매 방식 기본이 "상품명·옵션도 받기"(claim.parseMode = OPTIONS)이거나 옵션 방송 기록이 있다
//   (GET /api/option-broadcasts/exists). 번호로만 받는 판매자의 설정 화면은 지금과 같다(CMT-07). 보조자에게는 칸이 없다.
// - 서버에 키가 없으면 "지금은 쓸 수 없어요."만(스위치 없음).
// - 꺼짐: 상태 글 "꺼져 있어요" + 고지 문장 + 동의 칸 "위 내용을 읽었고 동의해요" + 스위치(접근성 이름 "AI 제안 받기", 보이는 글은 누르면 될 일 [켜기] — D-A1-18,
//   동의 전엔 누를 수 없다). 켜면 동의를 함께 보낸다.
// - 켜짐: "켜져 있어요 · 오늘 N번 썼어요 (하루 L번까지)"와 [끄기](확인 창 없이 바로). 다시 켤 때는 동의를 다시 받는다.
import { useEffect, useId, useState } from 'react'
import { get, type ApiError } from '../api/client.ts'
import { ASSIST_CONSENT, ASSIST_NOTICE, ASSIST_OFF_BUTTON, ASSIST_OFF_STATE, ASSIST_ON, ASSIST_ON_BUTTON, ASSIST_SWITCH, ASSIST_UNAVAILABLE, useAssistSettings } from '../lib/assist.ts'
import { ErrorNote } from './ErrorNote.tsx'

/** 옵션 방송이 하나라도 있는가 (참/거짓만 주는 가벼운 조회 — 실패하면 거짓: 칸이 하나 덜 보일 뿐, 판매 방식이 옵션이면 그대로 보인다) */
function useHasOptionBroadcasts(ask: boolean): boolean | null {
  const [known, setKnown] = useState<boolean | null>(null)
  useEffect(() => {
    if (!ask || known !== null) return
    let alive = true
    void get<{ exists?: unknown }>('/api/option-broadcasts/exists').then(
      (view) => {
        if (alive) setKnown(view.exists === true)
      },
      () => {
        if (alive) setKnown(false)
      },
    )
    return () => {
      alive = false
    }
  }, [ask, known])
  return known
}

/** 이 판매자에게 AI 제안 칸을 보이는가 (판매 방식이 옵션이면 바로, 아니면 옵션 방송 기록을 물어서) */
export function useShowAssist(optionsMode: boolean | null, assistant: boolean): boolean {
  const ask = !assistant && optionsMode === false
  const has = useHasOptionBroadcasts(ask)
  if (assistant) return false
  return optionsMode === true || has === true
}

export function AssistSection() {
  const handle = useAssistSettings(true)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ readonly error: ApiError; readonly enabled: boolean } | null>(null)
  const consentId = useId()
  const noticeId = useId()
  const current = handle.current

  const send = async (enabled: boolean) => {
    if (busy) return
    setBusy(true)
    setProblem(null)
    try {
      const error = await handle.change(enabled, enabled && consent)
      if (error !== null) setProblem({ error, enabled })
      // 켜거나 끈 뒤엔 동의 칸을 비운다 — 다시 켤 때 다시 동의를 받는다
      else setConsent(false)
    } finally {
      setBusy(false)
    }
  }

  if (current.state === 'hidden') return null
  if (current.state === 'loading') return <p role="status">불러오는 중…</p>
  if (current.state === 'error') return <ErrorNote error={current.error} onRetry={() => void handle.reload()} retryLabel="다시 불러오기" />
  const settings = current.settings
  if (!settings.available) return <p>{ASSIST_UNAVAILABLE}</p>
  return (
    <div className="stack-tight assist-section">
      {settings.enabled ? (
        <>
          <p className="assist-state" role="status">
            {ASSIST_ON(settings.usedToday, settings.dailyLimit)}
          </p>
          <p className="hint">{ASSIST_NOTICE}</p>
          <div className="row">
            <button type="button" className="button" disabled={busy} onClick={() => void send(false)}>
              {ASSIST_OFF_BUTTON}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="assist-state" role="status">
            {ASSIST_OFF_STATE}
          </p>
          <p id={noticeId}>{ASSIST_NOTICE}</p>
          <label className="choice" htmlFor={consentId}>
            <input id={consentId} type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
            <span>{ASSIST_CONSENT}</span>
          </label>
          <div className="row">
            <button
              type="button"
              role="switch"
              aria-checked={false}
              aria-label={ASSIST_SWITCH}
              aria-describedby={noticeId}
              className="button assist-switch"
              disabled={busy || !consent}
              onClick={() => void send(true)}
            >
              {ASSIST_ON_BUTTON}
            </button>
          </div>
          {!consent ? <p className="hint">동의 칸을 체크하면 켤 수 있어요.</p> : null}
        </>
      )}
      {problem !== null ? <ErrorNote error={problem.error} {...(problem.error.transient || problem.error.network ? { onRetry: () => void send(problem.enabled) } : {})} /> : null}
    </div>
  )
}
