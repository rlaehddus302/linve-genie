// PL1B 끝에서 넘긴 문자찜 카드 (SPEC VOC-04, D-I5-20 — 동작 변경 없음, 시험만) — test-e2e, 아이폰 크기 WebKit 묶음(@webkit).
// AC-PL1B-26 → APP1-36/APP1b-04: 합성 PCM·실제 서버 WS·모의 worker, 문자찜 듣기 켬(기본), 15번 상품.
// 10초 넘게 늦은 "15번 문자찜 끝자리 1234" 최종 글 → 카드는 보이고 10초 동안 저절로 넣지 않는다, "넣기"로만 15번 끝자리 1234 문자찜.
// 시각은 page.clock으로 멈추고 당긴다(waitForTimeout 없음).
import { expect, test } from '@playwright/test'
import { installSafariSpeech, login, noHorizontalScroll, openNewBroadcast, pauseClock, recordRequests, registerApi, safariSay, turnOnVoice, uniqueDate } from '../i5/support.ts'
import { smsButton, smsCard, smsEvents, smsListenBox, smsWrites } from '../v1/support.ts'

const C15 = '15번 핑크프릴 · 끝자리 1234 · 문자찜'

test.describe('PL1B 사파리 끝 넘김 문자찜 @webkit', () => {
  test('AC-PL1B-26: APP1에서 10초 넘게 늦은 "15번 문자찜 끝자리 1234" → 카드만, 10초 동안 문자찜 0건·"초 뒤 넣어요" 없음 → "넣기"로 15번 끝자리 1234 하나, 393px 가로 넘침 없음 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await page.clock.install()
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: false })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    const requests = recordRequests(page)
    await turnOnVoice(page)
    await expect(smsListenBox(page)).toBeChecked()
    await pauseClock(page)
    // 켠 직후 2초 미룸(D-PL1-09)이 지나게 당긴 뒤 말한다
    await page.clock.runFor(2_500)
    await safariSay(page, '15번 문자찜 끝자리 1234', { final: false, endSoon: true })
    await page.clock.runFor(500)
    const card = smsCard(page, C15)
    await expect(card).toBeVisible()
    await expect(card.getByText(/초 뒤 넣어요/)).toHaveCount(0)
    await expect(smsButton(page, C15, '넣기')).toBeVisible()

    // 10초 — 저절로 넣지 않는다(보통 최종이면 기다림 3초 뒤 넣는다)
    await page.clock.runFor(10_000)
    await expect(card).toBeVisible()
    expect(smsWrites(requests)).toEqual([])
    expect(await smsEvents(page, date, false)).toEqual([])
    await noHorizontalScroll(page)

    await smsButton(page, C15, '넣기').click()
    await expect.poll(async () => (await smsEvents(page, date, false)).length).toBe(1)
    const [event] = await smsEvents(page, date, false)
    expect(event!['no']).toBe(15)
    expect(JSON.stringify(event)).toContain('1234')
    expect(smsWrites(requests)).toHaveLength(1)
    await noHorizontalScroll(page)
  })
})
