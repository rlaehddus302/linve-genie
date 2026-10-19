// 문자찜 결과는 응답의 구매자로 · 받은 시각에 날짜 · 고른 방송 · 결과 색의 뜻 (AC-S06b-30·31·32·40, ORD-08, R-4, R-6 D-023, D-099, D-102, G-ENG-176) — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import { dateLongKo, login, openNewBroadcast, openSms, phoneLike, registerApi, scopeView, smsApi, smsField, smsUi, uniq, uniqueDate, viewerClaim, writeEvent } from './support.ts'

/** 입력 시각(지금)에 가장 가까운 날의 그 시각 → "10/20" (D-023 — 거리가 같으면 늦은 날) */
function nearestMonthDay(hms: string): string {
  const now = Date.now()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
  const base = Date.parse(`${today}T${hms.length === 5 ? `${hms}:00` : hms}+09:00`)
  const best = [-1, 0, 1].map((d) => base + d * 86_400_000).sort((a, b) => Math.abs(a - now) - Math.abs(b - now) || b - a)[0]!
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date(best))
}

async function rehearsal(page: Page): Promise<{ b: string; date: string; title: string }> {
  const date = uniqueDate()
  const title = uniq('문자')
  const b = await openNewBroadcast(page, { date, rehearsal: true, title })
  return { b, date, title }
}

test.describe('문자찜 결과 (AC-S06b-30·31·40)', () => {
  test('G-ENG-176 흐름 (휴대폰): 뒤 4자리만 같은 두 사람 → Y 번호로 15번 → "이미 찜한 구매자라…(지금 대기 1번)", 같은 사람 하나 더 = Y', async ({ page, browser }) => {
    await login(page)
    const { b, date, title } = await rehearsal(page)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '라울', 5000)
    const mobile = await phoneLike(browser, page)
    try {
      await openSms(mobile, title)
      const result = mobile.getByRole('region', { name: '넣은 결과' })
      await smsUi(mobile, { no: 15, phone: '010-1111-5678', memo: '김씨' })
      await expect(result).toContainText('15번 · 문자찜(김씨) · 1등')
      await expect(result).toHaveAttribute('data-tone', 'success')
      await smsUi(mobile, { no: 15, phone: '010-2222-5678', memo: '박씨' })
      await expect(result).toContainText('15번 · 문자찜(박씨) · 대기 1번')
      await expect(result).toHaveAttribute('data-tone', 'info')
      // Y 번호(형식 다름)로 다시 15번 → 새 찜 없음, 정한 구매자는 Y (1등인 X가 아니다)
      await smsField(mobile, '번호').fill('15')
      await smsField(mobile, '전화번호').fill('01022225678')
      await mobile.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
      await expect(result).toContainText('15번 · 이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 대기 1번)')
      await expect(result).toHaveAttribute('data-tone', 'warning')
      await result.getByRole('button', { name: '같은 사람 하나 더' }).click()
      const chosen = mobile.getByRole('group', { name: '고른 구매자' })
      await expect(chosen).toContainText('고른 구매자: 문자찜(박씨)')
      // 같은 사람(Y)으로 16번 → Y가 16번 1등
      await smsField(mobile, '번호').fill('16')
      await mobile.getByRole('button', { name: '16번에 문자찜 넣기' }).click()
      await expect(result).toContainText('16번 · 문자찜(박씨) · 1등')
      const view = await scopeView(page, date, true)
      const y = view.buyers.find((x) => x.display === '문자찜(박씨)')!
      expect(view.claims.filter((c) => c.no === 16).map((c) => c.currentBuyer)).toEqual([y.id])
      expect(view.claims).toHaveLength(3)
    } finally {
      await mobile.context().close()
    }
  })

  test('결과 색의 뜻: 판매 중 아님·차단은 주의(warning), 판매 완료 상품의 새 찜(대기)은 정보(info), 저장하지 못함은 위험(danger) — 낱말과 함께', async ({ page }) => {
    await login(page)
    const { b, date, title } = await rehearsal(page)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '라울', 5000)
    await registerApi(page, b, 17, '성미인', 8000)
    await registerApi(page, b, 18, '블루버드', 6000)
    expect((await writeEvent(page, { type: 'product.close', b, no: 18 })).status).toBeLessThan(300)
    await smsApi(page, { b, no: 15, memo: '먼저' }) // 1등 → 재고 1 → 판매 완료
    await openSms(page, title)
    const result = page.getByRole('region', { name: '넣은 결과' })
    await smsUi(page, { no: 15, memo: '늦음' })
    await expect(result).toContainText(/15번 · 문자찜\(늦음\) · 대기 1번/)
    await expect(result).toHaveAttribute('data-tone', 'info')
    await smsUi(page, { no: 18, memo: '닫힘' })
    await expect(result).toContainText(/18번 · 문자찜\(닫힘\) · .*판매 중 아님/)
    await expect(result).toHaveAttribute('data-tone', 'warning')
    // 차단된 구매자의 문자찜
    await smsUi(page, { no: 16, phone: '010-3333-4444', memo: '장난' })
    await expect(result).toHaveAttribute('data-tone', 'success')
    const blocked = (await scopeView(page, date, true)).buyers.find((x) => x.phoneLast4 === '4444')!.id
    expect((await writeEvent(page, { type: 'host.blockBuyer', buyer: blocked, reason: '반복 장난' }, { date, rehearsal: true })).status).toBeLessThan(300)
    await smsUi(page, { no: 17, phone: '010-3333-4444' })
    await expect(result).toContainText(/17번 · 문자찜\(장난\) · .*차단/)
    await expect(result).toHaveAttribute('data-tone', 'warning')
    // 저장하지 못함
    await page.route('**/api/events', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버에서 처리하지 못했어요.' } }) }))
    await smsField(page, '번호').fill('16')
    await page.getByRole('button', { name: '16번에 문자찜 넣기' }).click()
    const failed = page.locator('.error-note').first()
    await expect(failed).toBeVisible()
    await expect(failed).toHaveAttribute('data-tone', 'danger')
  })

  test('합쳐진 구매자의 번호로 온 문자찜: 지금의 구매자가 이미 찜했으면 "이미 찜한 구매자라…(지금 1등)", 같은 사람 하나 더 = 그 번호의 구매자', async ({ page }) => {
    await login(page)
    const { b, date, title } = await rehearsal(page)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 16, '라울', 5000)
    const ch = uniq('sim_m_')
    await viewerClaim(page, b, '홍길동', '15', ch)
    await smsApi(page, { b, no: 16, phone: '010-5555-1212', memo: '김씨' })
    const x = (await scopeView(page, date, true)).buyers.find((v) => v.kind === 'sms')!.id
    expect((await writeEvent(page, { type: 'buyer.merge', from: x, into: ch, reason: '같은 사람' }, { date, rehearsal: true })).status).toBeLessThan(300)
    await openSms(page, title)
    const result = page.getByRole('region', { name: '넣은 결과' })
    await smsField(page, '번호').fill('15')
    await smsField(page, '전화번호').fill('010-5555-1212')
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    await expect(result).toContainText('15번 · 이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 1등)')
    await expect(result).toHaveAttribute('data-tone', 'warning')
    await result.getByRole('button', { name: '같은 사람 하나 더' }).click()
    await expect(page.getByRole('group', { name: '고른 구매자' })).toContainText('문자찜(김씨)')
    expect((await scopeView(page, date, true)).claims).toHaveLength(2)
  })

  test('AC-S06b-31: 받은 시각은 날짜와 함께 — 분까지 "23:59"는 입력 시각에 가장 가까운 날(D-023), 최근 목록도 같은 글자', async ({ page }) => {
    await login(page)
    const { b, title } = await rehearsal(page)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await openSms(page, title)
    const md = nearestMonthDay('23:59')
    await smsField(page, '번호').fill('15')
    await smsField(page, '받은 시각').fill('23:59')
    await page.getByRole('button', { name: '15번에 문자찜 넣기' }).click()
    // 가장 가까운 날이 오늘이고 지금보다 늦으면 확인을 묻는다 (D-089)
    const late = page.getByRole('dialog', { name: '받은 시각을 확인해 주세요' })
    const result0 = page.getByRole('region', { name: '넣은 결과' })
    await expect(late.or(result0)).toBeVisible()
    if (await late.count() > 0) await late.getByRole('button', { name: '이대로 넣기' }).click()
    const result = page.getByRole('region', { name: '넣은 결과' })
    await expect(result).toContainText(`받은 시각 ${md} 23:59`)
    await expect(result).not.toContainText(`${md} 23:59:`) // 분까지만 적었으면 분까지
    await expect(page.getByRole('region', { name: '최근 넣은 문자찜' })).toContainText(`${md} 23:59`)
  })
})

test.describe('방송 고르기 (AC-S06b-22·32)', () => {
  test('고른 방송은 "✓ 고름" 글자·aria-pressed, 고르지 않은 항목엔 없음. 날짜는 연도·요일까지', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const t1 = uniq('고름A')
    const t2 = uniq('고름B')
    await openNewBroadcast(page, { date, rehearsal: true, title: t1 })
    await openNewBroadcast(page, { date, rehearsal: true, title: t2 })
    await openSms(page, t1)
    const region = page.getByRole('region', { name: '고른 방송' })
    await expect(region).toContainText(`${t1} · ${dateLongKo(date)}`)
    await region.getByRole('button', { name: /^방송 (바꾸기|고르기)$/ }).click()
    const dlg = page.getByRole('dialog', { name: '방송 고르기' })
    const chosen = dlg.getByRole('button', { name: new RegExp(`^${t1} ·`) })
    const other = dlg.getByRole('button', { name: new RegExp(`^${t2} ·`) })
    await expect(chosen).toHaveAttribute('aria-pressed', 'true')
    await expect(chosen).toContainText('✓ 고름')
    await expect(chosen).toContainText(dateLongKo(date))
    await expect(other).toHaveAttribute('aria-pressed', 'false')
    await expect(other).not.toContainText('✓ 고름')
    const bg = async (l: typeof chosen) => await l.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(await bg(chosen)).not.toBe(await bg(other))
    await expect(dlg.getByText('✓ 고름')).toHaveCount(1)
  })
})
