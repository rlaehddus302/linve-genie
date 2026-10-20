// N3 기억한 입금자명 (AC-N3-42·46·25, DP-4 3·DP-6, D-N3-03) — test-e2e. @fill 묶음(chromium-fill)에서 돈다.
// 기억한 입금자명은 유튜브 구매자에만 붙는다. 실제 범위에 유튜브 구매자를 만드는 화면 경로가 E2E에 없어서(리허설 채팅은 리허설 범위만),
// 채운 범위(오늘 실제 범위, 시청자 채팅 1만 — E2E 기동 --fill yes)의 유튜브 구매자 묶음을 쓴다.
// 흐름: 실명 입금(부분 금액) → 다른 묶음 지정으로 그 시청자 묶음에 확정·기억(기본 골라짐) → 같은 실명의 나머지 금액 입금 = 자동 확인 → 계좌 연동에서 지우기.
import { test, expect } from '@playwright/test'
import { deposit, depositOne, depositRow, fakeSource, history, kstIso, login, scopeView, todayKst, uniq } from './support.ts'

test('확정하며 입금자명 기억 → 같은 이름의 다음 입금이 그 시청자 묶음에 자동 확인 → 계좌 연동에서 지우기 @fill', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)
  const date = todayKst()
  const view = await scopeView(page, date, false)
  // 이름 표기가 하나뿐이고(동명 아님) 남은 금액이 넉넉한 유튜브 구매자 묶음
  const counts = new Map<string, number>()
  for (const b of view.buyers) counts.set(b.display, (counts.get(b.display) ?? 0) + 1)
  const target = view.settlements.find((s) => {
    const buyer = view.buyers.find((b) => b.id === s.buyer)
    return buyer !== undefined && buyer.kind === 'youtube' && counts.get(buyer.display) === 1 && s.received === 0 && s.total >= 10_000 && s.items.length > 0
  })
  expect(target, '채운 범위에 쓸 유튜브 구매자 묶음').toBeDefined()
  const buyer = view.buyers.find((b) => b.id === target!.buyer)!
  const realName = uniq('김실명')
  const first = target!.total - 3_000
  const src = await fakeSource(page)
  const [d1] = await deposit(page, src, [{ key: uniq('m1'), at: kstIso(5_000), amount: first, name: realName }])
  expect(d1!.status).toBe('REVIEW')

  await page.goto('/deposits')
  await depositRow(page, d1!.no).getByRole('group', { name: `입금 #${String(d1!.no)} 처리` }).getByRole('button', { name: '다른 묶음 지정' }).click()
  const search = page.getByRole('dialog', { name: `다른 묶음 지정 · 입금 #${String(d1!.no)}` })
  await search.getByLabel('찾을 말 (구매자 이름·닉네임·메모·전화번호 뒤 4자리)').fill(buyer.display)
  const found = search.getByRole('list', { name: '찾은 묶음' }).getByRole('button').filter({ hasText: buyer.display })
  await expect(found.first()).toBeVisible()
  await found.first().click()
  const dlg = page.getByRole('dialog', { name: '입금 확정' })
  const remember = dlg.getByRole('checkbox', { name: '다음에도 이 입금자명이면 이 구매자로 볼게요' })
  await expect(remember).toBeChecked() // 기본 골라짐 (AC-N3-42)
  await dlg.getByRole('button', { name: '확정' }).click()
  await expect(dlg).toHaveCount(0)
  await expect.poll(async () => (await depositOne(page, d1!.no)).status).toBe('APPLIED')

  // 같은 실명의 나머지 금액 → 그 시청자 묶음에 자동 확인 (기억한 이름이 이름 후보)
  const [d2] = await deposit(page, src, [{ key: uniq('m2'), at: kstIso(6_000), amount: 3_000, name: realName }])
  expect(d2!.status).toBe('AUTO_APPLIED')
  expect(d2!.applied?.buyer).toBe(target!.buyer)
  const s = (await scopeView(page, date, false)).settlements.find((x) => x.buyer === target!.buyer)!
  expect([s.received, s.payment]).toEqual([target!.total, 'PAID'])
  const pays = (await history(page, date, false)).filter((e) => e.type === 'settlement.payment' && e.fields['buyer'] === target!.buyer)
  expect(pays.map((e) => e.fields['memo'])).toEqual([`입금 내역으로 확인 · 입금 #${String(d1!.no)}`, `자동 입금 확인 · 입금 #${String(d2!.no)}`])
  // 엔진 기록에 실명이 없다 (DP-INV-5)
  expect(JSON.stringify(pays)).not.toContain(realName)

  // 계좌 연동의 기억한 입금자명 → 지우기
  await page.goto('/deposits?tab=sources')
  const item = page.getByRole('list', { name: '기억한 입금자명' }).getByRole('listitem', { name: `${realName} → ${buyer.display}` })
  await expect(item).toBeVisible()
  await item.getByRole('button', { name: '지우기' }).click()
  await page.getByRole('dialog', { name: '기억한 입금자명 지우기' }).getByRole('button', { name: '지우기' }).click()
  await expect(item).toHaveCount(0)
  const names = (await (await page.request.get('/api/deposits/names')).json()) as { names: { name: string }[] }
  expect(names.names.some((n) => n.name === realName)).toBe(false)
})
