// 방송 목록·새 방송·리허설 시작 (AC-S05-02, SPEC §7 화면 1, D-069·D-070·D-081).
// 방송 설정 스냅샷은 서버가 판매자 설정으로 채운다 — 화면은 설정을 보내지 않는다.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { BroadcastItem, WriteResult } from '../api/types.ts'
import { dateWords, kstToday } from '../lib/kst.ts'
import { routePath, type Route } from '../lib/router.ts'
import { ErrorNote, FieldError } from './ErrorNote.tsx'
import { TopBar } from './TopBar.tsx'

export interface HomePageProps {
  readonly shopName: string
  readonly onLogout: () => void
  readonly navigate: (route: Route) => void
}

/** 날짜(KST) 최근 순. 같은 날은 나중에 만든 방송이 위 (서버는 날짜 오름차순·같은 날은 실제 먼저·선언 순으로 준다) */
export function sortBroadcasts(items: readonly BroadcastItem[]): BroadcastItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.date === b.item.date ? b.index - a.index : a.item.date < b.item.date ? 1 : -1))
    .map(({ item }) => item)
}

export function HomePage({ shopName, onLogout, navigate }: HomePageProps) {
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => kstToday())
  const [createError, setCreateError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const pendingRequest = useRef<{ key: string; requestId: string } | null>(null)
  const titleField = useRef<HTMLInputElement>(null)
  const titleErrorId = useId()

  const load = async () => {
    setLoadError(null)
    try {
      const { broadcasts: items } = await get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
      setBroadcasts(sortBroadcasts(items))
    } catch (error) {
      if (isApiError(error)) setLoadError(error)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (formOpen) titleField.current?.focus()
  }, [formOpen])

  /** 같은 내용으로 다시 누르면(저장하지 못한 뒤) 같은 요청 번호를 쓴다 */
  const requestIdFor = (key: string): string => {
    if (pendingRequest.current?.key === key) return pendingRequest.current.requestId
    const requestId = newRequestId()
    pendingRequest.current = { key, requestId }
    return requestId
  }

  const create = async (input: { title?: string; date?: string; rehearsal?: boolean }) => {
    if (busy) return
    setBusy(true)
    setCreateError(null)
    const requestId = requestIdFor(JSON.stringify(input))
    try {
      const result = await withRetry(() => post<WriteResult>('/api/broadcasts', { requestId, ...input }))
      pendingRequest.current = null
      const id = result.broadcast?.id
      if (id !== undefined) navigate({ name: 'console', id })
    } catch (error) {
      if (!isApiError(error)) throw error
      setCreateError(error)
      if (error.problemFor('title') !== undefined) titleField.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    void create({ ...(trimmed === '' ? {} : { title: trimmed }), date })
  }

  return (
    <>
      <TopBar shopName={shopName} onLogout={onLogout} />
      <main className="page">
        <h1>방송 목록</h1>
        <div className="row">
          <button type="button" className="button button-primary" aria-expanded={formOpen} onClick={() => setFormOpen((open) => !open)}>
            새 방송 시작
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => void create({ rehearsal: true })}>
            리허설 해 보기
          </button>
        </div>
        {formOpen ? (
          <form className="stack card" onSubmit={submit} aria-label="새 방송">
            <label className="field">
              <span>제목</span>
              <input
                ref={titleField}
                className="input"
                name="title"
                value={title}
                placeholder="비워 두면 1부·2부처럼 정해져요"
                aria-describedby={createError?.problemFor('title') !== undefined ? titleErrorId : undefined}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <FieldError error={createError} field="title" id={titleErrorId} />
            <label className="field">
              <span>날짜</span>
              <input className="input" name="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <FieldError error={createError} field="date" />
            <button type="submit" className="button button-primary" disabled={busy}>
              이 방송 시작하기
            </button>
          </form>
        ) : null}
        {createError !== null ? <ErrorNote error={createError} omitFields={['title', 'date']} /> : null}
        {loadError !== null ? <ErrorNote error={loadError} onRetry={() => void load()} retryLabel="다시 불러오기" /> : null}
        {broadcasts === null && loadError === null ? <p>불러오는 중…</p> : null}
        {broadcasts !== null && broadcasts.length === 0 ? <p>아직 방송이 없어요. "새 방송 시작"을 눌러 주세요.</p> : null}
        {broadcasts !== null && broadcasts.length > 0 ? (
          <ul className="broadcast-list" aria-label="방송">
            {broadcasts.map((item) => (
              <li key={item.id}>
                <a
                  className="broadcast-link"
                  href={routePath({ name: 'console', id: item.id })}
                  onClick={(event) => {
                    event.preventDefault()
                    navigate({ name: 'console', id: item.id })
                  }}
                >
                  <strong className="broadcast-title">{item.title}</strong>
                  <span>{dateWords(item.date)}</span>
                  <span className={item.ended ? 'tag' : 'tag tag-live'}>{item.ended ? '끝남' : '진행 중'}</span>
                  {item.rehearsal ? <span className="tag tag-rehearsal">리허설</span> : null}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </>
  )
}
