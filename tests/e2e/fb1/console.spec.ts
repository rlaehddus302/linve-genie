// FB1 콘솔 빠른 입력 (AC-FB1-02·03, AC-FB1-90 콘솔 줄): 가격 단위 한 줄, 등록 전 "등록하면: …", 고치기 칸 "= …원" — 천원·원·만원 방송 각각.
// 회차 2: 단위 줄 자리(D-FB1-15 — 1440 고정 영역 안, 375 바로 아래), "등록하면" 줄은 늘 있고 자리 고정(D-FB1-18 (a)).
// 미리 보기 가격 = Enter로 보내는 가격(같은 해석). 진행 중 방송은 그 방송 설정 스냅샷의 단위.
import { expect, test, type Page } from '@playwright/test'
import { DEV_WORDS, UNIT_CHANGE, UNIT_LINE, UNIT_WORDS, loginNewSeller, openRealBroadcast, patchSettings, settingsRegion, saveBar, saveButton, serverSettings } from './support.ts'

const THOUSAND_LINE = UNIT_LINE.THOUSAND
const WON_LINE = UNIT_LINE.WON
const TEN_THOUSAND_LINE = UNIT_LINE.TEN_THOUSAND

const board = (page: Page) => page.getByRole('region', { name: '상품 보드' })

function willRegister(page: Page) {
  return page.locator('main').getByRole('status').filter({ hasText: /^등록하면: / })
}

/** 등록 요청(빠른 입력 Enter)의 본문을 모은다 */
function recordRegisters(page: Page): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = []
  page.on('request', (r) => {
    if (r.method() !== 'POST' || !new URL(r.url()).pathname.startsWith('/api/events')) return
    const body = r.postDataJSON() as Record<string, unknown> | null
    if (body !== null && body['type'] === 'product.register') seen.push(body)
  })
  return seen
}

/**
 * 등록된 가격 (D-APP-24: 기기는 친 글을 원문 그대로 보내고 서버가 읽는다 — 본문에 숫자 가격이 없다).
 * "미리 보기 가격 = 등록 가격"은 서버가 기록한 상품의 가격(보드)으로 본다.
 */
async function expectRegisteredPrice(page: Page, no: number, won: number): Promise<void> {
  await expect(board(page).getByRole('button', { name: new RegExp(`^${String(no)}번 `) })).toContainText(`${won.toLocaleString('ko-KR')}원`)
}

test.describe('AC-FB1-02 천원 방송', () => {
  test('단위 한 줄, 한 글자마다 미리 보기, 품종 없음·번호만·있는 번호·오류는 줄 없음, 미리 보기 가격 = 등록 가격, 고치기 칸 "= 15,000원"', async ({ page }) => {
    await loginNewSeller(page)
    await openRealBroadcast(page)
    const input = page.getByLabel('빠른 입력')
    await expect(page.getByText(THOUSAND_LINE, { exact: true })).toBeVisible()
    await expect(willRegister(page)).toHaveCount(0)

    await input.fill('15 엘레강스 1')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 1,000원')
    await input.press('End')
    await input.pressSequentially('0')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 10,000원')
    await input.fill('15 엘레강스 2만')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 20,000원')
    await input.fill('15 10')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 10,000원')
    await input.fill('15')
    await expect(willRegister(page)).toHaveCount(0)
    await input.fill('15 엘레강스')
    await expect(willRegister(page)).toHaveCount(0)

    const registers = recordRegisters(page)
    await input.fill('15 엘레강스 10')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 10,000원')
    await input.press('Enter')
    await expect.poll(() => registers.length).toBe(1)
    await expectRegisteredPrice(page, 15, 10000)

    // 같은 번호가 있으면 줄이 없다 (고칠까요)
    await input.fill('15 엘레강스 12')
    await expect(willRegister(page)).toHaveCount(0)

    // 가격 오류 → 고치기 칸, 가격 칸 옆 "= 15,000원", 읽지 못하면 없음
    await input.fill('21 홍옥')
    await input.press('Enter')
    const fix = page.getByRole('group', { name: '고치기 칸' })
    const price = fix.getByLabel('가격')
    await price.fill('1.5만')
    await expect(fix.getByText('= 15,000원', { exact: true })).toBeVisible()
    await price.fill('abc')
    await expect(fix.getByText(/^= /)).toHaveCount(0)
    await price.fill('15')
    await expect(fix.getByText('= 15,000원', { exact: true })).toBeVisible()
    await price.press('Enter')
    await expect.poll(() => registers.length).toBe(2)
    await expectRegisteredPrice(page, 21, 15000)
  })

  test('품종의 HTML은 글로만 (미리 보기)', async ({ page }) => {
    await loginNewSeller(page)
    await openRealBroadcast(page)
    const input = page.getByLabel('빠른 입력')
    await input.fill('31 <b>굵게</b> 10')
    await expect(willRegister(page)).toHaveText('등록하면: 31번 <b>굵게</b> 10,000원')
    await expect(willRegister(page).locator('b')).toHaveCount(0)
  })
})

test.describe('AC-FB1-02 원 방송', () => {
  test('원 방송은 "가격 단위: 원 — …", 10000 → 10,000원, 500 → 500원 — 설정 화면에서 천원으로 바꿔도 진행 중 방송의 줄은 그대로', async ({ page }) => {
    await loginNewSeller(page)
    await patchSettings(page, { 'price.unit': 'WON' })
    const { b } = await openRealBroadcast(page)
    const input = page.getByLabel('빠른 입력')
    await expect(page.getByText(WON_LINE, { exact: true })).toBeVisible()
    await input.fill('15 엘레강스 10000')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 10,000원')
    await input.fill('15 엘레강스 2만')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 20,000원')
    await input.fill('15 엘레강스 500')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 500원')
    // 100원 미만은 오류(PRICE_TOO_LOW, R-16 4)로 읽혀 줄이 없다
    await input.fill('15 엘레강스 10')
    await expect(willRegister(page)).toHaveCount(0)
    await input.fill('15 엘레강스 500')
    const registers = recordRegisters(page)
    await input.press('Enter')
    await expect.poll(() => registers.length).toBe(1)
    await expectRegisteredPrice(page, 15, 500)

    // 설정 화면에서 천원으로 바꾸고 저장
    await page.goto('/settings')
    await settingsRegion(page, '판매 규칙').getByRole('radio', { name: UNIT_WORDS.THOUSAND }).check() // 회차 2 D-FB1-11 낱말
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toContainText('저장했어요.')
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(page.getByText(WON_LINE, { exact: true })).toBeVisible()
    await page.getByLabel('빠른 입력').fill('16 선버스 900')
    await expect(willRegister(page)).toHaveText('등록하면: 16번 선버스 900원')
  })

  test('375px: 단위 줄과 미리 보기가 보인다', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await loginNewSeller(page)
    await openRealBroadcast(page)
    await expect(page.getByText(THOUSAND_LINE, { exact: true })).toBeVisible()
    await page.getByLabel('빠른 입력').fill('15 엘레강스 10')
    await expect(willRegister(page)).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/THOUSAND|\bWON\b/)
  })
})

test.describe('UX-04 고정 영역 (AC-FB1-95와 같은 기준 — 35% 이하)', () => {
  test('375×812: 단위 줄·"등록하면: …"이 보이는 채로 콘솔 고정 영역 ≤ 284px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loginNewSeller(page)
    await openRealBroadcast(page)
    await expect(page.getByText(THOUSAND_LINE, { exact: true })).toBeVisible()
    await page.getByLabel('빠른 입력').fill('15 엘레강스 10')
    await expect(willRegister(page)).toBeVisible()
    const h = await page.locator('.console-sticky').evaluate((el) => el.getBoundingClientRect().height)
    expect(h).toBeLessThanOrEqual(812 * 0.35)
  })
})

test.describe('AC-FB1-02 만원 방송 (D-FB1-11)', () => {
  test('만원 방송: 단위 줄 "가격 단위: 만원 — …", 15 → 150,000원·15000 → 15,000원·5천 → 5,000원, Enter 가격 = 미리 보기(150000), 고치기 칸 14 → "= 140,000원"', async ({ page }) => {
    await loginNewSeller(page)
    await patchSettings(page, { 'price.unit': 'TEN_THOUSAND' })
    await openRealBroadcast(page)
    const input = page.getByLabel('빠른 입력')
    await expect(page.getByText(TEN_THOUSAND_LINE, { exact: true })).toBeVisible()
    await expect(page.getByText(THOUSAND_LINE, { exact: true })).toHaveCount(0)
    await input.fill('15 엘레강스 15')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 150,000원')
    await input.fill('15 엘레강스 15000')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 15,000원')
    await input.fill('15 엘레강스 5천')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 5,000원')
    await input.fill('15 엘레강스 2만')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 20,000원')
    await input.fill('15 10')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 100,000원')

    const registers = recordRegisters(page)
    await input.fill('15 엘레강스 15')
    await expect(willRegister(page)).toHaveText('등록하면: 15번 엘레강스 150,000원')
    await input.press('Enter')
    await expect.poll(() => registers.length).toBe(1)
    await expectRegisteredPrice(page, 15, 150000)
    await expect(board(page).getByRole('button', { name: /^15번 / })).toContainText('150,000원')

    await input.fill('21 홍옥')
    await input.press('Enter')
    const fix = page.getByRole('group', { name: '고치기 칸' })
    const price = fix.getByLabel('가격')
    await price.fill('14')
    await expect(fix.getByText('= 140,000원', { exact: true })).toBeVisible()
    await price.fill('1.5만')
    await expect(fix.getByText('= 15,000원', { exact: true })).toBeVisible()
    await price.fill('14')
    await price.press('Enter')
    await expect.poll(() => registers.length).toBe(2)
    await expectRegisteredPrice(page, 21, 140000)
    expect(await page.locator('main').innerText()).not.toMatch(DEV_WORDS)
  })

  test('AC-FB1-01: 천원 방송 중 설정에서 만원으로 저장 → 이미 등록한 상품 가격 그대로, 진행 중 방송 줄은 천원 그대로, 다음 방송부터 만원', async ({ page }) => {
    await loginNewSeller(page)
    const one = await openRealBroadcast(page, { title: '천원 1부' })
    const input = page.getByLabel('빠른 입력')
    const registers = recordRegisters(page)
    await input.fill('15 엘레강스 10')
    await input.press('Enter')
    await expect.poll(() => registers.length).toBe(1)
    await expectRegisteredPrice(page, 15, 10000)
    await expect(board(page).getByRole('button', { name: /^15번 / })).toContainText('10,000원')

    await page.goto('/settings')
    const unit = settingsRegion(page, '판매 규칙').getByRole('radiogroup', { name: '가격 단위' })
    await unit.getByRole('radio', { name: UNIT_WORDS.TEN_THOUSAND }).check()
    await expect(settingsRegion(page, '판매 규칙').getByText(UNIT_CHANGE.TEN_THOUSAND, { exact: true })).toBeVisible()
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toContainText('저장했어요.')
    expect((await serverSettings(page))['price.unit']).toBe('TEN_THOUSAND')

    // 진행 중 1부: 상품 가격·단위 줄·해석 모두 천원 그대로
    await page.goto(`/broadcasts/${encodeURIComponent(one.b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(page.getByText(THOUSAND_LINE, { exact: true })).toBeVisible()
    await expect(page.getByText(TEN_THOUSAND_LINE, { exact: true })).toHaveCount(0)
    await expect(board(page).getByRole('button', { name: /^15번 / })).toContainText('10,000원')
    await expect(board(page).getByRole('button', { name: /^15번 / })).not.toContainText('100,000원')
    await page.getByLabel('빠른 입력').fill('16 선버스 15')
    await expect(willRegister(page)).toHaveText('등록하면: 16번 선버스 15,000원')

    // 다음 방송(2부)부터 만원
    await openRealBroadcast(page, { title: '만원 2부', date: one.date })
    await expect(page.getByText(TEN_THOUSAND_LINE, { exact: true })).toBeVisible()
    await page.getByLabel('빠른 입력').fill('16 선버스 15')
    await expect(willRegister(page)).toHaveText('등록하면: 16번 선버스 150,000원')
  })
})

/** "등록하면" 줄(role=status, 늘 있음)과 단위 줄의 자리 (회차 2 D-FB1-15·D-FB1-18 (a)) */
const LINE_OF = { 1440: THOUSAND_LINE, 375: THOUSAND_LINE } as const
for (const width of [1440, 375] as const) {
  test(`AC-FB1-02 ${String(width)}px 자리: 단위 줄은 화면에 하나(${width === 1440 ? '고정 영역 안' : '고정 영역 밖 바로 아래'}), "등록하면" 줄은 늘 있고 빈 글·${width === 1440 ? '한 줄 높이, 쳤다 지워도 빠른 입력칸과 그 아래 첫 요소 위치가 그대로' : '휴대폰 빈 줄은 높이 0(QL2 D-QL2-11 (2)), 지우면 그 아래 첫 요소 위치가 처음 그대로'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
    await loginNewSeller(page)
    await openRealBroadcast(page)
    const input = page.getByLabel('빠른 입력')
    const unitLines = page.getByText(LINE_OF[width], { exact: true })
    await expect(unitLines).toHaveCount(1)
    await expect(unitLines).toBeVisible()
    const sticky = page.locator('.console-sticky')
    const inSticky = await unitLines.evaluate((el) => el.closest('.console-sticky') !== null)
    if (width === 1440) {
      expect(inSticky, '1440px: 단위 줄은 고정 영역 안').toBe(true)
    } else {
      expect(inSticky, '375px: 단위 줄은 고정 영역 밖').toBe(false)
      const s = (await sticky.boundingBox())!
      const u = (await unitLines.boundingBox())!
      // 고정 영역 바로 아래 — 사이에는 "등록하면" 줄만 (dev-notes: 휴대폰은 고정 영역 바로 아래, 단위 줄 위)
      expect(u.y).toBeGreaterThanOrEqual(s.y + s.height - 1)
      // 사이에 보이는 글이 없다 (빈 "등록하면" 줄만 있을 수 있다)
      const between = await page.locator('main').evaluate((main, [a, b]) => {
        const out: string[] = []
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
          const text = (n.textContent ?? '').trim()
          if (text === '') continue
          const range = document.createRange()
          range.selectNodeContents(n)
          for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0 && r.top >= a && r.bottom <= b) out.push(text)
        }
        return out
      }, [s.y + s.height - 1, u.y + 1] as const)
      expect(between).toEqual([])
      expect(s.height).toBeLessThanOrEqual(812 * 0.35)
    }

    // 늘 있는 "등록하면" 줄: 미리 보기가 없으면 빈 글
    // 빈 글이라 이름·글로 찾을 수 없다 — dev-notes의 자리 클래스(p.quick-will-register)로 찾고 역할을 확인한다
    const line = page.locator('main .quick-will-register')
    await expect(line).toHaveCount(1)
    await expect(line).toHaveAttribute('role', 'status')
    await expect(line).toHaveText('')
    const firstBelow = async () => await input.evaluate((el) => {
      // 빠른 입력칸 아래 첫 요소: 화면 순서로 빠른 입력칸 다음에 오는, 보이는 첫 요소의 위치
      const r0 = el.getBoundingClientRect()
      const all = Array.from(document.querySelectorAll('main *')) as HTMLElement[]
      let best: number | null = null
      for (const e of all) {
        if (e === el || e.contains(el) || el.contains(e)) continue
        const r = e.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.top >= r0.bottom - 0.5 && (best === null || r.top < best)) best = r.top
      }
      return { input: r0.top, below: best }
    })
    const before = await firstBelow()
    if (width === 375) {
      // QL2 D-QL2-11 (2): 휴대폰 빈 "등록하면" 줄은 자리를 차지하지 않는다(높이 0) — 미리 보기가 생기면 아래가 한 줄만큼 내려가는 것은 받아들인다
      expect((await line.evaluate((el) => el.getBoundingClientRect().height))).toBe(0)
      await input.fill('15 엘레강스 10')
      await expect(line).toHaveText('등록하면: 15번 엘레강스 10,000원')
      await expect(line).toBeVisible()
      const lineDuring = (await line.boundingBox())!
      // 긴 품종도 한 줄 (끝이 잘림)
      await input.fill(`15 ${'엘레강스하월화세덤'.repeat(8)} 10`)
      await expect(line).toContainText('등록하면: 15번 ')
      expect((await line.boundingBox())!.height).toBe(lineDuring.height)
      await input.fill('')
      await expect(line).toHaveText('')
      expect((await line.evaluate((el) => el.getBoundingClientRect().height))).toBe(0)
      expect(await firstBelow()).toEqual(before)
    } else {
      const lineBefore = (await line.boundingBox())!
      await input.fill('15 엘레강스 10')
      await expect(line).toHaveText('등록하면: 15번 엘레강스 10,000원')
      const during = await firstBelow()
      expect(during).toEqual(before)
      const lineDuring = (await line.boundingBox())!
      expect(lineDuring.height).toBe(lineBefore.height)
      expect(lineDuring.y).toBe(lineBefore.y)
      // 긴 품종도 한 줄 (끝이 잘림)
      await input.fill(`15 ${'엘레강스하월화세덤'.repeat(8)} 10`)
      await expect(line).toContainText('등록하면: 15번 ')
      expect((await line.boundingBox())!.height).toBe(lineBefore.height)
      expect(await firstBelow()).toEqual(before)
      await input.fill('')
      await expect(line).toHaveText('')
      expect(await firstBelow()).toEqual(before)
    }
    if (width === 375) {
      const h = await sticky.evaluate((el) => el.getBoundingClientRect().height)
      expect(h).toBeLessThanOrEqual(812 * 0.35)
    }
  })
}
