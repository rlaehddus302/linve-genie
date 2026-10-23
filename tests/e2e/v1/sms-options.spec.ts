// V1 음성 문자찜 — 옵션 방송 (AC-V1-28, R-21 8, D-V1-08) — test-e2e.
import { test, expect } from '@playwright/test'
import { installSmsSpeech, login, recordRequests, smsCard, smsResults, smsWrites, speak, turnOnVoice, heardCard } from './support.ts'
import { SIZES, openOptionBroadcast, registerOptions, waitClaims } from '../o2/support.ts'

test('AC-V1-28: 옵션 방송 "반바지 M 2개 문자찜 끝자리 1234" → 21번 반바지 M 2개 카드 → options·qty로 넣기, "21번 문자찜"은 OPTION_UNCLEAR', async ({ page }) => {
  await installSmsSpeech(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const { b, date } = await openOptionBroadcast(page, { rehearsal: true })
  await registerOptions(page, b, { no: 21, name: '반바지', price: 10000, options: SIZES, stock: 5 })
  await turnOnVoice(page)
  const requests = recordRequests(page)
  const short = '21번 반바지 M 2개 · 끝자리 1234 · 문자찜'
  await speak(page, '반바지 M 2개 문자찜 끝자리 1234')
  await expect(smsCard(page, short)).toBeVisible()
  await expect(smsCard(page, short).getByText('3초 뒤 넣어요')).toBeVisible()
  await expect(smsResults(page, short)).toHaveText(/^21번 .*M.* · 문자찜 · 1등/, { timeout: 10_000 })
  const writes = smsWrites(requests)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ type: 'sms', b, no: 21, qty: 2, options: { 사이즈: 'M' }, last4: '1234' })
  const claims = await waitClaims(page, date, true, b, 1)
  expect(claims[0]!.qty).toBe(2)
  await speak(page, '21번 문자찜')
  await expect(heardCard(page, '21번 문자찜').getByRole('alert')).toHaveText("상품·옵션을 못 알아들었어요. '반바지 M 2개 문자찜'처럼 다시 말해 주세요.")
  await expect(heardCard(page, '21번 문자찜').getByRole('button')).toHaveText(['닫기'])
  expect(smsWrites(requests)).toHaveLength(1)
})
