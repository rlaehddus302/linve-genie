// LND1 소개를 건너뛰고 바로 로그인 (test-e2e) — AC-LND1-04·05·06·07. 기대값은 acceptance.md·D-LND1-01 (4)·D-LND1-02에서 정했다.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { decideOnFakePage, fakeUser, linkFromSettings, loginNewSeller, MSG, pressContinue, whoAmI } from '../l1/support.ts'
import { logoutFully } from '../menu.ts'
import { PHONE } from '../mob1/support.ts'
import { SESSION_EXPIRED, expectLanding, expectLoginScreen, fillLogin, freshTab } from './support.ts'

const home = (page: Page) => page.getByRole('button', { name: '새 방송 시작' })

test.describe('AC-LND1-04 다른 앱 주소는 지금 그대로', () => {
  test('로그아웃 상태 /packing?date=2026-10-18 → 그 주소 그대로 로그인 화면 → 로그인하면 그 화면(주소·검색값 그대로)', async ({ page }) => {
    await page.goto('/packing?date=2026-10-18')
    await expectLoginScreen(page)
    await expect(page).toHaveURL(/\/packing\?date=2026-10-18$/)
    await fillLogin(page)
    await expect(page.getByRole('navigation', { name: '메뉴' })).toBeVisible()
    await expect(page).toHaveURL(/\/packing\?date=2026-10-18$/)
    await expect(page.getByLabel('아이디')).toHaveCount(0)
  })

  test('로그아웃 상태 /settings·/sms도 그 자리 로그인 화면(소개 아님)', async ({ page }) => {
    for (const path of ['/settings', '/sms']) {
      await page.goto(path)
      await expectLoginScreen(page)
      expect(new URL(page.url()).pathname, path).toBe(path)
    }
  })
})

test.describe('AC-LND1-06 로그아웃·풀림 뒤는 로그인 화면', () => {
  test('PC: "/"에서 위 줄 "로그아웃" → 그 자리 로그인 화면(소개 아님) → 새로고침하면 소개 화면', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/login')
    await fillLogin(page)
    await expect(home(page)).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await logoutFully(page)
    await expectLoginScreen(page)
    await expect(page).toHaveURL(/\/$/)
    // 그 자리에서 바로 다시 로그인된다
    await fillLogin(page)
    await expect(home(page)).toBeVisible()
    await logoutFully(page)
    await expectLoginScreen(page)
    await page.reload()
    await expectLanding(page)
  })

  test('휴대폰 375: "더보기" 맨 끝 "로그아웃" → 로그인 화면(소개 아님)', async ({ browser, baseURL }) => {
    const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: PHONE, touch: true })
    try {
      await page.goto('/login')
      await fillLogin(page)
      await expect(home(page)).toBeVisible()
      await logoutFully(page)
      await expectLoginScreen(page)
      expect(new URL(page.url()).pathname).toBe('/')
    } finally {
      await ctx.close()
    }
  })

  test('"/"에서 세션이 서버에서 끝남 → 화면이 401을 받으면 로그인 화면 + "로그인이 풀렸어요. 다시 로그인해 주세요."(소개 아님)', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/')
    await expect(home(page)).toBeVisible()
    const origin = new URL(page.url()).origin
    // 같은 쿠키로 서버 세션을 끝낸다 (다른 곳에서 끝난 것과 같다 — 화면은 모름)
    const out = await page.request.post('/api/logout', { data: {}, headers: { Origin: origin } })
    expect(out.ok()).toBe(true)
    expect((await whoAmI(page.request)).status).toBe(401)
    // 무엇이든 API를 부르게 한다: "새 방송 시작"(창을 열 때 부르는 요청이 있으면 그 401) → 창이 열리면 "이 방송 시작하기"
    await home(page).click()
    const submit = page.getByRole('button', { name: '이 방송 시작하기' })
    await expect(submit.or(page.getByText(SESSION_EXPIRED))).toBeVisible()
    if (await submit.isVisible()) await submit.click({ timeout: 5_000 }).catch(() => undefined)
    await expect(page.getByText(SESSION_EXPIRED)).toBeVisible()
    await expectLoginScreen(page)
    await expect(page.getByText('판매자의 하루', { exact: true })).toHaveCount(0)
    await page.reload()
    await expectLanding(page)
  })
})

/** 홈 화면 앱 흉내 (앱이 처음 그리기 전에) */
async function asStandalone(ctx: BrowserContext, how: 'display-mode' | 'navigator'): Promise<void> {
  if (how === 'display-mode') {
    await ctx.addInitScript(() => {
      const original = window.matchMedia.bind(window)
      window.matchMedia = (query: string) => (/display-mode:\s*standalone/.test(query) ? ({ ...original(query), matches: true, media: query } as MediaQueryList) : original(query))
    })
  } else {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    })
  }
}

test.describe('AC-LND1-07 홈 화면 앱', () => {
  test('크로미움 display-mode: standalone 흉내 → 로그아웃 상태 "/"는 바로 로그인 화면, 주소 "/" · 로그인하면 방송 목록', async ({ browser, baseURL }) => {
    const { ctx, page } = await freshTab(browser, baseURL ?? '')
    try {
      await asStandalone(ctx, 'display-mode')
      await page.goto('/')
      expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true)
      await expectLoginScreen(page)
      await expect(page.getByLabel('아이디')).toBeFocused()
      expect(new URL(page.url()).pathname).toBe('/')
      // 새로고침해도 홈 화면 앱이면 로그인 화면
      await page.reload()
      await expectLoginScreen(page)
      await fillLogin(page)
      await expect(home(page)).toBeVisible()
      await expect(page).toHaveURL(/\/$/)
    } finally {
      await ctx.close()
    }
  })

  test('아이폰 WebKit navigator.standalone 흉내 → 로그아웃 상태 "/"는 바로 로그인 화면, 주소 "/" @webkit', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' })
    try {
      await asStandalone(ctx, 'navigator')
      const page = await ctx.newPage()
      await page.goto('/')
      expect(await page.evaluate(() => (navigator as Navigator & { standalone?: boolean }).standalone)).toBe(true)
      await expectLoginScreen(page)
      expect(new URL(page.url()).pathname).toBe('/')
      // 흉내가 없는 같은 WebKit 탭은 소개 화면 (흉내가 효과를 냈음을 확인)
      const plain = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' })
      try {
        const p = await plain.newPage()
        await p.goto('/')
        await expectLanding(p)
      } finally {
        await plain.close()
      }
    } finally {
      await ctx.close()
    }
  })
})

test.describe('AC-LND1-05 간편 로그인에서 돌아옴 @social', () => {
  test('소개 → "로그인" → 연결 안 된 구글 계정 → "/"에 로그인 화면·NOT_LINKED 문장·주소 지움 → 같은 탭에서 바로 아이디 로그인', async ({ page, browser, baseURL }) => {
    const seller = await loginNewSeller(page)
    const stranger = await fakeUser(page.request, 'google')
    const { ctx, page: p } = await freshTab(browser, baseURL ?? '')
    try {
      await p.goto('/')
      await expectLanding(p)
      await p.getByRole('link', { name: '로그인', exact: true }).click()
      await pressContinue(p, 'google')
      await decideOnFakePage(p, 'google', stranger)
      await expect(p.getByRole('alert')).toHaveText(MSG.NOT_LINKED('google'))
      await expectLoginScreen(p)
      await expect(p).toHaveURL(/\/$/)
      expect(new URL(p.url()).search).toBe('')
      await fillLogin(p, seller)
      await expect(p.getByRole('navigation', { name: '메뉴' })).toBeVisible()
      expect((await whoAmI(p.request)).loginId).toBe(seller.loginId)
    } finally {
      await ctx.close()
    }
  })

  test('연결된 구글 계정으로 간편 로그인 성공 → 방송 목록(소개 화면을 거치지 않음)', async ({ page, browser, baseURL }) => {
    const seller = await loginNewSeller(page)
    const user = await fakeUser(page.request, 'google')
    await linkFromSettings(page, 'google', user)
    const { ctx, page: p } = await freshTab(browser, baseURL ?? '')
    try {
      await p.goto('/login')
      await pressContinue(p, 'google')
      await decideOnFakePage(p, 'google', user)
      await expect(home(p)).toBeVisible()
      await expect(p.getByRole('banner')).toContainText(seller.shopName)
      await expect(p.getByText('판매자의 하루', { exact: true })).toHaveCount(0)
      await expect(p).toHaveURL(/\/$/)
    } finally {
      await ctx.close()
    }
  })
})

test.describe('TE-LND1-001 처음 로그인 확인이 실패한 뒤의 401은 "로그아웃·풀림"이 아니다 (D-LND1-02)', () => {
  test('"/"의 첫 /api/me가 인터넷 끊김 → "다시 시도" → 401이면 소개 화면 (로그인 화면·"로그인이 풀렸어요" 아님)', async ({ page }) => {
    let failed = 0
    await page.route('**/api/me', async (route) => {
      if (failed === 0) {
        failed += 1
        await route.abort('internetdisconnected')
        return
      }
      await route.continue()
    })
    await page.goto('/')
    await expect(page.getByText('인터넷 연결이 없어요. 연결되면 다시 불러와요.')).toBeVisible()
    await page.getByRole('button', { name: '다시 시도' }).click()
    await expectLanding(page)
    await expect(page.getByText(SESSION_EXPIRED)).toHaveCount(0)
  })

  test('"/"의 첫 /api/me가 서버 오류(503) → "다시 시도" → 401이면 소개 화면', async ({ page }) => {
    let failed = 0
    await page.route('**/api/me', async (route) => {
      if (failed === 0) {
        failed += 1
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '잠시 뒤에 다시 해 주세요.' } }) })
        return
      }
      await route.continue()
    })
    await page.goto('/')
    await page.getByRole('button', { name: '다시 시도' }).click()
    await expectLanding(page)
    await expect(page.getByText(SESSION_EXPIRED)).toHaveCount(0)
  })
})
