// QL2 알림 띠 (AC-QL2-05~08, D-QL2-02) · 출력 기기 없음 문장 (AC-QL2-40, D-QL2-09 ①) · 판매자 멈춤 알림 (AC-QL2-41, D-QL2-09 ②) — test-e2e.
// 휴대폰 375×812·412×915(크로미움 터치), 글자 150%·100%, PC 1440×900. 판매자는 시험마다 새로(출력 기록은 판매자 단위).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { becomeDevice, gotoLabels, region } from '../i1/support.ts'
import { loginAs } from '../i3/support.ts'
import { ANDROID_UA } from '../mob1/support.ts'
import { uniqueDate } from '../s05/support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import {
  ANDROID,
  DISCONNECT_ALERT,
  NO_STATION_PILING,
  PC,
  PHONE,
  SELLER_PAUSE_ALERT,
  alerts,
  backlogPauseAlert,
  baseUrlOf,
  broadcastApi,
  expectBig,
  expectNoClip,
  expectNoOverflow,
  freshSeller,
  isShown,
  newDevice,
  setLabelsApi,
  stationLost,
} from './support.ts'

interface World {
  readonly main: Page
  readonly context: BrowserContext
  readonly seller: { loginId: string; password: string; shopName: string }
}

async function world(browser: Browser, page: Page, viewport: { width: number; height: number } = PHONE, big = false): Promise<World> {
  await page.goto('/')
  const { page: main, context, seller } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: viewport.width < 768, big })
  await setLabelsApi(main, true)
  return { main, context, seller }
}

/** 안드로이드 흉내 기기가 시험용 프린터로 출력 기기가 된다 */
async function station(browser: Browser, w: World, name: string): Promise<{ page: Page; context: BrowserContext }> {
  const dev = await newDevice(browser, baseUrlOf(w.main), { viewport: ANDROID, touch: true, userAgent: ANDROID_UA })
  await loginAs(dev.page, w.seller)
  await becomeDevice(dev.page, name)
  return dev
}

const toggle = (page: Page) => page.getByRole('button', { name: /^알림( \d+)? (펼치기|접기)$/ })

test.describe('AC-QL2-05·40 세는 알림 0이어도 펼치기 — 출력 기기 없음 문장', () => {
  test('375×812: 출력 기기 없음 + 대기 라벨 1장 → 항목 문장 글자 그대로, "알림 펼치기"(aria-expanded false) → "알림 접기"·문장 전체·말줄임 없음 → 다시 접힘, 누르면 라벨 화면', async ({ page, browser }) => {
    const w = await world(browser, page)
    try {
      const b = await broadcastApi(w.main, uniqueDate())
      await w.main.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(w.main.getByLabel('빠른 입력')).toBeVisible()
      // 알림 하나도 없음 → "알림 없음", 펼치기 단추 없음 (지금 그대로)
      await expect(alerts(w.main)).toHaveText('알림 없음')
      await expect(toggle(w.main)).toHaveCount(0)

      await registerApi(w.main, b, 1, '품종1', 1000)
      await smsApi(w.main, { b, no: 1, phone: '010-6200-0001' })
      const item = alerts(w.main).getByRole('button', { name: NO_STATION_PILING, exact: true })
      await expect(item).toHaveCount(1)
      await expect(alerts(w.main).getByRole('button')).toHaveCount(1)
      const open = w.main.getByRole('button', { name: '알림 펼치기', exact: true })
      await expect(open).toBeVisible()
      await expect(open).toHaveAttribute('aria-expanded', 'false')
      await open.click()
      const close = w.main.getByRole('button', { name: '알림 접기', exact: true })
      await expect(close).toHaveAttribute('aria-expanded', 'true')
      await expect(item).toBeVisible()
      await expect(item).toHaveText(NO_STATION_PILING)
      await expectNoClip(item, '펼친 출력 기기 없음 항목')
      await close.click()
      await expect(w.main.getByRole('button', { name: '알림 펼치기', exact: true })).toHaveAttribute('aria-expanded', 'false')
      // 누르면 라벨 화면 (지금 그대로)
      await item.click()
      await expect(w.main).toHaveURL(/\/labels$/)
    } finally {
      await w.context.close()
    }
  })
})

/**
 * AC-QL2-06 Given: 세는 알림 둘 + 출력 기기 끊김 항목 — 이름은 "안드로이드 폰". acceptance의 예(충돌 1·출력 멈춤 1) 가운데 충돌은
 * 실제 방송에서 채팅 없이 만들 수 없어 보류 찜 1(부드러운 노란 항목)로 바꾼다. 출력 멈춤은 출력 기기에서 "출력 멈추기"(판매자 멈춤).
 */
async function sixWorld(browser: Browser, page: Page, viewport: { width: number; height: number }, big: boolean): Promise<{ w: World; dev: { page: Page; context: BrowserContext } }> {
  const w = await world(browser, page, viewport, big)
  const dev = await station(browser, w, '안드로이드 폰')
  const b = await broadcastApi(w.main, uniqueDate())
  await smsApi(w.main, { b, no: 40, memo: '보류' })
  // 출력 기기에서 "출력 멈추기" (판매자 멈춤)
  await region(dev.page, '출력 대기열').getByRole('button', { name: '출력 멈추기' }).click()
  await expect(region(dev.page, '출력 멈춤')).toBeVisible()
  await dev.context.setOffline(true)
  await w.main.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(w.main.getByLabel('빠른 입력')).toBeVisible()
  if (big) await expectBig(w.main)
  const strip = alerts(w.main)
  await expect(strip.getByRole('button', { name: '보류 찜 1', exact: true })).toHaveCount(1)
  await expect(strip.getByRole('button', { name: SELLER_PAUSE_ALERT, exact: true })).toHaveCount(1)
  await expect(strip.getByRole('button', { name: stationLost('안드로이드 폰'), exact: true })).toHaveCount(1, { timeout: 30_000 })
  return { w, dev }
}

test.describe('AC-QL2-06·41 세는 알림이 있을 때 — 판매자 멈춤 문장', () => {
  test('375×812: 보류 찜 1·출력 멈춤 1 + 출력 기기 끊김 → "알림 2 펼치기"(출력 기기 항목은 세지 않음), 펼치면 모든 항목 글자 잘림 0', async ({ page, browser }) => {
    const { w, dev } = await sixWorld(browser, page, PHONE, false)
    try {
      const open = w.main.getByRole('button', { name: '알림 2 펼치기', exact: true })
      await expect(open).toBeVisible()
      await open.click()
      await expect(w.main.getByRole('button', { name: '알림 2 접기', exact: true })).toHaveAttribute('aria-expanded', 'true')
      for (const button of await alerts(w.main).getByRole('button').all()) {
        await expect(button).toBeVisible()
        await expectNoClip(button, '펼친 띠 항목')
      }
      await expectNoOverflow(w.main, '375 띠 펼침')
      // 판매자 멈춤 항목을 누르면 "출력 멈춤" 창, 다시 시작으로 이어진다 (숫자 1 — 지금 그대로)
      await alerts(w.main).getByRole('button', { name: SELLER_PAUSE_ALERT, exact: true }).click()
      const dlg = w.main.getByRole('dialog', { name: '출력 멈춤' })
      await expect(dlg).toBeVisible()
      await expect(dlg.getByRole('button', { name: /다시 시작/ })).toBeVisible()
    } finally {
      await dev.context.close()
      await w.context.close()
    }
  })

  for (const [label, viewport] of [['375×812', PHONE], ['412×915', ANDROID]] as const) {
    test(`AC-QL2-07 ${label} 글자 150%: 접힌 상태·펼친 상태 모두 띠 안의 보이는 버튼 글자 잘림 0, 접힌 한 줄 높이 ≥ 버튼 높이, 가로 넘침 0`, async ({ page, browser }) => {
      const { w, dev } = await sixWorld(browser, page, viewport, true)
      try {
        const strip = alerts(w.main)
        const buttons = async () => {
          const all = await strip.getByRole('button').all()
          const shown = []
          for (const b of all) if (await isShown(b)) shown.push(b)
          return shown
        }
        // 접힘
        const folded = await buttons()
        expect(folded.length, '접힌 띠에 보이는 버튼').toBeGreaterThan(0)
        const stripBox = (await strip.boundingBox())!
        for (const button of folded) {
          await expectNoClip(button, `${label} 접힌 띠`)
          const bb = (await button.boundingBox())!
          expect(stripBox.height + 0.5, `${label} 접힌 띠 한 줄 높이 ≥ 버튼 높이`).toBeGreaterThanOrEqual(bb.height)
        }
        const open = w.main.getByRole('button', { name: '알림 2 펼치기', exact: true })
        await expectNoClip(open, `${label} 펼치기 단추`)
        await expectNoOverflow(w.main, `${label} 150% 띠 접음`)
        // 펼침
        await open.click()
        const close = w.main.getByRole('button', { name: '알림 2 접기', exact: true })
        await expect(close).toBeVisible()
        for (const button of await strip.getByRole('button').all()) await expectNoClip(button, `${label} 펼친 띠`)
        await expectNoClip(close, `${label} 접기 단추`)
        await expectNoOverflow(w.main, `${label} 150% 띠 펼침`)
      } finally {
        await dev.context.close()
        await w.context.close()
      }
    })
  }

  for (const [label, viewport] of [['375×812', PHONE], ['412×915', ANDROID]] as const) {
    test(`AC-QL2-44 ${label} 글자 150%: "알림 2 펼치기" → 각 항목 폭 ≥ 띠 폭의 90%, 한 줄에 하나씩 위아래로 — 글자 잘림 0·가로 넘침 0, 접으면 한 줄`, async ({ page, browser }) => {
      const { w, dev } = await sixWorld(browser, page, viewport, true)
      try {
        const strip = alerts(w.main)
        // 띠 = 알림 목록과 펼치기 단추를 함께 담은 줄 (알림 영역의 부모)
        const bar = strip.locator('xpath=..')
        const foldedHeight = (await bar.boundingBox())!.height
        await w.main.getByRole('button', { name: '알림 2 펼치기', exact: true }).click()
        const close = w.main.getByRole('button', { name: '알림 2 접기', exact: true })
        await expect(close).toHaveAttribute('aria-expanded', 'true')
        const barBox = (await bar.boundingBox())!
        const items = await strip.getByRole('button').all()
        expect(items.length, '펼친 항목 수 (보류 찜·출력 멈춤·출력 기기 끊김)').toBe(3)
        const boxes = []
        for (const item of items) {
          await expect(item).toBeVisible()
          await expectNoClip(item, `${label} 펼친 항목`)
          const box = (await item.boundingBox())!
          expect(box.width, `${label} 항목 폭 ${String(Math.round(box.width))} / 띠 폭 ${String(Math.round(barBox.width))}`).toBeGreaterThanOrEqual(barBox.width * 0.9)
          boxes.push(box)
        }
        for (let i = 1; i < boxes.length; i += 1) {
          const a = boxes[i - 1]!
          const b = boxes[i]!
          // 위아래로 하나씩: 가로 범위가 겹치고, 다음 항목은 앞 항목 아래
          expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), `${label} 항목 ${String(i)}·${String(i + 1)} 가로 범위 겹침`).toBeGreaterThan(0)
          expect(b.y, `${label} 항목 ${String(i + 1)}이 ${String(i)} 아래`).toBeGreaterThanOrEqual(a.y + a.height - 0.5)
        }
        await expectNoClip(close, `${label} 접기 단추`)
        await expectNoOverflow(w.main, `${label} 150% 띠 펼침(전체 폭)`)
        // 접으면 지금처럼 한 줄
        await close.click()
        await expect(w.main.getByRole('button', { name: '알림 2 펼치기', exact: true })).toHaveAttribute('aria-expanded', 'false')
        expect((await bar.boundingBox())!.height, `${label} 접은 띠 높이`).toBeLessThanOrEqual(foldedHeight + 0.5)
      } finally {
        await dev.context.close()
        await w.context.close()
      }
    })
  }

  test('AC-QL2-08 1440×900 PC: 같은 알림 — 펼치기 단추 없음, 모든 항목 문장이 그대로 보이고 Alt+1은 출력 멈춤부터(보류 찜보다 앞)', async ({ page, browser }) => {
    const { w, dev } = await sixWorld(browser, page, PC, false)
    try {
      await expect(toggle(w.main)).toHaveCount(0)
      const strip = alerts(w.main)
      for (const name of ['보류 찜 1', SELLER_PAUSE_ALERT, stationLost('안드로이드 폰')]) await expect(strip.getByRole('button', { name, exact: true })).toBeVisible()
      await expect(strip).toContainText(SELLER_PAUSE_ALERT)
      await w.main.getByLabel('빠른 입력').focus()
      await w.main.keyboard.press('Alt+1')
      await expect(w.main.getByRole('dialog', { name: '출력 멈춤' })).toBeVisible()
    } finally {
      await dev.context.close()
      await w.context.close()
    }
  })
})

test.describe('AC-QL2-41 멈춤 알림의 까닭·할 일', () => {
  test('출력 기기 없이 라벨 3장이 쌓인 뒤 한 기기가 "이 기기에서 출력" → "출력 멈춤 · 쌓인 라벨 3장이 기다려요. …", 끊김 멈춤은 "출력 멈춤 · 프린터 연결이 끊겼어요." 그대로', async ({ page, browser }) => {
    const w = await world(browser, page, PC)
    let dev: { page: Page; context: BrowserContext } | null = null
    try {
      const b = await broadcastApi(w.main, uniqueDate())
      for (const no of [1, 2, 3]) {
        await registerApi(w.main, b, no, `품종${String(no)}`, 1000)
        await smsApi(w.main, { b, no, phone: `010-6300-000${String(no)}` })
      }
      dev = await newDevice(browser, baseUrlOf(w.main), { viewport: ANDROID, touch: true, userAgent: ANDROID_UA })
      await loginAs(dev.page, w.seller)
      const made = await becomeDevice(dev.page, '안드로이드 폰')
      expect(made.backlog, '쌓인 라벨 멈춤').toBe(true)
      await w.main.goto(`/broadcasts/${encodeURIComponent(b)}`)
      const strip = alerts(w.main)
      await expect(strip.getByRole('button', { name: backlogPauseAlert(3), exact: true })).toBeVisible()
      // 누르면 "출력 멈춤" 창 — "출력 시작"으로 이어진다
      await strip.getByRole('button', { name: backlogPauseAlert(3), exact: true }).click()
      const dlg = w.main.getByRole('dialog', { name: '출력 멈춤' })
      await expect(dlg.getByRole('button', { name: /출력 시작/ })).toBeVisible()
      await dlg.getByRole('button', { name: '닫기' }).click()
      // 라벨 화면 멈춤 띠의 까닭 문장(L-8)은 그대로 — 서버 문장
      await gotoLabels(dev.page)
      await expect(region(dev.page, '출력 멈춤')).toBeVisible()
      await expect(region(dev.page, '출력 멈춤')).not.toContainText('눌러서')
      // 출력 시작 → 끊김 멈춤
      await region(dev.page, '출력 멈춤').getByRole('button', { name: /출력 시작/ }).click()
      await expect(region(dev.page, '출력 멈춤')).toHaveCount(0)
      await dev.page.evaluate(() => {
        const h = (window as unknown as { livejjimTestPrinter: { setAutoReconnect(on: boolean): void; simulateDisconnect(): void } }).livejjimTestPrinter
        h.setAutoReconnect(false)
        h.simulateDisconnect()
      })
      await expect(strip.getByRole('button', { name: DISCONNECT_ALERT, exact: true })).toBeVisible({ timeout: 20_000 })
    } finally {
      await dev?.context.close()
      await w.context.close()
    }
  })
})
