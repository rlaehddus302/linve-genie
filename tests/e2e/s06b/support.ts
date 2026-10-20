// S06b E2E 공용 도우미 (test-e2e). S06 도우미를 그대로 쓰고 이름 표기·주 버튼·tone·합치기 창용을 더한다.
// 선택자는 역할·이름 기반, 화면 표시(주 버튼 .button-primary · data-tone)는 dev-notes "## dev-web"의 약속.
import { expect, type Browser, type Locator, type Page } from '@playwright/test'
import { login } from '../s06/support.ts'

export * from '../s06/support.ts'

export function uniq(prefix: string): string {
  return `${prefix}${String(Math.floor(Math.random() * 1e6))}`
}

/** 휴대폰 창을 지금 페이지와 같은 화면 주소로 열고 로그인한다 */
export async function phoneLike(browser: Browser, like: Page): Promise<Page> {
  const origin = new URL(like.url()).origin
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: origin })
  const page = await context.newPage()
  await login(page)
  return page
}

/** 창(dialog) 밖에 보이는 주 버튼 수 (AC-S06b-24, dev-notes: .button-primary) */
export async function primaryOutsideDialogs(page: Page): Promise<string[]> {
  return await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.button-primary')]
      .filter((el) => el.closest('[role=dialog]') === null && el.offsetParent !== null)
      .map((el) => el.textContent?.trim() ?? ''),
  )
}

/** 합치기 창 — 미리 보기를 다 받을 때까지 */
export async function previewSettled(dlg: Locator): Promise<void> {
  await expect(dlg.getByText(/미리 보기를 (새로 )?받는 중이에요/)).toHaveCount(0)
  await expect(dlg.locator('[role=alert], ul[aria-label="합치면"]').first()).toBeVisible()
}

/** KST "YYYY-MM-DD" → "2026년 10월 18일(일)" (스펙 문장으로 손 계산) */
export function dateLongKo(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const dow = '일월화수목금토'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!
  return `${String(y)}년 ${String(m)}월 ${String(d)}일(${dow})`
}
