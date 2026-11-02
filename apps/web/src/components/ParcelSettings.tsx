// 설정 "택배" (SPEC §7 화면 8, PARCEL_RULES PC-1·PC-6, D-T1-09, AC-T1-66, FB1 D-FB1-04·05·06 — AC-FB1-19).
// - 쓰는 택배사 고르기: 고르지 않음·우체국택배·CJ대한통운·한진택배·로젠택배·롯데택배·직접 입력(+ "택배사 이름" 칸, 20자)
//   (+ 시험 모드면 서버가 목록 끝에 주는 "가짜 택배(시험용)"). 잠긴 줄 없음. "택배사 이름" 칸은 고르기 바로 아래, 그 아래 안내는 하나
//   (D-FB1-18 (f)) — 자동 접수가 안 되는 택배사를 골랐거나 고르지 않았으면 "자동 접수는 아직 준비 중이에요. …". 택배사 고객 번호(저장 뒤 끝 4자리만), 보내는 사람(이름 — 비면 가게 이름이 기본값),
//   기본 택배 크기(세 변의 합 60·80·100·120·160cm 이하).
// - 틀리면 칸마다 서버 문장(PC-2와 같은 칸 코드). 저장은 화면 아래 저장 막대 하나(D-FB1-06 — 바뀌었을 때만 PUT /api/parcels/settings).
//   저장하지 않은 값이 있으면 떠나기 전에 묻는다.
// - 고객 번호 칸은 비워 두면 그대로 둔다(저장한 번호는 화면에 다시 오지 않는다 — 끝 4자리만).
import { useEffect, useId, useRef, useState } from 'react'
import { get, isApiError, put, type ApiError } from '../api/client.ts'
import type { BoxKind, ParcelSettings, SettingsCarrier } from '../api/parcel-types.ts'
import { useUnsavedGuard } from '../lib/leave-guard.ts'
import { BOX_HINT, BOX_LABEL, CARRIER_NAME_LABEL, CARRIER_NAME_MAX, NO_AUTO_BOOK_NOTE, OTHER_CARRIER, boxWord } from '../lib/parcel-words.ts'
import { useSaveStep, type StepResult } from '../lib/save-bar.ts'
import { RequestError } from './ErrorNote.tsx'
import { AddressInputs, fieldNames } from './ParcelParts.tsx'

import { SENDER_KEYS, SENDER_LABELS, parcelBody, parcelDraftOf, sameParcelDraft, type ParcelDraft } from '../lib/parcel-words.ts'
export { parcelBody, parcelDraftOf, sameParcelDraft, type ParcelDraft } from '../lib/parcel-words.ts'

export function ParcelSettingsSection() {
  const id = useId()
  const [settings, setSettings] = useState<ParcelSettings | null>(null)
  const [draft, setDraft] = useState<ParcelDraft | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const busy = useRef(false)
  const [error, setError] = useState<ApiError | null>(null)
  const dirty = settings !== null && draft !== null && !sameParcelDraft(draft, parcelDraftOf(settings))
  useUnsavedGuard(dirty)

  /** 저장 막대가 부른다 (바뀌었을 때만) */
  const save = async (): Promise<StepResult> => {
    if (busy.current || settings === null || draft === null || !dirty) return { saved: [], failed: [] }
    busy.current = true
    setError(null)
    try {
      const result = await put<{ settings: ParcelSettings }>('/api/parcels/settings', parcelBody(settings, draft))
      setSettings(result.settings)
      setDraft(parcelDraftOf(result.settings))
      return { saved: ['택배'], failed: [] }
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      return { saved: [], failed: ['택배'] }
    } finally {
      busy.current = false
    }
  }
  useSaveStep('parcel', dirty ? ['택배'] : [], save)

  useEffect(() => {
    let alive = true
    get<{ settings: ParcelSettings }>('/api/parcels/settings').then(
      (result) => {
        if (!alive) return
        setSettings(result.settings)
        setDraft(parcelDraftOf(result.settings))
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

  const change = (patch: Partial<ParcelDraft>) => {
    setDraft((current) => (current === null ? current : { ...current, ...patch }))
  }
  const chosen = settings.carriers.find((carrier) => carrier.code === draft.carrier)
  const carrierProblem = error?.problemFor('carrier')
  const customerProblem = error?.problemFor('customerNo')
  const boxProblem = error?.problemFor('box')
  const senderProblem = error?.problemFor('sender')
  const nameProblem = error?.problemFor('carrierName')
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        // 저장은 화면 아래 저장 막대 하나 (FB1 D-FB1-06)
        event.preventDefault()
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
          onChange={(event) => change({ carrier: event.target.value as SettingsCarrier | '' })}
        >
          <option value="">고르지 않음</option>
          {settings.carriers.map((carrier) => (
            <option key={carrier.code} value={carrier.code}>
              {carrier.name}
            </option>
          ))}
        </select>
        {carrierProblem !== undefined ? (
          <p className="field-error" role="alert" id={`${id}-carrier-error`}>
            {carrierProblem.message}
          </p>
        ) : null}
      </div>
      {draft.carrier === OTHER_CARRIER ? (
        <div className="field">
          <label htmlFor={`${id}-carrier-name`}>{CARRIER_NAME_LABEL}</label>
          <input
            id={`${id}-carrier-name`}
            className="input"
            autoComplete="off"
            maxLength={CARRIER_NAME_MAX * 2}
            value={draft.carrierName}
            aria-invalid={nameProblem !== undefined}
            aria-describedby={nameProblem === undefined ? undefined : `${id}-carrier-name-error`}
            onChange={(event) => change({ carrierName: event.target.value })}
          />
          {nameProblem !== undefined ? (
            <p className="field-error" role="alert" id={`${id}-carrier-name-error`}>
              {nameProblem.message}
            </p>
          ) : null}
        </div>
      ) : null}
      {/* 안내는 하나 (FB1 D-FB1-18 (f)): 택배사 이름 칸 아래. 자동 접수가 되는 택배사면 없음 */}
      {chosen === undefined || !chosen.autoBook ? <p className="notice">{NO_AUTO_BOOK_NOTE}</p> : null}
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
        <label htmlFor={`${id}-box`}>{BOX_LABEL}</label>
        <select id={`${id}-box`} className="input" value={draft.box} aria-describedby={`${id}-box-hint`} onChange={(event) => change({ box: event.target.value as BoxKind })}>
          {settings.boxes.map((box) => (
            <option key={box} value={box}>
              {boxWord(box)}
            </option>
          ))}
        </select>
        {boxProblem !== undefined ? (
          <p className="field-error" role="alert">
            {boxProblem.message}
          </p>
        ) : null}
        <p className="hint" id={`${id}-box-hint`}>
          {BOX_HINT}
        </p>
        <p className="hint">택배 화면에서 묶음마다 바꿀 수 있어요.</p>
      </div>
      {error !== null ? <RequestError error={error} omitFields={['carrier', 'carrierName', 'customerNo', 'box', 'sender', ...fieldNames('sender', SENDER_KEYS)]} /> : null}
    </form>
  )
}
