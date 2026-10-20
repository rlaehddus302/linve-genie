// 판매대장 창 (AC-I2-22·33), 설정 화면 (AC-I2-02·65), 지난 구매 (AC-I2-41), 다시 보기 (AC-I2-55) — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import { dateLongKo, downloadBytes, login, menu, noHorizontalScroll, packingCommand, packingList, pay, phoneLike, postJson, realDay, registerApi, resetShop, scopeView, smsApi, uniqueDate, xlsxRows } from './support.ts'

const COLUMNS = ['방송 날짜', '회차', '상품 번호', '품종', '가격', '구매자', '채널', '찜 시각', '상태', '입금', '배송']

test.describe('판매대장 엑셀 창 (AC-I2-22·33)', () => {
  test('기간·방송 고르기 → 엑셀 내려받기: 이름, 첫 줄 열 이름 11개, 행 수, 배송 칸', async ({ page }) => {
    await login(page)
    const d1 = uniqueDate()
    const d2 = uniqueDate()
    const one = await realDay(page, { date: d1, title: '첫날', products: [{ no: 1, name: '핑크프릴', price: 10000 }, { no: 2, name: '라울', price: 8000 }], claims: [{ no: 1, phone: '010-7000-0001' }, { no: 2, phone: '010-7000-0002' }] })
    await realDay(page, { date: d2, title: '둘째날', products: [{ no: 5, name: '블루', price: 3000 }], claims: [{ no: 5, phone: '010-7000-0001' }] })
    const a = one.buyers.get('010-7000-0001')!
    const entry = (await packingList(page, d1)).find((e) => e.buyer === a)!
    expect((await packingCommand(page, d1, { buyer: a, action: 'pack', items: entry.items.map((i) => i.key) })).status).toBe(200)
    expect((await packingCommand(page, d1, { buyer: a, action: 'ship', invoice: '123456789012' })).status).toBe(200)

    await page.goto(`/settlements?date=${d1}`)
    await page.getByRole('group', { name: '정산 문서' }).getByRole('button', { name: '판매대장 엑셀' }).click()
    const dlg = page.getByRole('dialog', { name: '판매대장 엑셀' })
    await expect(dlg.getByLabel('시작 날짜')).toHaveValue(d1)
    await expect(dlg.getByLabel('끝 날짜')).toHaveValue(d1)
    // 날짜 고르기는 연도·요일까지
    await expect(dlg.getByLabel('시작 날짜').locator('option:checked')).toHaveText(dateLongKo(d1))
    const list = dlg.getByRole('list', { name: '판매대장에 넣을 방송' })
    await expect(list.getByRole('checkbox')).toHaveCount(1)
    await dlg.getByLabel('끝 날짜').selectOption(d2)
    await expect(list.getByRole('checkbox')).toHaveCount(2)
    await expect(list.getByRole('checkbox', { name: `${dateLongKo(d2)} · 둘째날` })).toBeChecked()
    // 모두 풀기 → 잠금 + 문장, 모두 고르기
    await dlg.getByRole('button', { name: '모두 풀기' }).click()
    await expect(dlg.getByText('방송을 하나 이상 골라 주세요.')).toBeVisible()
    await expect(dlg.getByRole('button', { name: '엑셀 내려받기' })).toBeDisabled()
    await dlg.getByRole('button', { name: '모두 고르기' }).click()
    await expect(dlg.getByRole('button', { name: '엑셀 내려받기' })).toBeEnabled()
    // 시작 > 끝
    await dlg.getByLabel('시작 날짜').selectOption(d2)
    await dlg.getByLabel('끝 날짜').selectOption(d1)
    await expect(dlg.getByText('시작 날짜가 끝 날짜보다 늦어요.')).toBeVisible()
    await expect(dlg.getByRole('button', { name: '엑셀 내려받기' })).toBeDisabled()
    await dlg.getByLabel('시작 날짜').selectOption(d1)
    await dlg.getByLabel('끝 날짜').selectOption(d2)
    // 기간을 바꿔도 전에 푼 방송은 푼 채
    await list.getByRole('checkbox', { name: `${dateLongKo(d2)} · 둘째날` }).uncheck()
    await dlg.getByLabel('끝 날짜').selectOption(d1)
    await dlg.getByLabel('끝 날짜').selectOption(d2)
    await expect(list.getByRole('checkbox', { name: `${dateLongKo(d2)} · 둘째날` })).not.toBeChecked()
    await list.getByRole('checkbox', { name: `${dateLongKo(d2)} · 둘째날` }).check()
    const [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: '엑셀 내려받기' }).click()])
    expect(dl.suggestedFilename()).toBe(`판매대장-${d1}-${d2}.xlsx`)
    const rows = await xlsxRows(await downloadBytes(dl))
    expect(rows[0]).toEqual(COLUMNS)
    expect(rows).toHaveLength(1 + 3)
    const ship = rows.slice(1).map((r) => r[10])
    expect(ship.filter((s) => s === '배송 완료 · 송장 123456789012')).toHaveLength(1)
    expect(ship.filter((s) => s === '포장 대기')).toHaveLength(2)
  })
})

test.describe('설정 화면 (AC-I2-02·65)', () => {
  test('가게: 계좌 일부만 → 서버 문장·칸 문제, 저장 → "저장했어요."·위 가게 이름 바로 바뀜·확인서 모양, 백업 목록, 휴대폰 폭', async ({ page, browser }) => {
    await login(page)
    const phone = await phoneLike(browser, page)
    try {
      await menu(phone).getByRole('link', { name: '설정' }).click()
      await expect(phone).toHaveURL(/\/settings$/)
      const preview = phone.getByRole('region', { name: '확인서에 나올 모양' })
      await expect(phone.getByLabel('가게 이름')).toHaveValue('시험 가게')
      await expect(preview.getByText('확인서에 입금 계좌가 나오지 않아요.')).toBeVisible()
      await phone.getByLabel('은행').fill('농협')
      await phone.getByRole('button', { name: '저장' }).click()
      await expect(phone.getByText('은행·계좌번호·예금주를 모두 적거나 모두 비워 주세요.')).toBeVisible()
      await expect(phone.getByLabel('계좌번호')).toHaveAttribute('aria-invalid', 'true')
      await phone.getByLabel('가게 이름').fill('초록다육')
      await phone.getByLabel('계좌번호').fill('302-9988-7766-11')
      await phone.getByLabel('예금주').fill('김판매')
      await phone.getByLabel('입금 안내 문장').fill('문의 010-1234-5678')
      await expect(preview).toContainText('농협 302-9988-7766-11 (예금주 김판매)')
      await expect(preview).toContainText('문의 010-1234-5678')
      await phone.getByRole('button', { name: '저장' }).click()
      await expect(phone.getByText('저장했어요.')).toBeVisible()
      await expect(phone.getByRole('banner').getByText('초록다육')).toBeVisible()
      // 백업 부분
      await expect(phone.getByText(/^마지막 자동 백업: \d{4}년 \d{1,2}월 \d{1,2}일 \(.\) \d{2}:\d{2}$/)).toBeVisible()
      await expect(phone.getByText('백업은 30일 동안 보관해요.')).toBeVisible()
      await expect(phone.getByRole('list', { name: '보관 중인 백업' }).getByRole('listitem').first()).toHaveText(/^\d{4}년 \d{1,2}월 \d{1,2}일 \(.\) \d{2}:\d{2} · \d+\.\dKB$/)
      await expect(phone.getByText('백업 시점으로 되돌리려면 운영자에게 날짜를 알려 주세요.')).toBeVisible()
      await expect(phone.getByText('자동 백업이 멈췄어요. 운영자에게 알려 주세요.')).toHaveCount(0)
      await expect(phone.getByText('구매자 닉네임·메모·전화번호 끝자리가 들어 있어요. 파일을 다른 사람에게 보내지 마세요.')).toBeVisible()
      await expect(phone.getByRole('button', { name: /복구|되돌리기/ })).toHaveCount(0)
      await noHorizontalScroll(phone)
      for (const label of ['가게 이름', '은행', '계좌번호', '예금주', '입금 안내 문장']) {
        const size = await phone.getByLabel(label).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
        expect(size, label).toBeGreaterThanOrEqual(16)
        expect((await phone.getByLabel(label).boundingBox())!.height, label).toBeGreaterThanOrEqual(44)
      }
      // 전체 기록 내려받기 — 이름
      const [json] = await Promise.all([phone.waitForEvent('download'), phone.getByRole('button', { name: '전체 기록(JSON)' }).click()])
      expect(json.suggestedFilename()).toMatch(/^라이브찜-전체기록-\d{4}-\d{2}-\d{2}\.json\.gz$/)
    } finally {
      await resetShop(page)
      await phone.context().close()
    }
  })
})

async function openBuyer(page: Page, date: string, buyer: string) {
  await page.goto(`/buyers?date=${date}&buyer=${encodeURIComponent(buyer)}`)
}

test.describe('지난 구매 (AC-I2-41)·다시 보기 (AC-I2-55)', () => {
  test('같은 전화번호의 다른 날 묶음이 "지난 구매"에 나오고, 누르면 그 날짜 정산 자세히로 간다. 전화 없는 구매자는 "다른 날의 구매 기록이 없어요."', async ({ page }) => {
    await login(page)
    const phoneNo = `010-8${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}-2222`
    const d1 = uniqueDate()
    const d2 = uniqueDate()
    const first = await realDay(page, { date: d1, title: '어제', products: [{ no: 15, name: '핑크프릴', price: 10000 }], claims: [{ no: 15, phone: phoneNo }] })
    const old = first.buyers.get(phoneNo)!
    await pay(page, d1, old, 14000)
    const second = await realDay(page, { date: d2, title: '오늘', products: [{ no: 7, name: '라울', price: 5000 }, { no: 9, name: '블루', price: 3000 }], claims: [{ no: 7, phone: phoneNo }, { no: 9, memo: '홍길동' }] })
    const now = second.buyers.get(phoneNo)!
    await openBuyer(page, d2, now)
    const past = page.getByRole('region', { name: '지난 구매' })
    const link = past.getByRole('link')
    await expect(link).toHaveCount(1)
    await expect(link).toContainText(dateLongKo(d1))
    await expect(link).toContainText('어제')
    await expect(link).toContainText('15번 핑크프릴 10,000원')
    await expect(link).toContainText('입금 완료')
    await expect(link).toContainText('포장 대기')
    await expect(link).toContainText('같은 휴대폰 번호(끝자리 2222)')
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/settlements\\?date=${d1}&buyer=${encodeURIComponent(old)}`))
    await expect(page.getByRole('region', { name: '구매 내역 확인서' }).getByRole('img', { name: '구매 내역 확인서 미리 보기' })).toBeVisible()
    // 전화 없는 문자 구매자
    await openBuyer(page, d2, second.buyers.get('홍길동')!)
    await expect(page.getByRole('region', { name: '지난 구매' }).getByText('다른 날의 구매 기록이 없어요.')).toBeVisible()
    // 지난 날짜의 포장 모드: 체크리스트·라벨 그림 저장
    await page.goto(`/packing?date=${d1}&buyer=${encodeURIComponent(old)}`)
    await page.getByRole('region', { name: '체크리스트' }).getByRole('checkbox', { name: '15번 핑크프릴' }).click()
    const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('region', { name: '포장 라벨' }).getByRole('button', { name: '그림 저장' }).click()])
    expect(png.suggestedFilename()).toMatch(new RegExp(`^포장라벨-${d1}-.+-1of1\\.png$`))
  })
})

test.describe('지난 구매 더 보기 (AC-I2-41)', () => {
  test('다른 날 22개 → 처음 20개(최근 날짜부터) + "더 보기" → 22개, 겹침 없음, 버튼 사라짐', async ({ page }) => {
    test.setTimeout(180_000)
    await login(page)
    const phoneNo = `010-7${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}-3333`
    const dates: string[] = []
    for (let i = 0; i < 23; i++) {
      const date = uniqueDate()
      dates.push(date)
      const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date, rehearsal: false, title: `${String(i + 1)}회` })
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
      const b = (res.body['broadcast'] as { id: string } | undefined)?.id ?? (res.body['result'] as { b: string } | undefined)?.b ?? String(res.body['b'] ?? res.body['id'])
      await registerApi(page, b, 1, `품종${String(i + 1)}`, 1000)
      await smsApi(page, { b, no: 1, phone: phoneNo })
    }
    const last = dates.at(-1)!
    const me = (await scopeView(page, last, false)).claims.find((c) => c.no === 1)!.currentBuyer
    await page.goto(`/buyers?date=${last}&buyer=${encodeURIComponent(me)}`)
    const past = page.getByRole('region', { name: '지난 구매' })
    await expect(past.getByRole('link')).toHaveCount(20)
    await expect(past.getByRole('link').first()).toContainText(dateLongKo(dates.at(-2)!))
    await past.getByRole('button', { name: '더 보기' }).click()
    await expect(past.getByRole('link')).toHaveCount(22)
    await expect(past.getByRole('button', { name: '더 보기' })).toHaveCount(0)
    const hrefs = await past.getByRole('link').evaluateAll((els) => els.map((el) => el.getAttribute('href')))
    expect(new Set(hrefs).size).toBe(22)
    await expect(past.getByRole('link').last()).toContainText(dateLongKo(dates[0]!))
  })
})

test.describe('KST 시각 (AC-I2-65, D-101)', () => {
  test('브라우저 시간대가 호놀룰루여도 "마지막 자동 백업"·백업 목록은 KST 시각', async ({ page, browser }) => {
    await login(page)
    const status = await (await page.request.get('/api/backups')).json() as { lastSuccessAt: string; backups: { createdAt: string }[] }
    const kst = (iso: string) => {
      const d = new Date(Date.parse(iso) + 9 * 3_600_000)
      const dow = '일월화수목금토'[d.getUTCDay()]!
      return `${String(d.getUTCFullYear())}년 ${String(d.getUTCMonth() + 1)}월 ${String(d.getUTCDate())}일 (${dow}) ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
    }
    const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Pacific/Honolulu', baseURL: new URL(page.url()).origin })
    const hnl = await context.newPage()
    await login(hnl)
    await hnl.goto('/settings')
    await expect(hnl.getByText(`마지막 자동 백업: ${kst(status.lastSuccessAt)}`)).toBeVisible()
    await expect(hnl.getByRole('list', { name: '보관 중인 백업' }).getByRole('listitem').first()).toContainText(kst(status.backups[0]!.createdAt))
    await context.close()
  })
})
