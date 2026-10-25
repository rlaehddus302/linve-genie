// SMS2 한 번의 시험 흐름 (test-e2e) — AC-SMS2-31·14(화면)·15(브라우저 GET)·16(새로고침·카드)·18(쉬운 말)·41(화면 이스케이프) 회귀.
// 기대값은 acceptance.md 문장과 계산(늦은 정도 = 서버 − 휴대폰, 평균은 100ms 단위 반올림)에서 정했다. 구현을 보고 정하지 않았다.
import { expect, test, type Page } from '@playwright/test'
import { SMS_TEST_PATH } from '../../../apps/server/src/try/sms-test.ts'
import { START, group, openSmsBox, phoneAtBefore, type SmsBox } from './support.ts'

let sms: SmsBox

test.beforeEach(async () => {
  sms = await openSmsBox()
})

test.afterEach(async () => {
  await sms.close()
})

/** 서버 시계를 START + offsetSec로 옮겨 보낸다. delayMs가 있으면 휴대폰이 받은 시각 = 옮긴 서버 시각 − delayMs */
async function sendAt(offsetSec: number, payload: Record<string, unknown>, delayMs?: number) {
  sms.setNow(new Date(START.getTime() + offsetSec * 1000))
  return sms.send(delayMs === undefined ? payload : { ...payload, receivedAt: phoneAtBefore(sms, delayMs) })
}

/** AC-SMS2-31 Given: iPhone 시험 1·2·4·4(같음)·3·6 (받은 시각 있음), Galaxy 165번주세요 (받은 시각 없음) */
async function sendRound() {
  const iphone = (body: string, delayMs: number) => ({ from: '010-1234-5678', body, device: 'iPhone', receivedAt: phoneAtBefore(sms, delayMs) })
  // 늦은 정도: 시험1 3000 · 시험2 1800 · 시험4 2500 · 시험3 4000 · 시험6 900 → 잰 것 5건, 합 12200 ÷ 5 = 2440ms → 2.4초, 가장 늦은 것 4초
  sms.setNow(START)
  expect((await sms.send(iphone('시험 1', 3000))).json).toMatchObject({ ok: true, seq: 1, serial: 1, duplicate: false })
  sms.setNow(new Date(START.getTime() + 10_000))
  expect((await sms.send(iphone('시험 2', 1800))).json).toMatchObject({ seq: 2, serial: 2, duplicate: false })
  sms.setNow(new Date(START.getTime() + 20_000))
  expect((await sms.send(iphone('시험 4', 2500))).json).toMatchObject({ seq: 3, serial: 4, duplicate: false })
  // 같은 문자가 다시 옴(번호 원문이 달라도 끝 4자리가 같으면 같은 보낸 사람)
  sms.setNow(new Date(START.getTime() + 90_000))
  const again = await sms.send({ from: '+82 10-1234-5678', body: '시험 4', device: 'iPhone', receivedAt: phoneAtBefore(sms, 100) })
  expect(again.status).toBe(200)
  expect(again.json).toEqual({ ok: true, seq: 3, last4: '5678', serial: 4, duplicate: true })
  sms.setNow(new Date(START.getTime() + 100_000))
  expect((await sms.send(iphone('시험 3', 4000))).json).toMatchObject({ seq: 4, serial: 3, duplicate: false })
  sms.setNow(new Date(START.getTime() + 110_000))
  expect((await sms.send(iphone('시험 6', 900))).json).toMatchObject({ seq: 5, serial: 6, duplicate: false })
  const galaxy = await sendAt(120, { from: '+82 10-1111-4321', body: '165번주세요', device: 'Galaxy' })
  expect(galaxy.json).toMatchObject({ ok: true, seq: 6, last4: '4321', serial: null, duplicate: false })
}

async function paragraphs(page: Page, device: string): Promise<string[]> {
  return group(page, device).locator('p').allInnerTexts()
}

test.describe('AC-SMS2-31 한 번의 시험 흐름', () => {
  test('iPhone·Galaxy 섞어 보낸 뒤 보기 화면 — 기기마다 요약 덩어리(처음 받은 기기 먼저), 카드 새것이 위, 원래 번호 없음', async ({ page }) => {
    await sendRound()
    const view = await page.goto(sms.viewUrl)
    expect(view?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('문자 자동 수신 시험')
    await expect(page.getByRole('heading', { level: 2, name: '요약' })).toBeVisible()

    // 요약 덩어리 차례 — 처음 받은 iPhone이 먼저
    await expect(page.locator('.group h3')).toHaveText(['iPhone — 받은 문자 5건', 'Galaxy — 받은 문자 1건'])

    expect(await paragraphs(page, 'iPhone')).toEqual([
      '겹쳐 온 것: 1번 (한 번으로 셌어요)',
      '늦은 정도: 평균 2.4초 · 가장 늦은 것 4초 (5건으로 쟀어요)',
      '시험 1~6: 빠진 번호 5',
      '순서: 늦게 온 번호 3',
      "'시험 6' 뒤에 보낸 문자가 안 왔는지는 이 화면이 알 수 없어요. 마지막으로 보낸 번호와 비교해 보세요.",
      '다음에 보낼 글: 시험 7',
    ])
    expect(await paragraphs(page, 'Galaxy')).toEqual([
      '겹쳐 온 것: 없음',
      '늦은 정도: 휴대폰이 받은 시각이 오지 않아 잴 수 없어요.',
      '휴대폰이 받은 시각 없이 온 것 1건',
      "'시험 1'처럼 번호를 붙여 보내면 빠진 문자와 순서도 볼 수 있어요.",
      '다음에 보낼 글: 시험 1',
    ])
    await expect(page.getByText('최근 50건 안에서만 세요. 연습 모드를 끄면 모두 사라져요.')).toBeVisible()
    await expect(page.getByText('50건이 넘어 오래된 문자는 지워졌어요.', { exact: false })).toHaveCount(0)

    // 시험 순서 안내 세 줄 (AC-SMS2-18)
    await expect(page.getByRole('listitem')).toHaveText([
      "다른 휴대폰에서 사장님 번호로 '시험 1', '시험 2', '시험 3'… 차례로 보내세요.",
      "기기마다 '다음에 보낼 글'을 보고 보내면 돼요.",
      '다 보냈으면 이 화면을 사진으로 찍어 두세요.',
    ])

    // 카드: 새것이 위, 첫 줄 "{seq}번째 · 시험 {번호}" · "늦은 정도 {값}" (AC-SMS2-16)
    const cards = page.locator('.card')
    await expect(cards).toHaveCount(6)
    await expect(cards.locator('.top')).toHaveText([
      '6번째 · 번호 없음 · 늦은 정도 -',
      '5번째 · 시험 6 · 늦은 정도 1초 안',
      '4번째 · 시험 3 · 늦은 정도 4초',
      '3번째 · 시험 4 · 늦은 정도 3초',
      '2번째 · 시험 2 · 늦은 정도 2초',
      '1번째 · 시험 1 · 늦은 정도 3초',
    ])
    // 처음 온 시험 1: 휴대폰 14:03:05, 서버 14:03:08 (한국 시각)
    const first = cards.filter({ hasText: '1번째 · 시험 1' })
    await expect(first.locator('p')).toHaveText([
      '1번째 · 시험 1 · 늦은 정도 3초',
      '휴대폰이 받은 시각 10월 26일 14:03:05',
      '서버가 받은 시각 10월 26일 14:03:08',
      '보낸 사람 끝 5678',
      '기기 iPhone',
    ])
    await expect(first.locator('.b')).toHaveText('시험 1')
    // 겹친 시험 4: 두 시각·늦은 정도는 처음 온 것 그대로(서버 14:03:28, 휴대폰 2.5초 앞 → 14:03:25), "2번 왔어요"
    const dup = cards.filter({ hasText: '3번째 · 시험 4' })
    await expect(dup.getByText('2번 왔어요 (한 번으로 셌어요)', { exact: true })).toBeVisible()
    await expect(dup.getByText('서버가 받은 시각 10월 26일 14:03:28', { exact: true })).toBeVisible()
    await expect(dup.getByText('휴대폰이 받은 시각 10월 26일 14:03:25', { exact: true })).toBeVisible()
    const galaxy = cards.filter({ hasText: '6번째 · 번호 없음' })
    await expect(galaxy.getByText('휴대폰이 받은 시각 -', { exact: true })).toBeVisible()
    await expect(galaxy.getByText('보낸 사람 끝 4321', { exact: true })).toBeVisible()
    await expect(galaxy.locator('.b')).toHaveText('165번주세요')

    // 원래 번호는 화면 HTML 어디에도 없다 (절대 규칙 7)
    const html = await page.content()
    for (const raw of ['010-1234-5678', '01012345678', '1234-5678', '+82', '1111']) expect(html, `원문 번호 조각 ${raw}`).not.toContain(raw)

    // 영어 상태값·개발 용어가 보이지 않는다 (AC-SMS2-18)
    const shown = await page.locator('body').innerText()
    for (const word of ['receivedAt', 'serial', 'duplicate', 'seq', 'null', 'JSON', 'undefined', 'NaN']) expect(shown, word).not.toContain(word)
    // 받은 글(기기 이름 iPhone·Galaxy) 말고는 영어 낱말이 없다
    expect(shown.replaceAll('iPhone', '').replaceAll('Galaxy', '')).not.toMatch(/[A-Za-z]{2,}/)

    // 표가 없다 (휴대폰 카드 화면)
    await expect(page.locator('table')).toHaveCount(0)
    await expect(page.locator('meta[http-equiv="refresh"]')).toHaveAttribute('content', '5')
  })

  test('"처음부터 다시 세기" → 확인 화면(3건 그대로, 새로고침 없음) → "아니요" → 다시 → "네, 지우고…" — 빈 화면, 토큰 그대로, 같은 문자가 새 줄 1번째', async ({ page }) => {
    await sendAt(0, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' }, 1000)
    await sendAt(1, { from: '010-1234-5678', body: '시험 2', device: 'iPhone' }, 1000)
    await sendAt(2, { from: '010-1234-5678', body: '시험 3', device: 'iPhone' }, 1000)
    await page.goto(sms.viewUrl)
    await expect(page.locator('.card')).toHaveCount(3)

    await page.getByRole('link', { name: '처음부터 다시 세기' }).click()
    await expect(page.getByText('받은 시험 문자 3건을 지우고 처음부터 셀까요? 지우면 되돌릴 수 없어요. 결과 사진을 먼저 찍어 두세요.', { exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('do')).toBe('reset-ask')
    await expect(page.locator('meta[http-equiv="refresh"]')).toHaveCount(0)
    expect(sms.box.entries()).toHaveLength(3)

    await page.getByRole('link', { name: '아니요, 돌아갈게요' }).click()
    await expect(page.locator('.card')).toHaveCount(3)
    expect(page.url()).toBe(sms.viewUrl)
    expect(sms.box.entries()).toHaveLength(3)

    await page.getByRole('link', { name: '처음부터 다시 세기' }).click()
    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === SMS_TEST_PATH)
    await page.getByRole('button', { name: '네, 지우고 처음부터 셀게요' }).click()
    expect((await posted).status()).toBe(303)
    await expect(page.getByText("아직 받은 문자가 없어요. 다른 휴대폰에서 사장님 번호로 '시험 1'을 보내 보세요.", { exact: true })).toBeVisible()
    expect(page.url()).toBe(sms.viewUrl)
    await expect(page.locator('.card')).toHaveCount(0)
    await expect(page.getByText('다음에 보낼 글: 시험 1', { exact: true })).toBeVisible()
    expect(sms.box.entries()).toHaveLength(0)

    // 같은 토큰(X-Try-Token)으로 계속 받고, 겹침 기록도 비었다
    const after = await sendAt(10, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' }, 1000)
    expect(after.status).toBe(200)
    expect(after.json).toMatchObject({ ok: true, seq: 1, serial: 1, duplicate: false })
    // 보기 화면은 5초 새로고침으로 저절로 새 문자를 보인다 (사람이 누르지 않음)
    await expect(page.locator('.card .top')).toHaveText(['1번째 · 시험 1 · 늦은 정도 1초'], { timeout: 15_000 })

    // 뒤로 가기로 확인 화면이 다시 보여도 지금 건수로 묻고, 아무것도 지우지 않는다
    await page.goBack()
    await expect(page.getByText('받은 시험 문자 1건을 지우고 처음부터 셀까요?', { exact: false })).toBeVisible()
    expect(sms.box.entries()).toHaveLength(1)
  })

  test('보기 화면은 5초마다 새로고침 — 열어 둔 채 휴대폰이 보낸 문자가 저절로 나타난다 (AC-SMS2-16)', async ({ page }) => {
    await page.goto(sms.viewUrl)
    await expect(page.getByText("아직 받은 문자가 없어요. 다른 휴대폰에서 사장님 번호로 '시험 1'을 보내 보세요.", { exact: true })).toBeVisible()
    await sendAt(0, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' })
    await expect(group(page, 'iPhone').getByRole('heading', { level: 3 })).toHaveText('iPhone — 받은 문자 1건', { timeout: 15_000 })
  })

  test('주소에 do=reset을 GET으로 열어도(즐겨찾기·새로고침) 지우지 않는다 (AC-SMS2-15)', async ({ page }) => {
    await sendAt(0, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' })
    await sendAt(1, { from: '010-1234-5678', body: '시험 2', device: 'iPhone' })
    await page.goto(`${sms.viewUrl}&do=reset`)
    await expect(page.locator('.card')).toHaveCount(2)
    await page.reload()
    await expect(page.locator('.card')).toHaveCount(2)
    expect(sms.box.entries()).toHaveLength(2)
  })

  test('토큰이 틀린 보기 주소 — 쉬운 말 안내, 받은 문자가 보이지 않는다', async ({ page }) => {
    await sendAt(0, { from: '010-1234-5678', body: '시험 1 비밀 내용', device: 'iPhone' })
    const res = await page.goto(`${sms.origin}${SMS_TEST_PATH}?t=wrong-token-xx`)
    expect(res?.status()).toBe(401)
    await expect(page.getByText('시험 토큰이 맞지 않아요. 터미널에 나온 주소를 그대로 여세요.', { exact: true })).toBeVisible()
    expect(await page.content()).not.toContain('비밀 내용')
    const ask = await page.goto(`${sms.origin}${SMS_TEST_PATH}?t=wrong-token-xx&do=reset-ask`)
    expect(ask?.status()).toBe(401)
    await expect(page.getByRole('button', { name: '네, 지우고 처음부터 셀게요' })).toHaveCount(0)
  })

  test('같은 와이파이 http 받는 곳은 문자 시험 말고 모두 404 (AC-SMS2-17 회귀)', async ({ page }) => {
    for (const path of ['/', '/api/health', '/_try/chat', '/_try/sms-test/x', '/login']) {
      const res = await page.goto(`${sms.origin}${path}?t=${sms.token}`)
      expect(res?.status(), path).toBe(404)
    }
  })

  test('받은 글의 태그·따옴표·& 는 글자 그대로 — 기기 이름 제목·카드·내용 (AC-SMS2-41 화면 쪽)', async ({ page }) => {
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    await sendAt(0, { from: '<img src=x onerror=alert(1)>', body: `시험 1 <script>alert("x")</script> 'a' & "b"`, device: '<b>x</b>' })
    await page.goto(sms.viewUrl)
    await expect(page.getByRole('heading', { level: 3 })).toHaveText('<b>x</b> — 받은 문자 1건')
    await expect(page.locator('.card .b')).toHaveText(`시험 1 <script>alert("x")</script> 'a' & "b"`)
    await expect(page.getByText('기기 <b>x</b>', { exact: true })).toBeVisible()
    await expect(page.getByText('번호 대신 이름이 왔어요', { exact: true })).toBeVisible()
    await expect(page.locator('main b, main script, main img')).toHaveCount(0)
    expect(dialogs).toEqual([])
  })
})

test.describe('AC-SMS2-14 지우기 — 아이폰·연타·50건', () => {
  test('@webkit 아이폰 사파리 모양에서 "네, 지우고 처음부터 셀게요" — 폼 보내기(form-action self)와 303이 막히지 않고 빈 화면, 토큰 그대로', async ({ page }) => {
    await sendAt(0, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' }, 1500)
    await sendAt(1, { from: '010-1234-5678', body: '시험 2', device: 'iPhone' }, 1500)
    await page.goto(sms.viewUrl)
    await expect(page.locator('.card')).toHaveCount(2)
    await page.getByRole('link', { name: '처음부터 다시 세기' }).tap()
    await expect(page.getByText(/^받은 시험 문자 2건을 지우고 처음부터 셀까요\?/)).toBeVisible()
    await page.getByRole('button', { name: '네, 지우고 처음부터 셀게요' }).tap()
    await expect(page.getByText("아직 받은 문자가 없어요. 다른 휴대폰에서 사장님 번호로 '시험 1'을 보내 보세요.", { exact: true })).toBeVisible()
    expect(page.url()).toBe(sms.viewUrl)
    expect(sms.box.entries()).toHaveLength(0)
  })

  test('"네" 단추를 두 번 빨리 눌러도 오류 화면 없이 빈 보기 화면', async ({ page }) => {
    await sendAt(0, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' })
    await page.goto(`${sms.viewUrl}&do=reset-ask`)
    await page.getByRole('button', { name: '네, 지우고 처음부터 셀게요' }).dblclick()
    await expect(page.getByText("아직 받은 문자가 없어요. 다른 휴대폰에서 사장님 번호로 '시험 1'을 보내 보세요.", { exact: true })).toBeVisible()
    expect(page.url()).toBe(sms.viewUrl)
    expect(sms.box.entries()).toHaveLength(0)
  })

  test('51건째로 처음 줄이 밀려나면 다시 세기 안내가 보이고, 지우면 그 안내도 사라진다 (AC-SMS2-13)', async ({ page }) => {
    for (let n = 1; n <= 51; n++) await sendAt(n, { from: '010-1234-5678', body: `시험 ${String(n)}`, device: 'iPhone' }, 1000)
    await page.goto(sms.viewUrl)
    await expect(page.locator('.card')).toHaveCount(50)
    const banner = page.getByText("50건이 넘어 오래된 문자는 지워졌어요. 빠진 번호가 틀릴 수 있으니 '처음부터 다시 세기'를 누르고 다시 시험하세요.", { exact: true })
    await expect(banner).toBeVisible()
    // 밀려난 시험 1은 빠진 번호로 보인다(그래서 다시 세기 안내가 필요하다)
    await expect(group(page, 'iPhone').getByText('시험 1~51: 빠진 번호 1', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '처음부터 다시 세기' }).click()
    await expect(page.getByText(/^받은 시험 문자 50건을 지우고/)).toBeVisible()
    await page.getByRole('button', { name: '네, 지우고 처음부터 셀게요' }).click()
    await expect(page.getByText("아직 받은 문자가 없어요. 다른 휴대폰에서 사장님 번호로 '시험 1'을 보내 보세요.", { exact: true })).toBeVisible()
    await expect(banner).toHaveCount(0)
  })
})
