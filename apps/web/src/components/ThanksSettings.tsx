// 구매 감사 메시지 (YT-04·05·07, D-Y12, D-I3-03, AC-I3-10~14).
// - "만들기"(판매 규칙 thanks.* — 다음 방송부터)와 "자동 게시 동의"(유튜브 연결의 동의 — 동의한 뒤 확정된 판매부터)를 나눠 보인다.
// - 동의 켜기는 설명 창(처음 포커스 "닫기")에서 "동의해요"로만. 서버가 승인 주소를 주면 같은 탭에서 구글로 간다. 끄기는 바로.
// - 대상마다 요약 한 줄은 저장된 규칙과 지금 동의로만 만든다(저장하지 않은 칸 값은 쓰지 않는다).
import type { SaleSettings } from '@livejjim/core'
import { useState } from 'react'
import { isApiError, put, type ApiError } from '../api/client.ts'
import type { ConsentTarget, YoutubeConnection } from '../api/types.ts'
import { goToGoogle } from '../lib/google-return.ts'
import { kstDateTimeWords } from '../lib/kst.ts'
import { fieldsAt, SAVED_MESSAGE } from '../lib/settings-fields.ts'
import {
  CONNECT_FIRST_MESSAGE,
  CONSENT_NAME,
  CONSENT_OFF_DONE,
  CONSENT_PLACE,
  NOT_CONFIGURED_MESSAGE,
  PREVIEW_BATCH,
  PREVIEW_SINGLE,
  PREVIEW_SMS_NOTE,
  consentSummary,
} from '../lib/youtube.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import { RuleField, SaveRow, settingProblem, useRuleForm, type RuleForm } from './RuleFields.tsx'
import type { ConnectionHandle } from './YoutubeConnection.tsx'

const THANKS_FIELDS = fieldsAt('thanks')

export interface ThanksSettingsProps {
  /** 저장된 설정 (요약·미리 보기는 이 값으로) */
  readonly settings: SaleSettings
  readonly youtube: ConnectionHandle
  /** "만들기" 칸 묶음 (상위가 저장하지 않은 값을 묻는다) */
  readonly form: RuleForm
}

export function useThanksForm(settings: SaleSettings, onSaved: (settings: SaleSettings) => void): RuleForm {
  return useRuleForm(THANKS_FIELDS, settings, onSaved, SAVED_MESSAGE)
}

export function ThanksSettings({ settings, youtube, form }: ThanksSettingsProps) {
  const connection = youtube.connection
  return (
    <div className="stack">
      <fieldset className="card stack">
        <legend className="sub-title">만들기</legend>
        <p className="hint">판매가 확정되면 이 규칙으로 감사 메시지를 만들어요. 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.</p>
        {THANKS_FIELDS.map((field) => (
          <RuleField key={field.key} field={field} value={form.draft[field.key]} onChange={(value) => form.set(field.key, value)} problem={settingProblem(form.error, field.key)} />
        ))}
        <SaveRow form={form} fields={THANKS_FIELDS} />
      </fieldset>
      <fieldset className="card stack">
        <legend className="sub-title">자동 게시 동의</legend>
        <ConsentControls youtube={youtube} />
      </fieldset>
      <section className="stack-tight" aria-label="지금 설정의 결과">
        <h3 className="sub-title">지금 설정의 결과</h3>
        <ul className="plain-list consent-summary">
          <li>
            <strong>실시간 채팅</strong> — {consentSummary(settings['thanks.liveChat'], connection?.consent.liveChat.enabled === true)}
          </li>
          <li>
            <strong>영상 댓글{settings['thanks.videoComment'] === 'PER_SALE' ? ' (판매마다)' : settings['thanks.videoComment'] === 'SUMMARY' ? ' (요약)' : ''}</strong> —{' '}
            {consentSummary(settings['thanks.videoComment'] !== 'OFF', connection?.consent.videoComment.enabled === true)}
          </li>
        </ul>
      </section>
      <section className="stack-tight" aria-label="미리 보기">
        <h3 className="sub-title">미리 보기</h3>
        <p className="quote">{PREVIEW_SINGLE}</p>
        {settings['thanks.batchWindowSec'] > 0 ? <p className="quote">{PREVIEW_BATCH}</p> : null}
        <p>{PREVIEW_SMS_NOTE}</p>
      </section>
    </div>
  )
}

/** 자동 게시 동의 켜기·끄기 (AC-I3-11·12) */
function ConsentControls({ youtube }: { readonly youtube: ConnectionHandle }) {
  const [asking, setAsking] = useState<ConsentTarget | null>(null)
  const [busy, setBusy] = useState<ConsentTarget | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const connection = youtube.connection
  const blocked = youtube.state.phase === 'notConfigured' ? NOT_CONFIGURED_MESSAGE : connection === null || connection.status === 'NOT_CONNECTED' ? CONNECT_FIRST_MESSAGE : null

  const send = async (target: ConsentTarget, enabled: boolean) => {
    if (busy !== null) return
    setBusy(target)
    setError(null)
    setMessage(null)
    try {
      const result = await put<{ connection?: YoutubeConnection; authorizeUrl?: string }>('/api/youtube/consent', { target, enabled })
      if (result.authorizeUrl !== undefined) {
        goToGoogle(result.authorizeUrl)
        return
      }
      if (result.connection !== undefined) youtube.set(result.connection)
      if (!enabled) setMessage(CONSENT_OFF_DONE)
      setAsking(null)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(null)
    }
  }

  const row = (target: ConsentTarget, state: { enabled: boolean; at: string | null } | null) => {
    const name = CONSENT_NAME[target]
    const on = state?.enabled === true
    return (
      <div className="consent-row stack-tight" key={target}>
        <p>
          <strong>{name} 자동 게시</strong> <span className={on ? 'tag tag-live' : 'tag'}>{on ? '켜짐' : '꺼짐'}</span>
          {on && state?.at !== null && state?.at !== undefined ? <span> {kstDateTimeWords(state.at)}에 동의함</span> : null}
        </p>
        <div className="row">
          {on ? (
            <button type="button" className="button" disabled={busy !== null || blocked !== null} onClick={() => void send(target, false)}>
              {name} 자동 게시 끄기
            </button>
          ) : (
            <button type="button" className="button button-primary" disabled={busy !== null || blocked !== null} onClick={() => setAsking(target)}>
              {name} 자동 게시 켜기
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="stack">
      {blocked !== null ? <p className="notice">{blocked}</p> : null}
      {row('LIVE_CHAT', connection?.consent.liveChat ?? null)}
      {row('VIDEO_COMMENT', connection?.consent.videoComment ?? null)}
      {message !== null ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {error !== null && asking === null ? <ErrorNote error={error} /> : null}
      {asking !== null ? (
        <Modal
          title={`${CONSENT_NAME[asking]} 자동 게시`}
          onClose={() => {
            setAsking(null)
            setError(null)
          }}
          actions={
            <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => void send(asking, true)}>
              동의해요
            </button>
          }
        >
          <p>구매 감사 메시지를 내 채널 이름으로 {CONSENT_PLACE[asking]} 자동으로 남겨요.</p>
          <p>동의한 뒤에 확정된 판매부터 남기고, 그 전 판매는 남기지 않아요.</p>
          <p>그 전 판매는 감사 메시지 목록에서 하나씩 보낼 수 있어요.</p>
          <p>구글 화면에서 글쓰기 권한을 한 번 더 허락해야 할 수 있어요.</p>
          {error !== null ? <ErrorNote error={error} /> : null}
        </Modal>
      ) : null}
    </div>
  )
}
