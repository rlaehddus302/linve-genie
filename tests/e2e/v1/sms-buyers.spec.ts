// V1 음성 문자찜 — 끝자리 손님이 여럿(고르기, AC-V1-25), 넣은 뒤 찜 취소(AC-V1-27), 정산 "구매자를 확인해 주세요"(AC-V1-29),
// 개인정보·글자로만(AC-V1-30) — test-e2e. 문장은 acceptance.md 그대로.
import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  boardItem,
  history,
  recordRequests,
  registerApi,
  scopeView,
  setupLive,
  setupPaused,
  smsApi,
  smsButton,
  smsCard,
  smsField,
  smsResults,
  smsUi,
  smsWrites,
  speak,
  viewerClaim,
  voiceRegion,
  writeEvent,
} from './support.ts'

// 상품은 품종 '핑크프릴'로 등록한다 — 카드 이름에 품종이 붙는다(D-V1-21)
const C165 = '165번 핑크프릴 · 끝자리 1234 · 문자찜'
const CHOOSE = '끝자리 1234 손님이 여러 명이에요. 누구인지 골라 주세요.'

async function background(button: Locator): Promise<string> {
  return button.evaluate((el) => getComputedStyle(el).backgroundColor)
}

test.describe('V1 구매자', () => {
  test('AC-V1-25·D-V1-14: 끝자리 1234 손님이 둘 → 409 → 고르기 카드("넣지 않기"·후보 "… · 15번"·"새 손님으로 넣기", 저절로 안 넣음) → 고르면 buyer로 한 번 → 결과', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    for (const no of [15, 165, 166]) await registerApi(page, b, no, '핑크프릴', 10000)
    await smsApi(page, { b, no: 15, phone: '010-1111-1234', memo: '김씨' })
    await smsApi(page, { b, no: 15, phone: '010-2222-1234', memo: '이씨' })
    await expect(boardItem(page, 166)).toBeVisible()
    const view = await scopeView(page, date, false)
    const kim = view.buyers.find((x) => x.display === '문자찜(김씨)')!.id
    const lee = view.buyers.find((x) => x.display === '문자찜(이씨)')!.id
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    await page.clock.runFor(3000)
    const c = smsCard(page, C165)
    await expect(c.getByRole('alert')).toHaveText(CHOOSE)
    // D-V1-14: 후보 = "표시 이름 · 끝자리 1234 · 찜 번호", 맨 끝 "새 손님으로 넣기". D-V1-20: "넣지 않기"가 첫 버튼
    await expect(c.getByRole('button')).toHaveText(['넣지 않기', '문자찜(김씨) · 끝자리 1234 · 15번', '문자찜(이씨) · 끝자리 1234 · 15번', '새 손님으로 넣기'])
    // 넣는 버튼(후보·새 손님)만 주 버튼 색 (D-V1-20)
    const skipBg = await background(smsButton(page, C165, '넣지 않기'))
    const pickBg = await background(page.getByRole('button', { name: `${C165} 손님 고르기: 문자찜(김씨) · 끝자리 1234 · 15번`, exact: true }))
    expect(pickBg).not.toBe(skipBg)
    expect(await background(page.getByRole('button', { name: `${C165} 새 손님으로 넣기`, exact: true }))).toBe(pickBg)
    expect(smsWrites(requests)).toHaveLength(1)
    expect(smsWrites(requests)[0]).toMatchObject({ no: 165, last4: '1234', voice: true })
    // 저절로 다시 넣지 않는다
    await page.clock.runFor(15_000)
    expect(smsWrites(requests)).toHaveLength(1)
    // 고르기 카드는 기다리는 카드가 아니라 Esc로 닫히지 않는다 (AC-V1-32)
    await page.getByLabel('빠른 입력').focus()
    await page.keyboard.press('Escape')
    await expect(c.getByRole('alert')).toHaveText(CHOOSE)
    await page.getByRole('button', { name: `${C165} 손님 고르기: 문자찜(이씨) · 끝자리 1234 · 15번`, exact: true }).click()
    await expect(smsResults(page, C165)).toHaveText(/^165번 · 문자찜\(이씨\) · 1등 · 받은 시각 .* · 뒤 4자리 1234$/)
    const writes = smsWrites(requests)
    expect(writes).toHaveLength(2)
    expect(writes[1]).toMatchObject({ no: 165, buyer: lee })
    expect(writes[1]).not.toHaveProperty('last4')
    expect(writes[1]!['requestId']).not.toBe(writes[0]!['requestId'])
    const after = await scopeView(page, date, false)
    expect(after.products.find((x) => x.no === 165)!.winners).toEqual([lee])
    expect(after.claims.filter((x) => x.no === 165)).toHaveLength(1)

    // "새 손님으로 넣기" → last4 + newBuyer: true 한 번 → 새 문자 구매자 (김씨·이씨는 166번을 갖지 않는다)
    const C166 = '166번 핑크프릴 · 끝자리 1234 · 문자찜'
    await speak(page, '166번 문자찜 끝자리 1234')
    await page.clock.runFor(3000)
    const c166 = smsCard(page, C166)
    await expect(c166.getByRole('alert')).toHaveText(CHOOSE)
    // 이씨는 이제 15번(대기)·165번(1등)을 가진다 — 처음 찜한 순서
    await expect(c166.getByRole('button')).toHaveText(['넣지 않기', '문자찜(김씨) · 끝자리 1234 · 15번', '문자찜(이씨) · 끝자리 1234 · 15번·165번', '새 손님으로 넣기'])
    await page.getByRole('button', { name: `${C166} 새 손님으로 넣기`, exact: true }).click()
    await expect(smsResults(page, C166)).toHaveText(/^166번 · 문자찜.* · 1등 · /)
    const all = smsWrites(requests)
    expect(all).toHaveLength(4)
    expect(all[3]).toMatchObject({ no: 166, last4: '1234', newBuyer: true, voice: true })
    expect(all[3]).not.toHaveProperty('buyer')
    const end = await scopeView(page, date, false)
    const winner = end.products.find((x) => x.no === 166)!.winners
    expect(winner).toHaveLength(1)
    expect([kim, lee]).not.toContain(winner[0])
    const fresh = end.buyers.find((x) => x.id === winner[0])!
    expect(fresh.kind).toBe('sms')
    expect(fresh.phoneLast4).toBe('1234')
  })

  test('AC-V1-25·D-V1-14: 끝자리·표시 이름이 같은 두 후보도 찜 번호로 버튼 글이 다르다', async ({ page }) => {
    const { b } = await setupPaused(page)
    for (const no of [15, 22, 165]) await registerApi(page, b, no, '핑크프릴', 10000)
    await smsApi(page, { b, no: 15, phone: '010-3333-5678' })
    await smsApi(page, { b, no: 22, phone: '010-4444-5678' })
    await expect(boardItem(page, 165)).toBeVisible()
    const short = '165번 핑크프릴 · 끝자리 5678 · 문자찜'
    await speak(page, '165번 문자찜 끝자리 5678')
    await page.clock.runFor(3000)
    const c = smsCard(page, short)
    await expect(c.getByRole('alert')).toHaveText('끝자리 5678 손님이 여러 명이에요. 누구인지 골라 주세요.')
    const buttons = c.getByRole('button')
    // 같은 표시 이름이면 구매자 목록의 구분 표기("문자찜 · 뒤 4자리 5678")가 붙는다 — 끝자리를 한 번 더 적을지는 스펙이 정하지 않아 보지 않는다
    await expect(buttons).toHaveText(['넣지 않기', /^문자찜.*5678.* · 15번$/, /^문자찜.*5678.* · 22번$/, '새 손님으로 넣기'])
    const texts = await buttons.allInnerTexts()
    expect(texts[1]).not.toBe(texts[2])
  })

  test('AC-V1-31·D-V1-14: 끝자리 1234 손님이 "문자찜(김민지)" 한 사람인데 박영희라고 말함 → 이름이 달라요 고르기 → 새 손님으로 넣기 → "문자찜(박영희)", 김민지는 166번 없음', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    for (const no of [165, 166]) await registerApi(page, b, no, '핑크프릴', 10000)
    await smsApi(page, { b, no: 165, phone: '010-1111-1234', memo: '김민지' })
    await expect(boardItem(page, 166)).toBeVisible()
    const kim = (await scopeView(page, date, false)).buyers.find((x) => x.display === '문자찜(김민지)')!.id
    const requests = recordRequests(page)
    const short = '166번 핑크프릴 · 끝자리 1234 · 박영희님 · 문자찜'
    await speak(page, '166번 문자찜 박영희님 끝자리 1234')
    await expect(smsCard(page, short).getByText('3초 뒤 넣어요')).toBeVisible()
    await page.clock.runFor(3000)
    const c = smsCard(page, short)
    await expect(c.getByRole('alert')).toHaveText('끝자리 1234 손님의 이름이 달라요. 누구인지 골라 주세요.')
    await expect(c.getByRole('button')).toHaveText(['넣지 않기', '문자찜(김민지) · 끝자리 1234 · 165번', '새 손님으로 넣기'])
    expect(smsWrites(requests)).toHaveLength(1)
    expect(smsWrites(requests)[0]).toMatchObject({ no: 166, last4: '1234', memo: '박영희', voice: true })
    // 저절로 넣지 않는다
    await page.clock.runFor(15_000)
    expect(smsWrites(requests)).toHaveLength(1)
    expect((await scopeView(page, date, false)).claims.filter((x) => x.no === 166)).toHaveLength(0)
    await page.getByRole('button', { name: `${short} 새 손님으로 넣기`, exact: true }).click()
    await expect(smsResults(page, short)).toHaveText(/^166번 · 문자찜\(박영희\) · 1등 · /)
    const writes = smsWrites(requests)
    expect(writes).toHaveLength(2)
    expect(writes[1]).toMatchObject({ no: 166, last4: '1234', newBuyer: true, memo: '박영희', voice: true })
    expect(writes[1]).not.toHaveProperty('buyer')
    const view = await scopeView(page, date, false)
    const winners = view.products.find((x) => x.no === 166)!.winners
    expect(winners).toHaveLength(1)
    expect(winners[0]).not.toBe(kim)
    expect(view.buyers.find((x) => x.id === winners[0])!.display).toBe('문자찜(박영희)')
    expect(view.buyers.find((x) => x.id === kim)!.display).toBe('문자찜(김민지)')
    expect(view.claims.filter((x) => x.no === 166 && (x.buyer === kim || x.currentBuyer === kim))).toEqual([])
  })

  test('AC-V1-27: 넣어서 1등 → "찜 취소하기" → 사유 창 → 취소, 대기의 유튜브 찜이 1등(AUTO 승계), 따로 된 되돌리기 띠 없음', async ({ page }) => {
    const { b, date } = await setupLive(page, { rehearsal: true })
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    await speak(page, '165번 문자찜 끝자리 1234')
    await smsButton(page, C165, '지금 넣기').click()
    await expect(smsResults(page, C165)).toHaveText(/^165번 · 문자찜 · 1등 · /)
    await viewerClaim(page, b, '다육사랑', '165번', 'sim_v1viewer01')
    await expect.poll(async () => (await scopeView(page, date, true)).products.find((x) => x.no === 165)!.waitlist.length, { timeout: 15_000 }).toBe(1)
    await expect(voiceRegion(page).getByText(/되돌리기|되돌렸어요/)).toHaveCount(0)
    await page.getByRole('button', { name: '165번 문자찜 찜 취소하기', exact: true }).click()
    const dlg = page.getByRole('dialog').last()
    await expect(dlg).toBeVisible()
    await page.keyboard.press('1')
    await expect(dlg.getByRole('button', { name: '찜 취소하기' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(smsResults(page, C165)).toContainText('취소됨', { timeout: 15_000 })
    const view = await scopeView(page, date, true)
    const p = view.products.find((x) => x.no === 165)!
    const viewer = view.buyers.find((x) => x.kind !== 'sms')!
    expect(p.winners).toEqual([viewer.id])
    const cancels = (await history(page, date, true)).filter((e) => e.type === 'host.cancel')
    expect(cancels).toHaveLength(1)
  })
})

/** 정산 목록 화면 (실제 범위) */
async function openSettlements(page: Page, date: string): Promise<void> {
  await page.goto(`/settlements?date=${date}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

test.describe('V1 정산 안내', () => {
  test('AC-V1-29: "문자찜(확인 필요)" 2명 → "2건" + 구매자마다 링크(구매자 자세히), 합치면 줄이 빠지고 0명이면 안내 없음', async ({ page }) => {
    const { b, date } = await setupLive(page)
    for (const no of [15, 166, 167]) await registerApi(page, b, no, '핑크프릴', 10000)
    await smsApi(page, { b, no: 15, memo: '김씨' })
    await expect(boardItem(page, 167)).toBeVisible()
    for (const no of [166, 167]) {
      await speak(page, `${String(no)}번 문자찜`)
      await smsButton(page, `${String(no)}번 핑크프릴 · 손님 확인 필요 · 문자찜`, '지금 넣기').click()
      await expect(smsResults(page, `${String(no)}번 핑크프릴 · 손님 확인 필요 · 문자찜`)).toHaveText(new RegExp(`^${String(no)}번 · 문자찜\\(확인 필요\\).* · 1등 · `))
      // D-V1-21: 확인 필요로 넣은 결과 카드에 정산 안내 한 줄
      await expect(smsCard(page, `${String(no)}번 핑크프릴 · 손님 확인 필요 · 문자찜`).getByText('방송 뒤 정산 화면에서 누구인지 확인해 주세요.', { exact: true })).toBeVisible()
    }
    const view = await scopeView(page, date, false)
    const kim = view.buyers.find((x) => x.display === '문자찜(김씨)')!.id
    const unknown = view.buyers.filter((x) => x.display === '문자찜(확인 필요)').map((x) => x.id)
    expect(unknown).toHaveLength(2)
    await openSettlements(page, date)
    const notice = page.getByRole('region', { name: '구매자를 확인해 주세요' })
    await expect(notice.getByText('구매자를 확인해야 하는 문자찜이 2건 있어요.')).toBeVisible()
    const links = notice.getByRole('link')
    await expect(links).toHaveCount(2)
    await expect(links.nth(0)).toHaveText(/^문자찜\(확인 필요\).* · 166번 — 구매자 확인하기$/)
    await expect(links.nth(1)).toHaveText(/^문자찜\(확인 필요\).* · 167번 — 구매자 확인하기$/)
    await links.nth(0).click()
    await expect(page).toHaveURL(new RegExp(`/buyers\\?.*buyer=${encodeURIComponent(unknown[0]!)}`))
    const detail = page.getByRole('region', { name: '구매자 자세히' })
    await expect(detail.getByRole('button', { name: '다른 구매자와 합치기' })).toBeVisible()
    // D-V1-22: 위에 안내 한 줄, 합치기가 첫 버튼, 차단하기는 맨 뒤
    await expect(detail.getByText('누구의 문자인지 찾아 합쳐 주세요.', { exact: true })).toBeVisible()
    const actions = (await detail.getByRole('button').allInnerTexts()).map((t) => t.trim())
    expect(actions.indexOf('다른 구매자와 합치기'), actions.join(' / ')).toBeGreaterThanOrEqual(0)
    expect(actions.indexOf('차단하기'), actions.join(' / ')).toBe(actions.length - 1)
    // 합치기 바로 옆(같은 줄)이 아니다
    const mergeBox = (await detail.getByRole('button', { name: '다른 구매자와 합치기' }).boundingBox())!
    const blockBox = (await detail.getByRole('button', { name: '차단하기' }).boundingBox())!
    expect(blockBox.y).toBeGreaterThanOrEqual(mergeBox.y + mergeBox.height)
    // 한 사람을 김씨에 합친다 → 1건
    expect((await writeEvent(page, { type: 'buyer.merge', from: unknown[0], into: kim, reason: '같은 사람' }, { date, rehearsal: false })).status).toBeLessThan(300)
    await openSettlements(page, date)
    await expect(notice.getByText('구매자를 확인해야 하는 문자찜이 1건 있어요.')).toBeVisible()
    await expect(notice.getByRole('link')).toHaveCount(1)
    await expect(notice.getByRole('link')).toHaveText(/ · 167번 — 구매자 확인하기$/)
    expect((await writeEvent(page, { type: 'buyer.merge', from: unknown[1], into: kim, reason: '같은 사람' }, { date, rehearsal: false })).status).toBeLessThan(300)
    await openSettlements(page, date)
    await expect(page.getByText('문자찜(김씨)').first()).toBeVisible()
    await expect(notice).toHaveCount(0)
  })
})

test.describe('V1 개인정보', () => {
  test('AC-V1-30·31: 쓰기 본문은 정한 칸뿐(음성은 voice: true, 손 입력엔 없음), 인식 문장은 요청·주소·저장소에 없음, 카드 글은 글자로만', async ({ page }) => {
    const title = `V1 개인정보 ${crypto.randomUUID().slice(0, 8)}`
    const { b } = await setupLive(page, { title })
    for (const no of [165, 166, 167]) await registerApi(page, b, no, '핑크프릴', 10000)
    await expect(boardItem(page, 166)).toBeVisible()
    const requests = recordRequests(page)
    await page.evaluate(() => {
      ;(window as unknown as { __xss: number }).__xss = 0
    })
    await speak(page, '165번 문자찜 끝자리 1234 <img src=x onerror="window.__xss=1"><b>굵게</b>')
    await smsButton(page, C165, '지금 넣기').click()
    await expect(smsResults(page, C165)).toHaveText(/^165번 · 문자찜 · 1등 · /)
    await speak(page, '김민지님 166번 문자찜 오후에 왔어요')
    await smsButton(page, '166번 핑크프릴 · 김민지님 · 문자찜', '지금 넣기').click()
    await expect(smsResults(page, '166번 핑크프릴 · 김민지님 · 문자찜')).toHaveText(/^166번 · 문자찜\(김민지\) · 1등 · /)
    // 글자 그대로 (요소가 아니다)
    const heard = smsCard(page, C165).getByText('들은 말: 165번 문자찜 끝자리 1234 <img src=x onerror="window.__xss=1"><b>굵게</b>', { exact: true })
    await expect(heard).toBeVisible()
    await expect(page.getByRole('list', { name: '음성 카드' }).locator('b, img')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __xss: number }).__xss)).toBe(0)
    // 쓰기 본문의 칸
    // AC-V1-30(D-V1-13·14로 보강): newBuyer·voice 칸이 더해졌다. 음성 쓰기는 voice: true (AC-V1-31)
    const allowed = new Set(['requestId', 'type', 'b', 'no', 'received', 'memo', 'last4', 'buyer', 'newBuyer', 'options', 'qty', 'voice'])
    const writes = smsWrites(requests)
    expect(writes).toHaveLength(2)
    for (const w of writes) for (const key of Object.keys(w)) expect(allowed.has(key), key).toBe(true)
    for (const w of writes) expect(w['voice']).toBe(true)
    // 인식 문장(그 조각)은 어느 요청에도 없다
    for (const word of ['굵게', 'onerror', '오후에 왔어요', '끝자리', '김민지님']) {
      for (const r of requests) {
        expect(decodeURIComponent(r.url), word).not.toContain(word)
        expect(r.body, word).not.toContain(word)
      }
    }
    // 저장소에도 없다
    const stored = await page.evaluate(async () => {
      const out: string[] = []
      for (const s of [window.localStorage, window.sessionStorage]) for (let i = 0; i < s.length; i++) out.push(`${s.key(i) ?? ''}=${s.getItem(s.key(i) ?? '') ?? ''}`)
      const dbs = (await indexedDB.databases?.()) ?? []
      for (const db of dbs) out.push(`idb:${db.name ?? ''}`)
      return out.join('\n')
    })
    for (const word of ['굵게', 'onerror', '오후에 왔어요', '165번 문자찜', '김민지']) expect(stored, word).not.toContain(word)
    // 손 입력 문자찜 본문에는 voice가 없다 (AC-V1-31)
    // 콘솔에서 연 방송을 문자찜 입력 화면이 그대로 고른다 (openSms는 다른 방송을 고를 때의 응답을 기다려 쓰지 않는다)
    await page.goto('/sms')
    await expect(page.getByRole('region', { name: '고른 방송' })).toContainText(title)
    await expect(page.getByRole('region', { name: '최근 넣은 문자찜' })).toBeVisible()
    await expect(smsField(page, '번호')).toBeFocused()
    await smsUi(page, { no: 167, memo: '손입력' })
    const manual = smsWrites(requests).filter((w) => w['no'] === 167)
    expect(manual).toHaveLength(1)
    expect(manual[0]).not.toHaveProperty('voice')
  })
})
