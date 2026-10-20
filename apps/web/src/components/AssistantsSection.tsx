// 설정의 보조자 관리 (SYS-04, D-I3-11, AC-I3-64). 보조자는 문자찜 입력만 하는 계정이다.
// - 목록: 이름·아이디·만든 때(KST). 이름을 적고 "보조자 만들기" → 서버가 만든 아이디·비밀번호를 한 번만 보이는 창(각각 복사 버튼).
//   "다 적었어요"로 닫으면 다시 볼 수 없다 — 비밀번호는 창을 닫으면 화면 상태에서도 지운다(저장소·주소에 두지 않는다).
// - 5명이면 만들기가 잠긴다. 지우기는 확인 창(처음 포커스 "그대로 두기") 뒤 — 그 기기에서 바로 로그아웃된다.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { get, isApiError, post, type ApiError } from '../api/client.ts'
import type { AssistantItem } from '../api/types.ts'
import { kstDateTimeWords } from '../lib/kst.ts'
import { ErrorNote, FieldError } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

export const ASSISTANT_LIMIT_MESSAGE = '보조자는 5명까지 만들 수 있어요.'
export const ONE_TIME_NOTE = '이 아이디와 비밀번호는 지금 한 번만 보여요. 보조자에게 전해 주세요.'

interface Created {
  readonly assistant: AssistantItem
  readonly password: string
}

export function AssistantsSection() {
  const [list, setList] = useState<readonly AssistantItem[] | null>(null)
  const [limit, setLimit] = useState(5)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  const [removing, setRemoving] = useState<AssistantItem | null>(null)
  const nameId = useId()
  const nameField = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const result = await get<{ assistants: AssistantItem[]; limit: number }>('/api/assistants')
      setList(result.assistants)
      setLimit(result.limit)
    } catch (caught) {
      if (isApiError(caught)) setLoadError(caught)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const full = list !== null && list.length >= limit

  const create = async () => {
    if (busy || full) return
    setBusy(true)
    setError(null)
    try {
      const result = await post<Created>('/api/assistants', { name })
      setCreated(result)
      setName('')
      setList((current) => [...(current ?? []), result.assistant])
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      if (caught.code === 'ASSISTANT_LIMIT') void load()
      nameField.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <p className="hint">보조자는 문자찜 입력만 할 수 있어요. 판매자 화면(방송·구매자·정산·설정)은 보지 못해요.</p>
      {loadError !== null ? <ErrorNote error={loadError} onRetry={() => void load()} retryLabel="다시 불러오기" /> : null}
      {list === null && loadError === null ? <p role="status">불러오는 중…</p> : null}
      {list !== null && list.length === 0 ? <p>아직 보조자가 없어요.</p> : null}
      {list !== null && list.length > 0 ? (
        <ul className="plain-list assistant-list" aria-label="보조자 목록">
          {list.map((item) => (
            <li key={item.id} className="assistant-row">
              <span className="stack-tight">
                <strong>{item.name}</strong>
                <span>아이디 {item.loginId}</span>
                <span>만든 때 {kstDateTimeWords(item.createdAt)}</span>
              </span>
              <button type="button" className="button" aria-label={`${item.name} 지우기`} onClick={() => setRemoving(item)}>
                지우기
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="stack-tight"
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <label className="field" htmlFor={nameId}>
          <span>보조자 이름</span>
        </label>
        <input
          id={nameId}
          ref={nameField}
          className="input"
          autoComplete="off"
          value={name}
          disabled={full}
          aria-describedby={error?.problemFor('name') !== undefined ? `${nameId}-error` : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        <FieldError error={error} field="name" id={`${nameId}-error`} />
        <div className="row">
          <button type="submit" className="button button-primary" disabled={busy || full}>
            보조자 만들기
          </button>
        </div>
        {full ? <p className="notice">{ASSISTANT_LIMIT_MESSAGE}</p> : null}
        {error !== null && error.problemFor('name') === undefined ? <ErrorNote error={error} /> : null}
      </form>
      {created !== null ? <CreatedDialog created={created} onClose={() => setCreated(null)} /> : null}
      {removing !== null ? (
        <RemoveDialog
          item={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setList((current) => (current ?? []).filter((item) => item.id !== removing.id))
            setRemoving(null)
          }}
        />
      ) : null}
    </div>
  )
}

/** 한 번만 보이는 아이디·비밀번호 (처음 포커스는 아무것도 바꾸지 않는 "아이디 복사") */
function CreatedDialog({ created, onClose }: { readonly created: Created; readonly onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (what: '아이디' | '비밀번호', text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(`${what}를 복사했어요.`)
    } catch {
      setCopied(`${what}를 복사하지 못했어요. 직접 적어 주세요.`)
    }
  }
  return (
    <Modal title={`보조자 ${created.assistant.name}을(를) 만들었어요`} onClose={onClose} closeLabel="다 적었어요" initialFocus={first}>
      <p className="warning">{ONE_TIME_NOTE}</p>
      <dl className="facts credentials">
        <div>
          <dt>아이디</dt>
          <dd className="credential">{created.assistant.loginId}</dd>
        </div>
        <div>
          <dt>비밀번호</dt>
          <dd className="credential">{created.password}</dd>
        </div>
      </dl>
      <div className="row">
        <button ref={first} type="button" className="button" onClick={() => void copy('아이디', created.assistant.loginId)}>
          아이디 복사
        </button>
        <button type="button" className="button" onClick={() => void copy('비밀번호', created.password)}>
          비밀번호 복사
        </button>
      </div>
      {copied !== null ? (
        <p className="notice" role="status">
          {copied}
        </p>
      ) : null}
    </Modal>
  )
}

/** 지우기 확인 (처음 포커스 "그대로 두기") */
function RemoveDialog({ item, onClose, onDone }: { readonly item: AssistantItem; readonly onClose: () => void; readonly onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const remove = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await post(`/api/assistants/${encodeURIComponent(item.id)}/delete`, {})
      onDone()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      // 이미 지운 보조자(다른 기기)면 목록에서 뺀다
      if (caught.status === 404) {
        onDone()
        return
      }
      setError(caught)
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`보조자 ${item.name}을(를) 지울까요?`}
      onClose={onClose}
      closeLabel="그대로 두기"
      actions={
        <button type="button" className="button button-danger" disabled={busy} onClick={() => void remove()}>
          지우기
        </button>
      }
    >
      <p>그 기기에서 바로 로그아웃돼요.</p>
      {error !== null ? <ErrorNote error={error} /> : null}
    </Modal>
  )
}
