// O4 식품·휴대폰 케이스 흐름 — 리허설 (AC-O4-30·31) — test-e2e.
// 기대값 = G-ENG-O4-02·03(tests/golden/engine/25-o4-integration.yaml). 댓글은 앞 댓글이 반영된 뒤 하나씩 보낸다.
import { expect, test, type Page } from '@playwright/test'
import {
  boardItem,
  buyerName,
  chat,
  chatPanel,
  createBroadcast,
  login,
  oscope,
  productOf,
  registerOptions,
  reviewLine,
  reviewList,
  openReviews,
  untilElapsed,
  waitReviews,
  type OScope,
} from './support.ts'

test.beforeEach(async ({ page }) => {
  await login(page)
})

function optionDialog(page: Page) {
  return page.getByRole('dialog', { name: '옵션 추가' })
}

async function claimCount(page: Page, date: string, b: string): Promise<number> {
  return (await oscope(page, date, true)).claims.filter((c) => c.broadcast === b).length
}

/** 댓글 하나를 보내고 찜(모든 상태)·확인 필요 수가 기대값이 될 때까지 */
async function say(page: Page, date: string, b: string, nick: string, text: string, expectAfter: { claims: number; reviews: number }) {
  await chat(page, b, nick, text)
  await expect.poll(async () => [await claimCount(page, date, b), (await waitReviewsCount(page, b))], { timeout: 15_000 }).toEqual([expectAfter.claims, expectAfter.reviews])
}

async function waitReviewsCount(page: Page, b: string): Promise<number> {
  const res = await page.request.get(`/api/reviews?rehearsal=true&broadcast=${encodeURIComponent(b)}`)
  return ((await res.json()) as { reviews: unknown[] }).reviews.length
}

function rowOf(page: Page, nick: string) {
  return chatPanel(page).getByRole('list', { name: '채팅 메시지' }).getByRole('listitem').filter({ has: page.locator('.chat-nick', { hasText: nick }) }).first()
}

function claimsOf(s: OScope, b: string, name: string) {
  return s.claims.filter((c) => c.broadcast === b && buyerName(s, c.buyer) === name).map((c) => [c.no, c.variant, c.qty, c.status, c.amount])
}

test('AC-O4-30: 식품 — 수량 댓글, 수량 2 이상 품절·수량 1 대기, STOCK_SHORT 고친 수량 바로잡기·QTY_INVALID 지우기, 수량 2 찜 취소의 승계 (G-ENG-O4-02)', async ({ page }) => {
  test.setTimeout(180_000)
  const { b, date } = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS', title: `식품 ${crypto.randomUUID().slice(0, 6)}` })
  await registerOptions(page, b, { no: 11, name: '초코 과자', price: 2000, stock: 5, aliases: ['초코'] })
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(boardItem(page, 11)).toBeVisible()
  // 13 견과 세트 — 템플릿 식품 중량에서 500g·1kg(+8,000, 별칭 1키로), 변형 재고 3
  const input = page.getByLabel('빠른 입력')
  await input.fill('13 견과 세트 12000')
  await page.getByRole('button', { name: '옵션 추가' }).click()
  const dlg = optionDialog(page)
  await dlg.getByRole('button', { name: '템플릿에서 고르기' }).click()
  await dlg.getByRole('button', { name: '식품 — 중량', exact: true }).click()
  await expect(dlg.getByLabel('항목 1 선택지 3 이름')).toHaveValue('2kg')
  await dlg.getByRole('button', { name: '항목 1 선택지 3 빼기' }).click()
  await dlg.getByLabel('항목 1 선택지 2 별칭').fill('1키로')
  await dlg.getByLabel('항목 1 선택지 2 가격 차이').fill('8000')
  await dlg.getByLabel('500g 재고').fill('3')
  await dlg.getByLabel('1kg 재고').fill('3')
  await dlg.getByRole('button', { name: '옵션 넣기' }).click()
  await expect(dlg).toHaveCount(0)
  await input.press('Enter')
  await expect(boardItem(page, 13)).toBeVisible()
  const p13 = await productOf(page, date, true, b, 13)
  expect(p13.variants.map((v) => [v.text, v.stock, v.price])).toEqual([['500g', 3, 12000], ['1kg', 3, 20000]])

  await say(page, date, b, '홍길동', '초코 과자 3', { claims: 1, reviews: 0 })
  await say(page, date, b, '김철수', '초코 2개', { claims: 2, reviews: 0 })
  await say(page, date, b, '이영희', '초코 1', { claims: 3, reviews: 0 })
  await say(page, date, b, '박민수', '초코과자 두개', { claims: 4, reviews: 0 })
  await say(page, date, b, '최지우', '견과 세트 1kg 2개', { claims: 5, reviews: 0 })
  await say(page, date, b, '정하나', '견과 세트 1kg 3개', { claims: 5, reviews: 1 })
  await say(page, date, b, '한가람', '견과 세트 500g 20개', { claims: 5, reviews: 2 })
  let s = await oscope(page, date, true)
  expect(claimsOf(s, b, '홍길동')).toEqual([[11, null, 3, 'CONFIRMED', 6000]])
  expect(claimsOf(s, b, '김철수')).toEqual([[11, null, 2, 'CONFIRMED', 4000]])
  expect(claimsOf(s, b, '이영희').map((c) => c.slice(0, 4))).toEqual([[11, null, 1, 'WAITLISTED']])
  expect(claimsOf(s, b, '박민수').map((c) => c.slice(0, 4))).toEqual([[11, null, 2, 'REJECTED']])
  expect(claimsOf(s, b, '최지우')).toEqual([[13, '1kg', 2, 'CONFIRMED', 40000]])
  // 채팅 패널 결과 낱말: 수량 1이 아닐 때만 ×n
  await expect(rowOf(page, '홍길동').locator('.tag-order')).toHaveText('주문 11번 ×3')
  await expect(rowOf(page, '이영희').locator('.tag-order')).toHaveText('주문 11번')
  await expect(rowOf(page, '최지우').locator('.tag-order')).toHaveText('주문 13번 1kg ×2')
  await expect(rowOf(page, '박민수').locator('.chat-claims')).toContainText('품절')

  const items = await waitReviews(page, b, true, 2)
  expect(items.map((x) => [x.reason, x.qty])).toEqual([['STOCK_SHORT', 3], ['QTY_INVALID', 20]])
  await openReviews(page, b, true)
  const [l1, l2] = [reviewLine(page, 1), reviewLine(page, 2)]
  await expect(l1).toContainText('정하나')
  await expect(l1).toContainText('남은 수량 부족')
  await expect(l1.getByLabel('상품')).toHaveValue(`${b}/13`)
  await expect(l1.getByLabel('중량')).toHaveValue('1kg')
  await expect(l1.getByLabel('수량')).toHaveValue('3')
  await expect(l1.getByText('남은 1개', { exact: true })).toBeVisible()
  await expect(l2).toContainText('한가람')
  await expect(l2).toContainText('수량 확인')
  await expect(l2.getByLabel('중량')).toHaveValue('500g')
  await l1.getByLabel('수량').fill('1')
  await l2.getByRole('button', { name: '2번째 줄 주문 아님' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  await reviewLine(page, 1).getByRole('button', { name: '1번째 줄 주문으로' }).click()
  await expect(page.getByRole('list', { name: '보낸 결과' }).getByText(/정하나.*1등/)).toBeVisible()
  await waitReviews(page, b, true, 0)

  // 상품 11 자세히에서 김철수 찜(2개) 취소 → 이영희 승계
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await boardItem(page, 11).click()
  const detail = page.getByRole('dialog', { name: /11번.*자세히/ })
  await detail.getByRole('region', { name: '1등' }).getByRole('listitem').filter({ hasText: '김철수' }).getByRole('button', { name: '찜 취소하기' }).click()
  const cancel = page.getByRole('dialog').last()
  await cancel.getByLabel('사유').fill('구매자 요청')
  await cancel.getByRole('button', { name: /취소/ }).last().click()
  await expect.poll(async () => claimsOf(await oscope(page, date, true), b, '이영희'), { timeout: 20_000 }).toEqual([[11, null, 1, 'CONFIRMED', 2000]])
  s = await oscope(page, date, true)
  const p11 = await productOf(page, date, true, b, 11) as Awaited<ReturnType<typeof productOf>> & { winners: string[]; waitlist: string[] }
  expect([p11.status, p11.winners.map((id) => buyerName(s, id)), p11.waitlist]).toEqual(['OPEN', ['홍길동', '이영희'], []])
  expect(claimsOf(s, b, '박민수').map((c) => c.slice(0, 4))).toEqual([[11, null, 2, 'REJECTED']])
  const kg = (await productOf(page, date, true, b, 13)).variants.find((v) => v.text === '1kg')!
  expect([kg.status, kg.winners.map((id) => buyerName(s, id))]).toEqual(['SOLD', ['최지우', '정하나']])
  expect(claimsOf(s, b, '정하나')).toEqual([[13, '1kg', 1, 'CONFIRMED', 20000]])
  expect(claimsOf(s, b, '최지우')).toEqual([[13, '1kg', 2, 'CONFIRMED', 40000]])
})

test('AC-O4-31: 휴대폰 케이스 — 기종 숫자는 옵션, 17번은 다른 상품, 언급, OPTION_CONFLICT 지우기·STOCK_SHORT 바로잡기 (G-ENG-O4-03)', async ({ page }) => {
  test.setTimeout(180_000)
  const { b, date } = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS', title: `케이스 ${crypto.randomUUID().slice(0, 6)}` })
  await registerOptions(page, b, { no: 17, name: '그립톡', price: 5000, stock: 3 })
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(boardItem(page, 17)).toBeVisible()
  const input = page.getByLabel('빠른 입력')
  await input.fill('41 폰케이스 12000')
  await page.getByRole('button', { name: '옵션 추가' }).click()
  const dlg = optionDialog(page)
  await dlg.getByRole('button', { name: '템플릿에서 고르기' }).click()
  await dlg.getByRole('button', { name: '휴대폰 케이스 — 기종', exact: true }).click()
  // 아이폰 16 · 아이폰 16 프로 · 아이폰 17 · 아이폰 17 프로 · 갤럭시 S25 · 갤럭시 S25 울트라 → 17 프로 · 17 · S25만
  await expect(dlg.getByLabel('항목 1 선택지 6 이름')).toHaveValue('갤럭시 S25 울트라')
  for (const n of [6, 2, 1]) await dlg.getByRole('button', { name: `항목 1 선택지 ${String(n)} 빼기` }).click()
  await expect(dlg.getByLabel('항목 1 선택지 1 이름')).toHaveValue('아이폰 17')
  await expect(dlg.getByLabel('항목 1 선택지 2 이름')).toHaveValue('아이폰 17 프로')
  await expect(dlg.getByLabel('항목 1 선택지 3 이름')).toHaveValue('갤럭시 S25')
  await dlg.getByLabel('항목 1 선택지 1 별칭').fill('')
  await dlg.getByLabel('항목 1 선택지 2 별칭').fill('17프로, 17pro')
  await dlg.getByLabel('항목 1 선택지 3 별칭').fill('s25, 갤s25')
  await dlg.getByLabel(/^상품 별칭/).fill('케이스')
  await dlg.getByLabel('모두 같은 수로').fill('2')
  await dlg.getByRole('button', { name: '모두 바꾸기' }).click()
  await dlg.getByRole('button', { name: '옵션 넣기' }).click()
  await expect(dlg).toHaveCount(0)
  await input.press('Enter')
  await expect(boardItem(page, 41)).toBeVisible()
  const registeredAt = Date.now()
  const p41 = await productOf(page, date, true, b, 41)
  expect(p41.aliases).toEqual(['케이스'])
  expect(p41.variants.map((v) => [v.text, v.stock])).toEqual([['아이폰 17', 2], ['아이폰 17 프로', 2], ['갤럭시 S25', 2]])
  await expect(page.getByRole('region', { name: '지금 상품' })).toContainText('지금 상품: 41번 폰케이스')

  await untilElapsed(page, registeredAt, 16_500)
  await say(page, date, b, '홍길동', '아이폰 17 프로', { claims: 1, reviews: 0 })
  await say(page, date, b, '김철수', '아이폰 17 2', { claims: 2, reviews: 0 })
  await say(page, date, b, '이영희', '17', { claims: 3, reviews: 0 })
  await say(page, date, b, '박민수', '17 2개', { claims: 4, reviews: 0 })
  await say(page, date, b, '최지우', '케이스 17프로 3개', { claims: 4, reviews: 1 })
  await chat(page, b, '정하나', '그립톡 아이폰 17')
  await expect(rowOf(page, '정하나')).toBeVisible()
  await say(page, date, b, '한가람', '아이폰 17 프로 갤럭시 S25', { claims: 4, reviews: 2 })
  await say(page, date, b, '오세훈', '갤s25', { claims: 5, reviews: 2 })
  let s = await oscope(page, date, true)
  expect(claimsOf(s, b, '홍길동')).toEqual([[41, '아이폰 17 프로', 1, 'CONFIRMED', 12000]])
  expect(claimsOf(s, b, '김철수')).toEqual([[41, '아이폰 17', 2, 'CONFIRMED', 24000]])
  expect(claimsOf(s, b, '이영희')).toEqual([[17, null, 1, 'CONFIRMED', 5000]])
  expect(claimsOf(s, b, '박민수')).toEqual([[17, null, 2, 'CONFIRMED', 10000]])
  expect(claimsOf(s, b, '정하나')).toEqual([])
  expect(claimsOf(s, b, '오세훈')).toEqual([[41, '갤럭시 S25', 1, 'CONFIRMED', 12000]])
  await expect(rowOf(page, '정하나').locator('.tag-mention')).toBeVisible()
  const items = await waitReviews(page, b, true, 2)
  expect(items.map((x) => x.reason)).toEqual(['STOCK_SHORT', 'OPTION_CONFLICT'])

  await openReviews(page, b, true)
  const [l1, l2] = [reviewLine(page, 1), reviewLine(page, 2)]
  await expect(l1).toContainText('최지우')
  await expect(l1.getByLabel('기종')).toHaveValue('아이폰 17 프로')
  await expect(l1.getByLabel('수량')).toHaveValue('3')
  await expect(l2).toContainText('한가람')
  await l1.getByLabel('수량').fill('1')
  await l2.getByRole('button', { name: '2번째 줄 주문 아님' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  await reviewLine(page, 1).getByRole('button', { name: '1번째 줄 주문으로' }).click()
  await expect(page.getByRole('list', { name: '보낸 결과' }).getByText(/최지우.*1등/)).toBeVisible()
  await waitReviews(page, b, true, 0)
  s = await oscope(page, date, true)
  expect(claimsOf(s, b, '최지우')).toEqual([[41, '아이폰 17 프로', 1, 'CONFIRMED', 12000]])
  const p17 = await productOf(page, date, true, b, 17) as Awaited<ReturnType<typeof productOf>> & { winners: string[] }
  expect([p17.status, p17.winners.map((id) => buyerName(s, id))]).toEqual(['SOLD', ['이영희', '박민수']])
  const final41 = await productOf(page, date, true, b, 41)
  expect(final41.status).toBe('OPEN')
  expect(Object.fromEntries(final41.variants.map((v) => [v.text, [v.status, v.winners.map((id) => buyerName(s, id))]]))).toEqual({
    '아이폰 17': ['SOLD', ['김철수']],
    '아이폰 17 프로': ['SOLD', ['홍길동', '최지우']],
    '갤럭시 S25': ['OPEN', ['오세훈']],
  })
})
