// FB1 간편 로그인 이동 (AC-FB1-31~33, AC-FB1-90 로그인 방법 줄) — 가짜 OAuth 묶음(@social).
// 이동이 막힌 경우(AC-FB1-33)는 page.route로 승인 주소 요청에 204(내용 없음)로 답한다 — 브라우저는 이동을 마치지 않고 지금 페이지에 머문다
// (pagehide 없음). 답하지 않고 붙잡아 두는 방법은 Playwright가 그 이동이 끝나기를 기다려 화면을 읽지 못해 쓰지 않는다(test-notes-e2e "로그인 이동 막기").
import { expect, test, type Page } from '@playwright/test'
import { escapeRe, fakeOAuth, methodsRegion } from '../l1/support.ts'
import { LEAVE_TEXT, LEAVE_TITLE, loginNewSeller, saveBar, serverSettings, settingsRegion } from './support.ts'

function linkRequests(page: Page): string[] {
  const seen: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/auth/link') seen.push(r.url())
  })
  return seen
}

function beforeUnloadDialogs(page: Page): string[] {
  const seen: string[] = []
  page.on('dialog', async (d) => {
    seen.push(d.type())
    await d.accept()
  })
  return seen
}

test.describe('AC-FB1-31·32 간편 로그인 연결하기 @social', () => {
  test('새로 연 설정에서 아무것도 고치지 않음 → 카카오 연결하기 → 창 없이 가짜 승인 주소로', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    await expect(saveBar(page)).toContainText('바꾼 칸이 없어요.')
    const dialogs = beforeUnloadDialogs(page)
    await methodsRegion(page).getByRole('button', { name: '카카오 연결하기' }).click()
    await expect(page).toHaveURL(new RegExp(`^${escapeRe(fakeOAuth())}/kakao/authorize\\?`))
    await expect(page.getByRole('dialog', { name: LEAVE_TITLE })).toHaveCount(0)
    expect(dialogs).toEqual([])
  })

  test('판매 규칙 하나를 고친 채 → 연결 요청 전에 앱 창, 닫기(처음 포커스·Esc) → 요청 없음·값 그대로, 떠나기 → "카카오로 이동하는 중…" → 브라우저 확인 없이 이동', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    const waitlist = settingsRegion(page, '판매 규칙').getByLabel('대기 인원 (0이면 대기 없음)')
    await waitlist.fill('7')
    const links = linkRequests(page)
    const dialogs = beforeUnloadDialogs(page)
    const button = methodsRegion(page).getByRole('button', { name: '카카오 연결하기' })
    await button.click()
    const dlg = page.getByRole('dialog', { name: LEAVE_TITLE })
    await expect(dlg).toContainText(LEAVE_TEXT)
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    // 회차 2 D-FB1-18 (e): 단추 셋, 이 차례
    await expect(dlg.getByRole('button')).toHaveText(['저장하고 떠나기', '저장하지 않고 떠나기', '닫기'])
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    expect(links).toEqual([])
    await expect(button).toBeEnabled()
    await expect(waitlist).toHaveValue('7')

    await button.click()
    await dlg.getByRole('button', { name: '닫기' }).click()
    await expect(dlg).toHaveCount(0)
    expect(links).toEqual([])
    await expect(waitlist).toHaveValue('7')

    await button.click()
    await dlg.getByRole('button', { name: '저장하지 않고 떠나기' }).click()
    await expect(page).toHaveURL(new RegExp(`^${escapeRe(fakeOAuth())}/kakao/authorize\\?`))
    expect(links).toHaveLength(1)
    expect(dialogs).toEqual([])
  })

  test('회차 2 "저장하고 떠나기": 실패면 연결 요청 없이 설정에 남음(버튼 "카카오 연결하기" 그대로) → 고쳐서 다시 → 저장 뒤 연결 요청 → 브라우저 확인 없이 이동', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    const waitlist = settingsRegion(page, '판매 규칙').getByLabel('대기 인원 (0이면 대기 없음)')
    await waitlist.fill('101')
    const links = linkRequests(page)
    const dialogs = beforeUnloadDialogs(page)
    const button = methodsRegion(page).getByRole('button', { name: '카카오 연결하기' })
    await button.click()
    const dlg = page.getByRole('dialog', { name: LEAVE_TITLE })
    await dlg.getByRole('button', { name: '저장하고 떠나기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(saveBar(page).getByRole('alert')).toHaveText('저장하지 못한 칸이 있어요: 판매 규칙. 빨간 글을 확인해 주세요.')
    await expect(waitlist).toBeFocused()
    await expect(button).toBeEnabled()
    await expect(page).toHaveURL(/\/settings/)
    expect(links).toEqual([])

    await waitlist.fill('7')
    await button.click()
    await dlg.getByRole('button', { name: '저장하고 떠나기' }).click()
    await expect(page).toHaveURL(new RegExp(`^${escapeRe(fakeOAuth())}/kakao/authorize\\?`))
    expect(links).toHaveLength(1)
    expect(dialogs).toEqual([])
    expect((await serverSettings(page))['waitlist.max']).toBe(7)
  })

  test('네이버도 같다 — 고친 값이 있으면 앱 창, 떠나면 브라우저 확인 없이 이동', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    await settingsRegion(page, '배송비').getByLabel('기본 배송비 (원)').fill('3300')
    const dialogs = beforeUnloadDialogs(page)
    await methodsRegion(page).getByRole('button', { name: '네이버 연결하기' }).click()
    await page.getByRole('dialog', { name: LEAVE_TITLE }).getByRole('button', { name: '저장하지 않고 떠나기' }).click()
    await expect(page).toHaveURL(new RegExp(`^${escapeRe(fakeOAuth())}/naver/authorize\\?`))
    expect(dialogs).toEqual([])
  })
})

test.describe('AC-FB1-33 못 떠나면 되돌린다 @social', () => {
  test('승인 주소 이동이 막혀 5초 안에 떠나지 못하면 버튼 "연결하기"로 되돌림 + "카카오로 가지 못했어요. 다시 눌러 주세요." — 다시 누르면 다시 간다', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    let held = 0
    const pattern = new RegExp(`^${escapeRe(fakeOAuth())}/kakao/authorize`)
    await page.route(pattern, async (route) => {
      held += 1
      await route.fulfill({ status: 204, body: '' })
    })
    const button = methodsRegion(page).getByRole('button', { name: '카카오 연결하기' })
    await button.click()
    await expect(methodsRegion(page).getByRole('button', { name: '카카오로 이동하는 중…' })).toBeDisabled()
    const alert = methodsRegion(page).getByRole('alert').filter({ hasText: '카카오로 가지 못했어요. 다시 눌러 주세요.' })
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(button).toBeEnabled()
    expect(held).toBe(1)
    await page.unroute(pattern)
    await expect(page).toHaveURL(/\/settings/)

    // 다시 누르면 다시 간다
    await button.click()
    await expect(page).toHaveURL(new RegExp(`^${escapeRe(fakeOAuth())}/kakao/authorize\\?`))
  })

  test('고친 값이 있고 떠나기를 고른 뒤 이동이 막혀도 되돌아오고, 그 뒤 메뉴 이동은 다시 묻는다 (브라우저 확인 다시 켬)', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    await settingsRegion(page, '판매 규칙').getByLabel('대기 인원 (0이면 대기 없음)').fill('8')
    let held = 0
    const pattern = new RegExp(`^${escapeRe(fakeOAuth())}/kakao/authorize`)
    await page.route(pattern, async (route) => {
      held += 1
      await route.fulfill({ status: 204, body: '' })
    })
    await methodsRegion(page).getByRole('button', { name: '카카오 연결하기' }).click()
    await page.getByRole('dialog', { name: LEAVE_TITLE }).getByRole('button', { name: '저장하지 않고 떠나기' }).click()
    await expect(methodsRegion(page).getByRole('alert').filter({ hasText: '카카오로 가지 못했어요. 다시 눌러 주세요.' })).toBeVisible({ timeout: 15_000 })
    expect(held).toBe(1)
    await page.unroute(pattern)
    await expect(settingsRegion(page, '판매 규칙').getByLabel('대기 인원 (0이면 대기 없음)')).toHaveValue('8')
    const prevented = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    })
    expect(prevented).toBe(true)
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    await expect(page.getByRole('dialog', { name: LEAVE_TITLE })).toBeVisible()
  })
})
