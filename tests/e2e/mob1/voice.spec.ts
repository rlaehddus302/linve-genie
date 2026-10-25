// MOB1 음성 (AC-MOB1-10 화면 꺼짐 막기 · AC-MOB1-11 안내 창 마지막 줄, D-MOB1-07, VOC-01) — test-e2e (412 크로미움 터치). 393 WebKit은 webkit.spec.ts.
// 가짜 Wake Lock(addInitScript — support.ts installFakeWake)과 가짜 음성 인식(I4 installFakeSpeech).
import { expect, test, type Browser, type Page } from '@playwright/test'
import { becomeDevice } from '../i1/support.ts'
import { installFakeSpeech, turnOnVoice, voiceRegion } from '../i4/support.ts'
import { uniqueDate } from '../s05/support.ts'
import { ANDROID, ANDROID_UA, baseUrlOf, broadcastApi, freshSeller, hideScreen, installFakeWake, setLabelsApi, showScreen, wakeCounts, type FakeWakeOptions } from './support.ts'

const CONSENT_LINES = [
  '말한 번호·품종·가격을 카드로 보여 줘요. 카드를 확인하고 등록해야 상품이 생겨요.',
  // V3 (D-V3-17, AC-V3-42): 처음 켤 때 안내 창에 한 줄 더 (D-I5-11 줄은 그대로)
  '번호와 가격이 들리면 바로 등록돼요. 음성 설정에서 끌 수 있어요.',
  '음성은 인식을 위해 브라우저의 음성 인식 서버(크롬은 구글, 아이폰은 애플)로 보내져요. 라이브지니는 음성을 녹음하거나 저장하지 않아요.',
  '다음에 브라우저가 마이크 사용을 물으면 "허용"을 눌러 주세요.',
  '방송하는 폰이 아닌 다른 기기(관리 폰이나 PC)에서 켜 주세요. 방송 앱이 마이크를 쓰는 폰에서는 잘 듣지 못해요.',
]

async function voiceConsole(page: Page): Promise<void> {
  const b = await broadcastApi(page, uniqueDate(), true)
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
}

function voiceOff(page: Page) {
  return voiceRegion(page).getByRole('button', { name: '음성 끄기', exact: true })
}

async function seller(browser: Browser, page: Page, wake: FakeWakeOptions = {}, consent = true): Promise<{ dev: Page; close: () => Promise<void> }> {
  await page.goto('/')
  const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: ANDROID, touch: true, userAgent: ANDROID_UA })
  await installFakeWake(context, wake)
  await installFakeSpeech(context, { consent })
  return { dev, close: () => context.close() }
}

test.describe('AC-MOB1-10 음성이 켜진 동안 화면 꺼짐 막기', () => {
  test('음성 켜기 → request("screen") 1번, 끄기 → 그 잠금을 놓는다', async ({ page, browser }) => {
    const { dev, close } = await seller(browser, page)
    try {
      await setLabelsApi(dev, false) // 출력 기기 잠금과 섞이지 않게
      await voiceConsole(dev)
      expect((await wakeCounts(dev)).requests, '켜기 전').toEqual([])
      await turnOnVoice(dev)
      await expect.poll(async () => (await wakeCounts(dev)).requests).toEqual(['screen'])
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(1)
      await voiceOff(dev).click()
      await expect(dev.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(0)
      expect((await wakeCounts(dev)).releasedByApp).toBe(1)
      expect((await wakeCounts(dev)).requests).toEqual(['screen'])
    } finally {
      await close()
    }
  })

  test('켜진 채 화면이 숨었다(브라우저가 잠금을 놓음) 다시 보이면 1번 다시 요청 — 끈 뒤에 보이면 요청하지 않는다', async ({ page, browser }) => {
    const { dev, close } = await seller(browser, page)
    try {
      await setLabelsApi(dev, false)
      await voiceConsole(dev)
      await turnOnVoice(dev)
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(1)
      await hideScreen(dev)
      expect((await wakeCounts(dev)).held).toBe(0)
      await showScreen(dev)
      await expect.poll(async () => (await wakeCounts(dev)).requests.length).toBe(2)
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(1)
      // 숨김·보임을 한 번 더 — 매번 1번씩
      await hideScreen(dev)
      await showScreen(dev)
      await expect.poll(async () => (await wakeCounts(dev)).requests.length).toBe(3)
      // 보이는 채 다시 보임 알림이 와도 더 요청하지 않는다 (이미 잡고 있음)
      await showScreen(dev)
      await expect(voiceRegion(dev).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
      expect((await wakeCounts(dev)).requests.length).toBe(3)
      // 끈 뒤
      await voiceOff(dev).click()
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(0)
      await hideScreen(dev)
      await showScreen(dev)
      await expect(dev.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
      expect((await wakeCounts(dev)).requests.length, '끈 뒤 보여도 요청 없음').toBe(3)
    } finally {
      await close()
    }
  })

  test('깨뜨리기: 숨은 동안 음성을 끄고 다시 보이면 요청하지 않는다, 켜진 채 콘솔을 떠나면(방송 목록) 잠금을 놓는다', async ({ page, browser }) => {
    const { dev, close } = await seller(browser, page)
    try {
      await setLabelsApi(dev, false)
      await voiceConsole(dev)
      await turnOnVoice(dev)
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(1)
      await hideScreen(dev)
      await voiceOff(dev).click()
      await showScreen(dev)
      await expect(dev.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
      expect((await wakeCounts(dev)).requests.length, '숨은 동안 끈 뒤 보여도 요청 없음').toBe(1)
      expect((await wakeCounts(dev)).held).toBe(0)
      // 다시 켜고 콘솔을 떠난다
      await turnOnVoice(dev)
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(1)
      await dev.getByRole('link', { name: '방송 목록' }).click()
      await expect(dev.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
      await expect.poll(async () => (await wakeCounts(dev)).held, '콘솔을 떠나면 놓는다').toBe(0)
      await hideScreen(dev)
      await showScreen(dev)
      expect((await wakeCounts(dev)).requests.length, '떠난 뒤 보여도 요청 없음').toBe(2)
    } finally {
      await close()
    }
  })

  for (const [label, wake] of [['Wake Lock이 없다', { absent: true }], ['요청이 거절된다', { reject: true }]] as const) {
    test(`${label}: 음성은 그대로 켜지고 새 문장·오류가 없다`, async ({ page, browser }) => {
      const { dev, close } = await seller(browser, page, wake)
      try {
        await setLabelsApi(dev, false)
        await voiceConsole(dev)
        const alertsBefore = await dev.getByRole('alert').count()
        const errors: string[] = []
        dev.on('pageerror', (e) => errors.push(e.message))
        await turnOnVoice(dev)
        await expect(voiceRegion(dev).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
        expect(await dev.getByRole('alert').count()).toBe(alertsBefore)
        await expect(dev.getByText(/화면|꺼짐|잠금/)).toHaveCount(0)
        await hideScreen(dev)
        await showScreen(dev)
        await expect(voiceRegion(dev).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
        expect(errors).toEqual([])
      } finally {
        await close()
      }
    })
  }

  test('이 기기가 출력 기기이기도 하다(D-I1-03 잠금): 음성만 끄면 출력 기기의 막기는 이어진다 — 잠금이 하나라도 남는다', async ({ page, browser }) => {
    const { dev, close } = await seller(browser, page)
    try {
      await setLabelsApi(dev, true)
      await dev.goto('/')
      await becomeDevice(dev, '안드로이드 폰')
      await expect.poll(async () => (await wakeCounts(dev)).held, '출력 기기 잠금').toBeGreaterThanOrEqual(1)
      const before = await wakeCounts(dev)
      // 콘솔로 앱 안 이동 (새로 읽으면 프린터 연결을 버린다)
      const b = await broadcastApi(dev, uniqueDate(), true)
      await dev.evaluate((path) => {
        window.history.pushState(null, '', path)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, `/broadcasts/${encodeURIComponent(b)}`)
      await expect(dev.getByLabel('빠른 입력')).toBeVisible()
      await turnOnVoice(dev)
      await expect.poll(async () => (await wakeCounts(dev)).requests.length).toBe(before.requests.length + 1)
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(before.held + 1)
      await voiceOff(dev).click()
      await expect.poll(async () => (await wakeCounts(dev)).held).toBe(before.held)
      expect((await wakeCounts(dev)).held, '출력 기기 잠금은 남는다').toBeGreaterThanOrEqual(1)
    } finally {
      await close()
    }
  })
})

test.describe('AC-MOB1-11 안내 창 한 줄', () => {
  test('음성을 처음 켤 때 "음성으로 상품 등록" 창 — 지금 세 줄 그대로 + 마지막 줄 "방송하는 폰이 아닌 다른 기기…"', async ({ page, browser }) => {
    const { dev, close } = await seller(browser, page, {}, false)
    try {
      await setLabelsApi(dev, false)
      await voiceConsole(dev)
      await dev.getByRole('button', { name: '음성 켜기', exact: true }).click()
      const dlg = dev.getByRole('dialog', { name: '음성으로 상품 등록' })
      await expect(dlg).toBeVisible()
      await expect(dlg.locator('p')).toHaveText(CONSENT_LINES)
      await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
      // 안내 창 안에서도 화면 안 (412)
      const box = (await dlg.boundingBox())!
      expect(box.x + box.width).toBeLessThanOrEqual(ANDROID.width + 0.5)
      await dlg.getByRole('button', { name: '음성 켜기', exact: true }).click()
      await expect(voiceRegion(dev).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
      await expect.poll(async () => (await wakeCounts(dev)).requests).toEqual(['screen'])
    } finally {
      await close()
    }
  })
})
