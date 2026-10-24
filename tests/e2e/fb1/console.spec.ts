// FB1 콘솔 빠른 입력 (AC-FB1-02·03, AC-FB1-90 콘솔 줄): 가격 단위 한 줄, 등록 전 "등록하면: …", 고치기 칸 "= …원" — 천원·원 방송 각각.
// 미리 보기 가격 = Enter로 보내는 가격(같은 해석). 진행 중 방송은 그 방송 설정 스냅샷의 단위.
import { expect, test, type Page } from '@playwright/test'
import { loginNewSeller, openRealBroadcast, patchSettings, settingsRegion, saveBar, saveButton } from './support.ts'

const THOUSAND_LINE = '가격 단위: 천원 — 10은 10,000원, 2만은 20,000원'
const WON_LINE = '가격 단위: 원 — 10000은 10,000원, 2만은 20,000원'

function willRegister(page: Page) {
  return page.locator('main').getByRole('status').filter({ hasText: /^등록하면: / })
}

/** 등록 요청(빠른 입력 Enter)의 본문을 모은다 */
function recordRegisters(page: Page): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = []
  page.on('request', (r) => {
    if (r.method() !== 'POST' || !new URL(r.url()).pathname.startsWith('/api/events')) return
    const body = r.postDataJSON() as Record<string, unknown> | null
    if (body !== null && body['type'] === 'product.register') seen.push(body)
  })
  return seen
}

function priceOf(body: Record<string, unknown>): unknown {
  const fields = (body['fields'] ?? body['product'] ?? body) as Record<string, unknown>
  return fields['price']
}

test.describe('AC-FB1-02 천원 방송', () => {
  test('단위 한 줄, 한 글자마다 미리 보기, 품종 없음·번호만·있는 번호·오류는 줄 없음, 미리 보기 가격 = 등록 가격, 고치기 칸 "= 15,000원"', async ({ page }) => {
    await loginNewSeller(page)
    await openRealBroadcast(page)
    const input = page.getByLabel('빠른 입력')
    await expect(page.getByText(THOUSAND_LINE, { exact: true })).toBeVisible()
    await expect(willRegister(page)).toHaveCount(0)

    await input.fill('15 엘레강스 1')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 1,000원')
    await input.press('End')
    await input.pressSequentially('0')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 10,000원')
    await input.fill('15 엘레강스 2만')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 20,000원')
    await input.fill('15 10')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 10,000원')
    await input.fill('15')
    await expect(willRegister(page)).toHaveCount(0)
    await input.fill('15 엘레강스')
    await expect(willRegister(page)).toHaveCount(0)

    const registers = recordRegisters(page)
    await input.fill('15 엘레강스 10')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 10,000원')
    await input.press('Enter')
    await expect.poll(() => registers.length).toBe(1)
    expect(priceOf(registers[0]!)).toBe(10000)

    // 같은 번호가 있으면 줄이 없다 (고칠까요)
    await input.fill('15 엘레강스 12')
    await expect(willRegister(page)).toHaveCount(0)

    // 가격 오류 → 고치기 칸, 가격 칸 옆 "= 15,000원", 읽지 못하면 없음
    await input.fill('21 홍옥')
    await input.press('Enter')
    const fix = page.getByRole('group', { name: '고치기 칸' })
    const price = fix.getByLabel('가격')
    await price.fill('1.5만')
    await expect(fix.getByText('= 15,000원', { exact: true })).toBeVisible()
    await price.fill('abc')
    await expect(fix.getByText(/^= /)).toHaveCount(0)
    await price.fill('15')
    await expect(fix.getByText('= 15,000원', { exact: true })).toBeVisible()
    await price.press('Enter')
    await expect.poll(() => registers.length).toBe(2)
    expect(priceOf(registers[1]!)).toBe(15000)
  })

  test('품종의 HTML은 글로만 (미리 보기)', async ({ page }) => {
    await loginNewSeller(page)
    await openRealBroadcast(page)
    const input = page.getByLabel('빠른 입력')
    await input.fill('31 <b>굵게</b> 10')
    await expect(willRegister(page)).toHaveText('등록하면: 31번 <b>굵게</b> 10,000원')
    await expect(willRegister(page).locator('b')).toHaveCount(0)
  })
})

test.describe('AC-FB1-02 원 방송', () => {
  test('원 방송은 "가격 단위: 원 — …", 10000 → 10,000원, 500 → 500원 — 설정 화면에서 천원으로 바꿔도 진행 중 방송의 줄은 그대로', async ({ page }) => {
    await loginNewSeller(page)
    await patchSettings(page, { 'price.unit': 'WON' })
    const { b } = await openRealBroadcast(page)
    const input = page.getByLabel('빠른 입력')
    await expect(page.getByText(WON_LINE, { exact: true })).toBeVisible()
    await input.fill('15 엘레강스 10000')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 10,000원')
    await input.fill('15 엘레강스 2만')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 20,000원')
    await input.fill('15 엘레강스 500')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 500원')
    // 100원 미만은 오류(PRICE_TOO_LOW, R-16 4)로 읽혀 줄이 없다
    await input.fill('15 엘레강스 10')
    await expect(willRegister(page)).toHaveCount(0)
    await input.fill('15 엘레강스 500')
    const registers = recordRegisters(page)
    await input.press('Enter')
    await expect.poll(() => registers.length).toBe(1)
    expect(priceOf(registers[0]!)).toBe(500)

    // 설정 화면에서 천원으로 바꾸고 저장
    await page.goto('/settings')
    await settingsRegion(page, '판매 규칙').getByRole('radio', { name: '천원 (10 → 10,000원)' }).check()
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toContainText('저장했어요.')
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(page.getByText(WON_LINE, { exact: true })).toBeVisible()
    await page.getByLabel('빠른 입력').fill('16 선버스 900')
    await expect(willRegister(page)).toHaveText('등록하면: 16번 선버스 900원')
  })

  test('375px: 단위 줄과 미리 보기가 보인다', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await loginNewSeller(page)
    await openRealBroadcast(page)
    await expect(page.getByText(THOUSAND_LINE, { exact: true })).toBeVisible()
    await page.getByLabel('빠른 입력').fill('15 엘레강스 10')
    await expect(willRegister(page)).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/THOUSAND|\bWON\b/)
  })
})

test.describe('UX-04 고정 영역 (AC-FB1-95와 같은 기준 — 35% 이하)', () => {
  test('375×812: 단위 줄·"등록하면: …"이 보이는 채로 콘솔 고정 영역 ≤ 284px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loginNewSeller(page)
    await openRealBroadcast(page)
    await expect(page.getByText(THOUSAND_LINE, { exact: true })).toBeVisible()
    await page.getByLabel('빠른 입력').fill('15 엘레강스 10')
    await expect(willRegister(page)).toBeVisible()
    const h = await page.locator('.console-sticky').evaluate((el) => el.getBoundingClientRect().height)
    expect(h).toBeLessThanOrEqual(812 * 0.35)
  })
})
