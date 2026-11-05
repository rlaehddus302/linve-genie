// 로그인 화면 (APP-01 AC1 "앱을 열면 로그인 화면"): 아이디·비밀번호 칸, 틀리면 서버 문장 그대로 + 안내, 맞으면 onLogin.
// D-UX3-31로 바뀐 기대: 옛 "첫 화면에 아이디·비밀번호 칸이 늘 있다" → 새 "간편 로그인이 켜진 서버면 [아이디로 로그인]을 눌러야 칸이 열린다
// (간편 로그인이 없는 서버·마지막으로 아이디로 들어온 기기는 처음부터 열림)".
// D-UX3-32로 바뀐 기대: 옛 "[아이디로 로그인] 링크를 누르면 칸이 열린다" → 새 "링크는 없고 서비스명을 2초 안에 다섯 번 누르면 열린다(숨은 길)". 아래 두 시험은 간편 로그인이 없는 서버라 칸이 바로 열린다(나타날 때까지 기다린다).
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import { configureApi } from '../src/api/config.ts'
import { setSocialNative } from '../src/lib/social-auth.ts'
import { LOGIN_FAILED_HINT, OFFLINE_AT_START_MESSAGE, SESSION_EXPIRED_MESSAGE, SUPPORT_EMAIL, SUPPORT_PHONE } from '../src/lib/words.ts'
import { LoginScreen } from '../src/screens/LoginScreen.tsx'
import { flush } from './support.ts'

describe('LoginScreen', () => {
  it('아이디·비밀번호를 적고 로그인을 누르면 onLogin을 부른다', async () => {
    const onLogin = vi.fn(async () => {})
    render(<LoginScreen expired={false} onLogin={onLogin} />)
    expect(screen.getByRole('heading', { name: '라이브지니' })).toBeTruthy()
    fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'seller1' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('seller1', 'pw'))
  })

  it('틀리면 서버 문장을 그대로 보이고 아이디는 남기며 운영자 안내를 붙인다', async () => {
    const onLogin = vi.fn(async () => {
      throw new ApiError({ status: 401, code: 'LOGIN_FAILED', message: '아이디 또는 비밀번호가 맞지 않아요.' })
    })
    render(<LoginScreen expired={false} onLogin={onLogin} />)
    fireEvent.change(await screen.findByLabelText('아이디'), { target: { value: 'seller1' } })
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

    const install = (back: string | null, replies: Record<string, unknown>, stored: Record<string, string> = {}, providers: readonly string[] = ['kakao', 'naver', 'google']) => {
      const calls: { url: string; body: unknown }[] = []
      configureApi({
        baseUrl: 'https://livegenie.test',
        fetch: async (input, init) => {
          const url = String(input)
          calls.push({ url, body: init?.body === undefined ? null : JSON.parse(String(init.body)) })
          if (url.endsWith('/api/client-config')) return new Response(JSON.stringify({ loginProviders: providers }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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

    it('D-UX3-34 서버가 Apple을 켜면 맨 아래에 검은 "Apple로 로그인" 단추, 누르면 provider=apple로 앱 로그인 창을 연다', async () => {
      const t = install(null, {}, {}, ['apple', 'kakao', 'naver', 'google'])
      render(<LoginScreen expired={false} onLogin={async () => {}} onSocialDone={async () => {}} />)
      const apple = await screen.findByRole('button', { name: 'Apple로 로그인' })
      const names = screen.getAllByRole('button').map((item) => item.getAttribute('aria-label')).filter((name) => name?.endsWith('로 로그인'))
      expect(names).toEqual(['카카오로 로그인', '네이버로 로그인', '구글로 로그인', 'Apple로 로그인'])
      fireEvent.click(apple)
      await waitFor(() => expect(t.opened).toEqual([`https://livegenie.test/api/auth/app/start?provider=apple&challenge=${'C'.repeat(43)}`]))
    })

    // 옛 기대 D-UX3-28: 처음 계정이면 동의 판(체크 → "동의하고 시작하기") 뒤 가입.
    // 새 기대 D-UX3-29 (사용자 지시 2026-11-05 "저런 화면이 필수임?"): 동의 판 없이 바로 가입 — 단추 아래 안내 한 줄과 약관 링크
    // D-UX3-33 (사용자 지시 2026-11-06 "처음이면 ... 동의한것으로 봐요 이 설명도 필요없어 지워"): 옛 기대 "단추 아래 안내 한 줄이 있다" → 새 기대 "안내 한 줄은 없고 약관 링크는 맨 아래에"
    it('처음 계정이면 동의 판 없이 바로 표·검증 값으로 가입, 동의 안내 한 줄은 없고 약관 링크는 있다', async () => {
      const t = install('livejjim://auth?ticket=' + 'T'.repeat(43) + '&provider=naver', { '/api/auth/app/finish': { result: 'SIGNUP', provider: 'naver' }, '/api/auth/signup': { seller: { name: '내 가게' } } })
      const onSocialDone = vi.fn(async () => {})
      render(<LoginScreen expired={false} onLogin={async () => {}} onSocialDone={onSocialDone} />)
      fireEvent.click(await screen.findByRole('button', { name: '네이버로 로그인' }))
      expect(screen.queryByText(/동의한 것으로 봐요/)).toBeNull()
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

    // D-UX3-31 (사용자 지시 2026-11-05 "아이디 비밀번호 방식 다 지우고 소셜 로그인만 남기고 밑에 쓸데 없는 설명은 지우고 필수적인거만")
    // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어 … 로그인 화면은 첨부 사진과 같이"): 옛 기대 "[아이디로 로그인]을 누르면 칸이 열린다"
    // → 새 기대 "그 링크는 없고, 서비스명을 2초 안에 다섯 번 누르면 칸이 열린다"
    it('간편 로그인이 켜진 서버면 첫 화면은 서비스명·단추 셋·맨 아래 약관과 고객센터뿐(동의 안내 한 줄 없음 — D-UX3-33), 아이디 칸·[아이디로 로그인]은 없다', async () => {
      install(null, {})
      render(<LoginScreen expired={false} onLogin={async () => {}} />)
      await screen.findByRole('button', { name: '카카오로 로그인' })
      expect(screen.getByRole('heading', { name: '라이브지니' })).toBeTruthy()
      expect(screen.queryByLabelText('아이디')).toBeNull()
      expect(screen.queryByLabelText('비밀번호')).toBeNull()
      expect(screen.queryByRole('button', { name: '아이디로 로그인' })).toBeNull()
      expect(screen.queryByText('또는')).toBeNull()
      expect(screen.queryByText(/운영자에게 물어봐/)).toBeNull()
      const footer = screen.getByTestId('login-footer')
      expect(footer.textContent).toBe(`이용약관개인정보처리방침고객센터 ${SUPPORT_PHONE}  |  ${SUPPORT_EMAIL}`)
      expect(SUPPORT_PHONE).toBe('070-1234-5678')
      expect(SUPPORT_EMAIL).toBe('help@livegenie.kr')
      expect(screen.getByRole('link', { name: '이용약관' })).toBeTruthy()
      expect(screen.getByRole('link', { name: '개인정보처리방침' })).toBeTruthy()
      expect(screen.getByRole('link', { name: `고객센터 전화 ${SUPPORT_PHONE}` })).toBeTruthy()
      expect(screen.getByRole('link', { name: `고객센터 이메일 ${SUPPORT_EMAIL}` })).toBeTruthy()
    })

    it('서비스명을 다섯 번 누르면 아이디 칸이 열린다(운영자·심사용 계정) — 네 번은 열리지 않는다', async () => {
      install(null, {})
      const onLogin = vi.fn(async () => {})
      render(<LoginScreen expired={false} onLogin={onLogin} />)
      await screen.findByRole('button', { name: '카카오로 로그인' })
      const title = screen.getByTestId('login-title')
      for (let i = 0; i < 4; i += 1) fireEvent.click(title)
      expect(screen.queryByLabelText('아이디')).toBeNull()
      fireEvent.click(title)
      fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'review1' } })
      fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } })
      fireEvent.click(screen.getByRole('button', { name: '로그인' }))
      await waitFor(() => expect(onLogin).toHaveBeenCalledWith('review1', 'pw'))
    })

    it('마지막으로 아이디로 들어온 기기는 처음부터 아이디 칸이 열려 있다', async () => {
      install(null, {}, { 'livejjim:last-login': 'id' })
      render(<LoginScreen expired={false} onLogin={async () => {}} />)
      await screen.findByRole('button', { name: '카카오로 로그인' })
      expect(await screen.findByLabelText('아이디')).toBeTruthy()
    })

    // D-UX3-30 (사용자 지시 2026-11-05 "같은 사람이면 하나의 계정으로"): 문자 인증이 켜진 서버면 번호부터
    describe('D-UX3-30 휴대폰 번호로 같은 사람 묶기', () => {
      /** 로그인 창이 차례로 돌려줄 주소들 */
      const installQueue = (backs: string[], replies: Record<string, unknown>) => {
        const t = install(null, replies)
        setSocialNative({
          openAuthSession: async (url) => {
            t.opened.push(url)
            return backs.shift() ?? null
          },
          randomVerifier: () => 'V'.repeat(43),
          sha256: async () => 'C'.repeat(43),
          storage: { getItem: async () => null, setItem: async (key, value) => void (t.stored[key] = value) },
        })
        return t
      }
      const T1 = 'T'.repeat(43)
      const T2 = 'U'.repeat(43)

      it('새 번호: 번호 → 인증번호 → 확인하면 가입하고 들어간다', async () => {
        const t = installQueue([`livejjim://auth?ticket=${T1}&provider=google`], {
          '/api/auth/app/finish': { result: 'SIGNUP', provider: 'google', phoneRequired: true },
          '/api/auth/signup/phone': { phone: '010-****-5678' },
          '/api/auth/signup/phone/verify': { next: 'SIGNUP', phone: '010-****-5678' },
          '/api/auth/signup': { seller: { name: '내 가게' } },
        })
        const onSocialDone = vi.fn(async () => {})
        render(<LoginScreen expired={false} onLogin={async () => {}} onSocialDone={onSocialDone} />)
        fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }))
        expect(await screen.findByText('휴대폰 번호를 확인할게요')).toBeTruthy()
        // 처음 화면으로 돌아가는 단추(왼쪽)와 인증번호 받기(오른쪽)가 한 줄에
        expect(screen.getByRole('button', { name: '처음으로' })).toBeTruthy()
        fireEvent.change(screen.getByLabelText('휴대폰 번호'), { target: { value: '010-1234-5678' } })
        fireEvent.click(screen.getByRole('button', { name: '인증번호 받기' }))
        expect(await screen.findByText('010-****-5678 번호로 인증번호를 보냈어요.')).toBeTruthy()
        fireEvent.change(screen.getByLabelText('인증번호 6자리'), { target: { value: '123456' } })
        fireEvent.click(screen.getByRole('button', { name: '확인' }))
        await waitFor(() => expect(onSocialDone).toHaveBeenCalledTimes(1))
        expect(t.calls.find((c) => c.url.endsWith('/api/auth/signup/phone'))?.body).toEqual({ phone: '010-1234-5678', ticket: T1, verifier: 'V'.repeat(43) })
        expect(t.calls.find((c) => c.url.endsWith('/api/auth/signup/phone/verify'))?.body).toEqual({ code: '123456', ticket: T1, verifier: 'V'.repeat(43) })
        expect(t.calls.find((c) => c.url.endsWith('/api/auth/signup'))?.body).toEqual({ agree: true, ticket: T1, verifier: 'V'.repeat(43) })
        expect(t.stored['livejjim:last-login']).toBe('google')
      })

      it('있는 번호: 새 계정을 만들지 않고, 그 계정의 카카오로 다시 로그인하면 구글을 잇는다', async () => {
        const t = installQueue([`livejjim://auth?ticket=${T1}&provider=google`, `livejjim://auth?ticket=${T2}&provider=kakao`], {
          '/api/auth/app/finish': { result: 'SIGNUP', provider: 'google', phoneRequired: true },
          '/api/auth/signup/phone': { phone: '010-****-6666' },
          '/api/auth/signup/phone/verify': { next: 'LOGIN_EXISTING', phone: '010-****-6666', providers: ['kakao'], password: false },
          '/api/auth/signup/link': { provider: 'google' },
        })
        const onSocialDone = vi.fn(async () => {})
        render(<LoginScreen expired={false} onLogin={async () => {}} onSocialDone={onSocialDone} />)
        fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }))
        fireEvent.change(await screen.findByLabelText('휴대폰 번호'), { target: { value: '01055556666' } })
        fireEvent.click(screen.getByRole('button', { name: '인증번호 받기' }))
        fireEvent.change(await screen.findByLabelText('인증번호 6자리'), { target: { value: '654321' } })
        fireEvent.click(screen.getByRole('button', { name: '확인' }))
        expect(await screen.findByText('이미 가입한 계정이 있어요')).toBeTruthy()
        expect(screen.getByText('010-****-6666 번호로 가입한 계정이에요. 카카오로 로그인하면 구글도 함께 이어져요.')).toBeTruthy()
        expect(screen.queryByRole('button', { name: '구글로 로그인' })).toBeNull()
        // 두 번째 로그인은 기존 계정(LOGGED_IN)
        const finishReplies = [{ result: 'LOGGED_IN', me: {} }]
        configureApi({
          baseUrl: 'https://livegenie.test',
          fetch: async (input, init) => {
            const url = String(input)
            t.calls.push({ url, body: init?.body === undefined ? null : JSON.parse(String(init.body)) })
            const path = new URL(url).pathname
            const reply = path === '/api/auth/app/finish' ? finishReplies.shift() : path === '/api/auth/signup/link' ? { provider: 'google' } : undefined
            return new Response(JSON.stringify(reply ?? {}), { status: reply === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } })
          },
        })
        fireEvent.click(screen.getByRole('button', { name: '카카오로 로그인' }))
        await waitFor(() => expect(onSocialDone).toHaveBeenCalledTimes(1))
        expect(t.calls.filter((c) => c.url.endsWith('/api/auth/signup'))).toHaveLength(0)
        expect(t.calls.find((c) => c.url.endsWith('/api/auth/signup/link'))?.body).toEqual({ ticket: T1, verifier: 'V'.repeat(43) })
        expect(t.stored['livejjim:last-login']).toBe('kakao')
      })
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
