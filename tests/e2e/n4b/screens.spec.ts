// 영수증 보내기 화면 (AC-N4b-30·31·32·33·34·35·41·42) — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import { directApi } from '../i3/support.ts'
import {
  allRegion,
  buyerRow,
  CLIPBOARD_FAKE,
  clipboard,
  dateLongKo,
  downloadBytes,
  endBroadcast,
  endedDay,
  isBaselineJpeg,
  login,
  noHorizontalScroll,
  openNewBroadcast,
  pay,
  pdfPages,
  phoneLike,
  postJson,
  primaryOutsideDialogs,
  readZip,
  receiptsPath,
  registerApi,
  resetShop,
  scopeView,
  setShop,
  smsApi,
  uniq,
  uniqueDate,
  viewerClaim,
  writeEvent,
  xlsxRows,
} from './support.ts'

/** "YYYY-MM-DD (요일)" (스펙 문장으로 손 계산) */
function dateDash(date: string): string {
  const long = dateLongKo(date)
  return `${date} (${long.slice(-2, -1)})`
}

test.describe('AC-N4b-30 끝난 콘솔의 "영수증 보내기"', () => {
  test('방송 중에는 없고, 끝내면 주 버튼 하나 "영수증 보내기" → /broadcasts/<B>/receipts', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: false, title: '1부' })
    await expect(page.getByRole('button', { name: '방송 끝내기' })).toBeVisible()
    await expect(page.getByRole('link', { name: '영수증 보내기' })).toHaveCount(0)
    await page.getByRole('button', { name: '방송 끝내기' }).click()
    await page.getByRole('dialog', { name: '방송 끝내기' }).getByRole('button', { name: '끝내기' }).click()
    const go = page.getByRole('link', { name: '영수증 보내기' })
    await expect(go).toBeVisible()
    await expect(go).toHaveAttribute('href', receiptsPath(b))
    expect(await primaryOutsideDialogs(page)).toEqual(['영수증 보내기'])
    // 방송 중 화면을 주소로 열면 안내
    const live = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: false, title: '2부' })
    await page.goto(receiptsPath(live))
    await expect(page.getByText('방송을 끝낸 뒤 보낼 수 있어요.')).toBeVisible()
    await expect(page.getByRole('link', { name: '콘솔로 돌아가기' })).toBeVisible()
    await expect(page.getByRole('list', { name: '구매자' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '링크 전부 만들기' })).toHaveCount(0)
  })

  test('끝난 리허설 콘솔도 주 버튼은 "영수증 보내기" 하나', async ({ page }) => {
    await login(page)
    const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true, title: '연습' })
    await endBroadcast(page, b)
    await page.reload()
    await expect(page.getByRole('link', { name: '영수증 보내기' })).toBeVisible()
    expect(await primaryOutsideDialogs(page)).toEqual(['영수증 보내기'])
  })

  test('없는 방송 주소는 "찾지 못했어요"', async ({ page }) => {
    await login(page)
    await page.goto(receiptsPath('no-such-broadcast'))
    await expect(page.getByRole('heading', { level: 1, name: '방송을 찾지 못했어요' })).toBeVisible()
  })
})

test.describe('AC-N4b-31 화면 머리', () => {
  test('날짜 "YYYY-MM-DD (요일)"·방송 제목, 같은 날 다른 방송이 있을 때만 그 안내', async ({ page }) => {
    await login(page)
    const day = await endedDay(page)
    await page.goto(receiptsPath(day.b))
    await expect(page.getByRole('heading', { level: 1, name: '영수증 보내기' })).toBeVisible()
    await expect(page.getByText(dateDash(day.date))).toBeVisible()
    await expect(page.getByText('화요일 저녁')).toBeVisible()
    await expect(page.getByText('같은 날 다른 방송의 상품도 함께 들어가요(정산은 날짜마다 하나예요).')).toHaveCount(0)
    // 같은 날 두 번째 실제 방송
    await openNewBroadcast(page, { date: day.date, rehearsal: false, title: '2부' })
    await page.goto(receiptsPath(day.b))
    await expect(page.getByText('같은 날 다른 방송의 상품도 함께 들어가요(정산은 날짜마다 하나예요).')).toBeVisible()
  })
})

test.describe('AC-N4b-41 한 번에 받기', () => {
  test('전원 PDF·전원 이미지 ZIP·이 방송 판매대장 — 파일 이름, ZIP 안 JPG 2개(UTF-8 이름), 판매대장은 이 방송 행만', async ({ page }) => {
    await login(page)
    const day = await endedDay(page)
    // 같은 날 다른 방송의 상품·찜
    const b2 = await openNewBroadcast(page, { date: day.date, rehearsal: false, title: '2부' })
    await registerApi(page, b2, 9, '다른방송상품', 7000)
    await smsApi(page, { b: b2, no: 9, phone: '010-7123-4567' })
    await page.goto(receiptsPath(day.b))
    const all = allRegion(page)
    const [pdf] = await Promise.all([page.waitForEvent('download'), all.getByRole('button', { name: '전원 확인서 PDF' }).click()])
    expect(pdf.suggestedFilename()).toBe(`확인서-${day.date}-전원.pdf`)
    expect(await pdfPages(await downloadBytes(pdf))).toBe(2)
    const [zip] = await Promise.all([page.waitForEvent('download'), all.getByRole('button', { name: '전원 이미지(JPG) 묶음' }).click()])
    expect(zip.suggestedFilename()).toBe(`확인서-${day.date}-전원-이미지.zip`)
    const entries = readZip(await downloadBytes(zip))
    expect(entries).toHaveLength(2)
    for (const e of entries) {
      expect(e.name).toMatch(new RegExp(`^확인서-${day.date}-[^/]+\\.jpg$`))
      expect(e.flags & 0x0800).toBe(0x0800)
      expect(isBaselineJpeg(e.data)).toBe(true)
    }
    const [xlsx] = await Promise.all([page.waitForEvent('download'), all.getByRole('button', { name: '이 방송 판매대장 엑셀' }).click()])
    expect(xlsx.suggestedFilename()).toBe(`판매대장-${day.date}.xlsx`)
    const rows = (await xlsxRows(await downloadBytes(xlsx))).map((r) => r.join('|'))
    expect(rows.some((r) => r.includes('핑크프릴'))).toBe(true)
    expect(rows.some((r) => r.includes('다른방송상품'))).toBe(false)
  })

  test('한 사람 "이미지(JPG)"·"PDF" — 이름 확인서-YYYY-MM-DD-<이름>.jpg/.pdf, 기본 JPEG', async ({ page }) => {
    await login(page)
    const day = await endedDay(page)
    await page.goto(receiptsPath(day.b))
    const row = buyerRow(page, '문자찜(가람이)')
    const [jpg] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: '이미지(JPG)' }).click()])
    expect(jpg.suggestedFilename()).toMatch(new RegExp(`^확인서-${day.date}-.+\\.jpg$`))
    expect(isBaselineJpeg(await downloadBytes(jpg))).toBe(true)
    const [pdf] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: 'PDF' }).click()])
    expect(pdf.suggestedFilename()).toMatch(new RegExp(`^확인서-${day.date}-.+\\.pdf$`))
  })
})

test.describe('AC-N4b-32 구매자 줄', () => {
  test('일괄 순서·상품 수·금액·입금 상태, 다른 기기 입금·취소가 실시간으로 바뀐다', async ({ page, browser }) => {
    await login(page)
    const day = await endedDay(page)
    const phone = await phoneLike(browser, page)
    try {
      await phone.goto(receiptsPath(day.b))
      const row = buyerRow(phone, '문자찜')
      await expect(row).toContainText('상품 2개')
      await expect(row).toContainText('22,000원')
      await expect(row).toContainText('미입금')
      await pay(page, day.date, day.phoneBuyer, 5000)
      await expect(row).toContainText('부분 입금', { timeout: 3000 })
      await pay(page, day.date, day.phoneBuyer, 17000)
      await expect(row).toContainText('입금 완료', { timeout: 3000 })
      // 메모 구매자의 유일한 상품 취소 → 줄이 빠진다
      expect((await writeEvent(page, { type: 'host.cancel', b: day.b, no: 3, buyer: day.memoBuyer, reason: '취소' })).status).toBeLessThan(300)
      await expect(phone.getByRole('list', { name: '구매자' }).getByRole('group')).toHaveCount(1, { timeout: 3000 })
    } finally {
      await phone.context().close()
    }
  })

  test('품목 있는 묶음이 없으면 "확인서를 만들 구매자가 없어요."와 판매대장만', async ({ page }) => {
    await login(page)
    const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: false, title: '빈 방송' })
    await endBroadcast(page, b)
    await page.goto(receiptsPath(b))
    await expect(page.getByText('확인서를 만들 구매자가 없어요.')).toBeVisible()
    const all = allRegion(page)
    await expect(all.getByRole('button')).toHaveText(['이 방송 판매대장 엑셀'])
  })
})

test.describe('AC-N4b-33 링크 만들기·복사·보내기·끊기', () => {
  test('링크 만들기 → 링크 있음 · 끝 시각, 포커스 "링크 복사", 끊기 창 Esc는 아무것도 보내지 않고 포커스 "링크 끊기"', async ({ page }) => {
    await page.addInitScript(CLIPBOARD_FAKE)
    await login(page)
    const day = await endedDay(page)
    await page.goto(receiptsPath(day.b))
    const row = buyerRow(page, '문자찜(가람이)')
    await expect(row).toContainText('링크 없음')
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/receipt-links')) posts.push(new URL(r.url()).pathname)
    })
    // 두 번 눌러도 하나만 보낸다
    await row.getByRole('button', { name: '링크 만들기' }).dblclick()
    await expect(row.getByRole('status')).toHaveText('링크를 만들었어요.')
    await expect(row).toContainText(/링크 있음 · \d{1,2}월 \d{1,2}일 \([일월화수목금토]\) \d{2}:\d{2}까지/)
    await expect(row.getByRole('button', { name: '링크 복사' })).toBeFocused()
    expect(posts).toEqual([`/api/days/${day.date}/receipt-links`])
    // 끊기 창: Esc → 보내지 않음
    await row.getByRole('button', { name: '링크 끊기' }).click()
    const dlg = page.getByRole('dialog', { name: '링크 끊기' })
    await expect(dlg).toContainText('문자찜(가람이)님의 링크를 끊으면 그 링크로는 더 이상 열 수 없어요. 필요하면 새 링크를 만들어 보내 주세요.')
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(row.getByRole('button', { name: '링크 끊기' })).toBeFocused()
    expect(posts).toHaveLength(1)
    // 끊은 뒤 새로 만들면 다른 주소
    await row.getByRole('button', { name: '링크 복사' }).click()
    const first = (await clipboard(page))[0]!
    await row.getByRole('button', { name: '링크 끊기' }).click()
    await dlg.getByRole('button', { name: '1 링크 끊기' }).click()
    await expect(row).toContainText('링크 끊음')
    await row.getByRole('button', { name: '링크 만들기' }).click()
    await expect(row.getByRole('button', { name: '링크 복사' })).toBeFocused()
    await row.getByRole('button', { name: '링크 복사' }).click()
    await expect.poll(async () => (await clipboard(page)).length).toBe(2)
    expect((await clipboard(page))[1]).not.toBe(first)
    // 모든 구매자의 링크를 한꺼번에 복사·공유하는 버튼이 없다
    await expect(page.getByRole('button', { name: /(전부|모두|전원).*(복사|보내기|공유)/ })).toHaveCount(0)
  })

  test('글 공유 기기: "링크 보내기"가 같은 글(text, 파일 없음)을 넘기고, 닫으면(AbortError) 아무 안내 없음', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __clip: string[]; __shared: unknown[]; __abort: boolean }
      w.__clip = []
      w.__shared = []
      w.__abort = false
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t: string) => { w.__clip.push(t); return Promise.resolve() } } })
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: { text?: string; files?: unknown }) => typeof d?.text === 'string' && d.files === undefined })
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (d: unknown) => {
          if (w.__abort) return Promise.reject(new DOMException('x', 'AbortError'))
          w.__shared.push(d)
          return Promise.resolve()
        },
      })
    })
    await login(page)
    const day = await endedDay(page)
    await page.goto(receiptsPath(day.b))
    const row = buyerRow(page, '문자찜')
    await row.getByRole('button', { name: '링크 만들기' }).click()
    await row.getByRole('button', { name: '링크 보내기' }).click()
    await expect.poll(async () => await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length)).toBe(1)
    const sent = await page.evaluate(() => (window as unknown as { __shared: Record<string, unknown>[] }).__shared[0])
    expect(Object.keys(sent!)).toEqual(['text'])
    await row.getByRole('button', { name: '링크 복사' }).click()
    await expect.poll(async () => (await clipboard(page)).length).toBe(1)
    expect(sent!['text']).toBe((await clipboard(page))[0])
    await page.evaluate(() => ((window as unknown as { __abort: boolean }).__abort = true))
    await row.getByRole('button', { name: '링크 보내기' }).click()
    await expect(row.getByRole('status')).toHaveText('')
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('클립보드를 못 쓰면 "길게 눌러 복사해 주세요." 글 칸(읽기 전용)에 같은 글', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('x', 'NotAllowedError')) } })
    })
    await login(page)
    await setShop(page)
    try {
      const day = await endedDay(page)
      await page.goto(receiptsPath(day.b))
      const row = buyerRow(page, '문자찜')
      await row.getByRole('button', { name: '링크 만들기' }).click()
      await row.getByRole('button', { name: '링크 복사' }).click()
      const field = row.getByLabel('길게 눌러 복사해 주세요.')
      await expect(field).toBeVisible()
      await expect(field).not.toBeEditable()
      await expect(field).toHaveValue(/^다육이네 구매 내역 확인서예요\. \d{1,2}월 \d{1,2}일 \([일월화수목금토]\)까지 열 수 있어요\. http:\/\/\S+\/r\/[A-Za-z0-9_-]{43}$/)
    } finally {
      await resetShop(page)
    }
  })

  test('링크 전부 만들기를 두 번 누르면 0개 — "새로 만들 링크가 없어요."', async ({ page }) => {
    await login(page)
    const day = await endedDay(page)
    await page.goto(receiptsPath(day.b))
    const all = allRegion(page)
    await all.getByRole('button', { name: '링크 전부 만들기' }).click()
    await expect(all.getByText('링크 2개를 만들었어요.')).toBeVisible()
    await all.getByRole('button', { name: '링크 전부 만들기' }).click()
    await expect(all.getByText('새로 만들 링크가 없어요.')).toBeVisible()
  })

  test('링크 조치는 발송함에 새 행을 만들지 않는다', async ({ page }) => {
    await login(page)
    const day = await endedDay(page)
    const before = await (await page.request.get(`/api/days/${day.date}/outbox`)).text()
    await page.goto(receiptsPath(day.b))
    await allRegion(page).getByRole('button', { name: '링크 전부 만들기' }).click()
    await expect(allRegion(page).getByText('링크 2개를 만들었어요.')).toBeVisible()
    const after = await (await page.request.get(`/api/days/${day.date}/outbox`)).text()
    expect(after).toBe(before)
  })
})

test.describe('AC-N4b-42 리허설·보조자', () => {
  test('리허설: 링크·판매대장 없이 안내, 주 버튼 "전원 확인서 PDF", ZIP 이름 리허설-확인서-…-전원-이미지.zip', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true, title: '연습' })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await viewerClaim(page, b, '홍길동', '15', uniq('sim_r_'))
    await expect.poll(async () => (await scopeView(page, date, true)).settlements.length).toBe(1)
    await endBroadcast(page, b)
    await page.reload()
    await page.getByRole('link', { name: '영수증 보내기' }).click()
    await expect(page.getByText('리허설에서는 공유 링크와 판매대장을 만들지 않아요.')).toBeVisible()
    const all = allRegion(page)
    await expect(all.getByRole('button')).toHaveText(['전원 확인서 PDF', '전원 이미지(JPG) 묶음'])
    expect(await primaryOutsideDialogs(page)).toEqual(['전원 확인서 PDF'])
    await expect(page.getByRole('button', { name: /링크/ })).toHaveCount(0)
    await expect(page.getByText(/링크 (없음|있음)/)).toHaveCount(0)
    const [zip] = await Promise.all([page.waitForEvent('download'), all.getByRole('button', { name: '전원 이미지(JPG) 묶음' }).click()])
    expect(zip.suggestedFilename()).toBe(`리허설-확인서-${date}-전원-이미지.zip`)
    expect(readZip(await downloadBytes(zip))).toHaveLength(1)
  })

  test('보조자: 끝난 방송 콘솔에 "영수증 보내기" 없음, 주소로 열면 안내만(데이터 요청 없음), 링크 API 403', async ({ page, browser }) => {
    await login(page)
    const day = await endedDay(page)
    const res = await postJson(page, '/api/assistants', { name: uniq('보조') })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    const { assistant, password } = res.body as unknown as { assistant: { loginId: string }; password: string }
    const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin })
    const helper = await ctx.newPage()
    try {
      const asked: string[] = []
      helper.on('request', (r) => {
        if (/receipt-(buyers|links)/.test(r.url())) asked.push(r.url())
      })
      await helper.goto('/')
      await helper.getByLabel('아이디').fill(assistant.loginId)
      await helper.getByLabel('비밀번호').fill(password)
      await helper.getByRole('button', { name: '로그인' }).click()
      await expect(helper.getByRole('button', { name: '로그아웃' })).toBeVisible()
      await helper.goto(`/broadcasts/${encodeURIComponent(day.b)}`)
      await expect(helper.getByRole('link', { name: '영수증 보내기' })).toHaveCount(0)
      await helper.goto(receiptsPath(day.b))
      await expect(helper.getByText('보조자 계정으로는 쓸 수 없는 화면이에요.')).toBeVisible()
      await expect(helper.getByRole('heading', { name: '영수증 보내기' })).toHaveCount(0)
      expect(asked).toEqual([])
      const origin = new URL(helper.url()).origin
      for (const [method, path, data] of [
        ['GET', `/api/days/${day.date}/receipt-buyers`, undefined],
        ['GET', `/api/days/${day.date}/receipt-links`, undefined],
        ['POST', `/api/days/${day.date}/receipt-links/all`, { requestId: crypto.randomUUID() }],
        ['POST', `/api/days/${day.date}/receipt-links`, { requestId: crypto.randomUUID(), buyer: day.phoneBuyer }],
        ['GET', `/api/days/${day.date}/receipts.zip`, undefined],
        ['GET', `/api/days/${day.date}/receipt.jpg?buyer=${encodeURIComponent(day.phoneBuyer)}`, undefined],
      ] as const) {
        const r = method === 'GET' ? await helper.request.get(path) : await helper.request.post(path, { data, headers: { Origin: origin } })
        expect(r.status(), `${method} ${path}`).toBe(403)
      }
    } finally {
      await ctx.close()
    }
  })
})

/** 보이는 버튼·글 칸의 높이·글자 크기 */
async function touchAndText(page: Page): Promise<{ small: string[]; tiny: string[] }> {
  return await page.evaluate(() => {
    const small: string[] = []
    const tiny: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('main button, main a, main input')) {
      if (el.offsetParent === null) continue
      const r = el.getBoundingClientRect()
      if (r.height < 44 || r.width < 44) small.push(`${el.textContent?.trim() ?? el.tagName} ${String(Math.round(r.width))}x${String(Math.round(r.height))}`)
    }
    const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const parent = n.parentElement
      if (parent === null || (n.textContent ?? '').trim() === '' || parent.offsetParent === null) continue
      const size = parseFloat(getComputedStyle(parent).fontSize)
      if (size < 16) tiny.push(`${(n.textContent ?? '').trim().slice(0, 20)} ${String(size)}px`)
    }
    return { small, tiny }
  })
}

test.describe('AC-N4b-34·42 휴대폰', () => {
  test('375×812 영수증 보내기 화면: 가로 스크롤 없음, 누르는 곳 44px, 글자 16px (링크 있는 줄 포함)', async ({ page, browser }) => {
    await login(page)
    const day = await endedDay(page, { memo: '아주긴메모이름이에요다육이좋아해요정말로많이요' })
    const phone = await phoneLike(browser, page)
    try {
      await phone.goto(receiptsPath(day.b))
      await allRegion(phone).getByRole('button', { name: '링크 전부 만들기' }).click()
      await expect(allRegion(phone).getByText('링크 2개를 만들었어요.')).toBeVisible()
      await noHorizontalScroll(phone)
      const { small, tiny } = await touchAndText(phone)
      expect(small).toEqual([])
      expect(tiny).toEqual([])
    } finally {
      await phone.context().close()
    }
  })

  test('375×812 구매자 링크 화면: 가로 스크롤 없음, 누르는 곳 44px, 글자 16px', async ({ page, browser }) => {
    await login(page)
    await setShop(page)
    try {
      const day = await endedDay(page)
      const made = await postJson(page, `/api/days/${day.date}/receipt-links`, { requestId: crypto.randomUUID(), buyer: day.phoneBuyer })
      expect(made.status).toBe(200)
      const link = new URL((made.body['link'] as { url: string }).url)
      const url = `${directApi()}${link.pathname}`
      // 기본 묶음의 화면 주소 프록시 문제(TE-N4b-001)와 떼어 보려고 서버에서 받은 문서를 그 출처로 연다
      const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
      const p = await phone.newPage()
      try {
        await p.goto(url)
        await expect(p.getByRole('heading', { name: '구매 내역 확인서' })).toBeVisible()
        await noHorizontalScroll(p)
        const { small, tiny } = await touchAndText(p)
        expect(small).toEqual([])
        expect(tiny).toEqual([])
      } finally {
        await phone.close()
      }
    } finally {
      await resetShop(page)
    }
  })
})

test.describe('AC-N4b-35 개인정보처리방침', () => {
  test('/privacy "12. 구매자 확인서 공유 링크" — 로그인 없이·14일·끊기·끝 4자리', async ({ page }) => {
    await page.goto('/privacy')
    const region = page.getByRole('region', { name: '12. 구매자 확인서 공유 링크' })
    await expect(region).toContainText('로그인 없이')
    await expect(region).toContainText('14일')
    await expect(region).toContainText('끊을 수 있어요')
    await expect(region).toContainText('끝 4자리')
    await expect(page.getByText('초안이에요. 법률 검토 전이라 실제 서비스 전에 바뀔 수 있어요.')).toBeVisible()
  })
})
