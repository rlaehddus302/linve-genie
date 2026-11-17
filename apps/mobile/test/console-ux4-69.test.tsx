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
    const dock = screen.getByRole('region', { name: '음성 인식 창' }) // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말 창")
    fireEvent.click(within(dock).getByRole('button', { name: '음성 인식 펼치기' })) // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말 펼치기")
    const log = within(dock).getByRole('log', { name: '지난 인식한 말' }) // 문구 바뀜 (D-UX4-96, 옛 기대: "지난 들린 말")
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
    expect(screen.getByRole('region', { name: '음성 인식 창' })).toBeTruthy() // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말 창")
    expect(screen.queryByRole('region', { name: '채팅·문자 창' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '라이브 관리' }))
    const row = screen.getByTestId('dock-choice')
    expect(row.textContent).toContain(DOCK_TITLE)
    expect(row.textContent).toContain('음성 인식') // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말")
    fireEvent.click(row)
    const sheet = screen.getByRole('dialog', { name: DOCK_TITLE })
    const group = within(sheet).getByRole('radiogroup', { name: DOCK_TITLE })
    expect(within(group).getAllByRole('radio').map((item) => item.getAttribute('aria-label'))).toEqual(['음성 인식', '채팅·문자', '안 보기']) // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말")
    // 설명 (D-UX4-89): 창 제목 밑 한 줄 + 줄마다 한 줄
    expect(sheet.textContent).toContain('라이브 화면 맨 아래에 무엇을 띄울지 골라요.')
    expect(sheet.textContent).toContain('어느 것을 골라도 음성 인식은 계속돼요.') // 문구 바뀜 (D-UX4-96, 옛 기대: "어느 것을 골라도 듣기는 계속돼요.")
    for (const item of DOCK_CHOICES) expect(within(group).getByRole('radio', { name: item.label }).textContent).toContain(item.description)
    expect(within(group).getByRole('radio', { name: '음성 인식' }).getAttribute('aria-checked')).toBe('true') // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말")
    fireEvent.click(within(group).getByRole('radio', { name: '채팅·문자' }))
    expect(getDockChoice()).toBe('talk')
    await waitFor(() => expect(screen.getByRole('region', { name: '채팅·문자 창' })).toBeTruthy())
    expect(screen.queryByRole('region', { name: '음성 인식 창' })).toBeNull() // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말 창")
    // 접으면 최근 한 줄
    await waitFor(() => expect(screen.getByRole('status', { name: '최근 채팅·문자' }).textContent).toContain('꽃집언니'))
    expect(screen.getByRole('status', { name: '최근 채팅·문자' }).textContent).toContain('15번이요')

    act(() => setDockChoice('none'))
    expect(screen.queryByRole('region', { name: '음성 인식 창' })).toBeNull() // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말 창")
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
    fireEvent.click(screen.getByRole('button', { name: '음성 인식 펼치기' })) // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말 펼치기")
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
    expect(names()).toEqual(['상품', '찜 기록', '음성 인식']) // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말")
    expect(screen.getByRole('button', { name: '상품' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '음성 인식' })) // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말")
    expect(await screen.findByText('아직 인식한 말이 없어요')).toBeTruthy() // 문구 바뀜 (D-UX4-96, 옛 기대: "아직 들린 말이 없어요")
    act(() => setDockChoice('none'))
    expect(names()).toEqual(['상품', '찜 기록', '채팅·문자', '음성 인식']) // 문구 바뀜 (D-UX4-96, 옛 기대: "들린 말")
  })

  it('들린 말 탭: 들린 시각(한국 시각) + 말, 새 말이 아래', async () => {
    const { HeardTab } = await import('../src/screens/console/StreamAudio.tsx')
    const base = Date.parse('2026-10-29T12:07:33.000Z')
    // D-UX4-156: 탭은 그 방송(broadcastId)의 서버 기록에 이 기기 줄을 잇는다 — 서버 기록이 없으면(여기선 받지 못함) 이 기기 줄만 (옛: session만 받았다)
    render(<HeardTab session={fakeVoice({ transcript: ['첫 말', '둘째 말'], transcriptAt: [base, base + 5000] })} broadcastId="b1" live />)
    expect(screen.getAllByTestId('heard-tab-row').map((row) => row.textContent)).toEqual(['21:07:33첫 말', '21:07:38둘째 말'])
  })
})

describe('탭 바 반고정 (D-UX4-93 → D-UX4-98 → D-UX4-104 → D-UX4-109)', () => {
  // 옛 시험: 손으로 만든 위에 붙는 탭 바(quickReturnStep) — 들어올 때 가려지고 따라 내려오는 등 흔들려(사용자 사진) 휴대폰이 직접 하는 붙는 머리로 바꿨다 (D-UX4-98)
  // D-UX4-104가 "숨지 않고 늘 붙어 있다"로 바꿨다가 D-UX4-109(사용자 "올릴 때 탭 바 안 숨는데?")로 D-UX4-98 기대(올리면 숨고 내리면 붙는다)를 되살렸다
  // D-UX4-155 (사용자 "채팅·문자 탭을 누르면 탭 바가 사라진다"): 숨기기를 휴대폰 것(stickyHeaderHiddenOnScroll — 앱이 맨 아래로 굴린 것까지 세서 탭에 들어가자마자 숨었다)에서
  // 손으로 굴린 거리만 세는 tabHide로 바꿨다. 붙는 머리는 그대로 — 옛 기대: 소스에 stickyHeaderHiddenOnScroll 줄이 있다
  // D-TABS-02 (사용자 지시 2026-11-17 "탭 바 위에 뜨는 모든 버튼, 알림 다 다른 곳으로 옮겨라 … 화면 상단 영역과 탭 바는 무조건 서로 붙어 있어야"):
  // 탭 바 위 알림 묶음(옛 첫째 자식)을 탭 바 밑으로 옮겨 탭 바가 첫째 자식이 됐다 — 옛 기대: STICKY_TABS [1](둘째 자식)
  it('탭 바는 목록의 첫째 자식 붙는 머리 — 올리면 숨고 내리면 붙는다(손으로 굴린 거리만 세는 tabHide), 손으로 만든 붙는 탭 바는 없다', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(import.meta.dirname, '../src/screens/ConsoleScreen.tsx'), 'utf8')
    expect(source).toContain('stickyHeaderIndices={STICKY_TABS}')
    expect(source).not.toMatch(/^\s*stickyHeaderHiddenOnScroll/m)
    expect(source).toContain('transform: [{ translateY: tabHide.offset }]')
    // D-UX4-108 (사용자 "스크롤 땡기면 여전히 이렇게 늘어나는데?"): 맨 위에서 당겨도 튕기거나 늘어나지 않는다
    expect(source).toContain('bounces={false}')
    expect(source).toContain('overScrollMode="never"')
    const { STICKY_TABS } = await import('../src/screens/ConsoleScreen.tsx')
    expect(STICKY_TABS).toEqual([0])
    const world = makeWorld({ products: [] })
    await open(world)
    expect(screen.queryByTestId('floating-tabs')).toBeNull()
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
    expect(screen.getByTestId('console-tabs')).toBeTruthy()
  })

  // D-UX4-110 (사용자 "중간에 올릴 때 탭바와 상단영역 사이 여백과 끝까지 올렸을 때 여백이 달라"): 옛 탭 바는 위 여백 4 + 목록 줄 사이 8 - 4로,
  // 맨 위에서는 알약이 머리 아래 8, 붙었을 때는 4였다. 이제 목록 줄 사이(8)를 위 margin으로 지우고 여백은 탭 바 안에만 — 두 경우 모두 TABS_TOP
  it('탭 바 위 여백은 탭 바 안에만 있다 — 맨 위와 붙었을 때 머리↔알약 여백이 같다', async () => {
    const { TABS_TOP } = await import('../src/screens/ConsoleScreen.tsx')
    const { SPACE } = await import('../src/ui/kit/tokens.ts')
    const world = makeWorld({ products: [] })
    await open(world)
    // D-UX4-155: 붙는 머리 칸(console-tabs-slot)이 위 margin을, 그 안에서 숨으며 밀리는 탭 바(console-tabs)가 안 여백을 갖는다 (옛 기대: 둘 다 console-tabs 한 칸에)
    const slot = getComputedStyle(screen.getByTestId('console-tabs-slot'))
    const tabs = getComputedStyle(screen.getByTestId('console-tabs'))
    // D-TABS-02: 탭 바가 첫째 자식이라 위에 지울 줄 사이가 없다 — 옛 기대: 위 margin -SPACE.sm(앞 알림 묶음과의 줄 사이를 지웠다)
    expect(['', '0', '0px']).toContain(slot.marginTop)
    expect(tabs.paddingTop).toBe(`${String(TABS_TOP)}px`)
    // D-TABS-03 (사용자 "토스와 상단 탭 바 위 여백·글자 크기가 다르다, 맞춰줘"): 토스 거래 내역 사진을 재어 8 → 4 (옛 기대: SPACE.sm)
    expect(TABS_TOP).toBe(SPACE.xs)
    // 알림 묶음은 탭 바 밑 — 머리와 탭 바 사이에는 아무것도 없다 (D-TABS-02)
    const tabSlot = screen.getByTestId('console-tabs-slot')
    expect(tabSlot.compareDocumentPosition(screen.getByTestId('console-notices')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tabSlot.previousElementSibling).toBeNull()
    // 목록 묶음의 줄 사이가 SPACE.sm이라 위 margin이 그 줄 사이를 정확히 지운다
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(import.meta.dirname, '../src/screens/ConsoleScreen.tsx'), 'utf8')
    expect(source).toMatch(/contentContainerStyle=\{\{ flexGrow: 1, paddingHorizontal: GUTTER, [^}]*gap: SPACE\.sm \}\}/)
  })
})
