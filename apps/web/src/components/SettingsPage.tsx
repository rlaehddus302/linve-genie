// 설정 (SPEC §7 화면 8, D-I3-08·D-I3-10, AC-I3-44~47·01~05·10~14·37·64).
// 칸: 가게 · 판매 규칙(자주 쓰는 칸 + "더 보기") · 배송비 · 구매 감사 메시지 · 라벨 · 택배(T1 AC-T1-66 — `/settings/parcel`은 그 칸으로) · 유튜브 · 인스타그램 · 틱톡 라이브(베타) · 보조자 · 그 밖. 칸마다 "저장"(바뀐 키만).
// - "라벨" 칸은 라벨 기능 켜기/끄기·바꾼 기록이다(N4a AC-N4a-10, D-N4a-05) — 저장 버튼 없이 누르면 바로 바뀐다(끌 때는 묻는다).
// - N2b-2: `/settings/instagram`·`/settings/tiktok`은 그 칸이 보이게 연다. 인스타그램에서 돌아온 결과(`?instagram=`)는 한 번 보이고 주소에서 지운다.
// - BND1 (AC-BND1-70): 틱톡 칸 뒤에 "네이버 밴드"(판매자만 — 보조자에게는 칸이 없다). `/settings/band`는 그 칸이 보이게 열고,
//   밴드에서 돌아온 결과(`?band=`)는 한 번 보이고 주소에서 지운다. 계정 알림(SSE `band` ACCOUNT)·다시 붙음에 바로 바뀐다.
// - `/settings/youtube`는 같은 화면에서 유튜브 칸이 보이게(스크롤·포커스) 연다. 구글에서 돌아온 결과(`?youtube=`)는 한 번 보이고 주소에서 지운다.
// - 끝나지 않은 실제 방송이 있으면 위에 "진행 중인 방송에는 바뀐 규칙이 적용되지 않아요."
// - 저장하지 않은 값이 있으면 다른 화면으로 가기 전에 같은 떠나기 창이 묻는다.
// - FB1 D-FB1-06 (AC-FB1-22~25): 값을 적는 다섯 칸(가게·판매 규칙·배송비·구매 감사 메시지 만들기·택배)은 칸마다 "저장" 대신 화면 아래 저장 막대 하나.
//   연결·동의·켜기 칸(라벨·유튜브·크롬 확장·인스타그램·틱톡·AI 제안·보조자·로그인 방법)은 지금처럼 누르면 바로.
// - 유튜브 연결·동의·사용량은 실시간 알림으로 1초 안에 바뀐다(다른 기기 포함). 끊겼다 이어지면 다시 받는다.
// I2 (STL-04, DAT-03·04, D-I2-02·D-I2-10~12, AC-I2-02·65) — 합친 화면(main I3 + I2)에서 양쪽 칸을 모두 둔다:
// - 가게: "가게 이름"(위 줄 이름 — 시작 마법사와 같은 값)·"은행"·"계좌번호"·"예금주"·"입금 안내 문장"과 "저장". 칸 아래에 확인서에 나올 모양을 미리 보인다
//   (`농협 302-9988-7766-11 (예금주 김판매)`와 안내 문장 — 계좌가 없으면 "확인서에 입금 계좌가 나오지 않아요."). 저장되면 "저장했어요."이고 위 가게 이름이 바로 바뀐다.
//   계좌 칸을 아직 받지 못했으면(불러오는 중·실패) 가게 이름만 저장한다(PUT /api/shop { name }).
// - 백업: 마지막 자동 백업 시각(KST)·보관 기간·보관 중인 백업 목록(만든 시각·크기). 꺼져 있거나 마지막 성공이 26시간보다 오래되면 주의 안내.
//   복구·백업 파일 내려받기 버튼은 없다(운영자에게 날짜를 알려 되돌린다 — D-I2-11).
// - 전체 기록 내려받기: "전체 기록 파일 (옮기기·보관용)"(MOB1 D-MOB1-11 — 옛 "전체 기록(JSON)")·"전체 판매대장(엑셀)" — 만드는 동안 그 버튼이 잠기고 "만드는 중이에요…".
// A1 (AC-A1-22): 틱톡 칸 뒤에 "AI 제안"(옵션 방송을 쓰는 판매자에게만 — 판매 방식 기본이 옵션이거나 옵션 방송 기록이 있다). `/settings/assist`는 그 칸이 보이게 연다.
// L1 (AC-L1-21~23): 보조자 칸 뒤에 "로그인 방법"(판매자에게만 — 간편 로그인이 꺼진 서버면 칸이 없다). 공급자에서 돌아온 `?login=<코드>&provider=<p>`는
//   그 칸에 정해진 문장을 한 번 보이고 주소에서 지운다. 연결·끊기 알림(`login`)과 다시 붙음에 목록을 다시 읽는다.
import type { SaleSettings } from '@livejjim/core'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { get, isApiError, put, type ApiError } from '../api/client.ts'
import type { BackupStatus, BroadcastItem, Shop } from '../api/types.ts'
import { sizeWords } from '../lib/files.ts'
import { kstDateTimeLong } from '../lib/kst.ts'
import { useUnsavedGuard } from '../lib/leave-guard.ts'
import { useLiveEvents } from '../lib/live-events.ts'
import { routePath, type Navigate, type Route, type SettingsRoute } from '../lib/router.ts'
import { saleModeOf } from '../lib/words.ts'
import { DETAIL_SETTINGS_NOTE, RULES_DETAIL, fieldsAt, ONGOING_NOTICE, SHIPPING_HINT, type FieldDef } from '../lib/settings-fields.ts'
import { useSaveStep, type SaveBlock, type StepResult } from '../lib/save-bar.ts'
import { SaveBarArea } from './SaveBar.tsx'
import { hasChannel } from '../lib/youtube.ts'
import { AssistSection, useShowAssist } from './AssistSection.tsx'
import { AssistantsSection } from './AssistantsSection.tsx'
import { DownloadButton } from './downloads.tsx'
import { ExtensionSettings, useExtension } from './ExtensionConnection.tsx'
import { ErrorNote, RequestError } from './ErrorNote.tsx'
import { LabelSwitchSection } from './LabelSwitchSection.tsx'
import { ParcelSettingsSection } from './ParcelSettings.tsx'
import { LoginMethodsPanel, showLoginMethods, useLoginMethods } from './LoginMethods.tsx'
import { parseLoginResult, stripLoginParams } from '../lib/social-login.ts'
import { DetailToggle, FixedArrivalField, RuleField, SaleModeField, settingProblem, useRuleForm } from './RuleFields.tsx'
import { ThanksSettings } from './ThanksSettings.tsx'
import { BandCallbackResult, BandSettings, useBandAccount } from './BandSettings.tsx'
import { InstagramCallbackResult, InstagramSettings, TikTokSettingsSection, useInstagramConnection, useTikTokSettings } from './PlatformSettings.tsx'
import { CallbackResult, useQuota, useYoutubeConnection, YoutubeStatus } from './YoutubeConnection.tsx'

const BASIC_FIELDS = fieldsAt('basic')
const MORE_FIELDS = fieldsAt('more')
const RULE_FIELDS = [...BASIC_FIELDS, ...MORE_FIELDS]
const SHIPPING_FIELDS = fieldsAt('shipping')
const THANKS_FIELDS = fieldsAt('thanks')
const ALL_FIELDS = [...RULE_FIELDS, ...SHIPPING_FIELDS, ...THANKS_FIELDS]
const ALL_KEYS = ALL_FIELDS.map((field) => `settings.${field.key}`)

export const SHOP_SAVED = '저장했어요.'
/** 가게 칸 저장 성공 (I2 이름 — SHOP_SAVED와 같은 글) */
export const SAVED = SHOP_SAVED
export const NO_ACCOUNT_ON_RECEIPT = '확인서에 입금 계좌가 나오지 않아요.'
/** 계좌 칸을 일부만 적었을 때 미리 보기 (서버 거절 문장과 다른 글 — 같은 글이 두 번 보이지 않게) */
export const ACCOUNT_INCOMPLETE = '은행·계좌번호·예금주가 모두 있어야 확인서에 계좌가 나와요.'
export const BACKUP_STOPPED = '자동 백업이 멈췄어요. 운영자에게 알려 주세요.'
export const RESTORE_HINT = '백업 시점으로 되돌리려면 운영자에게 날짜를 알려 주세요.'
export const EXPORT_WARNING = '구매자 닉네임·메모·전화번호 끝자리가 들어 있어요. 파일을 다른 사람에게 보내지 마세요.'
/** 마지막 자동 백업이 이보다 오래되면 멈춘 것으로 본다 (AC-I2-65) */
export const BACKUP_STALE_MS = 26 * 60 * 60 * 1000

const FIELDS = [
  { key: 'name', label: '가게 이름', placeholder: '초록다육' },
  { key: 'bank', label: '은행', placeholder: '농협' },
  { key: 'accountNumber', label: '계좌번호', placeholder: '302-9988-7766-11' },
  { key: 'accountHolder', label: '예금주', placeholder: '김판매' },
  { key: 'accountNote', label: '입금 안내 문장', placeholder: '입금자명은 닉네임으로 적어 주세요' },
] as const satisfies readonly { readonly key: keyof Shop; readonly label: string; readonly placeholder: string }[]

/** 확인서에 나올 입금 계좌 (문서 패키지와 같은 모양: "은행 계좌번호 (예금주 이름)") — 셋 다 있을 때만 */
export function accountPreview(shop: Shop): { readonly text: string; readonly note: string | null } | 'none' | 'partial' {
  const bank = shop.bank.trim()
  const number = shop.accountNumber.trim()
  const holder = shop.accountHolder.trim()
  const filled = [bank, number, holder].filter((value) => value !== '').length
  if (filled === 0) return 'none'
  if (filled < 3) return 'partial'
  const note = shop.accountNote.trim()
  return { text: `${bank} ${number} (예금주 ${holder})`, note: note === '' ? null : note }
}

/** 자동 백업이 멈췄는가: 꺼져 있거나, 성공이 없거나, 마지막 성공이 26시간보다 오래됐다 */
export function backupStopped(status: Pick<BackupStatus, 'enabled' | 'lastSuccessAt'>, now: number = Date.now()): boolean {
  if (!status.enabled || status.lastSuccessAt === null) return true
  const at = Date.parse(status.lastSuccessAt)
  return !Number.isFinite(at) || now - at > BACKUP_STALE_MS
}


export interface SettingsPageProps {
  readonly route: SettingsRoute
  readonly navigate: Navigate
  readonly shopName: string
  readonly onRenamed: (name: string) => void
  /** 보조자 계정 — "로그인 방법" 칸이 없고 목록을 부르지 않는다 (AC-L1-23) */
  readonly assistant?: boolean
}

export function SettingsPage({ route, navigate, shopName, onRenamed, assistant = false }: SettingsPageProps) {
  const [settings, setSettings] = useState<SaleSettings | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [ongoing, setOngoing] = useState(false)
  // 구글에서 돌아온 결과는 한 번만 (주소에서 지운 뒤에도 이 화면이 열린 동안 보인다)
  const [result] = useState<string | null>(route.youtubeResult ?? null)
  const youtube = useYoutubeConnection()
  const quota = useQuota(hasChannel(youtube.connection))
  // 인스타그램에서 돌아온 결과도 한 번만 (N2b-2)
  const [instagramResult] = useState<string | null>(route.instagramResult ?? null)
  const instagram = useInstagramConnection()
  const tiktok = useTikTokSettings()
  // 밴드에서 돌아온 결과도 한 번만 (BND1) — 보조자는 칸이 없고 부르지 않는다
  const [bandResult] = useState<string | null>(assistant ? null : (route.bandResult ?? null))
  const band = useBandAccount(!assistant)
  // 간편 로그인 연결에서 돌아온 결과도 한 번만 (L1 AC-L1-21)
  const [loginResult] = useState(() => (assistant ? null : parseLoginResult(window.location.pathname, window.location.search, 'settings')))
  const loginMethods = useLoginMethods(!assistant)
  // 크롬 확장 연결 (X1 — 판매자만, 보조자는 코드를 만들 수 없다)
  const extension = useExtension(!assistant)
  // AI 제안 칸 (A1): 저장된 판매 방식이 옵션이면 바로, 아니면 옵션 방송 기록을 물어서
  const showAssist = useShowAssist(settings === null ? (loadError === null ? null : false) : settings['claim.parseMode'] === 'OPTIONS', assistant)
  useEffect(() => {
    stripLoginParams()
  }, [])

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
    if (route.youtubeResult !== undefined || route.instagramResult !== undefined || route.bandResult !== undefined) navigate({ name: 'settings', ...(route.section === undefined ? {} : { section: route.section }) }, { replace: true })
  }, [route.youtubeResult, route.instagramResult, route.bandResult, route.section, navigate])

  useLiveEvents({
    onYoutube: (event) => {
      if (event.kind === 'connection') youtube.set(event.connection)
      else if (event.kind === 'quota') {
        quota.setMode(event.mode)
        void quota.reload()
      }
    },
    onPlatform: (event) => {
      if (event.type === 'instagram' && event.event.kind === 'CONNECTION') instagram.set(event.event.connection)
      if (event.type === 'band' && event.event.kind === 'ACCOUNT' && !assistant) band.set(event.event.band)
    },
    onLogin: () => void loginMethods.reload(),
    onReconnect: () => {
      void loginMethods.reload()
      void youtube.reload()
      void quota.reload()
      void instagram.reload()
      void tiktok.reload()
      if (!assistant) void band.reload()
    },
  })

  return (
    <main className="page settings-page stack">
      <SaveBarArea>
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
      <LabelSwitchSection focus={route.section === 'labels' && (settings !== null || loadError !== null)} />
      <SettingsSection title="택배" focus={route.section === 'parcel' && (settings !== null || loadError !== null)}>
        <ParcelSettingsSection />
      </SettingsSection>
      <SettingsSection title="유튜브" focus={route.section === 'youtube' && (settings !== null || loadError !== null)}>
        <CallbackResult code={result} />
        <YoutubeStatus handle={youtube} quota={quota.quota} navigate={navigate} place="settings" />
      </SettingsSection>
      {assistant ? null : (
        <SettingsSection title="크롬 확장으로 채팅 받기" focus={route.section === 'extension' && (settings !== null || loadError !== null)}>
          <ExtensionSettings handle={extension} />
        </SettingsSection>
      )}
      <SettingsSection title="인스타그램" focus={route.section === 'instagram' && (settings !== null || loadError !== null)}>
        <InstagramCallbackResult code={instagramResult} />
        <InstagramSettings handle={instagram} />
      </SettingsSection>
      <SettingsSection title="틱톡 라이브(베타)" focus={route.section === 'tiktok' && (settings !== null || loadError !== null)}>
        <TikTokSettingsSection handle={tiktok} />
      </SettingsSection>
      {assistant ? null : (
        <SettingsSection title="네이버 밴드" focus={route.section === 'band' && (settings !== null || loadError !== null)}>
          <BandCallbackResult code={bandResult} />
          <BandSettings handle={band} />
        </SettingsSection>
      )}
      {showAssist ? (
        <SettingsSection title="AI 제안" focus={route.section === 'assist'}>
          <AssistSection />
        </SettingsSection>
      ) : null}
      <SettingsSection title="보조자">
        <AssistantsSection />
      </SettingsSection>
      {showLoginMethods(loginMethods.current, loginResult) ? (
        <SettingsSection title="로그인 방법" focus={loginResult !== null && loginMethods.current.state !== 'loading'}>
          <LoginMethodsPanel handle={loginMethods} result={loginResult} />
        </SettingsSection>
      ) : null}
      <BackupSection />
      <ExportSection />
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
      </SaveBarArea>
    </main>
  )
}

/**
 * 판매 규칙·배송비·구매 감사 메시지(만들기) — 칸 묶음 하나(FB1 D-FB1-06): 저장 막대가 세 칸의 바뀐 키를 모아 PATCH /api/settings 한 번으로 보낸다
 * (셋이 한꺼번에 받히거나 거절된다 — 반만 저장 없음). 저장하지 않은 값이 있으면 떠나기 전에 묻는다.
 */
function RuleSections({ settings, onSaved, youtube }: { readonly settings: SaleSettings; readonly onSaved: (settings: SaleSettings) => void; readonly youtube: ReturnType<typeof useYoutubeConnection> }) {
  const form = useRuleForm(ALL_FIELDS, settings, onSaved, '')
  const [more, setMore] = useState(false)
  const moreId = useId()
  const options = saleModeOf({ 'claim.parseMode': String(form.draft['claim.parseMode']) }) === 'OPTIONS'
  useUnsavedGuard(form.dirty)
  const dirty = settingsDirtyBlocks(form.changes)
  const [failed, setFailed] = useState<readonly SaveBlock[]>([])
  useSaveStep('settings', dirty, async () => {
    const sent = settingsDirtyBlocks(form.changes)
    const ok = await form.save()
    setFailed(ok ? [] : sent)
    return ok ? { saved: sent, failed: [] } : { saved: [], failed: sent }
  })
  // 칸 밖 문장(연결 끊김 등)은 저장하지 못한 첫 칸 아래 한 번
  const outside = (block: SaveBlock) => (form.error !== null && failed[0] === block ? <ErrorNote error={form.error} omitFields={ALL_KEYS} /> : null)
  // 서버 문장이 접힌 칸에 있으면 펴서 보인다
  const moreOpen = more || MORE_FIELDS.some((field) => settingProblem(form.error, field.key) !== undefined)
  return (
    <>
      <SettingsSection title="판매 규칙">
        <p className="hint">바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.</p>
        {/* 판매 방식 (D-O2-01): 옵션 방식이면 겨루기를 접수순으로 함께 바꾼다 — 함께 둘 수 없는 값(옵션 + 실제 시각순)을 고를 수 없게 */}
        <SaleModeField
          value={options ? 'OPTIONS' : 'NUMBERS'}
          onChange={(mode) => {
            if (mode === 'OPTIONS') {
              form.set('claim.parseMode', 'OPTIONS')
              form.set('contention.policy', 'ARRIVAL')
            } else form.set('claim.parseMode', 'STRICT')
          }}
          problem={settingProblem(form.error, 'claim.parseMode')}
        />
        {BASIC_FIELDS.map((field) => (
          <RuleField key={field.key} field={field} value={form.draft[field.key]} saved={settings[field.key]} onChange={(value) => form.set(field.key, value)} problem={settingProblem(form.error, field.key)} />
        ))}
        <div className="stack-tight">
          {/* FB1 D-FB1-02 (2)·D-FB1-18 (c): "판매 규칙 상세 설정 ▼" — 펴면 맨 위에 "잘 모르면 그대로 두세요." */}
          <DetailToggle label={RULES_DETAIL} open={moreOpen} controls={moreId} onToggle={() => setMore(!moreOpen)} />
          <div id={moreId} className="stack" hidden={!moreOpen}>
            <p className="hint">{DETAIL_SETTINGS_NOTE}</p>
            {MORE_FIELDS.map((field) =>
              // 옵션 방식: 엄격/느슨 칸은 없고, 겨루기 칸은 고를 수 없는 글 (D-O2-01)
              options && field.key === 'claim.parseMode' ? null : options && field.key === 'contention.policy' ? (
                <FixedArrivalField key={field.key} label={field.label} />
              ) : (
                <RuleField key={field.key} field={field} value={form.draft[field.key]} onChange={(value) => form.set(field.key, value)} problem={settingProblem(form.error, field.key)} />
              ),
            )}
          </div>
        </div>
        {outside('판매 규칙')}
      </SettingsSection>
      <SettingsSection title="배송비">
        <p className="hint">{SHIPPING_HINT}</p>
        {SHIPPING_FIELDS.map((field) => (
          <RuleField key={field.key} field={field} value={form.draft[field.key]} onChange={(value) => form.set(field.key, value)} problem={settingProblem(form.error, field.key)} />
        ))}
        {outside('배송비')}
      </SettingsSection>
      <SettingsSection title="구매 감사 메시지">
        <ThanksSettings settings={settings} youtube={youtube} form={form} />
        {outside('구매 감사 메시지')}
      </SettingsSection>
    </>
  )
}

/** 설정 키 묶음 → 막대의 칸 이름 (바뀐 키가 있는 칸만, 화면 순서) */
export function settingsDirtyBlocks(changes: Readonly<Record<string, unknown>>): SaveBlock[] {
  const keys = Object.keys(changes)
  const has = (fields: readonly FieldDef[]) => fields.some((field) => keys.includes(field.key))
  return [...(has(RULE_FIELDS) ? (['판매 규칙'] as const) : []), ...(has(SHIPPING_FIELDS) ? (['배송비'] as const) : []), ...(has(THANKS_FIELDS) ? (['구매 감사 메시지'] as const) : [])]
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

const EMPTY_ACCOUNT = { bank: '', accountNumber: '', accountHolder: '', accountNote: '' } as const

/**
 * 가게 (I3 AC-I3-47 가게 이름 + I2 AC-I2-02 입금 계좌·안내 문장): 저장하면 이 기기의 위 줄이 바로 바뀐다.
 * shopName(로그인 정보의 가게 이름)이 있으면 가게 이름 칸은 바로 보이고, 계좌 칸은 GET /api/shop을 받은 뒤 보인다.
 * 계좌 칸을 받았으면 다섯 칸을 함께(PUT /api/shop 다섯 칸), 아직이면 가게 이름만(PUT /api/shop { name }) 저장한다.
 * 칸 문제는 그 칸 옆에, 칸 밖 문장(계좌 일부만 등)은 아래에 — 같은 문장을 두 번 보이지 않는다
 */
export function ShopForm({ shopName, onRenamed }: { readonly shopName?: string; readonly onRenamed: (name: string) => void }) {
  const id = useId()
  const [draft, setDraft] = useState<Shop>({ name: shopName ?? '', ...EMPTY_ACCOUNT })
  const [loaded, setLoaded] = useState<Shop | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<ApiError | null>(null)
  const busy = useRef(false)
  const savedName = loaded?.name ?? shopName ?? ''
  const dirty = loaded === null ? draft.name !== savedName : FIELDS.some((field) => draft[field.key] !== loaded[field.key])
  useUnsavedGuard(dirty)

  useEffect(() => {
    let alive = true
    setLoadError(null)
    get<{ shop: Shop }>('/api/shop').then(
      (result) => {
        if (!alive) return
        setLoaded(result.shop)
        // 받기 전에 고친 가게 이름은 그대로 둔다
        setDraft((current) => ({ ...result.shop, name: current.name !== (shopName ?? '') && shopName !== undefined ? current.name : result.shop.name }))
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setLoadError(caught)
      },
    )
    return () => {
      alive = false
    }
    // shopName은 처음 값만 쓴다 (저장 뒤 바뀐 이름으로 다시 받지 않는다)
  }, [attempt])

  const change = (key: keyof Shop, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  /** 저장 막대가 부른다 (FB1 D-FB1-06 — 바뀌었을 때만 PUT /api/shop) */
  const save = async (): Promise<StepResult> => {
    if (busy.current || !dirty) return { saved: [], failed: [] }
    busy.current = true
    setError(null)
    try {
      const { shop } = await put<{ shop: Partial<Shop> & { name: string } }>('/api/shop', loaded === null ? { name: draft.name } : draft)
      if (loaded !== null) {
        const full: Shop = { ...EMPTY_ACCOUNT, ...shop }
        setLoaded(full)
        setDraft(full)
      } else setDraft((current) => ({ ...current, name: shop.name }))
      onRenamed(shop.name)
      return { saved: ['가게'], failed: [] }
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
      return { saved: [], failed: ['가게'] }
    } finally {
      busy.current = false
    }
  }
  useSaveStep('shop', dirty ? ['가게'] : [], save)

  if (shopName === undefined && loaded === null) {
    return loadError !== null ? <RequestError error={loadError} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : <p role="status">불러오는 중…</p>
  }
  const shown = loaded === null ? FIELDS.filter((field) => field.key === 'name') : FIELDS
  const preview = loaded === null ? null : accountPreview(draft)
  const fieldKeys: readonly string[] = FIELDS.map((field) => field.key)
  // 칸 밖 문장: 칸 옆에 같은 문장이 이미 있으면 다시 보이지 않는다
  const outside = error !== null && !fieldKeys.some((key) => error.problemFor(key)?.message === error.message)
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        // 저장은 화면 아래 저장 막대 하나 (FB1 D-FB1-06)
        event.preventDefault()
      }}
    >
      {shown.map((field) => {
        const problem = error?.problemFor(field.key)
        return (
          <div key={field.key} className="field">
            <label htmlFor={`${id}-${field.key}`}>{field.label}</label>
            <input
              id={`${id}-${field.key}`}
              className="input"
              autoComplete={field.key === 'name' ? 'organization' : 'off'}
              inputMode={field.key === 'accountNumber' ? 'numeric' : undefined}
              placeholder={field.placeholder}
              value={draft[field.key]}
              aria-invalid={problem !== undefined}
              aria-describedby={problem === undefined ? undefined : `${id}-${field.key}-error`}
              onChange={(event) => change(field.key, event.target.value)}
            />
            {problem !== undefined ? (
              <p className="field-error" role="alert" id={`${id}-${field.key}-error`}>
                {problem.message}
              </p>
            ) : null}
          </div>
        )
      })}
      {loaded === null ? (
        loadError !== null ? (
          <RequestError error={loadError} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" />
        ) : (
          <p role="status">입금 계좌를 불러오는 중…</p>
        )
      ) : (
        <section className="receipt-account stack-tight" aria-label="확인서에 나올 모양">
          <h3 className="sub-title">확인서에 나올 모양</h3>
          {preview === 'none' ? <p>{NO_ACCOUNT_ON_RECEIPT}</p> : null}
          {preview === 'partial' ? (
            <p className="warning" data-tone="warning">
              {ACCOUNT_INCOMPLETE}
            </p>
          ) : null}
          {preview !== null && typeof preview === 'object' ? (
            <div className="quote">
              <p>{preview.text}</p>
              {preview.note !== null ? <p>{preview.note}</p> : null}
            </div>
          ) : null}
        </section>
      )}
      {outside ? <RequestError error={error} omitFields={fieldKeys} /> : null}
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

/** 백업 (I2 AC-I2-65) */
export function BackupSection() {
  const id = useId()
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    get<BackupStatus>('/api/backups').then(
      (result) => {
        if (alive) setStatus(result)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  return (
    <section className="card stack-tight" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title">
        백업
      </h2>
      {error !== null ? <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : null}
      {status === null && error === null ? <p role="status">불러오는 중…</p> : null}
      {status !== null ? (
        <>
          {backupStopped(status) ? (
            <p className="notice" role="alert" data-tone="warning">
              {BACKUP_STOPPED}
            </p>
          ) : null}
          <p>마지막 자동 백업: {status.lastSuccessAt === null ? '없음' : kstDateTimeLong(status.lastSuccessAt)}</p>
          <p>백업은 {String(status.retentionDays)}일 동안 보관해요.</p>
          {status.backups.length > 0 ? (
            <ul className="plain-list backup-list" aria-label="보관 중인 백업">
              {status.backups.map((backup) => (
                <li key={backup.createdAt}>
                  {kstDateTimeLong(backup.createdAt)} · {sizeWords(backup.size)}
                </li>
              ))}
            </ul>
          ) : (
            <p>보관 중인 백업이 없어요.</p>
          )}
          <p className="hint">{RESTORE_HINT}</p>
        </>
      ) : null}
    </section>
  )
}

/** 전체 기록 내려받기 (I2 AC-I2-66) */
export function ExportSection() {
  const id = useId()
  return (
    <section className="card stack-tight" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title">
        전체 기록 내려받기
      </h2>
      <p className="warning" data-tone="warning">
        {EXPORT_WARNING}
      </p>
      <div className="stack-tight">
        <DownloadButton label="전체 기록 파일 (옮기기·보관용)" busyText="만드는 중이에요…" path="/api/export/records.json.gz" fallbackName="livejjim-records.json.gz" />
        <DownloadButton label="전체 판매대장(엑셀)" busyText="만드는 중이에요…" path="/api/export/ledger.xlsx" fallbackName="livejjim-ledger.xlsx" />
      </div>
    </section>
  )
}
