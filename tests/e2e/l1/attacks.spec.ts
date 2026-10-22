// L1 흐름 깨뜨리기 (test-e2e 라운드 0): 끊기와 세션·실시간 연결, 잠긴 아이디, 공급자 실패·느림, 쿠키, 다른 판매자로 옮겨 연결.
// 제목 @social → chromium-social 묶음. 기대값은 acceptance.md(AC-L1-04~08·20~22)에서 정했다.
import { expect, test } from '@playwright/test'
import {
  MSG,
  NAME,
  decideOnFakePage,
  expectLoggedOut,
  fakeControl,
  fakeUser,
  linkFromSettings,
  loginAs,
  loginNewSeller,
  logout,
  methodsList,
  methodsRegion,
  pressContinue,
  whoAmI,
} from './support.ts'

test.describe('L1 깨뜨리기 @social', () => {
  test('카카오로 로그인한 지금 화면에서 카카오를 끊으면 지금 세션은 남고, 카카오로 로그인한 다른 문맥은 다음 요청에서 로그인 화면, 아이디로 로그인한 문맥은 그대로', async ({ page, browser, baseURL }) => {
    const seller = await loginNewSeller(page)
    const user = await fakeUser(page.request, 'kakao')
    await linkFromSettings(page, 'kakao', user)
    // 지금 화면도 카카오 세션으로 바꾼다
    await logout(page)
    await pressContinue(page, 'kakao')
    await decideOnFakePage(page, 'kakao', user)
    await expect(page.getByRole('banner')).toContainText(seller.shopName)

    const kakaoCtx = await browser.newContext({ baseURL })
    const kakaoPage = await kakaoCtx.newPage()
    await kakaoPage.goto('/')
    await pressContinue(kakaoPage, 'kakao')
    await decideOnFakePage(kakaoPage, 'kakao', user)
    await expect(kakaoPage.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await kakaoPage.goto('/settings')
    await expect(methodsList(kakaoPage)).toBeVisible()

    const pwCtx = await browser.newContext({ baseURL })
    const pwPage = await pwCtx.newPage()
    await loginAs(pwPage, seller)

    await page.goto('/settings')
    await methodsRegion(page).getByRole('button', { name: '카카오 연결 끊기' }).click()
    await page.getByRole('dialog', { name: '카카오 연결 끊기' }).getByRole('button', { name: '연결 끊기' }).click()
    await expect(methodsRegion(page).getByRole('status').filter({ hasText: MSG.UNLINKED('kakao') })).toBeVisible()

    // 다른 카카오 세션은 지워졌다 — 열린 화면은 다음 요청에서 로그인 화면 "로그인이 풀렸어요…" (AC-L1-07·30 10)
    expect((await whoAmI(kakaoPage.request)).status).toBe(401)
    await kakaoPage.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자' }).click()
    await expect(kakaoPage.getByText(MSG.SESSION_EXPIRED)).toBeVisible()
    await expectLoggedOut(kakaoPage)
    // 지금 세션(카카오로 만든 것)은 남는다
    await page.reload()
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
    expect((await whoAmI(page.request)).loginId).toBe(seller.loginId)
    // 아이디 세션은 그대로
    expect((await whoAmI(pwPage.request)).loginId).toBe(seller.loginId)
    await pwPage.reload()
    await expect(pwPage.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await Promise.all([kakaoCtx.close(), pwCtx.close()])
  })

  test('끊은 뒤 다른 판매자가 그 공급자 계정을 새로 연결할 수 있고, 그 계정의 로그인은 새 판매자로 들어간다', async ({ page, browser, baseURL }) => {
    const a = await loginNewSeller(page)
    const user = await fakeUser(page.request, 'naver')
    await linkFromSettings(page, 'naver', user)
    await methodsRegion(page).getByRole('button', { name: '네이버 연결 끊기' }).click()
    await page.getByRole('dialog', { name: '네이버 연결 끊기' }).getByRole('button', { name: '연결 끊기' }).click()
    await expect(methodsRegion(page).getByRole('status').filter({ hasText: MSG.UNLINKED('naver') })).toBeVisible()

    const ctx = await browser.newContext({ baseURL })
    const b = await ctx.newPage()
    const sellerB = await loginNewSeller(b)
    await linkFromSettings(b, 'naver', user)
    await logout(b)
    await pressContinue(b, 'naver')
    await decideOnFakePage(b, 'naver', user)
    await expect(b.getByRole('banner')).toContainText(sellerB.shopName)
    await expect(b.getByRole('banner')).not.toContainText(a.shopName)
    expect((await whoAmI(b.request)).loginId).toBe(sellerB.loginId)
    await ctx.close()
  })

  test('아이디가 잠긴(같은 아이디 10번 틀림) 판매자도 연결한 구글로는 로그인된다', async ({ page, browser, baseURL }) => {
    const seller = await loginNewSeller(page)
    const user = await fakeUser(page.request, 'google')
    await linkFromSettings(page, 'google', user)
    const ctx = await browser.newContext({ baseURL })
    const p = await ctx.newPage()
    await p.goto('/')
    const origin = new URL(p.url()).origin
    for (let i = 0; i < 10; i++) {
      const res = await p.request.post('/api/login', { data: { loginId: seller.loginId, password: `wrong-${String(i)}` }, headers: { Origin: origin } })
      expect(res.status()).toBeGreaterThanOrEqual(400)
    }
    const locked = await p.request.post('/api/login', { data: { loginId: seller.loginId, password: seller.password }, headers: { Origin: origin } })
    expect(locked.ok(), '잠금이 걸려야 시험이 뜻이 있다').toBe(false)
    await pressContinue(p, 'google')
    await decideOnFakePage(p, 'google', user)
    await expect(p.getByRole('banner')).toContainText(seller.shopName)
    // 이미 로그인한 세션(아이디)은 그대로
    expect((await whoAmI(page.request)).loginId).toBe(seller.loginId)
    await ctx.close()
  })

  test('간편 로그인 세션 쿠키는 아이디 로그인과 같다(lj_session HttpOnly·Secure·SameSite=Lax·30일) · 확인 쿠키 lj_oauth는 /api/auth 경로·돌아오면 지워짐', async ({ page, browser, baseURL }) => {
    await loginNewSeller(page)
    const user = await fakeUser(page.request, 'kakao')
    await linkFromSettings(page, 'kakao', user)
    const pwCookie = (await page.context().cookies()).find((c) => c.name === 'lj_session')
    const ctx = await browser.newContext({ baseURL })
    const p = await ctx.newPage()
    await p.goto('/')
    await pressContinue(p, 'kakao')
    const oauth = (await ctx.cookies()).find((c) => c.name === 'lj_oauth')
    expect(oauth?.path).toBe('/api/auth')
    expect(oauth?.httpOnly).toBe(true)
    expect(oauth?.secure).toBe(true)
    expect(oauth?.sameSite).toBe('Lax')
    const tenMin = Date.now() / 1000 + 600
    expect(Math.abs((oauth?.expires ?? 0) - tenMin)).toBeLessThan(120)
    await decideOnFakePage(p, 'kakao', user)
    await expect(p.getByRole('button', { name: '로그아웃' })).toBeVisible()
    const cookies = await ctx.cookies()
    expect(cookies.find((c) => c.name === 'lj_oauth')).toBeUndefined()
    const session = cookies.find((c) => c.name === 'lj_session')
    expect(session?.httpOnly).toBe(true)
    expect(session?.secure).toBe(true)
    expect(session?.sameSite).toBe('Lax')
    expect(session?.path).toBe(pwCookie?.path)
    expect(Math.abs((session?.expires ?? 0) - (Date.now() / 1000 + 30 * 86_400))).toBeLessThan(3600)
    // 간편 로그인 세션으로 로그아웃 → 로그인 화면
    await logout(p)
    expect((await whoAmI(p.request)).status).toBe(401)
    await ctx.close()
  })

  test('연결 중 취소 → 설정 칸에 CANCELLED 문장 · 교환 실패(5xx) → PROVIDER_ERROR · 아무것도 연결되지 않음', async ({ page }) => {
    await loginNewSeller(page)
    const user = await fakeUser(page.request, 'naver')
    await page.goto('/settings')
    await methodsRegion(page).getByRole('button', { name: '네이버 연결하기' }).click()
    await decideOnFakePage(page, 'naver', user, 'cancel')
    await expect(page).toHaveURL(/\/settings$/)
    await expect(methodsRegion(page).getByRole('alert')).toHaveText(MSG.CANCELLED('naver'))
    await fakeControl(page.request, '/_fake/fail', { provider: 'naver', step: 'token', status: 503, times: 1 })
    await methodsRegion(page).getByRole('button', { name: '네이버 연결하기' }).click()
    await decideOnFakePage(page, 'naver', user)
    await expect(methodsRegion(page).getByRole('alert')).toHaveText(MSG.PROVIDER_ERROR('naver'))
    await expect(methodsList(page).getByRole('listitem').filter({ hasText: '네이버' })).toHaveText('네이버 · 연결 안 됨연결하기')
  })

  for (const fault of [
    { step: 'userinfo', shape: 'missing_id' },
    { step: 'userinfo', status: 401 },
    { step: 'token', error: 'invalid_grant' },
    { step: 'token', shape: 'not_json' },
  ] as const) {
    test(`연결된 카카오 계정이어도 공급자 ${fault.step} 실패(${JSON.stringify(fault)}) → 로그인 화면 PROVIDER_ERROR, 로그인되지 않음`, async ({ page, browser, baseURL }) => {
      await loginNewSeller(page)
      const user = await fakeUser(page.request, 'kakao')
      await linkFromSettings(page, 'kakao', user)
      const ctx = await browser.newContext({ baseURL })
      const p = await ctx.newPage()
      await p.goto('/')
      await pressContinue(p, 'kakao')
      await fakeControl(p.request, '/_fake/fail', { provider: 'kakao', ...fault, times: 1 })
      await decideOnFakePage(p, 'kakao', user)
      await expect(p.getByRole('alert')).toHaveText(MSG.PROVIDER_ERROR('kakao'))
      await expectLoggedOut(p)
      expect((await whoAmI(p.request)).status).toBe(401)
      await ctx.close()
    })
  }

  test('느린 공급자(교환 12초) → 10초 시간 제한으로 PROVIDER_ERROR, 로그인되지 않음 · 그동안 다른 화면은 응답한다', async ({ page, browser, baseURL }) => {
    test.setTimeout(60_000)
    const seller = await loginNewSeller(page)
    const user = await fakeUser(page.request, 'google')
    await linkFromSettings(page, 'google', user)
    const ctx = await browser.newContext({ baseURL })
    const p = await ctx.newPage()
    await p.goto('/')
    await pressContinue(p, 'google')
    await fakeControl(p.request, '/_fake/fail', { provider: 'google', step: 'token', delayMs: 12_000, times: 1 })
    const done = decideOnFakePage(p, 'google', user)
    // 느린 교환 중에도 다른 판매자 화면은 응답한다
    await page.goto('/settings')
    await expect(methodsList(page)).toBeVisible()
    expect((await whoAmI(page.request)).loginId).toBe(seller.loginId)
    await done
    await expect(p.getByRole('alert')).toHaveText(MSG.PROVIDER_ERROR('google'), { timeout: 20_000 })
    await expectLoggedOut(p)
    await ctx.close()
  })

  test('같은 브라우저 두 탭에서 시작(카카오·네이버) → 먼저 동의한 탭으로 로그인되고, 다른 탭은 로그인되거나 EXPIRED — 다른 판매자로는 절대 안 들어감', async ({ page, browser, baseURL }) => {
    const seller = await loginNewSeller(page)
    const k = await fakeUser(page.request, 'kakao')
    const n = await fakeUser(page.request, 'naver')
    await linkFromSettings(page, 'kakao', k)
    await linkFromSettings(page, 'naver', n)
    const ctx = await browser.newContext({ baseURL })
    const t1 = await ctx.newPage()
    const t2 = await ctx.newPage()
    await t1.goto('/')
    await pressContinue(t1, 'kakao')
    await t2.goto('/')
    await pressContinue(t2, 'naver')
    await decideOnFakePage(t2, 'naver', n)
    await expect(t2.getByRole('banner')).toContainText(seller.shopName)
    await decideOnFakePage(t1, 'kakao', k)
    await expect(t1.getByRole('banner').or(t1.getByRole('alert'))).toBeVisible()
    if (await t1.getByRole('alert').isVisible()) await expect(t1.getByRole('alert')).toHaveText(MSG.EXPIRED)
    expect((await whoAmI(t1.request)).loginId).toBe(seller.loginId)
    await ctx.close()
  })

  test('카카오 세션으로 들어와 네이버를 더 연결 → LINKED, 지금 세션 그대로(새 세션 아님)', async ({ page, browser, baseURL }) => {
    const seller = await loginNewSeller(page)
    const k = await fakeUser(page.request, 'kakao')
    await linkFromSettings(page, 'kakao', k)
    const ctx = await browser.newContext({ baseURL })
    const p = await ctx.newPage()
    await p.goto('/')
    await pressContinue(p, 'kakao')
    await decideOnFakePage(p, 'kakao', k)
    await expect(p.getByRole('button', { name: '로그아웃' })).toBeVisible()
    const before = (await ctx.cookies()).find((c) => c.name === 'lj_session')?.value
    await linkFromSettings(p, 'naver', await fakeUser(p.request, 'naver'))
    expect((await ctx.cookies()).find((c) => c.name === 'lj_session')?.value).toBe(before)
    expect((await whoAmI(p.request)).loginId).toBe(seller.loginId)
    await expect(methodsList(p).getByRole('listitem').filter({ hasText: NAME.naver })).toContainText('연결 끊기')
    await ctx.close()
  })

  test('A가 연결을 시작해 둔 사이 같은 브라우저에서 B로 바꿔 로그인 → A의 승인으로 돌아와도 B에게도 A에게도 연결되지 않는다', async ({ page, browser, baseURL }) => {
    const a = await loginNewSeller(page)
    const ctx = await browser.newContext({ baseURL })
    const b = await ctx.newPage()
    const sellerB = await loginNewSeller(b) // B의 아이디·비밀번호만 쓴다
    await ctx.close()
    const user = await fakeUser(page.request, 'kakao')
    await page.goto('/settings')
    await methodsRegion(page).getByRole('button', { name: '카카오 연결하기' }).click()
    await expect(page).toHaveURL(/\/kakao\/authorize\?/)
    // 같은 브라우저의 다른 탭: A 로그아웃 → B 로그인
    const tab = await page.context().newPage()
    await tab.goto('/')
    await logout(tab)
    await loginAs(tab, sellerB)
    await tab.close()
    const back = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/kakao/callback')
    await decideOnFakePage(page, 'kakao', user)
    // 결과는 SESSION_GONE 또는 EXPIRED — 어느 쪽이든 LINKED가 아니다 (B로 로그인된 채라 문장이 어디에 보일지는 스펙이 정하지 않음 — 지적으로 올림)
    const location = (await back).headers()['location'] ?? ''
    expect(location).toMatch(/[?&]login=(SESSION_GONE|EXPIRED)&provider=kakao$/)
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await expect(page.getByText(MSG.LINKED('kakao'))).toHaveCount(0)
    const methodsB = await (await page.request.get('/api/auth/methods')).json() as { loginId: string; providers: { provider: string; linked: boolean }[] }
    expect(methodsB.loginId).toBe(sellerB.loginId)
    expect(methodsB.providers.find((p) => p.provider === 'kakao')?.linked).toBe(false)
    // A에게도 없다: 그 카카오 계정으로 로그인하면 NOT_LINKED
    const other = await browser.newContext({ baseURL })
    const p = await other.newPage()
    await p.goto('/')
    await pressContinue(p, 'kakao')
    await decideOnFakePage(p, 'kakao', user)
    await expect(p.getByRole('alert')).toHaveText(MSG.NOT_LINKED('kakao'))
    expect((await whoAmI(p.request)).status).toBe(401)
    expect(a.loginId).not.toBe(sellerB.loginId)
    await other.close()
  })

  test('설정에서 [연결하기] → 공급자 화면에서 브라우저 "뒤로" → 설정의 [연결하기]가 다시 눌린다', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    await methodsRegion(page).getByRole('button', { name: '구글 연결하기' }).click()
    await expect(page).toHaveURL(/\/google\/authorize\?/)
    await page.goBack()
    await expect(page).toHaveURL(/\/settings$/)
    for (const p of ['카카오', '네이버', '구글']) await expect(methodsRegion(page).getByRole('button', { name: `${p} 연결하기` })).toBeEnabled()
    await expect(page.getByText('구글로 이동하는 중…')).toHaveCount(0)
  })

  test('시작 요청이 네트워크에서 끊기면(오프라인) 정한 문장과 잠금 풀림 · 다시 누르면 간다', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: '카카오로 계속하기' })).toBeVisible()
    await page.route('**/api/auth/start', (route) => route.abort('internetdisconnected'))
    await page.getByRole('button', { name: '카카오로 계속하기' }).click()
    await expect(page.getByRole('alert')).toHaveText(MSG.START_FAILED)
    await page.unroute('**/api/auth/start')
    await pressContinue(page, 'kakao')
  })

  test('A의 연결 알림은 B의 열린 설정 화면에 가지 않는다 (B의 목록은 B 자신의 변경에만 다시 읽힘)', async ({ page, browser, baseURL }) => {
    await loginNewSeller(page) // A
    const bCtx = await browser.newContext({ baseURL })
    const bPc = await bCtx.newPage()
    const sellerB = await loginNewSeller(bPc)
    let bReads = 0
    bPc.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/auth/methods') bReads += 1
    })
    await bPc.goto('/settings')
    const bNaver = methodsList(bPc).getByRole('listitem').filter({ hasText: '네이버' })
    await expect(bNaver).toHaveText('네이버 · 연결 안 됨연결하기')
    await expect.poll(() => bReads).toBe(1)
    // A가 연결 (B와 다른 판매자)
    await linkFromSettings(page, 'naver', await fakeUser(page.request, 'naver'))
    await linkFromSettings(page, 'kakao', await fakeUser(page.request, 'kakao'))
    // B의 다른 기기가 연결 → B PC는 이 알림 하나로만 다시 읽는다
    const bPhoneCtx = await browser.newContext({ baseURL })
    const bPhone = await bPhoneCtx.newPage()
    await loginAs(bPhone, sellerB, '/settings')
    await linkFromSettings(bPhone, 'naver', await fakeUser(bPhone.request, 'naver', { email: 'bb.phone@naver.com' }))
    await expect(bNaver).toContainText('bb***@naver.com')
    // A의 알림 둘이 새었다면 4 이상 (다시 붙음으로 한 번 더 읽는 것은 허용)
    expect(bReads).toBeLessThanOrEqual(3)
    await expect(methodsList(bPc).getByRole('listitem').filter({ hasText: '카카오' })).toHaveText('카카오 · 연결 안 됨연결하기')
    await Promise.all([bCtx.close(), bPhoneCtx.close()])
  })
})
