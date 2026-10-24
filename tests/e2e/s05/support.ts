// S05 E2E 공용 도우미 (test-e2e). 선택자는 역할·이름 기반(dev-notes "화면 이름").
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'

export const LOGIN_ID = 'e2e-shop'
export const PASSWORD = 'e2e-pass-1234'

/** 오늘(KST) YYYY-MM-DD */
export function todayKst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

let dayCounter = 0
const dayBase = Math.floor(Math.random() * 2000) * 3
/**
 * 이 실행(Playwright 실행기 하나)에서 이미 쓴 날짜를 적는 곳. 시험이 실패하면 Playwright가 일꾼 프로세스를 새로 띄우고,
 * 새 일꾼은 dayBase를 새로 뽑고 dayCounter를 0부터 센다 — 앞 일꾼이 쓴 날짜와 겹치면 같은 서버의 그날 하루 보기(/api/days)에
 * 다른 시험의 방송·찜이 섞인다. 일꾼은 모두 같은 실행기의 자식이므로 실행기 pid(ppid)로 묶어 날짜마다 폴더를 만들어 차지한다(mkdir은 원자적).
 */
const claimedDir = join(tmpdir(), 'livejjim-e2e-dates', String(process.ppid))
mkdirSync(claimedDir, { recursive: true })
/** 시험끼리 범위가 겹치지 않게 과거의 서로 다른 날짜를 쓴다(알림 띠는 범위 전체를 센다). 한 실행 안에서는 일꾼이 바뀌어도 겹치지 않는다. */
export function uniqueDate(): string {
  for (;;) {
    dayCounter += 1
    const date = new Date(Date.UTC(2005, 0, 1) + (dayBase + dayCounter) * 86_400_000).toISOString().slice(0, 10)
    try {
      mkdirSync(join(claimedDir, date))
      return date
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

export async function login(page: Page): Promise<void> {
  await page.goto('/login') // LND1 D-LND1-01
  await page.getByLabel('아이디').fill(LOGIN_ID)
  await page.getByLabel('비밀번호').fill(PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  // MOB1 D-MOB1-05: 휴대폰 판매자는 위 줄에 "로그아웃"이 없다 — 로그인 확인은 메뉴로
  await expect(page.getByRole('navigation', { name: '메뉴' })).toBeVisible()
}

/** 홈에서 새 방송을 만들고 콘솔로 간다. 방송 ID를 돌려준다. */
export async function newBroadcast(page: Page, opts: { title?: string; date?: string } = {}): Promise<string> {
  await page.getByRole('button', { name: '새 방송 시작' }).click()
  if (opts.title !== undefined) await page.getByLabel('제목').fill(opts.title)
  if (opts.date !== undefined) await page.getByLabel('날짜').fill(opts.date)
  await page.getByRole('button', { name: '이 방송 시작하기' }).click()
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  const m = /\/broadcasts\/([^/?#]+)/.exec(page.url())
  if (m === null) throw new Error(`콘솔 주소가 아니다: ${page.url()}`)
  return decodeURIComponent(m[1] ?? '')
}

export async function newRehearsal(page: Page): Promise<string> {
  await page.getByRole('button', { name: '리허설 해 보기' }).click()
  await expect(page.getByText('리허설 중 — 실제 판매가 아니에요')).toBeVisible()
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  const m = /\/broadcasts\/([^/?#]+)/.exec(page.url())
  if (m === null) throw new Error(`콘솔 주소가 아니다: ${page.url()}`)
  return decodeURIComponent(m[1] ?? '')
}

export function board(page: Page) {
  return page.getByRole('region', { name: '상품 보드' })
}

export function boardItem(page: Page, no: number) {
  return board(page).getByRole('button', { name: new RegExp(`^${String(no)}번 `) })
}

/** 빠른 입력으로 한 줄 등록하고 보드에 나타날 때까지 기다린다. */
export async function register(page: Page, line: string, no: number): Promise<void> {
  const input = page.getByLabel('빠른 입력')
  await input.fill(line)
  await input.press('Enter')
  await expect(boardItem(page, no)).toBeVisible()
  await expect(input).toHaveValue('')
}

interface Broadcast { id: string; date: string; rehearsal: boolean; title: string }

/** 화면과 같은 출처로 보내는 쓰기 (서버는 Origin을 확인한다) */
export async function postJson(page: Page, path: string, data: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await page.request.post(path, { data, headers: { Origin: new URL(page.url()).origin } })
  return { status: res.status(), body: await res.json() as Record<string, unknown> }
}

export async function broadcastInfo(page: Page, id: string): Promise<Broadcast> {
  const res = await page.request.get('/api/broadcasts')
  expect(res.ok()).toBe(true)
  const body = await res.json() as { broadcasts: Broadcast[] }
  const b = body.broadcasts.find((x) => x.id === id)
  if (b === undefined) throw new Error(`방송 ${id} 없음`)
  return b
}

export interface HistoryItem { seq: number; type: string; actor: { kind: string; loginId: string | null }; reason: string | null; fields: Record<string, unknown>; failed: boolean }

/** 범위 이력 전체(이어 받기) */
export async function history(page: Page, date: string, rehearsal: boolean): Promise<HistoryItem[]> {
  const out: HistoryItem[] = []
  let after = 0
  for (;;) {
    const res = await page.request.get(`/api/days/${date}/history?after=${String(after)}&limit=500${rehearsal ? '&rehearsal=true' : ''}`)
    if (res.status() === 404 && after === 0) return out
    expect(res.ok(), await res.text()).toBe(true)
    const body = await res.json() as { events: HistoryItem[] }
    out.push(...body.events)
    if (body.events.length < 500) break
    after = body.events[body.events.length - 1]!.seq
  }
  return out
}

export async function day(page: Page, date: string, rehearsal: boolean): Promise<Record<string, unknown>> {
  const res = await page.request.get(`/api/days/${date}${rehearsal ? '?rehearsal=true' : ''}`)
  expect(res.ok(), await res.text()).toBe(true)
  return await res.json() as Record<string, unknown>
}

export async function sendViewerChat(page: Page, b: string, nick: string, text: string, channel?: string): Promise<void> {
  const res = await page.request.post(`/api/broadcasts/${b}/rehearsal/chat`, {
    data: { requestId: crypto.randomUUID(), nick, text, ...(channel === undefined ? {} : { channel }) },
    headers: { Origin: new URL(page.url()).origin },
  })
  expect(res.ok(), await res.text()).toBe(true)
}

/** 날짜를 정해 방송을 API로 만들고 그 콘솔을 연다 (시험끼리 범위를 나눈다 — 알림 띠는 범위 전체를 센다) */
export async function openNewBroadcast(page: Page, opts: { date: string; rehearsal: boolean; title?: string }): Promise<string> {
  if (!page.url().startsWith('http')) await page.goto('/')
  const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date: opts.date, rehearsal: opts.rehearsal, ...(opts.title === undefined ? {} : { title: opts.title }) })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  const b = (res.body['result'] as Record<string, unknown> | undefined)?.['b'] ?? (res.body['broadcast'] as Record<string, unknown> | undefined)?.['id'] ?? res.body['b'] ?? res.body['id']
  if (typeof b !== 'string') throw new Error(`방송 ID를 찾지 못함: ${JSON.stringify(res.body)}`)
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  return b
}

/** 브라우저 시계로 ms가 지날 때까지 기다린다(대기 시간이 "지났음"을 확인할 때만 — 상태로 기다릴 수 없는 "보내지 않음" 확인용) */
export async function untilElapsed(page: Page, since: number, ms: number): Promise<void> {
  await page.waitForFunction((end) => Date.now() >= end, since + ms, { timeout: ms + 10_000 })
}
