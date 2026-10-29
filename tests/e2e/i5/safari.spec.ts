// APP1/APP1b 이행 (D-APP1b-05): Safari Web Speech의 폐기된 end/재시작 대신 실제 PCM 중계의 같은 판매자 결과를 검증한다.
// 옛 AC의 카드·등록·거부·복구·배치 단언을 유지한다. 세부 대응은 APP1/test-notes-e2e.md.
import { test, expect } from '@playwright/test'
import { haltPcm, historyProbe, LG_FAILED, microphoneError, pcmCounts } from '../app1/support.ts'
import {
  LG_CHARGE, LG_CONSENT, LG_DATA, MSG, OLD_SENT, SENT, SENT_SHORT, STANDALONE,
  boardItem, card, cardButton, cardList, clockConsole, expectAlert, installSafariSpeech, login,
  openNewBroadcast, pauseClock, recordRequests, recordVoiceChunk, register, safariSay, turnOnVoice,
  uniqueDate, voiceRegion, voiceStatus,
} from './support.ts'

const C15 = '15번 핑크프릴 15,000원'
const writes = (requests: {method:string;body:string}[]) => requests.filter((r) => r.method === 'POST' && r.body.includes('"product.register"'))

test.describe('I5 아이폰 → APP1 실제 서버 음성 @webkit', () => {
  test.afterEach(async ({ page }) => { await historyProbe(page, { fail: false, delayMs: 0, reset: true }) })
  test('AC-I5-20 → APP1-38: 조용한 120초 동안 같은 연결을 유지하고 그 뒤 최종 글로 카드·등록 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true })
    await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    for (let i = 0; i < 40; i++) {
      await page.clock.runFor(3000)
      await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
      await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    }
    expect((await pcmCounts(page)).sockets).toBe(1)
    await safariSay(page, '15번 핑크프릴 만오천원')
    await expect(card(page, C15)).toBeVisible()
    await cardButton(page, C15, '등록').click()
    await expect(boardItem(page, 15)).toContainText('15,000')
  })
  for (const [label, error, message] of [
    ['a 권한 거부', 'NotAllowedError', MSG.PERMISSION_DENIED],
    ['b 마이크 없음', 'NotFoundError', '마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.'],
  ] as const) {
    test(`AC-I5-21·28 ${label} → APP1-42: 오류 뒤 자동 재시도 없음·빠른 입력·다시 켜기 @webkit`, async ({ page }) => {
      await installSafariSpeech(page, { consent: true }); await clockConsole(page); await pauseClock(page)
      await microphoneError(page, error)
      await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
      await expectAlert(page, message)
      const count = (await pcmCounts(page)).sockets
      await page.clock.runFor(10_000)
      expect((await pcmCounts(page)).sockets).toBe(count)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await register(page, '21 핑크프릴 10', 21)
      await microphoneError(page, null)
      await page.getByRole('button', { name: /^(음성 켜기|다시 켜기)$/ }).first().click()
      await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
      await expect(voiceRegion(page).getByRole('alert')).toHaveCount(0)
    })
  }
  test('AC-I5-21 c → APP1-33: 듣는 중 세션 종료는 AUTH·재시도 없음, 읽은 카드로 자동 쓰기 없음 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    const requests = recordRequests(page)
    await page.evaluate(async () => { await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }) })
    await expect(voiceRegion(page)).toContainText('로그인이 끝나 음성 듣기를 멈췄어요. 다시 로그인해 주세요.')
    const count = (await pcmCounts(page)).sockets
    await page.clock.runFor(10_000)
    expect((await pcmCounts(page)).sockets).toBe(count)
    expect(writes(requests)).toEqual([])
  })
  test('AC-I5-21 d → APP1-31: 60초 안에 여섯 번째 끊김은 멈춤·다시 켜기·빠른 입력 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    await haltPcm(page)
    expect((await pcmCounts(page)).sockets).toBe(6)
    await register(page, '21 핑크프릴 10', 21)
    await page.getByRole('button', { name: '다시 켜기', exact: true }).first().click()
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    await expect(page.getByText(LG_FAILED, { exact: true })).toHaveCount(0)
  })
  test('AC-I5-22 → APP1-36: 늦은 최종 글은 카드 한 장, 30초 뒤에도 수동 등록만 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, autoRegister: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    const requests = recordRequests(page)
    await safariSay(page, '15번 핑크프릴 만오천원', { final: false, endSoon: true })
    await page.clock.runFor(30_000)
    await expect(card(page, C15)).toHaveCount(1)
    await expect(cardList(page).getByRole('listitem')).toHaveCount(1)
    await expect(card(page, C15).getByText(/자동 등록/)).toHaveCount(0)
    expect(writes(requests)).toEqual([])
    await cardButton(page, C15, '등록').click()
    await expect(boardItem(page, 15)).toContainText('핑크프릴')
    await expect(boardItem(page, 15)).toContainText('15,000')
  })
  test('AC-I5-04 → APP1b-04: 같은 최종 글은 서버 읽기 후 기다림 없이 바로 등록 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, autoRegister: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    await page.clock.runFor(2500)
    await safariSay(page, '15번 핑크프릴 만오천원')
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(card(page, C15)).toHaveCount(0)
    await expect(page.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
  })
  for (const standalone of [true, false]) {
    test(`AC-I5-11 ${standalone ? 'a·b' : 'c'} → APP1-37·38: 홈 화면 여부 ${standalone}도 같은 서버 고지와 연결 @webkit`, async ({ page }) => {
      await installSafariSpeech(page, { consent: true, standalone }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
      await expect(voiceRegion(page).getByText(SENT_SHORT, { exact: true })).toBeVisible()
      await expect(page.getByText(STANDALONE)).toHaveCount(0)
      await page.clock.runFor(60_000)
      await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
      expect((await pcmCounts(page)).sockets).toBe(1)
    })
  }
  test('AC-I5-14 → APP1-31: 다시 켜기 뒤 대기 카드는 남고 동의창 없이 수동 등록 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    await safariSay(page, '15번 핑크프릴 만오천원'); await expect(card(page, C15)).toBeVisible()
    await haltPcm(page)
    await expect(card(page, C15)).toBeVisible()
    await page.getByRole('button', { name: '다시 켜기', exact: true }).first().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    await expect(card(page, C15)).toBeVisible()
    await cardButton(page, C15, '등록').click(); await expect(boardItem(page, 15)).toBeVisible()
  })
  test('AC-I5-12 → APP1-37: 처음 동의 세 줄과 켜진 동안 서버 고지, 옛 Apple 고지 없음 @webkit', async ({ page }) => {
    await installSafariSpeech(page); await clockConsole(page)
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
    await expect(dlg.locator('p')).toHaveText([LG_CONSENT, LG_DATA, LG_CHARGE])
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await dlg.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(voiceStatus(page)).toHaveText('음성: 듣는 중')
    await expect(voiceRegion(page).getByText(SENT_SHORT, { exact: true })).toBeVisible()
    await expect(page.getByText(SENT)).toHaveCount(0); await expect(page.getByText(OLD_SENT)).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('livejjim.voiceConsent.server.v1'))).toBe('yes')
  })
  test('AC-I5-10 → APP1-41: 캡처 미지원은 동의·마이크·읽기 연결 없이 안내, 손 입력 유지 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { unsupported: true }); await login(page); await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expectAlert(page, '이 기기에서는 음성이 어려워요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await pcmCounts(page)).sockets).toBe(0); expect((await pcmCounts(page)).starts).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('livejjim.voiceConsent.server.v1'))).toBeNull()
    await register(page, '15 핑크프릴 10', 15)
  })
  test('AC-I5-23 → APP1b-14: 393px 카드 4장·고지·버튼·Enter 비활성·끄기 뒤 카드 보존 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true }); await clockConsole(page); await turnOnVoice(page); await pauseClock(page)
    const requests = recordRequests(page)
    for (const [no, word] of [[16, '만육천원'], [17, '만칠천원'], [18, '만팔천원'], [19, '만구천원']] as const) {
      await safariSay(page, `${no}번 핑크프릴 ${word}`)
      const short = `${no}번 핑크프릴 ${no},000원`
      await expect(card(page, short)).toBeAttached()
      if (no !== 19) {
        // 옛 시험과 같이 앞 세 장을 손댄 카드로 만들어 자동 닫힘(손대지 않은 카드 3장)을 피한다.
        await expect(cardButton(page, short, '자동 등록 멈추기')).toHaveCount(0)
        await cardButton(page, short, '고치기').click()
        await expect(page.getByRole('group', { name: `${short} 고치기 칸` })).toBeVisible()
        await cardButton(page, short, '고치기').click()
        await expect(page.getByRole('group', { name: `${short} 고치기 칸` })).toHaveCount(0)
      }
    }
    await expect(cardList(page).getByRole('listitem')).toHaveCount(4)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const front = '19번 핑크프릴 19,000원'
    for (const target of [voiceRegion(page).getByRole('button', { name: '음성 끄기' }), voiceRegion(page).getByText(SENT_SHORT, { exact: true }), voiceStatus(page), page.getByLabel('빠른 입력'), cardButton(page, front, '등록'), cardButton(page, front, '닫기')]) {
      await target.scrollIntoViewIfNeeded(); await expect(target).toBeInViewport()
    }
    await page.getByLabel('빠른 입력').fill(''); await page.getByLabel('빠른 입력').press('Enter')
    await expect(cardList(page).getByRole('listitem')).toHaveCount(4); expect(writes(requests)).toEqual([])
    await cardButton(page, front, '닫기').click(); await expect(card(page, front)).toHaveCount(0)
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await expect(cardList(page).getByRole('listitem')).toHaveCount(3)
    expect((await pcmCounts(page)).stops).toBeGreaterThanOrEqual(1)
  })
  test('AC-I5-24 → APP1-40: 켜지 않으면 마이크·읽기 소켓·음성 조각 없음 @webkit', async ({ page }) => {
    await installSafariSpeech(page); const chunks = recordVoiceChunk(page)
    await login(page); await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true }); await register(page, '15 핑크프릴 10', 15)
    expect((await pcmCounts(page)).sockets).toBe(0); expect((await pcmCounts(page)).starts).toBe(0); expect(chunks).toEqual([])
  })
  test('AC-I5-22 이력 기다림 → APP1b-11: 서버 이력이 느려도 늦은 최종 글은 수동 카드만 @webkit', async ({ page }) => {
    await installSafariSpeech(page, { consent: true, autoRegister: true }); await clockConsole(page)
    await historyProbe(page, { delayMs: 3000, reset: true })
    await turnOnVoice(page); await pauseClock(page)
    const requests = recordRequests(page)
    await expect.poll(async () => (await historyProbe(page)).pending).toBeGreaterThan(0)
    await safariSay(page, '15번 핑크프릴 만오천원', { final: false, endSoon: true })
    await expect(card(page, C15)).toBeVisible()
    await expect.poll(async () => (await historyProbe(page)).completed).toBeGreaterThan(0)
    await expect.poll(async () => (await historyProbe(page)).pending).toBe(0)
    await page.clock.runFor(30_000)
    await expect(card(page, C15)).toBeVisible(); expect(writes(requests)).toEqual([])
    await cardButton(page, C15, '등록').click(); await expect(boardItem(page, 15)).toBeVisible()
  })
})
