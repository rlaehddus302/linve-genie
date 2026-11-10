// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 콘솔 유튜브 (YT-11 AC2·AC5·AC6·AC8, D-YT-SRV-03·06·07·09): 구글 연결 없이 잇기(최근 채널·주소), 처음 잇는 채널 확인,
// "유튜브 방송 · {이름}", "서버 연결로 받는 중", 막힘 바로 경고 + 대비 경로, 다시 받으면 한 줄, 운영자 끔, 거절 문장.
// 새 시안(D-UX2-03): 유튜브 칸은 방송 메뉴(⋯) → "유튜브 연결" 시트로 옮겼다. 상품이 없는 새 방송이 이어져 있지 않으면 시트가 저절로 한 번 열린다.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CollectorView, LinkView, LiveBroadcastItem } from '@livejjim/web/src/api/types.ts'
import { BroadcastLinkScreen } from '../src/screens/BroadcastLinkScreen.tsx'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { setClipboardProbe, setClipboardReader } from '../src/lib/clipboard.ts'
import { setWebOpener } from '../src/lib/open-web.ts'
import { MOBILE_FALLBACK_HINT } from '../src/lib/youtube.ts'
import { makeWorld } from './screen-support.tsx'
import { flush, fullView, product } from './support.ts'

const BLOCKED = '유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요.'
const OFF = '지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.'
const NOT_PUBLIC = '로그인 없이 볼 수 있는 라이브만 이을 수 있어요. 공개나 일부공개로 바꿔 주세요.'
const RESUMED = '유튜브 채팅을 다시 받고 있어요. 막힌 동안 손으로 넣은 주문과 겹치지 않는지 봐 주세요.'

const collector = (patch: Partial<CollectorView> = {}): CollectorView => ({
  status: 'LIVE', statusMessage: '채팅을 받는 중', reason: null, reasonMessage: null, mode: 'WEB', lastMessageAt: null, recorded: 3, skippedBeforeLink: 0, gap: false, gapMessage: null, restartable: false, ...patch,
})
const linked = (title: string, patch: Partial<CollectorView> = {}): LinkView => ({
  link: { videoId: 'VIDEOKNOWN1', channelId: 'UC_K', broadcastChannelId: 'UC_K', broadcastChannelTitle: title, invited: false, linkedAt: '2026-10-29T10:00:00.000Z', chatEnded: false },
  collector: collector(patch),
})
const item: LiveBroadcastItem = { videoId: 'LIVENOW0001', title: '오늘 경매', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId: 'UC_K', channelTitle: '다육이네' }

function youtubeWorld(options: { webChat?: { on: boolean } | null; recent?: LiveBroadcastItem[]; status?: 'NOT_CONNECTED' | 'CONNECTED' | 'RECONNECT_NEEDED' } = {}) {
  const world = makeWorld({ products: [product(15)] })
  const state = { link: { link: null, collector: null } as LinkView }
  world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: options.status ?? 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: options.webChat === undefined ? { on: true } : options.webChat, oauth: true } }))
  world.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: state.link }))
  world.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: options.recent ?? [] } }))
  // 잇기 전 미리 보기 (D-UX4-08): 제목·채널 이름만
  world.server.on('POST', /^\/api\/youtube\/preview$/, (call) => {
    if (call.body?.video === 'PRIVATE0001') return { status: 409, body: { error: { code: 'YOUTUBE_NOT_PUBLIC', message: NOT_PUBLIC } } }
    return { body: { title: '오늘 경매', channelTitle: call.body?.video === 'NEWCHAN0001' ? '<b>새채널</b>' : '다육이네' } }
  })
  world.server.on('POST', /^\/api\/broadcasts\/b1\/youtube$/, (call) => {
    if (call.body?.video === 'PRIVATE0001') return { status: 409, body: { error: { code: 'YOUTUBE_NOT_PUBLIC', message: NOT_PUBLIC } } }
    if (call.body?.video === 'NEWCHAN0001' && call.body.confirmInvited !== true) return { status: 409, body: { error: { code: 'INVITED_CONFIRM_NEEDED', message: '처음 잇는 채널이에요. 이 라이브가 맞나요?' }, channel: { id: 'UC_N', title: '<b>새채널</b>' } } }
    state.link = linked(call.body?.video === 'NEWCHAN0001' ? '<b>새채널</b>' : '다육이네')
    return { body: state.link }
  })
  return { world, state }
}

async function open(world: ReturnType<typeof makeWorld>) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush(10)
  })
}

const section = () => screen.getByRole('group', { name: '유튜브' })
/** 연결할 라이브 정보 카드 (D-UX4-116 → D-UX4-117): 플랫폼 · 제목(자르지 않음) · 채널 (이름은 글자로만) */
function expectLiveCheck(ask: HTMLElement, title: string, channel: string) {
  expect(within(ask).getByTestId('live-check-platform').textContent).toBe('유튜브')
  expect(within(ask).getByTestId('live-check-title').textContent).toBe(title)
  expect(within(ask).getByTestId('live-check-channel').textContent).toBe(channel)
}
/**
 * 잇기 전 확인 (D-UX4-08 — 처음이든 아니든): 제목·채널을 보이고 연결.
 * D-UX4-117: 옛 기대 팝업 "연결할 라이브 확인"("이 라이브가 맞나요?" 카드 · [아니에요][맞아요]) → 화면 "이 라이브에 연결할까요?" · 라이브 정보 카드 · [연결하기]
 */
async function agree(channel = '다육이네') {
  const heading = await screen.findByRole('heading', { name: '이 라이브에 연결할까요?' })
  const page = heading.closest('[role="dialog"]') as HTMLElement
  expectLiveCheck(page, '오늘 경매', channel)
  fireEvent.click(within(page).getByRole('button', { name: '연결하기' }))
}
/** 방송 메뉴 → 유튜브 연결 */
async function openYoutube() {
  fireEvent.click(screen.getByRole('button', { name: '라이브 관리' }))
  fireEvent.click(await screen.findByRole('button', { name: '라이브 연결' }))
}

describe('콘솔 유튜브 (앱)', () => {
  afterEach(() => {
    setClipboardReader(async () => '')
    setClipboardProbe(null)
  })

  it('구글 연결 없이 최근 채널 [잇기] → "유튜브 라이브 · 다육이네"·"서버 연결로 받는 중", 찾기는 칸을 열 때 한 번', async () => {
    const { world } = youtubeWorld({ recent: [item] })
    await open(world)
    await openYoutube()
    // D-UX4-112: 옛 기대 묶음 이름 "최근 이은 채널의 라이브", 한 줄 "다육이네 · 오늘 경매 · 라이브 중", [다육이네 · 오늘 경매 잇기]
    // → "최근 연결한 채널의 라이브가 있어요", 줄 둘(플랫폼 그림 + 제목 / 채널 사진 + 채널 이름), [오늘 경매 연결]
    const box = await screen.findByRole('group', { name: '최근 연결한 채널의 라이브가 있어요' })
    // D-UX4-117: 옛 기대(D-UX4-113) 플랫폼 그림 · 제목 / 회색 채널 이름 · [오늘 경매 연결] → 채널 사진(라이브 표시) · 채널 이름만 · [다육이네 연결]
    expect(within(box).queryByTestId('recent-live-title')).toBeNull()
    expect(within(box).getByTestId('recent-live-channel').textContent).toBe('다육이네')
    expect(world.server.callsTo('GET', /live-broadcasts/)).toHaveLength(1)
    fireEvent.click(within(box).getByRole('button', { name: '다육이네 연결' }))
    await agree()
    // D-UX4-95: 이은 뒤 라이브 화면의 라이브 연결 판도 흰 바탕 연결 정보 줄 (옛 기대: 유튜브 카드 "유튜브 라이브 · 다육이네")
    await waitFor(() => expect(screen.getByTestId('link-info-channel').textContent).toContain('다육이네'))
    // 받는 방식 줄("서버 연결로 받는 중")은 연결 정보 줄에서 뺐다 (D-UX4-95) — 개발 낱말도 보이지 않는다
    expect(screen.getByTestId('link-info').textContent).not.toContain('서버 연결로 받는 중')
    expect(screen.getByTestId('link-info').textContent).not.toMatch(/WEB|LIVE|STREAM/)
    // 확인 팝업에서 [맞아요]를 눌렀으니 확인 표시와 함께 보낸다 (D-UX4-08 — 전에는 아는 채널이면 표시 없이)
    expect(world.server.callsTo('POST', /\/youtube$/)[0]?.body).toMatchObject({ confirmInvited: true })
  })

  // 옛 기대 D-UX4-02: 처음 잇는 채널만 "처음 연결하는 채널이에요.\n채널명: …" 팝업.
  // 새 기대 D-UX4-08 (사용자 지시 2026-11-05 "처음이든 아니든 무조건 확인창, 방송 제목·채널명"): 늘 미리 보고 "이 방송이 맞나요?\n\n제목: …\n채널: …", 왼쪽 [아니에요]·오른쪽 [맞아요]
  it('잇기 전 늘 확인 팝업(제목·채널) → [맞아요]는 확인 표시로 한 번 보낸다, [아니에요]는 아무것도 보내지 않는다, 이름은 글자로만 (D-UX4-08)', async () => {
    const { world } = youtubeWorld()
    await open(world)
    await openYoutube()
    fireEvent.change(await screen.findByRole('textbox', { name: '라이브 링크' }), { target: { value: 'NEWCHAN0001' } })
    // D-UX4-117: 옛 기대 [확인] → 팝업 "연결할 라이브 확인" [아니에요][맞아요] → 새 기대 [다음] → 연결 확인 화면(같은 판 안) [이전][연결하기]
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    let heading = await screen.findByRole('heading', { name: '이 라이브에 연결할까요?' })
    let page = heading.closest('[role="dialog"]') as HTMLElement
    // 부정은 왼쪽, 긍정은 오른쪽 (D-UX4-01)
    expect(within(page).getAllByRole('button').map((button) => button.getAttribute('aria-label')).filter((label) => label === '이전' || label === '연결하기')).toEqual(['이전', '연결하기'])
    fireEvent.click(within(page).getByRole('button', { name: '이전' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '이 라이브에 연결할까요?' })).toBeNull())
    expect(world.server.callsTo('POST', /\/youtube$/)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    heading = await screen.findByRole('heading', { name: '이 라이브에 연결할까요?' })
    page = heading.closest('[role="dialog"]') as HTMLElement
    expectLiveCheck(page, '오늘 경매', '<b>새채널</b>')
    fireEvent.click(within(page).getByRole('button', { name: '연결하기' }))
    // D-UX4-95: 연결 정보 줄의 채널 이름 — 글자로만
    await waitFor(() => expect(screen.getByTestId('link-info-channel').textContent).toContain('<b>새채널</b>'))
    expect(document.querySelector('b')).toBeNull()
    expect(world.server.callsTo('POST', /\/youtube$/)).toHaveLength(1)
    expect(world.server.callsTo('POST', /\/youtube$/)[0]?.body).toMatchObject({ video: 'NEWCHAN0001', confirmInvited: true })
  })

  it('비공개 라이브는 짧은 문장으로 거절 (옛 기대: 서버 문장 그대로. 새 기대 D-UX3-11: 거절은 짧고 추상적으로)', async () => {
    const { world } = youtubeWorld()
    await open(world)
    await openYoutube()
    fireEvent.change(await screen.findByRole('textbox', { name: '라이브 링크' }), { target: { value: 'PRIVATE0001' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    // D-UX4-112: 옛 기대 "공개 라이브만 이을 수 있어요." → "공개 라이브만 연결할 수 있어요."
    await waitFor(() => expect(within(section()).getByRole('alert').textContent).toBe('공개 라이브만 연결할 수 있어요.'))
  })

  it('막힘은 바로 맨 위 경고 + 대비 경로, 다시 받으면 경고를 내리고 "다시 받고 있어요"', async () => {
    const { world, state } = youtubeWorld()
    state.link = linked('다육이네')
    await open(world)
    await openYoutube()
    // D-UX4-95: 이은 뒤 라이브 화면의 라이브 연결 판도 흰 바탕 연결 정보 줄 (옛 기대: 유튜브 카드 "유튜브 라이브 · 다육이네")
    await waitFor(() => expect(screen.getByTestId('link-info-channel').textContent).toContain('다육이네'))
    const emit = async (patch: Partial<CollectorView>) => {
      state.link = { ...state.link, collector: collector(patch) }
      await act(async () => {
        world.source().emit('youtube', { kind: 'collector', broadcast: 'b1', date: '2026-10-29', collector: collector(patch) })
        await flush(5)
      })
    }
    await emit({ status: 'RETRYING', statusMessage: '다시 연결하는 중', reason: 'BLOCKED', reasonMessage: BLOCKED })
    // 라이브 화면 맨 위와 열린 라이브 연결 판(D-UX4-95 — 경고는 판매자 안전으로 남김) 두 곳에 같은 경고
    const warnings = screen.getAllByRole('alert', { name: '유튜브 채팅 경고' })
    for (const warning of warnings) expect(warning.textContent).toBe(BLOCKED)
    // 옛 문장 "아래 문자찜 칸이나…" — 문자찜 칸은 "직접 넣기" 시트로 옮겼다 (D-UX2-03)
    // 옛 기대: '"직접 넣기"의 문자찜 칸이나 …'. 새 기대(D-UX4-20): 문자찜 칸은 톱니(방송 설정) → "문자찜 직접 넣기"
    // 새 기대(D-UX4-78): 문자찜 직접 넣기·댓글 붙여넣기를 없애 음성으로만 안내
    expect(screen.getAllByText(MOBILE_FALLBACK_HINT).length).toBeGreaterThan(0)
    // 옛 기대: "댓글 붙여넣기 (웹으로 열기)". 새 기대(D-APPX-03): 방송 화면 안 붙여넣기 창을 연다
    // 경고 줄의 단추 + 뒤에 열려 있는 방송 설정 화면의 같은 이름 줄 (D-UX4-20 — 설정 화면은 판이 아니라 방송 화면 위에 남는다)
    // 새 기대(D-UX4-78): 댓글 붙여넣기를 앱에서 없앴다 — 경고 줄에도 방송 관리에도 단추가 없다
    expect(screen.queryAllByRole('button', { name: '댓글 붙여넣기' })).toHaveLength(0)
    await emit({ status: 'LIVE' })
    expect(screen.queryAllByRole('alert', { name: '유튜브 채팅 경고' })).toHaveLength(0)
    // 다시 받은 뒤 "다시 받고 있어요" 줄은 연결 정보 줄에서 뺐다 (D-UX4-95) — 경고가 내려가는 것만 본다
    expect(screen.getByTestId('link-info').textContent).not.toContain(RESUMED)
  })

  it('운영자가 끄면 잇기 칸 대신 안내 — 최근 채널을 찾지 않는다', async () => {
    const { world } = youtubeWorld({ webChat: { on: false } })
    await open(world)
    await openYoutube()
    await waitFor(() => expect(within(section()).getByText(OFF)).toBeTruthy())
    expect(screen.queryByRole('textbox', { name: '라이브 링크' })).toBeNull()
    expect(world.server.callsTo('GET', /live-broadcasts/)).toHaveLength(0)
  })

  it('상품이 없는 새 라이브가 이어져 있지 않으면 유튜브 연결 시트가 저절로 한 번 열린다 (라이브 시작 흐름, D-UX2-03)', async () => {
    const { world } = youtubeWorld()
    world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=true)?$/, () => ({ body: fullView({ seq: world.seq, rehearsal: false, products: [] }) }))
    await open(world)
    expect(await screen.findByRole('textbox', { name: '라이브 링크' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '라이브 연결' })).toBeTruthy()
  })

  it('리허설은 유튜브 요청을 보내지 않는다', async () => {
    const world = makeWorld({ products: [], rehearsal: true })
    await open(world)
    expect(world.server.calls.filter((call) => call.path.includes('youtube'))).toHaveLength(0)
    expect(screen.queryByRole('group', { name: '유튜브' })).toBeNull()
  })

  it('클립보드에 글이 있으면 [붙여넣기] 한 번으로 링크를 넣고 잇는다 — 저절로 읽지 않는다 (옛 기대 D-LIVETEST-09: 칸에 미리 채움. 새 기대 D-UX3-11: 아이폰 허용 창이 뜨지 않게 [붙여넣기])', async () => {
    let reads = 0
    setClipboardReader(async () => {
      reads++
      return '  https://youtube.com/live/LIVENOW0001?si=x  '
    })
    const { world } = youtubeWorld()
    world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=true)?$/, () => ({ body: fullView({ seq: world.seq, rehearsal: false, products: [] }) }))
    setClipboardProbe(async () => true)
    await open(world)
    const sheet = await screen.findByRole('dialog', { name: '라이브 연결' })
    const field = await within(sheet).findByRole('textbox', { name: '라이브 링크' })
    await flush()
    expect((field as HTMLInputElement).value).toBe('')
    expect(reads).toBe(0)
    fireEvent.click(await within(sheet).findByRole('button', { name: '붙여넣기' }))
    await waitFor(() => expect((field as HTMLInputElement).value).toBe('https://youtube.com/live/LIVENOW0001?si=x'))
    // D-UX4-112: 옛 기대 [나중에 잇기] → [나중에 연결]
    expect(within(sheet).getByRole('button', { name: '나중에 연결' })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    await agree()
    // D-UX4-95: 이은 뒤 라이브 화면의 라이브 연결 판도 흰 바탕 연결 정보 줄 (옛 기대: 유튜브 카드 "유튜브 라이브 · 다육이네")
    await waitFor(() => expect(screen.getByTestId('link-info-channel').textContent).toContain('다육이네'))
    expect(world.server.callsTo('POST', /\/youtube$/)[0]?.body).toMatchObject({ video: 'https://youtube.com/live/LIVENOW0001?si=x' })
  })

  it('클립보드가 비었으면 [붙여넣기]가 없다', async () => {
    const { world } = youtubeWorld()
    await open(world)
    await openYoutube()
    const field = await screen.findByRole('textbox', { name: '라이브 링크' })
    await flush()
    expect((field as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('button', { name: '붙여넣기' })).toBeNull()
  })

  it('구글 연결로 읽는 서버: 연결돼 있으면 앱에서 주소를 붙여 잇고, 아니면 "먼저 연결" + 연결 화면(웹) + [다시 확인] (D-UX2-07)', async () => {
    const opened: string[] = []
    setWebOpener(async (url) => void opened.push(url))
    const { world } = youtubeWorld({ webChat: null })
    await open(world)
    await openYoutube()
    await waitFor(() => expect(within(section()).getByText('유튜브 채널을 먼저 연결해 주세요.')).toBeTruthy())
    expect(screen.queryByText('유튜브 라이브 잇기는 웹에서 해 주세요.')).toBeNull()
    fireEvent.click(within(section()).getByRole('button', { name: '유튜브 연결하러 가기 (웹으로 열기)' }))
    expect(opened).toEqual(['http://test.local/settings/youtube?from=app'])
    // 웹에서 연결하고 돌아와 [다시 확인] → 잇기 칸
    world.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'CONNECTED', channel: { id: 'UC_K', title: '다육이네' }, permissions: { read: true, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: null, oauth: true } }))
    fireEvent.click(within(section()).getByRole('button', { name: '다시 확인' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '라이브 링크' }), { target: { value: 'VIDEOKNOWN1' } })
    // D-LIVETEST-09: 내 채널에 지금 하는 방송이 없으면 목록을 숨긴다
    expect(within(section()).queryByText('내 채널에서 라이브 중')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    await waitFor(() => expect(world.server.callsTo('POST', /\/youtube$/)).toHaveLength(1))
  })
})

describe('라이브 연결은 쌓인 화면 (D-UX3-09 — 밀어서 뒤로 가기)', () => {
  it('경로가 openLink를 주면 저절로 여는 것도 메뉴 "라이브 연결"도 그 화면을 연다 — 앱 안 판은 뜨지 않는다', async () => {
    const { world } = youtubeWorld()
    world.server.on('GET', /^\/api\/days\/2026-10-29(\?rehearsal=true)?$/, () => ({ body: fullView({ seq: world.seq, rehearsal: false, products: [] }) }))
    const opened: boolean[] = []
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} openLink={(closed) => opened.push(closed)} />))
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
      await flush(10)
    })
    await waitFor(() => expect(opened).toEqual([false]))
    expect(screen.queryByRole('dialog', { name: '라이브 연결' })).toBeNull()
    await openYoutube()
    expect(opened).toEqual([false, false])
    expect(screen.queryByRole('dialog', { name: '라이브 연결' })).toBeNull()
  })

  // D-UX4-95로 바뀐 기대: 이은 뒤엔 회색 유튜브 카드("유튜브 라이브 · 다육이네") 대신 흰 바탕 정보 줄(플랫폼 · 라이브 제목 · 채널)
  // D-UX4-112: 옛 기대 [나중에 잇기] → [나중에 연결]
  it('라이브 연결 화면: 주소를 넣어 연결하고, 연결한 뒤엔 연결 정보 줄 — [나중에 연결]은 뒤로', async () => {
    const { world } = youtubeWorld()
    let back = 0
    render(world.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => back++} />))
    const page = await screen.findByRole('dialog', { name: '라이브 연결' })
    fireEvent.click(await within(page).findByRole('button', { name: '나중에 연결' }))
    expect(back).toBe(1)
    fireEvent.change(within(page).getByRole('textbox', { name: '라이브 링크' }), { target: { value: 'https://youtu.be/VIDEOKNOWN1' } })
    fireEvent.click(within(page).getByRole('button', { name: '다음' })) // D-UX4-117: 옛 [확인] → [다음]
    await agree()
    const info = await screen.findByTestId('link-info-page')
    expect(within(info).getByTestId('link-info-channel').textContent).toBe('채널다육이네')
    expect(within(info).getByRole('heading', { name: '라이브 연결' })).toBeTruthy()
  })
})
