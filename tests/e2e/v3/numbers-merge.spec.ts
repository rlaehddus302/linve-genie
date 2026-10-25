// V3 번호 둘이면 막기(AC-V3-25, D-V3-05)·열린 카드 합치기(AC-V3-27, D-V3-08)·이어 채우기 뒤 바로 등록(AC-V3-28).
import { test, expect } from '@playwright/test'
import {
  boardItem,
  card,
  cardButton,
  notice,
  openLog,
  productWrites,
  readout,
  recordWrites,
  sayChunk,
  sayWords,
  settle,
  GAP_MS,
  speak,
  setupV3,
  voiceCards,
  QUIET_MS,
} from './support.ts'

const BROADCAST_6 = '어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요'

test('AC-V3-25·51 R7 (D-V3-41): 실제 방송 6(189번인데 … 139번) → 쓰기 0, 카드 0, 기록 "번호가 여럿 들렸어요: 189·139"와 큰 글자 칸 4초', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayWords(page, BROADCAST_6)
  await page.clock.runFor(QUIET_MS + 100)
  await expect(readout(page)).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(voiceCards(page)).toHaveCount(0)
  await page.clock.runFor(4000)
  await expect(readout(page)).toHaveCount(0)
  const dlg = await openLog(page)
  await expect(dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem').first()).toContainText('번호가 여럿 들렸어요: 189·139')
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

test('AC-V3-27 R22 (설정 끔): 열린 15번 카드에 "15번 핑크문 만오천" → 카드 한 장(핑크문), 이어 "15번 만오천 원"은 카드 값만·쓰기 0, 누르면 등록', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } }) // 설정 끔 (D-V3-44)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 핑크프릴 만오천')
  await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
  await page.clock.runFor(1000)
  await sayChunk(page, '15번 핑크문 만오천')
  await expect(voiceCards(page)).toHaveCount(1)
  await expect(card(page, '15번 핑크문 15,000원')).toBeVisible()
  await page.clock.runFor(1000)
  await sayChunk(page, '15번 만오천 원')
  await expect(voiceCards(page)).toHaveCount(1)
  await expect(card(page, '15번 핑크문 15,000원')).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await cardButton(page, '15번 핑크문 15,000원', '등록').click()
  await expect(boardItem(page, 15)).toContainText('핑크문')
  expect(productWrites(writes)).toEqual([['product.register', 15, '핑크문', 15000]])
})

test('TE-V3-003 AC-V3-27 R24 (설정 끔): 고치기 칸으로 손댄 15번 카드에 "15번 루비 이만 원" → 카드 값 그대로·카드 늘지 않음, 기록 "고치는 중인 카드라 바꾸지 않았어요"', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } }) // 설정 끔 (D-V3-44)
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

test('AC-V3-28 R25 (켬, D-V3-44): 한 덩어리 안 "15번 엘레강스" … 1.5초 쉼 … "이만원" → 이만원 때 등록 하나, 그 전엔 화면 카드 없음', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await speak(page, '15번', { final: false })
  await page.clock.runFor(GAP_MS)
  await speak(page, '15번 엘레강스')
  await page.clock.runFor(1500)
  await expect(voiceCards(page)).toHaveCount(0)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await speak(page, '이만원')
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 15, '엘레강스', 20000]])
  await expect(voiceCards(page)).toHaveCount(0)
  await page.clock.runFor(QUIET_MS + 100)
  await expect(boardItem(page, 15)).toContainText('20,000원')
  expect(productWrites(writes)).toEqual([['product.register', 15, '엘레강스', 20000]])
})

test('AC-V3-28 (설정 끔): "15번"(덩어리 하나) 뒤 4초에 "엘레강스 이만원" → V2 S3 그대로 카드가 채워지고 쓰기 0', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } }) // 설정 끔 (D-V3-44)
  const writes = recordWrites(page)
  await sayChunk(page, '15번')
  await expect(voiceCards(page)).toHaveCount(1)
  await page.clock.runFor(4000 - QUIET_MS - 100)
  await sayChunk(page, '엘레강스 이만원')
  await expect(voiceCards(page)).toHaveCount(1)
  await expect(card(page, '15번 엘레강스 20,000원')).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
})

test('AC-V3-28·51 R51 (켬, D-V3-44): "15번" 뒤 4초에 "엘레강스 이만원" → 쓰기 0, 카드 0, 기록 첫 덩어리 "가격을 못 들었어요"·둘째 "번호를 못 들었어요"', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번')
  await expect(voiceCards(page)).toHaveCount(0)
  await page.clock.runFor(4000 - QUIET_MS - 100)
  await sayChunk(page, '엘레강스 이만원')
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(voiceCards(page)).toHaveCount(0)
  const dlg = await openLog(page)
  const items = dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem')
  await expect(items.nth(0)).toContainText('번호를 못 들었어요')
  await expect(items.nth(1)).toContainText('가격을 못 들었어요')
})
