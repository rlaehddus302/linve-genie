// QL3R1 휴대폰 되돌리기 항목 두 칸 한 줄 (AC-QL3R1-63, D-QL3R1-12, UX-04) — test-e2e.
// 기대값은 acceptance.md AC-QL3R1-63에서 정했다: 단추 top < 문장 bottom(단추만 둘째 줄로 내려가지 않음), 등록 항목 높이 ≤ 52px,
// 단추 높이·너비 ≥ 44px, 문장·"남은 시간 n초" 말줄임 없음(scrollWidth ≤ clientWidth + 1), 가로 넘침 0, 문장·단추 이름 그대로, PC 1440 그대로.
// 등록 되돌리기는 5초(REGISTER_UNDO_MS), 찜 취소 대기는 E2E_HOST_DELAY_MS(기본 2000) — 재기는 한 번의 evaluate로 그 안에서 끝낸다.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { uniqueDate } from '../s05/support.ts'
import { viewerClaim } from '../s06/support.ts'
import { broadcastApi, setLabelsApi } from '../ql2/support.ts'
import { D1440, D375, D393, D412, boardCard, openConsole, registerStock, sellerOn, type Device } from './support.ts'

const undoBar = (page: Page) => page.getByRole('region', { name: '보내기 전 조치' })

interface Measure {
  item: { top: number; bottom: number; height: number }
  status: { top: number; bottom: number; sw: number; cw: number; ellipsis: string }
  text: { sw: number; cw: number; display: string } | null
  countdown: { sw: number; cw: number } | null
  button: { top: number; bottom: number; height: number; width: number }
  itemDisplay: string
  docWidth: number
  viewWidth: number
}

/** 항목 하나를 한꺼번에 잰다 (대기 시간이 끝나기 전에) */
async function measure(item: Locator): Promise<Measure> {
  return await item.evaluate((li) => {
    const box = (el: Element) => el.getBoundingClientRect()
    const status = li.querySelector('[role="status"]')!
    const button = li.querySelector(':scope > .button')!
    const text = li.querySelector(':scope > .undo-text')
    const countdown = li.querySelector('.countdown')
    const s = box(status)
    const b = box(button)
    const i = box(li)
    return {
      item: { top: i.top, bottom: i.bottom, height: i.height },
      status: { top: s.top, bottom: s.bottom, sw: status.scrollWidth, cw: status.clientWidth, ellipsis: getComputedStyle(status).textOverflow },
      text: text === null ? null : { sw: text.scrollWidth, cw: text.clientWidth, display: getComputedStyle(text).display },
      countdown: countdown === null ? null : { sw: countdown.scrollWidth, cw: countdown.clientWidth },
      button: { top: b.top, bottom: b.bottom, height: b.height, width: b.width },
      itemDisplay: getComputedStyle(li).display,
      docWidth: document.documentElement.scrollWidth,
      viewWidth: window.innerWidth,
    }
  })
}

function expectRow(m: Measure, where: string, phone: boolean): void {
  const text = `${where}: 항목 ${String(Math.round(m.item.top))}~${String(Math.round(m.item.bottom))}, 문장 ${String(Math.round(m.status.top))}~${String(Math.round(m.status.bottom))}, 단추 ${String(Math.round(m.button.top))}~${String(Math.round(m.button.bottom))}`
  // 단추만 둘째 줄로 내려가지 않는다
  expect(m.button.top, `${text} — 단추 위쪽이 문장 아래쪽보다 위`).toBeLessThan(m.status.bottom)
  // 단추 44px 이상
  expect(m.button.height, `${where} 단추 높이`).toBeGreaterThanOrEqual(44)
  expect(m.button.width, `${where} 단추 너비`).toBeGreaterThanOrEqual(44)
  // 말줄임·잘림 없음
  expect(m.status.ellipsis, `${where} 문장 말줄임`).not.toBe('ellipsis')
  expect(m.status.sw, `${where} 문장 옆 잘림`).toBeLessThanOrEqual(m.status.cw + 1)
  if (m.countdown !== null) expect(m.countdown.sw, `${where} 남은 시간 옆 잘림`).toBeLessThanOrEqual(m.countdown.cw + 1)
  if (phone) {
    expect(m.text, `${where} 글 칸(.undo-text)`).not.toBeNull()
    expect(m.text!.sw, `${where} 글 칸 옆 잘림`).toBeLessThanOrEqual(m.text!.cw + 1)
  }
  // 가로 넘침 0
  expect(m.docWidth, `${where} 가로 넘침`).toBeLessThanOrEqual(m.viewWidth)
}

async function world(dev: Page): Promise<string> {
  const b = await broadcastApi(dev, uniqueDate(), true)
  await setLabelsApi(dev, false)
  await registerStock(dev, b, 1, '핑크프릴', 10000, 1)
  await viewerClaim(dev, b, '밤톨맘', '1', `sim_ql3r1_undo_${String(Date.now())}`)
  return b
}

async function check(page: Page, browser: Parameters<typeof sellerOn>[0], device: Device): Promise<void> {
  const phone = device.viewport.width < 768
  const s = await sellerOn(browser, page, device, false)
  try {
    const b = await world(s.dev)
    await openConsole(s.dev, b, false)
    await expect(boardCard(s.dev, 1)).toContainText('밤톨맘')

    // (a) 등록 "20번을 등록했어요" · "남은 시간 n초" · "되돌리기"(20번 등록 되돌리기)
    const input = s.dev.getByLabel('빠른 입력')
    await input.fill('20 새상품 10000')
    await input.press('Enter')
    const reg = undoBar(s.dev).getByRole('listitem').filter({ has: s.dev.getByRole('status').filter({ hasText: /^20번을 등록했어요$/ }) })
    await expect(reg.getByRole('button', { name: '20번 등록 되돌리기' })).toBeVisible()
    await expect(reg.getByRole('button', { name: '20번 등록 되돌리기' })).toHaveText('되돌리기')
    await expect(reg).toContainText(/남은 시간 \d초/)
    const a = await measure(reg)
    expectRow(a, `${device.label} 등록`, phone)
    if (phone) expect(a.item.height, `${device.label} 등록 항목 높이`).toBeLessThanOrEqual(52)

    // (b) 찜 취소 "… 뒤 보내요: 1번 … 밤톨맘 취소" (빠른 사유 바로 보냄 — D-QL3R1-05)
    await boardCard(s.dev, 1).click()
    const detail = s.dev.getByRole('dialog', { name: '1번 자세히' })
    await detail.getByRole('region', { name: '1등' }).getByRole('listitem').filter({ hasText: '밤톨맘' }).getByRole('button', { name: '찜 취소하기', exact: true }).click()
    const reason = s.dev.getByRole('dialog', { name: /밤톨맘 취소$/ })
    await reason.getByRole('button', { name: '1 시청자 요청', exact: true }).click()
    await expect(reason).toHaveCount(0)
    const cancel = undoBar(s.dev).getByRole('listitem').filter({ has: s.dev.getByRole('status').filter({ hasText: /초 뒤 보내요: 1번.* 밤톨맘 취소$/ }) })
    await expect(cancel.getByRole('button', { name: /밤톨맘 취소 되돌리기$/ })).toBeVisible()
    await expect(cancel.getByRole('button', { name: /밤톨맘 취소 되돌리기$/ })).toHaveText('되돌리기')
    const c = await measure(cancel)
    expectRow(c, `${device.label} 찜 취소`, phone)

    if (!phone) {
      // PC 1440은 지금 모양 그대로: 글 묶음은 상자가 없고(display: contents) 항목은 한 줄로 늘어선다
      for (const m of [a, c]) {
        expect(m.text?.display ?? 'contents').toBe('contents')
        expect(m.itemDisplay).toBe('flex')
      }
    }
  } finally {
    await s.close()
  }
}

test.describe('AC-QL3R1-63 휴대폰 되돌리기 항목은 두 칸 한 줄 (D-QL3R1-12)', () => {
  for (const device of [D375, D412, D1440]) {
    test(`${device.label} 글자 100%: 등록·찜 취소 항목의 "되돌리기"가 문장과 같은 줄, 등록 항목 ≤ 52px(휴대폰), 단추 44px, 말줄임·가로 넘침 없음`, async ({ page, browser }) => {
      await check(page, browser, device)
    })
  }
  test('393×852 WebKit 글자 100%: 등록·찜 취소 항목의 "되돌리기"가 문장과 같은 줄, 등록 항목 ≤ 52px, 단추 44px, 말줄임·가로 넘침 없음 @webkit', async ({ page, browser }) => {
    await check(page, browser, D393)
  })
})
