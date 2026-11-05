// 로그인 화면 (APP-01 AC1 "앱을 열면 로그인 화면"): 아이디·비밀번호 칸, 틀리면 서버 문장 그대로 + 안내, 맞으면 onLogin.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import { configureApi } from '../src/api/config.ts'
import { setSocialNative } from '../src/lib/social-auth.ts'
import { LOGIN_FAILED_HINT, OFFLINE_AT_START_MESSAGE, SESSION_EXPIRED_MESSAGE } from '../src/lib/words.ts'
import { LoginScreen } from '../src/screens/LoginScreen.tsx'
import { flush } from './support.ts'

describe('LoginScreen', () => {
  it('아이디·비밀번호를 적고 로그인을 누르면 onLogin을 부른다', async () => {
    const onLogin = vi.fn(async () => {})
    render(<LoginScreen expired={false} onLogin={onLogin} />)
    expect(screen.getByRole('heading', { name: '라이브지니' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'seller1' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('seller1', 'pw'))
  })

  it('틀리면 서버 문장을 그대로 보이고 아이디는 남기며 운영자 안내를 붙인다', async () => {
    const onLogin = vi.fn(async () => {
      throw new ApiError({ status: 401, code: 'LOGIN_FAILED', message: '아이디 또는 비밀번호가 맞지 않아요.' })
    })
    render(<LoginScreen expired={false} onLogin={onLogin} />)
    fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'seller1' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('아이디 또는 비밀번호가 맞지 않아요.'))
    expect(screen.getByText(LOGIN_FAILED_HINT)).toBeTruthy()
    expect((screen.getByLabelText('아이디') as HTMLInputElement).value).toBe('seller1')
    expect((screen.getByLabelText('비밀번호') as HTMLInputElement).value).toBe('')
  })

  it('세션이 끝나 돌아왔으면 "로그인이 풀렸어요"를 보인다', () => {
    render(<LoginScreen expired onLogin={async () => {}} />)
    expect(screen.getByText(SESSION_EXPIRED_MESSAGE)).toBeTruthy()
  })

  it('켤 때 서버에 닿지 못했으면 로그인이 풀렸다고 하지 않고 "다시 확인"을 보인다 (APP2 실기기)', async () => {
    const onRecheck = vi.fn(async () => {})
    render(<LoginScreen expired={false} offline onRecheck={onRecheck} onLogin={async () => {}} />)
    expect(screen.getByText(OFFLINE_AT_START_MESSAGE)).toBeTruthy()
    expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }))
    await waitFor(() => expect(onRecheck).toHaveBeenCalledTimes(1))
  })

  describe('D-UX3-28 앱 안 간편 로그인', () => {
    afterEach(() => setSocialNative(null))

    const install = (back: string | null, replies: Record<string, unknown>, stored: Record<string, string> = {}) => {
      const calls: { url: string; body: unknown }[] = []
      configureApi({
        baseUrl: 'https://livegenie.test',
        fetch: async (input, init) => {
          const url = String(input)
          calls.push({ url, body: init?.body === undefined ? null : JSON.parse(String(init.body)) })
          if (url.endsWith('/api/client-config')) return new Response(JSON.stringify({ loginProviders: ['kakao', 'naver', 'google'] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
          const path = new URL(url).pathname
          const reply = replies[path]
          return new Response(JSON.stringify(reply ?? {}), { status: reply === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } })
        },
      })
      const opened: string[] = []
      setSocialNative({
        openAuthSession: async (url) => {
          opened.push(url)
          return back
        },
        randomVerifier: () => 'V'.repeat(43),
        sha256: async () => 'C'.repeat(43),
        storage: { getItem: async (key) => stored[key] ?? null, setItem: async (key, value) => void (stored[key] = value) },
      })
      return { calls, opened, stored }
    }

    it('공식 로고 긴 단추 셋, 웹으로 열지 않고 앱 로그인 창으로 시작 주소를 연다. 돌아온 표로 로그인되면 onSocialDone·최근 로그인', async () => {
      const t = install('livejjim://auth?ticket=' + 'T'.repeat(43) + '&provider=kakao', { '/api/auth/app/finish': { result: 'LOGGED_IN', me: {} } })
      const onSocialDone = vi.fn(async () => {})
      render(<LoginScreen expired={false} onLogin={async () => {}} onSocialDone={onSocialDone} />)
      const kakao = await screen.findByRole('button', { name: '카카오로 로그인' })
      expect(screen.getByRole('button', { name: '네이버로 로그인' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '구글로 로그인' })).toBeTruthy()
      fireEvent.click(kakao)
      await waitFor(() => expect(onSocialDone).toHaveBeenCalledTimes(1))
      expect(t.opened).toEqual([`https://livegenie.test/api/auth/app/start?provider=kakao&challenge=${'C'.repeat(43)}`])
      expect(t.calls.find((c) => c.url.endsWith('/api/auth/app/finish'))?.body).toEqual({ ticket: 'T'.repeat(43), verifier: 'V'.repeat(43) })
      expect(t.stored['livejjim:last-login']).toBe('kakao')
    })

    // 옛 기대 D-UX3-28: 처음 계정이면 동의 판(체크 → "동의하고 시작하기") 뒤 가입.
    // 새 기대 D-UX3-29 (사용자 지시 2026-11-05 "저런 화면이 필수임?"): 동의 판 없이 바로 가입 — 단추 아래 안내 한 줄과 약관 링크
    it('처음 계정이면 동의 판 없이 바로 표·검증 값으로 가입, 단추 아래 안내와 약관 링크', async () => {
      const t = install('livejjim://auth?ticket=' + 'T'.repeat(43) + '&provider=naver', { '/api/auth/app/finish': { result: 'SIGNUP', provider: 'naver' }, '/api/auth/signup': { seller: { name: '내 가게' } } })
      const onSocialDone = vi.fn(async () => {})
      render(<LoginScreen expired={false} onLogin={async () => {}} onSocialDone={onSocialDone} />)
      fireEvent.click(await screen.findByRole('button', { name: '네이버로 로그인' }))
      expect(screen.getByText('처음이면 바로 라이브지니 계정이 만들어져요. 계속하면 만 14세 이상이며 이용약관과 개인정보처리방침에 동의한 것으로 봐요.')).toBeTruthy()
      expect(screen.getByRole('link', { name: '이용약관' })).toBeTruthy()
      expect(screen.getByRole('link', { name: '개인정보처리방침' })).toBeTruthy()
      await waitFor(() => expect(onSocialDone).toHaveBeenCalledTimes(1))
      expect(t.calls.find((c) => c.url.endsWith('/api/auth/signup'))?.body).toEqual({ agree: true, ticket: 'T'.repeat(43), verifier: 'V'.repeat(43) })
      expect(t.stored['livejjim:last-login']).toBe('naver')
      expect(screen.queryByRole('checkbox')).toBeNull()
      expect(screen.queryByText('동의하고 시작하기')).toBeNull()
    })

    // D-UX3-29 (사용자 지시 2026-11-05 "하나 누르면 전체가 다 눌린 상태로 팝업이 뜸", "꾹 눌렀을 때 버튼 안 진해짐")
    it('누른 단추만 안이 진해지고 다른 단추는 그대로·잠기지 않는다', async () => {
      let back: (value: string | null) => void = () => {}
      install(null, {})
      setSocialNative({
        openAuthSession: () => new Promise((resolve) => (back = resolve)),
        randomVerifier: () => 'V'.repeat(43),
        sha256: async () => 'C'.repeat(43),
        storage: { getItem: async () => null, setItem: async () => {} },
      })
      render(<LoginScreen expired={false} onLogin={async () => {}} />)
      fireEvent.click(await screen.findByRole('button', { name: '카카오로 로그인' }))
      await waitFor(() => expect(screen.getByTestId('social-kakao-pressed')).toBeTruthy())
      expect(screen.queryByTestId('social-naver-pressed')).toBeNull()
      expect(screen.queryByTestId('social-google-pressed')).toBeNull()
      for (const name of ['네이버로 로그인', '구글로 로그인']) expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).not.toBe('true')
      await act(async () => {
        back(null)
        await flush()
      })
      await waitFor(() => expect(screen.queryByTestId('social-kakao-pressed')).toBeNull())
    })

    it('취소하고 돌아오면 정한 문장, 창을 닫으면 아무 문장 없음. 마지막 방법에 "최근 로그인"', async () => {
      install('livejjim://auth?login=CANCELLED&provider=google', {}, { 'livejjim:last-login': 'google' })
      render(<LoginScreen expired={false} onLogin={async () => {}} />)
      const google = await screen.findByRole('button', { name: '구글로 로그인, 최근 로그인' })
      fireEvent.click(google)
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('구글 로그인을 취소했어요. 다시 하려면 버튼을 눌러 주세요.'))
    })
  })
})
