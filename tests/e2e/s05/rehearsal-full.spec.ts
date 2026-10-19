// 리허설 끝까지 (SPEC §8 1단계 완료 기준, acceptance L "리허설 끝까지", AC-S05-51·54, test-e2e).
// 생성기 1,000건(시드 고정)을 켜고 그동안 빠른 입력으로 1~30번을 등록하며 충돌·취소 요청을 화면에서 처리한다.
// 끝난 뒤 보드·서버 조회·정산 묶음이 그 리허설 범위 이력을 코어 applyEvent로 처음부터 재생한 결과와 같아야 한다.
import { test, expect } from '@playwright/test'
import { applyEvent, getBuyer, initEngine, listProducts, listSettlements, type EngineEvent, type EngineState } from '@livejjim/core'
import { boardItem, day, history, login, openNewBroadcast, uniqueDate } from './support.ts'

const STATUS_WORD: Record<string, string> = { READY: '공개 전', OPEN: '판매 중', SOLD: '판매 완료', HOLD: '일시 중지', CLOSED: '판매 종료' }

test('리허설 끝까지: 생성기 1,000건 + 상품 30개 + 화면 조치 → 보드·서버·정산 = 코어 재생', async ({ page }) => {
  test.setTimeout(240_000)
  await login(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  const panel = page.getByRole('region', { name: '리허설 조작판' })
  await panel.getByLabel('총 개수').fill('1000')
  await panel.getByLabel('초당 속도').fill('4') // E2E 속도 20배 → 초당 80건, 약 12초
  // AC-S06-66(013): '시드' 낱말 대신 "더 보기" 안의 "채팅 순서 번호"
  await panel.getByText('더 보기').click()
  await panel.getByLabel('채팅 순서 번호').fill('42')
  await panel.getByRole('button', { name: '가짜 채팅 시작' }).click()
  const status = panel.getByRole('status', { name: '가짜 채팅 상태' })
  await expect(status).toContainText(/실행 중|보내는 중|\d+ \/ 1,?000/)

  const input = page.getByLabel('빠른 입력')
  for (let no = 1; no <= 30; no += 1) {
    await input.fill(`${String(no)} 리허설${String(no)} ${String(no % 9 + 1)}000`)
    await input.press('Enter')
    // 다음 줄 전에 이 줄이 처리됐는지(보드에 보임) 확인 — 연타 경쟁은 TE-S05-001에서 따로 본다
    await expect(boardItem(page, no)).toBeVisible()
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // 생성기가 끝날 때까지 충돌·취소 요청·승계 결정을 화면에서 처리한다
  const strip = page.getByRole('region', { name: '알림' })
  const deadline = Date.now() + 150_000
  let handled = 0
  for (;;) {
    const gen = await (await page.request.get(`/api/broadcasts/${b}/rehearsal/generator`)).json() as { generator: { running: boolean; sent: number; total: number } }
    const actionable = strip.getByRole('button', { name: /^(충돌|취소 요청|승계 결정 필요) \d+$/ })
    if ((await actionable.count()) > 0) {
      await input.focus()
      await page.keyboard.press('Alt+1')
      const dlg = page.getByRole('dialog')
      await expect(dlg).toBeVisible()
      const title = await dlg.getByRole('heading').first().innerText()
      if (title.startsWith('승계 결정')) {
        await dlg.getByRole('button', { name: /^1 .*1등으로$/ }).click()
        const reason = page.getByRole('dialog').last()
        await reason.getByLabel('사유').fill('시청자 요청')
        await reason.getByLabel('사유').press('Enter')
      } else {
        await page.keyboard.press('1')
      }
      await expect(page.getByRole('dialog')).toHaveCount(0)
      handled += 1
      // 보낸 결과가 화면에 올 때까지(대기 중 항목은 창에서 건너뛴다)
      await expect(page.getByRole('region', { name: '보내기 전 조치' }).getByText(/초 뒤 보내요/)).toHaveCount(0, { timeout: 15_000 })
      continue
    }
    if (!gen.generator.running) break
    if (Date.now() > deadline) throw new Error('생성기가 끝나지 않음')
    await expect.poll(async () => {
      const g = await (await page.request.get(`/api/broadcasts/${b}/rehearsal/generator`)).json() as { generator: { running: boolean; sent: number } }
      return !g.generator.running || g.generator.sent > gen.generator.sent || (await actionable.count()) > 0
    }, { timeout: 20_000 }).toBe(true)
  }
  console.log(`화면에서 처리한 알림 ${String(handled)}개`)
  await expect(status).toContainText('1000 / 1000')
  await expect(page.getByRole('region', { name: '보내기 전 조치' }).getByText(/초 뒤 보내요|보내는 중/)).toHaveCount(0, { timeout: 15_000 })

  // ── 코어 재생 ──
  const events = await history(page, date, true)
  let state: EngineState = initEngine({ broadcasts: [], settings: {} })
  const seenMsg = new Set<string>()
  for (const e of events) {
    if (e.failed) continue
    if (e.type === 'chat') {
      const key = `${String(e.fields['b'])}|${String(e.fields['msg'] ?? e.fields['id'])}`
      expect(seenMsg.has(key), `같은 메시지 ID 사본이 기록됨 ${key}`).toBe(false)
      seenMsg.add(key)
      expect(e.actor.kind).toBe('collector')
    }
    const event = { type: e.type, seq: e.seq, at: Date.parse(String((e as unknown as { at: string }).at)), ...e.fields, ...(e.reason === null ? {} : { reason: e.reason }) } as unknown as EngineEvent
    state = applyEvent(state, event).state
  }
  const replayProducts = listProducts(state).filter((p) => p.broadcast === b)
  expect(replayProducts).toHaveLength(30)
  const view = await day(page, date, true) as { products: { key: string; status: string; winners: string[]; waitlist: string[]; conflict: boolean; awaitingSuccession: boolean; price: number; name: string }[]; settlements: { buyer: string; total: number }[] }
  const pick = (p: { key: string; status: string; winners: readonly string[]; waitlist: readonly string[]; conflict: boolean; awaitingSuccession: boolean; price: number; name: string }) =>
    ({ key: p.key, status: p.status, winners: [...p.winners], waitlist: [...p.waitlist], conflict: p.conflict, awaitingSuccession: p.awaitingSuccession, price: p.price, name: p.name })
  expect(view.products.filter((p) => p.key.startsWith(`${b}`)).map(pick).sort((x, y) => x.key.localeCompare(y.key)))
    .toEqual(replayProducts.map(pick).sort((x, y) => x.key.localeCompare(y.key)))
  // 정산 묶음(구매자별 합계)
  const replaySettle = listSettlements(state).map((s) => ({ buyer: s.buyer, total: s.total })).sort((x, y) => x.buyer.localeCompare(y.buyer))
  expect(view.settlements.map((s) => ({ buyer: s.buyer, total: s.total })).sort((x, y) => x.buyer.localeCompare(y.buyer))).toEqual(replaySettle)
  // 보드: 상태 낱말·1등 표시 이름·대기 수
  for (const p of replayProducts) {
    const item = boardItem(page, p.no)
    await expect(item).toContainText(STATUS_WORD[p.status]!)
    await expect(item).toContainText(`대기 ${String(p.waitlist.length)}`)
    for (const w of p.winners) await expect(item).toContainText(getBuyer(state, w)!.display)
    if (p.winners.length === 0) await expect(item).toContainText('아직 없음')
  }
  // 실제 범위에는 아무것도 없다
  const real = await page.request.get(`/api/days/${date}`)
  if (real.status() !== 404) {
    const body = await real.json() as { broadcasts: { id: string }[]; products: { key: string }[] }
    expect(body.broadcasts.map((x) => x.id)).not.toContain(b)
    expect(body.products.filter((p) => p.key.startsWith(b))).toEqual([])
  }
})
