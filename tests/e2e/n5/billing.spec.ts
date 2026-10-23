// N5 요금제 E2E (test-e2e) — acceptance "L. 테스트 관점 / test-e2e"의 흐름을 판매자가 겪는 순서로.
// 요금 기능을 켠 E2E 서버(chromium-billing)는 실행마다 빈 메모리 DB이고 시험 계정 하나를 함께 쓴다 —
// 그래서 이 파일의 시험은 선언 순서(이용권 없음 → 주문 건권 → 사업자 정보·결제 실패 → 계좌이체·환불 → 방송 일권 → 정액제)로 상태를 쌓는다.
// 각 시험은 시작할 때 요금 상태로 전제를 확인한다(앞 시험이 실패해 전제가 다르면 전제 단언에서 바로 실패).
// 기대 문장·숫자는 BILLING_RULES BL-9와 시험이 넣은 값(산 양·부여 시각)으로 계산한다 — 화면 구현을 보고 정하지 않는다.
import { expect, test, type Page } from '@playwright/test'
import { closeMore, expectPhoneBar, expectTarget, moreLinks, openMore } from '../menu.ts'
import {
  DAY_MS,
  LOOKUP_FAILED,
  NO_PASS_BANNER,
  NO_PASS_SENTENCE,
  billingStatus,
  buy,
  kst,
  login,
  menu,
  noHorizontalScroll,
  openBilling,
  openNewForm,
  payAndWebhook,
  payResult,
  paymentsApi,
  phoneLike,
  primaryOutsideDialogs,
  registerApi,
  smsApi,
  statusCell,
  testGateway,
  testGrant,
  uniq,
  uniqueDate,
  usageApi,
} from './support.ts'

test.describe('@billing N5 요금 흐름', () => {
  test('TE-N5 처음 판매자: 홈 띠 → 실제 방송 거절 문장·요금 화면 열기 → 리허설은 시작됨 (AC-N5-50·56·57)', async ({ page }) => {
    await login(page)
    const s = await billingStatus(page)
    expect(s.start.allowed, '전제: 이용권 없음').toBe(false)

    // PC 메뉴: 새 메뉴 "요금"은 "설정" 앞, "설정"이 늘 마지막 (D-NAV-01, AC-NAV-09) — T1 "택배"가 "설정" 바로 앞(AC-T1-60)이라 "요금 · 택배 · 설정"
    const links = menu(page).getByRole('link')
    await expect(links.last()).toHaveText('설정')
    await expect(links.nth(-2)).toHaveText('택배')
    await expect(links.nth(-3)).toHaveText('요금')

    // 홈 띠 (BL-9 1) + 요금 화면 열기 하나
    const banners = page.getByRole('region', { name: '요금 알림' })
    await expect(banners.getByRole('listitem')).toHaveText([NO_PASS_BANNER])
    await expect(banners.getByRole('link', { name: '요금 화면 열기' })).toHaveCount(1)

    // 새 방송 칸의 미리 보기 = BL-4 1.5 문장 + 요금 화면 열기
    const form = await openNewForm(page)
    const preview = form.getByRole('status', { name: '새 방송 요금' })
    await expect(preview).toContainText(NO_PASS_SENTENCE)
    await expect(preview.getByRole('link', { name: '요금 화면 열기' })).toBeVisible()

    // 그래도 "이 방송 시작하기"는 누를 수 있고, 서버 거절 문장이 같은 자리에 하나
    const before = ((await (await page.request.get('/api/broadcasts')).json()) as { broadcasts: unknown[] }).broadcasts.length
    await form.getByLabel('제목').fill(uniq('거절'))
    await form.getByLabel('날짜').fill(uniqueDate())
    await expect(form.getByRole('button', { name: '이 방송 시작하기' })).toBeEnabled()
    await form.getByRole('button', { name: '이 방송 시작하기' }).click()
    const alert = form.getByRole('alert')
    await expect(alert).toContainText(NO_PASS_SENTENCE)
    await expect(page.getByText(NO_PASS_SENTENCE, { exact: true })).toHaveCount(1)
    expect(page.url()).not.toContain('/broadcasts/')
    const after = ((await (await page.request.get('/api/broadcasts')).json()) as { broadcasts: unknown[] }).broadcasts.length
    expect(after).toBe(before)

    // 요금 화면 열기 → /billing (요금 화면을 열기만 해서는 포트원 SDK 같은 외부 스크립트를 부르지 않는다 — AC-N5-52)
    const outside: string[] = []
    page.on('request', (r) => {
      if (!r.url().startsWith(new URL(page.url()).origin)) outside.push(r.url())
    })
    await alert.getByRole('link', { name: '요금 화면 열기' }).click()
    await expect(page).toHaveURL(/\/billing$/)
    await expect(page.getByRole('heading', { level: 1, name: '요금' })).toBeVisible()
    await expect(page.getByRole('region', { name: '요금 알림' }).getByRole('listitem')).toHaveText([NO_PASS_BANNER])
    // 요금 화면 띠에는 링크가 없다(이미 요금 화면)
    await expect(statusCell(page, '정액제')).toContainText('없음')
    await expect(statusCell(page, '방송 일권')).toContainText('남은 0일')
    expect(outside).toEqual([])

    // 리허설은 요금과 상관없이 시작된다 (문장 없음)
    await page.goto('/')
    await page.getByRole('button', { name: '리허설 해 보기' }).click()
    await expect(page.getByText('리허설 중 — 실제 판매가 아니에요')).toBeVisible()
  })

  test('TE-N5 주문 건권 방송: 거절 뒤 다른 기기에서 받으면 미리 보기가 바뀌고 같은 칸으로 시작 → 1등 셋·늦은 문자찜 → 콘솔엔 요금 알림 없음 → 홈 띠 초과 → 다시 거절 (AC-N5-22·56·57)', async ({ page }) => {
    await login(page)
    const s = await billingStatus(page)
    expect(s.start.allowed, '전제: 이용권 없음').toBe(false)
    expect(s.balances.ORDERS).toBe(0)

    const title = uniq('주문건')
    const date = uniqueDate()
    const form = await openNewForm(page)
    await form.getByLabel('제목').fill(title)
    await form.getByLabel('날짜').fill(date)
    await form.getByRole('button', { name: '이 방송 시작하기' }).click()
    await expect(form.getByRole('alert')).toContainText(NO_PASS_SENTENCE)

    // 다른 기기(운영자)가 주문 건권 1건을 준다 → 요금 알림으로 거절 문장이 걷히고 새 미리 보기
    await testGrant(page, { kind: 'ORDERS', quantity: 1 })
    await expect(form.getByRole('status', { name: '새 방송 요금' })).toHaveText('주문 건권으로 시작해요 (남은 1건). 1등이 나온 상품마다 1건씩 빠져요.')
    await expect(form.getByRole('alert')).toHaveCount(0)

    // 같은 칸 그대로 다시 누르면 시작된다 (거절은 아무것도 기록하지 않았다 — 같은 요청 번호여도 시작)
    await form.getByRole('button', { name: '이 방송 시작하기' }).click()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    const b = decodeURIComponent(/\/broadcasts\/([^/?#]+)/.exec(page.url())![1]!)

    // 상품 넷 등록, 셋이 1등 (문자찜). 잔량 1 → 1 − 3 = −2 (방송 중 소진에도 모든 쓰기가 된다)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '블루엘프', 12000)
    await registerApi(page, b, 17, '라울', 8000)
    await registerApi(page, b, 18, '홍옥', 5000)
    await smsApi(page, { b, no: 15, phone: '010-1111-0015', memo: '첫째' })
    await smsApi(page, { b, no: 16, phone: '010-1111-0016', memo: '둘째' })
    await smsApi(page, { b, no: 17, phone: '010-1111-0017', memo: '셋째' })

    // 콘솔: 요금 알림 띠·문장 없음 (D-N5-03)
    await page.reload()
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    await expect(page.getByRole('region', { name: '요금 알림' })).toHaveCount(0)
    await expect(page.getByText(/주문 건권|이용권/)).toHaveCount(0)

    // 방송을 끝내고, 늦은 문자찜으로 넷째 상품이 처음 1등 → 1 − 4 = −3
    await page.getByRole('button', { name: '방송 끝내기' }).click()
    await page.getByRole('dialog', { name: '방송 끝내기' }).getByRole('button', { name: '끝내기' }).click()
    await expect(page.getByText('끝난 방송이에요')).toBeVisible()
    await smsApi(page, { b, no: 18, phone: '010-1111-0018', memo: '늦게' })
    await expect(page.getByRole('region', { name: '요금 알림' })).toHaveCount(0)

    // 홈 띠: 주문 건권 초과 3건
    await page.goto('/')
    const banners = page.getByRole('region', { name: '요금 알림' })
    await expect(banners.getByRole('listitem').filter({ hasText: '주문 건권' })).toHaveText('주문 건권을 3건 넘게 썼어요. 다음에 사는 주문 건권에서 먼저 빠져요.')
    await expect(banners.getByRole('listitem').filter({ hasText: '이용권이 없어' })).toHaveText(NO_PASS_BANNER)

    // 새 실제 방송은 다시 거절
    const form2 = await openNewForm(page)
    await expect(form2.getByRole('status', { name: '새 방송 요금' })).toContainText(NO_PASS_SENTENCE)
    await form2.getByLabel('날짜').fill(uniqueDate())
    await form2.getByRole('button', { name: '이 방송 시작하기' }).click()
    await expect(form2.getByRole('alert')).toContainText(NO_PASS_SENTENCE)

    // 요금 화면: 초과는 낱말로, 쓴 내역에 주문 1건 줄 넷 (최근 것 먼저 — 늦은 문자찜 18번이 맨 위)
    await openBilling(page)
    await expect(statusCell(page, '주문 건권')).toContainText('초과 3건')
    const usage = page.getByRole('table', { name: '쓴 내역' })
    await expect(usage.getByRole('row').filter({ hasText: '주문 1건' })).toHaveCount(4)
    await expect(usage.getByRole('row').nth(1)).toContainText('18번 홍옥')
    await expect(usage.getByRole('row').nth(1)).toContainText(title)
  })

  test('TE-N5 사업자 정보 없이 사기 → 안내 → 틀린 번호 문장 → 맞는 번호 → 가린 번호 → 주문 건권 사기 전 초과 안내 (AC-N5-52·53)', async ({ page }) => {
    await login(page)
    const s = await billingStatus(page)
    expect(s.business, '전제: 사업자 정보 없음').toBeNull()
    await openBilling(page)

    // "사기" 대신 안내와 버튼
    await expect(page.getByText('결제 전에 사업자 정보를 적어 주세요.')).toBeVisible()
    await expect(page.getByRole('button', { name: /사기$/ })).toHaveCount(0)
    await expect(page.getByText('방송 일권 1일 · 5,000원 (부가세 포함)')).toBeVisible()
    await page.getByRole('button', { name: '사업자 정보 적기' }).click()
    const biz = page.getByRole('form', { name: '사업자 정보' })
    await expect(biz.getByLabel('사업자등록번호')).toBeFocused()

    await biz.getByLabel('사업자등록번호').fill('12345')
    await biz.getByLabel('상호').fill('다육이네')
    await biz.getByLabel('대표자 이름').fill('김다육')
    await biz.getByRole('button', { name: '저장' }).click()
    await expect(biz.getByText('사업자등록번호는 숫자 10자리로 적어 주세요.')).toBeVisible()
    await biz.getByLabel('사업자등록번호').fill('123-45-67890')
    await biz.getByRole('button', { name: '저장' }).click()
    await expect(biz.getByText('사업자등록번호를 다시 확인해 주세요.')).toBeVisible()
    await expect(biz.getByLabel('사업자등록번호')).toHaveAttribute('aria-invalid', 'true')
    // 상호 51자 → 그 칸 아래 문장 (AC-N5-37)
    await biz.getByLabel('사업자등록번호').fill('123-45-67891')
    await biz.getByLabel('상호').fill('가'.repeat(51))
    await biz.getByRole('button', { name: '저장' }).click()
    await expect(biz.getByText('상호는 1~50자로 적어 주세요.')).toBeVisible()
    await expect(biz.getByLabel('상호')).toHaveAttribute('aria-invalid', 'true')
    await biz.getByLabel('상호').fill('다육이네')
    await biz.getByRole('button', { name: '저장' }).click()
    await expect(biz).toHaveCount(0)
    await expect(page.getByText('123-45-*****')).toBeVisible()
    await expect(page.getByText('1234567891')).toHaveCount(0)

    // "바꾸기": 번호 칸은 비어 있다 (가린 값을 넣지 않는다)
    await page.getByRole('button', { name: '바꾸기' }).click()
    await expect(page.getByRole('form', { name: '사업자 정보' }).getByLabel('사업자등록번호')).toHaveValue('')
    await page.getByRole('form', { name: '사업자 정보' }).getByRole('button', { name: '취소' }).click()

    // 이제 "사기"가 있다. 주문 건권 초과 중이면 결제 전 안내 (BL-9 5)
    await page.getByRole('button', { name: '주문 건권 100건 사기' }).click()
    const dlg = page.getByRole('dialog', { name: '주문 건권 100건 사기' })
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await expect(dlg).toContainText('주문 건권 100건 · 10,000원 (부가세 포함)')
    await expect(dlg).toContainText('지난 초과 3건이 이번 주문 건권에서 먼저 빠져요(이 이용권은 바로 쓴 것이 되어 7일 환불 대상이 아니에요).')
    await expect(dlg.getByRole('button', { name: '결제하기' })).toBeDisabled()
    await dlg.getByRole('radio', { name: '계좌이체' }).check()
    // D-PL1-07: 간이과세자 — 계좌이체 증빙은 현금영수증(지출증빙) 하나 (AC-PL1B-06·08)
    await expect(dlg).toContainText('현금영수증(지출증빙)을 발행해요.')
    await expect(dlg).not.toContainText('세금계산서(또는 현금영수증)를 발행해요.')
    await dlg.getByRole('button', { name: '닫기' }).click()
    await expect(dlg).toHaveCount(0)
  })

  test('TE-N5 결제가 안 될 때: 실패 · 금액 바꿔 결제 · 조회 실패 → 다시 확인 · 창 닫기 → 웹훅 (AC-N5-52·54·58)', async ({ page }) => {
    await login(page)
    const s = await billingStatus(page)
    expect(s.business?.complete, '전제: 사업자 정보 있음').toBe(true)
    const labels0 = s.balances.LABELS
    await openBilling(page)

    // 결제 실패
    await buy(page, '라벨 장권 100장', '결제 실패')
    await expect(payResult(page).getByRole('status')).toHaveText('결제가 되지 않았어요. 돈은 나가지 않았어요.')
    await expect(payResult(page).getByRole('button', { name: '다시 확인' })).toHaveCount(0)

    // 금액을 바꿔 결제 → 전액 취소 문장, 내역 "금액이 달라 취소함"
    const mismatch = await buy(page, '라벨 장권 100장', '금액을 바꿔 결제')
    await expect(payResult(page).getByRole('status')).toHaveText('결제 금액이 주문과 달라 결제를 취소했어요. 다시 시도해 주세요.')
    const table = page.getByRole('table', { name: '결제 내역' })
    await expect(table.locator('.tag', { hasText: '금액이 달라 취소함' })).toHaveCount(1)
    await expect(table.locator('.tag', { hasText: '결제 안 됨' })).toHaveCount(1)
    expect((await paymentsApi(page)).find((x) => x.paymentId === mismatch)?.state).toBe('MISMATCH_CANCELLED')
    await expect(statusCell(page, '라벨 장권')).toContainText(labels0 < 0 ? `초과 ${String(-labels0)}장` : `남은 ${String(labels0)}장`)

    // 조회 실패 켠 채 결제 → 확인하지 못함 + 다시 확인(한 곳) → 끄고 다시 확인 → 부여
    await testGateway(page, { lookupFailure: true })
    try {
      await buy(page, '라벨 장권 100장', '결제 완료(카드)')
      await expect(payResult(page).getByRole('status')).toContainText(LOOKUP_FAILED)
      await expect(page.getByRole('button', { name: '다시 확인' })).toHaveCount(1)
      await expect(page.getByRole('button', { name: /다시 확인$/ })).toHaveCount(1)
    } finally {
      await testGateway(page, { lookupFailure: false })
    }
    await payResult(page).getByRole('button', { name: '다시 확인' }).click()
    await expect(payResult(page).getByRole('status')).toHaveText('결제했어요. 라벨 장권 100장을 받았어요.')
    const labels1 = labels0 + 100
    await expect(statusCell(page, '라벨 장권')).toContainText(labels1 < 0 ? `초과 ${String(-labels1)}장` : `남은 ${String(labels1)}장`)

    // 창 닫기 → 결제 대기 + 다시 확인 → 포트원이 결제 완료 웹훅을 보낸다 → 결과 문장과 잔량이 바뀐다
    const pending = await buy(page, '라벨 장권 100장', '창 닫기')
    await expect(payResult(page).getByRole('status')).toContainText("결제를 확인하는 중이에요. 잠시 뒤 '다시 확인'을 눌러 주세요.")
    await expect(payResult(page).getByRole('button', { name: '다시 확인' })).toBeVisible()
    await expect(table.locator('.tag', { hasText: '결제 대기' })).toHaveCount(1)
    await payAndWebhook(page, pending)
    await expect(payResult(page).getByRole('status')).toHaveText('결제했어요. 라벨 장권 100장을 받았어요.')
    await expect(payResult(page).getByRole('button', { name: '다시 확인' })).toHaveCount(0)
    const labels2 = labels1 + 100
    await expect(statusCell(page, '라벨 장권')).toContainText(labels2 < 0 ? `초과 ${String(-labels2)}장` : `남은 ${String(labels2)}장`)
    await expect(table.locator('.tag', { hasText: '결제 대기' })).toHaveCount(0)
    await expect(table.locator('.tag', { hasText: '결제 완료' })).toHaveCount(2)
  })

  test('TE-N5 계좌이체·환불: 증빙 발행됨 TEST- → 환불 확인 창(처음 포커스 닫기) → 환불함·잔량 원래대로 (AC-N5-54)', async ({ page }) => {
    await login(page)
    const s = await billingStatus(page)
    expect(s.business?.complete, '전제: 사업자 정보 있음').toBe(true)
    expect(s.balances.DAYS, '전제: 방송 일권 0').toBe(0)
    await openBilling(page)

    const paymentId = await buy(page, '방송 일권 1일', '결제 완료(계좌이체)', '계좌이체')
    await expect(payResult(page).getByRole('status')).toHaveText('결제했어요. 방송 일권 1일을 받았어요.')
    await expect(statusCell(page, '방송 일권')).toContainText('남은 1일')
    const table = page.getByRole('table', { name: '결제 내역' })
    const row = table.getByRole('row').filter({ hasText: '방송 일권 1일' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('5,000원')
    await expect(row).toContainText('계좌이체')
    await expect(row.locator('.tag')).toHaveText('결제 완료')
    // D-PL1-07: 새 증빙 요청은 늘 현금영수증 (AC-PL1B-06·08)
    await expect(row).toContainText(/현금영수증 발행됨 · TEST-\S+/)

    await row.getByRole('button', { name: '방송 일권 1일 환불' }).click()
    const dlg = page.getByRole('dialog', { name: '환불할까요?' })
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await expect(dlg).toContainText("'방송 일권 1일' 결제(5,000원)를 취소하고 이용권을 거둬요. 되돌릴 수 없어요.")
    const buttons = dlg.getByRole('button')
    await expect(buttons.filter({ hasText: /^(닫기|환불)$/ })).toHaveText(['닫기', '환불'])
    await dlg.getByRole('button', { name: '환불' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page.getByRole('region', { name: '결제 내역' }).getByRole('status')).toHaveText('환불했어요. 결제 수단으로 돌려드려요.')
    await expect(row.locator('.tag')).toHaveText('환불함')
    await expect(row).toContainText('취소됨')
    await expect(row.getByRole('button', { name: '방송 일권 1일 환불' })).toHaveCount(0)
    await expect(statusCell(page, '방송 일권')).toContainText('남은 0일')
    expect((await paymentsApi(page)).find((x) => x.paymentId === paymentId)?.state).toBe('REFUNDED')
    // 환불한 이용권으로는 시작할 수 없다
    expect((await billingStatus(page)).start.allowed).toBe(false)
  })

  test('TE-N5 방송 일권: 카드로 사서 → 홈 미리 보기 1일 써요 → 휴대폰에서 시작하면 PC 미리 보기가 바뀜 → 2부 미리 보기 24시간 안 → 시작 → 쓴 내역 한 줄, 쓴 이용권엔 환불 없음 (AC-N5-51·55·56)', async ({ page, browser }) => {
    await login(page)
    const s = await billingStatus(page)
    expect(s.balances.DAYS, '전제: 방송 일권 0').toBe(0)
    expect(s.window, '전제: 열린 창 없음').toBeNull()
    expect(s.flat.active).toBe(false)
    await openBilling(page)

    await buy(page, '방송 일권 1일', '결제 완료(카드)')
    await expect(payResult(page).getByRole('status')).toHaveText('결제했어요. 방송 일권 1일을 받았어요.')
    await expect(statusCell(page, '방송 일권')).toContainText('남은 1일')

    await page.goto('/')
    const date = uniqueDate()
    const form = await openNewForm(page)
    const preview = form.getByRole('status', { name: '새 방송 요금' })
    await expect(preview).toHaveText('방송 일권 1일을 써요 (남은 1일 → 0일). 지금부터 24시간 안에 시작하는 방송은 더 빠지지 않아요.')

    // 1부는 휴대폰에서 시작한다 → 열어 둔 PC 새 방송 칸의 미리 보기가 새로 고치지 않아도 "24시간 안"으로 바뀐다 (AC-N5-56 두 기기)
    const t0 = Date.now()
    const mobile = await phoneLike(browser, page)
    try {
      const mform = await openNewForm(mobile)
      await expect(mform.getByRole('status', { name: '새 방송 요금' })).toHaveText('방송 일권 1일을 써요 (남은 1일 → 0일). 지금부터 24시간 안에 시작하는 방송은 더 빠지지 않아요.')
      await mform.getByLabel('제목').fill('1부')
      await mform.getByLabel('날짜').fill(date)
      await mform.getByRole('button', { name: '이 방송 시작하기' }).click()
      await expect(mobile.getByLabel('빠른 입력')).toBeVisible()
    } finally {
      await mobile.context().close()
    }
    const t1 = Date.now()
    await expect(preview).toHaveText(/^방송 일권 24시간 안이에요 \(.+까지\)\. 더 빠지지 않아요\.$/, { timeout: 3000 })

    // 창 끝 = 쓴 때 + 24시간 (서버 시각 — 시험은 누른 앞뒤 시각으로 범위를 잡는다)
    const used = (await usageApi(page)).filter((x) => x.kind === 'DAYS')
    expect(used).toHaveLength(1)
    const at = Date.parse(used[0]!.at)
    expect(at).toBeGreaterThanOrEqual(t0 - 5000)
    expect(at).toBeLessThanOrEqual(t1 + 5000)
    const until = kst(at + DAY_MS)

    await page.goto('/')
    const form2 = await openNewForm(page)
    await expect(form2.getByRole('status', { name: '새 방송 요금' })).toHaveText(`방송 일권 24시간 안이에요 (${until}까지). 더 빠지지 않아요.`)
    await form2.getByLabel('제목').fill('2부')
    await form2.getByLabel('날짜').fill(date)
    await form2.getByRole('button', { name: '이 방송 시작하기' }).click()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    expect((await usageApi(page)).filter((x) => x.kind === 'DAYS')).toHaveLength(1)

    await openBilling(page)
    await expect(statusCell(page, '방송 일권')).toContainText('남은 0일')
    await expect(statusCell(page, '방송 일권')).toContainText(`24시간 사용 중 · ${until}까지`)
    const usage = page.getByRole('table', { name: '쓴 내역' })
    const dayRows = usage.getByRole('row').filter({ hasText: '방송 일권 1일' })
    await expect(dayRows).toHaveCount(1)
    const [m, d] = date.slice(5).split('-').map(Number) as [number, number]
    await expect(dayRows).toContainText(`1부(${String(m)}/${String(d)})`)
    await expect(dayRows).toContainText(`${until}까지`)
    await expect(dayRows).toContainText(kst(at))
    // 쓴 이용권(카드)엔 환불이 없다 — 앞 시험에서 환불한 줄에도 없다
    await expect(page.getByRole('button', { name: '방송 일권 1일 환불' })).toHaveCount(0)
  })

  test('TE-N5 정액제 알림·두 기기: 3일 남은 띠 → 휴대폰에서 연장 결제 → PC 홈 미리 보기가 바로 30일 늘어남 (AC-N5-51·52·56·57)', async ({ page, browser }) => {
    await login(page)
    const s = await billingStatus(page)
    expect(s.flat.active, '전제: 정액제 없음').toBe(false)
    // 시험용 부여: 27일 전 + 60초 → 끝까지 3일에서 60초 모자람 → 올림 3일
    const atMs = Math.floor((Date.now() - 27 * DAY_MS - 60_000) / 1000) * 1000
    await testGrant(page, { kind: 'FLAT_30D', at: new Date(atMs).toISOString() })
    const until1 = kst(atMs + 30 * DAY_MS)
    const until2 = kst(atMs + 60 * DAY_MS)
    const flatBanner = `정액제가 3일 남았어요 (${until1}까지). 미리 연장하면 남은 기간 뒤에 30일이 이어져요.`

    await page.goto('/')
    const banners = page.getByRole('region', { name: '요금 알림' })
    await expect(banners.getByRole('listitem').filter({ hasText: '정액제' })).toHaveText(flatBanner)
    await expect(banners.getByRole('listitem').filter({ hasText: '이용권이 없어' })).toHaveCount(0)
    const form = await openNewForm(page)
    const preview = form.getByRole('status', { name: '새 방송 요금' })
    await expect(preview).toHaveText(`정액제로 시작해요 (${until1}까지).`)

    // 휴대폰: 요금 화면 띠·칸, 정액제 사기 전 안내, 결제
    const mobile = await phoneLike(browser, page)
    try {
      await openBilling(mobile)
      await expect(mobile.getByRole('region', { name: '요금 알림' }).getByRole('listitem').filter({ hasText: '정액제' })).toHaveText(flatBanner)
      await expect(statusCell(mobile, '정액제')).toContainText(`이용 중 · ${until1}까지`)
      await mobile.getByRole('button', { name: '정액제 30일 사기' }).click()
      const dlg = mobile.getByRole('dialog', { name: '정액제 30일 사기' })
      await expect(dlg).toContainText(`남은 기간(${until1}까지) 뒤에 30일이 이어져요.`)
      await dlg.getByRole('button', { name: '닫기' }).click()
      await buy(mobile, '정액제 30일', '결제 완료(카드)')
      await expect(payResult(mobile).getByRole('status')).toHaveText('결제했어요. 정액제 30일을 받았어요.')
      await expect(statusCell(mobile, '정액제')).toContainText(`이용 중 · ${until2}까지`)
      await expect(mobile.getByRole('region', { name: '요금 알림' }).getByRole('listitem').filter({ hasText: '정액제' })).toHaveCount(0)
      // 휴대폰 폭: 결제 내역·쓴 내역은 카드
      await expect(mobile.getByRole('list', { name: '결제 내역' })).toBeVisible()
      await expect(mobile.getByRole('table', { name: '결제 내역' })).toHaveCount(0)
      await expect(mobile.getByRole('list', { name: '쓴 내역' })).toBeVisible()
    } finally {
      await mobile.context().close()
    }

    // PC 홈: 새로 고치지 않아도 미리 보기와 띠가 바뀐다 (요금 알림)
    await expect(preview).toHaveText(`정액제로 시작해요 (${until2}까지).`, { timeout: 3000 })
    await expect(page.getByRole('region', { name: '요금 알림' }).getByRole('listitem').filter({ hasText: '정액제' })).toHaveCount(0)
  })

  test('TE-N5 375px: 요금 화면·결제 전 확인·환불 확인·사업자 정보가 가로 스크롤 없이, 누르는 곳 44px·글자 16px, 개발 용어 없음, 주 버튼 하나 이하 (AC-N5-59)', async ({ page, browser }) => {
    await login(page)
    const mobile = await phoneLike(browser, page)
    try {
      await openBilling(mobile)
      await expect(mobile.getByRole('list', { name: '결제 내역' })).toBeVisible()
      await noHorizontalScroll(mobile)
      const body = (await mobile.locator('main').innerText()).replace(/TEST-\S+/g, '')
      for (const word of ['FLAT', 'DAY', 'ORDERS', 'LABELS', 'PENDING', 'GRANTED', 'NO_PASS', 'REFUNDED', 'MISMATCH', 'NEEDS_REVIEW', 'TAX_INVOICE', 'CARD', 'TRANSFER']) {
        expect(body, word).not.toContain(word)
      }
      expect((await primaryOutsideDialogs(mobile)).length).toBeLessThanOrEqual(1)

      // 누르는 곳 44px, 칸 글자 16px
      const small = await mobile.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('main button, main a.button, main summary, main input:not([type=radio]):not([type=checkbox])')]
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ text: el.textContent?.trim() || el.getAttribute('aria-label') || el.tagName, h: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize) }))
          .filter((x) => x.h < 44 || x.font < 16),
      )
      expect(small).toEqual([])

      // 휴대폰 메뉴 (D-NAV-01, 요금 켜짐에서 AC-NAV-01·02 다시 확인 — AC-NAV-09): 막대는 다섯 칸 한 줄 그대로("방송"·"문자찜 입력"·"구매자"·"정산"·"더보기", 44px),
      // "요금"은 더보기 목록의 "설정" 바로 앞 — 목록 "입금 확인"·"포장"·"라벨"(켜짐일 때만)·"요금"·"설정", 한 줄에 하나·44px·16px
      await expectPhoneBar(mobile)
      await openMore(mobile)
      await expect(moreLinks(mobile)).toHaveText(await phoneMoreNames(mobile))
      for (const link of await moreLinks(mobile).all()) {
        await expectTarget(mobile, link)
        expect(await link.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
      }
      await expect(moreLinks(mobile).filter({ hasText: '요금' })).toHaveAttribute('aria-current', 'page')
      await noHorizontalScroll(mobile)
      await closeMore(mobile)

      // 사업자 정보 칸 (바꾸기) — 번호 칸은 숫자 키패드
      await mobile.getByRole('button', { name: '바꾸기' }).click()
      const biz = mobile.getByRole('form', { name: '사업자 정보' })
      await expect(biz.getByLabel('사업자등록번호')).toHaveAttribute('inputmode', 'numeric')
      await noHorizontalScroll(mobile)
      expect(await primaryOutsideDialogs(mobile)).toEqual(['저장'])
      await biz.getByRole('button', { name: '취소' }).click()

      // 결제 전 확인 창
      await mobile.getByRole('button', { name: '라벨 장권 500장 사기' }).click()
      const dlg = mobile.getByRole('dialog', { name: '라벨 장권 500장 사기' })
      await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
      await noHorizontalScroll(mobile)
      const dlgBox = await dlg.boundingBox()
      expect(dlgBox!.width).toBeLessThanOrEqual(375)
      await dlg.getByRole('button', { name: '닫기' }).click()

      // 환불 확인 창 (앞 시험에서 산, 쓰지 않은 라벨 장권)
      await mobile.getByRole('button', { name: '라벨 장권 100장 환불' }).first().click()
      const refund = mobile.getByRole('dialog', { name: '환불할까요?' })
      await expect(refund.getByRole('button', { name: '닫기' })).toBeFocused()
      await noHorizontalScroll(mobile)
      expect((await refund.boundingBox())!.width).toBeLessThanOrEqual(375)
      await refund.getByRole('button', { name: '닫기' }).click()
      await expect(refund).toHaveCount(0)
    } finally {
      await mobile.context().close()
    }
  })
})

/** 요금 켜짐 휴대폰 더보기 목록 (AC-NAV-02·09): 라벨 기능 켬/끔은 서버 설정을 읽어 정한다(꺼짐이면 "라벨"을 만들지 않는다 — L-13 9) */
async function phoneMoreNames(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/settings/labels')
  expect(res.status(), await res.text()).toBe(200)
  const { enabled } = (await res.json()) as { enabled: boolean }
  return ['입금 확인', '포장', ...(enabled ? ['라벨'] : []), '요금', '택배', '설정']
}
