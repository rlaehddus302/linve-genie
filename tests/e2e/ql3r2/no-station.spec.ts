// QL3R2 출력 기기 없음 짧은 줄 (AC-QL3R2-14, D-QL3R2-03, U-QL3R2-02·RA-QL3R1-03, LBL-06) — test-e2e.
// 라벨을 켠 판매자가 출력 기기를 정하지 않은 채 실제 방송에서 1등 2명(라벨 대기 2장)을 만든다.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { uniqueDate } from '../s05/support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import { broadcastApi, setLabelsApi } from '../ql2/support.ts'
import {
  D1440,
  D375,
  D393,
  D412,
  NO_STATION_LONG,
  NO_STATION_SHORT,
  alerts,
  checkSticky40,
  expectNoOverflow,
  expectShortWhole,
  openConsole,
  sellerOn,
  sentenceCount,
  shortRow,
  toggle,
  viewerOf,
  type Device,
} from './support.ts'

type View = Awaited<ReturnType<typeof viewerOf>>

/** 라벨 켬, 출력 기기 없음, 실제 방송: 상품 여럿 + 보류 찜 1 (아직 1등 없음 — 라벨 대기 0장) */
async function world(dev: Page): Promise<string> {
  await setLabelsApi(dev, true)
  const b = await broadcastApi(dev, uniqueDate())
  for (let no = 1; no <= 14; no += 1) await registerApi(dev, b, no, `품종${String(no)}`, 1000 * no)
  await smsApi(dev, { b, no: 40, memo: '보류' })
  return b
}

/** 1등 2명 → 라벨 대기 2장 */
async function twoLabels(dev: Page, b: string): Promise<void> {
  await smsApi(dev, { b, no: 1, phone: '010-5200-0001' })
  await smsApi(dev, { b, no: 2, phone: '010-5200-0002' })
}

async function expectFolded(v: View): Promise<void> {
  await expect(toggle(v.page), `${v.label} 접힘`).toHaveAttribute('aria-expanded', 'false')
  const row = shortRow(v.page, NO_STATION_SHORT)
  await expect(row, `${v.label} 짧은 줄`).toBeVisible({ timeout: 30_000 })
  await expect(row).toHaveText(NO_STATION_SHORT, { useInnerText: true })
  await expectShortWhole(v.page, row, v.label)
  // 자기 줄: "알림" 한 줄(영역)보다 아래
  const area = (await alerts(v.page).boundingBox())!
  const box = (await row.boundingBox())!
  expect(box.y, `${v.label} 짧은 줄이 "알림" 한 줄 아래`).toBeGreaterThanOrEqual(area.y + area.height - 0.5)
  // 접힌 동안 긴 문장 0번
  await expect(v.page.getByText(NO_STATION_LONG)).toHaveCount(0)
  expect(await sentenceCount(v.page, NO_STATION_LONG), `${v.label} 접힌 동안 긴 문장 수`).toBe(0)
  expect(await sentenceCount(v.page, NO_STATION_SHORT), `${v.label} 접힌 동안 짧은 줄 수`).toBe(1)
}

test.describe('AC-QL3R2-14 출력 기기 없음 + 라벨 대기: 접힌 휴대폰 띠는 짧은 줄', () => {
  test('375·412 × 글자 100%·150%: 대기 0장이면 줄 없음 → 2장이 되면 "라벨이 안 나가요 · 라벨 화면에서 프린터를 연결해 주세요"가 자기 줄에 다 보이고 긴 문장 0번, 펼치면 긴 문장 그대로·짧은 줄 없음, 누르면 /labels / PC 1440은 긴 문장', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    const views: View[] = []
    try {
      const b = await world(s.dev)
      const w = { owner: { page: s.dev }, seller: s.seller }
      for (const device of [D375, D412] as Device[]) for (const big of [false, true]) views.push(await viewerOf(browser, w, device, big))
      for (const v of views) await openConsole(v.page, b, v.big)
      // 라벨 대기 0장: 짧은 줄도 긴 문장도 없다
      for (const v of views) {
        await expect(alerts(v.page).getByRole('button', { name: /^보류 1$/ }), v.label).toBeVisible()
        await expect(shortRow(v.page, NO_STATION_SHORT), `${v.label} 대기 0장`).toHaveCount(0)
        await expect(v.page.getByText(NO_STATION_LONG), `${v.label} 대기 0장`).toHaveCount(0)
      }
      await twoLabels(s.dev, b)
      for (const v of views) {
        await expectFolded(v)
        await expectNoOverflow(v.page, `${v.label} 콘솔`)
      }
      // 펼친 띠: 긴 문장 그대로, 짧은 줄 없음 (375 150%)
      const phone = views[1]!
      await phone.page.getByRole('button', { name: /^알림( \d+)? 펼치기$/ }).click()
      await expect(phone.page.getByRole('button', { name: /^알림( \d+)? 접기$/ })).toBeVisible()
      const long = alerts(phone.page).getByRole('button', { name: NO_STATION_LONG, exact: true })
      await long.scrollIntoViewIfNeeded()
      await expect(long).toBeVisible()
      await expect(shortRow(phone.page, NO_STATION_SHORT)).toHaveCount(0)
      expect(await sentenceCount(phone.page, NO_STATION_LONG), '펼친 동안 긴 문장 수').toBe(1)
      await phone.page.getByRole('button', { name: /^알림( \d+)? 접기$/ }).click()
      // 짧은 줄을 누르면 라벨 화면
      await shortRow(phone.page, NO_STATION_SHORT).click()
      await expect(phone.page).toHaveURL(/\/labels$/)
      // PC 1440: 긴 문장 그대로, 짧은 줄 없음
      await openConsole(s.dev, b, false)
      await expect(alerts(s.dev).getByRole('button', { name: NO_STATION_LONG, exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(s.dev.getByRole('button', { name: NO_STATION_SHORT, exact: true })).toHaveCount(0)
      expect(await sentenceCount(s.dev, NO_STATION_SHORT), 'PC 짧은 줄 수').toBe(0)
    } finally {
      for (const v of views) await v.context.close()
      await s.close()
    }
  })

  test('375×812·412×915 150% + 보류 찜 1 + 700px 내림: 고정 영역 ≤ 화면 40% (324·366px), 짧은 줄이 고정 영역 안에 다 보이고 44px 이상', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    const views: { page: Page; context: BrowserContext; label: string }[] = []
    try {
      const b = await world(s.dev)
      await twoLabels(s.dev, b)
      const w = { owner: { page: s.dev }, seller: s.seller }
      for (const device of [D375, D412]) views.push(await viewerOf(browser, w, device, true))
      for (const v of views) {
        await openConsole(v.page, b, true)
        await expect(shortRow(v.page, NO_STATION_SHORT)).toBeVisible({ timeout: 30_000 })
        await checkSticky40(v.page, v.label, NO_STATION_SHORT)
        await expectNoOverflow(v.page, `${v.label} 콘솔`)
      }
    } finally {
      for (const v of views) await v.context.close()
      await s.close()
    }
  })

  test('393×852 WebKit 글자 100%·150%: 짧은 줄이 다 보이고 긴 문장 0번, 150% 700px 내림에서 고정 영역 ≤ 340px @webkit', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    const views: View[] = []
    try {
      const b = await world(s.dev)
      await twoLabels(s.dev, b)
      const w = { owner: { page: s.dev }, seller: s.seller }
      for (const big of [false, true]) views.push(await viewerOf(browser, w, D393, big))
      for (const v of views) {
        await openConsole(v.page, b, v.big)
        await expectFolded(v)
        await expectNoOverflow(v.page, `${v.label} 콘솔`)
      }
      await checkSticky40(views[1]!.page, views[1]!.label, NO_STATION_SHORT)
    } finally {
      for (const v of views) await v.context.close()
      await s.close()
    }
  })
})
