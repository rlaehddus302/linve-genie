// QL3R1 150% 고정 영역 높이 (AC-QL3R1-10·11, D-QL3R1-02, U-QL3-02) — test-e2e.
// 실제 방송, 알림 접힘·보류 찜 1·출력 기기 정상(라벨 꺼짐 — 출력 기기 줄 없음)·되돌리기 대기 없음(API로 넣음), 600px 내림.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { uniqueDate } from '../s05/support.ts'
import { smsApi } from '../s06/support.ts'
import { broadcastApi, expectNoOverflow, setLabelsApi } from '../ql2/support.ts'
import { expectNoDevWords } from '../mob1/support.ts'
import { D1440, D375, D393, D412, clipOf, lineCount, openConsole, registerStock, sellerOn, type Device } from './support.ts'

/** 넘칠 만큼 긴 이름 (요약 줄 {이름}은 10낱자로 잘림 — D-QL2-11 (1)) */
const LONG_NAME = '핑크프릴라울오로라대품'
const WINNER = '밤톨맘다육이네가게'
const summary = (page: Page) => page.getByRole('status', { name: '현재 상품 요약' })
const sticky = (page: Page) => page.locator('main .console-sticky')

async function world(dev: Page): Promise<string> {
  const b = await broadcastApi(dev, uniqueDate())
  await setLabelsApi(dev, false)
  await registerStock(dev, b, 15, LONG_NAME, 10000, 2)
  await smsApi(dev, { b, no: 15, memo: WINNER })
  // 보류 찜 1 (등록 안 한 번호)
  await smsApi(dev, { b, no: 40, memo: '병' })
  return b
}

/** 위아래 잘림 0 (요약 줄은 옆 말줄임 허용 — 다른 요소는 옆도) */
async function expectNoClipIn(target: Locator, where: string, allowSide: boolean): Promise<void> {
  const r = await clipOf(target)
  expect(r.sh, `${where} "${r.text}" 위아래 잘림 (scrollHeight ${String(r.sh)} > clientHeight ${String(r.ch)})`).toBeLessThanOrEqual(r.ch + 1)
  if (!allowSide) expect(r.sw, `${where} "${r.text}" 옆 잘림 (scrollWidth ${String(r.sw)} > clientWidth ${String(r.cw)})`).toBeLessThanOrEqual(r.cw + 1)
}

/** 고정 영역 안에 보이는가 (상자가 고정 영역 안·화면 안, 가운데 점이 그 요소) */
async function expectInsideSticky(page: Page, target: Locator, where: string): Promise<void> {
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

const LIMIT: Readonly<Record<number, number>> = { 375: 284, 393: 298, 412: 320 }

async function checkSticky(page: Page, device: Device): Promise<void> {
  const where = `${device.label} 150%`
  const vh = device.viewport.height
  await page.evaluate(() => window.scrollTo(0, 600))
  await expect.poll(async () => await page.evaluate(() => window.scrollY), { message: `${where}: 600px 내림` }).toBeGreaterThanOrEqual(600)
  const height = await sticky(page).evaluate((el) => el.getBoundingClientRect().height)
  const limit = vh * 0.35
  expect(LIMIT[device.viewport.width]).toBe(Math.floor(limit))
  expect(height, `${where}: 고정 영역 높이 ${String(height)}px ≤ 화면 × 0.35 = ${String(limit)}px`).toBeLessThanOrEqual(limit)
  // 그 안에 요약 줄·알림 띠(펼치기 단추 포함)·빠른 입력 칸·"개수" 칸이 모두 보인다
  const toggle = page.getByRole('button', { name: /^알림 \d+ 펼치기$/ })
  const items: readonly (readonly [string, Locator, boolean])[] = [
    ['요약 줄', summary(page), true],
    ['알림 띠', page.getByRole('region', { name: '알림' }), true],
    ['알림 펼치기', toggle, false],
    ['빠른 입력', page.getByLabel('빠른 입력'), false],
    ['개수', page.getByLabel('개수', { exact: true }), false],
  ]
  for (const [name, target, side] of items) {
    await expect(target, `${where} ${name}`).toBeVisible()
    await expectInsideSticky(page, target, `${where} ${name}`)
    // 알림 띠는 접힌 한 줄 말줄임(D-QL2-02)이라 옆은 재지 않는다 — 위아래만
    await expectNoClipIn(target, `${where} ${name}`, side)
  }
  // 알림 띠의 첫 항목 "보류 찜 1"은 잘리지 않고 보인다
  const pending = page.getByRole('region', { name: '알림' }).getByRole('button', { name: '보류 찜 1', exact: true })
  await expectInsideSticky(page, pending, `${where} 보류 찜 1`)
  await expectNoClipIn(pending, `${where} 보류 찜 1`, false)
  await page.evaluate(() => window.scrollTo(0, 0))
}

/** AC-11: 한 줄(높이 ≤ 줄 높이 × 1.2), 넘치면 "…", title = 문장 전체, 카드에는 이름·1등 전체 */
async function checkSummaryLine(page: Page, where: string): Promise<void> {
  const line = summary(page)
  const card = page.getByRole('region', { name: '현재 상품' })
  const winner = (await card.getByText(/^1등: /).innerText()).replace(/^1등: /, '').trim()
  expect(winner, `${where} 카드의 1등 전체`).toContain(WINNER)
  const clip = (text: string) => (Array.from(text).length > 10 ? `${Array.from(text).slice(0, 10).join('')}…` : text)
  const sentence = `15번 ${clip(LONG_NAME)} · 판매 중 · 1등 ${clip(winner)} · 대기 0명`
  await expect(line).toHaveText(sentence)
  await expect(line).toHaveAttribute('title', sentence)
  expect(await line.locator('b, script').count()).toBe(0)
  const m = await line.evaluate((el) => {
    const s = getComputedStyle(el)
    const content = el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)
    return { content, lh: parseFloat(s.lineHeight), overflow: s.textOverflow, sw: el.scrollWidth, cw: el.clientWidth }
  })
  expect(await lineCount(line), `${where} 요약 줄 줄 수`).toBe(1)
  expect(m.content, `${where} 요약 줄 높이 ${String(m.content)} ≤ 줄 높이 ${String(m.lh)} × 1.2`).toBeLessThanOrEqual(m.lh * 1.2)
  // 이 문장은 이 폭에서 넘친다 — 끝이 "…"(text-overflow: ellipsis)
  expect(m.sw, `${where} 요약 줄이 넘칠 만큼 긴 문장 (scrollWidth ${String(m.sw)} · clientWidth ${String(m.cw)})`).toBeGreaterThan(m.cw)
  expect(m.overflow, `${where} 넘치면 끝이 "…"`).toBe('ellipsis')
  // 현재 상품 카드에는 이름·1등 전체
  await expect(card.getByText(LONG_NAME, { exact: true })).toBeVisible()
  await expect(card.getByText(/^1등: /)).toContainText(WINNER)
}

test.describe('AC-QL3R1-10·11 글자 150% 휴대폰 고정 영역 ≤ 화면 35%, 요약은 한 줄 말줄임', () => {
  for (const device of [D375, D412]) {
    test(`${device.label} 150%: 600px 내린 뒤 고정 영역 ≤ ${String(LIMIT[device.viewport.width])}px, 요약 줄·알림 띠·펼치기·빠른 입력·개수가 고정 영역 안에 잘림 없이 보이고, 요약은 한 줄 "…"·title 전체`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, device, true)
      try {
        const b = await world(s.dev)
        await openConsole(s.dev, b, true)
        await expect(s.dev.getByRole('button', { name: '알림 1 펼치기', exact: true })).toHaveAttribute('aria-expanded', 'false')
        await expect(s.dev.getByRole('region', { name: '보내기 전 조치' })).toHaveCount(0)
        await checkSticky(s.dev, device)
        await checkSummaryLine(s.dev, `${device.label} 150%`)
        // AC-90: 가로 넘침 0, 개발 용어 0
        await expectNoOverflow(s.dev, `${device.label} 150% 콘솔`)
        await expectNoDevWords(s.dev, `${device.label} 150% 콘솔`)
      } finally {
        await s.close()
      }
    })
  }

  test('393×852 WebKit 150%: 600px 내린 뒤 고정 영역 ≤ 298px, 요약 줄·알림 띠·펼치기·빠른 입력·개수가 잘림 없이 보이고, 요약은 한 줄 "…"·title 전체 @webkit', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D393, true)
    try {
      const b = await world(s.dev)
      await openConsole(s.dev, b, true)
      await checkSticky(s.dev, D393)
      await checkSummaryLine(s.dev, '393 WebKit 150%')
      await expectNoOverflow(s.dev, '393 WebKit 150% 콘솔')
    } finally {
      await s.close()
    }
  })

  test('375×812 150%: 빠른 입력 칸은 접히지 않는다 — 누르지 않아도 바로 글을 칠 수 있고, 입력칸 폭은 화면의 60% 이상', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D375, true)
    try {
      const b = await world(s.dev)
      await openConsole(s.dev, b, true)
      const input = s.dev.getByLabel('빠른 입력')
      await expect(input).toBeEditable()
      const w = (await input.boundingBox())!.width
      expect(w, `입력칸 폭 ${String(w)}`).toBeGreaterThanOrEqual(375 * 0.6)
      await input.fill('16 청보석 20000')
      await expect(input).toHaveValue('16 청보석 20000')
    } finally {
      await s.close()
    }
  })

  test('1440×900 PC: 요약 줄이 없다 (그대로)', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, true)
    try {
      const b = await world(s.dev)
      await openConsole(s.dev, b, true)
      await expect(summary(s.dev)).toHaveCount(0)
      await expect(s.dev.getByRole('region', { name: '현재 상품' }).getByText(LONG_NAME, { exact: true })).toBeVisible()
    } finally {
      await s.close()
    }
  })
})
