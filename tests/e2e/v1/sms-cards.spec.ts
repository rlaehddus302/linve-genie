// V1 음성 문자찜 카드 — 설정·기본 흐름·넣지 않기·지금 넣기·손대기·같은 말 (AC-V1-20·21·22·24) — test-e2e.
// 기대값은 acceptance.md 문장에서 손으로 정했다. 시각은 page.clock으로 멈추고 당긴다.
import { test, expect } from '@playwright/test'
import { syncReadingClock } from '../app1/support.ts'
import {
  boardItem,
  cardList,
  installSmsSpeech,
  login,
  noHorizontalScroll,
  openExtras,
  openNewBroadcast,
  recordRequests,
  registerApi,
  scopeView,
  setupLive,
  setupPaused,
  smsAutoSecField,
  smsButton,
  smsCard,
  smsEvents,
  smsListenBox,
  smsResults,
  smsWrites,
  speak,
  turnOnVoice,
  uniqueDate,
  voiceRegion,
} from './support.ts'

// 165번은 품종 '핑크프릴'로 등록한다 — 카드 이름에 품종이 붙는다(D-V1-21, AC-V1-21)
const C165 = '165번 핑크프릴 · 끝자리 1234 · 문자찜'
const RESULT_165 = /^165번 · 문자찜 · 1등 · 받은 시각 \d\d\/\d\d \d\d:\d\d:\d\d · 뒤 4자리 1234$/

test.describe('V1 문자찜 카드', () => {
  test('AC-V1-20: 문자찜도 듣기(기본 켬)·기다림 3초, "문자찜도 듣는 중", 끄면 문자찜 카드 없음, 다시 열어도 저장', async ({ page }) => {
    await installSmsSpeech(page)
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: false })
    await registerApi(page, b, 165, '핑크프릴', 10000)
    const requests = recordRequests(page)
    await turnOnVoice(page)
    // 문자찜 설정은 음성 칸 아래 접는 칸 "음성 설정과 기록"(기본 접힘) 안 (D-V2-21)
    await openExtras(page)
    await expect(smsListenBox(page)).toBeChecked()
    await expect(smsAutoSecField(page)).toHaveValue('3')
    await expect(voiceRegion(page).getByText('문자찜도 듣는 중')).toBeVisible()
    await smsListenBox(page).uncheck()
    await expect(voiceRegion(page).getByText('문자찜도 듣는 중')).toHaveCount(0)
    await speak(page, '165번 문자찜 끝자리 1234')
    // 문자찜 문장은 어떤 카드도 만들지 않는다(상품 등록 카드도 아님) — 뒤의 상품 카드로 처리 끝을 확인
    await speak(page, '17번 라울 만원')
    await expect(cardList(page).getByRole('listitem')).toHaveCount(1)
    await expect(cardList(page).getByRole('listitem').first()).toHaveAccessibleName('17번 라울 10,000원 카드')
    expect(smsWrites(requests)).toEqual([])
    // 그 기기에 저장 — 다시 열어도 꺼져 있다
    await page.reload()
    await turnOnVoice(page)
    await openExtras(page)
    await expect(smsListenBox(page)).not.toBeChecked()
    await expect(voiceRegion(page).getByText('문자찜도 듣는 중')).toHaveCount(0)
    await smsListenBox(page).check()
    await expect(voiceRegion(page).getByText('문자찜도 듣는 중')).toBeVisible()
  })

  test('AC-V1-20: 저장값이 깨졌거나 범위 밖이면 기본(켬·3초)', async ({ browser }) => {
    for (const raw of ['{깨짐', JSON.stringify({ 'voice.smsListen': 'yes', 'voice.smsAutoSec': 11 }), JSON.stringify({ 'voice.smsAutoSec': -1 }), JSON.stringify({ 'voice.smsAutoSec': 2.5 })]) {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      await installSmsSpeech(page, { smsRaw: raw })
      await login(page)
      await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
      await turnOnVoice(page)
      await openExtras(page)
      await expect(smsListenBox(page), raw).toBeChecked()
      await expect(smsAutoSecField(page), raw).toHaveValue('3')
      await expect(voiceRegion(page).getByText('문자찜도 듣는 중'), raw).toBeVisible()
      await ctx.close()
    }
  })

  test('AC-V1-21: "165번 문자찜 끝자리 1234" → 3초 세고 저절로 한 번 → 1등 결과 카드, 15초 뒤 같은 말은 "이미 찜한 구매자라…"', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    const c = smsCard(page, C165)
    await expect(c).toBeVisible()
    await expect(c.getByText('3초 뒤 넣어요')).toBeVisible()
    await expect(smsButton(page, C165, '넣지 않기')).toBeVisible()
    await expect(smsButton(page, C165, '지금 넣기')).toBeVisible()
    // 상품 등록 카드는 생기지 않는다 — 맨 앞 카드가 이것 하나
    await expect(cardList(page).getByRole('listitem')).toHaveCount(1)
    await page.clock.runFor(1000)
    await expect(c.getByText('2초 뒤 넣어요')).toBeVisible()
    expect(smsWrites(requests)).toEqual([])
    await page.clock.runFor(1000)
    await expect(c.getByText('1초 뒤 넣어요')).toBeVisible()
    expect(smsWrites(requests)).toEqual([])
    await page.clock.runFor(1000)
    await expect(smsResults(page, C165)).toHaveText(RESULT_165)
    const firstSentAt = Date.now()
    await expect(page.getByRole('button', { name: '165번 문자찜 찜 취소하기' })).toBeVisible()
    const writes = smsWrites(requests)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ type: 'sms', b, no: 165, last4: '1234' })
    expect(writes[0]).not.toHaveProperty('received')
    expect(writes[0]).not.toHaveProperty('buyer')
    expect(writes[0]).not.toHaveProperty('phone')
    // 엔진: 165번 1등 = 새 문자 구매자, 표시 "문자찜", 뒤 4자리 1234
    const view = await scopeView(page, date, false)
    const p = view.products.find((x) => x.no === 165)!
    expect(p.winners).toHaveLength(1)
    const buyer = view.buyers.find((x) => x.id === p.winners[0] || x.current === p.winners[0])!
    expect(buyer.kind).toBe('sms')
    expect(buyer.phoneLast4).toBe('1234')
    expect(buyer.display).toBe('문자찜')
    // 15초 뒤 같은 말 → 새 카드(10초 지남), 엔진은 새 찜을 만들지 않는다
    await page.clock.runFor(15_000)
    // 서버의 기기 사이 같은 말 검사(D-V1-13)는 서버 도착 시각(실제 시계)으로 10초를 센다 — 브라우저 시계만 당기면 서버에겐 "방금"이라
    // VOICE_REPEATED가 난다. 실제 방송에선 두 시계가 함께 간다: 서버 쪽도 10초가 지날 때까지 기다린다(E2E 서버에 시계 손잡이가 없다).
    await expect.poll(() => Date.now() - firstSentAt, { timeout: 15_000, intervals: [250] }).toBeGreaterThan(10_500)
    // APP1b 읽기 시계도 멈춘 브라우저 시각에 맞춘다. HTTP 중복 방어의 실제10초 대기는 위에서 그대로 검증한다.
    await syncReadingClock(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    await expect(smsCard(page, C165)).toHaveCount(2)
    await page.clock.runFor(3000)
    await expect(smsCard(page, C165).first().getByRole('status').filter({ hasText: '이미 찜한 구매자라' })).toHaveText('165번 · 이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등) · 뒤 4자리 1234')
    expect(smsWrites(requests)).toHaveLength(2)
    const claims = (await scopeView(page, date, false)).claims.filter((x) => x.no === 165)
    expect(claims).toHaveLength(1)
  })

  test('AC-V1-22: "넣지 않기"는 10초 뒤까지 요청 없음, "지금 넣기"는 바로 한 번, 기다림 0은 만들자마자', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    for (const no of [165, 166]) await registerApi(page, b, no, '핑크프릴', 10000)
    await expect(boardItem(page, 166)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    await expect(smsCard(page, C165)).toBeVisible()
    await page.clock.runFor(1500)
    await smsButton(page, C165, '넣지 않기').click()
    await expect(smsCard(page, C165)).toHaveCount(0)
    await page.clock.runFor(10_000)
    expect(smsWrites(requests)).toEqual([])
    // 지금 넣기
    const c166 = '166번 핑크프릴 · 끝자리 5678 · 문자찜'
    await speak(page, '166번 문자찜 끝자리 5678')
    await smsButton(page, c166, '지금 넣기').click()
    await expect(smsResults(page, c166)).toHaveText(/^166번 · 문자찜 · 1등 · /)
    expect(smsWrites(requests)).toHaveLength(1)
    await page.clock.runFor(10_000)
    expect(smsWrites(requests)).toHaveLength(1)
    expect((await smsEvents(page, date, false)).map((e) => e['no'])).toEqual([166])
  })

  test('AC-V1-22: 기다림 0 → 카드를 만들자마자 보낸다', async ({ page }) => {
    // 시계를 멈추지 않는다 (0초 = 곧바로 부르는 타이머)
    const { b } = await setupLive(page, { smsSettings: { 'voice.smsListen': true, 'voice.smsAutoSec': 0 } })
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    await expect(smsAutoSecField(page)).toHaveValue('0')
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    await expect(smsResults(page, C165)).toHaveText(RESULT_165)
    expect(smsWrites(requests)).toHaveLength(1)
  })

  test('AC-V1-22: 번호 둘 → "— 넣을까요?"와 넣기·넣지 않기만, 기다려도 안 보냄, 넣기 → 주문마다 다른 요청 번호, 번호마다 결과 줄', async ({ page }) => {
    const { b } = await setupPaused(page)
    for (const no of [15, 28]) await registerApi(page, b, no, '핑크프릴', 10000)
    await expect(boardItem(page, 28)).toBeVisible()
    const requests = recordRequests(page)
    const short = '15번 핑크프릴 · 28번 핑크프릴 · 끝자리 1234 · 문자찜' // 번호마다 품종(D-V1-21)
    await speak(page, '15번 28번 문자찜 끝자리 1234')
    const c = smsCard(page, short)
    await expect(c.getByText('15번 핑크프릴 · 28번 핑크프릴 · 끝자리 1234 · 문자찜 — 넣을까요?')).toBeVisible()
    // D-V1-20: "넣지 않기"가 첫 버튼, 넣는 버튼은 뒤
    await expect(c.getByRole('button')).toHaveText(['넣지 않기', '넣기'])
    await page.clock.runFor(15_000)
    expect(smsWrites(requests)).toEqual([])
    await smsButton(page, short, '넣기').click()
    await expect(smsResults(page, short)).toHaveText([/^15번 · 문자찜 · 1등 · .* · 뒤 4자리 1234$/, /^28번 · 문자찜 · 1등 · .* · 뒤 4자리 1234$/])
    const writes = smsWrites(requests)
    expect(writes.map((w) => w['no'])).toEqual([15, 28])
    expect(new Set(writes.map((w) => w['requestId'])).size).toBe(2)
  })

  test('AC-V1-22: 창이 열려 있으면 기다림이 끝나도 안 보내고 닫힌 뒤 보낸다', async ({ page }) => {
    const { b } = await setupPaused(page)
    for (const no of [165, 15]) await registerApi(page, b, no, '핑크프릴', 10000)
    await expect(boardItem(page, 15)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    await expect(smsCard(page, C165)).toBeVisible()
    await boardItem(page, 15).click()
    const dlg = page.getByRole('dialog').first()
    await expect(dlg).toBeVisible()
    await page.clock.runFor(5000)
    expect(smsWrites(requests)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.clock.runFor(4000)
    await expect(smsResults(page, C165)).toHaveText(RESULT_165)
    expect(smsWrites(requests)).toHaveLength(1)
  })

  test('AC-V1-22: 음성을 끄면 기다리던 카드는 남고 저절로 넣지 않는다, 누르면 넣는다', async ({ page }) => {
    const { b } = await setupPaused(page)
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    await expect(smsCard(page, C165).getByText('3초 뒤 넣어요')).toBeVisible()
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await page.clock.runFor(10_000)
    await expect(smsCard(page, C165)).toBeVisible()
    expect(smsWrites(requests)).toEqual([])
    await smsButton(page, C165, '넣기').click()
    await expect(smsResults(page, C165)).toHaveText(RESULT_165)
    expect(smsWrites(requests)).toHaveLength(1)
  })

  test('AC-V1-24: 같은 말 2초 간격 두 번 → 카드 하나·쓰기 한 번·"같은 말을 한 번 더 들었어요", 끝자리 5678은 새 카드', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    await expect(smsCard(page, C165)).toBeVisible()
    await page.clock.runFor(2000)
    await speak(page, '165번 문자찜 끝자리 1234')
    await expect(smsCard(page, C165).getByRole('status').filter({ hasText: '같은 말을 한 번 더 들었어요' })).toBeVisible()
    await expect(smsCard(page, C165)).toHaveCount(1)
    await speak(page, '165번 문자찜 끝자리 5678')
    await expect(smsCard(page, '165번 핑크프릴 · 끝자리 5678 · 문자찜')).toBeVisible()
    await page.clock.runFor(5000)
    // 같은 표시 이름("문자찜")이 둘이면 이름에 구분 글자가 붙는다(D-098) — 그 부분은 TE-V1-001에서 본다
    await expect(smsResults(page, C165)).toHaveText(/^165번 · 문자찜.* · 1등 · 받은 시각 /)
    await expect(smsResults(page, '165번 핑크프릴 · 끝자리 5678 · 문자찜')).toHaveText(/^165번 · 문자찜.* · 대기 1번 · 받은 시각 /)
    const writes = smsWrites(requests)
    expect(writes.map((w) => w['last4'])).toEqual(['1234', '5678'])
    expect(await smsEvents(page, date, false)).toHaveLength(2)
  })

  test('AC-V1-20: 휴대폰(375×812) — 설정 두 칸·카드가 보이고 누를 곳은 44px 이상, 가로 넘침 없음', async ({ page }) => {
    await installSmsSpeech(page)
    await page.setViewportSize({ width: 375, height: 812 })
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: false })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 28, '핑크프릴', 10000)
    await turnOnVoice(page)
    await expect(voiceRegion(page).getByText('문자찜도 듣는 중')).toBeVisible()
    await speak(page, '15번 28번 문자찜 끝자리 1234')
    const short = '15번 핑크프릴 · 28번 핑크프릴 · 끝자리 1234 · 문자찜' // 번호마다 품종(D-V1-21)
    await expect(smsCard(page, short)).toBeVisible()
    for (const name of ['넣기', '넣지 않기'] as const) {
      const box = await smsButton(page, short, name).boundingBox()
      expect(box, name).not.toBeNull()
      expect(box!.height, name).toBeGreaterThanOrEqual(44)
      expect(box!.width, name).toBeGreaterThanOrEqual(44)
    }
    await noHorizontalScroll(page)
    await openExtras(page)
    await smsListenBox(page).scrollIntoViewIfNeeded()
    await expect(smsListenBox(page)).toBeVisible()
    await expect(smsAutoSecField(page)).toBeVisible()
    const field = await smsAutoSecField(page).boundingBox()
    expect(field!.height).toBeGreaterThanOrEqual(44)
    await noHorizontalScroll(page)
  })

  test('TE-V1-001: 같은 표시 이름의 문자 구매자가 둘이면 결과 줄에 "뒤 4자리 1234"가 두 번 나온다(이름의 구분 글자 + 카드의 끝자리)', async ({ page }) => {
    // D-098: 같은 표시 이름이 둘 이상이면 이름에 "뒤 4자리 1234"가 붙는다. 음성 문자찜 구매자는 모두 "문자찜"이라 둘째 손님부터 늘 겹친다.
    // AC-V1-21: 결과 문장은 손 입력 결과 카드와 같고 "뒤 4자리 표시 포함" — 한 번이어야 한다.
    const { b } = await setupLive(page)
    for (const no of [165, 166]) await registerApi(page, b, no, '핑크프릴', 10000)
    await expect(boardItem(page, 166)).toBeVisible()
    await speak(page, '165번 문자찜 끝자리 1234')
    await smsButton(page, C165, '지금 넣기').click()
    await expect(smsResults(page, C165)).toHaveText(RESULT_165)
    const c5678 = '166번 핑크프릴 · 끝자리 5678 · 문자찜'
    await speak(page, '166번 문자찜 끝자리 5678')
    await smsButton(page, c5678, '지금 넣기').click()
    await expect(smsResults(page, c5678)).toHaveText(/^166번 · 문자찜.* · 1등 · 받은 시각 /)
    for (const [short, last4] of [[C165, '1234'], [c5678, '5678']] as const) {
      const text = (await smsResults(page, short).innerText()).trim()
      expect(text.split(`뒤 4자리 ${last4}`).length - 1, text).toBe(1)
    }
  })
})
