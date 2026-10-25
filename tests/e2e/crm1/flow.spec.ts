// CRM1 한 흐름 (test-e2e) — AC-CRM1-03·15·16·17·21·23·24. 새 판매자로 날짜 넷을 만들어 손님 기록을 따라간다.
// 기대값은 acceptance.md에서 옮긴다(구현을 보고 정하지 않는다): 표지(채널 ID·전화번호 키)로 날짜를 넘어 한 번만 잇고, 누적 = 상품 합계(배송비 빼고).
import { test, expect } from '@playwright/test'
import { customerDateKo, customerRows, eventCount, kstDate, loginNewSeller, payAll, smsSale, won, writeEvent, youtubeSale } from './support.ts'

test.describe('손님 기록 한 흐름', () => {
  test('AC-CRM1-03·15·21·23: 채널로 세 날짜 + 합친 문자 손님의 전화번호로 한 날짜 → 4번·75,000원, 메모는 다른 날짜·모든 손님에서 같다, 빈 글이면 "메모를 지울까요?"(그대로 두기·지우기), 이벤트 0', async ({ page }) => {
    test.setTimeout(180_000)
    await loginNewSeller(page)
    const [d1, d2, d3, d4] = [kstDate(20), kstDate(15), kstDate(10), kstDate(6)] as const
    const ch = `UC_A${String(Date.now())}`
    const phone = `010-7${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}-1234`
    await youtubeSale(page, { date: d1, ch, nick: '다육이맘', prices: [30_000], paid: true })
    await youtubeSale(page, { date: d2, ch, nick: '다육이맘', prices: [15_000], paid: true })
    // d3: 유튜브 15,000 + 문자(전화 뒤 1234) 5,000 → 합친 묶음 20,000
    const s3 = await youtubeSale(page, { date: d3, ch, nick: '다육이맘', prices: [15_000], paid: false })
    const r1 = await smsSale(page, { date: d3, b: s3.b, phone, prices: [5_000], paid: false })
    expect((await writeEvent(page, { type: 'buyer.merge', from: r1.buyer, into: s3.buyer, reason: '같은 사람' }, { date: d3, rehearsal: false })).status).toBeLessThan(300)
    await payAll(page, d3, s3.buyer)
    // d4: 같은 전화번호의 다른 문자 구매자 10,000 입금 완료
    await smsSale(page, { date: d4, phone, prices: [10_000], paid: true })

    const scopes = [d1, d2, d3, d4].map((date) => ({ date, rehearsal: false }))
    const before = await eventCount(page, scopes)

    await page.goto(`/buyers?date=${d3}&buyer=${encodeURIComponent(s3.buyer)}`)
    const record = page.getByRole('region', { name: '손님 기록' })
    await expect(record).toContainText(`누적 구매 ${won(75_000)} · 4번`)
    await expect(record).toContainText(`마지막 구매 ${customerDateKo(d4)}`)
    await expect(record).toContainText('미입금 없음')
    await expect(record).toContainText('취소 0번')
    // "지난 구매" 위에 있다
    const recordBox = await record.boundingBox()
    const pastBox = await page.getByRole('region', { name: '지난 구매' }).boundingBox()
    expect(recordBox!.y).toBeLessThan(pastBox!.y)
    // 합친 묶음: 메모 칸 둘 (AC-CRM1-23)
    await expect(record.getByRole('heading', { name: '메모 · 유튜브 · 다육이맘' })).toBeVisible()
    await expect(record.getByRole('heading', { name: '메모 · 문자 · 끝자리 1234' })).toBeVisible()
    await expect(record).toContainText('연락처·주소는 적지 마세요.')
    // 영어 상태값이 보이지 않는다
    await expect(page.locator('main')).not.toContainText(/PAID|UNPAID|PARTIAL|OVERPAID/)

    // d1 자세히에서 메모 (2줄) → 바로 저장
    await page.goto(`/buyers?date=${d1}&buyer=${encodeURIComponent(ch)}`)
    const memoText = '10/8 늦게 입금,\n다음엔 선입금 부탁'
    const r = page.getByRole('region', { name: '손님 기록' })
    await r.getByLabel('메모 — 유튜브 · 다육이맘').fill(memoText)
    await r.getByRole('button', { name: '메모 저장 — 유튜브 · 다육이맘' }).click()
    await expect(r.getByRole('status').filter({ hasText: '메모를 저장했어요.' })).toBeVisible()
    await expect(r.getByText(/\d+월 \d+일\([일월화수목금토]\) 저장/)).toBeVisible()

    // d3 자세히에서 같은 메모(줄 나눔 그대로)
    await page.goto(`/buyers?date=${d3}&buyer=${encodeURIComponent(s3.buyer)}`)
    const memoBox = page.getByRole('region', { name: '손님 기록' }).locator('.memo-text').first()
    await expect(memoBox).toHaveText(memoText)
    expect(await memoBox.evaluate((el) => (el as HTMLElement).innerText)).toBe(memoText)

    // 모든 손님 → UC_A 자세히에서 같은 메모 → 빈 글로 저장하면 먼저 묻는다
    await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '모든 손님' }).click()
    const list = page.getByRole('region', { name: '모든 손님' })
    await expect(list).toBeVisible()
    await customerRows(page).filter({ hasText: '다육이맘' }).getByRole('link').first().click()
    const detail = page.getByRole('region', { name: '손님 자세히' })
    await expect(detail.locator('.memo-text')).toHaveText(memoText)
    const memoField = detail.getByLabel('메모 — 유튜브 · 다육이맘')
    const memoSave = detail.getByRole('button', { name: '메모 저장 — 유튜브 · 다육이맘' })
    const memoPuts: string[] = []
    page.on('request', (rq) => {
      if (rq.method() === 'PUT' && rq.url().includes('/memo')) memoPuts.push(rq.postData() ?? '')
    })
    // 빈 글로 저장하면 먼저 묻는다 (D-CRM1-16 (1)) — "그대로 두기"면 저장하지 않고 칸에 저장된 글이 돌아온다
    await memoField.fill('')
    await memoSave.click()
    const ask = page.getByRole('dialog', { name: '메모를 지울까요?' })
    await expect(ask).toBeVisible()
    await expect(ask.getByRole('button', { name: '지우기' })).toBeVisible()
    await ask.getByRole('button', { name: '그대로 두기' }).click()
    await expect(ask).toHaveCount(0)
    await expect(memoField).toHaveValue(memoText)
    await expect(detail.locator('.memo-text')).toHaveText(memoText)
    expect(memoPuts).toEqual([])
    // 다시 비우고 "지우기" → 지움
    await memoField.fill('')
    await memoSave.click()
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: '지우기' }).click()
    await expect(ask).toHaveCount(0)
    await expect(detail.getByRole('status').filter({ hasText: '메모를 지웠어요.' })).toBeVisible()
    expect(memoPuts).toHaveLength(1)
    await expect(detail.locator('.memo-text')).toHaveCount(0)
    await page.goto(`/buyers?date=${d2}&buyer=${encodeURIComponent(ch)}`)
    await expect(page.getByRole('region', { name: '손님 기록' }).getByText('메모 없음').first()).toBeVisible()

    // 메모·조회는 이벤트를 쓰지 않는다
    expect(await eventCount(page, scopes)).toBe(before)
  })

  test('AC-CRM1-16·17·24: 모든 손님 줄 → 손님 자세히(날짜별 줄 최근부터) → 날짜 줄 → 그날 구매자 자세히 → 뒤로 가기, 차단 길·차단 뒤 "차단"', async ({ page }) => {
    test.setTimeout(180_000)
    await loginNewSeller(page)
    const [d1, d2, d3] = [kstDate(25), kstDate(18), kstDate(4)] as const
    const ch = `UC_B${String(Date.now())}`
    await youtubeSale(page, { date: d1, ch, nick: '라울맘', prices: [12_000], paid: true })
    await youtubeSale(page, { date: d2, ch, nick: '라울맘', prices: [8_000], paid: true })
    const s3 = await youtubeSale(page, { date: d3, ch, nick: '라울맘(새이름)', prices: [5_000], paid: false })

    await page.goto(`/buyers?view=customers`)
    const rows = customerRows(page)
    await expect(rows).toHaveCount(1)
    const row = rows.first()
    await expect(row).toContainText('라울맘(새이름)') // 가장 최근 실제 날짜의 표시 이름
    await expect(row).toContainText('유튜브')
    await expect(row).toContainText(won(20_000))
    await expect(row).toContainText('2번')
    await expect(row).toContainText(customerDateKo(d2))
    // 찾기: 지난 날짜에만 쓴 닉네임 (AC-CRM1-16)
    await page.getByLabel('손님 찾기').fill('라울맘')
    await expect(page.getByRole('status').filter({ hasText: '손님 1명' })).toBeVisible()

    await row.getByRole('link').first().click()
    const detail = page.getByRole('region', { name: '손님 자세히' })
    const lines = detail.getByRole('region', { name: '날짜별 기록' }).getByRole('link')
    await expect(lines).toHaveCount(3)
    await expect(lines.nth(0)).toContainText(customerDateKo(d3))
    await expect(lines.nth(0)).toContainText('그날 이름 라울맘(새이름)')
    await expect(lines.nth(0)).toContainText(`상품 합계 ${won(5_000)}`)
    // 입금 낱말 (D-CRM1-13): d3은 기다리는 날 3일이 지난 미입금 → "미입금으로 셈" 하나(같은 줄에 "미입금"이 두 번 나오지 않는다)
    await expect(lines.nth(0)).toContainText('미입금으로 셈')
    expect(((await lines.nth(0).innerText()).match(/미입금/g) ?? []).length).toBe(1)
    await expect(lines.nth(0)).not.toContainText('입금 기다리는 중')
    await expect(lines.nth(1)).toContainText(customerDateKo(d2))
    await expect(lines.nth(1)).toContainText('입금 완료')
    await expect(lines.nth(1)).not.toContainText('미입금')
    await expect(lines.nth(2)).toContainText(customerDateKo(d1))
    // 차단 버튼 없음, 가장 최근 날짜 구매자 화면으로 가는 길
    await expect(detail.getByRole('button', { name: /차단/ })).toHaveCount(0)
    const [, m3, dd3] = d3.split('-').map(Number) as [number, number, number]
    const blockLink = detail.getByRole('link', { name: `가장 최근 날짜(${String(m3)}월 ${String(dd3)}일)의 구매자 화면에서 차단할 수 있어요` })
    await expect(blockLink).toBeVisible()

    // 날짜 줄 → 그날 구매자 자세히 → 뒤로 가기
    await lines.nth(1).click()
    await expect(page).toHaveURL(new RegExp(`date=${d2}`))
    await expect(page.getByRole('region', { name: '손님 기록' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('region', { name: '손님 자세히' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('region', { name: '모든 손님' })).toBeVisible()
    await expect(customerRows(page)).toHaveCount(1)

    // 차단 길 → 그날 구매자 자세히에 "차단하기"
    await customerRows(page).first().getByRole('link').first().click()
    await page.getByRole('region', { name: '손님 자세히' }).getByRole('link', { name: /가장 최근 날짜/ }).click()
    await expect(page).toHaveURL(new RegExp(`date=${d3}`))
    await expect(page.getByRole('button', { name: '차단하기' })).toBeVisible()
    // 차단은 기존 조치 그대로 (API로 적고) → 모든 손님 줄에 "차단"
    expect((await writeEvent(page, { type: 'host.blockBuyer', buyer: s3.buyer, reason: '장난' }, { date: d3, rehearsal: false })).status).toBeLessThan(300)
    await page.goto(`/buyers?view=customers`)
    await expect(customerRows(page).first()).toContainText('차단')
  })
})
