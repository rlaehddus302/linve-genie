// MOB1 웹 단위 시험 — 아래 막대 "문자찜"(D-MOB1-04, AC-MOB1-04), 로그아웃 자리·확인 창(D-MOB1-05, AC-MOB1-05·06).
// jsdom에는 matchMedia가 없어 휴대폰 모양이다(use-wide.ts). PC 모양은 matchMedia를 흉내 낸다.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOGOUT_LIVE, LOGOUT_NONE, LOGOUT_STATION, LOGOUT_UNKNOWN, LOGOUT_WAIT_MS, logoutRisks } from '../src/components/LogoutButton.tsx'
import { SMS_BAR_LABEL, barLabel, menuAll, menuLayout } from '../src/lib/menu.ts'
import type { BroadcastItem } from '../src/api/types.ts'
import { menuNav, openMore } from './menu-support.ts'
import { overview, queue } from './print-support.ts'
import { FakeEventSource, broadcastItem, flush } from './support.ts'

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('아래 막대 "문자찜" (AC-MOB1-04)', () => {
  const input = { route: { name: 'home' } as const, labels: true, review: null }

  it('휴대폰 막대 낱말은 "방송"·"문자찜"·"구매자"·"정산", PC 메뉴는 "문자찜 입력" 그대로', () => {
    const layout = menuLayout(input)
    expect(layout.bar.map(barLabel)).toEqual(['방송', SMS_BAR_LABEL, '구매자', '정산'])
    expect(SMS_BAR_LABEL).toBe('문자찜')
    expect(menuAll(layout).map((item) => item.label)).toContain('문자찜 입력')
  })
  it('그려진 휴대폰 막대 글이 barLabel 그대로 — 화면과 시험이 같은 길 (D-MOB1-17 (4))', async () => {
    await topBar({ broadcasts: [] })
    const links = within(menuNav()).getAllByRole('link').map((link) => link.textContent)
    expect(links).toEqual(menuLayout(input).bar.map(barLabel))
  })
})

describe('로그아웃할지 묻는 조건 (AC-MOB1-06)', () => {
  const live: Pick<BroadcastItem, 'ended'>[] = [{ ended: true }, { ended: false }]
  const ended: Pick<BroadcastItem, 'ended'>[] = [{ ended: true }]

  it('세 조건의 조합 — 위 문장이 먼저, 아무것도 없으면 묻지 않는다', () => {
    expect(logoutRisks({ broadcasts: [], station: false })).toEqual([])
    expect(logoutRisks({ broadcasts: ended, station: false })).toEqual([])
    expect(logoutRisks({ broadcasts: live, station: false })).toEqual([LOGOUT_LIVE])
    expect(logoutRisks({ broadcasts: ended, station: true })).toEqual([LOGOUT_STATION])
    expect(logoutRisks({ broadcasts: live, station: true })).toEqual([LOGOUT_LIVE, LOGOUT_STATION])
    expect(logoutRisks({ broadcasts: null, station: false })).toEqual([LOGOUT_UNKNOWN])
    expect(logoutRisks({ broadcasts: null, station: true })).toEqual([LOGOUT_UNKNOWN, LOGOUT_STATION])
  })

  it('문장은 결정 글자 그대로', () => {
    expect(LOGOUT_LIVE).toBe('아직 끝내지 않은 방송이 있어요. 로그아웃하면 이 기기에서는 다시 로그인해야 찜·채팅을 볼 수 있어요. 방송과 찜은 그대로예요.')
    expect(LOGOUT_STATION).toBe('이 기기가 라벨을 출력하는 기기예요. 로그아웃하면 라벨 출력이 멈춰요.')
    expect(LOGOUT_UNKNOWN).toBe('방송 중인지 확인하지 못했어요.')
    expect(LOGOUT_NONE).toBe('끝내지 않은 방송이 없어요.')
    expect(LOGOUT_WAIT_MS).toBe(700)
  })
})

interface World {
  readonly broadcasts: BroadcastItem[] | 'fail'
  /** 주면 방송 목록 답을 이것이 풀릴 때까지 늦춘다 (느린 망 — 응답 전) */
  readonly hold?: Promise<void>
  readonly mine?: boolean
  readonly wide?: boolean
}

async function topBar({ broadcasts, hold, mine = false, wide = false }: World) {
  if (wide) vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  const { TopBar } = await import('../src/components/TopBar.tsx')
  const { PrintContext } = await import('../src/components/print-context.tsx')
  const { PrintStore } = await import('../src/lib/print-store.ts')
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url))
    if (String(url).startsWith('/api/broadcasts')) {
      if (hold !== undefined) await hold
      if (broadcasts === 'fail') return new Response(JSON.stringify({ error: { code: 'X', message: '잠시 뒤에 다시 해 주세요.' } }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ broadcasts }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify(overview({ queue: queue({ labelsEnabled: true }) })), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const store = new PrintStore({ openStream: () => new FakeEventSource('/api/stream') })
  await store.reload()
  const onLogout = vi.fn()
  render(
    <PrintContext.Provider value={{ store, station: { isMine: () => mine } as never }}>
      <TopBar shopName="구피 가게" onLogout={onLogout} route={{ name: 'home' }} navigate={vi.fn()} />
    </PrintContext.Provider>,
  )
  return { onLogout, calls }
}

const banner = () => screen.getByRole('banner')

async function press(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button)
    await flush()
  })
}

describe('휴대폰 로그아웃 자리 (AC-MOB1-05)', () => {
  it('위 줄에는 "로그아웃"이 없고, "더보기" 목록 맨 끝("설정" 다음)에 버튼', async () => {
    await topBar({ broadcasts: [] })
    expect(within(banner()).queryByRole('button', { name: '로그아웃' })).toBeNull()
    const list = openMore()
    const items = within(list).getAllByRole('listitem')
    expect(within(items.at(-2) as HTMLElement).getByRole('link').textContent).toBe('설정')
    const last = within(items.at(-1) as HTMLElement).getByRole('button', { name: '로그아웃' })
    expect(last.tagName).toBe('BUTTON')
    expect(within(list).queryByRole('link', { name: '로그아웃' })).toBeNull()
  })

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자는 어느 폭이든 위 줄 그대로(묻지 않는다)"를 뺐다
  it('PC는 위 줄 그대로', async () => {
    const pc = await topBar({ broadcasts: [], wide: true })
    expect(within(menuNav()).queryByRole('button', { name: '더보기' })).toBeNull()
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeDefined()
    expect(within(menuNav()).getByRole('link', { name: '문자찜 입력' })).toBeDefined()
    expect(pc.onLogout).not.toHaveBeenCalled()
  })
})

describe('위험할 때만 확인 창 (AC-MOB1-06)', () => {
  it('끝내지 않은 방송이 없고 출력 기기가 아니면 창 없이 바로 로그아웃', async () => {
    const { onLogout } = await topBar({ broadcasts: [broadcastItem({ ended: true })] })
    await press(within(openMore()).getByRole('button', { name: '로그아웃' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('끝내지 않은 방송이 있으면 "로그아웃할까요?" — 처음 포커스 "로그인 유지", 누르면 닫기만, "로그아웃"이면 로그아웃', async () => {
    const { onLogout } = await topBar({ broadcasts: [broadcastItem({ ended: false, rehearsal: true })] })
    await press(within(openMore()).getByRole('button', { name: '로그아웃' }))
    const dialog = screen.getByRole('dialog', { name: '로그아웃할까요?' })
    expect(dialog.textContent).toContain(LOGOUT_LIVE)
    expect(dialog.textContent).not.toContain(LOGOUT_STATION)
    const keep = within(dialog).getByRole('button', { name: '로그인 유지' })
    expect(document.activeElement).toBe(keep)
    fireEvent.click(keep)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onLogout).not.toHaveBeenCalled()
    await press(within(openMore()).getByRole('button', { name: '로그아웃' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onLogout).not.toHaveBeenCalled()
    await press(within(openMore()).getByRole('button', { name: '로그아웃' }))
    const danger = within(screen.getByRole('dialog')).getByRole('button', { name: '로그아웃' })
    expect(danger.className).toContain('button-danger')
    fireEvent.click(danger)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('출력 기기면 두 번째 문장, 둘 다면 두 문장(방송 문장이 먼저)', async () => {
    await topBar({ broadcasts: [broadcastItem({ ended: false })], mine: true })
    await press(within(openMore()).getByRole('button', { name: '로그아웃' }))
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text.indexOf(LOGOUT_LIVE)).toBeGreaterThanOrEqual(0)
    expect(text.indexOf(LOGOUT_STATION)).toBeGreaterThan(text.indexOf(LOGOUT_LIVE))
  })

  it('방송 목록을 받지 못하면 "방송 중인지 확인하지 못했어요." — 묻지 않고 로그아웃하지 않는다 (PC 위 줄도 같다)', async () => {
    const { onLogout } = await topBar({ broadcasts: 'fail', wide: true })
    await press(screen.getByRole('button', { name: '로그아웃' }))
    expect(screen.getByRole('dialog', { name: '로그아웃할까요?' }).textContent).toContain(LOGOUT_UNKNOWN)
    expect(onLogout).not.toHaveBeenCalled()
  })

  describe('응답 전에도 묻는다 (TE-MOB1-001)', () => {
    function gate() {
      let open: () => void = () => {}
      const hold = new Promise<void>((resolve) => {
        open = resolve
      })
      return { hold, open }
    }
    const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const logoutIn = () => within(openMore()).getByRole('button', { name: '로그아웃' })

    it('답이 오지 않으면 잠깐 뒤 같은 창에 "방송 중인지 확인하지 못했어요." — 처음 포커스 "로그인 유지", 로그아웃하지 않는다', async () => {
      const g = gate()
      const { onLogout } = await topBar({ broadcasts: [], hold: g.hold })
      await press(logoutIn())
      await wait(LOGOUT_WAIT_MS + 100)
      const dialog = screen.getByRole('dialog', { name: '로그아웃할까요?' })
      expect(dialog.textContent).toContain(LOGOUT_UNKNOWN)
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '로그인 유지' }))
      expect(onLogout).not.toHaveBeenCalled()
      // 창의 "로그아웃"은 답을 기다리지 않고 바로 로그아웃
      fireEvent.click(within(dialog).getByRole('button', { name: '로그아웃' }))
      expect(onLogout).toHaveBeenCalledTimes(1)
      await act(async () => {
        g.open()
        await flush()
      })
      expect(onLogout).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('창이 뜬 뒤 끝내지 않은 방송이 있다는 답이 오면 문장을 맞춘다(출력 기기 문장도)', async () => {
      const g = gate()
      const { onLogout } = await topBar({ broadcasts: [broadcastItem({ ended: false })], hold: g.hold, mine: true })
      await press(logoutIn())
      await wait(LOGOUT_WAIT_MS + 100)
      expect(screen.getByRole('dialog').textContent).toContain(LOGOUT_UNKNOWN)
      expect(screen.getByRole('dialog').textContent).toContain(LOGOUT_STATION)
      await act(async () => {
        g.open()
        await flush()
      })
      const text = screen.getByRole('dialog', { name: '로그아웃할까요?' }).textContent ?? ''
      expect(text).not.toContain(LOGOUT_UNKNOWN)
      expect(text.indexOf(LOGOUT_LIVE)).toBeGreaterThanOrEqual(0)
      expect(text.indexOf(LOGOUT_STATION)).toBeGreaterThan(text.indexOf(LOGOUT_LIVE))
      expect(onLogout).not.toHaveBeenCalled()
    })

    it('창이 뜬 뒤 위험이 없다는 답이 오면 창 그대로 "끝내지 않은 방송이 없어요." — 저절로 로그아웃하지 않고 포커스도 그대로 (D-MOB1-15)', async () => {
      const g = gate()
      const { onLogout } = await topBar({ broadcasts: [broadcastItem({ ended: true })], hold: g.hold })
      await press(logoutIn())
      await wait(LOGOUT_WAIT_MS + 100)
      const keep = within(screen.getByRole('dialog')).getByRole('button', { name: '로그인 유지' })
      expect(document.activeElement).toBe(keep)
      await act(async () => {
        g.open()
        await flush()
      })
      const dialog = screen.getByRole('dialog', { name: '로그아웃할까요?' })
      expect(dialog.querySelector('.modal-body')?.textContent).toBe(LOGOUT_NONE)
      expect(onLogout).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(keep)
      expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual(['로그인 유지', '로그아웃'])
      // 판매자가 "로그아웃"을 눌러야 끝난다
      fireEvent.click(within(dialog).getByRole('button', { name: '로그아웃' }))
      expect(onLogout).toHaveBeenCalledTimes(1)
    })

    it('늦은 답이 실패면 "확인하지 못했어요." 그대로 — 로그아웃하지 않는다', async () => {
      const g = gate()
      const { onLogout } = await topBar({ broadcasts: 'fail', hold: g.hold })
      await press(logoutIn())
      await wait(LOGOUT_WAIT_MS + 100)
      await act(async () => {
        g.open()
        await flush()
      })
      expect(screen.getByRole('dialog').querySelector('.modal-body')?.textContent).toBe(LOGOUT_UNKNOWN)
      expect(onLogout).not.toHaveBeenCalled()
    })

    it('"로그인 유지"로 닫은 뒤 온 답은 버린다 — 창이 다시 뜨지 않고 로그아웃하지 않으며 버튼은 다시 눌린다', async () => {
      const g = gate()
      const kept = await topBar({ broadcasts: [broadcastItem({ ended: true })], hold: g.hold })
      await press(logoutIn())
      await wait(LOGOUT_WAIT_MS + 100)
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '로그인 유지' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      await act(async () => {
        g.open()
        await flush()
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(kept.onLogout).not.toHaveBeenCalled()
      expect((logoutIn() as HTMLButtonElement).disabled).toBe(false)
    })

    it('가짜 시계: 누른 직후엔 창이 없고 버튼만 잠김, LOGOUT_WAIT_MS가 지나면 바로 창 (1초 안)', async () => {
      const g = gate()
      const { onLogout } = await topBar({ broadcasts: [], hold: g.hold })
      const button = logoutIn()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        act(() => {
          fireEvent.click(button)
        })
        expect(screen.queryByRole('dialog')).toBeNull()
        expect((button as HTMLButtonElement).disabled).toBe(true)
        act(() => {
          vi.advanceTimersByTime(LOGOUT_WAIT_MS - 1)
        })
        expect(screen.queryByRole('dialog')).toBeNull()
        act(() => {
          vi.advanceTimersByTime(1)
        })
        expect(screen.getByRole('dialog', { name: '로그아웃할까요?' }).textContent).toContain(LOGOUT_UNKNOWN)
        expect(onLogout).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('답이 빨리 오면 창 없이 바로 로그아웃 — 기다리는 시간이 지나도 창이 뒤늦게 뜨지 않는다', async () => {
      const { onLogout } = await topBar({ broadcasts: [] })
      await press(logoutIn())
      expect(onLogout).toHaveBeenCalledTimes(1)
      await wait(LOGOUT_WAIT_MS + 100)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})

describe('로그아웃 확인 창 자리 (D-MOB1-16)', () => {
  it('로그아웃 창만 휴대폰 아래쪽 붙임 표시를 단다 — 공통 창은 기본 그대로', async () => {
    await topBar({ broadcasts: [broadcastItem({ ended: false })] })
    await press(within(openMore()).getByRole('button', { name: '로그아웃' }))
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    expect(backdrop.className).toBe('backdrop backdrop-phone-bottom')
    cleanup()
    const { Modal } = await import('../src/components/Modal.tsx')
    render(
      <Modal title="다른 창" onClose={() => {}}>
        <p>본문</p>
      </Modal>,
    )
    expect((screen.getByRole('dialog').parentElement as HTMLElement).className).toBe('backdrop')
  })
})
