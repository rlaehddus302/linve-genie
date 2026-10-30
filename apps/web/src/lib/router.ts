// 화면 주소 (AC-S05-01, AC-S06-01, D-094, AC-I3-44·50·77):
//   `/` 방송 목록(홈) · `/broadcasts/<방송 ID>` 그 방송의 콘솔 · `/broadcasts/<방송 ID>/receipts` 영수증 보내기(N4b AC-N4b-30·31) · `/sms` 문자찜 입력
//   `/buyers` 구매자 · `/settlements` 정산 — 고른 날짜·리허설·구매자는 검색값(`?date=2026-10-18&rehearsal=true&buyer=UC_A`)
//   `/packing` 포장 모드 — 고른 날짜(실제 범위만)·연 구매자는 검색값(`?date=2026-10-18&buyer=UC_A`) (I2 AC-I2-35)
//   `/settings` 설정 · `/settings/youtube` 설정의 유튜브 칸(구글에서 돌아오면 `?youtube=<결과>` — 화면이 보인 뒤 지운다)
//   `/settings/instagram`·`/settings/tiktok` 설정의 인스타그램·틱톡 칸 — 인스타그램에서 돌아온 `?instagram=<결과>`(경로 `/`여도)는 인스타그램 칸으로 (N2b-2)
//   `/settings/band` 설정의 네이버 밴드 칸 — 밴드에서 돌아온 `?band=<결과>`는 그 칸에서 한 번 보이고 지운다 (BND1)
//   `/settings/assist` 설정의 AI 제안 칸 (A1 — 확인 필요 화면의 "설정에서 AI 제안을 켤 수 있어요." 링크)
//   `/settings/labels` 설정의 라벨 칸 (PL1B U-PL1B-06 — "라벨 쓰지 않음 — 설정에서 켤 수 있어요."의 "설정" 링크)
//   `/login` 로그인 화면(LND1 D-LND1-01 — 메뉴에 없는 화면. 로그아웃 상태의 `/`는 소개 화면, 로그인하면 `/`로 바꿔 간다)
//   `/start` 시작 마법사 · `/privacy` 개인정보처리방침(초안) · `/terms` 이용약관(초안) — 둘은 로그인 없이 열린다
//   `/pricing` 공개 요금 안내(PAY2 §7 화면 18) — 로그인 없이 열리고 메뉴에 없다. 앱에서 연 탭에서는 `/`로 바뀐다(BL-11 3)
//   구매자 자세히의 합치기 창: 상대·방향은 `merge`(상대 구매자 ID)·`into`(남는 쪽 구매자 ID), 막힘에서 연 상품 자세히는 `product`(상품 키)
//   — 상품 자세히에 갔다 와도(브라우저 뒤로 가기 포함) 같은 합치기 창이 다시 열린다 (AC-S06b-34, D-102).
//   `/labels` 라벨(프린터·출력 대기열·버릴 라벨·출력 이력·라벨 설정·내보내기, I1 AC-I1-20)
//   `/settings` 설정에는 "라벨" 절도 있다 — 라벨 기능 켜기/끄기·바꾼 기록 (N4a AC-N4a-10)
//   `/billing` 요금(N5 AC-N5-50 — 요금 기능이 켜져 있을 때만 화면이 있다). 휴대폰 결제 창이 돌아온 주소 `/billing?paymentId=…`의
//   결제 ID만 읽는다(쿼리의 다른 값 — 결제 성공 여부·금액 — 은 쓰지 않는다, BL-6 3).
//   `/deposits` 입금 확인(N3, AC-N3-40) — 보는 목록은 검색값 `tab`(확인 필요는 적지 않는다): done 자동 확인됨·확인함 · ignored 무시함 · paste 붙여넣기 · sources 계좌 연동.
//   입금자명·금액은 주소에 넣지 않는다.
//   `/parcels` 택배 접수(T1, D-T1-08) — 고른 날짜(실제 범위만)는 검색값(`?date=2026-10-18`). `/settings/parcel`은 설정의 택배 칸으로.
// 전화번호·메모·사유는 주소에 넣지 않는다(AC-S06-81) — 구매자 ID·상품 키만. 새로고침·북마크해도 같은 화면이다.
import { useCallback, useEffect, useRef, useState } from 'react'

export type ScopeRouteName = 'buyers' | 'settlements'

export interface ScopeRoute {
  readonly name: ScopeRouteName
  /** 고른 날짜 (없으면 화면이 기본 날짜를 고른다) */
  readonly date?: string
  readonly rehearsal: boolean
  /** 자세히를 연 구매자 (지금의 구매자 ID) */
  readonly buyer?: string
  /** 합치기 창의 상대 구매자 ID (구매자 화면) */
  readonly merge?: string
  /** 합치기 창의 남는 쪽 구매자 ID */
  readonly into?: string
  /** 합치기 막힘에서 연 상품 자세히 (상품 키 `<방송>/<번호>`) */
  readonly product?: string
  /** 구매자 화면의 "모든 손님" 보기 (CRM1 D-CRM1-06) — 날짜별 보기는 적지 않는다 */
  readonly view?: 'customers'
  /** "모든 손님"에서 연 손님 (서버가 만든 불투명 손님 ID — 전화번호·표지가 아니다) */
  readonly customer?: string
  /** "모든 손님"의 정렬·거르기 (기본 total·all은 적지 않는다). 찾는 말은 주소에 넣지 않는다 */
  readonly sort?: string
  readonly filter?: string
}

const SCOPE_PARAMS = ['buyer', 'merge', 'into', 'product', 'customer', 'sort', 'filter'] as const

/** 요금 화면 (휴대폰 결제 창이 돌아오면 그 결제 ID) */
export interface BillingRoute {
  readonly name: 'billing'
  readonly paymentId?: string
}

/** 결제 ID 모양 (서버가 만든 영문·숫자 — 넉넉히 영문·숫자·'_'·'-' 1~64자) */
const PAYMENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export type SettingsSection = 'youtube' | 'instagram' | 'tiktok' | 'band' | 'parcel' | 'extension' | 'assist' | 'labels'

/** 입금 확인 화면의 목록 (N3) */
export const DEPOSIT_TABS = ['review', 'done', 'ignored', 'paste', 'sources'] as const
export type DepositTab = (typeof DEPOSIT_TABS)[number]

export interface DepositsRoute {
  readonly name: 'deposits'
  readonly tab: DepositTab
}

/** 포장 모드 (I2 AC-I2-35): 실제 범위만 — 리허설 표시가 없다 */
export interface PackingRoute {
  readonly name: 'packing'
  readonly date?: string
  /** 체크리스트를 연 구매자 (지금의 구매자 ID) */
  readonly buyer?: string
}

/** 택배 접수 (T1, D-T1-08): 실제 범위만 — 리허설 표시가 없다 */
export interface ParcelsRoute {
  readonly name: 'parcels'
  readonly date?: string
}

export interface SettingsRoute {
  readonly name: 'settings'
  /** 열자마자 보이게 할 칸 */
  readonly section?: SettingsSection
  /** 구글에서 돌아온 결과 코드 (`?youtube=`) */
  readonly youtubeResult?: string
  /** 인스타그램에서 돌아온 결과 코드 (`?instagram=` — 서버의 돌아오는 경로가 `/`여도 설정의 인스타그램 칸으로, N2b-2) */
  readonly instagramResult?: string
  /** 밴드에서 돌아온 결과 코드 (`/settings/band?band=` — BND1 AC-BND1-12·70) */
  readonly bandResult?: string
}

export interface StartRoute {
  readonly name: 'start'
  /** "시작 마법사 다시 하기": 상태와 상관없이 1단계부터 (주소에 적지 않는다) */
  readonly fresh?: boolean
  /** 마법사 3단계에서 구글로 갔다가 돌아온 결과 코드 (`?youtube=`) */
  readonly youtubeResult?: string
}

/** 확인 필요 목록 (SPEC §7 화면 15, D-O2-03): 메뉴에 없고 콘솔 알림 띠·홈 링크로 연다. 고른 방송은 `?broadcast=`, 리허설은 `?rehearsal=true` */
export interface ReviewsRoute {
  readonly name: 'reviews'
  readonly broadcast?: string
  readonly rehearsal: boolean
}

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'login' }
  | ReviewsRoute
  | { readonly name: 'console'; readonly id: string; /** 열 때 그 번호 상품 자세히를 연다 (정산 화면 [상품 보기], AC-V3-71) */ readonly product?: number }
  | { readonly name: 'receipts'; readonly id: string }
  | { readonly name: 'sms' }
  | { readonly name: 'labels' }
  | BillingRoute
  | ScopeRoute
  | PackingRoute
  | ParcelsRoute
  | SettingsRoute
  | StartRoute
  | { readonly name: 'privacy' }
  | { readonly name: 'terms' }
  | { readonly name: 'pricing' }
  | DepositsRoute

/** 로그인 없이 여는 화면 (AC-I3-77, LND1 D-LND1-01 — 로그인 화면 `/login`도, PAY2 공개 요금 안내 `/pricing`도) */
export const isPublicRoute = (route: Route): boolean => route.name === 'privacy' || route.name === 'terms' || route.name === 'pricing' || route.name === 'login'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function scopeRoute(name: ScopeRouteName, search: string): ScopeRoute {
  const params = new URLSearchParams(search)
  const date = params.get('date')
  const out: { -readonly [K in keyof ScopeRoute]: ScopeRoute[K] } = {
    name,
    ...(date !== null && DATE_RE.test(date) ? { date } : {}),
    rehearsal: params.get('rehearsal') === 'true',
  }
  for (const key of SCOPE_PARAMS) {
    const value = params.get(key)
    if (value !== null && value !== '') out[key] = value
  }
  if (name === 'buyers' && params.get('view') === 'customers') out.view = 'customers'
  return out
}

function packingRoute(search: string): PackingRoute {
  const params = new URLSearchParams(search)
  const date = params.get('date')
  const buyer = params.get('buyer')
  return {
    name: 'packing',
    ...(date !== null && DATE_RE.test(date) ? { date } : {}),
    ...(buyer !== null && buyer !== '' ? { buyer } : {}),
  }
}

export function parseRoute(pathname: string, search = ''): Route {
  const m = /^\/broadcasts\/([^/]+)\/?$/.exec(pathname)
  if (m?.[1] !== undefined) {
    try {
      const product = Number(new URLSearchParams(search).get('product'))
      return { name: 'console', id: decodeURIComponent(m[1]), ...(Number.isSafeInteger(product) && product >= 1 ? { product } : {}) }
    } catch {
      return { name: 'home' }
    }
  }
  const receipts = /^\/broadcasts\/([^/]+)\/receipts\/?$/.exec(pathname)
  if (receipts?.[1] !== undefined) {
    try {
      return { name: 'receipts', id: decodeURIComponent(receipts[1]) }
    } catch {
      return { name: 'home' }
    }
  }
  const path = pathname.replace(/\/+$/, '')
  const youtube = new URLSearchParams(search).get('youtube')
  const result = youtube !== null && youtube !== '' ? { youtubeResult: youtube } : {}
  const instagram = new URLSearchParams(search).get('instagram')
  // 인스타그램 연결을 마치고 돌아온 주소 (서버 LIVEJJIM_IG_RETURN_PATH — 기본 `/`): 설정의 인스타그램 칸에서 결과를 보인다
  if (instagram !== null && instagram !== '' && (path === '' || path === '/settings' || path === '/settings/instagram')) {
    return { name: 'settings', section: 'instagram', instagramResult: instagram }
  }
  if (path === '/settings') return { name: 'settings', ...result }
  if (path === '/settings/youtube') return { name: 'settings', section: 'youtube', ...result }
  if (path === '/settings/instagram') return { name: 'settings', section: 'instagram' }
  if (path === '/settings/tiktok') return { name: 'settings', section: 'tiktok' }
  if (path === '/settings/band') {
    const band = new URLSearchParams(search).get('band')
    return band !== null && band !== '' ? { name: 'settings', section: 'band', bandResult: band } : { name: 'settings', section: 'band' }
  }
  if (path === '/settings/parcel') return { name: 'settings', section: 'parcel' }
  if (path === '/settings/extension') return { name: 'settings', section: 'extension' }
  if (path === '/settings/assist') return { name: 'settings', section: 'assist' }
  if (path === '/settings/labels') return { name: 'settings', section: 'labels' }
  if (path === '/start') return { name: 'start', ...result }
  if (path === '/login') return { name: 'login' }
  if (path === '/privacy') return { name: 'privacy' }
  if (path === '/terms') return { name: 'terms' }
  if (path === '/pricing') return { name: 'pricing' }
  if (path === '/sms') return { name: 'sms' }
  if (path === '/labels') return { name: 'labels' }
  if (path === '/billing') {
    const paymentId = new URLSearchParams(search).get('paymentId')
    return paymentId !== null && PAYMENT_ID_RE.test(paymentId) ? { name: 'billing', paymentId } : { name: 'billing' }
  }
  if (path === '/deposits') {
    const tab = new URLSearchParams(search).get('tab')
    return { name: 'deposits', tab: (DEPOSIT_TABS as readonly string[]).includes(tab ?? '') ? (tab as DepositTab) : 'review' }
  }
  if (path === '/buyers') return scopeRoute('buyers', search)
  if (path === '/settlements') return scopeRoute('settlements', search)
  if (path === '/packing') return packingRoute(search)
  if (path === '/parcels') {
    const date = new URLSearchParams(search).get('date')
    return date !== null && DATE_RE.test(date) ? { name: 'parcels', date } : { name: 'parcels' }
  }
  if (path === '/reviews') {
    const params = new URLSearchParams(search)
    const broadcast = params.get('broadcast')
    return { name: 'reviews', ...(broadcast !== null && broadcast !== '' ? { broadcast } : {}), rehearsal: params.get('rehearsal') === 'true' }
  }
  return { name: 'home' }
}

export function routePath(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/'
    case 'login':
      return '/login'
    case 'console':
      return `/broadcasts/${encodeURIComponent(route.id)}${route.product === undefined ? '' : `?product=${String(route.product)}`}`
    case 'receipts':
      return `/broadcasts/${encodeURIComponent(route.id)}/receipts`
    case 'sms':
      return '/sms'
    case 'labels':
      return '/labels'
    case 'billing':
      return route.paymentId === undefined ? '/billing' : `/billing?paymentId=${encodeURIComponent(route.paymentId)}`
    case 'settings': {
      const base = route.section === undefined ? '/settings' : `/settings/${route.section}`
      if (route.instagramResult !== undefined) return `${base}?${new URLSearchParams({ instagram: route.instagramResult }).toString()}`
      if (route.bandResult !== undefined) return `${base}?${new URLSearchParams({ band: route.bandResult }).toString()}`
      return route.youtubeResult === undefined ? base : `${base}?${new URLSearchParams({ youtube: route.youtubeResult }).toString()}`
    }
    case 'start':
      return route.youtubeResult === undefined ? '/start' : `/start?${new URLSearchParams({ youtube: route.youtubeResult }).toString()}`
    case 'privacy':
      return '/privacy'
    case 'terms':
      return '/terms'
    case 'pricing':
      return '/pricing'
    case 'deposits':
      return route.tab === 'review' ? '/deposits' : `/deposits?tab=${route.tab}`
    case 'buyers':
    case 'settlements': {
      const params = new URLSearchParams()
      if (route.date !== undefined) params.set('date', route.date)
      if (route.rehearsal) params.set('rehearsal', 'true')
      if (route.view === 'customers') params.set('view', 'customers')
      for (const key of SCOPE_PARAMS) {
        const value = route[key]
        if (value !== undefined) params.set(key, value)
      }
      const query = params.toString()
      return query === '' ? `/${route.name}` : `/${route.name}?${query}`
    }
    case 'packing': {
      const params = new URLSearchParams()
      if (route.date !== undefined) params.set('date', route.date)
      if (route.buyer !== undefined) params.set('buyer', route.buyer)
      const query = params.toString()
      return query === '' ? '/packing' : `/packing?${query}`
    }
    case 'parcels':
      return route.date === undefined ? '/parcels' : `/parcels?${new URLSearchParams({ date: route.date }).toString()}`
    case 'reviews': {
      const params = new URLSearchParams()
      if (route.broadcast !== undefined) params.set('broadcast', route.broadcast)
      if (route.rehearsal) params.set('rehearsal', 'true')
      const query = params.toString()
      return query === '' ? '/reviews' : `/reviews?${query}`
    }
  }
}

/** 메뉴 항목 (AC-S06-01, AC-I1-20, AC-I3-44, I2 AC-I2-35, AC-N3-40, AC-N5-50): 지금 화면이 어느 메뉴에 속하는지 */
export type MenuKey = 'broadcasts' | 'sms' | 'buyers' | 'settlements' | 'deposits' | 'packing' | 'labels' | 'settings' | 'billing' | 'parcels'

/** 메뉴에 없는 화면(시작 마법사·정책 페이지·로그인 화면)은 null */
export function menuOf(route: Route): MenuKey | null {
  switch (route.name) {
    case 'home':
    case 'console':
    case 'reviews':
    case 'receipts':
      return 'broadcasts'
    case 'sms':
      return 'sms'
    case 'buyers':
      return 'buyers'
    case 'settlements':
      return 'settlements'
    case 'packing':
      return 'packing'
    case 'parcels':
      return 'parcels'
    case 'labels':
      return 'labels'
    case 'billing':
      return 'billing'
    case 'deposits':
      return 'deposits'
    case 'settings':
      return 'settings'
    case 'start':
    case 'login':
    case 'privacy':
    case 'terms':
    case 'pricing':
      return null
  }
}

export interface NavigateOptions {
  /** 기록을 남기지 않고 지금 주소를 바꾼다 (기본 날짜를 주소에 적을 때) */
  readonly replace?: boolean
  /**
   * 같은 화면 안에서 창을 여는 이동 (합치기 창의 상대 고르기·막힘에서 상품 자세히, AC-S06b-34): 기록을 남겨 뒤로 가기로 돌아오지만
   * 화면을 떠나는 것이 아니라 떠나기 확인을 묻지 않는다
   */
  readonly stay?: boolean
}

export type Navigate = (route: Route, options?: NavigateOptions) => void

/**
 * 브라우저 뒤로·앞으로 가기(popstate)를 막을지: 참이면 화면을 바꾸지 않는다(주소는 이미 바뀐 채 — 앱이 떠날지 묻고,
 * "닫기"면 보던 주소를 다시 적고, "보내지 않고 떠나기"면 그 주소로 바꾼다, AC-S06-01·D-083)
 */
export type PopBlocker = (next: Route) => boolean

const currentRoute = (): Route => parseRoute(window.location.pathname, window.location.search)

function stateRecord(): Record<string, unknown> {
  const state: unknown = window.history.state
  return typeof state === 'object' && state !== null && !Array.isArray(state) ? (state as Record<string, unknown>) : {}
}

/**
 * 앱 안 기록의 깊이: 처음 연 기록(홈 화면 앱으로 연 첫 화면·새 탭)은 0, 앱이 쌓은 기록마다 하나씩 (history.state에 적는다).
 * 0이면 앱 안에서 뒤로 갈 기록이 없다 — 뒤로 가기가 앱을 떠난다 (D-103).
 */
export function historyDepth(): number {
  const depth = stateRecord().livejjimDepth
  return typeof depth === 'number' && Number.isInteger(depth) && depth >= 0 ? depth : 0
}

/** 지금 기록이 떠나기 확인용으로 더 쌓은 같은 주소의 기록인가 */
export function isGuardEntry(): boolean {
  return stateRecord().livejjimGuard === true
}

/**
 * 처음 연 화면에 보내기 전인 조치가 있을 때 같은 주소의 기록을 하나 더 쌓는다 (AC-S06b-43, D-103):
 * 뒤로 가기가 앱을 떠나지 않고 이 기록을 빼며(popstate) 앱이 떠날지 묻는다.
 */
export function pushGuardEntry(): void {
  window.history.pushState({ livejjimDepth: historyDepth(), livejjimGuard: true }, '', `${window.location.pathname}${window.location.search}`)
}

export function useRoute(blocker?: PopBlocker): readonly [Route, Navigate] {
  const [route, setRoute] = useState<Route>(currentRoute)
  const block = useRef(blocker)
  block.current = blocker
  useEffect(() => {
    const onPop = () => {
      const next = currentRoute()
      if (block.current?.(next) === true) return
      setRoute(next)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback<Navigate>((next, options = {}) => {
    const path = routePath(next)
    if (`${window.location.pathname}${window.location.search}` !== path) {
      if (options.replace === true) window.history.replaceState(window.history.state, '', path)
      else window.history.pushState({ livejjimDepth: historyDepth() + 1 }, '', path)
    }
    setRoute(next)
  }, [])
  return [route, navigate] as const
}
