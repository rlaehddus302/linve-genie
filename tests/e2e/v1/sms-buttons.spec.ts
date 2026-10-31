// V1 음성 문자찜 — 버튼 자리·Esc 넣지 않기(AC-V1-32, D-V1-20), Ctrl+Z 알림(AC-V1-33, D-V1-22),
// 넣지 않기 뒤 같은 말은 새 카드(AC-V1-24 보강, D-V1-17), 품종 표시(D-V1-21) — test-e2e. 문장은 acceptance.md 그대로.
import { test, expect, type Locator } from '@playwright/test'
import {
  boardItem,
  heardCard,
  recordRequests,
  registerApi,
  setupLive,
  setupPaused,
  smsButton,
  smsCard,
  smsEvents,
  smsResults,
  smsWrites,
  speak,
} from './support.ts'

const C165 = '165번 핑크프릴 · 끝자리 1234 · 문자찜'
const C166 = '166번 핑크프릴 · 끝자리 5678 · 문자찜'
const C167 = '167번 핑크프릴 · 끝자리 1111 · 문자찜'
const C168 = '168번 핑크프릴 · 끝자리 2222 · 문자찜'
const TWO = '15번 핑크프릴 · 28번 핑크프릴 · 끝자리 1234 · 문자찜'

async function background(button: Locator): Promise<string> {
  return button.evaluate((el) => getComputedStyle(el).backgroundColor)
}

test.describe('V1 버튼 자리·단축키', () => {
  test('AC-V1-32: 기다리는 카드·번호 둘·이유 카드 모두 "넣지 않기"(이유는 "닫기")가 첫 버튼, 넣는 버튼만 주 버튼 색, PC는 기다리는 카드에 "Esc" 표시', async ({ page }) => {
    const { b } = await setupPaused(page)
    for (const no of [165, 15, 28]) await registerApi(page, b, no, '핑크프릴', 10000)
    await expect(boardItem(page, 28)).toBeVisible()
    await speak(page, '165번 문자찜 끝자리 1234')
    const waiting = smsCard(page, C165)
    await expect(waiting.getByText('3초 뒤 넣어요')).toBeVisible()
    await expect(waiting.getByRole('button')).toHaveText(['넣지 않기', '지금 넣기'])
    await expect(waiting.getByText('Esc', { exact: true })).toBeVisible()
    const skipBg = await background(smsButton(page, C165, '넣지 않기'))
    const sendBg = await background(smsButton(page, C165, '지금 넣기'))
    expect(sendBg).not.toBe(skipBg)

    await speak(page, '15번 28번 문자찜 끝자리 1234')
    const two = smsCard(page, TWO)
    await expect(two.getByText(`${TWO} — 넣을까요?`)).toBeVisible()
    await expect(two.getByRole('button')).toHaveText(['넣지 않기', '넣기'])
    expect(await background(smsButton(page, TWO, '넣기'))).toBe(sendBg)
    expect(await background(smsButton(page, TWO, '넣지 않기'))).toBe(skipBg)
    // 번호 둘 카드는 기다리는 카드가 아니라 Esc 표시가 없다
    await expect(two.getByText('Esc', { exact: true })).toHaveCount(0)

    await speak(page, '300번 문자찜')
    const reason = heardCard(page, '300번 문자찜')
    await expect(reason).toHaveAccessibleName('문자찜 · 넣지 않았어요 카드')
    await expect(reason.getByRole('alert')).toHaveText('300번 상품이 없어요.')
    await expect(reason.getByRole('button')).toHaveText(['닫기'])
    expect(await background(reason.getByRole('button'))).not.toBe(sendBg)
  })

  test('AC-V1-32: 휴대폰 폭은 기다리는 카드에 "Esc" 표시가 없고 "넣지 않기"가 먼저(위·왼쪽)', async ({ page }) => {
    const { b } = await setupPaused(page, { width: 375 })
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    await speak(page, '165번 문자찜 끝자리 1234')
    const c = smsCard(page, C165)
    await expect(c.getByText('3초 뒤 넣어요')).toBeVisible()
    await expect(c.getByRole('button')).toHaveText(['넣지 않기', '지금 넣기'])
    await expect(c.getByText('Esc', { exact: true })).toHaveCount(0)
    const skip = (await smsButton(page, C165, '넣지 않기').boundingBox())!
    const send = (await smsButton(page, C165, '지금 넣기').boundingBox())!
    // 같은 줄이면 왼쪽, 줄이 바뀌면 위
    expect(skip.y < send.y || (Math.abs(skip.y - send.y) < 1 && skip.x < send.x)).toBe(true)
  })

  // SRV1 (D-APP-22): 문자찜 기다림(3초)은 서버 음성 흐름의 실제 시계 타이머로 흐른다 — 페이지 시계를 멈춰도 서지 않는다.
  // 그래서 기다림을 10초로 두고(값만 바꿈 — Esc 뜻은 그대로, 3초 표시는 다른 V1 시험이 본다) 그 안에 Esc를 누르고, "닫은 카드는 넣지 않음"은 뒤에 말한 카드가 저절로 들어간 뒤(앞 카드들의 3초가 확실히 지난 뒤) 서버 기록으로 본다.
  test('AC-V1-32: PC·창 없음·빠른 입력칸이 비고 포커스 → Esc는 맨 앞(가장 새) 기다리는 카드만 닫고 그 뒤에도 쓰기 없음, 글자·창이 있으면 Esc는 그것 먼저, 번호 둘 카드는 닫지 않음', async ({ page }) => {
    // 페이지 시계를 멈추지 않는다(setupLive) — 남은 초 표시가 서버의 실제 기다림과 같은 시계로 흐르게
    const { b, date } = await setupLive(page, { smsSettings: { 'voice.smsListen': true, 'voice.smsAutoSec': 10 } })
    for (const no of [165, 166, 167, 168, 15, 28]) await registerApi(page, b, no, '핑크프릴', 10000)
    await expect(boardItem(page, 28)).toBeVisible()
    const quick = page.getByLabel('빠른 입력')
    await quick.focus()
    await speak(page, '165번 문자찜 끝자리 1234')
    await expect(smsCard(page, C165).getByText(/^\d+초 뒤 넣어요$/)).toBeVisible()
    await speak(page, '166번 문자찜 끝자리 5678')
    await expect(smsCard(page, C166).getByText(/^\d+초 뒤 넣어요$/)).toBeVisible()
    // "Esc" 표시는 맨 앞(가장 새) 카드에만
    await expect(smsCard(page, C166).getByText('Esc', { exact: true })).toBeVisible()
    await expect(smsCard(page, C165).getByText('Esc', { exact: true })).toHaveCount(0)
    await quick.focus()
    await page.keyboard.press('Escape')
    await expect(smsCard(page, C166)).toHaveCount(0)
    await expect(smsCard(page, C165)).toBeVisible()
    await expect(smsCard(page, C165).getByText('Esc', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(smsCard(page, C165)).toHaveCount(0)

    // 빠른 입력칸에 글자가 있으면 카드는 남는다
    await speak(page, '167번 문자찜 끝자리 1111')
    await expect(smsCard(page, C167).getByText(/^\d+초 뒤 넣어요$/)).toBeVisible()
    await quick.focus()
    await quick.fill('20 라울')
    await page.keyboard.press('Escape')
    await expect(smsCard(page, C167)).toBeVisible()
    await quick.fill('')

    // 창이 열려 있으면 Esc는 창을 닫고 카드는 남는다
    await speak(page, '168번 문자찜 끝자리 2222')
    await expect(smsCard(page, C168).getByText(/^\d+초 뒤 넣어요$/)).toBeVisible()
    await boardItem(page, 15).click()
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(smsCard(page, C168)).toBeVisible()

    // 기다리는 카드가 없으면(번호 둘 카드만) Esc는 카드를 닫지 않는다 — 남은 카드는 저절로 들어갔다
    await expect(smsResults(page, C168)).toHaveText(/^168번 · 문자찜 · /, { timeout: 20_000 })
    await speak(page, '15번 28번 문자찜 끝자리 1234')
    await expect(smsCard(page, TWO)).toBeVisible()
    await quick.focus()
    await page.keyboard.press('Escape')
    await expect(smsCard(page, TWO)).toBeVisible()

    // Esc로 닫은 165·166은 3초가 훨씬 지난 뒤에도 들어가지 않았다(남긴 167·168만 들어감)
    const nos = (await smsEvents(page, date, false)).map((e) => e['no']).sort()
    expect(nos).toEqual([167, 168])
  })

  test('AC-V1-33: 음성 문자찜 결과 카드가 열려 있고 되돌릴 것이 없을 때 Ctrl+Z → 쓰기 없이 "문자찜은 카드의 \'찜 취소하기\'로 취소해요."', async ({ page }) => {
    const { b } = await setupLive(page)
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    await speak(page, '165번 문자찜 끝자리 1234')
    await smsButton(page, C165, '지금 넣기').click()
    await expect(smsResults(page, C165)).toHaveText(/^165번 · 문자찜 · 1등 · /)
    const requests = recordRequests(page)
    const quick = page.getByLabel('빠른 입력')
    await quick.focus()
    await expect(quick).toHaveValue('')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.getByRole('status').filter({ hasText: "문자찜은 카드의 '찜 취소하기'로 취소해요." })).toBeVisible()
    await expect(smsResults(page, C165)).toHaveText(/^165번 · 문자찜 · 1등 · /)
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([])
  })

  test('AC-V1-24·D-V1-17: "넣지 않기"로 닫은 뒤 2초 뒤 같은 말 → 새 기다리는 카드, 3초 뒤 쓰기 한 번', async ({ page }) => {
    const { b } = await setupPaused(page)
    await registerApi(page, b, 166, '핑크프릴', 10000)
    await expect(boardItem(page, 166)).toBeVisible()
    const requests = recordRequests(page)
    const c166 = '166번 핑크프릴 · 끝자리 1234 · 문자찜'
    await speak(page, '166번 문자찜 끝자리 1234')
    await expect(smsCard(page, c166).getByText('3초 뒤 넣어요')).toBeVisible()
    await smsButton(page, c166, '넣지 않기').click()
    await expect(smsCard(page, c166)).toHaveCount(0)
    await page.clock.runFor(2000)
    await speak(page, '166번 문자찜 끝자리 1234')
    await expect(smsCard(page, c166).getByText('3초 뒤 넣어요')).toBeVisible()
    await expect(smsCard(page, c166).getByText('같은 말을 한 번 더 들었어요')).toHaveCount(0)
    await page.clock.runFor(3000)
    await expect(smsResults(page, c166)).toHaveText(/^166번 · 문자찜 · 1등 · /)
    expect(smsWrites(requests).map((w) => w['no'])).toEqual([166])
  })
})
