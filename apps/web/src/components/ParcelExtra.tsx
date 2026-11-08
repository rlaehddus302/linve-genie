// 직접 넣은 택배 (D-UX3-38): 방송 판매 기록 없이 받는 분·물품 수를 적어 그 날짜 접수 목록에 넣는다 — 택배 화면 위 칸·줄의 [고치기]·[지우기].
// 쓰기는 같은 내용이면 같은 요청 번호(끊기면 같은 번호로 다시). 받는 분 이름·주소는 글자로만 그린다.
import { useState } from 'react'
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import type { AddressFields, BundleView, ParcelRow } from '../api/parcel-types.ts'
import {
  ADDRESS_KEYS,
  ADDRESS_LABELS,
  EMPTY_ADDRESS,
  EXTRA_ADD,
  EXTRA_DELETE,
  EXTRA_DELETE_QUESTION,
  EXTRA_DELETED,
  EXTRA_EDIT,
  EXTRA_EDITED,
  EXTRA_HOW,
  EXTRA_QTY_LABEL,
  EXTRA_SAVED,
  EXTRA_TITLE,
  extraDateNote,
  extraDeleteDescription,
  extraFacts,
} from '../lib/parcel-words.ts'
import { RequestError } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import { AddressInputs, fieldNames, useParcelCommand } from './ParcelParts.tsx'

export interface ExtraDraft extends AddressFields {
  readonly qty: string
}

export const EMPTY_EXTRA: ExtraDraft = { ...EMPTY_ADDRESS, qty: '1' }

/** 보낼 본문: 여섯 칸 + 물품 수 (수가 아니면 글 그대로 보내 서버 문장을 받는다) */
export function extraBody(draft: ExtraDraft, buyer: string | null): Record<string, unknown> {
  const { qty, ...address } = draft
  const n = Number(qty.trim())
  return { ...(buyer === null ? {} : { buyer }), address, qty: /^[0-9]{1,4}$/.test(qty.trim()) ? n : qty }
}

/** 받는 분 넣기·고치기 창 */
function ExtraDialog({ title, initial, busy, error, onClose, onSave }: { readonly title: string; readonly initial: ExtraDraft; readonly busy: boolean; readonly error: ApiError | null; readonly onClose: () => void; readonly onSave: (draft: ExtraDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<ExtraDraft>(initial)
  const qtyProblem = error?.problemFor('qty')
  const submit = () => {
    if (!busy) void onSave(draft)
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <button type="button" className="button button-primary" disabled={busy} onClick={submit}>
          저장
        </button>
      }
    >
      <form
        className="stack-tight"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="stack-tight">
          <AddressInputs prefix="address" keys={ADDRESS_KEYS} labels={ADDRESS_LABELS} value={draft} onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))} error={error} />
          <div className="field">
            <label htmlFor="extra-qty">{EXTRA_QTY_LABEL}</label>
            <input id="extra-qty" className="input" inputMode="numeric" autoComplete="off" value={draft.qty} aria-invalid={qtyProblem !== undefined} onChange={(event) => setDraft((current) => ({ ...current, qty: event.target.value }))} />
            {qtyProblem !== undefined ? (
              <p className="field-error" role="alert">
                {qtyProblem.message}
              </p>
            ) : null}
          </div>
        </div>
        <button type="submit" hidden />
      </form>
      {busy ? <p role="status">저장하는 중…</p> : null}
      {error !== null ? <RequestError error={error} omitFields={[...fieldNames('address', ADDRESS_KEYS), 'qty']} /> : null}
    </Modal>
  )
}

/** 택배 화면 위 칸: 안내 + [받는 분 넣기] → 창 → 저장하면 onSaved(날짜) */
export function ExtraCard({ date, onSaved }: { readonly date: string; readonly onSaved: (date: string) => void }) {
  const command = useParcelCommand()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const save = async (draft: ExtraDraft) => {
    setDone(null)
    const result = await command.send<{ bundle: BundleView }>('PUT', `/api/parcels/days/${date}/extra`, extraBody(draft, null))
    if (result === null) return
    setOpen(false)
    setDone(EXTRA_SAVED)
    onSaved(date)
  }
  return (
    <section className="card stack" aria-labelledby="extra-title">
      <h2 id="extra-title" className="section-title">
        {EXTRA_TITLE}
      </h2>
      <p>{EXTRA_HOW}</p>
      <p className="hint">{extraDateNote(date)}</p>
      <div className="row">
        <button
          type="button"
          className="button"
          onClick={() => {
            setDone(null)
            command.clearError()
            setOpen(true)
          }}
        >
          {EXTRA_ADD}
        </button>
      </div>
      {done !== null ? (
        <p className="notice" role="status" data-tone="success">
          {done}
        </p>
      ) : null}
      {command.error !== null && !open ? <RequestError error={command.error} /> : null}
      {open ? (
        <ExtraDialog
          title={EXTRA_TITLE}
          initial={EMPTY_EXTRA}
          busy={command.busy}
          error={command.error}
          onClose={() => {
            setOpen(false)
            command.clearError()
          }}
          onSave={save}
        />
      ) : null}
    </section>
  )
}

/** 직접 넣은 줄의 사실 한 줄 */
export function ExtraFacts({ row }: { readonly row: ParcelRow }) {
  return (
    <p className="row parcel-facts">
      <span className="tag">{extraFacts(row.qty)}</span>
    </p>
  )
}

/** 직접 넣은 줄의 [고치기]·[지우기] (접수 전 줄에만 — 접수한 줄은 접수 취소가 먼저) */
export function ExtraRowActions({ date, row, disabled, onChanged }: { readonly date: string; readonly row: ParcelRow; readonly disabled: boolean; readonly onChanged: () => void }) {
  const command = useParcelCommand()
  const [ask, setAsk] = useState<'edit' | 'delete' | null>(null)
  const [initial, setInitial] = useState<ExtraDraft | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const edit = async () => {
    setDone(null)
    setLoadError(null)
    command.clearError()
    try {
      const { bundle } = await get<{ bundle: BundleView }>(withQuery(`/api/parcels/days/${date}/bundle`, { buyer: row.buyer }))
      const address = bundle.address
      setInitial({ ...(address === null ? EMPTY_ADDRESS : { name: address.name, phone: address.phone, address: address.address, detail: address.detail, zip: address.zip, memo: address.memo }), qty: String(bundle.row.qty) })
      setAsk('edit')
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setLoadError(caught)
    }
  }
  const save = async (draft: ExtraDraft) => {
    const result = await command.send<{ bundle: BundleView }>('PUT', `/api/parcels/days/${date}/extra`, extraBody(draft, row.buyer))
    if (result === null) return
    setAsk(null)
    setDone(EXTRA_EDITED)
    onChanged()
  }
  const remove = async () => {
    const result = await command.send<{ buyer: string }>('POST', `/api/parcels/days/${date}/extra/delete`, { buyer: row.buyer })
    if (result === null) return
    setAsk(null)
    setDone(EXTRA_DELETED)
    onChanged()
  }
  return (
    <>
      <div className="row" role="group" aria-label={`${row.name} 직접 넣은 택배`}>
        <button
          type="button"
          className="button"
          disabled={disabled || command.busy}
          onClick={() => {
            setDone(null)
            command.clearError()
            setAsk('delete')
          }}
        >
          {EXTRA_DELETE}
        </button>
        <button type="button" className="button" disabled={disabled || command.busy} onClick={() => void edit()}>
          {EXTRA_EDIT}
        </button>
      </div>
      {done !== null ? (
        <p className="notice" role="status" data-tone="success">
          {done}
        </p>
      ) : null}
      {loadError !== null ? <RequestError error={loadError} /> : null}
      {command.error !== null && ask === null ? <RequestError error={command.error} /> : null}
      {ask === 'edit' && initial !== null ? (
        <ExtraDialog
          title={`${row.name} ${EXTRA_EDIT}`}
          initial={initial}
          busy={command.busy}
          error={command.error}
          onClose={() => {
            setAsk(null)
            command.clearError()
          }}
          onSave={save}
        />
      ) : null}
      {ask === 'delete' ? (
        <Modal
          title={EXTRA_DELETE_QUESTION}
          onClose={() => setAsk(null)}
          actions={
            <button type="button" className="button button-danger" disabled={command.busy} onClick={() => void remove()}>
              {EXTRA_DELETE}
            </button>
          }
        >
          <p>{extraDeleteDescription(row.name)}</p>
          {command.error !== null ? <RequestError error={command.error} /> : null}
        </Modal>
      ) : null}
    </>
  )
}
