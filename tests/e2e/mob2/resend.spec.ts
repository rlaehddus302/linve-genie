// MOB2 F. 연결이 돌아오면 다시 보내기 (AC-MOB2-40~44·47, D-MOB2-07, UX-06) — test-e2e.
// "끊김" = context.setOffline(true)(쓰기 요청이 네트워크 실패 + 실시간 연결 끊김). "돌아옴" = setOffline(false) 뒤 "실시간 연결이 끊겼어요" 안내가 사라짐.
// 보낸 쓰기는 브라우저 요청 사건(request)으로 모은다 — 끊김 중 실패한 것도 사건은 생긴다. 요청 번호(requestId)는 본문에서 읽는다.
import { expect, test, type Browser, type Page, type Request, type Route } from '@playwright/test'
import { boardItem, day, history, uniqueDate } from '../s05/support.ts'
import { smsApi, smsField, writeEvent } from '../s06/support.ts'
import { PC, PHONE, broadcastApi, freshSeller } from '../mob1/support.ts'
import { AUTO_RESEND_NOTE, LOST_NOTICE, PRESS_RESEND, RESENT_PREFIX, autoFailedLine, blockWrites, droppedOptions, existsOnResend, isWrite, manualFailedLine, openSmsSole, otherDevice, vacatedEmpty } from './support.ts'

interface Sent {
  readonly requestId: string
  readonly type: string
  readonly no: number | null
  readonly at: number
  done: number | null
  /** 응답 본문 (실패·끊김이면 null) — `changed`·`seq` (D-MOB2-14) */
  reply: Record<string, unknown> | null
}

/** 이 화면의 쓰기 요청을 모은다 (응답·실패 시각도) */
function watchWrites(page: Page): Sent[] {
  const list: Sent[] = []
  const byReq = new Map<Request, Sent>()
  page.on('request', (r) => {
    if (!isWrite(r)) return
    let body: Record<string, unknown>
    try {
      body = JSON.parse(r.postData() ?? '{}') as Record<string, unknown>
    } catch {
      body = {}
    }
    const item: Sent = { requestId: String(body['requestId']), type: String(body['type']), no: typeof body['no'] === 'number' ? body['no'] : null, at: Date.now(), done: null, reply: null }
    list.push(item)
    byReq.set(r, item)
  })
  const finish = (r: Request) => {
    const item = byReq.get(r)
    if (item !== undefined) item.done = Date.now()
  }
  page.on('requestfinished', (r) => {
    finish(r)
    const item = byReq.get(r)
    if (item === undefined) return
    void r
      .response()
      .then(async (res) => {
        if (res !== null) item.reply = (await res.json()) as Record<string, unknown>
      })
      .catch(() => undefined)
  })
  page.on('requestfailed', finish)
  return list
}

async function seller(browser: Browser, baseURL: string, viewport: { width: number; height: number }): Promise<{ page: Page; close: () => Promise<void> }> {
  const { page, context } = await freshSeller(browser, baseURL, { viewport, touch: viewport.width < 768 })
  return { page, close: () => context.close() }
}

async function goOffline(page: Page): Promise<void> {
  await page.context().setOffline(true)
  await expect(page.getByText(LOST_NOTICE)).toBeVisible({ timeout: 20_000 })
}

/** 돌아옴: 끊김 안내가 사라진 시각 */
async function comeBack(page: Page): Promise<number> {
  await page.context().setOffline(false)
  await expect(page.getByText(LOST_NOTICE)).toHaveCount(0, { timeout: 20_000 })
  return Date.now()
}

const bar = (page: Page) => page.getByRole('region', { name: '보내기 전 조치' })

/** 저절로 다시 보낼 빠른 입력 실패: "저장하지 못했어요: {줄}" + 새 안내, "다시 보내기를 눌러 주세요"는 없다 (D-MOB2-16 (2), AC-MOB2-40) */
async function expectAutoFailed(page: Page, line: string): Promise<void> {
  await expect(page.getByText(autoFailedLine(line), { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(AUTO_RESEND_NOTE, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(PRESS_RESEND)).toHaveCount(0)
}

async function openConsole(page: Page, b: string): Promise<void> {
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
}

for (const [label, viewport] of [['375×812', PHONE], ['1440×900', PC]] as const) {
  test.describe(`AC-MOB2-40${viewport === PC ? '·47' : ''} 빠른 입력 등록 — ${label}`, () => {
    test('끊김 중 "15 핑크프릴 10000" 실패 → 안내 두 줄 → 돌아오면 누르지 않아도 5초 안에 같은 요청 번호로 한 번, "연결이 돌아와 보냈어요: 15번을 등록했어요"', async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, viewport)
      try {
        const date = uniqueDate()
        const b = await broadcastApi(s.page, date, false)
        await openConsole(s.page, b)
        const sent = watchWrites(s.page)
        await goOffline(s.page)
        const input = s.page.getByLabel('빠른 입력')
        await input.fill('15 핑크프릴 10000')
        await input.press('Enter')
        await expectAutoFailed(s.page, '15 핑크프릴 10000')
        const first = sent.filter((x) => x.type === 'product.register')
        expect(first.length, '끊김 중 보낸 등록 요청').toBeGreaterThan(0)
        const id = first[0]!.requestId
        expect(new Set(first.map((x) => x.requestId)), '끊김 중 재시도도 같은 요청 번호').toEqual(new Set([id]))
        const before = sent.length
        const back = await comeBack(s.page)
        await expect(boardItem(s.page, 15)).toBeVisible({ timeout: 5_000 })
        expect(Date.now() - back, '돌아온 뒤 5초 안').toBeLessThanOrEqual(5_500)
        const after = sent.slice(before).filter((x) => x.type === 'product.register')
        expect(after.map((x) => x.requestId), '돌아온 뒤 등록 요청 — 처음 요청 번호 그대로 한 번').toEqual([id])
        await expect(bar(s.page).getByRole('status').filter({ hasText: '15번을 등록했어요' })).toHaveText(`${RESENT_PREFIX}15번을 등록했어요`)
        await expect(bar(s.page).getByRole('button', { name: '15번 등록 되돌리기' })).toBeVisible()
        await expect(s.page.getByText(autoFailedLine('15 핑크프릴 10000'), { exact: true }), '실패 줄은 사라진다').toHaveCount(0)
        expect((await history(s.page, date, false)).filter((e) => e.type === 'product.register')).toHaveLength(1)
      } finally {
        await s.close()
      }
    })
  })
}

test.describe('AC-MOB2-40 두 줄 차례', () => {
  test('끊김 중 15·16 두 줄 실패 → 돌아오면 15 → 16 하나씩(16 요청은 15 응답 뒤), 각각 한 번', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, false)
      await openConsole(s.page, b)
      const sent = watchWrites(s.page)
      await goOffline(s.page)
      const input = s.page.getByLabel('빠른 입력')
      await input.fill('15 핑크프릴 10000')
      await input.press('Enter')
      await expectAutoFailed(s.page, '15 핑크프릴 10000')
      await input.fill('16 청보석 20000')
      await input.press('Enter')
      await expectAutoFailed(s.page, '16 청보석 20000')
      const id15 = sent.find((x) => x.no === 15)!.requestId
      const id16 = sent.find((x) => x.no === 16)!.requestId
      const before = sent.length
      await comeBack(s.page)
      await expect(boardItem(s.page, 15)).toBeVisible({ timeout: 10_000 })
      await expect(boardItem(s.page, 16)).toBeVisible({ timeout: 10_000 })
      const after = sent.slice(before).filter((x) => x.type === 'product.register')
      expect(after.map((x) => x.requestId), '15 → 16 각 한 번, 처음 요청 번호').toEqual([id15, id16])
      expect(after[0]!.done, '15 응답').not.toBeNull()
      expect(after[1]!.at, '16 요청은 15 응답 뒤').toBeGreaterThanOrEqual(after[0]!.done!)
      expect((await history(s.page, date, false)).filter((e) => e.type === 'product.register')).toHaveLength(2)
    } finally {
      await s.close()
    }
  })
})

/** 빠른 입력 줄에 옵션(사이즈 S·M)을 붙인다 (o2/round1.spec.ts와 같은 조작) */
async function attachSizes(page: Page): Promise<void> {
  await page.getByRole('button', { name: '옵션 추가' }).click()
  const dlg = page.getByRole('dialog', { name: '옵션 추가' })
  await dlg.getByRole('button', { name: '항목 더하기' }).click()
  await dlg.getByLabel('항목 1 이름').fill('사이즈')
  await dlg.getByLabel('항목 1 선택지 여러 개').fill('S, M')
  await dlg.getByRole('button', { name: '항목 1 선택지 한 번에 더하기' }).click()
  await dlg.getByRole('button', { name: '옵션 넣기' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByRole('group', { name: '붙은 옵션' })).toContainText('사이즈 S/M')
}

// D-MOB2-14 (SA-MOB2-03·TE-MOB2-006·RA-MOB2-06, D-MOB2-10의 "요청 0"을 대신함): 저절로 다시 보내는 등록은 화면을 미리 보지 않고
// 처음 요청 번호로 한 번 보내 서버 답으로 정한다. changed:false면 "고칠까요?" 창 없이 한 줄 안내(+ 옵션을 넣지 않았다는 안내), changed:true면 평소 성공.

/** 옵션 방송이면 리허설 OPTIONS 방송을 다른 기기(API)로 만든다 — 이 화면과 같은 계정 */
async function makeBroadcast(other: Awaited<ReturnType<typeof otherDevice>>, withOptions: boolean): Promise<{ b: string; date: string }> {
  const date = uniqueDate()
  const made = await other.post('/api/broadcasts', { date, rehearsal: withOptions, ...(withOptions ? { saleMode: 'OPTIONS' } : {}) })
  expect(made.status, JSON.stringify(made.body)).toBeLessThan(300)
  const b = String((made.body['broadcast'] as Record<string, unknown> | undefined)?.['id'] ?? (made.body['result'] as Record<string, unknown> | undefined)?.['b'] ?? made.body['b'] ?? made.body['id'])
  return { b, date }
}

const fixDialog = (page: Page) => page.getByRole('dialog', { name: /고칠까요/ })

/**
 * 다른 기기 등록이 이 화면에 오는 순서 (AC-MOB2-40 "뒤·앞 둘 다")
 * - 앞: 쓰기만 막혀 실패하고 실시간 연결은 살아 있어, 다른 기기의 15번이 다시 이어지기 **전**에 이 화면에 보인다. 그 뒤 끊겼다 돌아옴
 * - 뒤: 끊긴 동안 다른 기기가 등록 → 돌아온 뒤 따라잡기로 안다. 저절로 보낸 등록은 따라잡기로 15번 "청보석"이 보일 때까지 붙잡았다가 보낸다
 *   (응답이 따라잡기 뒤에 온다 — 화면이 이미 15번을 아는 채로 서버 답을 받는 길)
 * - 뒤·바로: 같은 끊김, 붙잡지 않음(저절로 보낸 등록의 응답이 따라잡기보다 먼저 올 수 있는 실제 순서 — 지난 TE-MOB2-006 재현)
 */
const ORDERS = ['앞', '뒤', '뒤·바로'] as const
for (const order of ORDERS) {
  for (const withOptions of [false, true]) {
    if (order === '뒤·바로' && withOptions) continue
    test(`TE-MOB2-006 · AC-MOB2-40 이미 있는 번호 — 다른 기기 등록이 다시 이어진 ${order}${withOptions ? ' (옵션 방송 · 붙인 옵션 줄)' : ''}: 등록 요청 1(처음 요청 번호)·응답 changed:false, 실패 줄 사라짐, "연결이 돌아와 보내려 했지만 15번이 이미 있어 등록하지 않았어요."${withOptions ? '·옵션을 넣지 않았다는 안내' : ''}, "고칠까요?" 창 없음, 15번 청보석 20,000원 그대로, 칸·옵션 되살리지 않음`, async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, PHONE)
      const other = await otherDevice(s.page, baseURL!)
      try {
        const { b, date } = await makeBroadcast(other, withOptions)
        await openConsole(s.page, b)
        const sent = watchWrites(s.page)
        const block = order === '앞' ? await blockWrites(s.page) : null
        if (order !== '앞') await goOffline(s.page)
        const input = s.page.getByLabel('빠른 입력')
        await input.fill('15 핑크프릴 10000')
        if (withOptions) await attachSizes(s.page)
        await input.press('Enter')
        await expectAutoFailed(s.page, '15 핑크프릴 10000')
        const first = sent.filter((x) => x.type === 'product.register')
        expect(first.length, '실패한 등록 요청').toBeGreaterThan(0)
        const id = first[0]!.requestId
        // 다른 기기에서 15번 등록
        const reg = await other.post('/api/events', { type: 'product.register', b, no: 15, name: '청보석', price: 20000 })
        expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
        if (order === '앞') {
          // 실시간 연결로 다시 이어지기 전에 이 화면이 안다
          await expect(boardItem(s.page, 15)).toContainText('청보석')
          await goOffline(s.page)
          await block!.release()
        }
        let open: () => void = () => undefined
        if (order === '뒤') {
          const gate = new Promise<void>((resolve) => {
            open = resolve
          })
          await s.page.route('**/api/events**', async (route) => {
            if (route.request().method() === 'POST') await gate
            await route.fallback()
          })
        }
        // 돌아오기 직전 판매자의 줄 (실패 중에도 친 줄은 칸에 남는다 — 성공해야 비운다)
        const typed = await input.inputValue()
        const before = sent.length
        await comeBack(s.page)
        if (order === '뒤') {
          await expect(boardItem(s.page, 15), '따라잡기로 다른 기기의 15번이 보인다').toContainText('청보석', { timeout: 10_000 })
          await expect.poll(() => sent.slice(before).filter((x) => x.type === 'product.register').length, { message: '저절로 보낸 등록 (붙잡는 중)' }).toBe(1)
          open()
        }
        await expect(s.page.getByRole('status').filter({ hasText: existsOnResend(15) })).toHaveText(existsOnResend(15), { timeout: 10_000 })
        if (withOptions) await expect(s.page.getByRole('status').filter({ hasText: droppedOptions(15) })).toBeVisible()
        else await expect(s.page.getByText(/붙인 옵션은/)).toHaveCount(0)
        await expect(s.page.getByText(autoFailedLine('15 핑크프릴 10000'), { exact: true }), '실패 줄 사라짐').toHaveCount(0)
        await expect(fixDialog(s.page), '"고칠까요?" 창 없음').toHaveCount(0)
        // 등록 요청은 처음 요청 번호로 한 번, 서버 답 changed:false
        const after = sent.slice(before).filter((x) => x.type === 'product.register')
        expect(after.map((x) => x.requestId), '돌아온 뒤 등록 요청 — 처음 요청 번호로 한 번').toEqual([id])
        await expect.poll(() => after[0]!.reply?.['changed'], { message: '저절로 보낸 등록의 응답 changed' }).toBe(false)
        // 15번은 다른 기기 것 그대로
        await expect(boardItem(s.page, 15)).toContainText('청보석')
        await expect(boardItem(s.page, 15)).toContainText('20,000')
        await expect(boardItem(s.page, 15)).not.toContainText('핑크프릴')
        // 판매자가 지금 치는 줄은 건드리지 않는다 (칸은 돌아오기 직전 그대로, 붙인 옵션은 되살리지 않음)
        await expect(input).toHaveValue(typed)
        await expect(s.page.getByRole('group', { name: '붙은 옵션' })).toHaveCount(0)
        // 더 나가지 않고 창도 끝까지 없음
        await expect.poll(() => sent.slice(before).filter((x) => x.type === 'product.register').length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(1)
        await expect(fixDialog(s.page)).toHaveCount(0)
        // 입력 우선 기록(절대 규칙 3): 이 화면이 처음 요청 번호로 한 번 보낸 등록도 사건으로 남지만 바꾼 것이 없다(changed:false) — 사건은 다른 기기 것 + 이 화면 것 하나
        const regs = (await history(s.page, date, withOptions)).filter((e) => e.type === 'product.register')
        expect(regs.map((e) => [e.fields['no'], e.fields['name'], e.fields['price']]), '등록 사건: 다른 기기의 청보석 다음 이 화면의 줄 하나(두 번 기록 없음)').toEqual([
          [15, '청보석', 20000],
          [15, '핑크프릴', 10000],
        ])
        expect(regs[1]!.seq, '이 화면 사건 = 저절로 보낸 등록의 응답 seq').toBe(after[0]!.reply?.['seq'])
        // 상품은 다른 기기의 15번 그대로 (이름·가격·옵션 없음)
        const view = (await day(s.page, date, withOptions)) as { products: { no: number; name: string; price: number; options?: unknown }[] }
        const fifteen = view.products.filter((x) => x.no === 15)
        expect(fifteen.map((x) => [x.name, x.price]), '15번 상품은 청보석 20,000원 그대로 하나').toEqual([['청보석', 20000]])
        expect(fifteen[0]!.options, '15번에 옵션이 붙지 않음').toEqual([])
      } finally {
        await other.dispose()
        await s.close()
      }
    })
  }
}

test('AC-MOB2-40 이미 있는 번호 — 판매자가 "다시 보내기"를 직접 누르면 지금처럼 "15번이 이미 있어요. 고칠까요?"', async ({ browser, baseURL }) => {
  const s = await seller(browser, baseURL!, PHONE)
  const other = await otherDevice(s.page, baseURL!)
  try {
    const { b } = await makeBroadcast(other, false)
    await openConsole(s.page, b)
    await goOffline(s.page)
    const input = s.page.getByLabel('빠른 입력')
    await input.fill('15 핑크프릴 10000')
    await input.press('Enter')
    await expectAutoFailed(s.page, '15 핑크프릴 10000')
    const reg = await other.post('/api/events', { type: 'product.register', b, no: 15, name: '청보석', price: 20000 })
    expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
    // 돌아올 때 쓰기를 막아 저절로 보낸 것이 다시 실패하게 → 막기를 풀고 직접 "다시 보내기"
    const block = await blockWrites(s.page)
    await s.page.context().setOffline(false)
    await expect(s.page.getByText(LOST_NOTICE)).toHaveCount(0, { timeout: 20_000 })
    await expect.poll(() => block.blocked(), { timeout: 30_000, message: '저절로 보낸 등록(막힘)' }).toBeGreaterThan(0)
    await expectAutoFailed(s.page, '15 핑크프릴 10000')
    await expect(boardItem(s.page, 15)).toContainText('청보석')
    await block.release()
    await s.page.getByRole('button', { name: '다시 보내기' }).first().click()
    await expect(s.page.getByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })).toBeVisible({ timeout: 10_000 })
  } finally {
    await other.dispose()
    await s.close()
  }
})

// D-MOB2-14 (RA-MOB2-06): 서버는 기록했지만 응답만 잃은 자기 등록 — 같은 요청 번호로 한 번 보내 처음 결과(같은 seq, changed:true)를 받고 평소 성공과 같다
for (const withOptions of [false, true]) {
  test(`RA-MOB2-06 · AC-MOB2-40 응답만 잃은 등록${withOptions ? ' (옵션 방송 · 붙인 옵션 줄)' : ''}: 돌아오면 처음 요청 번호로 한 번, 서버는 처음 결과(같은 seq·changed:true), "연결이 돌아와 보냈어요: 15번을 등록했어요"·되돌리기, "이미 있어"·옵션 안내 없음, 상품 기록 하나`, async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    const other = await otherDevice(s.page, baseURL!)
    try {
      const { b, date } = await makeBroadcast(other, withOptions)
      await openConsole(s.page, b)
      const sent = watchWrites(s.page)
      // 처음 등록 요청은 서버에 닿게 하고(기록됨) 응답만 끊는다. 화면 쪽 재시도는 닿지 않게 끊는다
      const lost: { reply: Record<string, unknown> | null } = { reply: null }
      const lose = async (route: Route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        if (lost.reply === null) {
          const res = await route.fetch()
          lost.reply = (await res.json()) as Record<string, unknown>
        }
        await route.abort('internetdisconnected')
      }
      await s.page.route('**/api/events**', lose)
      const input = s.page.getByLabel('빠른 입력')
      await input.fill('15 핑크프릴 10000')
      if (withOptions) await attachSizes(s.page)
      await input.press('Enter')
      await expectAutoFailed(s.page, '15 핑크프릴 10000')
      const firstReply = lost.reply
      expect(firstReply, '처음 요청은 서버에 닿아 기록됨').not.toBeNull()
      expect(firstReply!['changed'], JSON.stringify(firstReply)).toBe(true)
      const id = sent.filter((x) => x.type === 'product.register')[0]!.requestId
      await goOffline(s.page)
      await s.page.unroute('**/api/events**', lose)
      const before = sent.length
      await comeBack(s.page)
      // 따라잡기로 자기 15번 "핑크프릴"이 보인다 (실시간 알림으로 이미 보였을 수도 있다)
      await expect(boardItem(s.page, 15)).toContainText('핑크프릴', { timeout: 10_000 })
      await expect(bar(s.page).getByRole('status').filter({ hasText: '15번을 등록했어요' })).toHaveText(`${RESENT_PREFIX}15번을 등록했어요`, { timeout: 10_000 })
      await expect(bar(s.page).getByRole('button', { name: '15번 등록 되돌리기' })).toBeVisible()
      await expect(s.page.getByText(/이미 있어 등록하지 않았어요/)).toHaveCount(0)
      await expect(s.page.getByText(/붙인 옵션은/)).toHaveCount(0)
      await expect(fixDialog(s.page)).toHaveCount(0)
      await expect(s.page.getByText(autoFailedLine('15 핑크프릴 10000'), { exact: true })).toHaveCount(0)
      const after = sent.slice(before).filter((x) => x.type === 'product.register')
      expect(after.map((x) => x.requestId), '처음 요청 번호로 한 번').toEqual([id])
      await expect.poll(() => after[0]!.reply?.['seq'], { message: '처음 결과와 같은 seq' }).toBe(firstReply!['seq'])
      expect(after[0]!.reply?.['changed']).toBe(true)
      const regs = (await history(s.page, date, withOptions)).filter((e) => e.type === 'product.register')
      expect(regs, '상품 기록 하나').toHaveLength(1)
      expect([regs[0]!.fields['no'], regs[0]!.fields['name'], regs[0]!.fields['price']]).toEqual([15, '핑크프릴', 10000])
      if (withOptions) expect(regs[0]!.fields['options'], '옵션도 보낸 그대로').toBeTruthy()
      else expect(regs[0]!.fields['options']).toBeUndefined()
    } finally {
      await other.dispose()
      await s.close()
    }
  })
}

/** 실제 방송 · 15번 핑크프릴(재고 1) · 1등 문자찜(메모 "가나") */
async function winnerWorld(page: Page): Promise<{ b: string; date: string }> {
  const date = uniqueDate()
  const b = await broadcastApi(page, date, false)
  const reg = await writeEvent(page, { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000 })
  expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
  await smsApi(page, { b, no: 15, memo: '가나' })
  await openConsole(page, b)
  await expect(boardItem(page, 15)).toContainText('문자찜(가나)')
  return { b, date }
}

/** 상품 자세히 → 1등 "찜 취소하기" → 사유 (보내기는 대기 뒤) */
async function queueWinnerCancel(page: Page): Promise<void> {
  await boardItem(page, 15).click()
  const detail = page.getByRole('dialog', { name: '15번 자세히' })
  await detail.locator('li.claim-row').filter({ hasText: '문자찜(가나)' }).getByRole('button', { name: '찜 취소하기' }).click()
  const dlg = page.getByRole('dialog', { name: '15번 문자찜(가나) 취소' })
  await dlg.getByLabel('사유').fill('시청자 요청')
  await dlg.getByLabel('사유').press('Enter')
  await expect(bar(page)).toContainText(/초 뒤 보내요: 15번 문자찜\(가나\) 취소/)
}

for (const [label, viewport] of [['375×812', PHONE], ['1440×900', PC]] as const) {
  test.describe(`AC-MOB2-41${viewport === PC ? '·47' : ''} 방송자 조치 — ${label}`, () => {
    test('끊김 중 1등 찜 취소 → 대기 뒤 보냄 실패 + 안내 → 돌아오면 같은 요청 번호로 한 번, 결과 줄 "15번 1등 자리가 비었어요 · 대기 없음 · 판매 중"', async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, viewport)
      try {
        const { date } = await winnerWorld(s.page)
        const sent = watchWrites(s.page)
        await queueWinnerCancel(s.page)
        await goOffline(s.page)
        const failed = bar(s.page).getByRole('alert')
        await expect(failed).toContainText('15번 문자찜(가나) 취소 — 저장하지 못했어요.', { timeout: 20_000 })
        await expect(failed).toContainText(AUTO_RESEND_NOTE)
        const cancels = sent.filter((x) => x.type === 'host.cancel')
        expect(cancels.length).toBeGreaterThan(0)
        const id = cancels[0]!.requestId
        const before = sent.length
        await comeBack(s.page)
        await expect(bar(s.page).getByRole('status').filter({ hasText: '1등 자리가' })).toHaveText(vacatedEmpty('15번', '판매 중'), { timeout: 10_000 })
        expect(sent.slice(before).filter((x) => x.type === 'host.cancel').map((x) => x.requestId)).toEqual([id])
        expect((await history(s.page, date, false)).filter((e) => e.type === 'host.cancel')).toHaveLength(1)
      } finally {
        await s.close()
      }
    })
  })
}

test.describe('AC-MOB2-41 보내지 않는 경우·다른 기기', () => {
  test('실패 줄에서 "확인"으로 닫음 → 돌아와도 보내지 않는다(요청 0)', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const { date } = await winnerWorld(s.page)
      const sent = watchWrites(s.page)
      await queueWinnerCancel(s.page)
      await goOffline(s.page)
      await expect(bar(s.page).getByRole('alert')).toContainText('저장하지 못했어요', { timeout: 20_000 })
      await bar(s.page).getByRole('button', { name: '확인', exact: true }).click()
      await expect(bar(s.page).getByRole('alert')).toHaveCount(0)
      const before = sent.length
      await comeBack(s.page)
      // 돌아온 뒤 화면이 따라잡을 때까지 (보드는 그대로 1등)
      await expect(boardItem(s.page, 15)).toContainText('문자찜(가나)')
      await expect.poll(() => sent.slice(before).filter((x) => x.type === 'host.cancel').length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
      expect((await history(s.page, date, false)).filter((e) => e.type === 'host.cancel')).toHaveLength(0)
    } finally {
      await s.close()
    }
  })

  test('5초 안에 "되돌리기" → 보내지 않음, 끊겼다 돌아와도 보내지 않음', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const { date } = await winnerWorld(s.page)
      const sent = watchWrites(s.page)
      await queueWinnerCancel(s.page)
      await bar(s.page).getByRole('button', { name: '15번 문자찜(가나) 취소 되돌리기' }).click()
      await expect(bar(s.page)).toContainText('보내지 않았어요')
      await goOffline(s.page)
      await comeBack(s.page)
      await expect(boardItem(s.page, 15)).toContainText('문자찜(가나)')
      await expect.poll(() => sent.filter((x) => x.type === 'host.cancel').length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
      expect((await history(s.page, date, false)).filter((e) => e.type === 'host.cancel')).toHaveLength(0)
    } finally {
      await s.close()
    }
  })

  test('그사이 다른 기기(API)에서 같은 찜을 이미 취소 → 돌아와 보낸 결과 "적용되지 않았어요. 지금 상태를 확인해 주세요."', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const { b } = await winnerWorld(s.page)
      await queueWinnerCancel(s.page)
      await goOffline(s.page)
      await expect(bar(s.page).getByRole('alert')).toContainText('저장하지 못했어요', { timeout: 20_000 })
      // 다른 기기 (같은 계정·다른 연결 — 이 화면의 오프라인과 상관없는 요청 컨텍스트)
      const api = await s.page.context().browser()!.newContext({ baseURL: baseURL! })
      try {
        const state = await s.page.context().storageState()
        await api.addCookies(state.cookies)
        const other = await api.newPage()
        const day = (await (await other.request.get(`/api/days/${(await (await other.request.get('/api/broadcasts')).json() as { broadcasts: { id: string; date: string }[] }).broadcasts.find((x) => x.id === b)!.date}`)).json()) as { claims: { no: number; buyer: string; currentBuyer?: string; status: string }[] }
        const winner = day.claims.find((c) => c.no === 15 && c.status === 'CONFIRMED')!
        const res = await other.request.post('/api/events', { data: { requestId: crypto.randomUUID(), type: 'host.cancel', b, no: 15, buyer: winner.currentBuyer ?? winner.buyer, reason: '다른 기기' }, headers: { Origin: baseURL! } })
        expect(res.status(), await res.text()).toBeLessThan(300)
      } finally {
        await api.close()
      }
      await comeBack(s.page)
      await expect(bar(s.page)).toContainText('적용되지 않았어요. 지금 상태를 확인해 주세요.', { timeout: 10_000 })
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-MOB2-42 상품 관리', () => {
  for (const open of [true, false]) {
    test(`끊김 중 "일시 중지" 실패 → 돌아오면 같은 요청 번호로 한 번, 상품 일시 중지 — 창이 ${open ? '열려 있으면 실패 줄이 사라진다' : '닫혀 있으면 상품 카드 상태로'}`, async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, PHONE)
      try {
        const date = uniqueDate()
        const b = await broadcastApi(s.page, date, false)
        const reg = await writeEvent(s.page, { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000 })
        expect(reg.status).toBeLessThan(300)
        await openConsole(s.page, b)
        const sent = watchWrites(s.page)
        await boardItem(s.page, 15).click()
        const detail = s.page.getByRole('dialog', { name: '15번 자세히' })
        const manage = detail.getByRole('region', { name: '상품 관리' })
        await goOffline(s.page)
        await manage.getByRole('button', { name: '일시 중지' }).click()
        await expect(manage.getByText(AUTO_RESEND_NOTE, { exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(manage.getByRole('button', { name: '다시 보내기' })).toBeVisible()
        const holds = sent.filter((x) => x.type === 'product.hold')
        const id = holds[0]!.requestId
        if (!open) {
          await detail.getByRole('button', { name: '닫기' }).first().click()
          await expect(detail).toHaveCount(0)
        }
        const before = sent.length
        await comeBack(s.page)
        await expect(boardItem(s.page, 15)).toContainText('일시 중지', { timeout: 10_000 })
        expect(sent.slice(before).filter((x) => x.type === 'product.hold').map((x) => x.requestId)).toEqual([id])
        if (open) {
          await expect(manage.getByText(AUTO_RESEND_NOTE, { exact: true })).toHaveCount(0)
          await expect(manage.getByRole('button', { name: '다시 보내기' })).toHaveCount(0)
        }
        expect((await history(s.page, date, false)).filter((e) => e.type === 'product.hold')).toHaveLength(1)
      } finally {
        await s.close()
      }
    })
  }
})

test.describe('AC-MOB2-43 문자찜', () => {
  async function smsWorld(page: Page): Promise<{ date: string }> {
    const date = uniqueDate()
    const title = `다시${String(Math.floor(Math.random() * 1e6))}`
    const b = await broadcastApi(page, date, false, title)
    const reg = await writeEvent(page, { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000 })
    expect(reg.status).toBeLessThan(300)
    await openSmsSole(page, title)
    return { date }
  }

  test('끊김 중 "15번에 문자찜 넣기" 실패(칸 그대로) → 칸을 그대로 두고 돌아오면 같은 요청 번호로 한 번, 칸 비움, 결과 카드 앞 "연결이 돌아와 보냈어요: "', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const { date } = await smsWorld(s.page)
      const sent = watchWrites(s.page)
      await smsField(s.page, '번호').fill('15')
      await smsField(s.page, '메모').fill('오프')
      await goOffline(s.page)
      await s.page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
      await expect(s.page.getByText(/저장하지 못했어요/)).toBeVisible({ timeout: 30_000 })
      await expect(s.page.getByText(AUTO_RESEND_NOTE, { exact: true })).toBeVisible()
      await expect(smsField(s.page, '번호')).toHaveValue('15')
      const id = sent.find((x) => x.type === 'sms')!.requestId
      const before = sent.length
      await comeBack(s.page)
      const card = s.page.getByRole('region', { name: '넣은 결과' }).locator('strong').first()
      await expect(card).toHaveText(new RegExp(`^${RESENT_PREFIX}15번 · 문자찜\\(오프\\) · 1등`), { timeout: 10_000 })
      await expect(smsField(s.page, '번호')).toHaveValue('')
      await expect(smsField(s.page, '메모')).toHaveValue('')
      expect(sent.slice(before).filter((x) => x.type === 'sms').map((x) => x.requestId)).toEqual([id])
      expect((await history(s.page, date, false)).filter((e) => e.type === 'sms')).toHaveLength(1)
    } finally {
      await s.close()
    }
  })

  for (const change of ['번호', '메모', '전화번호', '받은 시각'] as const) {
    test(`실패 뒤 "${change}" 칸을 바꿈 → 돌아와도 보내지 않는다(요청 0), 실패 문장·"다시 보내기" 그대로`, async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, PHONE)
      try {
        const { date } = await smsWorld(s.page)
        const sent = watchWrites(s.page)
        await smsField(s.page, '번호').fill('15')
        await smsField(s.page, '메모').fill('오프')
        await goOffline(s.page)
        await s.page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
        await expect(s.page.getByText(/저장하지 못했어요/)).toBeVisible({ timeout: 30_000 })
        const field = smsField(s.page, change)
        await field.fill(change === '번호' ? '16' : change === '메모' ? '바꿈' : change === '전화번호' ? '010-1234-5678' : '20:01')
        const before = sent.length
        await comeBack(s.page)
        await expect.poll(() => sent.slice(before).filter((x) => x.type === 'sms').length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
        await expect(s.page.getByText(/저장하지 못했어요/)).toBeVisible()
        await expect(s.page.getByRole('button', { name: '다시 보내기' })).toBeVisible()
        expect((await history(s.page, date, false)).filter((e) => e.type === 'sms')).toHaveLength(0)
      } finally {
        await s.close()
      }
    })
  }
})

test.describe('AC-MOB2-44 저절로 보내지 않는 실패', () => {
  for (const kind of ['INTERNAL_ERROR', 'STATE_FORMAT'] as const) {
    test(`등록이 ${kind}(500)로 실패 → 실시간 연결이 끊겼다 돌아와도 보내지 않는다, 안내 없음, "다시 보내기"는 그대로`, async ({ browser, baseURL }) => {
      const s = await seller(browser, baseURL!, PHONE)
      try {
        const date = uniqueDate()
        const b = await broadcastApi(s.page, date, false)
        await openConsole(s.page, b)
        const sent = watchWrites(s.page)
        await s.page.route('**/api/events**', async (route) => {
          if (route.request().method() !== 'POST') return route.continue()
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: kind, message: '잠시 뒤 다시 해 주세요.' } }) })
        })
        const input = s.page.getByLabel('빠른 입력')
        await input.fill('15 핑크프릴 10000')
        await input.press('Enter')
        await expect(s.page.getByText(manualFailedLine('15 핑크프릴 10000'), { exact: true })).toBeVisible({ timeout: 20_000 })
        await expect(s.page.getByRole('button', { name: '다시 보내기' })).toBeVisible()
        await expect(s.page.getByText(AUTO_RESEND_NOTE, { exact: true })).toHaveCount(0)
        await s.page.unrouteAll()
        const before = sent.length
        await goOffline(s.page)
        await comeBack(s.page)
        await expect.poll(() => sent.slice(before).length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
        await expect(s.page.getByRole('button', { name: '다시 보내기' })).toBeVisible()
        expect((await history(s.page, date, false)).filter((e) => e.type === 'product.register')).toHaveLength(0)
      } finally {
        await s.close()
      }
    })
  }

  test('입력 거절(400 칸 오류)·409는 다시 보낼 대상이 아니다 — 돌아와도 요청 0', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, false)
      const reg = await writeEvent(s.page, { type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000 })
      expect(reg.status).toBeLessThan(300)
      await openConsole(s.page, b)
      const sent = watchWrites(s.page)
      let status = 409
      await s.page.route('**/api/events**', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: status === 409 ? 'CONFLICT' : 'INVALID_INPUT', message: '받을 수 없어요.', problems: status === 400 ? [{ field: 'name', message: '이름을 적어 주세요.' }] : [] } }) })
      })
      await boardItem(s.page, 15).click()
      const manage = s.page.getByRole('dialog', { name: '15번 자세히' }).getByRole('region', { name: '상품 관리' })
      await manage.getByRole('button', { name: '일시 중지' }).click()
      await expect(manage.getByText('받을 수 없어요.')).toBeVisible({ timeout: 15_000 })
      await expect(manage.getByText(AUTO_RESEND_NOTE, { exact: true })).toHaveCount(0)
      status = 400
      await s.page.unrouteAll()
      const before = sent.length
      await goOffline(s.page)
      await comeBack(s.page)
      await expect.poll(() => sent.slice(before).length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
      expect((await history(s.page, date, false)).filter((e) => e.type === 'product.hold')).toHaveLength(0)
    } finally {
      await s.close()
    }
  })

  test('끊김 중 실패가 남은 채 새로고침 → 돌아와도 보내지 않는다(메모리에만)', async ({ browser, baseURL }) => {
    const s = await seller(browser, baseURL!, PHONE)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.page, date, false)
      await openConsole(s.page, b)
      await goOffline(s.page)
      const input = s.page.getByLabel('빠른 입력')
      await input.fill('15 핑크프릴 10000')
      await input.press('Enter')
      await expectAutoFailed(s.page, '15 핑크프릴 10000')
      // 새로고침은 쓰기가 막힌 채로 한다 — 연결이 먼저 돌아와 새로고침 전에 저절로 보낸 것이 기록되지 않게(그 보내기는 이 시험의 대상이 아니다)
      const block = await blockWrites(s.page)
      await s.page.context().setOffline(false)
      // 떠나기 창(D-103)이 뜨면 떠난다 — 그 창은 지금 그대로
      s.page.once('dialog', (d) => void d.accept())
      await s.page.reload()
      await expect(s.page.getByLabel('빠른 입력')).toBeVisible()
      await block.release()
      const sent = watchWrites(s.page)
      await goOffline(s.page)
      await comeBack(s.page)
      await expect.poll(() => sent.length, { timeout: 6_000, intervals: [500, 1000, 1500, 3000] }).toBe(0)
      expect((await history(s.page, date, false)).filter((e) => e.type === 'product.register')).toHaveLength(0)
    } finally {
      await s.close()
    }
  })
})
