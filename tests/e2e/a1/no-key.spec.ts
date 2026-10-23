// A1 키 없는 서버(기본 묶음)·번호로만 받는 판매자·개인정보처리방침 (AC-A1-22·23·24, CMT-07) — test-e2e.
// 기본 묶음 서버는 AI 키가 없다: 규칙 제안은 늘 붙고, 설정엔 "지금은 쓸 수 없어요."만, 외부 호출 0.
import { expect, test } from '@playwright/test'
import { SOURCE_RULE, SWITCH, UNAVAILABLE, assistWorld, chat, createBroadcast, loginNewSeller, openReviews, reviewLine, waitReviews } from './support.ts'

test('AC-A1-22·02: 키 없는 서버 — 옵션 판매자의 설정 칸은 "지금은 쓸 수 없어요."만, 규칙 제안은 그대로 보이고 AI 문장·링크 없음', async ({ page }) => {
  const { b, outbound } = await assistWorld(page)
  await page.goto('/settings')
  const region = page.getByRole('region', { name: 'AI 제안' })
  await expect(region).toContainText(UNAVAILABLE)
  await expect(region.getByRole('switch', { name: SWITCH })).toHaveCount(0)
  await expect(region.getByRole('checkbox')).toHaveCount(0)
  const put = await page.request.put('/api/assist/settings', { data: { enabled: true, consent: true }, headers: { Origin: new URL(page.url()).origin } })
  expect(put.status()).toBe(409)
  await chat(page, b, '김철수', '반바지 미디엄')
  await waitReviews(page, b, true, 1)
  await openReviews(page, b, true)
  await expect(reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_RULE)
  await expect(page.getByRole('link', { name: '설정에서 AI 제안을 켤 수 있어요.' })).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText(/AI가 읽는 중|AI 제안을 지금 받지 못했어요|오늘 AI 제안을 다 썼어요/)
  expect(outbound).toEqual([])
})

test('AC-A1-22 CMT-07: 번호로만 받는 판매자(옵션 방송 없음)의 설정엔 AI 제안 칸이 없고 /api/assist/*를 부르지 않는다', async ({ page }) => {
  const assistCalls: string[] = []
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/assist/')) assistCalls.push(r.url()) })
  await loginNewSeller(page)
  const asked = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/option-broadcasts/exists')
  await page.goto('/settings')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await asked // 칸을 보일지 정하는 조회가 끝난 뒤에 본다
  await expect(page.getByRole('region', { name: 'AI 제안' })).toHaveCount(0)
  expect(assistCalls).toEqual([])
})

test('AC-A1-21: 번호로만 받는 판매자의 확인 필요 화면 — AI 제안 링크·문장 없음', async ({ page }) => {
  await loginNewSeller(page)
  await page.goto('/reviews')
  await expect(page.getByRole('heading', { name: '확인 필요', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: '설정에서 AI 제안을 켤 수 있어요.' })).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText(/AI/)
})

test('AC-A1-23·24: /privacy "AI 제안(선택)" — 켠 경우만·닉네임·전화번호 뺀 글·Anthropic(미국)·따로 저장하지 않음·언제든 끌 수 있음, 초안 표시', async ({ page }) => {
  await page.goto('/privacy')
  const region = page.getByRole('region', { name: /AI 제안\(선택\)/ })
  await expect(region).toBeVisible()
  await expect(region).toContainText('켠 경우에만')
  await expect(region).toContainText('닉네임·전화번호')
  await expect(region).toContainText('Anthropic(미국)')
  await expect(region).toContainText(/저장하지 않/)
  await expect(region).toContainText('언제든')
  await expect(page.getByText('초안이에요. 법률 검토 전이라 실제 서비스 전에 바뀔 수 있어요.')).toBeVisible()
  await expect(region).not.toContainText(/RULE|LIMIT|token|model|Anthropic API/)
})

test('AC-A1-22: 판매 방식은 "번호로만"이어도 옵션 방송 기록이 있으면 AI 제안 칸이 보인다', async ({ page }) => {
  await loginNewSeller(page)
  await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS' })
  await page.goto('/settings')
  await expect(page.getByRole('region', { name: 'AI 제안' })).toContainText(UNAVAILABLE)
})
