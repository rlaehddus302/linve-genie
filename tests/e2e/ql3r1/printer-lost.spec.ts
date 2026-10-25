// QL3R1 휴대폰 출력 기기 끊김 짧은 줄 (AC-QL3R1-25·26, D-QL3R1-04, U-QL3-04, LBL-06) — test-e2e.
// 출력 기기(안드로이드 흉내 컨텍스트)가 망을 잃으면 다른 기기의 콘솔 알림 띠에 끊김이 뜬다(mob1/station.spec.ts와 같은 방법).
// 한 판매자·한 출력 기기에 보는 기기를 여럿(폭·글자 크기) 함께 열어 끊김 한 번으로 모두 본다.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { becomeDevice, gotoLabels, region } from '../i1/support.ts'
import { loginAs } from '../i3/support.ts'
import { uniqueDate } from '../s05/support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import { ANDROID, alerts, baseUrlOf, broadcastApi, expectNoOverflow, freshSeller, newDevice, setLabelsApi } from '../ql2/support.ts'
import { ANDROID_UA } from '../mob1/support.ts'
import { D1440, D375, D393, D412, clipOf, openConsole, type Device } from './support.ts'

const longLost = (name: string) => `출력 기기('${name}')가 연결되어 있지 않아요. 그 기기에서 라이브지니를 열고 화면을 켜 두세요.`
const shortLost = (name: string) => {
  const chars = Array.from(name)
  return `라벨이 안 나가요 · '${chars.length > 10 ? `${chars.slice(0, 10).join('')}…` : name}' 화면을 켜 주세요`
}
/** 짧은 줄 — 알림 띠 안(접힌 휴대폰에서만 보임) */
const shortRow = (page: Page, name: string) => page.locator('.alert-bar').getByRole('button', { name: shortLost(name), exact: true })

interface World {
  readonly seller: { loginId: string; password: string; shopName: string }
  readonly owner: { page: Page; context: BrowserContext }
  readonly station: { page: Page; context: BrowserContext }
  readonly b: string
  readonly date: string
}

/** 판매자(라벨 켬) + 실제 방송(보류 찜 1) + 출력 기기 */
async function world(browser: Browser, page: Page, stationName: string, viewer: Device): Promise<World> {
  await page.goto('/')
  const owner = await freshSeller(browser, baseUrlOf(page), { viewport: viewer.viewport, touch: viewer.viewport.width < 768, ...(viewer.userAgent === undefined ? {} : { userAgent: viewer.userAgent }) })
  await setLabelsApi(owner.page, true)
  const date = uniqueDate()
  const b = await broadcastApi(owner.page, date)
  await registerApi(owner.page, b, 1, '품종1', 1000)
  await smsApi(owner.page, { b, no: 40, memo: '보류' })
  const station = await newDevice(browser, baseUrlOf(owner.page), { viewport: ANDROID, touch: true, userAgent: ANDROID_UA })
  await loginAs(station.page, owner.seller)
  await becomeDevice(station.page, stationName)
  return { seller: owner.seller, owner: { page: owner.page, context: owner.context }, station, b, date }
}

/** 같은 판매자로 보는 기기를 하나 더 */
async function viewer(browser: Browser, w: World, device: Device, big: boolean): Promise<{ page: Page; context: BrowserContext }> {
  const v = await newDevice(browser, baseUrlOf(w.owner.page), { viewport: device.viewport, touch: device.viewport.width < 768, big, ...(device.userAgent === undefined ? {} : { userAgent: device.userAgent }) })
  await loginAs(v.page, w.seller)
  return v
}

/** AC-25 Then: 짧은 줄이 자기 줄에 말줄임 없이 다 보인다, 펼치지 않은 상태 */
async function expectShortRow(page: Page, name: string, where: string): Promise<void> {
  await expect(page.getByRole('button', { name: /^알림 \d+ 펼치기$/ }), `${where} 접힘`).toHaveAttribute('aria-expanded', 'false')
  const row = shortRow(page, name)
  await expect(row, `${where} 짧은 줄`).toBeVisible({ timeout: 30_000 })
  await expect(row).toHaveText(shortLost(name), { useInnerText: true })
  const c = await clipOf(row)
  expect(c.sw, `${where} 짧은 줄 옆 잘림 (scrollWidth ${String(c.sw)} > clientWidth ${String(c.cw)})`).toBeLessThanOrEqual(c.cw + 1)
  expect(c.sh, `${where} 짧은 줄 위아래 잘림 (scrollHeight ${String(c.sh)} > clientHeight ${String(c.ch)})`).toBeLessThanOrEqual(c.ch + 1)
  // 말줄임 없음 · 글자 줄 상자가 단추 안 · 화면 안
  const m = await row.evaluate((el) => {
    const s = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(el)
    const lines = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0)
    return {
      overflow: s.textOverflow,
      inside: lines.every((x) => x.top >= box.top - 0.5 && x.bottom <= box.bottom + 0.5 && x.left >= box.left - 0.5 && x.right <= box.right + 0.5),
      left: box.left,
      right: box.right,
      vw: window.innerWidth,
      // 자기 줄: 같은 띠의 다른 단추(알림 펼치기·알림 항목)와 세로로 겹치지 않는다
      // 자기 줄: "알림" 한 줄(영역)보다 아래에 있고, 단추 위 여러 점이 다른 것에 가리지 않는다
      top: box.top,
      covered: [0.1, 0.5, 0.9]
        .map((fx) => document.elementFromPoint(box.left + box.width * fx, box.top + box.height / 2))
        .filter((hit) => hit === null || !(hit === el || el.contains(hit)))
        .map((hit) => (hit === null ? 'null' : `${hit.tagName}.${hit.className} "${(hit.textContent ?? '').trim().slice(0, 20)}"`)),
    }
  })
  expect(m.inside, `${where} 짧은 줄 글자가 단추 밖으로 나감`).toBe(true)
  expect(m.overflow, `${where} 짧은 줄 말줄임`).not.toBe('ellipsis')
  expect(m.left).toBeGreaterThanOrEqual(-0.5)
  expect(m.right, `${where} 짧은 줄이 화면 안`).toBeLessThanOrEqual(m.vw + 0.5)
  const area = (await alerts(page).boundingBox())!
  expect(m.top, `${where} 짧은 줄이 "알림" 한 줄 아래 (영역 아래 끝 ${String(area.y + area.height)})`).toBeGreaterThanOrEqual(area.y + area.height - 0.5)
  expect(m.covered, `${where} 짧은 줄을 가린 것`).toEqual([])
  // 글로만 넣는다 — 이름 속 태그가 요소가 되지 않음
  expect(await row.locator('b, script').count(), `${where} 이름이 HTML로 해석됨`).toBe(0)
}

test.describe('AC-QL3R1-25·26 출력 기기 끊김 — 휴대폰 접힌 띠는 짧은 줄, 펼친 띠·PC·라벨 화면은 긴 문장', () => {
  test('출력 기기 "PC"가 끊기면 375·412 × 글자 100%·150%의 접힌 띠에 "라벨이 안 나가요 · \'PC\' 화면을 켜 주세요"가 자기 줄에 다 보이고, 누르면 라벨 화면 / 펼치면·PC 1440·라벨 화면은 긴 문장', async ({ page, browser }) => {
    const w = await world(browser, page, 'PC', D1440)
    const views: { label: string; page: Page; context: BrowserContext }[] = []
    try {
      for (const device of [D375, D412]) {
        for (const big of [false, true]) views.push({ label: `${device.label} ${big ? '150%' : '100%'}`, ...(await viewer(browser, w, device, big)) })
      }
      await w.station.context.setOffline(true)
      // PC (1440): 긴 문장 그대로, 짧은 줄은 보이지 않음
      await openConsole(w.owner.page, w.b, false)
      await expect(alerts(w.owner.page).getByRole('button', { name: longLost('PC'), exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(shortRow(w.owner.page, 'PC')).toBeHidden()
      for (const v of views) {
        await openConsole(v.page, w.b, v.label.endsWith('150%'))
        await expectShortRow(v.page, 'PC', v.label)
        await expectNoOverflow(v.page, `${v.label} 콘솔`)
      }
      // 펼치면 긴 문장 그대로, 짧은 줄은 없다 (375 100%)
      const phone = views[0]!.page
      await phone.getByRole('button', { name: /^알림 \d+ 펼치기$/ }).click()
      await expect(phone.getByRole('button', { name: /^알림 \d+ 접기$/ })).toBeVisible()
      const long = alerts(phone).getByRole('button', { name: longLost('PC'), exact: true })
      await long.scrollIntoViewIfNeeded()
      await expect(long).toBeVisible()
      await expect(shortRow(phone, 'PC')).toBeHidden()
      // 접고 짧은 줄을 누르면 라벨 화면 (BASE 줄과 같은 곳)
      await phone.getByRole('button', { name: /^알림 \d+ 접기$/ }).click()
      await shortRow(phone, 'PC').click()
      await expect(phone).toHaveURL(/\/labels$/)
      // 라벨 화면 안내는 긴 문장 그대로
      await expect(region(phone, '프린터')).toContainText(longLost('PC'))
      await expect(phone.getByText(shortLost('PC'), { exact: true })).toHaveCount(0)
    } finally {
      for (const v of views) await v.context.close()
      await w.station.context.close()
      await w.owner.context.close()
    }
  })

  test('출력 기기 이름이 11낱자 이상이고 태그 글이 들면: 짧은 줄은 앞 10낱자 + "…"이고 이름 속 <b>는 글자 그대로 (375 150%), 긴 문장은 이름 전체', async ({ page, browser }) => {
    const name = '<b>굵게</b>안방프린터'
    expect(Array.from(name).length).toBeGreaterThanOrEqual(11)
    const w = await world(browser, page, name, D375)
    try {
      const v = await viewer(browser, w, D375, true)
      try {
        await w.station.context.setOffline(true)
        await openConsole(v.page, w.b, true)
        expect(shortLost(name)).toBe("라벨이 안 나가요 · '<b>굵게</b>안…' 화면을 켜 주세요")
        await expectShortRow(v.page, name, '375 150% 긴 이름')
        // 접힌 동안 긴 문장은 0번(이중 표시 없음), 펼치면 이름 전체가 든 긴 문장 1번
        await expect(alerts(v.page).getByRole('button', { name: longLost(name), exact: true })).toHaveCount(0) // QL3R2 D-QL3R2-02
        await v.page.getByRole('button', { name: /^알림 \d+ 펼치기$/ }).click() // QL3R2 D-QL3R2-02
        await expect(alerts(v.page).getByRole('button', { name: longLost(name), exact: true })).toHaveCount(1) // QL3R2 D-QL3R2-02
        expect(await v.page.locator('.alert-bar b').count(), '알림 띠 안 b 요소').toBe(0)
      } finally {
        await v.context.close()
      }
    } finally {
      await w.station.context.close()
      await w.owner.context.close()
    }
  })

  test('393×852 WebKit 글자 100%·150%: 출력 기기 "PC"가 끊기면 접힌 띠에 짧은 줄이 자기 줄에 다 보인다 @webkit', async ({ page, browser }) => {
    const w = await world(browser, page, 'PC', D393)
    const views: { label: string; page: Page; context: BrowserContext }[] = []
    try {
      for (const big of [false, true]) views.push({ label: `393 WebKit ${big ? '150%' : '100%'}`, ...(await viewer(browser, w, D393, big)) })
      await w.station.context.setOffline(true)
      // 끊김이 서버에 닿았는지 (라벨 화면 긴 문장)
      await gotoLabels(w.owner.page)
      await expect(region(w.owner.page, '프린터')).toContainText(longLost('PC'), { timeout: 30_000 })
      for (const v of views) {
        await openConsole(v.page, w.b, v.label.endsWith('150%'))
        await expectShortRow(v.page, 'PC', v.label)
        await expectNoOverflow(v.page, `${v.label} 콘솔`)
      }
    } finally {
      for (const v of views) await v.context.close()
      await w.station.context.close()
      await w.owner.context.close()
    }
  })
})

test.describe('AC-QL3R1-26 포장 출력 안내는 긴 문장 그대로', () => {
  test('375×812 포장 모드: 출력 기기 "PC"가 끊겼으면 접수 문장 뒤 안내 상자에 긴 문장, 짧은 문장 없음', async ({ page, browser }) => {
    const w = await world(browser, page, 'PC', D375)
    try {
      const date = w.date
      await smsApi(w.owner.page, { b: w.b, no: 1, phone: '010-5300-0001' })
      const view = (await (await w.owner.page.request.get(`/api/days/${date}`)).json()) as { claims: { no: number; currentBuyer: string }[] }
      const buyer = view.claims.find((c) => c.no === 1)!.currentBuyer
      await w.station.context.setOffline(true)
      await gotoLabels(w.owner.page)
      await expect(region(w.owner.page, '프린터')).toContainText(longLost('PC'), { timeout: 30_000 })
      await w.owner.page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
      const label = w.owner.page.getByRole('region', { name: '포장 라벨' })
      await label.getByRole('button', { name: '포장 라벨 출력', exact: true }).click()
      await expect(label.getByRole('status').filter({ hasText: '포장 라벨 1장 출력을 접수했어요.' })).toBeVisible()
      await expect(label.getByRole('note').filter({ hasText: longLost('PC') })).toBeVisible()
      await expect(w.owner.page.getByText(shortLost('PC'), { exact: true })).toHaveCount(0)
    } finally {
      await w.station.context.close()
      await w.owner.context.close()
    }
  })
})
