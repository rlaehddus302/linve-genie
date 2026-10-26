// N3 기억한 입금자명 (AC-N3-42·46·25, DP-4 3·DP-6, D-N3-03) — test-e2e. 기본 chromium 묶음(게이트 안)에서 돈다 (SA-N3-03).
// 기억한 입금자명은 유튜브 구매자에만 붙는다. 실제 범위의 유튜브 구매자는 시험 모드 전용 경로 POST /api/deposits/test/chat
// (dev-notes "수정 라운드 2 (dev-server)" — 운영 기동에는 경로가 없다)로 만든다: 실제 방송 → 상품 → 시청자 채팅 찜.
// 흐름: 실명 입금(부분 금액) → 다른 묶음 지정으로 그 시청자 묶음에 확정·기억(기본 골라짐) → 같은 실명의 나머지 금액 입금 = 자동 확인 → 계좌 연동에서 지우기.
import { test, expect, type Page } from '@playwright/test'
import { deposit, depositOne, depositRow, fakeSource, history, kstIso, login, oddPrice, postJson, recentDate, registerApi, scopeView, uniq } from './support.ts'
import { cleanupPrint } from '../i1/support.ts'

// 출력 기록은 판매자 단위 — 판매(1등)가 만든 라벨 작업을 남기면 뒤 시험(N4a 등)의 출력 기기가 쌓인 라벨로 멈춘다 (i1 support "시험끼리 출력 기록이 섞이지 않게")
test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

/** 실제 방송(date)에 시청자 채팅 찜 하나 → 그 유튜브 구매자와 묶음 (합계는 엔진 값 — 배송비 포함) */
async function youtubeSale(page: Page, date: string, ch: string, nick: string): Promise<{ buyer: string; display: string; total: number }> {
  const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date, rehearsal: false, title: '기억 시험' })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  const body = res.body as Record<string, Record<string, unknown> | undefined>
  const b = body['result']?.['b'] ?? body['broadcast']?.['id'] ?? res.body['b'] ?? res.body['id']
  if (typeof b !== 'string') throw new Error(JSON.stringify(res.body))
  const no = 17
  await registerApi(page, b, no, `상품${String(no)}`, oddPrice())
  const chat = await postJson(page, '/api/deposits/test/chat', { b, id: uniq('msg'), ch, nick, text: String(no) })
  expect([chat.status, chat.body['recorded']], JSON.stringify(chat.body)).toEqual([200, true])
  let found: { buyer: string; display: string; total: number } | undefined
  await expect.poll(async () => {
    const view = await scopeView(page, date, false)
    const mine = view.buyers.find((x) => x.kind === 'youtube' && x.display.includes(nick))
    const s = mine === undefined ? undefined : view.settlements.find((x) => x.buyer === (mine.current ?? mine.id))
    found = mine === undefined || s === undefined ? undefined : { buyer: s.buyer, display: mine.display, total: s.total }
    return s === undefined ? 0 : s.received === 0 ? s.total : -1
  }).toBeGreaterThan(0)
  return found!
}

test('확정하며 입금자명 기억 → 같은 이름의 다음 입금이 그 시청자 묶음에 자동 확인 → 계좌 연동에서 지우기', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)
  const date = recentDate()
  const ch = `UC_${uniq('ch')}`
  const nick = uniq('기억시청자')
  const target = await youtubeSale(page, date, ch, nick)
  const realName = uniq('김실명')
  const first = target.total - 3_000
  const src = await fakeSource(page)
  const [d1] = await deposit(page, src, [{ key: uniq('m1'), at: kstIso(5_000), amount: first, name: realName }])
  expect(d1!.status).toBe('REVIEW')

  await page.goto('/deposits')
  await depositRow(page, d1!.no).getByRole('group', { name: `입금 번호 ${String(d1!.no)} 처리` }).getByRole('button', { name: '다른 묶음 지정' }).click() // MOB2 D-MOB2-05
  const search = page.getByRole('dialog', { name: `다른 묶음 지정 · 입금 번호 ${String(d1!.no)}` }) // MOB2 D-MOB2-05
  await search.getByLabel('찾을 말 (구매자 이름·닉네임·메모·전화번호 뒤 4자리)').fill(target.display)
  const found = search.getByRole('list', { name: '찾은 묶음' }).getByRole('button').filter({ hasText: target.display })
  await expect(found).toHaveCount(1)
  await found.click()
  const dlg = page.getByRole('dialog', { name: '입금 확정' })
  const remember = dlg.getByRole('checkbox', { name: '다음에도 이 입금자명이면 이 구매자로 볼게요' })
  await expect(remember).toBeChecked() // 기본 골라짐 (AC-N3-42)
  await dlg.getByRole('button', { name: '확정' }).click()
  await expect(dlg).toHaveCount(0)
  await expect.poll(async () => (await depositOne(page, d1!.no)).status).toBe('APPLIED')

  // 같은 실명의 나머지 금액 → 그 시청자 묶음에 자동 확인 (기억한 이름이 이름 후보)
  const [d2] = await deposit(page, src, [{ key: uniq('m2'), at: kstIso(6_000), amount: 3_000, name: realName }])
  expect(d2!.status).toBe('AUTO_APPLIED')
  expect(d2!.applied?.buyer).toBe(target.buyer)
  const s = (await scopeView(page, date, false)).settlements.find((x) => x.buyer === target.buyer)!
  expect([s.received, s.payment]).toEqual([target.total, 'PAID'])
  const pays = (await history(page, date, false)).filter((e) => e.type === 'settlement.payment' && e.fields['buyer'] === target.buyer)
  expect(pays.map((e) => e.fields['memo'])).toEqual([`입금 내역으로 확인 · 입금 #${String(d1!.no)}`, `자동 입금 확인 · 입금 #${String(d2!.no)}`])
  // 엔진 기록에 실명이 없다 (DP-INV-5)
  expect(JSON.stringify(pays)).not.toContain(realName)

  // 다음 날짜 방송: 같은 시청자(같은 채널)의 새 묶음 — 같은 실명의 그 금액 입금이 그 묶음에 자동 확인 (테스트 계획 "다음 날짜 방송", AC-N3-42·DP-4 3)
  let date2 = recentDate()
  while (date2 === date) date2 = recentDate()
  const next = await youtubeSale(page, date2, ch, nick)
  const [d3] = await deposit(page, src, [{ key: uniq('m3'), at: kstIso(7_000), amount: next.total, name: realName }])
  expect([d3!.status, d3!.applied?.buyer], JSON.stringify(d3)).toEqual(['AUTO_APPLIED', next.buyer])

  // 계좌 연동의 기억한 입금자명 → 지우기
  await page.goto('/deposits?tab=sources')
  const item = page.getByRole('list', { name: '기억한 입금자명' }).getByRole('listitem', { name: `${realName} → ${target.display}` })
  await expect(item).toBeVisible()
  await item.getByRole('button', { name: '지우기' }).click()
  await page.getByRole('dialog', { name: '기억한 입금자명 지우기' }).getByRole('button', { name: '지우기' }).click()
  await expect(item).toHaveCount(0)
  const names = (await (await page.request.get('/api/deposits/names')).json()) as { names: { name: string }[] }
  expect(names.names.some((n) => n.name === realName)).toBe(false)
})
