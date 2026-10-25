// QL3R1 긴 창 열기 (AC-QL3R1-01~03, D-QL3R1-01, U-QL3-01) — test-e2e.
// 상품 1번(1등 1·대기 2)의 "1번 자세히"를 배경을 600px 넘게 내린 뒤 연다. 창 제목·1등 첫 이름이 첫 화면에, 창 배경 scrollTop 0, 초점은 창 안("닫기").
import { expect, test, type Locator, type Page } from '@playwright/test'
import { scopeView, writeEvent } from '../s06/support.ts'
import { D1440, D375, D393, D412, barHeight, boardCard, productOneWorld, rectOf, sellerOn, openConsole, type Device } from './support.ts'

const detail = (dev: Page) => dev.getByRole('dialog', { name: '1번 자세히' })

/** 배경을 600px 넘게 내리고 1번 카드가 화면 안에 오게 둔 뒤 누른다 — 누를 때 Playwright가 배경을 옮기지 않게(이미 보이는 자리) */
async function openFromScrolled(dev: Page, where: string): Promise<number> {
  const card = boardCard(dev, 1)
  await expect(card).toBeVisible()
  // 보드 목록은 제 안에서 내려간다 — 카드를 목록 안에서 보이게 한 뒤 배경(창)을 600px 넘게 내린다
  await card.evaluate((el) => el.scrollIntoView({ block: 'nearest' }))
  const vh = dev.viewportSize()!.height
  const bar = await barHeight(dev)
  const top = await card.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
  // 카드가 화면 가운데쯤 오는 자리, 600 이상
  const want = Math.max(600, top - (vh - bar) / 2)
  await dev.evaluate((y) => window.scrollTo(0, y), want)
  const scrolled = await dev.evaluate(() => window.scrollY)
  const max = await dev.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
  // PC 1440×900은 문서가 600px만큼 길지 않을 수 있다(보드·채팅이 제 안에서 내려감) — 그때는 끝까지 내린 상태
  expect(scrolled, `${where}: 배경을 600px 이상(문서 끝이 더 가까우면 끝까지) 내림 · 끝 ${String(max)}`).toBeGreaterThanOrEqual(Math.min(600, max) - 1)
  if (vh < 1000 && dev.viewportSize()!.width < 768) expect(scrolled, `${where}: 휴대폰은 600px 이상`).toBeGreaterThanOrEqual(600)
  const r = await rectOf(card)
  expect(r.top, `${where}: 카드가 화면 안`).toBeGreaterThanOrEqual(0)
  expect(r.bottom, `${where}: 카드가 화면 안`).toBeLessThanOrEqual(vh - bar)
  await card.click()
  await expect(detail(dev)).toBeVisible()
  return scrolled
}

/** AC-01 Then: 제목 위 끝 ≥ 0·아래 끝 ≤ (화면 − 아래 막대), 1등 첫 이름 보임, .backdrop scrollTop 0, 초점이 창 안 */
async function expectOpenedAtTop(dev: Page, where: string): Promise<void> {
  const dlg = detail(dev)
  const vh = dev.viewportSize()!.height
  const bar = await barHeight(dev)
  const limit = vh - bar
  // 처음 초점 = "닫기" (BASE 그대로, AC-02) — 초점이 들어간 뒤 잰다
  await expect(dlg.getByRole('button', { name: '닫기', exact: true })).toBeFocused()
  expect(await dlg.evaluate((el) => el.contains(document.activeElement)), `${where}: 초점이 창 안`).toBe(true)
  const title = dlg.getByRole('heading', { level: 2, name: '1번 자세히' })
  const t = await rectOf(title)
  const tText = `${where}: 제목 위 ${String(Math.round(t.top))} · 아래 ${String(Math.round(t.bottom))} · 막대 위 끝 ${String(Math.round(limit))}`
  expect(t.top, tText).toBeGreaterThanOrEqual(0)
  expect(t.bottom, tText).toBeLessThan(limit)
  const first = dlg.getByRole('region', { name: '1등' }).getByRole('listitem').first().locator('strong').first()
  await expect(first).toContainText('밤톨맘')
  const f = await rectOf(first)
  const fText = `${where}: 1등 첫 이름 위 ${String(Math.round(f.top))} · 아래 ${String(Math.round(f.bottom))} · 막대 위 끝 ${String(Math.round(limit))}`
  expect(f.top, fText).toBeGreaterThanOrEqual(0)
  expect(f.bottom, fText).toBeLessThanOrEqual(limit)
  // 가운데 점이 다른 것에 가리지 않는다
  const covered = await first.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 8), r.top + r.height / 2)
    return hit === null || !(hit === el || el.contains(hit))
  })
  expect(covered, `${fText} 덮임`).toBe(false)
  const scrollTops = await dev.evaluate(() => [...document.querySelectorAll('.backdrop')].map((el) => el.scrollTop))
  expect(scrollTops, `${where}: 창 배경 scrollTop`).toEqual(scrollTops.map(() => 0))
}

const CASES: readonly (readonly [Device, boolean])[] = [
  [D412, false],
  [D412, true],
  [D1440, false],
  [D1440, true],
]

test.describe('AC-QL3R1-01 긴 창이 맨 위에서 열린다', () => {
  for (const [device, big] of CASES) {
    test(`${device.label} 글자 ${big ? '150%' : '100%'}: 배경을 600px 넘게 내린 뒤 "1번 자세히" — 제목·1등 첫 이름이 첫 화면, 창 배경 scrollTop 0, 처음 초점 "닫기"(창 안)`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, device, big)
      try {
        const { b } = await productOneWorld(s.dev)
        await openConsole(s.dev, b, big)
        await openFromScrolled(s.dev, `${device.label} ${big ? '150%' : '100%'}`)
        await expectOpenedAtTop(s.dev, `${device.label} ${big ? '150%' : '100%'}`)
      } finally {
        await s.close()
      }
    })
  }

  for (const big of [false, true]) {
    test(`393×852 WebKit 글자 ${big ? '150%' : '100%'}: 배경을 600px 넘게 내린 뒤 "1번 자세히" — 제목·1등 첫 이름이 첫 화면, 창 배경 scrollTop 0, 처음 초점 "닫기" @webkit`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, D393, big)
      try {
        const { b } = await productOneWorld(s.dev)
        await openConsole(s.dev, b, big)
        await openFromScrolled(s.dev, `393 WebKit ${big ? '150%' : '100%'}`)
        await expectOpenedAtTop(s.dev, `393 WebKit ${big ? '150%' : '100%'}`)
      } finally {
        await s.close()
      }
    })
  }

  test('412×915 글자 150%: 창 안을 맨 아래 "닫기"까지 내린 뒤 Esc로 닫고 다시 열어도 맨 위에서 열린다', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D412, true)
    try {
      const { b } = await productOneWorld(s.dev)
      await openConsole(s.dev, b, true)
      await openFromScrolled(s.dev, '412 150% 첫 번째')
      await expectOpenedAtTop(s.dev, '412 150% 첫 번째')
      // 창 안을 내린 뒤 닫고 다시 열면 다시 맨 위
      await detail(s.dev).getByRole('button', { name: '닫기', exact: true }).scrollIntoViewIfNeeded()
      await s.dev.keyboard.press('Escape')
      await expect(detail(s.dev)).toHaveCount(0)
      await openFromScrolled(s.dev, '412 150% 두 번째')
      await expectOpenedAtTop(s.dev, '412 150% 두 번째')
    } finally {
      await s.close()
    }
  })
})

/** 창 안에서 초점을 받을 수 있는 요소 목록 (보이는 것만) */
async function focusables(dlg: Locator): Promise<number> {
  return await dlg.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.getClientRects().length > 0).length,
  )
}

test.describe('AC-QL3R1-02 창의 키 동작 그대로', () => {
  for (const device of [D412, D1440]) {
    test(`${device.label}: Tab은 창 안에서만 돈다(맨 끝 다음이 맨 처음), Shift+Tab 거꾸로도, Esc는 창을 닫는다`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, device, false)
      try {
        const { b } = await productOneWorld(s.dev)
        await openConsole(s.dev, b, false)
        await openFromScrolled(s.dev, device.label)
        const dlg = detail(s.dev)
        const close = dlg.getByRole('button', { name: '닫기', exact: true })
        await expect(close).toBeFocused()
        const n = await focusables(dlg)
        expect(n, '창 안 초점 받는 요소').toBeGreaterThan(3)
        const inside = async () => await dlg.evaluate((el) => el.contains(document.activeElement))
        // 앞으로 한 바퀴 + 2 — 한 번도 창 밖으로 나가지 않고 "닫기"로 돌아온다
        let backAtClose = 0
        for (let i = 0; i < n + 2; i += 1) {
          await s.dev.keyboard.press('Tab')
          expect(await inside(), `Tab ${String(i + 1)}번째: 초점이 창 안`).toBe(true)
          if (await close.evaluate((el) => el === document.activeElement)) backAtClose += 1
        }
        expect(backAtClose, 'Tab 한 바퀴에 "닫기"로 돌아온다').toBeGreaterThanOrEqual(1)
        // 거꾸로
        for (let i = 0; i < n + 2; i += 1) {
          await s.dev.keyboard.press('Shift+Tab')
          expect(await inside(), `Shift+Tab ${String(i + 1)}번째: 초점이 창 안`).toBe(true)
        }
        await s.dev.keyboard.press('Escape')
        await expect(dlg).toHaveCount(0)
      } finally {
        await s.close()
      }
    })
  }
})

/** 창에서 실제로 내려가는 칸 (창 배경 또는 창) */
async function scrollerTop(dev: Page): Promise<{ backdrop: number; modal: number; max: number }> {
  return await dev.evaluate(() => {
    const backdrop = [...document.querySelectorAll('.backdrop')].at(-1)
    const modal = backdrop?.querySelector('[role="dialog"]')
    return { backdrop: backdrop?.scrollTop ?? -1, modal: modal?.scrollTop ?? -1, max: backdrop === undefined ? -1 : backdrop.scrollHeight - backdrop.clientHeight }
  })
}

test.describe('AC-QL3R1-03 누른 단추가 사라져 초점이 "닫기"로 돌아가도 보던 자리 그대로', () => {
  // 100% 글자에서는 이 창이 화면에 다 들어가 내릴 곳이 없다 — 창이 화면보다 긴 큰 글씨에서 본다
  for (const [device, big] of [[D375, true], [D412, true]] as const) {
    test(`${device.label} 글자 ${big ? '150%' : '100%'}: 창을 내려 대기자 줄 단추에 초점 → 다른 기기에서 그 찜이 취소돼 단추가 사라짐 → 초점은 "닫기", 창 스크롤 위치는 ±2px`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, device, big)
      try {
        const { b, date } = await productOneWorld(s.dev)
        await openConsole(s.dev, b, big)
        await openFromScrolled(s.dev, device.label)
        const dlg = detail(s.dev)
        const waitRegion = dlg.getByRole('region', { name: '대기' })
        const firstWait = waitRegion.getByRole('listitem').filter({ hasText: '대기하나' })
        const button = firstWait.getByRole('button', { name: '무효로 하기', exact: true })
        // 그 줄이 창 아래쪽에 보이게 내린다. (그 줄을 창 맨 위에 두면 줄이 빠질 때 브라우저의 스크롤 고정(scroll anchoring)이
        // 아래 내용을 제자리에 두려고 scrollTop을 줄 높이만큼 줄인다 — 보이는 내용은 그대로라 뜀이 아니다. 그 경우는 아래 시험)
        await firstWait.evaluate((el) => el.scrollIntoView({ block: 'end' }))
        await button.focus()
        await expect(button).toBeFocused()
        const before = await scrollerTop(s.dev)
        expect(Math.max(before.backdrop, before.modal), `${device.label}: 창이 내려가 있음 (대기자 줄까지)`).toBeGreaterThan(0)
        // 다른 기기(같은 판매자 API)에서 그 대기 찜을 취소한다
        const view = await scopeView(s.dev, date, false)
        const target = view.claims.filter((c) => c.no === 1 && c.status === 'WAITLISTED').sort((x, y) => x.seq - y.seq)[0]!
        const res = await writeEvent(s.dev, { type: 'host.cancel', b, no: 1, buyer: target.currentBuyer, reason: '시험' })
        expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
        await expect(waitRegion.getByRole('listitem').filter({ hasText: '대기하나' })).toHaveCount(0)
        await expect(dlg.getByRole('button', { name: '닫기', exact: true })).toBeFocused()
        const after = await scrollerTop(s.dev)
        const text = `${device.label}: 전 ${JSON.stringify(before)} · 뒤 ${JSON.stringify(after)}`
        expect(Math.abs(after.backdrop - before.backdrop), text).toBeLessThanOrEqual(2)
        expect(Math.abs(after.modal - before.modal), text).toBeLessThanOrEqual(2)
        expect(after.backdrop, `${text} — 맨 아래로 뛰지 않음`).toBeLessThan(after.max - 2)
      } finally {
        await s.close()
      }
    })
  }

  test('375×812 글자 150%: 그 줄을 창 맨 위에 두고 사라지면 바로 아래 줄("대기둘")이 화면 같은 자리(±2px)에 남는다 — 맨 아래 "닫기"로 뛰지 않는다', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D375, true)
    try {
      const { b, date } = await productOneWorld(s.dev)
      await openConsole(s.dev, b, true)
      await openFromScrolled(s.dev, '375 150%')
      const dlg = detail(s.dev)
      const waitRegion = dlg.getByRole('region', { name: '대기' })
      const firstWait = waitRegion.getByRole('listitem').filter({ hasText: '대기하나' })
      const next = waitRegion.getByRole('listitem').filter({ hasText: '대기둘' })
      await firstWait.evaluate((el) => el.scrollIntoView({ block: 'start' }))
      await firstWait.getByRole('button', { name: '무효로 하기', exact: true }).focus()
      const nextBefore = (await rectOf(next)).top
      const view = await scopeView(s.dev, date, false)
      const target = view.claims.filter((c) => c.no === 1 && c.status === 'WAITLISTED').sort((x, y) => x.seq - y.seq)[0]!
      const res = await writeEvent(s.dev, { type: 'host.cancel', b, no: 1, buyer: target.currentBuyer, reason: '시험' })
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
      await expect(firstWait).toHaveCount(0)
      await expect(dlg.getByRole('button', { name: '닫기', exact: true })).toBeFocused()
      const nextAfter = (await rectOf(next)).top
      expect(Math.abs(nextAfter - nextBefore), `"대기둘" 화면 위 끝: 전 ${String(nextBefore)} · 뒤 ${String(nextAfter)}`).toBeLessThanOrEqual(2)
      const after = await scrollerTop(s.dev)
      expect(after.backdrop, `창 배경 ${JSON.stringify(after)} — 맨 아래로 뛰지 않음`).toBeLessThan(after.max - 2)
    } finally {
      await s.close()
    }
  })
})
