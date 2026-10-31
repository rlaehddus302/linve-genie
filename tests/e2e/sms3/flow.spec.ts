// AC-SMS3-34 흐름 (+ AC-SMS3-10·14·16·17·19·20·30·32의 화면 몫) — 가짜 기기(받기 토큰으로 POST /api/inbox/messages)로
// 방송 시작 → 손님 문자 → 보드 문자찜 → 확인 필요 카드 넣기 → 취소 요청 승인 → 은행 대표번호 입금 알림 → 정산 "입금 완료"(자동 확인)
// → 믿지 않는 번호 입금 알림 → 입금 확인 목록에 확인 필요. PC와 375px 휴대폰 화면이 같은 결과(새 판매자 각각).
// 기대값: acceptance.md AC-SMS3-*, SPEC ORD-13 "화면 문구", DEPOSIT_RULES DP-6(메모)·DP-8(사유 문장·원천 이름).
import { test, expect } from '@playwright/test'
import {
  boardItem,
  buyerByDisplay,
  claimsOf,
  depositOne,
  depositRow,
  deposits,
  expectNoDevWords,
  fakeDevice,
  heightOf,
  history,
  inboxCard,
  inboxPanel,
  kstToday,
  makeTokenOnScreen,
  onSale,
  openConsole,
  phoneNo,
  realBroadcast,
  scopeView,
  sellerAt,
  won,
  type Width,
} from './support.ts'

for (const width of ['PC', '375'] as const satisfies readonly Width[]) {
  test(`AC-SMS3-34 흐름 (${width}): 문자찜 바로 넣기 → 확인 카드 넣기 → 취소 승인 → 은행 알림 자동 확인 → 믿지 않는 곳 확인 필요`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000)
    const { page, context } = await sellerAt(browser, baseURL!, width)
    const token = await makeTokenOnScreen(page)
    const date = kstToday()
    const b = await realBroadcast(page)
    await onSale(page, b, 15, '핑크프릴', 10_000)
    await onSale(page, b, 16, '라울', 6_000)
    await openConsole(page, b)
    // 카드가 없으면 칸을 접는다 (AC-SMS3-30)
    await expect(inboxPanel(page)).toHaveCount(0)
    const device = await fakeDevice(baseURL!, token)
    const A = phoneNo('5678')
    const B = phoneNo('1111')

    // 1. 손님 문자 "15 16 홍길동" → 보드에 15·16번 문자찜(홍길동), "문자로 받음" (AC-SMS3-14·30)
    await device.sms(A, '15 16 홍길동')
    await expect(boardItem(page, 15)).toContainText('문자찜(홍길동)')
    await expect(boardItem(page, 16)).toContainText('문자찜(홍길동)')
    // TE-SMS3-001: 바로 넣은 문자찜의 "문자로 받음" (AC-SMS3-30) — 뒤 흐름도 보도록 soft
    await expect.soft(boardItem(page, 15), 'TE-SMS3-001 바로 넣은 문자찜에 "문자로 받음" 표시 (AC-SMS3-30)').toContainText('문자로 받음')
    await expect.soft(boardItem(page, 16), 'TE-SMS3-001').toContainText('문자로 받음')
    // 엔진 기록: sms 두 개, 메모 홍길동, 본문·번호 원문 없음 (AC-SMS3-14)
    const sms = (await history(page, date, false)).filter((e) => e.type === 'sms')
    expect(sms.map((e) => e.fields['no']).sort()).toEqual([15, 16])
    expect(sms.every((e) => e.fields['memo'] === '홍길동')).toBe(true)
    const dump = JSON.stringify(sms)
    expect(dump).not.toContain('15 16 홍길동')
    expect(dump).not.toContain(A)
    expect(dump).not.toContain(A.replaceAll('-', ''))

    // 2. 다른 손님 "15 있나요?" → 확인 필요 카드(UNCLEAR, 후보 15) → 넣기 → 15번 문자찜(그 번호, 메모 없음) (AC-SMS3-17·30)
    await device.sms(B, '15 있나요?')
    const ask = inboxCard(page, '15 있나요?')
    await expect(ask).toBeVisible()
    await expect(inboxPanel(page).getByRole('heading', { name: /문자 확인/ })).toBeVisible()
    await expect(ask).toContainText('확인 필요')
    await expect(ask).toContainText('뒤 4자리 1111')
    await expect(ask).toContainText('번호는 있는데 확실하지 않아요')
    await expect(ask).toContainText(/\d{1,2}:\d{2}/)
    // UX-SMS3-009: 후보 번호가 하나면 알약 없이 "15번에 넣기"만
    await expect(ask.getByRole('button', { name: '15번', exact: true })).toHaveCount(0)
    const pick = ask.getByRole('button', { name: '15번에 넣기' })
    await expect(pick).toBeVisible()
    if (width === '375') {
      // 375px 폭에서 단추 높이 48px 이상 (AC-SMS3-30)
      expect(await heightOf(pick), '넣기 단추 높이').toBeGreaterThanOrEqual(48)
      expect(await heightOf(ask.getByRole('button', { name: '무시' })), '무시 단추 높이').toBeGreaterThanOrEqual(48)
    }
    await expectNoDevWords(inboxPanel(page), '문자 확인 칸')
    await pick.click()
    await expect(ask).toHaveCount(0)
    await expect(inboxPanel(page)).toHaveCount(0)
    await expect.poll(async () => (await claimsOf(page, date, 15)).length).toBe(2)
    const view = await scopeView(page, date, false)
    const bBuyer = view.buyers.find((x) => x.phoneLast4 === '1111')
    expect(bBuyer, '카드에서 넣은 문자찜의 구매자(뒤 4자리 1111)').toBeDefined()
    expect(bBuyer!.display, '메모 없음 (AC-SMS3-17)').not.toContain('홍길동')

    // 3. "15 취소" → 찜은 그대로, 취소 요청 카드 → 승인 → 홍길동의 15번 찜 취소 (AC-SMS3-16)
    await device.sms(A, '15 취소')
    const cancel = inboxCard(page, '15 취소')
    await expect(cancel).toBeVisible()
    await expect(cancel).toContainText('취소 요청')
    await expect(cancel).toContainText('15번 취소를 원해요')
    await expect(cancel).toContainText('뒤 4자리 5678')
    await expect(boardItem(page, 15)).toContainText('문자찜(홍길동)')
    const hong = await buyerByDisplay(page, date, '문자찜(홍길동)')
    expect(hong).toBeDefined()
    const hongId = hong!.current ?? hong!.id
    expect((await claimsOf(page, date, 15)).find((c) => c.currentBuyer === hongId)?.status).toBe('CONFIRMED')
    await expectNoDevWords(inboxPanel(page), '취소 요청 카드')
    // UX-SMS3-006: 승인 → 확인 창. "그대로 두기"면 취소되지 않고, "찜 취소하기"를 눌러야 취소된다
    await cancel.getByRole('button', { name: '승인' }).click()
    const sure = page.getByRole('dialog', { name: '찜을 취소할까요?' })
    await expect(sure).toContainText('문자찜(홍길동)')
    await sure.getByRole('button', { name: '그대로 두기' }).click()
    await expect(sure).toHaveCount(0)
    await expect(cancel).toBeVisible()
    expect((await claimsOf(page, date, 15)).find((c) => c.currentBuyer === hongId)?.status).toBe('CONFIRMED')
    await cancel.getByRole('button', { name: '승인' }).click()
    await page.getByRole('dialog', { name: '찜을 취소할까요?' }).getByRole('button', { name: '찜 취소하기' }).click()
    await expect(cancel).toHaveCount(0)
    await expect.poll(async () => (await claimsOf(page, date, 15)).find((c) => c.currentBuyer === hongId)?.status).toBe('CANCELLED')
    await expect(boardItem(page, 15)).not.toContainText('문자찜(홍길동)')
    await expect(boardItem(page, 16)).toContainText('문자찜(홍길동)')

    // 4. 은행 대표번호 입금 알림 → 홍길동 묶음 자동 확인 → 정산 "입금 완료" (AC-SMS3-19, DP-6)
    const settle = (await scopeView(page, date, false)).settlements.find((s) => s.buyer === hongId)!
    const due = settle.total - settle.received
    expect(due).toBeGreaterThan(0)
    // D-DEP2-13: 휴대폰 알림 입금은 같은 은행 앞선 잔액 + 금액 = 잔액일 때만 자동 확인 → 앞에 같은 은행(KB) 출금 알림으로 잔액을 둔다
    const before = await device.send([{ channel: 'SMS', from: '1588-9999', text: '[KB] 출금 5,000 잔액 1,000,000' }])
    expect((before.body['results'] as { status: string }[])[0]?.status, JSON.stringify(before.body)).toBe('SAVED')
    const bank = await device.send([{ channel: 'SMS', from: '1588-9999', text: `[KB] 홍길동 입금 ${due.toLocaleString('en-US')} 잔액 ${(1_000_000 + due).toLocaleString('en-US')}`, receivedAt: new Date(Date.now() + 2_000).toISOString() }])
    expect(bank.status, JSON.stringify(bank.body)).toBe(200)
    expect((bank.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
    await expect.poll(async () => (await scopeView(page, date, false)).settlements.find((s) => s.buyer === hongId)?.payment).toBe('PAID')
    const done = (await deposits(page, 'AUTO_APPLIED', 20)).find((d) => d.amount === due && d.name === '홍길동')
    expect(done, '자동 확인된 휴대폰 알림 입금').toBeDefined()
    expect(done!.source.label).toBe('휴대폰 알림')
    const pays = (await history(page, date, false)).filter((e) => e.type === 'settlement.payment')
    expect(pays.map((e) => e.fields['memo'])).toEqual([`자동 입금 확인 · 입금 #${String(done!.no)}`])
    await page.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(hongId)}`)
    const detail = page.getByRole('region', { name: '정산 자세히' })
    await expect(detail).toContainText('입금 완료')
    await expect(detail).toContainText('자동 입금 확인')
    await page.goto('/deposits?tab=done')
    const doneRow = depositRow(page, done!.no, '자동 확인됨·확인함 입금')
    await expect(doneRow).toContainText('자동 확인됨')
    await expect(doneRow).toContainText('휴대폰 알림')
    await expect(doneRow).toContainText(won(due))

    // 5. 믿지 않는 번호의 입금 알림 → 입금 확인 목록에 확인 필요, DP-8 사유 문장 (AC-SMS3-20·32)
    const bSettle = (await scopeView(page, date, false)).settlements.find((s) => s.buyer === (bBuyer!.current ?? bBuyer!.id))
    const fakeAmount = bSettle === undefined ? 7_000 : bSettle.total - bSettle.received
    const untrusted = await device.send([{ channel: 'SMS', from: '1600-0000', text: `[KB] 김영희 입금 ${fakeAmount.toLocaleString('en-US')}` }])
    expect((untrusted.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
    let reviewNo = 0
    await expect.poll(async () => {
      const found = (await deposits(page, 'REVIEW', 20)).find((d) => d.name === '김영희' && d.amount === fakeAmount)
      reviewNo = found?.no ?? 0
      return found?.review?.reason ?? null
    }).toBe('UNTRUSTED_SOURCE')
    expect((await depositOne(page, reviewNo)).status).toBe('REVIEW')
    await page.goto('/deposits')
    const row = depositRow(page, reviewNo)
    await expect(row).toContainText('은행 앱이나 은행 대표번호가 아닌 곳에서 온 입금 알림이에요. 은행 앱에서 꼭 확인해 주세요')
    await expect(row).toContainText('휴대폰 알림')
    await expectNoDevWords(row, '확인 필요 입금 줄')
    // 다시 열어도 바뀌지 않는다 (ONE_MATCH가 되지 않음)
    await page.reload()
    await expect(depositRow(page, reviewNo)).toContainText('은행 앱이나 은행 대표번호가 아닌 곳에서 온 입금 알림이에요')

    await device.dispose()
    await context.close()
  })
}
