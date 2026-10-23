// V1 E2E 공용 도우미 (test-e2e): 음성 문자찜. I4 가짜 음성 인식 계약 그대로(addInitScript로 SpeechRecognition 바꾸기).
// 선택자·문장은 harness/sprints/V1/acceptance.md AC-V1-20~30과 dev-notes "test-e2e가 잡을 이름".
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { installFakeSpeech, login, openNewBroadcast, turnOnVoice, uniqueDate, type FakeSpeechOptions } from '../i4/support.ts'

export * from '../i4/support.ts'

/** 문자찜 설정 저장 키 (그 기기 — D-V1-09) */
export const SMS_SETTINGS_KEY = 'livejjim.voiceSmsSettings'

/** 가짜 인식 + (선택) 문자찜 설정을 페이지를 열기 전에 깐다 */
export async function installSmsSpeech(target: Page | BrowserContext, options: FakeSpeechOptions & { smsSettings?: unknown; smsRaw?: string } = {}): Promise<void> {
  await installFakeSpeech(target, { consent: true, ...options })
  if (options.smsSettings !== undefined || options.smsRaw !== undefined) {
    const raw = options.smsRaw ?? JSON.stringify(options.smsSettings)
    await target.addInitScript(({ key, raw }) => {
      try {
        // 처음 한 번만 (다시 열기 시험이 화면이 저장한 값을 보게)
        if (window.sessionStorage.getItem('__v1_sms_seeded') === null) {
          window.localStorage.setItem(key, raw)
          window.sessionStorage.setItem('__v1_sms_seeded', '1')
        }
      } catch {
        // about:blank
      }
    }, { key: SMS_SETTINGS_KEY, raw })
  }
}

export function voiceSettings(page: Page) {
  return page.getByRole('region', { name: '음성 설정과 기록' })
}

export function smsListenBox(page: Page) {
  return voiceSettings(page).getByRole('checkbox', { name: '문자찜도 듣기' })
}

export function smsAutoSecField(page: Page) {
  return voiceSettings(page).getByLabel('문자찜 자동으로 넣기까지(초)')
}

/** 문자찜 카드 (짧은 글 = 카드 글에서 " — 넣을까요?"를 뗀 것) */
export function smsCard(page: Page, short: string) {
  return page.getByRole('list', { name: '음성 카드' }).getByRole('listitem', { name: `${short} 카드`, exact: true })
}

export function smsButton(page: Page, short: string, action: '넣지 않기' | '지금 넣기' | '넣기' | '닫기') {
  return page.getByRole('button', { name: `${short} ${action}`, exact: true })
}

/** 결과 줄 (카드 안 "넣은 결과" 목록의 상태 글) */
export function smsResults(page: Page, short: string) {
  return smsCard(page, short).getByRole('list', { name: `${short} 넣은 결과` }).getByRole('status')
}

/** POST /api/events 중 sms 쓰기 본문 */
export function smsWrites(requests: { method: string; url: string; body: string }[]): Record<string, unknown>[] {
  return requests
    .filter((r) => r.method === 'POST' && new URL(r.url).pathname === '/api/events' && r.body.includes('"sms"'))
    .map((r) => JSON.parse(r.body) as Record<string, unknown>)
    .filter((b) => b['type'] === 'sms')
}

/** 시계를 깔고 로그인 → 방송 콘솔 → 음성 켜기, 그 뒤 시계를 멈춘다 (화면은 Date.now·setTimeout만 쓴다) */
export async function setupPaused(page: Page, opts: { rehearsal?: boolean; smsSettings?: unknown; date?: string; title?: string; width?: number; at?: Date } = {}): Promise<{ b: string; date: string; now: number }> {
  await installSmsSpeech(page, opts.smsSettings === undefined ? {} : { smsSettings: opts.smsSettings })
  await page.setViewportSize({ width: opts.width ?? 1440, height: 900 })
  await page.clock.install(opts.at === undefined ? undefined : { time: opts.at })
  await login(page)
  const date = opts.date ?? uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: opts.rehearsal ?? false, ...(opts.title === undefined ? {} : { title: opts.title }) })
  await turnOnVoice(page)
  const now = (await page.evaluate(() => Date.now())) + 1000
  await page.clock.pauseAt(now)
  return { b, date, now }
}

/** 기다림 없이 (시계를 멈추지 않고) 음성까지 */
export async function setupLive(page: Page, opts: { rehearsal?: boolean; smsSettings?: unknown; date?: string; width?: number; height?: number; title?: string } = {}): Promise<{ b: string; date: string }> {
  await installSmsSpeech(page, opts.smsSettings === undefined ? {} : { smsSettings: opts.smsSettings })
  await page.setViewportSize({ width: opts.width ?? 1440, height: opts.height ?? 900 })
  await login(page)
  const date = opts.date ?? uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: opts.rehearsal ?? false, ...(opts.title === undefined ? {} : { title: opts.title }) })
  await turnOnVoice(page)
  return { b, date }
}

/** 범위 이력의 sms 이벤트 */
export async function smsEvents(page: Page, date: string, rehearsal: boolean): Promise<Record<string, unknown>[]> {
  const res = await page.request.get(`/api/days/${date}/history?after=0&limit=500${rehearsal ? '&rehearsal=true' : ''}`)
  if (res.status() === 404) return []
  expect(res.ok(), await res.text()).toBe(true)
  const body = await res.json() as { events: { type: string; fields: Record<string, unknown> }[] }
  return body.events.filter((e) => e.type === 'sms').map((e) => e.fields)
}

/** 들은 말로 찾는 카드 (이유 카드처럼 카드 글이 정해지지 않은 것) */
export function heardCard(page: Page, text: string) {
  return page.getByRole('list', { name: '음성 카드' }).getByRole('listitem').filter({ has: page.getByText(`들은 말: ${text}`, { exact: true }) })
}

/** 오늘(KST) 그 시각의 Date — 브라우저 시계 고정용 */
export function kstToday(hhmm: string): Date {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  return new Date(`${today}T${hhmm}:00+09:00`)
}
