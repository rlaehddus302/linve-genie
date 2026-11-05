// 시작 마법사(AC-I3-50~56)·정책 초안 페이지(AC-I3-77·78). 앱 전체를 그린다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { BroadcastItem, Me, WizardState, YoutubeConnection } from '../src/api/types.ts'
import { setTopLevelNavigation } from '../src/lib/google-return.ts'
import { FakeEventSource, FakeServer, apiError, broadcastItem, connection, flush, youtubeNotConfigured, type Reply } from './support.ts'

let server: FakeServer
let wizard: WizardState
let broadcasts: BroadcastItem[]
let me: Me | null
let youtube: YoutubeConnection | null

const seller: Me = { seller: { name: '구피 가게' }, loginId: 'shop1' }

beforeEach(() => {
  server = new FakeServer()
  wizard = { status: 'NEW', step: null }
  broadcasts = []
  me = seller
  youtube = null
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.sessionStorage.clear()
  setTopLevelNavigation(() => {})
  server
    .on('GET', /^\/api\/me$/, () => (me === null ? apiError(401, 'UNAUTHORIZED', '로그인이 필요해요.') : { body: me }))
    .on('GET', /^\/api\/wizard$/, () => ({ body: { wizard } }))
    .on('PUT', /^\/api\/wizard$/, (call) => {
      wizard = { status: call.body?.status as WizardState['status'], step: (call.body?.step as number | undefined) ?? null }
      return { body: { wizard } }
    })
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts } }))
    .on('POST', /^\/api\/broadcasts$/, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      broadcasts = [broadcastItem({ id: 'r1', rehearsal: true, title: '리허설' })]
      return { body: { date: '2026-10-20', rehearsal: true, seq: 1, type: 'broadcast.start', changed: true, effects: [], broadcast: { id: 'r1', date: '2026-10-20', title: '리허설', rehearsal: true } } }
    })
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: DEFAULT_SETTINGS } }))
    .on('GET', /^\/api\/youtube\/connection$/, (): Reply => (youtube === null ? youtubeNotConfigured : { body: { connection: youtube } }))
    .on('PUT', /^\/api\/shop$/, (call) => {
      const name = String(call.body?.name ?? '').trim()
      if (name === '') return apiError(400, 'INVALID_INPUT', '가게 이름은 1~30자로 적어 주세요.', [{ field: 'name', message: '가게 이름은 1~30자로 적어 주세요.' }])
      return { body: { shop: { name } } }
    })
    .on('GET', /^\/api\/days(\?rehearsal=true)?$/, () => ({ body: { days: [] } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 50 } }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  setTopLevelNavigation(null)
})

async function open(path: string) {
  window.history.replaceState(null, '', path)
  const utils = render(<App />)
  await flush(8)
  return utils
}

const heading = (name: string) => screen.findByRole('heading', { name, level: 2 })

describe('시작 마법사가 열리는 때 (AC-I3-50)', () => {
  it('실제 방송이 없고 "처음"이면 방송 목록에서 /start로 — 1단계 제목에 포커스', async () => {
    broadcasts = [broadcastItem({ rehearsal: true })]
    await open('/')
    const title = await heading('1/5 가게 이름')
    expect(window.location.pathname).toBe('/start')
    await waitFor(() => expect(document.activeElement).toBe(title))
    for (const step of ['1/5 가게 이름', '2/5 판매 규칙 확인', '3/5 유튜브 연결', '4/5 프린터 연결', '5/5 리허설 해 보기']) {
      expect(within(screen.getByRole('list', { name: '단계' })).getByText(step)).toBeDefined()
    }
  })

  it('"진행 중"이면 그 단계부터 — 저장된 번호는 새 순서의 번호로 그대로 읽는다 (D-WIZ-01, AC-WIZ-02)', async () => {
    wizard = { status: 'IN_PROGRESS', step: 3 }
    await open('/')
    expect(await heading('3/5 유튜브 연결')).toBeDefined()
    cleanup()
    wizard = { status: 'IN_PROGRESS', step: 4 }
    await open('/')
    expect(await heading('4/5 프린터 연결')).toBeDefined()
  })

  it('실제 방송이 있거나, 마침·닫음이면 열지 않는다. 다른 주소로 바로 들어오면 상태를 묻지도 않는다', async () => {
    broadcasts = [broadcastItem({ rehearsal: false })]
    await open('/')
    expect(await screen.findByRole('heading', { name: '방송 목록' })).toBeDefined()
    expect(window.location.pathname).toBe('/')
    cleanup()
    broadcasts = []
    wizard = { status: 'DISMISSED', step: null }
    await open('/')
    expect(await screen.findByRole('heading', { name: '방송 목록' })).toBeDefined()
    cleanup()
    wizard = { status: 'NEW', step: null }
    const before = server.callsTo('GET', /^\/api\/wizard$/).length
    await open('/sms')
    expect(await screen.findByRole('heading', { name: '문자찜 입력' })).toBeDefined()
    expect(server.callsTo('GET', /^\/api\/wizard$/).length).toBe(before)
  })
})

describe('마법사 단계 (AC-I3-51~55)', () => {
  it('1단계: 바꾸지 않으면 저장하지 않고 다음 — 단계를 옮기면 서버에 적는다. 2단계: 여섯 줄, 바꾸지 않고 다음이면 설정 요청 없음', async () => {
    await open('/start')
    await heading('1/5 가게 이름')
    expect((screen.getByLabelText('가게 이름') as HTMLInputElement).value).toBe('구피 가게')
    expect(screen.queryByRole('button', { name: '이전' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await heading('2/5 판매 규칙 확인')).toBeDefined()
    expect(server.callsTo('PUT', /^\/api\/shop$/)).toHaveLength(0)
    await waitFor(() => expect(wizard).toEqual({ status: 'IN_PROGRESS', step: 2 }))
    // FB1 D-FB1-11: 가격 단위 낱말 원·천원·만원 (AC-FB1-01)
    for (const line of ['대기 인원: 5명', '1등이 취소되면: 대기 1순위가 바로 1등', '시청자가 채팅으로 취소하면: 내가 확인하고 처리해요', '가격 단위: 천원 (15 → 15,000원)', '기본 배송비: 4,000원', '무료배송 기준: 없음'])
      expect(await screen.findByText(line)).toBeDefined()
    expect(screen.getByText('바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.')).toBeDefined()
    expect(screen.getByText('다른 규칙은 설정에서 바꿀 수 있어요.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await heading('3/5 유튜브 연결')).toBeDefined()
    expect(server.callsTo('PATCH', /settings/)).toHaveLength(0)
    expect(screen.getByText('감사 메시지 자동 게시는 설정에서 따로 켤 수 있어요.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '이전' }))
    expect(await heading('2/5 판매 규칙 확인')).toBeDefined()
  })

  it('단계 순서: "다음"은 가게 이름 → 판매 규칙 → 유튜브 → 프린터 → 리허설, "이전"은 거꾸로 — 제목에 포커스 (D-WIZ-01, AC-WIZ-01)', async () => {
    const order = ['1/5 가게 이름', '2/5 판매 규칙 확인', '3/5 유튜브 연결', '4/5 프린터 연결', '5/5 리허설 해 보기']
    await open('/start')
    await heading(order[0] as string)
    for (const next of order.slice(1)) {
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      const title = await heading(next)
      await waitFor(() => expect(document.activeElement).toBe(title))
    }
    for (const prev of [...order].reverse().slice(1)) {
      fireEvent.click(screen.getByRole('button', { name: '이전' }))
      const title = await heading(prev)
      await waitFor(() => expect(document.activeElement).toBe(title))
    }
  })

  it('1단계: 바꾼 이름이 틀리면 다음 단계로 가지 않는다, 맞으면 저장하고 위 줄이 바뀐다', async () => {
    await open('/start')
    await heading('1/5 가게 이름')
    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('가게 이름은 1~30자로 적어 주세요.')).toBeDefined()
    expect(screen.getByRole('heading', { name: '1/5 가게 이름', level: 2 })).toBeDefined()
    fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '새 가게' } })
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await heading('2/5 판매 규칙 확인')).toBeDefined()
    expect(document.querySelector('.shop-name')?.textContent).toBe('새 가게')
  })

  it('2단계 "바꾸기" → 그 자리의 칸 → 저장(그 키만)', async () => {
    let saved = { ...DEFAULT_SETTINGS }
    server.on('PATCH', /^\/api\/settings$/, (call) => {
      saved = { ...saved, ...(call.body?.settings as object) }
      return { body: { settings: saved } }
    })
    wizard = { status: 'IN_PROGRESS', step: 2 }
    await open('/start')
    fireEvent.click(await screen.findByRole('button', { name: '1등이 취소되면 바꾸기' }))
    fireEvent.click(screen.getByRole('radio', { name: '내가 골라요' }))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('1등이 취소되면: 내가 골라요')).toBeDefined()
    expect(screen.getByText('저장했어요. 다음에 시작하는 방송부터 적용돼요.')).toBeDefined()
    expect(server.callsTo('PATCH', /settings/).map((call) => call.body)).toEqual([{ settings: { 'cancel.succession': 'ASK' } }])
  })

  describe('저장하지 않은 값 (UX-I3-001, AC-I3-46·52)', () => {
    let saved: typeof DEFAULT_SETTINGS
    beforeEach(() => {
      saved = { ...DEFAULT_SETTINGS }
      server.on('GET', /^\/api\/settings$/, () => ({ body: { settings: saved } }))
      server.on('PATCH', /^\/api\/settings$/, (call) => {
        saved = { ...saved, ...(call.body?.settings as object) }
        return { body: { settings: saved } }
      })
    })

    const dialog = () => screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
    const editFee = async (value: string) => {
      fireEvent.click(await screen.findByRole('button', { name: '기본 배송비 바꾸기' }))
      fireEvent.change(screen.getByLabelText('기본 배송비 (원)'), { target: { value } })
    }

    it('2단계: 칸에서 바꾼 값이 있는 채 "다음"이면 설정 화면과 같은 창으로 묻는다 — "닫기"면 그 단계·값·포커스 그대로, 저장하면 묻지 않고 넘어간다', async () => {
      wizard = { status: 'IN_PROGRESS', step: 2 }
      await open('/start')
      await editFee('3000')
      const next = screen.getByRole('button', { name: '다음' })
      next.focus()
      fireEvent.click(next)
      const asked = await dialog()
      expect(within(asked).getByText('저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.')).toBeDefined()
      expect(within(asked).getByRole('button', { name: '저장하지 않고 떠나기' })).toBeDefined()
      expect(screen.getByRole('heading', { name: '2/5 판매 규칙 확인', level: 2 })).toBeDefined()
      fireEvent.click(within(asked).getByRole('button', { name: '닫기' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(document.activeElement).toBe(next)
      expect(screen.getByRole('heading', { name: '2/5 판매 규칙 확인', level: 2 })).toBeDefined()
      expect((screen.getByLabelText('기본 배송비 (원)') as HTMLInputElement).value).toBe('3000')
      expect(wizard).toEqual({ status: 'IN_PROGRESS', step: 2 })
      fireEvent.click(screen.getByRole('button', { name: '저장' }))
      expect(await screen.findByText('기본 배송비: 3,000원')).toBeDefined()
      expect(server.callsTo('PATCH', /settings/).map((call) => call.body)).toEqual([{ settings: { 'shipping.baseFee': 3000 } }])
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      expect(await heading('3/5 유튜브 연결')).toBeDefined()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('2단계: "저장하지 않고 떠나기"면 저장 요청 없이 다음 단계로 — 돌아오면 저장된 값', async () => {
      wizard = { status: 'IN_PROGRESS', step: 2 }
      await open('/start')
      await editFee('3000')
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      fireEvent.click(within(await dialog()).getByRole('button', { name: '저장하지 않고 떠나기' }))
      expect(await heading('3/5 유튜브 연결')).toBeDefined()
      expect(server.callsTo('PATCH', /settings/)).toHaveLength(0)
      fireEvent.click(screen.getByRole('button', { name: '이전' }))
      expect(await screen.findByText('기본 배송비: 4,000원')).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      expect(await heading('3/5 유튜브 연결')).toBeDefined()
    })

    it('2단계: "이전"·"나중에 할게요"도 묻는다 — 나중에 할게요를 떠나면 상태 "닫음" → 방송 목록(앱 창이 다시 묻지 않는다)', async () => {
      wizard = { status: 'IN_PROGRESS', step: 2 }
      await open('/start')
      await editFee('3000')
      fireEvent.click(screen.getByRole('button', { name: '이전' }))
      fireEvent.click(within(await dialog()).getByRole('button', { name: '닫기' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(screen.getByRole('heading', { name: '2/5 판매 규칙 확인', level: 2 })).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: '나중에 할게요' }))
      await dialog()
      expect(wizard).toEqual({ status: 'IN_PROGRESS', step: 2 })
      fireEvent.click(screen.getByRole('button', { name: '저장하지 않고 떠나기' }))
      expect(await screen.findByRole('heading', { name: '방송 목록' })).toBeDefined()
      expect(window.location.pathname).toBe('/')
      expect(wizard).toEqual({ status: 'DISMISSED', step: null })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(server.callsTo('PATCH', /settings/)).toHaveLength(0)
    })

    it('2단계: 메뉴로 가도 같은 문장으로 묻는다 / 칸을 열기만 했거나 "그만두기"면 묻지 않는다', async () => {
      wizard = { status: 'IN_PROGRESS', step: 2 }
      await open('/start')
      await editFee('3000')
      fireEvent.click(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '문자찜' })) // MOB1 D-MOB1-04
      const asked = await dialog()
      expect(within(asked).getByText('저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.')).toBeDefined()
      fireEvent.click(within(asked).getByRole('button', { name: '닫기' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(window.location.pathname).toBe('/start')
      fireEvent.click(screen.getByRole('button', { name: '그만두기' }))
      fireEvent.click(screen.getByRole('button', { name: '1등이 취소되면 바꾸기' }))
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      expect(await heading('3/5 유튜브 연결')).toBeDefined()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(server.callsTo('PATCH', /settings/)).toHaveLength(0)
    })

    /**
     * 화면이 바뀐 바로 그 순간(같은 틱 — React가 그린 뒤 늦게 도는 효과보다 먼저) 그 이름의 버튼을 누른다 (SA-I3-010).
     * React는 그린 뒤 한 번 양보하고 효과를 돌린다 — 그 사이에 오는 누름을 흉내 낸다. 부하가 있을 때 생기던 일을 늘 일으킨다.
     */
    const clickOnceDrawn = (drawn: () => boolean, name: string) => {
      let clicked = false
      const observer = new MutationObserver(() => {
        if (clicked || !drawn()) return
        clicked = true
        observer.disconnect()
        screen.getByRole('button', { name }).click()
      })
      observer.observe(document.body, { subtree: true, childList: true, characterData: true })
      return () => waitFor(() => expect(clicked).toBe(true))
    }

    it('2단계: 저장이 끝나 화면이 바뀐 바로 그 순간(같은 틱) "다음"을 눌러도 묻지 않는다 (SA-I3-010)', async () => {
      wizard = { status: 'IN_PROGRESS', step: 2 }
      await open('/start')
      await editFee('3000')
      const clicked = clickOnceDrawn(() => (document.body.textContent ?? '').includes('기본 배송비: 3,000원'), '다음')
      fireEvent.click(screen.getByRole('button', { name: '저장' }))
      await clicked()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(await heading('3/5 유튜브 연결')).toBeDefined()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(server.callsTo('PATCH', /settings/).map((call) => call.body)).toEqual([{ settings: { 'shipping.baseFee': 3000 } }])
      expect(wizard).toEqual({ status: 'IN_PROGRESS', step: 3 })
    })

    it('2단계: 저장 응답이 온 바로 그때(화면을 다시 그리기 전) "다음"을 눌러도 묻지 않는다 (SA-I3-010)', async () => {
      let answer = () => {}
      const answered = new Promise<void>((resolve) => {
        answer = resolve
      })
      server.on('PATCH', /^\/api\/settings$/, async (call) => {
        await answered
        saved = { ...saved, ...(call.body?.settings as object) }
        return { body: { settings: saved } }
      })
      wizard = { status: 'IN_PROGRESS', step: 2 }
      await open('/start')
      await editFee('3000')
      fireEvent.click(screen.getByRole('button', { name: '저장' }))
      await waitFor(() => expect(server.callsTo('PATCH', /settings/)).toHaveLength(1))
      const next = screen.getByRole('button', { name: '다음' })
      // act 안에서는 React가 다시 그리지 않는다 — 저장 응답을 다 받은 뒤, 그리기 전에 "다음"을 누른다
      await act(async () => {
        answer()
        await flush()
        next.click()
      })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(await heading('3/5 유튜브 연결')).toBeDefined()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(server.callsTo('PATCH', /settings/).map((call) => call.body)).toEqual([{ settings: { 'shipping.baseFee': 3000 } }])
    })

    it('2단계: 저장에 실패하면 그 값은 여전히 저장하지 않은 값 — "다음"이면 묻는다 (SA-I3-010)', async () => {
      server.on('PATCH', /^\/api\/settings$/, () => apiError(400, 'INVALID_INPUT', '기본 배송비는 0~100,000원으로 적어 주세요.', [{ field: 'settings.shipping.baseFee', message: '기본 배송비는 0~100,000원으로 적어 주세요.' }]))
      wizard = { status: 'IN_PROGRESS', step: 2 }
      await open('/start')
      await editFee('3000')
      fireEvent.click(screen.getByRole('button', { name: '저장' }))
      expect(await screen.findByText('기본 배송비는 0~100,000원으로 적어 주세요.')).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      expect(within(await dialog()).getByText('저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.')).toBeDefined()
      expect(screen.getByRole('heading', { name: '2/5 판매 규칙 확인', level: 2 })).toBeDefined()
    })

    it('1단계: 바꾼 이름을 저장하고 2단계가 그려진 바로 그 순간(같은 틱) "다음"을 눌러도 묻지 않는다 (SA-I3-010)', async () => {
      await open('/start')
      await heading('1/5 가게 이름')
      fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '새 가게' } })
      const clicked = clickOnceDrawn(() => document.getElementById('wizard-step-title')?.textContent === '2/5 판매 규칙 확인', '다음')
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      await clicked()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(await heading('3/5 유튜브 연결')).toBeDefined()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(server.callsTo('PUT', /^\/api\/shop$/).map((call) => call.body)).toEqual([{ name: '새 가게' }])
    })

    it('1단계: 바꾼 이름이 있는 채 "나중에 할게요"·메뉴면 묻는다 ("다음"은 저장하므로 묻지 않는다)', async () => {
      await open('/start')
      await heading('1/5 가게 이름')
      fireEvent.change(screen.getByLabelText('가게 이름'), { target: { value: '새 가게' } })
      fireEvent.click(screen.getByRole('button', { name: '나중에 할게요' }))
      fireEvent.click(within(await dialog()).getByRole('button', { name: '닫기' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      fireEvent.click(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '방송' }))
      fireEvent.click(within(await dialog()).getByRole('button', { name: '닫기' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(window.location.pathname).toBe('/start')
      expect(server.callsTo('PUT', /^\/api\/shop$/)).toHaveLength(0)
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      expect(await heading('2/5 판매 규칙 확인')).toBeDefined()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(server.callsTo('PUT', /^\/api\/shop$/).map((call) => call.body)).toEqual([{ name: '새 가게' }])
    })
  })

  it('3단계: 준비 안 된 서버면 안내 + 다음, 자동 게시 동의는 묻지 않는다 / 연결됐으면 채널 이름', async () => {
    wizard = { status: 'IN_PROGRESS', step: 3 }
    await open('/start')
    await heading('3/5 유튜브 연결')
    expect(await screen.findByText('유튜브 연동을 준비하지 않은 서버예요.')).toBeDefined()
    expect(screen.getByText('감사 메시지 자동 게시는 설정에서 따로 켤 수 있어요.')).toBeDefined()
    expect(screen.queryByRole('button', { name: /자동 게시/ })).toBeNull()
    expect(screen.getByRole('button', { name: '다음' })).toBeDefined()
    cleanup()
    youtube = connection({ channel: { id: 'UC1', title: '구피 채널' } })
    await open('/start')
    expect(await screen.findByText('구피 채널')).toBeDefined()
    expect(screen.queryByRole('button', { name: '연결 끊기' })).toBeNull()
  })

  it('3단계에서 구글로 갔다 오면(설정 주소로 돌아옴) 저장된 단계와 상관없이 마법사 3단계에 결과 문장 — "다음"은 4/5 프린터 (AC-WIZ-02)', async () => {
    youtube = connection({ status: 'NOT_CONNECTED', channel: null })
    const assigned: string[] = []
    setTopLevelNavigation((url) => assigned.push(url))
    server.on('POST', /^\/api\/youtube\/connection\/start$/, () => ({ body: { authorizeUrl: 'http://127.0.0.1:4100/o/oauth2/v2/auth?state=s' } }))
    wizard = { status: 'IN_PROGRESS', step: 3 }
    await open('/start')
    fireEvent.click(await screen.findByRole('button', { name: '구글로 유튜브 연결하기' }))
    await waitFor(() => expect(assigned).toHaveLength(1))
    cleanup()
    youtube = connection()
    // 서버에는 다른 단계가 적혀 있어도(예전 순서의 4단계) 돌아온 직후엔 3단계다
    wizard = { status: 'IN_PROGRESS', step: 5 }
    await open('/settings/youtube?youtube=connected')
    expect(await screen.findByText('유튜브 채널을 연결했어요.')).toBeDefined()
    expect(screen.getByRole('heading', { name: '3/5 유튜브 연결', level: 2 })).toBeDefined()
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe('/start'))
    expect(window.sessionStorage.length).toBe(0)
    await waitFor(() => expect(wizard).toEqual({ status: 'IN_PROGRESS', step: 3 }))
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await heading('4/5 프린터 연결')).toBeDefined()
  })

  it('5단계: "리허설 시작하기"는 두 번 눌러도 리허설 방송 하나 → 마침 → 그 리허설 콘솔', async () => {
    wizard = { status: 'IN_PROGRESS', step: 5 }
    await open('/start')
    await heading('5/5 리허설 해 보기')
    expect(screen.getByText('리허설로 연습해 볼까요? 가짜 채팅으로 상품 등록부터 1등 확정까지 해 볼 수 있어요. 진짜 유튜브에는 아무것도 올라가지 않아요.')).toBeDefined()
    const start = screen.getByRole('button', { name: '리허설 시작하기' })
    fireEvent.click(start)
    fireEvent.click(start)
    await waitFor(() => expect(window.location.pathname).toBe('/broadcasts/r1'))
    const posts = server.callsTo('POST', /^\/api\/broadcasts$/)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toMatchObject({ rehearsal: true })
    expect(String(posts[0]?.body?.requestId)).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(wizard.status).toBe('DONE')
  })

  it('"마치기"는 마침 → 방송 목록, "나중에 할게요"는 닫음 → 방송 목록 (다시 열리지 않는다)', async () => {
    wizard = { status: 'IN_PROGRESS', step: 5 }
    await open('/start')
    fireEvent.click(await screen.findByRole('button', { name: '마치기' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(wizard).toEqual({ status: 'DONE', step: null })
    cleanup()
    wizard = { status: 'NEW', step: null }
    await open('/start')
    fireEvent.click(await screen.findByRole('button', { name: '나중에 할게요' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(wizard).toEqual({ status: 'DISMISSED', step: null })
    expect(await screen.findByRole('heading', { name: '방송 목록' })).toBeDefined()
  })

  it('설정 "시작 마법사 다시 하기"는 상태와 상관없이 1단계부터', async () => {
    wizard = { status: 'DONE', step: null }
    await open('/settings')
    fireEvent.click(await screen.findByRole('link', { name: '시작 마법사 다시 하기' }))
    expect(await heading('1/5 가게 이름')).toBeDefined()
    await waitFor(() => expect(wizard).toEqual({ status: 'IN_PROGRESS', step: 1 }))
  })
})

// D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 "보조자 화면 (AC-I3-63)" 시험을 뺐다

describe('정책 초안 페이지 (AC-I3-77·78)', () => {
  it('로그인 없이 열린다 — 세션이 없어도 로그인 화면으로 바꾸지 않는다', async () => {
    me = null
    await open('/privacy')
    expect(await screen.findByRole('heading', { name: '개인정보처리방침(초안)', level: 1 })).toBeDefined()
    expect(screen.getByText('초안이에요. 법률 검토 전이라 실제 서비스 전에 바뀔 수 있어요.')).toBeDefined()
    await act(async () => {
      await flush()
    })
    expect(screen.queryByLabelText('비밀번호')).toBeNull()
    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(links).toContain('https://policies.google.com/privacy')
    expect(links).toContain('https://myaccount.google.com/permissions')
    const text = document.body.textContent ?? ''
    for (const phrase of ['유튜브 API 서비스', '30일 뒤에 지워요', '휴대폰 번호 원문은 저장하지 않아요', '광고·분석 쿠키는 쓰지 않아요', '[미정]', '[검토 필요]', '제공하지 않아요']) expect(text).toContain(phrase)
  })

  it('이용약관: 유튜브 이용약관 링크·세법상 증빙 아님·자동 게시는 동의할 때만', async () => {
    me = null
    await open('/terms')
    expect(await screen.findByRole('heading', { name: '이용약관(초안)', level: 1 })).toBeDefined()
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toContain('https://www.youtube.com/t/terms')
    const text = document.body.textContent ?? ''
    expect(text).toContain('구매 내역 확인서는 세금계산서·현금영수증 같은 세법상 증빙이 아니에요')
    expect(text).toContain('구매 감사 메시지 자동 게시는 판매자가 설정에서 동의할 때만 해요.')
    expect(text).toContain('요금')
  })

  it('로그인한 판매자도 메뉴와 함께 연다', async () => {
    await open('/terms')
    expect(await screen.findByRole('heading', { name: '이용약관(초안)', level: 1 })).toBeDefined()
    expect(screen.getByRole('navigation', { name: '메뉴' })).toBeDefined()
  })
})
