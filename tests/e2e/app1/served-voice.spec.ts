// APP1 실제 운영 CSP 경계: 합성 장치의 실제 AudioWorklet/PCM → WS → 서버 읽기 → 기존 쓰기 API.
// CSP·캡처·브라우저 오디오 API를 가짜로 바꾸지 않는다. ASR 공급자만 결정적인 최종 글을 돌려준다.
import { once } from 'node:events'
import { test, expect } from '@playwright/test'
import { WebSocket } from 'ws'
import { boardItem, login, openNewBroadcast, uniqueDate } from '../s05/support.ts'

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

interface CaptureObservation {
  captureCalls: number
  tracks: MediaStreamTrack[]
  violations: { directive: string; blocked: string }[]
}

test('@served AC-APP1-30·34·APP1b-04·I3-70: 엄격한 CSP에서 실제 AudioWorklet PCM·등록 1건·끄기 정리, CSP 위반 0', async ({ page, baseURL }) => {
  const origin = baseURL ?? ''
  const workerUrl = new URL('/api/voice/worker', origin)
  workerUrl.protocol = 'ws:'
  const worker = new WebSocket(workerUrl, { headers: { Authorization: 'Bearer livejjim-e2e-transcribe-worker' } })
  const frames = new Map<number, number>()
  const closed: number[] = []
  const invalidFrameSizes: number[] = []
  worker.on('message', (raw, binary) => {
    const bytes = Buffer.from(raw as Buffer)
    if (binary) {
      if (bytes.length !== 3204) invalidFrameSizes.push(bytes.length)
      if (bytes.length < 4) return
      const stream = bytes.readUInt32BE(0)
      frames.set(stream, (frames.get(stream) ?? 0) + 1)
    } else {
      const message = JSON.parse(bytes.toString()) as { type: string; stream: number }
      if (message.type === 'open') frames.set(message.stream, 0)
      if (message.type === 'close') closed.push(message.stream)
    }
  })
  try {
    await once(worker, 'open')
    worker.send(JSON.stringify({ type: 'hello', maxStreams: 1 }))
    const response = await page.request.get('/login')
    expect(response.status()).toBe(200)
    const csp = response.headers()['content-security-policy'] ?? ''
    expect(csp).toMatch(/(?:^|;\s*)script-src 'self'(?:;|$)/)
    expect(csp).toMatch(/(?:^|;\s*)worker-src 'self'(?:;|$)/)
    // img-src의 기존 blob: 그림 허용과 구분한다. 실행 코드·일꾼에는 self만 허용한다.
    expect(csp.split(';').map((part) => part.trim()).filter((part) => /^(?:script|worker)-src\b/.test(part))).toEqual(["script-src 'self'", "worker-src 'self'"])
    expect(csp).not.toContain("'unsafe-eval'")
    const consoleViolations: string[] = []
    page.on('console', (message) => {
      if (/content security policy|refused to|violates.*directive/i.test(message.text())) consoleViolations.push(message.text())
    })
    await page.addInitScript(() => {
      const observation: CaptureObservation = { captureCalls: 0, tracks: [], violations: [] }
      ;(window as unknown as { __servedVoice: CaptureObservation }).__servedVoice = observation
      document.addEventListener('securitypolicyviolation', (event) => {
        observation.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI })
      })
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        observation.captureCalls++
        const stream = await original(constraints)
        observation.tracks.push(...stream.getTracks())
        return stream
      }
    })
    await page.setViewportSize({ width: 375, height: 812 })
    await login(page)
    const date = uniqueDate()
    const broadcast = await openNewBroadcast(page, { date, rehearsal: true })
    const writes: Record<string, unknown>[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/events') writes.push(request.postDataJSON() as Record<string, unknown>)
    })
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await page.getByRole('dialog', { name: '음성으로 상품 등록' }).getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect.poll(() => [...frames.values()].some((count) => count >= 30)).toBe(true)
    expect(invalidFrameSizes).toEqual([])
    const stream = [...frames.keys()][0]!
    // 실제 일꾼은 0.4초 쉼 뒤 최종 글을 돌려준다. 말 끝은 그 쉼 앞의 표본 위치다.
    const endMs = Math.max(0, (frames.get(stream) ?? 0) * 100 - 400)
    worker.send(JSON.stringify({ type: 'result', stream, text: '15번 핑크프릴 이만 원', startMs: Math.max(0, endMs - 1000), endMs, procMs: 15 }))
    await expect(boardItem(page, 15)).toContainText('핑크프릴')
    await expect(boardItem(page, 15)).toContainText('20,000원')
    expect(writes.filter((value) => value['type'] === 'product.register' && value['no'] === 15)).toHaveLength(1)
    const view = await page.request.get(`/api/days/${date}?rehearsal=true`)
    expect(view.status()).toBe(200)
    const data = await view.json() as { products: { broadcast: string; no: number; name: string; price: number }[] }
    expect(data.products.filter((product) => product.broadcast === broadcast && product.no === 15)).toEqual([
      expect.objectContaining({ no: 15, name: '핑크프릴', price: 20000 }),
    ])
    await page.getByRole('button', { name: '음성 끄기', exact: true }).click()
    await expect.poll(() => closed.includes(stream)).toBe(true)
    await expect.poll(() => page.evaluate(() => {
      const observation = (window as unknown as { __servedVoice: CaptureObservation }).__servedVoice
      return observation.tracks.length > 0 && observation.tracks.every((track) => track.readyState === 'ended')
    })).toBe(true)
    const observation = await page.evaluate(() => {
      const state = (window as unknown as { __servedVoice: CaptureObservation }).__servedVoice
      return { captureCalls: state.captureCalls, violations: state.violations }
    })
    expect(observation.captureCalls).toBe(1)
    expect(observation.violations).toEqual([])
    expect(consoleViolations).toEqual([])
  } finally { worker.terminate() }
})
