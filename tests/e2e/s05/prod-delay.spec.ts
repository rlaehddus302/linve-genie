// AC-S05-41 "운영 빌드의 값이 5초" — 대기를 줄이지 않은 묶음(chromium-prod-delay)에서만 돈다.
import { test, expect } from '@playwright/test'
import { boardItem, history, login, openNewBroadcast, register, sendViewerChat, uniqueDate } from './support.ts'

test('AC-S05-41: 방송자 조치는 5초 뒤에 보낸다 @prod-delay', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  const cfg = await (await page.request.get('/api/client-config')).json() as { hostActionDelayMs: number }
  expect(cfg.hostActionDelayMs).toBe(5000)
  await register(page, '15 핑크프릴 10000', 15)
  await sendViewerChat(page, b, '홍길동', '15')
  await expect(boardItem(page, 15)).toContainText('홍길동')
  await boardItem(page, 15).click()
  await page.getByRole('dialog', { name: '15번 자세히' }).getByRole('region', { name: '1등' }).getByRole('button', { name: '취소' }).click()
  const reason = page.getByRole('dialog', { name: '15번 홍길동 취소' })
  await reason.getByLabel('사유').fill('시청자 요청')
  const sent = page.waitForRequest((r) => r.url().includes('/api/events') && r.method() === 'POST')
  const t0 = Date.now()
  await reason.getByLabel('사유').press('Enter')
  const bar = page.getByRole('region', { name: '보내기 전 조치' })
  await expect(bar).toContainText('5초 뒤 보내요: 15번 홍길동 취소')
  await expect(bar.getByRole('button', { name: '15번 홍길동 취소 되돌리기' })).toBeVisible()
  await sent
  const elapsed = Date.now() - t0
  expect(elapsed).toBeGreaterThanOrEqual(4_900)
  expect(elapsed).toBeLessThan(7_000)
  await expect(bar).toContainText('보냈어요: 15번 홍길동 취소')
  expect((await history(page, date, true)).filter((e) => e.type === 'host.cancel')).toHaveLength(1)
})
