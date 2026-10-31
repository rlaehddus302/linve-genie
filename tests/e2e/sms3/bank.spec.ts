// 입금 확인 화면의 휴대폰 알림 (AC-SMS3-10 (가)·19·23·32, DEPOSIT_RULES DP-8·DP-9 9) — PC와 375px.
// 은행 앱 알림(카카오뱅크) 자동 확인, 은행 대표번호 입금 취소 → "은행 알림" 줄 + 그 입금의 "되돌리기"(누르면 확인 창 — 저절로 되돌리지 않음),
// 읽지 못한 알림 줄, "확인했어요"로 닫기, 믿지 않는 곳의 입금 취소는 아무것도 저장하지 않음.
import { test, expect } from '@playwright/test'
import { depositOne, deposits, expectNoDevWords, fakeDevice, kstToday, makeTokenApi, onSale, phoneNo, realBroadcast, scopeView, sellerAt, won, type Width } from './support.ts'

/** 입금 알림의 받은 시각 — 문자찜보다 확실히 뒤(초 단위로 잘리는 입금 시각이 판매 시각과 같은 초가 되지 않게, DP-4) */
const later = (): string => new Date(Date.now() + 2_000).toISOString()

for (const width of ['PC', '375'] as const satisfies readonly Width[]) {
  test(`AC-SMS3-23·32 은행 알림 줄 (${width}): 앱 알림 자동 확인 → 입금 취소 줄·되돌리기 확인 창 → 읽지 못함 줄 → 확인했어요`, async ({ browser, baseURL }) => {
    test.setTimeout(150_000)
    const { page, context } = await sellerAt(browser, baseURL!, width)
    const token = await makeTokenApi(page)
    const date = kstToday()
    const b = await realBroadcast(page)
    await onSale(page, b, 16, '라울', 6_300)
    const device = await fakeDevice(baseURL!, token)
    await device.sms(phoneNo(), '16 이수진')
    let buyer = ''
    let due = 0
    await expect.poll(async () => {
      const view = await scopeView(page, date, false)
      const x = view.buyers.find((y) => y.display === '문자찜(이수진)')
      buyer = x === undefined ? '' : (x.current ?? x.id)
      const s = view.settlements.find((y) => y.buyer === buyer)
      due = s === undefined ? 0 : s.total - s.received
      return due
    }).toBeGreaterThan(0)

    // (가) 은행 앱 알림(카카오뱅크) → 믿음 → 잔액이 앞 알림과 이어지면 자동 확인 (D-DEP2-13 — 앞에 같은 은행 출금 알림으로 잔액을 둔다)
    const before = await device.send([{ channel: 'APP', from: 'com.kakaobank.channel', title: '출금 5,000원', text: '내 입출금통장(1234) → 김밥천국 잔액 100,000원' }])
    expect((before.body['results'] as { status: string }[])[0]?.status, JSON.stringify(before.body)).toBe('SAVED')
    const app = await device.send([{ channel: 'APP', from: 'com.kakaobank.channel', title: `입금 ${due.toLocaleString('en-US')}원`, text: `이수진 잔액 ${(100_000 + due).toLocaleString('en-US')}원`, receivedAt: later() }])
    expect((app.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
    await expect.poll(async () => (await scopeView(page, date, false)).settlements.find((s) => s.buyer === buyer)?.payment).toBe('PAID')
    const applied = (await deposits(page, 'AUTO_APPLIED', 20)).find((d) => d.name === '이수진' && d.amount === due)
    expect(applied).toBeDefined()

    // 입금 취소 (은행 대표번호) → 은행 알림 줄. 엔진 기록·입금 상태는 그대로
    const cancel = await device.send([{ channel: 'SMS', from: '1588-9999', text: `[KB] 이수진 입금 취소 ${due.toLocaleString('en-US')}원` }])
    expect((cancel.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
    // 믿지 않는 곳의 입금 취소·읽지 못함은 아무것도 저장하지 않는다
    const junk = await device.send([
      { channel: 'SMS', from: '1600-0000', text: `[KB] 이수진 입금 취소 ${due.toLocaleString('en-US')}원` },
      { channel: 'SMS', from: '1600-0000', text: '[KB] 입금 내역을 확인하세요' },
    ])
    expect((junk.body['results'] as { status: string }[]).map((r) => r.status)).toEqual(['IGNORED', 'IGNORED'])
    await page.goto('/deposits')
    const notices = page.getByRole('region', { name: '은행 알림' })
    await expect(notices).toBeVisible()
    await expect(notices.getByRole('listitem')).toHaveCount(1)
    const line = notices.getByRole('listitem').first()
    await expect(line).toContainText(`입금 취소 알림이 왔어요: ${won(due)} 이수진. 이 입금을 확인했다면 되돌려 주세요`)
    await expect(line).toContainText('KB국민')
    await expectNoDevWords(notices, '은행 알림 줄')
    // 되돌리기 → DP-6 확인 창. 닫으면 그대로(저절로 되돌리지 않음)
    await line.getByRole('button', { name: /되돌리기/ }).click()
    const dlg = page.getByRole('dialog', { name: '입금 확인 되돌리기' })
    await expect(dlg).toBeVisible()
    await expect(dlg).toContainText(won(due))
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    expect((await depositOne(page, applied!.no)).status).toBe('AUTO_APPLIED')
    expect((await scopeView(page, date, false)).settlements.find((s) => s.buyer === buyer)?.payment).toBe('PAID')

    // 읽지 못한 알림 → 줄 (실시간으로 위에 더해진다)
    const unreadable = await device.send([{ channel: 'SMS', from: '1588-9999', text: '[KB] 입금 내역을 확인하세요' }])
    expect((unreadable.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
    await expect(notices.getByRole('listitem')).toHaveCount(2)
    const unread = notices.getByRole('listitem').filter({ hasText: '읽지 못한 은행 알림이에요' })
    await expect(unread).toContainText('읽지 못한 은행 알림이에요. 은행 앱에서 확인하고 필요하면 정산에서 손으로 적어 주세요')
    await expect(unread).toContainText('KB국민')
    await expect(unread).not.toContainText('입금 내역을 확인하세요')
    await expectNoDevWords(notices, '은행 알림 줄 둘')

    // "확인했어요"로 닫는다 → 다시 열어도 없다
    await unread.getByRole('button', { name: '확인했어요' }).click()
    await expect(notices.getByRole('listitem')).toHaveCount(1)
    await notices.getByRole('listitem').first().getByRole('button', { name: '확인했어요' }).click()
    await expect(notices).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('tablist', { name: '입금 확인 목록' })).toBeVisible()
    await expect(page.getByRole('region', { name: '은행 알림' })).toHaveCount(0)
    await device.dispose()
    await context.close()
  })
}

test('AC-SMS3-21 잔액이 이어지지 않으면 확인 필요 "잔액이 앞 알림과 이어지는지 확인하지 못했어요" (PC, D-DEP2-13 문구)', async ({ browser, baseURL }) => {
  const { page, context } = await sellerAt(browser, baseURL!, 'PC')
  const token = await makeTokenApi(page)
  const device = await fakeDevice(baseURL!, token)
  const at = (min: number) => {
    const k = new Date(Date.now() - min * 60_000 + 9 * 3_600_000)
    return { md: `${k.toISOString().slice(5, 7)}/${k.toISOString().slice(8, 10)}`, hm: k.toISOString().slice(11, 16) }
  }
  const a = at(4)
  const c = at(2)
  const first = await device.send([{ channel: 'SMS', from: '15778000', text: `신한${a.md} ${a.hm}\n110-***-123456\n입금 3,000\n잔액 1,014,000\n 박민수` }])
  expect((first.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
  const second = await device.send([{ channel: 'SMS', from: '15778000', text: `신한${c.md} ${c.hm}\n110-***-123456\n입금 14,000\n잔액 1,030,000\n 정하늘` }])
  expect((second.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
  let no = 0
  await expect.poll(async () => {
    const d = (await deposits(page, 'REVIEW', 20)).find((x) => x.name === '정하늘')
    no = d?.no ?? 0
    return d?.review?.reason ?? null
  }).toBe('BALANCE_GAP')
  await page.goto('/deposits')
  const { depositRow } = await import('./support.ts')
  await expect(depositRow(page, no)).toContainText('잔액이 앞 알림과 이어지는지 확인하지 못했어요. 은행 앱에서 확인해 주세요')
  await device.dispose()
  await context.close()
})
