// 설정 (SPEC §7 화면 8, D-I3-08·D-I3-10, AC-I3-44~47·01~05·10~14·37·64).
// 칸: 가게 · 판매 규칙(자주 쓰는 칸 + "더 보기") · 배송비 · 구매 감사 메시지 · 라벨 · 유튜브 · 보조자 · 그 밖. 칸마다 "저장"(바뀐 키만).
// - "라벨" 칸은 라벨 기능 켜기/끄기·바꾼 기록이다(N4a AC-N4a-10, D-N4a-05) — 저장 버튼 없이 누르면 바로 바뀐다(끌 때는 묻는다).
// - `/settings/youtube`는 같은 화면에서 유튜브 칸이 보이게(스크롤·포커스) 연다. 구글에서 돌아온 결과(`?youtube=`)는 한 번 보이고 주소에서 지운다.
// - 끝나지 않은 실제 방송이 있으면 위에 "진행 중인 방송에는 바뀐 규칙이 적용되지 않아요."
// - 저장하지 않은 값이 있으면 다른 화면으로 가기 전에 같은 떠나기 창이 묻는다.
// - 유튜브 연결·동의·사용량은 실시간 알림으로 1초 안에 바뀐다(다른 기기 포함). 끊겼다 이어지면 다시 받는다.
import type { SaleSettings } from '@livejjim/core'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { get, isApiError, put, type ApiError } from '../api/client.ts'
import type { BroadcastItem } from '../api/types.ts'
import { useUnsavedGuard } from '../lib/leave-guard.ts'
import { useLiveEvents } from '../lib/live-events.ts'
import { routePath, type Navigate, type Route, type SettingsRoute } from '../lib/router.ts'
import { fieldsAt, ONGOING_NOTICE, SAVED_MESSAGE, SAVED_SHIPPING_MESSAGE } from '../lib/settings-fields.ts'
import { hasChannel } from '../lib/youtube.ts'
import { AssistantsSection } from './AssistantsSection.tsx'
import { ErrorNote, FieldError } from './ErrorNote.tsx'
import { LabelSwitchSection } from './LabelSwitchSection.tsx'
import { RuleField, SaveRow, settingProblem, useRuleForm } from './RuleFields.tsx'
import { ThanksSettings, useThanksForm } from './ThanksSettings.tsx'
import { CallbackResult, useQuota, useYoutubeConnection, YoutubeStatus } from './YoutubeConnection.tsx'

const BASIC_FIELDS = fieldsAt('basic')
const MORE_FIELDS = fieldsAt('more')
const RULE_FIELDS = [...BASIC_FIELDS, ...MORE_FIELDS]
const SHIPPING_FIELDS = fieldsAt('shipping')

export const SHOP_SAVED = '저장했어요.'

export interface SettingsPageProps {
  readonly route: SettingsRoute
  readonly navigate: Navigate
  readonly shopName: string
  readonly onRenamed: (name: string) => void
}

export function SettingsPage({ route, navigate, shopName, onRenamed }: SettingsPageProps) {
  const [settings, setSettings] = useState<SaleSettings | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [ongoing, setOngoing] = useState(false)
  // 구글에서 돌아온 결과는 한 번만 (주소에서 지운 뒤에도 이 화면이 열린 동안 보인다)
  const [result] = useState<string | null>(route.youtubeResult ?? null)
  const youtube = useYoutubeConnection()
  const quota = useQuota(hasChannel(youtube.connection))

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [{ settings: current }, { broadcasts }] = await Promise.all([get<{ settings: SaleSettings }>('/api/settings'), get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')])
      setSettings(current)
      setOngoing(broadcasts.some((item) => !item.rehearsal && !item.ended))
    } catch (error) {
      if (isApiError(error)) setLoadError(error)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 돌아온 결과 코드는 주소에서 지운다 (기록을 늘리지 않고 — 새로고침해도 다시 나오지 않게)
  useEffect(() => {
    if (route.youtubeResult !== undefined) navigate({ name: 'settings', ...(route.section === undefined ? {} : { section: route.section }) }, { replace: true })
  }, [route.youtubeResult, route.section, navigate])

  useLiveEvents({
    onYoutube: (event) => {
      if (event.kind === 'connection') youtube.set(event.connection)
      else if (event.kind === 'quota') {
        quota.setMode(event.mode)
        void quota.reload()
      }
    },
    onReconnect: () => {
      void youtube.reload()
      void quota.reload()
    },
  })

  return (
    <main className="page settings-page stack">
      <h1>설정</h1>
      {ongoing ? (
        <p className="notice" role="note">
          {ONGOING_NOTICE}
        </p>
      ) : null}
      {loadError !== null ? <ErrorNote error={loadError} onRetry={() => void load()} retryLabel="다시 불러오기" /> : null}
      {settings === null && loadError === null ? <p role="status">불러오는 중…</p> : null}
      <SettingsSection title="가게">
        <ShopForm shopName={shopName} onRenamed={onRenamed} />
      </SettingsSection>
      {settings !== null ? <RuleSections settings={settings} onSaved={setSettings} youtube={youtube} /> : null}
      <LabelSwitchSection />
      <SettingsSection title="유튜브" focus={route.section === 'youtube' && (settings !== null || loadError !== null)}>
        <CallbackResult code={result} />
        <YoutubeStatus handle={youtube} quota={quota.quota} navigate={navigate} place="settings" />
      </SettingsSection>
      <SettingsSection title="보조자">
        <AssistantsSection />
      </SettingsSection>
      <SettingsSection title="그 밖">
        <ul className="plain-list link-list">
          <li>
            <SpaLink navigate={navigate} to={{ name: 'start', fresh: true }}>
              시작 마법사 다시 하기
            </SpaLink>
          </li>
          <li>
            <SpaLink navigate={navigate} to={{ name: 'privacy' }}>
              개인정보처리방침
            </SpaLink>
          </li>
          <li>
            <SpaLink navigate={navigate} to={{ name: 'terms' }}>
              이용약관
            </SpaLink>
          </li>
        </ul>
      </SettingsSection>
    </main>
  )
}

/** 판매 규칙·배송비·구매 감사 메시지 (저장하지 않은 값이 있으면 떠나기 전에 묻는다) */
function RuleSections({ settings, onSaved, youtube }: { readonly settings: SaleSettings; readonly onSaved: (settings: SaleSettings) => void; readonly youtube: ReturnType<typeof useYoutubeConnection> }) {
  const rules = useRuleForm(RULE_FIELDS, settings, onSaved, SAVED_MESSAGE)
  const shipping = useRuleForm(SHIPPING_FIELDS, settings, onSaved, SAVED_SHIPPING_MESSAGE)
  const thanks = useThanksForm(settings, onSaved)
  const [more, setMore] = useState(false)
  const moreId = useId()
  useUnsavedGuard(rules.dirty || shipping.dirty || thanks.dirty)
  return (
    <>
      <SettingsSection title="판매 규칙">
        <p className="hint">바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.</p>
        {BASIC_FIELDS.map((field) => (
          <RuleField key={field.key} field={field} value={rules.draft[field.key]} onChange={(value) => rules.set(field.key, value)} problem={settingProblem(rules.error, field.key)} />
        ))}
        <div className="stack-tight">
          <button type="button" className="button" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((open) => !open)}>
            더 보기 (잘 모르면 그대로 두세요)
          </button>
          <div id={moreId} className="stack" hidden={!more}>
            {MORE_FIELDS.map((field) => (
              <RuleField key={field.key} field={field} value={rules.draft[field.key]} onChange={(value) => rules.set(field.key, value)} problem={settingProblem(rules.error, field.key)} />
            ))}
          </div>
        </div>
        <SaveRow form={rules} fields={RULE_FIELDS} />
      </SettingsSection>
      <SettingsSection title="배송비">
        {SHIPPING_FIELDS.map((field) => (
          <RuleField key={field.key} field={field} value={shipping.draft[field.key]} onChange={(value) => shipping.set(field.key, value)} problem={settingProblem(shipping.error, field.key)} />
        ))}
        <SaveRow form={shipping} fields={SHIPPING_FIELDS} />
      </SettingsSection>
      <SettingsSection title="구매 감사 메시지">
        <ThanksSettings settings={settings} youtube={youtube} form={thanks} />
      </SettingsSection>
    </>
  )
}

/** 칸 하나 (제목이 그 영역의 이름 — 화면 낭독기·E2E가 찾는다). focus면 열자마자 보이게 스크롤하고 제목에 포커스 */
function SettingsSection({ title, focus = false, children }: { readonly title: string; readonly focus?: boolean; readonly children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const id = useId()
  useEffect(() => {
    const element = heading.current
    if (!focus || element === null) return
    if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'start' })
    element.focus()
  }, [focus])
  return (
    <section className="card stack settings-section" aria-labelledby={id}>
      <h2 id={id} ref={heading} tabIndex={-1} className="section-title">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** 가게 이름 (AC-I3-47): 저장하면 이 기기의 위 줄이 바로 바뀐다 */
export function ShopForm({ shopName, onRenamed }: { readonly shopName: string; readonly onRenamed: (name: string) => void }) {
  const [name, setName] = useState(shopName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState(false)
  const id = useId()
  const dirty = name !== shopName
  useUnsavedGuard(dirty)
  const save = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      const { shop } = await put<{ shop: { name: string } }>('/api/shop', { name })
      onRenamed(shop.name)
      setName(shop.name)
      setDone(true)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="stack-tight"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label className="field" htmlFor={id}>
        <span>가게 이름</span>
      </label>
      <input
        id={id}
        className="input"
        autoComplete="organization"
        value={name}
        aria-describedby={error?.problemFor('name') !== undefined ? `${id}-error` : undefined}
        onChange={(event) => {
          setName(event.target.value)
          setDone(false)
        }}
      />
      <FieldError error={error} field="name" id={`${id}-error`} />
      <div className="row">
        <button type="submit" className="button button-primary" disabled={busy}>
          저장
        </button>
      </div>
      {done ? (
        <p className="notice" role="status">
          {SHOP_SAVED}
        </p>
      ) : null}
      {error !== null && error.problemFor('name') === undefined ? <ErrorNote error={error} /> : null}
    </form>
  )
}

/** 화면 안 이동 링크 (새 탭으로 열 수도 있게 주소를 단다) */
export function SpaLink({ navigate, to, children, className }: { readonly navigate: Navigate; readonly to: Route; readonly children: ReactNode; readonly className?: string }) {
  return (
    <a
      className={className}
      href={routePath(to)}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}
