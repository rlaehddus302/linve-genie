// D-UX4-117 (사용자 지시 2026-11-10, 링크 화면·확인 팝업 사진):
// - 사진1: 라이브 확인 팝업 대신 별도 화면. [확인] → [다음], 누르면 다음 화면 "이 라이브에 연결할까요?" · 플랫폼 아이콘+이름 / 제목(다 보임) / 채널 아이콘+이름 · [연결하기]
// - 사진2: 설명 없음, 제목 아래 링크 칸, 그 아래 한 줄 [링크를 모르겠어요][붙여넣기]. 최근 라이브 줄은 채널 사진(라이브 빨간 표시) + 채널 이름만, [연결] → 위 확인 화면
// D-UX4-121 (사용자 지시 2026-11-10 "다음이나 연결 누르면 로딩이 긴데 … 연결하기 버튼 눌러야 실제로 연결해야지"): [다음]·[연결]은 기다리지 않고 바로 확인 화면, 정보는 거기서 받는다
// D-UX4-119: 관리/라이브 연결의 라이브 제목은 이을 때 남긴 제목으로 바로 (전에는 화면을 열 때마다 유튜브를 다시 읽어 늦게 떴다)
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BroadcastLinkScreen } from '../src/screens/BroadcastLinkScreen.tsx'
import { LINK_CONFIRM_ACTION, LIVE_NOW_YOUTUBE, LINK_CONFIRM_TITLE, LINK_NEXT } from '../src/screens/console/YoutubeSection.tsx'
import { setClipboardProbe, setClipboardReader } from '../src/lib/clipboard.ts'
import { makeWorld } from './screen-support.tsx'

const LONG = '미강다육🌻 라이브 11월 10일 신상입고! #에케베리 #국민이 #에오니움 #힐링 #다육식물 #다육이'
const CONNECTION = { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true }

function world(options: { readonly recent?: readonly Record<string, unknown>[]; readonly refuse?: boolean; readonly storedTitle?: string | null } = {}) {
  const w = makeWorld({ products: [] })
  let link: Record<string, unknown> | null = null
  w.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: CONNECTION }))
  w.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link, collector: null } }))
  w.server.on('GET', /^\/api\/youtube\/live-broadcasts$/, () => ({ body: { broadcasts: options.recent ?? [] } }))
  w.server.on('POST', /^\/api\/youtube\/preview$/, () => ({ body: { title: LONG, channelTitle: '미강다육🌻', channelId: 'UC_MIGANG' } }))
  w.server.on('POST', /^\/api\/broadcasts\/b1\/youtube$/, (call) => {
    if (options.refuse === true) return { status: 409, body: { error: { code: 'NO_LIVE_CHAT', message: '긴 서버 문장' } } }
    link = { videoId: String(call.body?.video), channelId: null, broadcastChannelId: 'UC_MIGANG', broadcastChannelTitle: '미강다육🌻', broadcastTitle: options.storedTitle === undefined ? LONG : options.storedTitle, invited: false, linkedAt: '2026-11-10T12:00:00.000Z', chatEnded: false }
    return { body: { link, collector: { mode: 'WEB', status: 'STARTING', restartable: false } } }
  })
  return w
}

afterEach(() => {
  setClipboardReader(async () => '')
  setClipboardProbe(null)
})

describe('링크 화면 → 연결 확인 화면 (D-UX4-117)', () => {
  it('[다음] → "이 라이브에 연결할까요?" 화면(팝업 아님) · 라이브 정보 · [연결하기] → 이은 뒤 연결 정보', async () => {
    const w = world()
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const field = await screen.findByRole('textbox', { name: '라이브 링크' })
    expect(LINK_NEXT).toBe('다음')
    expect(screen.queryByRole('button', { name: '확인' })).toBeNull()
    fireEvent.change(field, { target: { value: 'https://youtu.be/MIGANG00001' } })
    fireEvent.click(screen.getByRole('button', { name: LINK_NEXT }))
    const page = await screen.findByTestId('link-confirm')
    // D-UX4-121: 기다리지 않고 바로 넘어오고, 라이브 정보는 이 화면에서 받는다 — 받기 전엔 [연결하기]가 꺼져 있다
    await within(page).findByTestId('live-check-title')
    expect(LINK_CONFIRM_TITLE).toBe('이 라이브에 연결할까요?')
    expect(within(page).getByRole('heading', { level: 1 }).textContent).toBe(LINK_CONFIRM_TITLE)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // 링크 화면은 사라지고(한 화면씩), 제목은 자르지 않는다
    expect(screen.queryByRole('textbox', { name: '라이브 링크' })).toBeNull()
    expect(within(page).getByTestId('live-check-platform').textContent).toBe('유튜브')
    expect(within(page).getByTestId('live-check-title').textContent).toBe(LONG)
    expect(within(page).getByTestId('live-check-channel').textContent).toBe('미강다육🌻')
    // 아직 보내지 않았다
    expect(w.server.callsTo('POST', /\/broadcasts\/b1\/youtube$/)).toHaveLength(0)
    expect(LINK_CONFIRM_ACTION).toBe('연결하기')
    fireEvent.click(within(page).getByRole('button', { name: LINK_CONFIRM_ACTION }))
    const info = await screen.findByTestId('link-info-page')
    expect(w.server.callsTo('POST', /\/broadcasts\/b1\/youtube$/)[0]?.body).toMatchObject({ video: 'https://youtu.be/MIGANG00001', confirmInvited: true })
    // D-UX4-119: 이을 때 남긴 제목이 바로 — 연결 정보 화면이 미리 보기를 다시 부르지 않는다
    expect(within(info).getByTestId('link-info-title').textContent).toContain(LONG)
    expect(w.server.callsTo('POST', /\/api\/youtube\/preview$/)).toHaveLength(1)
  })

  it('[다음]은 미리 보기를 기다리지 않고 바로 확인 화면 — 받는 동안 회색 막대·[연결하기] 꺼짐, 아무것도 잇지 않는다 (D-UX4-121)', async () => {
    const w = world()
    let answer: (() => void) | null = null
    w.server.on('POST', /^\/api\/youtube\/preview$/, async () => {
      await new Promise<void>((resolve) => {
        answer = resolve
      })
      return { body: { title: LONG, channelTitle: '미강다육🌻', channelId: 'UC_MIGANG' } }
    })
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    fireEvent.change(await screen.findByRole('textbox', { name: '라이브 링크' }), { target: { value: 'https://youtu.be/MIGANG00001' } })
    fireEvent.click(screen.getByRole('button', { name: LINK_NEXT }))
    const page = await screen.findByTestId('link-confirm')
    expect(within(page).getByTestId('live-check-loading')).toBeTruthy()
    expect(within(page).getByRole('button', { name: LINK_CONFIRM_ACTION }).getAttribute('aria-disabled')).toBe('true')
    expect(w.server.callsTo('POST', /\/broadcasts\/b1\/youtube$/)).toHaveLength(0)
    await waitFor(() => expect(answer).not.toBeNull())
    await act(async () => {
      answer?.()
    })
    expect((await within(page).findByTestId('live-check-title')).textContent).toBe(LONG)
    expect(within(page).queryByTestId('live-check-loading')).toBeNull()
    expect(within(page).getByRole('button', { name: LINK_CONFIRM_ACTION }).getAttribute('aria-disabled')).not.toBe('true')
    expect(w.server.callsTo('POST', /\/broadcasts\/b1\/youtube$/)).toHaveLength(0)
  })

  it('받는 중에 뒤로 가면 늦게 온 답은 버린다 — 링크 화면 그대로 (D-UX4-121)', async () => {
    const w = world()
    let answer: (() => void) | null = null
    w.server.on('POST', /^\/api\/youtube\/preview$/, async () => {
      await new Promise<void>((resolve) => {
        answer = resolve
      })
      return { body: { title: LONG, channelTitle: '미강다육🌻', channelId: 'UC_MIGANG' } }
    })
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    fireEvent.change(await screen.findByRole('textbox', { name: '라이브 링크' }), { target: { value: 'https://youtu.be/MIGANG00001' } })
    fireEvent.click(screen.getByRole('button', { name: LINK_NEXT }))
    fireEvent.click(within(await screen.findByTestId('link-confirm')).getByRole('button', { name: '뒤로' }))
    await screen.findByRole('textbox', { name: '라이브 링크' })
    await waitFor(() => expect(answer).not.toBeNull())
    await act(async () => {
      answer?.()
    })
    expect(screen.queryByTestId('link-confirm')).toBeNull()
  })

  it('확인 화면의 뒤로 → 링크 화면(넣은 링크 그대로), 아무것도 보내지 않는다', async () => {
    const w = world()
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    fireEvent.change(await screen.findByRole('textbox', { name: '라이브 링크' }), { target: { value: 'https://youtu.be/MIGANG00001' } })
    fireEvent.click(screen.getByRole('button', { name: LINK_NEXT }))
    fireEvent.click(within(await screen.findByTestId('link-confirm')).getByRole('button', { name: '뒤로' }))
    const field = (await screen.findByRole('textbox', { name: '라이브 링크' })) as HTMLInputElement
    expect(field.value).toBe('https://youtu.be/MIGANG00001')
    expect(screen.queryByTestId('link-confirm')).toBeNull()
    expect(w.server.callsTo('POST', /\/broadcasts\/b1\/youtube$/)).toHaveLength(0)
  })

  it('[연결하기]가 거절되면 링크 화면으로 돌아가 칸 아래에 짧은 까닭', async () => {
    const w = world({ refuse: true })
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    fireEvent.change(await screen.findByRole('textbox', { name: '라이브 링크' }), { target: { value: 'https://youtu.be/MIGANG00001' } })
    fireEvent.click(screen.getByRole('button', { name: LINK_NEXT }))
    const confirmPage = await screen.findByTestId('link-confirm')
    await within(confirmPage).findByTestId('live-check-title') // D-UX4-121
    fireEvent.click(within(confirmPage).getByRole('button', { name: LINK_CONFIRM_ACTION }))
    await waitFor(() => expect(screen.queryByTestId('link-confirm')).toBeNull())
    expect((await screen.findByRole('alert')).textContent).toBe('라이브 채팅을 받을 수 없는 라이브예요.')
  })

  it('최근 라이브 [연결] → 같은 확인 화면', async () => {
    const w = world({ recent: [{ videoId: 'MIGANG00001', title: LONG, status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId: 'UC_MIGANG', channelTitle: '미강다육🌻' }] })
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    fireEvent.click(await screen.findByRole('button', { name: '미강다육🌻 연결' }))
    const page = await screen.findByTestId('link-confirm')
    expect(within(page).getByTestId('live-check-title').textContent).toBe(LONG)
    // D-UX4-121: 최근 라이브 줄은 이미 아는 제목·채널을 바로 쓴다 — 미리 보기를 부르지 않는다 (옛 기대: 미리 보기 { video } 한 번)
    expect(within(page).getByTestId('live-check-channel').textContent).toBe('미강다육🌻')
    expect(within(page).getByRole('button', { name: LINK_CONFIRM_ACTION }).getAttribute('aria-disabled')).not.toBe('true')
    expect(w.server.callsTo('POST', /\/api\/youtube\/preview$/)).toHaveLength(0)
  })

  // 다른 라이브에 연결된 줄의 [연결]은 흐리지 않고 누를 수 있다 — 누르면 옮길지 묻는다 (D-YT-MOVE-01로 바뀜, 옛: 흐린 [연결])
  it('예정 라이브는 라이브 표시 없이 "예정", 다른 라이브에 연결된 것은 그 말과 누를 수 있는 [연결] (D-YT-MOVE-01)', async () => {
    const w = world({
      recent: [
        { videoId: 'SOON0000001', title: '예정 라이브', status: 'UPCOMING', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId: 'UC_A', channelTitle: '가게A' },
        { videoId: 'USED0000001', title: '쓰는 라이브', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: 'b2', channelId: 'UC_B', channelTitle: '가게B' },
      ],
    })
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const rows = await screen.findAllByTestId('recent-live')
    expect(within(rows[0] as HTMLElement).queryByTestId('channel-live-tag')).toBeNull()
    expect(within(rows[0] as HTMLElement).getByTestId('recent-live-sub').textContent).toBe('예정')
    expect(within(rows[1] as HTMLElement).getByTestId('recent-live-sub').textContent).toBe('다른 라이브에 연결돼 있어요')
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: '가게B 연결' }).getAttribute('aria-disabled')).not.toBe('true')
  })

  // D-RECENT-LIVE-01 (사용자 "그 아래 애매한 빈 줄은 뭐니? 차라리 지금 유튜브에서 라이브 중이에요 이렇게 넣어")
  it('지금 라이브 중인 줄은 빈 줄 대신 "지금 유튜브에서 라이브 중이에요"', async () => {
    const w = world({
      recent: [{ videoId: 'LIVE0000001', title: '지금 라이브', status: 'LIVE', scheduledStartTime: null, actualStartTime: null, linkedBroadcast: null, channelId: 'UC_A', channelTitle: '가게A' }],
    })
    render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
    const rows = await screen.findAllByTestId('recent-live')
    expect(within(rows[0] as HTMLElement).getByTestId('recent-live-sub').textContent).toBe(LIVE_NOW_YOUTUBE)
    expect(LIVE_NOW_YOUTUBE).toBe('지금 유튜브에서 라이브 중이에요')
  })
})

describe('관리/라이브 연결의 라이브 제목은 바로 (D-UX4-119)', () => {
  it('이은 기록에 제목이 있으면 미리 보기를 부르지 않고 바로, 옛 기록(제목 없음)만 미리 보기로', async () => {
    for (const stored of [LONG, null]) {
      const w = makeWorld({ products: [] })
      w.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: CONNECTION }))
      w.server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: { videoId: 'MIGANG00001', channelId: null, broadcastChannelId: 'UC_MIGANG', broadcastChannelTitle: '미강다육🌻', broadcastTitle: stored, invited: false, linkedAt: '2026-11-10T12:00:00.000Z', chatEnded: false }, collector: null } }))
      w.server.on('POST', /^\/api\/youtube\/preview$/, () => ({ body: { title: '미리 본 제목', channelTitle: '미강다육🌻' } }))
      const { unmount } = render(w.wrap(<BroadcastLinkScreen broadcastId="b1" closed={false} onBack={() => {}} />))
      const info = await screen.findByTestId('link-info-page')
      if (stored !== null) {
        expect(within(info).getByTestId('link-info-title').textContent).toContain(LONG)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
        })
        expect(w.server.callsTo('POST', /\/api\/youtube\/preview$/)).toHaveLength(0)
      } else {
        await waitFor(() => expect(within(info).getByTestId('link-info-title').textContent).toContain('미리 본 제목'))
      }
      unmount()
    }
  })
})
