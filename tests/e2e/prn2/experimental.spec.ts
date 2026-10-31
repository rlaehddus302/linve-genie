// AC-PRN2-06 (실험 표시·테스트 인쇄 "예" 뒤 출력)·AC-PRN2-08 (크기 목록·목록 밖 크기) — 시험용 프린터가 실험 기종을 흉내 낸다.
import { expect, test } from '@playwright/test'
import { B1_SIZES, BAUATO, BAUATO_APP, becomeOutputDevice, confirmTestPrint, connectAs, D110, setTestProfile, experimentalNotice, gotoLabels, loginNewSeller, openRealBroadcast, postJson, printed, queueOf, region, registerApi, smsApi } from './support.ts'

test('AC-PRN2-06: 실험 기종(바우아토)은 이름 뒤 "(실험)"과 안내 한 줄 (L-7 문장 그대로)', async ({ page }) => {
  await loginNewSeller(page)
  await connectAs(page, BAUATO.id)
  const printer = region(page, '프린터')
  await expect(printer.getByText(`${BAUATO.name} (실험)`, { exact: true })).toBeVisible()
  const note = printer.getByRole('note', { name: '실험 중인 프린터 안내' })
  await expect(note).toBeVisible()
  await expect(note).toContainText(experimentalNotice(BAUATO_APP))
  const text = await page.locator('main').innerText()
  expect(text).not.toMatch(/BAUATO|LUCKJINGLE|experimental|undefined|null/)
})

test('AC-PRN2-06: 확인됨(B1)에는 "(실험)"도 실험 안내도 없다', async ({ page }) => {
  await loginNewSeller(page)
  await connectAs(page, null)
  const printer = region(page, '프린터')
  await expect(printer.getByText('NIIMBOT B1', { exact: true })).toBeVisible()
  await expect(printer.getByText('(실험)')).toHaveCount(0)
  await expect(printer.getByRole('note', { name: '실험 중인 프린터 안내' })).toHaveCount(0)
  await expect(printer.getByRole('button', { name: '이 기기에서 출력' })).toBeVisible()
})

test('AC-PRN2-06: 실험 기종은 테스트 인쇄 "예" 뒤에만 "이 기기에서 출력"이 보이고, 끊었다 다시 이으면 처음부터', async ({ page }) => {
  await loginNewSeller(page)
  await connectAs(page, BAUATO.id)
  const printer = region(page, '프린터')
  const output = printer.getByRole('button', { name: '이 기기에서 출력' })
  await expect(output).toHaveCount(0)
  await expect(printer.getByText('실험 중인 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 이 기기에서 출력할 수 있어요.')).toBeVisible()
  await printer.getByRole('button', { name: '테스트 인쇄' }).click()
  const result = printer.getByRole('group', { name: '테스트 인쇄 결과' })
  // 인쇄만 하고 "예"를 누르기 전에는 아직 숨김
  await expect(result).toBeVisible()
  await expect(output).toHaveCount(0)
  await result.getByRole('button', { name: '예' }).click()
  await expect(output).toBeVisible()
  // 끊었다 다시 이으면 처음부터
  await printer.getByRole('button', { name: '연결 끊기' }).click()
  await printer.getByRole('button', { name: /시험용 프린터/ }).click()
  await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
  await expect(output).toHaveCount(0)
})

test('AC-PRN2-08: 출력 기기가 알린 프로필 ID만 서버에 있고, 크기 목록이 프로필 따라 바뀐다 (바우아토 → 테이프 → 끊으면 B1)', async ({ page }) => {
  await loginNewSeller(page)
  const settings = region(page, '라벨 설정')
  await connectAs(page, BAUATO.id)
  await becomeOutputDevice(page, 'PC', true)
  await expect.poll(async () => (await queueOf(page)).device?.profileId).toBe(BAUATO.id)
  expect((await queueOf(page)).labelSizes).toEqual(['50x30', '50x15', '50x50'])
  const sizeNames = async () => (await settings.getByRole('radio').evaluateAll((els) => els.map((e) => e.closest('label')?.textContent?.trim() ?? ''))).filter((x) => x.includes('mm'))
  await expect.poll(async () => (await sizeNames()).slice(0, 3)).toEqual([...BAUATO.sizes])
  await expect(settings.getByRole('radio', { name: '50×40mm' })).toHaveCount(0)
  // 서버 기록에 이름·기기 ID가 없다: 응답 어디에도 프린터 이름 글이 없다
  expect(JSON.stringify(await (await page.request.get('/api/print')).json())).not.toContain(BAUATO.name)

  // 테이프 프린터(D110)로 바꾸면 테이프 크기
  await region(page, '프린터').getByRole('button', { name: '출력 그만하기' }).click()
  await connectAs(page, D110.id)
  await becomeOutputDevice(page, 'PC', true)
  await expect.poll(async () => (await queueOf(page)).device?.profileId).toBe(D110.id)
  for (const name of D110.sizes) await expect(settings.getByRole('radio', { name })).toBeVisible()
  await expect(settings.getByRole('radio', { name: '50×30mm' })).toHaveCount(0)

  // 출력 그만하기 → 프로필을 모르니 B1 목록
  await region(page, '프린터').getByRole('button', { name: '출력 그만하기' }).click()
  await expect.poll(async () => (await queueOf(page)).device).toBeNull()
  expect((await queueOf(page)).labelSizes).toEqual(['50x30', '50x20', '50x40'])
  for (const name of B1_SIZES) await expect(settings.getByRole('radio', { name })).toBeVisible()
})

test('AC-PRN2-08: 표에 없는 프로필 ID는 400이 아니라 모름(B1 목록), 글이 아닌 값은 400', async ({ page }) => {
  await loginNewSeller(page)
  const base = { deviceId: 'prn2-dev-unknown1', name: 'PC' }
  const unknown = await postJson(page, '/api/print/device', { ...base, profileId: 'NOPE_9000' })
  expect(unknown.status, JSON.stringify(unknown.body)).toBe(200)
  const q = await queueOf(page)
  expect(q.device?.profileId ?? null).toBeNull()
  expect(q.labelSizes).toEqual(['50x30', '50x20', '50x40'])
  const bad = await postJson(page, '/api/print/device', { ...base, profileId: 12 })
  expect(bad.status).toBe(400)
  const known = await postJson(page, '/api/print/device', { ...base, profileId: 'MARKLIFE_LP15' })
  expect(known.status).toBe(200)
  expect((await queueOf(page)).device?.profileId).toBe('MARKLIFE_LP15')
  // 칸을 빼면 앞 값을 잇지 않고 모름
  expect((await postJson(page, '/api/print/device', base)).status).toBe(200)
  expect((await queueOf(page)).device?.profileId ?? null).toBeNull()
})

test('AC-PRN2-08: 목록에 없는 크기(50×40)의 저장된 템플릿 → 바우아토 출력 기기에서 라벨 오류로 멈추고 쉬운 문장 + 설정에 경고', async ({ page }) => {
  await loginNewSeller(page)
  const { defaultTemplate } = await import('@livejjim/label')
  const before = await (await page.request.get('/api/print/templates')).json() as { product: { version: number } }
  const put = await page.request.put('/api/print/templates/product', { data: { template: defaultTemplate('product', '50x40'), version: before.product.version }, headers: { Origin: new URL(page.url()).origin } })
  expect(put.ok(), await put.text()).toBe(true)
  const { b } = await openRealBroadcast(page)
  await connectAs(page, BAUATO.id)
  await becomeOutputDevice(page, 'PC', true)
  const printedBefore = (await printed(page)).length
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  const pause = region(page, '출력 멈춤')
  await expect(pause).toContainText('라벨을 만들지 못해 멈췄어요. 라벨 설정을 확인한 뒤 다시 시작해 주세요.')
  await expect(page.getByText('이 프린터는 50×40 라벨을 찍을 수 없어요. 라벨 설정에서 크기를 바꿔 주세요.').first()).toBeVisible()
  expect((await queueOf(page)).pause?.reason).toBe('LABEL_ERROR')
  expect((await printed(page)).length).toBe(printedBefore) // 한 장도 찍지 않았다
  await gotoLabels(page)
  await expect(region(page, '라벨 설정').getByRole('note', { name: '라벨 크기 경고' })).toContainText('이 프린터는 50×40 라벨을 찍을 수 없어요. 라벨 설정에서 크기를 바꿔 주세요.')
})

test('AC-PRN2-06 (D-PRN2-10·15): 출력 기기에 실험 프린터를 이으면 "예" 전까지 받지 않고 멈춤 문장만 보이며, "예" 뒤 멈췄던 출력을 이어서 한다', async ({ page }) => {
  await loginNewSeller(page)
  const { b } = await openRealBroadcast(page)
  await connectAs(page, null)
  await becomeOutputDevice(page, 'PC', false)
  // 출력 기기 그대로 실험 기종(바우아토)으로 바꿔 잇는다
  await setTestProfile(page, BAUATO.id)
  const printer = region(page, '프린터')
  await printer.getByRole('button', { name: /시험용 프린터/ }).click()
  await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
  const pause = region(page, '출력 멈춤')
  await expect(pause).toContainText('실험 중인 프린터라 출력을 잠시 멈췄어요. 테스트 인쇄를 하고 "예"를 누르면 다시 출력해요.')
  await expect(pause.getByRole('button', { name: '다시 연결' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다시 연결' })).toHaveCount(0)
  await expect(printer.getByRole('status').filter({ hasText: '실험 중인 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 라벨을 찍어요.' })).toBeVisible()
  // "예" 전에 들어온 작업은 찍히지 않는다
  const before = (await printed(page)).length
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  await expect.poll(async () => (await queueOf(page)).waiting).toBeGreaterThan(0)
  expect((await printed(page)).length).toBe(before)
  // 테스트 인쇄 → "예" → 이어서 출력
  await confirmTestPrint(page)
  await expect(printer.getByRole('status').filter({ hasText: '좋아요. 멈췄던 출력을 이어서 해요.' })).toBeVisible()
  await expect.poll(async () => (await printed(page)).length).toBe(before + 2) // 테스트 인쇄 1장 + 대기하던 라벨 1장
  await expect(pause).toHaveCount(0)
})

test('AC-PRN2-06 (D-PRN2-15): 끊었다 다시 이으면 "예"는 지워지고 다시 받기를 멈춘다', async ({ page }) => {
  await loginNewSeller(page)
  await connectAs(page, BAUATO.id)
  await becomeOutputDevice(page, 'PC', true)
  const printer = region(page, '프린터')
  await printer.getByRole('button', { name: '연결 끊기' }).click()
  await printer.getByRole('button', { name: /시험용 프린터/ }).click()
  await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
  await expect(region(page, '출력 멈춤')).toContainText('실험 중인 프린터라 출력을 잠시 멈췄어요.')
})
