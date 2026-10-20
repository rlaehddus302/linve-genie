// N5 요금 기능이 꺼진 서버 (기본 묶음 chromium — 제목에 @billing 없음, AC-N5-50·11): 메뉴 "요금" 없음, 홈 띠·미리 보기 없음,
// /billing은 기존 없는 화면, 실제 방송은 이용권 없이도 시작된다(지금과 같다).
import { expect, test } from '@playwright/test'
import { login, menu, uniq, uniqueDate } from './support.ts'

test.describe('N5 요금 기능 꺼짐', () => {
  test('TE-N5 꺼진 서버: 메뉴 요금 없음 · 홈 미리 보기·띠 없음 · /billing 없는 화면 · 실제 방송 시작됨 (AC-N5-50)', async ({ page }) => {
    await login(page)
    await expect(menu(page).getByRole('link', { name: '요금' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: '요금 알림' })).toHaveCount(0)
    await page.getByRole('button', { name: '새 방송 시작' }).click()
    const form = page.getByRole('form', { name: '새 방송' })
    await expect(form).toBeVisible()
    await expect(form.getByRole('status', { name: '새 방송 요금' })).toHaveCount(0)
    await expect(page.getByText(/이용권/)).toHaveCount(0)

    // 요금 경로는 404 (웹훅 포함)
    expect((await page.request.get('/api/billing')).status()).toBe(404)
    expect((await page.request.post('/api/billing/webhook', { data: {} })).status()).toBe(404)

    // 이용권 없이 실제 방송이 시작된다
    await form.getByLabel('제목').fill(uniq('꺼짐'))
    await form.getByLabel('날짜').fill(uniqueDate())
    await form.getByRole('button', { name: '이 방송 시작하기' }).click()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()

    await page.goto('/billing')
    await expect(page.getByRole('heading', { name: '찾을 수 없는 화면이에요.' })).toBeVisible()
    await expect(page.getByRole('link', { name: '방송 목록으로' })).toBeVisible()
  })
})
