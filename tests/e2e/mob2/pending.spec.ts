// MOB2 E. 시간이 지난 보류 찜 (AC-MOB2-30~33·35, D-MOB2-06·15·16 (3), UX-04, R-5) — test-e2e.
// 공통 Given: claim.preOpenWindowSec = 30(기본), 등록 안 한 번호 31로 문자찜(이름 "문자찜(김씨)"), **화면이 열린 채로** 들어와 이 탭이 t0에 처음 받는다
// (D-MOB2-15: 시간 지남 = 지금 − 이 탭이 그 찜을 처음 받은 시각 > W).
// 시계: 화면 시계는 page.clock으로 당긴다. 처음 받은 시각을 정확히 정하려고 찜이 들어오기 전에 화면 시계를 멈춘다(freeze) — 멈춘 시각 = t0.
//   문자찜 화면에서 직접 넣는 경우(AC-MOB2-30 첫 시험)만 시계를 흐르게 두고 t0 = 서버 도착 시각(at)으로 본다 — 이 탭은 at 뒤에 받으므로
//   t0 + 30초 정각은 반드시 "보류"이고, t0 + 31초는 처음 받기까지 1초 안이면 "보류 · 시간 지남".
// 서버 시계는 당길 수 없어 엔진 만료(AC-MOB2-33)는 실제로 31초를 기다린다.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { boardItem, sendViewerChat, uniqueDate } from '../s05/support.ts'
import { menuLink } from '../menu.ts'
import { smsApi, smsUi, writeEvent } from '../s06/support.ts'
import { PC, PHONE, alerts, broadcastApi, freshSeller, pendingWord } from '../mob1/support.ts'
import { TIMED_OUT_TAIL, TIMED_OUT_WORD, openSmsSole } from './support.ts'

interface ClaimView { id: string; no: number; at: string; status: string; reason?: string | null; origin: string }

async function claimsOf(page: Page, date: string, rehearsal = false): Promise<ClaimView[]> {
  const res = await page.request.get(`/api/days/${date}${rehearsal ? '?rehearsal=true' : ''}`)
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()) as { claims: ClaimView[] }).claims
}

async function atOf(page: Page, date: string, no: number, rehearsal = false): Promise<number> {
  const claim = (await claimsOf(page, date, rehearsal)).find((c) => c.no === no)
  expect(claim?.at, `번호 ${String(no)} 찜`).toBeTruthy()
  return Date.parse(claim!.at)
}

async function seller(browser: Browser, baseURL: string, viewport: { width: number; height: number } = PC): Promise<{ page: Page; close: () => Promise<void> }> {
  const { page, context } = await freshSeller(browser, baseURL, { viewport, touch: viewport.width < 768 })
  return { page, close: () => context.close() }
}

/** 화면 시계를 (지금 실제 시각 + lead + 2초)에 멈춘다 — 그 뒤 들어오는 찜은 이 탭이 바로 이 시각에 처음 받는다(D-MOB2-15 t0). 멈춘 시각을 돌려준다 */
async function freeze(page: Page, lead = 0): Promise<number> {
  const at = Date.now() + lead + 2_000
  await page.clock.pauseAt(at)
  return at
}

/** 화면 시계를 단다 (시간은 흐르다가 pauseAt에서 멈춘다). 바뀌는 때를 재는 타이머는 찜이 들어온 뒤에 걸리므로 그대로 당겨진다 */
async function clock(page: Page): Promise<void> {
  await page.clock.install()
}

const recentRow = (page: Page, no: number) => page.getByRole('region', { name: '최근 넣은 문자찜' }).getByRole('listitem').filter({ hasText: `${String(no)}번` }).first()
const resultCard = (page: Page) => page.getByRole('region', { name: '넣은 결과' })

test.describe('AC-MOB2-30 낱말 — 문자찜 화면', () => {
  test('t0 + 30초 정각은 "보류", t0 + 31초에 최근 넣은 문자찜 줄 "보류 · 시간 지남"·결과 카드 끝 " — 지금 등록해도 판정되지 않아요", "만료" 없음', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const title = `보류시간${String(Math.floor(Math.random() * 1e6))}`
      await broadcastApi(s.page, date, false, title)
      await openSmsSole(s.page, title)
      await clock(s.page)
      await smsUi(s.page, { no: 31, memo: '김씨' })
      const t0 = await atOf(s.page, date, 31)
      const row = recentRow(s.page, 31)
      await expect(row).toContainText('문자찜(김씨)')
      // 경계 정각: 아직 유효
      await s.page.clock.pauseAt(t0 + 30_000)
      await expect(row.locator('.tag').first()).toHaveText('보류')
      await expect(resultCard(s.page)).toContainText('31번 · 문자찜(김씨) · 보류 · 받은 시각')
      await expect(resultCard(s.page)).not.toContainText('시간 지남')
      // 1초 넘김 → 1초 안에 바뀐다 (다시 그리는 때가 at + 30초 + 1ms)
      await s.page.clock.fastForward(1_000)
      await expect(row.locator('.tag').first()).toHaveText(TIMED_OUT_WORD, { timeout: 1_000 })
      await expect(row).not.toContainText('만료')
      const card = resultCard(s.page).locator('strong').first()
      await expect(card).toContainText(`31번 · 문자찜(김씨) · ${TIMED_OUT_WORD} · 받은 시각`)
      expect((await card.innerText()).endsWith(TIMED_OUT_TAIL.trim()), `결과 카드 끝: ${await card.innerText()}`).toBe(true)
      await expect(card).toContainText(TIMED_OUT_TAIL.trim())
    } finally {
      await s.close()
    }
  })

  test('번호 31을 공개 전(READY)으로 등록한 상품의 보류 찜 — 상품 자세히 "보류·충돌 찜" 줄도 같은 규칙', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, false)
      const reg = await writeEvent(s.page, { type: 'product.register', b, no: 31, name: '라울', price: 7000, status: 'READY' })
      expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
      await clock(s.page)
      await s.page.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(s.page.getByLabel('빠른 입력')).toBeVisible()
      await s.page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^31번 / }).click()
      const detail = s.page.getByRole('dialog', { name: '31번 자세히' })
      await expect(detail).toBeVisible()
      // 화면이 열린 채로 찜이 들어온다 — 이 탭이 t0에 처음 받는다
      const t0 = await freeze(s.page)
      await smsApi(s.page, { b, no: 31, memo: '김씨' })
      const row = detail.locator('li.claim-row').filter({ hasText: '문자찜(김씨)' })
      await expect(row.locator('.tag').first()).toHaveText('보류')
      await s.page.clock.fastForward(30_000)
      expect(await s.page.evaluate(() => Date.now())).toBe(t0 + 30_000)
      await expect(row.locator('.tag').first(), 't0 + 30초 정각은 아직 보류').toHaveText('보류')
      await s.page.clock.fastForward(1_000)
      await expect(row.locator('.tag').first()).toHaveText(TIMED_OUT_WORD, { timeout: 1_000 })
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-MOB2-31·32 알림 띠 수·보류 찜 창', () => {
  test('31번(t0)·32번(t0 + 20초) — t0 + 31초: "보류 찜 1"(32번만), 창 위 32번·아래 "시간이 지난 보류 찜" "31번 1개"; t0 + 51초: 칩 없음 "알림 없음", Alt+1도 열지 않음', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, false)
      await clock(s.page)
      await s.page.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(s.page.getByLabel('빠른 입력')).toBeVisible()
      const strip = alerts(s.page)
      // 화면이 열린 채로 31번이 t0에, 32번이 t0 + 20초에 들어온다
      const t0 = await freeze(s.page)
      await smsApi(s.page, { b, no: 31, memo: '김씨' })
      await expect(strip.getByRole('button', { name: '보류 찜 1', exact: true })).toBeVisible()
      await s.page.clock.fastForward(20_000)
      await smsApi(s.page, { b, no: 32, memo: '박씨' })
      await expect(strip.getByRole('button', { name: '보류 찜 2', exact: true })).toBeVisible()
      // t0 + 31초: 31번만 시간 지남
      await s.page.clock.fastForward(11_000)
      expect(await s.page.evaluate(() => Date.now())).toBe(t0 + 31_000)
      await expect(strip.getByRole('button', { name: '보류 찜 1', exact: true })).toBeVisible({ timeout: 1_000 })
      await strip.getByRole('button', { name: '보류 찜 1', exact: true }).click()
      const dlg = s.page.getByRole('dialog', { name: '보류 찜' })
      await expect(dlg).toBeVisible()
      const live = dlg.getByRole('listitem').filter({ hasText: '32번' }).first()
      await expect(live.getByRole('button', { name: /번호 넣기/ })).toBeVisible()
      const old = dlg.getByRole('region', { name: '시간이 지난 보류 찜' })
      await expect(old.getByRole('heading', { name: '시간이 지난 보류 찜' })).toBeVisible()
      await expect(old.getByRole('listitem')).toHaveText(['31번 1개'])
      await expect(old.getByRole('button', { name: /번호 넣기/ })).toHaveCount(0)
      // "최근 만료된 찜"은 지금 그대로 (엔진 만료 없음)
      await expect(dlg.getByText('최근 만료된 찜', { exact: true })).toBeVisible()
      await dlg.getByRole('button', { name: '닫기' }).click()
      // t0 + 51초: 32번도 지남 → 칩 없음, 알림 없음
      await s.page.clock.fastForward(20_000)
      await expect(strip.getByRole('button', { name: /^보류 찜/, includeHidden: true })).toHaveCount(0, { timeout: 1_000 })
      await expect(strip.getByText('알림 없음')).toBeVisible()
      // Alt+1도 보류 찜 창을 열지 않는다
      await s.page.getByLabel('빠른 입력').focus()
      await s.page.keyboard.press('Alt+1')
      await expect(s.page.getByRole('dialog', { name: '보류 찜' })).toHaveCount(0)
    } finally {
      await s.close()
    }
  })
})

// AC-MOB2-35 앞 두 경우: 등록 안 한 번호 31(알림 띠는 상품이 없는 번호의 보류 찜만 센다)의 리허설 채팅 찜 — 낱말은 채팅 칸에서 본다
const chatClaimRow = (page: Page, nick: string) => page.getByRole('region', { name: '채팅' }).getByRole('listitem').filter({ hasText: nick }).filter({ hasText: '31번' }).first()

test.describe('AC-MOB2-35 휴대폰 시계 차이 · 새로고침 (D-MOB2-15)', () => {
  test('375×812 · 화면 시계가 서버보다 90초(W + 60초) 앞선 기기: 막 들어온 31번은 "보류"·"보류 1"·보류 찜 창 "번호 넣기"에 있고, 그 탭 시계로 31초 뒤 1초 안에 "보류 · 시간 지남"·알림 수에서 빠짐', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, true)
      await s.page.clock.install({ time: Date.now() + 90_000 })
      await s.page.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(s.page.getByLabel('빠른 입력')).toBeVisible()
      const strip = alerts(s.page)
      const t0 = await freeze(s.page, 90_000)
      await sendViewerChat(s.page, b, '김씨', '31')
      const at = await atOf(s.page, date, 31, true)
      expect(t0 - at, '화면 시계가 찜의 서버 시각보다 W + 60초쯤 앞섬').toBeGreaterThan(85_000)
      const row = chatClaimRow(s.page, '김씨')
      await expect(row, '앞선 시계에서도 막 들어온 찜은 "보류"').toContainText('31번 보류')
      await expect(row).not.toContainText(TIMED_OUT_WORD)
      const chip = strip.getByRole('button', { name: `${pendingWord(s.page)} 1`, exact: true })
      await expect(chip, '앞선 시계에서도 막 들어온 찜은 알림 수에 든다 (접힌 휴대폰 "보류 1")').toBeVisible()
      await chip.click()
      const dlg = s.page.getByRole('dialog', { name: '보류 찜' })
      await expect(dlg.getByRole('listitem').filter({ hasText: '31번' }).first().getByRole('button', { name: /번호 넣기/ })).toBeVisible()
      await expect(dlg.getByRole('region', { name: '시간이 지난 보류 찜' })).toHaveCount(0)
      await dlg.getByRole('button', { name: '닫기' }).click()
      await expect(dlg).toHaveCount(0)
      await s.page.clock.fastForward(30_000)
      await expect(row, '그 탭 시계로 30초 정각은 아직 보류').not.toContainText(TIMED_OUT_WORD)
      await expect(chip).toBeVisible()
      await s.page.clock.fastForward(1_000)
      await expect(row).toContainText(`31번 ${TIMED_OUT_WORD}`, { timeout: 1_000 })
      await expect(strip.getByRole('button', { name: new RegExp(`^${pendingWord(s.page)} \\d`), includeHidden: true }), '알림 수에서 빠짐').toHaveCount(0, { timeout: 1_000 })
    } finally {
      await s.close()
    }
  })

  test('1440×900 · 시간이 지난 보류 찜이 있는 방송을 새로고침한 탭: 연 뒤 W초 동안 "보류"(알림 수에 셈), W + 1초 뒤 "보류 · 시간 지남" — 늦게 바뀌는 쪽만', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, true)
      await clock(s.page)
      await s.page.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(s.page.getByLabel('빠른 입력')).toBeVisible()
      const strip = alerts(s.page)
      await freeze(s.page)
      await sendViewerChat(s.page, b, '김씨', '31')
      const row = chatClaimRow(s.page, '김씨')
      await expect(row).toContainText('31번 보류')
      await expect(strip.getByRole('button', { name: '보류 찜 1', exact: true })).toBeVisible()
      // 이 탭에서 시간이 지남
      await s.page.clock.fastForward(31_000)
      await expect(row).toContainText(`31번 ${TIMED_OUT_WORD}`, { timeout: 1_000 })
      await expect(strip.getByRole('button', { name: /^보류 찜/, includeHidden: true })).toHaveCount(0, { timeout: 1_000 })
      // 새로고침 — 처음 받은 시각을 다시 잰다 (화면 시계는 멈춘 그대로)
      const reloadAt = await s.page.evaluate(() => Date.now())
      await s.page.reload()
      await expect(s.page.getByLabel('빠른 입력')).toBeVisible()
      expect(await s.page.evaluate(() => Date.now()), '새로고침 뒤에도 화면 시계는 멈춘 그대로').toBe(reloadAt)
      const again = chatClaimRow(s.page, '김씨')
      await expect(again, '새로 연 탭은 W초 동안 "보류"').toContainText('31번 보류')
      await expect(again).not.toContainText(TIMED_OUT_WORD)
      await expect(strip.getByRole('button', { name: '보류 찜 1', exact: true }), '새로 연 탭은 W초 동안 알림 수에 센다').toBeVisible()
      await s.page.clock.fastForward(30_000)
      await expect(again, '연 뒤 W초 정각은 아직 보류').not.toContainText(TIMED_OUT_WORD)
      await expect(strip.getByRole('button', { name: '보류 찜 1', exact: true })).toBeVisible()
      await s.page.clock.fastForward(1_000)
      await expect(again).toContainText(`31번 ${TIMED_OUT_WORD}`, { timeout: 1_000 })
      await expect(strip.getByRole('button', { name: /^보류 찜/, includeHidden: true })).toHaveCount(0, { timeout: 1_000 })
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-MOB2-35 모든 화면 같은 낱말 (D-MOB2-15 ②)', () => {
  test('1440×900 리허설 · 공개 전(READY) 31번의 채팅 보류 찜(김씨): 같은 때 채팅 칸·알림 창(취소 요청 "지금 상태")·상품 자세히·구매자 화면·문자찜 화면이 모두 "보류", 이 탭 시계로 31초 뒤 모두 "보류 · 시간 지남" (화면을 옮겨도 처음 받은 시각 그대로)', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const page = s.page
      const date = uniqueDate()
      const title = `낱말${String(Math.floor(Math.random() * 1e6))}`
      const b = await broadcastApi(page, date, true, title)
      const reg = await writeEvent(page, { type: 'product.register', b, no: 31, name: '라울', price: 7000, status: 'READY' })
      expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
      await clock(page)
      await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(page.getByLabel('빠른 입력')).toBeVisible()
      await freeze(page)
      // 화면이 열린 채로 채팅 찜과 그 사람의 취소 요청이 들어온다
      await sendViewerChat(page, b, '김씨', '31')
      const chatRow = page.getByRole('region', { name: '채팅' }).getByRole('listitem').filter({ hasText: '김씨' }).filter({ hasText: '31번' }).first()
      await expect(chatRow).toBeVisible()
      await sendViewerChat(page, b, '김씨', '31 취소')
      await expect(alerts(page).getByRole('button', { name: '취소 요청 1', exact: true })).toBeVisible({ timeout: 15_000 })

      /** 지금 다섯 화면의 낱말을 모은다 — 콘솔(채팅 칸·취소 요청 창·상품 자세히) → 구매자 → 문자찜 → 콘솔, 모두 메뉴로 옮긴다(새로고침 없음) */
      const words = async (): Promise<Record<string, string>> => {
        const out: Record<string, string> = {}
        const word = (text: string): string => {
          const m = /31번(?:\s*·)?\s*(보류(?: · 시간 지남)?)/.exec(text)
          return m?.[1] ?? `(찾지 못함: ${text.slice(0, 80)})`
        }
        out['채팅 칸'] = word(await chatRow.innerText())
        await alerts(page).getByRole('button', { name: '취소 요청 1', exact: true }).click()
        const req = page.getByRole('dialog', { name: /^취소 요청 — 31번/ })
        await expect(req).toBeVisible()
        out['알림 창'] = (await req.locator('dt', { hasText: '지금 상태' }).locator('xpath=following-sibling::dd[1]').innerText()).trim()
        await req.getByRole('button', { name: '닫기' }).first().click()
        await expect(req).toHaveCount(0)
        await boardItem(page, 31).click()
        const detail = page.getByRole('dialog', { name: '31번 자세히' })
        out['상품 자세히'] = (await detail.locator('li.claim-row').filter({ hasText: '김씨' }).locator('.tag').first().innerText()).trim()
        await detail.getByRole('button', { name: '닫기' }).first().click()
        await expect(detail).toHaveCount(0)
        await menuLink(page, '구매자').click()
        const day = page.getByLabel('날짜', { exact: true })
        await expect(day).toBeVisible()
        if ((await day.inputValue()) === '') await day.selectOption({ label: await day.locator('option', { hasText: '리허설' }).first().innerText() })
        // 1등 찜이 없는 구매자(보류 찜만)도 보이게
        const all = page.getByRole('checkbox', { name: '찜 없는 구매자도 보기' })
        if (!(await all.isChecked())) await all.check()
        await page.getByRole('link', { name: /김씨/ }).first().click()
        const others = page.getByRole('region', { name: '구매자 자세히' }).getByRole('region', { name: '합계에 들지 않는 찜' })
        await expect(others).toContainText('31번')
        out['구매자 화면'] = word(await others.getByRole('listitem').filter({ hasText: '31번' }).first().innerText())
        await menuLink(page, '문자찜 입력').click()
        // 리허설 방송은 저절로 고르지 않으면 고른다 (s06 openSms와 같은 조작 — 새로고침 없이)
        const chosen = page.getByRole('region', { name: '고른 방송' })
        await expect(chosen.getByRole('button', { name: /^방송 (바꾸기|고르기)$/ })).toBeVisible()
        if (!(await chosen.innerText()).includes(title)) {
          await chosen.getByRole('button', { name: /^방송 (바꾸기|고르기)$/ }).click()
          const pickDlg = page.getByRole('dialog', { name: '방송 고르기' })
          await pickDlg.getByRole('button', { name: new RegExp(`^${title} ·`) }).click()
          await expect(pickDlg).toHaveCount(0)
        }
        await expect(chosen).toContainText(title)
        await expect(page.getByLabel('번호', { exact: true })).toBeEditable()
        await page.getByLabel('구매자 고르기').fill('김씨')
        await page.getByRole('list', { name: '찾은 구매자' }).getByRole('button').filter({ hasText: '김씨' }).first().click()
        await expect(page.getByRole('group', { name: '고른 구매자' })).toContainText('김씨')
        await page.getByLabel('번호', { exact: true }).fill('31')
        await page.getByRole('button', { name: '31번에 문자찜 넣기' }).click()
        const card = page.getByRole('region', { name: '넣은 결과' }).locator('strong').first()
        await expect(card).toContainText('이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 ')
        out['문자찜 화면'] = /\(지금 (.+)\)/.exec(await card.innerText())?.[1] ?? `(찾지 못함: ${await card.innerText()})`
        // 콘솔로 되돌아간다 (앱 안 이동 — 새로고침 없음)
        for (let i = 0; i < 5 && !new URL(page.url()).pathname.startsWith('/broadcasts/'); i++) await page.goBack()
        await expect(page.getByLabel('빠른 입력')).toBeVisible()
        return out
      }

      const before = await words()
      console.log(`[MOB2 낱말] t0: ${JSON.stringify(before)}`)
      expect(before, 't0: 다섯 화면 모두 "보류"').toEqual({ '채팅 칸': '보류', '알림 창': '보류', '상품 자세히': '보류', '구매자 화면': '보류', '문자찜 화면': '보류' })
      // 이 탭 시계로 처음 받은 때부터 31초 (화면을 옮기는 동안 시계는 멈춰 있다)
      await page.clock.fastForward(31_000)
      await expect(chatRow).toContainText(TIMED_OUT_WORD, { timeout: 1_000 })
      const after = await words()
      console.log(`[MOB2 낱말] t0 + 31초: ${JSON.stringify(after)}`)
      expect(after, 't0 + 31초: 다섯 화면 모두 "보류 · 시간 지남"').toEqual({ '채팅 칸': TIMED_OUT_WORD, '알림 창': TIMED_OUT_WORD, '상품 자세히': TIMED_OUT_WORD, '구매자 화면': TIMED_OUT_WORD, '문자찜 화면': TIMED_OUT_WORD })
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-MOB2-33 판정은 그대로', () => {
  test('t0 + 31초(실제)에 31번 등록 → 엔진 REJECTED(EXPIRED), 화면 낱말 "만료"', async ({ browser, baseURL }) => {
    test.setTimeout(120_000)
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const title = `만료${String(Math.floor(Math.random() * 1e6))}`
      const b = await broadcastApi(s.page, date, false, title)
      await openSmsSole(s.page, title)
      await clock(s.page)
      await smsUi(s.page, { no: 31, memo: '김씨' })
      const t0 = await atOf(s.page, date, 31)
      const row = recentRow(s.page, 31)
      await expect(row.locator('.tag').first()).toHaveText(TIMED_OUT_WORD, { timeout: 40_000 })
      // 서버 시계로 31초가 지날 때까지 (서버 도착 시각 기준 — 상태를 기다린다)
      await expect.poll(() => Date.now() - t0, { timeout: 40_000, intervals: [1_000] }).toBeGreaterThan(31_000)
      const reg = await writeEvent(s.page, { type: 'product.register', b, no: 31, name: '라울', price: 7000 })
      expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
      await expect.poll(async () => (await claimsOf(s.page, date)).find((c) => c.no === 31)?.status).toBe('REJECTED')
      expect((await claimsOf(s.page, date)).find((c) => c.no === 31)?.reason).toBe('EXPIRED')
      await expect(row.locator('.tag').first()).toHaveText('만료')
    } finally {
      await s.close()
    }
  })

  test('창 안(화면 시계 t0 + 29초 "보류")에 등록 → 1등', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!)
    try {
      const date = uniqueDate()
      const title = `안${String(Math.floor(Math.random() * 1e6))}`
      const b = await broadcastApi(s.page, date, false, title)
      await openSmsSole(s.page, title)
      await clock(s.page)
      await smsUi(s.page, { no: 31, memo: '김씨' })
      const t0 = await atOf(s.page, date, 31)
      await s.page.clock.pauseAt(t0 + 29_000)
      const row = recentRow(s.page, 31)
      await expect(row.locator('.tag').first()).toHaveText('보류')
      const reg = await writeEvent(s.page, { type: 'product.register', b, no: 31, name: '라울', price: 7000 })
      expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
      await expect.poll(async () => (await claimsOf(s.page, date)).find((c) => c.no === 31)?.status).toBe('CONFIRMED')
      await expect(row.locator('.tag').first()).toHaveText('1등')
    } finally {
      await s.close()
    }
  })
})
