// AC-I1-14·25·26·12·50 — 라벨 설정 저장이 대기 작업에 반영, 템플릿만 바뀐 것은 재출력 필요 아님, 시험 모드 끈 서버
import { expect, test } from '@playwright/test'
import { becomeDevice, cleanupPrint, gotoLabels, login, postJson, printed, realBroadcast, region, registerApi, scopeLabels, smsApi, TEST_PRINTER, uniqueDate, waitPrinted } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

test('AC-I1-14·12: 멈춘 사이 라벨 크기를 50×40으로 저장 → 대기 작업은 새 템플릿으로 그려 찍고, 이미 찍은 라벨은 재출력 필요가 아니다', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  const settings = region(page, '라벨 설정')
  await settings.getByRole('radio', { name: '50×30mm' }).check()
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  await waitPrinted(page, 1)
  const [first] = await printed(page)
  expect(first!.height).toBe(240)

  await postJson(page, '/api/print/pause', {})
  await registerApi(page, b, 2, '품종2', 1000)
  await smsApi(page, { b, no: 2 })
  await expect(region(page, '출력 대기열').getByRole('list', { name: '대기 작업' })).toContainText('2번')
  await settings.getByRole('radio', { name: '50×40mm' }).check()
  await settings.getByRole('button', { name: '라벨 설정 저장' }).click()
  await expect(settings.getByText('라벨 설정을 저장했어요.')).toBeVisible()
  await region(page, '출력 멈춤').getByRole('button', { name: '다시 시작' }).click()
  await waitPrinted(page, 2)
  const images = await printed(page)
  expect(images[1]!.height).toBe(320)
  const labels = await scopeLabels(page, date)
  const one = labels.find((l) => l.no === 1 && l.winner)!
  expect(one.reprintNeeded).toBe(false)
  expect(one.word).toBe('라벨 출력됨')

  // 되돌리기 (뒤 시험이 50×30 기본을 본다)
  await settings.getByRole('radio', { name: '50×30mm' }).check()
  await settings.getByRole('button', { name: '기본으로 되돌리기' }).click()
  await settings.getByRole('button', { name: '라벨 설정 저장' }).click()
  await expect(settings.getByText('라벨 설정을 저장했어요.')).toBeVisible()
})

test('AC-I1-50: 시험 모드가 아닌 서버 — 연결 방법에 시험용 프린터가 없고 손잡이도 없다 @no-test-printer', async ({ page }) => {
  await login(page)
  await gotoLabels(page)
  const printer = region(page, '프린터')
  await expect(printer.getByText(/이 기기의 프린터|이 브라우저에서는 프린터에 바로 연결할 수 없어요/)).toBeVisible()
  await expect(printer.getByRole('button', { name: TEST_PRINTER })).toHaveCount(0)
  await expect(page.getByText('시험용 프린터 조작')).toHaveCount(0)
  expect(await page.evaluate(() => 'livejjimTestPrinter' in window)).toBe(false)
  const config = await (await page.request.get('/api/client-config')).json() as { testPrinter: boolean }
  expect(config.testPrinter).toBe(false)
})

test('AC-I1-21: 바로 연결할 수 없는 브라우저(블루투스·USB 없음) — 안내 문장과 그림 파일로 저장하는 곳, 출력 기기가 될 수 없다 @no-test-printer', async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of ['bluetooth', 'serial']) {
      try {
        Object.defineProperty(Navigator.prototype, key, { get: () => undefined, configurable: true })
      } catch {
        // 무시
      }
    }
  })
  await login(page)
  await gotoLabels(page)
  const printer = region(page, '프린터')
  await expect(printer).toContainText('이 브라우저에서는 프린터에 바로 연결할 수 없어요. 라벨을 그림 파일로 저장해 NIIMBOT 앱에서 인쇄해 주세요.')
  await expect(printer.getByRole('link', { name: '그림 파일로 저장하기' })).toBeVisible()
  await expect(printer.getByRole('button', { name: '이 기기에서 출력' })).toHaveCount(0)
  await expect(printer.getByRole('button', { name: /블루투스로 연결|USB 선으로 연결/ })).toHaveCount(0)
})
