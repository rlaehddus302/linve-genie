// O4 의류 한 흐름 — 리허설 (AC-O4-10~14·16) — test-e2e.
// 기대값 = G-ENG-O4-01(tests/golden/engine/25-o4-integration.yaml). 댓글은 앞 댓글이 반영된 뒤 하나씩 "시청자로 보내기"(D-082)로 보낸다.
// 상품 등록·확인 필요 바로잡기·취소는 화면으로 한다. 지금 상품 댓글은 22 등록 뒤 16초가 지난 다음에 보낸다(D-O4-03).
import { expect, test, type Page } from '@playwright/test'
import {
  boardItem,
  buyerName,
  chat,
  chatPanel,
  createBroadcast,
  login,
  openReviews,
  oscope,
  productOf,
  reviewLine,
  reviewList,
  untilElapsed,
  waitClaims,
  waitReviews,
  type OScope,
} from './support.ts'

function optionDialog(page: Page) {
  return page.getByRole('dialog', { name: '옵션 추가' })
}

/** 템플릿 하나로 항목을 채운다 */
async function pickTemplate(page: Page, name: string) {
  const dlg = optionDialog(page)
  const group = dlg.getByRole('group', { name: '템플릿' })
  if (!(await group.isVisible())) await dlg.getByRole('button', { name: '템플릿에서 고르기' }).click()
  await dlg.getByRole('button', { name, exact: true }).click()
}

/** 화면으로 반바지·반팔티 등록 (AC-O4-10) */
async function registerClothingUi(page: Page): Promise<number> {
  const input = page.getByLabel('빠른 입력')
  await input.fill('21 반바지 10000')
  await page.getByRole('button', { name: '옵션 추가' }).click()
  const dlg = optionDialog(page)
  await pickTemplate(page, '의류 — 사이즈')
  await expect(dlg.getByLabel('항목 1 선택지 4 이름')).toHaveValue('XL')
  await dlg.getByRole('button', { name: '항목 1 선택지 4 빼기' }).click()
  await dlg.getByLabel('항목 1 선택지 2 별칭').fill('엠')
  await dlg.getByLabel('M 재고').fill('1')
  await dlg.getByLabel('L 재고').fill('2')
  await dlg.getByRole('button', { name: '옵션 넣기' }).click()
  await expect(dlg).toHaveCount(0)
  await input.press('Enter')
  await expect(boardItem(page, 21)).toBeVisible()

  await input.fill('22 반팔티 15000')
  await page.getByRole('button', { name: '옵션 추가' }).click()
  await pickTemplate(page, '의류 — 사이즈(숫자)')
  await expect(dlg.getByLabel('항목 1 선택지 4 이름')).toHaveValue('110')
  await dlg.getByRole('button', { name: '항목 1 선택지 4 빼기' }).click()
  await dlg.getByLabel('항목 1 선택지 3 가격 차이').fill('2000')
  await pickTemplate(page, '의류 — 색상')
  await expect(dlg.getByLabel('항목 2 선택지 5 이름')).toHaveValue('베이지')
  for (const n of [5, 4, 3]) await dlg.getByRole('button', { name: `항목 2 선택지 ${String(n)} 빼기` }).click()
  await expect(dlg.getByLabel('항목 2 선택지 1 별칭')).toHaveValue(/화이트/)
  await expect(dlg.getByLabel('항목 2 선택지 2 별칭')).toHaveValue(/검정.*블랙/)
  await dlg.getByLabel('105/검정색 재고').fill('2')
  await dlg.getByRole('button', { name: '옵션 넣기' }).click()
  await expect(dlg).toHaveCount(0)
  await input.press('Enter')
  await expect(boardItem(page, 22)).toBeVisible()
  return Date.now()
}

/** 앞 댓글이 반영된 뒤 다음 댓글 (활성 찜 수·확인 필요 수가 바뀔 때까지) */
async function say(page: Page, b: string, nick: string, text: string, wait: () => Promise<unknown>) {
  await chat(page, b, nick, text)
  await wait()
}

function variantView(s: OScope, p: { variants: { text: string; status: string; remaining: number; winners: string[]; waitlist: string[] }[] }) {
  return Object.fromEntries(p.variants.map((v) => [v.text, { status: v.status, remaining: v.remaining, winners: v.winners.map((id) => buyerName(s, id)), waitlist: v.waitlist.map((id) => buyerName(s, id)) }]))
}

test('AC-O4-10~14·16: 의류 리허설 — 화면 등록 → 이름·번호 댓글의 변형 1등·대기·품절 → 지금 상품 댓글 → 확인 필요 셋 → 변형 취소·승계 → 확인서', async ({ page }) => {
  test.setTimeout(240_000)
  await login(page)
  const { b, date } = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS', title: `의류 리허설 ${crypto.randomUUID().slice(0, 6)}` })
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()

  // ── AC-O4-10 등록 ──
  const registeredAt = await registerClothingUi(page)
  await page.getByRole('button', { name: '변형 펼치기 — 21번' }).click()
  const v21 = page.getByRole('list', { name: '변형 — 21번' }).getByRole('listitem')
  await expect(v21).toHaveCount(3)
  await expect(v21.nth(0)).toContainText(/^S.*남은 1/)
  await expect(v21.nth(1)).toContainText(/^M.*남은 1/)
  await expect(v21.nth(2)).toContainText(/^L.*남은 2/)
  await page.getByRole('button', { name: '변형 펼치기 — 22번' }).click()
  await expect(page.getByRole('list', { name: '변형 — 22번' }).getByRole('listitem')).toHaveCount(6)
  await expect(page.getByRole('region', { name: '지금 상품' })).toContainText('지금 상품: 22번 반팔티')
  const p21 = await productOf(page, date, true, b, 21)
  expect(p21.options.map((o) => [o.name, o.choices.map((c) => [c.label, c.aliases ?? [], c.price ?? 0])])).toEqual([['사이즈', [['S', [], 0], ['M', ['엠'], 0], ['L', [], 0]]]])
  expect(p21.variants.map((v) => [v.text, v.stock])).toEqual([['S', 1], ['M', 1], ['L', 2]])
  const p22 = await productOf(page, date, true, b, 22)
  expect(p22.options.map((o) => [o.name, o.choices.map((c) => [c.label, c.price ?? 0])])).toEqual([
    ['사이즈', [['95', 0], ['100', 0], ['105', 2000]]],
    ['색상', [['흰색', 0], ['검정색', 0]]],
  ])
  expect(Object.fromEntries(p22.variants.map((v) => [v.text, [v.stock, v.price]]))).toEqual({
    '95/흰색': [1, 15000], '95/검정색': [1, 15000], '100/흰색': [1, 15000], '100/검정색': [1, 15000], '105/흰색': [1, 17000], '105/검정색': [2, 17000],
  })

  // ── AC-O4-11 이름·번호 댓글 ──
  await say(page, b, '홍길동', '반바지 M', () => waitClaims(page, date, true, b, 1))
  await say(page, b, '김철수', '21 M', () => waitClaims(page, date, true, b, 2))
  await say(page, b, '박민수', '반팔티 105 검정 2', () => waitClaims(page, date, true, b, 3))
  await chat(page, b, '최지우', '반팔티 105 블랙 2개')
  await expect.poll(async () => (await oscope(page, date, true)).claims.filter((c) => c.broadcast === b).length, { timeout: 15_000 }).toBe(4)
  let s = await oscope(page, date, true)
  const byName = (name: string) => s.claims.filter((c) => c.broadcast === b && buyerName(s, c.buyer) === name)
  expect(byName('최지우').map((c) => [c.no, c.variant, c.qty, c.status])).toEqual([[22, '105/검정색', 2, 'REJECTED']])
  expect(byName('박민수').map((c) => [c.no, c.variant, c.qty, c.status, c.amount])).toEqual([[22, '105/검정색', 2, 'CONFIRMED', 34000]])
  expect(variantView(s, await productOf(page, date, true, b, 21))['M']).toEqual({ status: 'SOLD', remaining: 0, winners: ['홍길동'], waitlist: ['김철수'] })
  const tee = variantView(s, await productOf(page, date, true, b, 22))
  expect(tee['105/검정색']).toEqual({ status: 'SOLD', remaining: 0, winners: ['박민수'], waitlist: [] })
  for (const text of ['95/흰색', '95/검정색', '100/흰색', '100/검정색', '105/흰색']) expect(tee[text]?.status, text).toBe('OPEN')
  // 채팅 패널의 결과 낱말이 이 상태와 같다
  const rows = chatPanel(page).getByRole('list', { name: '채팅 메시지' }).getByRole('listitem')
  const row = (nick: string) => rows.filter({ has: page.locator('.chat-nick', { hasText: nick }) })
  await expect(row('홍길동').first().locator('.chat-claims')).toContainText('21번 M 1등')
  await expect(row('김철수').first().locator('.chat-claims')).toContainText(/21번 M 대기 1/)
  await expect(row('박민수').first().locator('.chat-claims')).toContainText(/22번 105\/검정색 ×2 1등/)
  await expect(row('최지우').first().locator('.chat-claims')).toContainText('품절')
  await expect(row('최지우').first().locator('.chat-claims')).not.toContainText('대기')

  // ── AC-O4-12 지금 상품 댓글 (22 등록에서 16초 넘게 지난 뒤) ──
  await untilElapsed(page, registeredAt, 16_500)
  await say(page, b, '정하나', '화이트 100', () => waitClaims(page, date, true, b, 4))
  s = await oscope(page, date, true)
  expect(byName('정하나').map((c) => [c.no, c.variant, c.qty, c.status, c.amount])).toEqual([[22, '100/흰색', 1, 'CONFIRMED', 15000]])
  await waitReviews(page, b, true, 0)

  // ── AC-O4-13 확인 필요 셋 ──
  await say(page, b, '이영희', '반바지', () => waitReviews(page, b, true, 1))
  await say(page, b, '홍길동', '반바지 L 3개', () => waitReviews(page, b, true, 2))
  await say(page, b, '한가람', '반바지 XL', () => waitReviews(page, b, true, 3))
  const strip = page.getByRole('region', { name: '알림' })
  await strip.getByRole('button', { name: '확인 필요 3건' }).click()
  await expect(page.getByRole('heading', { name: '확인 필요', level: 1 })).toBeVisible()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(3)
  const [l1, l2, l3] = [reviewLine(page, 1), reviewLine(page, 2), reviewLine(page, 3)]
  await expect(l1).toContainText('이영희')
  await expect(l1).toContainText('옵션 빠짐')
  await expect(l1.getByLabel('상품')).toHaveValue(`${b}/21`)
  await expect(l2).toContainText('홍길동')
  await expect(l2).toContainText('남은 수량 부족')
  await expect(l2.getByLabel('상품')).toHaveValue(`${b}/21`)
  await expect(l2.getByLabel('사이즈')).toHaveValue('L')
  await expect(l2.getByLabel('수량')).toHaveValue('3')
  await expect(l2.getByText('남은 2개', { exact: true })).toBeVisible()
  await expect(l3).toContainText('한가람')
  await expect(l3).toContainText('모르는 말')
  await l1.getByLabel('사이즈').selectOption('S')
  if ((await l1.getByLabel('수량').inputValue()) === '') await l1.getByLabel('수량').fill('1')
  await l2.getByLabel('수량').fill('2')
  await l3.getByRole('button', { name: '3번째 줄 주문 아님' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(2)
  await reviewLine(page, 1).getByRole('checkbox', { name: '1번째 줄 고르기' }).check()
  await reviewLine(page, 2).getByRole('checkbox', { name: '2번째 줄 고르기' }).check()
  await page.getByRole('button', { name: '고른 줄 주문으로' }).click()
  const results = page.getByRole('list', { name: '보낸 결과' })
  await expect(results.getByText(/이영희.*1등/)).toBeVisible()
  await expect(results.getByText(/홍길동.*1등/)).toBeVisible()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(0)
  await waitReviews(page, b, true, 0)
  await waitClaims(page, date, true, b, 6)
  s = await oscope(page, date, true)
  expect(byName('이영희').map((c) => [c.no, c.variant, c.qty, c.status, c.amount])).toEqual([[21, 'S', 1, 'CONFIRMED', 10000]])
  expect(byName('홍길동').filter((c) => c.variant === 'L').map((c) => [c.qty, c.status, c.amount])).toEqual([[2, 'CONFIRMED', 20000]])
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  await expect(page.getByRole('region', { name: '알림' }).getByRole('button', { name: /^확인 필요 [1-9]/ })).toHaveCount(0)

  // ── AC-O4-14 변형을 고른 취소와 대기 승계 ──
  await boardItem(page, 21).click()
  const detail = page.getByRole('dialog', { name: /21번.*자세히/ })
  const mWinners = detail.getByRole('region', { name: 'M 변형' }).getByRole('region', { name: 'M 1등' })
  await expect(mWinners).toContainText('홍길동')
  await mWinners.getByRole('listitem').filter({ hasText: '홍길동' }).getByRole('button', { name: '찜 취소하기' }).click()
  const cancel = page.getByRole('dialog').last()
  await cancel.getByLabel('사유').fill('구매자 요청')
  await cancel.getByRole('button', { name: /취소/ }).last().click()
  await expect.poll(async () => {
    const now = await oscope(page, date, true)
    return variantView(now, await productOf(page, date, true, b, 21))['M']
  }, { timeout: 20_000 }).toEqual({ status: 'SOLD', remaining: 0, winners: ['김철수'], waitlist: [] })
  s = await oscope(page, date, true)
  const final21 = await productOf(page, date, true, b, 21)
  expect(final21.status).toBe('SOLD')
  expect(variantView(s, final21)).toEqual({
    S: { status: 'SOLD', remaining: 0, winners: ['이영희'], waitlist: [] },
    M: { status: 'SOLD', remaining: 0, winners: ['김철수'], waitlist: [] },
    L: { status: 'SOLD', remaining: 0, winners: ['홍길동'], waitlist: [] },
  })
  expect(byName('홍길동').filter((c) => c.status === 'CONFIRMED').map((c) => [c.variant, c.qty])).toEqual([['L', 2]])
  await page.keyboard.press('Escape')

  // ── AC-O4-16 리허설 확인서 ──
  const buyerOf = (name: string) => s.buyers.find((x) => x.display === name)!.id
  const receipt = async (name: string) => {
    const res = await page.request.get(`/api/days/${date}/receipt?rehearsal=true&buyer=${encodeURIComponent(buyerOf(name))}`)
    expect(res.ok(), await res.text()).toBe(true)
    return await res.json() as { lines: { no: number; name: string; price: number }[]; itemCount: number; subtotal: number; shipping: number; total: number }
  }
  const min = await receipt('박민수')
  expect(min.lines.map((l) => [l.no, l.name, l.price])).toEqual([[22, '반팔티 105/검정색 (17,000원 × 2개)', 34000]])
  expect(min.itemCount).toBe(2)
  const hong = await receipt('홍길동')
  expect(hong.lines.map((l) => [l.no, l.name, l.price])).toEqual([[21, '반바지 L (10,000원 × 2개)', 20000]])
  expect([hong.subtotal, hong.shipping, hong.total]).toEqual([20000, 4000, 24000])
  // 화면에서 받는 PDF 이름은 "리허설-"로 시작한다
  await page.goto(`/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(buyerOf('홍길동'))}`)
  const region = page.getByRole('region', { name: '구매 내역 확인서' })
  await expect(region.getByRole('img', { name: '구매 내역 확인서 미리 보기' })).toBeVisible()
  const [pdf] = await Promise.all([page.waitForEvent('download'), region.getByRole('button', { name: 'PDF 내려받기' }).click()])
  expect(pdf.suggestedFilename()).toMatch(/^리허설-/)
})
