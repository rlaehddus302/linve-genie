// QL2 휴대폰 콘솔 첫 화면 — 현재 상품 (AC-QL2-01~04, D-QL2-01, UX-04) — test-e2e.
// 기기: 375×812·412×915 크로미움(터치), 글자 150%·100%. 393×852 WebKit(@webkit 묶음 — devices['iPhone 15'])은 100%. PC 1440×900.
// "보인다(첫 화면)"는 공통 전제의 뜻(support.ts expectFirstScreen) — 아래 메뉴 막대에 가리지 않음.
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { postJson, uniqueDate } from '../s05/support.ts'
import { registerApi, scopeView, smsApi, viewerClaim, writeEvent } from '../s06/support.ts'
import { payAll } from '../crm1/support.ts'
import { IPHONE_UA, pendingWord } from '../mob1/support.ts' // QL3R2 D-QL3R2-02
import { ANDROID, PC, PHONE, alerts, baseUrlOf, barHeight, broadcastApi, endBroadcastApi, expectBig, expectFirstScreen, expectNoClip, expectNoOverflow, expectOrder, freshSeller, setLabelsApi } from './support.ts'

const IPHONE = { width: 393, height: 852 } as const
const HACKER = '<b>해커</b>'
/** 휴대폰 고정 영역 맨 위(제목·리허설 띠 바로 아래, 알림 띠 위)의 현재 상품 한 줄 요약 (D-QL2-11 (1)·QL2 D-QL2-14 (1)) */
const summary = (page: Page) => page.getByRole('status', { name: '현재 상품 요약' })
/** D-QL2-11 (1): 이름·1등은 낱자(Array.from) 10글자를 넘으면 앞 10글자 + "…" */
const clip10 = (text: string): string => {
  const chars = Array.from(text)
  return chars.length > 10 ? `${chars.slice(0, 10).join('')}…` : text
}
/** 리허설 채팅 닉네임 그대로의 요약 — AC-QL2-01 글자 그대로 */
const REHEARSAL_SUMMARY = `15번 핑크프릴 · 판매 중 · 1등 ${HACKER} · 대기 0명`

/** 리허설 띠 (role="note") — 두 문장 중 폭에 맞는 하나만 보인다 (D-QL2-13 (1)) */
const REHEARSAL_WIDE = '리허설 중 — 실제 판매가 아니에요'
const REHEARSAL_SHORT = '리허설 · 실제 판매 아님'
const band = (page: Page) => page.getByRole('note').filter({ hasText: '실제 판매' })

/**
 * 실제 방송 번호 no의 1등 묶음을 입금 완료로 — 시험 날짜(2005년)는 입금 기다리는 날이 지나 미입금이면 CRM1 "입금 늦음 주의" 꼬리표
 * (D-CRM1-04·07)가 요약 줄·카드 1등 뒤에 붙는다. 이 시험들은 꼬리표 없는 요약 문장을 재므로 꼬리표 조건을 만들지 않는다(꼬리표는 crm1/console.spec)
 */
async function payWinner(dev: Page, date: string, no: number): Promise<void> {
  const claim = (await scopeView(dev, date, false)).claims.filter((c) => c.no === no).sort((x, y) => x.seq - y.seq)[0]
  if (claim === undefined) throw new Error(`${String(no)}번 찜 없음`)
  await payAll(dev, date, claim.currentBuyer)
}

/** 수량을 정해 API로 상품 등록 */
async function registerStock(page: Page, b: string, no: number, name: string, price: number, stock: number): Promise<void> {
  const res = await writeEvent(page, { type: 'product.register', b, no, name, price, stock })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

interface Options {
  readonly viewport: { readonly width: number; readonly height: number }
  readonly big: boolean
  readonly rehearsal?: boolean
  readonly userAgent?: string
}

/**
 * AC-QL2-01 Given: 진행 중 방송, 세는 알림 둘(출력 멈춤 1·보류 찜 1 — 접힌 띠), 15번 "핑크프릴" 10,000원을 마지막에 등록하고 1등 `<b>해커</b>`.
 * 음성 꺼짐(기본), 되돌리기 대기 없음(API 등록), 고치기 칸 닫힘. 충돌은 실제 방송에서 채팅 없이 만들 수 없어 "예: 충돌 1" 대신 출력 멈춤(판매자)을 쓴다.
 * 라벨 켬 + 출력 기기 없음이라 띠 끝에 출력 기기 없음 항목(세지 않음)도 붙는다 — 실제 방송 하루의 흔한 모양.
 * AC-QL2-01 Then이 1등이 있는데 "판매 중"이므로 15번은 수량 2로 등록한다(수량 1이면 1등이 생기는 순간 판매 완료 — R 규칙).
 * 1등: 리허설은 채팅 닉네임 `<b>해커</b>` 그대로, 실제 방송은 채팅 없이 넣을 수 있는 문자찜(메모 `<b>해커</b>`)이라 구매자 이름이 카드의 "1등: …" 값 그대로다.
 */
async function consoleWorld(browser: Browser, page: Page, options: Options): Promise<{ dev: Page; close: () => Promise<void>; b: string }> {
  await page.goto('/')
  const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), {
    viewport: options.viewport,
    touch: options.viewport.width < 768,
    big: options.big,
    ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
  })
  await setLabelsApi(dev, true)
  const date = uniqueDate()
  const b = await broadcastApi(dev, date, options.rehearsal === true)
  expect((await postJson(dev, '/api/print/pause', {})).status).toBeLessThan(300)
  await registerApi(dev, b, 16, '청보석', 20000)
  await smsApi(dev, { b, no: 16, memo: '갑' })
  // 보류 찜 (등록 안 한 번호)
  await smsApi(dev, { b, no: 40, memo: '병' })
  await registerStock(dev, b, 15, '핑크프릴', 10000, 2)
  if (options.rehearsal === true) await viewerClaim(dev, b, HACKER, '15', 'sim_ql2_hacker')
  else {
    await smsApi(dev, { b, no: 15, memo: HACKER })
    await payWinner(dev, date, 15)
  }
  await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(dev.getByLabel('빠른 입력')).toBeVisible()
  if (options.big) await expectBig(dev)
  const strip = alerts(dev)
  await expect(strip.getByRole('button', { name: /^출력 멈춤 · / })).toHaveCount(1)
  await expect(strip.getByRole('button', { name: `${pendingWord(dev)} 1`, exact: true })).toHaveCount(1) // QL3R2 D-QL3R2-02
  if (options.viewport.width < 768) await expect(dev.getByRole('button', { name: '알림 2 펼치기', exact: true })).toHaveAttribute('aria-expanded', 'false')
  const current = dev.getByRole('region', { name: '현재 상품' })
  await expect(current.getByText('15번', { exact: true })).toBeVisible()
  await expect(current.getByText(/^1등: /)).toContainText(HACKER)
  // 스크롤 0 (포커스·자동 스크롤이 내려 놓지 않았는지는 expectFirstScreen이 본다)
  await dev.evaluate(() => window.scrollTo(0, 0))
  return { dev, b, close: () => context.close() }
}

async function expectCurrentOnFirstScreen(dev: Page, where: string): Promise<void> {
  const current = dev.getByRole('region', { name: '현재 상품' })
  await expectFirstScreen(dev, current.getByText('15번', { exact: true }), `${where} 번호 "15번"`)
  await expectFirstScreen(dev, current.getByText('핑크프릴', { exact: true }), `${where} 이름 "핑크프릴"`)
  const winner = current.getByText(/^1등: /)
  await expectFirstScreen(dev, winner, `${where} "1등: " 줄`)
  // 1등 이름은 글자 그대로 (굵게 바뀌지 않음 — 절대 규칙 7). 문자찜 구매자는 메모가 이름 안에 든다
  await expect(winner).toContainText(HACKER)
  expect(await current.locator('b, script').count(), `${where} 이름이 HTML로 해석됨`).toBe(0)
}

/**
 * D-QL2-11 (1)(4): 요약 줄 글자 그대로 + 보인다 + 글자 잘림 0 + `b` 요소 0, 600px 스크롤해도 보인다(고정 영역).
 * 기대 문장은 스펙의 틀 "{번호}번 {이름} · {상태} · 1등 {1등} · 대기 {n}명" — {1등}은 카드의 "1등: …" 값을 10글자로 자른 것.
 */
async function expectSummaryOnFirstScreen(dev: Page, where: string, rehearsal: boolean, oneLine = false): Promise<void> {
  const line = summary(dev)
  const winner = (await dev.getByRole('region', { name: '현재 상품' }).getByText(/^1등: /).innerText()).replace(/^1등: /, '').trim()
  expect(winner, `${where} 카드의 1등`).toContain(HACKER)
  const expected = rehearsal ? REHEARSAL_SUMMARY : `15번 핑크프릴 · 판매 중 · 1등 ${clip10(winner)} · 대기 0명`
  await expect(line).toHaveText(expected)
  expect(await line.locator('b, script').count(), `${where} 요약 닉네임이 HTML로 해석됨`).toBe(0)
  await expectFirstScreen(dev, line, `${where} 요약 줄`)
  if (oneLine) {
    // QL3R1 D-QL3R1-02 ⓒ: 휴대폰 큰 글씨 고정 영역의 요약 줄은 한 줄 말줄임 — 위아래 잘림 0·한 줄, 문장 전체는 title
    const r = await line.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, overflow: getComputedStyle(el).textOverflow }))
    expect(r.sh, `${where} 요약 줄 위아래 잘림`).toBeLessThanOrEqual(r.ch + 1)
    expect(r.overflow, `${where} 요약 줄 말줄임`).toBe('ellipsis')
    expect(await line.getAttribute('title'), `${where} 요약 줄 title`).toBe(expected)
  } else await expectNoClip(line, `${where} 요약 줄`)
  // 600px 아래로 스크롤해도 보인다 (고정 영역)
  await dev.evaluate(() => window.scrollTo(0, 600))
  const bar = await barHeight(dev)
  const vh = dev.viewportSize()!.height
  const r = await line.evaluate((el) => {
    const b = el.getBoundingClientRect()
    const hit = document.elementFromPoint(b.left + Math.min(b.width / 2, 8), b.top + b.height / 2)
    return { top: b.top, bottom: b.bottom, covered: hit === null || !(hit === el || el.contains(hit)), y: window.scrollY }
  })
  const text = `${where} 스크롤 ${String(r.y)} 뒤 요약 줄: 위 ${String(Math.round(r.top))} · 아래 ${String(Math.round(r.bottom))} · 막대 위 끝 ${String(Math.round(vh - bar))}`
  expect(r.top, text).toBeGreaterThanOrEqual(0)
  expect(r.bottom, text).toBeLessThanOrEqual(vh - bar + 0.5)
  expect(r.covered, `${text} 덮임`).toBe(false)
  await dev.evaluate(() => window.scrollTo(0, 0))
}

/**
 * QL2 D-QL2-14 (1): 요약 줄은 고정 영역 **맨 위** — 문서 차례 (리허설 띠 →) 제목 h1 → 요약 → 알림 띠 → 빠른 입력,
 * 화면에서 제목 아래 끝 ≤ 요약 위 끝, 요약 아래 끝 ≤ 알림 띠 위 끝, 요약 위로 고정 영역 안에 보이는 다른 요소가 없다(스크롤 0).
 */
async function expectSummaryOnTop(dev: Page, where: string, rehearsal: boolean): Promise<void> {
  const line = summary(dev)
  const title = dev.getByRole('heading', { level: 1 })
  const strip = alerts(dev)
  const quick = dev.getByLabel('빠른 입력')
  await expectOrder(
    [
      ...(rehearsal ? [['리허설 띠', band(dev)] as const] : []),
      ['제목', title],
      ['요약 줄', line],
      ['알림 띠', strip],
      ['빠른 입력', quick],
    ],
    `${where} 고정 영역 차례`,
  )
  expect(await dev.evaluate(() => window.scrollY), `${where}: 스크롤 0`).toBe(0)
  const t = (await title.boundingBox())!
  const s = (await line.boundingBox())!
  const a = (await strip.boundingBox())!
  const pos = `${where}: 제목 아래 ${String(Math.round(t.y + t.height))} · 요약 ${String(Math.round(s.y))}~${String(Math.round(s.y + s.height))} · 알림 띠 위 ${String(Math.round(a.y))}`
  expect(s.y, `${pos} — 요약이 제목 아래`).toBeGreaterThanOrEqual(t.y + t.height - 0.5)
  expect(s.y + s.height, `${pos} — 요약이 알림 띠 위`).toBeLessThanOrEqual(a.y + 0.5)
  // 고정 영역(위에 붙는 조상) 안에서 요약보다 위에 보이는 요소가 없다 — 맨 위 자리
  const above = await line.evaluate((el) => {
    let pinned: Element | null = el.parentElement
    while (pinned !== null && getComputedStyle(pinned).position !== 'sticky') pinned = pinned.parentElement
    if (pinned === null) return ['고정 영역 없음']
    const top = el.getBoundingClientRect().top
    return [...pinned.querySelectorAll('*')]
      .filter((x) => x !== el && !el.contains(x) && !x.contains(el))
      .filter((x) => {
        const r = x.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.bottom <= top + 0.5
      })
      .map((x) => `${x.tagName}.${x.className} "${(x.textContent ?? '').trim().slice(0, 20)}"`)
  })
  expect(above, `${where} 고정 영역 안 요약보다 위에 있는 요소`).toEqual([])
}

test.describe('AC-QL2-01 첫 화면에 현재 상품 — 150%는 요약 줄, 100%는 요약 줄과 카드 (D-QL2-11 (4))', () => {
  for (const [label, viewport] of [['375×812', PHONE], ['412×915', ANDROID]] as const) {
    for (const rehearsal of [false, true]) {
      // QL2 D-QL2-11 (4): 150%의 "보인다" 대상은 요약 줄
      test(`${label} 글자 150%: ${rehearsal ? '리허설' : '실제'} 방송 — 요약 줄 "15번 핑크프릴 · 판매 중 · 1등 … · 대기 0명"이 아래 막대에 가리지 않고 보이고, 600px 스크롤해도 보인다`, async ({ page, browser }) => {
        const w = await consoleWorld(browser, page, { viewport, big: true, rehearsal })
        try {
          if (rehearsal) {
            const panel = w.dev.getByRole('region', { name: '리허설 조작판' })
            await expect(panel).toBeVisible()
            await expectOrder([['현재 상품', w.dev.getByRole('region', { name: '현재 상품' })], ['리허설 조작판', panel]], `${label} 리허설`)
          }
          await expectSummaryOnFirstScreen(w.dev, `${label} 150%${rehearsal ? ' 리허설' : ''}`, rehearsal, true) // QL3R1 D-QL3R1-02
          // QL2 D-QL2-14 (1): 요약은 고정 영역 맨 위, 알림 띠 위
          await expectSummaryOnTop(w.dev, `${label} 150%${rehearsal ? ' 리허설' : ''}`, rehearsal)
        } finally {
          await w.close()
        }
      })
      test(`${label} 글자 100%: ${rehearsal ? '리허설' : '실제'} 방송 — 요약 줄과 카드의 "15번"·"핑크프릴"·"1등: <b>해커</b>"가 보인다`, async ({ page, browser }) => {
        const w = await consoleWorld(browser, page, { viewport, big: false, rehearsal })
        try {
          await expectSummaryOnFirstScreen(w.dev, `${label} 100%${rehearsal ? ' 리허설' : ''}`, rehearsal)
          // QL2 D-QL2-14 (1): 요약은 고정 영역 맨 위, 알림 띠 위
          await expectSummaryOnTop(w.dev, `${label} 100%${rehearsal ? ' 리허설' : ''}`, rehearsal)
          await expectCurrentOnFirstScreen(w.dev, `${label} 100%${rehearsal ? ' 리허설' : ''}`)
        } finally {
          await w.close()
        }
      })
    }
  }

  // QL2 D-QL2-14 (2): 393×852 WebKit도 글자 100%·150% × 실제 방송·리허설 (열두 경우 — 375·412는 위 묶음)
  for (const rehearsal of [false, true]) {
    const kind = rehearsal ? '리허설' : '실제'
    test(`393×852 WebKit 글자 100%: ${kind} 방송 — 요약 줄(고정 영역 맨 위, 알림 띠 위)과 카드가 보인다, 가로 넘침 0 @webkit`, async ({ page, browser }) => {
      const w = await consoleWorld(browser, page, { viewport: IPHONE, big: false, rehearsal, userAgent: IPHONE_UA })
      try {
        await expectSummaryOnFirstScreen(w.dev, `393 WebKit 100% ${kind}`, rehearsal)
        await expectSummaryOnTop(w.dev, `393 WebKit 100% ${kind}`, rehearsal)
        await expectCurrentOnFirstScreen(w.dev, `393 WebKit 100% ${kind}`)
        await expectNoOverflow(w.dev, `393 WebKit ${kind} 콘솔`)
      } finally {
        await w.close()
      }
    })

    test(`393×852 WebKit 글자 150%: ${kind} 방송 — 요약 줄이 고정 영역 맨 위(알림 띠 위)에 아래 막대에 가리지 않고 보이고, 600px 스크롤해도 보인다, 가로 넘침 0 @webkit`, async ({ page, browser }) => {
      const w = await consoleWorld(browser, page, { viewport: IPHONE, big: true, rehearsal, userAgent: IPHONE_UA })
      try {
        if (rehearsal) {
          // 리허설 띠는 보이고 짧은 한 줄 (D-QL2-13)
          await expect(band(w.dev)).toHaveText(REHEARSAL_SHORT, { useInnerText: true })
          await expectFirstScreen(w.dev, band(w.dev), '393 WebKit 150% 리허설 띠')
        }
        await expectSummaryOnFirstScreen(w.dev, `393 WebKit 150% ${kind}`, rehearsal, true) // QL3R1 D-QL3R1-02
        await expectSummaryOnTop(w.dev, `393 WebKit 150% ${kind}`, rehearsal)
        await expectNoOverflow(w.dev, `393 WebKit 150% ${kind} 콘솔`)
      } finally {
        await w.close()
      }
    })
  }

  test('375×812 요약 문장: 현재 상품 없음 → "현재 상품: 아직 없어요", 1등 없음 → "1등 아직 없음", 판매 완료 상태 낱말, 12글자 이름은 앞 10글자 + "…"(카드는 전체)', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true, big: false })
    try {
      const date = uniqueDate()
      const b = await broadcastApi(dev, date)
      await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(dev.getByLabel('빠른 입력')).toBeVisible()
      await expect(summary(dev)).toHaveText('현재 상품: 아직 없어요')
      await registerApi(dev, b, 15, '핑크프릴', 10000)
      await expect(summary(dev)).toHaveText('15번 핑크프릴 · 판매 중 · 1등 아직 없음 · 대기 0명')
      // 수량 1에 1등 → 판매 완료 (요약의 1등은 카드 값 그대로)
      await smsApi(dev, { b, no: 15, memo: '갑' })
      // 1등을 입금 완료로 하고 콘솔을 다시 연다(꼬리표는 열 때·1등이 바뀔 때 받는다 — D-CRM1-14)
      await payWinner(dev, date, 15)
      await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(dev.getByLabel('빠른 입력')).toBeVisible()
      const current = dev.getByRole('region', { name: '현재 상품' })
      await expect(current.getByText('판매 완료', { exact: true })).toBeVisible()
      const winner = (await current.getByText(/^1등: /).innerText()).replace(/^1등: /, '').trim()
      expect(winner).not.toBe('아직 없음')
      await expect(summary(dev)).toHaveText(`15번 핑크프릴 · 판매 완료 · 1등 ${clip10(winner)} · 대기 0명`)
      // 12글자 이름
      const long = '가나다라마바사아자차카타'
      await registerApi(dev, b, 18, long, 3000)
      await expect(summary(dev)).toHaveText('18번 가나다라마바사아자차… · 판매 중 · 1등 아직 없음 · 대기 0명')
      await expect(current.getByText(long, { exact: true })).toBeVisible()
      await expectFirstScreen(dev, summary(dev), '375 100% 12글자 요약')
    } finally {
      await context.close()
    }
  })

  test('1440×900 PC: 요약 줄이 없다, 현재 상품은 왼쪽 열 카드', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PC, big: false })
    try {
      await expect(summary(w.dev)).toHaveCount(0)
      await expect(w.dev.getByRole('region', { name: '현재 상품' }).getByText('15번', { exact: true })).toBeVisible()
    } finally {
      await w.close()
    }
  })

  test('375×812 끝난 방송: 요약 줄이 없다', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PHONE, big: false })
    try {
      await endBroadcastApi(w.dev, w.b)
      await w.dev.reload()
      await expect(w.dev.getByText('끝난 방송이에요', { exact: true })).toBeVisible()
      await expect(summary(w.dev)).toHaveCount(0)
    } finally {
      await w.close()
    }
  })
})


/** 띠의 보이는 글 줄 수 (Range.getClientRects 줄 위 끝을 모아 셈 — 숨긴 문장은 상자가 없다), 색·테두리·굵기 */
async function bandShape(target: Locator): Promise<{ lines: number; bg: string; border: string; weight: string }> {
  return await target.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const tops = new Set([...range.getClientRects()].filter((x) => x.width > 0 && x.height > 0).map((x) => Math.round(x.top)))
    const s = getComputedStyle(el)
    return { lines: tops.size, bg: s.backgroundColor, border: s.borderTopColor, weight: s.fontWeight }
  })
}

async function expectBandLook(dev: Page, where: string): Promise<void> {
  const shape = await bandShape(band(dev))
  expect(shape.lines, `${where} 리허설 띠 글 줄 수`).toBe(1)
  // 색(#fff4e5 바탕·#7a4100 테두리)·굵은 글자 그대로 (D-QL2-13 (2))
  expect(shape.bg, `${where} 띠 바탕`).toBe('rgb(255, 244, 229)')
  expect(shape.border, `${where} 띠 테두리`).toBe('rgb(122, 65, 0)')
  expect(Number(shape.weight), `${where} 띠 굵기`).toBeGreaterThanOrEqual(700)
  await expectNoClip(band(dev), `${where} 리허설 띠`)
}

test.describe('AC-QL2-01 리허설 띠 — 휴대폰은 짧은 한 줄, PC는 옛 문장 (D-QL2-13)', () => {
  for (const [label, viewport] of [['375×812', PHONE], ['412×915', ANDROID]] as const) {
    for (const big of [true, false]) {
      test(`${label} 글자 ${big ? '150%' : '100%'} 리허설: 띠 글은 "${REHEARSAL_SHORT}" 한 줄·잘림 없음·첫 화면에 보임, 옛 문장은 안 보이고 읽히지 않음, 누르는 것·펼침 없음`, async ({ page, browser }) => {
        const w = await consoleWorld(browser, page, { viewport, big, rehearsal: true })
        try {
          const dev = w.dev
          const note = band(dev)
          await expect(note).toHaveCount(1)
          await expect(note).toBeVisible()
          // textContent에는 두 문장이 다 있다 — 보이는 글(innerText)로 본다
          await expect(note).toHaveText(REHEARSAL_SHORT, { useInnerText: true })
          await expect(dev.getByText(REHEARSAL_WIDE, { exact: true })).toBeHidden()
          // 읽기 프로그램도 짧은 문장 하나만 (숨긴 쪽 display:none)
          await expect(note).toMatchAriaSnapshot(`- note: ${REHEARSAL_SHORT}`)
          // 누르는 기능·펼침 없음 (D-QL2-13 (2))
          await expect(note.getByRole('button')).toHaveCount(0)
          expect(await note.getAttribute('aria-expanded'), `${label} 띠 aria-expanded`).toBeNull()
          await expectBandLook(dev, `${label} ${big ? '150%' : '100%'}`)
          await expectFirstScreen(dev, note, `${label} ${big ? '150%' : '100%'} 리허설 띠`)
          // 띠를 눌러도 글이 그대로 (펼침 없음)
          await note.click()
          await expect(note).toHaveText(REHEARSAL_SHORT, { useInnerText: true })
          expect((await bandShape(note)).lines, `${label} 누른 뒤 띠 줄 수`).toBe(1)
          // 띠는 숨기거나 접지 않는다 — 600px 스크롤해도 문서에 보이는 상태
          await dev.evaluate(() => window.scrollTo(0, 600))
          await expect(note).toBeVisible()
          await dev.evaluate(() => window.scrollTo(0, 0))
          if (big) {
            // D-QL2-13 (4): 150% 리허설에서 요약 줄이 아래 막대 위
            await expectSummaryOnFirstScreen(dev, `${label} 150% 리허설(띠 한 줄)`, true, true) // QL3R1 D-QL3R1-02
          }
        } finally {
          await w.close()
        }
      })
    }
  }

  test('1440×900 PC 리허설: 띠 글은 옛 문장 "리허설 중 — 실제 판매가 아니에요" 한 줄, 짧은 문장은 안 보임, 제목의 "리허설" 꼬리표 그대로', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PC, big: false, rehearsal: true })
    try {
      const dev = w.dev
      const note = band(dev)
      await expect(note).toBeVisible()
      await expect(note).toHaveText(REHEARSAL_WIDE, { useInnerText: true })
      await expect(dev.getByText(REHEARSAL_WIDE, { exact: true })).toBeVisible()
      await expect(dev.getByText(REHEARSAL_SHORT, { exact: true })).toBeHidden()
      await expect(note).toMatchAriaSnapshot(`- note: ${REHEARSAL_WIDE}`)
      await expectBandLook(dev, '1440')
      await expect(dev.getByRole('heading', { level: 1 }).getByText('리허설', { exact: true })).toBeVisible()
    } finally {
      await w.close()
    }
  })

  test('375×812 실제 방송: 리허설 띠가 없다', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PHONE, big: true })
    try {
      await expect(band(w.dev)).toHaveCount(0)
      await expect(w.dev.getByText(REHEARSAL_SHORT, { exact: true })).toHaveCount(0)
    } finally {
      await w.close()
    }
  })
})

test.describe('AC-QL2-01b 빈 "등록하면" 줄 (D-QL2-11 (2))', () => {
  for (const big of [false, true]) {
    test(`375×812 글자 ${big ? '150%' : '100%'}: 빈 칸이면 "등록하면" 줄 자리 없음(빠른 입력 줄 아래 끝과 다음 요소 사이 빈 줄 없음), 치면 "등록하면: 15번 핑크프릴 10,000원"이 보인다`, async ({ page, browser }) => {
      await page.goto('/')
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true, big })
      try {
        const b = await broadcastApi(dev, uniqueDate())
        await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
        const input = dev.getByLabel('빠른 입력')
        await expect(input).toBeVisible()
        if (big) await expectBig(dev)
        // 빈 글이라 이름으로 찾을 수 없다 — 자리 클래스(p.quick-will-register, fb1 시험과 같음)
        const line = dev.locator('main .quick-will-register')
        await expect(line).toHaveCount(1)
        await expect(line).toHaveText('')
        expect(await line.evaluate((el) => el.getBoundingClientRect().height), '빈 "등록하면" 줄 높이').toBe(0)
        // QL2 D-QL2-14: 요약 줄은 고정 영역 맨 위로 갔다 — 빠른 입력 줄 아래의 다음 요소는 되돌리기 띠(대기 없음이라 없다) → 고정 영역 끝.
        // 휴대폰의 "등록하면" 줄은 고정 영역 바로 아래(D-FB1-18 (a))라, 빈 줄 자리는 (가) 빠른 입력 묶음 아래 끝 → 고정 영역 끝,
        // (나) 고정 영역 끝 → 그 아래 처음 보이는 요소 사이에 생긴다. 둘 다 "등록하면" 한 줄 높이보다 작아야 한다
        // (나)의 "그 아래 요소"는 "등록하면" 줄 자신을 빼고 센다 — 치면 그 줄이 들어가 그 요소가 한 줄만큼 내려가는지도 본다
        const gaps = async (): Promise<{ inner: number; below: number; next: string }> =>
          await dev.locator('main .console-sticky-quick').evaluate((quickBox) => {
            let pinned: Element | null = quickBox.parentElement
            while (pinned !== null && getComputedStyle(pinned).position !== 'sticky') pinned = pinned.parentElement
            if (pinned === null) throw new Error('고정 영역 없음')
            const area = pinned.getBoundingClientRect()
            const s = getComputedStyle(pinned)
            const contentBottom = area.bottom - parseFloat(s.paddingBottom) - parseFloat(s.borderBottomWidth)
            let next: Element | null = pinned.nextElementSibling
            while (next !== null && (next.getBoundingClientRect().height === 0 || next.classList.contains('quick-will-register'))) next = next.nextElementSibling
            if (next === null) throw new Error('고정 영역 아래 요소 없음')
            return {
              inner: contentBottom - quickBox.getBoundingClientRect().bottom,
              below: next.getBoundingClientRect().top - area.bottom,
              next: `${next.tagName}.${next.className} "${(next.textContent ?? '').trim().slice(0, 20)}"`,
            }
          })
        const empty = await gaps()
        await input.fill('15 핑크프릴 10000')
        await expect(line).toHaveText('등록하면: 15번 핑크프릴 10,000원')
        await expect(line).toBeVisible()
        // 빈 때의 틈은 "등록하면" 한 줄 높이보다 작다 (빈 줄 자리 없음)
        const shown = (await line.boundingBox())!
        expect(shown.height, '"등록하면" 줄 높이').toBeGreaterThan(0)
        expect(empty.inner, `빈 칸일 때 빠른 입력 묶음 아래 끝 → 고정 영역 끝 ${String(empty.inner)}px, "등록하면" 줄 ${String(shown.height)}px`).toBeLessThan(shown.height)
        expect(empty.below, `빈 칸일 때 고정 영역 끝 → ${empty.next} ${String(empty.below)}px, "등록하면" 줄 ${String(shown.height)}px`).toBeLessThan(shown.height)
        // 치면 그 줄이 고정 영역 끝과 그 아래 요소 사이에 들어가 틈이 한 줄만큼 는다 (재는 자리가 맞는지)
        const typed = await gaps()
        expect(typed.below, `치고 난 뒤 고정 영역 끝 → ${typed.next} ${String(typed.below)}px`).toBeGreaterThanOrEqual(empty.below + shown.height - 1)
        await input.fill('')
        await expect(line).toHaveText('')
        expect(await line.evaluate((el) => el.getBoundingClientRect().height)).toBe(0)
      } finally {
        await context.close()
      }
    })
  }
})

test.describe('AC-QL2-02 차례', () => {
  test('375×812 진행 중 리허설 방송: h1 → 알림 띠·빠른 입력 → 단위 줄 → 현재 상품 → 상품 보드 → 방송 목록·상품 목록 가져오기·방송 끝내기 → 리허설 조작판 (QL3R1 D-QL3R1-03)', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PHONE, big: false, rehearsal: true })
    try {
      const dev = w.dev
      const h1 = dev.getByRole('heading', { level: 1 })
      await expectOrder(
        [
          ['h1', h1],
          ['알림', alerts(dev)],
          ['빠른 입력', dev.getByLabel('빠른 입력')],
          ['단위 줄', dev.getByText(/^가격 단위: /)],
          ['현재 상품', dev.getByRole('region', { name: '현재 상품' })],
          ['상품 보드', dev.getByRole('region', { name: '상품 보드' })], // QL3R1 D-QL3R1-03
          ['방송 목록', dev.getByRole('main').getByRole('link', { name: '방송 목록', exact: true })],
          ['상품 목록 가져오기', dev.getByRole('button', { name: '상품 목록 가져오기', exact: true })],
          ['방송 끝내기', dev.getByRole('button', { name: '방송 끝내기', exact: true })],
          ['리허설 조작판', dev.getByRole('region', { name: '리허설 조작판' })],
        ],
        '375 차례',
      )
      // 문서 차례 = Tab 차례: 양수 tabindex가 없다
      expect(await dev.locator('main [tabindex]:not([tabindex="0"]):not([tabindex="-1"])').count()).toBe(0)
      // "방송 끝내기"의 확인 창은 그대로
      await dev.getByRole('button', { name: '방송 끝내기', exact: true }).click()
      const dlg = dev.getByRole('dialog')
      await expect(dlg).toBeVisible()
      await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
      await dev.keyboard.press('Escape')
      await expect(dlg).toHaveCount(0)
    } finally {
      await w.close()
    }
  })

  test('375×812 실제 방송: 현재 상품 다음 상품 보드, 그 뒤 행동 줄(QL3R1 D-QL3R1-03) — 카드 안은 "현재 상품" → "15번" → 이름 → "1등: …" → 가격 → 상태 → "대기 n명" → "15번 자세히"', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PHONE, big: false })
    try {
      const dev = w.dev
      await expectOrder(
        [
          ['단위 줄', dev.getByText(/^가격 단위: /)],
          ['현재 상품', dev.getByRole('region', { name: '현재 상품' })],
          ['상품 보드', dev.getByRole('region', { name: '상품 보드' })], // QL3R1 D-QL3R1-03
          ['방송 목록', dev.getByRole('main').getByRole('link', { name: '방송 목록', exact: true })],
          ['방송 끝내기', dev.getByRole('button', { name: '방송 끝내기', exact: true })],
        ],
        '375 실제',
      )
      await expectCardOrder(dev, '375')
    } finally {
      await w.close()
    }
  })

  test('375×812 끝난 방송: "끝난 방송이에요"·"영수증 보내기"가 현재 상품 아래, 누르면 영수증 화면', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PHONE, big: false })
    try {
      const dev = w.dev
      await endBroadcastApi(dev, w.b)
      await dev.reload()
      const ended = dev.getByText('끝난 방송이에요', { exact: true })
      await expect(ended).toBeVisible()
      const receipts = dev.getByRole('link', { name: '영수증 보내기', exact: true })
      const current = dev.getByRole('region', { name: '현재 상품' })
      await expectOrder([['현재 상품', current], ['끝난 방송이에요', ended], ['영수증 보내기', receipts]], '375 끝난 방송')
      await receipts.click()
      await expect(dev).toHaveURL(new RegExp(`/broadcasts/${encodeURIComponent(w.b)}/receipts$`))
    } finally {
      await w.close()
    }
  })

  test('1440×900 PC: 행동 줄은 제목 옆, 현재 상품은 왼쪽 열 — 카드 안 차례는 휴대폰과 같다', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PC, big: false })
    try {
      const dev = w.dev
      const h1 = dev.getByRole('heading', { level: 1 })
      const list = dev.getByRole('main').getByRole('link', { name: '방송 목록', exact: true })
      const current = dev.getByRole('region', { name: '현재 상품' })
      // 행동 줄이 제목 옆: 문서 차례 h1 → 방송 목록 → 알림 띠 → 현재 상품, 같은 줄 높이
      await expectOrder([['h1', h1], ['방송 목록', list], ['알림', alerts(dev)], ['현재 상품', current]], 'PC 차례')
      const hb = (await h1.boundingBox())!
      const lb = (await list.boundingBox())!
      expect(lb.y, '"방송 목록"이 제목 줄에').toBeLessThan(hb.y + hb.height)
      expect(lb.y + lb.height, '"방송 목록"이 제목 줄에').toBeGreaterThan(hb.y)
      expect(lb.x, '"방송 목록"이 제목 오른쪽').toBeGreaterThan(hb.x)
      // 현재 상품은 왼쪽 열
      const cb = (await current.boundingBox())!
      expect(cb.x + cb.width / 2, '현재 상품은 왼쪽 열').toBeLessThan(PC.width / 2)
      await expectCardOrder(dev, 'PC')
    } finally {
      await w.close()
    }
  })
})

/** 카드 안 차례 (보이는 줄 글자로) */
async function expectCardOrder(dev: Page, where: string): Promise<void> {
  const current = dev.getByRole('region', { name: '현재 상품' })
  const lines = (await current.innerText()).split('\n').map((x) => x.trim()).filter((x) => x !== '')
  const at = (match: (line: string) => boolean, name: string): number => {
    const i = lines.findIndex(match)
    expect(i, `${where} 카드에 ${name} (${lines.join(' | ')})`).toBeGreaterThanOrEqual(0)
    return i
  }
  const title = at((l) => l === '현재 상품', '"현재 상품"')
  const no = at((l) => l === '15번', '"15번"')
  const name = at((l) => l === '핑크프릴', '이름')
  const winner = at((l) => l.startsWith('1등: '), '"1등: …"')
  const price = at((l) => l === '10,000원', '가격')
  const wait = at((l) => /^대기 \d+명$/.test(l), '"대기 n명"')
  const more = at((l) => l === '15번 자세히', '"15번 자세히"')
  const order = [title, no, name, winner, price, wait, more]
  expect(order, `${where} 카드 차례 (${lines.join(' | ')})`).toEqual([...order].sort((a, b) => a - b))
  // 가격과 "대기" 사이에 상태 한 줄
  expect(wait - price, `${where} 가격 → 상태 → 대기 (${lines.join(' | ')})`).toBe(2)
  expect(['공개 전', '판매 중', '판매 완료', '일시 중지', '판매 종료']).toContain(lines[price + 1])
}

test.describe('AC-QL2-03·04 고정 영역 그대로·가로 넘침 0', () => {
  test('375×812 글자 100%: 고정 영역 합 ≤ 284px, 알림 띠·빠른 입력·개수 칸이 그대로 있다', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PHONE, big: false })
    try {
      const dev = w.dev
      await expect(alerts(dev)).toBeVisible()
      await expect(dev.getByLabel('빠른 입력')).toBeVisible()
      await expect(dev.getByLabel('개수', { exact: true })).toBeVisible()
      const total = await dev.evaluate(() => {
        const vh = window.innerHeight
        const pinned = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => ['fixed', 'sticky'].includes(getComputedStyle(el).position))
        let sum = 0
        for (const el of pinned) {
          if (pinned.some((other) => other !== el && other.contains(el))) continue
          const r = el.getBoundingClientRect()
          sum += Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
        }
        return sum
      })
      expect(total).toBeLessThanOrEqual(284)
    } finally {
      await w.close()
    }
  })

  for (const [label, viewport] of [['375×812', PHONE], ['412×915', ANDROID]] as const) {
    for (const big of [true, false]) {
      test(`${label} 글자 ${big ? '150%' : '100%'}: 콘솔 가로 넘침 0 (띠 접음·펼침)`, async ({ page, browser }) => {
        const w = await consoleWorld(browser, page, { viewport, big })
        try {
          await expectNoOverflow(w.dev, `${label} 콘솔(접음)`)
          await w.dev.getByRole('button', { name: /^알림 \d+ 펼치기$/ }).click()
          await expect(w.dev.getByRole('button', { name: /^알림 \d+ 접기$/ })).toBeVisible()
          await expectNoOverflow(w.dev, `${label} 콘솔(펼침)`)
        } finally {
          await w.close()
        }
      })
    }
  }
})
