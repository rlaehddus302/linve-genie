// V3 번호 둘이면 막기(AC-V3-25, D-V3-05)·열린 카드 합치기(AC-V3-27, D-V3-08)·이어 채우기 뒤 바로 등록(AC-V3-28).
import { test, expect } from '@playwright/test'
import {
  boardItem,
  card,
  cardButton,
  openLog,
  productWrites,
  readout,
  recordWrites,
  sayChunk,
  sayWords,
  settle,
  notices,
  undoBar,
  GAP_MS,
  speak,
  setupV3,
  voiceCards,
  QUIET_MS,
} from './support.ts'

const BROADCAST_6 = '어 자 요거 지금 189번인데 뿌리가 있습니다 뿌리 있는데 컵이 너무 잘 들었어요 빅뱅 금 139번 얘 50만 원 들어요'

// D-V3-46이 D-V3-05 "막음"을 대신함: 원 가격 바로 앞 139번과 짝, 앞의 189번은 버리고 덩어리 끝에 4초 안내(등록 안내 4초 다음 차례 — D-V3-61)
test('TE-V3-013 AC-V3-25 R7 (D-V3-46): 실제 방송 6 → 결과 19(원)에서 139번 빅뱅금 500,000원 등록 하나, 덩어리 끝 4초 "139번으로 등록했는데 189번도 들렸어요…"', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayWords(page, BROADCAST_6, {
    afterEach: async (k) => {
      if (k === 19) await expect.poll(() => productWrites(writes)).toEqual([['product.register', 139, '빅뱅금', 500000]])
    },
  })
  await page.clock.runFor(QUIET_MS + 100)
  const OTHER = '139번으로 등록했는데 189번도 들렸어요. 맞는지 확인해 주세요.'
  await page.clock.runFor(2500)
  await expect(readout(page)).toHaveText(OTHER)
  await expect(page.getByRole('button', { name: '알겠어요' })).toHaveCount(0)
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.register', 139, '빅뱅금', 500000]])
  await expect(voiceCards(page)).toHaveCount(0)
  await expect(boardItem(page, 189)).toHaveCount(0)
  const dlg = await openLog(page)
  await expect(dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem').filter({ hasText: '189번도 들렸어요' })).toHaveCount(1)
})

test('AC-V3-25 R26 (D-V3-45): "189번 빅뱅금 50만 원 139번" → 결과 4에서 189번 등록 하나, 덩어리 끝 큰 글자 칸 4초 안내(단추 없음)·음성 기록, 5초 되돌리기 띠 그대로', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayWords(page, '189번 빅뱅금 50만 원 139번', {
    afterEach: async (k) => {
      if (k === 4) await expect.poll(() => productWrites(writes)).toEqual([['product.register', 189, '빅뱅금', 500000]])
    },
  })
  await page.clock.runFor(QUIET_MS + 100)
  const OTHER = '189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요.'
  // 등록 뒤 5초 되돌리기 띠는 그대로
  await expect(undoBar(page).getByRole('button', { name: '189번 등록 되돌리기' })).toBeVisible()
  // 4초 안내는 차례로(D-V3-61): 결과 4의 "등록했어요" 4초가 끝난 뒤 다른 번호 안내 4초
  await page.clock.runFor(2000)
  await expect(readout(page)).toHaveText(OTHER)
  await expect(page.getByRole('button', { name: '알겠어요' })).toHaveCount(0)
  await expect(notices(page).getByRole('listitem', { name: OTHER })).toHaveCount(0)
  await expect(boardItem(page, 139)).toHaveCount(0)
  await page.clock.runFor(3500)
  await expect(readout(page)).toHaveText(OTHER)
  await page.clock.runFor(1000)
  await expect(readout(page).filter({ hasText: OTHER })).toHaveCount(0)
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.register', 189, '빅뱅금', 500000]])
  const dlg = await openLog(page)
  await expect(dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem').filter({ hasText: '139번도 들렸어요' })).toHaveCount(1)
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

test('TE-V3-014 AC-V3-28·72 R51 (켬, D-V3-67): "15번" 뒤 4초에 "엘레강스 이만원" → 기다리는 번호로 이만원 때 15번 엘레강스 20,000원 바로 등록, 기록 "이어 받음"', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번')
  await expect(voiceCards(page)).toHaveCount(0)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await page.clock.runFor(4000 - QUIET_MS - 100)
  await sayWords(page, '엘레강스 이만원')
  // 표: 둘째 덩어리의 '이만원' 때 (조용한 시간 전)
  await expect.soft(async () => expect(productWrites(writes)).toEqual([['product.register', 15, '엘레강스', 20000]])).toPass({ timeout: 5000 })
  await page.clock.runFor(QUIET_MS + 100)
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 15, '엘레강스', 20000]])
  await expect(voiceCards(page)).toHaveCount(0)
  expect(productWrites(writes)).toHaveLength(1)
  const dlg = await openLog(page)
  await expect(dlg.getByRole('list', { name: '음성 기록 목록' })).toContainText('이어 받음')
})

test('TE-V3-014 AC-V3-72 R74·R76 (D-V3-67): "15번" 뒤 4초에 "16번 2만 원" → 16번 등록과 카드 "15번 가격을 못 들었어요"(가격 칸·등록·닫기), 이어 "15번 만오천 원" → 그 카드로 등록', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번')
  await page.clock.runFor(4000 - QUIET_MS - 100)
  await sayChunk(page, '16번 2만 원')
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 16, '', 20000]])
  const missed = voiceCards(page).filter({ hasText: '15번 가격을 못 들었어요' })
  await expect(missed).toHaveCount(1)
  await expect(missed.getByRole('textbox')).toBeVisible()
  await expect(missed.getByRole('button', { name: /등록$/ })).toBeVisible()
  await expect(missed.getByRole('button', { name: /닫기$/ })).toBeVisible()
  await page.clock.runFor(1000)
  await sayChunk(page, '15번 만오천 원')
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 16, '', 20000], ['product.register', 15, '', 15000]])
  await expect(missed).toHaveCount(0)
})

test('TE-V3-014 AC-V3-72 R75 (D-V3-67): "15번" 뒤 61초에 "이만 원" → 등록 없음, 61초 때 카드 "15번 가격을 못 들었어요"', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번')
  await page.clock.runFor(61_000 - QUIET_MS - 100)
  await expect(voiceCards(page).filter({ hasText: '15번 가격을 못 들었어요' })).toHaveCount(1)
  await sayChunk(page, '이만 원')
  await settle(page)
  expect(productWrites(writes)).toEqual([])
})
