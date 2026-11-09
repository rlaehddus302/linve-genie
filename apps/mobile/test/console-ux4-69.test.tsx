// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
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
import { DOCK_CHOICE_KEY, DOCK_CHOICES, DOCK_TITLE, getDockChoice, setDockChoice, wireDockChoice } from '../src/lib/dock-choice.ts'
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

    fireEvent.click(screen.getByRole('button', { name: '라이브 관리' }))
    const row = screen.getByTestId('dock-choice')
    expect(row.textContent).toContain(DOCK_TITLE)
    expect(row.textContent).toContain('들린 말')
    fireEvent.click(row)
    const sheet = screen.getByRole('dialog', { name: DOCK_TITLE })
    const group = within(sheet).getByRole('radiogroup', { name: DOCK_TITLE })
    expect(within(group).getAllByRole('radio').map((item) => item.getAttribute('aria-label'))).toEqual(['들린 말', '채팅·문자', '안 보기'])
    // 설명 (D-UX4-89): 창 제목 밑 한 줄 + 줄마다 한 줄
    expect(sheet.textContent).toContain('라이브 화면 맨 아래에 무엇을 띄울지 골라요.')
    expect(sheet.textContent).toContain('어느 것을 골라도 듣기는 계속돼요.')
    for (const item of DOCK_CHOICES) expect(within(group).getByRole('radio', { name: item.label }).textContent).toContain(item.description)
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

describe('펼친 아래 창: 지난 줄과 지금 줄 사이 여백·빠르기 (D-UX4-90)', () => {
  it('지난 말 칸은 아래 여백 없이 지금 줄 위로 겹쳐, 사이가 지난 줄끼리 사이(4)와 같다 · 열고 닫기 160ms', async () => {
    const { DOCK_ROW_HEIGHT, HEARD_OPEN_MS, HEARD_OVERLAP } = await import('../src/screens/console/StreamAudio.tsx')
    const { TALK_OVERLAP } = await import('../src/screens/console/LiveTalk.tsx')
    const { SPACE } = await import('../src/ui/kit/tokens.ts')
    expect(HEARD_OPEN_MS).toBeLessThanOrEqual(160)
    // 지금 줄 글자 위 빈 곳 − 겹침 = 지난 줄 사이
    expect((DOCK_ROW_HEIGHT - 20) / 2 - HEARD_OVERLAP).toBe(SPACE.xs)
    expect((DOCK_ROW_HEIGHT - 24) / 2 - TALK_OVERLAP).toBe(SPACE.xs)
    render(<ListenLine session={fakeVoice({ transcript: ['첫 말', '지금 말'], transcriptAt: [0, 1000] })} broadcastId="b1" stream={{ status: null, hold: false, retry: () => {} }} bottom={0} />)
    fireEvent.click(screen.getByRole('button', { name: '들린 말 펼치기' }))
    const box = getComputedStyle(screen.getByTestId('heard-log-box'))
    expect(box.paddingBottom === '' || box.paddingBottom === '0px').toBe(true)
    expect(box.marginBottom).toBe(`-${String(HEARD_OVERLAP)}px`)
  })
})

describe('아래 창과 같은 탭은 숨기고, 들린 말 탭 (D-UX4-91)', () => {
  const pills = () => screen.getByRole('tablist', { name: '보기' }).querySelectorAll('[role="button"]')
  const names = () => [...pills()].map((pill) => pill.getAttribute('aria-label'))
  it('아래 창이 들린 말이면 들린 말 탭이 없고, 채팅·문자면 채팅·문자 탭이 없고, 안 보기면 둘 다 있다 — 숨긴 탭을 보고 있었으면 상품으로', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    expect(names()).toEqual(['상품', '찜 기록', '채팅·문자'])
    fireEvent.click(screen.getByRole('button', { name: '채팅·문자' }))
    expect(screen.getByRole('button', { name: '채팅·문자' }).getAttribute('aria-selected')).toBe('true')
    act(() => setDockChoice('talk'))
    expect(names()).toEqual(['상품', '찜 기록', '들린 말'])
    expect(screen.getByRole('button', { name: '상품' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '들린 말' }))
    expect(await screen.findByText('아직 들린 말이 없어요')).toBeTruthy()
    act(() => setDockChoice('none'))
    expect(names()).toEqual(['상품', '찜 기록', '채팅·문자', '들린 말'])
  })

  it('들린 말 탭: 들린 시각(한국 시각) + 말, 새 말이 아래', async () => {
    const { HeardTab } = await import('../src/screens/console/StreamAudio.tsx')
    const base = Date.parse('2026-10-29T12:07:33.000Z')
    render(<HeardTab session={fakeVoice({ transcript: ['첫 말', '둘째 말'], transcriptAt: [base, base + 5000] })} />)
    expect(screen.getAllByTestId('heard-tab-row').map((row) => row.textContent)).toEqual(['21:07:33첫 말', '21:07:38둘째 말'])
  })
})

describe('탭 바 반고정 (D-UX4-93)', () => {
  it('제자리 탭 바를 지나 내리면 숨고, 올리면 위에 붙어 보이고, 제자리로 돌아오면 붙은 탭 바는 없다', async () => {
    const { quickReturnStep } = await import('../src/screens/ConsoleScreen.tsx')
    const bottom = 300
    let state = { y: 0, floating: false, shown: false }
    const go = (y: number) => {
      state = quickReturnStep(state, y, bottom)
      return state
    }
    expect(go(100)).toMatchObject({ floating: false })
    expect(go(400)).toMatchObject({ floating: true, shown: false }) // 막 지나감 — 내리는 중이라 숨음
    expect(go(600)).toMatchObject({ floating: true, shown: false }) // 더 내림
    expect(go(598)).toMatchObject({ shown: false }) // 손떨림(4 이하)은 그대로
    expect(go(560)).toMatchObject({ floating: true, shown: true }) // 올림 → 보임
    expect(go(700)).toMatchObject({ shown: false }) // 다시 내림 → 숨음
    expect(go(650)).toMatchObject({ shown: true })
    expect(go(250)).toMatchObject({ floating: false }) // 제자리까지 올라옴 → 제자리 것만
  })

  it('처음(맨 위)에는 위에 붙는 탭 바를 그리지 않는다', async () => {
    const world = makeWorld({ products: [] })
    await open(world)
    expect(screen.queryByTestId('floating-tabs')).toBeNull()
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
  })
})
