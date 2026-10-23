// X1 — 크롬 확장으로 감사 채팅 올리기 (YT-10 AC11~AC17). AC-X1-26·27·29·30·31·34
// 공식 경로로는 올릴 수 없는 회차(유튜브 연결·동의는 있으나 YT-02로 이은 영상 없음)를 만들어, 확장이 가짜 live_chat 입력 칸에 넣고 보내는지 본다.
// "아무 일도 없어야 한다"는 시험은 확장이 적어도 한 번 물어볼 시간(시작 3초 + 다시 묻기 15초 안)을 상태를 보며 지켜본다.
import type { BrowserContext, Page } from '@playwright/test'
import {
  addChat,
  connectPopup,
  connectYoutube,
  consentLiveChat,
  expect,
  fake,
  fakeState,
  issueCode,
  loginNewSeller,
  openLiveChat,
  openPopup,
  openRealBroadcast,
  outboxRows,
  pickBroadcast,
  postingChatHtml,
  register,
  test,
} from './support.ts'

test.beforeEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})

interface Lg { sent: string[]; at: number[]; mutations: number; html?: string }
const lg = (chat: Page): Promise<Lg> => chat.evaluate(() => (window as unknown as { __lg: Lg }).__lg)

async function enableThanks(page: Page): Promise<void> {
  await page.goto('/settings/extension')
  await page.getByRole('button', { name: '확장으로 감사 채팅 올리기 켜기' }).click()
  await page.getByRole('dialog', { name: '확장으로 감사 채팅 올리기를 켤까요?' }).getByRole('button', { name: '켤게요' }).click()
  await expect(page.getByRole('button', { name: '확장으로 감사 채팅 올리기 끄기' })).toBeVisible()
}

/** 판매자·유튜브 연결·동의 → (스위치) → 이은 영상 없는 실제 방송 → 확장 연결·회차 고르기 */
async function setup(ext: { context: BrowserContext; page: Page; extId: string; setChatHtml: (h: string) => void }, o: { title: string; video: string; enable: boolean; me?: 'owner' | 'other'; products?: number[]; echo?: boolean }) {
  const { context, page, extId, setChatHtml } = ext
  await loginNewSeller(page)
  const channel = await connectYoutube(page, `${o.title} 채널`)
  await consentLiveChat(page, channel)
  if (o.enable) await enableThanks(page)
  const { b, date } = await openRealBroadcast(page, { title: o.title })
  for (const no of o.products ?? [3]) await register(page, `${String(no)} 감사다육 10`, no)
  const code = await issueCode(page)
  setChatHtml(postingChatHtml({ me: (o.me ?? 'owner') === 'owner' ? channel.id : 'UCx1otheraccount00000001', owner: channel.id, echo: o.echo !== false }))
  const chat = await openLiveChat(context, o.video)
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  await pickBroadcast(popup, page, `${o.title} (${date})`, b)
  return { channel, b, date, chat, popup }
}

const viewerChat = (n: number, nick: string, no: number) => ({ id: `ChwKGkNPeDFfdGhhbmtzXzAwMDAwMDAw${String(n).padStart(6, '0')}`, ch: `UCx1thanksviewer0000000${String(n)}`, nick, text: `${String(no)}번` })

/** 지정한 시간 동안 조건이 계속 참인지 상태를 보며 지켜본다 (한 번이라도 거짓이면 바로 실패) */
async function holds(ms: number, check: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + ms
  await expect.poll(async () => {
    if (!(await check())) return 'broken'
    return Date.now() >= end ? 'held' : 'waiting'
  }, { timeout: ms + 10_000, intervals: [500] }).not.toBe('waiting')
  expect(await check()).toBe(true)
}

test('@youtube AC-X1-34·31: 스위치 켬 → "3번" 1등 → 입력 칸에 감사 글이 들어가 보내지고 자기 글로 뜸 → 게시됨, 글은 정확히 1번, 공식 게시 호출 0', async ({ ext }) => {
  test.setTimeout(120_000)
  const page = ext.page
  const { channel, b, date, chat } = await setup(ext, { title: '감사 1부', video: 'x1ThxVid001', enable: true })
  await addChat(chat, viewerChat(1, '첫손님', 3))

  await expect.poll(async () => (await outboxRows(page, date)).find((r) => r.target === 'LIVE_CHAT' && r.text.startsWith('3번'))?.state, { timeout: 60_000 }).toBe('SENT')
  const row = (await outboxRows(page, date)).find((r) => r.target === 'LIVE_CHAT' && r.text.startsWith('3번'))
  const state = await lg(chat)
  expect(state.sent).toHaveLength(1)
  expect(state.sent[0]?.replace(/\s+/g, ' ').trim()).toBe(row?.text.replace(/\s+/g, ' ').trim())
  expect(state.sent[0]).toContain('첫손님')
  // 자기 글이 채팅에 떴다 (입력 칸은 비었다)
  await expect(chat.locator('#items yt-live-chat-text-message-renderer #message').filter({ hasText: row?.text ?? '' })).toHaveCount(1)
  await expect(chat.locator('#input')).toHaveText('')

  // 그 뒤로도 다시 올리지 않는다 (확장이 몇 번 더 물어볼 동안)
  await holds(20_000, async () => (await lg(chat)).sent.length === 1)
  // 자기 감사 글은 채팅 찜으로 기록되지 않고, 공식 경로는 이 채널에 아무것도 올리지 않았다
  expect((await fakeState(page.request)).posted.filter((p) => p.authorChannelId === channel.id)).toHaveLength(0)
  expect((await outboxRows(page, date)).filter((r) => r.target === 'LIVE_CHAT' && r.state === 'SENT')).toHaveLength(1)

  // 콘솔 유튜브 칸 감사 목록: 확장에 맡긴 행 태그 "크롬 확장으로"
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await page.getByRole('region', { name: '유튜브', exact: true }).getByRole('button', { name: '감사 메시지' }).click()
  const dialog = page.getByRole('dialog', { name: '감사 메시지' })
  await dialog.getByRole('region', { name: '보냄' }).getByRole('button', { name: '펼치기' }).click()
  await expect(dialog.getByRole('listitem').filter({ hasText: '첫손님' }).getByText('크롬 확장으로')).toBeVisible()
})

test('@youtube AC-X1-26: 스위치가 꺼져 있으면 확장은 입력 칸을 한 번도 건드리지 않는다', async ({ ext }) => {
  test.setTimeout(120_000)
  const { date, chat } = await setup(ext, { title: '꺼짐 1부', video: 'x1ThxOff001', enable: false })
  await addChat(chat, viewerChat(2, '꺼짐손님', 3))
  await expect.poll(async () => (await outboxRows(ext.page, date)).some((r) => r.target === 'LIVE_CHAT' && r.text.startsWith('3번')), { timeout: 30_000 }).toBe(true)
  await holds(20_000, async () => { const s = await lg(chat); return s.sent.length === 0 && s.mutations === 0 })
  const row = (await outboxRows(ext.page, date)).find((r) => r.target === 'LIVE_CHAT' && r.text.startsWith('3번'))
  expect(row?.reason).not.toBe('EXTENSION')
  expect(row?.state).not.toBe('SENT')
})

test('@youtube AC-X1-27: 채팅 창 로그인 계정이 방송 채널이 아니면 넣지 않고, 콘솔·팝업에 "방송 채널 계정으로 로그인해야…"', async ({ ext }) => {
  test.setTimeout(120_000)
  const { b, date, chat, popup } = await setup(ext, { title: '남계정 1부', video: 'x1ThxOther1', enable: true, me: 'other' })
  await addChat(chat, viewerChat(3, '남계정손님', 3))
  await expect.poll(async () => (await outboxRows(ext.page, date)).find((r) => r.target === 'LIVE_CHAT' && r.text.startsWith('3번'))?.reason, { timeout: 30_000 }).toBe('EXTENSION')
  await ext.page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(ext.page.getByRole('alert').filter({ hasText: '방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요' })).toBeVisible({ timeout: 40_000 })
  await expect(async () => {
    await popup.reload()
    await expect(popup.getByText('방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요')).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 30_000 })
  const s = await lg(chat)
  expect(s.sent).toHaveLength(0)
  expect(s.mutations).toBe(0)
  expect((await outboxRows(ext.page, date)).find((r) => r.text.startsWith('3번'))?.state).not.toBe('SENT')
})

test('@youtube AC-X1-30: 입력 칸에 판매자 글 "잠시만요"가 있으면 기다리고 덮어쓰지 않는다 → 지운 뒤 5초 넘게 지나야 올린다', async ({ ext }) => {
  test.setTimeout(150_000)
  const { date, chat } = await setup(ext, { title: '쓰는중 1부', video: 'x1ThxType01', enable: true })
  await chat.locator('#input').click()
  await chat.keyboard.type('잠시만요')
  await addChat(chat, viewerChat(4, '기다림손님', 3))
  await expect.poll(async () => (await outboxRows(ext.page, date)).find((r) => r.target === 'LIVE_CHAT' && r.text.startsWith('3번'))?.reason, { timeout: 30_000 }).toBe('EXTENSION')
  await holds(20_000, async () => (await lg(chat)).sent.length === 0 && (await chat.locator('#input').textContent()) === '잠시만요')

  await chat.locator('#input').click()
  await chat.keyboard.press('ControlOrMeta+a')
  await chat.keyboard.press('Backspace')
  await expect(chat.locator('#input')).toHaveText('')
  const clearedAt = Date.now()
  await expect.poll(async () => (await lg(chat)).sent.length, { timeout: 40_000 }).toBe(1)
  const s = await lg(chat)
  expect(s.sent[0]).toMatch(/^3번/)
  expect((s.at[0] ?? 0) - clearedAt).toBeGreaterThanOrEqual(5000)
  await expect.poll(async () => (await outboxRows(ext.page, date)).find((r) => r.text.startsWith('3번'))?.state, { timeout: 30_000 }).toBe('SENT')
})

test('@youtube AC-X1-29: 감사 4건이 1초 안에 → 묶어서 4번보다 적게, 글 사이 3초 이상, 닉네임 태그·줄바꿈은 글자로 정리', async ({ ext }) => {
  test.setTimeout(150_000)
  const { date, chat } = await setup(ext, { title: '몰림 1부', video: 'x1ThxBurst1', enable: true, products: [3, 4, 5, 6] })
  const nicks = ['몰림하나', '몰림둘', '몰림셋', '<b>홍\n길동</b>']
  const t0 = Date.now()
  for (const [i, nick] of nicks.entries()) await addChat(chat, { ...viewerChat(10 + i, nick, 3 + i), atMs: t0 + i * 200 })

  await expect.poll(async () => (await outboxRows(ext.page, date)).filter((r) => r.target === 'LIVE_CHAT' && /^[3-6]번/.test(r.text) && r.state === 'SENT').length, { timeout: 90_000 }).toBe(4)
  const s = await lg(chat)
  expect(s.sent.length).toBeGreaterThanOrEqual(1)
  expect(s.sent.length).toBeLessThan(4)
  for (let i = 1; i < s.at.length; i++) expect((s.at[i] ?? 0) - (s.at[i - 1] ?? 0)).toBeGreaterThanOrEqual(3000)
  const all = s.sent.join('\n')
  for (const no of [3, 4, 5, 6]) expect(all.match(new RegExp(`(^|\\s)${String(no)}번`, 'g'))).toHaveLength(1)
  for (const text of s.sent) {
    expect(text).not.toContain('\n')
    expect(text.length).toBeLessThanOrEqual(200)
  }
  // 입력 칸에 태그가 요소로 생기지 않았다
  expect(await chat.locator('#input b, #items b').count()).toBe(0)
  await holds(10_000, async () => (await lg(chat)).sent.length === s.sent.length)
})

test('@youtube AC-X1-31·32: 보냈는데 자기 글이 15초 안에 안 뜨면 확인 필요·다시 안 올림, 3번 이어지면 콘솔에 "확장으로 감사 글을 올리지 못하고 있어요" + 다시 켜기', async ({ ext }) => {
  test.setTimeout(240_000)
  const { b, date, chat } = await setup(ext, { title: '안뜸 1부', video: 'x1ThxNoEcho', enable: true, products: [3, 4, 5], echo: false })
  for (const [i, no] of [3, 4, 5].entries()) {
    await addChat(chat, viewerChat(20 + i, `안뜸손님${String(i)}`, no))
    await expect.poll(async () => (await outboxRows(ext.page, date)).find((r) => r.text.startsWith(`${String(no)}번`))?.reason, { timeout: 90_000 }).toBe('UNCONFIRMED')
  }
  const s = await lg(chat)
  // 글마다 정확히 한 번만 보냈다 (확인 필요를 다시 올리지 않음)
  for (const no of [3, 4, 5]) expect(s.sent.filter((t) => t.startsWith(`${String(no)}번`))).toHaveLength(1)
  await ext.page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  const warning = ext.page.getByRole('alert').filter({ hasText: '확장으로 감사 글을 올리지 못하고 있어요' })
  await expect(warning).toBeVisible({ timeout: 30_000 })
  await expect(warning.getByRole('button', { name: '다시 켜기' })).toBeVisible()
  await expect(ext.page.getByText(/\b(PAUSED|OWNER|UNCONFIRMED)\b/)).toHaveCount(0)
  await warning.getByRole('button', { name: '다시 켜기' }).click()
  await expect(warning).toHaveCount(0)
  expect((await lg(chat)).sent).toHaveLength(3)
})
