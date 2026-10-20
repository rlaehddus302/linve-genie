// I4 4단계 완료 기준 — 음성 등록 끝까지 + 음성 꺼도 전 기능 정상 (AC-I4-90) — test-e2e.
// 기대값(보드·이력)은 acceptance AC-I4-90 문장에서 손으로 정했다.
import { test, expect } from '@playwright/test'
import {
  board,
  boardItem,
  card,
  cardButton,
  cardList,
  history,
  installFakeSpeech,
  login,
  openNewBroadcast,
  recordRequests,
  register,
  speak,
  turnOnVoice,
  uniqueDate,
  untilElapsed,
  voiceRegion,
} from './support.ts'

test('AC-I4-90: 음성 등록 끝까지(①~⑧) — 보드·범위 이력·실제 범위·요청 맞대기, 끈 뒤 빠른 입력·찾기·되돌리기', async ({ page }) => {
  test.setTimeout(180_000)
  await installFakeSpeech(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  const requests = recordRequests(page)
  await login(page)
  const date = uniqueDate()
  await openNewBroadcast(page, { date, rehearsal: true })
  await turnOnVoice(page, { consent: true })
  const input = page.getByLabel('빠른 입력')

  // ① 잡담 → 카드 없음
  await speak(page, '안녕하세요 여러분')
  // ② Enter로 등록
  await speak(page, '15번 핑크프릴 만오천 원')
  const c15 = card(page, '15번 핑크프릴 15,000원')
  await expect(c15.getByText('Enter 등록', { exact: true })).toBeVisible()
  await input.press('Enter')
  await expect(boardItem(page, 15)).toBeVisible()
  await expect(cardList(page)).toHaveCount(0)
  // ③ 끊어 말한 번호 → 카드 없음
  await speak(page, '십 오번 라울 오천 원')
  await page.getByRole('region', { name: '음성 설정과 기록' }).getByText('들린 말 기록').click()
  await expect(page.getByRole('region', { name: '음성 설정과 기록' }).getByRole('listitem').first()).toHaveText('십 오번 라울 오천 원')
  await expect(cardList(page)).toHaveCount(0)
  // ④ "확인 필요" 카드 → 등록 누르기
  await speak(page, '16번 핑크푸릴 만원')
  const c16 = card(page, '16번 핑크프릴 10,000원')
  await expect(c16.getByText('확인 필요')).toBeVisible()
  await cardButton(page, '16번 핑크프릴 10,000원', '등록').click()
  await expect(boardItem(page, 16)).toBeVisible()
  // ⑤ 번호 없음 → 고치기 칸 번호 17 → Enter
  await speak(page, '핑크프릴 만오천 원')
  await cardButton(page, '번호 없음 핑크프릴 15,000원', '고치기').click()
  const form = page.getByRole('group', { name: '번호 없음 핑크프릴 15,000원 고치기 칸' })
  await expect(form.getByLabel('번호')).toBeFocused()
  await form.getByLabel('번호').fill('17')
  await form.getByLabel('번호').press('Enter')
  await expect(boardItem(page, 17)).toBeVisible()
  // ⑥ 이미 있는 번호 → "고칠까요?"에서 바꾸지 않고 닫기
  await speak(page, '15번 라울 만원')
  await cardButton(page, '15번 라울 10,000원', '등록').click()
  const ask = page.getByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: '아니요' }).click()
  await expect(ask).toHaveCount(0)
  await expect(input).toHaveValue('')
  // ⑦ 자동 확정 켬(5초) → 자동 등록 → Ctrl+Z
  await page.getByRole('region', { name: '음성 설정과 기록' }).getByRole('checkbox', { name: '확실한 카드는 자동으로 등록' }).check()
  await input.focus()
  await speak(page, '18번 블루엘프 칠천 원')
  await expect(card(page, '18번 블루엘프 7,000원').getByText(/초 뒤 자동 등록/)).toBeVisible()
  await expect(boardItem(page, 18)).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Control+z')
  await expect(page.getByText('18번 등록을 되돌렸어요(판매 종료)')).toBeVisible()
  // ⑧ 5초 전에 음성 끄기 → 기다림이 지나도 등록 없음 → 등록 누르기
  await speak(page, '19번 라울 만원')
  const c19 = card(page, '19번 라울 10,000원')
  await expect(c19.getByText(/초 뒤 자동 등록/)).toBeVisible()
  const since = await page.evaluate(() => Date.now())
  await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
  await untilElapsed(page, since, 6000)
  await expect(c19).toBeVisible()
  await expect(boardItem(page, 19)).toHaveCount(0)
  await cardButton(page, '19번 라울 10,000원', '등록').click()
  await expect(boardItem(page, 19)).toBeVisible()

  // 보드
  await expect(boardItem(page, 15)).toContainText('핑크프릴')
  await expect(boardItem(page, 15)).toContainText('15,000원')
  await expect(boardItem(page, 16)).toContainText('핑크프릴')
  await expect(boardItem(page, 16)).toContainText('10,000원')
  await expect(boardItem(page, 17)).toContainText('핑크프릴')
  await expect(boardItem(page, 17)).toContainText('15,000원')
  await expect(boardItem(page, 18)).toContainText('블루엘프')
  await expect(boardItem(page, 18)).toContainText('7,000원')
  await expect(boardItem(page, 18)).toContainText('판매 종료')
  await expect(boardItem(page, 19)).toContainText('라울')
  await expect(boardItem(page, 19)).toContainText('10,000원')
  await expect(board(page).getByRole('button', { name: /^\d+번 / })).toHaveCount(5)

  // 범위 이력: 등록 5 + 18번 판매 종료 1, 그 밖의 쓰기 없음
  const events = await history(page, date, true)
  const writes = events.filter((e) => e.type.startsWith('product.') || e.type === 'sms' || e.type.startsWith('claim'))
  expect(writes.map((e) => `${e.type}:${String(e.fields['no'])}`)).toEqual([
    'product.register:15',
    'product.register:16',
    'product.register:17',
    'product.register:18',
    'product.close:18',
    'product.register:19',
  ])
  const regs = writes.filter((e) => e.type === 'product.register').map((e) => [e.fields['no'], e.fields['name'], e.fields['price']])
  expect(regs).toEqual([
    [15, '핑크프릴', 15000],
    [16, '핑크프릴', 10000],
    [17, '핑크프릴', 15000],
    [18, '블루엘프', 7000],
    [19, '라울', 10000],
  ])
  // 실제 범위(같은 날짜)에는 아무것도 없다
  expect(await history(page, date, false)).toEqual([])
  // 인식 문장은 어느 요청에도 없다
  for (const word of ['안녕하세요', '십 오번', '만오천', '핑크푸릴', '칠천', '만원']) {
    for (const r of requests) {
      expect(decodeURIComponent(r.url)).not.toContain(word)
      expect(r.body).not.toContain(word)
    }
  }

  // 끈 뒤: 빠른 입력 등록·찾기·되돌리기
  await input.focus()
  await register(page, '20 라울 10', 20)
  await page.keyboard.press('Control+z')
  await expect(page.getByText('20번 등록을 되돌렸어요(판매 종료)')).toBeVisible()
  await input.fill('20')
  await input.press('Enter')
  await expect(page.getByRole('dialog').first()).toContainText('20번')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(input).toBeFocused()
})
