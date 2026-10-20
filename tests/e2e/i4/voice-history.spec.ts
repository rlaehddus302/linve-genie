// I4 판매 이력 사전 (AC-I4-40) — test-e2e. 범위는 기존 API로 만든다.
// 이 E2E 서버는 같은 실행의 다른 시험과 함께 쓴다. 다른 시험은 과거 날짜(uniqueDate — 2005~2024)와 오늘을 쓰므로, 이 시험은 오늘(KST) 실제 범위를
// 지금 범위로 하고 오늘 바로 앞 12일에 지난 범위를 만든다 — "가장 늦은 10개"가 이 시험의 날짜가 된다. 미래 날짜는 쓰지 않는다(다른 시험의 방송 목록 순서를 흔들지 않게).
// 사전 정리 확인은 다른 시험이 쓰지 않는 이름(레티지아)으로 한다 — 이력 이름은 같은 서버의 뒤 시험 사전에도 들어간다.
import { test, expect, type Page } from '@playwright/test'
import { card, installFakeSpeech, login, todayKst, uniqueDate, postJson, recordRequests, register, registerApi, speak, turnOnVoice, voiceRegion } from './support.ts'

/** 늦은 날짜 먼저: 1번째 ~ 12번째 (기본 사전에 없고 서로 닮지 않은 이름) */
const PAST_NAMES = ['참새방울', '고래구름', '여우별꽃', '사슴뿔초', '다람쥐풀', '부엉이잎', '두더지콩', '너구리솔', '까치노을', '펭귄얼음', '하마바위', '코끼리귀']
const REHEARSAL_NAME = '기린목도리'
const CURRENT_NAME = '토끼당근'

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

async function createBroadcast(page: Page, date: string, rehearsal: boolean): Promise<string> {
  const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date, rehearsal })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  const b = (res.body['result'] as Record<string, unknown> | undefined)?.['b'] ?? (res.body['broadcast'] as Record<string, unknown> | undefined)?.['id'] ?? res.body['b'] ?? res.body['id']
  if (typeof b !== 'string') throw new Error(JSON.stringify(res.body))
  return b
}

test.describe('I4 판매 이력 사전', () => {
  test('AC-I4-40: 켤 때 한 번, 지금 범위를 뺀 실제 범위 중 늦은 10개만 — 10번째 품종은 알아듣고 11·12번째·리허설은 아니다, 지금 범위 새 품종은 다음 문장부터', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page)
    const today = todayKst()
    const start = addDays(today, -12)
    // PAST_NAMES[i]는 start + (11 - i)일(= 오늘 - 1 - i): 0번이 가장 늦은 날짜
    for (let i = 0; i < 12; i++) {
      const date = addDays(start, 11 - i)
      const b = await createBroadcast(page, date, false)
      await registerApi(page, b, 1, PAST_NAMES[i]!, 10000)
      if (i === 0) await registerApi(page, b, 2, '레티 지아', 10000)
    }
    // 지난 리허설 범위 (지난 실제 범위보다 늦은 날짜)
    const rb = await createBroadcast(page, addDays(today, -1), true)
    await registerApi(page, rb, 1, REHEARSAL_NAME, 10000)
    // 지금 범위: 오늘 실제 범위 (다른 시험의 상품이 있어도 된다 — 지금 범위 이름은 사전 맨 앞)
    const currentDate = today
    const cb = await createBroadcast(page, currentDate, false)
    await registerApi(page, cb, 1, CURRENT_NAME, 10000)
    const requests = recordRequests(page)
    await page.goto(`/broadcasts/${encodeURIComponent(cb)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    expect(requests.filter((r) => /\/api\/days(\/|$|\?)/.test(new URL(r.url).pathname) && new URL(r.url).pathname === '/api/days')).toEqual([])

    await turnOnVoice(page)
    const pastCalls = () => requests.filter((r) => r.method === 'GET' && /^\/api\/days\/\d{4}-\d{2}-\d{2}$/.test(new URL(r.url).pathname) && new URL(r.url).searchParams.get('rehearsal') === null && new URL(r.url).pathname !== `/api/days/${currentDate}`)
    await expect.poll(() => pastCalls().length).toBe(10)
    const fetched = pastCalls().map((r) => new URL(r.url).pathname.slice('/api/days/'.length)).sort()
    expect(fetched).toEqual(Array.from({ length: 10 }, (_, i) => addDays(start, 2 + i)).sort())
    expect(requests.filter((r) => r.method === 'GET' && new URL(r.url).pathname === '/api/days')).toHaveLength(1)

    // 사전 결과 (이력이 들어온 뒤의 문장)
    await speak(page, '21번 펭귄얼음 만원')
    await expect(card(page, '21번 펭귄얼음 10,000원')).toBeVisible()
    await speak(page, '22번 하마바위 만원')
    await expect(card(page, '22번 품종 미입력 10,000원')).toBeVisible()
    await speak(page, '23번 기린목도리 만원')
    await expect(card(page, '23번 품종 미입력 10,000원')).toBeVisible()
    await speak(page, '24번 토끼당근 만원')
    await expect(card(page, '24번 토끼당근 10,000원')).toBeVisible()
    await speak(page, '25번 레티지아 만원')
    await expect(card(page, '25번 레티 지아 10,000원')).toBeVisible()
    await speak(page, '26번 참새방울 만원')
    await expect(card(page, '26번 참새방울 10,000원')).toBeVisible()

    // 지금 범위에서 손으로 등록한 새 품종
    await register(page, '30 수달조개 10', 30)
    await speak(page, '31번 수달조개 만원')
    await expect(card(page, '31번 수달조개 10,000원')).toBeVisible()

    // 끄고 다시 켜도 다시 받지 않는다
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await turnOnVoice(page)
    await speak(page, '32번 펭귄얼음 만원')
    await expect(card(page, '32번 펭귄얼음 10,000원')).toBeVisible()
    expect(pastCalls()).toHaveLength(10)
    expect(requests.filter((r) => r.method === 'GET' && new URL(r.url).pathname === '/api/days')).toHaveLength(1)
  })

  test('AC-I4-40: 조회가 실패하면 안내하고 지금 범위 + 기본 사전으로 계속', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    const cb = await createBroadcast(page, uniqueDate(), true)
    await registerApi(page, cb, 1, CURRENT_NAME, 10000)
    await page.route((url) => url.pathname === '/api/days', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '서버 오류' } }) }))
    await page.goto(`/broadcasts/${encodeURIComponent(cb)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await turnOnVoice(page)
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '지난 판매 품종을 불러오지 못했어요. 기본 품종 사전으로 알아들어요.' })).toBeVisible()
    await speak(page, '15번 핑크프릴 만원')
    await expect(card(page, '15번 핑크프릴 10,000원')).toBeVisible()
    await speak(page, '16번 토끼당근 만원')
    await expect(card(page, '16번 토끼당근 10,000원')).toBeVisible()
  })
})
