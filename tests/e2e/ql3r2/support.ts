// QL3R2 E2E 공용 도우미 (test-e2e) — 품질 3회차 2회차 고칠 것 (harness/sprints/QL3R2/acceptance.md).
// 기대값은 acceptance.md의 따옴표 문장에서 정했다(구현을 보고 정하지 않음).
// 기기: 375×812·412×915 크로미움(터치), 393×852 WebKit(@webkit 묶음), PC 1440×900. 글자 150% = `html { font-size: 150% }`.
import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { becomeDevice } from '../i1/support.ts'
import { loginAs } from '../i3/support.ts'
import { uniqueDate } from '../s05/support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import { ANDROID_UA } from '../mob1/support.ts'
import { ANDROID, alerts, baseUrlOf, broadcastApi, freshSeller, newDevice, setLabelsApi } from '../ql2/support.ts'
import { clipOf, type Device } from '../ql3r1/support.ts'

export { D1440, D375, D393, D412, clipOf, openConsole, rectOf, sellerOn, type Device } from '../ql3r1/support.ts'
export { alerts, expectNoOverflow } from '../ql2/support.ts'

/** 끊김 긴 문장 (펼친 띠·PC) */
export const longLost = (name: string): string => `출력 기기('${name}')가 연결되어 있지 않아요. 그 기기에서 라이브지니를 열고 화면을 켜 두세요.`
/** 끊김 짧은 줄 (접힌 휴대폰 띠 — 이름 10낱자 이하) */
export const shortLost = (name: string): string => `라벨이 안 나가요 · '${name}' 화면을 켜 주세요`
/** 출력 기기 없음 + 대기 라벨 — 긴 문장 (펼친 띠·PC) */
export const NO_STATION_LONG = "출력 기기가 아직 없어 라벨이 쌓이고 있어요. 출력할 기기의 라벨 화면에서 프린터를 연결한 뒤 '이 기기에서 출력'을 눌러 주세요."
/** 출력 기기 없음 + 대기 라벨 — 짧은 줄 (AC-QL3R2-14) */
export const NO_STATION_SHORT = '라벨이 안 나가요 · 라벨 화면에서 프린터를 연결해 주세요'

export const toggle = (page: Page): Locator => page.getByRole('button', { name: /^알림( \d+)? (펼치기|접기)$/ })
export const summary = (page: Page): Locator => page.getByRole('status', { name: '현재 상품 요약' })
export const sticky = (page: Page): Locator => page.locator('main .console-sticky')
/** 접힌 휴대폰 띠의 짧은 줄 (그 문장 그대로인 누르는 줄) */
export const shortRow = (page: Page, text: string): Locator => page.locator('.alert-bar').getByRole('button', { name: text, exact: true })

/** 화면 기준 상자·잘림을 한 번에 */
export async function expectWhole(target: Locator, where: string): Promise<void> {
  const c = await clipOf(target)
  expect(c.sw, `${where} "${c.text}" 옆 잘림 (scrollWidth ${String(c.sw)} > clientWidth ${String(c.cw)})`).toBeLessThanOrEqual(c.cw + 1)
  expect(c.sh, `${where} "${c.text}" 위아래 잘림 (scrollHeight ${String(c.sh)} > clientHeight ${String(c.ch)})`).toBeLessThanOrEqual(c.ch + 1)
}

/** 고정 영역 안에 보이는가 (상자가 고정 영역 안·화면 안, 가운데 점이 그 요소) — ql3r1/sticky-height.spec.ts와 같은 방법 */
export async function expectInsideSticky(page: Page, target: Locator, where: string): Promise<void> {
  const r = await target.evaluate((el) => {
    let pinned: Element | null = el.parentElement
    while (pinned !== null && getComputedStyle(pinned).position !== 'sticky') pinned = pinned.parentElement
    const b = el.getBoundingClientRect()
    const p = pinned?.getBoundingClientRect()
    const hit = document.elementFromPoint(b.left + Math.min(b.width / 2, 8), b.top + b.height / 2)
    return { top: b.top, bottom: b.bottom, ptop: p?.top ?? NaN, pbottom: p?.bottom ?? NaN, covered: hit === null || !(hit === el || el.contains(hit)) }
  })
  const text = `${where}: 위 ${String(Math.round(r.top))}·아래 ${String(Math.round(r.bottom))} / 고정 영역 ${String(Math.round(r.ptop))}~${String(Math.round(r.pbottom))}`
  expect(r.top, text).toBeGreaterThanOrEqual(Math.max(0, r.ptop) - 0.5)
  expect(r.bottom, text).toBeLessThanOrEqual(Math.min(page.viewportSize()!.height, r.pbottom) + 0.5)
  expect(r.covered, `${text} 덮임`).toBe(false)
}

/** 짧은 줄: 말줄임 없이 다 보인다 (옆·위아래 잘림 0, text-overflow 아님, 글자 줄이 단추 안, 화면 안) */
export async function expectShortWhole(page: Page, row: Locator, where: string): Promise<void> {
  await expect(row, `${where} 짧은 줄`).toBeVisible()
  await expectWhole(row, `${where} 짧은 줄`)
  const m = await row.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(el)
    const lines = [...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0)
    return {
      overflow: getComputedStyle(el).textOverflow,
      inside: lines.every((x) => x.top >= box.top - 0.5 && x.bottom <= box.bottom + 0.5 && x.left >= box.left - 0.5 && x.right <= box.right + 0.5),
      left: box.left,
      right: box.right,
      vw: window.innerWidth,
    }
  })
  expect(m.overflow, `${where} 짧은 줄 말줄임`).not.toBe('ellipsis')
  expect(m.inside, `${where} 짧은 줄 글자가 단추 밖으로 나감`).toBe(true)
  expect(m.left).toBeGreaterThanOrEqual(-0.5)
  expect(m.right, `${where} 짧은 줄이 화면 안`).toBeLessThanOrEqual(m.vw + 0.5)
  expect(await row.locator('b, script').count(), `${where} 짧은 줄 안 요소`).toBe(0)
  void page
}

/** 화면에 보이는 글·접근성 트리(이름) 어디에도 그 문장이 몇 번 있는가 — 숨긴 사본도 센다 */
export async function sentenceCount(page: Page, sentence: string): Promise<number> {
  return await page.evaluate((s) => {
    let n = 0
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent ?? '').join('')
      if (own.includes(s)) n += 1
      for (const attr of ['aria-label', 'title', 'aria-description']) if ((el.getAttribute(attr) ?? '').includes(s)) n += 1
    }
    return n
  }, sentence)
}

export interface LostWorld {
  readonly seller: { loginId: string; password: string; shopName: string }
  readonly owner: { page: Page; context: BrowserContext }
  readonly station: { page: Page; context: BrowserContext }
  readonly b: string
  readonly date: string
}

/**
 * 판매자(라벨 켬) + 실제 방송(보류 찜 1, 700px 넘게 내릴 수 있게 상품 여럿) + 출력 기기(안드로이드 흉내).
 * 보는 판매자 화면은 PC 1440 100%. 끊김은 `lose()`로.
 */
export async function lostWorld(browser: Browser, page: Page, stationName: string): Promise<LostWorld> {
  await page.goto('/')
  const owner = await freshSeller(browser, baseUrlOf(page), { viewport: { width: 1440, height: 900 } })
  await setLabelsApi(owner.page, true)
  const date = uniqueDate()
  const b = await broadcastApi(owner.page, date)
  for (let no = 1; no <= 14; no += 1) await registerApi(owner.page, b, no, `품종${String(no)}`, 1000 * no)
  // 보류 찜 1 (등록 안 한 번호)
  await smsApi(owner.page, { b, no: 40, memo: '보류' })
  const station = await newDevice(browser, baseUrlOf(owner.page), { viewport: ANDROID, touch: true, userAgent: ANDROID_UA })
  await loginAs(station.page, owner.seller)
  await becomeDevice(station.page, stationName)
  return { seller: owner.seller, owner: { page: owner.page, context: owner.context }, station, b, date }
}

/** 같은 판매자로 보는 기기를 하나 더 */
export async function viewerOf(browser: Browser, w: { owner: { page: Page }; seller: { loginId: string; password: string; shopName: string } }, device: Device, big: boolean): Promise<{ page: Page; context: BrowserContext; label: string; big: boolean; device: Device }> {
  const v = await newDevice(browser, baseUrlOf(w.owner.page), { viewport: device.viewport, touch: device.viewport.width < 768, big, ...(device.userAgent === undefined ? {} : { userAgent: device.userAgent }) })
  await loginAs(v.page, w.seller)
  return { ...v, label: `${device.label} ${big ? '150%' : '100%'}`, big, device }
}

/** 700px 내리고 고정 영역 높이 ≤ 화면 × 0.40 — 그 안의 요소가 모두 보이는가 */
export async function checkSticky40(page: Page, where: string, short: string): Promise<void> {
  const vh = page.viewportSize()!.height
  await page.evaluate(() => window.scrollTo(0, 700))
  await expect.poll(async () => await page.evaluate(() => window.scrollY), { message: `${where}: 700px 내림` }).toBeGreaterThanOrEqual(700)
  const height = await sticky(page).evaluate((el) => el.getBoundingClientRect().height)
  const limit = vh * 0.4
  expect(height, `${where}: 고정 영역 높이 ${String(height)}px ≤ 화면 × 0.40 = ${String(limit)}px`).toBeLessThanOrEqual(limit)
  const row = shortRow(page, short)
  const items: readonly (readonly [string, Locator])[] = [
    ['요약 줄', summary(page)],
    ['알림 띠', alerts(page)],
    ['알림 펼치기', page.getByRole('button', { name: /^알림( \d+)? 펼치기$/ })],
    ['짧은 줄', row],
    ['빠른 입력', page.getByLabel('빠른 입력')],
    ['개수', page.getByLabel('개수', { exact: true })],
  ]
  for (const [name, target] of items) {
    await expect(target, `${where} ${name}`).toBeVisible()
    await expectInsideSticky(page, target, `${where} ${name}`)
  }
  await expectShortWhole(page, row, where)
  const h = (await row.boundingBox())!.height
  expect(h, `${where} 짧은 줄 높이 ${String(h)} ≥ 44`).toBeGreaterThanOrEqual(44)
  await page.evaluate(() => window.scrollTo(0, 0))
}
