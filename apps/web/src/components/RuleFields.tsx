// 판매 규칙 칸과 칸 묶음 저장 (AC-I3-10·45·46·52). 칸마다 낱말(설정 키·영문 값 없음), 숫자 칸은 숫자 키패드,
// "저장"은 그 묶음에서 바뀐 키만 PATCH /api/settings로 보낸다. 실패하면 서버 문장을 그 칸 옆에 보이고 아무것도 저장되지 않는다.
import type { SaleSettings } from '@livejjim/core'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { isApiError, patch, type ApiError } from '../api/client.ts'
import { changedSettings, draftOf, fieldWarning, type Draft, type FieldDef } from '../lib/settings-fields.ts'
import { ErrorNote } from './ErrorNote.tsx'

export interface RuleFieldProps {
  readonly field: FieldDef
  readonly value: string | boolean | undefined
  readonly onChange: (value: string | boolean) => void
  /** 그 칸의 서버 문장 */
  readonly problem?: string | undefined
  readonly disabled?: boolean
}

/** 칸 하나 */
export function RuleField({ field, value, onChange, problem, disabled = false }: RuleFieldProps) {
  const id = useId()
  const problemId = `${id}-problem`
  const warning = fieldWarning(field, value)
  const described = problem !== undefined ? problemId : undefined
  if (field.kind === 'bool') {
    return (
      <div className="stack-tight">
        <label className="choice">
          <input type="checkbox" checked={value === true} disabled={disabled} aria-describedby={described} onChange={(event) => onChange(event.target.checked)} />
          <span>{field.label}</span>
        </label>
        <Problem id={problemId} text={problem} />
      </div>
    )
  }
  if (field.kind === 'choice') {
    return (
      <fieldset className="rule-choice" role="radiogroup" aria-describedby={described} disabled={disabled}>
        <legend>{field.label}</legend>
        <div className="choice-list">
          {field.options.map((option) => (
            <label key={option.value} className="choice">
              <input type="radio" name={`${id}-${field.key}`} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
              <span>{option.word}</span>
            </label>
          ))}
        </div>
        {warning !== null ? (
          <p className="warning" role="note">
            {warning}
          </p>
        ) : null}
        <Problem id={problemId} text={problem} />
      </fieldset>
    )
  }
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      <span className="row">
        <input
          id={id}
          className="input input-number"
          inputMode="numeric"
          autoComplete="off"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          aria-invalid={problem !== undefined}
          aria-describedby={described}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.kind === 'int' && field.unit !== undefined ? <span>{field.unit}</span> : null}
        {field.kind === 'money' ? <span>원</span> : null}
      </span>
      <Problem id={problemId} text={problem} />
    </div>
  )
}

function Problem({ id, text }: { readonly id: string; readonly text: string | undefined }) {
  if (text === undefined) return null
  return (
    <p className="field-error" role="alert" id={id}>
      {text}
    </p>
  )
}

/** 서버 문제 중 그 설정 키의 문장 (`settings.<키>`) */
export function settingProblem(error: ApiError | null, key: string): string | undefined {
  return error?.problemFor(`settings.${key}`)?.message
}

export interface RuleForm {
  readonly draft: Draft
  readonly set: (key: FieldDef['key'], value: string | boolean) => void
  /** 저장하지 않은 칸이 있다 */
  readonly dirty: boolean
  readonly busy: boolean
  readonly error: ApiError | null
  /** 저장한 뒤의 문장 */
  readonly done: string | null
  readonly save: () => Promise<boolean>
  readonly reset: () => void
}

/**
 * 칸 묶음 하나의 값·저장. saved가 바뀌면(이 기기·다른 기기에서 저장) 고치지 않은 칸은 새 값으로 맞춘다.
 * 저장은 바뀐 키만 보낸다(바뀐 것이 없으면 요청 없이 끝).
 */
export function useRuleForm(fields: readonly FieldDef[], saved: SaleSettings, onSaved: (settings: SaleSettings) => void, doneMessage: string): RuleForm {
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved, fields))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const base = useRef<Draft>(draftOf(saved, fields))
  const busyRef = useRef(false)

  // 저장된 값이 바뀌면 손대지 않은 칸만 새 값으로
  useEffect(() => {
    const next = draftOf(saved, fields)
    const previous = base.current
    base.current = next
    setDraft((current) => {
      const merged: Record<string, string | boolean | undefined> = { ...current }
      for (const field of fields) if (Object.is(current[field.key], previous[field.key])) merged[field.key] = next[field.key]
      return merged as Draft
    })
  }, [saved, fields])

  const changes = useMemo(() => changedSettings(fields, draft, saved), [fields, draft, saved])
  const dirty = Object.keys(changes).length > 0

  const set = useCallback((key: FieldDef['key'], value: string | boolean) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setDone(null)
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false
    if (Object.keys(changes).length === 0) {
      setError(null)
      return true
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const result = await patch<{ settings: SaleSettings }>('/api/settings', { settings: changes })
      onSaved(result.settings)
      setDone(doneMessage)
      return true
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [changes, doneMessage, onSaved])

  const reset = useCallback(() => {
    setDraft(draftOf(saved, fields))
    setError(null)
  }, [saved, fields])

  return { draft, set, dirty, busy, error, done, save, reset }
}

/** 칸 묶음 아래: 저장 버튼·문장·칸 밖 오류 */
export function SaveRow({ form, fields, label = '저장' }: { readonly form: RuleForm; readonly fields: readonly FieldDef[]; readonly label?: string }) {
  const keys = fields.map((field) => `settings.${field.key}`)
  return (
    <div className="stack-tight">
      <div className="row">
        <button type="button" className="button button-primary" disabled={form.busy} onClick={() => void form.save()}>
          {form.busy ? '저장하는 중…' : label}
        </button>
      </div>
      {form.done !== null ? (
        <p className="notice" role="status">
          {form.done}
        </p>
      ) : null}
      {form.error !== null ? <ErrorNote error={form.error} omitFields={keys} /> : null}
    </div>
  )
}
