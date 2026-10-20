// 방송 목록·새 방송·리허설 시작 (AC-S05-02, SPEC §7 화면 1, D-069·D-070·D-081).
// 방송 설정 스냅샷은 서버가 판매자 설정으로 채운다 — 화면은 설정을 보내지 않는다.
// I3: 실제 방송이 하나도 없고 시작 마법사 상태가 "처음"·"진행 중"이면 `/start`를 연다(AC-I3-50 — 이 주소로 왔을 때만).
//     봉인 예정 날짜의 방송 줄에 "이 날짜 기록은 … 봉인돼요"(7일 전부터 경고 상자, AC-I3-40).
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { BroadcastItem, DayRow, WizardState, WriteResult } from '../api/types.ts'
import { dateWords, kstToday } from '../lib/kst.ts'
import { routePath, type Navigate } from '../lib/router.ts'
import { ErrorNote, FieldError } from './ErrorNote.tsx'
import { SealNotice } from './SealNotice.tsx'

/** 시작 마법사를 저절로 열까 (실제 방송이 없고 처음·진행 중일 때만) */
async function shouldOpenWizard(items: readonly BroadcastItem[]): Promise<boolean> {
  if (items.some((item) => !item.rehearsal)) return false
  try {
    const { wizard } = await get<{ wizard: WizardState }>('/api/wizard')
    return wizard.status === 'NEW' || wizard.status === 'IN_PROGRESS'
  } catch {
    return false
  }
}

export interface HomePageProps {
  readonly navigate: Navigate
}

/** 날짜(KST) 최근 순. 같은 날은 나중에 만든 방송이 위 (서버는 날짜 오름차순·같은 날은 실제 먼저·선언 순으로 준다) */
export function sortBroadcasts(items: readonly BroadcastItem[]): BroadcastItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.date === b.item.date ? b.index - a.index : a.item.date < b.item.date ? 1 : -1))
    .map(({ item }) => item)
}

export function HomePage({ navigate }: HomePageProps) {
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[] | null>(null)
  const [seals, setSeals] = useState<ReadonlyMap<string, DayRow>>(new Map())
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => kstToday())
  const [createError, setCreateError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const pendingRequest = useRef<{ key: string; requestId: string } | null>(null)
  const titleField = useRef<HTMLInputElement>(null)
  const titleErrorId = useId()

  const load = async (first = false) => {
    setLoadError(null)
    try {
      const { broadcasts: items } = await get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
      if (first && (await shouldOpenWizard(items))) {
        navigate({ name: 'start' }, { replace: true })
        return
      }
      setBroadcasts(sortBroadcasts(items))
      if (items.some((item) => !item.rehearsal)) {
        get<{ days: DayRow[] }>('/api/days').then(
          ({ days }) => setSeals(new Map(days.map((day) => [day.date, day]))),
          () => {},
        )
      }
    } catch (error) {
      if (isApiError(error)) setLoadError(error)
    }
  }

  useEffect(() => {
    void load(true)
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
                {item.rehearsal ? null : <SealNotice sealAt={seals.get(item.date)?.sealAt} sealed={seals.get(item.date)?.sealed === true} />}
              </li>
            ))}
          </ul>
        ) : null}
      </main>
    </>
  )
}
