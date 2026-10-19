// 정산 입력 창 머리·입금 상태 미리 보기·입금 상한, 주 버튼, PC 표 (AC-S06b-21·23·24, STL-02·03·07·09, R-12, D-101, G-ENG-177) — test-e2e.
// 금액은 골든 G-ENG-177을 손으로 옮겼다(10,000 + 배송비 4,000 = 14,000).
import { test, expect, type Page } from '@playwright/test'
import { dateLongKo, history, login, openNewBroadcast, primaryOutsideDialogs, registerApi, scopeView, smsApi, uniq, uniqueDate, viewerClaim, writeEvent } from './support.ts'

async function paidDay(page: Page): Promise<{ b: string; date: string; a: string }> {
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true, title: '1부' })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  const ch = uniq('sim_hong_')
  await viewerClaim(page, b, '홍길동', '15', ch)
  await expect.poll(async () => (await scopeView(page, date, true)).settlements.length).toBe(1)
  return { b, date, a: ch }
}

function detailOf(page: Page) {
  return page.getByRole('region', { name: '정산 자세히' })
}

test.describe('정산 입력 창 (AC-S06b-23)', () => {
  test('G-ENG-177 흐름: 머리·금액 줄, 입금 완료 → 직접 수령 = 과입금(환불 필요 4,000원, 주의) → 할인 1,000 = 5,000원 → 기본 배송비로 → 추가 1,000 → 추가 3,000 = 부분 입금', async ({ page }) => {
    await login(page)
    const { date, a } = await paidDay(page)
    const scope = { date, rehearsal: true }
    await page.goto(`/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(a)}`)
    const detail = detailOf(page)
    // 입금 적기 창: 머리 = "입금 적기 · 홍길동 · 2026년 10월 18일 묶음", 그 아래 금액 줄
    await detail.getByRole('button', { name: '입금 적기' }).click()
    const pay = page.getByRole('dialog', { name: `입금 적기 · 홍길동 · ${dateLongKo(date).replace(/\(.\)$/, '')} 묶음` })
    await expect(pay).toBeVisible()
    await expect(pay.locator('p.input-amounts')).toHaveText('최종 14,000원 · 받은 금액 0원 · 남은 금액 14,000원')
    await expect(pay.getByRole('status').filter({ hasText: '입금 상태' })).toHaveText('입금 상태: 미입금 → 입금 완료')
    // 입금 상한 1억
    await pay.getByLabel('입금 금액').fill('100000001')
    await expect(pay.getByText('입금은 1원~100,000,000원으로 적어 주세요.')).toBeVisible()
    await pay.getByRole('button', { name: '입금 적기' }).click()
    await expect(page.getByRole('dialog', { name: '입금 금액 확인' })).toHaveCount(0)
    expect((await history(page, date, true)).filter((e) => e.type === 'settlement.payment')).toHaveLength(0)
    await pay.getByLabel('입금 금액').fill('100000000')
    await expect(pay.getByText('입금은 1원~100,000,000원으로 적어 주세요.')).toHaveCount(0)
    // 과입금이 새로 생기는 입금은 주의
    await pay.getByLabel('입금 금액').fill('20000')
    await expect(pay.locator('p.payment-change')).toHaveText('입금 상태: 미입금 → 과입금(환불 필요 6,000원)')
    await expect(pay.locator('p.payment-change')).toHaveAttribute('data-tone', 'warning')
    await pay.getByLabel('입금 금액').fill('14000')
    await expect(pay.locator('p.payment-change')).not.toHaveAttribute('data-tone', 'warning')
    await pay.getByRole('button', { name: '입금 적기' }).click()
    await expect(pay).toHaveCount(0)
    const saved = page.getByText('입금을 적었어요')
    await expect(saved).toBeVisible()
    await expect(saved).toHaveAttribute('data-tone', 'success')
    await expect(detail).toContainText('입금 완료')

    // 직접 수령 → 과입금(환불 필요 4,000원), 주의
    await detail.getByRole('button', { name: '배송비 바꾸기' }).click()
    const ship = page.getByRole('dialog', { name: /^배송비 바꾸기 · 홍길동 · / })
    await expect(ship.locator('p.input-amounts')).toHaveText('최종 14,000원 · 받은 금액 14,000원 · 남은 금액 0원')
    await ship.getByRole('radio', { name: '직접 수령' }).check()
    const shipChange = ship.locator('p.payment-change')
    await expect(shipChange).toHaveText('입금 상태: 입금 완료 → 과입금(환불 필요 4,000원)')
    await expect(shipChange).toHaveAttribute('data-tone', 'warning')
    await ship.getByRole('button', { name: '배송비 바꾸기' }).click()
    await expect(ship).toHaveCount(0)
    await expect(detail).toContainText('과입금(환불 필요 4,000원)')
    // 주 버튼: 과입금이면 "환불 적기" 하나
    expect(await primaryOutsideDialogs(page)).toEqual(['환불 적기'])

    // 할인 1,000 → 과입금(환불 필요 4,000원) → 과입금(환불 필요 5,000원), 주의
    await detail.getByRole('button', { name: '할인·추가' }).click()
    const adj = page.getByRole('dialog', { name: /^할인·추가 · 홍길동 · / })
    await adj.getByLabel('할인 금액').fill('1000')
    await expect(adj.locator('p.payment-change')).toHaveText('입금 상태: 과입금(환불 필요 4,000원) → 과입금(환불 필요 5,000원)')
    await expect(adj.locator('p.payment-change')).toHaveAttribute('data-tone', 'warning')
    await adj.getByRole('button', { name: '1 단골 할인' }).click()
    await adj.getByRole('button', { name: '할인 적기' }).click()
    await expect(adj).toHaveCount(0)

    // 기본 배송비로 (API) → 환불 필요 1,000. 추가 1,000 → 입금 완료 (줄어듦 = 보통)
    expect((await writeEvent(page, { type: 'settlement.shippingOverride', buyer: a, date, mode: 'DEFAULT' }, scope)).status).toBeLessThan(300)
    await expect(detail).toContainText('과입금(환불 필요 1,000원)')
    await detail.getByRole('button', { name: '할인·추가' }).click()
    await adj.getByRole('radio', { name: '추가' }).check()
    await adj.getByLabel('추가 금액').fill('1000')
    await expect(adj.locator('p.payment-change')).toHaveText('입금 상태: 과입금(환불 필요 1,000원) → 입금 완료')
    await expect(adj.locator('p.payment-change')).not.toHaveAttribute('data-tone', 'warning')
    await adj.getByLabel('사유').fill('포장 추가')
    await adj.getByRole('button', { name: '추가 적기' }).click()
    await expect(adj).toHaveCount(0)
    await expect(detail).toContainText('입금 완료')
    expect(await primaryOutsideDialogs(page)).toEqual([]) // 입금 완료면 주 버튼 없음

    // 추가 3,000(조정 합 0에서) → 입금 완료 → 부분 입금
    await detail.getByRole('button', { name: '할인·추가' }).click()
    await adj.getByRole('radio', { name: '추가' }).check()
    await adj.getByLabel('추가 금액').fill('3000')
    await expect(adj.locator('p.payment-change')).toHaveText('입금 상태: 입금 완료 → 부분 입금')
    await adj.getByLabel('사유').fill('도서산간')
    await adj.getByRole('button', { name: '추가 적기' }).click()
    await expect(adj).toHaveCount(0)
    await expect(detail).toContainText('부분 입금')
    expect(await primaryOutsideDialogs(page)).toEqual(['입금 적기'])
    // 남은 3,000 입금 창: 그대로가 아니라 부분 입금 → 입금 완료
    await detail.getByRole('button', { name: '입금 적기' }).click()
    await expect(pay.locator('p.input-amounts')).toHaveText('최종 17,000원 · 받은 금액 14,000원 · 남은 금액 3,000원')
    await expect(pay.locator('p.payment-change')).toHaveText('입금 상태: 부분 입금 → 입금 완료')
    await pay.getByLabel('입금 금액').fill('1000')
    await expect(pay.locator('p.payment-change')).toHaveText('입금 상태: 그대로(부분 입금)')
    const s = (await scopeView(page, date, true)).settlements[0]!
    expect([s.total, s.received, s.payment]).toEqual([17000, 14000, 'PARTIAL'])
  })

  test('환불 적기 창도 머리와 입금 상태 미리 보기 (과입금 → 입금 완료)', async ({ page }) => {
    await login(page)
    const { date, a } = await paidDay(page)
    expect((await writeEvent(page, { type: 'settlement.payment', buyer: a, date, amount: 20000 }, { date, rehearsal: true })).status).toBeLessThan(300)
    await page.goto(`/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(a)}`)
    const detail = detailOf(page)
    await expect(detail).toContainText('과입금(환불 필요 6,000원)')
    expect(await primaryOutsideDialogs(page)).toEqual(['환불 적기'])
    await detail.getByRole('button', { name: '환불 적기' }).click()
    const refund = page.getByRole('dialog', { name: /^환불 적기 · 홍길동 · .+ 묶음$/ })
    await expect(refund.locator('p.input-amounts')).toHaveText('최종 14,000원 · 받은 금액 20,000원 · 남은 금액 0원')
    await expect(refund.locator('p.payment-change')).toHaveText('입금 상태: 과입금(환불 필요 6,000원) → 입금 완료')
    await refund.getByLabel('환불 금액').fill('7000')
    await expect(refund.locator('p.payment-change')).toHaveText('입금 상태: 과입금(환불 필요 6,000원) → 부분 입금')
  })
})

test.describe('주 버튼 (AC-S06b-24)', () => {
  test('정산 자세히 네 상태(미입금·부분 입금·입금 완료·과입금), 구매자 자세히·목록·문자찜·콘솔 — 창 밖 주 버튼은 많아야 하나', async ({ page }) => {
    await login(page)
    const { b, date, a } = await paidDay(page)
    const scope = { date, rehearsal: true }
    const at = async (url: string, expected: string[] | number) => {
      await page.goto(url)
      await expect(page.locator('main')).toBeVisible()
      await expect(page.getByText(/불러오는 중/)).toHaveCount(0)
      const got = await primaryOutsideDialogs(page)
      if (typeof expected === 'number') expect(got.length, `${url}: ${got.join(', ')}`).toBeLessThanOrEqual(expected)
      else expect(got, url).toEqual(expected)
    }
    const s = `/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(a)}`
    await at(s, ['입금 적기'])
    expect((await writeEvent(page, { type: 'settlement.payment', buyer: a, date, amount: 4000 }, scope)).status).toBeLessThan(300)
    await at(s, ['입금 적기'])
    expect((await writeEvent(page, { type: 'settlement.payment', buyer: a, date, amount: 10000 }, scope)).status).toBeLessThan(300)
    await at(s, [])
    expect((await writeEvent(page, { type: 'settlement.payment', buyer: a, date, amount: 1 }, scope)).status).toBeLessThan(300)
    await at(s, ['환불 적기'])
    await at(`/buyers?date=${date}&rehearsal=true&buyer=${encodeURIComponent(a)}`, [])
    await expect(page.getByRole('button', { name: /차단/ }).first()).toHaveClass(/button-danger/)
    await at(`/buyers?date=${date}&rehearsal=true`, 1)
    await at(`/settlements?date=${date}&rehearsal=true`, 1)
    await at('/sms', 1)
    await at('/', 1)
    await at(`/broadcasts/${encodeURIComponent(b)}`, 1)
  })
})

test.describe('PC 표 (AC-S06b-21)', () => {
  test('1440×900: 구매자·정산 표 — 열 머리, 금액 오른쪽, 줄 높이 44px 이상, 8줄 이상 스크롤 없이, 키보드 Tab·Enter로 자세히', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true, title: uniq('표') })
    for (let i = 1; i <= 12; i++) {
      await registerApi(page, b, i, `상품${String(i)}`, 1000 * i)
      await viewerClaim(page, b, `손님${String(i).padStart(2, '0')}`, String(i), `sim_t_${String(i).padStart(4, '0')}${uniq('')}`)
    }
    await expect.poll(async () => (await scopeView(page, date, true)).settlements.length).toBe(12)
    for (const [path, name, cols] of [
      ['buyers', '구매자', ['이름', '종류', '상품 수', '합계', '입금 상태', '표시']],
      ['settlements', '정산 묶음', ['이름', '상품 수', '상품 합계', '배송비', '조정', '최종 금액', '받은 금액', '입금 상태']],
    ] as const) {
      await page.goto(`/${path}?date=${date}&rehearsal=true`)
      const table = page.getByRole('table', { name, exact: true })
      await expect(table.getByRole('link')).toHaveCount(12)
      expect(await table.locator('th[scope=col]').allInnerTexts()).toEqual([...cols])
      const rows = table.locator('tbody tr')
      const heights = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
      expect(Math.min(...heights), `${name} 줄 높이`).toBeGreaterThanOrEqual(44)
      const visible = await rows.evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().bottom <= window.innerHeight).length)
      expect(visible, `${name}: 스크롤 없이 보이는 줄`).toBeGreaterThanOrEqual(8)
      const align = await table.locator('td.num').first().evaluate((el) => getComputedStyle(el).textAlign)
      expect(align).toBe('right')
      await expect(page.locator('html')).toHaveJSProperty('scrollTop', 0)
      // 키보드: 첫 이름 링크에 포커스 → Enter
      await table.getByRole('link').first().focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('region', { name: path === 'buyers' ? '구매자 자세히' : '정산 자세히' })).toBeVisible()
    }
  })

  test('375×812: 지금의 카드 모양, 가로 스크롤 없음', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await login(page)
    const { date } = await paidDay(page)
    for (const [path, name] of [['buyers', '구매자'], ['settlements', '정산 묶음']] as const) {
      await page.goto(`/${path}?date=${date}&rehearsal=true`)
      await expect(page.getByRole('list', { name, exact: true }).getByRole('link')).toHaveCount(1)
      await expect(page.getByRole('table')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    }
  })

  test('TE-S06b-001: 48rem 이상 태블릿 폭(768·1024)에서 표의 금액이 숫자 중간·"원" 앞에서 줄이 바뀌지 않는다 (금액은 늘 "1,238,000원" 한 덩어리)', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true, title: uniq('폭') })
    await registerApi(page, b, 15, '핑크프릴', 128000)
    await registerApi(page, b, 16, '블루버드', 1234000)
    await smsApi(page, { b, no: 15, memo: '김씨', phone: '010-1111-5678' })
    await smsApi(page, { b, no: 16, memo: '김씨', phone: '010-2222-5678' })
    const scope = { date, rehearsal: true }
    const first = (await scopeView(page, date, true)).buyers.find((x) => x.kind === 'sms' && x.subtotal === 128000)!.id
    expect((await writeEvent(page, { type: 'settlement.shippingOverride', buyer: first, date, mode: 'PICKUP' }, scope)).status).toBeLessThan(300)
    expect((await writeEvent(page, { type: 'settlement.adjust', buyer: first, date, amount: -12000, reason: '단골 할인' }, scope)).status).toBeLessThan(300)
    expect((await writeEvent(page, { type: 'settlement.payment', buyer: first, date, amount: 1500000 }, scope)).status).toBeLessThan(300)
    const broken: string[] = []
    for (const width of [768, 1024]) {
      await page.setViewportSize({ width, height: 1024 })
      for (const [path, name] of [['settlements', '정산 묶음'], ['buyers', '구매자']] as const) {
        await page.goto(`/${path}?date=${date}&rehearsal=true`)
        const table = page.getByRole('table', { name, exact: true })
        await expect(table.getByRole('link')).toHaveCount(2)
        const split = await table.evaluate((el) => {
          const out: string[] = []
          for (const td of el.querySelectorAll('td')) {
            const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT)
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
              const text = node.textContent ?? ''
              const re = /[−-]?\d[\d,]*원/g
              for (let m = re.exec(text); m !== null; m = re.exec(text)) {
                const range = document.createRange()
                range.setStart(node, m.index)
                range.setEnd(node, m.index + m[0].length)
                const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)))
                if (tops.size > 1) out.push(m[0])
              }
            }
          }
          return out
        })
        for (const amount of split) broken.push(`${String(width)}px ${name}: ${amount}`)
      }
    }
    expect(broken, '줄이 바뀐 금액').toEqual([])
  })
})
