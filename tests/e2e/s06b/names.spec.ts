// 구매자 이름 표기 하나 (AC-S06b-20, BUY-01, D-098) — test-e2e.
// 같은 표시 이름이 둘 이상이면 "표시 이름 · 구분 글자", 그래도 같으면 생긴 순서로 " · 2". 목록·자세히·정산·합치기 창·문자찜 결과에서 같은 글자.
import { test, expect, type Page } from '@playwright/test'
import { boardItem, login, openNewBroadcast, openSms, registerApi, scopeView, smsApi, smsField, uniq, uniqueDate, viewerClaim, writeEvent } from './support.ts'

async function day(page: Page): Promise<{ b: string; date: string; title: string }> {
  const date = uniqueDate()
  const title = uniq('이름')
  const b = await openNewBroadcast(page, { date, rehearsal: true, title })
  for (let no = 11; no <= 18; no++) await registerApi(page, b, no, `상품${String(no)}`, 1000 * no)
  return { b, date, title }
}

/** 목록·자세히·정산 목록·정산 자세히에서 그 구매자 이름 */
async function namesEverywhere(page: Page, date: string, id: string): Promise<string[]> {
  const out: string[] = []
  await page.goto(`/buyers?date=${date}&rehearsal=true`)
  const list = page.getByRole('table', { name: '구매자' })
  await expect(list.getByRole('link').first()).toBeVisible()
  const href = `buyer=${encodeURIComponent(id)}`
  out.push((await list.locator(`a.table-link[href*="${href}"]`).innerText()).trim())
  await page.goto(`/buyers?date=${date}&rehearsal=true&${href}`)
  out.push((await page.getByRole('region', { name: '구매자 자세히' }).getByRole('heading', { level: 2 }).innerText()).trim())
  await page.goto(`/settlements?date=${date}&rehearsal=true`)
  const settle = page.getByRole('table', { name: '정산 묶음' })
  await expect(settle.getByRole('link').first()).toBeVisible()
  out.push((await settle.locator(`a.table-link[href*="${href}"]`).innerText()).trim())
  await page.goto(`/settlements?date=${date}&rehearsal=true&${href}`)
  out.push((await page.getByRole('region', { name: '정산 자세히' }).getByRole('heading', { level: 2 }).innerText()).trim())
  return out
}

test.describe('이름 표기 (AC-S06b-20)', () => {
  test('같은 메모의 전화번호 없는 문자 구매자 둘: "문자찜(김씨) · 문자 20:01:05" / "· 문자 20:02" — 목록·자세히·정산에서 같다', async ({ page }) => {
    await login(page)
    const { b, date } = await day(page)
    await smsApi(page, { b, no: 11, memo: '김씨', received: '00:00:05' })
    await smsApi(page, { b, no: 12, memo: '김씨', received: '00:00' })
    const view = await scopeView(page, date, true)
    const sms = view.buyers.filter((x) => x.kind === 'sms')
    expect(sms).toHaveLength(2)
    const first = sms.find((x) => view.claims.some((c) => c.buyer === x.id && c.no === 11))!
    const second = sms.find((x) => x.id !== first.id)!
    expect(await namesEverywhere(page, date, first.id)).toEqual(Array(4).fill('문자찜(김씨) · 문자 00:00:05'))
    expect(await namesEverywhere(page, date, second.id)).toEqual(Array(4).fill('문자찜(김씨) · 문자 00:00'))
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/번째 문자|\) \(/)
  })

  test('받은 시각까지 같으면 생긴 순서로 " · 2" — 문자찜 결과 카드·최근 목록·구매자 고르기도 같은 이름', async ({ page }) => {
    await login(page)
    const { b, date, title } = await day(page)
    await smsApi(page, { b, no: 11, memo: '김씨', received: '00:00:07' })
    await openSms(page, title)
    await smsField(page, '번호').fill('12')
    await smsField(page, '받은 시각').fill('00:00:07')
    await smsField(page, '메모').fill('김씨')
    await page.getByRole('button', { name: '12번에 문자찜 넣기' }).click()
    const result = page.getByRole('region', { name: '넣은 결과' })
    await expect(result).toContainText('12번 · 문자찜(김씨) · 문자 00:00:07 · 2 · 1등')
    const recent = page.getByRole('region', { name: '최근 넣은 문자찜' })
    await expect(recent.getByRole('listitem').filter({ hasText: '12번' })).toContainText('문자찜(김씨) · 문자 00:00:07 · 2 ·')
    await expect(recent.getByRole('listitem').filter({ hasText: '11번' })).toContainText('문자찜(김씨) · 문자 00:00:07 ·')
    await expect(recent.getByRole('listitem').filter({ hasText: '11번' })).not.toContainText('00:00:07 · 2')
    // 구매자 고르기 찾기 결과
    await smsField(page, '구매자 고르기').fill('김씨')
    const found = page.getByRole('list', { name: '찾은 구매자' })
    await expect(found.getByRole('button', { name: /문자찜\(김씨\) · 문자 00:00:07 · 2/ })).toHaveCount(1)
    await expect(found.getByRole('button', { name: /문자찜\(김씨\) · 문자 00:00:07(?! · 2)/ })).toHaveCount(1)
    const view = await scopeView(page, date, true)
    const second = view.buyers.find((x) => x.kind === 'sms' && view.claims.some((c) => c.buyer === x.id && c.no === 12))!
    expect(await namesEverywhere(page, date, second.id)).toEqual(Array(4).fill('문자찜(김씨) · 문자 00:00:07 · 2'))
  })

  test('같은 닉네임 유튜브 둘 "홍길동 · 끝 1234", 같은 메모·뒤 4자리 같은 두 사람 "· 뒤 4자리 5678" / "· 2" — 합치기 창에서도 같다', async ({ page }) => {
    await login(page)
    const { b, date } = await day(page)
    const n = String(Math.floor(Math.random() * 9000) + 1000)
    await viewerClaim(page, b, '홍길동', '11', `sim_h1_${n}1111`)
    await viewerClaim(page, b, '홍길동', '12', `sim_h2_${n}2222`)
    await smsApi(page, { b, no: 13, memo: '박씨', phone: '010-1111-5678' })
    await smsApi(page, { b, no: 14, memo: '박씨', phone: '010-2222-5678' })
    const view = await scopeView(page, date, true)
    const h1 = view.buyers.find((x) => x.display === '홍길동' && x.id.endsWith('1111'))!
    const h2 = view.buyers.find((x) => x.display === '홍길동' && x.id.endsWith('2222'))!
    const p1 = view.buyers.find((x) => x.kind === 'sms' && view.claims.some((c) => c.buyer === x.id && c.no === 13))!
    const p2 = view.buyers.find((x) => x.kind === 'sms' && view.claims.some((c) => c.buyer === x.id && c.no === 14))!
    expect(await namesEverywhere(page, date, h1.id)).toEqual(Array(4).fill('홍길동 · 끝 1111'))
    expect(await namesEverywhere(page, date, h2.id)).toEqual(Array(4).fill('홍길동 · 끝 2222'))
    expect(await namesEverywhere(page, date, p1.id)).toEqual(Array(4).fill('문자찜(박씨) · 뒤 4자리 5678'))
    expect(await namesEverywhere(page, date, p2.id)).toEqual(Array(4).fill('문자찜(박씨) · 뒤 4자리 5678 · 2'))
    // 합치기 창: p2 자세히에서 p1을 상대로
    await page.goto(`/buyers?date=${date}&rehearsal=true&buyer=${encodeURIComponent(p2.id)}&merge=${encodeURIComponent(p1.id)}&into=${encodeURIComponent(p2.id)}`)
    const dlg = page.getByRole('dialog', { name: '구매자 합치기' })
    await expect(dlg).toContainText('남는 이름: 문자찜(박씨) · 뒤 4자리 5678 · 2(문자) ← 문자찜(박씨) · 뒤 4자리 5678(문자)')
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/번째 문자|\) \(|010-|01011115678|sms:/)
  })

  test('콘솔 보드·상품 자세히도 같은 이름 (같은 닉네임 둘, 같은 메모 문자 둘)', async ({ page }) => {
    await login(page)
    const { b } = await day(page)
    const n = String(Math.floor(Math.random() * 9000) + 1000)
    const reg = await writeEvent(page, { type: 'product.register', b, no: 20, name: '여럿', price: 3000, stock: 4 })
    expect(reg.status).toBeLessThan(300)
    await viewerClaim(page, b, '홍길동', '20', `sim_c1_${n}3333`)
    await viewerClaim(page, b, '홍길동', '20', `sim_c2_${n}4444`)
    await smsApi(page, { b, no: 20, memo: '김씨', received: '00:00:09' })
    await smsApi(page, { b, no: 20, memo: '김씨', received: '00:00:09' })
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    const item = boardItem(page, 20)
    await expect(item).toContainText('홍길동 · 끝 3333')
    await item.click()
    const detail = page.getByRole('dialog', { name: '20번 자세히' })
    for (const name of ['홍길동 · 끝 3333', '홍길동 · 끝 4444', '문자찜(김씨) · 문자 00:00:09', '문자찜(김씨) · 문자 00:00:09 · 2']) {
      await expect(detail.getByText(name, { exact: true })).toHaveCount(1)
    }
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/번째 문자|\) \(/)
  })

  test('채널 끝 4자리까지 같은 두 "홍길동": 생긴 순서(먼저 온 채팅)로 둘째에 " · 2" — ID 글자 순서가 아니다, 새로고침·증분 뒤에도 같다', async ({ page }) => {
    await login(page)
    const { b, date } = await day(page)
    const n = String(Math.floor(Math.random() * 9000) + 1000)
    const first = `sim_zz_${n}_5555`
    const second = `sim_aa_${n}_5555`
    await viewerClaim(page, b, '홍길동', '11', first)
    // 화면을 연 뒤(전체 조회) 둘째가 증분으로 들어온다
    await page.goto(`/buyers?date=${date}&rehearsal=true`)
    await expect(page.getByRole('table', { name: '구매자' }).getByRole('link')).toHaveCount(1)
    await viewerClaim(page, b, '홍길동', '12', second)
    const table = page.getByRole('table', { name: '구매자' })
    await expect(table.getByRole('link')).toHaveCount(2)
    const nameOf = async (id: string) => (await table.locator(`a.table-link[href*="buyer=${encodeURIComponent(id)}"]`).innerText()).trim()
    expect(await nameOf(first)).toBe('홍길동 · 끝 5555')
    expect(await nameOf(second)).toBe('홍길동 · 끝 5555 · 2')
    await page.reload()
    await expect(table.getByRole('link')).toHaveCount(2)
    expect(await nameOf(first)).toBe('홍길동 · 끝 5555')
    expect(await nameOf(second)).toBe('홍길동 · 끝 5555 · 2')
  })

  test('TE-S06b-003: 콘솔 충돌 알림 창에도 괄호가 겹친 표기가 없다 — 앞선 찜이 문자 구매자면 "문자찜(김씨) (문자찜, …)"', async ({ page }) => {
    await login(page)
    const origin = new URL(page.url()).origin
    const before = await (await page.request.get('/api/settings')).json() as { settings: Record<string, unknown> }
    const set = await page.request.patch('/api/settings', { data: { settings: { 'contention.policy': 'RECEIVED_TIME', 'contention.sameMinuteTieBreaker': 'HOST' } }, headers: { Origin: origin } })
    expect(set.ok(), await set.text()).toBe(true)
    let b: string
    const date = uniqueDate()
    try {
      b = await openNewBroadcast(page, { date, rehearsal: true, title: uniq('충돌') })
    } finally {
      await page.request.patch('/api/settings', { data: { settings: { 'contention.policy': before.settings['contention.policy'] ?? 'ARRIVAL', 'contention.sameMinuteTieBreaker': before.settings['contention.sameMinuteTieBreaker'] ?? 'HOST' } }, headers: { Origin: origin } })
    }
    await registerApi(page, b, 16, '라울', 5000)
    const t = Date.now()
    await viewerClaim(page, b, '홍길동', '16', uniq('sim_cf_'))
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(t))
    await smsApi(page, { b, no: 16, memo: '김씨', received: hm }) // 같은 분 → 동률 → HOST → 충돌 (R-7 6, G-ENG-175)
    await expect.poll(async () => (await scopeView(page, date, true)).claims.some((c) => c.status === 'CONFLICT')).toBe(true)
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await page.keyboard.press('Alt+1') // 첫 알림 열기 (UX-05)
    const dlg = page.getByRole('dialog', { name: /^충돌 — / })
    await expect(dlg).toContainText('홍길동')
    await expect(dlg).toContainText('문자찜(김씨)')
    const text = await dlg.innerText()
    expect(text, '괄호가 겹친 이름 표기 (AC-S06b-20)').not.toContain(') (')
  })
})
