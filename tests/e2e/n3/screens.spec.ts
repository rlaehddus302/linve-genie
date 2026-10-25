// N3 화면 경계: 리허설·판매 전 입금·되돌리기 창 문장·계좌 연동·375px·낱말 (AC-N3-43·44·46·48·49·50) — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import {
  deposit, depositRow, depositTab, recentDate, fakeSource, kstIso, login, noHorizontalScroll, openNewBroadcast, phoneLike, postJson, registerApi,
  scopeView, smsApi, smsSale, uniq, won,
} from './support.ts'
import { barCells, closeMore, moreLinks, openMore } from '../menu.ts'
import { cleanupPrint } from '../i1/support.ts'

// 출력 기록은 판매자 단위 — 판매(1등)가 만든 라벨 작업을 남기면 뒤 시험(N4a 등)의 출력 기기가 쌓인 라벨로 멈춘다 (i1 support "시험끼리 출력 기록이 섞이지 않게")
test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

const ENGLISH = ['REVIEW', 'AUTO_APPLIED', 'APPLIED', 'IGNORED', 'POPBILL', 'PASTE', 'FAKE', 'tid', 'requestId', 'NAME_MISMATCH', 'AMOUNT_MISMATCH', 'NO_MATCH', 'ONE_MATCH', 'POSSIBLE_DUPLICATE', 'SAME_NAME', 'MULTIPLE', 'UNPAID', 'PAID', 'OVERPAID', 'PARTIAL', 'undefined', 'null', 'NaN']

async function visibleText(page: Page): Promise<string> {
  return await page.locator('main').innerText()
}

test.describe('입금 확인 화면 경계', () => {
  test('리허설: 정산에 안내 문장·입금 연결 없음, 같은 이름·금액의 리허설 묶음은 자동 확인·묶음 찾기에 안 나옴 (AC-N3-48·21)', async ({ page }) => {
    await login(page)
    const name = uniq('리허설이')
    const date = recentDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크', 12_340)
    await smsApi(page, { b, no: 15, memo: name, phone: '010-4444-1111' })
    let total = 0
    let buyer = ''
    await expect.poll(async () => {
      const s = (await scopeView(page, date, true)).settlements[0]
      total = s?.total ?? 0
      buyer = s?.buyer ?? ''
      return total
    }).toBeGreaterThan(0)
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('h'), at: kstIso(5_000), amount: total, name }])
    expect(d!.status).toBe('REVIEW')
    expect(d!.review?.reason).toBe('NO_MATCH')
    const rv = (await (await page.request.get(`/api/days/${date}?rehearsal=true`)).json()) as { depositLinks: unknown[] }
    expect(rv.depositLinks).toEqual([])
    await page.goto(`/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(buyer)}`)
    await expect(page.getByText('리허설 묶음은 입금 확인에 쓰지 않아요.')).toBeVisible()
    await expect(page.getByRole('button', { name: '입금 확인 되돌리기' })).toHaveCount(0)
    // 묶음 찾기에도 없다
    await page.goto('/deposits')
    await depositRow(page, d!.no).getByRole('button', { name: '다른 묶음 지정' }).click()
    const search = page.getByRole('dialog', { name: `다른 묶음 지정 · 입금 #${String(d!.no)}` })
    await search.getByLabel('찾을 말 (구매자 이름·닉네임·메모·전화번호 뒤 4자리)').fill(name)
    await expect(search.getByRole('status').filter({ hasText: '찾는 중' })).toHaveCount(0)
    await expect(search.getByRole('list', { name: '찾은 묶음' }).getByRole('button')).toHaveCount(0)
  })

  test('판매 전 입금: 자동으로 맞추지 않고, 다른 묶음 지정에서 "입금 시각이 이 묶음의 판매보다 먼저예요." → 확정은 된다 (AC-N3-43·24, DP-4)', async ({ page }) => {
    await login(page)
    const name = uniq('먼저보냄')
    const src = await fakeSource(page)
    const early = kstIso(-60_000) // 판매 1분 전 입금
    const sale = await smsSale(page, { memo: name })
    const [d] = await deposit(page, src, [{ key: uniq('e'), at: early, amount: sale.remaining, name }])
    expect(d!.status).toBe('REVIEW')
    await page.goto('/deposits')
    const row = depositRow(page, d!.no)
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: '다른 묶음 지정' }).click()
    const search = page.getByRole('dialog', { name: `다른 묶음 지정 · 입금 #${String(d!.no)}` })
    await search.getByLabel('찾을 말 (구매자 이름·닉네임·메모·전화번호 뒤 4자리)').fill(name)
    const found = search.getByRole('list', { name: '찾은 묶음' }).getByRole('listitem')
    await expect(found).toHaveCount(1)
    await expect(found).toContainText('입금 시각이 이 묶음의 판매보다 먼저예요.')
    await found.getByRole('button').click()
    const dlg = page.getByRole('dialog', { name: '입금 확정' })
    await expect(dlg).toContainText('입금 시각이 이 묶음의 판매보다 먼저예요.')
    await dlg.getByRole('button', { name: '확정' }).click()
    await expect(page.getByRole('status').filter({ hasText: `입금 #${String(d!.no)}` })).toContainText('입금 시각이 이 묶음의 판매보다 먼저예요.')
  })

  test('되돌리기 창 문장: "{구매자} · M월 D일 묶음에 적은 N원 입금을 되돌려요. …" (AC-N3-44)', async ({ page }) => {
    await login(page)
    const name = uniq('창문장')
    const sale = await smsSale(page, { memo: name })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('w'), at: kstIso(5_000), amount: sale.remaining, name }])
    expect(d!.status).toBe('AUTO_APPLIED')
    await page.goto('/deposits?tab=done')
    await depositRow(page, d!.no, '자동 확인됨·확인함 입금').getByRole('button', { name: '되돌리기' }).click()
    const [, m, dd] = sale.date.split('-').map(Number) as [number, number, number]
    await expect(page.getByRole('dialog', { name: '입금 확인 되돌리기' })).toContainText(
      `문자찜(${name}) · ${String(m)}월 ${String(dd)}일 묶음에 적은 ${won(sale.remaining)} 입금을 되돌려요. 같은 금액의 환불 기록이 남고 이 입금은 확인 필요로 돌아가요.`,
    )
  })

  test('계좌 연동: 연동 키 없는 서버의 준비 중 문장, 원천 상태·주기·지금 받아 오기 1분 제한 문장, 계좌 비밀번호 칸 없음 (AC-N3-46·14)', async ({ page }) => {
    await login(page)
    const label = uniq('원천').slice(0, 12)
    const src = await fakeSource(page, label)
    await page.goto('/deposits?tab=sources')
    await expect(page.getByText('계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요.')).toBeVisible()
    await expect(page.getByLabel(/비밀번호/)).toHaveCount(0)
    const item = page.getByRole('listitem', { name: `입금 받는 곳 ${label}` }) // QL3R2 D-QL3R2-04
    await expect(item).toBeVisible()
    await expect(item).toContainText('시험용 입금')
    await expect(item.getByLabel('받아 오는 주기')).toBeVisible()
    await item.getByRole('button', { name: '지금 받아 오기' }).click()
    await expect(item).toContainText('마지막으로 받아 온 때')
    await item.getByRole('button', { name: '지금 받아 오기' }).click()
    await expect(page.getByText('방금 받아 왔어요. 잠시 뒤에 다시 눌러 주세요.')).toBeVisible()
    // 끄면 받아 오지 않는다
    await item.getByRole('button', { name: '끄기' }).click()
    await expect(item.getByRole('button', { name: '켜기' })).toBeVisible()
    const added = await postJson(page, '/api/deposits/test/rows', { source: src, rows: [{ key: uniq('off'), at: kstIso(1_000), amount: 777, name: '꺼짐' }] })
    expect(added.status).toBeLessThan(300)
    await item.getByRole('button', { name: '켜기' }).click()
    await expect(item.getByRole('button', { name: '끄기' })).toBeVisible()
  })

  for (const tab of ['', '?tab=done', '?tab=ignored', '?tab=paste', '?tab=sources']) {
    test(`375px ${tab === '' ? '확인 필요' : tab}: 가로 스크롤 없음·글자 16px·누르는 곳 44px·카드 목록·영어 낱말 없음 (AC-N3-49·50)`, async ({ page, browser }) => {
      await login(page)
      // 목록에 줄이 있게: 확인 필요 하나 + 자동 확인 하나 + 무시 하나
      const name = uniq('폰화면')
      const sale = await smsSale(page, { memo: name })
      const src = await fakeSource(page)
      const [auto, review, ign] = await deposit(page, src, [
        { key: uniq('a'), at: kstIso(5_000), amount: sale.remaining, name },
        { key: uniq('b'), at: kstIso(5_000), amount: 3_210, name: '아주긴입금자이름이라서줄바꿈이되어야하는경우를시험해봅니다요' },
        { key: uniq('c'), at: kstIso(5_000), amount: 3_220, name: uniq('무시') },
      ])
      expect(auto!.status).toBe('AUTO_APPLIED')
      expect(review!.status).toBe('REVIEW')
      expect((await postJson(page, `/api/deposits/${String(ign!.no)}/ignore`, { requestId: crypto.randomUUID() })).status).toBe(200)
      const phone = await phoneLike(browser, page)
      await phone.goto(`/deposits${tab}`)
      await expect(depositTab(phone, /^확인 필요/)).toBeVisible()
      if (tab === '') await expect(phone.getByRole('list', { name: '확인 필요 입금' }).getByRole('listitem').first()).toBeVisible()
      if (tab === '?tab=done') await expect(phone.getByRole('list', { name: '자동 확인됨·확인함 입금' }).getByRole('listitem').first()).toBeVisible()
      if (tab === '?tab=ignored') await expect(phone.getByRole('list', { name: '무시한 입금' }).getByRole('listitem').first()).toBeVisible()
      if (tab === '?tab=sources') await expect(phone.getByRole('list', { name: '입금 받는 곳' })).toBeVisible() // QL3R2 D-QL3R2-04
      if (tab === '?tab=paste') await expect(phone.getByLabel('입금 내역')).toBeVisible()
      await expect(phone.getByRole('table')).toHaveCount(0)
      await noHorizontalScroll(phone)
      const problems = await phone.evaluate(() => {
        const out: string[] = []
        for (const el of document.querySelectorAll<HTMLElement>('main button, main a, main input, main select, main textarea, main [role=tab]')) {
          if (el.offsetParent === null) continue
          if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
            const label = el.closest('label') as HTMLElement | null
            const box = (label ?? el).getBoundingClientRect()
            if (box.height < 44) out.push(`작은 고르기 ${el.getAttribute('aria-label') ?? label?.innerText ?? ''} ${String(box.height)}`)
            continue
          }
          const r = el.getBoundingClientRect()
          if (r.height < 44 || r.width < 44) out.push(`작은 누르는 곳 "${(el.innerText || el.getAttribute('aria-label') || el.tagName).slice(0, 20)}" ${String(Math.round(r.width))}x${String(Math.round(r.height))}`)
        }
        for (const el of document.querySelectorAll<HTMLElement>('main *')) {
          if (el.offsetParent === null || el.children.length > 0 || (el.textContent ?? '').trim() === '') continue
          const size = parseFloat(getComputedStyle(el).fontSize)
          if (size < 16) out.push(`작은 글자 "${(el.textContent ?? '').trim().slice(0, 20)}" ${String(size)}px`)
        }
        return out
      })
      expect(problems).toEqual([])
      const text = await visibleText(phone)
      for (const word of ENGLISH) expect(text, word).not.toMatch(new RegExp(`\\b${word}\\b`))
      await phone.context().close()
    })
  }

  test('TE-N3-001: 375px 아래 메뉴의 누르는 곳이 모두 44×44px 이상 — 막대 다섯 칸과 "더보기" 목록 항목 모두, "입금 확인"을 더해도 방송·정산·라벨이 좁아지지 않는다 (AC-N3-49, UX-04, AC-S06-02 회귀, AC-NAV-10)', async ({ page, browser }) => {
    await login(page)
    const phone = await phoneLike(browser, page)
    for (const path of ['/deposits', '/settlements', '/sms']) {
      await phone.goto(path)
      // "입금 확인"은 "더보기" 목록 안 — 목록을 연 뒤 찾는다
      await openMore(phone)
      await expect(moreLinks(phone).filter({ hasText: '입금 확인' })).toHaveCount(1)
      const small: string[] = []
      for (const target of [...barCells(phone), ...await moreLinks(phone).all()]) {
        const box = await target.boundingBox()
        expect(box, path).not.toBeNull()
        if (box!.width < 44 || box!.height < 44) small.push(`${(await target.innerText()).trim()} ${String(Math.round(box!.width))}×${String(Math.round(box!.height))}`)
      }
      expect(small, path).toEqual([])
      await closeMore(phone)
    }
    await phone.context().close()
  })
})
