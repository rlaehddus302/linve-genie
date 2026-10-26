// AC-L1-30 공급자마다 흐름 (구글·카카오·네이버 — 같은 시험 묶음을 공급자 매개변수로). 제목 @social → chromium-social 묶음(세 공급자 켬, 가짜 OAuth).
// 기대값은 acceptance.md "결과 문장" 표·AC-L1-20~22·30에서 정했다(구현을 보고 정하지 않음).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { expectLanding } from '../lnd1/support.ts'
import {
  MSG,
  NAME,
  PROVIDERS,
  decideOnFakePage,
  expectLoggedOut,
  fakeControl,
  fakeOAuth,
  fakeRequests,
  fakeUser,
  linkFromSettings,
  loginNewSeller,
  logout,
  methodsList,
  methodsRegion,
  pressContinue,
  whoAmI,
  type FakeUser,
  type Provider,
  type Seller,
} from './support.ts'

/** 오늘(KST) "YYYY. M. D." */
function todayDots(): string {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-')
  return `${y ?? ''}. ${String(Number(m))}. ${String(Number(d))}.`
}

/** 새 판매자 A가 아이디로 로그인한 뒤 설정에서 그 공급자를 연결해 둔 상태 */
async function linkedSeller(page: Page, provider: Provider, user?: FakeUser): Promise<{ seller: Seller; user: FakeUser }> {
  const seller = await loginNewSeller(page)
  const u = user ?? (await fakeUser(page.request, provider))
  await linkFromSettings(page, provider, u)
  return { seller, user: u }
}

/** 새 브라우저 문맥에서 "<공>로 계속하기" → 그 사용자로 동의 → 홈. 돌아온 callback 주소를 돌려준다 */
async function socialLoginInNewContext(browser: Browser, baseURL: string, provider: Provider, user: FakeUser): Promise<{ ctx: BrowserContext; page: Page; callback: string }> {
  const ctx = await browser.newContext({ baseURL })
  const page = await ctx.newPage()
  await page.goto('/login') // LND1 D-LND1-01
  await pressContinue(page, provider)
  const callbackSeen = page.waitForRequest((r) => new URL(r.url()).pathname === `/api/auth/${provider}/callback`)
  await decideOnFakePage(page, provider, user)
  const callback = (await callbackSeen).url()
  await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
  return { ctx, page, callback }
}

/**
 * 가짜 승인 화면에서 동의를 누르되, 가짜 서버가 돌려보내는 주소(앱의 callback)로는 가지 않고 그 주소만 받는다.
 * (Playwright route는 리디렉션으로 이어진 요청을 가로채지 못하므로 동의 POST의 302를 직접 받는다)
 */
async function captureCallback(page: Page, provider: Provider, user: FakeUser): Promise<URL> {
  const isDecision = (u: URL) => u.href.startsWith(`${fakeOAuth()}/${provider}/authorize`)
  let resolve: (url: URL) => void = () => undefined
  const got = new Promise<URL>((r) => {
    resolve = r
  })
  await page.route(isDecision, async (route) => {
    if (route.request().method() !== 'POST') return await route.continue()
    const response = await route.fetch({ maxRedirects: 0 })
    const location = response.headers()['location'] ?? ''
    resolve(new URL(location))
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>받음</p>' })
  })
  await decideOnFakePage(page, provider, user)
  const url = await got
  await page.unroute(isDecision)
  expect(url.pathname).toBe(`/api/auth/${provider}/callback`)
  return url
}

for (const provider of PROVIDERS) {
  const P = NAME[provider]
  test.describe(`AC-L1-30 ${P} 흐름 @social`, () => {
    test(`1·2·3: ${P} 처음 연결 → 로그아웃 → ${P}로 계속하기 → 홈(가게 이름) → 새 문맥에서 다시 로그인해도 같은 판매자`, async ({ page, browser, baseURL }) => {
      const user = await fakeUser(page.request, provider, { email: `seller.kim.${provider}@gmail.com` })
      const { seller } = await linkedSeller(page, provider, user)
      // 목록에 가린 이름 (이메일 seller.kim… → se***@gmail.com, AC-L1-08) · 연결한 날짜
      await expect(methodsList(page).getByRole('listitem').filter({ hasText: P })).toHaveText(`${P} · se***@gmail.com · ${todayDots()}연결 끊기`)
      await expect(methodsRegion(page).getByRole('button', { name: `${P} 연결 끊기` })).toBeVisible()
      // 주소에서 결과 매개변수가 지워졌다 — 새로 고침하면 문장이 다시 나오지 않는다 (AC-L1-21)
      expect(new URL(page.url()).search).toBe('')
      await page.reload()
      await expect(methodsList(page)).toBeVisible()
      await expect(page.getByText(MSG.LINKED(provider))).toHaveCount(0)

      // 2. 처음 로그인
      await logout(page)
      await pressContinue(page, provider)
      await decideOnFakePage(page, provider, user)
      await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
      await expect(page.getByRole('banner')).toContainText(seller.shopName)
      expect(new URL(page.url()).pathname).toBe('/')
      expect(new URL(page.url()).search).toBe('')
      const me = await whoAmI(page.request)
      expect(me).toEqual({ status: 200, shop: seller.shopName, loginId: seller.loginId })

      // 3. 다시 로그인 (새 브라우저 문맥) → 같은 A, 새 판매자·계정 없음
      const again = await socialLoginInNewContext(browser, baseURL ?? '', provider, user)
      await expect(again.page.getByRole('banner')).toContainText(seller.shopName)
      expect(await whoAmI(again.page.request)).toEqual({ status: 200, shop: seller.shopName, loginId: seller.loginId })
      // 간편 로그인 세션도 판매자 권한 그대로 — 설정의 로그인 방법 목록을 본다 (AC-L1-05)
      const methods = await again.page.request.get('/api/auth/methods')
      expect(methods.status()).toBe(200)
      expect((await methods.json() as { loginId: string }).loginId).toBe(seller.loginId)
      await again.ctx.close()
    })

    test(`4: ${P} 가짜 화면에서 취소 → 로그인 화면 CANCELLED 문장, 로그인되지 않음`, async ({ page }) => {
      const user = await fakeUser(page.request, provider)
      await page.goto('/login') // LND1 D-LND1-01
      await pressContinue(page, provider)
      await decideOnFakePage(page, provider, user, 'cancel')
      await expect(page.getByRole('alert')).toHaveText(MSG.CANCELLED(provider))
      await expectLoggedOut(page)
      expect(new URL(page.url()).search).toBe('')
      expect((await whoAmI(page.request)).status).toBe(401)
      // 새로 고침하면 다시 보이지 않는다
      await page.reload()
      // LND1 D-LND1-02: 새로고침한 '/'는 소개 화면 — 문장은 거기에도, 로그인 화면(/login)에도 없다
      await expectLanding(page) // LND1 SA-LND1-01: 소개 화면에만 있는 절·한 줄 소개·"시작하기" + 아이디 칸 없음 (h1만으로는 로그인 화면과 구별 안 됨)
      await expect(page.getByText(MSG.CANCELLED(provider))).toHaveCount(0)
      await page.goto('/login') // LND1 D-LND1-01
      await expect(page.getByLabel('아이디')).toBeFocused()
      await expect(page.getByText(MSG.CANCELLED(provider))).toHaveCount(0)
    })

    test(`5: ${P} state를 바꾼 돌아오는 주소·다른 문맥에서 시작한 state → EXPIRED, 로그인되지 않음`, async ({ page, browser, baseURL }) => {
      const { user } = await linkedSeller(page, provider)
      // 연결된 사용자로 시도해야 "state만 틀려서" 막혔음을 안다
      const ctx = await browser.newContext({ baseURL })
      const victim = await ctx.newPage()
      await victim.goto('/login') // LND1 D-LND1-01
      await pressContinue(victim, provider)
      // 가짜 화면이 돌려보내는 주소를 받아 두고(앱으로 가지 않게), state를 바꿔 연다
      const back = await captureCallback(victim, provider, user)
      const state = back.searchParams.get('state') ?? ''
      back.searchParams.set('state', `${state.slice(0, -2)}${state.endsWith('AA') ? 'BB' : 'AA'}`)
      await victim.goto(back.href)
      await expect(victim.getByRole('alert')).toHaveText(MSG.EXPIRED)
      await expectLoggedOut(victim)
      expect((await whoAmI(victim.request)).status).toBe(401)

      // 다른 문맥(공격자)에서 시작·동의해 받은 돌아오는 주소를 이 문맥에서 연다
      const attackerCtx = await browser.newContext({ baseURL })
      const attacker = await attackerCtx.newPage()
      await attacker.goto('/login') // LND1 D-LND1-01
      await pressContinue(attacker, provider)
      const foreign = (await captureCallback(attacker, provider, user)).href
      // 피해자는 이번엔 시작조차 안 했고(쿠키 없음), 시작해 둔 경우도 본다
      const fresh = await browser.newContext({ baseURL })
      const noCookie = await fresh.newPage()
      await noCookie.goto(foreign)
      await expect(noCookie.getByRole('alert')).toHaveText(MSG.EXPIRED)
      await expectLoggedOut(noCookie)
      await victim.goto('/login') // LND1 D-LND1-01
      await pressContinue(victim, provider) // 피해자 브라우저에도 자기 __Host-lj_oauth가 있다
      await victim.goto(foreign)
      await expect(victim.getByRole('alert')).toHaveText(MSG.EXPIRED)
      await expectLoggedOut(victim)
      await Promise.all([ctx.close(), attackerCtx.close(), fresh.close()])
    })

    test(`6: ${P} 성공한 돌아오는 주소 다시 열기 → EXPIRED · 새 state + 옛 코드 → PROVIDER_ERROR`, async ({ page, browser, baseURL }) => {
      const { seller, user } = await linkedSeller(page, provider)
      const first = await socialLoginInNewContext(browser, baseURL ?? '', provider, user)
      const before = (await fakeRequests(page.request, provider)).exchanges[provider]
      // 같은 브라우저(쿠키 지운 뒤)에서 같은 주소를 다시 연다 → EXPIRED, 로그인되지 않음, 공급자를 다시 부르지 않음
      await first.ctx.clearCookies()
      await first.page.goto(first.callback)
      await expect(first.page.getByRole('alert')).toHaveText(MSG.EXPIRED)
      await expectLoggedOut(first.page)
      expect((await fakeRequests(page.request, provider)).exchanges[provider]).toBe(before)

      // 새 state + 옛 코드: 새로 시작해 받은 state에 옛 code를 붙여 연다 → 가짜 서버가 코드 재사용을 거절 → PROVIDER_ERROR
      const oldCode = new URL(first.callback).searchParams.get('code') ?? ''
      await first.page.goto('/login') // LND1 D-LND1-01
      await pressContinue(first.page, provider)
      const newState = new URL(first.page.url()).searchParams.get('state') ?? ''
      const forged = new URL(first.callback)
      forged.searchParams.set('state', newState)
      forged.searchParams.set('code', oldCode)
      await first.page.goto(forged.href)
      await expect(first.page.getByRole('alert')).toHaveText(MSG.PROVIDER_ERROR(provider))
      await expectLoggedOut(first.page)
      expect((await whoAmI(first.page.request)).status).toBe(401)
      // A의 원래 화면은 그대로 로그인돼 있다
      expect((await whoAmI(page.request)).loginId).toBe(seller.loginId)
      await first.ctx.close()
    })

    test(`7: ${P} 가짜 서버에 다른 돌아오는 주소가 등록돼 있으면 오류 화면, 앱으로 돌아오지 않음 · 서버가 보낸 redirect_uri는 글자까지 같다`, async ({ page, baseURL }) => {
      const user = await fakeUser(page.request, provider)
      const expected = `${baseURL ?? ''}/api/auth/${provider}/callback`
      await fakeControl(page.request, '/_fake/redirect', { provider, redirectUri: `${baseURL ?? ''}/api/auth/${provider}/callback-other` })
      try {
        await page.goto('/login') // LND1 D-LND1-01
        await pressContinue(page, provider)
        await expect(page.locator('p[role=alert][data-error=redirect_uri_mismatch]')).toBeVisible()
        await expect(page.locator(`input[data-user="${user.id}"]`)).toHaveCount(0)
        expect(page.url().startsWith(fakeOAuth())).toBe(true)
        const { requests } = await fakeRequests(page.request, provider)
        const last = requests.filter((r) => r.kind === 'authorize').at(-1)
        expect(last?.params['redirect_uri']).toBe(expected)
        expect((await whoAmI(page.request)).status).toBe(401)
      } finally {
        await fakeControl(page.request, '/_fake/redirect', { provider, redirectUri: expected })
      }
    })

    test(`8: ${P} 이메일·닉네임 없는 사용자로 연결·로그인 → 성공, 목록에 "${P} 계정"`, async ({ page }) => {
      const user = await fakeUser(page.request, provider, { email: null, nickname: null })
      const { seller } = await linkedSeller(page, provider, user)
      await expect(methodsList(page).getByRole('listitem').filter({ hasText: P })).toHaveText(`${P} · ${P} 계정 · ${todayDots()}연결 끊기`)
      await logout(page)
      await pressContinue(page, provider)
      await decideOnFakePage(page, provider, user)
      await expect(page.getByRole('banner')).toContainText(seller.shopName)
    })

    test(`9: ${P} 연결하지 않은 사용자로 로그인 → NOT_LINKED 문장, 아이디 칸 커서 · 같은 이메일이어도 합치지 않음`, async ({ page, browser, baseURL }) => {
      // A에 연결한 사용자와 이메일이 같은 다른 공급자 계정
      const email = `same.${provider}.${Math.random().toString(36).slice(2, 7)}@gmail.com`
      await linkedSeller(page, provider, await fakeUser(page.request, provider, { email }))
      const stranger = await fakeUser(page.request, provider, { email })
      const ctx = await browser.newContext({ baseURL })
      const p = await ctx.newPage()
      await p.goto('/login') // LND1 D-LND1-01
      await pressContinue(p, provider)
      await decideOnFakePage(p, provider, stranger)
      await expect(p.getByRole('alert')).toHaveText(MSG.NOT_LINKED(provider))
      await expect(p.getByLabel('아이디')).toBeFocused()
      expect(new URL(p.url()).search).toBe('')
      expect((await whoAmI(p.request)).status).toBe(401)
      await ctx.close()
    })

    test(`10: ${P} 연결 끊기 → 그 공급자로 로그인한 다른 문맥은 로그인 화면, 지금 화면은 그대로 → 다시 로그인하면 NOT_LINKED`, async ({ page, browser, baseURL }) => {
      const { seller, user } = await linkedSeller(page, provider)
      const other = await socialLoginInNewContext(browser, baseURL ?? '', provider, user)
      await other.page.goto('/settings')
      await expect(methodsList(other.page)).toBeVisible()

      await page.goto('/settings')
      await methodsRegion(page).getByRole('button', { name: `${P} 연결 끊기` }).click()
      const dialog = page.getByRole('dialog', { name: `${P} 연결 끊기` })
      await expect(dialog).toContainText(`${P} 연결을 끊을까요? 끊으면 ${P}로 로그인할 수 없고, ${P}로 로그인해 둔 다른 기기는 로그아웃돼요. 아이디 로그인은 그대로예요.`)
      await expect(dialog.getByRole('button', { name: '그만두기' })).toBeFocused()
      await dialog.getByRole('button', { name: '연결 끊기' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(methodsRegion(page).getByRole('status').filter({ hasText: MSG.UNLINKED(provider) })).toBeVisible()
      await expect(methodsList(page).getByRole('listitem').filter({ hasText: P })).toHaveText(`${P} · 연결 안 됨연결하기`)
      // 지금 화면은 로그인된 채
      await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible()
      expect((await whoAmI(page.request)).loginId).toBe(seller.loginId)

      // 그 공급자로 로그인해 둔 다른 문맥: (열린 화면에서) 다음 요청에서 로그인 화면 + "로그인이 풀렸어요…"
      await other.page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자' }).click()
      await expect(other.page.getByText(MSG.SESSION_EXPIRED)).toBeVisible()
      await expectLoggedOut(other.page)

      // 다시 그 공급자로 로그인 → NOT_LINKED
      await pressContinue(other.page, provider)
      await decideOnFakePage(other.page, provider, user)
      await expect(other.page.getByRole('alert')).toHaveText(MSG.NOT_LINKED(provider))
      await other.ctx.close()
    })
  })
}

test.describe('AC-L1-30 구글 묶음 추가 @social', () => {
  test('구글 승인 요청의 권한은 정확히 "openid email" · PKCE S256 · 유튜브 연결 상태 그대로', async ({ page }) => {
    await loginNewSeller(page)
    const ytBefore = await (await page.request.get('/api/youtube/connection')).text()
    const user = await fakeUser(page.request, 'google')
    await linkFromSettings(page, 'google', user)
    const { requests } = await fakeRequests(page.request, 'google')
    const auth = requests.filter((r) => r.kind === 'authorize').at(-1)
    expect(auth?.params['scope']).toBe('openid email')
    expect(auth?.params['code_challenge_method']).toBe('S256')
    expect(String(auth?.params['scope'] ?? '')).not.toContain('youtube')
    expect(auth?.params).not.toHaveProperty('include_granted_scopes')
    expect(auth?.params).not.toHaveProperty('access_type')
    expect(await (await page.request.get('/api/youtube/connection')).text()).toBe(ytBefore)
    await page.goto('/settings')
    await methodsRegion(page).getByRole('button', { name: '구글 연결 끊기' }).click()
    await page.getByRole('dialog', { name: '구글 연결 끊기' }).getByRole('button', { name: '연결 끊기' }).click()
    await expect(methodsRegion(page).getByRole('status').filter({ hasText: MSG.UNLINKED('google') })).toBeVisible()
    expect(await (await page.request.get('/api/youtube/connection')).text()).toBe(ytBefore)
  })
})
