// AC-S05-64 화면 반영 1초 (NFR-01·04 규모) — 채운 묶음(chromium-fill: 오늘 실제 범위, 방송 "채운 방송", 상품 1~500, 채팅 1만)에서만 돈다.
import { test, expect, type Browser, type Page } from '@playwright/test'
import { boardItem, login } from './support.ts'

async function device(browser: Browser, baseURL: string, width: number, height: number): Promise<Page> {
  const ctx = await browser.newContext({ baseURL, viewport: { width, height }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) })
  return ctx.newPage()
}

async function openFilled(page: Page): Promise<void> {
  await login(page)
  await page.getByRole('list', { name: '방송' }).getByRole('link', { name: /채운 방송/ }).click()
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
}

function p99(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)]!
}

test('AC-S05-64: 상품 500·채팅 1만 범위에서 PC 쓰기 → 휴대폰 화면 p99 1초 @fill', async ({ browser, baseURL }) => {
  test.setTimeout(180_000)
  const pc = await device(browser, baseURL!, 1440, 900)
  const phone = await device(browser, baseURL!, 375, 812)
  await openFilled(pc)
  await openFilled(phone)
  // 채팅 1만 건이어도 처음엔 최근 것만 — "이전 메시지 보기"
  await expect(phone.getByRole('button', { name: '이전 메시지 보기' })).toBeVisible()
  const samples: number[] = []
  const input = pc.getByLabel('빠른 입력')
  for (let i = 0; i < 60; i += 1) {
    const no = 1 + (i % 500)
    const price = 20_000 + i * 1000
    await input.fill(`${String(no)} 반영시험 ${String(price)}`)
    await input.press('Enter')
    const dlg = pc.getByRole('dialog', { name: `${String(no)}번이 이미 있어요. 고칠까요?` })
    const resp = pc.waitForResponse((r) => r.url().includes('/api/events') && r.request().method() === 'POST')
    await dlg.getByRole('button', { name: '예' }).click()
    const apply = pc.getByRole('dialog', { name: '확정된 찜에도 새 가격을 적용할까요?' })
    if (await apply.isVisible().catch(() => false)) await apply.getByRole('button', { name: '아니요, 새 찜부터' }).click()
    await resp
    const t0 = Date.now()
    await expect(boardItem(phone, no)).toContainText(`${price.toLocaleString('en-US')}원`, { timeout: 10_000 })
    if (i >= 10) samples.push(Date.now() - t0)
  }
  console.log(`반영 p99 ${String(p99(samples))}ms, 최대 ${String(Math.max(...samples))}ms`)
  expect(p99(samples)).toBeLessThan(1_000)
  await pc.context().close()
  await phone.context().close()
})
