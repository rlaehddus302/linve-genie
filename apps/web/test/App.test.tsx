// 로그인·방송 목록 (AC-S05-01·02·70·72). S00의 "준비 중이에요." 첫 화면을 S05 화면이 바꾼다(교체 — dev-notes).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import { sortBroadcasts } from '../src/components/HomePage.tsx'
import { FakeEventSource, FakeServer, apiError, broadcastItem } from './support.ts'

let server: FakeServer

beforeEach(() => {
  server = new FakeServer()
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

const loggedOut = () => {
  // LND1 D-LND1-01: 로그아웃 상태의 로그인 화면은 `/login` (`/`는 소개 화면)
  window.history.replaceState(null, '', '/login')
  return server.on('GET', /^\/api\/me$/, () => apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.'))
}
const me = { seller: { name: '구피 가게' }, loginId: 'shop1' }

function visibleLatin(container: HTMLElement): string[] {
  const found: string[] = []
  const text = container.textContent ?? ''
  if (/[A-Za-z]/.test(text)) found.push(text)
  for (const element of container.querySelectorAll('*')) {
    for (const name of ['aria-label', 'title', 'alt', 'placeholder']) {
      const value = element.getAttribute(name) ?? ''
      if (/[A-Za-z]/.test(value)) found.push(`${name}=${value}`)
    }
  }
  return found
}

describe('로그인 화면 (AC-S05-01)', () => {
  it('로그인하지 않았으면 아이디·비밀번호 칸과 "로그인" 버튼이 보이고 가입 화면·링크는 없다 (링크는 정책 초안 둘뿐 — AC-I3-77)', async () => {
    loggedOut()
    render(<App />)
    expect(await screen.findByRole('button', { name: '로그인' })).toBeDefined()
    expect(screen.getByLabelText('아이디')).toBeDefined()
    const password = screen.getByLabelText('비밀번호') as HTMLInputElement
    expect(password.type).toBe('password')
    expect(screen.queryByText(/가입/)).toBeNull()
    const links = screen.queryAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])
    expect(links).toEqual([
      ['개인정보처리방침', '/privacy'],
      ['이용약관', '/terms'],
    ])
  })

  it('틀리면 서버 문장을 그대로 보이고 아이디는 남는다', async () => {
    loggedOut()
    server.on('POST', /^\/api\/login$/, () => apiError(401, 'LOGIN_FAILED', '아이디나 비밀번호가 맞지 않아요.'))
    render(<App />)
    fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'shop1' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByText('아이디나 비밀번호가 맞지 않아요.')).toBeDefined()
    expect((screen.getByLabelText('아이디') as HTMLInputElement).value).toBe('shop1')
    // 로그인 실패(LOGIN_FAILED)는 세션 만료가 아니다
    expect(screen.queryByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeNull()
  })

  it('잠기면 서버의 잠금 문장을 그대로 보인다', async () => {
    loggedOut()
    server.on('POST', /^\/api\/login$/, () => apiError(429, 'LOGIN_LOCKED', '로그인을 여러 번 틀려서 잠시 막아 두었어요. 15분 뒤에 다시 해 주세요.'))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '로그인' }))
    expect(await screen.findByText('로그인을 여러 번 틀려서 잠시 막아 두었어요. 15분 뒤에 다시 해 주세요.')).toBeDefined()
  })

  it('맞게 로그인하면 홈(방송 목록)에 가게 이름과 "로그아웃"이 보이고, 로그아웃하면 로그인 화면으로', async () => {
    loggedOut()
    server.on('POST', /^\/api\/login$/, (call) => {
      expect(call.body).toEqual({ loginId: 'shop1', password: 'pass-word-1' })
      expect(call.credentials).toBe('include')
      return { body: me }
    })
    server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    server.on('POST', /^\/api\/logout$/, () => ({ body: { ok: true } }))
    render(<App />)
    fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'shop1' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pass-word-1' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { name: '방송 목록' })).toBeDefined()
    expect(screen.getByText('구피 가게')).toBeDefined()
    // MOB1 D-MOB1-05: 휴대폰 폭(jsdom)은 "더보기" 목록 맨 끝의 "로그아웃" — 끝내지 않은 방송이 없으면 묻지 않는다
    fireEvent.click(screen.getByRole('button', { name: '더보기' }))
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(await screen.findByRole('button', { name: '로그인' })).toBeDefined()
    expect(screen.queryByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeNull()
  })

  it('쓰는 중에 세션이 끝나면(401) "로그인이 풀렸어요"와 로그인 화면, 다시 로그인하면 보던 화면(주소 그대로)', async () => {
    server.on('GET', /^\/api\/me$/, () => ({ body: me }))
    let expired = false
    server.on('GET', /^\/api\/broadcasts$/, () => (expired ? apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.') : { body: { broadcasts: [broadcastItem()] } }))
    window.history.replaceState(null, '', '/broadcasts/b1')
    expired = true
    render(<App />)
    expect(await screen.findByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeDefined()
    expect(window.location.pathname).toBe('/broadcasts/b1')
    server.on('POST', /^\/api\/login$/, () => ({ body: me }))
    expired = false
    server.on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000 } }))
    server.on('GET', /^\/api\/days\/2026-10-19\/messages/, () => ({ body: { date: '2026-10-19', rehearsal: false, seq: 1, messages: [], more: false } }))
    server.on('GET', /^\/api\/days\/2026-10-19$/, () => ({
      body: { date: '2026-10-19', rehearsal: false, seq: 1, broadcasts: [], products: [], claims: [], pending: [], buyers: [], settlements: [], effects: [], cancelRequests: [], attention: [] },
    }))
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    // 같은 방송의 콘솔로 돌아간다
    await waitFor(() => expect(server.callsTo('GET', /^\/api\/days\/2026-10-19$/).length).toBeGreaterThan(0))
    expect(window.location.pathname).toBe('/broadcasts/b1')
  })

  it('로그인 화면의 보이는 글자에 영어(로마자)가 없다', async () => {
    loggedOut()
    const { container } = render(<App />)
    await screen.findByRole('button', { name: '로그인' })
    expect(visibleLatin(container)).toEqual([])
  })
})

describe('방송 목록 (AC-S05-02)', () => {
  it('날짜(KST) 최근 순, 제목·날짜·진행 중/끝남·리허설 글자. 누르면 콘솔 주소로', async () => {
    server.on('GET', /^\/api\/me$/, () => ({ body: me }))
    server.on('GET', /^\/api\/broadcasts$/, () => ({
      body: {
        broadcasts: [
          broadcastItem({ id: 'old', date: '2026-10-18', title: '어제 방송', ended: true, endedAt: '2026-10-18T12:00:00.000Z' }),
          broadcastItem({ id: 'b1', title: '1부' }),
          broadcastItem({ id: 'r1', title: '1부', rehearsal: true }),
        ],
      },
    }))
    server.on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000 } }))
    render(<App />)
    const list = await screen.findByRole('list', { name: '방송' })
    const items = within(list).getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual(['1부10월 19일진행 중리허설', '1부10월 19일진행 중', '어제 방송10월 18일끝남'])
    fireEvent.click(within(list).getAllByRole('link')[1] as HTMLElement)
    expect(window.location.pathname).toBe('/broadcasts/b1')
  })

  it('새 방송 시작: 제목·날짜(기본 오늘 KST)로 요청 번호와 함께 만들고 설정은 보내지 않는다. 번호가 든 제목은 서버 문장을 제목 칸 아래에', async () => {
    server.on('GET', /^\/api\/me$/, () => ({ body: me }))
    server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    const phone = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'
    server.on('POST', /^\/api\/broadcasts$/, (call) =>
      String(call.body?.title).includes('010') ? apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'title', message: phone }]) : { body: {} },
    )
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '새 방송 시작' }))
    expect((screen.getByLabelText('날짜') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '구피 010-1234-5678' } })
    fireEvent.click(screen.getByRole('button', { name: '이 방송 시작하기' }))
    expect(await screen.findByText(phone)).toBeDefined()
    const [create] = server.callsTo('POST', /^\/api\/broadcasts$/)
    expect(Object.keys(create?.body ?? {}).sort()).toEqual(['date', 'requestId', 'title'])
    expect(String(create?.body?.requestId)).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('정렬: 같은 날은 나중에 만든 방송이 위', () => {
    const sorted = sortBroadcasts([broadcastItem({ id: 'a', date: '2026-10-19' }), broadcastItem({ id: 'b', date: '2026-10-19' }), broadcastItem({ id: 'c', date: '2026-10-20' })])
    expect(sorted.map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })
})
