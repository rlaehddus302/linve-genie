// BND1 E2E — 콘솔 "밴드" 칸 한 흐름 (AC-BND1-71·72·74·75, AC-BND1-80 ②③④⑤⑪). 여러 플랫폼 묶음(@multi — 가짜 밴드 읽기 1초·3초).
// 기대값은 acceptance.md: 이을 때 있던 댓글은 넣지 않음(기준선), 손님 댓글 → 보드 1등·채팅 줄 "밴드", 판매자 댓글은 넣지 않음,
// 한 번에 잡힌 댓글은 작성 시각 순, 지운·고친 댓글은 알림만(찜 그대로), 끊은 뒤·방송을 끝낸 뒤 댓글은 없음.
import { expect, test } from '@playwright/test'
import {
  READ_WAIT,
  T,
  band,
  bandComment,
  bandComments,
  bandUser,
  bandWorld,
  boardItem,
  chatPanel,
  cleanupBand,
  consoleBand,
  escapeRe,
  linkView,
  linkedBroadcast,
  openRealBroadcast,
  registerApi,
  scopeView,
  alertStrip,
} from './support.ts'

test.describe('BND1 콘솔 밴드 칸 @multi', () => {
  test.describe.configure({ timeout: 180_000 })
  test.afterEach(async ({ page }) => {
    await cleanupBand(page)
  })

  test('AC-BND1-80 ②: 밴드 둘 중 고르기 → 내 글만 보임 → 확인 창 → 잇기 → 기준선 3개 문장 · 보드에 찜 0 @multi', async ({ page }) => {
    const w = await bandWorld(page, { baseline: 3 })
    const { b, date } = await openRealBroadcast(page)
    await registerApi(page, b, 1, '핑크프릴', 12_000)
    const region = consoleBand(page)
    await region.getByRole('button', { name: T.linkStart }).click()
    const pickBand = page.getByRole('dialog', { name: '밴드 고르기' })
    const bands = pickBand.getByRole('list', { name: '가입한 밴드' }).getByRole('button')
    await expect(bands).toHaveCount(2)
    await bands.filter({ hasText: w.bandAName }).click()
    const posts = page.getByRole('dialog', { name: '내 글 고르기' })
    const list = posts.getByRole('list', { name: '내가 쓴 글' })
    await expect(list.getByRole('button')).toHaveCount(1)
    await expect(list.getByRole('button').first()).toContainText(w.postLine)
    await expect(list.getByRole('button').first()).toContainText('댓글 3개')
    await expect(posts.getByText(w.otherLine)).toHaveCount(0)
    await list.getByRole('button').first().click()
    const confirm = page.getByRole('dialog', { name: '이 글 잇기' })
    await expect(confirm.getByText(T.confirm)).toBeVisible()
    await confirm.getByRole('button', { name: '잇기', exact: true }).click()
    await expect(confirm).toHaveCount(0)
    await expect(region.getByText(T.reading)).toBeVisible()
    await expect(region.getByText(T.baseline(3))).toBeVisible()
    await expect(region.getByText(w.postLine)).toBeVisible()
    await expect(region.getByText('받은 댓글 0개')).toBeVisible()
    await expect(region.getByText(/\d{2}:\d{2}:\d{2}에 읽었어요/)).toBeVisible({ timeout: READ_WAIT })
    const view = await scopeView(page, date, false)
    expect(view.claims).toHaveLength(0)
    expect(view.products.find((p) => p.no === 1)?.winners).toEqual([])
  })

  test('AC-BND1-80 ②: 밴드에 내 글이 없으면 "이 밴드에 내가 쓴 글이 없어요…" @multi', async ({ page }) => {
    const w = await bandWorld(page, { baseline: 0 })
    await openRealBroadcast(page)
    await consoleBand(page).getByRole('button', { name: T.linkStart }).click()
    await page.getByRole('dialog', { name: '밴드 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.bandBName)) }).click()
    await expect(page.getByRole('dialog', { name: '내 글 고르기' }).getByText(T.noPosts)).toBeVisible()
  })

  // "1번 2개요"는 STRICT 기본 설정 파서 골든(chat.yaml "15번 2개 가능해요?" → 언급만)대로 찜이 아니다 — AC-BND1-33 "그 회차 파서 결과대로".
  // 수용 기준 ③의 "1번 2개요 → 1등"은 골든과 어긋나 스펙 확인 필요로 올리고, 여기서는 골든대로 언급만 + "1번이요" → 1등을 본다.
  test('AC-BND1-80 ③: 손님 "1번 2개요"는 파서대로 언급만 · "1번이요" → 보드 1번 1등·채팅 줄 "밴드" · 판매자 댓글 "1번 마감"은 찜·채팅에 없음 @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { date } = await linkedBroadcast(page, w)
    const guest = await bandUser(page.request, '초록손님')
    await bandComment(page.request, w.post, { content: '1번 2개요', name: '초록손님', userKey: guest })
    const chat = chatPanel(page)
    await expect(chat.getByText('1번 2개요')).toBeVisible({ timeout: READ_WAIT })
    expect((await scopeView(page, date, false)).claims).toHaveLength(0)
    await bandComment(page.request, w.post, { content: '1번이요', name: '초록손님', userKey: guest })
    await expect(boardItem(page, 1)).toContainText('초록손님', { timeout: READ_WAIT })
    const line = chat.getByRole('listitem').filter({ hasText: '1번이요' })
    await expect(line).toHaveCount(1)
    await expect(line).toContainText('밴드')
    // 판매자 본인 댓글
    await bandComment(page.request, w.post, { content: '1번 마감', name: w.profileName, userKey: w.me })
    const after = await bandComment(page.request, w.post, { content: '그냥 인사요', name: '다른손님', userKey: await bandUser(page.request, '다른손님') })
    expect(after).toBeTruthy()
    await expect(chat.getByText('그냥 인사요')).toBeVisible({ timeout: READ_WAIT })
    await expect(chat.getByText('1번 마감')).toHaveCount(0)
    const view = await scopeView(page, date, false)
    const p1 = view.products.find((p) => p.no === 1)!
    expect(p1.winners).toHaveLength(1)
    const winner = view.claims.find((c) => c.id === p1.winners[0])?.buyer ?? p1.winners[0]
    expect(winner).toBe(`band:${guest}`)
    expect(view.claims.filter((c) => c.buyer === `band:${w.me}`)).toHaveLength(0)
    await expect(consoleBand(page).getByText('받은 댓글 3개')).toBeVisible()
  })

  test('AC-BND1-80 ④: 같은 시각 두 댓글 + 이른 시각 하나를 한 번에 → 기록 차례 = 작성 시각 순(보드 1등·대기 순서) @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { date } = await linkedBroadcast(page, w)
    const keys = await Promise.all(['늦은갑', '늦은을', '이른병'].map((n) => bandUser(page.request, n)))
    const t = Date.now()
    // 목록에 단 차례: 늦은갑(t) · 늦은을(t) · 이른병(t-5초) — 기록 차례는 이른병 → 늦은갑 → 늦은을
    await bandComments(page.request, w.post, [
      { content: '1번', name: '늦은갑', userKey: keys[0]!, createdAt: t },
      { content: '1번', name: '늦은을', userKey: keys[1]!, createdAt: t },
      { content: '1번', name: '이른병', userKey: keys[2]!, createdAt: t - 5000 },
    ])
    await expect(boardItem(page, 1)).toContainText('이른병', { timeout: READ_WAIT })
    await expect.poll(async () => (await scopeView(page, date, false)).claims.length, { timeout: READ_WAIT }).toBe(3)
    const view = await scopeView(page, date, false)
    const p1 = view.products.find((p) => p.no === 1)!
    const buyerOf = (id: string) => view.claims.find((c) => c.id === id)?.buyer ?? id
    expect([...p1.winners, ...p1.waitlist].map(buyerOf)).toEqual([`band:${keys[2]!}`, `band:${keys[0]!}`, `band:${keys[1]!}`])
    const seqs = view.claims.slice().sort((a, b) => a.seq - b.seq).map((c) => c.buyer)
    expect(seqs).toEqual([`band:${keys[2]!}`, `band:${keys[0]!}`, `band:${keys[1]!}`])
  })

  test('AC-BND1-80 ⑤·73·74: 손님 댓글 지우기·고치기 → 알림 띠 "확인하지 않은 밴드 알림이 2개 있어요." → 밴드 칸 문장 둘·"새 알림" → 확인했어요 → 줄 사라짐 · 찜 그대로 @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { b, date } = await linkedBroadcast(page, w, [
      { no: 1, name: '핑크프릴', price: 12_000 },
      { no: 2, name: '블루엘프', price: 8_000 },
    ])
    const a = await bandUser(page.request, '지울손님')
    const c = await bandUser(page.request, '고칠손님')
    const ka = await bandComment(page.request, w.post, { content: '1번이요', name: '지울손님', userKey: a })
    const kc = await bandComment(page.request, w.post, { content: '2번이요', name: '고칠손님', userKey: c })
    await expect(boardItem(page, 1)).toContainText('지울손님', { timeout: READ_WAIT })
    await expect(boardItem(page, 2)).toContainText('고칠손님', { timeout: READ_WAIT })
    const before = await scopeView(page, date, false)
    await band(page.request, 'drop', { postKey: w.post, commentKey: ka })
    await band(page.request, 'edit', { postKey: w.post, commentKey: kc, content: '2번 취소할게요' })
    const strip = alertStrip(page)
    await expect(strip.getByText(T.notices(2), { exact: true })).toBeVisible({ timeout: READ_WAIT })
    // D-BND1-17: 옛 문장("밴드에서 지우거나 고친 댓글이 …")은 없다 — 띠 N은 확인하지 않은 밴드 알림 전부
    await expect(page.getByText(T.oldEdits)).toHaveCount(0)
    expect((await linkView(page, b)).notices.unseen).toBe(2)
    const region = consoleBand(page)
    const notices = region.getByRole('list', { name: '밴드 알림' })
    await expect(notices.getByText(T.deleted('지울손님', '1번이요'), { exact: true })).toBeVisible()
    await expect(notices.getByText(T.edited('고칠손님', '2번이요', '2번 취소할게요'), { exact: true })).toBeVisible()
    await expect(notices.getByText(T.newNotice, { exact: true })).toHaveCount(2)
    await strip.getByRole('button', { name: T.seen }).click()
    await expect(strip.getByText(T.notices(2))).toHaveCount(0)
    await expect(notices.getByText(T.newNotice, { exact: true })).toHaveCount(0)
    // 찜은 그대로
    const after = await scopeView(page, date, false)
    expect(after.claims.map((x) => [x.id, x.status])).toEqual(before.claims.map((x) => [x.id, x.status]))
    expect(after.products.map((p) => p.winners)).toEqual(before.products.map((p) => p.winners))
    // 그 뒤 새 알림이 오면 다시 뜬다
    const k3 = await bandComment(page.request, w.post, { content: '1번 하나 더', name: '또손님', userKey: await bandUser(page.request, '또손님') })
    await expect(chatPanel(page).getByText('1번 하나 더')).toBeVisible({ timeout: READ_WAIT })
    await band(page.request, 'drop', { postKey: w.post, commentKey: k3 })
    await expect(strip.getByText(T.notices(1))).toBeVisible({ timeout: READ_WAIT })
  })

  test('AC-BND1-80 ⑪: 끊기 확인 창 → 그 뒤 단 댓글은 보드에 없음(다시 이으면 기준선) · 방송 끝내기 → 그 뒤 단 댓글도 없음 @multi', async ({ page, browser }) => {
    const w = await bandWorld(page)
    const { b, date } = await linkedBroadcast(page, w)
    const region = consoleBand(page)
    await region.getByRole('button', { name: '끊기', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: '밴드 연결 끊기' })
    await expect(dlg.getByText(T.unlinkQuestion)).toBeVisible()
    await dlg.getByRole('button', { name: '끊기', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    await expect(region.getByText(T.unlinked, { exact: true })).toBeVisible()
    await bandComment(page.request, w.post, { content: '1번 끊은 뒤요', name: '늦은손님', userKey: await bandUser(page.request, '늦은손님') })
    // 같은 글을 다시 이으면 끊긴 동안 달린 댓글은 기준선이 된다 (AC-BND1-22) — 끊긴 동안 기록됐다면 찜이 있다
    await region.getByRole('button', { name: T.linkOther }).click()
    await page.getByRole('dialog', { name: '밴드 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.bandAName)) }).click()
    await page.getByRole('dialog', { name: '내 글 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.postLine)) }).click()
    await page.getByRole('dialog', { name: '이 글 잇기' }).getByRole('button', { name: '잇기', exact: true }).click()
    await expect(region.getByText(T.baseline(4))).toBeVisible()
    expect((await scopeView(page, date, false)).claims).toHaveLength(0)

    // 방송 끝내기 → 그 뒤 단 댓글은 없다 (마지막 읽기 없음)
    await page.getByRole('button', { name: '방송 끝내기' }).click()
    await page.getByRole('dialog', { name: '방송 끝내기' }).getByRole('button', { name: '끝내기' }).click()
    await expect(page.getByText('끝난 방송이에요')).toBeVisible()
    await expect.poll(async () => (await linkView(page, b)).state, { timeout: READ_WAIT }).toBe('FINISHED')
    await page.reload()
    await expect(consoleBand(page).getByText(T.ended, { exact: true })).toBeVisible()
    await bandComment(page.request, w.post, { content: '1번 끝난 뒤요', name: '끝손님', userKey: await bandUser(page.request, '끝손님') })
    // 시계 대신 다른 판매자의 읽기를 증인으로: 그쪽 읽기가 새 댓글 둘을 차례로 받을 동안(읽기 두 차례 이상) 이쪽에는 없다
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    const other = await ctx.newPage()
    try {
      const w2 = await bandWorld(other, { baseline: 0, oneBand: true })
      await linkedBroadcast(other, w2)
      for (const text of ['1번 증인 하나', '1번 증인 둘']) {
        await bandComment(other.request, w2.post, { content: text, name: '증인', userKey: await bandUser(other.request, '증인') })
        await expect(chatPanel(other).getByText(text)).toBeVisible({ timeout: READ_WAIT })
      }
      await cleanupBand(other)
    } finally {
      await ctx.close()
    }
    const view = await scopeView(page, date, false)
    expect(view.claims).toHaveLength(0)
    expect((await linkView(page, b)).received).toBe(0)
  })
})
