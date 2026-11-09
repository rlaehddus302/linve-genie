// D-UX4-86 (사용자 지시 2026-11-10 "앱 안에 있는 모든 '방송' 단어 다 라이브로"): 화면 낱말이 바뀌어 기대 글의 '방송'을 '라이브'로(조사 포함) 바꿨다.
// 앱 가게 설정 (D-APPX-03 — 웹 SettingsPage와 같은 칸·저장 규칙): 바꾼 칸만 아래 "저장" 하나로(가게 PUT · 판매 규칙 PATCH 바뀐 키만),
// 저장 문장은 저장 막대와 같은 글, 서버 칸 문장은 그 칸 아래, 저장하지 않고 나가면 묻는다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@livejjim/core/settings'
import { ShopSettingsScreen } from '../src/screens/ShopSettingsScreen.tsx'
import { makeWorld } from './screen-support.tsx'

function world() {
  const w = makeWorld()
  const writes: { method: string; path: string; body: Record<string, unknown> | null }[] = []
  const shop = { name: '초록가게', bank: '', accountNumber: '', accountHolder: '', accountNote: '' }
  w.server.on('GET', /^\/api\/shop$/, () => ({ body: { shop } }))
  w.server.on('GET', /^\/api\/settings$/, () => ({ body: { settings: DEFAULT_SETTINGS } }))
  w.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
  w.server.on('GET', /^\/api\/parcels\/settings$/, () => ({ body: { settings: { carrier: null, carrierName: null, carriers: [{ code: 'EPOST', name: '우체국택배', autoBook: false }], customerNoLast4: null, sender: null, shopName: '초록가게', box: '60', boxes: ['60', '80'] } } }))
  w.server.on('GET', /^\/api\/customer-settings$/, () => ({ body: { settings: { regularCount: 3, regularAmount: null, waitDays: 3 } } }))
  w.server.on('GET', /^\/api\/ledger-settings$/, () => ({ body: { settings: { months: 12, consoleBadges: false } } }))
  w.server.on('GET', /^\/api\/assist\/settings$/, () => ({ body: { available: false, enabled: false, consentedAt: null, usedToday: 0, dailyLimit: 50 } }))
  w.server.on('GET', /^\/api\/backups$/, () => ({ body: { enabled: true, retentionDays: 14, lastSuccessAt: new Date().toISOString(), backups: [] } }))
  w.server.on('PUT', /^\/api\/shop$/, (call) => {
    writes.push({ method: 'PUT', path: call.path, body: call.body })
    return { body: { shop: call.body } }
  })
  w.server.on('PATCH', /^\/api\/settings$/, (call) => {
    writes.push({ method: 'PATCH', path: call.path, body: call.body })
    const changes = (call.body?.['settings'] ?? {}) as Record<string, unknown>
    if (changes['waitlist.max'] === 999) return { status: 400, body: { error: { code: 'INVALID', message: '대기 인원은 0~50명이에요.', problems: [{ field: 'settings.waitlist.max', message: '대기 인원은 0~50명이에요.' }] } } }
    return { body: { settings: { ...DEFAULT_SETTINGS, ...changes } } }
  })
  return { w, writes }
}

describe('ShopSettingsScreen (앱 가게 설정)', () => {
  it('바꾼 칸만 저장 하나로: 가게 PUT, 판매 규칙은 바뀐 키만 PATCH, 저장 문장', async () => {
    const { w, writes } = world()
    render(w.wrap(<ShopSettingsScreen onBack={() => undefined} />))
    fireEvent.change(await screen.findByLabelText('가게 이름'), { target: { value: '다육한 집' } })
    fireEvent.click(await screen.findByRole('button', { name: /가격 단위 만원/ }))
    expect(screen.getByText(/저장하면 다음 라이브부터 '15'는 150,000원으로 들어가요/)).toBeTruthy()
    expect(screen.getByText('저장하지 않은 칸: 가게 · 판매 규칙')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[0]).toMatchObject({ method: 'PUT', body: { name: '다육한 집' } })
    expect(writes[1]).toMatchObject({ method: 'PATCH', body: { settings: { 'price.unit': 'TEN_THOUSAND' } } })
    expect(Object.keys((writes[1]!.body?.['settings'] ?? {}) as object)).toEqual(['price.unit'])
    expect(await screen.findByText(/^저장했어요\./)).toBeTruthy()
  })

  // D-YT-SEND-18: 봇이 감사 채팅을 대신 올리는 판매자 — 게시 동의 안내 대신 "라이브지니가 올려요", 연결 목록에 유튜브 연결 줄 없음
  it('봇 감사 판매자: 감사 칸 아래 안내가 바뀌고 연결에서 유튜브 연결 줄이 빠진다', async () => {
    const { w } = world()
    w.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true, botThanks: true } }))
    render(w.wrap(<ShopSettingsScreen onBack={() => undefined} />))
    expect(await screen.findByText(/라이브지니가 라이브 채팅에 감사 메시지를 대신 올려요/)).toBeTruthy()
    expect(screen.queryByText('유튜브 채팅·댓글 자동 게시 동의는 아래 "연결"에서 웹으로 열어요.')).toBeNull()
    await waitFor(() => expect(screen.queryByText('유튜브 연결')).toBeNull())
    expect(screen.getByText('인스타그램 연결')).toBeTruthy()
  })

  it('봇 감사가 아닌 판매자: 예전 안내와 유튜브 연결 줄 그대로', async () => {
    const { w } = world()
    w.server.on('GET', /^\/api\/youtube\/connection$/, () => ({ body: { connection: { status: 'NOT_CONNECTED', channel: null, permissions: { read: false, publish: false }, consent: { liveChat: { enabled: false, at: null }, videoComment: { enabled: false, at: null } } }, webChat: { on: true }, oauth: true, botThanks: false } }))
    render(w.wrap(<ShopSettingsScreen onBack={() => undefined} />))
    expect(await screen.findByText('유튜브 채팅·댓글 자동 게시 동의는 아래 "연결"에서 웹으로 열어요.')).toBeTruthy()
    expect(await screen.findByText('유튜브 연결')).toBeTruthy()
  })

  it('서버 칸 문장은 그 칸 아래 · 저장하지 않고 나가면 묻는다', async () => {
    const { w } = world()
    const onBack = vi.fn()
    render(w.wrap(<ShopSettingsScreen onBack={onBack} />))
    fireEvent.change(await screen.findByLabelText('대기 인원 (0이면 대기 없음)'), { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText(/대기 인원은 0~50명이에요/)).toBeTruthy()
    expect(screen.getByText(/저장하지 못한 칸이 있어요: 판매 규칙/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(screen.getByText('저장하지 않은 칸이 있어요')).toBeTruthy()
    expect(onBack).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '저장하지 않고 나가기' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 시험 "보조자 만들기"를 지우고, 그 칸이 없는지 본다
  it('보조자 칸이 없고 보조자 목록을 부르지 않는다', async () => {
    const { w } = world()
    render(w.wrap(<ShopSettingsScreen onBack={() => undefined} />))
    expect(await screen.findByLabelText('가게 이름')).toBeTruthy()
    expect(screen.queryByText('보조자')).toBeNull()
    expect(screen.queryByLabelText('보조자 이름')).toBeNull()
    expect(w.server.calls.filter((call) => call.path.startsWith('/api/assistants'))).toEqual([])
  })
})
