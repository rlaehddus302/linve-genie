// 설정 "손님 관리" 칸 (CRM1 D-CRM1-05, AC-CRM1-11·12): 단골 횟수(2~99번, 기본 3)·단골 금액(1,000~100,000,000원, 비우면 금액 기준 안 씀)·
// 입금 기다리는 날(1~30일, 기본 3). 저장은 화면 아래 저장 막대 하나(D-FB1-06) — 이 칸이 바뀌었으면 PUT /api/customer-settings 하나.
// 검사는 서버가 한다: 정수가 아닌 글("10.5")은 숫자로 바꾸지 않고 그대로 보내 서버 문장을 칸 아래에 보인다. 판매 규칙·판정과 상관없다.
import { useEffect, useId, useRef, useState } from 'react'
import { get, isApiError, put, type ApiError } from '../api/client.ts'
import type { CustomerSettings } from '../lib/customers.ts'
import { groupDigits } from '../lib/money.ts'
import { useUnsavedGuard } from '../lib/leave-guard.ts'
import { useSaveStep, type StepResult } from '../lib/save-bar.ts'
import { RequestError } from './ErrorNote.tsx'

export const CUSTOMER_SETTINGS_HINT = '손님 기록의 "단골"·"입금 늦음 주의" 기준이에요. 판매 규칙·판정에는 영향이 없어요.'
export const REGULAR_AMOUNT_HINT = '비우면 금액 기준을 쓰지 않아요.'
export const WAIT_DAYS_HINT = '방송 날짜에서 이 날 수가 지나도 입금이 없으면 미입금으로 세요.'

interface Draft {
  readonly regularCount: string
  readonly regularAmount: string
  readonly waitDays: string
}

const draftOf = (settings: CustomerSettings): Draft => ({
  regularCount: String(settings.regularCount),
  regularAmount: settings.regularAmount === null ? '' : groupDigits(settings.regularAmount),
  waitDays: String(settings.waitDays),
})

const same = (a: Draft, b: Draft): boolean => a.regularCount.trim() === b.regularCount.trim() && a.regularAmount.trim() === b.regularAmount.trim() && a.waitDays.trim() === b.waitDays.trim()

/** 칸 글 → 보낼 값: 숫자(쉼표 묶음 허용)면 정수, 아니면 글 그대로(서버가 거절 문장을 준다) */
export function settingValue(text: string): number | string {
  const value = text.trim()
  if (/^\d+$/.test(value) || /^\d{1,3}(,\d{3})+$/.test(value)) {
    const n = Number(value.replace(/,/g, ''))
    if (Number.isSafeInteger(n)) return n
  }
  return value
}

/** 보낼 본문 (금액 칸이 비면 null = 금액 기준 안 씀) */
export function customerSettingsBody(draft: Draft): Record<string, unknown> {
  return {
    regularCount: settingValue(draft.regularCount),
    regularAmount: draft.regularAmount.trim() === '' ? null : settingValue(draft.regularAmount),
    waitDays: settingValue(draft.waitDays),
  }
}

export function CustomerSettingsSection() {
  const id = useId()
  const [settings, setSettings] = useState<CustomerSettings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const busy = useRef(false)
  const dirty = settings !== null && draft !== null && !same(draft, draftOf(settings))
  useUnsavedGuard(dirty)

  const save = async (): Promise<StepResult> => {
    if (busy.current || settings === null || draft === null || !dirty) return { saved: [], failed: [] }
    busy.current = true
    setError(null)
    try {
      const result = await put<{ settings: CustomerSettings }>('/api/customer-settings', customerSettingsBody(draft))
      setSettings(result.settings)
      setDraft(draftOf(result.settings))
      return { saved: ['손님 관리'], failed: [] }
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      return { saved: [], failed: ['손님 관리'] }
    } finally {
      busy.current = false
    }
  }
  useSaveStep('customers', dirty ? ['손님 관리'] : [], save)

  useEffect(() => {
    let alive = true
    get<{ settings: CustomerSettings }>('/api/customer-settings').then(
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
    return loadError !== null ? <RequestError error={loadError} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : <p role="status">손님 관리 설정을 불러오는 중…</p>
  }
  const change = (patch: Partial<Draft>) => setDraft((current) => (current === null ? current : { ...current, ...patch }))
  const fields: readonly { key: keyof Draft; label: string; unit: string; hint?: string }[] = [
    { key: 'regularCount', label: '단골 횟수', unit: '번' },
    { key: 'regularAmount', label: '단골 금액', unit: '원', hint: REGULAR_AMOUNT_HINT },
    { key: 'waitDays', label: '입금 기다리는 날', unit: '일', hint: WAIT_DAYS_HINT },
  ]
  const named = new Set(fields.map((field) => field.key as string))
  const outside = error !== null && !error.problems.some((problem) => problem.field !== null && named.has(problem.field))
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        // 저장은 화면 아래 저장 막대 하나 (FB1 D-FB1-06)
        event.preventDefault()
      }}
    >
      <p className="hint">{CUSTOMER_SETTINGS_HINT}</p>
      <p className="hint">단골 = 횟수 기준 또는 금액 기준을 넘은 손님. 입금 늦음 주의 = 미입금이 한 번이라도 있는 손님.</p>
      {fields.map((field) => {
        const problem = error?.problemFor(field.key)
        const inputId = `${id}-${field.key}`
        const described = [field.hint === undefined ? null : `${inputId}-hint`, problem === undefined ? null : `${inputId}-error`].filter((part) => part !== null).join(' ')
        return (
          <div key={field.key} className="field">
            <label htmlFor={inputId}>{field.label}</label>
            <span className="row">
              <input
                id={inputId}
                className="input input-number"
                inputMode="numeric"
                autoComplete="off"
                value={draft[field.key]}
                aria-invalid={problem !== undefined}
                aria-describedby={described === '' ? undefined : described}
                onChange={(event) => change({ [field.key]: event.target.value })}
              />
              <span>{field.unit}</span>
            </span>
            {field.hint !== undefined ? (
              <p className="hint" id={`${inputId}-hint`}>
                {field.hint}
              </p>
            ) : null}
            {problem !== undefined ? (
              <p className="field-error" role="alert" id={`${inputId}-error`}>
                {problem.message}
              </p>
            ) : null}
          </div>
        )
      })}
      {outside && error !== null ? <RequestError error={error} /> : null}
    </form>
  )
}
