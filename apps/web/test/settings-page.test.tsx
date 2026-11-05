// 설정 화면 (AC-I3-01~05·10~14·37·44~47·64, D-I3-02·03·08·10·11). 앱 전체를 /settings로 그린다(메뉴·떠나기 창 포함).
import { DEFAULT_SETTINGS, type SaleSettings } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { BroadcastItem, YoutubeConnection } from '../src/api/types.ts'
import { setTopLevelNavigation } from '../src/lib/google-return.ts'
import { FakeEventSource, FakeServer, apiError, broadcastItem, connection, flush, youtubeNotConfigured, type Reply } from './support.ts'
import { menuNav, openMore } from './menu-support.ts'

let server: FakeServer
let settings: SaleSettings
let youtube: YoutubeConnection | null
let broadcasts: BroadcastItem[]
let assigned: string[]

const AUTH_URL = 'http://127.0.0.1:4100/o/oauth2/v2/auth?client_id=x&state=s1'

function setup() {
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '구피 가게' }, loginId: 'shop1' } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings } }))
    .on('PATCH', /^\/api\/settings$/, (call) => {
      const changes = (call.body?.settings ?? {}) as Record<string, unknown>
      const window = changes['thanks.batchWindowSec']
      if (window !== undefined && (typeof window !== 'number' || !Number.isInteger(window) || window < 0 || window > 600)) {
        return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'settings.thanks.batchWindowSec', message: '0부터 600까지 숫자로 적어 주세요.' }]) // FB1 D-FB1-18 (g) 코어 범위 문장
      }
      settings = { ...settings, ...changes } as SaleSettings
      return { body: { settings } }
    })
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts } }))
    .on('GET', /^\/api\/youtube\/connection$/, (): Reply => (youtube === null ? youtubeNotConfigured : { body: { connection: youtube } }))
    .on('GET', /^\/api\/youtube\/quota$/, () => ({
      body: { quota: { day: '2026-10-20', used: 1234, remaining: 8766, budget: 10000, resetsAt: '2026-10-21T07:00:00.000Z', mode: 'BATCH', methods: [{ method: 'liveChatMessages.insert', calls: 3, units: 60 }] } },
    }))
    .on('POST', /^\/api\/youtube\/connection\/start$/, () => ({ body: { authorizeUrl: AUTH_URL } }))
    .on('POST', /^\/api\/youtube\/connection\/disconnect$/, () => {
      youtube = connection({ status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false } })
      return { body: { connection: youtube } }
    })
    .on('PUT', /^\/api\/youtube\/consent$/, (call) => {
      if (youtube === null) return youtubeNotConfigured
      const enabled = call.body?.enabled === true
      const key = call.body?.target === 'LIVE_CHAT' ? 'liveChat' : 'videoComment'
      if (enabled && !youtube.permissions.publish) return { body: { authorizeUrl: AUTH_URL } }
      youtube = { ...youtube, consent: { ...youtube.consent, [key]: { enabled, at: enabled ? '2026-10-25T11:01:00.000Z' : null } } }
      return { body: { connection: youtube } }
    })
    .on('PUT', /^\/api\/shop$/, (call) => {
      const name = String(call.body?.name ?? '').trim()
      if (name === '' || [...name].length > 30) return apiError(400, 'INVALID_INPUT', '가게 이름은 1~30자로 적어 주세요.', [{ field: 'name', message: '가게 이름은 1~30자로 적어 주세요.' }])
      return { body: { shop: { name } } }
    })
}

beforeEach(() => {
  server = new FakeServer()
  settings = { ...DEFAULT_SETTINGS }
  youtube = connection({ status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false } })
  broadcasts = []
  assigned = []
  setTopLevelNavigation((url) => assigned.push(url))
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/settings')
  setup()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  setTopLevelNavigation(null)
})

async function open(path = '/settings') {
  window.history.replaceState(null, '', path)
  const utils = render(<App />)
  await screen.findByRole('heading', { name: '설정', level: 1 })
  await screen.findByRole('region', { name: '판매 규칙' })
  await flush()
  return utils
}

const section = (name: string) => screen.getByRole('region', { name })
// FB1 D-FB1-06: 칸마다 "저장" 대신 화면 아래 저장 막대 하나
const saveBar = () => screen.getByRole('region', { name: '저장' })
const clickSave = () => fireEvent.click(within(saveBar()).getByRole('button', { name: '저장' }))

describe('메뉴·칸 (AC-I3-44)', () => {
  it('메뉴에 "설정"(지금 화면), 칸 제목 여섯, "그 밖"의 링크, 진행 중인 방송이 있으면 안내', async () => {
    broadcasts = [broadcastItem({ id: 'b1', rehearsal: false, ended: false }), broadcastItem({ id: 'b2', rehearsal: true, ended: false })]
    await open()
    expect(within(menuNav()).getByRole('button', { name: '더보기' }).getAttribute('aria-current')).toBe('page')
    expect(within(openMore()).getByRole('link', { name: '설정' }).getAttribute('aria-current')).toBe('page')
    for (const name of ['가게', '판매 규칙', '배송비', '구매 감사 메시지', '유튜브', '그 밖']) expect(section(name)).toBeDefined()
    expect(screen.queryByRole('region', { name: '보조자' })).toBeNull() // D-UX3-32
    const other = section('그 밖')
    expect(within(other).getByRole('link', { name: '시작 마법사 다시 하기' }).getAttribute('href')).toBe('/start')
    expect(within(other).getByRole('link', { name: '개인정보처리방침' }).getAttribute('href')).toBe('/privacy')
    expect(within(other).getByRole('link', { name: '이용약관' }).getAttribute('href')).toBe('/terms')
    expect(screen.getByText('진행 중인 방송에는 바뀐 규칙이 적용되지 않아요.')).toBeDefined()
  })

  it('끝나지 않은 실제 방송이 없으면 안내가 없다, 화면에 설정 키·영문 값이 없다', async () => {
    broadcasts = [broadcastItem({ rehearsal: true, ended: false }), broadcastItem({ id: 'b2', ended: true })]
    await open()
    expect(screen.queryByText('진행 중인 방송에는 바뀐 규칙이 적용되지 않아요.')).toBeNull()
    const text = document.body.textContent ?? ''
    for (const word of ['waitlist', 'STRICT', 'LOOSE', 'THOUSAND', 'NOT_CONNECTED', 'thanks.', 'OAuth', '토큰', 'API']) expect(text).not.toContain(word)
  })
})

describe('판매 규칙 (AC-I3-45·46)', () => {
  it('"판매 규칙 상세 설정"은 처음에 접혀 있고 펼치면 칸이 보인다, 경고 한 줄은 저장 전에도', async () => {
    await open()
    const rules = section('판매 규칙')
    const more = within(rules).getByRole('button', { name: '판매 규칙 상세 설정' }) // FB1 D-FB1-02 (2)·D-FB1-18 (c)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    const strict = within(rules).getByRole('radio', { name: /엄격하게/, hidden: true })
    expect(strict.closest('[hidden]')).not.toBeNull()
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(within(rules).getByRole('radio', { name: /엄격하게/ }).closest('[hidden]')).toBeNull()
    fireEvent.click(within(rules).getByRole('radio', { name: /느슨하게/ }))
    expect(within(rules).getByText("느슨하게 하면 '15번 예뻐요' 같은 채팅도 주문이 될 수 있어요.")).toBeDefined()
    fireEvent.click(within(rules).getByRole('radio', { name: '바로 취소해요' }))
    expect(within(rules).getByText('장난 취소도 바로 처리돼요.')).toBeDefined()
    expect(server.callsTo('PATCH', /settings/)).toHaveLength(0)
  })

  it('저장은 바뀐 키만 보낸다, 숫자 칸은 숫자 키패드', async () => {
    await open()
    const rules = section('판매 규칙')
    const waitlist = within(rules).getByLabelText('대기 인원 (0이면 대기 없음)')
    expect(waitlist.getAttribute('inputmode')).toBe('numeric')
    fireEvent.change(waitlist, { target: { value: '3' } })
    fireEvent.click(within(rules).getByRole('radio', { name: '내가 골라요' }))
    clickSave() // FB1 D-FB1-06
    expect(await within(saveBar()).findByText('저장했어요. 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.')).toBeDefined() // FB1 D-FB1-06
    expect(server.callsTo('PATCH', /^\/api\/settings$/).map((call) => call.body)).toEqual([{ settings: { 'waitlist.max': 3, 'cancel.succession': 'ASK' } }])
  })

  it('배송비: 빈 무료배송 기준은 null, 그날 정산 안내 문장', async () => {
    settings = { ...settings, 'shipping.freeThreshold': 50000 }
    await open()
    const shipping = section('배송비')
    fireEvent.change(within(shipping).getByLabelText('무료배송 기준 금액 (원, 비우면 없음)'), { target: { value: '' } })
    clickSave() // FB1 D-FB1-06
    expect(await within(saveBar()).findByText('저장했어요. 오늘 방송을 이미 시작했으면 배송비는 내일부터 적용돼요.')).toBeDefined() // FB1 D-FB1-02·06
    expect(server.callsTo('PATCH', /^\/api\/settings$/)[0]?.body).toEqual({ settings: { 'shipping.freeThreshold': null } })
  })

  it('저장하지 않은 값이 있으면 다른 메뉴로 가기 전에 묻는다', async () => {
    await open()
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '7' } })
    fireEvent.click(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '방송' }))
    const dialog = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
    expect(within(dialog).getByText('저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.')).toBeDefined()
    expect(window.location.pathname).toBe('/settings')
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하지 않고 떠나기' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })
})

describe('구매 감사 메시지 (AC-I3-10~14)', () => {
  it('만들기 세 칸(지금 값), 범위 밖이면 서버 문장을 칸 옆에, 저장하면 다음 방송부터', async () => {
    await open()
    const thanks = section('구매 감사 메시지')
    expect((within(thanks).getByRole('checkbox', { name: '찜이 확정될 때마다 채팅에 감사 메시지 남기기' }) as HTMLInputElement).checked).toBe(true) // FB1 D-FB1-14
    expect(within(thanks).queryByRole('checkbox', { name: '영상 댓글에 감사 메시지 남기기' })).toBeNull() // FB1 D-FB1-14 (새로 켤 칸 없음)
    fireEvent.click(within(thanks).getByRole('button', { name: '감사 메시지 상세 설정' })) // FB1 D-FB1-03·D-FB1-18 (c) 묶는 시간은 상세 설정 안
    const batch = within(thanks).getByLabelText('몇 초 동안의 판매를 한 메시지로 묶을까요? (0이면 하나씩)') as HTMLInputElement
    expect(batch.value).toBe('0')
    fireEvent.change(batch, { target: { value: '601' } })
    clickSave() // FB1 D-FB1-06
    expect(await within(thanks).findByText('0부터 600까지 숫자로 적어 주세요.')).toBeDefined() // FB1 D-FB1-18 (g)
    expect(settings['thanks.batchWindowSec']).toBe(0)
    fireEvent.change(batch, { target: { value: '30' } })
    fireEvent.click(within(thanks).getByRole('checkbox', { name: '찜이 확정될 때마다 채팅에 감사 메시지 남기기' })) // FB1 D-FB1-14 (영상 댓글은 켤 길 없음 — 채팅 체크로)
    clickSave() // FB1 D-FB1-06
    expect(await within(saveBar()).findByText('저장했어요. 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.')).toBeDefined() // FB1 D-FB1-06
    expect(server.callsTo('PATCH', /^\/api\/settings$/).at(-1)?.body).toEqual({ settings: { 'thanks.liveChat': false, 'thanks.batchWindowSec': 30 } }) // FB1 D-FB1-14
    // 저장한 묶음 시간이 0보다 크면 묶음 미리 보기
    expect(within(thanks).getByText('15번 핑크프릴 10,000원 홍길동님, 16번 라울 5,000원 김철수님 구매 감사합니다')).toBeDefined()
  })

  it('요약 한 줄은 저장된 규칙과 지금 동의로만 (저장하지 않은 칸 값은 쓰지 않는다), 미리 보기·문자찜 안내', async () => {
    youtube = connection({ consent: { liveChat: { enabled: true, at: '2026-10-25T11:01:00.000Z' }, videoComment: { enabled: false, at: null } } })
    await open()
    const thanks = section('구매 감사 메시지')
    const summary = within(thanks).getByRole('region', { name: '지금 설정의 결과' })
    await waitFor(() => expect(summary.textContent).toContain('실시간 채팅 — 다음 방송부터 자동으로 남겨요'))
    expect(summary.textContent).not.toContain('영상 댓글') // FB1 D-FB1-14 (3): 저장값 OFF면 영상 댓글 줄 없음
    fireEvent.click(within(thanks).getByRole('checkbox', { name: '찜이 확정될 때마다 채팅에 감사 메시지 남기기' })) // FB1 D-FB1-14
    expect(summary.textContent).toContain('실시간 채팅 — 다음 방송부터 자동으로 남겨요')
    expect(within(thanks).getByText('15번 핑크프릴 10,000원 홍길동님 구매 감사합니다')).toBeDefined()
    expect(within(thanks).queryByText(/16번 라울/)).toBeNull()
    expect(within(thanks).getByText("문자찜으로 산 분은 '문자찜'으로 나가요. 메모·전화번호는 절대 나가지 않아요.")).toBeDefined()
  })

  it('동의 켜기: 설명 창(처음 포커스 "닫기") — 닫으면 요청 없음, "동의해요"면 켜짐과 켠 때, 요약이 바뀐다', async () => {
    youtube = connection({ permissions: { read: true, publish: true } })
    settings = { ...settings, 'thanks.videoComment': 'PER_SALE' } // FB1 D-FB1-14 (3): 영상 댓글 동의 줄은 켜 둔 판매자에게만
    await open()
    const thanks = section('구매 감사 메시지')
    fireEvent.click(await within(thanks).findByRole('button', { name: '실시간 채팅 자동 게시 켜기' }))
    let dialog = screen.getByRole('dialog', { name: '실시간 채팅 자동 게시' })
    expect(document.activeElement?.textContent).toBe('닫기')
    for (const sentence of [
      '구매 감사 메시지를 내 채널 이름으로 실시간 채팅에 자동으로 남겨요.',
      '동의한 뒤에 확정된 판매부터 남기고, 그 전 판매는 남기지 않아요.',
      '그 전 판매는 감사 메시지 목록에서 하나씩 보낼 수 있어요.',
      '구글 화면에서 글쓰기 권한을 한 번 더 허락해야 할 수 있어요.',
    ])
      expect(within(dialog).getByText(sentence)).toBeDefined()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(server.callsTo('PUT', /consent/)).toHaveLength(0)
    fireEvent.click(within(thanks).getByRole('button', { name: '영상 댓글 자동 게시 켜기' }))
    dialog = screen.getByRole('dialog', { name: '영상 댓글 자동 게시' })
    expect(within(dialog).getByText('구매 감사 메시지를 내 채널 이름으로 방송 영상 댓글로 자동으로 남겨요.')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    fireEvent.click(within(thanks).getByRole('button', { name: '실시간 채팅 자동 게시 켜기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '동의해요' }))
    expect(await within(thanks).findByText(/10월 25일 오후 8:01에 동의함/)).toBeDefined()
    expect(server.callsTo('PUT', /consent/).map((call) => call.body)).toEqual([{ target: 'LIVE_CHAT', enabled: true }])
    expect(within(thanks).getByRole('region', { name: '지금 설정의 결과' }).textContent).toContain('실시간 채팅 — 다음 방송부터 자동으로 남겨요')
  })

  it('글쓰기 권한이 없으면 승인 주소로 같은 탭에서 이동 (주소는 저장하지 않는다), 끄기는 바로', async () => {
    youtube = connection()
    await open()
    const thanks = section('구매 감사 메시지')
    fireEvent.click(await within(thanks).findByRole('button', { name: '실시간 채팅 자동 게시 켜기' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '동의해요' }))
    await waitFor(() => expect(assigned).toEqual([AUTH_URL]))
    const stored = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage })
    expect(stored).not.toContain('oauth2')
    youtube = connection({ permissions: { read: true, publish: true }, consent: { liveChat: { enabled: true, at: '2026-10-25T11:01:00.000Z' }, videoComment: { enabled: false, at: null } } })
    cleanup()
    await open()
    fireEvent.click(await within(section('구매 감사 메시지')).findByRole('button', { name: '실시간 채팅 자동 게시 끄기' }))
    expect(await screen.findByText('껐어요. 기다리던 감사 메시지는 보내지 않아요.')).toBeDefined()
    expect(server.callsTo('PUT', /consent/).at(-1)?.body).toEqual({ target: 'LIVE_CHAT', enabled: false })
  })

  it('연결 안 됨·준비 안 된 서버면 켜기가 잠긴다', async () => {
    await open()
    let thanks = section('구매 감사 메시지')
    expect(await within(thanks).findByText('유튜브를 먼저 연결해 주세요.')).toBeDefined()
    expect((within(thanks).getByRole('button', { name: '실시간 채팅 자동 게시 켜기' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    youtube = null
    settings = { ...settings, 'thanks.videoComment': 'SUMMARY' } // FB1 D-FB1-14 (3): 영상 댓글 동의 줄은 켜 둔 판매자에게만
    await open()
    thanks = section('구매 감사 메시지')
    expect(await within(thanks).findByText('유튜브 연동을 준비하지 않은 서버예요.')).toBeDefined()
    expect((within(thanks).getByRole('button', { name: '영상 댓글 자동 게시 켜기' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('유튜브 칸 (AC-I3-01~05·37)', () => {
  it('준비 안 된 서버: 안내 한 줄만 — 연결·끊기 버튼 없음', async () => {
    youtube = null
    await open()
    const yt = section('유튜브')
    expect(await within(yt).findByText('유튜브 연동을 준비하지 않은 서버예요.')).toBeDefined()
    expect(within(yt).queryByRole('button')).toBeNull()
    expect(within(yt).queryByRole('alert')).toBeNull()
  })

  it('연결 안 됨: 권한 안내 + "구글로 유튜브 연결하기" → 같은 탭에서 승인 주소로 (저장·콘솔 기록 없음)', async () => {
    const log = vi.spyOn(console, 'log')
    await open()
    const yt = section('유튜브')
    for (const sentence of ['내 채널 이름 보기', '내 라이브 방송 목록 보기', '방송 채팅 읽기(찜 받기)', '연결만으로는 내 채널에 글을 쓰지 않아요.', '구글 인증 정보는 암호로 바꿔 보관하고, 채팅 내용은 방송 날짜부터 30일 뒤에 지워요.', '언제든 연결을 끊거나 구글 계정 설정에서 권한을 거둘 수 있어요.'])
      expect(await within(yt).findByText(sentence)).toBeDefined()
    expect(within(yt).getByRole('link', { name: '개인정보처리방침' }).getAttribute('href')).toBe('/privacy')
    fireEvent.click(within(yt).getByRole('button', { name: '구글로 유튜브 연결하기' }))
    await waitFor(() => expect(assigned).toEqual([AUTH_URL]))
    expect(window.sessionStorage.getItem('livejjim.googleReturn')).toBeNull()
    expect(log.mock.calls.flat().join(' ')).not.toContain('oauth2')
    log.mockRestore()
  })

  it('돌아오면 결과 문장을 한 번(상태 영역) 보이고 주소의 결과 값을 지운다, 연결 상태는 서버로 다시 읽는다', async () => {
    youtube = connection()
    await open('/settings/youtube?youtube=connected')
    const yt = section('유튜브')
    const status = await within(yt).findByText('유튜브 채널을 연결했어요.')
    expect(status.getAttribute('role')).toBe('status')
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe('/settings/youtube'))
    expect(server.callsTo('GET', /^\/api\/youtube\/connection$/).length).toBeGreaterThan(0)
    cleanup()
    await open('/settings/youtube?youtube=ACCESS_DENIED')
    expect(await screen.findByText('구글에서 연결을 허락하지 않았어요. 다시 시도해 주세요.')).toBeDefined()
    cleanup()
    await open('/settings/youtube?youtube=weird')
    expect(await screen.findByText('연결 결과를 알 수 없어요. 아래 연결 상태를 확인해 주세요.')).toBeDefined()
  })

  it('연결됨: 채널 이름(글자로)·권한·사용량(KST·쉼표)·모드 — 영문 상태값·호출 종류 없음', async () => {
    youtube = connection({ channel: { id: 'UC_ME', title: '<img src=x onerror=alert(1)>채널' }, permissions: { read: true, publish: false } })
    await open()
    const yt = section('유튜브')
    expect(await within(yt).findByText('<img src=x onerror=alert(1)>채널')).toBeDefined()
    expect(document.querySelector('img')).toBeNull()
    expect(within(yt).getByText('읽기 권한 있음')).toBeDefined()
    expect(within(yt).getByText('글쓰기 권한 없음')).toBeDefined()
    expect(await within(yt).findByText('오늘 쓴 양 1,234 · 남은 양 8,766 (하루 한도 10,000)')).toBeDefined()
    expect(within(yt).getByText('한국 시간 10월 21일 오후 4:00에 다시 채워져요')).toBeDefined()
    expect(within(yt).getByText('유튜브 사용량이 얼마 남지 않아 감사 메시지를 묶어서 보내요')).toBeDefined()
    expect(yt.textContent).not.toMatch(/CONNECTED|liveChatMessages|insert|youtube\.readonly/)
  })

  it('다시 연결 필요: 안내·"다시 연결하기", 동의가 켜져 있으면 글쓰기 권한 안내', async () => {
    youtube = connection({ status: 'RECONNECT_NEEDED', consent: { liveChat: { enabled: true, at: '2026-10-25T11:01:00.000Z' }, videoComment: { enabled: false, at: null } } })
    await open()
    const yt = section('유튜브')
    expect(await within(yt).findByText('유튜브 연결을 다시 해 주세요.')).toBeDefined()
    expect(within(yt).getByText('구글 화면에 글쓰기 권한도 함께 나와요. 빼고 허락하면 자동 게시가 꺼져요.')).toBeDefined()
    fireEvent.click(within(yt).getByRole('button', { name: '다시 연결하기' }))
    await waitFor(() => expect(assigned).toEqual([AUTH_URL]))
    expect(server.callsTo('POST', /connection\/start/)).toHaveLength(1)
  })

  it('연결 끊기: 확인 창(처음 포커스 "그대로 두기", Esc는 그대로 두기) → 끊으면 연결 안 됨', async () => {
    youtube = connection()
    broadcasts = [broadcastItem({ id: 'b1', title: '1부', rehearsal: false, ended: false })]
    server.on('GET', /^\/api\/broadcasts\/b1\/youtube$/, () => ({ body: { link: { videoId: 'v1', channelId: 'UC_ME', linkedAt: '2026-10-20T00:00:00.000Z', chatEnded: false }, collector: null } }))
    await open()
    const yt = section('유튜브')
    fireEvent.click(await within(yt).findByRole('button', { name: '연결 끊기' }))
    let dialog = screen.getByRole('dialog', { name: '유튜브 연결을 끊을까요?' })
    expect(document.activeElement?.textContent).toBe('그대로 두기')
    expect(await within(dialog).findByText('지금 채팅을 받는 방송: 1부')).toBeDefined()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(server.callsTo('POST', /disconnect/)).toHaveLength(0)
    fireEvent.click(within(yt).getByRole('button', { name: '연결 끊기' }))
    dialog = screen.getByRole('dialog', { name: '유튜브 연결을 끊을까요?' })
    fireEvent.click(within(dialog).getByRole('button', { name: '연결 끊기' }))
    expect(await within(yt).findByRole('button', { name: '구글로 유튜브 연결하기' })).toBeDefined()
    expect(server.callsTo('POST', /disconnect/)).toHaveLength(1)
  })

  it('다른 기기에서 바뀌면 실시간 알림으로 바로 바뀐다 (연결·동의·사용량), 다시 붙으면 다시 받는다', async () => {
    youtube = connection()
    await open()
    const yt = section('유튜브')
    expect(await within(yt).findByText('글쓰기 권한 없음')).toBeDefined()
    const stream = FakeEventSource.last
    act(() => stream.emit('ready', { scopes: [] }))
    act(() => stream.emit('youtube', { kind: 'connection', connection: connection({ status: 'RECONNECT_NEEDED' }) }))
    expect(within(yt).getByText('유튜브 연결을 다시 해 주세요.')).toBeDefined()
    const before = server.callsTo('GET', /^\/api\/youtube\/connection$/).length
    act(() => stream.emit('ready', { scopes: [] }))
    await waitFor(() => expect(server.callsTo('GET', /^\/api\/youtube\/connection$/).length).toBe(before + 1))
  })
})

describe('가게 이름 (AC-I3-47)', () => {
  it('저장하면 위 줄 가게 이름이 바로 바뀐다, 틀리면 서버 문장', async () => {
    await open()
    const shop = section('가게')
    const field = within(shop).getByLabelText('가게 이름')
    fireEvent.change(field, { target: { value: '   ' } })
    clickSave() // FB1 D-FB1-06
    expect(await within(shop).findByText('가게 이름은 1~30자로 적어 주세요.')).toBeDefined()
    fireEvent.change(field, { target: { value: ' 새 가게 ' } })
    clickSave() // FB1 D-FB1-06
    expect(await within(saveBar()).findByText('저장했어요.')).toBeDefined() // FB1 D-FB1-06
    expect(document.querySelector('.shop-name')?.textContent).toBe('새 가게')
  })
})

// D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 "보조자 (AC-I3-64)" 만들기·지우기 시험을 뺐다
