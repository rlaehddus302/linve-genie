// V1 통합 흐름 (AC-V1-60) — test-e2e. 음성 켜기 → "165번 문자찜 끝자리 1234"(3초 뒤 1등) → 같은 말 반복(카드 하나)
// → "166번 문자찜"(확인 필요 구매자) → 정산 화면 안내 → 합치기(화면) → 안내 사라짐.
import { test, expect } from '@playwright/test'
import { boardItem, history, recordRequests, registerApi, scopeView, setupLive, smsCard, smsResults, smsWrites, speak } from './support.ts'

test('AC-V1-60 · TE-V1-002: 음성 문자찜 처음부터 끝까지 — 저절로 1등·같은 말 한 번·확인 필요·정산 안내·합치기', async ({ page }) => {
  test.setTimeout(180_000)
  const { b, date } = await setupLive(page)
  for (const no of [165, 166]) await registerApi(page, b, no, '핑크프릴', 10000)
  await expect(boardItem(page, 166)).toBeVisible()
  const requests = recordRequests(page)

  const c165 = '165번 · 끝자리 1234 · 문자찜'
  await speak(page, '165번 문자찜 끝자리 1234')
  await expect(smsCard(page, c165).getByText(/^[1-3]초 뒤 넣어요$/)).toBeVisible()
  await speak(page, '165번 문자찜 끝자리 1234')
  await expect(smsCard(page, c165)).toHaveCount(1)
  await expect(smsCard(page, c165).getByText('같은 말을 한 번 더 들었어요')).toBeVisible()
  await expect(smsResults(page, c165)).toHaveText(/^165번 · 문자찜 · 1등 · 받은 시각 .* · 뒤 4자리 1234$/, { timeout: 10_000 })
  expect(smsWrites(requests)).toHaveLength(1)

  const c166 = '166번 · 손님 확인 필요 · 문자찜'
  await speak(page, '166번 문자찜')
  await expect(smsResults(page, c166)).toHaveText(/^166번 · 문자찜\(확인 필요\) · 1등 · /, { timeout: 10_000 })
  expect(smsWrites(requests)).toHaveLength(2)

  const view = await scopeView(page, date, false)
  const known = view.buyers.find((x) => x.phoneLast4 === '1234')!
  const unknown = view.buyers.find((x) => x.display === '문자찜(확인 필요)')!

  // 정산 화면 안내 → 링크 → 구매자 자세히에서 합치기
  await page.goto(`/settlements?date=${date}`)
  const notice = page.getByRole('region', { name: '구매자를 확인해 주세요' })
  await expect(notice.getByText('구매자를 확인해야 하는 문자찜이 1건 있어요.')).toBeVisible()
  await notice.getByRole('link', { name: /166번 구매자 확인하기$/ }).click()
  const detail = page.getByRole('region', { name: '구매자 자세히' })
  await expect(detail).toContainText('문자찜(확인 필요)')
  await detail.getByRole('button', { name: '다른 구매자와 합치기' }).click()
  const pick = page.getByRole('dialog', { name: '다른 구매자와 합치기' })
  await pick.getByLabel('합칠 구매자 찾기').fill('1234')
  await pick.getByRole('list', { name: '합칠 구매자' }).getByRole('button').first().click()
  const dlg = page.getByRole('dialog', { name: '구매자 합치기' })
  // 안내 링크가 연 화면 그대로(방향은 화면이 정한 대로) 사유 "같은 사람"으로 합친다
  await dlg.getByRole('button', { name: '1 같은 사람' }).click()
  await expect(dlg.getByRole('button', { name: '합치기', exact: true })).toBeEnabled()
  await dlg.getByRole('button', { name: '합치기', exact: true }).click()
  await expect(page.getByText('합쳤어요')).toBeVisible()
  const merges = (await history(page, date, false)).filter((e) => e.type === 'buyer.merge')
  expect(merges).toHaveLength(1)
  expect([merges[0]!.fields['from'], merges[0]!.fields['into']].sort()).toEqual([known.id, unknown.id].sort())

  // TE-V1-002: 확인 필요 구매자의 자세히에서 합치면 기본 방향이 "남는 이름: 문자찜(확인 필요)"라 합친 뒤에도 그 구매자가
  // 합쳐지지 않은 "문자찜(확인 필요)"로 남아 안내가 사라지지 않는다(알던 손님의 이름까지 "확인 필요"로 바뀐다).
  // AC-V1-29 "합치면 그 줄이 사라진다", AC-V1-60 "합치기 → 안내 사라짐".
  await page.goto(`/settlements?date=${date}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: '구매자를 확인해 주세요' }), 'TE-V1-002').toHaveCount(0)
  const after = await scopeView(page, date, false)
  expect(after.buyers.filter((x) => x.mergedInto === null && x.display === '문자찜(확인 필요)').map((x) => x.id), 'TE-V1-002').toEqual([])
})
