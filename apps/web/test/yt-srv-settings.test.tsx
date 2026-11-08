// 서버가 읽는 유튜브 채팅 — 설정·시작 마법사 유튜브 칸 (YT-01 서버 수집, D-YT-SRV-11·13):
// 첫 줄 "방송할 때 방송 주소만 넣으면 채팅을 받아요.", 구글 연결은 "감사 채팅을 올리려면 (선택)" 칸의 보조 버튼, 구글 연결을 못 쓰는 서버는 안내만.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { YoutubeConnection } from '../src/api/types.ts'
import { useYoutubeConnection, withConnection, YoutubeStatus } from '../src/components/YoutubeConnection.tsx'
import type { Navigate } from '../src/lib/router.ts'
import { FakeServer, connection } from './support.ts'

const INTRO = '방송할 때 방송 주소만 넣으면 채팅을 받아요.'
const OPTIONAL = '감사 채팅을 올리려면 (선택)'

let server: FakeServer
let youtube: YoutubeConnection
let body: Record<string, unknown>
let navigate: Navigate

function Harness({ place }: { readonly place: 'settings' | 'wizard' }) {
  const handle = useYoutubeConnection()
  return <YoutubeStatus handle={handle} quota={null} navigate={navigate} place={place} />
}

beforeEach(() => {
  server = new FakeServer()
  youtube = connection({ status: 'NOT_CONNECTED', channel: null })
  body = { webChat: { on: true }, oauth: true }
  navigate = vi.fn()
  server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: youtube, ...body } }))
  server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
  vi.stubGlobal('fetch', server.fetch)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('설정·마법사 유튜브 칸 (D-YT-SRV-11)', () => {
  for (const place of ['settings', 'wizard'] as const) {
    it(`${place}: 첫 줄은 방송 주소만, 구글 연결은 감사 채팅용 선택 칸의 보조 버튼 — "채팅 읽기"를 할 수 있는 일로 말하지 않는다`, async () => {
      render(<Harness place={place} />)
      expect(await screen.findByText(INTRO)).toBeDefined()
      const optional = screen.getByRole('region', { name: OPTIONAL })
      expect(within(optional).getByText('구글 연결은 감사 채팅을 올릴 때만 필요해요. 연결하지 않아도 채팅은 받아요.')).toBeDefined()
      expect(optional.textContent).toContain('채팅 받기에는 구글 연결을 쓰지 않아요.')
      expect(optional.textContent).not.toContain('방송 채팅 읽기')
      const connect = within(optional).getByRole('button', { name: '구글로 유튜브 연결하기' })
      expect(connect.className).not.toContain('button-primary')
      expect(document.body.textContent).not.toMatch(/API|OAuth|WEB/)
    })
  }

  it('구글 연결을 쓸 수 없는 서버(oauth=false): 연결 버튼 대신 안내', async () => {
    body = { webChat: { on: true }, oauth: false }
    render(<Harness place="settings" />)
    expect(await screen.findByText('이 서버에서는 감사 채팅을 올리는 구글 연결을 쓰지 않아요. 채팅은 방송 주소만으로 받아요.')).toBeDefined()
    expect(screen.queryByRole('button', { name: '구글로 유튜브 연결하기' })).toBeNull()
    expect(screen.getByText(INTRO)).toBeDefined()
  })

  // D-YT-SEND-18: 봇이 감사 채팅을 대신 올리는 판매자 — 구글 연결 칸 대신 안내 한 줄, 연결 버튼 없음
  it('봇 감사 판매자(botThanks): 구글 연결 칸·버튼 대신 "감사 채팅은 라이브지니가 올려요"', async () => {
    body = { webChat: { on: true }, oauth: true, botThanks: true }
    render(<Harness place="settings" />)
    const bot = await screen.findByRole('region', { name: '감사 채팅은 라이브지니가 올려요' })
    expect(bot.textContent).toContain('구글 연결은 필요 없어요.')
    expect(screen.queryByRole('region', { name: OPTIONAL })).toBeNull()
    expect(screen.queryByRole('button', { name: '구글로 유튜브 연결하기' })).toBeNull()
    expect(screen.getByText(INTRO)).toBeDefined()
  })

  it('운영자가 끄면 첫 줄 아래 안내', async () => {
    body = { webChat: { on: false }, oauth: true }
    render(<Harness place="settings" />)
    expect(await screen.findByText('지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.')).toBeDefined()
  })

  it('다시 연결 필요: 감사 채팅 몫만 말한다, 끊기 창은 "채팅은 그대로 받아요" — 채팅 받는 방송을 찾지 않는다', async () => {
    youtube = connection({ status: 'RECONNECT_NEEDED' })
    render(<Harness place="settings" />)
    expect(await screen.findByText('감사 채팅을 올리는 구글 연결을 다시 해 주세요. 채팅은 그대로 받아요.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '연결 끊기' }))
    const dialog = screen.getByRole('dialog', { name: '유튜브 연결을 끊을까요?' })
    expect(dialog.textContent).toContain('끊으면 감사 메시지 자동 게시가 멈추고, 자동 게시 동의도 지워져요. 채팅은 그대로 받아요.')
    expect(dialog.textContent).not.toContain('채팅 수집')
    expect(server.callsTo('GET', /^\/api\/broadcasts$/)).toHaveLength(0)
  })

  it('옛 공식 읽기(webChat 없음)는 그대로 — 첫 줄·선택 칸 없음, 마법사의 연결 버튼은 주 버튼', async () => {
    body = {}
    render(<Harness place="wizard" />)
    const connect = await screen.findByRole('button', { name: '구글로 유튜브 연결하기' })
    expect(connect.className).toContain('button-primary')
    expect(screen.queryByText(INTRO)).toBeNull()
    expect(screen.queryByRole('region', { name: OPTIONAL })).toBeNull()
    expect(document.body.textContent).toContain('방송 채팅 읽기(찜 받기)')
  })
})

describe('알림으로 받은 연결 (withConnection)', () => {
  it('서버 읽기·구글 연결 가능 여부는 연결 응답에만 있다 — 알림으로 연결이 바뀌어도 그대로 둔다', () => {
    const next = connection({ status: 'CONNECTED' })
    expect(withConnection({ phase: 'ready', connection: youtube, webChat: { on: true }, oauth: false }, next)).toEqual({ phase: 'ready', connection: next, webChat: { on: true }, oauth: false })
    expect(withConnection({ phase: 'loading' }, next)).toEqual({ phase: 'ready', connection: next })
  })
})
