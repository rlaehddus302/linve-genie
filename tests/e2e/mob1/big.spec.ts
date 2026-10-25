// MOB1 글자 150% 가로 넘침 0 (AC-MOB1-02) · 쌓기·줄바꿈 (AC-MOB1-03, D-MOB1-03) — test-e2e (크로미움 375·412). 393 WebKit은 webkit.spec.ts.
// 가로 넘침 0 = 문서 scrollWidth ≤ 화면 폭 + 보이는 버튼·칸·링크가 화면 안 (support.ts expectNoOverflow — 넘친 요소의 글을 실패 문장에).
import { expect, test, type Locator, type Page } from '@playwright/test'
import { login, uniqueDate } from '../s05/support.ts'
import { registerApi, sendViewerChat, smsApi, smsField } from '../s06/support.ts'
import { menu, openMore } from '../menu.ts'
import { ANDROID, PHONE, alerts, baseUrlOf, broadcastApi, endBroadcastApi, expectBig, expectNoOverflow, freshSeller, newDevice, setLabelsApi, pendingWord } from './support.ts' // QL3R2 D-QL3R2-02 (pendingWord)

interface Day {
  readonly date: string
  readonly real: string
  readonly rehearsal: string
  readonly ended: string
  readonly buyer: string
}

/** 실제 방송(상품 3개·빨간 알림(출력 멈춤)·노란 알림(보류 찜)) + 채팅 있는 리허설 + 끝난 방송 */
async function makeDay(page: Page): Promise<Day> {
  const date = uniqueDate()
  const real = await broadcastApi(page, date, false, '오늘 실제 방송 다육 특가 1부')
  for (const no of [1, 2, 3]) await registerApi(page, real, no, `핑크프릴${String(no)}`, 10000 * no)
  await smsApi(page, { b: real, no: 1, phone: '010-7100-0001' })
  // 빨간 알림: 출력 멈춤 (긴 까닭 문장이 버튼 글에 붙는다)
  const paused = await page.request.post('/api/print/pause', { data: {}, headers: { Origin: new URL(page.url()).origin } })
  expect(paused.ok(), await paused.text()).toBe(true)
  // 보류 찜 (노란 알림)
  await smsApi(page, { b: real, no: 40, memo: '보류' })
  const rehearsal = await broadcastApi(page, date, true)
  await registerApi(page, rehearsal, 15, '핑크프릴', 10000)
  for (const [nick, text] of [['시청자하나', '15'], ['시청자둘', '15번 예뻐요 실물도 이래요?'], ['아주긴닉네임을쓰는시청자입니다', '15번 15번 15번 사이즈 어떻게 되나요 궁금해요']] as const) await sendViewerChat(page, rehearsal, nick, text)
  const ended = await broadcastApi(page, uniqueDate(), false, '끝난 방송')
  await registerApi(page, ended, 1, '끝난품종', 3000)
  await endBroadcastApi(page, ended)
  const view = (await (await page.request.get(`/api/days/${date}`)).json()) as { claims: { no: number; currentBuyer: string }[] }
  const buyer = view.claims.find((c) => c.no === 1)!.currentBuyer
  return { date, real, rehearsal, ended, buyer }
}

/** 요소의 글이 잘리지 않는다 (scrollWidth ≤ clientWidth) · 화면 안 */
async function expectWrapped(page: Page, target: Locator, where: string): Promise<void> {
  const r = await target.evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { sw: el.scrollWidth, cw: el.clientWidth, left: b.left, right: b.right, text: (el.textContent ?? '').trim().slice(0, 40) }
  })
  expect(r.sw, `${where} "${r.text}" 글이 잘림 (scrollWidth ${String(r.sw)} > clientWidth ${String(r.cw)})`).toBeLessThanOrEqual(r.cw + 1)
  expect(r.left, `${where} "${r.text}" 왼쪽`).toBeGreaterThanOrEqual(-0.5)
  expect(r.right, `${where} "${r.text}" 오른쪽`).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5)
}

for (const [label, viewport] of [['375×812', PHONE], ['412×915', ANDROID]] as const) {
  test(`AC-MOB1-02·03 글자 150% ${label}: 방송 목록·콘솔(띠 펼침·접음)·끝난 콘솔·문자찜(고르기 전·후)·구매자·정산·포장·라벨·설정·"더보기" 목록 — 가로 넘침 0, 빠른 입력은 세로로 쌓이고 알림 버튼 글은 줄바꿈`, async ({ page, browser }) => {
    test.setTimeout(240_000)
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: true, big: true })
    try {
      await setLabelsApi(dev, true)
      // 방송이 없을 때 문자찜 입력 — 고르기 전 경고 상자
      await dev.goto('/sms')
      await expectBig(dev)
      await expect(dev.getByRole('heading', { level: 1, name: '문자찜 입력' })).toBeVisible()
      const smsCard = dev.getByRole('region', { name: '고른 방송' })
      await expect(smsCard.getByRole('status')).toBeVisible()
      await expectNoOverflow(dev, '문자찜 입력(고르기 전)')
      await expectWrapped(dev, smsCard.getByRole('status'), '고르기 전 경고 상자')
      await expectWrapped(dev, dev.getByRole('heading', { level: 1, name: '문자찜 입력' }), '제목')

      const day = await makeDay(dev)
      await dev.goto('/')
      await expect(dev.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
      await expectNoOverflow(dev, '방송 목록')

      // 진행 중 콘솔 (실제 방송) — 띠 접음·펼침
      await dev.goto(`/broadcasts/${encodeURIComponent(day.real)}`)
      const input = dev.getByLabel('빠른 입력')
      await expect(input).toBeVisible()
      await expect(alerts(dev).getByRole('button', { name: /^출력 멈춤 · / })).toHaveCount(1)
      // MOB2 D-MOB2-02: 접힌 띠에 다 들지 않는 칩은 숨겨지고 접근성 트리에서도 빠진다 — 항목이 있는지·차례는 숨은 칩도 센다
      await expect(alerts(dev).getByRole('button', { name: new RegExp(`^${pendingWord(dev)} \\d+$`), includeHidden: true })).toHaveCount(1) // QL3R2 D-QL3R2-02 · MOB2 D-MOB2-02 (D-MOB2-11 준비 줄)
      await expectNoOverflow(dev, '콘솔(띠 접음)')
      // 빠른 입력 줄: 세로로 쌓임 — 입력칸 폭 ≥ 화면 60%, 입력칸·"개수" 칸이 화면 안
      const ib = (await input.boundingBox())!
      expect(ib.width, '입력칸 폭 ≥ 화면 60%').toBeGreaterThanOrEqual(viewport.width * 0.6)
      expect(ib.x + ib.width).toBeLessThanOrEqual(viewport.width + 0.5)
      const count = dev.getByLabel('개수', { exact: true })
      if ((await count.count()) > 0) {
        const cb = (await count.boundingBox())!
        expect(cb.x).toBeGreaterThanOrEqual(-0.5)
        expect(cb.x + cb.width, '"개수" 칸 화면 안').toBeLessThanOrEqual(viewport.width + 0.5)
      }
      const toggle = dev.getByRole('button', { name: /^알림 \d+ 펼치기$/ })
      await toggle.click()
      await expect(dev.getByRole('button', { name: /^알림 \d+ 접기$/ })).toBeVisible()
      await expectNoOverflow(dev, '콘솔(띠 펼침)')
      for (const button of await alerts(dev).getByRole('button').all()) await expectWrapped(dev, button, '알림 버튼')

      // 리허설 콘솔 (채팅)
      await dev.goto(`/broadcasts/${encodeURIComponent(day.rehearsal)}`)
      await expect(dev.getByRole('list', { name: '채팅 메시지' }).getByRole('listitem').filter({ hasText: '아주긴닉네임을쓰는시청자입니다' })).toBeVisible()
      await expectNoOverflow(dev, '리허설 콘솔(채팅)')

      // 끝난 방송 콘솔
      await dev.goto(`/broadcasts/${encodeURIComponent(day.ended)}`)
      await expect(dev.getByText('끝난 방송이에요')).toBeVisible()
      await expectNoOverflow(dev, '끝난 콘솔')

      // 문자찜 입력 — 고른 뒤 방송 카드
      await dev.goto('/sms')
      await smsCard.getByRole('button', { name: /^방송 (바꾸기|고르기)$/ }).click()
      const pick = dev.getByRole('dialog', { name: '방송 고르기' })
      await expect(pick).toBeVisible()
      await expectNoOverflow(dev, '방송 고르기 창')
      await pick.getByRole('button', { name: /^오늘 실제 방송 다육 특가 1부 ·/ }).click()
      await expect(smsCard).toContainText('오늘 실제 방송 다육 특가 1부')
      await expect(smsField(dev, '번호')).toBeVisible()
      await expectNoOverflow(dev, '문자찜 입력(고른 뒤)')
      await expectWrapped(dev, smsCard, '방송 카드')
      for (const button of await smsCard.getByRole('button').all()) await expectWrapped(dev, button, '방송 카드 버튼')

      // 구매자 · 정산 · 포장(구매자 한 명) · 라벨 · 설정
      for (const [where, path, ready] of [
        ['구매자', `/buyers?date=${day.date}`, () => dev.getByRole('heading', { level: 1, name: '구매자' })],
        ['정산', `/settlements?date=${day.date}`, () => dev.getByRole('region', { name: '정산 요약' })],
        ['포장(구매자 한 명)', `/packing?date=${day.date}&buyer=${encodeURIComponent(day.buyer)}`, () => dev.getByRole('region', { name: '포장 라벨' }).getByRole('img').first()],
        ['라벨', '/labels', () => dev.getByRole('heading', { level: 1, name: '라벨' })],
        ['설정', '/settings', () => dev.getByRole('region', { name: '전체 기록 내려받기', exact: true })],
      ] as const) {
        await dev.goto(path)
        await expect(ready(), where).toBeVisible()
        await expectNoOverflow(dev, where)
      }
      // "더보기" 목록을 연 상태
      await openMore(dev)
      await expectNoOverflow(dev, '"더보기" 목록')
    } finally {
      await context.close()
    }
  })
}

test.describe('AC-MOB1-03 글자 100% 375×812 — 지금 모양 그대로', () => {
  test('콘솔 고정 영역 ≤ 화면 35%, 빠른 입력 줄은 한 줄(이름·입력칸·개수의 위 끝 차이 ≤ 4px), 위 줄의 "시험 가게"와 프린터 상태가 한 줄', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await newDevice(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
    try {
      await login(dev)
      await setLabelsApi(dev, true)
      const b = await broadcastApi(dev, uniqueDate(), true)
      await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
      const input = dev.getByLabel('빠른 입력')
      await expect(input).toBeFocused()
      const pinned = await dev.evaluate(() => {
        const vh = window.innerHeight
        let total = 0
        const all = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => ['fixed', 'sticky'].includes(getComputedStyle(el).position))
        for (const el of all) {
          if (all.some((o) => o !== el && o.contains(el))) continue
          const r = el.getBoundingClientRect()
          total += Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
        }
        return total
      })
      expect(pinned, '고정 영역').toBeLessThanOrEqual(PHONE.height * 0.35)
      const tops = [(await dev.getByText('빠른 입력', { exact: true }).boundingBox())!.y, (await input.boundingBox())!.y]
      const count = dev.getByLabel('개수', { exact: true })
      if ((await count.count()) > 0) tops.push((await count.boundingBox())!.y)
      for (const top of tops) expect(Math.abs(top - tops[0]!), `빠른 입력 줄 위 끝 ${JSON.stringify(tops)}`).toBeLessThanOrEqual(4)
      // 위 줄: 가게 이름과 프린터 상태
      const banner = dev.getByRole('banner')
      const shop = banner.getByText('시험 가게', { exact: true })
      const printer = banner.getByRole('link', { name: /^(프린터 .+|출력 기기 없음.*|출력 멈춤.*)$/ })
      await expect(printer).toBeVisible()
      const sy = (await shop.boundingBox())!.y
      const py = (await printer.boundingBox())!.y
      expect(Math.abs(sy - py), `가게 이름 ${String(sy)} · 프린터 ${String(py)}`).toBeLessThanOrEqual(4)
      await expect(menu(dev)).toBeVisible()
    } finally {
      await context.close()
    }
  })
})

// MOB1 D-MOB1-17 (1) (U-MOB1-01, SA-MOB1-02): 글자 150% 휴대폰 콘솔에서 빠른 입력칸·되돌리기 띠가 아래 메뉴 막대 뒤에 깔리지 않는다 (AC-MOB1-03)
/** 대상들이 모두 화면 안(위 끝 ≥ 0, 아래 끝 ≤ 화면 높이)이고 아래 막대 위 끝보다 위(아래 끝 ≤ 막대 위 끝)인가 — 어긋난 것을 글로 돌려준다 */
async function aboveBar(page: Page, targets: readonly (readonly [string, Locator])[]): Promise<string[]> {
  const bar = (await menu(page).boundingBox())!
  const height = page.viewportSize()!.height
  const out: string[] = []
  for (const [name, target] of targets) {
    const box = await target.boundingBox()
    if (box === null) {
      out.push(`${name}: 없음`)
      continue
    }
    const bottom = box.y + box.height
    if (box.y < -0.5) out.push(`${name}: 위 끝 ${String(Math.round(box.y))} < 0`)
    if (bottom > height + 0.5) out.push(`${name}: 아래 끝 ${String(Math.round(bottom))} > 화면 ${String(height)}`)
    if (bottom > bar.y + 0.5) out.push(`${name}: 아래 끝 ${String(Math.round(bottom))} > 막대 위 끝 ${String(Math.round(bar.y))}`)
  }
  return out
}

test.describe('AC-MOB1-03 글자 150% 휴대폰 콘솔 — 빠른 입력칸·되돌리기 띠가 아래 막대보다 위', () => {
  for (const [label, viewport] of [['375×812', PHONE], ['412×915', ANDROID]] as const) {
    test(`U-MOB1-01 ${label}: 진행 중 실제 방송 콘솔을 연 직후 빠른 입력칸 전체가 화면 안·막대 위, "15 핑크프릴 10000" Enter 뒤 되돌리기 띠("되돌리기")와 입력칸도 화면 안·막대 위`, async ({ page, browser }) => {
      await page.goto('/')
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: true, big: true })
      try {
        await setLabelsApi(dev, true)
        const date = uniqueDate()
        const real = await broadcastApi(dev, date, false, '오늘 실제 방송 다육 특가 1부')
        for (const no of [1, 2, 3]) await registerApi(dev, real, no, `핑크프릴${String(no)}`, 10000 * no)
        await smsApi(dev, { b: real, no: 1, phone: '010-7200-0001' })
        // 알림 띠에 빨간 출력 멈춤·노란 보류 찜 (방송 중 흔한 모양 — 위 줄이 높아진다)
        const paused = await dev.request.post('/api/print/pause', { data: {}, headers: { Origin: baseUrlOf(dev) } })
        expect(paused.ok(), await paused.text()).toBe(true)
        await smsApi(dev, { b: real, no: 40, memo: '보류' })
        // 처음 연 상태 (내리지 않음)
        await dev.goto(`/broadcasts/${encodeURIComponent(real)}`)
        await expectBig(dev)
        const input = dev.getByLabel('빠른 입력')
        await expect(input).toBeVisible()
        await expect(alerts(dev).getByRole('button', { name: /^출력 멈춤 · / })).toHaveCount(1)
        await expect(menu(dev)).toBeVisible()
        await expect.poll(() => aboveBar(dev, [['빠른 입력칸', input]]), '연 직후 빠른 입력칸이 막대 위').toEqual([])
        // 등록
        await input.click()
        await input.fill('15 핑크프릴 10000')
        await input.press('Enter')
        const undoBar = dev.getByRole('region', { name: '보내기 전 조치' })
        await expect(undoBar).toContainText('15번을 등록했어요')
        const undo = undoBar.getByRole('button', { name: '15번 등록 되돌리기', exact: true }).filter({ hasText: '되돌리기' })
        await expect(undo).toHaveCount(1)
        await expect
          .poll(() => aboveBar(dev, [['되돌리기 띠', undoBar], ['"되돌리기" 버튼', undo], ['빠른 입력칸', input]]), 'Enter 뒤 되돌리기 띠·입력칸이 막대 위')
          .toEqual([])
        await expect(undo).toBeVisible()
      } finally {
        await context.close()
      }
    })
  }
})
