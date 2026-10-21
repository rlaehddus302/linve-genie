// O2 콘솔 — 옵션 등록·지금 상품·변형·채팅 패널·알림 띠 (AC-O2-11~17·20~25) — test-e2e.
// 기대값은 acceptance.md·D-O2-04~12에서 정했다. 채팅은 리허설 방송에서만 넣을 수 있어 옵션 리허설 방송을 쓴다.
import { expect, test, type Page } from '@playwright/test'
import { loginNewSeller } from '../i3/support.ts'
import {
  FOCUS_GRACE,
  NO_FOCUS,
  SIZES,
  board,
  boardItem,
  buyerName,
  chat,
  createBroadcast,
  SMS_TO_REVIEW,
  history,
  login,
  todayKst,
  smsField,
  openOptionBroadcast,
  oscope,
  productOf,
  register,
  registerOptions,
  waitClaims,
  waitReviews,
  writeEvent,
} from './support.ts'

function optionDialog(page: Page, name = '옵션 추가') {
  return page.getByRole('dialog', { name })
}

/** "옵션 추가" 창에서 항목 하나를 선택지 여러 개로 만든다 */
async function addItem(page: Page, n: number, name: string, choices: string) {
  const dlg = optionDialog(page)
  await dlg.getByRole('button', { name: '항목 더하기' }).click()
  await dlg.getByLabel(`항목 ${String(n)} 이름`).fill(name)
  await dlg.getByLabel(`항목 ${String(n)} 선택지 여러 개`).fill(choices)
  await dlg.getByRole('button', { name: `항목 ${String(n)} 선택지 한 번에 더하기` }).click()
}

function focusRegion(page: Page) {
  return page.getByRole('region', { name: '지금 상품' })
}

function variantLine(page: Page, no: number, text: string) {
  return page.getByRole('list', { name: `변형 — ${String(no)}번` }).getByRole('listitem').filter({ has: page.getByText(text, { exact: true }) })
}

test.describe('옵션 등록', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('AC-O2-11: 붙은 옵션 요약을 보고 Enter 한 번에 옵션 포함 product.register 하나 · 다음 줄은 옵션 없음', async ({ page }) => {
    const { b, date } = await openOptionBroadcast(page)
    const input = page.getByLabel('빠른 입력')
    await input.fill('21 반바지 15000')
    await page.getByRole('button', { name: '옵션 추가' }).click()
    await addItem(page, 1, '사이즈', 'S, M, L')
    await optionDialog(page).getByRole('button', { name: '옵션 넣기' }).click()
    await expect(optionDialog(page)).toHaveCount(0)
    await expect(page.getByRole('group', { name: '붙은 옵션' })).toContainText('옵션: 사이즈 S/M/L · 변형 3개')
    await expect(input).toHaveValue('21 반바지 15000')
    await input.press('Enter')
    await expect(boardItem(page, 21)).toBeVisible()
    await expect(page.getByRole('group', { name: '붙은 옵션' })).toHaveCount(0)
    await register(page, '22 티셔츠 9000', 22)
    const events = (await history(page, date, true)).filter((e) => e.type.startsWith('product.'))
    expect(events.map((e) => e.type)).toEqual(['product.register', 'product.register'])
    const p21 = await productOf(page, date, true, b, 21)
    expect(p21.options.map((o) => [o.name, o.choices.map((c) => c.label)])).toEqual([['사이즈', ['S', 'M', 'L']]])
    expect(p21.variants.map((v) => v.stock)).toEqual([1, 1, 1])
    const p22 = await productOf(page, date, true, b, 22)
    expect(p22.hasOptions).toBe(false)
  })

  test('AC-O2-12: 템플릿 "화분 — 호수"·"휴대폰 케이스 — 기종" — 항목 하나씩, 3개면 더 못 고름, 요청에 템플릿 이름 없음', async ({ page }) => {
    const { b, date } = await openOptionBroadcast(page)
    await page.getByLabel('빠른 입력').fill('21 다육화분 5000')
    await page.getByRole('button', { name: '옵션 추가' }).click()
    const dlg = optionDialog(page)
    await dlg.getByRole('button', { name: '템플릿에서 고르기' }).click()
    await dlg.getByRole('button', { name: '화분 — 호수' }).click()
    await expect(dlg.getByLabel('항목 1 이름')).toHaveValue('호수')
    await expect(dlg.getByLabel('항목 1 선택지 1 이름')).toHaveValue('1호')
    await expect(dlg.getByLabel('항목 1 선택지 10 이름')).toHaveValue('10호')
    await dlg.getByRole('button', { name: '휴대폰 케이스 — 기종' }).click()
    await expect(dlg.getByLabel('항목 2 이름')).toHaveValue('기종')
    const aliasFields = dlg.locator('input[aria-label^="항목 2 선택지"][aria-label$="별칭"]')
    const aliases = await aliasFields.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
    expect(aliases.some((value) => value.split(/[,，、]/).map((x) => x.trim()).includes('17프로'))).toBe(true)
    // 채운 선택지를 고치거나 지울 수 있다
    await dlg.getByLabel('항목 1 선택지 1 이름').fill('미니')
    await dlg.getByRole('button', { name: '항목 1 선택지 10 빼기' }).click()
    await expect(dlg.getByLabel('항목 1 선택지 10 이름')).toHaveCount(0)
    await dlg.getByRole('button', { name: '항목 2 빼기' }).click()
    await dlg.getByRole('button', { name: '화분 — 호수' }).click()
    await dlg.getByLabel('항목 2 이름').fill('받침')
    await dlg.getByRole('button', { name: '화분 — 호수' }).click()
    await dlg.getByLabel('항목 3 이름').fill('덮개')
    // 항목 3개: 더 고를 수 없고 이유가 보인다
    await expect(dlg.getByRole('button', { name: '화분 — 호수' })).toBeDisabled()
    await expect(dlg.getByRole('button', { name: '항목 더하기' })).toBeDisabled()
    await expect(dlg.getByText('옵션 항목은 3개까지라 더 고를 수 없어요.')).toBeVisible()
    // 변형이 100개를 넘는다(9×10×10) — 하나만 남기고 넣는다
    await dlg.getByRole('button', { name: '항목 3 빼기' }).click()
    await dlg.getByRole('button', { name: '항목 2 빼기' }).click()
    const sent: unknown[] = []
    page.on('request', (req) => { if (req.url().endsWith('/api/events') && req.method() === 'POST') sent.push(req.postDataJSON()) })
    await dlg.getByRole('button', { name: '옵션 넣기' }).click()
    await page.getByLabel('빠른 입력').press('Enter')
    await expect(boardItem(page, 21)).toBeVisible()
    expect(JSON.stringify(sent)).not.toMatch(/화분 — |template|템플릿/)
    const p = await productOf(page, date, true, b, 21)
    expect(p.options[0]?.choices.map((c) => c.label)).toEqual(['미니', '2호', '3호', '4호', '5호', '6호', '7호', '8호', '9호'])
  })

  test('AC-O2-13: 겹침 알림은 두 자리를 말하고 "옵션 넣기"가 막힌다 · 고치면 풀린다', async ({ page }) => {
    await openOptionBroadcast(page)
    await page.getByLabel('빠른 입력').fill('21 반바지 15000')
    await page.getByRole('button', { name: '옵션 추가' }).click()
    await addItem(page, 1, '사이즈', 'S, M, L')
    const dlg = optionDialog(page)
    const submit = dlg.getByRole('button', { name: '옵션 넣기' })
    await expect(submit).toBeEnabled()
    await dlg.getByLabel('항목 1 선택지 3 별칭').fill('m')
    await expect(dlg.getByText('‘m’이 사이즈 M과 사이즈 L에 함께 있어요')).toBeVisible()
    await expect(submit).toBeDisabled()
    await dlg.getByLabel('항목 1 선택지 3 별칭').fill('라지')
    await expect(dlg.getByText(/함께 있어요/)).toHaveCount(0)
    await expect(submit).toBeEnabled()
    // `/` 든 이름, 가격 차이 1.5
    await dlg.getByLabel('항목 1 선택지 1 이름').fill('S/M')
    await expect(submit).toBeDisabled()
    await expect(dlg.getByText('선택지 이름·별칭은 1~20자로, ‘/’·‘#’ 없이 적어 주세요.')).toBeVisible()
    await dlg.getByLabel('항목 1 선택지 1 이름').fill('S')
    await dlg.getByLabel('항목 1 선택지 2 가격 차이').fill('1.5')
    await expect(submit).toBeDisabled()
    await dlg.getByLabel('항목 1 선택지 2 가격 차이').fill('1,000,001')
    await expect(submit).toBeDisabled()
    await dlg.getByLabel('항목 1 선택지 2 가격 차이').fill('2000')
    await expect(submit).toBeEnabled()
  })

  test('AC-O2-14: 변형 재고 표 — 항목 순서 4행·처음 1·숫자 키패드·모두 같은 수로 3·0이면 "없음(처음부터 품절)" → 엔진 3·3·3·0, 판매 완료', async ({ page }) => {
    const { b, date } = await openOptionBroadcast(page)
    await page.getByLabel('빠른 입력').fill('31 수건 8000')
    await page.getByRole('button', { name: '옵션 추가' }).click()
    await addItem(page, 1, '색상', '흰색, 검정색')
    await addItem(page, 2, '크기', '대형, 소형')
    const dlg = optionDialog(page)
    const table = dlg.getByRole('region', { name: '옵션별 재고' }).getByRole('table')
    await expect(table.getByRole('rowheader')).toHaveText(['흰색/대형', '흰색/소형', '검정색/대형', '검정색/소형'])
    for (const text of ['흰색/대형', '흰색/소형', '검정색/대형', '검정색/소형']) {
      await expect(dlg.getByLabel(`${text} 재고`)).toHaveValue('1')
      await expect(dlg.getByLabel(`${text} 재고`)).toHaveAttribute('inputmode', 'numeric')
    }
    await dlg.getByLabel('모두 같은 수로').fill('3')
    await dlg.getByRole('button', { name: '모두 바꾸기' }).click()
    for (const text of ['흰색/대형', '흰색/소형', '검정색/대형', '검정색/소형']) await expect(dlg.getByLabel(`${text} 재고`)).toHaveValue('3')
    await dlg.getByLabel('검정색/소형 재고').fill('0')
    await expect(table.getByRole('row').filter({ hasText: '검정색/소형' })).toContainText('없음(처음부터 품절)')
    await dlg.getByRole('button', { name: '옵션 넣기' }).click()
    await page.getByLabel('빠른 입력').press('Enter')
    await expect(boardItem(page, 31)).toBeVisible()
    const p = await productOf(page, date, true, b, 31)
    expect(p.variants.map((v) => [v.text, v.stock])).toEqual([['흰색/대형', 3], ['흰색/소형', 3], ['검정색/대형', 3], ['검정색/소형', 0]])
    await page.getByRole('button', { name: '변형 펼치기 — 31번' }).click()
    for (const [text, left] of [['흰색/대형', 3], ['흰색/소형', 3], ['검정색/대형', 3], ['검정색/소형', 0]] as const) await expect(variantLine(page, 31, text)).toContainText(`남은 ${String(left)}`)
    await expect(variantLine(page, 31, '검정색/소형')).toContainText('판매 완료')
  })

  test('AC-O2-16: 상품 별칭 두 개가 엔진에 저장되고 상세에 보인다 · 11개째는 막힌다 · 휴대폰 번호 모양은 서버가 거절', async ({ page }) => {
    const { b, date } = await openOptionBroadcast(page)
    await page.getByLabel('빠른 입력').fill('41 초코 과자 3000')
    await page.getByRole('button', { name: '옵션 추가' }).click()
    const dlg = optionDialog(page)
    const aliases = dlg.getByLabel('상품 별칭 (쉼표로 나눠 적기, 10개까지)')
    await aliases.fill('a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11')
    await expect(dlg.getByText('상품 별칭은 10개까지예요.')).toBeVisible()
    await expect(dlg.getByRole('button', { name: '옵션 넣기' })).toBeDisabled()
    await aliases.fill('초코과자, 초코')
    await dlg.getByRole('button', { name: '옵션 넣기' }).click()
    await page.getByLabel('빠른 입력').press('Enter')
    await expect(boardItem(page, 41)).toBeVisible()
    expect((await productOf(page, date, true, b, 41)).aliases).toEqual(['초코과자', '초코'])
    await boardItem(page, 41).click()
    await expect(page.getByRole('dialog', { name: /41번.*자세히/ })).toContainText('초코과자, 초코')
    const phone = await writeEvent(page, { type: 'product.register', b, no: 42, name: '사탕', price: 1000, aliases: ['01012345678'] })
    expect(phone.status).toBe(400)
    expect(JSON.stringify(phone.body)).toContain('전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.')
  })

  test('AC-O2-17: 찜이 있는 상품의 옵션 고치기 — 안내·제한 칸, XL 더하기·L 재고 3 저장 → 콘솔 XL 행', async ({ page }) => {
    const { b, date } = await openOptionBroadcast(page)
    await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
    await chat(page, b, '홍길동', '반바지 M')
    await waitClaims(page, date, true, b, 1)
    await boardItem(page, 21).click()
    await page.getByRole('dialog', { name: /21번.*자세히/ }).getByRole('button', { name: '옵션 고치기' }).click()
    const dlg = optionDialog(page, '21번 옵션 고치기')
    await expect(dlg.getByText('찜이 있어 선택지 더하기·가격·재고만 바꿀 수 있어요. 다른 것은 새 번호로 등록해 주세요.')).toBeVisible()
    await expect(dlg.getByRole('button', { name: '항목 더하기' })).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: '항목 1 빼기' })).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: /^항목 1 선택지 \d+ 빼기$/ })).toHaveCount(0)
    await expect(dlg.getByLabel('항목 1 이름')).toHaveCount(0)
    await expect(dlg.getByLabel('항목 1 선택지 1 이름')).toHaveCount(0)
    await dlg.getByLabel('항목 1 선택지 여러 개').fill('XL')
    await dlg.getByRole('button', { name: '항목 1 선택지 한 번에 더하기' }).click()
    await dlg.getByLabel('L 재고', { exact: true }).fill('3')
    await dlg.getByRole('button', { name: '옵션 저장' }).click()
    await expect(dlg).toHaveCount(0)
    const p = await productOf(page, date, true, b, 21)
    expect(p.variants.map((v) => [v.text, v.stock])).toEqual([['S', 1], ['M', 1], ['L', 3], ['XL', 1]])
    await page.getByRole('dialog', { name: /21번.*자세히/ }).getByRole('button', { name: '닫기' }).first().click()
    await page.getByRole('button', { name: '변형 펼치기 — 21번' }).click()
    await expect(variantLine(page, 21, 'XL')).toBeVisible()
  })

  test('AC-O2-17: 고치는 중에 찜이 들어와 서버가 changed=false면 "바뀐 것이 없어요"이고 저장 완료로 보이지 않는다', async ({ page }) => {
    const { b, date } = await openOptionBroadcast(page)
    await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
    await boardItem(page, 21).click()
    await page.getByRole('dialog', { name: /21번.*자세히/ }).getByRole('button', { name: '옵션 고치기' }).click()
    const dlg = optionDialog(page, '21번 옵션 고치기')
    // 찜이 없으니 선택지를 뺄 수 있다
    await dlg.getByRole('button', { name: '항목 1 선택지 3 빼기' }).click()
    await expect(dlg.getByLabel('항목 1 선택지 3 이름')).toHaveCount(0)
    // 그 사이 찜이 들어온다
    await chat(page, b, '홍길동', '반바지 M')
    await waitClaims(page, date, true, b, 1)
    await dlg.getByRole('button', { name: '옵션 저장' }).click()
    await expect(dlg.getByText('바뀐 것이 없어요')).toBeVisible()
    await expect(dlg).toBeVisible()
    expect((await productOf(page, date, true, b, 21)).variants.map((v) => v.text)).toEqual(['S', 'M', 'L'])
  })
})

test.describe('지금 상품·변형', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('AC-O2-20: 지금 상품 크게(24px 이상) · 15초 안내가 보였다가 사라진다 · 없으면 "지금 상품 없음"', async ({ page }) => {
    await page.clock.install()
    const { b } = await openOptionBroadcast(page)
    await expect(focusRegion(page)).toContainText(NO_FOCUS)
    await register(page, '21 반바지 15000', 21)
    await expect(focusRegion(page).getByText('지금 상품: 21번 반바지')).toBeVisible()
    const size = await focusRegion(page).getByText('지금 상품: 21번 반바지').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBeGreaterThanOrEqual(24)
    await expect(focusRegion(page).getByText(FOCUS_GRACE)).toBeVisible()
    await page.clock.runFor(16_000)
    await expect(focusRegion(page).getByText(FOCUS_GRACE)).toHaveCount(0)
    await expect(focusRegion(page).getByText('지금 상품: 21번 반바지')).toBeVisible()
    expect(b).toBeTruthy()
  })

  test('AC-O2-21: "지금 상품으로"는 판매 중·공개 전에만, 지금 상품엔 "지금 상품" · 22를 누르면 대기 없이 바로 product.focus', async ({ page }) => {
    const { b, date } = await openOptionBroadcast(page)
    await registerOptions(page, b, { no: 23, name: '모자', price: 5000 })
    await registerOptions(page, b, { no: 24, name: '양말', price: 2000 })
    await writeEvent(page, { type: 'product.hold', b, no: 23 })
    await writeEvent(page, { type: 'product.close', b, no: 24 })
    await registerOptions(page, b, { no: 22, name: '치마', price: 12000, status: 'READY' })
    await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
    await expect(boardItem(page, 21)).toBeVisible()
    await expect(focusRegion(page)).toContainText('지금 상품: 21번 반바지')
    await expect(page.getByRole('button', { name: '지금 상품으로 — 21번' })).toHaveCount(0)
    await expect(board(page).getByText('지금 상품', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '지금 상품으로 — 22번' })).toBeVisible()
    await expect(page.getByRole('button', { name: '지금 상품으로 — 23번' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '지금 상품으로 — 24번' })).toHaveCount(0)
    const t0 = Date.now()
    await page.getByRole('button', { name: '지금 상품으로 — 22번' }).click()
    await expect(focusRegion(page)).toContainText('지금 상품: 22번 치마')
    expect(Date.now() - t0).toBeLessThan(2000) // 대기 띠(2초) 없이 바로
    await expect(page.getByRole('region', { name: '보내기 전 조치' }).getByRole('button', { name: /되돌리기/ })).toHaveCount(0)
    const focus = (await history(page, date, true)).filter((e) => e.type === 'product.focus')
    expect(focus.map((e) => e.fields['no'])).toEqual([22])
    // 상품 상세에도 같은 규칙
    await boardItem(page, 23).click()
    await expect(page.getByRole('dialog', { name: /23번.*자세히/ }).getByRole('button', { name: /^지금 상품으로/ })).toHaveCount(0)
  })

  test('AC-O2-22: 한 콘솔에서 지금 상품을 일시 중지하면 두 콘솔 모두 "지금 상품 없음" — 판매 종료도 같다', async ({ page, browser }) => {
    const { b } = await openOptionBroadcast(page)
    await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
    await registerOptions(page, b, { no: 22, name: '치마', price: 12000 })
    const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: await page.context().storageState() })
    const other = await ctx.newPage()
    await other.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(focusRegion(other)).toContainText('지금 상품: 22번 치마')
    await page.getByRole('button', { name: '지금 상품으로 — 21번' }).click()
    await expect(focusRegion(other)).toContainText('지금 상품: 21번 반바지')
    await boardItem(page, 21).click()
    await page.getByRole('dialog', { name: /21번.*자세히/ }).getByRole('button', { name: '일시 중지' }).click()
    await expect(focusRegion(page)).toContainText(NO_FOCUS)
    await expect(focusRegion(other)).toContainText(NO_FOCUS)
    await page.keyboard.press('Escape')
    await other.getByRole('button', { name: '지금 상품으로 — 22번' }).click()
    await expect(focusRegion(page)).toContainText('지금 상품: 22번 치마')
    await boardItem(page, 22).click()
    await page.getByRole('dialog', { name: /22번.*자세히/ }).getByRole('button', { name: '판매 종료' }).click()
    await page.getByRole('dialog', { name: '판매 종료' }).getByRole('button', { name: '판매 종료하기' }).click()
    await expect(focusRegion(other)).toContainText(NO_FOCUS)
    await expect(focusRegion(page)).toContainText(NO_FOCUS)
    await ctx.close()
  })

  test('AC-O2-23: 변형마다 한 줄 — 상태·1등(×2)·대기 수·남은 수량, 상품 줄은 "변형 3개 · 남은 1"·"변형별"', async ({ page }) => {
    const { b, date } = await openOptionBroadcast(page)
    await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { L: 2 } })
    await chat(page, b, '홍길동', '반바지 M')
    await chat(page, b, '김철수', '반바지 M')
    await chat(page, b, '최지우', '반바지 L 2개')
    await waitClaims(page, date, true, b, 3)
    await expect(boardItem(page, 21)).toContainText('변형 3개 · 남은 1')
    await expect(boardItem(page, 21)).toContainText('1등 변형별')
    await page.getByRole('button', { name: '변형 펼치기 — 21번' }).click()
    await expect(variantLine(page, 21, 'S')).toContainText('판매 중')
    await expect(variantLine(page, 21, 'S')).toContainText('남은 1')
    await expect(variantLine(page, 21, 'M')).toContainText('1등 홍길동')
    await expect(variantLine(page, 21, 'M')).toContainText('대기 1')
    await expect(variantLine(page, 21, 'M')).toContainText('남은 0')
    await expect(variantLine(page, 21, 'M')).toContainText('판매 완료')
    await expect(variantLine(page, 21, 'L')).toContainText('최지우 ×2')
    await expect(variantLine(page, 21, 'L')).toContainText('남은 0')
    await writeEvent(page, { type: 'product.hold', b, no: 21 })
    for (const text of ['S', 'M', 'L']) await expect(variantLine(page, 21, text)).toContainText('일시 중지')
  })

  test('AC-O2-24: 채팅 패널 — "주문 21번 M"·"주문 21번 L ×2"·"확인 필요 · 옵션 빠짐"·"언급", 확인 필요에는 "확인 필요에서 고르기"만', async ({ page }) => {
    const { b } = await openOptionBroadcast(page)
    await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { L: 2 } })
    await chat(page, b, '홍길동', '반바지 M')
    await chat(page, b, '최지우', '반바지 L 2개')
    await chat(page, b, '김철수', '반바지')
    await chat(page, b, '박민수', '반바지 예뻐요 너무')
    const list = page.getByRole('list', { name: '채팅 메시지' })
    const msg = (text: string) => list.getByRole('listitem').filter({ has: page.getByText(text, { exact: true }) })
    await expect(msg('반바지 M')).toContainText('주문 21번 M')
    await expect(msg('반바지 M')).not.toContainText('×1')
    await expect(msg('반바지 L 2개')).toContainText('주문 21번 L ×2')
    await expect(msg('반바지')).toContainText('확인 필요 · 옵션 빠짐')
    await expect(msg('반바지 예뻐요 너무')).toContainText('언급')
    await expect(msg('반바지').getByRole('button', { name: /찜으로 바꾸기/ })).toHaveCount(0)
    await expect(msg('반바지 예뻐요 너무').getByRole('button', { name: /찜으로 바꾸기/ })).toHaveCount(0)
    await msg('반바지').getByRole('button', { name: /확인 필요에서 고르기/ }).click()
    await expect(page.getByRole('heading', { name: '확인 필요', level: 1 })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/reviews\\?.*broadcast=${b}`))
    await expect(page.getByRole('list', { name: '확인 필요 목록' }).getByRole('listitem')).toHaveCount(1)
  })
})

test('AC-O2-25: 알림 띠 "확인 필요 2건"(이 방송) → /reviews 이 방송 · 홈 "리허설 확인 필요 3건" · 번호 방송만 있는 판매자는 확인 필요 없음', async ({ page }) => {
  await loginNewSeller(page)
  await page.goto('/')
  await expect(page.getByText(/확인 필요/)).toHaveCount(0)
  const num = await createBroadcast(page, { rehearsal: true, saleMode: 'NUMBERS' })
  await page.goto(`/broadcasts/${encodeURIComponent(num.b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  await expect(page.getByRole('region', { name: '알림' })).not.toContainText('확인 필요')
  await expect(page.getByRole('navigation', { name: '메뉴' })).not.toContainText('확인 필요')

  const one = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS' })
  const two = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS' })
  await registerOptions(page, one.b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await registerOptions(page, two.b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await chat(page, one.b, '김철수', '반바지')
  await chat(page, one.b, '이영희', '반바지')
  await chat(page, two.b, '박민수', '반바지')
  await waitReviews(page, one.b, true, 2)
  await waitReviews(page, two.b, true, 1)
  await page.goto(`/broadcasts/${encodeURIComponent(one.b)}`)
  const alertButton = page.getByRole('region', { name: '알림' }).getByRole('button', { name: '확인 필요 2건' })
  await expect(alertButton).toBeVisible()
  await alertButton.click()
  await expect(page).toHaveURL(new RegExp(`/reviews\\?.*broadcast=${one.b}`))
  await expect(page.getByRole('list', { name: '확인 필요 목록' }).getByRole('listitem')).toHaveCount(2)
  await page.goto('/')
  await expect(page.getByRole('link', { name: '리허설 확인 필요 3건' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^확인 필요 \d+건$/ })).toHaveCount(0)
})

test('TE-O2-001: 옵션 상품의 승계 결정 필요(변형)도 알림 띠에 뜨고 창에 그 변형의 대기자가 보인다 (cancel.succession=ASK)', async ({ page }) => {
  await loginNewSeller(page)
  const origin = new URL(page.url()).origin
  const res = await page.request.patch('/api/settings', { data: { settings: { 'cancel.succession': 'ASK' } }, headers: { Origin: origin } })
  expect(res.status(), await res.text()).toBe(200)
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await chat(page, b, '홍길동', '반바지 M')
  await chat(page, b, '김철수', '반바지 M')
  const claims = await waitClaims(page, date, true, b, 2)
  const s = await oscope(page, date, true)
  const winner = claims.find((c) => c.status === 'CONFIRMED')!
  expect(buyerName(s, winner.currentBuyer)).toBe('홍길동')
  const cancel = await writeEvent(page, { type: 'host.cancel', b, no: 21, buyer: winner.currentBuyer, options: { 사이즈: 'M' }, reason: '시험 취소' })
  expect(cancel.status, JSON.stringify(cancel.body)).toBeLessThan(300)
  await expect.poll(async () => (await productOf(page, date, true, b, 21)).variants.find((v) => v.text === 'M')?.awaitingSuccession).toBe(true)
  // 판매자가 알아야 한다: 알림 띠에 "승계 결정 필요"
  const alert = page.getByRole('region', { name: '알림' }).getByRole('button', { name: /^승계 결정 필요/ })
  await expect(alert).toBeVisible()
  await alert.click()
  const dlg = page.getByRole('dialog', { name: /^승계 결정/ })
  await expect(dlg).toContainText('대기 1번 김철수')
})

test('TE-O2-002: 옵션 상품에 1등 찜이 있으면 상품 상세 "판매 종료"는 누를 수 없고 "1등·대기 찜을 먼저 정리해 주세요." (S05 규칙 그대로)', async ({ page }) => {
  await login(page)
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await chat(page, b, '홍길동', '반바지 M')
  await waitClaims(page, date, true, b, 1)
  await boardItem(page, 21).click()
  const detail = page.getByRole('dialog', { name: /21번.*자세히/ })
  await expect(detail.getByRole('region', { name: 'M 변형' })).toContainText('홍길동')
  await expect(detail.getByRole('button', { name: '판매 종료' })).toBeDisabled()
  await expect(detail.getByText('1등·대기 찜을 먼저 정리해 주세요.')).toBeVisible()
})

test('TE-O2-003: 옵션 상품의 가격을 1등 찜이 있을 때 바꾸면 "이미 1등인 찜"에 적용할지 묻는다 (번호 상품과 같은 흐름)', async ({ page }) => {
  await login(page)
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await chat(page, b, '홍길동', '반바지 M')
  await waitClaims(page, date, true, b, 1)
  const input = page.getByLabel('빠른 입력')
  await input.fill('21 반바지 13000')
  await input.press('Enter')
  await page.getByRole('dialog', { name: '21번이 이미 있어요. 고칠까요?' }).getByRole('button', { name: '예' }).click()
  // 번호 상품(AC-S05-13)과 같이 확정된 찜에 적용할지 묻는다
  const apply = page.getByRole('dialog', { name: '확정된 찜에도 새 가격을 적용할까요?' })
  await expect(apply).toBeVisible()
  await expect(apply.getByText(/이미 1등인 찜 1개의 가격도/)).toBeVisible()
})

test('AC-O2-25·30: 실제 옵션 방송의 문자찜 확인 필요 — 홈 "확인 필요 1건"·콘솔 알림 띠, 목록엔 뒤 4자리만, 주문으로 보내면 문자찜 찜', async ({ page }) => {
  await loginNewSeller(page)
  const title = `실제 옵션 ${crypto.randomUUID().slice(0, 8)}`
  const { b, date } = await createBroadcast(page, { rehearsal: false, saleMode: 'OPTIONS', title, date: todayKst() })
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  // 새 판매자의 하나뿐인 실제 방송이라 문자찜 화면이 처음부터 고른다
  await page.goto('/sms')
  await expect(page.getByRole('region', { name: '고른 방송' })).toContainText(title)
  await expect(page.getByRole('region', { name: '최근 넣은 문자찜' })).toBeVisible()
  await smsField(page, '번호').fill('21')
  await smsField(page, '전화번호').fill('010-2345-6789')
  await page.getByRole('region', { name: '문자찜 넣기' }).getByRole('radiogroup', { name: '사이즈' }).getByRole('radio', { name: 'M · 남은 1개' }).check()
  await page.getByRole('region', { name: '문자찜 넣기' }).getByLabel('수량', { exact: true }).fill('3')
  await page.getByRole('button', { name: '21번에 문자찜 넣기' }).click()
  await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText(SMS_TO_REVIEW)
  await page.goto('/')
  const link = page.getByRole('link', { name: '확인 필요 1건' })
  await expect(link).toBeVisible()
  await expect(page.getByRole('link', { name: /^리허설 확인 필요/ })).toHaveCount(0)
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByRole('region', { name: '알림' }).getByRole('button', { name: '확인 필요 1건' })).toBeVisible()
  await page.goto('/')
  await link.click()
  await expect(page.getByRole('heading', { name: '확인 필요', level: 1 })).toBeVisible()
  const line = page.getByRole('list', { name: '확인 필요 목록' }).getByRole('listitem', { name: '1번째 줄', exact: true })
  await expect(line).toContainText('뒤 4자리 6789')
  await expect(line).toContainText('남은 수량 부족')
  await expect(page.locator('main')).not.toContainText(/2345|010-?2345/)
  await expect(line.getByLabel('사이즈')).toHaveValue('M')
  await expect(line.getByLabel('수량')).toHaveValue('3')
  await line.getByLabel('수량').fill('1')
  await line.getByRole('button', { name: '1번째 줄 주문으로' }).click()
  await expect(page.getByRole('list', { name: '확인 필요 목록' }).getByRole('listitem')).toHaveCount(0, { timeout: 15_000 })
  const [claim] = await waitClaims(page, date, false, b, 1)
  expect([claim!.origin, claim!.variant, claim!.qty, claim!.status]).toEqual(['sms', 'M', 1, 'CONFIRMED'])
})
