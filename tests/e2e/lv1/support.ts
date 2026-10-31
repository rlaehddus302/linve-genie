// LV1 방송 소리로 듣기 E2E 도우미 (test-e2e).
// playwright.config.ts의 STACKS에는 --stream-audio fake 묶음이 없다(지적 TE-LV1-001). 그래서 이 묶음은 시험이 직접
// 서버(가짜 유튜브 + --stream-audio fake|off)와 화면 미리 보기를 띄운다. 7700 포트는 쓰지 않는다.
// 조작: 서버의 POST /_e2e/stream-audio { op: cut|restore|delay|unsupported|supported|say, ms? } (LV1 dev-notes ## server).
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, type APIRequestContext, type Page } from '@playwright/test'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const offset = Number(process.env['E2E_PORT_OFFSET'] ?? '0')

/** 그 묶음 화면 주소 — E2E_PORT_OFFSET을 따른다(startAudioStack과 같은 포트) */
export function audioWebUrl(mode: 'fake' | 'off'): string {
  return `http://localhost:${String(5195 + (mode === 'fake' ? 0 : 1) + offset)}`
}

export interface AudioStack { api: string; web: string; youtube: string; stop(): Promise<void> }

async function up(url: string): Promise<boolean> {
  try { return (await fetch(url)).ok } catch { return false }
}

async function waitUp(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`시험 서버가 멈췄다: ${url}`)
    if (await up(url)) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`시험 서버가 뜨지 않았다: ${url}`)
}

/** mode fake: 가짜 방송 소리 + 모의 일꾼, off: 운영자 끔 */
export async function startAudioStack(mode: 'fake' | 'off'): Promise<AudioStack> {
  const n = mode === 'fake' ? 0 : 1
  const apiPort = 3130 + n + offset, webPort = 5195 + n + offset, ytPort = 4130 + n + offset
  const api = `http://127.0.0.1:${String(apiPort)}`
  const children: ChildProcess[] = []
  if (!(await up(`${api}/api/health`))) {
    const server = spawn('pnpm', ['--filter', '@livejjim/server', 'e2e', '--port', String(apiPort), '--origin', `http://localhost:${String(webPort)}`,
      '--host-delay-ms', '2000', '--youtube', 'fake', '--youtube-port', String(ytPort), '--youtube-chat', 'web', '--outbox-fast', 'yes', '--stream-audio', mode],
    { cwd: ROOT, stdio: 'ignore', detached: true })
    children.push(server)
    await waitUp(`${api}/api/health`, server, 120_000)
  }
  if (!(await up(`http://127.0.0.1:${String(webPort)}`))) {
    const web = spawn('node', ['e2e/serve.ts', '--port', String(webPort), '--api', api], { cwd: `${ROOT}/apps/web`, stdio: 'ignore', detached: true })
    children.push(web)
    await waitUp(`http://127.0.0.1:${String(webPort)}`, web, 180_000)
  }
  return {
    api,
    web: `http://localhost:${String(webPort)}`,
    youtube: `http://127.0.0.1:${String(ytPort)}`,
    async stop() {
      for (const child of children) { try { if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM') } catch { /* 이미 끝남 */ } }
    },
  }
}

export async function fake<T = Record<string, unknown>>(request: APIRequestContext, stack: AudioStack, path: string, data: unknown = {}): Promise<T> {
  const res = await request.post(`${stack.youtube}${path}`, { data })
  expect(res.ok(), `${path} ${await res.text()}`).toBe(true)
  return await res.json() as T
}

export async function audioOp(request: APIRequestContext, stack: AudioStack, op: 'cut' | 'restore' | 'delay' | 'unsupported' | 'supported' | 'say', ms?: number): Promise<void> {
  const res = await request.post(`${stack.api}/_e2e/stream-audio`, { data: { op, ...(ms === undefined ? {} : { ms }) } })
  expect(res.ok(), await res.text()).toBe(true)
}

export async function newSellerLogin(page: Page, stack: AudioStack): Promise<{ loginId: string; password: string }> {
  const res = await page.request.post(`${stack.api}/_e2e/sellers`, { data: {} })
  expect(res.ok(), await res.text()).toBe(true)
  const seller = await res.json() as { loginId: string; password: string }
  await page.goto('/settings')
  await page.getByLabel('아이디').fill(seller.loginId)
  await page.getByLabel('비밀번호').fill(seller.password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByRole('navigation', { name: '메뉴' })).toBeVisible()
  const wiz = await page.request.put('/api/wizard', { data: { status: 'DONE' }, headers: { Origin: new URL(page.url()).origin } })
  expect(wiz.ok(), await wiz.text()).toBe(true)
  return seller
}

export async function connectYoutube(page: Page, stack: AudioStack): Promise<{ id: string }> {
  const channel = await fake<{ id: string; account: string }>(page.request, stack, '/_fake/channels', { title: '테스트 채널' })
  await fake(page.request, stack, '/_fake/approval', { account: channel.account, channel: channel.id })
  await page.goto('/settings/youtube')
  const yt = page.getByRole('region', { name: '유튜브', exact: true })
  await yt.getByRole('button', { name: '구글로 유튜브 연결하기' }).click()
  await expect(page.getByText('유튜브 채널을 연결했어요.')).toBeVisible()
  return channel
}

function todayKst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** 실제 방송을 만들고 콘솔을 연다 (아직 잇지 않음) */
export async function openBroadcast(page: Page): Promise<string> {
  const res = await page.request.post('/api/broadcasts', { data: { requestId: crypto.randomUUID(), date: todayKst(), rehearsal: false, title: '소리 회차' }, headers: { Origin: new URL(page.url()).origin } })
  const body = await res.json() as { broadcast?: { id: string }; result?: { b?: string } }
  const b = body.broadcast?.id ?? body.result?.b
  if (typeof b !== 'string') throw new Error(JSON.stringify(body))
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
  return b
}

/** 방송 주소만 붙여 잇기 */
export async function linkAddress(page: Page, videoId: string): Promise<void> {
  const yt = page.getByRole('region', { name: '유튜브', exact: true })
  const field = yt.getByLabel('주소 붙여넣기')
  await field.fill(`https://www.youtube.com/watch?v=${videoId}`)
  await field.press('Enter')
  await expect(yt.getByText(`읽은 영상: ${videoId}`)).toBeVisible()
  await yt.getByRole('button', { name: '이 방송에 잇기' }).last().click()
  const group = yt.getByRole('group', { name: '채팅 수집' })
  const confirm = yt.getByRole('button', { name: '맞아요, 잇기' })
  await expect(group.or(confirm)).toBeVisible()
  if (await confirm.isVisible()) await confirm.click()
  await expect(group).toBeVisible()
}

export function audioLine(page: Page) {
  return page.getByRole('region', { name: '듣는 곳' })
}

export function productItem(page: Page, no: number) {
  return page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: new RegExp(`^${String(no)}번 `) })
}
