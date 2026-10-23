// 설정 "택배" (SPEC §7 화면 8, PARCEL_RULES PC-6, D-T1-09, AC-T1-66).
// - 택배사 고르기("가짜 택배(시험용)"는 서버가 시험 모드에서만 목록에 준다, "우체국 택배 — 준비 중"은 고를 수 없다), 택배사 고객 번호(저장 뒤 끝 4자리만),
//   보내는 사람(이름 — 비면 가게 이름이 기본값으로 채워져 있다·연락처·주소·상세 주소·우편번호), 기본 상자 크기(극소·소·중·대).
// - 틀리면 칸마다 서버 문장(PC-2와 같은 칸 코드), 저장하면 "택배 설정을 저장했어요.". 저장하지 않은 값이 있으면 떠나기 전에 묻는다.
// - 고객 번호 칸은 비워 두면 그대로 둔다(저장한 번호는 화면에 다시 오지 않는다 — 끝 4자리만).
import { useEffect, useId, useState } from 'react'
import { get, isApiError, put, type ApiError } from '../api/client.ts'
import type { BoxKind, CarrierCode, ParcelSender, ParcelSettings } from '../api/parcel-types.ts'
import { useUnsavedGuard } from '../lib/leave-guard.ts'
import { PARCEL_SETTINGS_SAVED } from '../lib/parcel-words.ts'
import { RequestError } from './ErrorNote.tsx'
import { AddressInputs, fieldNames } from './ParcelParts.tsx'

const SENDER_KEYS = ['name', 'phone', 'address', 'detail', 'zip'] as const
const SENDER_LABELS: Readonly<Record<(typeof SENDER_KEYS)[number], string>> = {
  name: '보내는 사람 이름',
  phone: '보내는 사람 연락처',
  address: '보내는 주소',
  detail: '보내는 상세 주소',
  zip: '보내는 우편번호(몰라도 돼요)',
}

interface Draft {
  readonly carrier: CarrierCode | ''
  readonly customerNo: string
  readonly sender: ParcelSender
  readonly box: BoxKind
}

function draftOf(settings: ParcelSettings): Draft {
  const sender = settings.sender ?? { name: settings.shopName, phone: '', address: '', detail: '', zip: '' }
  return { carrier: settings.carrier ?? '', customerNo: '', sender: { ...sender, name: sender.name === '' ? settings.shopName : sender.name }, box: settings.box }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.carrier === b.carrier && a.customerNo === b.customerNo && a.box === b.box && SENDER_KEYS.every((key) => a.sender[key] === b.sender[key])
}

/** 보내는 사람을 보낼지: 저장한 것이 없고 이름 말고 아무것도 적지 않았으면 보내지 않는다(빈 칸 오류를 내지 않게) */
function senderToSend(settings: ParcelSettings, draft: Draft): ParcelSender | undefined {
  if (settings.sender !== null) return draft.sender
  const touched = SENDER_KEYS.some((key) => key !== 'name' && draft.sender[key].trim() !== '') || draft.sender.name !== settings.shopName
  return touched ? draft.sender : undefined
}

export function ParcelSettingsSection() {
  const id = useId()
  const [settings, setSettings] = useState<ParcelSettings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState(false)
  const dirty = settings !== null && draft !== null && !sameDraft(draft, draftOf(settings))
  useUnsavedGuard(dirty)

  useEffect(() => {
    let alive = true
    get<{ settings: ParcelSettings }>('/api/parcels/settings').then(
      (result) => {
        if (!alive) return
        setSettings(result.settings)
        setDraft(draftOf(result.settings))
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

  if (settings === null || draft === null) {
    return loadError !== null ? <RequestError error={loadError} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : <p role="status">택배 설정을 불러오는 중…</p>
  }

  const change = (patch: Partial<Draft>) => {
    setDone(false)
    setDraft((current) => (current === null ? current : { ...current, ...patch }))
  }
  const save = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setDone(false)
    const sender = senderToSend(settings, draft)
    const body = {
      carrier: draft.carrier === '' ? null : draft.carrier,
      box: draft.box,
      ...(sender === undefined ? {} : { sender }),
      ...(draft.customerNo.trim() === '' ? {} : { customerNo: draft.customerNo }),
    }
    try {
      const result = await put<{ settings: ParcelSettings }>('/api/parcels/settings', body)
      setSettings(result.settings)
      setDraft(draftOf(result.settings))
      setDone(true)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  const carrierProblem = error?.problemFor('carrier')
  const customerProblem = error?.problemFor('customerNo')
  const boxProblem = error?.problemFor('box')
  const senderProblem = error?.problemFor('sender')
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-carrier`}>택배사</label>
        <select
          id={`${id}-carrier`}
          className="input"
          value={draft.carrier}
          aria-invalid={carrierProblem !== undefined}
          aria-describedby={carrierProblem === undefined ? undefined : `${id}-carrier-error`}
          onChange={(event) => change({ carrier: event.target.value as CarrierCode | '' })}
        >
          <option value="">고르지 않음</option>
          {settings.carriers.map((carrier) => (
            <option key={carrier.code} value={carrier.code} disabled={!carrier.available}>
              {carrier.available ? carrier.name : `${carrier.name} — ${carrier.note ?? '준비 중'}`}
            </option>
          ))}
        </select>
        {carrierProblem !== undefined ? (
          <p className="field-error" role="alert" id={`${id}-carrier-error`}>
            {carrierProblem.message}
          </p>
        ) : null}
        <p className="hint">택배사를 고르지 않아도 포장 화면에서 배송 완료·송장번호를 직접 적을 수 있어요.</p>
      </div>
      <div className="field">
        <label htmlFor={`${id}-customer`}>택배사 고객 번호</label>
        <input
          id={`${id}-customer`}
          className="input"
          autoComplete="off"
          value={draft.customerNo}
          aria-invalid={customerProblem !== undefined}
          aria-describedby={customerProblem === undefined ? `${id}-customer-hint` : `${id}-customer-error`}
          onChange={(event) => change({ customerNo: event.target.value })}
        />
        <p className="hint" id={`${id}-customer-hint`}>
          {settings.customerNoLast4 === null ? '택배사와 계약하면 받는 번호예요. 없으면 비워 두세요.' : `저장한 번호 끝 ${settings.customerNoLast4} · 바꿀 때만 새로 적어 주세요.`}
        </p>
        {customerProblem !== undefined ? (
          <p className="field-error" role="alert" id={`${id}-customer-error`}>
            {customerProblem.message}
          </p>
        ) : null}
      </div>
      <fieldset className="stack-tight parcel-sender">
        <legend>보내는 사람</legend>
        <AddressInputs prefix="sender" keys={SENDER_KEYS} labels={SENDER_LABELS} value={draft.sender} onChange={(key, value) => change({ sender: { ...draft.sender, [key]: value } })} error={error} />
        {senderProblem !== undefined ? (
          <p className="field-error" role="alert">
            {senderProblem.message}
          </p>
        ) : null}
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-box`}>기본 상자 크기</label>
        <select id={`${id}-box`} className="input" value={draft.box} onChange={(event) => change({ box: event.target.value as BoxKind })}>
          {settings.boxes.map((box) => (
            <option key={box} value={box}>
              {box}
            </option>
          ))}
        </select>
        {boxProblem !== undefined ? (
          <p className="field-error" role="alert">
            {boxProblem.message}
          </p>
        ) : null}
        <p className="hint">택배 화면에서 묶음마다 바꿀 수 있어요.</p>
      </div>
      <div className="row">
        <button type="submit" className="button" disabled={busy}>
          저장
        </button>
        {busy ? <span role="status">저장하는 중…</span> : null}
      </div>
      {done ? (
        <p className="notice" role="status" data-tone="success">
          {PARCEL_SETTINGS_SAVED}
        </p>
      ) : null}
      {error !== null ? <RequestError error={error} omitFields={['carrier', 'customerNo', 'box', 'sender', ...fieldNames('sender', SENDER_KEYS)]} /> : null}
    </form>
  )
}
