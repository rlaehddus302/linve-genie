// N5 E2E 공격 (라운드 0, test-e2e) — billing.spec.ts 뒤에 돈다(파일 이름 순). 각 시험은 스스로 전제를 만든다(사업자 정보가 없으면 API로 적는다).
// 판매자가 실제로 할 법한 조작: 휴대폰 결제 창이 돌아옴, 결제하기·환불 연타, 결제 대기 주문 둘, 새로 고침.
import { expect, test, type Page } from '@playwright/test'
import { becomeDevice, cleanupPrint, printOverview, region, scopeLabels, waitPrinted } from '../i1/support.ts'
import { billingStatus, buy, kst, login, statusCell, testGrant, openBilling, payResult, paymentsApi, phoneLike, registerApi, sendJson, smsApi, uniqueDate, usageApi } from './support.ts'

async function ensureBusiness(page: Page): Promise<void> {
  if ((await billingStatus(page)).business?.complete === true) return
  const res = await sendJson(page, 'PUT', '/api/billing/business', { requestId: crypto.randomUUID(), businessNumber: '123-45-67891', name: '다육이네', ceo: '김다육' })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

async function createOrder(page: Page, itemId: string): Promise<{ paymentId: string; orderName: string }> {
  const res = await sendJson(page, 'POST', '/api/billing/orders', { requestId: crypto.randomUUID(), itemId, method: 'CARD', agreed: true })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as never
}

async function testPay(page: Page, paymentId: string, action: 'PAID' | 'FAILED'): Promise<void> {
  const res = await sendJson(page, 'POST', `/api/billing/test/payments/${paymentId}`, { action, ...(action === 'PAID' ? { method: 'CARD' } : {}) })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

test.describe('@billing N5 공격 (라운드 0)', () => {
  test('TE-N5 휴대폰 결제 창이 /billing?paymentId=…로 돌아오면 서버 확인 결과만 보이고 주소의 다른 값은 쓰지 않는다 (AC-N5-31·52)', async ({ page, browser }) => {
    await login(page)
    await ensureBusiness(page)
    const mobile = await phoneLike(browser, page)
    try {
      await mobile.goto('/')
      // 결제 실패한 결제인데 주소에는 성공처럼 꾸민 값이 붙어 있다
      const failed = await createOrder(mobile, 'labels-100')
      await testPay(mobile, failed.paymentId, 'FAILED')
      await mobile.goto(`/billing?paymentId=${failed.paymentId}&code=&transactionType=PAYMENT&amount=2000&status=PAID`)
      await expect(payResult(mobile).getByRole('status')).toHaveText('결제가 되지 않았어요. 돈은 나가지 않았어요.')
      await expect(mobile).toHaveURL(/\/billing$/)

      // 결제 완료한 결제 → 부여, 새로 고쳐도 다시 확인하지 않는다(주소에서 지웠다)
      const paid = await createOrder(mobile, 'labels-100')
      await testPay(mobile, paid.paymentId, 'PAID')
      const labels0 = (await billingStatus(mobile)).balances.LABELS
      await mobile.goto(`/billing?paymentId=${paid.paymentId}`)
      await expect(payResult(mobile).getByRole('status')).toHaveText('결제했어요. 라벨 장권 100장을 받았어요.')
      await expect(mobile).toHaveURL(/\/billing$/)
      expect((await billingStatus(mobile)).balances.LABELS).toBe(labels0 + 100)
      const confirms: string[] = []
      mobile.on('request', (r) => {
        if (/\/confirm$/.test(new URL(r.url()).pathname)) confirms.push(r.url())
      })
      await mobile.reload()
      await expect(mobile.getByRole('heading', { level: 1, name: '요금' })).toBeVisible()
      await expect(mobile.locator('.billing-cell')).toHaveCount(4)
      expect(confirms).toEqual([])
    } finally {
      await mobile.context().close()
    }
  })

  test('TE-N5 결제 대기 주문 둘: 결과 문장의 주문은 그 자리에만, 다른 주문은 내역 줄의 "<이름> 다시 확인" → 그 결과로 바뀐다 (AC-N5-52·54)', async ({ page }) => {
    await login(page)
    await ensureBusiness(page)
    await openBilling(page)
    const first = await buy(page, '라벨 장권 500장', '창 닫기')
    await expect(payResult(page).getByRole('status')).toContainText('결제를 확인하는 중이에요.')
    const second = await buy(page, '라벨 장권 500장', '창 닫기')
    await expect(payResult(page).getByRole('status')).toContainText('결제를 확인하는 중이에요.')
    expect(first).not.toBe(second)
    // 결과 문장의 "다시 확인" 하나 + 다른 대기 주문의 줄 버튼 하나
    await expect(payResult(page).getByRole('button', { name: '다시 확인' })).toHaveCount(1)
    const rowButtons = page.getByRole('button', { name: '라벨 장권 500장 다시 확인' })
    await expect(rowButtons).toHaveCount(1)

    // 첫 주문은 사이에 결제가 끝났다(웹훅 없음) → 줄의 다시 확인 → 결과 문장이 그 주문의 결과
    await testPay(page, first, 'PAID')
    await rowButtons.click()
    await expect(payResult(page).getByRole('status')).toHaveText('결제했어요. 라벨 장권 500장을 받았어요.')
    // 이제 둘째 주문은 결과 문장 자리에 없으니 줄에 "다시 확인"이 있어야 한다
    await expect(page.getByRole('button', { name: '라벨 장권 500장 다시 확인' })).toHaveCount(1)
    expect((await paymentsApi(page)).find((x) => x.paymentId === second)?.state).toBe('PENDING')
  })

  test('TE-N5 결제하기·환불 연타: 주문은 하나, 환불(결제 취소)은 한 번 (AC-N5-30·36)', async ({ page }) => {
    await login(page)
    await ensureBusiness(page)
    await openBilling(page)
    const before = (await paymentsApi(page)).length

    await page.getByRole('button', { name: '방송 일권 10일 사기' }).click()
    const dlg = page.getByRole('dialog', { name: '방송 일권 10일 사기' })
    await dlg.getByRole('checkbox', { name: '이용권 약관과 환불 규정을 읽었어요' }).check()
    const orders: string[] = []
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/billing/orders' && r.method() === 'POST') orders.push(r.postData() ?? '')
    })
    await dlg.getByRole('button', { name: '결제하기' }).dblclick()
    const test = page.getByRole('dialog', { name: '시험 결제 — 실제로 돈이 나가지 않아요' })
    await expect(test).toBeVisible()
    await test.getByRole('button', { name: '결제 완료(카드)' }).click()
    await expect(payResult(page).getByRole('status')).toHaveText('결제했어요. 방송 일권 10일을 받았어요.')
    const after = await paymentsApi(page)
    expect(after.length).toBe(before + 1)
    expect(new Set(orders.map((o) => (JSON.parse(o) as { requestId: string }).requestId)).size).toBe(1)

    // 환불 확인 창의 "환불" 연타 → 환불 요청은 같은 요청 번호, 결과는 환불함 하나
    const target = after[0]!
    expect(target.itemName).toBe('방송 일권 10일')
    const refunds: string[] = []
    page.on('request', (r) => {
      if (/\/refund$/.test(new URL(r.url()).pathname)) refunds.push(r.postData() ?? '')
    })
    await page.getByRole('button', { name: '방송 일권 10일 환불' }).click()
    const confirmDlg = page.getByRole('dialog', { name: '환불할까요?' })
    await confirmDlg.getByRole('button', { name: '환불' }).dblclick()
    await expect(page.getByRole('region', { name: '결제 내역' }).getByRole('status')).toHaveText('환불했어요. 결제 수단으로 돌려드려요.')
    expect(new Set(refunds.map((o) => (JSON.parse(o) as { requestId: string }).requestId)).size).toBe(1)
    expect((await paymentsApi(page)).find((x) => x.paymentId === target.paymentId)?.state).toBe('REFUNDED')
  })

  test('TE-N5 라벨 장: 주문 건권 방송의 상품 라벨이 출력함이 될 때마다 1장(자동·다시 출력), 정액제 방송의 라벨은 세지 않는다 (AC-N5-24·55)', async ({ page }) => {
    await login(page)
    const usage0 = await usageApi(page)
    const ordersUse = usage0.filter((x) => x.kind === 'ORDERS')
    expect(ordersUse.length, '전제: 주문 건권 방송(billing.spec.ts)').toBeGreaterThan(0)
    const ordersBroadcast = ordersUse[0]!.broadcast!
    const labels0 = (await billingStatus(page)).balances.LABELS
    const labelUse0 = usage0.filter((x) => x.kind === 'LABELS').length
    // 출력 기기가 없어 기다리던 주문 건권 방송의 상품 라벨 (자동 출력 — 1등마다 하나)
    const waiting = (await printOverview(page)).queue.waiting
    expect(waiting, '전제: 주문 건권 방송의 상품 라벨 넷이 출력 대기').toBe(4)
    try {
      const { backlog } = await becomeDevice(page, '라벨 기기')
      expect(backlog).toBe(true)
      await region(page, '출력 멈춤').getByRole('button', { name: '출력 시작' }).click()
      await waitPrinted(page, 4)
      await expect.poll(async () => (await usageApi(page)).filter((x) => x.kind === 'LABELS').length).toBe(labelUse0 + 4)
      expect((await billingStatus(page)).balances.LABELS).toBe(labels0 - 4)

      // 다시 출력 → 새 작업 → 1장 더
      const winner = (await scopeLabels(page, ordersBroadcast.date)).find((l) => l.winner && l.no === 15)!
      const re = await sendJson(page, 'POST', '/api/print/labels/reprint', { requestId: crypto.randomUUID(), b: ordersBroadcast.id, claim: winner.claim })
      expect(re.status, JSON.stringify(re.body)).toBeLessThan(300)
      await waitPrinted(page, 5)
      await expect.poll(async () => (await usageApi(page)).filter((x) => x.kind === 'LABELS').length).toBe(labelUse0 + 5)

      // 정액제로 시작한 실제 방송의 상품 라벨은 세지 않는다
      expect((await billingStatus(page)).start).toMatchObject({ allowed: true, mode: 'FLAT' })
      const date = uniqueDate()
      // 라벨 화면을 떠나면(전체 새로 고침) 시험용 프린터 연결이 끊기므로 API로 만든다
      const made = await sendJson(page, 'POST', '/api/broadcasts', { requestId: crypto.randomUUID(), date, title: '정액방송' })
      expect(made.status, JSON.stringify(made.body)).toBe(200)
      expect(made.body['billing']).toEqual({ mode: 'FLAT', usedDay: false })
      const b = (made.body['broadcast'] as { id: string }).id
      await registerApi(page, b, 31, '정액상품', 3000)
      await smsApi(page, { b, no: 31, phone: '010-2222-0031' })
      await waitPrinted(page, 6)
      expect((await usageApi(page)).filter((x) => x.kind === 'LABELS').length).toBe(labelUse0 + 5)
      expect((await billingStatus(page)).balances.LABELS).toBe(labels0 - 5)

      // 쓴 내역 화면: "라벨 1장 · <방송> 15번"
      await page.goto('/billing')
      const rows = page.getByRole('table', { name: '쓴 내역' }).getByRole('row').filter({ hasText: '라벨 1장' })
      await expect(rows).toHaveCount(labelUse0 + 5)
      await expect(rows.first().getByRole('cell')).toHaveText([/\d+\/\d+ \d{2}:\d{2}/, '라벨 1장', ordersBroadcast.title, '15번', ''])
    } finally {
      await cleanupPrint(page)
    }
  })

  test('TE-N5 초과 중에 산 주문 건권은 바로 쓴 것 — 잔량은 초과를 뺀 값, "환불" 없음, 초과 띠 사라짐 (AC-N5-52·54, BL-3 3·BL-9 5)', async ({ page }) => {
    await login(page)
    await ensureBusiness(page)
    const orders0 = (await billingStatus(page)).balances.ORDERS
    expect(orders0, '전제: 주문 건권 초과 중').toBeLessThan(0)
    await openBilling(page)
    await buy(page, '주문 건권 100건', '결제 완료(카드)')
    await expect(payResult(page).getByRole('status')).toHaveText('결제했어요. 주문 건권 100건을 받았어요.')
    await expect(statusCell(page, '주문 건권')).toHaveText(`남은 ${String(100 + orders0)}건`)
    await expect(page.getByRole('region', { name: '요금 알림' }).getByRole('listitem').filter({ hasText: '주문 건권' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '주문 건권 100건 환불' })).toHaveCount(0)
    expect((await paymentsApi(page)).find((x) => x.itemName === '주문 건권 100건')?.refundable).toBe(false)
  })

  test('TE-N5 정액제 연장분(아직 시작 전 기간)은 7일 안 환불 가능 → 환불하면 "…까지"가 앞 이용권 끝으로 돌아가고 3일 남은 띠가 다시 보인다 (AC-N5-36·51·57, BL-2·BL-7)', async ({ page }) => {
    await login(page)
    await ensureBusiness(page)
    const s = (await billingStatus(page)) as unknown as { flat: { active: boolean; until: string; chain: { from: string; until: string }[] } }
    expect(s.flat.active).toBe(true)
    expect(s.flat.chain.length, '전제: 운영자 정액 + 결제한 연장 정액(billing.spec.ts)').toBe(2)
    const first = s.flat.chain[0]!
    await openBilling(page)
    // 연장분 기간 [앞 끝, 앞 끝 + 30일)에는 아직 시작한 방송이 없다 → 쓰지 않은 것
    await page.getByRole('button', { name: '정액제 30일 환불' }).click()
    const dlg = page.getByRole('dialog', { name: '환불할까요?' })
    await expect(dlg).toContainText("'정액제 30일' 결제(30,000원)를 취소하고 이용권을 거둬요. 되돌릴 수 없어요.")
    await dlg.getByRole('button', { name: '환불' }).click()
    await expect(page.getByRole('region', { name: '결제 내역' }).getByRole('status')).toHaveText('환불했어요. 결제 수단으로 돌려드려요.')
    const until1 = kst(Date.parse(first.until))
    await expect(statusCell(page, '정액제')).toHaveText(`이용 중 · ${until1}까지`)
    await expect(page.getByRole('region', { name: '요금 알림' }).getByRole('listitem').filter({ hasText: '정액제' })).toHaveText(`정액제가 3일 남았어요 (${until1}까지). 미리 연장하면 남은 기간 뒤에 30일이 이어져요.`)
  })

  test('TE-N5 결제 내역 더 보기: 빠짐·겹침 없이 끝까지, 더 본 뒤 요금 알림으로 첫 장을 새로 받아도 줄이 빠지거나 겹치지 않는다 (AC-N5-14·54)', async ({ page }) => {
    await login(page)
    await ensureBusiness(page)
    let total = (await paymentsApi(page)).length
    while (total < 60) {
      await createOrder(page, 'labels-100')
      total += 1
    }
    await openBilling(page)
    const table = page.getByRole('table', { name: '결제 내역' })
    const rows = table.locator('tbody tr')
    await expect(rows).toHaveCount(50)
    await page.getByRole('button', { name: '결제 내역 더 보기' }).click()
    await expect(rows).toHaveCount(total)
    await expect(page.getByRole('button', { name: '결제 내역 더 보기' })).toHaveCount(0)
    // 다른 기기(운영자)가 이용권을 준다 → 요금 알림 → 첫 장을 새로 받는다 → 한 줄 늘고 나머지는 그대로
    await testGrant(page, { kind: 'LABELS', quantity: 3, reason: '보상' })
    await expect(table.getByRole('row').filter({ hasText: '운영자가 준 이용권 · 보상' })).toHaveCount(1)
    await expect(rows).toHaveCount(total + 1)
    const ids = await rows.evaluateAll((trs) => trs.map((tr) => tr.textContent ?? ''))
    expect(ids).toHaveLength(total + 1)
  })

  test('TE-N5 요금 알림이 있어도 문자찜 입력·구매자·정산·라벨 화면에는 띠·문장이 없고 요금 상태를 부르지 않는다 (AC-N5-57)', async ({ page }) => {
    await login(page)
    const s = await billingStatus(page)
    expect(s.banners.length, '전제: 요금 알림 띠가 있다').toBeGreaterThan(0)
    const billingCalls: string[] = []
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/billing')) billingCalls.push(r.url())
    })
    for (const [path, heading] of [['/sms', '문자찜 입력'], ['/buyers', '구매자'], ['/settlements', '정산'], ['/labels', '라벨']] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      await expect(page.getByRole('region', { name: '요금 알림' })).toHaveCount(0)
      await expect(page.getByText(/이용권|정액제가|주문 건권을|라벨 장권을/)).toHaveCount(0)
    }
    expect(billingCalls).toEqual([])
  })
})
