// SMS3 고치기 2라운드 화면 흐름 (test-e2e) — PC와 375px.
// 늦게 온 문자 LATE 카드(D-SMS3-30), 엔진이 받지 않은 REJECTED 카드(D-SMS3-31), 12시간 넘은 방송 알림(D-SMS3-29),
// 잔액 이어짐이 확인되지 않은 첫 입금은 확인 필요(D-DEP2-13), 이름 없는 입금 취소 줄 "이름 모름"(D-DEP2-15),
// 화면에 영어 상태값(LATE·REJECTED·INBOX_OFF 등)이 보이지 않음.
// D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "12시간 넘은 방송 알림 닫기: 보조자 요청은 403, 보조자 화면에 닫기 없음"을 뺐다
// 기대값: SPEC ORD-13 "화면 문구"·받기 상태, DEPOSIT_RULES DP-8·DP-9 9, acceptance.md AC-SMS3-*, 서버 약속 v4. 화면 코드를 보고 정하지 않는다.
import { test, expect, type Page, type Route } from '@playwright/test'
import { sealNow } from '../i3/support.ts'
import {
  boardItem,
  claimsOf,
  depositRow,
  deposits,
  expectNoDevWords,
  fakeDevice,
  inboxCard,
  inboxPanel,
  inboxSection,
  kstToday,
  makeTokenApi,
  onSale,
  openConsole,
  phoneNo,
  realBroadcast,
  scopeView,
  sellerAt,
  won,
  type Width,
} from './support.ts'

const WIDTHS = ['PC', '375'] as const satisfies readonly Width[]

/** 화면의 KST "M월 D일 오전/오후 h:mm:ss" (D-SMS3-34, LATE 문구의 {시각}) */
function kstMonthDayTime(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))
  const part = (t: string): string => parts.find((x) => x.type === t)?.value ?? ''
  const h = Number(part('hour'))
  return `${String(Number(part('month')))}월 ${String(Number(part('day')))}일 ${h < 12 ? '오전' : '오후'} ${String(h % 12 === 0 ? 12 : h % 12)}:${part('minute')}:${part('second')}`
}

const STALE_TEXT = '끝내지 않은 방송이 12시간 넘게 이어져 손님 문자를 넣지 않았어요. 방송을 끝내 주세요.'

for (const width of WIDTHS) {
  test(`D-SMS3-30 늦게 온 문자 (${width}): 바로 넣지 않고 확인 카드 — 휴대폰이 받은 시각이 보이고, 넣으면 서버에 온 순서(앞서 온 찜 뒤)로`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000)
    const { page, context } = await sellerAt(browser, baseURL!, width)
    const token = await makeTokenApi(page)
    const date = kstToday()
    const b = await realBroadcast(page)
    await onSale(page, b, 15, '핑크프릴', 10_000)
    await openConsole(page, b)
    const device = await fakeDevice(baseURL!, token)

    // 1. 제때 온 문자 → 바로 15번 문자찜(김민지)
    await device.sms(phoneNo('1111'), '15 김민지')
    await expect(boardItem(page, 15)).toContainText('문자찜(김민지)')

    // 2. 휴대폰이 15분 전에 받았지만 이제야 온 문자 → 바로 넣지 않는다 (서버 도착보다 10분 넘게 이름)
    const phoneAt = Math.floor((Date.now() - 15 * 60_000) / 1000) * 1000
    const late = await device.send([{ channel: 'SMS', from: phoneNo('2222'), text: '15 박서준', receivedAt: new Date(phoneAt).toISOString() }])
    expect(late.status, JSON.stringify(late.body)).toBe(200)
    expect((late.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
    const card = inboxCard(page, '15 박서준')
    await expect(card).toBeVisible()
    await expect(card).toContainText(`늦게 온 문자예요 (휴대폰이 ${kstMonthDayTime(phoneAt)}에 받음). 넣으면 지금 받은 순서로 들어가요`)
    await expect(card).toContainText('뒤 4자리 2222')
    expect((await claimsOf(page, date, 15)).length, '늦게 온 문자는 바로 넣지 않는다').toBe(1)
    await expectNoDevWords(inboxPanel(page), '늦게 온 문자 카드')

    // 3. 넣기 → 15번 찜 둘. 받은 시각 = 서버 도착이라 먼저 온 김민지가 그대로 앞(휴대폰 시각이면 박서준이 앞이 된다)
    const pick = card.getByRole('button', { name: '15번', exact: true })
    if (await pick.count() > 0 && (await pick.getAttribute('aria-pressed')) !== 'true') await pick.click()
    await card.getByRole('button', { name: /넣기$/ }).click()
    await expect(card).toHaveCount(0)
    await expect.poll(async () => (await claimsOf(page, date, 15)).length).toBe(2)
    const view = await scopeView(page, date, false)
    const kim = view.buyers.find((x) => x.phoneLast4 === '1111')
    const park = view.buyers.find((x) => x.phoneLast4 === '2222')
    expect(kim, '김민지 구매자').toBeDefined()
    expect(park, '박서준 구매자').toBeDefined()
    const ids = (x: { id: string; current: string }) => [x.id, x.current]
    const product = view.products.find((p) => p.no === 15)!
    const first = product.winners[0] ?? ''
    expect(ids(kim!), `먼저 온 김민지가 15번 첫째여야 한다 — winners ${JSON.stringify(product.winners)}`).toContain(first)
    await expect(boardItem(page, 15)).toContainText('문자찜(김민지)')
    await device.dispose()
    await context.close()
  })

  test(`D-SMS3-31 엔진이 받지 않은 문자찜 (${width}): "{번호}번은 바로 넣지 못했어요. 보드에서 확인해 주세요" 카드`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000)
    const { page, context, seller } = await sellerAt(browser, baseURL!, width)
    const token = await makeTokenApi(page)
    const date = kstToday()
    const b = await realBroadcast(page)
    await onSale(page, b, 15, '핑크프릴', 10_000)
    // 엔진이 받지 않는 상태를 만든다 — 그 날짜 범위 봉인(SEALED). 시험 조종 주소로만 만들 수 있는 거절이다
    await sealNow(page.request, seller.loginId, date)
    await openConsole(page, b)
    const device = await fakeDevice(baseURL!, token)
    const res = await device.send([{ channel: 'SMS', from: phoneNo('3333'), text: '15 김민지' }])
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect((res.body['results'] as { status: string }[])[0]?.status, '거절 카드를 만들었으면 받은 것으로 적는다').toBe('SAVED')
    expect(await claimsOf(page, date, 15)).toHaveLength(0)
    // 카드는 서버에 있다 (콘솔이 보일 것)
    const cards = await page.request.get(`/api/inbox/cards?b=${encodeURIComponent(b)}`)
    expect(cards.ok(), await cards.text()).toBe(true)
    const list = ((await cards.json()) as { cards: { why: string | null; message?: string; numbers: number[] }[] }).cards
    expect(list.map((c) => c.why), JSON.stringify(list)).toContain('REJECTED')
    // 판매자가 볼 수 있어야 한다 — 콘솔 "문자 확인" 칸
    const card = inboxCard(page, '15 김민지')
    await expect(card, '거절 카드가 콘솔에 보여야 한다(보드에서 확인하라는 안내)').toBeVisible()
    await expect(card).toContainText('15번은 바로 넣지 못했어요. 보드에서 확인해 주세요')
    await expectNoDevWords(inboxPanel(page), '거절 카드')
    // UX-SMS3-011: 보관만 하는(봉인) 콘솔도 카드는 보이고, 넣기·승인 단추 없이 "무시"만 있다
    await expect(card.getByRole('button', { name: /넣기/ })).toHaveCount(0)
    await expect(card.getByRole('button', { name: '승인' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: '무시' })).toBeVisible()
    await device.dispose()
    await context.close()
  })

  test(`D-DEP2-13 잔액 이어짐 (${width}): 은행의 첫 입금은 맞는 금액이어도 확인 필요 → 그 잔액에서 이어지는 다음 입금은 자동 확인`, async ({ browser, baseURL }) => {
    test.setTimeout(150_000)
    const { page, context } = await sellerAt(browser, baseURL!, width)
    const token = await makeTokenApi(page)
    const date = kstToday()
    const b = await realBroadcast(page)
    await onSale(page, b, 15, '핑크프릴', 10_000)
    await onSale(page, b, 16, '라울', 6_300)
    const device = await fakeDevice(baseURL!, token)
    await device.sms(phoneNo(), '16 이수진')
    await device.sms(phoneNo(), '15 박서준')
    const dueOf = async (display: string): Promise<{ buyer: string; due: number }> => {
      let buyer = ''
      let due = 0
      await expect.poll(async () => {
        const view = await scopeView(page, date, false)
        const x = view.buyers.find((y) => y.display === display)
        buyer = x === undefined ? '' : (x.current ?? x.id)
        const s = view.settlements.find((y) => y.buyer === buyer)
        due = s === undefined ? 0 : s.total - s.received
        return due
      }).toBeGreaterThan(0)
      return { buyer, due }
    }
    const lee = await dueOf('문자찜(이수진)')
    const park = await dueOf('문자찜(박서준)')
    const start = 1_000_000
    const at = () => new Date(Date.now() + 2_000).toISOString()

    // 1. KB 첫 입금 (앞선 잔액 없음) — 금액·이름이 딱 맞아도 확인 필요
    const first = await device.send([{ channel: 'SMS', from: '1588-9999', text: `[KB] 이수진 입금 ${lee.due.toLocaleString('en-US')} 잔액 ${(start + lee.due).toLocaleString('en-US')}`, receivedAt: at() }])
    expect((first.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
    let no = 0
    await expect.poll(async () => {
      const d = (await deposits(page, 'REVIEW', 20)).find((x) => x.name === '이수진' && x.amount === lee.due)
      no = d?.no ?? 0
      return d?.review?.reason ?? null
    }).toBe('BALANCE_GAP')
    expect((await scopeView(page, date, false)).settlements.find((s) => s.buyer === lee.buyer)?.payment, '확인 필요 입금은 정산에 적지 않는다').not.toBe('PAID')
    await page.goto('/deposits')
    const row = depositRow(page, no)
    await expect(row).toContainText('잔액이 앞 알림과 이어지는지 확인하지 못했어요. 은행 앱에서 확인해 주세요')
    await expect(row).toContainText('휴대폰 알림')
    await expectNoDevWords(row, '잔액 확인 필요 입금 줄')

    // 2. 확인 필요로 저장된 입금의 잔액도 다음 비교의 앞선 잔액 → 이어지는 다음 입금은 자동 확인
    const second = await device.send([{ channel: 'SMS', from: '1588-9999', text: `[KB] 박서준 입금 ${park.due.toLocaleString('en-US')} 잔액 ${(start + lee.due + park.due).toLocaleString('en-US')}`, receivedAt: at() }])
    expect((second.body['results'] as { status: string }[])[0]?.status).toBe('SAVED')
    await expect.poll(async () => (await scopeView(page, date, false)).settlements.find((s) => s.buyer === park.buyer)?.payment).toBe('PAID')
    // 첫 입금은 다시 계산되지 않고 그대로 확인 필요
    await expect.poll(async () => (await deposits(page, 'REVIEW', 20)).find((x) => x.no === no)?.review?.reason ?? null).toBe('BALANCE_GAP')
    await device.dispose()
    await context.close()
  })

  test(`D-DEP2-15 이름 없는 입금 취소 알림 (${width}): 은행 알림 줄 "입금 취소 알림이 왔어요: {금액} 이름 모름…"`, async ({ browser, baseURL }) => {
    const { page, context } = await sellerAt(browser, baseURL!, width)
    const token = await makeTokenApi(page)
    const device = await fakeDevice(baseURL!, token)
    const res = await device.send([{ channel: 'SMS', from: '1588-9999', text: '[KB] 입금취소 14,000원' }])
    expect((res.body['results'] as { status: string }[])[0]?.status, JSON.stringify(res.body)).toBe('SAVED')
    await page.goto('/deposits')
    const notices = page.getByRole('region', { name: '은행 알림' })
    await expect(notices.getByRole('listitem')).toHaveCount(1)
    const line = notices.getByRole('listitem').first()
    await expect(line).toContainText(`입금 취소 알림이 왔어요: ${won(14_000)} 이름 모름. 이 입금을 확인했다면 되돌려 주세요`)
    await expect(line).toContainText('KB국민')
    await expectNoDevWords(notices, '이름 없는 입금 취소 줄')
    await device.dispose()
    await context.close()
  })
}

/**
 * 12시간 넘은 방송 알림 (D-SMS3-29) — 실제로 12시간 지난 방송은 E2E 서버에서 만들 수 없다(방송 시작 시각을 옮기는 시험 조종 주소·시계 조종이 없다).
 * 그래서 서버 약속 v4의 응답(GET cards·settings의 staleBroadcast)만 바꿔 보내 화면을 본다. 닫기 요청(POST /api/inbox/stale/close)은 실제 서버로 간다.
 */
async function fakeStale(page: Page, b: string): Promise<{ closed: () => boolean }> {
  let closed = false
  const notice = { b, startedAt: new Date(Date.now() - 13 * 3_600_000).toISOString(), lastAt: new Date().toISOString(), count: 3, message: STALE_TEXT }
  const inject = async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch()
    const body = (await res.json()) as Record<string, unknown>
    if ('inbox' in body && typeof body['inbox'] === 'object' && body['inbox'] !== null) (body['inbox'] as Record<string, unknown>)['staleBroadcast'] = closed ? null : notice
    else body['staleBroadcast'] = closed ? null : notice
    await route.fulfill({ response: res, json: body })
  }
  await page.route(/\/api\/inbox\/cards(\?|$)/, inject)
  await page.route(/\/api\/inbox\/settings(\?|$)/, inject)
  await page.route(/\/api\/inbox\/stale\/close$/, async (route) => {
    closed = true
    await route.fallback()
  })
  return { closed: () => closed }
}

for (const width of WIDTHS) {
  test(`D-SMS3-29 12시간 넘은 방송 알림 (${width}): 콘솔 위·설정 받기 상태에 문구, 판매자가 닫으면 사라짐`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000)
    const { page, context } = await sellerAt(browser, baseURL!, width)
    await makeTokenApi(page)
    const b = await realBroadcast(page)
    const fake = await fakeStale(page, b)

    // 설정 받기 상태
    await page.goto('/settings/inbox')
    const section = inboxSection(page)
    await expect(section).toContainText(STALE_TEXT)
    await expectNoDevWords(section, '설정 12시간 알림')

    // 콘솔 위
    await openConsole(page, b)
    const bar = page.getByRole('alert').filter({ hasText: STALE_TEXT })
    await expect(bar).toBeVisible()
    await expectNoDevWords(bar, '콘솔 12시간 알림')
    const close = bar.getByRole('button', { name: '닫기' })
    await expect(close).toBeVisible()
    if (width === '375') expect((await close.boundingBox())!.height, '닫기 단추 높이').toBeGreaterThanOrEqual(44)
    await close.click()
    await expect(page.getByText(STALE_TEXT)).toHaveCount(0)
    expect(fake.closed(), '닫기는 서버에 적는다').toBe(true)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await context.close()
  })
}
