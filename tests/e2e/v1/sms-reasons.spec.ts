// V1 음성 문자찜 — 넣을 수 없는 경우의 이유 카드(AC-V1-23), 이름·확인 필요·받은 시각(AC-V1-26) — test-e2e.
// 이유 문장은 acceptance.md AC-V1-23 표 그대로. 시각은 page.clock으로 고정·멈춘다.
import { test, expect } from '@playwright/test'
import { loginNewSeller } from '../i3/support.ts'
import {
  boardItem,
  heardCard,
  installSmsSpeech,
  kstToday,
  openNewBroadcast,
  recordRequests,
  registerApi,
  scopeView,
  setupPaused,
  smsApi,
  smsButton,
  smsCard,
  smsResults,
  smsWrites,
  speak,
  turnOnVoice,
  uniqueDate,
  writeEvent,
} from './support.ts'

const REASONS: [string, string][] = [
  ['문자찜 들어왔어요', '번호를 못 알아들었어요. 다시 말하거나 문자찜 입력에 넣어 주세요.'],
  ['1 5번 문자찜', '번호를 못 알아들었어요. 다시 말하거나 문자찜 입력에 넣어 주세요.'],
  ['15번 문자찜 끝자리 12 34', '끝자리를 못 알아들었어요. 숫자 네 개로 다시 말해 주세요.'],
  ['김민지님 이수진님 15번 문자찜', '이름이 둘이에요. 한 분씩 말해 주세요.'],
  ['15번 문자찜 25시', '받은 시각을 못 알아들었어요. 시각 없이 다시 말해 주세요.'],
  ['15번 문자찜 취소', '음성으로는 찜을 취소하지 않아요. 찜 취소는 화면에서 해 주세요.'],
]

test.describe('V1 이유 카드', () => {
  test('AC-V1-23: 문제 문장(NUMBER·LAST4·NAME·TIME_UNCLEAR·CANCEL)과 없는 번호·판매 중 아님 → 그 문장·"닫기"만·쓰기 없음', async ({ page }) => {
    const { b } = await setupPaused(page)
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 301, '라울', 7000)
    await registerApi(page, b, 302, '라울', 7000)
    await registerApi(page, b, 303, '라울', 7000)
    expect((await writeEvent(page, { type: 'product.close', b, no: 301 })).status).toBeLessThan(300)
    expect((await writeEvent(page, { type: 'product.hold', b, no: 302 })).status).toBeLessThan(300)
    await expect(boardItem(page, 303)).toBeVisible()
    const requests = recordRequests(page)
    const all: [string, string][] = [
      ...REASONS,
      ['300번 문자찜', '300번 상품이 없어요.'],
      ['301번 문자찜', '301번은 지금 판매 중이 아니에요.'],
      ['302번 문자찜', '302번은 지금 판매 중이 아니에요.'],
    ]
    for (const [text, reason] of all) {
      await speak(page, text)
      const c = heardCard(page, text)
      await expect(c.getByRole('alert'), text).toHaveText(reason)
      await expect(c.getByRole('button'), text).toHaveText(['닫기'])
      // 주문이 빈 문제 카드끼리는 "같은 말"이 될 수 있다(D-V1-06 — 문제 카드끼리도 같은 규칙) → 10초를 넘겨 다음 문장
      await page.clock.runFor(10_001)
    }
    await page.clock.runFor(15_000)
    expect(smsWrites(requests)).toEqual([])
    // 닫기 → 카드가 사라진다
    await heardCard(page, '300번 문자찜').getByRole('button', { name: /닫기$/ }).click()
    await expect(heardCard(page, '300번 문자찜')).toHaveCount(0)
  })

  test('AC-V1-23: 공개 전(READY) 상품도 "지금 판매 중이 아니에요"', async ({ page }) => {
    const { b } = await setupPaused(page)
    expect((await writeEvent(page, { type: 'product.register', b, no: 304, name: '라울', price: 7000, status: 'READY' })).status).toBeLessThan(300)
    await expect(boardItem(page, 304)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '304번 문자찜')
    await expect(heardCard(page, '304번 문자찜').getByRole('alert')).toHaveText('304번은 지금 판매 중이 아니에요.')
    await page.clock.runFor(5000)
    expect(smsWrites(requests)).toEqual([])
  })

  test('AC-V1-23: 만든 뒤 넣기 직전에 판매 종료되면 보내지 않고 이유 카드로 바뀐다', async ({ page }) => {
    const { b } = await setupPaused(page)
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 끝자리 1234')
    const short = '165번 · 끝자리 1234 · 문자찜'
    await expect(smsCard(page, short).getByText('3초 뒤 넣어요')).toBeVisible()
    expect((await writeEvent(page, { type: 'product.close', b, no: 165 })).status).toBeLessThan(300)
    await expect(boardItem(page, 165)).toContainText('판매 종료')
    await page.clock.runFor(4000)
    await expect(smsCard(page, short).getByRole('alert')).toHaveText('165번은 지금 판매 중이 아니에요.')
    await expect(smsCard(page, short).getByRole('button')).toHaveText(['닫기'])
    expect(smsWrites(requests)).toEqual([])
  })

  test('AC-V1-23: 1등이 찼고 대기도 꽉 참(waitlist.max 1) → "대기까지 다 찼어요", 대기 자리가 있으면 대기로 넣는다', async ({ page }) => {
    await installSmsSpeech(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await loginNewSeller(page)
    const patch = await page.request.patch('/api/settings', { data: { settings: { 'waitlist.max': 1 } }, headers: { Origin: new URL(page.url()).origin } })
    expect(patch.status(), await patch.text()).toBe(200)
    const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: false })
    await registerApi(page, b, 302, '라울', 7000)
    await smsApi(page, { b, no: 302, memo: '김씨' })
    await expect(boardItem(page, 302)).toBeVisible()
    await turnOnVoice(page)
    const requests = recordRequests(page)
    // 대기 자리 하나 → 넣어서 대기 1번
    const short = '302번 · 끝자리 1234 · 문자찜'
    await speak(page, '302번 문자찜 끝자리 1234')
    await smsButton(page, short, '지금 넣기').click()
    await expect(smsResults(page, short)).toHaveText(/^302번 · 문자찜.* · 대기 1번 · 받은 시각 /)
    // 이제 대기도 꽉 참
    await speak(page, '302번 문자찜 끝자리 5678')
    await expect(heardCard(page, '302번 문자찜 끝자리 5678').getByRole('alert')).toHaveText('302번은 대기까지 다 찼어요.')
    await expect(heardCard(page, '302번 문자찜 끝자리 5678').getByRole('button')).toHaveText(['닫기'])
    expect(smsWrites(requests)).toHaveLength(1)
  })
})

test.describe('V1 이름·확인 필요·받은 시각', () => {
  test('AC-V1-26: "김민지님 165번 문자찜" → 메모 김민지·문자찜(김민지), "166번 문자찜" → 메모 확인 필요·문자찜(확인 필요)', async ({ page }) => {
    const { b, date } = await setupPaused(page)
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await registerApi(page, b, 166, '핑크프릴', 10000)
    await expect(boardItem(page, 166)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '김민지님 165번 문자찜')
    await expect(smsCard(page, '165번 · 김민지님 · 문자찜')).toBeVisible()
    await page.clock.runFor(3000)
    await expect(smsResults(page, '165번 · 김민지님 · 문자찜')).toHaveText(/^165번 · 문자찜\(김민지\) · 1등 · 받은 시각 /)
    await speak(page, '166번 문자찜')
    await expect(smsCard(page, '166번 · 손님 확인 필요 · 문자찜')).toBeVisible()
    await page.clock.runFor(3000)
    await expect(smsResults(page, '166번 · 손님 확인 필요 · 문자찜')).toHaveText(/^166번 · 문자찜\(확인 필요\) · 1등 · 받은 시각 /)
    const writes = smsWrites(requests)
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({ no: 165, memo: '김민지' })
    expect(writes[1]).toMatchObject({ no: 166, memo: '확인 필요' })
    for (const w of writes) {
      expect(w).not.toHaveProperty('last4')
      expect(w).not.toHaveProperty('buyer')
    }
    const view = await scopeView(page, date, false)
    expect(view.buyers.map((x) => x.display).sort()).toEqual(['문자찜(김민지)', '문자찜(확인 필요)'])
  })

  test('AC-V1-26: 지금 14:30에 "165번 문자찜 2시 15분" → 14:15로 저절로, 지금 13:00이면 "받은 시각이 지금보다 늦어요" 확인·저절로 안 넣음', async ({ page }) => {
    const { b } = await setupPaused(page, { at: kstToday('14:30') })
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 2시 15분')
    const c = page.getByRole('list', { name: '음성 카드' }).getByRole('listitem', { name: /^165번 .*받은 시각 2:15.* 카드$/ })
    await expect(c).toBeVisible()
    await expect(c.getByText('3초 뒤 넣어요')).toBeVisible()
    await page.clock.runFor(3000)
    await expect(c.getByRole('list').getByRole('status')).toHaveText(/^165번 · 문자찜\(확인 필요\) · 1등 · 받은 시각 \d\d\/\d\d 14:15/)
    expect(smsWrites(requests)).toHaveLength(1)
    expect(smsWrites(requests)[0]).toMatchObject({ no: 165, received: '14:15' })
  })

  test('AC-V1-26: 지금 13:00에 "165번 문자찜 2시 15분" → 늦은 시각 확인, 저절로 안 넣음, 넣기 → 14:15', async ({ page }) => {
    const { b } = await setupPaused(page, { at: kstToday('13:00') })
    await registerApi(page, b, 165, '핑크프릴', 10000)
    await expect(boardItem(page, 165)).toBeVisible()
    const requests = recordRequests(page)
    await speak(page, '165번 문자찜 2시 15분')
    const c = page.getByRole('list', { name: '음성 카드' }).getByRole('listitem', { name: /^165번 .*받은 시각 2:15.* 카드$/ })
    await expect(c.getByText('받은 시각이 지금보다 늦어요. 그래도 넣을까요?')).toBeVisible()
    await expect(c.getByRole('button')).toHaveText(['넣기', '넣지 않기'])
    await page.clock.runFor(15_000)
    expect(smsWrites(requests)).toEqual([])
    await c.getByRole('button', { name: /넣기$/ }).filter({ hasText: /^넣기$/ }).click()
    await expect(c.getByRole('list').getByRole('status')).toHaveText(/^165번 · 문자찜\(확인 필요\) · 1등 · /)
    expect(smsWrites(requests)).toHaveLength(1)
    expect(smsWrites(requests)[0]).toMatchObject({ no: 165, received: '14:15' })
  })
})
