// QL3R2 휴대폰 출력 기기 끊김일 때 고정 영역 (AC-QL3R2-10·11·12, D-QL3R2-02, U-QL3R2-01·SA-QL3R1-02) — test-e2e.
// 출력 기기(안드로이드 흉내 컨텍스트)가 망을 잃으면 같은 판매자의 다른 기기 콘솔 알림 띠에 끊김이 뜬다(ql3r1/printer-lost.spec.ts와 같은 방법).
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { gotoLabels, region } from '../i1/support.ts'
import { setLabelsApi } from '../ql2/support.ts'
import {
  D1440,
  D375,
  D393,
  D412,
  alerts,
  checkSticky40,
  expectNoOverflow,
  expectWhole,
  longLost,
  lostWorld,
  openConsole,
  sellerOn,
  sentenceCount,
  shortLost,
  shortRow,
  toggle,
  viewerOf,
  type Device,
} from './support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import { uniqueDate } from '../s05/support.ts'
import { broadcastApi } from '../ql2/support.ts'

type View = Awaited<ReturnType<typeof viewerOf>>

async function closeAll(views: readonly { context: BrowserContext }[]): Promise<void> {
  for (const v of views) await v.context.close()
}

test.describe('AC-QL3R2-10 끊김 + 보류 찜 1 + 글자 150% + 700px 내림: 고정 영역 ≤ 화면 40%', () => {
  test("375×812·412×915 150%: 'PC 2' 끊김 — 고정 영역 ≤ 324·366px, 요약 줄·알림 띠·펼치기·짧은 줄·빠른 입력·개수가 모두 보이고, 짧은 줄은 다 보이며 44px 이상, 가로 넘침 0", async ({ page, browser }) => {
    const w = await lostWorld(browser, page, 'PC 2')
    const views: View[] = []
    try {
      for (const device of [D375, D412]) views.push(await viewerOf(browser, w, device, true))
      await w.station.context.setOffline(true)
      for (const v of views) {
        await openConsole(v.page, w.b, true)
        await expect(toggle(v.page), `${v.label} 접힘`).toHaveAttribute('aria-expanded', 'false')
        await expect(shortRow(v.page, shortLost('PC 2')), `${v.label} 짧은 줄`).toBeVisible({ timeout: 30_000 })
        await expect(v.page.getByRole('region', { name: '보내기 전 조치' })).toHaveCount(0)
        await checkSticky40(v.page, v.label, shortLost('PC 2'))
        await expectNoOverflow(v.page, `${v.label} 콘솔`)
      }
    } finally {
      await closeAll(views)
      await w.station.context.close()
      await w.owner.context.close()
    }
  })

  test("393×852 WebKit 150%: 'PC 2' 끊김 — 고정 영역 ≤ 340px, 모든 요소가 고정 영역 안에 보이고 짧은 줄은 다 보인다 @webkit", async ({ page, browser }) => {
    const w = await lostWorld(browser, page, 'PC 2')
    const views: View[] = []
    try {
      views.push(await viewerOf(browser, w, D393, true))
      await w.station.context.setOffline(true)
      await gotoLabels(w.owner.page)
      await expect(region(w.owner.page, '프린터')).toContainText(longLost('PC 2'), { timeout: 30_000 })
      const v = views[0]!
      await openConsole(v.page, w.b, true)
      await expect(shortRow(v.page, shortLost('PC 2'))).toBeVisible({ timeout: 30_000 })
      await checkSticky40(v.page, v.label, shortLost('PC 2'))
      await expectNoOverflow(v.page, `${v.label} 콘솔`)
    } finally {
      await closeAll(views)
      await w.station.context.close()
      await w.owner.context.close()
    }
  })
})

/** 접힌 휴대폰: 보류 단추 글·이름 "보류 1", 다 보인다, "보류 찜 1" 단추는 없다 */
async function expectFoldedPending(v: View): Promise<void> {
  await expect(toggle(v.page), `${v.label} 접힘`).toHaveAttribute('aria-expanded', 'false')
  const short = alerts(v.page).getByRole('button', { name: '보류 1', exact: true })
  await expect(short, `${v.label} 보류 1`).toBeVisible()
  await expect(short).toHaveText('보류 1', { useInnerText: true })
  await expectWhole(short, `${v.label} 보류 1`)
  await expect(alerts(v.page).getByRole('button', { name: '보류 찜 1', exact: true }), `${v.label} 접힌 띠의 "보류 찜 1"`).toHaveCount(0)
}

/** 펼친 띠: "보류 찜 1" 그대로, "보류 1" 없음 → 다시 접기 */
async function expectOpenPending(v: View): Promise<void> {
  await v.page.getByRole('button', { name: /^알림 \d+ 펼치기$/ }).click()
  await expect(v.page.getByRole('button', { name: /^알림 \d+ 접기$/ })).toBeVisible()
  await expect(alerts(v.page).getByRole('button', { name: '보류 찜 1', exact: true }), `${v.label} 펼친 띠`).toBeVisible()
  await expect(alerts(v.page).getByRole('button', { name: '보류 1', exact: true })).toHaveCount(0)
  await v.page.getByRole('button', { name: /^알림 \d+ 접기$/ }).click()
  await expect(toggle(v.page)).toHaveAttribute('aria-expanded', 'false')
}

test.describe('AC-QL3R2-11 접힌 휴대폰 띠의 보류 단추 "보류 1"', () => {
  test("끊김('PC') 있음: 375·412 × 글자 100%·150% 접힌 띠는 \"보류 1\"(이름도 같고 다 보임), 펼치면 \"보류 찜 1\", 누르면 보류 찜 창 / PC 1440은 \"보류 찜 1\"", async ({ page, browser }) => {
    const w = await lostWorld(browser, page, 'PC')
    const views: View[] = []
    try {
      for (const device of [D375, D412]) for (const big of [false, true]) views.push(await viewerOf(browser, w, device, big))
      await w.station.context.setOffline(true)
      await openConsole(w.owner.page, w.b, false)
      await expect(alerts(w.owner.page).getByRole('button', { name: longLost('PC'), exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(alerts(w.owner.page).getByRole('button', { name: '보류 찜 1', exact: true })).toBeVisible()
      await expect(alerts(w.owner.page).getByRole('button', { name: '보류 1', exact: true })).toHaveCount(0)
      for (const v of views) {
        await openConsole(v.page, w.b, v.big)
        await expect(shortRow(v.page, shortLost('PC'))).toBeVisible({ timeout: 30_000 })
        await expectFoldedPending(v)
        await expectOpenPending(v)
        await expectNoOverflow(v.page, `${v.label} 콘솔`)
      }
      // 누르면 지금처럼 보류 찜 창 (375 150%)
      const phone = views[1]!
      await alerts(phone.page).getByRole('button', { name: '보류 1', exact: true }).click()
      const dlg = phone.page.getByRole('dialog', { name: '보류 찜' })
      await expect(dlg).toBeVisible()
      await expect(dlg).toContainText('40')
    } finally {
      await closeAll(views)
      await w.station.context.close()
      await w.owner.context.close()
    }
  })

  test('출력 기기 정상(라벨 꺼짐): 375·412 × 글자 100%·150% 접힌 띠는 "보류 1", 펼치면 "보류 찜 1", 누르면 보류 찜 창 / PC 1440은 "보류 찜 1"', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    const views: View[] = []
    try {
      await setLabelsApi(s.dev, false)
      const b = await broadcastApi(s.dev, uniqueDate())
      await registerApi(s.dev, b, 1, '품종1', 1000)
      await smsApi(s.dev, { b, no: 40, memo: '보류' })
      await openConsole(s.dev, b, false)
      await expect(alerts(s.dev).getByRole('button', { name: '보류 찜 1', exact: true })).toBeVisible()
      await expect(alerts(s.dev).getByRole('button', { name: '보류 1', exact: true })).toHaveCount(0)
      const w = { owner: { page: s.dev }, seller: s.seller }
      for (const device of [D375, D412] as Device[]) for (const big of [false, true]) views.push(await viewerOf(browser, w, device, big))
      for (const v of views) {
        await openConsole(v.page, b, v.big)
        await expectFoldedPending(v)
        await expectOpenPending(v)
      }
      const phone = views[3]!
      await alerts(phone.page).getByRole('button', { name: '보류 1', exact: true }).click()
      await expect(phone.page.getByRole('dialog', { name: '보류 찜' })).toBeVisible()
    } finally {
      await closeAll(views)
      await s.close()
    }
  })
})

test.describe('AC-QL3R2-12 접힌 휴대폰 띠는 짧은 줄 하나만 (이중 표시 없음)', () => {
  test("'PC' 끊김 + 보류 찜 1: 375·412 접힌 동안 긴 문장 0번·짧은 줄 1번(누르면 라벨 화면), 펼치면 긴 문장 1번·짧은 줄 0번, \"알림 1 펼치기\" 그대로 / PC 1440은 긴 문장 1번·짧은 줄 0번", async ({ page, browser }) => {
    const w = await lostWorld(browser, page, 'PC')
    const views: View[] = []
    try {
      for (const device of [D375, D412]) views.push(await viewerOf(browser, w, device, false))
      await w.station.context.setOffline(true)
      // PC: 긴 문장 1번, 짧은 줄 0번
      await openConsole(w.owner.page, w.b, false)
      await expect(alerts(w.owner.page).getByRole('button', { name: longLost('PC'), exact: true })).toBeVisible({ timeout: 30_000 })
      expect(await sentenceCount(w.owner.page, longLost('PC')), 'PC 긴 문장 수').toBe(1)
      expect(await sentenceCount(w.owner.page, shortLost('PC')), 'PC 짧은 줄 수').toBe(0)
      await expect(w.owner.page.getByRole('button', { name: shortLost('PC'), exact: true })).toHaveCount(0)
      for (const v of views) {
        await openConsole(v.page, w.b, false)
        const row = shortRow(v.page, shortLost('PC'))
        await expect(row).toBeVisible({ timeout: 30_000 })
        // 접힌 동안: 화면에도 접근성 트리에도 긴 문장 0번, 짧은 줄 1번
        await expect(v.page.getByRole('button', { name: /^알림 1 펼치기$/ }), `${v.label} 알림 수 (출력 기기 항목은 세지 않음)`).toBeVisible()
        await expect(v.page.getByText(longLost('PC'))).toHaveCount(0)
        await expect(v.page.getByRole('button', { name: longLost('PC') })).toHaveCount(0)
        expect(await sentenceCount(v.page, longLost('PC')), `${v.label} 접힌 동안 긴 문장 수`).toBe(0)
        expect(await v.page.evaluate(() => document.body.innerText), `${v.label} 접힌 화면 글`).not.toContain(longLost('PC'))
        await expect(v.page.getByRole('button', { name: shortLost('PC'), exact: true })).toHaveCount(1)
        expect(await sentenceCount(v.page, shortLost('PC')), `${v.label} 접힌 동안 짧은 줄 수`).toBe(1)
        // 펼친 동안: 긴 문장 1번, 짧은 줄 0번
        await v.page.getByRole('button', { name: '알림 1 펼치기', exact: true }).click()
        await expect(v.page.getByRole('button', { name: '알림 1 접기', exact: true })).toBeVisible()
        await expect(alerts(v.page).getByRole('button', { name: longLost('PC'), exact: true })).toHaveCount(1)
        expect(await sentenceCount(v.page, longLost('PC')), `${v.label} 펼친 동안 긴 문장 수`).toBe(1)
        await expect(v.page.getByRole('button', { name: shortLost('PC'), exact: true })).toHaveCount(0)
        expect(await sentenceCount(v.page, shortLost('PC')), `${v.label} 펼친 동안 짧은 줄 수`).toBe(0)
        await v.page.getByRole('button', { name: '알림 1 접기', exact: true }).click()
        await expect(row).toBeVisible()
      }
      // 짧은 줄을 누르면 라벨 화면 (375)
      const phone: Page = views[0]!.page
      await shortRow(phone, shortLost('PC')).click()
      await expect(phone).toHaveURL(/\/labels$/)
    } finally {
      await closeAll(views)
      await w.station.context.close()
      await w.owner.context.close()
    }
  })
})
