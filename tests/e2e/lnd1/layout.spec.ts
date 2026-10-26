// LND1 휴대폰·큰 글씨 (test-e2e) — AC-LND1-12, D-LND1-09·D-MOB1-03. 가로 넘침 0은 MOB1 공통 전제(expectNoOverflow)와 같은 정의.
import { expect, test } from '@playwright/test'
import { expectNoOverflow } from '../mob1/support.ts'
import { bigText, expectLanding, expectLoginScreen, freshTab, shortTargets } from './support.ts'

const VIEWPORTS = [
  ['375×812', { width: 375, height: 812 }],
  ['412×915', { width: 412, height: 915 }],
] as const

for (const [label, viewport] of VIEWPORTS) {
  for (const big of [false, true]) {
    test(`${label} 글자 ${big ? '150' : '100'}%: 소개 화면과 /login — 가로 넘침 0, 보이는 링크·버튼 44px 이상`, async ({ browser, baseURL }) => {
      const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport, touch: true })
      try {
        if (big) await bigText(ctx)
        await page.goto('/')
        await expectLanding(page)
        if (big) await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(24)
        await expectNoOverflow(page, `소개 ${label}`)
        expect(await shortTargets(page), '소개: 44px 미만').toEqual([])
        // 특히 데이터 정책 링크·정책 링크
        for (const name of ['로그인', '시작하기', '개인정보처리방침', '이용약관', '구글 API 서비스 사용자 데이터 정책']) {
          const box = await page.getByRole('link', { name, exact: true }).boundingBox()
          expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44)
        }
        await page.goto('/login')
        await expectLoginScreen(page)
        await expectNoOverflow(page, `/login ${label}`)
        expect(await shortTargets(page), '/login: 44px 미만').toEqual([])
      } finally {
        await ctx.close()
      }
    })
  }
}

test('375×812 글자 100%: 처음 연 화면(스크롤 0)에 "로그인"·"시작하기"가 다 보인다', async ({ browser, baseURL }) => {
  const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: { width: 375, height: 812 }, touch: true })
  try {
    await page.goto('/')
    await expectLanding(page)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    for (const name of ['로그인', '시작하기']) await expect(page.getByRole('link', { name, exact: true }), name).toBeInViewport({ ratio: 1 })
  } finally {
    await ctx.close()
  }
})

for (const big of [false, true]) {
  test(`1440×900 글자 ${big ? '150' : '100'}%: 가로 넘침 0, 글 줄 폭 ≤ 900px`, async ({ browser, baseURL }) => {
    const { ctx, page } = await freshTab(browser, baseURL ?? '', { viewport: { width: 1440, height: 900 } })
    try {
      if (big) await bigText(ctx)
      await page.goto('/')
      await expectLanding(page)
      await expectNoOverflow(page, '소개 1440')
      const wide = await page.evaluate(() => {
        const out: string[] = []
        for (const el of document.querySelectorAll<HTMLElement>('main p, main li, main h1, main h2')) {
          const w = el.getBoundingClientRect().width
          if (w > 900) out.push(`${el.tagName} ${String(Math.round(w))}px ${(el.textContent ?? '').slice(0, 20)}`)
        }
        return out
      })
      expect(wide).toEqual([])
    } finally {
      await ctx.close()
    }
  })
}

test('393×852 WebKit 아이폰 글자 100%·150%: 소개 화면과 /login — 가로 넘침 0, 44px 이상 @webkit', async ({ browser, baseURL }) => {
  for (const big of [false, true]) {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' })
    try {
      if (big) await bigText(ctx)
      const page = await ctx.newPage()
      await page.goto('/')
      await expectLanding(page)
      await expectNoOverflow(page, `소개 WebKit ${big ? '150' : '100'}%`)
      expect(await shortTargets(page), '소개: 44px 미만').toEqual([])
      await page.goto('/login')
      await expectLoginScreen(page)
      await expectNoOverflow(page, `/login WebKit ${big ? '150' : '100'}%`)
      expect(await shortTargets(page), '/login: 44px 미만').toEqual([])
    } finally {
      await ctx.close()
    }
  }
})
