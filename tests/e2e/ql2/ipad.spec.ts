// QL2 iPadOS 사파리 (AC-QL2-25, D-QL2-07, LBL-07) — test-e2e. 묶음 webkit-iphone(@webkit)의 WebKit 브라우저로 1024×1366 새 컨텍스트.
// iPadOS 사파리는 사용자 에이전트가 맥(Macintosh)과 같고 터치 지점이 5다 — navigator.maxTouchPoints를 5로 둔다(Playwright hasTouch만으로는 1일 수 있다).
import { expect, test } from '@playwright/test'
import { baseUrlOf, freshSeller, setLabelsApi } from './support.ts'

const TEST_PRINTER = '시험용 프린터 — 실제로 출력되지 않아요'
const IPHONE_LINE = '실제 아이폰에선 프린터에 바로 연결할 수 없어요. 라벨 그림을 저장해 출력해 주세요.'
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

for (const [label, touchPoints, shown] of [['터치 지점 5(아이패드)', 5, true], ['터치 지점 0(맥)', 0, false]] as const) {
  test(`AC-QL2-25 WebKit 1024×1366 Macintosh 사파리 ${label}: 라벨 화면 시험용 프린터 아래 아이폰 줄 ${shown ? '있음' : '없음'} @webkit`, async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: { width: 1024, height: 1366 }, touch: touchPoints > 0, userAgent: IPAD_UA })
    try {
      await context.addInitScript((n: number) => {
        Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => n })
      }, touchPoints)
      await setLabelsApi(dev, true)
      await dev.goto('/labels')
      await expect(dev.getByRole('heading', { level: 1, name: '라벨' })).toBeVisible()
      expect(await dev.evaluate(() => navigator.maxTouchPoints)).toBe(touchPoints)
      const box = dev.getByRole('region', { name: '프린터', exact: true })
      const testButton = box.getByRole('button', { name: TEST_PRINTER, exact: true })
      await expect(testButton).toBeVisible()
      const line = box.getByText(IPHONE_LINE, { exact: true })
      if (!shown) {
        await expect(line).toHaveCount(0)
        return
      }
      await expect(line).toBeVisible()
      const tb = (await testButton.boundingBox())!
      const lb = (await line.boundingBox())!
      expect(lb.y, '시험용 프린터 바로 아래').toBeGreaterThanOrEqual(tb.y + tb.height - 0.5)
      expect(lb.y - (tb.y + tb.height), '바로 아래(사이가 좁음)').toBeLessThan(48)
    } finally {
      await context.close()
    }
  })
}
