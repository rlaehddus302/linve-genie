// 계좌 연동 (N3, DP-1, D-N3-09, AC-N3-46·14·15·16·25).
// - 원천 목록: 표시 이름·종류·계좌번호 끝 4자리·켜짐/꺼짐·주기·"마지막으로 받아 온 때 10/18 21:05"·마지막 오류 문장,
//   받아 오기가 있는 원천마다 "지금 받아 오기"·주기 고르기(1~5분)·켜기/끄기. 붙여넣기 원천은 받아 오기가 없다.
// - 계좌조회 원천 추가: 표시 이름·사업자번호·은행·계좌번호(번호 칸은 숫자 키패드) — 계좌 비밀번호는 받지 않는다
//   ("계좌 비밀번호는 여기에 적지 않아요. 팝빌 계좌 관리에서 등록해요."), "팝빌에서 계좌 등록·관리"는 서버가 준 주소를 새 창으로.
//   연동 키가 없는 서버면 추가 대신 "계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요."
// - 시험 모드 서버에서만 "시험용 입금 원천 추가"(가짜 원천, D-N3-12).
// - 기억한 입금자명 목록(입금자명 → 구매자 표시 이름)과 줄마다 "지우기"(확인 뒤).
// 사업자번호·계좌번호는 보낸 뒤 칸을 비우고 화면 어디에도 남기지 않는다(서버도 끝 4자리만 돌려준다).
import { useEffect, useId, useState, type FormEvent } from 'react'
import { del, get, isApiError, patch, post, type ApiError } from '../api/client.ts'
import type { RememberedName, SourceView, SourcesView } from '../api/deposit-types.ts'
import { BANKS, SOURCE_KIND_WORD, bankName, intervalWords } from '../lib/deposit-words.ts'
import { kstShort } from '../lib/kst.ts'
import { useDepositSignal } from './deposit-context.tsx'
import { ErrorNote, FieldError } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'

export const POPBILL_NOT_READY = '계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요.'
export const NO_PASSWORD = '계좌 비밀번호는 여기에 적지 않아요. 팝빌 계좌 관리에서 등록해요.'
export const MANAGE_WORDS = '팝빌에서 계좌 등록·관리'
const INTERVALS = [1, 2, 3, 4, 5] as const

function useSources(): { readonly view: SourcesView | null; readonly error: ApiError | null; readonly reload: () => Promise<void> } {
  const signal = useDepositSignal()
  const [view, setView] = useState<SourcesView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const reload = async () => {
    try {
      setView(await get<SourcesView>('/api/deposits/sources'))
      setError(null)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    }
  }
  useEffect(() => {
    void reload()
  }, [signal.sourcesTick])
  return { view, error, reload }
}

/** 팝빌 계좌 관리 주소를 새 창으로 연다 — 창은 누를 때 먼저 열어 둔다(응답을 기다린 뒤 열면 브라우저가 막는다) */
async function openManage(body: Readonly<Record<string, unknown>>): Promise<ApiError | null> {
  const win = window.open('', '_blank')
  try {
    const { url } = await post<{ url: string }>('/api/deposits/popbill/manage-url', body)
    if (!/^https:\/\//.test(url)) {
      win?.close()
      return null
    }
    if (win === null) {
      window.location.assign(url)
      return null
    }
    win.opener = null
    win.location.href = url
    return null
  } catch (error) {
    win?.close()
    if (!isApiError(error)) throw error
    return error
  }
}

export function SourcesTab() {
  const sources = useSources()
  const titleId = useId()
  const addId = useId()
  return (
    <div className="stack sources-tab">
      <section className="card stack" aria-labelledby={titleId}>
        <h2 id={titleId} className="section-title">
          입금 받는 곳
        </h2>
        {sources.error !== null ? <ErrorNote error={sources.error} onRetry={() => void sources.reload()} retryLabel="다시 불러오기" /> : null}
        {sources.view === null ? (
          sources.error === null ? (
            <p role="status">불러오는 중…</p>
          ) : null
        ) : sources.view.sources.length === 0 ? (
          <p>아직 입금 받는 곳이 없어요. 붙여넣기로 넣거나 계좌를 연결해 주세요.</p>
        ) : (
          <ul className="plain-list stack-tight" aria-label="입금 받는 곳">
            {sources.view.sources.map((source) => (
              <SourceItem key={source.id} source={source} onChanged={() => void sources.reload()} />
            ))}
          </ul>
        )}
      </section>
      <section className="card stack" aria-labelledby={addId}>
        <h2 id={addId} className="section-title">
          계좌 연결
        </h2>
        {sources.view === null ? null : sources.view.popbill ? <AddPopbill onAdded={() => void sources.reload()} /> : <p className="notice" data-tone="info">{POPBILL_NOT_READY}</p>}
        {sources.view?.testMode === true ? <AddFake onAdded={() => void sources.reload()} /> : null}
      </section>
      <RememberedNames />
    </div>
  )
}

function SourceItem({ source, onChanged }: { readonly source: SourceView; readonly onChanged: () => void }) {
  const intervalId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [manageError, setManageError] = useState<ApiError | null>(null)
  const act = async (send: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await send()
      onChanged()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  const kind = SOURCE_KIND_WORD[source.kind] ?? ''
  return (
    <li className="claim-row source-item" aria-label={`입금 받는 곳 ${source.label}`}>
      <p>
        <strong>{source.label}</strong>
        {source.label.trim() === kind ? '' : ` · ${kind}`}
        {source.accountLast4 !== null ? ` · ${bankName(source.bank)} 계좌 끝 ${source.accountLast4}` : ''}
        {source.fetchable ? (
          <>
            {' · '}
            <span className={source.enabled ? 'tag tag-live' : 'tag'}>{source.enabled ? '켜짐' : '꺼짐'}</span>
            {` · ${intervalWords(source.intervalMin)}`}
          </>
        ) : null}
      </p>
      {source.fetchable ? (
        <p>
          {source.lastFetchedAt === null ? '아직 받아 오지 않았어요' : `마지막으로 받아 온 때 ${kstShort(source.lastFetchedAt)}`}
          {source.lastNew !== null && source.lastFetchedAt !== null ? ` · 새 입금 ${String(source.lastNew)}건` : ''}
          {source.fetching ? ' · 받아 오는 중' : ''}
        </p>
      ) : (
        <p className="hint">받아 오기가 없어요. "붙여넣기"에서 넣어요.</p>
      )}
      {source.lastError !== null ? (
        <p className="warning" data-tone="warning">
          {source.lastError}
          {source.lastErrorAt !== null ? ` (${kstShort(source.lastErrorAt)})` : ''}
        </p>
      ) : null}
      {source.fetchable ? (
        <div className="toolbar">
          <button type="button" className="button" disabled={busy || !source.enabled} onClick={() => void act(() => post(`/api/deposits/sources/${encodeURIComponent(source.id)}/fetch`, {}))}>
            지금 받아 오기
          </button>
          <div className="field">
            <label htmlFor={intervalId}>받아 오는 주기</label>
            <select
              id={intervalId}
              className="input"
              value={source.intervalMin}
              disabled={busy}
              onChange={(event) => void act(() => patch(`/api/deposits/sources/${encodeURIComponent(source.id)}`, { intervalMin: Number(event.target.value) }))}
            >
              {INTERVALS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {intervalWords(minutes)}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="button" disabled={busy} onClick={() => void act(() => patch(`/api/deposits/sources/${encodeURIComponent(source.id)}`, { enabled: !source.enabled }))}>
            {source.enabled ? '끄기' : '켜기'}
          </button>
          {source.kind === 'POPBILL' ? (
            <button
              type="button"
              className="button"
              onClick={() =>
                void openManage({ source: source.id }).then((caught) => {
                  setManageError(caught)
                })
              }
            >
              {MANAGE_WORDS}
            </button>
          ) : null}
        </div>
      ) : null}
      {error !== null ? <ErrorNote error={error} /> : null}
      {manageError !== null ? <ErrorNote error={manageError} /> : null}
    </li>
  )
}

/** 계좌조회 원천 추가 (AC-N3-46·16): 비밀번호 칸은 없다 */
function AddPopbill({ onAdded }: { readonly onAdded: () => void }) {
  const ids = { label: useId(), corp: useId(), bank: useId(), account: useId() }
  const [label, setLabel] = useState('')
  const [corpNum, setCorpNum] = useState('')
  const [bank, setBank] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [manageError, setManageError] = useState<ApiError | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setAdded(null)
    try {
      const source = await post<SourceView>('/api/deposits/sources', { kind: 'POPBILL', label: label.trim(), corpNum, bank, accountNumber })
      setAdded(`${source.label} 계좌를 연결했어요. 팝빌 계좌 관리에서 빠른조회 등록을 마쳐야 내역을 받아 와요.`)
      setLabel('')
      setCorpNum('')
      setBank('')
      setAccountNumber('')
      onAdded()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="stack-tight add-source" onSubmit={(event) => void submit(event)}>
      <p className="notice" data-tone="info">
        {NO_PASSWORD}
      </p>
      <div className="field">
        <label htmlFor={ids.label}>표시 이름</label>
        <input id={ids.label} className="input" autoComplete="off" maxLength={20} placeholder="국민 1234" value={label} onChange={(event) => setLabel(event.target.value)} />
        <FieldError error={error} field="label" />
      </div>
      <div className="field">
        <label htmlFor={ids.corp}>사업자번호</label>
        <input id={ids.corp} className="input" inputMode="numeric" autoComplete="off" value={corpNum} onChange={(event) => setCorpNum(event.target.value)} />
        <FieldError error={error} field="corpNum" />
      </div>
      <div className="field">
        <label htmlFor={ids.bank}>은행</label>
        <select id={ids.bank} className="input" value={bank} onChange={(event) => setBank(event.target.value)}>
          <option value="">은행을 골라 주세요</option>
          {BANKS.map((item) => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </select>
        <FieldError error={error} field="bank" />
      </div>
      <div className="field">
        <label htmlFor={ids.account}>계좌번호</label>
        <input id={ids.account} className="input" inputMode="numeric" autoComplete="off" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} />
        <FieldError error={error} field="accountNumber" />
      </div>
      <div className="row">
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? '보내는 중…' : '계좌 연결'}
        </button>
        <button
          type="button"
          className="button"
          onClick={() =>
            void openManage({ corpNum }).then((caught) => {
              setManageError(caught)
            })
          }
        >
          {MANAGE_WORDS}
        </button>
      </div>
      {added !== null ? (
        <p className="notice" role="status" data-tone="success">
          {added}
        </p>
      ) : null}
      {error !== null && error.problems.length === 0 ? <ErrorNote error={error} /> : null}
      {manageError !== null ? <ErrorNote error={manageError} /> : null}
    </form>
  )
}

/** 시험 모드에서만: 가짜 원천 (D-N3-12) */
function AddFake({ onAdded }: { readonly onAdded: () => void }) {
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      await post('/api/deposits/sources', { kind: 'FAKE' })
      onAdded()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack-tight">
      <p className="hint">시험 모드 서버예요. 시험용 입금 받는 곳은 실제 계좌가 아니에요.</p>
      <div>
        <button type="button" className="button" disabled={busy} onClick={() => void add()}>
          시험용 입금 받는 곳 추가
        </button>
      </div>
      {error !== null ? <ErrorNote error={error} /> : null}
    </div>
  )
}

// ── 기억한 입금자명 (AC-N3-25·46) ─────────────────────────────────────────

function RememberedNames() {
  const titleId = useId()
  const signal = useDepositSignal()
  const [names, setNames] = useState<readonly RememberedName[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [forgetting, setForgetting] = useState<RememberedName | null>(null)
  const reload = async () => {
    try {
      const result = await get<{ names: RememberedName[] }>('/api/deposits/names')
      setNames(result.names)
      setError(null)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    }
  }
  useEffect(() => {
    void reload()
  }, [signal.tick])
  return (
    <section className="card stack" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        기억한 입금자명
      </h2>
      <p className="hint">확인 필요에서 확정할 때 기억한 입금자명이에요. 다음에 같은 입금자명·같은 금액이 오면 그 구매자 묶음으로 자동 확인해요.</p>
      {error !== null ? <ErrorNote error={error} onRetry={() => void reload()} retryLabel="다시 불러오기" /> : null}
      {names === null ? null : names.length === 0 ? (
        <p>기억한 입금자명이 없어요.</p>
      ) : (
        <ul className="plain-list stack-tight" aria-label="기억한 입금자명">
          {names.map((item) => (
            <li key={item.id} className="claim-row remembered-name" aria-label={`${item.name} → ${item.buyerName}`}>
              <p>
                <strong>{item.name}</strong> → {item.buyerName}
              </p>
              <div>
                <button type="button" className="button" onClick={() => setForgetting(item)}>
                  지우기
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {forgetting !== null ? (
        <ForgetDialog
          item={forgetting}
          onClose={() => setForgetting(null)}
          onDone={() => {
            setForgetting(null)
            void reload()
          }}
        />
      ) : null}
    </section>
  )
}

function ForgetDialog({ item, onClose, onDone }: { readonly item: RememberedName; readonly onClose: () => void; readonly onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const forget = async () => {
    setBusy(true)
    setError(null)
    try {
      await del(`/api/deposits/names/${String(item.id)}`)
      onDone()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="기억한 입금자명 지우기"
      onClose={onClose}
      actions={
        <button type="button" className="button button-danger" disabled={busy} onClick={() => void forget()}>
          {busy ? '지우는 중…' : '지우기'}
        </button>
      }
    >
      <p>
        "{item.name}" → {item.buyerName}
      </p>
      <p>이 입금자명을 지울까요? 지운 뒤에는 이 입금자명으로 자동 확인하지 않아요. 이미 적은 입금 기록은 그대로예요.</p>
      {error !== null ? <ErrorNote error={error} /> : null}
    </Modal>
  )
}
