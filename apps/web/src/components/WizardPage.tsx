// 시작 마법사 (UX-02, D-I3-09, AC-I3-50~56): 가게 이름 → 판매 규칙 확인 → 프린터 → 유튜브 → 리허설.
// - 단계 표시는 글자("1/5 가게 이름"). 단계마다 "이전"(1단계 제외)·"다음"·"나중에 할게요". 단계를 옮기면 서버에 그 단계를 적는다(PUT /api/wizard).
// - "나중에 할게요" → 닫음 → 방송 목록. "마치기"·"리허설 시작하기" → 마침. 마치거나 닫으면 다시 저절로 열리지 않는다(다른 기기도 — 서버 상태).
// - 1단계는 이름을 바꿨을 때만 저장한다(실패하면 다음으로 가지 않는다). 2단계는 바꾸지 않고 "다음"이면 설정 요청을 보내지 않는다.
// - 4단계에서 구글로 갔다 오면 서버는 설정 화면 주소로 돌려보낸다 — 앱이 이 화면 4단계로 다시 보내고 결과 문장을 보인다.
// - 단계가 바뀌면 포커스는 그 단계 제목으로. 키보드만으로 끝까지 갈 수 있다.
import type { SaleSettings } from '@livejjim/core'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { get, isApiError, newRequestId, post, put, withRetry, type ApiError } from '../api/client.ts'
import type { WizardState, WriteResult } from '../api/types.ts'
import type { Navigate, StartRoute } from '../lib/router.ts'
import { fieldOf, SAVED_MESSAGE, SAVED_SHIPPING_MESSAGE, valueWords, type FieldDef, type RuleKey } from '../lib/settings-fields.ts'
import { ErrorNote, FieldError } from './ErrorNote.tsx'
import { RuleField, settingProblem, useRuleForm } from './RuleFields.tsx'
import { PrinterStep } from './wizard/PrinterStep.tsx'
import { CallbackResult, useYoutubeConnection, YoutubeStatus } from './YoutubeConnection.tsx'

export const STEP_TITLES = ['가게 이름', '판매 규칙 확인', '프린터 연결', '유튜브 연결', '리허설 해 보기'] as const
const LAST = STEP_TITLES.length

/** 2단계의 여섯 줄: 짧은 이름 → 설정 키 (AC-I3-52) */
const RULE_LINES: readonly { readonly label: string; readonly key: RuleKey }[] = [
  { label: '대기 인원', key: 'waitlist.max' },
  { label: '1등이 취소되면', key: 'cancel.succession' },
  { label: '시청자가 채팅으로 취소하면', key: 'cancel.buyerChat' },
  { label: '가격 단위', key: 'price.unit' },
  { label: '기본 배송비', key: 'shipping.baseFee' },
  { label: '무료배송 기준', key: 'shipping.freeThreshold' },
]

export const REHEARSAL_INVITE = '리허설로 연습해 볼까요? 가짜 채팅으로 상품 등록부터 1등 확정까지 해 볼 수 있어요. 진짜 유튜브에는 아무것도 올라가지 않아요.'

export interface WizardPageProps {
  readonly route: StartRoute
  readonly navigate: Navigate
  readonly shopName: string
  readonly onRenamed: (name: string) => void
}

const clampStep = (step: number | null | undefined): number => (typeof step === 'number' && Number.isInteger(step) && step >= 1 && step <= LAST ? step : 1)

export function WizardPage({ route, navigate, shopName, onRenamed }: WizardPageProps) {
  const [step, setStep] = useState<number | null>(route.youtubeResult !== undefined ? 4 : route.fresh === true ? 1 : null)
  const [result] = useState<string | null>(route.youtubeResult ?? null)
  const [settings, setSettings] = useState<SaleSettings | null>(null)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  /** 서버에 상태를 적는다 (진행 중이면 단계도). 실패해도 화면은 그대로 간다 — 다음에 열 때 단계만 다를 수 있다 */
  const record = useCallback(async (state: WizardState) => {
    try {
      await put('/api/wizard', state.status === 'IN_PROGRESS' ? { status: state.status, step: state.step } : { status: state.status })
    } catch {
      // 상태 기록은 편의 — 판매에는 영향이 없다
    }
  }, [])

  useEffect(() => {
    let alive = true
    if (route.fresh === true) void record({ status: 'IN_PROGRESS', step: 1 })
    if (route.youtubeResult !== undefined) {
      void record({ status: 'IN_PROGRESS', step: 4 })
      navigate({ name: 'start' }, { replace: true })
    }
    if (step === null) {
      get<{ wizard: WizardState }>('/api/wizard').then(
        ({ wizard }) => {
          if (alive) setStep((current) => current ?? (wizard.status === 'IN_PROGRESS' ? clampStep(wizard.step) : 1))
        },
        () => {
          if (alive) setStep((current) => current ?? 1)
        },
      )
    }
    get<{ settings: SaleSettings }>('/api/settings').then(
      ({ settings: current }) => {
        if (alive) setSettings(current)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
    // 처음 한 번 (주소의 결과 코드는 지운 뒤에도 이 화면 상태로 남는다)
  }, [])

  // 단계가 바뀌면 그 단계 제목으로 포커스
  useEffect(() => {
    if (step !== null) heading.current?.focus()
  }, [step])

  const go = (next: number) => {
    setStep(next)
    void record({ status: 'IN_PROGRESS', step: next })
  }

  const later = async () => {
    if (closing) return
    setClosing(true)
    await record({ status: 'DISMISSED', step: null })
    navigate({ name: 'home' })
  }

  const finish = async () => {
    if (closing) return
    setClosing(true)
    await record({ status: 'DONE', step: null })
    navigate({ name: 'home' })
  }

  if (step === null) {
    return (
      <main className="page wizard-page">
        <h1>시작 마법사</h1>
        <p role="status">불러오는 중…</p>
      </main>
    )
  }

  const title = STEP_TITLES[step - 1] ?? ''
  return (
    <main className="page wizard-page stack">
      <h1>시작 마법사</h1>
      <ol className="wizard-steps" aria-label="단계">
        {STEP_TITLES.map((name, index) => (
          <li key={name} aria-current={index + 1 === step ? 'step' : undefined} className={index + 1 === step ? 'wizard-step wizard-step-current' : 'wizard-step'}>
            {index + 1}/{LAST} {name}
          </li>
        ))}
      </ol>
      <section className="card stack" aria-labelledby="wizard-step-title">
        <h2 id="wizard-step-title" ref={heading} tabIndex={-1} className="section-title">
          {step}/{LAST} {title}
        </h2>
        {step === 1 ? <ShopStep key="shop" shopName={shopName} onRenamed={onRenamed} onNext={() => go(2)} onLater={() => void later()} /> : null}
        {step === 2 ? (
          <>
            {settings === null ? error !== null ? <ErrorNote error={error} /> : <p role="status">불러오는 중…</p> : <RulesStep settings={settings} onSaved={setSettings} />}
            <StepButtons step={step} onPrev={() => go(1)} onNext={() => go(3)} onLater={() => void later()} />
          </>
        ) : null}
        {step === 3 ? (
          <>
            <PrinterStep />
            <StepButtons step={step} onPrev={() => go(2)} onNext={() => go(4)} onLater={() => void later()} />
          </>
        ) : null}
        {step === 4 ? (
          <>
            <YoutubeStep result={result} navigate={navigate} />
            <StepButtons step={step} onPrev={() => go(3)} onNext={() => go(5)} onLater={() => void later()} />
          </>
        ) : null}
        {step === 5 ? <RehearsalStep navigate={navigate} onFinish={() => void finish()} onPrev={() => go(4)} onLater={() => void later()} busy={closing} /> : null}
      </section>
    </main>
  )
}

function StepButtons({ step, onPrev, onNext, onLater, nextBusy = false }: { readonly step: number; readonly onPrev?: () => void; readonly onNext?: () => void; readonly onLater: () => void; readonly nextBusy?: boolean }) {
  return (
    <div className="row wizard-buttons">
      {step > 1 && onPrev !== undefined ? (
        <button type="button" className="button" onClick={onPrev}>
          이전
        </button>
      ) : null}
      {onNext !== undefined ? (
        <button type="button" className="button button-primary" disabled={nextBusy} onClick={onNext}>
          다음
        </button>
      ) : null}
      <button type="button" className="button" onClick={onLater}>
        나중에 할게요
      </button>
    </div>
  )
}

/** 1단계 가게 이름 (AC-I3-51): 바꿨을 때만 저장, 실패하면 다음으로 가지 않는다 */
function ShopStep({ shopName, onRenamed, onNext, onLater }: { readonly shopName: string; readonly onRenamed: (name: string) => void; readonly onNext: () => void; readonly onLater: () => void }) {
  const [name, setName] = useState(shopName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const id = useId()
  const next = async () => {
    if (busy) return
    if (name === shopName) {
      onNext()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { shop } = await put<{ shop: { name: string } }>('/api/shop', { name })
      onRenamed(shop.name)
      onNext()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      setBusy(false)
    }
  }
  return (
    <>
      <p>라벨과 화면 위에 보이는 가게 이름이에요.</p>
      <label className="field" htmlFor={id}>
        <span>가게 이름</span>
      </label>
      <input
        id={id}
        className="input"
        autoComplete="organization"
        value={name}
        aria-describedby={error?.problemFor('name') !== undefined ? `${id}-error` : undefined}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void next()
          }
        }}
      />
      <FieldError error={error} field="name" id={`${id}-error`} />
      {error !== null && error.problemFor('name') === undefined ? <ErrorNote error={error} /> : null}
      <StepButtons step={1} onNext={() => void next()} onLater={onLater} nextBusy={busy} />
    </>
  )
}

/** 2단계 판매 규칙 확인 (AC-I3-52): 지금 값 여섯 줄, 줄마다 "바꾸기" → 그 자리의 칸 → "저장" */
function RulesStep({ settings, onSaved }: { readonly settings: SaleSettings; readonly onSaved: (settings: SaleSettings) => void }) {
  return (
    <div className="stack">
      <ul className="plain-list rule-lines">
        {RULE_LINES.map((line) => (
          <RuleLine key={line.key} label={line.label} field={fieldOf(line.key)} settings={settings} onSaved={onSaved} />
        ))}
      </ul>
      <p>바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.</p>
      <p>다른 규칙은 설정에서 바꿀 수 있어요.</p>
    </div>
  )
}

function RuleLine({ label, field, settings, onSaved }: { readonly label: string; readonly field: FieldDef; readonly settings: SaleSettings; readonly onSaved: (settings: SaleSettings) => void }) {
  const fields = useRef([field]).current
  const form = useRuleForm(fields, settings, onSaved, field.place === 'shipping' ? SAVED_SHIPPING_MESSAGE : SAVED_MESSAGE)
  const [editing, setEditing] = useState(false)
  return (
    <li className="rule-line stack-tight">
      <div className="row">
        <p>
          {label}: {valueWords(field, settings)}
        </p>
        {editing ? null : (
          <button type="button" className="button" aria-label={`${label} 바꾸기`} onClick={() => setEditing(true)}>
            바꾸기
          </button>
        )}
      </div>
      {editing ? (
        <div className="card stack-tight">
          <RuleField field={field} value={form.draft[field.key]} onChange={(value) => form.set(field.key, value)} problem={settingProblem(form.error, field.key)} />
          <div className="row">
            <button
              type="button"
              className="button button-primary"
              disabled={form.busy}
              onClick={() =>
                void form.save().then((ok) => {
                  if (ok) setEditing(false)
                })
              }
            >
              저장
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                form.reset()
                setEditing(false)
              }}
            >
              그만두기
            </button>
          </div>
          {form.error !== null && settingProblem(form.error, field.key) === undefined ? <ErrorNote error={form.error} /> : null}
        </div>
      ) : null}
      {form.done !== null && !editing ? (
        <p className="notice" role="status">
          {form.done}
        </p>
      ) : null}
    </li>
  )
}

/** 4단계 유튜브 (AC-I3-54): 설정과 같은 안내·버튼·상태. 자동 게시 동의는 묻지 않는다 */
function YoutubeStep({ result, navigate }: { readonly result: string | null; readonly navigate: Navigate }) {
  const youtube = useYoutubeConnection()
  return (
    <div className="stack">
      <CallbackResult code={result} />
      <YoutubeStatus handle={youtube} quota={null} navigate={navigate} place="wizard" />
      <p className="hint">감사 메시지 자동 게시는 설정에서 따로 켤 수 있어요.</p>
    </div>
  )
}

/** 5단계 리허설 (AC-I3-55): 오늘(KST) 리허설 방송을 만들고(요청 번호 — 두 번 눌러도 하나) 마침 → 그 리허설 콘솔 */
function RehearsalStep({ navigate, onFinish, onPrev, onLater, busy }: { readonly navigate: Navigate; readonly onFinish: () => void; readonly onPrev: () => void; readonly onLater: () => void; readonly busy: boolean }) {
  const requestId = useRef(newRequestId())
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const start = async () => {
    if (starting) return
    setStarting(true)
    setError(null)
    try {
      const created = await withRetry(() => post<WriteResult>('/api/broadcasts', { requestId: requestId.current, rehearsal: true }))
      try {
        await put('/api/wizard', { status: 'DONE' })
      } catch {
        // 상태 기록은 편의 — 리허설로 간다
      }
      const id = created.broadcast?.id
      navigate(id === undefined ? { name: 'home' } : { name: 'console', id })
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      setStarting(false)
    }
  }
  return (
    <>
      <p>{REHEARSAL_INVITE}</p>
      <div className="row">
        <button type="button" className="button button-primary" disabled={starting || busy} onClick={() => void start()}>
          리허설 시작하기
        </button>
        <button type="button" className="button" disabled={starting || busy} onClick={onFinish}>
          마치기
        </button>
      </div>
      {error !== null ? <ErrorNote error={error} onRetry={() => void start()} retryLabel="다시 시도" /> : null}
      <div className="row wizard-buttons">
        <button type="button" className="button" onClick={onPrev}>
          이전
        </button>
        <button type="button" className="button" onClick={onLater}>
          나중에 할게요
        </button>
      </div>
    </>
  )
}
