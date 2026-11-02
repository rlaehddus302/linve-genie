// 앱 가게 설정 (D-APPX-03 — 웹 SettingsPage와 같은 칸·저장 규칙): 바꾼 칸만 아래 "저장" 하나로(가게 PUT · 판매 규칙 PATCH 바뀐 키만),
// 저장 문장은 저장 막대와 같은 글, 서버 칸 문장은 그 칸 아래, 저장하지 않고 나가면 묻는다, 보조자 비밀번호는 한 번만 보인다.
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
  w.server.on('GET', /^\/api\/assistants$/, () => ({ body: { assistants: [], limit: 5 } }))
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
  w.server.on('POST', /^\/api\/assistants$/, (call) => {
    writes.push({ method: 'POST', path: call.path, body: call.body })
    return { body: { assistant: { id: 'a1', name: String(call.body?.['name']), loginId: 'helper01', createdAt: '2026-11-02T01:00:00.000Z' }, password: 'one-time-secret' } }
  })
  return { w, writes }
}

describe('ShopSettingsScreen (앱 가게 설정)', () => {
  it('바꾼 칸만 저장 하나로: 가게 PUT, 판매 규칙은 바뀐 키만 PATCH, 저장 문장', async () => {
    const { w, writes } = world()
    render(w.wrap(<ShopSettingsScreen onBack={() => undefined} />))
    fireEvent.change(await screen.findByLabelText('가게 이름'), { target: { value: '다육한 집' } })
    fireEvent.click(await screen.findByRole('button', { name: /가격 단위 만원/ }))
    expect(screen.getByText(/저장하면 다음 방송부터 '15'는 150,000원으로 들어가요/)).toBeTruthy()
    expect(screen.getByText('저장하지 않은 칸: 가게 · 판매 규칙')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[0]).toMatchObject({ method: 'PUT', body: { name: '다육한 집' } })
    expect(writes[1]).toMatchObject({ method: 'PATCH', body: { settings: { 'price.unit': 'TEN_THOUSAND' } } })
    expect(Object.keys((writes[1]!.body?.['settings'] ?? {}) as object)).toEqual(['price.unit'])
    expect(await screen.findByText(/^저장했어요\./)).toBeTruthy()
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

  it('보조자 만들기: 서버가 만든 아이디·비밀번호를 한 번만 보이고 닫으면 지운다', async () => {
    const { w, writes } = world()
    render(w.wrap(<ShopSettingsScreen onBack={() => undefined} />))
    fireEvent.change(await screen.findByLabelText('보조자 이름'), { target: { value: '언니' } })
    fireEvent.click(screen.getByRole('button', { name: '보조자 만들기' }))
    await waitFor(() => expect(writes.some((write) => write.path === '/api/assistants')).toBe(true))
    expect(await screen.findByText('one-time-secret')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다 적었어요' }))
    await waitFor(() => expect(screen.queryByText('one-time-secret')).toBeNull())
    expect(screen.getByText('언니')).toBeTruthy()
  })
})
