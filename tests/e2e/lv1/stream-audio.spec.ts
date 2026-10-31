// LV1 방송 소리로 듣기 (SPEC VOC-08, D-LV1-03~10) — 연습 라이브 한 바퀴를 PC 1440·휴대폰 375 폭에서.
// 기준: harness/sprints/LV1/acceptance.md AC-LV1-01·02·05·06·07·09·12·13. 문장은 acceptance 그대로.
// 등록 시험은 콘솔의 조작 전용 음성 흐름이 hello를 "듣는 중"으로 보내야만 통과한다(그 줄이 깨지면 받아쓴 글이 버려져 15번이 생기지 않는다).
import { expect, test, type Page } from '@playwright/test'
import { audioWebUrl, audioLine, audioOp, connectYoutube, fake, linkAddress, newSellerLogin, openBroadcast, productItem, startAudioStack, type AudioStack } from './support.ts'

const LOW_LATENCY = "유튜브 방송 설정에서 지연 시간을 '초저지연'으로 하면 더 빨리 등록돼요."
const LISTENING = '방송 소리로 듣는 중'
const RECONNECTING = '방송 소리 다시 잇는 중'
const STOPPED = '방송 소리 듣기 멈춤'
const LATE = '방송 소리가 늦어요. 휴대폰 마이크로 들으면 더 빨라요.'
const MIC = '휴대폰 마이크로 듣는 중'
const FORBIDDEN = /HLS|ffmpeg|PCM|stream|listening|phase|worker|일꾼|웹소켓/i

const SIZES = [{ name: 'PC 1440', width: 1440, height: 900 }, { name: '휴대폰 375', width: 375, height: 812 }] as const

let stack: AudioStack
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { test.setTimeout(300_000); stack = await startAudioStack('fake') })
test.afterAll(async () => { await stack.stop() })
test.use({ baseURL: audioWebUrl('fake'), permissions: ['microphone'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } })
// 시험용 모의 일꾼은 흐름 하나만 받는다. 다음 시험이 '바쁨'으로 다시 잇기에 빠지지 않게, 끝난 시험 판매자의 설정을 꺼 흐름을 바로 닫는다.
test.afterEach(async ({ page, request }) => {
  await audioOp(request, stack, 'restore')
  if (page.url().startsWith('http')) await page.request.put('/api/settings/stream-audio', { data: { enabled: false }, headers: { Origin: new URL(page.url()).origin } })
})

/** 새 판매자 → 구글 연결 → 콘솔 → 주소 잇기 → 첫 안내 창 확인 → 듣는 중 */
async function listeningConsole(page: Page): Promise<{ liveChatId: string; b: string }> {
  await newSellerLogin(page, stack)
  const channel = await connectYoutube(page, stack)
  const live = await fake<{ videoId: string; liveChatId: string }>(page.request, stack, '/_fake/broadcasts', { channelId: channel.id, status: 'live', title: '오늘 라이브' })
  const b = await openBroadcast(page)
  // 첫 안내 창은 콘솔을 열면 뜬다(아직 잇기 전 '방송을 이으면 …' 상태에서도). 확인한 뒤 주소를 잇는다.
  const dialog = page.getByRole('dialog', { name: '방송 소리로 듣기' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(LOW_LATENCY)
  await expect(dialog).not.toContainText(FORBIDDEN)
  await dialog.getByRole('button', { name: '확인하고 듣기' }).click()
  await expect(dialog).toBeHidden()
  await linkAddress(page, live.videoId)
  await expect(audioLine(page)).toContainText(LISTENING, { timeout: 15_000 })
  return { liveChatId: live.liveChatId, b }
}

for (const size of SIZES) {
  test.describe(`${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test(`AC-LV1-01·12·13 ${size.name}: 주소만 잇고 안내 창 확인 → 마이크·버튼 없이 15번 핑크프릴 20,000원 등록`, async ({ page, request }) => {
      await listeningConsole(page)
      // 처음 여는 소리 흐름은 표지 소리를 한 번 말한다. 이미 쓴 서버면 다시 말하게 한다.
      await audioOp(request, stack, 'say')
      const item = productItem(page, 15)
      await expect(item).toBeVisible({ timeout: 30_000 })
      await expect(item).toContainText('핑크프릴')
      await expect(item).toContainText('20,000')
      await expect(page.getByRole('button', { name: '음성 끄기' })).toHaveCount(0) // 마이크를 켜지 않았다
      await expect(audioLine(page)).not.toContainText(FORBIDDEN)
    })

    test(`AC-LV1-05 ${size.name}: 끊으면 다시 잇는 중, 계속 끊기면 멈춤 문장과 [다시 켜기]·[휴대폰으로 듣기], 그동안 빠른 입력은 됨`, async ({ page, request }) => {
      await listeningConsole(page)
      await audioOp(request, stack, 'cut')
      await expect(audioLine(page)).toContainText(RECONNECTING, { timeout: 3_000 })
      // 1·2·4·8초 다시 잇기 — 60초 안 여섯 번째 끊김이면 멈춤
      await expect(audioLine(page).getByRole('alert')).toContainText(STOPPED, { timeout: 60_000 })
      await expect(audioLine(page).getByRole('button', { name: '다시 켜기' })).toBeVisible()
      await expect(audioLine(page).getByRole('button', { name: '휴대폰으로 듣기' })).toBeVisible()
      const input = page.getByLabel('빠른 입력')
      await input.fill('3 장미 5000')
      await input.press('Enter')
      await expect(productItem(page, 3)).toBeVisible()
      await audioOp(request, stack, 'restore')
      await audioLine(page).getByRole('button', { name: '다시 켜기' }).click()
      await expect(audioLine(page)).toContainText(LISTENING, { timeout: 15_000 })
      await expect(audioLine(page).getByRole('button', { name: '다시 켜기' })).toHaveCount(0)
    })

    test(`AC-LV1-06·13 ${size.name}: 30초 넘게 늦으면 늦음 문장, 29초엔 없음`, async ({ page, request }) => {
      const { b } = await listeningConsole(page)
      await audioOp(request, stack, 'delay', 29_000)
      // 서버가 29초 늦음을 알게 될 때까지 기다린 뒤(상태 1초마다 읽음) 화면을 본다
      await expect.poll(async () => ((await (await page.request.get(`/api/broadcasts/${encodeURIComponent(b)}/stream-audio`)).json()) as { lagMs?: number }).lagMs ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(28_000)
      await expect(page.getByText(LATE)).toHaveCount(0)
      await expect(audioLine(page)).toContainText(LISTENING)
      await expect(page.getByText(LATE)).toHaveCount(0)
      await audioOp(request, stack, 'delay', 31_000)
      await expect(page.getByText(LATE)).toBeVisible({ timeout: 10_000 })
      await expect(audioLine(page)).toContainText(LISTENING)
    })

    test(`AC-LV1-07 ${size.name}: 휴대폰 마이크를 켜면 "휴대폰 마이크로 듣는 중", 끄면 방송 소리로 돌아감`, async ({ page }) => {
      await listeningConsole(page)
      await page.getByRole('button', { name: '음성 켜기' }).first().click()
      const consent = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '음성 켜기' }) })
      if (await consent.isVisible()) await consent.getByRole('button', { name: '음성 켜기' }).click()
      await expect(audioLine(page)).toContainText(MIC, { timeout: 15_000 })
      await expect(audioLine(page)).not.toContainText(LISTENING)
      await page.getByRole('button', { name: '음성 끄기' }).click()
      await expect(audioLine(page)).toContainText(LISTENING, { timeout: 15_000 })
    })

    test(`AC-LV1-09·12 ${size.name}: 설정에서 끄면 칸은 꺼짐, 콘솔은 듣지 않음 문장(듣는 중 아님)`, async ({ page }) => {
      await newSellerLogin(page, stack)
      await page.goto('/settings')
      const region = page.getByRole('region', { name: '방송 소리로 듣기', exact: true })
      await expect(region).toContainText(LOW_LATENCY)
      await expect(region).not.toContainText(FORBIDDEN)
      const box = region.getByRole('checkbox', { name: '방송 소리로 듣기' })
      await expect(box).toBeChecked()
      await box.click() // 저장 응답 뒤에 바뀌는 칸이라 uncheck()의 즉시 확인 대신 상태를 기다린다
      await expect(box).not.toBeChecked()
      await expect(region).toContainText('지금: 꺼짐')
      const channel = await connectYoutube(page, stack)
      const live = await fake<{ videoId: string }>(page.request, stack, '/_fake/broadcasts', { channelId: channel.id, status: 'live' })
      await openBroadcast(page)
      await linkAddress(page, live.videoId)
      await expect(audioLine(page)).toContainText('방송 소리로 듣기가 꺼져 있어요. 설정에서 켤 수 있어요.')
      await expect(page.getByRole('dialog', { name: '방송 소리로 듣기' })).toHaveCount(0)
      await expect(audioLine(page)).not.toContainText(LISTENING)
    })
  })
}
