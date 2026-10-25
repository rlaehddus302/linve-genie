// I3 — 30일 봉인 예고·봉인된 날짜 (기본 묶음). AC-I3-40·41·96·20
import { expect, test, type Page } from '@playwright/test'
import { e2eDate, loginAs, newSeller, openRealBroadcast, sealNow } from './support.ts'

const SEAL_WARNING = '30일이 지나면 채팅 내용을 지우고 기록을 봉인해요. 그 뒤로는 입금·배송비 같은 기록을 고칠 수 없어요. 그 전에 정산을 마쳐 주세요.'
const SEALED = '30일이 지나 봉인한 날짜예요. 볼 수만 있어요.'

async function sellerIn(page: Page) {
  const seller = await newSeller(page.request)
  await loginAs(page, seller, '/settings')
  await page.request.put('/api/wizard', { data: { status: 'DONE' }, headers: { Origin: new URL(page.url()).origin } })
  return seller
}

test('AC-I3-40: 봉인 7일 전 날짜 — 방송 목록·정산·구매자에 "… 0시부터 잠겨요. 그 뒤로는 고칠 수 없어요."와 경고 상자, 봉인 예정만인 날짜는 경고 상자 없음', async ({ page }) => {
  const seller = await sellerIn(page)
  const soon = await e2eDate(page.request, seller.loginId, 'sealSoon')
  const later = await e2eDate(page.request, seller.loginId, 'youtube')
  await page.goto('/')
  const rows = page.getByRole('main').getByRole('listitem')
  const soonRow = rows.filter({ hasText: new RegExp(`${String(Number(soon.date.slice(5, 7)))}월 ${String(Number(soon.date.slice(8, 10)))}일`) })
  await expect(soonRow.first()).toContainText(/이 날짜 기록은 \d+월 \d+일 0시부터 잠겨요\. 그 뒤로는 고칠 수 없어요\./) // QL3R1 D-QL3R1-07
  await expect(soonRow.first()).toContainText(SEAL_WARNING)
  const laterRow = rows.filter({ hasText: new RegExp(`${String(Number(later.date.slice(5, 7)))}월 ${String(Number(later.date.slice(8, 10)))}일`) })
  await expect(laterRow.first()).toContainText(/이 날짜 기록은 \d+월 \d+일 0시부터 잠겨요\. 그 뒤로는 고칠 수 없어요\./) // QL3R1 D-QL3R1-07
  await expect(page.getByRole('main')).not.toContainText('봉인돼요') // QL3R1 D-QL3R1-07
  await expect(laterRow.first()).not.toContainText(SEAL_WARNING)
  await page.goto(`/settlements?date=${soon.date}`)
  await expect(page.getByRole('main')).toContainText(/이 날짜 기록은 \d+월 \d+일 0시부터 잠겨요\. 그 뒤로는 고칠 수 없어요\./) // QL3R1 D-QL3R1-07
  await expect(page.getByRole('main')).not.toContainText('봉인돼요') // QL3R1 D-QL3R1-07
  await expect(page.getByRole('main')).toContainText(SEAL_WARNING)
  await page.goto(`/buyers?date=${soon.date}`)
  await expect(page.getByRole('main')).toContainText(/이 날짜 기록은 \d+월 \d+일 0시부터 잠겨요\. 그 뒤로는 고칠 수 없어요\./) // QL3R1 D-QL3R1-07
  await expect(page.getByRole('main')).not.toContainText('봉인돼요') // QL3R1 D-QL3R1-07
})

test('AC-I3-41: 봉인된 날짜 — 콘솔 안내·빠른 입력 잠금·채팅 칸 서버 문장, 문자찜 방송 고르기에 없음', async ({ page }) => {
  const seller = await sellerIn(page)
  const sealed = await e2eDate(page.request, seller.loginId, 'sealed')
  await page.goto(`/broadcasts/${encodeURIComponent(sealed.broadcast)}`)
  await expect(page.getByRole('main')).toContainText(SEALED)
  await expect(page.getByRole('main')).toContainText('30일이 지나 채팅 내용을 지웠어요.')
  await expect(page.getByLabel('빠른 입력')).toHaveCount(0) // MOB1 D-MOB1-09 (봉인 날짜는 빠른 입력 줄이 없다 — 등록할 수 없는 것은 그대로)
  await page.goto(`/settlements?date=${sealed.date}`)
  await expect(page.getByRole('main')).toContainText(SEALED)
  await page.goto('/sms')
  await expect(page.getByRole('region', { name: '고른 방송' })).not.toContainText('지난 방송')
  const pick = page.getByRole('region', { name: '고른 방송' }).getByRole('button', { name: /^방송 (바꾸기|고르기)$/ })
  await pick.click()
  await expect(page.getByRole('dialog', { name: '방송 고르기' }).getByRole('button', { name: /^지난 방송 ·/ })).toHaveCount(0)
})

test('AC-I3-41: 그 날짜를 연 채 봉인되면 1초 안에 봉인 화면, 그 뒤 10초 동안 증분 조회 1번 이하', async ({ page }) => {
  const seller = await sellerIn(page)
  const day = await e2eDate(page.request, seller.loginId, 'youtube')
  await page.goto(`/broadcasts/${encodeURIComponent(day.broadcast)}`)
  await expect(page.getByLabel('빠른 입력')).toBeEnabled()
  const changes: number[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === `/api/days/${day.date}/changes`) changes.push(Date.now())
  })
  const start = Date.now()
  await sealNow(page.request, seller.loginId, day.date)
  await expect(page.getByRole('main')).toContainText(SEALED, { timeout: 1500 })
  await expect(page.getByLabel('빠른 입력')).toHaveCount(0) // MOB1 D-MOB1-09 (봉인 날짜는 빠른 입력 줄이 없다 — 등록할 수 없는 것은 그대로)
  await page.waitForFunction((end) => Date.now() >= end, start + 10_000, { timeout: 20_000 })
  expect(changes.filter((t) => t >= start).length).toBeLessThanOrEqual(1)
})

test('AC-I3-96·20: 유튜브 준비 안 된 서버 — 콘솔 유튜브 칸은 한 줄, 알림 띠에 감사 실패 없음, 리허설은 유튜브 요청 없음', async ({ page }) => {
  await sellerIn(page)
  await openRealBroadcast(page, { title: '준비 안 됨' })
  const yt = page.getByRole('region', { name: '유튜브', exact: true })
  await expect(yt).toContainText('유튜브 연동을 준비하지 않은 서버예요.')
  await expect(yt.getByRole('button', { name: /잇기|내 라이브/ })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '알림' }).getByRole('button', { name: /감사 실패/ })).toHaveCount(0)
  const ytRequests: string[] = []
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname
    if (path.startsWith('/api/youtube') || path.includes('/outbox') || path.includes('youtube-notices')) ytRequests.push(path)
  })
  await page.goto('/')
  await page.getByRole('button', { name: '리허설 해 보기' }).click()
  await expect(page.getByText('리허설 중 — 실제 판매가 아니에요')).toBeVisible()
  await expect(page.getByRole('region', { name: '유튜브', exact: true })).toContainText('리허설 방송은 유튜브와 잇지 않아요. 가짜 채팅으로 연습해요.')
  await page.getByRole('region', { name: '유튜브', exact: true }).getByRole('button', { name: '감사 메시지' }).click()
  await expect(page.getByRole('dialog', { name: '감사 메시지' })).toContainText('리허설 감사 메시지는 유튜브에 올리지 않아요.')
  expect(ytRequests).toEqual([])
})
