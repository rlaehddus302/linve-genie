// AC-L1-20·21·22 화면 (로그인 화면 버튼·돌아온 결과 문장·설정 "로그인 방법"). 제목 @social → chromium-social 묶음(세 공급자).
// D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "AC-L1-23 보조자 설정에 로그인 방법 칸 없음·목록 API 안 부름·간편 로그인은 NOT_LINKED"를 뺐다
// 기대값은 acceptance.md에서 정했다.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectLanding } from '../lnd1/support.ts'
import {
  MSG,
  NAME,
  PROVIDERS,
  decideOnFakePage,
  fakeUser,
  linkFromSettings,
  loginAs,
  loginNewSeller,
  logout,
  methodsList,
  methodsRegion,
  pressContinue,
  whoAmI,
  type Provider,
} from './support.ts'

function luminance(rgb: string): number {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb)
  if (m === null) throw new Error(`색을 읽지 못함: ${rgb}`)
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((l1 ?? 0) + 0.05) / ((l2 ?? 0) + 0.05)
}

async function style(locator: Locator) {
  return await locator.evaluate((el) => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { bg: s.backgroundColor, color: s.color, borderColor: s.borderTopColor, borderWidth: s.borderTopWidth, fontSize: parseFloat(s.fontSize), width: r.width, height: r.height, parentWidth: (el.parentElement?.getBoundingClientRect().width ?? 0) }
  })
}

const continueButton = (page: Page, p: Provider) => page.getByRole('button', { name: `${NAME[p]}로 계속하기`, exact: true })

async function noHorizontalScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}

test.describe('AC-L1-20 로그인 화면 버튼 @social', () => {
  test('로그인 칸 그대로 위·아이디 커서 → "또는" → 카카오·네이버·구글 순 · 가입 없음 · 색·명암비 · 그림 없음 · PC 44px', async ({ page }) => {
    await page.goto('/login') // LND1 D-LND1-01
    await expect(page.getByLabel('아이디')).toBeFocused()
    await expect(continueButton(page, 'google')).toBeVisible()
    const order = await page.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim()))
    expect(order).toEqual(['로그인', '카카오로 계속하기', 'N네이버로 계속하기', '구글로 계속하기'])
    // 위에서부터: 로그인 버튼 → 또는 → 카카오 → 네이버 → 구글
    const tops = await Promise.all([page.getByRole('button', { name: '로그인', exact: true }), page.getByText('또는', { exact: true }), continueButton(page, 'kakao'), continueButton(page, 'naver'), continueButton(page, 'google')].map(async (l) => (await l.boundingBox())?.y ?? -1))
    expect([...tops].sort((a, b) => a - b)).toEqual(tops)
    await expect(page.getByText(/회원가입|가입하기/)).toHaveCount(0)
    await expect(page.locator('img, svg image')).toHaveCount(0)
    // 네이버 "N"은 읽는 이름 없음 (aria-hidden)
    await expect(continueButton(page, 'naver').locator('[aria-hidden="true"]')).toHaveText('N')

    await page.mouse.move(0, 0)
    const kakao = await style(continueButton(page, 'kakao'))
    expect(kakao.bg).toBe('rgb(254, 229, 0)')
    expect(kakao.color).toBe('rgb(25, 25, 25)')
    const naver = await style(continueButton(page, 'naver'))
    expect(naver.bg).toBe('rgb(255, 255, 255)')
    expect(naver.borderColor).toBe('rgb(3, 199, 90)')
    expect(naver.borderWidth).toBe('2px')
    expect(naver.color).toBe('rgb(31, 31, 31)')
    const mark = await style(continueButton(page, 'naver').locator('[aria-hidden="true"]'))
    expect(mark.bg).toBe('rgb(3, 199, 90)')
    expect(mark.color).toBe('rgb(255, 255, 255)')
    const google = await style(continueButton(page, 'google'))
    expect(google.bg).toBe('rgb(255, 255, 255)')
    expect(google.borderColor).toBe('rgb(116, 119, 117)')
    expect(google.borderWidth).toBe('1px')
    expect(google.color).toBe('rgb(31, 31, 31)')
    for (const s of [kakao, naver, google]) {
      expect(contrast(s.color, s.bg)).toBeGreaterThanOrEqual(4.5)
      expect(s.height).toBeGreaterThanOrEqual(44)
    }
  })

  test('Tab 순서: 아이디 → 비밀번호 → 로그인 → 카카오 → 네이버 → 구글 → 정책 링크', async ({ page }) => {
    await page.goto('/login') // LND1 D-LND1-01
    await expect(continueButton(page, 'google')).toBeVisible()
    await expect(page.getByLabel('아이디')).toBeFocused()
    const names: string[] = []
    for (let i = 0; i < 7; i++) { // LND1 D-LND1-10: /login엔 정책 링크 위에 "처음 화면으로"가 하나 더 있다
      await page.keyboard.press('Tab')
      names.push(await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (el === null) return ''
        if (el instanceof HTMLInputElement) return el.labels?.[0]?.textContent?.trim() ?? el.name
        return (el.getAttribute('aria-label') ?? el.innerText).replace(/\s+/g, '').trim()
      }))
    }
    expect(names).toEqual(['비밀번호', '로그인', '카카오로계속하기', 'N네이버로계속하기', '구글로계속하기', '처음화면으로', '개인정보처리방침']) // LND1 D-LND1-10
  })

  test('휴대폰 폭(390): 버튼 폭 가득·44px 이상·글 16px 이상·가로 스크롤 없음', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const page = await ctx.newPage()
    await page.goto('/login') // LND1 D-LND1-01
    await expect(continueButton(page, 'google')).toBeVisible()
    const idWidth = (await page.getByLabel('아이디').boundingBox())?.width ?? 0
    for (const p of PROVIDERS) {
      const s = await style(continueButton(page, p))
      expect(s.height, p).toBeGreaterThanOrEqual(44)
      expect(s.fontSize, p).toBeGreaterThanOrEqual(16)
      expect(Math.abs(s.width - s.parentWidth), p).toBeLessThanOrEqual(1)
      expect(s.width, p).toBeGreaterThanOrEqual(idWidth - 1)
    }
    await noHorizontalScroll(page)
    await ctx.close()
  })

  test('누르면 버튼 셋이 잠기고 누른 버튼이 "카카오로 이동하는 중…" → 같은 탭으로 승인 화면 · 두 번 눌러도 시작 요청 하나', async ({ page }) => {
    await page.goto('/login') // LND1 D-LND1-01
    await expect(continueButton(page, 'kakao')).toBeVisible()
    let release: () => void = () => undefined
    const held = new Promise<void>((r) => {
      release = r
    })
    const starts: string[] = []
    await page.route('**/api/auth/start', async (route) => {
      starts.push(route.request().postData() ?? '')
      await held
      await route.continue()
    })
    await continueButton(page, 'kakao').click()
    await expect(page.getByRole('button', { name: '카카오로 이동하는 중…' })).toBeDisabled()
    await expect(continueButton(page, 'naver')).toBeDisabled()
    await expect(continueButton(page, 'google')).toBeDisabled()
    await page.getByRole('button', { name: '카카오로 이동하는 중…' }).click({ force: true })
    await continueButton(page, 'naver').click({ force: true })
    release()
    await expect(page).toHaveURL(/\/kakao\/authorize\?/)
    expect(starts).toHaveLength(1)
    expect(JSON.parse(starts[0] ?? '{}')).toEqual({ provider: 'kakao' })
    expect(page.context().pages()).toHaveLength(1)
  })

  test('시작 요청이 실패하면 잠금이 풀리고 버튼 아래에 문장 (본문 없음 → 정한 문장, 서버 문장 → 그대로)', async ({ page }) => {
    await page.goto('/login') // LND1 D-LND1-01
    await expect(continueButton(page, 'naver')).toBeVisible()
    await page.route('**/api/auth/start', (route) => route.fulfill({ status: 502, body: '' }))
    await continueButton(page, 'naver').click()
    await expect(page.getByRole('alert')).toHaveText(MSG.START_FAILED)
    for (const p of PROVIDERS) await expect(continueButton(page, p)).toBeEnabled()
    // 알림은 버튼 아래
    const alertTop = (await page.getByRole('alert').boundingBox())?.y ?? 0
    const googleTop = (await continueButton(page, 'google').boundingBox())?.y ?? 0
    expect(alertTop).toBeGreaterThan(googleTop)
    await page.unroute('**/api/auth/start')
    await page.route('**/api/auth/start', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'LOGIN_RATE_LIMITED', message: MSG.RATE_LIMITED } }) }))
    await continueButton(page, 'google').click()
    await expect(page.getByRole('alert')).toHaveText(MSG.RATE_LIMITED)
    await expect(continueButton(page, 'google')).toBeEnabled()
    await expect(page).toHaveURL(/\/login$/) // LND1 D-LND1-01 (로그인 화면 주소 그대로)
  })

  test('공급자 화면에서 브라우저 "뒤로" → 로그인 화면 버튼이 다시 눌린다', async ({ page }) => {
    await page.goto('/login') // LND1 D-LND1-01
    await pressContinue(page, 'google')
    await page.goBack()
    await expect(page.getByLabel('아이디')).toBeVisible()
    for (const p of PROVIDERS) await expect(continueButton(page, p)).toBeEnabled()
    await expect(page.getByText('구글로 이동하는 중…')).toHaveCount(0)
  })
})

test.describe('AC-L1-21 돌아온 결과 문장 @social', () => {
  const cases: [string, Provider, string][] = [
    ['CANCELLED', 'naver', MSG.CANCELLED('naver')],
    ['EXPIRED', 'google', MSG.EXPIRED],
    ['NOT_LINKED', 'kakao', MSG.NOT_LINKED('kakao')],
    ['PROVIDER_ERROR', 'naver', MSG.PROVIDER_ERROR('naver')],
    ['RATE_LIMITED', 'kakao', MSG.RATE_LIMITED],
    ['SESSION_GONE', 'google', MSG.SESSION_GONE],
  ]
  for (const [code, provider, text] of cases) {
    test(`로그인 화면 ?login=${code}&provider=${provider} → 문장 한 번(alert) · 주소에서 지움 · 새로 고침하면 없음 · 아이디 커서`, async ({ page }) => {
      await page.goto(`/?login=${code}&provider=${provider}`)
      await expect(page.getByRole('alert')).toHaveText(text)
      await expect(page.getByText(text)).toHaveCount(1)
      await expect(page.getByLabel('아이디')).toBeFocused()
      await expect(page).toHaveURL(/\/$/)
      await page.reload()
      // LND1 D-LND1-02: 새로고침한 '/'는 소개 화면 — 문장은 거기에도, 로그인 화면(/login)에도 없다
      await expectLanding(page) // LND1 SA-LND1-01: 소개 화면에만 있는 절·한 줄 소개·"시작하기" + 아이디 칸 없음 (h1만으로는 로그인 화면과 구별 안 됨)
      await expect(page.getByText(text)).toHaveCount(0)
      await page.goto('/login') // LND1 D-LND1-01
      await expect(page.getByLabel('아이디')).toBeFocused()
      await expect(page.getByRole('alert')).toHaveCount(0)
    })
  }

  test('모르는 코드·모르는 공급자·HTML·스크립트·긴 글 → 아무 문장도 없고 주소 글이 화면에 없다', async ({ page }) => {
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    const long = 'A'.repeat(5000)
    const bad = [
      '?login=HACKED&provider=kakao',
      '?login=CANCELLED&provider=facebook',
      '?login=CANCELLED&provider=Kakao',
      '?login=cancelled&provider=kakao',
      `?login=${encodeURIComponent('<img src=x onerror=alert(1)>')}&provider=kakao`,
      `?login=CANCELLED&provider=${encodeURIComponent('<script>alert(1)</script>')}`,
      `?login=${long}&provider=naver`,
      '?login=LINKED&provider=kakao', // 설정 화면의 성공 코드는 로그인 화면에 보이지 않는다
      '?login=%20CANCELLED&provider=kakao',
      '?login=CANCELLED&provider=kakao%00',
    ]
    for (const q of bad) {
      await page.goto(`/${q}`)
      await expect(page.getByLabel('아이디')).toBeFocused()
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.getByRole('status')).toHaveCount(0)
      const body = await page.locator('body').innerText()
      expect(body, q).not.toContain('HACKED')
      expect(body, q).not.toContain('<img')
      expect(body, q).not.toContain('script')
      expect(body, q).not.toContain('facebook')
      expect(body, q).not.toContain('AAAAAAAAAA')
      expect(new URL(page.url()).searchParams.has('login'), q).toBe(false)
    }
    expect(dialogs).toEqual([])
  })

  test('설정 ?login=<코드> — 설정 코드만 그 칸에 보인다(LINKED=status, LINKED_ELSEWHERE=alert), 로그인 화면 코드(NOT_LINKED)는 없음', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings?login=LINKED_ELSEWHERE&provider=naver')
    await expect(methodsRegion(page).getByRole('alert')).toHaveText(MSG.LINKED_ELSEWHERE('naver'))
    await expect(page).toHaveURL(/\/settings$/)
    await page.goto('/settings?login=ALREADY_LINKED&provider=google')
    await expect(methodsRegion(page).getByRole('alert')).toHaveText(MSG.ALREADY_LINKED('google'))
    await page.goto('/settings?login=NOT_LINKED&provider=kakao')
    await expect(methodsList(page)).toBeVisible()
    await expect(page.getByText(MSG.NOT_LINKED('kakao'))).toHaveCount(0)
    await expect(page).toHaveURL(/\/settings$/)
    await page.goto(`/settings?login=${encodeURIComponent('<b>x</b>')}&provider=kakao`)
    await expect(methodsList(page)).toBeVisible()
    await expect(methodsRegion(page).getByRole('alert')).toHaveCount(0)
    await expect(methodsRegion(page).getByRole('status')).toHaveCount(0)
    await expect(page).toHaveURL(/\/settings$/)
  })

  test('로그인한 채 /?login=NOT_LINKED → 문장 없이 홈, 주소만 지움', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/?login=NOT_LINKED&provider=kakao')
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await expect(page.getByText(MSG.NOT_LINKED('kakao'))).toHaveCount(0)
    await expect(page).toHaveURL(/\/$/)
  })

  for (const [code, provider, text] of [['SESSION_GONE', 'kakao', MSG.SESSION_GONE], ['RATE_LIMITED', 'naver', MSG.RATE_LIMITED]] as const) {
    test(`TE-L1-001: 로그인한 채 /?login=${code}&provider=${provider} → 위 알림으로 같은 문장 한 번 · 주소에서 지움 · [닫기]로 사라짐 · 새로 고침하면 없음`, async ({ page }) => {
      await loginNewSeller(page)
      await page.goto(`/?login=${code}&provider=${provider}`)
      await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
      await expect(page.getByRole('alert')).toHaveText(text)
      await expect(page.getByText(text)).toHaveCount(1)
      await expect(page).toHaveURL(/\/$/)
      await page.getByRole('button', { name: '닫기' }).click()
      await expect(page.getByText(text)).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
      await expect(page.getByText(text)).toHaveCount(0)
    })
  }
})

test.describe('AC-L1-22 설정 "로그인 방법" @social', () => {
  test('첫 줄 아이디 로그인(끄는 버튼 없음) → 카카오·네이버·구글 순 "연결 안 됨"+[연결하기] · 휴대폰 폭 버튼 44px', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const page = await ctx.newPage()
    const seller = await loginNewSeller(page)
    await page.goto('/settings')
    const items = methodsList(page).getByRole('listitem')
    await expect(items).toHaveText([`아이디 로그인 · 아이디 ${seller.loginId} · 늘 켜져 있어요`, '카카오 · 연결 안 됨연결하기', '네이버 · 연결 안 됨연결하기', '구글 · 연결 안 됨연결하기'])
    await expect(items.first().getByRole('button')).toHaveCount(0)
    for (const p of PROVIDERS) {
      const box = await methodsRegion(page).getByRole('button', { name: `${NAME[p]} 연결하기` }).boundingBox()
      expect(box?.height ?? 0, p).toBeGreaterThanOrEqual(44)
      expect(box?.width ?? 0, p).toBeGreaterThanOrEqual(44)
    }
    await noHorizontalScroll(page)
    await ctx.close()
  })

  test('[연결하기] → 버튼 잠기고 "카카오로 이동하는 중…" → 승인 → /settings 결과 문장과 새 목록', async ({ page }) => {
    await loginNewSeller(page)
    const user = await fakeUser(page.request, 'kakao', { email: 'ab@naver.com' })
    await page.goto('/settings')
    let release: () => void = () => undefined
    const held = new Promise<void>((r) => {
      release = r
    })
    await page.route('**/api/auth/link', async (route) => {
      await held
      await route.continue()
    })
    await methodsRegion(page).getByRole('button', { name: '카카오 연결하기' }).click()
    await expect(methodsRegion(page).getByRole('button', { name: '카카오로 이동하는 중…' })).toBeDisabled()
    await expect(methodsRegion(page).getByRole('button', { name: '네이버 연결하기' })).toBeDisabled()
    release()
    await decideOnFakePage(page, 'kakao', user)
    await expect(page).toHaveURL(/\/settings$/)
    await expect(methodsRegion(page).getByRole('status').filter({ hasText: MSG.LINKED('kakao') })).toBeVisible()
    await expect(methodsList(page).getByRole('listitem').nth(1)).toContainText('카카오 · a***@naver.com · ')
  })

  test('끊기 확인 창: 기본 포커스 그만두기 · Esc = 그만두기(그대로 연결) · [그만두기]도 그대로', async ({ page }) => {
    await loginNewSeller(page)
    await linkFromSettings(page, 'naver', await fakeUser(page.request, 'naver'))
    const unlink = methodsRegion(page).getByRole('button', { name: '네이버 연결 끊기' })
    await unlink.click()
    const dialog = page.getByRole('dialog', { name: '네이버 연결 끊기' })
    await expect(dialog.getByRole('button', { name: '그만두기' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(unlink).toBeVisible()
    await unlink.click()
    await dialog.getByRole('button', { name: '그만두기' }).click()
    await expect(dialog).toHaveCount(0)
    const methods = await (await page.request.get('/api/auth/methods')).json() as { providers: { provider: string; linked: boolean }[] }
    expect(methods.providers.find((p) => p.provider === 'naver')?.linked).toBe(true)
  })

  test('다른 판매자에 연결된 계정 → LINKED_ELSEWHERE(B에 관한 글 없음) · 다른 계정 더 연결 → ALREADY_LINKED · 같은 계정 다시 → LINKED', async ({ page, browser, baseURL }) => {
    const a = await loginNewSeller(page)
    const u1 = await fakeUser(page.request, 'google', { email: 'first.user@gmail.com' })
    await linkFromSettings(page, 'google', u1)

    // B가 A의 구글 계정으로 연결 시도
    const ctx = await browser.newContext({ baseURL })
    const b = await ctx.newPage()
    await loginNewSeller(b)
    await b.goto('/settings')
    await methodsRegion(b).getByRole('button', { name: '구글 연결하기' }).click()
    await decideOnFakePage(b, 'google', u1)
    await expect(methodsRegion(b).getByRole('alert')).toHaveText(MSG.LINKED_ELSEWHERE('google'))
    await expect(methodsList(b).getByRole('listitem').filter({ hasText: '구글' })).toHaveText('구글 · 연결 안 됨연결하기')
    const bBody = await b.locator('body').innerText()
    expect(bBody).not.toContain(a.loginId)
    expect(bBody).not.toContain(a.shopName)
    await ctx.close()

    // A에 다른 구글 계정 더 (화면엔 [연결하기]가 없으니 연결 시작을 직접 부른다)
    const u2 = await fakeUser(page.request, 'google', { email: 'second.user@gmail.com' })
    const origin = new URL(page.url()).origin
    const start = await page.request.post('/api/auth/link', { data: { provider: 'google' }, headers: { Origin: origin } })
    expect(start.status()).toBe(200)
    await page.goto((await start.json() as { authorizeUrl: string }).authorizeUrl)
    await decideOnFakePage(page, 'google', u2)
    await expect(methodsRegion(page).getByRole('alert')).toHaveText(MSG.ALREADY_LINKED('google'))
    await expect(methodsList(page).getByRole('listitem').filter({ hasText: '구글' })).toContainText('fi***@gmail.com')

    // 같은 계정 다시 연결 → LINKED (오류 아님)
    const again = await page.request.post('/api/auth/link', { data: { provider: 'google' }, headers: { Origin: origin } })
    await page.goto((await again.json() as { authorizeUrl: string }).authorizeUrl)
    await decideOnFakePage(page, 'google', u1)
    await expect(methodsRegion(page).getByRole('status').filter({ hasText: MSG.LINKED('google') })).toBeVisible()
    await expect(methodsRegion(page).getByRole('alert')).toHaveCount(0)
  })

  test('연결 도중 로그아웃 → SESSION_GONE 문장이 로그인 화면에, 아이디 커서 · 아무것도 연결되지 않음', async ({ page }) => {
    const seller = await loginNewSeller(page)
    const user = await fakeUser(page.request, 'kakao')
    await page.goto('/settings')
    const origin = new URL(page.url()).origin
    await methodsRegion(page).getByRole('button', { name: '카카오 연결하기' }).click()
    await expect(page).toHaveURL(/\/kakao\/authorize\?/)
    const out = await page.request.post(`${origin}/api/logout`, { data: {}, headers: { Origin: origin } })
    expect(out.ok()).toBe(true)
    await decideOnFakePage(page, 'kakao', user)
    await expect(page.getByRole('alert')).toHaveText(MSG.SESSION_GONE)
    await expect(page.getByLabel('아이디')).toBeFocused()
    await expect(page).toHaveURL(/\/$/)
    await loginAs(page, seller, '/settings')
    await expect(methodsList(page).getByRole('listitem').filter({ hasText: '카카오' })).toHaveText('카카오 · 연결 안 됨연결하기')
    // 그 사용자로 로그인하면 NOT_LINKED
    await logout(page)
    await pressContinue(page, 'kakao')
    await decideOnFakePage(page, 'kakao', user)
    await expect(page.getByRole('alert')).toHaveText(MSG.NOT_LINKED('kakao'))
  })

  test('다른 기기(같은 판매자)에서 연결·끊으면 열린 설정 화면의 목록이 새로 읽힌다 (실시간 login 알림)', async ({ page, browser, baseURL }) => {
    const seller = await loginNewSeller(page)
    await page.goto('/settings')
    const row = methodsList(page).getByRole('listitem').filter({ hasText: '네이버' })
    await expect(row).toHaveText('네이버 · 연결 안 됨연결하기')
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const phone = await ctx.newPage()
    await loginAs(phone, seller, '/settings')
    const user = await fakeUser(page.request, 'naver', { email: 'phone.user@naver.com' })
    await linkFromSettings(phone, 'naver', user)
    await expect(row).toContainText('네이버 · ph***@naver.com · ')
    await methodsRegion(phone).getByRole('button', { name: '네이버 연결 끊기' }).click()
    await phone.getByRole('dialog', { name: '네이버 연결 끊기' }).getByRole('button', { name: '연결 끊기' }).click()
    await expect(row).toHaveText('네이버 · 연결 안 됨연결하기')
    // 끊긴 쪽(PC)에서 이미 끊긴 줄을 끊으려 해도 오류 없이 같은 결과
    await ctx.close()
  })

  test('이미 다른 기기에서 끊긴 연결을 끊으면 창이 닫히고 "끊었어요" + 목록 새로 읽음', async ({ page, browser, baseURL }) => {
    const seller = await loginNewSeller(page)
    await linkFromSettings(page, 'kakao', await fakeUser(page.request, 'kakao'))
    // 실시간 알림이 오기 전에 누른 경우를 흉내 낸다: 다른 기기가 끊는 동안 이 화면은 실시간 알림을 받지 못한다
    await page.route('**/api/stream**', (route) => route.abort())
    await page.reload()
    await expect(methodsRegion(page).getByRole('button', { name: '카카오 연결 끊기' })).toBeVisible()
    const ctx = await browser.newContext({ baseURL })
    const other = await ctx.newPage()
    await loginAs(other, seller, '/settings')
    await methodsRegion(other).getByRole('button', { name: '카카오 연결 끊기' }).click()
    await other.getByRole('dialog', { name: '카카오 연결 끊기' }).getByRole('button', { name: '연결 끊기' }).click()
    await expect(methodsRegion(other).getByRole('status').filter({ hasText: MSG.UNLINKED('kakao') })).toBeVisible()
    await ctx.close()
    await methodsRegion(page).getByRole('button', { name: '카카오 연결 끊기' }).click()
    await page.getByRole('dialog', { name: '카카오 연결 끊기' }).getByRole('button', { name: '연결 끊기' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(methodsRegion(page).getByRole('status').filter({ hasText: MSG.UNLINKED('kakao') })).toBeVisible()
    await expect(methodsList(page).getByRole('listitem').filter({ hasText: '카카오' })).toHaveText('카카오 · 연결 안 됨연결하기')
  })
})

test.describe('AC-L1-30 휴대폰 크기(390×844)에서 1·2 @social', () => {
  for (const provider of PROVIDERS) {
    test(`${NAME[provider]}: 처음 연결 → 로그아웃 → 계속하기 → 홈 (버튼 크기)`, async ({ browser, baseURL }) => {
      const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
      const page = await ctx.newPage()
      const seller = await loginNewSeller(page)
      const user = await fakeUser(page.request, provider)
      await page.goto('/settings')
      const linkButton = methodsRegion(page).getByRole('button', { name: `${NAME[provider]} 연결하기` })
      expect((await linkButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
      await linkButton.tap()
      await decideOnFakePage(page, provider, user)
      await expect(methodsRegion(page).getByRole('status').filter({ hasText: MSG.LINKED(provider) })).toBeVisible()
      await noHorizontalScroll(page)
      // [연결 끊기]와 확인 창 버튼도 44px 이상 (AC-L1-22 휴대폰 폭)
      const unlinkButton = methodsRegion(page).getByRole('button', { name: `${NAME[provider]} 연결 끊기` })
      expect((await unlinkButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
      await unlinkButton.tap()
      const dialog = page.getByRole('dialog', { name: `${NAME[provider]} 연결 끊기` })
      for (const name of ['연결 끊기', '그만두기']) expect((await dialog.getByRole('button', { name, exact: true }).boundingBox())?.height ?? 0, name).toBeGreaterThanOrEqual(44)
      await dialog.getByRole('button', { name: '그만두기', exact: true }).tap()
      await expect(dialog).toHaveCount(0)
      await logout(page)
      const button = continueButton(page, provider)
      const s = await style(button)
      expect(s.height).toBeGreaterThanOrEqual(44)
      expect(s.fontSize).toBeGreaterThanOrEqual(16)
      await button.tap()
      await decideOnFakePage(page, provider, user)
      await expect(page.getByRole('banner')).toContainText(seller.shopName)
      expect((await whoAmI(page.request)).loginId).toBe(seller.loginId)
      await noHorizontalScroll(page)
      await ctx.close()
    })
  }
})

test.describe('AC-L1-22 돌아온 결과가 보이는 곳 @social', () => {
  test('휴대폰 폭에서 연결하고 돌아오면 결과 문장이 화면 안에 보인다 — 설정의 위 칸들이 로그인 방법보다 늦게 불러와져도', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const page = await ctx.newPage()
    await loginNewSeller(page)
    const user = await fakeUser(page.request, 'kakao')
    await page.goto('/settings')
    await methodsRegion(page).getByRole('button', { name: '카카오 연결하기' }).click()
    // 돌아온 설정 화면에서 판매 설정(/api/settings)이 로그인 방법 목록보다 늦게 오게 한다
    let release: () => void = () => undefined
    const held = new Promise<void>((r) => {
      release = r
    })
    await page.route('**/api/settings', async (route) => {
      await held
      await route.continue()
    })
    const methodsLoaded = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/methods')
    await decideOnFakePage(page, 'kakao', user)
    await methodsLoaded
    const notice = methodsRegion(page).getByRole('status').filter({ hasText: MSG.LINKED('kakao') })
    await expect(notice).toBeInViewport()
    release()
    // 위 칸(판매 설정)이 그려진 뒤에도 결과 문장은 화면 안
    await expect(page.getByRole('region', { name: '판매 규칙', exact: true })).toBeAttached()
    await expect(notice).toBeInViewport()
    await ctx.close()
  })
})
