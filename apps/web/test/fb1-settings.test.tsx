// FB1 설정 화면 (D-FB1-01~06·08·13·14·18, AC-FB1-01·05~08·10·11·19·22~25·31·32): 문구·감사 켜기 체크·택배사·택배 크기·저장 막대 하나·남은 값 없으면 묻지 않음.
import { DEFAULT_SETTINGS, type SaleSettings } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { ParcelSettings } from '../src/api/parcel-types.ts'
import type { Shop } from '../src/api/types.ts'
import { setTopLevelNavigation } from '../src/lib/google-return.ts'
import { fieldOf, valueWords } from '../src/lib/settings-fields.ts'
import { dirtyLine, failedMessage, orderBlocks, runSteps, savedMessage } from '../src/lib/save-bar.ts'
import { FakeEventSource, FakeServer, apiError, flush, youtubeNotConfigured, type Reply } from './support.ts'

let server: FakeServer
let settings: SaleSettings
let shop: Shop
let parcel: ParcelSettings
let meName: string
let assigned: string[]
/** PATCH /api/settings를 이 약속이 풀릴 때까지 붙잡는다 */
let holdPatch: Promise<void> | null

const AUTHORIZE = 'http://127.0.0.1:4104/kakao/authorize?state=s1'
const CARRIERS: ParcelSettings['carriers'] = [
  { code: 'EPOST', name: '우체국택배', autoBook: false },
  { code: 'CJ', name: 'CJ대한통운', autoBook: false },
  { code: 'HANJIN', name: '한진택배', autoBook: false },
  { code: 'LOGEN', name: '로젠택배', autoBook: false },
  { code: 'LOTTE', name: '롯데택배', autoBook: false },
  { code: 'OTHER', name: '직접 입력', autoBook: false },
  { code: 'FAKE', name: '가짜 택배(시험용)', autoBook: true },
]

function baseParcel(): ParcelSettings {
  return { carrier: null, carrierName: null, carriers: CARRIERS, customerNoLast4: null, sender: null, shopName: shop.name, box: '80', boxes: ['60', '80', '100', '120', '160'] }
}

function setup() {
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: meName }, loginId: 'shop1' } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, loginProviders: ['kakao'] } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings } }))
    .on('PATCH', /^\/api\/settings$/, async (call): Promise<Reply> => {
      if (holdPatch !== null) await holdPatch
      const changes = (call.body?.settings ?? {}) as Record<string, unknown>
      const waitlist = changes['waitlist.max']
      if (waitlist !== undefined && (typeof waitlist !== 'number' || waitlist > 100)) {
        // FB1 D-FB1-18 (g): 코어 범위 문장 그대로
        return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'settings.waitlist.max', message: '0부터 100까지 숫자로 적어 주세요.' }])
      }
      settings = { ...settings, ...changes } as SaleSettings
      return { body: { settings } }
    })
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on('GET', /^\/api\/youtube\/connection$/, () => youtubeNotConfigured)
    .on('GET', /^\/api\/shop$/, () => ({ body: { shop } }))
    .on('PUT', /^\/api\/shop$/, (call) => {
      shop = { ...shop, ...(call.body as Partial<Shop>) }
      return { body: { shop } }
    })
    .on('GET', /^\/api\/parcels\/settings$/, () => ({ body: { settings: parcel } }))
    .on('PUT', /^\/api\/parcels\/settings$/, (call): Reply => {
      const body = call.body ?? {}
      if (body.carrier === 'OTHER' && (typeof body.carrierName !== 'string' || body.carrierName.trim() === '')) {
        return apiError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field: 'carrierName', message: '택배사 이름을 적어 주세요.' }])
      }
      const carrier = (body.carrier as ParcelSettings['carrier']) ?? null
      const name = carrier === 'OTHER' ? String(body.carrierName).trim().replace(/\s+/g, ' ') : (CARRIERS.find((item) => item.code === carrier)?.name ?? null)
      parcel = {
        ...parcel,
        carrier,
        carrierName: name,
        box: (body.box as ParcelSettings['box']) ?? parcel.box,
        ...(body.sender === undefined ? {} : { sender: body.sender as ParcelSettings['sender'] }),
      }
      return { body: { settings: parcel } }
    })
    .on('GET', /^\/api\/auth\/methods$/, () => ({ body: { loginId: 'shop1', providers: [{ provider: 'kakao', enabled: true, linked: false, label: '', linkedAt: null }] } }))
    .on('POST', /^\/api\/auth\/link$/, () => ({ body: { authorizeUrl: AUTHORIZE } }))
}

beforeEach(() => {
  server = new FakeServer()
  settings = { ...DEFAULT_SETTINGS }
  shop = { name: '초록다육', bank: '', accountNumber: '', accountHolder: '', accountNote: '' }
  meName = '초록다육'
  parcel = baseParcel()
  assigned = []
  holdPatch = null
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

async function open() {
  window.history.replaceState(null, '', '/settings')
  render(<App />)
  await screen.findByRole('heading', { name: '설정', level: 1 })
  await screen.findByRole('region', { name: '판매 규칙' })
  await within(screen.getByRole('region', { name: '택배' })).findByRole('combobox', { name: '택배사' })
  await within(screen.getByRole('region', { name: '가게' })).findByLabelText('은행')
  await flush()
}

const section = (name: string) => screen.getByRole('region', { name })
const bar = () => screen.getByRole('region', { name: '저장' })
const saveButton = () => within(bar()).getByRole('button', { name: /저장/ })
const BLOCKS = ['가게', '판매 규칙', '배송비', '구매 감사 메시지', '택배'] as const

/** beforeunload가 브라우저 확인을 부르는가 */
function unloadAsks(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('저장 막대 낱말 (lib)', () => {
  it('화면 순서·이음표, 성공 문장(규칙·배송비 안내), 실패 문장', () => {
    expect(dirtyLine([])).toBe('바꾼 칸이 없어요.')
    expect(dirtyLine(['택배', '판매 규칙'])).toBe('저장하지 않은 칸: 판매 규칙 · 택배')
    expect(orderBlocks(['택배', '가게', '택배'])).toEqual(['가게', '택배'])
    expect(savedMessage(['가게'])).toBe('저장했어요.')
    expect(savedMessage(['구매 감사 메시지'])).toBe('저장했어요. 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.')
    expect(savedMessage(['판매 규칙', '배송비', '택배'])).toBe('저장했어요. 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요. 오늘 방송을 이미 시작했으면 배송비는 내일부터 적용돼요.')
    expect(failedMessage(['판매 규칙'])).toBe('저장하지 못한 칸이 있어요: 판매 규칙. 빨간 글을 확인해 주세요.')
    // FB1 D-FB1-18 (d): 저장한 칸 이름을 잇는다 (화면 순서, " · ")
    expect(failedMessage(['판매 규칙'], ['택배'])).toBe('저장하지 못한 칸이 있어요: 판매 규칙. 빨간 글을 확인해 주세요. 저장한 칸: 택배.')
    expect(failedMessage(['배송비'], ['택배', '가게'])).toBe('저장하지 못한 칸이 있어요: 배송비. 빨간 글을 확인해 주세요. 저장한 칸: 가게 · 택배.')
  })

  it('단계는 가게 → 설정 → 택배 차례, 하나가 던져도 다음 단계를 보낸다, 바뀐 칸이 없는 단계는 부르지 않는다', async () => {
    const order: string[] = []
    const result = await runSteps({
      parcel: { dirty: ['택배'], save: () => (order.push('parcel'), Promise.resolve({ saved: ['택배'], failed: [] })) },
      settings: { dirty: ['배송비'], save: () => (order.push('settings'), Promise.reject(new Error('x'))) },
      shop: { dirty: [], save: () => (order.push('shop'), Promise.resolve({ saved: [], failed: [] })) },
    })
    expect(order).toEqual(['settings', 'parcel'])
    expect(result).toEqual({ saved: ['택배'], failed: ['배송비'] })
  })
})

describe('남은 값이 없으면 묻지 않는다 (AC-FB1-31)', () => {
  const states: Record<string, () => void> = {
    '(a) 새 판매자': () => {},
    '(b) 계좌·안내 문장·보내는 사람·직접 입력 택배사': () => {
      shop = { ...shop, bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', accountNote: '입금자명은 닉네임으로' }
      parcel = { ...baseParcel(), carrier: 'OTHER', carrierName: '경동 택배', customerNoLast4: '5678', sender: { name: '김판매', phone: '0311234567', address: '경기도 고양시 1', detail: '101호', zip: '10200' } }
    },
    '(c) 옵션 판매 방식·무료배송 없음·묶는 시간 30': () => {
      settings = { ...settings, 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL', 'shipping.freeThreshold': null, 'thanks.batchWindowSec': 30, 'thanks.videoComment': 'SUMMARY' }
      parcel = { ...baseParcel(), sender: { name: '', phone: '0311234567', address: '경기도 고양시 1', detail: '', zip: '' }, box: '160' }
    },
    '(d) 로그인 정보와 저장된 가게 이름이 다름': () => {
      meName = '옛 이름'
      shop = { ...shop, name: '새 이름' }
      parcel = baseParcel()
    },
  }
  for (const [name, arrange] of Object.entries(states)) {
    it(`${name}: 막대 "바꾼 칸이 없어요."·잠긴 저장, 브라우저 확인 없음, 메뉴 이동·카카오 연결하기에 창 없음`, async () => {
      arrange()
      await open()
      expect(within(bar()).getByText('바꾼 칸이 없어요.')).toBeDefined()
      expect(saveButton()).toHaveProperty('disabled', true)
      expect(unloadAsks()).toBe(false)
      fireEvent.click(within(await screen.findByRole('region', { name: '로그인 방법' })).getByRole('button', { name: '카카오 연결하기' }))
      await waitFor(() => expect(assigned).toEqual([AUTHORIZE]))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(unloadAsks()).toBe(false)
      fireEvent.click(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '방송' }))
      await waitFor(() => expect(window.location.pathname).toBe('/'))
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  }
})

describe('저장 막대 (AC-FB1-22~25)', () => {
  it('다섯 칸 안에 "저장" 단추가 없고 막대 하나 — 고치면 고친 칸 이름(화면 순서), 되돌리면 빠진다', async () => {
    await open()
    for (const name of BLOCKS) expect(within(section(name)).queryByRole('button', { name: '저장' })).toBeNull()
    expect(screen.getAllByRole('region', { name: '저장' })).toHaveLength(1)
    fireEvent.change(within(section('택배')).getByLabelText('보내는 사람 연락처'), { target: { value: '0311234567' } })
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '3' } })
    expect(within(bar()).getByText('저장하지 않은 칸: 판매 규칙 · 택배')).toBeDefined()
    expect(saveButton().className).toContain('button-primary')
    expect(saveButton()).toHaveProperty('disabled', false)
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: String(DEFAULT_SETTINGS['waitlist.max']) } })
    expect(within(bar()).getByText('저장하지 않은 칸: 택배')).toBeDefined()
    expect(unloadAsks()).toBe(true)
  })

  it('다섯 칸을 고치고 한 번 저장: 가게 → 설정 하나(바뀐 키만) → 택배 차례, 보내는 동안 "저장하는 중…"(두 번 눌러도 한 번), 성공 문장·위 가게 이름', async () => {
    await open()
    fireEvent.change(within(section('가게')).getByLabelText('가게 이름'), { target: { value: '다육상회' } })
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '3' } })
    fireEvent.change(within(section('배송비')).getByLabelText('기본 배송비 (원)'), { target: { value: '3500' } })
    fireEvent.click(within(section('구매 감사 메시지')).getByRole('checkbox', { name: '찜이 확정될 때마다 채팅에 감사 메시지 남기기' })) // FB1 D-FB1-14
    fireEvent.change(within(section('택배')).getByRole('combobox', { name: '택배사' }), { target: { value: 'CJ' } })
    expect(within(bar()).getByText('저장하지 않은 칸: 가게 · 판매 규칙 · 배송비 · 구매 감사 메시지 · 택배')).toBeDefined()
    let release = () => {}
    holdPatch = new Promise<void>((resolve) => {
      release = resolve
    })
    const before = server.calls.length
    fireEvent.click(saveButton())
    fireEvent.click(saveButton())
    const busy = await within(bar()).findByRole('button', { name: '저장하는 중…' })
    expect(busy).toHaveProperty('disabled', true)
    await act(async () => {
      release()
      await flush()
    })
    expect(await within(bar()).findByText('저장했어요. 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요. 오늘 방송을 이미 시작했으면 배송비는 내일부터 적용돼요.')).toBeDefined()
    const writes = server.calls.slice(before).filter((call) => call.method !== 'GET')
    expect(writes.map((call) => `${call.method} ${call.path}`)).toEqual(['PUT /api/shop', 'PATCH /api/settings', 'PUT /api/parcels/settings'])
    expect(writes[1]?.body).toEqual({ settings: { 'waitlist.max': 3, 'shipping.baseFee': 3500, 'thanks.liveChat': false } }) // FB1 D-FB1-14
    expect(writes[2]?.body).toMatchObject({ carrier: 'CJ', box: '80' })
    expect(await within(bar()).findByText('바꾼 칸이 없어요.')).toBeDefined()
    await waitFor(() => expect(document.querySelector('.shop-name')?.textContent).toBe('다육상회'))
  })

  it('바뀌지 않은 칸의 요청은 없다 (택배만 바꾸면 택배 하나)', async () => {
    await open()
    fireEvent.change(within(section('택배')).getByRole('combobox', { name: '기본 택배 크기 (세 변의 합)' }), { target: { value: '120' } })
    const before = server.calls.length
    fireEvent.click(saveButton())
    expect(await within(bar()).findByText('저장했어요.')).toBeDefined()
    const writes = server.calls.slice(before).filter((call) => call.method !== 'GET')
    expect(writes.map((call) => `${call.method} ${call.path}`)).toEqual(['PUT /api/parcels/settings'])
    expect(writes[0]?.body).toMatchObject({ box: '120' })
  })

  it('일부 실패: 대기 인원 101 → 설정 400(아무 키도 저장 안 됨), 택배는 저장 — 칸 옆 서버 문장, 막대 alert, 남은 칸은 판매 규칙만', async () => {
    await open()
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '101' } })
    fireEvent.change(within(section('택배')).getByLabelText('보내는 사람 이름'), { target: { value: '김판매' } })
    fireEvent.change(within(section('택배')).getByLabelText('보내는 사람 연락처'), { target: { value: '0311234567' } })
    fireEvent.click(saveButton())
    const alert = await within(bar()).findByRole('alert')
    expect(alert.textContent).toBe('저장하지 못한 칸이 있어요: 판매 규칙. 빨간 글을 확인해 주세요. 저장한 칸: 택배.') // FB1 D-FB1-18 (d)
    expect(within(section('판매 규칙')).getByText('0부터 100까지 숫자로 적어 주세요.')).toBeDefined() // FB1 D-FB1-18 (g)
    expect(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)')).toHaveProperty('value', '101')
    expect(settings['waitlist.max']).toBe(DEFAULT_SETTINGS['waitlist.max'])
    expect(parcel.sender?.name).toBe('김판매')
    expect(await within(bar()).findByText('저장하지 않은 칸: 판매 규칙')).toBeDefined()
    // 첫 고칠 칸으로 데려간다 (U-FB1-02)
    await waitFor(() => expect(document.activeElement).toBe(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)')))
    // 되돌려 저장값과 같아지면 실패 문장도 사라진다
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: String(DEFAULT_SETTINGS['waitlist.max']) } })
    expect(within(bar()).queryByRole('alert')).toBeNull()
    expect(within(bar()).getByText('바꾼 칸이 없어요.')).toBeDefined()
  })

  it('네트워크 실패도 같은 모양 (그 칸 이름)', async () => {
    server.on('PATCH', /^\/api\/settings$/, () => ({ network: true }))
    await open()
    fireEvent.change(within(section('배송비')).getByLabelText('기본 배송비 (원)'), { target: { value: '3500' } })
    fireEvent.click(saveButton())
    expect((await within(bar()).findByRole('alert')).textContent).toBe('저장하지 못한 칸이 있어요: 배송비. 빨간 글을 확인해 주세요.')
    expect(await within(bar()).findByText('저장하지 않은 칸: 배송비')).toBeDefined()
    // 빨간 칸이 없으면 그 칸 제목으로 (U-FB1-02)
    await waitFor(() => expect(document.activeElement).toBe(within(section('배송비')).getByRole('heading', { name: '배송비' })))
  })

  it('바뀐 칸이 있으면 메뉴 이동은 앱 창으로 묻는다 (AC-FB1-25)', async () => {
    await open()
    fireEvent.change(within(section('가게')).getByLabelText('예금주'), { target: { value: '김판매' } })
    fireEvent.click(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '방송' }))
    const dialog = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
    expect(within(dialog).getByText('저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.')).toBeDefined()
    expect(window.location.pathname).toBe('/settings')
  })

  it('누르면 바로 되는 칸(로그인 방법 등)은 막대의 바뀐 칸에 들지 않는다', async () => {
    await open()
    expect(within(bar()).getByText('바꾼 칸이 없어요.')).toBeDefined()
    expect(within(section('로그인 방법')).getByRole('button', { name: '카카오 연결하기' })).toBeDefined()
  })
})

describe('설정 문구 (AC-FB1-01·05~08)', () => {
  it('가격 단위 세 낱말과 단위 붙인 글 안내, 배송비 안내, "상세 설정"과 펼친 칸 위 안내, 여러 번호 예시, 같은 1분 낱말', async () => {
    await open()
    const rules = section('판매 규칙')
    const unit = within(rules).getByRole('radiogroup', { name: '가격 단위' })
    // FB1 D-FB1-11 (5): 원·천원·만원 (D-FB1-01의 두 낱말 대체)
    // D-V3-70: 넷째 단추 "자동"
    expect(within(unit).getAllByRole('radio').map((radio) => radio.parentElement?.textContent)).toEqual(['원 (15000 → 15,000원)', '천원 (15 → 15,000원)', '만원 (15 → 150,000원)', '자동 (25 → 250,000원, 180 → 180,000원)'])
    expect((within(unit).getByRole('radio', { name: '천원 (15 → 15,000원)' }) as HTMLInputElement).checked).toBe(true)
    expect(within(unit).getByText("'2만'·'15000원'처럼 단위를 붙여 적으면 이 설정과 상관없이 적힌 대로 들어가요.")).toBeDefined()
    expect(within(section('배송비')).getByText('배송비는 그날 첫 방송을 시작할 때의 값으로 정산해요. 오늘 방송을 이미 시작했으면 바꾼 배송비는 내일부터 적용돼요.')).toBeDefined()
    // FB1 D-FB1-18 (c): 접근 이름 "판매 규칙 상세 설정", 보이는 글 뒤 ▼/▲(aria-hidden)
    expect(within(rules).queryByRole('button', { name: '상세 설정' })).toBeNull()
    const detail = within(rules).getByRole('button', { name: '판매 규칙 상세 설정' })
    expect(detail.getAttribute('aria-expanded')).toBe('false')
    expect(detail.textContent).toBe('판매 규칙 상세 설정 ▼')
    expect(detail.querySelector('[aria-hidden="true"]')?.textContent).toBe('▼')
    fireEvent.click(detail)
    expect(detail.getAttribute('aria-expanded')).toBe('true')
    expect(detail.textContent).toBe('판매 규칙 상세 설정 ▲')
    expect(within(rules).getByText('잘 모르면 그대로 두세요.')).toBeDefined()
    const multi = within(rules).getByRole('radiogroup', { name: '한 채팅에 번호가 여러 개면' })
    // FB1 D-FB1-12: 채팅 한 줄 모양 — 글쓴이와 글은 다른 요소, 글쓴이는 다른 모양(회색 작은 글씨)
    const author = within(multi).getByText('@홍길동')
    const chat = within(multi).getByText('132 475')
    expect(author).not.toBe(chat)
    expect(author.contains(chat) || chat.contains(author)).toBe(false)
    expect(author.className).not.toBe(chat.className)
    expect(author.parentElement?.textContent).toBe('예: @홍길동 132 475')
    expect(within(multi).getAllByRole('radio').map((radio) => radio.parentElement?.textContent)).toEqual(['모두 주문 (132번·475번 둘 다 찜)', '첫 번호만 주문 (132번만 찜)', '주문으로 보지 않아요 (둘 다 찜 아님)'])
    const tie = within(rules).getByRole('radiogroup', { name: '문자찜과 댓글찜이 동시에(같은 1분 안에) 들어오면' }) // FB1 D-FB1-13
    expect(within(tie).getAllByRole('radio').map((radio) => radio.parentElement?.textContent)).toEqual(['유튜브 먼저', '문자 먼저', '내가 정해요'])
    const text = document.body.textContent ?? ''
    for (const gone of [
      '더 보기 (잘 모르면 그대로 두세요)',
      '그날 첫 방송이 이미 있으면 그날 정산은 그대로예요.',
      "만원 단위는 '2만'·'1.5만'처럼 적으면 돼요.",
      "예: 채팅 '15 28'",
      '15번·28번 둘 다',
      '극소',
      'TEN_THOUSAND',
      'THOUSAND',
      'WON',
      'EPOST',
      'OTHER',
      'PER_SALE',
      // FB1 D-FB1-13·14·18 (c)
      '문자찜과 유튜브 찜이 같은 1분 안에 들어오면 (실제 받은 시각 순서일 때만)',
      '같은 분에 들어오면',
      '까지의 정수로 적어 주세요',
    ])
      expect(text).not.toContain(gone)
    expect(screen.queryByRole('button', { name: '상세 설정' })).toBeNull()
    // 저장 값은 WON·THOUSAND·TEN_THOUSAND
    fireEvent.click(within(unit).getByRole('radio', { name: '원 (15000 → 15,000원)' }))
    fireEvent.click(saveButton())
    await within(bar()).findByText(/저장했어요/)
    expect(server.callsTo('PATCH', /^\/api\/settings$/).at(-1)?.body).toEqual({ settings: { 'price.unit': 'WON' } })
  })

  it('가격 단위를 저장된 값과 다르게 고르면 확인 한 줄(창 없음), 되돌리거나 저장하면 없다 — 만원 저장 값 TEN_THOUSAND (AC-FB1-01)', async () => {
    await open()
    const unit = within(section('판매 규칙')).getByRole('radiogroup', { name: '가격 단위' })
    const TEN = "저장하면 다음 방송부터 '15'는 150,000원으로 들어가요. 이미 등록한 상품 가격은 바뀌지 않아요."
    const THOUSAND_NOTE = "저장하면 다음 방송부터 '15'는 15,000원으로 들어가요. 이미 등록한 상품 가격은 바뀌지 않아요."
    const WON_NOTE = "저장하면 다음 방송부터 숫자를 원 그대로 읽어요('15000' → 15,000원). 이미 등록한 상품 가격은 바뀌지 않아요."
    const notes = () => [TEN, THOUSAND_NOTE, WON_NOTE].filter((note) => within(unit).queryByText(note) !== null)
    expect(notes()).toEqual([])
    fireEvent.click(within(unit).getByRole('radio', { name: '만원 (15 → 150,000원)' }))
    expect(notes()).toEqual([TEN])
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(unit).getByRole('radio', { name: '원 (15000 → 15,000원)' }))
    expect(notes()).toEqual([WON_NOTE])
    fireEvent.click(within(unit).getByRole('radio', { name: '천원 (15 → 15,000원)' }))
    expect(notes()).toEqual([])
    fireEvent.click(within(unit).getByRole('radio', { name: '만원 (15 → 150,000원)' }))
    fireEvent.click(saveButton())
    await within(bar()).findByText(/저장했어요/)
    expect(server.callsTo('PATCH', /^\/api\/settings$/).at(-1)?.body).toEqual({ settings: { 'price.unit': 'TEN_THOUSAND' } })
    expect(notes()).toEqual([])
    // 저장된 값이 만원일 때 천원으로 바꾸면 천원 문장
    fireEvent.click(within(unit).getByRole('radio', { name: '천원 (15 → 15,000원)' }))
    expect(notes()).toEqual([THOUSAND_NOTE])
    expect(document.body.textContent).not.toContain('TEN_THOUSAND')
  })
})

describe('시작 마법사 요약의 가격 단위 낱말 (AC-FB1-01)', () => {
  it('설정 화면과 같은 낱말', () => {
    const word = (unit: SaleSettings['price.unit']) => valueWords(fieldOf('price.unit'), { ...DEFAULT_SETTINGS, 'price.unit': unit })
    expect([word('WON'), word('THOUSAND'), word('TEN_THOUSAND')]).toEqual(['원 (15000 → 15,000원)', '천원 (15 → 15,000원)', '만원 (15 → 150,000원)'])
  })
})

// FB1 D-FB1-14 (사용자 결정): 채팅 체크 한 줄 — 영상 댓글은 켜 둔 판매자만 끄기/되돌리기 (옛 "켜기 체크 두 줄" 시험 대체)
describe('구매 감사 메시지 만들기 (AC-FB1-08·10·11)', () => {
  const thanks = () => section('구매 감사 메시지')
  const VIDEO_WORDS = ['감사 메시지를 남길 곳', '영상 댓글에 감사 메시지 남기기', '영상 댓글 방식', '판매마다 댓글', '방송이 끝나고 요약 댓글 1개', '남기지 않음', '방송 중 영상 옆 채팅창에 바로 보이는 글이에요.', '방송 영상 아래 댓글란에 남는 글이에요. 방송이 끝나도 남아요.']
  const ON_LINE = '영상 댓글에도 감사 메시지를 남기고 있어요.'
  const PENDING_LINE = '저장하면 영상 댓글에는 남기지 않아요.'

  it('저장값 OFF: 체크 한 줄 "찜이 확정될 때마다 채팅에 감사 메시지 남기기"뿐 — 영상 댓글 낱말·켤 칸이 어디에도 없다', async () => {
    await open()
    const box = within(thanks()).getByRole('checkbox', { name: '찜이 확정될 때마다 채팅에 감사 메시지 남기기' }) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(within(thanks()).getAllByRole('checkbox')).toHaveLength(1)
    expect(within(thanks()).queryByRole('group', { name: '감사 메시지를 남길 곳' })).toBeNull()
    expect(within(thanks()).queryByRole('radiogroup')).toBeNull()
    expect(within(thanks()).queryByRole('button', { name: '영상 댓글 끄기' })).toBeNull()
    const text = thanks().textContent ?? ''
    for (const word of [...VIDEO_WORDS, '실시간 채팅에 감사 메시지 남기기', '영상 댓글', ON_LINE]) expect(text).not.toContain(word)
    fireEvent.click(box)
    expect(within(bar()).getByText('저장하지 않은 칸: 구매 감사 메시지')).toBeDefined()
    fireEvent.click(saveButton())
    await within(bar()).findByText(/저장했어요/)
    expect(server.callsTo('PATCH', /^\/api\/settings$/).at(-1)?.body).toEqual({ settings: { 'thanks.liveChat': false } })
  })

  for (const saved of ['PER_SALE', 'SUMMARY'] as const) {
    it(`저장값 ${saved}: 알림 한 줄 + "영상 댓글 끄기" → "저장하면 …" + "되돌리기" → 되돌리면 ${saved} 그대로, 끄고 저장하면 OFF와 낱말이 사라진다`, async () => {
      settings = { ...settings, 'thanks.videoComment': saved }
      await open()
      expect(within(thanks()).getByText(ON_LINE)).toBeDefined()
      for (const word of VIDEO_WORDS) expect(within(thanks()).queryByText(word)).toBeNull()
      // 자동 게시 동의·지금 설정의 결과의 영상 댓글 줄은 그대로 보인다
      expect(within(thanks()).getByRole('region', { name: '지금 설정의 결과' }).textContent).toContain('영상 댓글')
      const off = within(thanks()).getByRole('button', { name: '영상 댓글 끄기' })
      expect(off.className).not.toContain('button-primary')
      fireEvent.click(off)
      expect(within(thanks()).getByText(PENDING_LINE)).toBeDefined()
      expect(within(thanks()).queryByText(ON_LINE)).toBeNull()
      expect(within(bar()).getByText('저장하지 않은 칸: 구매 감사 메시지')).toBeDefined()
      // 되돌리기: 저장된 방식 그대로, 막대에서 빠진다
      const undo = within(thanks()).getByRole('button', { name: '되돌리기' })
      expect(undo.className).not.toContain('button-primary')
      fireEvent.click(undo)
      expect(within(thanks()).getByText(ON_LINE)).toBeDefined()
      expect(within(bar()).getByText('바꾼 칸이 없어요.')).toBeDefined()
      // 다른 칸을 고친 채 되돌리면 그 칸만 남는다
      fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '3' } })
      fireEvent.click(within(thanks()).getByRole('button', { name: '영상 댓글 끄기' }))
      expect(within(bar()).getByText('저장하지 않은 칸: 판매 규칙 · 구매 감사 메시지')).toBeDefined()
      fireEvent.click(within(thanks()).getByRole('button', { name: '되돌리기' }))
      expect(within(bar()).getByText('저장하지 않은 칸: 판매 규칙')).toBeDefined()
      fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: String(DEFAULT_SETTINGS['waitlist.max']) } })
      // 끄고 저장
      fireEvent.click(within(thanks()).getByRole('button', { name: '영상 댓글 끄기' }))
      fireEvent.click(saveButton())
      await within(bar()).findByText(/저장했어요/)
      expect(server.callsTo('PATCH', /^\/api\/settings$/).at(-1)?.body).toEqual({ settings: { 'thanks.videoComment': 'OFF' } })
      await waitFor(() => expect(within(thanks()).queryByText(PENDING_LINE)).toBeNull())
      expect(within(thanks()).queryByText(ON_LINE)).toBeNull()
      expect(within(thanks()).queryByRole('button', { name: '되돌리기' })).toBeNull()
      expect(thanks().textContent).not.toContain('영상 댓글')
    })
  }

  it('늘 보이는 자동 묶음 안내는 한 문장, 묶는 시간 칸은 "감사 메시지 상세 설정 ▼"을 펴야 보인다, 저장값 30이면 밖에 한 줄 (0이면 없음)', async () => {
    await open()
    // FB1 D-FB1-14 (4): 앞 문장 "판매가 확정될 때마다 하나씩 남겨요."는 없다
    expect(within(thanks()).getByText('유튜브가 하루에 받아 주는 양이 모자라면 저절로 1분씩 묶어 남겨요.')).toBeDefined()
    expect(thanks().textContent).not.toContain('판매가 확정될 때마다 하나씩 남겨요.')
    expect(within(thanks()).queryByText(/초 동안의 판매를 한 메시지로 묶어요/)).toBeNull()
    // FB1 D-FB1-18 (c)
    expect(within(thanks()).queryByRole('button', { name: '상세 설정' })).toBeNull()
    const detail = within(thanks()).getByRole('button', { name: '감사 메시지 상세 설정' })
    expect(detail.getAttribute('aria-expanded')).toBe('false')
    expect(detail.textContent).toBe('감사 메시지 상세 설정 ▼')
    expect(detail.querySelector('[aria-hidden="true"]')?.textContent).toBe('▼')
    expect(within(thanks()).getByLabelText('몇 초 동안의 판매를 한 메시지로 묶을까요? (0이면 하나씩)').closest('[hidden]')).not.toBeNull()
    fireEvent.click(detail)
    expect(detail.textContent).toBe('감사 메시지 상세 설정 ▲')
    const batch = within(thanks()).getByLabelText('몇 초 동안의 판매를 한 메시지로 묶을까요? (0이면 하나씩)')
    expect(batch.closest('[hidden]')).toBeNull()
    fireEvent.change(batch, { target: { value: '30' } })
    fireEvent.click(saveButton())
    expect(await within(thanks()).findByText('지금은 30초 동안의 판매를 한 메시지로 묶어요.')).toBeDefined()
  })
})

// FB1 D-FB1-18 (e): 설정 화면 떠나기 창 — "저장하고 떠나기"(주 버튼)·"저장하지 않고 떠나기"·"닫기"
describe('떠나기 창 "저장하고 떠나기" (AC-FB1-25·32)', () => {
  const dialogButtons = (dialog: HTMLElement) => within(dialog).getAllByRole('button').map((button) => button.textContent)

  it('단추 셋 이 순서, 처음 포커스 "닫기", 저장하고 떠나기 → 같은 요청 차례 → 가려던 화면으로, 보내는 동안 "저장하는 중…"·세 단추 잠김(두 번 눌러도 한 번)', async () => {
    await open()
    fireEvent.change(within(section('가게')).getByLabelText('예금주'), { target: { value: '김판매' } })
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '3' } })
    fireEvent.change(within(section('택배')).getByLabelText('보내는 사람 연락처'), { target: { value: '0311234567' } })
    fireEvent.click(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '방송' }))
    const dialog = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
    expect(dialogButtons(dialog)).toEqual(['저장하고 떠나기', '저장하지 않고 떠나기', '닫기'])
    expect(within(dialog).getByRole('button', { name: '저장하고 떠나기' }).className).toContain('button-primary')
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' }))
    let release = () => {}
    holdPatch = new Promise<void>((resolve) => {
      release = resolve
    })
    const before = server.calls.length
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하고 떠나기' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /^저장하(고 떠나기|는 중…)$/ }))
    const busy = await within(dialog).findByRole('button', { name: '저장하는 중…' })
    expect(busy).toHaveProperty('disabled', true)
    expect(within(dialog).getByRole('button', { name: '저장하지 않고 떠나기' })).toHaveProperty('disabled', true)
    expect(within(dialog).getByRole('button', { name: '닫기' })).toHaveProperty('disabled', true)
    // 보내는 동안 Esc도 창을 닫지 않는다
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '다른 화면으로 갈까요?' })).toBeDefined()
    await act(async () => {
      release()
      await flush()
    })
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(screen.queryByRole('dialog')).toBeNull()
    const writes = server.calls.slice(before).filter((call) => call.method !== 'GET')
    expect(writes.map((call) => `${call.method} ${call.path}`)).toEqual(['PUT /api/shop', 'PATCH /api/settings', 'PUT /api/parcels/settings'])
    expect(writes[1]?.body).toEqual({ settings: { 'waitlist.max': 3 } })
    expect(shop.accountHolder).toBe('김판매')
    expect(settings['waitlist.max']).toBe(3)
  })

  it('일부 실패 → 창이 닫히고 설정 화면에 남는다, 막대에 일부 실패 문장, 첫 빨간 칸에 포커스', async () => {
    await open()
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '101' } })
    fireEvent.change(within(section('택배')).getByLabelText('보내는 사람 연락처'), { target: { value: '0311234567' } })
    fireEvent.click(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '방송' }))
    const dialog = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하고 떠나기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.pathname).toBe('/settings')
    expect((await within(bar()).findByRole('alert')).textContent).toBe('저장하지 못한 칸이 있어요: 판매 규칙. 빨간 글을 확인해 주세요. 저장한 칸: 택배.')
    await waitFor(() => expect(document.activeElement).toBe(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)')))
    expect(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)')).toHaveProperty('value', '101')
  })

  it('네트워크 실패 → 창이 닫히고 남는다, 저장한 칸이 없으면 앞 두 문장만, 그 칸 제목에 포커스', async () => {
    server.on('PATCH', /^\/api\/settings$/, () => ({ network: true }))
    await open()
    fireEvent.change(within(section('배송비')).getByLabelText('기본 배송비 (원)'), { target: { value: '3500' } })
    fireEvent.click(within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '방송' }))
    const dialog = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하고 떠나기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(window.location.pathname).toBe('/settings')
    expect((await within(bar()).findByRole('alert')).textContent).toBe('저장하지 못한 칸이 있어요: 배송비. 빨간 글을 확인해 주세요.')
    await waitFor(() => expect(document.activeElement).toBe(within(section('배송비')).getByRole('heading', { name: '배송비' })))
  })

  it('"저장하지 않고 떠나기"는 그대로 저장하지 않고 간다, "닫기"는 남는다', async () => {
    await open()
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '3' } })
    const menu = () => within(screen.getByRole('navigation', { name: '메뉴' })).getByRole('link', { name: '방송' })
    fireEvent.click(menu())
    fireEvent.click(within(await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.pathname).toBe('/settings')
    fireEvent.click(menu())
    const before = server.calls.length
    fireEvent.click(within(await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })).getByRole('button', { name: '저장하지 않고 떠나기' }))
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(server.calls.slice(before).filter((call) => call.method !== 'GET')).toEqual([])
    expect(settings['waitlist.max']).toBe(DEFAULT_SETTINGS['waitlist.max'])
  })

  it('카카오 연결하기: 저장하고 떠나기 성공 → 연결 요청 → 이동, 실패 → 연결 요청 없이 남고 버튼 "카카오 연결하기" 그대로', async () => {
    await open()
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '101' } })
    const login = await screen.findByRole('region', { name: '로그인 방법' })
    fireEvent.click(within(login).getByRole('button', { name: '카카오 연결하기' }))
    let dialog = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
    expect(dialogButtons(dialog)).toEqual(['저장하고 떠나기', '저장하지 않고 떠나기', '닫기'])
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하고 떠나기' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await within(bar()).findByRole('alert')
    expect(server.callsTo('POST', /^\/api\/auth\/link$/)).toHaveLength(0)
    expect(assigned).toEqual([])
    expect(within(login).getByRole('button', { name: '카카오 연결하기' })).toHaveProperty('disabled', false)
    // 고쳐서 다시
    fireEvent.change(within(section('판매 규칙')).getByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '3' } })
    fireEvent.click(within(login).getByRole('button', { name: '카카오 연결하기' }))
    dialog = await screen.findByRole('dialog', { name: '다른 화면으로 갈까요?' })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장하고 떠나기' }))
    await waitFor(() => expect(assigned).toEqual([AUTHORIZE]))
    expect(settings['waitlist.max']).toBe(3)
    expect(server.callsTo('POST', /^\/api\/auth\/link$/)).toHaveLength(1)
    expect(unloadAsks()).toBe(false)
  })
})

describe('택배 설정 (AC-FB1-19)', () => {
  it('택배사 낱말(잠긴 줄 없음)·직접 입력 이름 칸·자동 접수 안내, 기본 택배 크기 다섯 낱말과 안내', async () => {
    await open()
    const box = section('택배')
    const carrier = within(box).getByRole('combobox', { name: '택배사' })
    const options = [...carrier.querySelectorAll('option')]
    expect(options.map((option) => option.textContent)).toEqual(['고르지 않음', '우체국택배', 'CJ대한통운', '한진택배', '로젠택배', '롯데택배', '직접 입력', '가짜 택배(시험용)'])
    expect(options.every((option) => !option.disabled)).toBe(true)
    const note = '자동 접수는 아직 준비 중이에요. 지금은 포장 화면에서 송장번호를 직접 적어요.'
    expect(within(box).getByText(note)).toBeDefined()
    fireEvent.change(carrier, { target: { value: 'FAKE' } })
    expect(within(box).queryByText(note)).toBeNull()
    fireEvent.change(carrier, { target: { value: 'LOGEN' } })
    expect(within(box).getByText(note)).toBeDefined()
    expect(within(box).queryByLabelText('택배사 이름')).toBeNull()
    fireEvent.change(carrier, { target: { value: 'OTHER' } })
    const name = within(box).getByLabelText('택배사 이름')
    // FB1 D-FB1-18 (f): 이름 칸은 고르기 바로 아래(사이에 다른 글 없음), 그 아래 안내 하나, 옛 안내 둘 없음
    const carrierField = carrier.closest('.field') as HTMLElement
    expect(carrierField.nextElementSibling).toBe(name.closest('.field'))
    expect([...carrierField.querySelectorAll('p')]).toEqual([])
    expect(name.closest('.field')?.nextElementSibling?.textContent).toBe(note)
    expect([...box.querySelectorAll('p')].filter((p) => p.textContent === note)).toHaveLength(1)
    expect(box.textContent).not.toContain('택배사를 고르지 않아도 포장 화면에서 배송 완료·송장번호를 직접 적을 수 있어요.')
    expect(box.textContent).not.toContain('20자까지 적을 수 있어요.')
    fireEvent.click(saveButton())
    expect(await within(box).findByText('택배사 이름을 적어 주세요.')).toBeDefined()
    fireEvent.change(name, { target: { value: '  경동   택배 ' } })
    fireEvent.click(saveButton())
    await within(bar()).findByText('저장했어요.')
    expect(server.callsTo('PUT', /^\/api\/parcels\/settings$/).at(-1)?.body).toMatchObject({ carrier: 'OTHER', carrierName: '  경동   택배 ' })
    expect(within(box).getByLabelText('택배사 이름')).toHaveProperty('value', '경동 택배')
    const size = within(box).getByRole('combobox', { name: '기본 택배 크기 (세 변의 합)' })
    expect([...size.querySelectorAll('option')].map((option) => [option.value, option.textContent])).toEqual([
      ['60', '60cm 이하'],
      ['80', '80cm 이하'],
      ['100', '100cm 이하'],
      ['120', '120cm 이하'],
      ['160', '160cm 이하'],
    ])
    expect(within(box).getByText('가로·세로·높이를 더한 길이예요. 우체국 기준이고, 무게 기준은 택배사마다 달라요.')).toBeDefined()
    expect(box.textContent).not.toMatch(/극소|기본 상자 크기/)
  })

  it('직접 입력 이름은 글자로만 보인다 (HTML로 읽지 않는다)', async () => {
    parcel = { ...baseParcel(), carrier: 'OTHER', carrierName: '<img src=x onerror=alert(1)>' }
    await open()
    expect(within(section('택배')).getByLabelText('택배사 이름')).toHaveProperty('value', '<img src=x onerror=alert(1)>')
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })
})
