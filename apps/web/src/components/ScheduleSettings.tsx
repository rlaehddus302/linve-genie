// 설정 "방송 일정" (KP1 SCH-01·SCH-02, AC-KP1-20·21, D-KP1-15): 다음 방송 적기(날짜·시각·제목 1~40·소개 0~100)와
// 공개 일정 페이지 켜기·끄기·새 주소 만들기·주소 복사. 칸 검사는 서버가 한다 — 거절 문장(휴대폰 번호 모양 포함)은 서버 문장 그대로 칸 아래에.
// 화면은 길이를 막지 않고(maxLength 없음) 글자 수만 보인다 — 41자를 적으면 서버 문장이 보인다.
// 판매자만(보조자는 서버가 403). 저장은 이 절의 버튼으로 바로 한다(판매 규칙의 저장 막대와 상관없다).
import { useEffect, useId, useRef, useState } from 'react'
import { isApiError, type ApiError } from '../api/client.ts'
import {
  CHANNEL_LABEL,
  COPIED,
  COPY_FAILED,
  COPY_LABEL,
  INTRO_MAX,
  PAGE_HINT,
  PAGE_SWITCH_LABEL,
  RENEW_CONFIRM,
  RENEW_LABEL,
  SCHEDULE_EMPTY,
  SCHEDULE_FULL_MESSAGE,
  SCHEDULE_HINT,
  TITLE_MAX,
  addScheduleItem,
  editScheduleItem,
  fetchSchedule,
  removeScheduleItem,
  renewSchedulePage,
  saveSchedulePage,
  scheduleFull,
  scheduleWhen,
  type ScheduleInput,
  type ScheduleItem,
  type ScheduleView,
} from '../lib/schedule.ts'
import { FieldError, RequestError } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import './kp1-report.css'

const EMPTY: ScheduleInput = { date: '', time: '', title: '', intro: '' }
const FIELDS = ['date', 'time', 'title', 'intro'] as const

export function ScheduleSettings() {
  const [view, setView] = useState<ScheduleView | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    fetchSchedule().then(
      (result) => {
        if (!alive) return
        setView(result)
        setLoadError(null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setLoadError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  if (view === null) {
    return loadError !== null ? <RequestError error={loadError} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : <p role="status">방송 일정을 불러오는 중…</p>
  }
  return (
    <div className="stack kp1-page">
      <p className="hint">{SCHEDULE_HINT}</p>
      <PagePart view={view} onSaved={setView} />
      <ItemsPart view={view} onSaved={setView} />
    </div>
  )
}

// ── 공개 페이지 ───────────────────────────────────────────────────────

function PagePart({ view, onSaved }: { readonly view: ScheduleView; readonly onSaved: (view: ScheduleView) => void }) {
  const id = useId()
  const [channel, setChannel] = useState(view.page.channelUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [renewing, setRenewing] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const run = async (send: () => Promise<ScheduleView>, doneWords: string): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setError(null)
    setDone(null)
    setCopied(null)
    try {
      const next = await send()
      onSaved(next)
      setChannel(next.page.channelUrl ?? '')
      setDone(doneWords)
      return true
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      return false
    } finally {
      setBusy(false)
    }
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(COPIED)
    } catch {
      setCopied(COPY_FAILED)
    }
  }

  const channelId = `${id}-channel`
  const channelProblem = error?.problemFor('channelUrl') !== undefined
  return (
    <div className="stack-tight">
      <label className="kp1-switch">
        <input
          type="checkbox"
          checked={view.page.enabled}
          disabled={busy}
          onChange={(event) => {
            const enabled = event.target.checked
            void run(() => saveSchedulePage(enabled, channel), enabled ? '공개 일정 페이지를 켰어요.' : '공개 일정 페이지를 껐어요. 전에 알려 준 주소는 이제 열리지 않아요.')
          }}
        />
        <span>
          {PAGE_SWITCH_LABEL} — <strong>{view.page.enabled ? '켜짐' : '꺼짐'}</strong>
        </span>
      </label>
      <p className="hint">{PAGE_HINT}</p>
      {view.page.enabled && view.page.url !== null ? (
        <div className="stack-tight">
          <p>공개 주소</p>
          <p className="kp1-url" aria-label="공개 주소">
            {view.page.url}
          </p>
          <div className="row">
            <button type="button" className="button kp1-button" onClick={() => void copy(view.page.url ?? '')}>
              {COPY_LABEL}
            </button>
            <button type="button" className="button kp1-button" disabled={busy} onClick={() => setRenewing(true)}>
              {RENEW_LABEL}
            </button>
          </div>
          {copied !== null ? <p role="status">{copied}</p> : null}
        </div>
      ) : null}
      <div className="field kp1-field">
        <label htmlFor={channelId}>{CHANNEL_LABEL}</label>
        <input
          id={channelId}
          className="input"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.youtube.com/@가게"
          value={channel}
          aria-invalid={channelProblem}
          aria-describedby={channelProblem ? `${channelId}-error` : undefined}
          onChange={(event) => setChannel(event.target.value)}
        />
        <FieldError error={error} field="channelUrl" id={`${channelId}-error`} />
      </div>
      <div className="row">
        <button
          type="button"
          className="button kp1-button"
          disabled={busy || channel.trim() === (view.page.channelUrl ?? '')}
          onClick={() => void run(() => saveSchedulePage(view.page.enabled, channel), '채널 주소를 저장했어요.')}
        >
          채널 주소 저장
        </button>
      </div>
      {error !== null ? <RequestError error={error} omitFields={['channelUrl']} /> : null}
      {done !== null ? <p role="status">{done}</p> : null}
      {renewing ? (
        <Modal
          title={RENEW_LABEL}
          onClose={() => setRenewing(false)}
          closeLabel="그만두기"
          closeDisabled={busy}
          actions={
            <button
              type="button"
              className="button button-primary kp1-button"
              disabled={busy}
              onClick={() => {
                void run(() => renewSchedulePage(), '새 주소를 만들었어요. 전에 알려 준 주소는 이제 열리지 않아요.').then(() => setRenewing(false))
              }}
            >
              {RENEW_LABEL}
            </button>
          }
        >
          <p>{RENEW_CONFIRM}</p>
        </Modal>
      ) : null}
    </div>
  )
}

// ── 다가오는 일정 ─────────────────────────────────────────────────────

function ItemsPart({ view, onSaved }: { readonly view: ScheduleView; readonly onSaved: (view: ScheduleView) => void }) {
  const [editing, setEditing] = useState<ScheduleItem | null>(null)
  const [removing, setRemoving] = useState<ScheduleItem | null>(null)
  const [removeError, setRemoveError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const full = scheduleFull(view)

  const remove = async (item: ScheduleItem) => {
    if (busy) return
    setBusy(true)
    setRemoveError(null)
    try {
      onSaved(await removeScheduleItem(item.id))
      setRemoving(null)
      setDone('일정을 지웠어요.')
      if (editing?.id === item.id) setEditing(null)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setRemoveError(caught)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <h3>다가오는 방송 ({String(view.items.length)}/{String(view.max)})</h3>
      {view.items.length === 0 ? (
        <p>{SCHEDULE_EMPTY}</p>
      ) : (
        <ul className="kp1-list" aria-label="다가오는 방송 목록">
          {view.items.map((item) => (
            <li key={item.id} className="card stack-tight">
              <p className="kp1-row-title">{scheduleWhen(item)}</p>
              <p>{item.title}</p>
              {item.intro !== '' ? <p className="hint">{item.intro}</p> : null}
              <div className="row">
                <button type="button" className="button kp1-button" aria-label={`${scheduleWhen(item)} 일정 고치기`} onClick={() => setEditing(item)}>
                  고치기
                </button>
                <button type="button" className="button kp1-button" aria-label={`${scheduleWhen(item)} 일정 지우기`} onClick={() => setRemoving(item)}>
                  지우기
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {done !== null ? <p role="status">{done}</p> : null}
      {editing !== null ? (
        <ItemForm
          key={`edit-${editing.id}`}
          title="일정 고치기"
          submitLabel="고친 내용 저장"
          initial={{ date: editing.date, time: editing.time, title: editing.title, intro: editing.intro }}
          send={(input) => editScheduleItem(editing.id, input)}
          onSaved={(next) => {
            onSaved(next)
            setEditing(null)
            setDone('일정을 고쳤어요.')
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <ItemForm
          key="add"
          title="새 일정 적기"
          submitLabel="일정 적기"
          initial={EMPTY}
          {...(full ? { fullNote: SCHEDULE_FULL_MESSAGE } : {})}
          send={addScheduleItem}
          onSaved={(next) => {
            onSaved(next)
            setDone('일정을 적었어요.')
          }}
        />
      )}
      {removing !== null ? (
        <Modal
          title="일정 지우기"
          onClose={() => {
            setRemoving(null)
            setRemoveError(null)
          }}
          closeLabel="그만두기"
          closeDisabled={busy}
          actions={
            <button type="button" className="button button-danger kp1-button" disabled={busy} onClick={() => void remove(removing)}>
              지우기
            </button>
          }
        >
          <p>
            {scheduleWhen(removing)} "{removing.title}" 일정을 지울까요?
          </p>
          {removeError !== null ? <RequestError error={removeError} /> : null}
        </Modal>
      ) : null}
    </div>
  )
}

interface ItemFormProps {
  readonly title: string
  readonly submitLabel: string
  readonly initial: ScheduleInput
  /** 다가오는 일정이 꽉 찼을 때 미리 보이는 문장 (서버가 409로 같은 문장을 준다) */
  readonly fullNote?: string
  readonly send: (input: ScheduleInput) => Promise<ScheduleView>
  readonly onSaved: (view: ScheduleView) => void
  readonly onCancel?: () => void
}

function ItemForm({ title, submitLabel, initial, fullNote, send, onSaved, onCancel }: ItemFormProps) {
  const id = useId()
  const [draft, setDraft] = useState<ScheduleInput>(initial)
  const [error, setError] = useState<ApiError | null>(null)
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set())
  const busy = useRef(false)
  const [sending, setSending] = useState(false)

  const submit = async () => {
    if (busy.current) return
    busy.current = true
    setSending(true)
    setError(null)
    setEdited(new Set())
    try {
      const next = await send({ date: draft.date, time: draft.time, title: draft.title, intro: draft.intro })
      setDraft(initial)
      onSaved(next)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      busy.current = false
      setSending(false)
    }
  }
  const change = (key: keyof ScheduleInput, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (error !== null) setEdited((current) => (current.has(key) ? current : new Set([...current, key])))
  }
  const shownError = (field: string) => (edited.has(field) ? null : error)
  const labels: Record<keyof ScheduleInput, string> = { date: '날짜', time: '시작 시각', title: '제목', intro: '한 줄 소개 (비워도 돼요)' }
  const counts: Partial<Record<keyof ScheduleInput, number>> = { title: TITLE_MAX, intro: INTRO_MAX }
  const fullShown = fullNote !== undefined && error?.code !== 'SCHEDULE_FULL'
  return (
    <form
      className="card stack-tight"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <h3>{title}</h3>
      {fullShown ? (
        <p className="kp1-note" role="note">
          {fullNote}
        </p>
      ) : null}
      {FIELDS.map((field) => {
        const inputId = `${id}-${field}`
        const problem = shownError(field)?.problemFor(field) !== undefined
        const max = counts[field]
        const described = [max === undefined ? null : `${inputId}-count`, problem ? `${inputId}-error` : null].filter((part) => part !== null).join(' ')
        return (
          <div key={field} className="field kp1-field">
            <label htmlFor={inputId}>{labels[field]}</label>
            <input
              id={inputId}
              className="input"
              type={field === 'date' ? 'date' : field === 'time' ? 'time' : 'text'}
              autoComplete="off"
              value={draft[field]}
              aria-invalid={problem}
              aria-describedby={described === '' ? undefined : described}
              onChange={(event) => change(field, event.target.value)}
            />
            {max !== undefined ? (
              <p className="hint" id={`${inputId}-count`}>
                {String([...draft[field].trim()].length)}/{String(max)}자
              </p>
            ) : null}
            <FieldError error={shownError(field)} field={field} id={`${inputId}-error`} />
          </div>
        )
      })}
      {error !== null ? <RequestError error={error} omitFields={[...FIELDS]} /> : null}
      <div className="row">
        <button type="submit" className="button button-primary kp1-button" disabled={sending}>
          {sending ? '저장하는 중…' : submitLabel}
        </button>
        {onCancel !== undefined ? (
          <button type="button" className="button kp1-button" disabled={sending} onClick={onCancel}>
            그만두기
          </button>
        ) : null}
      </div>
    </form>
  )
}
