// 방송 목록·새 방송·리허설 시작 (AC-S05-02, SPEC §7 화면 1, D-069·D-070·D-081).
// 방송 설정 스냅샷은 서버가 판매자 설정으로 채운다 — 화면은 설정을 보내지 않는다.
// 요금 기능이 켜져 있으면(N5, AC-N5-56·57) 위쪽에 요금 알림 띠, 새 방송 칸(실제 방송 — "새 방송 시작"으로 연다)의 제목·날짜 아래·"이 방송 시작하기" 위에
// "지금 실제 방송을 시작하면" 미리 보기(서버 값 그대로)를 둔다. 이용권이 없어도 "이 방송 시작하기"는 누를 수 있고(미리 보기가 늦었을 수 있다)
// 서버가 거절하면(422 NO_PASS) 그 문장과 "요금 화면 열기"를 미리 보기 자리에 보인다.
// 리허설은 요금과 상관없이 늘 시작된다(문장 없음, BL-0 6).
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { BroadcastItem, WriteResult } from '../api/types.ts'
import { dateWords, kstToday } from '../lib/kst.ts'
import { routePath, type Navigate } from '../lib/router.ts'
import { useBillingConfig, useBillingStore } from './billing-context.tsx'
import { BillingBanners, StartPreviewNote } from './BillingNotices.tsx'
import { ErrorNote, FieldError } from './ErrorNote.tsx'

/** 이용권이 없어 서버가 실제 방송 시작을 거절했다 (BL-4 1.5) */
const NO_PASS = 'NO_PASS'

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
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => kstToday())
  const [createError, setCreateError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const pendingRequest = useRef<{ key: string; requestId: string } | null>(null)
  const titleField = useRef<HTMLInputElement>(null)
  const titleErrorId = useId()
  const billingEnabled = useBillingConfig()?.enabled === true
  const billing = useBillingStore(billingEnabled, false)
  const billingStore = billing.store
  const status = billing.snapshot.status
  const rejected = createError?.code === NO_PASS ? createError.message : null

  // 다른 기기에서 이용권을 사거나 받으면(요금 알림) 거절 문장을 거두고 새 미리 보기를 보인다
  useEffect(() => {
    if (billingStore === null) return
    return billingStore.onNotice(() => setCreateError((error) => (error?.code === NO_PASS ? null : error)))
  }, [billingStore])

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
      // 미리 보기가 늦었다 — 요금 상태를 새로 받는다
      if (error.code === NO_PASS) void billingStore?.reload()
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
        {status !== null ? <BillingBanners banners={status.banners} navigate={navigate} /> : null}
        <div className="row">
          {/* 주 버튼은 하나 (D-101): 새 방송 칸이 열리면 그 칸의 "이 방송 시작하기"가 주 버튼 */}
          <button type="button" className={formOpen ? 'button' : 'button button-primary'} aria-expanded={formOpen} onClick={() => setFormOpen((open) => !open)}>
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
            {billingEnabled ? <StartPreviewNote start={status?.start ?? null} rejected={rejected} navigate={navigate} /> : null}
            <button type="submit" className="button button-primary" disabled={busy}>
              이 방송 시작하기
            </button>
          </form>
        ) : null}
        {createError !== null && rejected === null ? <ErrorNote error={createError} omitFields={['title', 'date']} /> : null}
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
