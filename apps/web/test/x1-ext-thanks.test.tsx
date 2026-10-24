// X1 확장으로 감사 채팅 올리기 화면 (AC-X1-26·27·32, YT-10 AC11·AC12·AC17): 설정 스위치(기본 꺼짐·"켤게요" 뒤에만), 콘솔 경고·다시 켜기.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionThanksView, ExtensionView } from '../src/api/types.ts'
import { ExtensionSettings, ExtensionThanksBar, useExtension } from '../src/components/ExtensionConnection.tsx'
import { EXTENSION_THANKS_QUESTION, parseExtensionEvent, thanksWarnings } from '../src/lib/extension.ts'
import { FakeEventSource, FakeServer, type Reply } from './support.ts'

const B = 'b-2026-10-23-1'
const OWNER = '방송 채널 계정으로 로그인해야 감사 글을 올릴 수 있어요'
const PAUSED = '확장으로 감사 글을 올리지 못하고 있어요'

function extView(thanks: Partial<ExtensionThanksView> = {}): ExtensionView {
  return {
    connected: true,
    connectedAt: '2026-10-23T05:00:00.000Z',
    lastUsedAt: null,
    state: 'RECEIVING',
    message: '확장으로 받는 중',
    manual: null,
    broadcasts: [B],
    statusAt: null,
    lastChatAt: null,
    dropped: 0,
    thanks: { enabled: false, enabledAt: null, warnings: [], ...thanks },
  }
}

let server: FakeServer
let view: ExtensionView

beforeEach(() => {
  server = new FakeServer()
  view = extView()
  server
    .on('GET', /^\/api\/extension$/, (): Reply => ({ body: { extension: view } }))
    .on('POST', /^\/api\/extension\/thanks$/, (call): Reply => {
      const body = call.body as { enabled: boolean }
      view = extView({ enabled: body.enabled, enabledAt: body.enabled ? '2026-10-23T05:10:00.000Z' : null })
      return { body: { extension: view } }
    })
    .on('POST', /^\/api\/extension\/thanks\/resume$/, (): Reply => {
      view = extView({ enabled: true })
      return { body: { extension: view } }
    })
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Settings() {
  return <ExtensionSettings handle={useExtension()} />
}

function Bar({ ended = false, broadcast = B }: { readonly ended?: boolean; readonly broadcast?: string }) {
  return <ExtensionThanksBar handle={useExtension()} broadcastId={broadcast} ended={ended} />
}

describe('설정 — 확장으로 감사 채팅 올리기 (AC-X1-26)', () => {
  // MOB1 D-MOB1-09: 휴대폰 폭 설정의 크롬 확장 칸은 한 줄 안내뿐 — 이 묶음은 PC 폭(지금 그대로)으로 본다
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 48rem)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  })

  it('기본은 꺼짐. 켜기는 설명 창에서 "켤게요"를 눌러야 하고, "그대로 두기"면 아무것도 보내지 않는다', async () => {
    render(<Settings />)
    const group = await screen.findByRole('group', { name: '확장으로 감사 채팅 올리기' })
    expect(within(group).getByText('꺼짐')).toBeTruthy()
    fireEvent.click(within(group).getByRole('button', { name: '확장으로 감사 채팅 올리기 켜기' }))
    let dialog = screen.getByRole('dialog', { name: '확장으로 감사 채팅 올리기를 켤까요?' })
    expect(dialog.textContent).toContain(EXTENSION_THANKS_QUESTION)
    expect(EXTENSION_THANKS_QUESTION).toBe('판매자님 유튜브 계정으로 채팅에 감사 글을 올려요. 유튜브가 자동 글쓰기를 막을 수 있어요.')
    fireEvent.click(within(dialog).getByRole('button', { name: '그대로 두기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(server.callsTo('POST', /^\/api\/extension\/thanks$/)).toHaveLength(0)

    fireEvent.click(within(group).getByRole('button', { name: '확장으로 감사 채팅 올리기 켜기' }))
    dialog = screen.getByRole('dialog', { name: '확장으로 감사 채팅 올리기를 켤까요?' })
    fireEvent.click(within(dialog).getByRole('button', { name: '켤게요' }))
    await waitFor(() => expect(within(group).getByText('켜짐')).toBeTruthy())
    expect(server.callsTo('POST', /^\/api\/extension\/thanks$/)[0]?.body).toEqual({ enabled: true, agreed: true })

    fireEvent.click(within(group).getByRole('button', { name: '확장으로 감사 채팅 올리기 끄기' }))
    await waitFor(() => expect(within(group).getByText('꺼짐')).toBeTruthy())
    expect(server.callsTo('POST', /^\/api\/extension\/thanks$/)[1]?.body).toEqual({ enabled: false })
  })
})

describe('콘솔 고정 영역 (AC-X1-27·32)', () => {
  it('멈춤이면 경고와 "다시 켜기" → 다시 맡는다. 영어 값은 보이지 않는다', async () => {
    view = extView({ enabled: true, warnings: [{ broadcast: B, kind: 'PAUSED', message: PAUSED }] })
    const { container } = render(<Bar />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(PAUSED)
    expect(container.textContent).not.toMatch(/PAUSED|OWNER/)
    fireEvent.click(within(alert).getByRole('button', { name: '다시 켜기' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(server.callsTo('POST', /^\/api\/extension\/thanks\/resume$/)[0]?.body).toEqual({ broadcast: B })
  })

  it('채널 주인이 아니면 할 일을 알려 주고 "다시 켜기"는 없다', async () => {
    view = extView({ enabled: true, warnings: [{ broadcast: B, kind: 'OWNER', message: OWNER }] })
    render(<Bar />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(OWNER)
    expect(alert.textContent).toContain('방송 채널 계정으로 로그인해 주세요')
    expect(within(alert).queryByRole('button')).toBeNull()
  })

  it('다른 방송·끝난 방송·스위치 꺼짐이면 보이지 않는다', async () => {
    view = extView({ enabled: true, warnings: [{ broadcast: B, kind: 'PAUSED', message: PAUSED }] })
    render(<Bar broadcast="other" />)
    await waitFor(() => expect(server.callsTo('GET', /^\/api\/extension$/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    render(<Bar ended />)
    await waitFor(() => expect(server.callsTo('GET', /^\/api\/extension$/).length).toBeGreaterThan(1))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(thanksWarnings(extView({ enabled: false, warnings: [{ broadcast: B, kind: 'PAUSED', message: PAUSED }] }), B)).toEqual([])
  })

  it('SSE 모양 검사: thanks 모양이 틀리면 버린다', () => {
    expect(parseExtensionEvent(JSON.stringify(extView()))).toEqual(extView())
    expect(parseExtensionEvent(JSON.stringify({ ...extView(), thanks: 'x' }))).toBeNull()
  })
})
