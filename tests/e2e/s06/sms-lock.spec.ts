// 문자찜 보내는 동안 잠금·성공 응답 바로 비우기·따라잡기 전 결과 카드·실패면 그대로 (AC-SMS-01~04, ORD-08 AC8, D-SMS-01) — test-e2e.
// 휴대폰(375px)에서 판매자가 문자찜을 빠르게 이어 넣는 흐름. 기대값은 스펙 문장에서 정한다. 기다림은 상태로.
// - 쓰기 응답 붙잡기: POST /api/events는 서버에 닿게 한 뒤(기록됨) 응답만 문을 열 때까지 쥐고 있는다.
// - 화면 따라잡기 붙잡기: 화면의 범위 조회(/api/days/<날짜>…: 증분 /changes 포함)를 문을 열 때까지 쥐고 있는다.
// "1초 안에"(AC-SMS-02)는 시간 단언 대신 "따라잡기를 쥔 채로 칸이 빈다"로 확인한다 — 따라잡기를 기다리지 않는다는 뜻이 그것이고,
// 부하에서 흔들리는 시간 단언은 일반 시험에 두지 않는다(D-902, test-common 비례 원칙).
import { test, expect, type Browser, type Page, type Route } from '@playwright/test'
import { history, kstTimeAgo, login, openNewBroadcast, openSms, registerApi, smsField, uniqueDate, viewerClaim } from './support.ts'

function uniq(prefix: string): string {
  return `${prefix}${String(Math.floor(Math.random() * 1e6))}`
}

async function phone(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL!
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await login(page)
  return page
}

/** 열 때까지 기다리는 문 */
function gate(): { readonly wait: Promise<void>; readonly open: () => void } {
  let open: () => void = () => undefined
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { wait, open }
}

/** 문자찜 쓰기 응답을 붙잡는다 (서버에는 닿아 기록된다). 지나간 요청 번호를 모은다 */
async function holdWrites(page: Page): Promise<{ readonly release: () => void; readonly arrived: Promise<void>; readonly requestIds: string[] }> {
  const door = gate()
  const first = gate()
  const requestIds: string[] = []
  await page.route('**/api/events', async (route: Route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.continue()
    const body = request.postDataJSON() as { requestId?: string; type?: string }
    if (body.type !== 'sms') return route.continue()
    requestIds.push(String(body.requestId))
    const response = await route.fetch()
    first.open()
    await door.wait
    await route.fulfill({ response }).catch(() => undefined)
  })
  return { release: door.open, arrived: first.wait, requestIds }
}

/** 화면 따라잡기(범위 조회)를 붙잡는다 */
async function holdCatchUp(page: Page): Promise<{ readonly release: () => void; readonly held: () => number }> {
  const door = gate()
  let held = 0
  await page.route(
    (url) => url.pathname.startsWith('/api/days/'),
    async (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue()
      held += 1
      await door.wait
      await route.continue().catch(() => undefined)
    },
  )
  return { release: door.open, held: () => held }
}

async function rehearsal(page: Page, title: string): Promise<{ b: string; date: string }> {
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true, title })
  return { b, date }
}

const LOCKED_NOTE = '보내는 중이라 잠시 고칠 수 없어요.'
const FIELDS = ['번호', '받은 시각', '전화번호', '메모'] as const

test.describe('문자찜 보내는 동안·보낸 뒤의 칸 (휴대폰)', () => {
  test('AC-SMS-01: 보내는 동안 칸은 읽기 전용, 방송 고르기·구매자 고르기·보내기·이전 카드 "같은 사람 하나 더"는 못 누르고, 쳐도 값이 그대로', async ({ browser }) => {
    const page = await phone(browser)
    const title = uniq('잠금')
    const { b, date } = await rehearsal(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '로즈', 5000)
    await viewerClaim(page, b, '홍길동', '16', 'sim_hong_lock1')
    await openSms(page, title)
    // 이전 결과 카드 (구매자가 있어 "같은 사람 하나 더"가 있다)
    await smsField(page, '번호').fill('16')
    await smsField(page, '메모').fill('박씨')
    await page.getByRole('button', { name: '16번에 문자찜 넣기' }).click()
    const result = page.getByRole('region', { name: '넣은 결과' })
    await expect(result).toContainText('16번 · 문자찜(박씨)')
    await expect(result).not.toContainText('상태 확인 중')
    await expect(result.getByRole('button', { name: '같은 사람 하나 더' })).toBeEnabled()

    const received = kstTimeAgo(60)
    await smsField(page, '번호').fill('15')
    await smsField(page, '받은 시각').fill(received)
    await smsField(page, '전화번호').fill('010-1234-5678')
    await smsField(page, '메모').fill('김씨')
    await smsField(page, '구매자 고르기').fill('홍길')
    const found = page.getByRole('list', { name: '찾은 구매자' }).getByRole('button', { name: /홍길동/ })
    await expect(found).toBeEnabled()

    const writes = await holdWrites(page)
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    await writes.arrived
    await expect(page.getByText('보내는 중…', { exact: true })).toBeVisible()
    await expect(page.getByText(LOCKED_NOTE, { exact: true })).toBeVisible()
    for (const name of FIELDS) {
      await expect(smsField(page, name), name).toHaveAttribute('readonly', '')
      await expect(smsField(page, name), name).not.toBeEditable()
    }
    await expect(smsField(page, '구매자 고르기')).not.toBeEditable()
    await expect(page.getByRole('region', { name: '고른 방송' }).getByRole('button', { name: /^방송 (바꾸기|고르기)$/ })).toBeDisabled()
    await expect(found).toBeDisabled()
    await expect(page.getByRole('button', { name: /문자찜 넣기$/ })).toBeDisabled()
    await expect(result.getByRole('button', { name: '같은 사람 하나 더' })).toBeDisabled()
    // 쳐도 값은 누를 때 그대로
    await smsField(page, '번호').focus()
    await page.keyboard.type('9')
    await page.keyboard.press('Backspace')
    await smsField(page, '메모').focus()
    await page.keyboard.type('추가')
    await expect(smsField(page, '번호')).toHaveValue('15')
    await expect(smsField(page, '받은 시각')).toHaveValue(received)
    await expect(smsField(page, '전화번호')).toHaveValue('010-1234-5678')
    await expect(smsField(page, '메모')).toHaveValue('김씨')
    await expect(smsField(page, '구매자 고르기')).toHaveValue('홍길')

    writes.release()
    await expect(smsField(page, '번호')).toHaveValue('')
    await expect(page.getByText(LOCKED_NOTE, { exact: true })).toHaveCount(0)
    await expect(smsField(page, '번호')).toBeEditable()
    await expect(result).toContainText('15번 · 문자찜(김씨)')
    const sms = (await history(page, date, true)).filter((e) => e.type === 'sms')
    expect(sms).toHaveLength(2)
    await page.context().close()
  })

  test('AC-SMS-02·03: 따라잡기를 막아도 성공 응답에 바로 비움(고른 구매자 포함), 바로 친 "16"은 따라잡기 뒤에도 남는다, 카드는 "상태 확인 중…"에서 상태 문장으로', async ({ browser }) => {
    const page = await phone(browser)
    const title = uniq('비움')
    const { b, date } = await rehearsal(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '로즈', 5000)
    await registerApi(page, b, 17, '튤립', 7000)
    await openSms(page, title)
    // 먼저 하나 넣고 "같은 사람 하나 더"로 구매자를 고른다
    await smsField(page, '번호').fill('17')
    await smsField(page, '메모').fill('박씨')
    await page.getByRole('button', { name: '17번에 문자찜 넣기' }).click()
    const result = page.getByRole('region', { name: '넣은 결과' })
    await expect(result).toContainText('17번 · 문자찜(박씨) · 1등')
    await result.getByRole('button', { name: '같은 사람 하나 더' }).click()
    const picked = page.getByRole('group', { name: '고른 구매자' })
    await expect(picked).toContainText('문자찜(박씨)')
    const received = kstTimeAgo(60)
    await smsField(page, '받은 시각').fill(received)
    await smsField(page, '번호').fill('15')
    await smsField(page, '메모').fill('오후 문자')

    const catchUp = await holdCatchUp(page)
    const writes = await holdWrites(page)
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    await writes.arrived
    // 보내는 동안: 고른 구매자 지우기도 못 누른다 (AC-SMS-01)
    await expect(picked.getByRole('button', { name: '고른 구매자 지우기' })).toBeDisabled()
    await expect(page.getByText(LOCKED_NOTE, { exact: true })).toBeVisible()
    await expect(smsField(page, '번호')).toHaveValue('15')

    // 성공 응답만 온다 — 따라잡기는 여전히 붙잡혀 있다
    writes.release()
    for (const name of FIELDS) await expect(smsField(page, name), name).toHaveValue('')
    await expect(picked).toHaveCount(0)
    await expect(smsField(page, '구매자 고르기')).toBeVisible()
    await expect(page.getByText(LOCKED_NOTE, { exact: true })).toHaveCount(0)
    await expect(smsField(page, '번호')).toBeFocused()
    await expect(page.getByRole('region', { name: '고른 방송' })).toContainText(title)
    // 따라잡기 전 카드 (AC-SMS-03): 거짓 "생기지 않았어요" 없음, 응답의 구매자로 "같은 사람 하나 더"는 바로
    await expect(result).toContainText('15번 · 넣었어요 · 상태 확인 중…')
    await expect(result).not.toContainText('새 찜이 생기지 않았어요')
    await expect(result).not.toContainText('이미 찜한 구매자라')
    await expect(result.getByRole('button', { name: '찜 취소하기' })).toHaveCount(0)
    await expect(result.getByRole('button', { name: '같은 사람 하나 더' })).toBeEnabled()
    // 바로 다음 번호를 친다
    await page.keyboard.type('16')
    await expect(smsField(page, '번호')).toHaveValue('16')
    await smsField(page, '메모').fill('다음 문자')
    expect(catchUp.held(), '따라잡기 조회가 붙잡혀 있어야 한다').toBeGreaterThan(0)

    // 따라잡기를 푼다 → 카드가 상태 문장으로, 친 글은 그대로
    catchUp.release()
    // 문자 구매자의 표시 이름은 가장 최근 메모(R-11) — 방금 보낸 메모 "오후 문자"
    await expect(result).toContainText('15번 · 문자찜(오후 문자) · 1등 · 받은 시각')
    await expect(result).not.toContainText('상태 확인 중')
    await expect(result.getByRole('button', { name: '찜 취소하기' })).toBeVisible()
    await expect(smsField(page, '번호')).toHaveValue('16')
    await expect(smsField(page, '메모')).toHaveValue('다음 문자')
    // 이어 친 찜도 그대로 들어간다
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.getByRole('button', { name: '16번에 문자찜 넣기' }).click()
    await expect(result).toContainText('16번 · 문자찜(다음 문자) · 1등')
    const sms = (await history(page, date, true)).filter((e) => e.type === 'sms')
    expect(sms.map((e) => e.fields['no'])).toEqual([17, 15, 16])
    await page.context().close()
  })

  test('AC-SMS-03: 전화번호를 적었으면 따라잡기 전 카드에 "· 뒤 4자리 5678", 따라잡으면 상태 문장과 "찜 취소하기"', async ({ browser }) => {
    const page = await phone(browser)
    const title = uniq('뒤4')
    const { b } = await rehearsal(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await openSms(page, title)
    const received = kstTimeAgo(60)
    await smsField(page, '번호').fill('15')
    await smsField(page, '받은 시각').fill(received)
    await smsField(page, '전화번호').fill('010-1234-5678')
    await smsField(page, '메모').fill('김씨')
    const catchUp = await holdCatchUp(page)
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    const result = page.getByRole('region', { name: '넣은 결과' })
    await expect(result).toContainText('15번 · 넣었어요 · 상태 확인 중… · 뒤 4자리 5678')
    for (const name of FIELDS) await expect(smsField(page, name), name).toHaveValue('')
    await expect(result).not.toContainText('새 찜이 생기지 않았어요')
    await expect(result).not.toContainText('이미 찜한 구매자라')
    await expect(result.getByRole('button', { name: '같은 사람 하나 더' })).toBeEnabled()
    await page.keyboard.type('15')
    catchUp.release()
    await expect(result).toContainText('15번 · 문자찜(김씨) · 1등 · 받은 시각')
    await expect(result).toContainText('뒤 4자리 5678')
    await expect(result.getByRole('button', { name: '찜 취소하기' })).toBeVisible()
    await expect(smsField(page, '번호')).toHaveValue('15')
    // 전화번호 원문이 화면에 남지 않는다 (AC-S06-81)
    expect(await page.locator('body').innerText()).not.toMatch(/010-?1234-?5678|01012345678/)
    await page.context().close()
  })

  test('AC-SMS-04: 응답을 못 받으면 잠금이 풀리고 번호·받은 시각·메모·고른 구매자가 그대로, 다시 보내면 같은 요청 번호로 찜 하나', async ({ browser }) => {
    const page = await phone(browser)
    const title = uniq('실패')
    const { b, date } = await rehearsal(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 17, '튤립', 7000)
    await openSms(page, title)
    await smsField(page, '번호').fill('17')
    await smsField(page, '메모').fill('박씨')
    await page.getByRole('button', { name: '17번에 문자찜 넣기' }).click()
    const result = page.getByRole('region', { name: '넣은 결과' })
    await expect(result).toContainText('17번 · 문자찜(박씨) · 1등')
    await result.getByRole('button', { name: '같은 사람 하나 더' }).click()
    const picked = page.getByRole('group', { name: '고른 구매자' })
    await expect(picked).toContainText('문자찜(박씨)')
    const received = kstTimeAgo(60)
    await smsField(page, '받은 시각').fill(received)
    await smsField(page, '번호').fill('15')
    await smsField(page, '메모').fill('두 번째')

    let lose = true
    const requestIds: string[] = []
    await page.route('**/api/events', async (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.continue()
      const body = request.postDataJSON() as { requestId?: string; type?: string }
      if (body.type !== 'sms') return route.continue()
      requestIds.push(String(body.requestId))
      if (lose) {
        await route.fetch() // 서버에는 닿았다(기록됨) — 응답만 잃는다
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    await expect(page.getByText(/저장하지 못했어요/)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(LOCKED_NOTE, { exact: true })).toHaveCount(0)
    await expect(smsField(page, '번호')).toBeEditable()
    await expect(smsField(page, '번호')).toHaveValue('15')
    await expect(smsField(page, '받은 시각')).toHaveValue(received)
    await expect(smsField(page, '메모')).toHaveValue('두 번째')
    // 고른 구매자는 그대로 (표시 이름은 서버에 닿은 메모 "두 번째"로 바뀌었을 수 있다 — R-11)
    await expect(picked).toContainText(/문자찜\((박씨|두 번째)\)/)
    await expect(picked.getByRole('button', { name: '고른 구매자 지우기' })).toBeEnabled()

    lose = false
    await page.getByRole('button', { name: '다시 보내기' }).click()
    await expect(result).toContainText('15번 · 문자찜(두 번째) · 1등')
    for (const name of ['번호', '받은 시각', '메모'] as const) await expect(smsField(page, name), name).toHaveValue('')
    expect(new Set(requestIds).size, JSON.stringify(requestIds)).toBe(1)
    const sms = (await history(page, date, true)).filter((e) => e.type === 'sms' && e.fields['no'] === 15)
    expect(sms).toHaveLength(1)
    await page.context().close()
  })

  test('AC-SMS-04: 서버가 거절하면(메모의 휴대폰 번호 400) 칸은 친 그대로·오류 문장, 고치지 않고 다시 보내면 찜 하나', async ({ browser }) => {
    const page = await phone(browser)
    const title = uniq('거절')
    const { b, date } = await rehearsal(page, title)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await openSms(page, title)
    const received = kstTimeAgo(60)
    await smsField(page, '번호').fill('15')
    await smsField(page, '받은 시각').fill(received)
    await smsField(page, '전화번호').fill('010-2468-1357')
    await smsField(page, '메모').fill('이씨')
    // 화면 검사는 지나간 요청을 서버가 거절하게 한다: 가는 길에 메모에 휴대폰 번호를 붙인다(서버의 D-079 검사)
    let reject = true
    const requestIds: string[] = []
    await page.route('**/api/events', async (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.continue()
      const body = request.postDataJSON() as Record<string, unknown>
      if (body['type'] !== 'sms') return route.continue()
      requestIds.push(String(body['requestId']))
      if (!reject) return route.continue()
      const response = await route.fetch({ postData: JSON.stringify({ ...body, memo: `${String(body['memo'])} 01098765432` }) })
      expect(response.status(), await response.text()).toBe(400)
      await route.fulfill({ response })
    })
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    const form = page.getByRole('region', { name: '문자찜 넣기' })
    await expect(form.getByRole('alert').first()).toBeVisible()
    await expect(page.getByText(LOCKED_NOTE, { exact: true })).toHaveCount(0)
    await expect(smsField(page, '번호')).toBeEditable()
    await expect(smsField(page, '번호')).toHaveValue('15')
    await expect(smsField(page, '받은 시각')).toHaveValue(received)
    await expect(smsField(page, '전화번호')).toHaveValue('010-2468-1357')
    await expect(smsField(page, '메모')).toHaveValue('이씨')
    await expect(page.getByRole('region', { name: '넣은 결과' })).toHaveCount(0)
    expect((await history(page, date, true)).filter((e) => e.type === 'sms')).toHaveLength(0)

    reject = false
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    await expect(page.getByRole('region', { name: '넣은 결과' })).toContainText('15번 · 문자찜(이씨)')
    // 거절된 요청은 기록되지 않았으니 다시 보내도 찜은 하나다. (요청 번호를 그대로 쓰는지는 최종 거절이라 따지지 않는다 — 보고에 남김)
    expect(requestIds).toHaveLength(2)
    expect((await history(page, date, true)).filter((e) => e.type === 'sms')).toHaveLength(1)
    await page.context().close()
  })
})
