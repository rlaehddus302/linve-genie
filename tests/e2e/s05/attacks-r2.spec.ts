// 수정 라운드 2 다시 공격 (test-e2e): TE-S05-002 수정("고칠까요?" 목록)의 남은 구멍.
// 기대값은 acceptance.md(AC-S05-10·13·42, NFR-08) 문장에서 정했다.
import { test, expect, type Page } from '@playwright/test'
import { boardItem, history, login, newBroadcast, openNewBroadcast, postJson, uniqueDate } from './support.ts'

async function slowWrites(page: Page, ms: number): Promise<void> {
  await page.route('**/api/events**', async (route) => {
    await new Promise((r) => setTimeout(r, ms))
    await route.continue()
  })
}

/** TE-S05-002 재현 줄: 61 등록 → 같은 번호를 다시 친 줄은 늦게 판단되고, 그사이 62·63을 이어 친다 */
async function typeDuplicateThenNext(page: Page): Promise<void> {
  const input = page.getByLabel('빠른 입력')
  for (const line of ['61 꽃 1만', '61 장미 2만', '62 꽃 1만', '63 꽃 1만']) {
    await input.pressSequentially(line, { delay: 40 })
    await input.press('Enter')
  }
  await expect(boardItem(page, 62)).toBeVisible()
  await expect(boardItem(page, 63)).toBeVisible()
  await expect(input).toHaveValue('')
}

const askList = (page: Page) => page.getByRole('list', { name: '고칠까요?' })

test('TE-S05-002 다시: 세 번 반복해도 62·63이 빠지지 않고 61 줄은 "고칠까요?"로 남는다', async ({ page }) => {
  await login(page)
  for (let i = 0; i < 3; i += 1) {
    await page.goto('/')
    const date = uniqueDate()
    await newBroadcast(page, { date })
    await slowWrites(page, 500)
    await typeDuplicateThenNext(page)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(askList(page)).toContainText('61번이 이미 있어요. 고칠까요?')
    await expect(askList(page)).toContainText('61 장미 2만')
    const events = await history(page, date, false)
    expect(events.filter((e) => e.type === 'product.register').map((e) => e.fields['no'])).toEqual([61, 62, 63])
    expect(events.filter((e) => e.type === 'product.update')).toEqual([])
    await page.unroute('**/api/events**')
  }
})

test('AC-S05-13 회귀: 남겨 둔 "고칠까요?"를 빈 칸에서 고치기 → 아니요면 친 줄이 칸에 남고, 다시 Enter → 예면 바뀐 칸만 고친다', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  await newBroadcast(page, { date })
  await slowWrites(page, 500)
  await typeDuplicateThenNext(page)
  const input = page.getByLabel('빠른 입력')
  await page.getByRole('button', { name: '61 장미 2만 고치기' }).click()
  const dlg = page.getByRole('dialog', { name: '61번이 이미 있어요. 고칠까요?' })
  await expect(dlg.getByRole('button', { name: '아니요' })).toBeFocused()
  await expect(dlg).toContainText('장미')
  await dlg.getByRole('button', { name: '아니요' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(input).toHaveValue('61 장미 2만')
  await expect(input).toBeFocused()
  await input.press('Enter')
  await page.getByRole('dialog', { name: '61번이 이미 있어요. 고칠까요?' }).getByRole('button', { name: '예' }).click()
  await expect(boardItem(page, 61)).toContainText('장미')
  await expect(input).toHaveValue('')
  await expect(askList(page)).toHaveCount(0)
  const updates = (await history(page, date, false)).filter((e) => e.type === 'product.update')
  expect(updates).toHaveLength(1)
  expect(updates[0]!.fields).toMatchObject({ no: 61, name: '장미', price: 20000 })
})

test('AC-S05-13 회귀: 다음 줄을 치는 중에 "고칠까요?"를 열어 예 → 고쳐지고 치던 줄은 그대로, "그대로 두기"는 아무것도 보내지 않는다', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  await newBroadcast(page, { date })
  await slowWrites(page, 500)
  await typeDuplicateThenNext(page)
  const input = page.getByLabel('빠른 입력')
  await input.pressSequentially('64 튤립', { delay: 20 })
  await page.getByRole('button', { name: '61 장미 2만 고치기' }).click()
  const dlg = page.getByRole('dialog', { name: '61번이 이미 있어요. 고칠까요?' })
  await dlg.getByRole('button', { name: '예' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(boardItem(page, 61)).toContainText('장미')
  await expect(input).toHaveValue('64 튤립')
  await expect(askList(page)).toHaveCount(0)

  // 다시 같은 번호를 지연 중에 쳐서 남긴 뒤 "그대로 두기"
  await input.fill('')
  for (const line of ['65 꽃 1만', '65 국화 3만', '66 꽃 1만']) {
    await input.pressSequentially(line, { delay: 40 })
    await input.press('Enter')
  }
  await expect(boardItem(page, 66)).toBeVisible()
  await page.getByRole('button', { name: '65 국화 3만 그대로 두기' }).click()
  await expect(askList(page)).toHaveCount(0)
  const events = await history(page, date, false)
  expect(events.filter((e) => e.type === 'product.update').map((e) => e.fields['no'])).toEqual([61])
})

test('NFR-08 / AC-S05-42: 남겨 둔 "고칠까요?"는 마우스 없이 빠른 입력칸에서 Tab으로 가서 고칠 수 있다', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  await newBroadcast(page, { date })
  await slowWrites(page, 500)
  await typeDuplicateThenNext(page)
  const input = page.getByLabel('빠른 입력')
  await expect(input).toBeFocused()
  const fixBtn = page.getByRole('button', { name: '61 장미 2만 고치기' })
  let reached = false
  for (let i = 0; i < 6 && !reached; i += 1) {
    await page.keyboard.press('Tab')
    reached = await fixBtn.evaluate((el) => el === document.activeElement)
  }
  expect(reached, '빠른 입력칸에서 Tab 여섯 번 안에 "고치기"에 닿아야 한다').toBe(true)
  await page.keyboard.press('Enter')
  const dlg = page.getByRole('dialog', { name: '61번이 이미 있어요. 고칠까요?' })
  await expect(dlg.getByRole('button', { name: '아니요' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dlg).toHaveCount(0)
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('61 장미 2만')
})

test('AC-S05-10·13: 보낸 등록이 다른 기기에 먼저 등록돼 changed:false로 돌아와도, 다음 줄을 치는 중이면 창을 띄우지 않고 남기며 다음 줄은 등록된다', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  const b = await newBroadcast(page, { date })
  let raced = false
  await page.route('**/api/events**', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown> | null
    if (!raced && body !== null && body['type'] === 'product.register' && body['no'] === 81) {
      raced = true
      // 다른 기기(휴대폰)가 같은 번호를 먼저 등록한다
      const other = await postJson(page, '/api/events', { requestId: crypto.randomUUID(), type: 'product.register', b, no: 81, name: '수국', price: 30000 })
      expect(other.status).toBeLessThan(300)
    }
    await new Promise((r) => setTimeout(r, 500))
    await route.continue()
  })
  const input = page.getByLabel('빠른 입력')
  for (const line of ['81 꽃 1만', '82 꽃 1만']) {
    await input.pressSequentially(line, { delay: 40 })
    await input.press('Enter')
  }
  await expect(boardItem(page, 82)).toBeVisible()
  await expect(boardItem(page, 81)).toContainText('수국')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(askList(page)).toContainText('81 꽃 1만')
  await expect(input).toHaveValue('')
  const events = await history(page, date, false)
  // 이력에는 거절된(바뀌지 않은) 81 등록도 남는다 — 82는 한 번, 81은 고쳐지지 않는다
  expect(events.filter((e) => e.type === 'product.register' && e.fields['no'] === 82)).toHaveLength(1)
  expect(events.filter((e) => e.type === 'product.update')).toEqual([])
})

test('AC-S05-21 / D-085: 생성기 채팅이 흐르는 동안 콘솔을 새로고침해도 채팅 패널은 서버의 마지막 메시지들과 빈틈없이 같다', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  const start = await postJson(page, `/api/broadcasts/${b}/rehearsal/generator/start`, { total: 400, perSecond: 5, seed: 7, requestId: crypto.randomUUID() })
  expect(start.status, JSON.stringify(start.body)).toBeLessThan(300)
  const genState = async () => (await (await page.request.get(`/api/broadcasts/${b}/rehearsal/generator`)).json() as { generator: { running: boolean; sent: number } }).generator
  // 흐르는 중에 두 번 새로고침한다 (첫 조회와 따라잡기가 채팅과 겹친다)
  for (const at of [80, 200]) {
    await expect.poll(async () => (await genState()).sent, { timeout: 30_000 }).toBeGreaterThanOrEqual(at)
    await page.reload()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
  }
  await expect.poll(async () => (await genState()).running, { timeout: 60_000 }).toBe(false)
  const res = await page.request.get(`/api/days/${date}/messages?rehearsal=true&b=${encodeURIComponent(b)}&limit=500`)
  expect(res.ok()).toBe(true)
  const server = (await res.json() as { messages: { nick: string; text: string }[] }).messages
  expect(server.length).toBeGreaterThan(300) // 생성기는 같은 메시지 ID 재전송(duplicates)을 섞는다
  const rows = page.getByRole('list', { name: '채팅 메시지' }).getByRole('listitem')
  // 패널이 마지막 메시지까지 따라잡을 때까지
  const last = server[server.length - 1]!
  await expect(rows.last()).toContainText(last.text)
  const texts = await rows.allTextContents()
  expect(texts.length).toBeGreaterThanOrEqual(100)
  const tail = server.slice(server.length - texts.length)
  const missing = tail.map((m, i) => ({ i, m, row: texts[i] ?? '' })).filter(({ m, row }) => !row.includes(m.nick) || !row.includes(m.text))
  expect(missing.slice(0, 3), `패널 ${String(texts.length)}줄이 서버 마지막 ${String(texts.length)}개와 다름`).toEqual([])
})
