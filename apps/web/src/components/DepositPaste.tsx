// 입금 내역 붙여넣기 (N3, DP-1·DP-2, D-N3-08, AC-N3-45·13).
// 글 칸에 은행 거래내역 표를 머리글 줄까지 붙여 넣거나 CSV 파일을 고른다(UTF-8로 읽어 보고 아니면 EUC-KR).
// "읽어 보기" → 서버 미리 보기(아무것도 기록하지 않음): 줄마다 새 입금·이미 있는 입금·오래된 입금·시각이 앞으로인 입금, 건너뛴 줄 수,
// 읽지 못한 줄은 줄 번호와 이유 → "입금 내역 넣기"(주 버튼) → 결과 문장 "새 입금 5건 — 자동 확인 3건, 확인 필요 2건 (이미 있던 입금 1건)".
// 미리 본 글이 바뀌면 다시 읽어 봐야 넣을 수 있다. 넣은 뒤 글 칸을 비운다. 머리글 없음·줄 수 초과·너무 큼은 서버 문장을 그대로.
// 붙여 넣은 글은 이 화면에만 있고 어디에도 남기지 않는다(주소·저장소에 넣지 않는다).
import { formatWon } from '@livejjim/core'
import { useId, useState, type ChangeEvent } from 'react'
import { isApiError, post, type ApiError } from '../api/client.ts'
import type { PastePreview, PasteSummary } from '../api/deposit-types.ts'
import { readCsvFile } from '../lib/csv-text.ts'
import { PASTE_STATE_WORD, UNREADABLE_WORD, depositName, depositTime, pasteResultWords } from '../lib/deposit-words.ts'
import { useWide } from '../lib/use-wide.ts'
import { useDepositStore } from './deposit-context.tsx'
import { useAction } from './deposit-parts.tsx'
import { ErrorNote } from './ErrorNote.tsx'

export const PASTE_HINT = '은행 거래내역 표를 첫 줄(거래일시·입금액 같은 칸 이름)까지 복사해 붙여 넣거나 은행에서 받은 파일(.csv)을 골라 주세요. 출금 줄은 넣지 않아요.'
export const FILE_ERROR = '파일을 읽지 못했어요. 은행에서 받은 .csv 파일인지 확인해 주세요.'

interface Result {
  readonly summary: PasteSummary
}

const lineWords = (line: number, why: keyof typeof UNREADABLE_WORD): string => `${String(line)}번째 줄: ${UNREADABLE_WORD[why]}`

export function PasteTab() {
  const textId = useId()
  const fileId = useId()
  const store = useDepositStore()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ readonly text: string; readonly view: PastePreview } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<ApiError | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const insert = useAction()
  const current = preview !== null && preview.text === text ? preview.view : null

  const edit = (value: string) => {
    setText(value)
    setResult(null)
    insert.clear()
  }

  const readPreview = async (value: string = text) => {
    if (value.trim() === '') {
      setPreviewError(null)
      setFileError('입금 내역을 붙여 넣어 주세요.')
      return
    }
    setFileError(null)
    setPreviewing(true)
    setPreviewError(null)
    setResult(null)
    try {
      const view = await post<PastePreview>('/api/deposits/paste/preview', { text: value })
      setPreview({ text: value, view })
    } catch (error) {
      if (!isApiError(error)) throw error
      setPreview(null)
      setPreviewError(error)
    } finally {
      setPreviewing(false)
    }
  }

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    try {
      const value = await readCsvFile(file)
      edit(value)
      await readPreview(value)
    } catch {
      setFileError(FILE_ERROR)
    }
  }

  const send = async () => {
    if (current === null) return
    const sent = text
    const summary = await insert.run<PasteSummary>('/api/deposits/paste', { text: sent })
    if (summary === null) return
    setResult({ summary })
    setText('')
    setPreview(null)
    void store?.refreshCount()
  }

  return (
    <div className="stack paste-tab">
      <p className="hint">{PASTE_HINT}</p>
      <div className="field">
        <label htmlFor={textId}>입금 내역</label>
        <textarea id={textId} className="input paste-input" rows={8} spellCheck={false} autoComplete="off" value={text} onChange={(event) => edit(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={fileId}>은행 파일 고르기(.csv)</label>
        <input id={fileId} className="input file-input" type="file" accept=".csv,text/csv,text/plain" onChange={(event) => void pickFile(event)} />
      </div>
      {fileError !== null ? (
        <p className="field-error" role="alert">
          {fileError}
        </p>
      ) : null}
      <div className="row" role="group" aria-label="붙여넣기">
        <button type="button" className="button" disabled={previewing} onClick={() => void readPreview()}>
          {previewing ? '읽는 중…' : '읽어 보기'}
        </button>
        <button type="button" className="button button-primary" disabled={current === null || current.rows.length === 0 || insert.busy} onClick={() => void send()}>
          {insert.busy ? '넣는 중…' : '입금 내역 넣기'}
        </button>
      </div>
      {preview !== null && current === null ? <p className="hint">글이 바뀌었어요. "읽어 보기"를 다시 눌러 주세요.</p> : null}
      {previewError !== null ? <ErrorNote error={previewError} /> : null}
      {insert.error !== null ? <ErrorNote error={insert.error} {...(insert.error.transient ? { onRetry: () => void send() } : {})} /> : null}
      {result !== null ? <PasteResult summary={result.summary} /> : null}
      {current !== null ? <PreviewView view={current} /> : null}
    </div>
  )
}

function PasteResult({ summary }: { readonly summary: PasteSummary }) {
  const lines: string[] = []
  if (summary.old > 0 || summary.future > 0) lines.push(`오래된 입금 ${String(summary.old)}건, 시각이 앞으로인 입금 ${String(summary.future)}건은 넣지 않았어요.`)
  if (summary.skipped > 0) lines.push(`건너뛴 줄 ${String(summary.skipped)}개(출금 등)`)
  for (const item of summary.unreadable) lines.push(lineWords(item.line, item.why))
  return (
    <div className="notice stack-tight paste-result" role="status" data-tone="success">
      <p>
        <strong>{pasteResultWords(summary)}</strong>
      </p>
      {lines.length > 0 ? (
        <ul className="plain-list">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function PreviewView({ view }: { readonly view: PastePreview }) {
  const wide = useWide()
  const count = (state: keyof typeof PASTE_STATE_WORD) => view.rows.filter((row) => row.state === state).length
  return (
    <section className="stack-tight paste-preview" aria-label="읽어 본 결과">
      <h2 className="section-title">읽어 본 결과</h2>
      <p>
        읽은 입금 {view.rows.length}건 · 건너뛴 줄 {view.skipped.length}개(출금 등) · 읽지 못한 줄 {view.unreadable.length}개
      </p>
      <p>
        {(['NEW', 'EXISTING', 'OLD', 'FUTURE'] as const).map((state) => `${PASTE_STATE_WORD[state]} ${String(count(state))}건`).join(' · ')}
      </p>
      {view.unreadable.length > 0 ? (
        <ul className="plain-list stack-tight" aria-label="읽지 못한 줄">
          {view.unreadable.map((item) => (
            <li key={item.line} className="field-error">
              {lineWords(item.line, item.why)}
            </li>
          ))}
        </ul>
      ) : null}
      {view.rows.length === 0 ? null : wide ? (
        <div className="table-scroll">
          <table className="list-table" aria-label="읽은 입금">
            <thead>
              <tr>
                <th scope="col">줄</th>
                <th scope="col">입금 시각</th>
                <th scope="col">입금자명</th>
                <th scope="col" className="num">
                  금액
                </th>
                <th scope="col">넣으면</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.line}>
                  <td>{row.line}</td>
                  <td>{depositTime(row.at, row.precision)}</td>
                  <td className="cell-name">{depositName(row.name)}</td>
                  <td className="num">{formatWon(row.amount)}</td>
                  <td>
                    <span className={`tag paste-${row.state}`}>{PASTE_STATE_WORD[row.state]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="plain-list stack-tight" aria-label="읽은 입금">
          {view.rows.map((row) => (
            <li key={row.line} className="claim-row">
              <p>
                <span className={`tag paste-${row.state}`}>{PASTE_STATE_WORD[row.state]}</span> {row.line}번째 줄
              </p>
              <p>
                {depositTime(row.at, row.precision)} · {depositName(row.name)} · {formatWon(row.amount)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
