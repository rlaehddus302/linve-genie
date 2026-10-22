// O4 의류 한 흐름 — 실제 옵션 방송 (가짜 유튜브 묶음 @youtube, AC-O4-11~16·18, D-O4-02) — test-e2e.
// 댓글은 가짜 구글 서버의 실시간 채팅(실제 수집기 경로)으로 앞 댓글이 반영된 뒤 하나씩 넣는다. 기대값 = G-ENG-O4-01.
// 새 판매자 계정으로 돈다(오늘 날짜의 실제 범위를 다른 시험과 나누지 않게).
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { connectYoutube, fake, fakeBroadcast, fakeChat, linkByAddress, loginNewSeller } from '../i3/support.ts'
import {
  SHORTS,
  TEE,
  bitsDiff,
  boardItem,
  buyerName,
  canvasBits,
  nodeProductBits,
  createBroadcast,
  openReviews,
  oscope,
  packingLabelData,
  productLabelItems,
  productOf,
  productTemplate,
  pngBits,
  registerOptions,
  reviewLine,
  reviewList,
  setLabels,
  untilElapsed,
  waitReviews,
  type OScope,
} from './support.ts'

test.beforeEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})

function todayKst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function claimsOf(s: OScope, b: string, name: string) {
  return s.claims.filter((c) => c.broadcast === b && buyerName(s, c.buyer) === name).map((c) => [c.no, c.variant, c.qty, c.status, c.amount])
}

async function counts(page: Page, date: string, b: string): Promise<[number, number]> {
  const s = await oscope(page, date, false)
  const reviews = await (await page.request.get(`/api/reviews?broadcast=${encodeURIComponent(b)}`)).json() as { reviews: unknown[] }
  return [s.claims.filter((c) => c.broadcast === b).length, reviews.reviews.length]
}

test('@youtube AC-O4-11~16·18: 실제 옵션 방송 — 수집기 댓글의 변형 1등·대기·품절, 지금 상품 댓글, 확인 필요 셋, 변형 취소·승계 → 라벨 목록·확인서·포장 라벨', async ({ page }) => {
  test.setTimeout(240_000)
  await loginNewSeller(page)
  const channel = await connectYoutube(page)
  await setLabels(page, true)
  const live = await fakeBroadcast(page.request, channel.id, { title: '의류 라이브' })
  const date = todayKst()
  const { b } = await createBroadcast(page, { date, rehearsal: false, saleMode: 'OPTIONS', title: '의류 1부' })
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  await linkByAddress(page, live.videoId)
  await registerOptions(page, b, { ...SHORTS })
  await registerOptions(page, b, { ...TEE })
  const registeredAt = Date.now()
  await expect(boardItem(page, 22)).toBeVisible()

  const tag = crypto.randomUUID().slice(0, 6)
  const ch = (x: string) => `UC_${x}_${tag}`
  const say = async (author: string, nick: string, text: string, after: [number, number]) => {
    await fakeChat(page.request, live.liveChatId, ch(author), nick, text)
    await expect.poll(() => counts(page, date, b), { timeout: 30_000 }).toEqual(after)
  }
  await say('A', '홍길동', '반바지 M', [1, 0])
  await say('B', '김철수', '21 M', [2, 0])
  await say('D', '박민수', '반팔티 105 검정 2', [3, 0])
  await say('E', '최지우', '반팔티 105 블랙 2개', [4, 0])
  let s = await oscope(page, date, false)
  expect(claimsOf(s, b, '홍길동')).toEqual([[21, 'M', 1, 'CONFIRMED', 10000]])
  expect(claimsOf(s, b, '김철수').map((c) => c.slice(0, 4))).toEqual([[21, 'M', 1, 'WAITLISTED']])
  expect(claimsOf(s, b, '박민수')).toEqual([[22, '105/검정색', 2, 'CONFIRMED', 34000]])
  expect(claimsOf(s, b, '최지우').map((c) => c.slice(0, 4))).toEqual([[22, '105/검정색', 2, 'REJECTED']])
  await untilElapsed(page, registeredAt, 16_500)
  await say('F', '정하나', '화이트 100', [5, 0])
  await say('C', '이영희', '반바지', [5, 1])
  await say('A', '홍길동', '반바지 L 3개', [5, 2])
  await say('G', '한가람', '반바지 XL', [5, 3])
  s = await oscope(page, date, false)
  expect(claimsOf(s, b, '정하나')).toEqual([[22, '100/흰색', 1, 'CONFIRMED', 15000]])

  // 확인 필요 셋 — 원래 순서, 바로잡기 둘·지우기 하나
  const items = await waitReviews(page, b, false, 3)
  expect(items.map((x) => x.reason)).toEqual(['OPTION_MISSING', 'STOCK_SHORT', 'UNKNOWN_WORD'])
  await openReviews(page, b, false)
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(3)
  await expect(reviewLine(page, 1)).toContainText('이영희')
  await expect(reviewLine(page, 2)).toContainText('홍길동')
  await expect(reviewLine(page, 3)).toContainText('한가람')
  await reviewLine(page, 1).getByLabel('사이즈').selectOption('S')
  if ((await reviewLine(page, 1).getByLabel('수량').inputValue()) === '') await reviewLine(page, 1).getByLabel('수량').fill('1')
  await reviewLine(page, 2).getByLabel('수량').fill('2')
  await reviewLine(page, 3).getByRole('button', { name: '3번째 줄 주문 아님' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(2)
  await reviewLine(page, 1).getByRole('checkbox', { name: '1번째 줄 고르기' }).check()
  await reviewLine(page, 2).getByRole('checkbox', { name: '2번째 줄 고르기' }).check()
  await page.getByRole('button', { name: '고른 줄 주문으로' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(0)
  await expect.poll(() => counts(page, date, b), { timeout: 20_000 }).toEqual([7, 0])

  // 변형 취소 (화면) → 김철수 승계
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await boardItem(page, 21).click()
  const detail = page.getByRole('dialog', { name: /21번.*자세히/ })
  const mWinners = detail.getByRole('region', { name: 'M 변형' }).getByRole('region', { name: 'M 1등' })
  await mWinners.getByRole('listitem').filter({ hasText: '홍길동' }).getByRole('button', { name: '찜 취소하기' }).click()
  const cancel = page.getByRole('dialog').last()
  await cancel.getByLabel('사유').fill('구매자 요청')
  await cancel.getByRole('button', { name: /취소/ }).last().click()
  await expect.poll(async () => { const now = await oscope(page, date, false); return claimsOf(now, b, '김철수') }, { timeout: 20_000 }).toEqual([[21, 'M', 1, 'CONFIRMED', 10000]])
  s = await oscope(page, date, false)
  expect((await productOf(page, date, false, b, 21)).status).toBe('SOLD')
  expect(claimsOf(s, b, '홍길동').filter((c) => c[3] === 'CONFIRMED')).toEqual([[21, 'L', 2, 'CONFIRMED', 20000]])
  // 상품 자세히의 1등 라벨 묶음 이름에 옵션 글·수량 (취소를 보내면 자세히 창이 닫힌다 — 다시 연다)
  // 판매 줄 한 모양 (D-O4-10·AC-O4-25·35): `1등 홍길동 L 2개 라벨` — `×`·` · 2개` 없음
  if (!(await detail.isVisible())) await boardItem(page, 21).click()
  const hongGroup = detail.getByRole('group', { name: '1등 홍길동 L 2개 라벨' })
  await expect(hongGroup).toBeVisible()
  await expect(detail.getByRole('group', { name: '1등 김철수 M 라벨' })).toBeVisible()
  await expect(detail.getByRole('group', { name: /^1등 홍길동 M/ })).toHaveCount(0)
  await expect(detail.getByRole('group', { name: /×|·/ })).toHaveCount(0)
  // AC-O4-15 미리 보기 그림 (홍길동 21 L 2개)
  const hongCanvas = hongGroup.getByRole('img', { name: '21번 라벨 미리 보기' })
  await expect(hongCanvas).toBeVisible()
  const hongPreview = await canvasBits(hongCanvas)
  await page.keyboard.press('Escape')

  // ── AC-O4-15 라벨 목록 ──
  const labelsRes = await page.request.get(`/api/print/labels?date=${date}`)
  expect(labelsRes.ok(), await labelsRes.text()).toBe(true)
  const labels = (await labelsRes.json() as { labels: { no: number; winner: boolean; data: Record<string, unknown> | null; buyer: { kind: string; name?: string } }[] }).labels
  const winnerData = labels.filter((l) => l.winner).map((l) => [l.no, l.buyer.name, l.data?.['name'], l.data?.['variant'] ?? null, l.data?.['qty'] ?? 1, l.data?.['price']]).sort()
  expect(winnerData).toEqual([
    [21, '김철수', '반바지', 'M', 1, 10000],
    [21, '이영희', '반바지', 'S', 1, 10000],
    [21, '홍길동', '반바지', 'L', 2, 20000],
    [22, '박민수', '반팔티', '105/검정색', 2, 34000],
    [22, '정하나', '반팔티', '100/흰색', 1, 15000],
  ].sort())
  await page.goto('/labels')
  await expect(page.getByRole('heading', { name: '라벨', level: 1 })).toBeVisible()
  const summary = page.getByText('라벨마다 그림 파일로 저장')
  const files = page.getByRole('list', { name: '그림 파일로 저장할 라벨' })
  if (!(await files.isVisible())) await summary.click()
  const lines = files.getByRole('listitem').locator('.job-main')
  await expect(lines).toHaveCount(5)
  const texts = (await lines.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).sort()
  expect(texts).toEqual(['21번 L 2개 · 홍길동', '21번 M · 김철수', '21번 S · 이영희', '22번 100/흰색 · 정하나', '22번 105/검정색 2개 · 박민수'].sort())
  for (const t of texts) expect(t).not.toMatch(/×| · \d+개/)

  // ── AC-O4-15 라벨 글 자리·미리 보기 그림 = 그 라벨 데이터로 그린 그림 ──
  const hongLabel = labels.find((l) => l.winner && l.no === 21 && l.buyer.name === '홍길동')
  expect(hongLabel?.data).toBeTruthy()
  const template = await productTemplate(page)
  const textItems = productLabelItems(template, hongLabel!.data)
  expect([textItems['number'], textItems['name'], textItems['price']]).toEqual(['21', '반바지 L', '2개 20 천원'])
  // 그림 파일 목록의 PNG는 서버 라벨 데이터를 같은 렌더러로 그린 것 — 미리 보기와 바이트까지 같다
  const hongFile = files.getByRole('listitem').filter({ hasText: '21번 L 2개 · 홍길동' })
  const [dl] = await Promise.all([page.waitForEvent('download'), hongFile.getByRole('button', { name: '그림 파일로 저장' }).click()])
  expect(dl.suggestedFilename()).toBe(`라벨-${date}-21번.png`)
  const filePng = await pngBits(page, readFileSync((await dl.path())!))
  expect([hongPreview.width, hongPreview.height]).toEqual([filePng.width, filePng.height])
  expect(hongPreview.data).toEqual(filePng.data)
  // 그 데이터로 Node에서 그린 그림과 크기가 같고, 옵션 글·수량을 뺀 데이터로 그린 것보다 가깝다
  // (브라우저·Node 캔버스는 글자 가장자리 점이 조금 달라 점 하나까지 비교는 위 PNG와 한다 — I1 probes와 같은 방식)
  const want = nodeProductBits(template, hongLabel!.data)
  expect([want.width, want.height]).toEqual([hongPreview.width, hongPreview.height])
  const { variant: _v, qty: _q, ...noOption } = hongLabel!.data as Record<string, unknown>
  expect(productLabelItems(template, noOption)['name']).toBe('반바지')
  expect(bitsDiff(want, hongPreview)).toBeLessThan(bitsDiff(nodeProductBits(template, noOption), hongPreview))
  expect(bitsDiff(want, hongPreview)).toBeLessThan(bitsDiff(nodeProductBits(template, { ...noOption, variant: 'L' }), hongPreview))
  // 그림 파일 목록에 `×`·` · 2개`가 없다 (AC-O4-25 — 대기열·이력 줄은 attacks TE-O4-ATK-4)
  await expect(files).not.toContainText('×')
  await expect(files).not.toContainText(/ · \d+개/)

  // ── AC-O4-16 확인서 (실제) ──
  const idOf = (name: string) => s.buyers.find((x) => x.display === name)!.id
  const receipt = async (name: string) => {
    const res = await page.request.get(`/api/days/${date}/receipt?buyer=${encodeURIComponent(idOf(name))}`)
    expect(res.ok(), await res.text()).toBe(true)
    return await res.json() as { lines: { no: number; name: string; price: number }[]; itemCount: number; subtotal: number; shipping: number; total: number }
  }
  const min = await receipt('박민수')
  expect([min.lines.map((l) => [l.no, l.name, l.price]), min.itemCount]).toEqual([[[22, '반팔티 105/검정색 (17,000원 × 2개)', 34000]], 2])
  const hong = await receipt('홍길동')
  expect([hong.lines.map((l) => [l.no, l.name, l.price]), hong.subtotal, hong.shipping, hong.total]).toEqual([[[21, '반바지 L (10,000원 × 2개)', 20000]], 20000, 4000, 24000])

  // ── AC-O4-18 포장 라벨 항목 ──
  const pl = await packingLabelData(page, date, idOf('박민수'))
  expect(pl.data.broadcasts).toEqual([{ title: '의류 1부', numbers: [{ no: 22, variant: '105/검정색', qty: 2 }] }])
  await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(idOf('홍길동'))}`)
  const cl = page.getByRole('region', { name: '체크리스트' })
  await expect(cl.getByRole('checkbox')).toHaveCount(1)
  await expect(cl.getByRole('checkbox', { name: '21번 반바지 L 2개' })).toBeVisible()
})
