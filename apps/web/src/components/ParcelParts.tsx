// 택배 조각 (T1, PARCEL_RULES PC-2·PC-3·PC-8, D-T1-06, AC-T1-65): 배송지 칸 양식·묶음 자세히의 "배송지" 칸·"택배: 상태 · 송장번호" 꼬리표.
// - 배송지 칸 여섯(받는 분·연락처·주소·상세 주소·우편번호(몰라도 돼요)·배송 메모). 틀리면 칸마다 서버 문장(같은 함수 PC-2 — 화면이 따로 검사하지 않는다).
// - 묶음 자세히: 없으면 "배송지가 없어요" + "배송지 적기" + 안내, 있으면 여섯 칸·출처·"배송지 확인"(확인 전)·"고치기"·"지우기"(확인 창).
//   살아 있는 접수가 있으면 고치기·지우기 없이 "택배 접수를 먼저 취소해 주세요.", 직접 수령·합배송은 그 한 문장.
// - 이름·주소·메모는 React 기본 이스케이프로만 그린다(규칙 7). 연락처·주소는 주소창·로그에 넣지 않는다(본문 POST만).
// - 쓰기는 누를 때 만든 요청 번호로 보내고 연결이 끊기면 같은 요청 번호로 다시 보낸다. 봉인한 날짜는 Lock이 잠근다.
import { useEffect, useId, useRef, useState } from 'react'
import { get, isApiError, newRequestId, post, put, withQuery, withRetry, type ApiError } from '../api/client.ts'
import type { AddressFields, BundleView, ParcelBrief } from '../api/parcel-types.ts'
import {
  ADDRESS_CONFIRMED,
  ADDRESS_DELETED,
  ADDRESS_EXPIRED,
  ADDRESS_KEYS,
  ADDRESS_LABELS,
  ADDRESS_SAVED,
  BUYER_CAN_WRITE,
  COMBINED_BUNDLE,
  EMPTY_ADDRESS,
  LOCKED_ADDRESS,
  NO_ADDRESS,
  PICKUP_BUNDLE,
  addressShape,
  checkedWords,
  parcelLine,
  parcelTone,
  phoneWords,
  confirmedWords,
  sourceWords,
} from '../lib/parcel-words.ts'
import { RequestError } from './ErrorNote.tsx'
import { Lock } from './Lock.tsx'
import { Modal } from './Modal.tsx'
// KP1 지난 주문 배송지 "확인 전" (CR-4, AC-KP1-08)
import { LedgerPrefillBlock, prefillAddress } from './CustomerLedger.tsx'
import { PREFILL_CONFIRMED, useLedgerVersion } from '../lib/ledger.ts'

/** "택배: 배송 중 · 9000-0000-0001" 꼬리표 (색 + 글자) */
export function ParcelTag({ parcel }: { readonly parcel: ParcelBrief }) {
  return (
    <span className="tag parcel-tag" data-tone={parcelTone(parcel)}>
      {parcelLine(parcel)}
    </span>
  )
}

/** 꼬리표 + 마지막 확인 시각 (있을 때) */
export function ParcelLine({ parcel }: { readonly parcel: ParcelBrief }) {
  const checked = checkedWords(parcel)
  return (
    <span className="row parcel-line">
      <ParcelTag parcel={parcel} />
      {checked !== null ? <span className="hint">{checked}</span> : null}
    </span>
  )
}

// ── 쓰기 (같은 내용 = 같은 요청 번호) ────────────────────────────────────

export interface ParcelCommand {
  readonly busy: boolean
  readonly error: ApiError | null
  /** 보낸다. 되면 응답, 아니면 null(오류는 error에). 보내는 중이면 null */
  send<T>(method: 'POST' | 'PUT', path: string, body: Readonly<Record<string, unknown>>): Promise<T | null>
  clearError(): void
}

export function useParcelCommand(): ParcelCommand {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const pending = useRef<{ key: string; requestId: string } | null>(null)
  const running = useRef(false)
  return {
    busy,
    error,
    clearError: () => setError(null),
    async send<T>(method: 'POST' | 'PUT', path: string, body: Readonly<Record<string, unknown>>): Promise<T | null> {
      if (running.current) return null
      const key = JSON.stringify([method, path, body])
      if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
      const { requestId } = pending.current
      running.current = true
      setBusy(true)
      setError(null)
      try {
        const payload = { requestId, ...body }
        const result = await withRetry(() => (method === 'PUT' ? put<T>(path, payload) : post<T>(path, payload)))
        pending.current = null
        return result
      } catch (caught) {
        if (!isApiError(caught)) throw caught
        // 다시 보내도 되는 실패만 요청 번호를 남긴다 (같은 번호로 다시 보내기)
        if (!caught.transient) pending.current = null
        setError(caught)
        return null
      } finally {
        running.current = false
        setBusy(false)
      }
    },
  }
}

// ── 배송지 칸 양식 ───────────────────────────────────────────────────────

export interface AddressFormProps<K extends keyof AddressFields> {
  /** 서버 문제의 칸 이름 앞머리 (`address.phone`·`sender.phone`) */
  readonly prefix: 'address' | 'sender'
  readonly keys: readonly K[]
  readonly labels: Readonly<Record<K, string>>
  readonly value: Readonly<Record<K, string>>
  readonly onChange: (key: K, value: string) => void
  readonly error: ApiError | null
}

/** 칸 여럿 (form 요소는 부르는 쪽이 둔다) */
export function AddressInputs<K extends keyof AddressFields>({ prefix, keys, labels, value, onChange, error }: AddressFormProps<K>) {
  const id = useId()
  return keys.map((key) => {
    const problem = error?.problemFor(`${prefix}.${key}`)
    const fieldId = `${id}-${key}`
    return (
      <div key={key} className="field">
        <label htmlFor={fieldId}>{labels[key]}</label>
        <input
          id={fieldId}
          className="input"
          autoComplete="off"
          inputMode={key === 'phone' || key === 'zip' ? 'numeric' : undefined}
          value={value[key]}
          aria-invalid={problem !== undefined}
          aria-describedby={problem === undefined ? undefined : `${fieldId}-error`}
          onChange={(event) => onChange(key, event.target.value)}
        />
        {problem !== undefined ? (
          <p className="field-error" role="alert" id={`${fieldId}-error`}>
            {problem.message}
          </p>
        ) : null}
      </div>
    )
  })
}

/** 칸 이름 목록 (칸 옆에 보인 문제는 아래 오류에서 뺀다) */
export function fieldNames(prefix: string, keys: readonly string[]): readonly string[] {
  return keys.map((key) => `${prefix}.${key}`)
}

/** 배송지 적기·고치기 창 */
function AddressDialog({
  title,
  initial,
  busy,
  error,
  onClose,
  onSave,
}: {
  readonly title: string
  readonly initial: AddressFields
  readonly busy: boolean
  readonly error: ApiError | null
  readonly onClose: () => void
  readonly onSave: (address: AddressFields) => Promise<void>
}) {
  const [draft, setDraft] = useState<AddressFields>(initial)
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
        </div>
        <button type="submit" hidden />
      </form>
      {busy ? <p role="status">저장하는 중…</p> : null}
      {error !== null ? <RequestError error={error} omitFields={fieldNames('address', ADDRESS_KEYS)} /> : null}
    </Modal>
  )
}

// ── 묶음 자세히의 "배송지" 칸 (AC-T1-65) ─────────────────────────────────

type Ask = 'write' | 'edit' | 'delete' | null

/**
 * 실제 범위의 묶음 하나. version이 바뀌면(택배·포장 알림, 다시 붙음) 다시 받는다.
 * 리허설 범위는 배송지가 없다 — 부르는 쪽이 그리지 않는다.
 */
export function AddressSection({ date, buyer, version }: { readonly date: string; readonly buyer: string; readonly version: string }) {
  const [bundle, setBundle] = useState<BundleView | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [ask, setAsk] = useState<Ask>(null)
  const [done, setDone] = useState<string | null>(null)
  const command = useParcelCommand()
  const latest = useRef(0)
  const ledgerVersion = useLedgerVersion() // KP1: 장부를 지우면 "확인 전" 칸이 바로 사라진다

  useEffect(() => {
    const mine = ++latest.current
    get<{ bundle: BundleView }>(withQuery(`/api/parcels/days/${date}/bundle`, { buyer })).then(
      (result) => {
        if (mine !== latest.current) return
        setBundle(result.bundle)
        setLoadError(null)
      },
      (caught: unknown) => {
        if (mine !== latest.current || !isApiError(caught)) return
        setLoadError(caught)
      },
    )
  }, [date, buyer, version, attempt, ledgerVersion])

  const apply = (next: BundleView | null, text: string) => {
    if (next === null) return false
    latest.current++
    setBundle(next)
    setLoadError(null)
    setDone(text)
    return true
  }

  const save = async (address: AddressFields) => {
    setDone(null)
    const result = await command.send<{ bundle: BundleView }>('PUT', `/api/parcels/days/${date}/address`, { buyer, address })
    if (apply(result?.bundle ?? null, ADDRESS_SAVED)) setAsk(null)
  }
  const confirm = async () => {
    if (bundle?.address == null) return
    setDone(null)
    const result = await command.send<{ bundle: BundleView }>('POST', `/api/parcels/days/${date}/address/confirm`, { buyer, updatedAt: bundle.address.updatedAt })
    apply(result?.bundle ?? null, ADDRESS_CONFIRMED)
  }
  // KP1: 장부 연락처를 이 묶음 배송지로 (출처 판매자·확인함) — 장부에는 아무것도 쓰지 않는다
  const confirmLedger = async () => {
    const prefill = bundle?.ledger
    if (prefill == null) return
    setDone(null)
    const result = await command.send<{ bundle: BundleView }>('POST', `/api/parcels/days/${date}/address/ledger`, { buyer, ledgerId: prefill.ledgerId, updatedAt: prefill.updatedAt })
    apply(result?.bundle ?? null, PREFILL_CONFIRMED)
  }
  const remove = async () => {
    setDone(null)
    setAsk(null)
    const result = await command.send<{ bundle: BundleView }>('POST', `/api/parcels/days/${date}/address/delete`, { buyer })
    apply(result?.bundle ?? null, ADDRESS_DELETED)
  }

  // 거절(그 사이 구매자가 고침·접수됨 — 409)은 응답이 끝난 뒤 지금 모습을 다시 받는다 (옛 내용으로 확인하지 않는다)
  useEffect(() => {
    if (command.error !== null && command.error.status === 409) setAttempt((n) => n + 1)
  }, [command.error])

  if (bundle === null) {
    return (
      <section className="stack-tight address-section kp1-seller" aria-label="배송지">
        <h3 className="sub-title">배송지</h3>
        {loadError !== null ? <RequestError error={loadError} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : <p role="status">배송지를 불러오는 중…</p>}
      </section>
    )
  }
  const shape = addressShape(bundle)
  const address = bundle.address
  const parcel = bundle.row.parcel
  return (
    <section className="stack-tight address-section kp1-seller" aria-label="배송지">
      <h3 className="sub-title">배송지</h3>
      {parcel !== null ? <ParcelLine parcel={parcel} /> : null}
      {shape === 'pickup' ? <p>{PICKUP_BUNDLE}</p> : null}
      {shape === 'combined' ? <p>{COMBINED_BUNDLE}</p> : null}
      {shape === 'expired' ? <p>{ADDRESS_EXPIRED}</p> : null}
      {shape === 'none' && bundle.ledger != null && !bundle.locked ? (
        <LedgerPrefillBlock
          prefill={bundle.ledger}
          busy={command.busy}
          onConfirm={() => void confirmLedger()}
          onEdit={() => {
            setDone(null)
            command.clearError()
            setAsk('write')
          }}
        />
      ) : null}
      {shape === 'none' && (bundle.ledger == null || bundle.locked) ? (
        <>
          <p>{NO_ADDRESS}</p>
          {bundle.locked ? (
            <p className="notice" role="note">
              {LOCKED_ADDRESS}
            </p>
          ) : (
            <Lock>
              <div className="row">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setDone(null)
                    command.clearError()
                    setAsk('write')
                  }}
                >
                  배송지 적기
                </button>
              </div>
            </Lock>
          )}
          <p className="hint">{BUYER_CAN_WRITE}</p>
        </>
      ) : null}
      {shape === 'shown' && address !== null ? (
        <>
          <dl className="facts address-facts">
            <div>
              <dt>{ADDRESS_LABELS.name}</dt>
              <dd>{address.name}</dd>
            </div>
            <div>
              <dt>{ADDRESS_LABELS.phone}</dt>
              <dd>{phoneWords(address.phone)}</dd>
            </div>
            <div>
              <dt>{ADDRESS_LABELS.address}</dt>
              <dd className="address-text">{address.address}</dd>
            </div>
            <div>
              <dt>{ADDRESS_LABELS.detail}</dt>
              <dd className="address-text">{address.detail === '' ? '없음' : address.detail}</dd>
            </div>
            <div>
              <dt>우편번호</dt>
              <dd>{address.zip === '' ? '없음' : address.zip}</dd>
            </div>
            <div>
              <dt>{ADDRESS_LABELS.memo}</dt>
              <dd className="address-text">{address.memo === '' ? '없음' : address.memo}</dd>
            </div>
          </dl>
          <p className="row">
            <span>{sourceWords(address.source)}</span>
            <span className="tag" data-tone={address.confirmed ? 'success' : 'warning'}>
              {confirmedWords(address.source, address.confirmed)}
            </span>
          </p>
          {bundle.locked ? (
            <p className="notice" role="note">
              {LOCKED_ADDRESS}
            </p>
          ) : (
            <Lock>
              <div className="row" role="group" aria-label="배송지 고치기">
                {!address.confirmed ? (
                  <button type="button" className="button button-primary" disabled={command.busy} onClick={() => void confirm()}>
                    배송지 확인
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button"
                  disabled={command.busy}
                  onClick={() => {
                    setDone(null)
                    command.clearError()
                    setAsk('edit')
                  }}
                >
                  고치기
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={command.busy}
                  onClick={() => {
                    setDone(null)
                    command.clearError()
                    setAsk('delete')
                  }}
                >
                  지우기
                </button>
              </div>
            </Lock>
          )}
        </>
      ) : null}
      {done !== null ? (
        <p className="notice" role="status" data-tone="success">
          {done}
        </p>
      ) : null}
      {command.busy && ask === null ? <p role="status">보내는 중…</p> : null}
      {command.error !== null && ask === null ? <RequestError error={command.error} /> : null}
      {ask === 'write' || ask === 'edit' ? (
        <AddressDialog
          title={ask === 'write' && bundle.ledger == null ? '배송지 적기' : '배송지 고치기'}
          initial={ask === 'edit' && address !== null ? { name: address.name, phone: address.phone, address: address.address, detail: address.detail, zip: address.zip, memo: address.memo } : bundle.ledger != null ? prefillAddress(bundle.ledger) : EMPTY_ADDRESS}
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
          title="배송지 지우기"
          onClose={() => setAsk(null)}
          actions={
            <button type="button" className="button button-danger" disabled={command.busy} onClick={() => void remove()}>
              지우기
            </button>
          }
        >
          <p>이 묶음의 배송지를 지울까요? 지우면 되돌릴 수 없어요.</p>
        </Modal>
      ) : null}
    </section>
  )
}
