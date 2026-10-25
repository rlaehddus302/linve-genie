// QL2 라벨 "빼기" 확인 창 (AC-QL2-42, D-QL2-09 ③) · 보류 찜 창의 시간과 뜻 (AC-QL2-43, D-QL2-09 ④) — test-e2e.
import { expect, test, type Page } from '@playwright/test'
import { gotoLabels, postJson, region, scopeLabels } from '../i1/support.ts'
import { loginNewSeller } from '../i3/support.ts'
import { uniqueDate } from '../s05/support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import { CANCEL_QUESTION_TAIL, alerts, broadcastApi, expectOrder, pendingMeaning, setLabelsApi } from './support.ts'

test.describe('AC-QL2-42 "빼기" 확인 창', () => {
  test('대기 2장 → 첫 작업 "빼기" → 창 "라벨 빼기"(번호·품종·뜻 문장, 처음 포커스 "닫기"), 요청 없음 → Esc·닫기 뒤 2장 → "1 빼기"면 그 작업만 "출력 안 함"', async ({ page }) => {
    await loginNewSeller(page)
    await setLabelsApi(page, true)
    const date = uniqueDate()
    const b = await broadcastApi(page, date)
    expect((await postJson(page, '/api/print/pause', {})).status).toBeLessThan(300)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '청보석', 20000)
    await smsApi(page, { b, no: 15, phone: '010-6400-0015' })
    await smsApi(page, { b, no: 16, phone: '010-6400-0016' })
    await page.goto('/')
    await gotoLabels(page)
    const list = region(page, '출력 대기열').getByRole('list', { name: '대기 작업' })
    await expect(list.getByRole('listitem')).toHaveCount(2)
    const first = list.getByRole('listitem').first()
    const firstText = await first.innerText()
    const [no, name] = /15번/.test(firstText.split('\n')[0] ?? firstText) ? ['15번', '핑크프릴'] : ['16번', '청보석']
    const cancels: string[] = []
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/print/jobs/cancel') cancels.push(r.url())
    })

    await first.getByRole('button', { name: '빼기', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: '라벨 빼기' })
    await expect(dlg).toBeVisible()
    await expect(dlg).toContainText(`${no} ${name} ${CANCEL_QUESTION_TAIL}`)
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    expect(cancels).toEqual([])
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(list.getByRole('listitem')).toHaveCount(2)
    // 닫기
    await first.getByRole('button', { name: '빼기', exact: true }).click()
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: '닫기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(list.getByRole('listitem')).toHaveCount(2)
    expect(cancels).toEqual([])

    // "1 빼기"(숫자 1)
    await first.getByRole('button', { name: '빼기', exact: true }).click()
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('1')
    await expect(dlg).toHaveCount(0)
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(list.getByRole('listitem').first()).not.toContainText(name)
    expect(cancels).toHaveLength(1)
    const labels = (await scopeLabels(page, date)).filter((l) => l.winner).sort((x, y) => x.no - y.no)
    const gone = Number(no.replace('번', ''))
    expect(labels.map((l) => [l.no, l.word === '출력 안 함'])).toEqual([[15, gone === 15], [16, gone === 16]])
    // "모두 빼기"는 지금 그대로 (확인 창 "모두 빼기")
    await region(page, '출력 대기열').getByRole('button', { name: '모두 빼기' }).click()
    await expect(page.getByRole('dialog', { name: '모두 빼기' })).toBeVisible()
  })
})

/** 보류 찜 창을 브라우저 시계(찜 시각 + 지난 초)로 연다 */
async function openPendingAt(page: Page, at: number, seconds: number): Promise<ReturnType<Page['getByRole']>> {
  await page.clock.setFixedTime(at + seconds * 1000)
  await alerts(page).getByRole('button', { name: /^보류 찜 \d+$/ }).click()
  const dlg = page.getByRole('dialog', { name: '보류 찜' })
  await expect(dlg).toBeVisible()
  return dlg
}

test.describe('AC-QL2-43 보류 찜 창의 시간과 뜻', () => {
  test('등록 안 한 번호 31 — 10초 "10초 전", 맨 위 뜻 문장(기본 30초), "번호 넣기"·만료 태그 그대로, 383·45·60초는 "시간이 지난 보류 찜"의 "31번 1개"(MOB2 D-MOB2-06)', async ({ page }) => {
    await loginNewSeller(page)
    const date = uniqueDate()
    const b = await broadcastApi(page, date)
    await smsApi(page, { b, no: 31, memo: '보류' })
    const view = (await (await page.request.get(`/api/days/${date}`)).json()) as { claims: { no: number; at?: string }[] }
    const claim = view.claims.find((c) => c.no === 31)
    expect(claim?.at, JSON.stringify(view.claims)).toBeTruthy()
    const at = Date.parse(claim!.at!)
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    for (const [seconds, word, expires] of [[383, '6분 전', true], [45, '45초 전', true], [60, '1분 전', true], [10, '10초 전', false]] as const) {
      const dlg = await openPendingAt(page, at, seconds)
      const meaning = dlg.getByText(pendingMeaning(30), { exact: true })
      await expect(meaning).toBeVisible()
      if (seconds > 30) {
        // MOB2 D-MOB2-06: 창(30초)이 지난 찜만 남은 번호는 위 묶음이 아니라 아래 "시간이 지난 보류 찜" 목록의 "31번 1개" — "번호 넣기" 없음
        const old = dlg.getByRole('region', { name: '시간이 지난 보류 찜' })
        const oldRow = old.getByRole('listitem').filter({ hasText: '31번' })
        await expect(oldRow).toHaveText('31번 1개')
        await expectOrder([['뜻 문장', meaning], ['31번 줄', oldRow]], `${String(seconds)}초 창 맨 위`)
        await expect(dlg.getByRole('button', { name: /번호 넣기/ })).toHaveCount(0)
        await dlg.getByRole('button', { name: '닫기' }).click()
        await expect(dlg).toHaveCount(0)
        continue
      }
      const row = dlg.getByRole('listitem').filter({ hasText: '31번' })
      await expectOrder([['뜻 문장', meaning], ['31번 줄', row]], `${String(seconds)}초 창 맨 위`)
      await expect(row).toContainText(`보류 찜 1개 · 가장 오래된 찜 ${word}`)
      await expect(row).not.toContainText(/\d{3,}초 전/)
      await expect(row.getByRole('button', { name: /번호 넣기/ })).toBeVisible()
      if (expires) await expect(row).toContainText('지금 등록하면 만료돼요')
      else await expect(row).not.toContainText('지금 등록하면 만료돼요')
      await dlg.getByRole('button', { name: '닫기' }).click()
      await expect(dlg).toHaveCount(0)
    }
  })

  test('claim.preOpenWindowSec 45로 만든 방송: 뜻 문장이 "45초 안에"', async ({ page }) => {
    await loginNewSeller(page)
    const res = await page.request.patch('/api/settings', { data: { settings: { 'claim.preOpenWindowSec': 45 } }, headers: { Origin: new URL(page.url()).origin } })
    expect(res.status(), await res.text()).toBe(200)
    const date = uniqueDate()
    const b = await broadcastApi(page, date)
    await smsApi(page, { b, no: 31, memo: '보류' })
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await alerts(page).getByRole('button', { name: /^보류 찜 \d+$/ }).click()
    const dlg = page.getByRole('dialog', { name: '보류 찜' })
    await expect(dlg.getByText(pendingMeaning(45), { exact: true })).toBeVisible()
    await expect(dlg.getByText(pendingMeaning(30), { exact: true })).toHaveCount(0)
  })
})
