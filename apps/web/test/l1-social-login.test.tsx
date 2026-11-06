// L1 간편 로그인 화면 (AC-L1-20~23, D-L1-01·03·06): 로그인 화면 버튼·돌아온 결과 문장·설정 "로그인 방법" 칸.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import { PrivacyPage, SOCIAL_LOGIN_ITEM } from '../src/components/PolicyPages.tsx'
import { setTopLevelNavigation } from '../src/lib/google-return.ts'
import { linkedDate, methodsOf, parseLoginResult, providersOf, resultMessage, safeAuthorizeUrl, LOGIN_CODES, SETTINGS_CODES, type LoginProvider } from '../src/lib/social-login.ts'
import { FakeEventSource, FakeServer, apiError, flush, youtubeNotConfigured, type Reply } from './support.ts'

let server: FakeServer
let assigned: string[]
let loggedIn: boolean
let enabledProviders: LoginProvider[]
let links: Partial<Record<LoginProvider, { label: string; linkedAt: string; enabled?: boolean }>>

const AUTHORIZE = (p: string) => `http://127.0.0.1:4104/${p}/authorize?state=s1`

function methodsBody() {
  const providers = (['kakao', 'naver', 'google'] as const)
    .filter((p) => enabledProviders.includes(p) || links[p] !== undefined)
    .map((p) => ({ provider: p, enabled: enabledProviders.includes(p) && links[p]?.enabled !== false, linked: links[p] !== undefined, label: links[p]?.label ?? '', linkedAt: links[p]?.linkedAt ?? null }))
  return { loginId: 'shop1', providers }
}

function setup() {
  server
    .on('GET', /^\/api\/me$/, (): Reply => (loggedIn ? { body: { seller: { name: '구피 가게' }, loginId: 'shop1' } } : apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.')))
    .on('GET', /^\/api\/client-config$/, (): Reply => {
      if (!loggedIn) return enabledProviders.length === 0 ? apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.') : { body: { loginProviders: enabledProviders } }
      return { body: { hostActionDelayMs: 5000, ...(enabledProviders.length === 0 ? {} : { loginProviders: enabledProviders }) } }
    })
    .on('POST', /^\/api\/auth\/start$/, (call): Reply => (enabledProviders.includes(call.body?.provider as LoginProvider) ? { body: { authorizeUrl: AUTHORIZE(String(call.body?.provider)) } } : apiError(404, 'NOT_FOUND', '찾을 수 없어요.')))
    .on('POST', /^\/api\/auth\/link$/, (call): Reply => ({ body: { authorizeUrl: AUTHORIZE(String(call.body?.provider)) } }))
    .on('GET', /^\/api\/auth\/methods$/, (): Reply => {
      if (enabledProviders.length === 0) return apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
      return { body: methodsBody() }
    })
    .on('POST', /^\/api\/auth\/unlink$/, (call): Reply => {
      const p = call.body?.provider as LoginProvider
      if (links[p] === undefined) return apiError(404, 'NOT_FOUND', '찾을 수 없어요.')
      delete links[p]
      return { body: methodsBody() }
    })
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: DEFAULT_SETTINGS } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on('GET', /^\/api\/youtube\/connection$/, () => youtubeNotConfigured)
}

beforeEach(() => {
  server = new FakeServer()
  assigned = []
  loggedIn = false
  enabledProviders = ['kakao', 'naver', 'google']
  links = {}
  setTopLevelNavigation((url) => assigned.push(url))
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  setup()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  setTopLevelNavigation(null)
})

async function openLogin(path = '/login' /* LND1 D-LND1-01 */) {
  window.history.replaceState(null, '', path)
  render(<App />)
  await screen.findByRole('button', { name: '로그인' })
  await flush()
}

const socialButtons = () => screen.queryAllByRole('button').filter((button) => button.classList.contains('social-button'))

describe('결과 코드·문장 (lib)', () => {
  it('정해진 코드·공급자만 읽는다 — 모르는 값·HTML·긴 글은 null', () => {
    expect(parseLoginResult('/', '?login=NOT_LINKED&provider=kakao', 'login')).toEqual({ code: 'NOT_LINKED', provider: 'kakao' })
    expect(parseLoginResult('/settings', '?login=LINKED&provider=naver', 'settings')).toEqual({ code: 'LINKED', provider: 'naver' })
    expect(parseLoginResult('/', '?login=LINKED&provider=kakao', 'login')).toBeNull()
    expect(parseLoginResult('/settings', '?login=NOT_LINKED&provider=kakao', 'settings')).toBeNull()
    expect(parseLoginResult('/', '?login=%3Cscript%3Ealert(1)%3C%2Fscript%3E&provider=kakao', 'login')).toBeNull()
    expect(parseLoginResult('/', `?login=${'A'.repeat(5000)}&provider=kakao`, 'login')).toBeNull()
    // D-UX3-34: Apple이 공급자가 되어 모르는 값의 예를 line으로 바꾼다 (옛 기대: provider=apple → null)
    expect(parseLoginResult('/', '?login=CANCELLED&provider=line', 'login')).toBeNull()
    expect(parseLoginResult('/', '?login=CANCELLED&provider=apple', 'login')).toEqual({ code: 'CANCELLED', provider: 'apple' })
    expect(parseLoginResult('/', '?login=CANCELLED', 'login')).toBeNull()
    expect(parseLoginResult('/buyers', '?login=CANCELLED&provider=kakao', 'login')).toBeNull()
  })

  // D-UX3-29: 단추 이름이 "…로 로그인"이 되어 연결 문장도 '다음부터 "카카오로 로그인" 단추로 들어올 수 있어요.' (옛: '"카카오로 계속하기"로 로그인할 수 있어요.')
  it('문장: 공급자 이름·"로" 조사, 성공만 status', () => {
    for (const code of [...LOGIN_CODES, ...SETTINGS_CODES]) {
      const message = resultMessage({ code, provider: 'google' })
      expect(message.text).not.toMatch(/[A-Z_]{4,}|google/)
      expect(message.tone).toBe(code === 'LINKED' || code === 'SIGNUP' ? 'success' : 'error')
    }
    expect(resultMessage({ code: 'LINKED', provider: 'kakao' }).text).toBe('카카오 계정을 연결했어요. 다음부터 "카카오로 로그인" 단추로 들어올 수 있어요.')
    expect(resultMessage({ code: 'RATE_LIMITED', provider: 'naver' }).text).toBe('로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요.')
    expect(resultMessage({ code: 'PROVIDER_ERROR', provider: 'naver' }).text).toBe('네이버에서 로그인을 마치지 못했어요. 잠시 뒤에 다시 해 주세요.')
  })

  // D-UX3-34: 순서 끝에 Apple (옛 기대: apple은 모르는 값이라 버림)
  it('공급자 순서는 카카오·네이버·구글·Apple, 모르는 값은 버린다; 승인 주소는 http(s)만; 날짜는 KST "YYYY. M. D."', () => {
    expect(providersOf(['google', 'apple', 'line', 'kakao'])).toEqual(['kakao', 'google', 'apple'])
    expect(providersOf('kakao')).toEqual([])
    expect(safeAuthorizeUrl('javascript:alert(1)')).toBeNull()
    expect(safeAuthorizeUrl(42)).toBeNull()
    expect(safeAuthorizeUrl('https://kauth.kakao.com/oauth/authorize?x=1')).toBe('https://kauth.kakao.com/oauth/authorize?x=1')
    expect(linkedDate('2026-10-21T15:30:00.000Z')).toBe('2026. 10. 22.')
    expect(linkedDate(null)).toBe('')
    expect(methodsOf({ loginId: 'a', providers: [{ provider: 'google', enabled: true, linked: false, label: '', linkedAt: null }, { provider: 'x' }, { provider: 'kakao', enabled: true, linked: true, label: 'se***@gmail.com', linkedAt: '2026-10-22T00:00:00.000Z' }] }).providers.map((item) => item.provider)).toEqual(['kakao', 'google'])
  })
})

describe('로그인 화면 버튼 (AC-L1-20)', () => {
  it('로그인 칸 아래 "또는"과 카카오·네이버·구글 순 버튼, 아이디 칸에 커서, 가입 글 없음, 공식 로고 그림만 (D-UX3-28)', async () => {
    await openLogin()
    await screen.findByRole('button', { name: '카카오로 로그인' })
    expect(socialButtons().map((button) => button.textContent)).toEqual(['카카오로 로그인', '네이버로 로그인', '구글로 로그인'])
    expect(screen.getByRole('button', { name: '네이버로 로그인' })).toBeDefined()
    expect(screen.getByText('또는')).toBeDefined()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '아이디' }))
    expect(document.body.textContent).not.toMatch(/회원가입|가입/)
    // D-UX3-28: 단추마다 공식 로고 SVG 하나(글 읽기에서 숨김), 그 밖의 그림은 없다
    expect(document.querySelectorAll('img')).toHaveLength(0)
    expect(socialButtons().map((button) => button.querySelectorAll('svg[aria-hidden="true"]').length)).toEqual([1, 1, 1])
    // 순서: 로그인 버튼 → 카카오 → 네이버 → 구글 → 정책 링크 (문서 순서 = Tab 순서)
    const order = [screen.getByRole('button', { name: '로그인' }), ...socialButtons(), screen.getByRole('link', { name: '개인정보처리방침' })]
    for (let i = 1; i < order.length; i++) expect(order[i - 1]?.compareDocumentPosition(order[i] as Node) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(server.callsTo('GET', /^\/api\/client-config$/)[0]?.credentials).toBe('include')
  })

  it('켜진 공급자만 (구글 하나), 하나도 없으면 "또는"도 없고 로그인 풀림 문장도 없다', async () => {
    enabledProviders = ['google']
    await openLogin()
    await screen.findByRole('button', { name: '구글로 로그인' })
    expect(socialButtons()).toHaveLength(1)
    cleanup()
    enabledProviders = []
    await openLogin()
    await flush()
    expect(socialButtons()).toHaveLength(0)
    expect(screen.queryByText('또는')).toBeNull()
    expect(screen.queryByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeNull()
  })

  // 옛 기대: 누르면 셋이 잠긴다(disabled). 새 기대 D-UX3-29 (사용자 지시 2026-11-05 "하나 누르면 전체가 다 눌린 상태"): 누른 것만 바쁨 표시, 다른 단추는 흐려지지 않고 겹쳐 누르기는 무시
  it('누르면 그 단추만 바쁨 "카카오로 이동하는 중…", 서버가 준 승인 주소로 같은 탭 이동', async () => {
    let release: (() => void) | undefined
    server.on('POST', /^\/api\/auth\/start$/, async (call) => {
      await new Promise<void>((resolve) => (release = resolve))
      return { body: { authorizeUrl: AUTHORIZE(String(call.body?.provider)) } }
    })
    await openLogin()
    fireEvent.click(await screen.findByRole('button', { name: '카카오로 로그인' }))
    await screen.findByRole('button', { name: '카카오로 이동하는 중…' })
    expect(socialButtons().map((button) => button.getAttribute('aria-busy'))).toEqual(['true', 'false', 'false'])
    for (const button of socialButtons()) expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '네이버로 로그인' }))
    expect(server.callsTo('POST', /^\/api\/auth\/start$/)).toHaveLength(1)
    expect(server.callsTo('POST', /^\/api\/auth\/start$/)[0]?.body).toEqual({ provider: 'kakao' })
    release?.()
    await waitFor(() => expect(assigned).toEqual([AUTHORIZE('kakao')]))
  })

  it('시작이 실패하면 잠금이 풀리고 서버 문장, 서버에 닿지 못하면 정한 문장; 이상한 승인 주소로는 가지 않는다', async () => {
    server.on('POST', /^\/api\/auth\/start$/, () => apiError(429, 'LOGIN_RATE_LIMITED', '로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요.'))
    await openLogin()
    fireEvent.click(await screen.findByRole('button', { name: '네이버로 로그인' }))
    expect((await screen.findByRole('alert')).textContent).toBe('로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요.')
    for (const button of socialButtons()) expect((button as HTMLButtonElement).disabled).toBe(false)
    server.on('POST', /^\/api\/auth\/start$/, () => ({ network: true }))
    fireEvent.click(screen.getByRole('button', { name: '구글로 로그인' }))
    await screen.findByText('지금 연결하지 못했어요. 잠시 뒤에 다시 해 주세요.')
    server.on('POST', /^\/api\/auth\/start$/, () => ({ body: { authorizeUrl: 'javascript:alert(1)' } }))
    fireEvent.click(screen.getByRole('button', { name: '구글로 로그인' }))
    await flush()
    expect(assigned).toEqual([])
  })
})

describe('돌아온 결과 문장 (AC-L1-21)', () => {
  // 옛 기대 D-UX3-28: 가입 판(동의 체크 → [동의하고 시작하기]). 새 기대 D-UX3-29: 판 없이 돌아오자마자 한 번 가입 — 로그인 화면 단추 아래 안내 한 줄을 보고 누른 것이 동의
  it('D-UX3-29 처음 계정: `/?login=SIGNUP` → 판 없이 바로 POST /api/auth/signup {agree:true} 한 번, 그 공급자가 최근 로그인', async () => {
    window.localStorage.setItem('livejjim:last-login-pending', 'kakao')
    server.on('POST', /^\/api\/auth\/signup$/, (call): Reply => {
      loggedIn = true
      return call.body?.agree === true ? { body: { seller: { name: '내 가게' }, loginId: 'lg-abcdefgh', } } : apiError(400, 'INVALID_INPUT', '이용약관과 개인정보처리방침에 동의해 주세요.')
    })
    await openLogin('/?login=SIGNUP&provider=kakao')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: '동의하고 시작하기' })).toBeNull()
    await waitFor(() => expect(server.callsTo('POST', /^\/api\/auth\/signup$/)).toHaveLength(1))
    expect(server.callsTo('POST', /^\/api\/auth\/signup$/)[0]?.body).toEqual({ agree: true })
    await waitFor(() => expect(window.localStorage.getItem('livejjim:last-login')).toBe('kakao'))
    await flush()
    expect(server.callsTo('POST', /^\/api\/auth\/signup$/)).toHaveLength(1)
  })

  // D-UX3-30 (사용자 지시 2026-11-05 "같은 사람이면 하나의 계정으로"): 문자 인증이 켜진 서버면 가입이 PHONE_REQUIRED → 번호 확인
  it('D-UX3-30 있는 번호: 번호 확인 → "이미 가입한 계정이 있어요" → 그 계정의 네이버로 다녀오면 돌아와서 한 번 잇는다', async () => {
    server
      .on('POST', /^\/api\/auth\/signup$/, (): Reply => apiError(409, 'PHONE_REQUIRED', '휴대폰 번호를 먼저 확인해 주세요.'))
      .on('POST', /^\/api\/auth\/signup\/phone$/, (): Reply => ({ body: { phone: '010-****-6666' } }))
      .on('POST', /^\/api\/auth\/signup\/phone\/verify$/, (): Reply => ({ body: { next: 'LOGIN_EXISTING', phone: '010-****-6666', providers: ['naver'], accounts: [{ provider: 'naver', label: 'ab***@naver.com', lastLoginAt: '2026-11-05T15:30:00.000Z' }], password: false } }))
      .on('POST', /^\/api\/auth\/signup\/link$/, (): Reply => ({ body: { provider: 'kakao' } }))
    window.history.replaceState(null, '', '/?login=SIGNUP&provider=kakao')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '휴대폰 번호를 확인할게요' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('휴대폰 번호'), { target: { value: '010-5555-6666' } })
    fireEvent.click(screen.getByRole('button', { name: '인증번호 받기' }))
    expect(await screen.findByText('010-****-6666 번호로 인증번호를 보냈어요.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('인증번호 6자리'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    // D-UX3-59로 바뀐 기대 (사용자 지시 2026-11-07 "제목에는 "이미 가입한 적이 있어요" 그 아래에는 "해당 계정에 연결하고 로그인할게요" … 이미 존재하는 계정들 나열"):
    // 옛 — 제목 "이미 가입한 계정이 있어요"·"010-****-6666 번호로 가입한 계정이에요. 네이버로 로그인하면 카카오도 함께 이어져요."
    // 새 — 제목·설명이 바뀌고 있는 계정(공급자·가린 이메일·마지막 로그인 한국 날짜)을 보인다
    expect(await screen.findByRole('heading', { name: '이미 가입한 적이 있어요' })).toBeTruthy()
    expect(screen.getByText('해당 계정에 연결하고 로그인할게요')).toBeTruthy()
    const list = screen.getByTestId('existing-accounts')
    expect(list.textContent).toContain('네이버')
    expect(list.textContent).toContain('ab***@naver.com')
    expect(list.textContent).toContain('2026년 11월 06일 마지막 로그인')
    expect(socialButtons().map((button) => button.textContent)).toEqual(['네이버로 로그인'])
    fireEvent.click(screen.getByRole('button', { name: '네이버로 로그인' }))
    await waitFor(() => expect(assigned).toEqual([AUTHORIZE('naver')]))
    expect(window.sessionStorage.getItem('livejjim:pending-link')).toBe('1')
    // 네이버에서 로그인되어 돌아왔다
    cleanup()
    loggedIn = true
    window.history.replaceState(null, '', '/')
    render(<App />)
    await waitFor(() => expect(server.callsTo('POST', /^\/api\/auth\/signup\/link$/)).toHaveLength(1))
    expect(window.sessionStorage.getItem('livejjim:pending-link')).toBeNull()
    expect(server.callsTo('POST', /^\/api\/auth\/signup$/)).toHaveLength(1)
  })

  it('D-UX3-28 최근 로그인: 마지막으로 로그인한 공급자 단추에만 "최근 로그인"', async () => {
    window.localStorage.setItem('livejjim:last-login', 'naver')
    await openLogin()
    await screen.findByRole('button', { name: /네이버로 로그인/ })
    expect(socialButtons().map((button) => button.textContent)).toEqual(['카카오로 로그인', '네이버로 로그인최근 로그인', '구글로 로그인'])
  })

  it('로그인 화면: NOT_LINKED 문장을 alert로 한 번, 주소에서 지운다, 아이디 칸 커서', async () => {
    await openLogin('/?login=NOT_LINKED&provider=kakao')
    expect(screen.getByRole('alert').textContent).toBe('이 카카오 계정에 연결된 라이브지니 계정이 없어요. 아이디로 로그인한 뒤 설정 → 로그인 방법에서 카카오 계정을 연결해 주세요.')
    expect(window.location.search).toBe('')
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '아이디' }))
    cleanup()
    // LND1 D-LND1-01: 새로고침한 `/`는 소개 화면이라 지운 주소를 로그인 화면(`/login`)에서 다시 연다
    await openLogin(`/login${window.location.search}`)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('SESSION_GONE·CANCELLED·EXPIRED도 정한 문장, 모르는 코드·스크립트·긴 글은 아무 문장 없이 지운다', async () => {
    await openLogin('/?login=SESSION_GONE&provider=google')
    expect(screen.getByRole('alert').textContent).toBe('로그인이 풀려 연결하지 못했어요. 다시 로그인한 뒤 연결해 주세요.')
    cleanup()
    await openLogin('/?login=CANCELLED&provider=naver')
    expect(screen.getByRole('alert').textContent).toBe('네이버 로그인을 취소했어요. 다시 하려면 버튼을 눌러 주세요.')
    for (const bad of ['%3Cscript%3Ealert(1)%3C%2Fscript%3E', 'LINKED', `X${'가'.repeat(3000)}`]) {
      cleanup()
      await openLogin(`/?login=${bad}&provider=kakao`)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(document.body.innerHTML).not.toContain('script')
      expect(document.body.textContent).not.toContain('가가가')
      expect(window.location.search).toBe('')
    }
  })
})

describe('로그인된 채 홈으로 돌아온 결과 (TE-L1-001)', () => {
  async function openHome(path: string) {
    loggedIn = true
    window.history.replaceState(null, '', path)
    render(<App />)
    // MOB1 D-MOB1-05: 휴대폰 폭(jsdom)은 위 줄에 "로그아웃"이 없다 — 로그인됨은 메뉴로 기다린다
    await screen.findByRole('navigation', { name: '메뉴' })
    await flush()
  }

  it('SESSION_GONE·RATE_LIMITED는 위 알림으로 같은 문장, 주소에서 지운다, [닫기]로 사라진다', async () => {
    await openHome('/?login=SESSION_GONE&provider=kakao')
    expect((await screen.findByRole('alert')).textContent).toBe('로그인이 풀려 연결하지 못했어요. 다시 로그인한 뒤 연결해 주세요.')
    expect(window.location.search).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    await openHome('/?login=RATE_LIMITED&provider=naver')
    expect((await screen.findByRole('alert')).textContent).toBe('로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요.')
    expect(window.location.search).toBe('')
  })

  it('그 밖의 코드·모르는 값은 로그인된 채면 문장 없이 지운다', async () => {
    for (const code of ['NOT_LINKED', 'CANCELLED', 'LINKED', '%3Cscript%3E']) {
      cleanup()
      await openHome(`/?login=${code}&provider=kakao`)
      expect(screen.queryByText(/연결된 라이브지니 계정이 없어요|취소했어요|연결했어요/)).toBeNull()
      expect(document.body.innerHTML).not.toContain('<script')
      expect(window.location.search).toBe('')
    }
  })
})

describe('설정 "로그인 방법" (AC-L1-22·23)', () => {
  async function openSettings(path = '/settings') {
    loggedIn = true
    window.history.replaceState(null, '', path)
    render(<App />)
    await screen.findByRole('heading', { name: '설정', level: 1 })
    await flush()
  }
  const methods = () => screen.getByRole('region', { name: '로그인 방법' })

  it('아이디 로그인 줄(끄는 버튼 없음)과 카카오·네이버·구글 줄 — 연결됨은 가린 이름(없으면 "카카오 계정")·날짜, 꺼진 공급자의 남은 연결은 "지금은 쓸 수 없어요"', async () => {
    enabledProviders = ['kakao', 'naver']
    links = { kakao: { label: '', linkedAt: '2026-10-22T01:00:00.000Z' }, google: { label: 'se***@gmail.com', linkedAt: '2026-10-20T01:00:00.000Z' } }
    await openSettings()
    const region = await screen.findByRole('region', { name: '로그인 방법' })
    const rows = within(region).getAllByRole('listitem')
    expect(rows.map((row) => row.querySelector('p')?.textContent)).toEqual(['아이디 로그인 · 아이디 shop1 · 늘 켜져 있어요', '카카오 · 카카오 계정 · 2026. 10. 22.', '네이버 · 연결 안 됨', '구글 · se***@gmail.com · 지금은 쓸 수 없어요'])
    expect(within(rows[0] as HTMLElement).queryByRole('button')).toBeNull()
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: '카카오 연결 끊기' })).toBeDefined()
    expect(within(rows[2] as HTMLElement).getByRole('button', { name: '네이버 연결하기' }).textContent).toBe('연결하기')
    expect(within(rows[3] as HTMLElement).getAllByRole('button').map((button) => button.textContent)).toEqual(['연결 끊기'])
  })

  it('[연결하기]: 잠기고 "카카오로 이동하는 중…", 승인 주소로 이동', async () => {
    await openSettings()
    fireEvent.click(within(await screen.findByRole('region', { name: '로그인 방법' })).getByRole('button', { name: '카카오 연결하기' }))
    await within(methods()).findByRole('button', { name: '카카오로 이동하는 중…' })
    await waitFor(() => expect(assigned).toEqual([AUTHORIZE('kakao')]))
    expect(server.callsTo('POST', /^\/api\/auth\/link$/)[0]?.body).toEqual({ provider: 'kakao' })
  })

  it('돌아온 LINKED는 status, LINKED_ELSEWHERE는 alert — 주소에서 지운다, 모르는 코드는 문장 없음', async () => {
    links = { naver: { label: 'ab***@naver.com', linkedAt: '2026-10-22T01:00:00.000Z' } }
    await openSettings('/settings?login=LINKED&provider=naver')
    const region = await screen.findByRole('region', { name: '로그인 방법' })
    expect(within(region).getByRole('status').textContent).toBe('네이버 계정을 연결했어요. 다음부터 "네이버로 로그인" 단추로 들어올 수 있어요.')
    expect(window.location.search).toBe('')
    cleanup()
    await openSettings('/settings?login=LINKED_ELSEWHERE&provider=google')
    expect(within(await screen.findByRole('region', { name: '로그인 방법' })).getByRole('alert').textContent).toBe('이 구글 계정은 이미 다른 라이브지니 계정에 연결돼 있어요. 다른 구글 계정으로 해 주세요.')
    cleanup()
    await openSettings('/settings?login=NOT_LINKED&provider=google')
    expect(within(await screen.findByRole('region', { name: '로그인 방법' })).queryByRole('alert')).toBeNull()
    expect(window.location.search).toBe('')
  })

  it('[연결 끊기]: 확인 창(기본 포커스 그만두기, Esc = 그만두기) → 끊으면 문장과 새 목록, 로그인된 채', async () => {
    links = { kakao: { label: 'se***@gmail.com', linkedAt: '2026-10-22T01:00:00.000Z' } }
    await openSettings()
    const region = await screen.findByRole('region', { name: '로그인 방법' })
    fireEvent.click(within(region).getByRole('button', { name: '카카오 연결 끊기' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('카카오 연결을 끊을까요? 끊으면 카카오로 로그인할 수 없고, 카카오로 로그인해 둔 다른 기기는 로그아웃돼요. 아이디 로그인은 그대로예요.')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '그만두기' }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(server.callsTo('POST', /^\/api\/auth\/unlink$/)).toHaveLength(0)
    fireEvent.click(within(region).getByRole('button', { name: '카카오 연결 끊기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '연결 끊기' }))
    expect((await within(region).findByRole('status')).textContent).toBe('카카오 연결을 끊었어요.')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(region).getByRole('button', { name: '카카오 연결하기' })).toBeDefined()
    expect(screen.getByRole('heading', { name: '설정', level: 1 })).toBeDefined()
  })

  it('끊기 409는 창 안에 서버 문장', async () => {
    links = { kakao: { label: '', linkedAt: '2026-10-22T01:00:00.000Z' } }
    server.on('POST', /^\/api\/auth\/unlink$/, () => apiError(409, 'LOGIN_METHOD_LAST', '마지막 로그인 방법은 끊을 수 없어요.'))
    await openSettings()
    fireEvent.click(within(await screen.findByRole('region', { name: '로그인 방법' })).getByRole('button', { name: '카카오 연결 끊기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '연결 끊기' }))
    expect(await within(screen.getByRole('dialog')).findByText('마지막 로그인 방법은 끊을 수 없어요.')).toBeDefined()
  })

  it('실시간 알림 login {kind:"methods"}이면 목록을 다시 읽는다', async () => {
    await openSettings()
    await screen.findByRole('region', { name: '로그인 방법' })
    const before = server.callsTo('GET', /^\/api\/auth\/methods$/).length
    links = { google: { label: 'x***@gmail.com', linkedAt: '2026-10-22T01:00:00.000Z' } }
    const stream = FakeEventSource.last
    act(() => stream.emit('ready', { scopes: [] }))
    act(() => stream.emit('login', { kind: 'methods' }))
    await waitFor(() => expect(server.callsTo('GET', /^\/api\/auth\/methods$/).length).toBe(before + 1))
    await waitFor(() => expect(within(methods()).getByRole('button', { name: '구글 연결 끊기' })).toBeDefined())
  })

  it('간편 로그인이 꺼진 서버(목록 404)면 칸이 없다', async () => {
    enabledProviders = []
    await openSettings()
    await flush()
    expect(screen.queryByRole('region', { name: '로그인 방법' })).toBeNull()
  })

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 시험 "보조자: 설정에 칸이 없고 목록을 부르지 않는다"를 뺐다
})

it('개인정보처리방침 초안에 간편 로그인 연결 정보 (AC-L1-13)', () => {
  render(<PrivacyPage />)
  expect(screen.getByText(SOCIAL_LOGIN_ITEM)).toBeDefined()
  expect(SOCIAL_LOGIN_ITEM).toBe('간편 로그인을 연결하면: 공급자 계정 번호, 가린 이메일(예: se***@gmail.com)')
})
