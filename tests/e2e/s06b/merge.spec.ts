// 합치기 미리 보기는 서버 계산 · 막힌 합치기 이어 가기 (AC-S06b-33·34·40, BUY-03, R-11, D-100, D-102, G-ENG-174) — test-e2e.
// 기대값은 골든 G-ENG-174를 손으로 옮겼다(상품·가격·찜 순서 같음). 기다림은 상태로.
import { test, expect, type Page } from '@playwright/test'
import { history, login, openNewBroadcast, phoneLike, previewSettled, registerApi, scopeView, smsApi, uniq, uniqueDate, viewerClaim, writeEvent } from './support.ts'

interface Day { b: string; date: string; title: string; a: string; x: string; bb: string; y: string }

/** G-ENG-174 앞부분: A(홍길동) 15·18·19 1등, B(영희) 16 1등, X(문자찜(김씨)) 18·19 1등 + 16 대기 1, A 16 대기 2, Y(문자찜) 17 1등 */
async function setup174(page: Page): Promise<Day> {
  const date = uniqueDate()
  const title = uniq('합')
  const b = await openNewBroadcast(page, { date, rehearsal: true, title })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await registerApi(page, b, 16, '라울', 5000)
  await registerApi(page, b, 17, '성미인', 8000)
  for (const [no, name, price] of [[18, '블루버드', 6000], [19, '금황성', 7000]] as const) {
    const reg = await writeEvent(page, { type: 'product.register', b, no, name, price, stock: 2 })
    expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
  }
  const chA = uniq('sim_a_')
  await viewerClaim(page, b, '홍길동', '15', chA)
  await viewerClaim(page, b, '홍길동', '18', chA)
  await viewerClaim(page, b, '홍길동', '19', chA)
  await viewerClaim(page, b, '영희', '16', uniq('sim_b_'))
  await smsApi(page, { b, no: 18, phone: '010-1111-2222', memo: '김씨' })
  await smsApi(page, { b, no: 19, phone: '01011112222', memo: '김씨' })
  await smsApi(page, { b, no: 16, phone: '010 1111 2222' })
  await viewerClaim(page, b, '홍길동', '16', chA)
  await smsApi(page, { b, no: 17 })
  await viewerClaim(page, b, '철수', '안녕하세요', uniq('sim_c_'))
  const view = await scopeView(page, date, true)
  const id = (pred: (x: (typeof view.buyers)[number]) => boolean) => view.buyers.find(pred)!.id
  const day = {
    b, date, title,
    a: id((x) => x.display === '홍길동'),
    x: id((x) => x.kind === 'sms' && x.phoneLast4 === '2222'),
    bb: id((x) => x.display === '영희'),
    y: id((x) => x.kind === 'sms' && x.phoneLast4 === null),
  }
  // 골든 G-ENG-174 첫 assert와 같은 상태인지
  expect(view.buyers.find((x) => x.id === day.a)!.subtotal).toBe(23000)
  expect(view.buyers.find((x) => x.id === day.x)!.subtotal).toBe(13000)
  return day
}

async function openMerge(page: Page, day: Day, opened: string, pickQuery: string, pickName: RegExp) {
  await page.goto(`/buyers?date=${day.date}&rehearsal=true&buyer=${encodeURIComponent(opened)}`)
  const detail = page.getByRole('region', { name: '구매자 자세히' })
  await detail.getByRole('button', { name: '다른 구매자와 합치기' }).click()
  const pick = page.getByRole('dialog', { name: '다른 구매자와 합치기' })
  await pick.getByLabel('합칠 구매자 찾기').fill(pickQuery)
  await pick.getByRole('list', { name: '합칠 구매자' }).getByRole('button', { name: pickName }).first().click()
  const dlg = page.getByRole('dialog', { name: '구매자 합치기' })
  await previewSettled(dlg)
  return { detail, dlg }
}

/** 상품 자세히에서 그 사람 1등 찜을 사유 1번으로 취소하고(5초 대기 — E2E 기동 값), 보낼 때까지 */
async function cancelIn(page: Page, day: Day, product: ReturnType<Page['getByRole']>, who: RegExp, count: number) {
  await product.getByRole('listitem').filter({ hasText: who }).getByRole('button', { name: '찜 취소하기' }).click()
  const reason = page.getByRole('dialog').last()
  await reason.getByRole('button', { name: /^1 / }).click()
  await reason.getByRole('button', { name: '찜 취소하기' }).click()
  await expect.poll(async () => (await history(page, day.date, true)).filter((e) => e.type === 'host.cancel').length, { timeout: 15_000 }).toBe(count)
}

test.describe('합치기 미리 보기 (AC-S06b-33·34)', () => {
  test('G-ENG-174 흐름 (PC): 두 상품 막힘 → 18번 자세히에서 취소 → 합치기로 돌아가기 → 19번 자세히에서 취소 → 브라우저 뒤로 → 풀림·중복 → 합치기', async ({ page }) => {
    await login(page)
    const day = await setup174(page)
    const { detail, dlg } = await openMerge(page, day, day.x, '홍길동', /홍길동/)
    const mergeButton = dlg.getByRole('button', { name: '합치기', exact: true })
    // 하나만 유튜브 → 유튜브 쪽(A)이 남는다. 18·19번 모두 막힘 (상품마다 한 문장)
    await expect(dlg).toContainText('남는 이름: 홍길동(유튜브)')
    const blocked = dlg.getByRole('alert')
    await expect(blocked).toHaveAttribute('data-tone', 'danger')
    await expect(blocked).toContainText(/18번에 두 사람 모두 1등이에요\. 먼저 한 사람의 찜을 취소해 주세요\./)
    await expect(blocked).toContainText(/19번에 두 사람 모두 1등이에요\. 먼저 한 사람의 찜을 취소해 주세요\./)
    await expect(dlg).not.toContainText('합친 뒤 합계') // 막히면 합친 뒤 합계 줄이 없다
    await expect(mergeButton).toBeDisabled()
    // 주소에는 구매자 ID만 (전화번호·메모 없음)
    const url = new URL(page.url())
    expect(url.searchParams.get('merge')).toBe(day.a)
    expect(url.searchParams.get('into')).toBe(day.a)
    expect(page.url()).not.toMatch(/1111|2222|%EA%B9%80|김씨/)

    // 18번: 문자찜(김씨)의 1등 취소 → 합치기로 돌아가기
    await blocked.getByRole('button', { name: /18번 자세히$/ }).click()
    let product = page.getByRole('dialog', { name: /18번 자세히$/ })
    expect(new URL(page.url()).searchParams.get('product')).toBe(`${day.b}/18`)
    await cancelIn(page, day, product, /문자찜\(김씨\)/, 1)
    await product.getByRole('button', { name: '합치기로 돌아가기' }).click()
    await previewSettled(dlg)
    await expect(dlg.getByRole('alert')).toContainText(/19번에 두 사람 모두 1등이에요/)
    await expect(dlg.getByRole('alert')).not.toContainText('18번에')
    await expect(mergeButton).toBeDisabled()

    // 19번: 홍길동의 1등 취소 → 브라우저 뒤로 가기로 같은 합치기 창
    await dlg.getByRole('alert').getByRole('button', { name: /19번 자세히$/ }).click()
    product = page.getByRole('dialog', { name: /19번 자세히$/ })
    await cancelIn(page, day, product, /홍길동/, 2)
    await page.goBack()
    await expect(product).toHaveCount(0)
    await previewSettled(dlg)
    // 골든: 옮길 X 확정 19번 7,000 → 합친 뒤 A 15·18(16,000) + 19(7,000) = 23,000. 16번 A의 대기 2번 찜이 중복
    await expect(dlg.getByRole('alert')).toHaveCount(0)
    await expect(dlg).toContainText('옮겨 갈 확정 찜 1개 · 7,000원')
    await expect(dlg).toContainText('합친 뒤 합계 23,000원')
    const dup = dlg.getByRole('note')
    await expect(dup).toHaveAttribute('data-tone', 'warning')
    await expect(dup).toContainText(/16번: 홍길동의 대기 2번 찜이 중복으로 정리돼요/)
    await expect(dup).toContainText('떼어 내도 돌아오지 않아요.')
    await expect(mergeButton).toBeEnabled()
    await dlg.getByRole('button', { name: /^1 / }).click()
    await mergeButton.click()
    const done = page.getByText('합쳤어요')
    await expect(done).toBeVisible()
    await expect(done).toHaveAttribute('data-tone', 'success')
    await expect(detail.getByRole('heading', { level: 2 })).toHaveText('홍길동')
    await expect(detail.getByRole('region', { name: '확정 상품' })).toContainText('전체 합계 23,000원')
    // 미리 본 그대로 (골든 마지막 expect)
    const view = await scopeView(page, day.date, true)
    expect(view.claims.filter((c) => c.status === 'DUPLICATE').map((c) => `${c.buyer}/${String(c.no)}`)).toEqual([`${day.a}/16`])
    expect(view.settlements.find((s) => s.buyer === day.a)!.total).toBe(27000)
  })

  test('두 기기: 막힌 미리 보기를 연 채 다른 기기에서 찜 취소 → 새로 받아 막힘이 풀려 보인다', async ({ page, browser }) => {
    await login(page)
    const day = await setup174(page)
    const { dlg } = await openMerge(page, day, day.x, '홍길동', /홍길동/)
    const mergeButton = dlg.getByRole('button', { name: '합치기', exact: true })
    await expect(mergeButton).toBeDisabled()
    const mobile = await phoneLike(browser, page)
    try {
      // 휴대폰에서 X 18번, A 19번 취소 (API — 다른 기기의 쓰기)
      expect((await writeEvent(mobile, { type: 'host.cancel', b: day.b, no: 18, buyer: day.x, reason: '같은 사람 중복' })).status).toBeLessThan(300)
      expect((await writeEvent(mobile, { type: 'host.cancel', b: day.b, no: 19, buyer: day.a, reason: '같은 사람 중복' })).status).toBeLessThan(300)
      await expect(dlg.getByRole('alert')).toHaveCount(0, { timeout: 5000 })
      await expect(dlg).toContainText('합친 뒤 합계 23,000원')
      await expect(mergeButton).toBeEnabled()
    } finally {
      await mobile.context().close()
    }
  })

  test('두 기기: 풀린 미리 보기를 연 채 다른 기기의 찜으로 다시 막히면 "합치기"를 누를 수 없다 (낡은 미리 보기로 보내지 않음)', async ({ page, browser }) => {
    await login(page)
    const day = await setup174(page)
    // Y(17번 1등) → B(16번 1등): 겹치는 상품 없음 → 합칠 수 있음. 그 뒤 재고 2인 20번에 둘 다 1등이 되면 막혀야 한다
    const reg = await writeEvent(page, { type: 'product.register', b: day.b, no: 20, name: '새상품', price: 3000, stock: 2 })
    expect(reg.status).toBeLessThan(300)
    const { dlg } = await openMerge(page, day, day.y, '영희', /영희/)
    const mergeButton = dlg.getByRole('button', { name: '합치기', exact: true })
    await expect(dlg).toContainText('합친 뒤 합계 13,000원') // 골든: B 5,000 + Y 8,000
    await expect(mergeButton).toBeEnabled()
    const mobile = await phoneLike(browser, page)
    try {
      await viewerClaim(mobile, day.b, '영희', '20', day.bb)
      await smsApi(mobile, { b: day.b, no: 20, buyer: day.y })
      await expect(dlg.getByRole('alert')).toContainText(/20번에 두 사람 모두 1등이에요/, { timeout: 5000 })
      await expect(mergeButton).toBeDisabled()
      await expect(dlg).not.toContainText('합친 뒤 합계')
    } finally {
      await mobile.context().close()
    }
  })

  test('AC-S06b-34 휴대폰: 막힘 → 상품 자세히에서 취소(5초 대기 중) → 합치기로 돌아가기는 떠나기 확인 → 닫기 → 보낸 뒤 돌아가면 풀림', async ({ page, browser }) => {
    await login(page)
    const day = await setup174(page)
    // 18번은 API로 미리 풀어 둔다 → 19번 하나만 막힘
    expect((await writeEvent(page, { type: 'host.cancel', b: day.b, no: 18, buyer: day.x, reason: '같은 사람 중복' })).status).toBeLessThan(300)
    const mobile = await phoneLike(browser, page)
    try {
      const { dlg } = await openMerge(mobile, day, day.x, '홍길동', /홍길동/)
      await expect(dlg.getByRole('alert')).toContainText(/19번에 두 사람 모두 1등이에요/)
      await dlg.getByRole('alert').getByRole('button', { name: /19번 자세히$/ }).click()
      const product = mobile.getByRole('dialog', { name: /19번 자세히$/ })
      await product.getByRole('listitem').filter({ hasText: /홍길동/ }).getByRole('button', { name: '찜 취소하기' }).click()
      const reason = mobile.getByRole('dialog').last()
      await reason.getByRole('button', { name: /^1 / }).click()
      await reason.getByRole('button', { name: '찜 취소하기' }).click()
      // 대기 중에 돌아가려 하면 떠나기 확인
      await product.getByRole('button', { name: '합치기로 돌아가기' }).click()
      const leave = mobile.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
      await expect(leave).toBeVisible()
      await leave.getByRole('button', { name: '닫기' }).click()
      await expect(leave).toHaveCount(0)
      await expect.poll(async () => (await history(page, day.date, true)).filter((e) => e.type === 'host.cancel').length, { timeout: 15_000 }).toBe(2)
      await product.getByRole('button', { name: '합치기로 돌아가기' }).click()
      await expect(leave).toHaveCount(0)
      await previewSettled(dlg)
      await expect(dlg.getByRole('alert')).toHaveCount(0)
      await expect(dlg).toContainText('합친 뒤 합계 23,000원')
      await expect(dlg.getByRole('button', { name: '합치기', exact: true })).toBeEnabled()
    } finally {
      await mobile.context().close()
    }
  })

  test('주소로 다시 연 합치기 창(새로고침)도 같은 상대·방향, 방향 바꾸기는 새로 받는다 (CYCLE·FROM_MERGED 낱말)', async ({ page }) => {
    await login(page)
    const day = await setup174(page)
    expect((await writeEvent(page, { type: 'host.cancel', b: day.b, no: 18, buyer: day.x, reason: '같은 사람 중복' })).status).toBeLessThan(300)
    expect((await writeEvent(page, { type: 'host.cancel', b: day.b, no: 19, buyer: day.a, reason: '같은 사람 중복' })).status).toBeLessThan(300)
    expect((await writeEvent(page, { type: 'buyer.merge', from: day.x, into: day.a, reason: '같은 사람' }, { date: day.date, rehearsal: true })).status).toBeLessThan(300)
    // A 자세히에서 X(이미 A에 합쳐짐)를 상대로: 주소로 바로 연다 (X → A 방향 = 고리가 아니라 이미 합쳐짐)
    await page.goto(`/buyers?date=${day.date}&rehearsal=true&buyer=${encodeURIComponent(day.a)}&merge=${encodeURIComponent(day.x)}&into=${encodeURIComponent(day.a)}`)
    const dlg = page.getByRole('dialog', { name: '구매자 합치기' })
    await previewSettled(dlg)
    await expect(dlg.getByRole('alert')).toContainText('문자찜(김씨)는 이미 홍길동에 합쳐져 있어요. 먼저 떼어 내 주세요.')
    await page.reload()
    await previewSettled(dlg)
    await expect(dlg.getByRole('alert')).toContainText('문자찜(김씨)는 이미 홍길동에 합쳐져 있어요. 먼저 떼어 내 주세요.')
    await dlg.getByRole('button', { name: '방향 바꾸기' }).click()
    await previewSettled(dlg)
    // A → X: X의 지금의 구매자가 A → 고리
    await expect(dlg.getByRole('alert')).toContainText('문자찜(김씨)는 이미 홍길동에 합쳐져 있어요.')
    await expect(dlg.getByRole('alert')).not.toContainText('먼저 떼어 내 주세요.')
    expect(new URL(page.url()).searchParams.get('into')).toBe(day.x)
    await expect(dlg.getByRole('button', { name: '합치기', exact: true })).toBeDisabled()
  })

  test('미리 보기를 받지 못하면 "미리 보기를 받지 못했어요." + "다시 받기", 그동안 "합치기"를 누를 수 없다', async ({ page }) => {
    await login(page)
    const day = await setup174(page)
    let fail = true
    await page.route('**/merge-preview?**', async (route) => {
      if (fail) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '잠시 뒤 다시 시도해 주세요.' } }) })
        return
      }
      await route.continue()
    })
    await page.goto(`/buyers?date=${day.date}&rehearsal=true&buyer=${encodeURIComponent(day.y)}&merge=${encodeURIComponent(day.bb)}&into=${encodeURIComponent(day.bb)}`)
    const dlg = page.getByRole('dialog', { name: '구매자 합치기' })
    await expect(dlg.getByRole('alert')).toContainText('미리 보기를 받지 못했어요.')
    await expect(dlg.getByRole('alert')).toHaveAttribute('data-tone', 'danger')
    await expect(dlg.getByRole('button', { name: '합치기', exact: true })).toBeDisabled()
    fail = false
    await dlg.getByRole('button', { name: '다시 받기' }).click()
    await previewSettled(dlg)
    await expect(dlg).toContainText('합친 뒤 합계 13,000원')
    await expect(dlg.getByRole('button', { name: '합치기', exact: true })).toBeEnabled()
  })

  test('G-ENG-175 흐름 (실제 시각순·HOST): 중복 문장은 상태 낱말까지 — 16번 대기 찜, 보류(아직 없는 20번) 찜, 방향을 바꿔도 같은 찜', async ({ page }) => {
    await login(page)
    const origin = new URL(page.url()).origin
    const before = await (await page.request.get('/api/settings')).json() as { settings: Record<string, unknown> }
    const set = await page.request.patch('/api/settings', { data: { settings: { 'contention.policy': 'RECEIVED_TIME', 'contention.sameMinuteTieBreaker': 'HOST' } }, headers: { Origin: origin } })
    expect(set.ok(), await set.text()).toBe(true)
    let b: string
    const date = uniqueDate()
    try {
      b = await openNewBroadcast(page, { date, rehearsal: true, title: uniq('시각') })
    } finally {
      await page.request.patch('/api/settings', { data: { settings: { 'contention.policy': before.settings['contention.policy'] ?? 'ARRIVAL', 'contention.sameMinuteTieBreaker': before.settings['contention.sameMinuteTieBreaker'] ?? 'HOST' } }, headers: { Origin: origin } })
    }
    await registerApi(page, b, 16, '라울', 5000)
    const chA = uniq('sim_a_')
    const chB = uniq('sim_b_')
    const kst = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ms))
    const tA = Date.now()
    await viewerClaim(page, b, '홍길동', '16', chA)
    // 분까지만 적은 문자 = A의 게시 분 → 동률 → HOST → 충돌
    await smsApi(page, { b, no: 16, memo: '김씨', received: kst(tA).slice(0, 5) })
    await viewerClaim(page, b, '영희', '16', chB) // 충돌 중 → 대기 1
    const tB = Date.now()
    await viewerClaim(page, b, '영희', '20', chB) // 보류
    let view = await scopeView(page, date, true)
    const x = view.buyers.find((v) => v.kind === 'sms')!.id
    await smsApi(page, { b, no: 20, buyer: x, received: kst(tB - 20_000) }) // 실제 시각이 B보다 앞섬 → 보류 판정 순위 X가 앞
    view = await scopeView(page, date, true)
    expect(view.claims.find((c) => c.buyer === x && c.no === 16)?.status, JSON.stringify(view.claims)).toBe('CONFLICT')
    await page.goto(`/buyers?date=${date}&rehearsal=true&buyer=${encodeURIComponent(chB)}&merge=${encodeURIComponent(x)}&into=${encodeURIComponent(x)}`)
    const dlg = page.getByRole('dialog', { name: '구매자 합치기' })
    await previewSettled(dlg)
    const dup = dlg.getByRole('note')
    await expect(dup).toContainText(/16번: 영희의 대기 1번 찜이 중복으로 정리돼요/)
    await expect(dup).toContainText(/20번: 영희의 보류 찜이 중복으로 정리돼요/)
    await expect(dlg).toContainText('합친 뒤 합계 0원')
    await dlg.getByRole('button', { name: '방향 바꾸기' }).click()
    await previewSettled(dlg)
    await expect(dup).toContainText(/16번: 영희의 대기 1번 찜이 중복으로 정리돼요/)
    await expect(dup).toContainText(/20번: 영희의 보류 찜이 중복으로 정리돼요/)
    // X → A: X의 충돌 찜이 중복
    await page.goto(`/buyers?date=${date}&rehearsal=true&buyer=${encodeURIComponent(x)}&merge=${encodeURIComponent(chA)}&into=${encodeURIComponent(chA)}`)
    await previewSettled(dlg)
    await expect(dup).toContainText(/16번: 문자찜\(김씨\)의 충돌 찜이 중복으로 정리돼요/)
    await expect(dlg).toContainText('합친 뒤 합계 5,000원')
  })

  test('주소의 상대가 범위에 없는 구매자·같은 구매자면 막힘 문장 (UNKNOWN_BUYER·SAME_BUYER), 합치기를 누를 수 없다', async ({ page }) => {
    await login(page)
    const day = await setup174(page)
    const dlg = page.getByRole('dialog', { name: '구매자 합치기' })
    await page.goto(`/buyers?date=${day.date}&rehearsal=true&buyer=${encodeURIComponent(day.a)}&merge=${encodeURIComponent('UC_nobody_here')}`)
    await previewSettled(dlg)
    await expect(dlg.getByRole('alert')).toContainText('구매자를 찾지 못했어요. 화면을 새로 불러와 주세요.')
    await expect(dlg.getByRole('button', { name: '합치기', exact: true })).toBeDisabled()
    await expect(dlg).not.toContainText('합친 뒤 합계')
    await page.goto(`/buyers?date=${day.date}&rehearsal=true&buyer=${encodeURIComponent(day.a)}&merge=${encodeURIComponent(day.a)}`)
    await previewSettled(dlg)
    await expect(dlg.getByRole('alert')).toContainText('같은 구매자끼리는 합칠 수 없어요.')
    await expect(dlg.getByRole('button', { name: '합치기', exact: true })).toBeDisabled()
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/undefined|null|NaN|UNKNOWN_BUYER|SAME_BUYER/)
  })
})
