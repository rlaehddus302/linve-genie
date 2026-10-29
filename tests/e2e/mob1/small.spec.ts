// MOB1 작은 다듬기 · PC 버튼 높이 · 내려받기 이름 (AC-MOB1-21·22·23·26, D-MOB1-11·12·13) — test-e2e.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { registerApi, sendViewerChat, smsApi, smsField, uniqueDate } from '../s06/support.ts'
import { chat, registerOptions, SIZES } from '../o2/support.ts'
import { menu } from '../menu.ts'
import { ANDROID, PC, PHONE, baseUrlOf, broadcastApi, expectNoDevWords, freshSeller, setLabelsApi } from './support.ts'

function chatRow(page: Page, text: string): Locator {
  return page.getByRole('list', { name: '채팅 메시지' }).getByRole('listitem').filter({ has: page.getByText(text, { exact: true }) })
}

test.describe('AC-MOB1-21 "전체 기록 파일 (옮기기·보관용)"', () => {
  test('설정 "전체 기록 내려받기"의 첫 버튼 이름 — 같은 경로·같은 파일 이름, 이 화면 어디에도 "JSON"이 없다', async ({ page, browser }) => {
    await page.goto('/')
    for (const viewport of [PHONE, PC]) {
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: viewport === PHONE })
      try {
        await dev.goto('/settings')
        const section = dev.getByRole('region', { name: '전체 기록 내려받기', exact: true })
        await expect(section.getByRole('button').first()).toHaveAccessibleName('전체 기록 파일 (옮기기·보관용)')
        await expect(section.getByRole('button', { name: '전체 기록(JSON)' })).toHaveCount(0)
        const asked = dev.waitForRequest((r) => new URL(r.url()).pathname === '/api/export/records.json.gz')
        const [file] = await Promise.all([dev.waitForEvent('download'), section.getByRole('button', { name: '전체 기록 파일 (옮기기·보관용)', exact: true }).click()])
        await asked
        expect(file.suggestedFilename()).toMatch(/^라이브지니-전체기록-\d{4}-\d{2}-\d{2}\.json\.gz$/)
        expect(await dev.evaluate(() => document.body.innerText), `${String(viewport.width)} 설정 화면`).not.toContain('JSON')
        await expectNoDevWords(dev, `설정 ${String(viewport.width)}`)
      } finally {
        await context.close()
      }
    }
  })
})

test.describe('AC-MOB1-22 PC "찜으로 바꾸기" 44px', () => {
  test('1440×900 콘솔: 보이는 "찜으로 바꾸기" 높이 ≥ 44px — 언급 20개 중 8개 이상 채팅 칸에 보인다(AC-S06-62 그대로)', async ({ page, browser }) => {
    await page.goto('/')
    const { page: pc, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      const b = await broadcastApi(pc, uniqueDate(), true)
      await registerApi(pc, b, 15, '핑크프릴', 10000)
      await pc.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(pc.getByLabel('빠른 입력')).toBeVisible()
      const lines = ['15번 예뻐요', '15번 색 너무 이뻐요', '15번 사이즈 어때요?', '15번 실물도 이래요?', '15번 향 좋아요?']
      for (let i = 1; i <= 20; i++) await sendViewerChat(pc, b, `시청자${String(i)}`, lines[i % lines.length]!)
      const list = pc.getByRole('list', { name: '채팅 메시지' })
      await expect(list.getByRole('listitem').filter({ hasText: '시청자20' })).toBeVisible()
      const layout = await list.evaluate((ol) => {
        const box = ol.getBoundingClientRect()
        const top = Math.max(box.top, 0)
        const bottom = Math.min(box.bottom, window.innerHeight)
        const rows = [...ol.querySelectorAll('li')].map((li) => {
          const r = li.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom, height: r.height, visible: r.top >= top - 1 && r.bottom <= bottom + 1 }
        })
        const blocks = ['.console-head', '.console-sticky', '.console-grid', '.chat'].map((selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect()
          return { selector, top: r?.top, bottom: r?.bottom, height: r?.height }
        })
        return { visible: rows.filter((row) => row.visible).length, viewport: window.innerHeight, list: { top, bottom, height: box.height }, blocks, rows }
      })
      await test.info().attach('chat-geometry.json', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' })
      expect(layout.visible, '채팅 칸에 보이는 언급').toBeGreaterThanOrEqual(8)
      const buttons = await list.getByRole('button', { name: '찜으로 바꾸기' }).all()
      expect(buttons.length).toBeGreaterThan(0)
      for (const button of buttons) {
        if (!(await button.isVisible())) continue
        expect((await button.boundingBox())!.height, '찜으로 바꾸기 높이').toBeGreaterThanOrEqual(44)
      }
    } finally {
      await context.close()
    }
  })

  test('1440×900 옵션 방송: "확인 필요에서 고르기" 높이 ≥ 44px', async ({ page, browser }) => {
    await page.goto('/')
    const { page: pc, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      const { createBroadcast } = await import('../o2/support.ts')
      const made = await createBroadcast(pc, { rehearsal: true, saleMode: 'OPTIONS' })
      await pc.goto(`/broadcasts/${encodeURIComponent(made.b)}`)
      await expect(pc.getByLabel('빠른 입력')).toBeVisible()
      await registerOptions(pc, made.b, { no: 21, name: '반바지', price: 15000, options: SIZES })
      await chat(pc, made.b, '김철수', '반바지')
      const review = chatRow(pc, '반바지')
      await expect(review).toContainText('확인 필요 · 옵션 빠짐')
      const button = review.getByRole('button', { name: '확인 필요에서 고르기' })
      await expect(button).toBeVisible()
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    } finally {
      await context.close()
    }
  })
})

test.describe('AC-MOB1-23 받은 시각 칸 예시 없음', () => {
  test('문자찜 입력 "받은 시각" 칸에 placeholder가 없다 — 아래 안내·틀렸을 때 문장은 그대로', async ({ page, browser }) => {
    await page.goto('/')
    for (const viewport of [PHONE, PC]) {
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: viewport === PHONE })
      try {
        const title = `받은시각${String(viewport.width)}`
        await broadcastApi(dev, uniqueDate(), false, title)
        // 방송이 하나뿐인 새 판매자 — 문자찜 입력 화면이 그 방송을 고른다
        await dev.goto('/sms')
        await expect(dev.getByRole('region', { name: '고른 방송' })).toContainText(title)
        await expect(smsField(dev, '번호')).toBeVisible()
        const field = smsField(dev, '받은 시각')
        await expect(field).toHaveValue('')
        expect(await field.getAttribute('placeholder'), `${String(viewport.width)} placeholder`).toBeNull()
        await expect(dev.getByText('비우면 지금 시각(초까지)으로 넣어요')).toBeVisible()
        await field.fill('25:00')
        await expect(dev.getByText('받은 시각을 20:01처럼 적어 주세요.')).toBeVisible()
      } finally {
        await context.close()
      }
    }
  })
})

test.describe('AC-MOB1-26 포장 라벨 출력 자리', () => {
  for (const [label, viewport] of [['375×812', PHONE], ['412×915', ANDROID]] as const) {
    test(`${label} 포장 모드 구매자 한 명(품목 1개), 처음 연 상태: "포장 라벨 출력" 전체가 화면 안·아래 막대보다 위, 제목 바로 아래·그림 위, 결과 문장은 버튼 바로 아래`, async ({ page, browser }) => {
      await page.goto('/')
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: true })
      try {
        await setLabelsApi(dev, true)
        const date = uniqueDate()
        const b = await broadcastApi(dev, date)
        await registerApi(dev, b, 1, '품종1', 1000)
        await smsApi(dev, { b, no: 1, phone: '010-6100-0001' })
        const view = (await (await dev.request.get(`/api/days/${date}`)).json()) as { claims: { no: number; currentBuyer: string }[] }
        const buyer = view.claims.find((c) => c.no === 1)!.currentBuyer
        await dev.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
        const section = dev.getByRole('region', { name: '포장 라벨' })
        const heading = section.getByRole('heading', { name: '포장 라벨' })
        const print = section.getByRole('button', { name: '포장 라벨 출력', exact: true })
        const img = section.getByRole('img', { name: '포장 라벨 1/1쪽' })
        await expect(img).toBeVisible()
        await expect(print).toBeVisible()
        // 처음 연 상태(내리지 않음)
        expect(await dev.evaluate(() => window.scrollY)).toBe(0)
        const pb = (await print.boundingBox())!
        const bar = (await menu(dev).boundingBox())!
        expect(pb.y, '버튼 위 끝이 화면 안').toBeGreaterThanOrEqual(0)
        expect(pb.x).toBeGreaterThanOrEqual(0)
        expect(pb.x + pb.width).toBeLessThanOrEqual(viewport.width + 0.5)
        expect(pb.y + pb.height, '버튼 아래 끝 ≤ 아래 막대 위 끝').toBeLessThanOrEqual(bar.y + 0.5)
        // 제목 바로 아래 · 그림 위
        const hb = (await heading.boundingBox())!
        const ib = (await img.boundingBox())!
        expect(hb.y + hb.height).toBeLessThanOrEqual(pb.y + 0.5)
        expect(pb.y + pb.height).toBeLessThanOrEqual(ib.y + 0.5)
        const between = await heading.evaluate((h, button) => {
          // 제목과 버튼 사이에 다른 글·버튼이 없다 (문서 순서로 제목 다음의 첫 보이는 요소가 버튼 줄)
          const all = [...(h.parentElement?.children ?? [])]
          const at = all.indexOf(h)
          const next = all[at + 1]
          return next !== undefined && button !== null && next.contains(button)
        }, await print.elementHandle())
        expect(between, '"포장 라벨" 제목 바로 다음 줄이 버튼').toBe(true)
        // "그림 저장"·"라벨 PDF"는 그림 아래 그대로
        for (const name of ['그림 저장', '라벨 PDF']) {
          const box = (await section.getByRole('button', { name, exact: true }).first().boundingBox())!
          expect(box.y, `${name}은 그림 아래`).toBeGreaterThanOrEqual(ib.y + ib.height - 0.5)
        }
        // 결과 문장은 버튼 바로 아래
        await print.click()
        const done = section.getByRole('status').filter({ hasText: '포장 라벨 1장 출력을 접수했어요.' })
        await expect(done).toBeVisible()
        const db = (await done.boundingBox())!
        const pb2 = (await print.boundingBox())!
        expect(db.y).toBeGreaterThanOrEqual(pb2.y + pb2.height - 0.5)
        const ib2 = (await img.boundingBox())!
        expect(db.y + db.height, '결과 문장은 그림 위').toBeLessThanOrEqual(ib2.y + 0.5)
      } finally {
        await context.close()
      }
    })
  }
})
