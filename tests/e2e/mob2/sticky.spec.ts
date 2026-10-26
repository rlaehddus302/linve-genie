// MOB2 A·B. 글자 150% 고정 영역·접힌 칩·빠른 입력칸 (AC-MOB2-01~03·05, D-MOB2-02·03, UX-04) — test-e2e.
// 기기: 375×812·412×915 크로미움(터치), 393×852 WebKit(@webkit 묶음, 아이폰 사용자 에이전트). 글자 150% = html { font-size: 150% !important }.
// 고정 영역 높이 = .console-sticky의 getBoundingClientRect().height (알림 띠 접힘·"더보기" 목록 닫힘·고치기 칸 닫힘) — 공통 전제 그대로.
// 50% 셈(AC-MOB2-01, D-MOB2-13): 잰 높이 = 고정 영역 높이 − 띠 아래 출력 기기 짧은 줄(.alert-short-row) 상자 높이 − 그 줄의 margin-top (리허설은 짧은 줄이 없어 그대로).
// Given(AC-MOB2-01): 현재 상품 15번 "핑크프릴"(1등 <b>해커</b>), 세는 알림 둘(충돌 1·보류 찜 1) + 출력 기기 없음 항목, 되돌리기 대기 1개(찜 취소 대기 중).
//   보류 찜이 시험 도중 "시간 지남"(D-MOB2-06)으로 빠지지 않게 claim.preOpenWindowSec = 300.
//   충돌은 실제 시각순(contention.policy = RECEIVED_TIME)에서 초까지 적은 문자찜과 같은 분의 분까지만 적은 문자찜(동률 HOST)으로 만든다. 1등: 리허설은 채팅 닉네임, 실제는 문자찜 메모.
// 측정값은 시험 출력(console.log)에 남긴다.
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { uniqueDate } from '../s05/support.ts'
import { kstTimeAgo, scopeView, smsApi, viewerClaim, writeEvent } from '../s06/support.ts'
import { payAll } from '../crm1/support.ts'
import { ANDROID, IPHONE_UA, PHONE, alerts, broadcastApi, expectBig, expectNoOverflow, foldedShortRow, freshSeller, pendingWord, setLabelsApi } from '../mob1/support.ts'
import { NO_STATION_SHORT } from '../ql3r2/support.ts'
import { barHeight, expectNoClip } from '../ql2/support.ts'

const IPHONE = { width: 393, height: 852 } as const
const HACKER = '<b>해커</b>'

interface Device {
  readonly label: string
  readonly viewport: { readonly width: number; readonly height: number }
  readonly webkit: boolean
}

const DEVICES: readonly Device[] = [
  { label: '375×812', viewport: PHONE, webkit: false },
  { label: '412×915', viewport: ANDROID, webkit: false },
  { label: '393×852 WebKit', viewport: IPHONE, webkit: true },
]

const tag = (d: Device): string => (d.webkit ? ' @webkit' : '')

interface World {
  readonly page: Page
  readonly b: string
  readonly close: () => Promise<void>
}

/**
 * MOB2 합치기(CRM1): 실제 방송 번호 no의 1등 묶음을 입금 완료로 — 시험 날짜는 입금 기다리는 날이 지나 미입금이면 "입금 늦음 주의" 꼬리표
 * (D-CRM1-04·07)가 요약 줄 1등 뒤에 붙는다. 이 시험은 꼬리표 없는 고정 영역을 잰다(꼬리표는 crm1 시험, ql2·ql3r1 시험과 같은 처리)
 */
async function payWinner(page: Page, date: string, no: number): Promise<void> {
  const claim = (await scopeView(page, date, false)).claims.filter((c) => c.no === no).sort((x, y) => x.seq - y.seq)[0]
  if (claim === undefined) throw new Error(`${String(no)}번 찜 없음`)
  await payAll(page, date, claim.currentBuyer)
}

async function world(browser: Browser, baseURL: string, d: Device, opts: { big: boolean; rehearsal: boolean; title?: string }): Promise<World> {
  const { page, context } = await freshSeller(browser, baseURL, {
    viewport: d.viewport,
    touch: true,
    big: opts.big,
    ...(d.webkit ? { userAgent: IPHONE_UA } : {}),
  })
  await setLabelsApi(page, true)
  const set = await page.request.patch('/api/settings', { data: { settings: { 'contention.policy': 'RECEIVED_TIME', 'claim.preOpenWindowSec': 300 } }, headers: { Origin: baseURL } })
  expect(set.status(), await set.text()).toBe(200)
  const date = uniqueDate()
  const b = await broadcastApi(page, date, opts.rehearsal, opts.title)
  const reg = async (no: number, name: string, stock = 1) => {
    const res = await writeEvent(page, { type: 'product.register', b, no, name, price: 10000, stock })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  }
  for (let no = 1; no <= 8; no++) await reg(no, `상품${String(no)}`)
  // 충돌: 실제 시각순에서 초까지 적은 문자찜(정확한 시각)과 같은 분의 분까지만 적은 문자찜 → 동률 → HOST(R-6·R-7)
  await reg(16, '충돌상품')
  const exact = kstTimeAgo(90)
  await smsApi(page, { b, no: 16, memo: '갑', received: exact })
  await smsApi(page, { b, no: 16, memo: '을', received: exact.slice(0, 5) })
  // 보류 찜 (등록 안 한 번호)
  await smsApi(page, { b, no: 40, memo: '병' })
  // 되돌리기 대기를 만들 1등 (17번)
  await reg(17, '청보석')
  await smsApi(page, { b, no: 17, memo: '정' })
  // 17번 자세히를 연 뒤 요약 줄은 17번 — 그 1등(정)도 꼬리표 조건을 만들지 않는다(실제 방송만, payWinner 설명)
  if (!opts.rehearsal) await payWinner(page, date, 17)
  // 현재 상품 = 마지막에 등록한 15번 (재고 2 — 1등이 있어도 판매 중)
  await reg(15, '핑크프릴', 2)
  if (opts.rehearsal) await viewerClaim(page, b, HACKER, '15', `sim_mob2_hacker_${String(Math.floor(Math.random() * 1e6))}`)
  else {
    await smsApi(page, { b, no: 15, memo: HACKER })
    await payWinner(page, date, 15)
  }
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
  if (opts.big) await expectBig(page)
  const strip = alerts(page)
  await expect(strip.getByRole('button', { name: '충돌 1', exact: true, includeHidden: true }), '충돌 1 (Given)').toHaveCount(1)
  await expect(strip.getByRole('button', { name: `${pendingWord(page)} 1`, exact: true, includeHidden: true }), '보류 1 (Given)') // 합친 뒤 QL3R2 D-QL3R2-02: 접힌 휴대폰 띠는 "보류 n".toHaveCount(1)
  // 출력 기기 없음 항목은 라벨이 있는 실제 방송에서만 (리허설은 라벨을 만들지 않는다)
  // 합친 뒤 QL3R2 D-QL3R2-02 (1)·03: 접힌 휴대폰 띠에서는 "알림" 영역 안 항목 대신 띠 아래 짧은 줄 하나(D-QL3R1-10 (1) — 칩이 아니라 숨기지 않음)
  if (!opts.rehearsal) {
    await expect(foldedShortRow(page, NO_STATION_SHORT), '출력 기기 없음 짧은 줄 (Given)').toBeVisible()
    await expect(strip.locator('li').filter({ hasText: '출력 기기가 아직 없어' }), '접힌 띠 "알림" 영역 안에는 없음 (Given)').toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: '알림 2 펼치기', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('region', { name: '현재 상품' }).getByText('15번', { exact: true })).toBeVisible()
  return { page, b, close: () => context.close() }
}

/** 17번 1등 찜 취소를 대기시킨다 (5초 대기 — E2E 묶음은 2초) */
async function queueCancel(page: Page): Promise<Locator> {
  await page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^17번 / }).click()
  const detail = page.getByRole('dialog', { name: '17번 자세히' })
  await detail.locator('li.claim-row').filter({ hasText: '문자찜(정)' }).getByRole('button', { name: '찜 취소하기' }).click()
  const dlg = page.getByRole('dialog', { name: '17번 문자찜(정) 취소' })
  await dlg.getByLabel('사유').fill('시청자 요청')
  await dlg.getByLabel('사유').press('Enter')
  const undo = page.getByRole('region', { name: '보내기 전 조치' }).getByRole('button', { name: '17번 문자찜(정) 취소 되돌리기' })
  await expect(undo).toBeVisible()
  return undo
}

interface StickyShot {
  readonly y: number
  readonly vh: number
  readonly sticky: { top: number; bottom: number; height: number }
  readonly parts: Record<string, { top: number; bottom: number; left: number; right: number; height: number; inside: boolean; shown: boolean } | null>
  readonly outside: string[]
  /** 띠 아래 출력 기기 짧은 줄 (.alert-short-row, D-MOB2-13) — 없으면 null */
  readonly short: { height: number; marginTop: number; shown: boolean; sw: number; cw: number; lines: number; text: string } | null
}

/** 스크롤 y에서 고정 영역과 그 안의 요소들을 한 번에 잰다 (대기 2초 안에 끝나게 한 번의 evaluate로) */
async function shoot(page: Page, ys: readonly number[]): Promise<StickyShot[]> {
  return await page.evaluate((list) => {
    const out: StickyShot[] = []
    for (const target of list) {
      window.scrollTo(0, target)
      const sticky = document.querySelector<HTMLElement>('.console-sticky')!
      const s = sticky.getBoundingClientRect()
      const shown = (el: Element) => {
        const st = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return st.visibility !== 'hidden' && st.display !== 'none' && r.width > 0 && r.height > 0
      }
      const box = (el: Element | null) => {
        if (el === null) return null
        const r = el.getBoundingClientRect()
        const inside = sticky.contains(el) && r.top >= s.top - 1 && r.bottom <= s.bottom + 1 && r.left >= Math.max(s.left, 0) - 1 && r.right <= Math.min(s.right, window.innerWidth) + 1
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, inside, shown: shown(el) }
      }
      const undo = [...sticky.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').endsWith('되돌리기') || b.textContent === '되돌리기') ?? null
      const parts = {
        summary: box(sticky.querySelector('[role="status"][aria-label="현재 상품 요약"]')),
        alerts: box(sticky.querySelector('section[aria-label="알림"]')),
        quick: box(sticky.querySelector('input[aria-label="빠른 입력"], #quick-input') ?? [...sticky.querySelectorAll('input')].find((i) => i.labels?.[0]?.textContent?.includes('빠른 입력')) ?? null),
        undo: box(undo),
      }
      // AC-MOB2-03: 보이는 버튼·입력칸·태그는 상자 전체가 고정 영역 상자와 화면 안
      const outsideList: string[] = []
      for (const el of sticky.querySelectorAll<HTMLElement>('button, input, select, textarea, .tag')) {
        if (!shown(el)) continue
        const r = el.getBoundingClientRect()
        const ok = r.top >= s.top - 1 && r.bottom <= s.bottom + 1 && r.left >= Math.max(s.left, 0) - 1 && r.right <= Math.min(s.right, window.innerWidth) + 1
        if (!ok) outsideList.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${String(Math.round(r.left))},${String(Math.round(r.top))}~${String(Math.round(r.right))},${String(Math.round(r.bottom))} / 고정 ${String(Math.round(s.top))}~${String(Math.round(s.bottom))}`)
      }
      // D-MOB2-13: 짧은 줄 상자 높이 + 그 줄의 위 간격(margin-top)은 50% 셈에서 뺀다. 글 줄 수는 글 범위의 getClientRects() 줄(위치가 다른 줄)로 센다
      const shortEl = sticky.querySelector<HTMLElement>('.alert-short-row')
      let short: StickyShot['short'] = null
      if (shortEl !== null) {
        const r = shortEl.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(shortEl)
        // 위 끝이 4px 넘게 다른 글 상자를 다른 줄로 센다 (같은 줄의 다른 크기 글은 한 줄)
        const tops = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => rect.top).sort((a, b) => a - b)
        let lines = 0
        let last = Number.NEGATIVE_INFINITY
        for (const top of tops) {
          if (top - last > 4) lines++
          last = top
        }
        short = { height: r.height, marginTop: parseFloat(getComputedStyle(shortEl).marginTop) || 0, shown: shown(shortEl), sw: shortEl.scrollWidth, cw: shortEl.clientWidth, lines, text: (shortEl.textContent ?? '').trim() }
      }
      out.push({ y: window.scrollY, vh: window.innerHeight, sticky: { top: s.top, bottom: s.bottom, height: s.height }, parts, outside: outsideList, short })
    }
    window.scrollTo(0, 0)
    return out
  }, ys)
}

/** AC-MOB2-05: 포커스를 빼고 스크롤 0 → 빠른 입력칸이 아래 막대 위·가운데가 그 칸, 리허설 띠·제목 h1, 누르면 AC-MOB1-03 그대로. 끝에 포커스를 뺀다 */
async function expectQuickAboveBar(page: Page, where: string, rehearsal: boolean): Promise<void> {
  const quick = page.getByLabel('빠른 입력')
  await quick.evaluate((el) => (el as HTMLElement).blur())
  await page.evaluate(() => window.scrollTo(0, 0))
  const bar = await barHeight(page)
  const vh = page.viewportSize()!.height
  const q = await quick.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { bottom: r.bottom, top: r.top, hit: hit === el || el.contains(hit), y: window.scrollY, what: hit === null ? 'null' : `${hit.tagName}.${String(hit.className)}` }
  })
  console.log(`[MOB2 측정] ${where} 빠른 입력칸 위 ${String(Math.round(q.top))} 아래 ${String(Math.round(q.bottom))} / 막대 위 끝 ${String(Math.round(vh - bar))} (스크롤 ${String(q.y)})`)
  expect(q.y, `${where} 스크롤 0`).toBe(0)
  expect(q.bottom, `${where} 빠른 입력칸 아래 끝 ≤ 막대 위 끝`).toBeLessThanOrEqual(vh - bar + 0.5)
  expect(q.hit, `${where} 칸 가운데를 덮은 것: ${q.what}`).toBe(true)
  if (rehearsal) await expect(page.getByRole('note').filter({ hasText: '리허설 · 실제 판매 아님' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // 누르면 AC-MOB1-03 그대로 (포커스 뒤에도 막대 위)
  await quick.click()
  await expect(quick).toBeFocused()
  const focused = (await quick.boundingBox())!
  expect(focused.y + focused.height, `${where} 포커스 뒤 막대 위`).toBeLessThanOrEqual(vh - (await barHeight(page)) + 0.5)
  await quick.evaluate((el) => (el as HTMLElement).blur())
}

for (const d of DEVICES) {
  for (const rehearsal of [false, true]) {
    const kind = rehearsal ? '리허설' : '실제'
    test(`AC-MOB2-01·03·05 ${d.label} 글자 150% ${kind}: 빠른 입력칸이 스크롤 0·포커스 없이 막대 위, 되돌리기 대기 1개에서 고정 영역 ≤ 화면 50%(스크롤 0·600), 요약·알림 띠·빠른 입력·되돌리기 단추가 고정 영역 안에 보이고 단추 ≥ 44px, 보이는 조작은 모두 고정 영역·화면 안${tag(d)}`, async ({ browser, baseURL }) => {
      const w = await world(browser, baseURL!, d, { big: true, rehearsal })
      const where = `${d.label} 150% ${kind}`
      try {
        const page = w.page
        // ── B. AC-MOB2-05 (되돌리기 대기 없음) ──
        await expectQuickAboveBar(page, where, rehearsal)

        // ── A. AC-MOB2-01·03 (되돌리기 대기 1개) ──
        const undo = await queueCancel(page)
        const shots = await shoot(page, [0, 600])
        for (const shot of shots) {
          const at = `${where} 스크롤 ${String(shot.y)}`
          // D-MOB2-13: 잰 높이 = 고정 영역 − (보이는 짧은 줄 상자 높이 + 그 줄의 margin-top). 짧은 줄이 없으면(리허설) 고정 영역 그대로
          const short = shot.short !== null && shot.short.shown ? shot.short : null
          const cut = short === null ? 0 : short.height + short.marginTop
          const measured = shot.sticky.height - cut
          console.log(`[MOB2 측정] ${at}: 고정 영역 ${String(Math.round(shot.sticky.height))} · 짧은 줄 ${short === null ? '없음' : `${String(Math.round(short.height))}+간격 ${String(Math.round(short.marginTop))}`} · 잰 높이 ${String(Math.round(measured))} / 기준 ${String(shot.vh * 0.5)} (위 ${String(Math.round(shot.sticky.top))})`)
          expect(measured, `${at} 잰 높이(짧은 줄 뺌) ≤ innerHeight × 0.5`).toBeLessThanOrEqual(shot.vh * 0.5)
          if (rehearsal) expect(short, `${at} 리허설에는 출력 기기 짧은 줄이 없다`).toBeNull()
          else {
            // 실제 방송: 짧은 줄 "라벨이 안 나가요 · …"가 보이고, 말줄임 없이, 높이 ≥ 44px (D-QL3R1-04·D-QL3R2-03). 글 두 줄 이하는 아래 TE-MOB2-007 시험
            expect(short, `${at} 출력 기기 짧은 줄 보임 (${JSON.stringify(shot.short)})`).not.toBeNull()
            expect(short!.text, `${at} 짧은 줄 글`).toContain(NO_STATION_SHORT)
            expect(short!.sw, `${at} 짧은 줄 말줄임 없음 (${JSON.stringify(short)})`).toBeLessThanOrEqual(short!.cw + 1)
            expect(short!.height, `${at} 짧은 줄 높이 ≥ 44px`).toBeGreaterThanOrEqual(44)
          }
          for (const [name, part] of Object.entries(shot.parts)) {
            expect(part, `${at} ${name} 있음`).not.toBeNull()
            expect(part!.shown, `${at} ${name} 보임`).toBe(true)
            expect(part!.inside, `${at} ${name} 고정 영역 안 (${JSON.stringify(part)})`).toBe(true)
          }
          expect(shot.parts['undo']!.height, `${at} 되돌리기 단추 높이 ≥ 44px`).toBeGreaterThanOrEqual(44)
          expect(shot.outside, `${at} 고정 영역·화면 밖으로 나간 조작`).toEqual([])
        }
        expect(shots[1]!.y, `${where} 600px 스크롤이 실제로 됨`).toBeGreaterThan(0)
        expect(shots[1]!.sticky.top, `${where} 스크롤 뒤에도 고정 영역이 위에 붙음`).toBeGreaterThanOrEqual(-1)
        void undo
        await expectNoOverflow(page, `${where} 콘솔`)
      } finally {
        await w.close()
      }
    })
  }
}

// TE-MOB2-007 (D-MOB2-13 "짧은 줄은 … 글은 두 줄 이하", D-QL3R2-02 "짧은 줄 하나(두 줄 글)"): 50%에서 빼는 짧은 줄이 자기 규칙(두 줄 이하)을 지키는지
for (const d of DEVICES) {
  test(`TE-MOB2-007 · AC-MOB2-01 ${d.label} 글자 150% 실제: 띠 아래 출력 기기 짧은 줄 "${NO_STATION_SHORT}"의 글이 두 줄 이하${tag(d)}`, async ({ browser, baseURL }) => {
    const w = await world(browser, baseURL!, d, { big: true, rehearsal: false })
    try {
      const [shot] = await shoot(w.page, [0])
      const short = shot!.short
      console.log(`[MOB2 측정] ${d.label} 150% 실제 짧은 줄: ${JSON.stringify(short)}`)
      expect(short?.shown, `짧은 줄 보임 (${JSON.stringify(short)})`).toBe(true)
      expect(short!.lines, `짧은 줄 글 두 줄 이하 (${JSON.stringify(short)})`).toBeLessThanOrEqual(2)
    } finally {
      await w.close()
    }
  })
}

// SA-MOB2-02 / D-MOB2-11: 8글자 이상 제목(제목 줄의 날짜가 다음 줄로 넘어가는 길이 — U-MOB2-01이 재현된 조건)에서도 AC-MOB2-05 그대로
const LONG_TITLE = '토요일 다육 방송 특가전'
for (const d of DEVICES) {
  for (const rehearsal of [false, true]) {
    const kind = rehearsal ? '리허설' : '실제'
    test(`AC-MOB2-05 ${d.label} 글자 150% ${kind} · 8글자 이상 제목 "${LONG_TITLE}": 빠른 입력칸이 스크롤 0·포커스 없이 막대 위, 칸 가운데가 그 칸, 포커스 뒤에도 막대 위${tag(d)}`, async ({ browser, baseURL }) => {
      const w = await world(browser, baseURL!, d, { big: true, rehearsal, title: LONG_TITLE })
      try {
        await expect(w.page.getByRole('heading', { level: 1 })).toContainText(LONG_TITLE)
        await expectQuickAboveBar(w.page, `${d.label} 150% ${kind} 긴 제목`, rehearsal)
      } finally {
        await w.close()
      }
    })
  }
}

/** AC-MOB2-02: 접힌 띠 안 보이는 버튼은 상자 전체가 띠 안, 보이지 않는 칩은 접근성 트리에도 없음, 첫 칩은 보임 */
async function expectChipsWhole(page: Page, where: string): Promise<void> {
  const strip = alerts(page)
  const r = await strip.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const items = [...el.querySelectorAll<HTMLElement>('li')]
    const rows = items.map((li) => {
      const button = li.querySelector('button') ?? li
      const st = getComputedStyle(button)
      const b = button.getBoundingClientRect()
      const shown = st.visibility !== 'hidden' && st.display !== 'none' && b.width > 0 && b.height > 0
      const inside = b.top >= box.top - 1 && b.bottom <= box.bottom + 1 && b.left >= box.left - 1 && b.right <= box.right + 1
      return { text: (button.textContent ?? '').trim().slice(0, 30), shown, inside }
    })
    return { rows }
  })
  const shownRows = r.rows.filter((x) => x.shown)
  for (const row of shownRows) expect(row.inside, `${where}: 보이는 칩 "${row.text}"의 상자 전체가 띠 안`).toBe(true)
  expect(r.rows[0]?.shown, `${where}: 첫 칩은 늘 보인다 (${JSON.stringify(r.rows)})`).toBe(true)
  // 보이지 않는 칩은 접근성 트리에도 없다 — 역할로 찾은 버튼 수 = 보이는 칩 수
  await expect(strip.getByRole('button'), `${where}: 접근성 트리의 칩 수 (${JSON.stringify(r.rows)})`).toHaveCount(shownRows.length)
  const toggle = page.getByRole('button', { name: '알림 2 펼치기', exact: true })
  await expect(toggle).toBeVisible()
  const tb = (await toggle.boundingBox())!
  const vw = page.viewportSize()!.width
  expect(tb.x, `${where}: 펼치기 단추 왼쪽 끝`).toBeGreaterThanOrEqual(-0.5)
  expect(tb.x + tb.width, `${where}: 펼치기 단추 오른쪽 끝`).toBeLessThanOrEqual(vw + 0.5)
  await expectNoClip(toggle, `${where} 펼치기 단추`)
}

for (const d of DEVICES) {
  for (const big of [true, false]) {
    test(`AC-MOB2-02 ${d.label} 글자 ${big ? '150%' : '100%'}: 접힌 띠의 칩은 다 보이거나 숨김(접근성 트리에도 없음), 첫 칩은 보임, "알림 2 펼치기" → 모두 보이고 잘림 0, 접으면 다시 같은 기준${tag(d)}`, async ({ browser, baseURL }) => {
      const w = await world(browser, baseURL!, d, { big, rehearsal: false })
      const where = `${d.label} ${big ? '150%' : '100%'}`
      try {
        const page = w.page
        await page.evaluate(() => window.scrollTo(0, 0))
        await expectChipsWhole(page, `${where} 접힘`)
        await page.getByRole('button', { name: '알림 2 펼치기', exact: true }).click()
        await expect(page.getByRole('button', { name: '알림 2 접기', exact: true })).toHaveAttribute('aria-expanded', 'true')
        const all = alerts(page).getByRole('button')
        await expect(all).toHaveCount(3)
        for (const button of await all.all()) {
          await expect(button).toBeVisible()
          await expectNoClip(button, `${where} 펼친 띠`)
        }
        await page.getByRole('button', { name: '알림 2 접기', exact: true }).click()
        await expect(page.getByRole('button', { name: '알림 2 펼치기', exact: true })).toHaveAttribute('aria-expanded', 'false')
        await expectChipsWhole(page, `${where} 다시 접음`)
      } finally {
        await w.close()
      }
    })
  }
}
