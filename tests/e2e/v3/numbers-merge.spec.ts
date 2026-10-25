// V3 번호 둘이면 막기(AC-V3-25, D-V3-05)·열린 카드 합치기(AC-V3-27, D-V3-08)·이어 채우기 뒤 바로 등록(AC-V3-28).
import { test, expect } from '@playwright/test'
import {
  boardItem,
  card,
  cardButton,
  notice,
  openLog,
  productWrites,
  recordWrites,
  sayChunk,
  sayWords,
  settle,
  setupV3,
  voiceCards,
  QUIET_MS,
} from './support.ts'

const BROADCAST_6 = '어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요'

test('AC-V3-25 R7: 실제 방송 6(189번인데 … 139번) → 쓰기 0, 카드 하나 "번호 없음 빅뱅금 500,000원" + "번호 확인 필요 · 들린 번호: 189·139"', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, BROADCAST_6)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(voiceCards(page)).toHaveCount(1)
  const c = card(page, '번호 없음 빅뱅금 500,000원')
  await expect(c).toBeVisible()
  await expect(c.getByText('번호 확인 필요 · 들린 번호: 189·139')).toBeVisible()
  // "등록" → 고치기 칸이 열려 번호 칸에 커서
  await cardButton(page, '번호 없음 빅뱅금 500,000원', '등록').click()
  const form = page.getByRole('group', { name: '번호 없음 빅뱅금 500,000원 고치기 칸' })
  await expect(form).toBeVisible()
  await expect(form.getByLabel('번호', { exact: true })).toBeFocused()
  expect(productWrites(writes)).toEqual([])
})

test('AC-V3-25 R26: "189번 빅뱅금 50만 원 139번" → 결과 4에서 189번 등록 하나, 덩어리 끝 다른 번호 알림이 "알겠어요"까지 남음', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayWords(page, '189번 빅뱅금 50만 원 139번', {
    afterEach: async (k) => {
      if (k === 4) await expect.poll(() => productWrites(writes)).toEqual([['product.register', 189, '빅뱅금', 500000]])
    },
  })
  await page.clock.runFor(QUIET_MS + 100)
  const other = notice(page, '189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요.')
  await expect(other).toBeVisible()
  await expect(boardItem(page, 139)).toHaveCount(0)
  await page.clock.runFor(30_000)
  await expect(other).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.register', 189, '빅뱅금', 500000]])
  await other.getByRole('button', { name: '알겠어요' }).click()
  await expect(other).toHaveCount(0)
})

test('AC-V3-27 R22·R23: 열린 15번 카드에 "15번 핑크문 만오천" → 카드 한 장(핑크문), 이어 "15번 만오천 원" → 그 카드가 사라지고 등록 하나', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 핑크프릴 만오천')
  await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
  await page.clock.runFor(1000)
  await sayChunk(page, '15번 핑크문 만오천')
  await expect(voiceCards(page)).toHaveCount(1)
  await expect(card(page, '15번 핑크문 15,000원')).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await page.clock.runFor(1000)
  await sayWords(page, '15번 만오천 원', {
    afterEach: async (k) => {
      if (k === 3) await expect.poll(() => productWrites(writes)).toEqual([['product.register', 15, '핑크문', 15000]])
    },
  })
  await expect(voiceCards(page)).toHaveCount(0)
  await page.clock.runFor(QUIET_MS + 100)
  await expect(boardItem(page, 15)).toContainText('핑크문')
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.register', 15, '핑크문', 15000]])
})

test('TE-V3-003 AC-V3-27 R24: 고치기 칸으로 손댄 15번 카드에 "15번 루비 이만 원" → 카드 값 그대로·카드 늘지 않음, 기록 "고치는 중인 카드라 바꾸지 않았어요"', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 핑크프릴 만오천')
  await cardButton(page, '15번 핑크프릴 15,000원', '고치기').click()
  const form = page.getByRole('group', { name: '15번 핑크프릴 15,000원 고치기 칸' })
  await expect(form).toBeVisible()
  // 손댐: 가격 칸을 같은 값으로 다시 적는다
  await form.getByLabel('가격', { exact: true }).fill('15000')
  await page.clock.runFor(1000)
  await sayChunk(page, '15번 루비 이만 원')
  await expect(voiceCards(page)).toHaveCount(1)
  await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await page.keyboard.press('Escape')
  const dlg = await openLog(page)
  await expect(dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem').first()).toContainText('고치는 중인 카드라 바꾸지 않았어요')
})

test('AC-V3-28 R25: "15번"(덩어리 하나) 뒤 4초에 "엘레강스 이만원" → 둘째 덩어리 끝에 15번 엘레강스 20,000원 등록 하나, 카드 사라짐', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번')
  await expect(card(page, '15번 품종 미입력 가격 없음')).toBeVisible()
  await page.clock.runFor(4000 - QUIET_MS - 100)
  await sayChunk(page, '엘레강스 이만원')
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 15, '엘레강스', 20000]])
  await expect(voiceCards(page)).toHaveCount(0)
  await expect(boardItem(page, 15)).toContainText('20,000원')
})
