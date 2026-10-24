// MOB1 누름 모양 (AC-MOB1-01, D-MOB1-02 — hover는 마우스 기기만, 알림 버튼 대비) — test-e2e.
// 412×915 터치(안드로이드 흉내 — isMobile·hasTouch)에서 알림 버튼을 손가락으로 누르고 창을 닫은 뒤의 계산된 색, 1440×900 마우스로 올렸을 때의 색·대비.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { sendViewerChat, smsApi, uniqueDate, viewerClaim, registerApi } from '../s06/support.ts'
import { ANDROID, ANDROID_UA, PC, alerts, baseUrlOf, broadcastApi, colorsOf, contrast, freshSeller } from './support.ts'

const RED = { bg: 'rgb(179, 38, 30)', color: 'rgb(255, 255, 255)' }
const SOFT = { bg: 'rgb(254, 247, 224)', color: 'rgb(61, 43, 0)' }
const RED_HOVER = { bg: 'rgb(140, 29, 24)', color: 'rgb(255, 255, 255)' }
const SOFT_HOVER = { bg: 'rgb(253, 238, 194)', color: 'rgb(61, 43, 0)' }

/** 리허설 콘솔에 빨간 알림(취소 요청 1)·노란 알림(보류 찜 1) */
async function consoleWithAlerts(page: Page): Promise<void> {
  const b = await broadcastApi(page, uniqueDate(), true)
  await registerApi(page, b, 7, '핑크프릴', 10000)
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
  await viewerClaim(page, b, '셋째', '7', 'sim_third_0003')
  await sendViewerChat(page, b, '셋째', '7 취소', 'sim_third_0003')
  await smsApi(page, { b, no: 40, memo: '보류' })
  await expect(redAlert(page)).toBeVisible()
  await expect(softAlert(page)).toBeVisible()
}

function redAlert(page: Page): Locator {
  return alerts(page).getByRole('button', { name: /^취소 요청 1$/ })
}
function softAlert(page: Page): Locator {
  return alerts(page).getByRole('button', { name: /^보류 찜 1$/ })
}

/** 눌러 창을 열고 "닫기"로 닫는다 (터치면 손가락) */
async function pressAndClose(page: Page, button: Locator, touch: boolean): Promise<void> {
  if (touch) await button.tap()
  else await button.click()
  const dlg = page.getByRole('dialog').first()
  await expect(dlg).toBeVisible()
  const close = dlg.getByRole('button', { name: '닫기', exact: true }).last()
  if (touch) await close.tap()
  else await close.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test.describe('AC-MOB1-01 누름 모양', () => {
  test('412×915 터치: 빨간 알림을 누르고 창을 닫아도 배경 #b3261e·흰 글자(회색 바탕 아님), 노란 알림도 #fef7e0·#3d2b00', async ({ page, browser }) => {
    await page.goto('/')
    const { page: phone, context } = await freshSeller(browser, baseUrlOf(page), { viewport: ANDROID, touch: true, userAgent: ANDROID_UA })
    try {
      await consoleWithAlerts(phone)
      // 이 기기는 마우스가 아니다 (터치 흉내 — hover 없음)
      expect(await phone.evaluate(() => matchMedia('(hover: hover)').matches), '터치 기기').toBe(false)
      const red = redAlert(phone)
      expect(await colorsOf(red), '누르기 전 빨간 알림').toEqual(RED)
      await pressAndClose(phone, red, true)
      await expect(red).toBeVisible()
      expect(await colorsOf(red), '누르고 닫은 뒤 빨간 알림').toEqual(RED)
      expect(contrast((await colorsOf(red)).color, (await colorsOf(red)).bg)).toBeGreaterThanOrEqual(4.5)
      const soft = softAlert(phone)
      await pressAndClose(phone, soft, true)
      await expect(soft).toBeVisible()
      expect(await colorsOf(soft), '누르고 닫은 뒤 노란 알림').toEqual(SOFT)
      // 초점이 남은 채로도 (닫은 뒤 버튼에 초점을 둔다)
      await red.focus()
      expect(await colorsOf(red), '초점이 있는 빨간 알림').toEqual(RED)
    } finally {
      await context.close()
    }
  })

  test('1440×900 마우스: 빨간 알림 올림 #8c1d18·흰 글자, 노란 알림 #fdeec2·#3d2b00, 보통·주·위험 버튼도 올렸을 때 대비 4.5:1 이상', async ({ page, browser }) => {
    await page.goto('/')
    const { page: pc, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      await consoleWithAlerts(pc)
      expect(await pc.evaluate(() => matchMedia('(hover: hover)').matches), '마우스 기기').toBe(true)
      await redAlert(pc).hover()
      await expect.poll(() => colorsOf(redAlert(pc)), '빨간 알림 올림').toEqual(RED_HOVER)
      await softAlert(pc).hover()
      await expect.poll(() => colorsOf(softAlert(pc)), '노란 알림 올림').toEqual(SOFT_HOVER)
      await pc.mouse.move(0, 0)
      await expect.poll(() => colorsOf(redAlert(pc)), '올림을 떼면').toEqual(RED)

      // 보통 버튼 ("방송 끝내기")
      const normal = pc.getByRole('button', { name: '방송 끝내기' })
      await normal.hover()
      const n = await colorsOf(normal)
      expect(contrast(n.color, n.bg), `보통 버튼 올림 ${JSON.stringify(n)}`).toBeGreaterThanOrEqual(4.5)
      // 주·위험 버튼 ("방송 끝내기" 창의 "끝내기"·로그아웃 창의 위험 버튼)
      await normal.click()
      const end = pc.getByRole('dialog', { name: '방송 끝내기' })
      for (const button of await end.getByRole('button').all()) {
        await button.hover()
        const c = await colorsOf(button)
        expect(contrast(c.color, c.bg), `창 버튼 "${(await button.textContent()) ?? ''}" 올림 ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(4.5)
      }
      await end.getByRole('button', { name: '닫기', exact: true }).click()
      await pc.getByRole('banner').getByRole('button', { name: '로그아웃', exact: true }).click()
      const out = pc.getByRole('dialog', { name: '로그아웃할까요?' })
      await expect(out).toBeVisible()
      const danger = out.getByRole('button', { name: '로그아웃', exact: true })
      await expect(danger).toHaveClass(/button-danger/)
      await danger.hover()
      const d = await colorsOf(danger)
      expect(contrast(d.color, d.bg), `위험 버튼 올림 ${JSON.stringify(d)}`).toBeGreaterThanOrEqual(4.5)
      const primaries = pc.locator('.button-primary:visible')
      await out.getByRole('button', { name: '로그인 유지', exact: true }).click()
      await pc.goto('/sms')
      await expect(pc.getByRole('heading', { level: 1, name: '문자찜 입력' })).toBeVisible()
      for (const p of await primaries.all()) {
        if (await p.isDisabled()) continue
        await p.hover()
        const c = await colorsOf(p)
        expect(contrast(c.color, c.bg), `주 버튼 "${(await p.textContent()) ?? ''}" 올림 ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(4.5)
      }
    } finally {
      await context.close()
    }
  })
})
