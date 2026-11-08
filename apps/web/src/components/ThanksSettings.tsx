// 구매 감사 메시지 (YT-04·05·07, D-Y12, D-I3-03, AC-I3-10~14).
// - "만들기"(판매 규칙 thanks.* — 다음 방송부터)와 "자동 게시 동의"(유튜브 연결의 동의 — 동의한 뒤 확정된 판매부터)를 나눠 보인다.
// - 동의 켜기는 설명 창(처음 포커스 "닫기")에서 "동의해요"로만. 서버가 승인 주소를 주면 같은 탭에서 구글로 간다. 끄기는 바로.
// - 대상마다 요약 한 줄은 저장된 규칙과 지금 동의로만 만든다(저장하지 않은 칸 값은 쓰지 않는다).
// - FB1 D-FB1-14 (사용자 결정, AC-FB1-10·11): "만들기"는 채팅 체크 한 줄 "찜이 확정될 때마다 채팅에 감사 메시지 남기기"(thanks.liveChat).
//   영상 댓글은 새로 켤 길이 없다. 저장된 thanks.videoComment가 OFF가 아닐 때만(예전에 켠 판매자) 체크 아래 한 줄 + "영상 댓글 끄기"
//   (누르면 고친 값 OFF — 저장은 저장 막대, 그 자리는 "저장하면 …" + "되돌리기"). 자동 게시 동의·지금 설정의 결과의 영상 댓글 줄도 그때만.
//   묶는 시간(thanks.batchWindowSec)은 "감사 메시지 상세 설정"(접힘, D-FB1-18 (c)) 안 — 늘 보이는 자동 묶음 안내, 저장된 값이 0보다 크면 접힘 밖에도 한 줄.
//   저장은 화면 아래 저장 막대 하나(D-FB1-06) — 이 칸에는 "저장"이 없다. 서버 규칙·설정 키·기본값은 그대로(D-FB1-14 (5)).
import type { SaleSettings } from '@livejjim/core'
import { useId, useState } from 'react'
import { isApiError, put, type ApiError } from '../api/client.ts'
import type { ConsentTarget, YoutubeConnection } from '../api/types.ts'
import { goToGoogle } from '../lib/google-return.ts'
import { kstDateTimeWords } from '../lib/kst.ts'
import { fieldOf, fieldsAt, SAVED_MESSAGE, THANKS_DETAIL } from '../lib/settings-fields.ts'
import {
  BOT_THANKS_NOTE,
  BOT_THANKS_SUMMARY,
  BOT_THANKS_TITLE,
  CONNECT_FIRST_MESSAGE,
  CONNECT_FOR_THANKS,
  CONSENT_NAME,
  CONSENT_OFF_DONE,
  CONSENT_PLACE,
  GOOGLE_NOT_READY,
  NOT_CONFIGURED_MESSAGE,
  PREVIEW_BATCH,
  PREVIEW_SINGLE,
  PREVIEW_SMS_NOTE,
  consentSummary,
} from '../lib/youtube.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import { DetailToggle, RuleField, settingProblem, useRuleForm, type RuleForm } from './RuleFields.tsx'
import { botThanksOf, oauthOf, webChatOf, type ConnectionHandle } from './YoutubeConnection.tsx'

const THANKS_FIELDS = fieldsAt('thanks')
const LIVE_CHAT_FIELD = fieldOf('thanks.liveChat')
const BATCH_FIELD = fieldOf('thanks.batchWindowSec')

/** 예전에 영상 댓글을 켠 판매자에게만 (FB1 D-FB1-14 (2)) */
export const VIDEO_COMMENT_ON = '영상 댓글에도 감사 메시지를 남기고 있어요.'
export const VIDEO_COMMENT_OFF_BUTTON = '영상 댓글 끄기'
export const VIDEO_COMMENT_OFF_PENDING = '저장하면 영상 댓글에는 남기지 않아요.'
export const VIDEO_COMMENT_UNDO = '되돌리기'
/** 늘 보이는 자동 묶음 안내 (D-FB1-14 (4) — 앞 문장은 체크 이름이 말하므로 뺌, D-011·D-Y09 묶음 모드 그대로) */
export const AUTO_BATCH_NOTE = '유튜브가 하루에 받아 주는 양이 모자라면 저절로 1분씩 묶어 남겨요.'
/** 저장된 묶는 시간이 0보다 클 때 (접힘 밖) */
export const batchNow = (seconds: number): string => `지금은 ${String(seconds)}초 동안의 판매를 한 메시지로 묶어요.`

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
  // 영상 댓글 줄은 저장값이 OFF가 아닐 때만 (D-FB1-14 (3) — 실시간 채팅 줄은 늘)
  const videoOn = settings['thanks.videoComment'] !== 'OFF'
  // 봇 감사 판매자 (D-YT-SEND-18): 실시간 채팅은 감사 스위치 하나 — 구글 게시 동의 칸 대신 안내. 영상 댓글은 봇이 올리지 않아 동의 칸을 그대로 둔다
  const bot = botThanksOf(youtube.state)
  return (
    <div className="stack">
      <MakeFields settings={settings} form={form} />
      {bot ? (
        <section className="card stack-tight" aria-label={BOT_THANKS_TITLE}>
          <h3 className="sub-title">{BOT_THANKS_TITLE}</h3>
          <p>{BOT_THANKS_NOTE}</p>
        </section>
      ) : null}
      {!bot || videoOn ? (
        <fieldset className="card stack">
          <legend className="sub-title">자동 게시 동의</legend>
          <ConsentControls youtube={youtube} videoComment={videoOn} liveChat={!bot} />
        </fieldset>
      ) : null}
      <section className="stack-tight" aria-label="지금 설정의 결과">
        <h3 className="sub-title">지금 설정의 결과</h3>
        <ul className="plain-list consent-summary">
          <li>
            <strong>실시간 채팅</strong> —{' '}
            {bot ? (settings['thanks.liveChat'] ? BOT_THANKS_SUMMARY : consentSummary(false, false)) : consentSummary(settings['thanks.liveChat'], connection?.consent.liveChat.enabled === true)}
          </li>
          {videoOn ? (
            <li>
              <strong>영상 댓글{settings['thanks.videoComment'] === 'PER_SALE' ? ' (판매마다)' : settings['thanks.videoComment'] === 'SUMMARY' ? ' (요약)' : ''}</strong> —{' '}
              {consentSummary(true, connection?.consent.videoComment.enabled === true)}
            </li>
          ) : null}
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

/** "만들기" 칸 (D-FB1-14): 채팅 체크 한 줄 + (켜 둔 판매자만) 영상 댓글 끄기 + 묶는 시간은 감사 메시지 상세 설정 */
function MakeFields({ settings, form }: { readonly settings: SaleSettings; readonly form: RuleForm }) {
  const id = useId()
  const [detail, setDetail] = useState(false)
  const savedMode = settings['thanks.videoComment']
  const draftMode = String(form.draft['thanks.videoComment'] ?? savedMode)
  const modeProblem = settingProblem(form.error, 'thanks.videoComment')
  const saved = settings['thanks.batchWindowSec']
  const batchProblem = settingProblem(form.error, 'thanks.batchWindowSec')
  // 서버 문장이 접힌 칸에 있으면 펴서 보인다
  const open = detail || batchProblem !== undefined
  return (
    <fieldset className="card stack">
      <legend className="sub-title">만들기</legend>
      <p className="hint">판매가 확정되면 이 규칙으로 감사 메시지를 만들어요. 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.</p>
      <RuleField field={LIVE_CHAT_FIELD} value={form.draft['thanks.liveChat']} onChange={(value) => form.set('thanks.liveChat', value)} problem={settingProblem(form.error, 'thanks.liveChat')} />
      {savedMode !== 'OFF' ? (
        // 예전에 켠 판매자만 — 끄기만 있다(새로 켤 길 없음). 저장 전이면 되돌리기로 저장된 방식 그대로
        <div className="row video-comment-off">
          {draftMode === 'OFF' ? (
            <>
              <p>{VIDEO_COMMENT_OFF_PENDING}</p>
              <button type="button" className="button" onClick={() => form.set('thanks.videoComment', savedMode)}>
                {VIDEO_COMMENT_UNDO}
              </button>
            </>
          ) : (
            <>
              <p>{VIDEO_COMMENT_ON}</p>
              <button type="button" className="button" onClick={() => form.set('thanks.videoComment', 'OFF')}>
                {VIDEO_COMMENT_OFF_BUTTON}
              </button>
            </>
          )}
        </div>
      ) : null}
      {modeProblem !== undefined ? (
        <p className="field-error" role="alert">
          {modeProblem}
        </p>
      ) : null}
      <p className="hint">{AUTO_BATCH_NOTE}</p>
      {saved > 0 ? <p className="notice">{batchNow(saved)}</p> : null}
      <div className="stack-tight">
        <DetailToggle label={THANKS_DETAIL} open={open} controls={`${id}-detail`} onToggle={() => setDetail(!open)} />
        <div id={`${id}-detail`} className="stack" hidden={!open}>
          <RuleField field={BATCH_FIELD} value={form.draft['thanks.batchWindowSec']} onChange={(value) => form.set('thanks.batchWindowSec', value)} problem={batchProblem} />
        </div>
      </div>
    </fieldset>
  )
}

/** 자동 게시 동의 켜기·끄기 (AC-I3-11·12) */
function ConsentControls({ youtube, videoComment, liveChat = true }: { readonly youtube: ConnectionHandle; readonly videoComment: boolean; readonly liveChat?: boolean }) {
  const [asking, setAsking] = useState<ConsentTarget | null>(null)
  const [busy, setBusy] = useState<ConsentTarget | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const connection = youtube.connection
  // 서버가 채팅을 읽는 서버(YT-11)에서는 구글 연결이 감사 채팅용 선택이다 — 연결이 없으면 "감사 채팅을 올리려면…", 구글 연결을 못 쓰는 서버면 그 안내
  const blocked =
    youtube.state.phase === 'notConfigured'
      ? NOT_CONFIGURED_MESSAGE
      : !oauthOf(youtube.state)
        ? GOOGLE_NOT_READY
        : connection === null || connection.status === 'NOT_CONNECTED'
          ? webChatOf(youtube.state) !== null
            ? CONNECT_FOR_THANKS
            : CONNECT_FIRST_MESSAGE
          : null

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
            <button type="button" className="button" disabled={busy !== null || blocked !== null} onClick={() => setAsking(target)}>
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
      {liveChat ? row('LIVE_CHAT', connection?.consent.liveChat ?? null) : null}
      {videoComment ? row('VIDEO_COMMENT', connection?.consent.videoComment ?? null) : null}
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
