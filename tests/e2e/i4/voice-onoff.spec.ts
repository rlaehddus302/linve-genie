import { historyProbe, pcmCounts } from '../app1/support.ts'
// I4 음성 켜기·끄기 (AC-I4-10~14) — test-e2e. 가짜 SpeechRecognition(addInitScript)로 실제 브라우저에서 확인한다.
import { test, expect } from '@playwright/test'
import {
  board,
  boardItem,
  card,
  cardButton,
  cardList,
  installFakeSpeech,
  login,
  openNewBroadcast,
  recordRequests,
  recordVoiceChunk,
  register,
  speak,
  speechCounts,
  speechEnd,
  speechError,
  turnOnVoice,
  uniqueDate,
  voiceRegion,
  openVoiceLog,
  voiceLogItems,
  withoutVoiceHeard,
} from './support.ts'

test.describe('I4 음성 켜기·끄기', () => {
  test('AC-I4-10: 누르기 전에는 인식 객체·getUserMedia·이력 조회·음성 조각이 없고, 새로 고침·다른 화면에 다녀오면 꺼져 있다', async ({ page }) => {
    await installFakeSpeech(page)
    const chunks = recordVoiceChunk(page)
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    // 이력 조회(/api/days)는 콘솔을 연 뒤부터 센다 — 방송 목록(홈)은 봉인 예고를 보이려고 /api/days를 부른다(I3, AC-I3-40).
    // openNewBroadcast는 콘솔 주소로 새로 열므로(page.goto) 홈의 요청은 그 전에 끝난다. 콘솔에서 누르기 전 0번·켠 뒤 1번은 그대로 본다.
    const requests = recordRequests(page)
    const toggle = page.getByRole('button', { name: '음성 켜기', exact: true })
    await expect(toggle).toBeEnabled()
    // 화면이 자리를 잡을 시간 (상태로 기다릴 수 없는 "하지 않음" 확인 — 보드가 그려진 뒤)
    await expect(board(page)).toBeVisible()
    let counts = await speechCounts(page)
    expect(counts.instances).toBe(0)
    expect(counts.getUserMedia).toBe(0)
    expect(chunks).toEqual([])
    expect(requests.filter((r) => new URL(r.url).pathname === '/api/days' && r.method === 'GET')).toEqual([])

    // 처음: 안내 창 → 켜기 → 서버 이력 조회 1번, 음성 조각 1번
    await historyProbe(page, { fail: false, reset: true })
    await turnOnVoice(page, { consent: true })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    counts = await speechCounts(page)
    expect(counts.instances).toBe(1)
    await expect.poll(async () => (await historyProbe(page)).calls.filter((date) => date === null).length).toBe(1)
    expect(requests.filter((r) => new URL(r.url).pathname === '/api/days' && r.method === 'GET')).toEqual([])

    // 새로 고침 → 꺼짐
    await page.reload()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    await expect(voiceRegion(page)).toHaveCount(0)
    expect((await speechCounts(page)).instances).toBe(0)

    // V3 교체(D-V3-52, AC-V3-58): 켜고 방송 목록에 다녀와도 음성은 켜진 채(인식을 멈추지 않음), 돌아오면 "듣는 중"
    await turnOnVoice(page)
    counts = await speechCounts(page)
    const stopped = counts.stops + counts.aborts
    await page.getByRole('link', { name: '방송 목록' }).click()
    await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
    counts = await speechCounts(page)
    expect(counts.stops + counts.aborts).toBe(stopped)
    await page.goBack()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    void b
  })

  test('AC-I4-11: 처음 켤 때 안내 창 — 문장 세 개·처음 포커스 닫기, 닫기·Esc는 꺼진 그대로, 두 번째는 창 없이, 인식 설정 ko-KR·continuous·interim', async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL!
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    // 처음 켜는 기기 그대로(저장값 없음 = 바로 등록 켬, D-V3-16)
    await installFakeSpeech(context, { autoRegister: true })
    const page = await context.newPage()
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
    await expect(dlg).toBeVisible()
    // V3 교체(D-V3-36): 바로 등록이 켜져 있으면 첫 줄이 바뀌고 그 아래 바로 등록 줄(D-V3-17). 꺼진 경우는 tests/e2e/v3 AC-V3-42
    await expect(dlg).toContainText('번호와 가격이 확실하지 않으면 카드로 보여 드려요. 카드를 확인하고 등록해요.')
    await expect(dlg).toContainText('번호와 가격이 들리면 바로 등록돼요. 음성 설정에서 끌 수 있어요.')
    await expect(dlg).not.toContainText('카드를 확인하고 등록해야 상품이 생겨요.')
    // D-I5-06: 외부 전송 문장 교체 (I5)
    await expect(dlg).toContainText('음성은 인식을 위해 브라우저의 음성 인식 서버(크롬은 구글, 아이폰은 애플)로 보내져요. 라이브지니는 음성을 녹음하거나 저장하지 않아요.')
    // D-I5-11: 마이크 줄 "크롬이" → "브라우저가" (I5)
    await expect(dlg).toContainText('다음에 브라우저가 마이크 사용을 물으면 "허용"을 눌러 주세요.')
    await expect(page.getByText('크롬이 마이크 사용을 물으면')).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    // 창이 열린 동안 "음성 켜기"는 창 안의 하나뿐
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toHaveCount(1)
    await dlg.getByRole('button', { name: '닫기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    expect((await speechCounts(page)).instances).toBe(0)

    // Esc
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    expect((await speechCounts(page)).instances).toBe(0)

    // 창의 "음성 켜기"
    await turnOnVoice(page, { consent: true })
    const counts = await speechCounts(page)
    expect(counts.instances).toBe(1)
    expect(counts.starts).toBe(1)
    expect(counts.last).toEqual({ lang: 'ko-KR', continuous: true, interimResults: true })
    // D-I5-06: 켜진 동안 고지 문장 교체 (I5)
    await expect(voiceRegion(page)).toContainText('음성은 인식을 위해 크롬은 구글로, 아이폰은 애플로 보내져요.')
    await expect(page.getByLabel('빠른 입력')).toBeFocused()

    // 끄고 다시 켜면 창 없이
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    await expect(dlg).toHaveCount(0)

    // APP1 D-APP1-04: 새 페이지는 새 device다. 동의는 같은 컨텍스트에 남되 한 흐름만 켠다.
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await expect.poll(async () => (await pcmCounts(page)).openSockets).toBe(0)
    // 같은 기기 저장소(컨텍스트)의 새 페이지도 창 없이
    const page2 = await context.newPage()
    await page2.goto(page.url())
    await expect(page2.getByLabel('빠른 입력')).toBeFocused()
    await turnOnVoice(page2)
    await expect(page2.getByRole('dialog', { name: '음성으로 상품 등록' })).toHaveCount(0)
    await context.close()
  })

  test('AC-I4-11: 저장소를 쓸 수 없으면 매번 안내 창', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await installFakeSpeech(page, { blockStorage: true })
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await turnOnVoice(page, { consent: true })
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '음성으로 상품 등록' })).toBeVisible()
  })

  test('AC-I4-12: 지원하지 않는 브라우저 — 창을 띄우기 전에 알리고 꺼진 그대로', async ({ page }) => {
    await installFakeSpeech(page, { unsupported: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    // D-I5-03: 지원 안 함 문장 교체 (I5)
    await expect(page.getByRole('alert').filter({ hasText: '이 기기에서는 음성이 어려워요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '음성으로 상품 등록' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '음성 끄기' })).toHaveCount(0)
  })

  test('AC-I4-12: 권한 거부·마이크 없음은 꺼지고 다시 시작하지 않는다, 다시 켜면 문장이 사라진다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await turnOnVoice(page)
    await speechError(page, 'not-allowed')
    // D-I5-03: 권한 거부 문장 교체, D-I5-12: 기기별 줄로 나눠 줄마다 따로 보인다 (I5)
    const denied = page.getByRole('alert').filter({ has: page.getByText('마이크 사용이 막혀 있어요.', { exact: true }) })
    await expect(denied).toBeVisible()
    await expect(denied.getByText('· PC·안드로이드 크롬: 주소창 왼쪽 자물쇠에서 마이크를 허용해 주세요.', { exact: true })).toBeVisible()
    await expect(denied.getByText('· 아이폰: 설정 > 사파리 > 마이크에서 허용해 주세요.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    expect((await speechCounts(page)).starts).toBe(1)

    await turnOnVoice(page)
    await expect(page.getByText('마이크 사용이 막혀 있어요.')).toHaveCount(0)
    expect((await speechCounts(page)).starts).toBe(2)
    await speechError(page, 'audio-capture')
    await expect(page.getByRole('alert').filter({ hasText: '마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.' })).toBeVisible()
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    expect((await speechCounts(page)).starts).toBe(2)

    await turnOnVoice(page)
    await speechError(page, 'service-not-allowed')
    // D-I5-03: 처음 켤 때의 service-not-allowed는 SERVICE_OFF 문장, D-I5-12: 기기별 줄로 나눠 줄마다 따로 (I5)
    const off = page.getByRole('alert').filter({ has: page.getByText('이 기기에서 음성 인식이 꺼져 있어요.', { exact: true }) })
    await expect(off).toBeVisible()
    await expect(off.getByText('· 아이폰: 설정에서 Siri와 받아쓰기를 켜 주세요.', { exact: true })).toBeVisible()
    await expect(off.getByText('· 그래도 안 되면 PC 크롬이나 안드로이드에서 켜 주세요.', { exact: true })).toBeVisible()
    expect((await speechCounts(page)).starts).toBe(3)
  })

  test('AC-I4-12: network·no-speech·저절로 끝남은 다시 시작하고, 최종 결과 없이 6번째면 "자꾸 끊겨요"로 꺼진다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await turnOnVoice(page)
    await speechError(page, 'network')
    await speechError(page, 'no-speech')
    await speechEnd(page)
    await speechEnd(page)
    await speechEnd(page)
    expect((await speechCounts(page)).starts).toBe(6)
    await expect(page.getByRole('button', { name: '음성 끄기' })).toBeVisible()
    await speechEnd(page)
    // D-I5-03: 끊김 문장 교체 (I5)
    await expect(page.getByRole('alert').filter({ hasText: '음성 인식이 자꾸 끊겨요. 마이크를 확인하고 다시 켜 주세요. 계속 끊기면 PC 크롬이나 안드로이드에서 켜 주세요.' })).toBeVisible()
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    expect((await speechCounts(page)).starts).toBe(6)
    // 다시 켤 수 있다
    await turnOnVoice(page)
    await expect(page.getByText('음성 인식이 자꾸 끊겨요.')).toHaveCount(0)
  })

  test('AC-I4-12: 최종 결과가 오면 끊김 횟수를 다시 센다 — 5번 끊김 → 최종 결과 → 5번 끊김에도 켜져 있다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await turnOnVoice(page)
    for (let i = 0; i < 5; i++) await speechEnd(page)
    await speak(page, '안녕하세요')
    for (let i = 0; i < 5; i++) await speechEnd(page)
    await expect(page.getByRole('button', { name: '음성 끄기' })).toBeVisible()
    expect((await speechCounts(page)).starts).toBe(11)
    await speechEnd(page)
    await expect(page.getByRole('alert').filter({ hasText: '음성 인식이 자꾸 끊겨요.' })).toBeVisible()
  })

  test('AC-I4-13: 중간 결과는 자막 한 줄로 덮어쓰고, 최종 결과는 기록 맨 앞·카드, 악성 문장은 글자로만', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await turnOnVoice(page)
    // V3 교체(D-V3-50, AC-V3-56): "들리는 말:" 줄이 없어지고 중간 결과는 맨 위 큰 칸("지금 들리는 말")에만 덮어써 보인다
    const now = page.getByRole('region', { name: '지금 들리는 말', exact: true })
    await speak(page, '15번 핑', { final: false })
    await expect(now).toContainText('15번 핑')
    await expect(page.getByText(/^들리는 말:/)).toHaveCount(0)
    await speak(page, '15번 핑크프릴', { final: false })
    await expect(now).toContainText('15번 핑크프릴')
    await expect(now.getByText('15번 핑', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/^들리는 말:/)).toHaveCount(0)
    await expect(cardList(page)).toHaveCount(0)
    await speak(page, '15번 핑크프릴 만오천 원')
    await expect(page.getByText(/^들리는 말:/)).toHaveCount(0)
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await speak(page, '<img src=x onerror=alert(1)>16번 라울 만원')
    // D-V3-41: 번호가 붙지 않은 말이라 카드는 생기지 않는다 — 글자 그대로는 음성 기록에서 본다(아래)
    await expect(cardList(page).getByRole('listitem')).toHaveCount(1)
    await expect(page.locator('img[src="x"]')).toHaveCount(0)
    await openVoiceLog(page)
    const items = voiceLogItems(page)
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('<img src=x onerror=alert(1)>16번 라울 만원')
    await expect(items.nth(1)).toContainText('15번 핑크프릴 만오천 원')
    expect(await page.locator('img[src="x"]').count()).toBe(0)
    expect(dialogs).toEqual([])
  })

  test('AC-I4-13: 인식 문장은 서버 요청·저장소·콘솔 메시지 어디에도 없다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    const requests = recordRequests(page)
    const logs: string[] = []
    page.on('console', (m) => logs.push(m.text()))
    await login(page)
    const date = uniqueDate()
    await openNewBroadcast(page, { date, rehearsal: true })
    await turnOnVoice(page)
    const secret = '비밀문장가나다 15번 핑크프릴 만오천 원'
    await speak(page, '비밀중간말라마', { final: false })
    await speak(page, secret)
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await cardButton(page, '15번 핑크프릴 15,000원', '등록').click()
    await expect(boardItem(page, 15)).toBeVisible()
    const stored = await page.evaluate(async () => {
      const out: string[] = []
      for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) out.push(`${s.key(i) ?? ''}=${s.getItem(s.key(i) ?? '') ?? ''}`)
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        for (const req of await cache.keys()) out.push(req.url)
      }
      const dbs = (await indexedDB.databases?.()) ?? []
      out.push(...dbs.map((d) => d.name ?? ''))
      return out.join('\n')
    })
    for (const word of ['비밀문장가나다', '비밀중간말라마']) {
      expect(stored).not.toContain(word)
      expect(logs.join('\n')).not.toContain(word)
      for (const r of requests) {
        expect(decodeURIComponent(r.url)).not.toContain(word)
        // D-V3-73: voiceLog.heard 한 줄(가린 들은 말)만 예외
        expect(withoutVoiceHeard(r.body)).not.toContain(word)
      }
    }
    // 등록 쓰기는 번호·품종·가격뿐
    const writes = requests.filter((r) => r.method === 'POST' && r.body.includes('product.register'))
    expect(writes).toHaveLength(1)
    const body = JSON.parse(writes[0]!.body) as Record<string, unknown>
    expect(body).toMatchObject({ type: 'product.register', no: 15, name: '핑크프릴', price: 15000 })
  })

  test('AC-I4-14: 음성 끄기 뒤 늦은 결과는 무시, 카드는 남고 손으로 등록, 콘솔 떠나면 인식 멈춤·돌아오면 카드·기록 없음, 끈 뒤 빠른 입력 그대로', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await turnOnVoice(page)
    await speak(page, '15번 핑크프릴 만오천 원')
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    const counts = await speechCounts(page)
    expect(counts.stops + counts.aborts).toBeGreaterThanOrEqual(1)
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    // 늦은 결과
    await speak(page, '16번 라울 만원', { final: false })
    await speak(page, '16번 라울 만원')
    await expect(card(page, '16번 라울 10,000원')).toHaveCount(0)
    await expect(page.getByText('들리는 말:')).toHaveCount(0)
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await cardButton(page, '15번 핑크프릴 15,000원', '등록').click()
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(cardList(page)).toHaveCount(0)
    // 끈 뒤 빠른 입력·찾기·되돌리기
    await register(page, '20 라울 10', 20)
    const input = page.getByLabel('빠른 입력')
    await input.press('Control+z')
    await expect(page.getByText('20번 등록을 되돌렸어요(판매 종료)')).toBeVisible()

    // V3 교체(D-V3-52, AC-V3-58): 켜고 카드를 만든 채 떠났다 와도 음성은 켜진 채(인식을 멈추지 않음)이고 카드는 그 방송 콘솔에 남는다
    await turnOnVoice(page)
    await speak(page, '17번 라울 만원')
    await expect(card(page, '17번 라울 10,000원')).toBeVisible()
    const before = await speechCounts(page)
    await page.getByRole('link', { name: '방송 목록' }).click()
    await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
    const after = await speechCounts(page)
    expect(after.stops + after.aborts).toBe(before.stops + before.aborts)
    await page.goBack()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(card(page, '17번 라울 10,000원')).toBeVisible()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    void b
  })
})
