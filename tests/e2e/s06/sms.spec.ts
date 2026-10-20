// 문자찜 입력 (AC-S06-10~15·81, ORD-08, R-0 5, R-6, R-11, D-089) — test-e2e.
// 기대값은 스펙 문장·골든(G-ENG-169·170)에서 정한다. 기다림은 상태로.
import { test, expect, type Page } from '@playwright/test'
import {
  history, login, openNewBroadcast, openSms, postJson, registerApi, scopeView, smsApi, smsField, smsUi, uniqueDate, viewerClaim, writeEvent,
  kstTimeAgo,
} from './support.ts'

function uniq(prefix: string): string {
  return `${prefix}${String(Math.floor(Math.random() * 1e6))}`
}

/** 입력 시각(지금)에 가장 가까운 날의 그 시각 (D-023) → "10/20" */
function kstMonthDayNearest(hms: string): string {
  const now = Date.now()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
  const base = Date.parse(`${today}T${hms}+09:00`)
  const best = [-1, 0, 1].map((d) => base + d * 86_400_000).sort((a, b) => Math.abs(a - now) - Math.abs(b - now) || b - a)[0]!
  const md = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date(best))
  return md
}

async function rehearsalWithTitle(page: Page, title: string): Promise<{ b: string; date: string }> {
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true, title })
  return { b, date }
}

test.describe('문자찜 입력', () => {
  test('AC-S06-10: 가장 최근의 끝나지 않은 실제 방송이 기본, 다른 기기에서 끝내도 고른 방송은 그대로 "끝남"', async ({ page }) => {
    await login(page)
    const title = uniq('기본')
    // 다른 시험이 만든 실제 방송보다 늦은 날짜 (끝까지 끝내 다른 시험의 기본값을 흐리지 않는다)
    const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date: '2099-12-30', rehearsal: false, title })
    expect(res.status).toBeLessThan(300)
    const list = await (await page.request.get('/api/broadcasts')).json() as { broadcasts: { id: string; title: string }[] }
    const b = list.broadcasts.find((x) => x.title === title)!.id
    try {
      await page.goto('/sms')
      const region = page.getByRole('region', { name: '고른 방송' })
      await expect(region).toContainText(`${title} · 2099년 12월 30일(수)`)
      await expect(region).toContainText('진행 중')
      await expect(smsField(page, '번호')).toBeFocused()
      // 다른 기기에서 끝냄
      const end = await postJson(page, `/api/broadcasts/${b}/end`, { requestId: crypto.randomUUID() })
      expect(end.status).toBeLessThan(300)
      await expect(region).toContainText('끝남')
      await expect(region).toContainText(title)
    } finally {
      await postJson(page, `/api/broadcasts/${b}/end`, { requestId: crypto.randomUUID() })
    }
  })

  test('AC-S06-10: 끝나지 않은 실제 방송이 없으면 고른 방송이 없고 안내, 보낼 수 없다 (리허설만 있어도 기본으로 고르지 않는다)', async ({ page }) => {
    await login(page)
    await rehearsalWithTitle(page, uniq('리허만'))
    // 방송 목록에서 끝나지 않은 실제 방송을 뺀다 (같은 서버를 함께 쓰는 다른 시험의 방송)
    await page.route('**/api/broadcasts', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const res = await route.fetch()
      const body = await res.json() as { broadcasts: { rehearsal: boolean; ended: boolean }[] }
      await route.fulfill({ response: res, json: { broadcasts: body.broadcasts.filter((x) => x.rehearsal || x.ended) } })
    })
    await page.goto('/sms')
    await expect(page.getByRole('region', { name: '고른 방송' })).toContainText('문자찜을 넣을 방송을 골라 주세요.')
    await expect(page.getByRole('region', { name: '고른 방송' }).getByRole('button', { name: '방송 고르기' })).toBeVisible()
    await expect(page.getByRole('button', { name: /문자찜 넣기$/ })).toBeDisabled()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })

  test('AC-S06-10: 리허설 방송을 고르면 경고가 늘 보이고 끝난 방송도 고를 수 있다', async ({ page }) => {
    await login(page)
    const title = uniq('리허')
    const { b } = await rehearsalWithTitle(page, title)
    await postJson(page, `/api/broadcasts/${b}/end`, { requestId: crypto.randomUUID() })
    await openSms(page, title)
    await expect(page.getByText('리허설 방송이에요 — 실제 판매에 들어가지 않아요')).toBeVisible()
    await expect(page.getByRole('region', { name: '고른 방송' })).toContainText('끝남')
    // 끝난 방송의 늦은 문자찜도 평소대로 (R-1, G-ENG-170) — 상품이 없으면 보류가 되고 만료된다 해도 기록은 된다
    await registerApi(page, b, 3, '로즈', 5000)
    await smsUi(page, { no: 3, memo: '늦게' })
    const events = (await history(page, (await scopeDate(page, b)), true)).filter((e) => e.type === 'sms')
    expect(events).toHaveLength(1)
  })

  test('AC-S06-11: 번호 미리 보기 — 없음·판매 중·공개 전·일시 중지, 범위 밖 번호, 다른 기기의 변화가 따라온다', async ({ page, browser }) => {
    await login(page)
    const title = uniq('미리')
    const { b } = await rehearsalWithTitle(page, title)
    await openSms(page, title)
    const preview = page.getByRole('status', { name: '번호의 상품' })
    await smsField(page, '번호').fill('15')
    await expect(preview).toHaveText('15번 상품이 아직 없어요. 넣으면 보류 찜이 되고, 30초 안에 등록되면 판정돼요.')
    // 다른 기기(API)에서 등록·찜 → 미리 보기가 따라온다
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await expect(preview).toContainText('15번 핑크프릴 10,000원 · 판매 중 · 1등 아직 없음 · 대기 0')
    await viewerClaim(page, b, '홍길동', '15', 'sim_hong_0001')
    await expect(preview).toContainText('15번 핑크프릴 10,000원 · 판매 완료 · 1등 홍길동 · 대기 0')
    // 일시 중지
    expect((await writeEvent(page, { type: 'product.hold', b, no: 15 })).status).toBeLessThan(300)
    await expect(preview).toContainText('지금 판매 중이 아니라 넣으면 거절돼요.')
    // 범위 밖 번호
    await smsField(page, '번호').fill('1000')
    await expect(page.getByText('번호는 1~999 사이로 적어 주세요.')).toBeVisible()
    await expect(page.getByRole('button', { name: /문자찜 넣기$/ })).toHaveText('문자찜 넣기')
    // 숫자만 받는다
    await smsField(page, '번호').fill('')
    await smsField(page, '번호').pressSequentially('1a5번')
    await expect(smsField(page, '번호')).toHaveValue('15')
    await expect(smsField(page, '번호')).toHaveAttribute('inputmode', 'numeric')
    void browser
  })

  test('AC-S06-12: 받은 시각 읽기 표 (지금 = 20:05 KST)와 늦은 시각 확인(처음 포커스 "고치기")', async ({ page }) => {
    // 브라우저 시계만 20:05 KST로 (시각이 흐른다)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
    await page.clock.install({ time: new Date(`${today}T20:05:00+09:00`) })
    await login(page)
    const title = uniq('시각')
    const { b, date } = await rehearsalWithTitle(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await openSms(page, title)
    const field = smsField(page, '받은 시각')
    await expect(page.getByText('비우면 지금 시각(초까지)으로 넣어요')).toBeVisible()
    const table: [string, string][] = [
      ['20:01', '오늘 20:01에 받은 문자'],
      ['2001', '오늘 20:01에 받은 문자'],
      ['20:01:05', '오늘 20:01:05에 받은 문자'],
      ['200105', '오늘 20:01:05에 받은 문자'],
      ['8:01', '오늘 20:01에 받은 문자'],
      ['801', '오늘 20:01에 받은 문자'],
      ['오후 8:01', '오늘 20:01에 받은 문자'],
      // D-023: 날짜는 지금과 가장 가까운 날 — 20:05에 08:01은 내일 08:01(11시간 56분 뒤)이 오늘 08:01(12시간 4분 전)보다 가깝다
      ['오전 8:01', '내일 08:01에 받은 문자'],
      ['08:01', '내일 08:01에 받은 문자'],
      ['00:30', '내일 00:30에 받은 문자'],
      ['13:05', '오늘 13:05에 받은 문자'],
      ['오후 1:05', '오늘 13:05에 받은 문자'],
    ]
    for (const [text, words] of table) {
      await field.fill(text)
      await expect(page.getByText(words, { exact: true }), text).toBeVisible()
    }
    for (const bad of ['25:00', '20:61', '2:5', '20시']) {
      await field.fill(bad)
      await expect(page.getByText('받은 시각을 20:01처럼 적어 주세요.'), bad).toBeVisible()
    }
    // 읽지 못하면 보내지 않는다
    await smsField(page, '번호').fill('15')
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    await expect(smsField(page, '번호')).toHaveValue('15')
    // 늦은 시각 → 확인 창
    await field.fill('20:07')
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    const dlg = page.getByRole('dialog', { name: '받은 시각을 확인해 주세요' })
    await expect(dlg).toContainText('받은 시각(오늘 20:07)이 지금보다 늦어요. 이대로 넣을까요?')
    await expect(dlg.getByRole('button', { name: '고치기' })).toBeFocused()
    await dlg.getByRole('button', { name: '고치기' }).click()
    await expect(field).toBeFocused()
    expect((await history(page, date, true)).filter((e) => e.type === 'sms')).toHaveLength(0)
    // 분까지만 적은 지금 분(20:05)은 늦지 않다 (분의 시작으로 비교)
    await field.fill('20:05')
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText('15번')
    const sms = (await history(page, date, true)).filter((e) => e.type === 'sms')
    expect(sms).toHaveLength(1)
    expect(sms[0]!.fields['received']).toBe('20:05')
  })

  test('AC-S06-13: 전화번호 읽지 못함·메모의 휴대폰 번호는 막고, 보내지 않는다', async ({ page }) => {
    await login(page)
    const title = uniq('막기')
    const { b, date } = await rehearsalWithTitle(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await openSms(page, title)
    await smsField(page, '번호').fill('15')
    for (const bad of ['1234', '010-12']) {
      await smsField(page, '전화번호').fill(bad)
      await expect(page.getByText('휴대폰 번호로 읽지 못했어요. 고치거나 지워 주세요.'), bad).toBeVisible()
      await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    }
    await smsField(page, '전화번호').fill('010-1234-5678')
    await expect(page.getByText('뒤 4자리 5678로 이어져요')).toBeVisible()
    await smsField(page, '메모').fill('김씨 01098765432')
    await expect(page.getByText('전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.')).toBeVisible()
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    expect((await history(page, date, true)).filter((e) => e.type === 'sms')).toHaveLength(0)
    await smsField(page, '메모').fill('김씨')
    await expect(page.getByLabel('구매자 표시 이름')).toHaveText('구매자 표시: 문자찜(김씨)')
  })

  test('AC-S06-14·81: 바로 보내기 → 결과 카드 → 칸 비움 → 같은 사람 하나 더 (전화번호 다시 채우지 않음)', async ({ page }) => {
    // 받은 시각 00:00:01이 "오늘"로 읽히게 브라우저 시계를 KST 06:00으로 (낮 12시가 넘으면 "내일"로 읽혀 확인 창이 뜬다 — 시각에 기대지 않게)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
    await page.clock.install({ time: new Date(`${today}T06:00:00+09:00`) })
    const logs: string[] = []
    page.on('console', (m) => logs.push(m.text()))
    await login(page)
    const title = uniq('결과')
    const { b, date } = await rehearsalWithTitle(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '로즈', 5000)
    await openSms(page, title)
    // 받은 시각: 지금보다 1분 이른 한국 시각 — 고정 시각은 정오 뒤 '내일'로 읽혀 확인 창이 뜬다(D-023, SA-I4-009)
    const received = kstTimeAgo(60)
    await smsField(page, '번호').fill('15')
    await smsField(page, '받은 시각').fill(received)
    await smsField(page, '전화번호').fill('010-1234-5678')
    await smsField(page, '메모').fill('김씨')
    await smsField(page, '번호').press('Enter')
    const result = page.getByRole('region', { name: '넣은 결과' })
    // 받은 시각의 날짜는 입력 시각에 가장 가까운 날 (D-023, AC-S06b-31 — 교체: 날짜가 붙었다)
    await expect(result).toContainText(`15번 · 문자찜(김씨) · 1등 · 받은 시각 ${kstMonthDayNearest(received)} ${received}`)
    await expect(result).toContainText('뒤 4자리 5678')
    for (const name of ['번호', '받은 시각', '전화번호', '메모'] as const) await expect(smsField(page, name)).toHaveValue('')
    await expect(smsField(page, '번호')).toBeFocused()
    // 같은 사람 하나 더 → 고른 구매자, 받은 시각은 방금 값, 전화번호는 다시 채우지 않음
    await result.getByRole('button', { name: '같은 사람 하나 더' }).click()
    await expect(page.getByRole('group', { name: '고른 구매자' })).toContainText('문자찜(김씨)')
    await expect(smsField(page, '받은 시각')).toHaveValue(received)
    await expect(smsField(page, '전화번호')).toHaveValue('')
    await expect(smsField(page, '전화번호')).toBeDisabled()
    await expect(page.getByText('구매자를 골랐으면 전화번호는 쓰지 않아요')).toBeVisible()
    await expect(smsField(page, '번호')).toBeFocused()
    await page.keyboard.type('16')
    await page.keyboard.press('Enter')
    await expect(result).toContainText('16번 · 문자찜(김씨) · 1등')
    const view = await scopeView(page, date, true)
    const smsClaims = view.claims.filter((c) => c.origin === 'sms')
    expect(smsClaims).toHaveLength(2)
    expect(new Set(smsClaims.map((c) => c.currentBuyer)).size).toBe(1)
    // 전화번호 원문이 화면·주소·저장소·콘솔에 없다 (AC-S06-81)
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/010-?1234-?5678|01012345678/)
    expect(page.url()).not.toMatch(/5678|%EA%B9%80/)
    const stored = await page.evaluate(async () => {
      const parts: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })]
      for (const key of await caches.keys()) {
        const cache = await caches.open(key)
        for (const req of await cache.keys()) parts.push(req.url)
      }
      const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
      parts.push(JSON.stringify(dbs))
      return parts.join('\n')
    })
    expect(stored).not.toMatch(/1234-?5678|김씨/)
    expect(logs.join('\n')).not.toMatch(/1234-?5678|김씨/)
  })

  test('AC-S06-14: 지정 구매자가 이미 찜한 번호면 "이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등)"', async ({ page }) => {
    await login(page)
    const title = uniq('이미')
    const { b } = await rehearsalWithTitle(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await viewerClaim(page, b, '홍길동', '15', 'sim_hong_7777')
    await openSms(page, title)
    await smsField(page, '구매자 고르기').fill('홍길동')
    await page.getByRole('list', { name: '찾은 구매자' }).getByRole('button', { name: /홍길동/ }).click()
    await expect(page.getByRole('group', { name: '고른 구매자' })).toContainText('홍길동')
    await expect(page.getByLabel('구매자 표시 이름')).toHaveText('구매자 표시: 홍길동')
    await smsField(page, '메모').fill('메모는 이름을 바꾸지 않음')
    await expect(page.getByLabel('구매자 표시 이름')).toHaveText('구매자 표시: 홍길동')
    await smsField(page, '번호').fill('15')
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText('이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등)')
  })

  test('TE-S06-001 회귀: 같은 전화번호로 같은 번호를 다시 넣으면 "이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등)"', async ({ page }) => {
    // AC-S06-14: "찜이 생기지 않았으면: 그 구매자가 그 번호에 활성 찜이 있으면 '이미 찜한 구매자라…'" — 구매자를 정한 길(지정·전화번호)과 상관없다.
    // 같은 사람이 같은 문자를 두 번 보내는 것은 흔하다(문자 두 번 확인).
    await login(page)
    const title = uniq('두번')
    const { b } = await rehearsalWithTitle(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await openSms(page, title)
    await smsUi(page, { no: 15, phone: '010-2222-3333' })
    await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText('1등')
    await smsUi(page, { no: 15, phone: '010-2222-3333' })
    await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText('이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등)')
  })

  test('AC-S06-14: 저장 응답을 못 받아도 "다시 보내기"는 같은 요청 번호 — 한 번만 기록', async ({ page }) => {
    await login(page)
    const title = uniq('재시도')
    const { b, date } = await rehearsalWithTitle(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await openSms(page, title)
    let lose = true
    await page.route('**/api/events', async (route) => {
      if (lose && route.request().method() === 'POST') {
        await route.fetch() // 서버에는 닿았다(기록됨) — 응답만 잃는다 (저절로 다시 보내는 것도 모두)
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })
    await smsField(page, '번호').fill('15')
    await smsField(page, '전화번호').fill('010-4444-5555')
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    await expect(page.getByText(/저장하지 못했어요/)).toBeVisible()
    // 칸은 그대로 남아 있다
    await expect(smsField(page, '번호')).toHaveValue('15')
    lose = false
    await page.getByRole('button', { name: '다시 보내기' }).click()
    await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText('15번')
    const sms = (await history(page, date, true)).filter((e) => e.type === 'sms')
    expect(sms).toHaveLength(1)
  })

  test('AC-S06-14·15: 결과 카드·최근 목록의 "찜 취소하기"는 사유 + 대기 뒤 보낸다, 다른 기기의 문자찜도 최근 목록에', async ({ page }) => {
    await login(page)
    const title = uniq('취소')
    const { b, date } = await rehearsalWithTitle(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await openSms(page, title)
    await smsUi(page, { no: 15, memo: '박씨' })
    await page.getByRole('region', { name: '넣은 결과' }).getByRole('button', { name: '찜 취소하기' }).click()
    const dlg = page.getByRole('dialog').last()
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('1')
    await expect(dlg.getByRole('button', { name: '찜 취소하기' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText('취소됨', { timeout: 15_000 })
    const cancels = (await history(page, date, true)).filter((e) => e.type === 'host.cancel')
    expect(cancels).toHaveLength(1)
    expect(cancels[0]!.reason).toBe('시청자 요청')
    // 다른 기기(API)에서 넣은 문자찜이 최근 목록에
    await smsApi(page, { b, no: 15, memo: '최씨' })
    const recent = page.getByRole('region', { name: '최근 넣은 문자찜' })
    await expect(recent).toContainText('문자찜(최씨)')
    await expect(recent.getByRole('listitem').first()).toContainText('15번')
    await expect(recent.getByRole('listitem').first()).toContainText('1등')
  })

  test('AC-S06-14: 인터넷이 끊긴 채 보내기 → 안내 → 연결 뒤 다시 보내기 → 한 번만 기록, 보류 찜도 결과 카드에서 취소', async ({ page, context }) => {
    await login(page)
    const title = uniq('끊김')
    const { date } = await rehearsalWithTitle(page, title)
    await openSms(page, title)
    await smsField(page, '번호').fill('77')
    await smsField(page, '메모').fill('오프')
    await context.setOffline(true)
    await page.getByRole('button', { name: '77번에 문자찜 넣기' }).click()
    await expect(page.getByText(/저장하지 못했어요/)).toBeVisible({ timeout: 30_000 })
    await expect(smsField(page, '번호')).toHaveValue('77')
    await context.setOffline(false)
    await page.getByRole('button', { name: '다시 보내기' }).click()
    const result = page.getByRole('region', { name: '넣은 결과' })
    await expect(result).toContainText('77번 · 문자찜(오프) · 보류')
    expect((await history(page, date, true)).filter((e) => e.type === 'sms')).toHaveLength(1)
    await result.getByRole('button', { name: '찜 취소하기' }).click()
    await page.keyboard.press('1')
    await page.keyboard.press('Enter')
    await expect(result).toContainText('취소됨', { timeout: 15_000 })
  })

  test('AC-S06-14: 아직 없는 번호 → 보류 → 다른 기기에서 등록하면 결과·최근 목록이 1등으로', async ({ page }) => {
    await login(page)
    const title = uniq('보류')
    const { b } = await rehearsalWithTitle(page, title)
    await openSms(page, title)
    await smsUi(page, { no: 21, memo: '이씨' })
    const result = page.getByRole('region', { name: '넣은 결과' })
    await expect(result).toContainText('21번 · 문자찜(이씨) · 보류')
    await registerApi(page, b, 21, '튤립', 7000)
    await expect(result).toContainText('21번 · 문자찜(이씨) · 1등')
    await expect(page.getByRole('region', { name: '최근 넣은 문자찜' })).toContainText('튤립')
  })
})

async function scopeDate(page: Page, b: string): Promise<string> {
  const list = await (await page.request.get('/api/broadcasts')).json() as { broadcasts: { id: string; date: string }[] }
  return list.broadcasts.find((x) => x.id === b)!.date
}
