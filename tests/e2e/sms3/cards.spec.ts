// 콘솔 "문자 확인" 칸 깨뜨리기 (AC-SMS3-15·16·17·30, ORD-13 화면 문구) — 이름만 온 문자, 판매 중 아님, 찜 없는 취소 승인,
// 이스케이프, 리허설만(받지 않음), 같은 id 다시, 두 기기(PC + 375) 동시 처리.
import { test, expect } from '@playwright/test'
import {
  boardItem,
  claimsOf,
  expectNoDevWords,
  fakeDevice,
  history,
  inboxCard,
  inboxPanel,
  kstToday,
  makeTokenApi,
  onSale,
  openConsole,
  phoneNo,
  postJson,
  realBroadcast,
  sameSellerAt,
  scopeView,
  sellerAt,
} from './support.ts'

test.describe('문자 확인 칸', () => {
  test('AC-SMS3-17 이름만 온 문자: "이름만 와서 누가 보냈는지 몰라요" → 넣으면 메모 = 보낸 이름인 새 문자 구매자(번호 없음) (375)', async ({ browser, baseURL }) => {
    const { page, context } = await sellerAt(browser, baseURL!, '375')
    const token = await makeTokenApi(page)
    const date = kstToday()
    const b = await realBroadcast(page)
    await onSale(page, b, 15, '핑크프릴', 10_000)
    await openConsole(page, b)
    const device = await fakeDevice(baseURL!, token)
    await device.sms('김영희', '15')
    const card = inboxCard(page, '15')
    await expect(card).toBeVisible()
    await expect(card).toContainText('이름만 와서 누가 보냈는지 몰라요')
    await expect(card).toContainText('김영희')
    await expect(card).not.toContainText('뒤 4자리')
    await expectNoDevWords(inboxPanel(page), '이름만 온 문자 카드')
    // UX-SMS3-004: 이름만 온 카드는 연락처 이름과 "전화번호는 오지 않았어요", 넣으면 들어갈 이름을 보여 준다
    await expect(card).toContainText('연락처 이름: 김영희 (전화번호는 오지 않았어요)')
    await expect(card).toContainText("넣으면 '문자찜(김영희)'으로 들어가요")
    // UX-SMS3-009: 후보 번호가 하나면 알약 없이 "15번에 넣기"만
    await expect(card.getByRole('button', { name: '15번', exact: true })).toHaveCount(0)
    await card.getByRole('button', { name: '15번에 넣기' }).click()
    await expect(inboxPanel(page)).toHaveCount(0)
    await expect(boardItem(page, 15)).toContainText('문자찜(김영희)')
    const view = await scopeView(page, date, false)
    const buyer = view.buyers.find((x) => x.display === '문자찜(김영희)')
    expect(buyer).toBeDefined()
    expect(buyer!.phoneLast4).toBeNull()
    await device.dispose()
    await context.close()
  })

  test('UX-SMS3-005 콘솔 알림 줄 "확인할 문자 n" — 누르면 문자 확인 칸으로 (375)', async ({ browser, baseURL }) => {
    const { page, context } = await sellerAt(browser, baseURL!, '375')
    const token = await makeTokenApi(page)
    const b = await realBroadcast(page)
    await onSale(page, b, 15, '핑크프릴', 10_000)
    await openConsole(page, b)
    const device = await fakeDevice(baseURL!, token)
    await device.sms(phoneNo('1111'), '15 있나요?')
    await device.sms(phoneNo('2222'), '15 되나요?')
    await expect(inboxPanel(page).getByRole('listitem')).toHaveCount(2)
    const lead = page.getByRole('button', { name: '확인할 문자 2' })
    await expect(lead).toBeVisible()
    await lead.click()
    await expect(inboxPanel(page)).toBeInViewport()
    await device.dispose()
    await context.close()
  })

  test('AC-SMS3-15 판매 중이 아니면 넣지 않음: 공개 전 17번 → "17번은 지금 판매 중이 아니에요" 카드, 무시하면 기록 없이 사라짐 (PC)', async ({ browser, baseURL }) => {
    const { page, context } = await sellerAt(browser, baseURL!, 'PC')
    const token = await makeTokenApi(page)
    const date = kstToday()
    const b = await realBroadcast(page)
    const reg = await postJson(page, '/api/events', { requestId: crypto.randomUUID(), type: 'product.register', b, no: 17, name: '블루엘프', price: 5_000, status: 'READY' })
    expect(reg.status).toBeLessThan(300)
    await openConsole(page, b)
    const device = await fakeDevice(baseURL!, token)
    const before = (await history(page, date, false)).length
    await device.sms(phoneNo(), '17 홍길동')
    const card = inboxCard(page, '17 홍길동')
    await expect(card).toBeVisible()
    await expect(card).toContainText('17번은 지금 판매 중이 아니에요')
    expect(await claimsOf(page, date, 17)).toHaveLength(0)
    await card.getByRole('button', { name: '무시' }).click()
    await expect(inboxPanel(page)).toHaveCount(0)
    expect((await history(page, date, false)).length, '무시는 엔진 기록이 없다').toBe(before)
    // 다시 열어도 돌아오지 않는다
    await page.reload()
    await expect(page.getByRole('region', { name: '상품 보드' })).toBeVisible()
    await expect(inboxPanel(page)).toHaveCount(0)
    await device.dispose()
    await context.close()
  })

  test('AC-SMS3-16 찜이 없는데 승인 → "취소할 찜이 없어요", 엔진 기록 없음, 카드는 남고 무시로 닫힘 (PC)', async ({ browser, baseURL }) => {
    const { page, context } = await sellerAt(browser, baseURL!, 'PC')
    const token = await makeTokenApi(page)
    const date = kstToday()
    const b = await realBroadcast(page)
    await onSale(page, b, 15, '핑크프릴', 10_000)
    await openConsole(page, b)
    const device = await fakeDevice(baseURL!, token)
    const before = (await history(page, date, false)).length
    await device.sms(phoneNo(), '15 취소')
    const card = inboxCard(page, '15 취소')
    await expect(card).toContainText('15번 취소를 원해요')
    await card.getByRole('button', { name: '승인' }).click()
    // UX-SMS3-006: 승인은 확인 창을 거친다 — "그대로 두기"면 아무 일도 없고, "찜 취소하기"를 눌러야 보낸다
    const ask = page.getByRole('dialog', { name: '찜을 취소할까요?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: '그대로 두기' }).click()
    await expect(ask).toHaveCount(0)
    await expect(card).not.toContainText('취소할 찜이 없어요')
    expect((await history(page, date, false)).length).toBe(before)
    await card.getByRole('button', { name: '승인' }).click()
    await page.getByRole('dialog', { name: '찜을 취소할까요?' }).getByRole('button', { name: '찜 취소하기' }).click()
    await expect(card).toContainText('취소할 찜이 없어요')
    await expect(card).toBeVisible()
    expect((await history(page, date, false)).length).toBe(before)
    await card.getByRole('button', { name: '무시' }).click()
    await expect(inboxPanel(page)).toHaveCount(0)
    await device.dispose()
    await context.close()
  })

  test('이스케이프: 본문·연락처 이름의 HTML은 글 그대로, 스크립트가 돌지 않는다 (PC)', async ({ browser, baseURL }) => {
    const { page, context } = await sellerAt(browser, baseURL!, 'PC')
    const token = await makeTokenApi(page)
    const b = await realBroadcast(page)
    await onSale(page, b, 15, '핑크프릴', 10_000)
    await openConsole(page, b)
    const device = await fakeDevice(baseURL!, token)
    const evil = '<img src=x onerror="window.__xss=1">'
    await device.sms(phoneNo('4321'), `15 있나요? ${evil}`)
    await device.sms(`홍길동${evil}`, '15')
    await expect(inboxPanel(page).getByRole('listitem')).toHaveCount(2)
    await expect(inboxPanel(page)).toContainText(evil)
    await expect(inboxPanel(page).locator('img')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
    await device.dispose()
    await context.close()
  })

  test('AC-SMS3-13 리허설만 진행 중이면 손님 문자는 받지 않는다 (IGNORED, 카드·찜 없음)', async ({ browser, baseURL }) => {
    const { page, context } = await sellerAt(browser, baseURL!, 'PC')
    const token = await makeTokenApi(page)
    const date = kstToday()
    const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date, rehearsal: true, title: '리허설' })
    expect(res.status).toBeLessThan(300)
    const device = await fakeDevice(baseURL!, token)
    await device.sms(phoneNo(), '15 홍길동', 'IGNORED')
    await device.sms(phoneNo(), '15 있나요?', 'IGNORED')
    await device.dispose()
    await context.close()
  })

  test('AC-SMS3-12 같은 id를 다시 보내면 DUPLICATE, 찜이 늘지 않는다 · AC-SMS3-10 (바) 휴대폰 번호의 은행 글은 찜·입금 아님', async ({ browser, baseURL }) => {
    const { page, context } = await sellerAt(browser, baseURL!, 'PC')
    const token = await makeTokenApi(page)
    const date = kstToday()
    const b = await realBroadcast(page)
    await onSale(page, b, 15, '핑크프릴', 10_000)
    const device = await fakeDevice(baseURL!, token)
    const from = phoneNo()
    const first = await device.send([{ id: 'same-a1', channel: 'SMS', from, text: '15' }])
    expect((first.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
    const again = await device.send([{ id: 'same-a1', channel: 'SMS', from, text: '15' }])
    expect((again.body['results'] as { status: string }[])[0]?.status).toBe('DUPLICATE')
    await expect.poll(async () => (await claimsOf(page, date, 15)).length).toBe(1)
    await device.sms(phoneNo(), '[KB] 홍길동 입금 14,000', 'IGNORED')
    expect(await claimsOf(page, date, 15)).toHaveLength(1)
    const list = await page.request.get('/api/deposits?status=REVIEW,AUTO_APPLIED,APPLIED,IGNORED&limit=50')
    expect(((await list.json()) as { deposits: unknown[] }).deposits).toHaveLength(0)
    await device.dispose()
    await context.close()
  })

  test('두 기기(PC + 375) 같은 카드: 양쪽에 보이고, 한쪽이 넣으면 다른 쪽에서 사라짐 · 동시에 누르면 찜 하나', async ({ browser, baseURL }) => {
    test.setTimeout(150_000)
    const { page: pc, context, seller } = await sellerAt(browser, baseURL!, 'PC')
    const phone = await sameSellerAt(browser, baseURL!, seller, '375')
    const token = await makeTokenApi(pc)
    const date = kstToday()
    const b = await realBroadcast(pc)
    await onSale(pc, b, 15, '핑크프릴', 10_000)
    await onSale(pc, b, 16, '라울', 6_000)
    await openConsole(pc, b)
    await openConsole(phone, b)
    const device = await fakeDevice(baseURL!, token)

    // 한쪽이 넣으면 다른 쪽에서 사라진다
    await device.sms(phoneNo('2468'), '15 있나요?')
    await expect(inboxCard(pc, '15 있나요?')).toBeVisible()
    await expect(inboxCard(phone, '15 있나요?')).toBeVisible()
    await inboxCard(phone, '15 있나요?').getByRole('button', { name: /넣기$/ }).click()
    await expect(inboxCard(phone, '15 있나요?')).toHaveCount(0)
    await expect(inboxCard(pc, '15 있나요?')).toHaveCount(0)
    await expect(boardItem(pc, 15)).toContainText('1등 문자찜')
    expect((await scopeView(pc, date, false)).buyers.some((x) => x.phoneLast4 === '2468')).toBe(true)
    await expect.poll(async () => (await claimsOf(pc, date, 15)).length).toBe(1)

    // 동시에 누르면 찜 하나, 어느 쪽에도 오류 문장이 남지 않는다
    await device.sms(phoneNo('1357'), '16 되나요?')
    const pcCard = inboxCard(pc, '16 되나요?')
    const phoneCard = inboxCard(phone, '16 되나요?')
    await expect(pcCard).toBeVisible()
    await expect(phoneCard).toBeVisible()
    // 먼저 처리된 쪽 때문에 카드가 사라지면 늦은 쪽 누르기는 대상이 없어진다 — 그건 정상(어느 쪽이든 찜은 하나)
    const press = async (card: typeof pcCard): Promise<void> => {
      await card.getByRole('button', { name: /넣기$/ }).click({ timeout: 5_000 }).catch(async (e: unknown) => {
        if ((await card.count()) > 0) throw e
      })
    }
    await Promise.all([press(pcCard), press(phoneCard)])
    await expect(pcCard).toHaveCount(0)
    await expect(phoneCard).toHaveCount(0)
    await expect.poll(async () => (await claimsOf(pc, date, 16)).length).toBe(1)
    await expect(inboxPanel(pc)).toHaveCount(0)
    await expect(inboxPanel(phone)).toHaveCount(0)
    await phone.context().close()
    await device.dispose()
    await context.close()
  })

  test('375 폭: 띄어쓰기 없는 긴 본문 카드도 가로 스크롤 없이, 단추는 화면 안', async ({ browser, baseURL }) => {
    const { page, context } = await sellerAt(browser, baseURL!, '375')
    const token = await makeTokenApi(page)
    const b = await realBroadcast(page)
    await onSale(page, b, 15, '핑크프릴', 10_000)
    await openConsole(page, b)
    const device = await fakeDevice(baseURL!, token)
    const long = `15 있나요? ${'ㅋ'.repeat(400)}https://example.com/${'a'.repeat(300)}`
    await device.sms(phoneNo(), long)
    const card = inboxCard(page, '15 있나요?')
    await expect(card).toBeVisible()
    const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    expect(sizes.scroll, '가로 스크롤').toBeLessThanOrEqual(sizes.client)
    for (const name of [/넣기$/, /^무시$/]) {
      const box = await card.getByRole('button', { name }).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x + box!.width, `${String(name)} 단추가 화면 밖`).toBeLessThanOrEqual(375.5)
    }
    await device.dispose()
    await context.close()
  })
})
