// QL2 AI 제안 문장 (AC-QL2-20·21, D-QL2-05 ①②) — 묶음 chromium-assist(@assist) · 개인정보 페이지 (AC-QL2-22, D-QL2-05 ③·D-QL2-06) — 기본 묶음. test-e2e.
// 유튜브 줄은 크롬 확장 경로(출처 extension — 유튜브와 같이 AI에 보내지 않음, AIY1 support). AI 제안 묶음엔 가짜 메타(인스타그램)가 없어
// "인스타그램 줄"은 E2E에서 만들 수 없다 — 유튜브로 뺀 항목이 없는 경우는 리허설 줄로 본다(acceptance AC-QL2-20 셋째 Given의 리허설 부분).
import { expect, test } from '@playwright/test'
import { assistWorld, chat, enableAssistApi, fakeLlm, openReviews, reviewList, reviewsExcluded, waitReviews, youtubeWorld, ytChat } from '../aiy1/support.ts'
import { ASSIST_NOTICE, OLD_ASSIST_NOTICE, YT_EXCLUDED } from './support.ts'

test.describe('AC-QL2-20 확인 필요 목록 위 한 줄', () => {
  test.beforeEach(async ({ request }) => {
    await fakeLlm(request, '/_fake/reset')
  })

  test('AI 켜짐 + 유튜브 줄(확인 필요 2) → 목록 위에 "유튜브 채팅은 AI에 보내지 않아요. 규칙 제안만 보여 드려요." 한 번 → AI 끄면 없다 @assist', async ({ page, request }) => {
    const { b, link } = await youtubeWorld(page, request)
    await ytChat(request, link, '김철수', '반바지 미디엄')
    await ytChat(request, link, '이영희', '반바지 엠사이즈')
    await waitReviews(page, b, false, 2)
    expect((await reviewsExcluded(page, b, false)).map((x) => x.excluded)).toEqual(['YOUTUBE_POLICY', 'YOUTUBE_POLICY'])
    await enableAssistApi(page)
    await openReviews(page, b, false)
    await expect(reviewList(page).getByRole('listitem')).toHaveCount(2)
    const line = page.getByText(YT_EXCLUDED, { exact: true })
    await expect(line).toHaveCount(1)
    await expect(line).toBeVisible()
    // 목록 위
    const lb = (await line.boundingBox())!
    const listBox = (await reviewList(page).boundingBox())!
    expect(lb.y + lb.height, '문장이 목록 위').toBeLessThanOrEqual(listBox.y + 0.5)

    // AI 끔 → 없다
    const off = await page.request.put('/api/assist/settings', { data: { enabled: false }, headers: { Origin: new URL(page.url()).origin } })
    expect(off.status(), await off.text()).toBe(200)
    await page.reload()
    await expect(reviewList(page).getByRole('listitem')).toHaveCount(2)
    await expect(page.getByText(YT_EXCLUDED)).toHaveCount(0)
  })

  test('AI 켜짐인데 유튜브로 뺀 항목 없음(리허설 줄만) → 문장이 없다 @assist', async ({ page }) => {
    const { b } = await assistWorld(page)
    await chat(page, b, '연습손님', '반바지 엠사이즈')
    await waitReviews(page, b, true, 1)
    expect((await reviewsExcluded(page, b, true)).map((x) => x.excluded)).toEqual([null])
    await enableAssistApi(page)
    await openReviews(page, b, true)
    await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
    await expect(page.getByText(YT_EXCLUDED)).toHaveCount(0)
  })
})

test('AC-QL2-21 설정 "AI 제안" 고지 글자 그대로, 옛 문장 없음, 이미 켠 판매자는 다시 동의 없이 켜져 있다 @assist', async ({ page }) => {
  await assistWorld(page)
  await page.goto('/settings')
  const region = page.getByRole('region', { name: 'AI 제안' })
  await expect(region).toBeVisible()
  await expect(region.getByText(ASSIST_NOTICE, { exact: true })).toBeVisible()
  await expect(page.getByText(OLD_ASSIST_NOTICE, { exact: true })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(OLD_ASSIST_NOTICE)
  // 이미 켠 판매자 (전에 동의함) — 다시 열어도 켜져 있다
  await enableAssistApi(page)
  await page.reload()
  await expect(region.getByRole('status')).toHaveText(/^켜져 있어요 · 오늘 \d+번 썼어요/)
  await expect(region.getByRole('button', { name: '끄기', exact: true })).toBeVisible()
  await expect(region.getByLabel('위 내용을 읽었고 동의해요')).toHaveCount(0)
  await expect(region.getByText(ASSIST_NOTICE, { exact: true })).toBeVisible()
})

test('AC-QL2-22 로그아웃 상태 /privacy: 14번 "AI 제안(선택)" 끝에 유튜브 줄, 6번 위탁 줄은 14번을 가리키고 "13번을 보세요"는 없다, 택배 "13번 참고"는 그대로', async ({ page }) => {
  await page.goto('/privacy')
  const ai = page.getByRole('region', { name: /^14\. AI 제안\(선택\)$/ })
  await expect(ai).toBeVisible()
  const items = (await ai.getByRole('listitem').allInnerTexts()).map((x) => x.trim())
  expect(items.at(-1)).toBe('유튜브에서 받은 채팅 글은 보내지 않아요.')
  const six = page.getByRole('region', { name: '6. 처리 위탁' })
  await expect(six.getByText("AI 제안(판매자가 켠 경우만): Anthropic(미국) — 14번 'AI 제안(선택)'을 보세요. [검토 필요]", { exact: true })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('13번을 보세요')
  await expect(page.getByRole('region', { name: '1. 처리하는 정보' })).toContainText('13번 참고')
  await expect(page.getByRole('region', { name: '5. 제3자 제공' })).toContainText('13번 참고')
})
