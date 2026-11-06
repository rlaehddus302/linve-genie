// 로그인 화면 (APP-01 AC1 "앱을 열면 로그인 화면"): 아이디·비밀번호 칸, 틀리면 서버 문장 그대로 + 안내, 맞으면 onLogin.
// D-UX3-31로 바뀐 기대: 옛 "첫 화면에 아이디·비밀번호 칸이 늘 있다" → 새 "간편 로그인이 켜진 서버면 [아이디로 로그인]을 눌러야 칸이 열린다
// (간편 로그인이 없는 서버·마지막으로 아이디로 들어온 기기는 처음부터 열림)".
// D-UX3-32로 바뀐 기대: 옛 "[아이디로 로그인] 링크를 누르면 칸이 열린다" → 새 "링크는 없고 서비스명을 2초 안에 다섯 번 누르면 열린다(숨은 길)". 아래 두 시험은 간편 로그인이 없는 서버라 칸이 바로 열린다(나타날 때까지 기다린다).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import { configureApi } from '../src/api/config.ts'
import { setSocialNative } from '../src/lib/social-auth.ts'
import { LOGIN_FAILED_HINT, OFFLINE_AT_START_MESSAGE, SESSION_EXPIRED_MESSAGE, SUPPORT_EMAIL, SUPPORT_PHONE } from '../src/lib/words.ts'
import { LoginScreen } from '../src/screens/LoginScreen.tsx'
import { CODE_ASK_TITLE, PHONE_ASK_TITLE, PHONE_RECHECK } from '@livejjim/web/src/lib/social-login.ts'
import { setErrorHaptic } from '../src/native/haptics.ts'
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

      // D-UX3-49로 바뀐 기대 (사용자 지시 2026-11-07 사진): 옛 "번호 → [인증번호 받기] → 6자리 → [확인]" →
      // "번호 11자리가 차면 바로 보내고 인증번호 화면, 6자리가 차면 바로 확인, '인증 성공'을 2초 보인 뒤 들어간다". 왼쪽 위 ‹(처음으로).
      // D-UX3-50으로 다시 바뀐 기대 (사용자 지시 2026-11-07 사진 7 "다 채웠다고 바로 넘어가지 말고 아래에 다음 버튼"):
      // 옛 "11자리가 차면 바로 보낸다" → 새 "11자리가 차면 [다음]이 켜지고, 눌러야 보낸다". 6자리 바로 확인·인증 성공 2초는 그대로.
      it('새 번호: 11자리를 넣고 [다음]을 누르면 보내고, 6자리가 차면 바로 확인하고, 인증 성공 2초 뒤 가입하고 들어간다', async () => {
        const t = installQueue([`livejjim://auth?ticket=${T1}&provider=google`], {
          '/api/auth/app/finish': { result: 'SIGNUP', provider: 'google', phoneRequired: true },
          '/api/auth/signup/phone': { phone: '010-****-5678' },
          '/api/auth/signup/phone/verify': { next: 'SIGNUP', phone: '010-****-5678' },
          '/api/auth/signup': { seller: { name: '내 가게' } },
        })
        const onSocialDone = vi.fn(async () => {})
        render(<LoginScreen expired={false} onLogin={async () => {}} onSocialDone={onSocialDone} />)
        fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }))
        expect(await screen.findByText(PHONE_ASK_TITLE.replace('\n', ' '))).toBeTruthy()
        expect(screen.getByRole('button', { name: '처음으로' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: '인증번호 받기' })).toBeNull()
        expect(PHONE_ASK_TITLE).toBe('본인 확인을 위해\n휴대폰 번호를 입력해 주세요')
        fireEvent.change(screen.getByLabelText('휴대폰 번호'), { target: { value: '0101234567' } })
        expect(screen.getByRole('button', { name: '다음' }).getAttribute('aria-disabled')).toBe('true')
        fireEvent.change(screen.getByLabelText('휴대폰 번호'), { target: { value: '01012345678' } })
        await flush()
        // 다 채워도 저절로 넘어가지 않는다
        expect(t.calls.filter((c) => c.url.endsWith('/api/auth/signup/phone'))).toHaveLength(0)
        expect(screen.queryByText(CODE_ASK_TITLE.replace('\n', ' '))).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: '다음' }))
        expect(await screen.findByText(CODE_ASK_TITLE.replace('\n', ' '))).toBeTruthy()
        expect(screen.getByText(/남은 시간 0[23]:\d\d/)).toBeTruthy()
        // D-UX3-53으로 바뀐 기대 (사용자 지시 2026-11-07 "토스처럼 문구, 버튼 형태 … 누르면 팝업 형태로"): 옛 키보드 위 [다시 문자 받을게요] 단추(30초 전 꺼짐)와 그 위 "N초 뒤에 다시 받을 수 있어요" →
        // 새 밑줄 글자 [문자가 안 오나요?] → 팝업 "N초 뒤에 받을 수 있어요" + 왼쪽 [닫기]·오른쪽 [다시 받기](30초 전 꺼짐)
        fireEvent.click(screen.getByRole('button', { name: '문자가 안 오나요?' }))
        const ask = await screen.findByRole('alertdialog')
        expect(ask.textContent).toMatch(/(30|29|28)초 뒤에 받을 수 있어요/)
        // D-UX3-54로 바뀐 기대 (사용자 지시 2026-11-07 "제목은 \"인증 문자를 다시 받을까요?\""): 옛 제목 "문자가 안 오나요?" → 새 "인증 문자를 다시 받을까요?"
        expect(ask.textContent).toContain('인증 문자를 다시 받을까요?')
        expect(ask.textContent).not.toContain('문자가 안 오나요?')
        expect(within(ask).getByRole('button', { name: '다시 받기' }).getAttribute('aria-disabled')).toBe('true')
        fireEvent.click(within(ask).getByRole('button', { name: '닫기' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(screen.queryByRole('button', { name: '확인' })).toBeNull()
        fireEvent.change(screen.getByLabelText('인증번호 6자리'), { target: { value: '123456' } })
        expect(await screen.findByText('인증 성공')).toBeTruthy()
        expect(onSocialDone).not.toHaveBeenCalled()
        await waitFor(() => expect(onSocialDone).toHaveBeenCalledTimes(1), { timeout: 4000 })
        expect(t.calls.find((c) => c.url.endsWith('/api/auth/signup/phone'))?.body).toEqual({ phone: '010-1234-5678', ticket: T1, verifier: 'V'.repeat(43) })
        expect(t.calls.find((c) => c.url.endsWith('/api/auth/signup/phone/verify'))?.body).toEqual({ code: '123456', ticket: T1, verifier: 'V'.repeat(43) })
        expect(t.calls.find((c) => c.url.endsWith('/api/auth/signup'))?.body).toEqual({ agree: true, ticket: T1, verifier: 'V'.repeat(43) })
        expect(t.stored['livejjim:last-login']).toBe('google')
      })

      // D-UX3-50으로 바뀐 기대 (사용자 지시 2026-11-07 사진 7 "010 예외처리는 바로 하는게 아니라 11자리 다 입력하고 나서"):
      // 옛 "앞 세 자리가 010이 아니면 바로 경고" → 새 "11자리를 다 넣은 뒤에 경고". [지우기]는 그대로.
      // D-UX3-51로 바뀐 기대 (사용자 지시 2026-11-07 "휴대폰 번호 잘못 입력했을 때 다음 버튼이 사라지는 문제"): 옛 "경고 때 [다음] 없음" →
      // 새 "[다음]은 그대로, 누르면 보내지 않고 다시 흔들고 진동". 경고가 처음 뜰 때도 진동 한 번.
      it('11자리를 다 넣었는데 010이 아니면 "다시 확인해 주세요"와 진동, [다음]을 눌러도 보내지 않고 다시 진동 (D-UX3-50·51)', async () => {
        const buzz = vi.fn()
        setErrorHaptic(buzz)
        const t = installQueue([`livejjim://auth?ticket=${T1}&provider=google`], {
          '/api/auth/app/finish': { result: 'SIGNUP', provider: 'google', phoneRequired: true },
          '/api/auth/signup/phone': { phone: '011-****-5678' },
        })
        render(<LoginScreen expired={false} onLogin={async () => {}} />)
        fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }))
        fireEvent.change(await screen.findByLabelText('휴대폰 번호'), { target: { value: '011' } })
        expect(screen.queryByRole('alert')).toBeNull()
        fireEvent.change(screen.getByLabelText('휴대폰 번호'), { target: { value: '0111234567' } })
        expect(screen.queryByRole('alert')).toBeNull()
        fireEvent.change(screen.getByLabelText('휴대폰 번호'), { target: { value: '01112345678' } })
        expect(screen.getByRole('alert').textContent).toContain(PHONE_RECHECK)
        expect(buzz).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: '다음' }))
        expect(buzz).toHaveBeenCalledTimes(2)
        expect(screen.getByRole('alert').textContent).toContain(PHONE_RECHECK)
        await flush()
        expect(t.calls.filter((c) => c.url.endsWith('/api/auth/signup/phone'))).toHaveLength(0)
        // 지우기는 그대로 — 누르면 비고 경고도 사라진다
        fireEvent.click(screen.getByRole('button', { name: '휴대폰 번호 지우기' }))
        expect(screen.queryByRole('alert')).toBeNull()
        expect(buzz).toHaveBeenCalledTimes(2)
        setErrorHaptic(() => {})
      })

      it('인증번호가 틀리면 칸을 하나로 합쳐 빨갛게 하고 서버 문장을 보이며 들어가지 않는다 (D-UX3-49)', async () => {
        const t = installQueue([`livejjim://auth?ticket=${T1}&provider=google`], {
          '/api/auth/app/finish': { result: 'SIGNUP', provider: 'google', phoneRequired: true },
          '/api/auth/signup/phone': { phone: '010-****-5678' },
        })
        configureApi({
          baseUrl: 'https://livegenie.test',
          fetch: async (input, init) => {
            const url = String(input)
            t.calls.push({ url, body: init?.body === undefined ? null : JSON.parse(String(init.body)) })
            const path = new URL(url).pathname
            if (path === '/api/auth/signup/phone/verify') {
              return new Response(JSON.stringify({ error: { code: 'CODE_WRONG', message: '인증번호가 맞지 않아요.' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
            }
            const reply = path === '/api/auth/app/finish' ? { result: 'SIGNUP', provider: 'google', phoneRequired: true } : path === '/api/auth/signup/phone' ? { phone: '010-****-5678' } : url.endsWith('/api/client-config') ? { loginProviders: ['kakao', 'naver', 'google'] } : undefined
            return new Response(JSON.stringify(reply ?? {}), { status: reply === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } })
          },
        })
        const onSocialDone = vi.fn(async () => {})
        render(<LoginScreen expired={false} onLogin={async () => {}} onSocialDone={onSocialDone} />)
        fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }))
        fireEvent.change(await screen.findByLabelText('휴대폰 번호'), { target: { value: '010-1234-5678' } })
        fireEvent.click(screen.getByRole('button', { name: '다음' })) // D-UX3-50
        fireEvent.change(await screen.findByLabelText('인증번호 6자리'), { target: { value: '000000' } })
        expect((await screen.findByRole('alert')).textContent).toContain('인증번호가 맞지 않아요.')
        expect(screen.getByTestId('code-wrong')).toBeTruthy()
        expect(screen.queryByText('인증 성공')).toBeNull()
        // 고쳐 넣으면 빨간 표시가 풀린다
        fireEvent.change(screen.getByLabelText('인증번호 6자리'), { target: { value: '00000' } })
        expect(screen.queryByTestId('code-wrong')).toBeNull()
        expect(onSocialDone).not.toHaveBeenCalled()
        // D-UX3-54 (사용자 지시 2026-11-07 토스 사진 17~19): 합친 빨간 칸은 잠깐 — 여섯 칸(옅은 빨강)으로 나뉘고 문장은 사라지며 [문자가 안 오나요?]가 다시 보인다
        fireEvent.change(screen.getByLabelText('인증번호 6자리'), { target: { value: '000000' } })
        expect((await screen.findByRole('alert')).textContent).toContain('인증번호가 맞지 않아요.')
        expect(screen.getByTestId('code-wrong')).toBeTruthy()
        await waitFor(() => expect(screen.queryByTestId('code-wrong')).toBeNull(), { timeout: 3000 })
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
        expect(screen.getByLabelText('인증번호 6자리').getAttribute('aria-invalid')).toBe('true')
        expect(screen.getByRole('button', { name: '문자가 안 오나요?' })).toBeTruthy()
      })

      it('시간이 지나 다시 받으면 남은 시간이 3분으로 돌아가고 팝업이 다시 뜨지 않는다. 닫는 동안 글이 바뀌지 않고, 30초 뒤에는 "지금 바로" (D-UX3-54)', async () => {
        const sends: string[] = []
        installQueue([`livejjim://auth?ticket=${T1}&provider=google`], {})
        configureApi({
          baseUrl: 'https://livegenie.test',
          fetch: async (input) => {
            const url = String(input)
            const path = new URL(url).pathname
            if (path === '/api/auth/signup/phone') sends.push(path)
            const reply = path === '/api/auth/app/finish' ? { result: 'SIGNUP', provider: 'google', phoneRequired: true } : path === '/api/auth/signup/phone' ? { phone: '010-****-5678' } : url.endsWith('/api/client-config') ? { loginProviders: ['kakao', 'naver', 'google'] } : undefined
            return new Response(JSON.stringify(reply ?? {}), { status: reply === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } })
          },
        })
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          render(<LoginScreen expired={false} onLogin={async () => {}} />)
          fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }))
          fireEvent.change(await screen.findByLabelText('휴대폰 번호'), { target: { value: '010-1234-5678' } })
          fireEvent.click(screen.getByRole('button', { name: '다음' }))
          expect(await screen.findByText(CODE_ASK_TITLE.replace('\n', ' '))).toBeTruthy()
          // 30초가 지나면 "지금 바로 다시 받을 수 있어요"와 켜진 [다시 받기]
          vi.setSystemTime(Date.now() + 31_000)
          fireEvent.click(screen.getByRole('button', { name: '문자가 안 오나요?' }))
          const ask = await screen.findByRole('alertdialog')
          await waitFor(() => expect(ask.textContent).toContain('지금 바로 다시 받을 수 있어요'), { timeout: 2500 })
          expect(within(ask).getByRole('button', { name: '다시 받기' }).getAttribute('aria-disabled')).not.toBe('true')
          fireEvent.click(within(ask).getByRole('button', { name: '닫기' }))
          await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
          // 3분이 지나면 시간 지남 팝업 — 닫는 동안 [문자가 안 오나요?] 팝업 글로 바뀌지 않는다
          vi.setSystemTime(Date.now() + 180_000)
          const over = await screen.findByRole('alertdialog', undefined, { timeout: 2500 })
          expect(over.textContent).toContain('입력할 수 있는 시간이 지났어요')
          fireEvent.click(within(over).getByRole('button', { name: '닫기' }))
          expect(screen.queryByText('인증 문자를 다시 받을까요?')).toBeNull()
          await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
          // D-UX3-55로 바뀐 기대 (사용자 지시 2026-11-07 "시간 초과 시 팝업에서 닫기를 누르면 그 화면에 남는게 아니라 이전 화면으로"):
          // 옛 — 그 화면에 남아 "남은 시간 00:00"·[문자가 안 오나요?] → 새 — 넣었던 번호가 남은 번호 화면으로, [다음]이면 새 3분
          const phone = (await screen.findByLabelText('휴대폰 번호')) as HTMLInputElement
          expect(phone.value).toBe('010-1234-5678')
          fireEvent.click(screen.getByRole('button', { name: '다음' }))
          await waitFor(() => expect(sends).toHaveLength(2))
          expect(await screen.findByText(/남은 시간 0(3:00|2:59)/)).toBeTruthy()
          // 시간 지남 팝업의 [다시 받기]로 받아도 남은 시간이 3분으로, 팝업은 다시 뜨지 않는다
          vi.setSystemTime(Date.now() + 181_000)
          fireEvent.click(within(await screen.findByRole('alertdialog', undefined, { timeout: 2500 })).getByRole('button', { name: '다시 받기' }))
          await waitFor(() => expect(sends).toHaveLength(3))
          await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
          expect(screen.getByText(/남은 시간 0(3:00|2:59)/)).toBeTruthy()
          await new Promise((resolve) => setTimeout(resolve, 1200))
          expect(screen.queryByRole('alertdialog')).toBeNull()
          expect(screen.getByText(/남은 시간 0(3:00|2:59)/)).toBeTruthy()
        } finally {
          vi.useRealTimers()
        }
      })

      it('뒤로는 "다음에 할까요?" 팝업: [닫기]면 그대로, [나가기]면 인증번호 화면은 번호 화면으로·번호 화면은 처음으로. 서버가 빨리 답해도 0.5초는 확인 중 (D-UX3-55)', async () => {
        installQueue([`livejjim://auth?ticket=${T1}&provider=google`], {})
        configureApi({
          baseUrl: 'https://livegenie.test',
          fetch: async (input) => {
            const url = String(input)
            const path = new URL(url).pathname
            if (path === '/api/auth/signup/phone/verify') {
              return new Response(JSON.stringify({ error: { code: 'CODE_WRONG', message: '인증번호가 맞지 않아요.' } }), { status: 400, headers: { 'Content-Type': 'application/json' } })
            }
            const reply = path === '/api/auth/app/finish' ? { result: 'SIGNUP', provider: 'google', phoneRequired: true } : path === '/api/auth/signup/phone' ? { phone: '010-****-5678' } : url.endsWith('/api/client-config') ? { loginProviders: ['kakao', 'naver', 'google'] } : undefined
            return new Response(JSON.stringify(reply ?? {}), { status: reply === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } })
          },
        })
        render(<LoginScreen expired={false} onLogin={async () => {}} />)
        fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }))
        fireEvent.change(await screen.findByLabelText('휴대폰 번호'), { target: { value: '010-1234-5678' } })
        fireEvent.click(screen.getByRole('button', { name: '다음' }))
        // 0.5초 동안은 합친 칸으로 확인 중, 그 뒤에 틀림
        const started = Date.now()
        fireEvent.change(await screen.findByLabelText('인증번호 6자리'), { target: { value: '000000' } })
        expect(screen.getByTestId('code-checking')).toBeTruthy()
        await screen.findByRole('alert')
        expect(Date.now() - started).toBeGreaterThanOrEqual(480)
        // 인증번호 화면의 뒤로 → 팝업, [닫기]면 그 화면 그대로
        fireEvent.click(screen.getByRole('button', { name: '번호 다시 넣기' }))
        const ask = await screen.findByRole('alertdialog')
        expect(ask.textContent).toContain('다음에 할까요?')
        expect(ask.textContent).toContain('여기서 나가면 처음부터 다시 해야 해요')
        expect(within(ask).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['닫기', '나가기'])
        fireEvent.click(within(ask).getByRole('button', { name: '닫기' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        expect(screen.getByLabelText('인증번호 6자리')).toBeTruthy()
        // [나가기] → 빈 번호 화면
        fireEvent.click(screen.getByRole('button', { name: '번호 다시 넣기' }))
        fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '나가기' }))
        const phone = (await screen.findByLabelText('휴대폰 번호')) as HTMLInputElement
        expect(phone.value).toBe('')
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        // 번호 화면의 뒤로 → 같은 팝업, [나가기]면 처음 로그인 화면
        fireEvent.click(screen.getByRole('button', { name: '처음으로' }))
        fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '나가기' }))
        expect(await screen.findByRole('button', { name: '구글로 로그인' })).toBeTruthy()
      })

      it('가입 표가 없어졌으면 시간 지남이 아니라 서버 문장과 [처음으로] 팝업 (D-UX3-54)', async () => {
        installQueue([`livejjim://auth?ticket=${T1}&provider=google`], {})
        configureApi({
          baseUrl: 'https://livegenie.test',
          fetch: async (input) => {
            const url = String(input)
            const path = new URL(url).pathname
            if (path === '/api/auth/signup/phone/verify') {
              return new Response(JSON.stringify({ error: { code: 'LOGIN_EXPIRED', message: '로그인 요청이 오래됐어요. 처음부터 다시 해 주세요.' } }), { status: 410, headers: { 'Content-Type': 'application/json' } })
            }
            const reply = path === '/api/auth/app/finish' ? { result: 'SIGNUP', provider: 'google', phoneRequired: true } : path === '/api/auth/signup/phone' ? { phone: '010-****-5678' } : url.endsWith('/api/client-config') ? { loginProviders: ['kakao', 'naver', 'google'] } : undefined
            return new Response(JSON.stringify(reply ?? {}), { status: reply === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } })
          },
        })
        render(<LoginScreen expired={false} onLogin={async () => {}} />)
        fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }))
        fireEvent.change(await screen.findByLabelText('휴대폰 번호'), { target: { value: '010-1234-5678' } })
        fireEvent.click(screen.getByRole('button', { name: '다음' }))
        fireEvent.change(await screen.findByLabelText('인증번호 6자리'), { target: { value: '123456' } })
        const gone = await screen.findByRole('alertdialog')
        expect(gone.textContent).toContain('로그인 요청이 오래됐어요. 처음부터 다시 해 주세요.')
        expect(gone.textContent).not.toContain('입력할 수 있는 시간이 지났어요')
        fireEvent.click(within(gone).getByRole('button', { name: '처음으로' }))
        expect(await screen.findByRole('button', { name: '구글로 로그인' })).toBeTruthy()
      })

      it('틀린 문장에는 남은 횟수가 없고, 다섯 번째에 서버가 횟수 초과라 하면 팝업 [닫기]·[다시 받기], 시간 지남도 팝업 (D-UX3-53)', async () => {
        const verifyReplies: { status: number; body: unknown }[] = [
          { status: 400, body: { error: { code: 'CODE_WRONG', message: '인증번호가 맞지 않아요.' } } },
          { status: 429, body: { error: { code: 'CODE_LOCKED', message: '입력 횟수를 초과했어요\n처음부터 다시 시도해 주세요' } } },
          { status: 410, body: { error: { code: 'CODE_EXPIRED', message: '인증번호가 만료됐어요. 인증번호를 다시 받아 주세요.' } } },
        ]
        const sends: string[] = []
        installQueue([`livejjim://auth?ticket=${T1}&provider=google`], {})
        configureApi({
          baseUrl: 'https://livegenie.test',
          fetch: async (input) => {
            const url = String(input)
            const path = new URL(url).pathname
            if (path === '/api/auth/signup/phone/verify') {
              const next = verifyReplies.shift() ?? verifyReplies[0]
              return new Response(JSON.stringify(next?.body ?? {}), { status: next?.status ?? 500, headers: { 'Content-Type': 'application/json' } })
            }
            if (path === '/api/auth/signup/phone') sends.push(path)
            const reply = path === '/api/auth/app/finish' ? { result: 'SIGNUP', provider: 'google', phoneRequired: true } : path === '/api/auth/signup/phone' ? { phone: '010-****-5678' } : url.endsWith('/api/client-config') ? { loginProviders: ['kakao', 'naver', 'google'] } : undefined
            return new Response(JSON.stringify(reply ?? {}), { status: reply === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } })
          },
        })
        render(<LoginScreen expired={false} onLogin={async () => {}} />)
        fireEvent.click(await screen.findByRole('button', { name: '구글로 로그인' }))
        fireEvent.change(await screen.findByLabelText('휴대폰 번호'), { target: { value: '010-1234-5678' } })
        fireEvent.click(screen.getByRole('button', { name: '다음' }))
        // 틀림: 남은 횟수 없이 한 줄, 앞에 느낌표 그림
        fireEvent.change(await screen.findByLabelText('인증번호 6자리'), { target: { value: '000000' } })
        const alert = await screen.findByRole('alert')
        expect(alert.textContent).toBe('인증번호가 맞지 않아요.')
        expect(alert.querySelector('[aria-hidden="true"]')).not.toBeNull()
        // 횟수 초과: 팝업
        fireEvent.change(screen.getByLabelText('인증번호 6자리'), { target: { value: '00000' } })
        fireEvent.change(screen.getByLabelText('인증번호 6자리'), { target: { value: '000001' } })
        const locked = await screen.findByRole('alertdialog')
        expect(locked.textContent).toContain('입력 횟수를 초과했어요')
        expect(locked.textContent).toContain('처음부터 다시 시도해 주세요')
        expect(screen.getByTestId('code-wrong')).toBeTruthy()
        fireEvent.click(within(locked).getByRole('button', { name: '닫기' }))
        await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
        // D-UX3-55로 바뀐 기대 (사용자 지시 2026-11-07 "입력횟수 초과 … 닫기를 누르면 그 화면에 남는게 아니라 이전 화면으로"):
        // 옛 — 인증번호 화면에 남아 다시 넣기 → 새 — 넣었던 번호가 남은 번호 화면으로 밀려 돌아간다
        const phone = (await screen.findByLabelText('휴대폰 번호')) as HTMLInputElement
        expect(phone.value).toBe('010-1234-5678')
        expect(screen.queryByLabelText('인증번호 6자리')).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: '다음' }))
        // 시간 지남(서버 판정): 팝업 "입력할 수 있는 시간이 지났어요" / "문자를 다시 받을까요?"
        fireEvent.change(await screen.findByLabelText('인증번호 6자리'), { target: { value: '000002' } })
        const over = await screen.findByRole('alertdialog')
        expect(over.textContent).toContain('입력할 수 있는 시간이 지났어요')
        expect(over.textContent).toContain('문자를 다시 받을까요?')
        expect(sends).toHaveLength(2)
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
        // D-UX3-49·50: 11자리를 넣고 [다음], 6자리가 차면 바로 확인, "인증 성공" 2초 뒤 있는 계정 안내
        fireEvent.change(await screen.findByLabelText('휴대폰 번호'), { target: { value: '01055556666' } })
        fireEvent.click(screen.getByRole('button', { name: '다음' }))
        fireEvent.change(await screen.findByLabelText('인증번호 6자리'), { target: { value: '654321' } })
        expect(await screen.findByText('이미 가입한 계정이 있어요', undefined, { timeout: 4000 })).toBeTruthy()
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
