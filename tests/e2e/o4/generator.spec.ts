// O4 리허설 생성기 — 옵션 방송의 옵션 댓글·확인 필요 감 (AC-O4-08), 다육(번호) 리허설 회귀 (AC-O4-33) — test-e2e.
// 기대값은 acceptance.md·D-O4-01·D-O4-08에서 정했다. 생성기 상태 응답에는 종류별 개수가 없어(dev-server 인계)
// "review 없음"은 확인 필요 조회가 비어 있고 채팅 패널에 "확인 필요"가 없는 것으로 본다.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { loginNewSeller } from '../i3/support.ts'
import {
  SHORTS,
  bitsDiff,
  canvasBits,
  nodeProductBits,
  pngBits,
  productLabelItems,
  productTemplate,
  setLabels,
  smsApi,
  boardItem,
  buyerName,
  chat,
  chatPanel,
  createBroadcast,
  login,
  newRehearsal,
  oscope,
  productOf,
  register,
  registerOptions,
  reviewsApi,
  uniqueDate,
  waitClaims,
  waitGeneratorDone,
  writeEvent,
} from './support.ts'

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('AC-O4-08: 옵션 리허설에서 생성기 200건 → 채팅 패널에 옵션 주문 줄·"확인 필요" 줄, 알림 띠 수 = 확인 필요 조회 수 ≥ 1, 변형 남은 ≥ 0, 실제 범위는 비어 있음', async ({ page }) => {
  test.setTimeout(180_000)
  const date = uniqueDate()
  const { b } = await createBroadcast(page, { date, rehearsal: true, saleMode: 'OPTIONS', title: `옵션 생성기 ${crypto.randomUUID().slice(0, 6)}` })
  await registerOptions(page, b, { ...SHORTS })
  await registerOptions(page, b, { no: 11, name: '초코 과자', price: 2000, stock: 5, aliases: ['초코'] })
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(boardItem(page, 21)).toBeVisible()
  await expect(boardItem(page, 11)).toBeVisible()

  const panel = page.getByRole('region', { name: '리허설 조작판' })
  await panel.getByLabel('총 개수').fill('200')
  await panel.getByLabel('초당 속도').fill('50')
  await panel.getByText('더 보기').click()
  await panel.getByLabel('채팅 순서 번호').fill('7')
  await panel.getByRole('button', { name: '가짜 채팅 시작' }).click()
  await waitGeneratorDone(page, b, 200)
  await expect(panel.getByRole('status', { name: '가짜 채팅 상태' })).toContainText('200 / 200')

  // 채팅 패널: 옵션 글이 붙은 주문 줄 ("주문 21번 M" 모양) · "확인 필요" 표시 줄
  const messages = chatPanel(page).getByRole('list', { name: '채팅 메시지' })
  await expect(messages.locator('.tag-order').filter({ hasText: /^주문 21번 (S|M|L)( ×\d+)?$/ }).first()).toBeVisible()
  await expect(messages.locator('.tag-alert').filter({ hasText: /^확인 필요 · / }).first()).toBeVisible()

  // 알림 띠의 "확인 필요 n건" = 확인 필요 조회 항목 수 ≥ 1
  const reviews = (await reviewsApi(page, { broadcast: b, rehearsal: true })).reviews
  expect(reviews.length).toBeGreaterThanOrEqual(1)
  await expect(page.getByRole('region', { name: '알림' }).getByRole('button', { name: `확인 필요 ${String(reviews.length)}건` })).toBeVisible()

  // 변형 표: 각 변형 "남은 n개" ≥ 0 (서버 값과 화면 줄 모두)
  const p21 = await productOf(page, date, true, b, 21)
  for (const v of p21.variants) expect(v.remaining, v.text).toBeGreaterThanOrEqual(0)
  await page.getByRole('button', { name: '변형 펼치기 — 21번' }).click()
  const lines = page.getByRole('list', { name: '변형 — 21번' }).getByRole('listitem')
  await expect(lines).toHaveCount(3)
  for (const text of await lines.allInnerTexts()) expect(text).toMatch(/남은 \d+/)

  // 실제 범위에는 찜·확인 필요가 하나도 없다 (D-081)
  const realRes = await page.request.get(`/api/days/${date}`)
  if (realRes.status() !== 404) {
    const real = await realRes.json() as { claims: unknown[] }
    expect(real.claims).toEqual([])
  }
  const realReviews = (await reviewsApi(page)).reviews
  expect(realReviews.filter((r) => r.broadcast === b || r.date === date)).toEqual([])
})

test('AC-O4-33: 다육(번호로만 받기) 리허설 — 194·195 1등, "반바지 M"·"초코 과자 3"은 찜 아님, 옵션 낱말 없음, 생성기 300건에도 확인 필요 없음', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  const b = await newRehearsal(page)
  const info = await (await page.request.get('/api/broadcasts')).json() as { broadcasts: { id: string; date: string; rehearsal: boolean; settings?: Record<string, unknown> }[] }
  const mine = info.broadcasts.find((x) => x.id === b)
  expect(mine?.rehearsal).toBe(true)
  const date = mine!.date
  await register(page, '194 왕비뇌신금 8', 194)
  await register(page, '195 핑크프릴 12', 195)
  const panel = page.getByRole('region', { name: '리허설 조작판' })
  // "시청자로 보내기" (D-082)
  await chat(page, b, '홍길동', '194')
  await chat(page, b, '김철수', '195번')
  await chat(page, b, '이영희', '반바지 M')
  await chat(page, b, '박민수', '초코 과자 3')
  const claims = await waitClaims(page, date, true, b, 2)
  const s = await oscope(page, date, true)
  expect(claims.map((c) => [c.no, buyerName(s, c.buyer), c.status, c.variant, c.qty]).sort()).toEqual([[194, '홍길동', 'CONFIRMED', null, 1], [195, '김철수', 'CONFIRMED', null, 1]])

  await panel.getByLabel('총 개수').fill('300')
  await panel.getByLabel('초당 속도').fill('50')
  await panel.getByText('더 보기').click()
  await panel.getByLabel('채팅 순서 번호').fill('42')
  await panel.getByRole('button', { name: '가짜 채팅 시작' }).click()
  await waitGeneratorDone(page, b, 300)

  // 생성기 기록에 review가 없다 = 확인 필요가 하나도 없다
  expect((await reviewsApi(page, { broadcast: b, rehearsal: true })).reviews).toEqual([])
  const main = page.locator('main')
  await expect(chatPanel(page).getByRole('list', { name: '채팅 메시지' }).locator('li').first()).toBeVisible()
  for (const word of ['옵션 추가', '지금 상품', '확인 필요']) await expect(main.getByText(word)).toHaveCount(0)
  // 확인서 줄은 옵션 글·수량 없이 지금 모양 (품종만)
  const hong = claims.find((c) => c.no === 194)!.currentBuyer
  const res = await page.request.get(`/api/days/${date}/receipt?rehearsal=true&buyer=${encodeURIComponent(hong)}`)
  expect(res.ok(), await res.text()).toBe(true)
  const receipt = await res.json() as { lines: { no: number; name: string; price: number }[] }
  expect(receipt.lines.filter((l) => l.no === 194).map((l) => [l.name, l.price])).toEqual([['왕비뇌신금', 8000]])
  // 찜이 된 것은 모두 옵션·수량 없는 번호 찜
  const after = await oscope(page, date, true)
  const options = after.claims.filter((c) => c.broadcast === b && (c.variant !== null || c.qty !== 1))
  expect(options).toEqual([])
  // 라벨: 리허설 방송은 지금처럼 라벨이 없다 — 상품 자세히 안내 그대로, 리허설 라벨 조회는 거절
  await boardItem(page, 194).click()
  const labelBox = page.getByRole('dialog', { name: /194번.*자세히/ }).getByRole('region', { name: '라벨' })
  await expect(labelBox).toContainText('리허설 방송은 라벨을 출력하지 않아요.')
  await expect(labelBox.getByRole('img')).toHaveCount(0)
  await page.keyboard.press('Escape')
  const rl = await page.request.get(`/api/print/labels?date=${date}&rehearsal=true`)
  expect(rl.status()).toBe(422)
})

test('AC-O4-33 (라벨): 번호로만 받기 판매자의 다육 라벨 데이터에 옵션 글·수량 칸이 없고, 글 자리·미리 보기 그림이 지금 모양', async ({ page }) => {
  await page.context().clearCookies()
  await loginNewSeller(page)
  await setLabels(page, true)
  const date = uniqueDate()
  const { b } = await createBroadcast(page, { date, rehearsal: false, title: '다육 1부' })
  const reg = await writeEvent(page, { type: 'product.register', b, no: 194, name: '왕비뇌신금', price: 8000 })
  expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
  await smsApi(page, { b, no: 194, phone: '010-2345-6789', memo: '홍길동' })
  const res = await page.request.get(`/api/print/labels?date=${date}`)
  expect(res.ok(), await res.text()).toBe(true)
  const labels = (await res.json() as { labels: { no: number; winner: boolean; data: Record<string, unknown> | null }[] }).labels
  const label = labels.find((l) => l.winner && l.no === 194)
  expect(label?.data).toBeTruthy()
  const data = label!.data!
  // 다육 라벨 데이터는 지금 칸만 (L-9 BASE: no·name·price·date·buyer) — variant·qty 없음
  expect(Object.keys(data).sort()).toEqual(['buyer', 'date', 'name', 'no', 'price'])
  expect([data['no'], data['name'], data['price']]).toEqual([194, '왕비뇌신금', 8000])
  const template = await productTemplate(page)
  const items = productLabelItems(template, data)
  expect([items['number'], items['name'], items['price']]).toEqual(['194', '왕비뇌신금', '8 천원'])
  // 미리 보기 = 그림 파일(PNG) 바이트 같음, Node로 그린 BASE 그림과 크기 같고 수량을 붙인 그림보다 가깝다
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await boardItem(page, 194).click()
  const group = page.getByRole('dialog', { name: /194번.*자세히/ }).getByRole('group', { name: /^1등 .+ 라벨$/ })
  await expect(group).toHaveCount(1)
  await expect(group).not.toContainText('×')
  const canvas = group.getByRole('img', { name: '194번 라벨 미리 보기' })
  await expect(canvas).toBeVisible()
  const preview = await canvasBits(canvas)
  const [dl] = await Promise.all([page.waitForEvent('download'), group.getByRole('button', { name: '그림 파일로 저장' }).click()])
  const file = await pngBits(page, readFileSync((await dl.path())!))
  expect(preview).toEqual(file)
  const base = nodeProductBits(template, data)
  expect([base.width, base.height]).toEqual([preview.width, preview.height])
  expect(bitsDiff(base, preview)).toBeLessThan(bitsDiff(nodeProductBits(template, { ...data, qty: 2, price: 16000 }), preview))
})
