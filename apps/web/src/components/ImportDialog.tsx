// 상품 목록 가져오기 창 (PRD-05, R-18, D-I2-09, UX-01·03·05, AC-I2-52).
// - 붙여 넣기 칸(여러 줄) 또는 "파일 고르기"(.xlsx·.csv·.txt) → "미리 보기"(서버가 R-18로 해석 — 기록하지 않는다).
// - 미리 보기: "등록할 상품 n개 · 빼는 줄 m개", 머리글이 있으면 "머리글로 보고 뺀 줄: 1번 줄 (번호, 품종, 가격)", 표(줄 번호·번호·품종·가격·문제).
//   문제 줄은 주의 색과 글(코드는 보이지 않는다). 빈 품종은 "품종 미입력".
// - "n개 등록하기"(주 버튼)는 미리 보기가 확인이라 따로 묻지 않고 바로 보낸다. 성공하면 "n개를 공개 전 상품으로 등록했어요."
//   거절되면(그 사이 바뀜) 같은 글·파일로 새 미리 보기를 받고 "그 사이에 바뀐 것이 있어요. 다시 확인해 주세요."
// - 같은 줄을 다시 보내면(연결이 끊긴 뒤) 같은 요청 번호 — 두 번 등록되지 않는다. 창을 닫으면 포커스는 빠른 입력칸으로(콘솔이 한다).
import { formatWon } from '@livejjim/core'
import { useContext, useId, useRef, useState } from 'react'
import { isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import type { ImportPreview } from '../api/types.ts'
import { IMPORT_GUIDE, IMPORT_CHANGED, IMPORT_EMPTY, IMPORT_TOO_MANY, IMPORT_FILE_MAX_BYTES, IMPORT_FILE_TOO_LARGE, IMPORT_OPTIONS_NOTE, importProblemWords } from '../lib/import-words.ts'
import { fileBase64 } from '../lib/files.ts'
import { RequestError } from './ErrorNote.tsx'
import { ConsoleContext } from './console-context.ts'
import { Modal } from './Modal.tsx'

export { IMPORT_GUIDE, IMPORT_CHANGED, IMPORT_EMPTY, IMPORT_TOO_MANY, IMPORT_FILE_MAX_BYTES, IMPORT_FILE_TOO_LARGE, IMPORT_OPTIONS_NOTE, importProblemWords } from '../lib/import-words.ts'

type Source = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'file'; readonly name: string; readonly data: string }

interface RegisterRow {
  readonly no: number
  readonly name: string
  readonly price: number
}

export interface ImportDialogProps {
  readonly broadcastId: string
  readonly onClose: () => void
  /** 등록이 저장됐다 — 응답 seq까지 화면을 따라잡는다 */
  readonly onRegistered: (seq: number) => Promise<void>
}

export function ImportDialog({ broadcastId, onClose, onRegistered }: ImportDialogProps) {
  const id = useId()
  const textArea = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [file, setFile] = useState<{ readonly name: string; readonly data: string } | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  /** 미리 보기를 만든 입력 (등록이 거절되면 같은 입력으로 다시 미리 보기) */
  const [previewSource, setPreviewSource] = useState<Source | null>(null)
  const [busy, setBusy] = useState<'preview' | 'register' | 'file' | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [changedNotice, setChangedNotice] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [tooLarge, setTooLarge] = useState(false)
  const pending = useRef<{ key: string; requestId: string } | null>(null)
  const base = `/api/broadcasts/${encodeURIComponent(broadcastId)}/import`

  const source: Source | null = file !== null ? { kind: 'file', name: file.name, data: file.data } : text.trim() === '' ? null : { kind: 'text', text }

  const runPreview = async (input: Source): Promise<ImportPreview | null> => {
    setBusy('preview')
    setError(null)
    try {
      const body = input.kind === 'text' ? { text: input.text } : { file: { name: input.name, data: input.data } }
      const result = await post<ImportPreview>(`${base}/preview`, body)
      setPreview(result)
      setPreviewSource(input)
      return result
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      return null
    } finally {
      setBusy(null)
    }
  }

  const showPreview = () => {
    if (source === null || busy !== null) return
    setDone(null)
    setChangedNotice(false)
    void runPreview(source)
  }

  const rows: RegisterRow[] = preview === null ? [] : preview.rows.flatMap((row) => ('error' in row ? [] : [{ no: row.no, name: row.name, price: row.price }]))

  const register = async () => {
    if (preview === null || rows.length === 0 || busy !== null) return
    const key = JSON.stringify(rows)
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const { requestId } = pending.current
    setBusy('register')
    setError(null)
    setChangedNotice(false)
    try {
      const result = await withRetry(() => post<{ registered: number; seq: number }>(base, { requestId, rows }))
      pending.current = null
      await onRegistered(result.seq)
      setDone(result.registered)
      setPreview(null)
      setPreviewSource(null)
      setText('')
      setFile(null)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) pending.current = null
      if (caught.code === 'IMPORT_CHANGED' && previewSource !== null) {
        setBusy(null)
        await runPreview(previewSource)
        setChangedNotice(true)
        return
      }
      setError(caught)
    } finally {
      setBusy(null)
    }
  }

  /** 파일을 고르면 그 파일이 입력이다 (붙여 넣은 글은 비운다 — 한 번에 하나) */
  const pickFile = async (picked: File | undefined) => {
    if (picked === undefined) return
    setError(null)
    setDone(null)
    setPreview(null)
    setChangedNotice(false)
    if (picked.size > IMPORT_FILE_MAX_BYTES) {
      setFile(null)
      setTooLarge(true)
      return
    }
    setTooLarge(false)
    setBusy('file')
    try {
      setFile({ name: picked.name, data: await fileBase64(picked) })
      setText('')
    } finally {
      setBusy(null)
    }
  }

  const optionBroadcast = useContext(ConsoleContext)?.options === true
  const listError = preview?.error === 'EMPTY' ? IMPORT_EMPTY : preview?.error === 'TOO_MANY' ? IMPORT_TOO_MANY : null
  const count = preview === null ? 0 : preview.register

  return (
    <Modal
      title="상품 목록 가져오기"
      onClose={onClose}
      initialFocus={textArea}
      wide
      actions={
        <>
          <button type="button" className="button" disabled={source === null || busy !== null} onClick={showPreview}>
            미리 보기
          </button>
          <button type="button" className="button button-primary" disabled={preview === null || count === 0 || busy !== null} onClick={() => void register()}>
            {String(count)}개 등록하기
          </button>
        </>
      }
    >
      <p>{IMPORT_GUIDE}</p>
      {optionBroadcast ? (
        <p className="warning" role="note" data-tone="warning">
          {IMPORT_OPTIONS_NOTE}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor={`${id}-text`}>붙여 넣기</label>
        <textarea
          id={`${id}-text`}
          ref={textArea}
          className="input import-text"
          rows={6}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            // 글을 고치면 고른 파일·지난 미리 보기는 쓰지 않는다
            setFile(null)
            setTooLarge(false)
            setPreview(null)
            setDone(null)
          }}
        />
      </div>
      <div className="row">
        <input
          id={`${id}-file`}
          className="visually-hidden"
          type="file"
          accept=".xlsx,.csv,.txt"
          onChange={(event) => {
            void pickFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <label htmlFor={`${id}-file`} className="button">
          파일 고르기
        </label>
        {file !== null ? <span>고른 파일: {file.name}</span> : null}
        {busy === 'file' ? <span role="status">파일을 읽는 중…</span> : null}
      </div>
      {tooLarge ? (
        <p className="field-error" role="alert">
          {IMPORT_FILE_TOO_LARGE}
        </p>
      ) : null}
      {busy === 'preview' ? <p role="status">미리 보기를 만드는 중이에요…</p> : null}
      {busy === 'register' ? <p role="status">등록하는 중이에요…</p> : null}
      {done !== null ? (
        <p className="notice" role="status" data-tone="success">
          {String(done)}개를 공개 전 상품으로 등록했어요.
        </p>
      ) : null}
      {changedNotice ? (
        <p className="notice" role="alert" data-tone="warning">
          {IMPORT_CHANGED}
        </p>
      ) : null}
      {error !== null ? <RequestError error={error} /> : null}
      {preview !== null ? <PreviewView preview={preview} listError={listError} /> : null}
    </Modal>
  )
}

function PreviewView({ preview, listError }: { readonly preview: ImportPreview; readonly listError: string | null }) {
  if (listError !== null) {
    return (
      <p className="notice" role="status" data-tone="warning">
        {listError}
      </p>
    )
  }
  return (
    <section className="stack-tight import-preview" aria-label="미리 보기">
      <p className="summary-line">
        등록할 상품 {String(preview.register)}개 · 빼는 줄 {String(preview.problems)}개
      </p>
      {preview.header !== null ? (
        <p>
          머리글로 보고 뺀 줄: {String(preview.header)}번 줄{preview.headerCells !== null && preview.headerCells.length > 0 ? ` (${preview.headerCells.join(', ')})` : ''}
        </p>
      ) : null}
      <div className="table-scroll">
        <table className="list-table import-table" aria-label="가져올 상품">
          <thead>
            <tr>
              <th scope="col">줄</th>
              <th scope="col">번호</th>
              <th scope="col">품종</th>
              <th scope="col" className="num">
                가격
              </th>
              <th scope="col">문제</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) =>
              'error' in row ? (
                <tr key={row.line} className="import-problem" data-tone="warning">
                  <td>{String(row.line)}</td>
                  <td colSpan={3} className="import-original">
                    {row.text}
                  </td>
                  <td>{importProblemWords(row.error, preview.maxNumber)}</td>
                </tr>
              ) : (
                <tr key={row.line}>
                  <td>{String(row.line)}</td>
                  <td>{String(row.no)}번</td>
                  <td>{row.name.trim() === '' ? '품종 미입력' : row.name}</td>
                  <td className="num">{formatWon(row.price)}</td>
                  <td />
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
