// LND1 공개 소개 화면 (AC-LND1-01~03·05~08·10·90, D-LND1-01~05·08): 경로 읽기, 소개를 보일지 판단, 운영 사업자 줄, 화면 흐름.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import { LandingPage } from '../src/components/LandingPage.tsx'
import { LANDING_DAY_STEPS, LANDING_ENGLISH, LANDING_GOOGLE_ITEMS, LANDING_TAGLINE, operatorLines, shouldShowLanding, USER_DATA_POLICY_URL, type LandingInput } from '../src/lib/landing.ts'
import { isPublicRoute, menuOf, parseRoute, routePath } from '../src/lib/router.ts'
import { OPERATOR, type Operator } from '../src/operator.ts'
import { FakeEventSource, FakeServer, apiError, flush } from './support.ts'

afterEach(() => {
  cleanup()
})

const TAGLINE = '유튜브·인스타그램·틱톡 라이브 판매의 찜을 자동으로 받아 선착순을 정하고, 라벨 출력과 정산까지 도와드려요.'
const DAY = [
  '방송 전: 오늘 팔 상품의 번호·이름·가격을 적어요. 말로 불러도 돼요.',
  '방송 중: 손님이 채팅에 상품 번호를 쓰면 찜으로 받아 먼저 쓴 순서대로 정해요.',
  '찜이 정해지면: 상품 라벨이 바로 출력돼요.',
  '방송 뒤: 손님마다 합계·배송비를 정산하고 입금을 확인해요.',
  '포장: 손님별 목록을 보며 담고 포장 라벨을 붙여요.',
]
const GOOGLE = [
  '유튜브를 연결하면 판매자 본인 채널의 이름, 본인 라이브 방송 목록, 고른 방송의 채팅 글을 읽어요. 채팅에서 주문을 찾는 데만 써요.',
  '판매자가 설정에서 감사 메시지 자동 게시를 켜고 동의했을 때만 본인 방송 채팅이나 본인 영상 댓글에 짧은 감사 글을 올려요.',
  '구글로 로그인하면 구글 계정 번호와 가린 이메일만 저장해요.',
  '채팅 글과 시청자 이름은 방송 날짜부터 30일 뒤에 지워요. 구글 사용자 데이터를 팔거나 광고에 쓰지 않아요.',
  '설정의 유튜브 칸에서 언제든 연결을 끊을 수 있어요.',
]
const LIMITED_USE = '라이브지니가 구글 API에서 받은 정보를 쓰고 다른 앱으로 옮길 때는 구글 API 서비스 사용자 데이터 정책(제한적 사용 요건 포함)을 따릅니다.'

describe('경로 (AC-LND1-90)', () => {
  it('/login ↔ 로그인 화면, 메뉴에 없고 로그인 없이 여는 화면', () => {
    expect(parseRoute('/login')).toEqual({ name: 'login' })
    expect(parseRoute('/login/')).toEqual({ name: 'login' })
    expect(routePath({ name: 'login' })).toBe('/login')
    expect(parseRoute(routePath({ name: 'login' }))).toEqual({ name: 'login' })
    expect(menuOf({ name: 'login' })).toBeNull()
    expect(isPublicRoute({ name: 'login' })).toBe(true)
    // 다른 주소는 그대로
    expect(parseRoute('/')).toEqual({ name: 'home' })
    expect(isPublicRoute({ name: 'home' })).toBe(false)
  })
})

describe('소개를 보일지 (AC-LND1-90, D-LND1-02)', () => {
  const base: LandingInput = { signedOut: true, route: { name: 'home' }, loginParam: false, leftInTab: false, standalone: false }
  it('로그아웃 상태·`/`·결과 값 없음·로그아웃/풀림 뒤 아님·홈 화면 앱 아님일 때만 참', () => {
    expect(shouldShowLanding(base)).toBe(true)
    expect(shouldShowLanding({ ...base, signedOut: false })).toBe(false)
    expect(shouldShowLanding({ ...base, route: { name: 'settings' } })).toBe(false)
    expect(shouldShowLanding({ ...base, route: { name: 'login' } })).toBe(false)
    expect(shouldShowLanding({ ...base, loginParam: true })).toBe(false)
    expect(shouldShowLanding({ ...base, leftInTab: true })).toBe(false)
    expect(shouldShowLanding({ ...base, standalone: true })).toBe(false)
  })
})

describe('운영 사업자 줄 (AC-LND1-10, D-LND1-04)', () => {
  const blank: Operator = { name: '틈(TEUM)', representative: '', businessNumber: '', mailOrderNumber: '', address: '', email: '' }
  const NOT_READY = /\[확인 필요\]|\[미정\]|\[검토 필요\]|확인 필요/

  it('지금 상수는 상호만 정해져 있다', () => {
    expect(OPERATOR).toEqual(blank)
    expect(operatorLines(OPERATOR)).toEqual(['상호: 틈(TEUM)'])
  })

  it('빈 값: "상호: 틈(TEUM)" 한 줄, "계정 문의:" 없음, 자리표시 없음', () => {
    render(<LandingPage operator={blank} onLogin={() => {}} />)
    const section = screen.getByRole('region', { name: '운영 사업자' })
    expect(within(section).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['상호: 틈(TEUM)'])
    expect(document.body.textContent).not.toContain('계정 문의:')
    expect(document.body.textContent).not.toMatch(NOT_READY)
  })

  it('값을 넣은 항목만 더 나온다 (이메일은 계정 문의에도, mailto 링크)', () => {
    const filled: Operator = { ...blank, businessNumber: '000-00-00000', email: 'help@example.com' }
    expect(operatorLines(filled)).toEqual(['상호: 틈(TEUM)', '사업자등록번호: 000-00-00000', '문의 이메일: help@example.com'])
    expect(operatorLines({ ...blank, representative: '홍길동', mailOrderNumber: '2026-서울-0000', address: '서울' })).toEqual(['상호: 틈(TEUM)', '대표자: 홍길동', '통신판매업 신고번호: 2026-서울-0000', '주소: 서울'])
    render(<LandingPage operator={filled} onLogin={() => {}} />)
    const section = screen.getByRole('region', { name: '운영 사업자' })
    expect(within(section).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['상호: 틈(TEUM)', '사업자등록번호: 000-00-00000', '문의 이메일: help@example.com'])
    const start = screen.getByRole('region', { name: '시작하려면' })
    expect(within(start).getByText((_, element) => element?.tagName === 'P' && element.textContent === '계정 문의: help@example.com')).toBeDefined()
    expect(within(start).getByRole('link', { name: 'help@example.com' }).getAttribute('href')).toBe('mailto:help@example.com')
    expect(document.body.textContent).not.toMatch(NOT_READY)
  })
})

describe('소개 화면 문장 (AC-LND1-01·09·13)', () => {
  it('상수가 확정 문장 그대로다', () => {
    expect(LANDING_TAGLINE).toBe(TAGLINE)
    expect(LANDING_DAY_STEPS).toEqual(DAY)
    expect(LANDING_GOOGLE_ITEMS).toEqual(GOOGLE)
    expect(USER_DATA_POLICY_URL).toBe('https://developers.google.com/terms/api-services-user-data-policy')
    expect(LANDING_ENGLISH.startsWith('LiveGenie uses Google user data only to provide its features.')).toBe(true)
    expect(LANDING_ENGLISH.endsWith('including the Limited Use requirements.')).toBe(true)
  })

  it('제목·한 줄 소개·버튼 둘·절·목록 순서·제한적 사용 링크·영문 단락·정책 링크, 그림·입력 칸 없음', () => {
    render(<LandingPage onLogin={() => {}} />)
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['라이브지니'])
    expect(screen.getByText(TAGLINE)).toBeDefined()
    expect(screen.getByRole('link', { name: '로그인' }).getAttribute('href')).toBe('/login')
    expect(screen.getByRole('link', { name: '시작하기' })).toBeDefined()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['판매자의 하루', '시작하려면', '구글 사용자 데이터를 쓰는 곳', '운영 사업자'])
    const day = screen.getByRole('region', { name: '판매자의 하루' })
    expect(day.querySelector('ol')).not.toBeNull()
    expect(within(day).getAllByRole('listitem').map((item) => item.textContent)).toEqual(DAY)
    expect(screen.getByText('라이브지니 계정은 운영자가 만들어 드려요. 받은 아이디로 로그인해 주세요.')).toBeDefined()
    const google = screen.getByRole('region', { name: '구글 사용자 데이터를 쓰는 곳' })
    expect(google.querySelector('ul')).not.toBeNull()
    expect(within(google).getAllByRole('listitem').map((item) => item.textContent)).toEqual(GOOGLE)
    const policy = within(google).getByRole('link', { name: '구글 API 서비스 사용자 데이터 정책' })
    expect(policy.getAttribute('href')).toBe('https://developers.google.com/terms/api-services-user-data-policy')
    expect(policy.getAttribute('rel')?.split(' ').sort()).toEqual(['noopener', 'noreferrer'])
    expect(policy.getAttribute('target')).toBeNull()
    expect(policy.parentElement?.textContent).toBe(LIMITED_USE)
    const english = document.querySelectorAll('[lang="en"]')
    expect(english).toHaveLength(1)
    expect(english[0]?.textContent?.trim()).toBe(LANDING_ENGLISH)
    expect(screen.getByRole('link', { name: '개인정보처리방침' }).getAttribute('href')).toBe('/privacy')
    expect(screen.getByRole('link', { name: '이용약관' }).getAttribute('href')).toBe('/terms')
    expect(document.querySelectorAll('img, svg, input')).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/다른 곳에 넘기지 않아요|제3자/)
  })

  it('영문 단락 밖의 글에 영어 낱말이 없다 (예외: "API", "TEUM")', () => {
    const { container } = render(<LandingPage onLogin={() => {}} />)
    const copy = container.cloneNode(true) as HTMLElement
    for (const element of copy.querySelectorAll('[lang="en"]')) element.remove()
    const words = (copy.textContent ?? '').match(/[A-Za-z_][A-Za-z0-9_.-]*/g) ?? []
    expect(words.filter((word) => word !== 'API' && word !== 'TEUM')).toEqual([])
  })

  it('"시작하기"는 주소를 바꾸지 않고 "시작하려면" 제목으로 움직인다', () => {
    window.history.replaceState(null, '', '/')
    render(<LandingPage onLogin={() => {}} />)
    const heading = screen.getByRole('heading', { name: '시작하려면' })
    const scrolled = vi.fn()
    heading.scrollIntoView = scrolled
    fireEvent.click(screen.getByRole('link', { name: '시작하기' }))
    expect(scrolled).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(heading)
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/')
  })
})

describe('앱 흐름 (AC-LND1-01~03·05~08, D-LND1-01·02·08)', () => {
  let server: FakeServer
  let signedIn: boolean
  const me = { seller: { name: '구피 가게' }, loginId: 'shop1' }

  beforeEach(() => {
    server = new FakeServer()
    signedIn = false
    server.on('GET', /^\/api\/me$/, () => (signedIn ? { body: me } : apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.')))
    server.on('POST', /^\/api\/login$/, () => {
      signedIn = true
      return { body: me }
    })
    server.on('POST', /^\/api\/logout$/, () => {
      signedIn = false
      return { body: { ok: true } }
    })
    server.on('GET', /^\/api\/broadcasts$/, () => (signedIn ? { body: { broadcasts: [] } } : apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.')))
    vi.stubGlobal('fetch', server.fetch)
    vi.stubGlobal('EventSource', FakeEventSource)
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    onUnauthorized(null)
    FakeEventSource.reset()
  })

  const path = () => `${window.location.pathname}${window.location.search}`

  it('로그아웃 상태 `/`: 소개 화면, 로그인 칸·메뉴·로그아웃 없음, 서버 요청은 로그인 확인 하나', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: '판매자의 하루' })).toBeDefined()
    await act(async () => {
      await flush()
    })
    expect(path()).toBe('/')
    expect(screen.queryByLabelText('아이디')).toBeNull()
    expect(screen.queryByLabelText('비밀번호')).toBeNull()
    expect(screen.queryByRole('navigation', { name: '메뉴' })).toBeNull()
    expect(screen.queryByText('로그아웃')).toBeNull()
    expect(new Set(server.calls.map((call) => `${call.method} ${call.path}`))).toEqual(new Set(['GET /api/me']))
  })

  it('"로그인" → `/login` 로그인 화면(아이디 칸 커서), 뒤로 가기 → 소개; 로그인하면 `/` 방송 목록으로 바꿔 간다', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: '로그인' }))
    expect(path()).toBe('/login')
    const id = await screen.findByRole('textbox', { name: '아이디' })
    expect(document.activeElement).toBe(id)
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await waitFor(() => expect(path()).toBe('/'))
    expect(await screen.findByRole('heading', { name: '판매자의 하루' })).toBeDefined()
    await act(async () => {
      window.history.forward()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await waitFor(() => expect(path()).toBe('/login'))
    fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'shop1' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pass-word-1' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { name: '방송 목록' })).toBeDefined()
    expect(path()).toBe('/')
    // 기록을 바꿔 갔다: 지금 기록도 `/`, 뒤로 가면 처음 연 `/`
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    await waitFor(() => expect(path()).toBe('/'))
    expect(screen.queryByLabelText('아이디')).toBeNull()
    expect(screen.getByRole('heading', { name: '방송 목록' })).toBeDefined()
  })

  it('로그인한 사람: `/`는 방송 목록, `/login`은 `/`로 바꿔 간다', async () => {
    signedIn = true
    window.history.replaceState(null, '', '/login')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '방송 목록' })).toBeDefined()
    expect(path()).toBe('/')
    expect(screen.queryByLabelText('아이디')).toBeNull()
    expect(screen.queryByText('판매자의 하루')).toBeNull()
  })

  it('`/?login=NOT_LINKED&provider=google`: 소개가 아니라 로그인 화면과 결과 문장, 주소는 `/`로 지운다', async () => {
    window.history.replaceState(null, '', '/?login=NOT_LINKED&provider=google')
    render(<App />)
    expect(await screen.findByRole('textbox', { name: '아이디' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('구글 계정에 연결된')
    expect(screen.queryByText('판매자의 하루')).toBeNull()
    await waitFor(() => expect(path()).toBe('/'))
    // 지워진 뒤에도 로그인 칸 그대로 — 바로 로그인할 수 있다
    expect(screen.getByRole('textbox', { name: '아이디' })).toBeDefined()
  })

  it('로그아웃하면 소개가 아니라 로그인 화면 (새로고침 전까지)', async () => {
    signedIn = true
    render(<App />)
    expect(await screen.findByRole('heading', { name: '방송 목록' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '더보기' }))
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('textbox', { name: '아이디' })).toBeDefined()
    expect(path()).toBe('/')
    expect(screen.queryByText('판매자의 하루')).toBeNull()
    // 새로고침(앱을 새로 그림) → 소개 화면
    cleanup()
    render(<App />)
    expect(await screen.findByRole('heading', { name: '판매자의 하루' })).toBeDefined()
  })

  it('쓰는 중 로그인이 풀리면 소개가 아니라 로그인 화면과 "로그인이 풀렸어요"', async () => {
    // 로그인 확인은 통과하고 방송 목록을 부를 때 세션이 서버에서 끝나 있다
    signedIn = true
    server.on('GET', /^\/api\/broadcasts$/, () => apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.'))
    render(<App />)
    expect(await screen.findByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeDefined()
    expect(screen.getByRole('textbox', { name: '아이디' })).toBeDefined()
    expect(screen.queryByText('판매자의 하루')).toBeNull()
  })

  it('홈 화면 앱(display-mode: standalone · navigator.standalone): `/`에서 바로 로그인 화면', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    render(<App />)
    expect(await screen.findByRole('textbox', { name: '아이디' })).toBeDefined()
    expect(path()).toBe('/')
    expect(screen.queryByText('판매자의 하루')).toBeNull()
    cleanup()
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', server.fetch)
    vi.stubGlobal('EventSource', FakeEventSource)
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    try {
      render(<App />)
      expect(await screen.findByRole('textbox', { name: '아이디' })).toBeDefined()
      expect(screen.queryByText('판매자의 하루')).toBeNull()
    } finally {
      Reflect.deleteProperty(navigator, 'standalone')
    }
  })

  it('다른 앱 주소(`/settings`)는 지금처럼 그 자리에 로그인 화면', async () => {
    window.history.replaceState(null, '', '/settings')
    render(<App />)
    expect(await screen.findByRole('textbox', { name: '아이디' })).toBeDefined()
    expect(path()).toBe('/settings')
  })

  it('정책 페이지의 "로그인 화면으로"는 `/login`', async () => {
    for (const page of ['/privacy', '/terms']) {
      window.history.replaceState(null, '', page)
      render(<App />)
      const back = await screen.findByRole('link', { name: '로그인 화면으로' })
      expect(back.getAttribute('href')).toBe('/login')
      fireEvent.click(back)
      expect(path()).toBe('/login')
      expect(await screen.findByRole('textbox', { name: '아이디' })).toBeDefined()
      cleanup()
    }
  })
})
