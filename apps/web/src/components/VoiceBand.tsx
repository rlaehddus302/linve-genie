// 콘솔 밖 음성 띠 (V3 D-V3-52, AC-V3-58): 켠 음성은 다른 화면에서도 듣는다 — 듣는 중·방송 제목·외부 전송 짧은 고지·[끄기],
// 바로 등록 5초 [되돌리기], 확인할 카드 수와 [보기](그 방송 콘솔로). 화면 위에 붙어 휴대폰 아래 메뉴와 겹치지 않는다.
// 음성 코드는 불러오지 않는다 — 음성을 켠 적이 없으면 아무것도 그리지 않는다.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Navigate, Route } from '../lib/router.ts'
import { BAND_SENT, getVoiceSession, subscribeVoiceSession, type VoiceSession } from '../voice/session.ts'
import { SENT_NOTICE_SHORT } from '../voice/controller.ts'
import { readVoiceEngine } from '../voice/remote.ts'

export function VoiceBand({ route, navigate }: { readonly route: Route; readonly navigate: Navigate }) {
  const session = useSyncExternalStore(subscribeVoiceSession, getVoiceSession)
  return session === null ? null : <Band session={session} route={route} navigate={navigate} />
}

function Band({ session, route, navigate }: { readonly session: VoiceSession; readonly route: Route; readonly navigate: Navigate }) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const voice = useSyncExternalStore(session.controller.subscribe, session.controller.getSnapshot)
  const [, tick] = useState(0)
  const undo = view.undo
  const engine = session.controller.captureEngine?.() ?? readVoiceEngine()
  useEffect(() => {
    if (undo === null) return
    const timer = setTimeout(() => tick((n) => n + 1), Math.max(0, undo.until - Date.now()))
    return () => clearTimeout(timer)
  }, [undo])
  if (!view.on) return null
  // 그 방송 콘솔에서는 음성 칸이 보인다
  if (route.name === 'console' && route.id === view.broadcastId) return null
  const open = () => navigate({ name: 'console', id: view.broadcastId })
  return (
    <section className="voice-band" aria-label="음성 듣는 중">
      <p className="voice-band-line">
        <strong>음성 듣는 중</strong> · <span>{view.title}</span> · <span>{engine === 'chrome' ? SENT_NOTICE_SHORT : BAND_SENT}</span>
      </p>
      {voice.error !== null ? <p className="voice-error" role="alert">{voice.error}</p> : null}
      {/* 바로 등록·고침 안내 (AC-V3-58 b) — 들은 글·품종은 글자로만 */}
      {view.readout !== null ? (
        <p className="voice-band-readout" role="status">
          {view.readout}
        </p>
      ) : null}
      <div className="voice-band-actions">
        {voice.error !== null ? <button type="button" className="button" onClick={() => { session.controller.turnOff(); void session.controller.turnOn() }}>다시 켜기</button> : null}
        {undo !== null && Date.now() <= undo.until ? (
          <button type="button" className="button" onClick={() => void session.undoOutside()}>
            {`${String(undo.no)}번 등록 되돌리기`}
          </button>
        ) : null}
        {view.cards > 0 ? (
          <button type="button" className="button" onClick={open}>
            {`확인할 카드 ${String(view.cards)}장 · 보기`}
          </button>
        ) : null}
        <button type="button" className="button" onClick={() => session.controller.turnOff()}>
          끄기
        </button>
      </div>
    </section>
  )
}
