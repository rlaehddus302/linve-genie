// LND1 사용성 1회차 반영 화면 (test-e2e) — AC-LND1-16·17·18, D-LND1-10. 기대값은 acceptance.md "확정 문장" 표·AC 본문에서 정했다(구현을 보고 정하지 않음).
// 폰 우선: 375×812(크로미움)·393×852(WebKit 아이폰, @webkit)·1440×900.
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { newSeller, type Seller } from '../i3/support.ts'
import { expectSignedIn, logoutFully } from '../menu.ts'
import { expectNoOverflow } from '../mob1/support.ts'
import { ENGLISH, bigText, expectLanding, expectLoginScreen, fillLogin, freshTab, section, shortTargets } from './support.ts'

const START_LOGIN = '로그인하러 가기'
const ACCOUNT_NOTE = '계정은 운영자가 만들어 드려요. 아이디·비밀번호를 잊었으면 운영자에게 물어봐 주세요.'
const BACK_HOME = '처음 화면으로'
const FAILED = '아이디나 비밀번호가 맞지 않아요.'
const FAILED_HINT = '아이디·비밀번호를 잊었으면 운영자에게 물어봐 주세요.'
const CAPTION = '(영문 안내 — 구글 심사용)'

const PHONE = { width: 375, height: 812 } as const
const IPHONE = { width: 393, height: 852 } as const
const PC = { width: 1440, height: 900 } as const

/** 안내 한 줄(틀린 비밀번호 뒤) — 계정 안내 문장 안의 같은 글과 섞이지 않게 글 전체가 같은 것만 */
const hint = (page: Page): Locator => page.getByText(FAILED_HINT, { exact: true })
const backHome = (page: Page): Locator => page.getByRole('link', { name: BACK_HOME, exact: true })
const note = (page: Page): Locator => page.getByText(ACCOUNT_NOTE, { exact: true })

async function webkitTab(browser: Browser, baseURL: string | undefined): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL, viewport: IPHONE, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' })
  return { ctx, page: await ctx.newPage() }
}

/** AC-LND1-16: 소개 화면 → "시작하기" → "로그인하러 가기"가 뷰포트 안 → 누르면 /login·아이디 커서 */
async function startLoginFlow(page: Page, where: string, opts: { checkOverflow: boolean }): Promise<void> {
  await page.goto('/')
  await expectLanding(page)
  // 이름이 정확히 "로그인"인 링크는 여전히 하나(맨 위)
  await expect(page.getByRole('link', { name: '로그인', exact: true })).toHaveCount(1)
  const startLogin = page.getByRole('link', { name: START_LOGIN, exact: true })
  await expect(startLogin).toHaveCount(1)
  // "시작하려면" 절 안, 문장 아래
  await expect(section(page, '시작하려면').getByRole('link', { name: START_LOGIN, exact: true })).toHaveCount(1)
  await expect(startLogin).toHaveAttribute('href', '/login')
  await page.getByRole('link', { name: '시작하기', exact: true }).click()
  await expect(startLogin).toBeInViewport({ ratio: 1 })
  const text = await section(page, '시작하려면').getByText('라이브지니 계정은 운영자가 만들어 드려요.', { exact: false }).boundingBox()
  const box = await startLogin.boundingBox()
  expect(box, where).not.toBeNull()
  expect(text, where).not.toBeNull()
  expect(box?.height ?? 0, `${where} "${START_LOGIN}" 높이`).toBeGreaterThanOrEqual(44)
  expect((box?.y ?? 0) + 0.5, `${where} "${START_LOGIN}"는 문장 아래`).toBeGreaterThanOrEqual((text?.y ?? 0) + (text?.height ?? 0))
  if (opts.checkOverflow) {
    await expectNoOverflow(page, `소개 ${where}`)
    expect(await shortTargets(page), `${where} 소개: 44px 미만`).toEqual([])
  }
  await startLogin.click()
  await expect(page).toHaveURL(/\/login$/)
  await expectLoginScreen(page)
  await expect(page.getByLabel('아이디')).toBeFocused()
}

test.describe('AC-LND1-16 "시작하려면"의 로그인 길', () => {
  for (const big of [false, true]) {
    test(`375×812 글자 ${big ? '150' : '100'}%: "시작하기" → "${START_LOGIN}" 화면 안·44px·가로 넘침 0 → /login 아이디 커서`, async ({ browser, baseURL }) => {
      const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: PHONE, touch: true })
      try {
        if (big) await bigText(ctx)
        await startLoginFlow(page, `375 ${big ? '150' : '100'}%`, { checkOverflow: true })
      } finally {
        await ctx.close()
      }
    })
  }

  test(`1440×900: "시작하기" → "${START_LOGIN}" → /login 아이디 커서`, async ({ browser, baseURL }) => {
    const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: PC })
    try {
      await startLoginFlow(page, '1440', { checkOverflow: true })
    } finally {
      await ctx.close()
    }
  })

  test(`393×852 WebKit 아이폰 글자 100%·150%: "시작하기" → "${START_LOGIN}" → /login 아이디 커서 @webkit`, async ({ browser, baseURL }) => {
    for (const big of [false, true]) {
      const { ctx, page } = await webkitTab(browser, baseURL)
      try {
        if (big) await bigText(ctx)
        await startLoginFlow(page, `WebKit ${big ? '150' : '100'}%`, { checkOverflow: true })
      } finally {
        await ctx.close()
      }
    }
  })
})

/** /login의 계정 안내·"처음 화면으로": 로그인 칸 아래, 정책 링크 위. 누르면 / 소개 화면 */
async function loginHelpFlow(page: Page, where: string): Promise<void> {
  await page.goto('/login')
  await expectLoginScreen(page)
  await expect(note(page)).toBeVisible()
  await expect(backHome(page)).toBeVisible()
  await expect(backHome(page)).toHaveAttribute('href', '/')
  const submit = await page.getByRole('button', { name: '로그인', exact: true }).boundingBox()
  const n = await note(page).boundingBox()
  const b = await backHome(page).boundingBox()
  const policy = await page.getByRole('link', { name: '개인정보처리방침', exact: true }).boundingBox()
  expect(submit && n && b && policy, where).toBeTruthy()
  if (!submit || !n || !b || !policy) return
  expect(n.y + 0.5, `${where}: 안내는 로그인 칸 아래`).toBeGreaterThanOrEqual(submit.y + submit.height)
  expect(policy.y + 0.5, `${where}: 안내·링크는 정책 링크 위`).toBeGreaterThanOrEqual(b.y + b.height)
  expect(b.height, `${where}: "${BACK_HOME}" 높이`).toBeGreaterThanOrEqual(44)
  await expectNoOverflow(page, `/login ${where}`)
  expect(await shortTargets(page), `${where} /login: 44px 미만`).toEqual([])
  await backHome(page).click()
  await expect(page).toHaveURL(/\/$/)
  expect(new URL(page.url()).search).toBe('')
  await expectLanding(page)
  await expect(backHome(page)).toHaveCount(0)
}

test.describe('AC-LND1-17 /login 안내·돌아갈 길', () => {
  for (const big of [false, true]) {
    test(`375×812 글자 ${big ? '150' : '100'}%: /login에 계정 안내·"${BACK_HOME}" → 누르면 / 소개 화면`, async ({ browser, baseURL }) => {
      const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: PHONE, touch: true })
      try {
        if (big) await bigText(ctx)
        await loginHelpFlow(page, `375 ${big ? '150' : '100'}%`)
      } finally {
        await ctx.close()
      }
    })
  }

  test(`1440×900: /login에 계정 안내·"${BACK_HOME}" → 누르면 / 소개 화면`, async ({ browser, baseURL }) => {
    const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: PC })
    try {
      await loginHelpFlow(page, '1440')
    } finally {
      await ctx.close()
    }
  })

  test(`393×852 WebKit 아이폰 글자 100%·150%: /login에 계정 안내·"${BACK_HOME}" → / 소개 화면 @webkit`, async ({ browser, baseURL }) => {
    for (const big of [false, true]) {
      const { ctx, page } = await webkitTab(browser, baseURL)
      try {
        if (big) await bigText(ctx)
        await loginHelpFlow(page, `WebKit ${big ? '150' : '100'}%`)
      } finally {
        await ctx.close()
      }
    }
  })

  test('그 자리 로그인 화면(/settings·/sms·/packing)과 같은 탭 로그아웃 뒤 "/"의 로그인 화면엔 안내·"처음 화면으로"가 없다', async ({ browser, baseURL }) => {
    const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: PHONE, touch: true })
    try {
      for (const path of ['/settings', '/sms', '/packing?date=2026-10-18']) {
        await page.goto(path)
        await expectLoginScreen(page)
        await expect(backHome(page), path).toHaveCount(0)
        await expect(page.getByText(ACCOUNT_NOTE), path).toHaveCount(0)
      }
      // 건너뛰기 로그인 화면 (D-LND1-02 (b)): 이 탭에서 로그아웃한 뒤의 "/"
      // 기본 판매자(방송 있음 — 로그인하면 "/")로 로그인했다가 같은 탭에서 로그아웃
      await page.goto('/login')
      await fillLogin(page)
      await expectSignedIn(page)
      await expect(page).toHaveURL(/\/$/)
      await logoutFully(page)
      await expectLoginScreen(page)
      expect(new URL(page.url()).pathname).toBe('/')
      await expect(backHome(page)).toHaveCount(0)
      await expect(page.getByText(ACCOUNT_NOTE)).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})

/** 틀린 비밀번호 → alert 글 그대로 + 바로 아래(alert 밖) 안내 한 줄 */
async function expectFailedWithHint(page: Page, where: string): Promise<void> {
  const alert = page.getByRole('alert')
  await expect(alert, where).toHaveCount(1)
  await expect(alert, where).toHaveText(FAILED)
  await expect(hint(page), where).toHaveCount(1)
  await expect(hint(page), where).toBeVisible()
  // alert 밖
  await expect(alert.getByText(FAILED_HINT), `${where}: alert 안에 없어야 함`).toHaveCount(0)
  // 바로 아래: 오류 문장 아래에 붙어 있고, 둘 사이에 다른 보이는 글·칸이 없다
  const a = await alert.boundingBox()
  const h = await hint(page).boundingBox()
  expect(a && h, where).toBeTruthy()
  if (!a || !h) return
  expect(h.y + 0.5, `${where}: 안내는 오류 문장 아래`).toBeGreaterThanOrEqual(a.y + a.height)
  const between = await page.evaluate(
    ({ top, bottom }) => {
      const out: string[] = []
      for (const el of document.querySelectorAll<HTMLElement>('input, button, a[href], label, p, li, h1, h2, h3')) {
        const r = el.getBoundingClientRect()
        if (r.height === 0) continue
        if (r.top >= top - 0.5 && r.bottom <= bottom + 0.5) out.push(`${el.tagName} ${(el.textContent ?? '').trim().slice(0, 30)}`)
      }
      return out
    },
    { top: a.y + a.height, bottom: h.y },
  )
  expect(between, `${where}: 오류 문장과 안내 사이`).toEqual([])
}

async function wrongThenRight(page: Page, seller: Seller, where: string): Promise<void> {
  await fillLogin(page, { loginId: seller.loginId, password: `${seller.password}-틀림` })
  await expectFailedWithHint(page, where)
  await fillLogin(page, seller)
  await expectSignedIn(page)
  await expect(hint(page)).toHaveCount(0)
  await expect(page.getByText(FAILED)).toHaveCount(0)
}

test.describe('AC-LND1-17 틀린 비밀번호 뒤 안내', () => {
  test('375×812: /login에서 틀림 → alert "아이디나 비밀번호가 맞지 않아요." 그대로, 바로 아래(alert 밖) 안내 → 맞게 다시 → 안내 사라짐·로그인한 화면', async ({ browser, baseURL }) => {
    const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: PHONE, touch: true })
    try {
      const seller = await newSeller(page.request)
      await page.goto('/login')
      await wrongThenRight(page, seller, '375 /login')
      // 로그인하면 /login을 떠난다 (새 판매자는 처음 안내로 갈 수 있음 — 로그인 칸이 다시 보이지 않는 것까지 본다)
      await expect(page).not.toHaveURL(/\/login$/)
      await expect(page.getByLabel('아이디')).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('1440×900: /settings 그 자리 로그인 화면에서 틀려도 같은 안내 → 맞게 다시 → 안내 사라짐·/settings 그대로', async ({ browser, baseURL }) => {
    const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: PC })
    try {
      const seller = await newSeller(page.request)
      await page.goto('/settings')
      await expectLoginScreen(page)
      await wrongThenRight(page, seller, '1440 /settings')
      await expect(page).toHaveURL(/\/settings$/)
    } finally {
      await ctx.close()
    }
  })

  test('393×852 WebKit 아이폰: /login에서 틀림 → 같은 안내(alert 밖) → 맞게 다시 → 사라짐 @webkit', async ({ browser, baseURL }) => {
    const { ctx, page } = await webkitTab(browser, baseURL)
    try {
      const seller = await newSeller(page.request)
      await page.goto('/login')
      await wrongThenRight(page, seller, 'WebKit /login')
      await expect(page).not.toHaveURL(/\/login$/)
      await expect(page.getByLabel('아이디')).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('다른 오류엔 안내 줄이 없다: 아이디 잠김(15분), 연결 끊김', async ({ browser, baseURL }) => {
    const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: PHONE, touch: true })
    try {
      const seller = await newSeller(page.request)
      await page.goto('/login')
      await expectLoginScreen(page)
      const origin = new URL(page.url()).origin
      // 같은 아이디로 계속 틀려 잠근다 (API로 — 화면 시험은 잠긴 뒤의 문장만 본다)
      let locked = false
      for (let i = 0; i < 20 && !locked; i++) {
        const res = await page.request.post('/api/login', { data: { loginId: seller.loginId, password: `wrong-${String(i)}` }, headers: { Origin: origin } })
        const body = (await res.json()) as { error?: { code?: string } }
        locked = body.error?.code === 'LOGIN_LOCKED'
      }
      expect(locked, '잠김에 이르지 못함').toBe(true)
      await fillLogin(page, seller)
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('alert')).not.toHaveText(FAILED)
      await expect(hint(page)).toHaveCount(0)

      // 연결 끊김: 로그인 요청이 닿지 않음
      await page.goto('/login')
      await expectLoginScreen(page)
      await page.route('**/api/login', (route) => route.abort('internetdisconnected'))
      await fillLogin(page, { loginId: seller.loginId, password: 'whatever-1234' })
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('alert')).not.toHaveText(FAILED)
      await expect(hint(page)).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})

/** AC-LND1-18: lang="en" 문단 바로 앞 형제가 머리말(p, 제목 아님, lang="en" 밖), 16px 이상. 영문 글은 그대로 */
async function expectCaption(page: Page, where: string): Promise<void> {
  await page.goto('/')
  await expectLanding(page)
  const en = page.locator('[lang="en"]')
  await expect(en, where).toHaveCount(1)
  expect(((await en.textContent()) ?? '').trim(), where).toBe(ENGLISH)
  const info = await en.evaluate((el) => {
    const prev = el.previousElementSibling as HTMLElement | null
    if (prev === null) return null
    return {
      text: (prev.textContent ?? '').trim(),
      tag: prev.tagName.toLowerCase(),
      role: prev.getAttribute('role'),
      inEnglish: prev.closest('[lang="en"]') !== null,
      fontPx: parseFloat(getComputedStyle(prev).fontSize),
      visible: prev.getBoundingClientRect().height > 0,
    }
  })
  expect(info, `${where}: 앞 형제 없음`).not.toBeNull()
  expect(info?.text, where).toBe(CAPTION)
  expect(info?.tag, where).not.toMatch(/^h[1-6]$/)
  expect(info?.role, where).not.toBe('heading')
  expect(info?.inEnglish, where).toBe(false)
  expect(info?.visible, where).toBe(true)
  expect(info?.fontPx ?? 0, `${where}: 머리말 글자 크기`).toBeGreaterThanOrEqual(16)
  // 제목 목록에 섞이지 않는다
  await expect(page.getByRole('heading', { name: CAPTION })).toHaveCount(0)
}

test.describe('AC-LND1-18 영문 단락 머리말', () => {
  test('375×812·1440×900: 영문 단락 바로 앞 "(영문 안내 — 구글 심사용)" — 제목 아님, lang="en" 밖, 16px 이상', async ({ browser, baseURL }) => {
    for (const [where, viewport, touch] of [['375', PHONE, true], ['1440', PC, false]] as const) {
      const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport, touch })
      try {
        await expectCaption(page, where)
      } finally {
        await ctx.close()
      }
    }
  })

  test('393×852 WebKit 아이폰: 영문 단락 머리말 @webkit', async ({ browser, baseURL }) => {
    const { ctx, page } = await webkitTab(browser, baseURL)
    try {
      await expectCaption(page, 'WebKit')
    } finally {
      await ctx.close()
    }
  })
})
