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
  openExtras,
  openVoiceLog,
  voiceLogItems,
  withoutVoiceHeard,
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
  // V3 교체(D-V3-54): "십 오번"은 앞 수와 합쳐 15번 — 끊어 말해 비우는 꼴은 자리가 겹치는 "5 13번"(AC-V3-65)
  await speak(page, '5 13번 라울 오천 원')
  await openVoiceLog(page)
  await expect(voiceLogItems(page).first()).toContainText('5 13번 라울 오천 원')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '음성 기록' })).toHaveCount(0)
  await expect(cardList(page)).toHaveCount(0)
  // ④ "확인 필요" 카드 → 등록 누르기
  await speak(page, '16번 핑크푸릴 만원')
  const c16 = card(page, '16번 핑크프릴 10,000원')
  await expect(c16.getByText('확인 필요')).toBeVisible()
  await cardButton(page, '16번 핑크프릴 10,000원', '등록').click()
  await expect(boardItem(page, 16)).toBeVisible()
  // ⑤ V3 교체(D-V3-41): 번호 없는 말은 카드가 되지 않으므로, 빈 칸 채우기는 번호만 카드(가격 없음)로 — 고치기 칸 가격 15(=15,000원) → Enter
  await speak(page, '핑크프릴 만오천 원')
  await expect(card(page, '번호 없음 핑크프릴 15,000원')).toHaveCount(0)
  await speak(page, '17번 핑크프릴')
  await cardButton(page, '17번 핑크프릴 가격 없음', '고치기').click()
  const form = page.getByRole('group', { name: '17번 핑크프릴 가격 없음 고치기 칸' })
  await expect(form.getByLabel('가격')).toBeFocused()
  await form.getByLabel('가격').fill('15')
  await form.getByLabel('가격').press('Enter')
  await expect(boardItem(page, 17)).toBeVisible()
  // ⑥ 이미 있는 번호 → V3 교체(D-V3-06·D-V3-22 b): 카드·창 없이 R-22 묻기(설정 끔), "그대로 두기"로 바꾸지 않음
  await speak(page, '15번 라울 만원')
  // 덩어리가 끝날 때까지(조용한 시간) — 설정은 말한 때를 따르므로(D-V3-35) 다음 덩어리 전에 끝낸다
  await expect(page.getByRole('region', { name: '지금 들리는 말', exact: true })).not.toContainText('듣는 중…')
  const ask = page.getByRole('list', { name: '방금 등록한 상품 고치기' }).getByRole('listitem', { name: /^15번을 고칠까요\? / })
  await expect(ask).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await ask.getByRole('button', { name: '그대로 두기' }).click()
  await expect(ask).toHaveCount(0)
  await expect(input).toHaveValue('')
  // ⑦ V3 교체(D-V3-01·D-V3-22 b): 자동 확정(5초 기다림)이 "번호와 가격이 들리면 바로 등록"이 됐다 — 켬 → 기다림 없이 등록 → Ctrl+Z
  await (await openExtras(page)).getByRole('checkbox', { name: '번호와 가격이 들리면 바로 등록' }).check()
  await input.focus()
  await speak(page, '18번 블루엘프 칠천 원')
  await expect(boardItem(page, 18)).toBeVisible()
  await expect(page.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.getByText('18번 등록을 되돌렸어요(판매 종료)')).toBeVisible()
  // ⑧ (D-V3-02·44: 바로 등록을 끄면 '원'이 없는 말은 카드) 음성 끄기 → 기다려도 등록 없음 → 등록 누르기
  await expect(page.getByRole('region', { name: '지금 들리는 말', exact: true })).not.toContainText('듣는 중…')
  await (await openExtras(page)).getByRole('checkbox', { name: '번호와 가격이 들리면 바로 등록' }).uncheck()
  await input.focus()
  await speak(page, '19번 라울 만')
  const c19 = card(page, '19번 라울 10,000원')
  await expect(c19).toBeVisible()
  await expect(c19.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
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
  for (const word of ['안녕하세요', '5 13번', '만오천', '핑크푸릴', '칠천', '만원']) {
    for (const r of requests) {
      expect(decodeURIComponent(r.url)).not.toContain(word)
      // D-V3-73: voiceLog.heard 한 줄(가린 들은 말)만 예외 — 그 밖의 칸에 받아쓴 글이 없다
      expect(withoutVoiceHeard(r.body)).not.toContain(word)
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
