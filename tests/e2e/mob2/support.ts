// MOB2 E2E 공용 도우미 (test-e2e) — 휴대폰 화면 남은 문제 (harness/sprints/MOB2/acceptance.md).
// 기대 문장은 acceptance.md·DECISIONS D-MOB2-01~08의 따옴표 문장에서 정했다(구현을 보고 정하지 않음).
import { expect, request, type Page, type Request, type Route } from '@playwright/test'

/** 연결이 돌아와 저절로 보낸 것의 앞말 (D-MOB2-07, AC-MOB2-40) */
export const RESENT_PREFIX = '연결이 돌아와 보냈어요: '
/** 다시 보낼 실패 줄의 안내 (D-MOB2-07, AC-MOB2-40) */
export const AUTO_RESEND_NOTE = '연결이 돌아오면 저절로 다시 보내요.'
/** 실시간 연결이 끊긴 안내 (돌아옴 = 이 안내가 사라짐 — F 공통 Given) */
export const LOST_NOTICE = '실시간 연결이 끊겼어요. 다시 연결하는 중이에요.'
/** 시간이 지난 보류 찜 (D-MOB2-06, AC-MOB2-30) */
export const TIMED_OUT_WORD = '보류 · 시간 지남'
export const TIMED_OUT_TAIL = ' — 지금 등록해도 판정되지 않아요'
/** 1등 자리를 비운 조치의 결과 (D-MOB2-04, AC-MOB2-10~13) */
export const newWinner = (label: string, name: string): string => `${label} 새 1등: ${name}`
export const vacatedEmpty = (label: string, status: string): string => `${label} 1등 자리가 비었어요 · 대기 없음 · ${status}`
export const vacatedAsk = (label: string, n: number): string => `${label} 1등 자리가 비었어요 · 대기 ${String(n)}명 — 누구를 1등으로 할지 골라 주세요`
export const vacatedCleared = (label: string, status: string): string => `${label} 1등 자리가 비었어요 · 대기를 비웠어요 · ${status}`

/** 쓰기 요청(POST /api/events)인가 */
export function isWrite(request: Request): boolean {
  return request.method() === 'POST' && new URL(request.url()).pathname === '/api/events'
}

/**
 * 쓰기를 네트워크 실패로 막는다 (D-MOB2-07 시험 — 연결이 돌아와 저절로 보낸 것도 실패하게).
 * `blocked()`는 막은 쓰기 수, `bodies()`는 막은 본문, `release()`는 막기를 푼다.
 */
export async function blockWrites(page: Page): Promise<{ blocked: () => number; bodies: () => Record<string, unknown>[]; release: () => Promise<void> }> {
  const seen: Record<string, unknown>[] = []
  const handler = async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    try {
      seen.push(JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>)
    } catch {
      seen.push({})
    }
    await route.abort('internetdisconnected')
  }
  await page.route('**/api/events**', handler)
  return {
    blocked: () => seen.length,
    bodies: () => [...seen],
    release: async () => {
      await page.unroute('**/api/events**', handler)
    },
  }
}

/**
 * 끊김 중에 실패한 쓰기를 남긴 채, 쓰기를 막아 둔 상태로 연결을 되돌린다 — 저절로 한 번 다시 보낸 것이 막혀 다시 실패할 때까지 기다린다.
 * 기존 시험(AC-S05-63·AC-S06-14)이 "다시 보내기"를 직접 누르는 길을 그대로 보게 한다 (MOB2 D-MOB2-07, AC-MOB2-80).
 * 돌려준 `release()`로 막기를 푼 뒤 "다시 보내기"를 누른다.
 */
export async function onlineWithWritesBlocked(page: Page, failed: () => Promise<void>): Promise<{ release: () => Promise<void>; blocked: () => number }> {
  const block = await blockWrites(page)
  await page.context().setOffline(false)
  // 저절로 한 번 보냈다가 막혀 실패 (요청 1개 이상 — 화면 쪽 재시도 포함)
  await expect.poll(() => block.blocked(), { timeout: 30_000, message: '연결이 돌아온 뒤 저절로 다시 보낸 요청' }).toBeGreaterThan(0)
  await failed()
  return { release: block.release, blocked: block.blocked }
}

/**
 * 문자찜 화면을 연다 — 방송이 하나뿐인 새 판매자는 화면이 그 방송을 저절로 고른다(s06 openSms는 고르기 창을 눌러 그 조회 응답을 기다려서
 * 이미 고른 경우 끝나지 않는다). 고른 방송 제목·최근 목록·번호 칸이 준비될 때까지.
 */
export async function openSmsSole(page: Page, title: string): Promise<void> {
  await page.goto('/sms')
  const region = page.getByRole('region', { name: '고른 방송' })
  await expect(region).toContainText(title)
  await expect(page.getByRole('region', { name: '최근 넣은 문자찜' })).toBeVisible()
  await expect(page.getByLabel('번호', { exact: true })).toBeEditable()
}

/** 이 화면이 보낸 쓰기 요청 본문을 모은다 (끊김 중 실패한 요청도 사건은 생긴다 — MOB2 수정 라운드 2) */
export function watchBodies(page: Page): Record<string, unknown>[] {
  const list: Record<string, unknown>[] = []
  page.on('request', (r) => {
    if (!isWrite(r)) return
    try {
      list.push(JSON.parse(r.postData() ?? '{}') as Record<string, unknown>)
    } catch {
      list.push({})
    }
  })
  return list
}

/**
 * 같은 계정의 다른 기기 — 이 화면의 오프라인 흉내(context.setOffline)와 상관없는 요청 컨텍스트.
 * `post(path, data)`는 같은 출처 머리글을 붙여 보낸다. 끝나면 `dispose()`.
 */
export async function otherDevice(page: Page, baseURL: string): Promise<{ post: (path: string, data: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>; dispose: () => Promise<void> }> {
  const api = await request.newContext({ baseURL, storageState: await page.context().storageState() })
  return {
    post: async (path, data) => {
      const res = await api.post(path, { data: { requestId: crypto.randomUUID(), ...data }, headers: { Origin: baseURL } })
      const text = await res.text()
      let body: Record<string, unknown>
      try {
        body = JSON.parse(text) as Record<string, unknown>
      } catch {
        body = { text }
      }
      return { status: res.status(), body }
    },
    dispose: () => api.dispose(),
  }
}

/** KST 오늘 날짜의 `HH:MM:SS` 시각 (밀리초) — 화면 시계를 당길 때 */
export function kstTodayAt(time: string): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return Date.parse(`${day}T${time}+09:00`)
}

/** 밀리초 → KST `HH:MM:SS` */
export function kstClock(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(ms))
}

/** 받은 시각을 비운 채 실패해 처음 누른 시각을 채운 안내 (D-MOB2-09, AC-MOB2-43) */
export const filledReceived = (time: string): string => `받은 시각을 비워 두셔서 처음 누른 시각(${time})을 넣어 두었어요. 다시 보내도 이 시각으로 들어가요.`
/** 저절로 다시 보내려던 등록의 번호가 이미 있어 보내지 않음 (D-MOB2-10, AC-MOB2-40) */
export const existsOnResend = (no: number): string => `연결이 돌아와 보내려 했지만 ${String(no)}번이 이미 있어 등록하지 않았어요.`
/** 붙인 옵션을 넣지 않았다는 평소 안내의 앞부분 (O2 round1 DROPPED와 같은 문장) */
export const droppedOptions = (no: number): string => `붙인 옵션은 ${String(no)}번에 넣지 않고 뗐어요.`
