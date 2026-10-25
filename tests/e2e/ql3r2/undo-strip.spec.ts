// QL3R2 빠른 사유 뒤 되돌리기 띠 (AC-QL3R2-31, D-QL3R2-06, RA-QL3R1-01·SA-QL3R1-03) — test-e2e.
// 실제 방송: 상품 1번(수량 1)에 1등 문자찜 '물주기담당'·대기 1명. 휴대폰 글자 150%, 방송 화면을 600px 내린 상태에서 상품 자세히 → 1등 "찜 취소하기" → 빠른 사유 1번.
// E2E 서버의 방송자 조치 대기 = E2E_HOST_DELAY_MS(기본 2000 — 운영 5초). 되돌리기는 그 안에 누른다.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { history, untilElapsed, uniqueDate } from '../s05/support.ts'
import { registerApi, scopeView, smsApi } from '../s06/support.ts'
import { broadcastApi, setLabelsApi } from '../ql2/support.ts'
import { boardCard, registerStock } from '../ql3r1/support.ts'
import { D375, D393, D412, openConsole, sellerOn, type Device } from './support.ts'
import { installSmsSpeech, smsButton, smsResults, speak, turnOnVoice } from '../v1/support.ts'

const DELAY = Number(process.env['E2E_HOST_DELAY_MS'] ?? '2000')
const WINNER = '물주기담당'
const undoBar = (page: Page): Locator => page.getByRole('region', { name: '보내기 전 조치' })

async function world(dev: Page): Promise<{ b: string; date: string }> {
  const date = uniqueDate()
  const b = await broadcastApi(dev, date)
  await setLabelsApi(dev, false)
  await registerStock(dev, b, 1, '핑크프릴', 10000, 1)
  await smsApi(dev, { b, no: 1, memo: WINNER })
  await smsApi(dev, { b, no: 1, memo: '대기손님' })
  for (let no = 2; no <= 13; no += 1) await registerApi(dev, b, no, `품종${String(no)}`, 1000 * no)
  await expect
    .poll(async () => {
      const view = await scopeView(dev, date, false)
      const claims = view.claims.filter((c) => c.no === 1)
      return `${String(claims.filter((c) => c.status === 'CONFIRMED').length)}/${String(claims.filter((c) => c.status === 'WAITLISTED').length)}`
    })
    .toBe('1/1')
  return { b, date }
}

/** 1번 상품의 1등 표시 이름 */
async function winnerName(dev: Page, date: string): Promise<string> {
  const view = await scopeView(dev, date, false)
  const p = view.products.find((x) => x.no === 1)!
  return view.buyers.find((x) => x.id === p.winners[0])?.display ?? ''
}

/** 화면 안·잘림 없음 */
async function expectOnScreen(target: Locator, where: string): Promise<void> {
  const m = await target.evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, vw: window.innerWidth, vh: window.innerHeight, sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }
  })
  const text = `${where}: 위 ${String(Math.round(m.top))}·아래 ${String(Math.round(m.bottom))}·왼쪽 ${String(Math.round(m.left))}·오른쪽 ${String(Math.round(m.right))} / 화면 ${String(m.vw)}×${String(m.vh)}`
  expect(m.top, text).toBeGreaterThanOrEqual(-0.5)
  expect(m.left, text).toBeGreaterThanOrEqual(-0.5)
  expect(m.bottom, text).toBeLessThanOrEqual(m.vh + 0.5)
  expect(m.right, text).toBeLessThanOrEqual(m.vw + 0.5)
  expect(m.sw, `${where} 옆 잘림 (scrollWidth ${String(m.sw)} > clientWidth ${String(m.cw)})`).toBeLessThanOrEqual(m.cw + 1)
  expect(m.sh, `${where} 위아래 잘림 (scrollHeight ${String(m.sh)} > clientHeight ${String(m.ch)})`).toBeLessThanOrEqual(m.ch + 1)
}

/** 띠: 이름·남은 초·"되돌리기" 단추가 화면 안에 잘림 없이, 단추 44px 이상 */
async function expectUndoStrip(dev: Page, where: string, no = 1, name = WINNER): Promise<Locator> {
  const waiting = undoBar(dev).getByRole('status').filter({ hasText: new RegExp(`초 뒤 보내요: ${String(no)}번.*${name}.* 취소$`) })
  await expect(waiting, `${where} 대기 문장`).toBeVisible()
  await expect(waiting).toContainText(/\d+초 뒤/)
  await expectOnScreen(undoBar(dev), `${where} 되돌리기 띠`)
  await expectOnScreen(waiting, `${where} 이름·남은 초`)
  const undo = undoBar(dev).getByRole('button', { name: new RegExp(`${name}.* 취소 되돌리기$`) })
  await expect(undo).toBeVisible()
  await expect(undo).toContainText('되돌리기')
  await expectOnScreen(undo, `${where} 되돌리기 단추`)
  const h = (await undo.boundingBox())!.height
  expect(h, `${where} 되돌리기 단추 높이 ${String(h)} ≥ 44`).toBeGreaterThanOrEqual(44)
  return undo
}

async function scrollDown(dev: Page, where: string): Promise<void> {
  await dev.evaluate(() => window.scrollTo(0, 600))
  await expect.poll(async () => await dev.evaluate(() => window.scrollY), { message: `${where}: 600px 내림` }).toBeGreaterThanOrEqual(600)
}

async function boardFlow(device: Device, page: Page, browser: Parameters<typeof sellerOn>[0]): Promise<void> {
  const where = `${device.label} 150%`
  const s = await sellerOn(browser, page, device, true)
  try {
    const { b, date } = await world(s.dev)
    await openConsole(s.dev, b, true)
    await scrollDown(s.dev, where)
    await boardCard(s.dev, 1).click()
    const detail = s.dev.getByRole('dialog', { name: '1번 자세히' })
    await expect(detail).toBeVisible()
    await detail.getByRole('region', { name: '1등' }).getByRole('listitem').filter({ hasText: WINNER }).getByRole('button', { name: '찜 취소하기', exact: true }).click()
    const dlg = s.dev.getByRole('dialog', { name: new RegExp(`${WINNER}.* 취소$`) })
    await expect(dlg).toBeVisible()
    const since = Date.now()
    await dlg.getByRole('button', { name: '1 시청자 요청', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    const undo = await expectUndoStrip(s.dev, where)
    await undo.click()
    await expect(undoBar(s.dev).getByRole('status').filter({ hasText: new RegExp(`^보내지 않았어요: 1번.*${WINNER}.* 취소$`) })).toBeVisible()
    await untilElapsed(s.dev, since, DELAY + 1500)
    expect((await history(s.dev, date, false)).filter((e) => e.type === 'host.cancel'), '되돌린 취소는 보내지 않는다').toHaveLength(0)
    expect(await winnerName(s.dev, date), '1등 그대로').toContain(WINNER)
  } finally {
    await s.close()
  }
}

test.describe('AC-QL3R2-31 빠른 사유 뒤 되돌리기 띠가 화면 안에 잘리지 않는다', () => {
  test('375×812 150%, 600px 내림: 상품 자세히 → 1등 "찜 취소하기" → "1 시청자 요청" → 창 닫힘·띠(이름·남은 초·되돌리기 44px 이상)가 화면 안 잘림 없음 → 되돌리기면 1등 그대로', async ({ page, browser }) => {
    await boardFlow(D375, page, browser)
  })

  test('393×852 WebKit 150%, 600px 내림: 같은 길 — 띠가 화면 안 잘림 없음, 되돌리기면 1등 그대로 @webkit', async ({ page, browser }) => {
    await boardFlow(D393, page, browser)
  })

  test('375×812 150%: 문자찜 화면 "최근 넣은 문자찜"의 "찜 취소하기" → 빠른 사유 한 번 → 창 닫힘·띠(이름·남은 초·되돌리기)가 화면 안 → 되돌리기면 1등 그대로', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D375, true)
    try {
      const { b, date } = await world(s.dev)
      // 콘솔에서 연 방송을 문자찜 화면이 그대로 고른다
      await openConsole(s.dev, b, true)
      await s.dev.goto('/sms')
      const recent = s.dev.getByRole('region', { name: '최근 넣은 문자찜' })
      await expect(recent).toBeVisible()
      const line = recent.getByRole('listitem').filter({ hasText: WINNER })
      await line.getByRole('button', { name: '찜 취소하기', exact: true }).click()
      const dlg = s.dev.getByRole('dialog', { name: new RegExp(`${WINNER}.* 취소$`) })
      await expect(dlg).toBeVisible()
      const since = Date.now()
      await dlg.getByRole('button', { name: '1 시청자 요청', exact: true }).click()
      await expect(dlg).toHaveCount(0)
      const undo = await expectUndoStrip(s.dev, '문자찜 화면 375 150%')
      await undo.click()
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: new RegExp(`^보내지 않았어요: 1번.*${WINNER}.* 취소$`) })).toBeVisible()
      await untilElapsed(s.dev, since, DELAY + 1500)
      expect((await history(s.dev, date, false)).filter((e) => e.type === 'host.cancel')).toHaveLength(0)
      expect(await winnerName(s.dev, date)).toContain(WINNER)
    } finally {
      await s.close()
    }
  })

  test('375×812 150%: 음성 칸에서 넣은 문자찜의 "찜 취소하기" → 빠른 사유 한 번 → 창 닫힘·띠(남은 초·되돌리기)가 화면 안 → 되돌리기면 1등 그대로', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D375, true)
    try {
      await installSmsSpeech(s.context)
      const { b, date } = await world(s.dev)
      await openConsole(s.dev, b, true)
      await turnOnVoice(s.dev)
      const short = '2번 품종2 · 끝자리 1234 · 문자찜'
      await speak(s.dev, '2번 문자찜 끝자리 1234')
      await smsButton(s.dev, short, '지금 넣기').click()
      await expect(smsResults(s.dev, short)).toHaveText(/^2번 · 문자찜 · 1등 · /, { timeout: 15_000 })
      const before = (await scopeView(s.dev, date, false)).products.find((x) => x.no === 2)!.winners[0]
      expect(before).toBeDefined()
      await s.dev.getByRole('button', { name: '2번 문자찜 찜 취소하기', exact: true }).click()
      const dlg = s.dev.getByRole('dialog', { name: /취소$/ })
      await expect(dlg).toBeVisible()
      const since = Date.now()
      await dlg.getByRole('button', { name: '1 시청자 요청', exact: true }).click()
      await expect(dlg).toHaveCount(0)
      const undo = await expectUndoStrip(s.dev, '음성 칸 375 150%', 2, '문자찜')
      await undo.click()
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /^보내지 않았어요: 2번.* 취소$/ })).toBeVisible()
      await untilElapsed(s.dev, since, DELAY + 1500)
      expect((await history(s.dev, date, false)).filter((e) => e.type === 'host.cancel')).toHaveLength(0)
      expect((await scopeView(s.dev, date, false)).products.find((x) => x.no === 2)!.winners[0], '1등 그대로').toBe(before)
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-QL3R2-30 숫자 키를 누르고 있어 반복된 입력은 무시 (화면 흐름)', () => {
  test('412×915: 찜 취소하기 창에서 반복 표시(repeat)가 붙은 숫자 키 "2"는 아무것도 누르지 않고(창 그대로·대기 없음), 보통 "2" 한 번은 그 사유로 창을 닫고 대기', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D412, false)
    try {
      const { b, date } = await world(s.dev)
      await openConsole(s.dev, b, false)
      await boardCard(s.dev, 1).click()
      const detail = s.dev.getByRole('dialog', { name: '1번 자세히' })
      await detail.getByRole('region', { name: '1등' }).getByRole('listitem').filter({ hasText: WINNER }).getByRole('button', { name: '찜 취소하기', exact: true }).click()
      const dlg = s.dev.getByRole('dialog', { name: new RegExp(`${WINNER}.* 취소$`) })
      await expect(dlg).toBeVisible()
      await expect(dlg.getByRole('button', { name: '닫기', exact: true })).toBeFocused()
      // 키를 누르고 있을 때 브라우저가 보내는 반복 keydown (repeat: true) — 첫 keydown 없이 반복만 여러 번
      for (let i = 0; i < 5; i += 1) {
        await s.dev.evaluate(() => {
          const target = document.activeElement ?? document.body
          target.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', repeat: true, bubbles: true, cancelable: true }))
          target.dispatchEvent(new KeyboardEvent('keyup', { key: '2', code: 'Digit2', bubbles: true, cancelable: true }))
        })
      }
      await expect(dlg).toBeVisible()
      await expect(dlg.getByRole('button', { pressed: true })).toHaveCount(0)
      await expect(undoBar(s.dev)).toHaveCount(0)
      // 보통 한 번
      await s.dev.keyboard.press('2')
      await expect(dlg).toHaveCount(0)
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /^보냈어요: 1번.* 취소$/ })).toBeVisible({ timeout: DELAY + 10_000 })
      const cancels = (await history(s.dev, date, false)).filter((e) => e.type === 'host.cancel')
      expect(cancels).toHaveLength(1)
      expect(cancels[0]!.reason).toBe('장난 찜')
    } finally {
      await s.close()
    }
  })
})
