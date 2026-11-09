// 사용자 지시 2026-11-10 (D-UX4-69~71):
// - 들린 말 창을 펼쳤을 때 지난 말이 없으면 "지난 들린 말이 아직 없어요." 같은 안내를 띄우지 않고 비워 둔다
// - 되돌리기 창을 띄우지 않는다 — 바로 등록 뒤 "N번 등록 되돌리기", 바로 고친 뒤 "고침 되돌리기", "방금 등록한 …" 되돌리기 카드. 고칠 것은 상품에서 직접
// - 방송 화면 맨 아래 창을 관리에서 고른다: 들린 말(기본) · 채팅·문자 · 안 보기 (이 휴대폰에 기억)
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VoiceSnapshot } from '@livejjim/web/src/voice/model.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { ListenLine } from '../src/screens/console/StreamAudio.tsx'
import { offerShown } from '../src/screens/console/RemoteVoicePanel.tsx'
import { DOCK_CHOICE_KEY, DOCK_TITLE, getDockChoice, setDockChoice, wireDockChoice } from '../src/lib/dock-choice.ts'
import type { VoiceSession, VoiceView } from '../src/lib/voice-session.ts'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

function fakeVoice(view: Partial<VoiceView>): VoiceSession {
  const full = { on: true, broadcastId: 'b1', state: { kind: 'listening' }, transcript: [], transcriptAt: [], ...view } as unknown as VoiceView
  return { subscribe: () => () => {}, getView: () => full } as unknown as VoiceSession
}

async function open(world: ReturnType<typeof makeWorld>) {
  render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
  await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
  await act(async () => {
    world.source().open([{ date: '2026-10-29', rehearsal: false, seq: world.seq }])
    await flush()
  })
}

describe('들린 말 창 — 지난 말이 없으면 비워 둔다 (D-UX4-69)', () => {
  it('펼쳐도 안내 문장 없이 빈 칸', () => {
    render(<ListenLine session={fakeVoice({ transcript: ['지금 말'], transcriptAt: [0] })} broadcastId="b1" stream={{ status: null, hold: false, retry: () => {} }} bottom={0} />)
    const dock = screen.getByRole('region', { name: '들린 말 창' })
    fireEvent.click(within(dock).getByRole('button', { name: '들린 말 펼치기' }))
    const log = within(dock).getByRole('log', { name: '지난 들린 말' })
    expect(log.textContent).toBe('')
    expect(within(dock).queryByText(/아직 없어요/)).toBeNull()
    expect(within(dock).queryAllByTestId('heard-row')).toHaveLength(0)
  })
})

describe('되돌리기 창을 띄우지 않는다 (D-UX4-70)', () => {
  type Offer = VoiceSnapshot['offers'][number]
  const offer = (patch: Partial<Offer>): Offer => ({ id: 'offer-1', kind: 'offer', registrationId: 'r1', message: '15번 가격을 고칠까요?', changes: {}, stage: 'ask', before: null, undoUntil: null, error: null, ...patch }) as Offer
  it('묻기(고치기·번호)와 실패 안내만 보이고, 되돌리기·늦은 말·고친 뒤 카드는 숨긴다', () => {
    expect(offerShown(offer({}))).toBe(true)
    expect(offerShown(offer({ kind: 'number' }))).toBe(true)
    expect(offerShown(offer({ kind: 'card' }))).toBe(true)
    expect(offerShown(offer({ kind: 'undo' }))).toBe(false)
    expect(offerShown(offer({ kind: 'late' }))).toBe(false)
    expect(offerShown(offer({ stage: 'fixed', undoUntil: Date.now() + 10_000 }))).toBe(false)
    expect(offerShown(offer({ stage: 'fixed', error: '고치지 못했어요.' }))).toBe(true)
  })
})

describe('화면 아래 창 고르기 (D-UX4-71)', () => {
  it('기본은 들린 말 — 관리에서 채팅·문자로 바꾸면 채팅 창, 안 보기면 아무 창도 없다', async () => {
    const world = makeWorld({ products: [] })
    world.server.on('GET', /^\/api\/days\/2026-10-29\/messages/, () => ({ body: { date: '2026-10-29', rehearsal: false, seq: 5, more: false, messages: [{ id: 'm1', broadcast: 'b1', channel: 'ch1', nick: '꽃집언니', text: '15번이요', owner: false, seq: 4, at: '2026-10-29T11:00:00.000Z', publishedAt: '2026-10-29T11:00:00.000Z', ignored: false, order: true, cancel: false, orders: [15], cancels: [], mentions: [15], converted: [], claims: [], failed: false }] } }))
    await open(world)
    expect(screen.getByRole('region', { name: '들린 말 창' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '채팅·문자 창' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '방송 관리' }))
    const row = screen.getByTestId('dock-choice')
    expect(row.textContent).toContain(DOCK_TITLE)
    expect(row.textContent).toContain('들린 말')
    fireEvent.click(row)
    const sheet = screen.getByRole('dialog', { name: DOCK_TITLE })
    const group = within(sheet).getByRole('radiogroup', { name: DOCK_TITLE })
    expect(within(group).getAllByRole('radio').map((item) => item.getAttribute('aria-label'))).toEqual(['들린 말', '채팅·문자', '안 보기'])
    expect(within(group).getByRole('radio', { name: '들린 말' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(group).getByRole('radio', { name: '채팅·문자' }))
    expect(getDockChoice()).toBe('talk')
    await waitFor(() => expect(screen.getByRole('region', { name: '채팅·문자 창' })).toBeTruthy())
    expect(screen.queryByRole('region', { name: '들린 말 창' })).toBeNull()
    // 접으면 최근 한 줄
    await waitFor(() => expect(screen.getByRole('status', { name: '최근 채팅·문자' }).textContent).toContain('꽃집언니'))
    expect(screen.getByRole('status', { name: '최근 채팅·문자' }).textContent).toContain('15번이요')

    act(() => setDockChoice('none'))
    expect(screen.queryByRole('region', { name: '들린 말 창' })).toBeNull()
    expect(screen.queryByRole('region', { name: '채팅·문자 창' })).toBeNull()
  })

  it('고른 것은 이 휴대폰 저장소에 남고, 다시 켜면 되살린다 (깨진 값은 기본)', async () => {
    const saved = new Map<string, string>([[DOCK_CHOICE_KEY, 'talk']])
    const storage = { getItem: vi.fn(async (key: string) => saved.get(key) ?? null), setItem: vi.fn(async (key: string, value: string) => { saved.set(key, value) }) }
    await wireDockChoice(storage)
    expect(getDockChoice()).toBe('talk')
    setDockChoice('none')
    expect(storage.setItem).toHaveBeenCalledWith(DOCK_CHOICE_KEY, 'none')
    setDockChoice('voice')
    saved.set(DOCK_CHOICE_KEY, '이상한 값')
    await wireDockChoice(storage)
    expect(getDockChoice()).toBe('voice')
  })
})
