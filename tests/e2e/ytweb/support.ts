// YT-SRV(CH-26) — 서버 웹 읽기 묶음(@ytweb) 공용 도우미 (test-e2e). I3 도우미 위에 가짜 유튜브 웹 조작(/_fake/web/*)과 정리를 더한다.
// 가짜 구글의 방송·채팅은 같은 ID로 가짜 유튜브 웹에 비친다(apps/server/src/youtube/fake-web-bridge.ts). 오류는 /_fake/web/fail로 넣는다.
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { consoleYoutube, fake, fakeUrl } from '../i3/support.ts'

export * from '../i3/support.ts'

export type WebEndpoint = 'watch' | 'chatPage' | 'poll' | 'channelLive'
export type WebFault = { status: number } | { kind: 'bot' | 'shape' | 'empty' | 'hang' | 'reset' | 'cut' }

/** 가짜 유튜브 웹 오류를 times번 넣는다 (지우는 경로가 없다 — 정확한 횟수만 넣는다) */
export async function webFail(request: APIRequestContext, endpoint: WebEndpoint, fault: WebFault, times = 1): Promise<void> {
  await fake(request, '/_fake/web/fail', { endpoint, fault, times })
}

/** 엔드포인트별 부른 수 (모든 영상 합) */
export async function webCalls(request: APIRequestContext): Promise<Record<WebEndpoint, number>> {
  const res = await request.get(`${fakeUrl()}/_fake/web/state`)
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { calls: Record<WebEndpoint, number> }).calls
}

/** 웹에만 주는 영상 상태 (chatOff·live·private …) */
export async function webVideo(request: APIRequestContext, videoId: string, state: 'live' | 'upcoming' | 'ended' | 'vod' | 'private' | 'members' | 'age' | 'chatOff' | 'missing'): Promise<void> {
  await fake(request, '/_fake/web/video', { videoId, state })
}

/**
 * 넣은 오류가 실제로 쓰였을 때까지 기다린다: 이 시점 뒤 poll이 n번 더 불렸다.
 * 앞 시험의 수집기는 afterEach에서 끝내 두므로(endChats) 이 묶음에서 poll을 부르는 건 이 시험의 수집기뿐이다.
 */
export async function waitPolls(request: APIRequestContext, from: number, n: number, timeout = 60_000): Promise<void> {
  await expect.poll(async () => (await webCalls(request)).poll - from, { timeout }).toBeGreaterThanOrEqual(n)
}

/** 이 시험에서 만든 가짜 채팅들을 끝낸다 — 남은 수집기가 다음 시험의 오류를 먹지 않게 */
export async function endChats(request: APIRequestContext, liveChatIds: readonly string[]): Promise<void> {
  for (const id of liveChatIds) await fake(request, '/_fake/end-chat', { liveChatId: id })
}

/**
 * 콘솔에서 주소 붙여넣기로 잇기 (서버 웹 읽기). 처음 잇는 채널이면 확인 줄의 "맞아요, 잇기"를 누른다 — 구글 연결 채널은 확인한 채널이라 바로 잇는다(YT-02 서버 잇기).
 */
export async function linkWeb(page: Page, videoId: string): Promise<void> {
  const yt = consoleYoutube(page)
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

/** 콘솔 고정 영역의 경고 한 줄 (그 문장을 담은 것) */
export function stickyWarning(page: Page, text: string): Locator {
  return page.locator('.console-sticky').getByRole('alert').filter({ hasText: text })
}

/** 채팅 패널에서 글들이 이 순서로(위 = 먼저) 한 번씩 보인다 */
export async function expectChatOrder(chat: Locator, texts: readonly string[]): Promise<void> {
  for (const text of texts) await expect(chat.getByText(text), text).toHaveCount(1)
  const rows = await chat.getByRole('listitem').allInnerTexts()
  const at = texts.map((text) => rows.findIndex((row) => row.includes(text)))
  expect(at.every((i) => i >= 0), JSON.stringify(rows)).toBe(true)
  expect([...at].sort((a, b) => a - b), JSON.stringify(rows)).toEqual(at)
}
