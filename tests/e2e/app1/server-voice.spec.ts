// APP1b 독립 E2E: 실제 브라우저 캡처·WS·서버 읽기·기존 쓰기 API를 함께 검증한다.
import { once } from 'node:events'
import { test, expect } from '@playwright/test'
import { WebSocket } from 'ws'
import { boardItem, login, openNewBroadcast, register, uniqueDate } from '../s05/support.ts'

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

async function worker() {
  const offset = Number(process.env['E2E_PORT_OFFSET'] ?? '0')
  const socket = new WebSocket(`ws://127.0.0.1:${3100 + offset}/api/voice/worker`, { headers: { Authorization: 'Bearer livejjim-e2e-transcribe-worker' } })
  const frames = new Map<number, number>()
  const closed: number[] = []
  socket.on('message', (raw, binary) => {
    const bytes = Buffer.from(raw as Buffer)
    if (binary) {
      expect(bytes.length).toBe(3204)
      const stream = bytes.readUInt32BE(0)
      frames.set(stream, (frames.get(stream) ?? 0) + 1)
    } else {
      const message = JSON.parse(bytes.toString()) as { type: string; stream: number }
      if (message.type === 'open') frames.set(message.stream, 0)
      if (message.type === 'close') closed.push(message.stream)
    }
  })
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'hello', maxStreams: 4 }))
  return {
    frames, closed,
    result(stream: number, text: string) {
      const endMs = Math.max(0, (frames.get(stream) ?? 0) * 100 - 400)
      socket.send(JSON.stringify({ type: 'result', stream, text, startMs: Math.max(0, endMs - 1000), endMs, procMs: 15 }))
    },
    close: () => socket.terminate(),
  }
}

test('AC-APP1b-04·15·16: 375px 실제 PCM→서버 읽기→상품 등록과 끄기 정리', async ({ page }) => {
  const transcriber = await worker()
  try {
    await page.setViewportSize({ width: 375, height: 812 })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    const writes: Record<string, unknown>[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/events') writes.push(request.postDataJSON() as Record<string, unknown>)
    })
    expect(transcriber.frames.size).toBe(0)
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    const consent = page.getByRole('dialog', { name: '음성으로 상품 등록' })
    await expect(consent).toContainText('라이브지니 받아쓰기 서버')
    await consent.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect.poll(() => [...transcriber.frames.values()].some((count) => count >= 30)).toBe(true)
    const stream = [...transcriber.frames.keys()][0]!
    transcriber.result(stream, '15번 2만 원')
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(boardItem(page, 15)).toContainText('20,000')
    expect(writes.filter((value) => value['type'] === 'product.register' && value['no'] === 15)).toHaveLength(1)
    await page.getByRole('button', { name: '음성 끄기', exact: true }).click()
    await expect.poll(() => transcriber.closed.includes(stream)).toBe(true)
    transcriber.result(stream, '16번 3만 원')
    await register(page, '17 40000', 17)
    expect(writes.filter((value) => value['type'] === 'product.register' && value['no'] === 16)).toHaveLength(0)
  } finally { transcriber.close() }
})

test('AC-APP1-일꾼없음: 받아쓰기 준비가 안 되면 오류를 보이고 손 입력은 계속 된다', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page)
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
  await page.getByRole('dialog', { name: '음성으로 상품 등록' }).getByRole('button', { name: '음성 켜기', exact: true }).click()
  await expect(page.getByRole('region', { name: '음성 등록' })).toContainText(/준비|멈춤/)
  await register(page, '18 25000', 18)
  await expect(boardItem(page, 18)).toContainText('25,000')
})
