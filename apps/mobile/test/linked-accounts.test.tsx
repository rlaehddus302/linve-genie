// 설정 → 연동된 소셜 계정 (D-UX3-61): 연결된 간편 로그인마다 가린 이메일·로고·이름과 [해지], 해지는 가운데 팝업을 거친다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LinkedAccountsScreen } from '../src/screens/LinkedAccountsScreen.tsx'
import { SettingsScreen } from '../src/screens/SettingsScreen.tsx'
import { SessionProvider } from '../src/services.tsx'
import { makeWorld } from './screen-support.tsx'

const item = (provider: string, linked: boolean, label = '') => ({ provider, enabled: true, linked, label, linkedAt: linked ? '2026-11-01T00:00:00.000Z' : null })

function setup(start: { provider: string; linked: boolean; label?: string }[], unlinkReply?: { status: number; body: unknown }) {
  const world = makeWorld()
  let providers = start.map((row) => item(row.provider, row.linked, row.label))
  const unlinks: unknown[] = []
  world.server.on('GET', /^\/api\/auth\/methods$/, () => ({ body: { loginId: '', providers, phone: '010-****-5678' } }))
  world.server.on('POST', /^\/api\/auth\/unlink$/, (call) => {
    unlinks.push(call.body)
    if (unlinkReply !== undefined) return unlinkReply
    providers = providers.map((row) => (row.provider === call.body?.provider ? { ...row, linked: false, label: '', linkedAt: null } : row))
    return { body: { loginId: '', providers, phone: '010-****-5678' } }
  })
  return { world, unlinks }
}

describe('LinkedAccountsScreen', () => {
  it('연결된 계정만 가린 이메일(없으면 "카카오 계정")·이름과 [해지]로 보인다', async () => {
    const { world } = setup([
      { provider: 'kakao', linked: true },
      { provider: 'naver', linked: false },
      { provider: 'google', linked: true, label: 'yu***@gmail.com' },
    ])
    render(world.wrap(<LinkedAccountsScreen onBack={() => {}} />))
    expect(await screen.findByRole('heading', { name: '연동된 소셜 계정' })).toBeTruthy()
    const list = await screen.findByTestId('linked-accounts')
    expect(list.textContent).toContain('카카오 계정')
    expect(list.textContent).toContain('yu***@gmail.com')
    expect(list.textContent).toContain('구글')
    expect(list.textContent).not.toContain('네이버')
    expect(within(list).getAllByRole('button', { name: '해지' })).toHaveLength(2)
  })

  it('[해지] → 팝업 "구글 연결을 해지할까요?" 왼쪽 [닫기]·오른쪽 [해지] → 해지하면 알림과 새 목록', async () => {
    const { world, unlinks } = setup([
      { provider: 'kakao', linked: true },
      { provider: 'google', linked: true, label: 'yu***@gmail.com' },
    ])
    render(world.wrap(<LinkedAccountsScreen onBack={() => {}} />))
    fireEvent.click(await screen.findByTestId('unlink-google'))
    const ask = await screen.findByRole('alertdialog')
    expect(ask.textContent).toContain('구글 연결을 해지할까요?')
    const buttons = within(ask).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['닫기', '해지'])
    fireEvent.click(within(ask).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(unlinks).toEqual([])
    fireEvent.click(screen.getByTestId('unlink-google'))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '해지' }))
    await waitFor(() => expect(unlinks).toEqual([{ provider: 'google' }]))
    expect(await screen.findByText('구글 연결을 해지했어요.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('yu***@gmail.com')).toBeNull())
    expect(screen.getByTestId('linked-accounts').textContent).toContain('카카오 계정')
  })

  it('마지막 로그인 방법이면 서버 문장을 알리고 목록은 그대로', async () => {
    const { world } = setup([{ provider: 'kakao', linked: true }], { status: 409, body: { error: { code: 'LOGIN_METHOD_LAST', message: '마지막 로그인 방법은 끊을 수 없어요.' } } })
    render(world.wrap(<LinkedAccountsScreen onBack={() => {}} />))
    fireEvent.click(await screen.findByTestId('unlink-kakao'))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '해지' }))
    expect(await screen.findByText('마지막 로그인 방법은 끊을 수 없어요.')).toBeTruthy()
    expect(screen.getByTestId('linked-kakao')).toBeTruthy()
  })
})

describe('SettingsScreen — 연동된 소셜 계정 줄 (D-UX3-61)', () => {
  it('계정 칸에 "연동된 소셜 계정"과 연결된 로고, 누르면 그 화면으로', async () => {
    const { world } = setup([
      { provider: 'kakao', linked: true },
      { provider: 'naver', linked: true },
      { provider: 'google', linked: false },
    ])
    world.server.on('GET', /^\/api\/me$/, () => ({ body: { loginId: 'seller1', seller: { id: 's1', name: '김다육' } } }))
    world.server.on('GET', /^\/api\/settings\/labels$/, () => ({ body: { enabled: true, history: [], waiting: 0, rev: 1 } }))
    world.server.on('GET', /^\/api\/settings$/, () => ({ body: { settings: {} } }))
    let opened = 0
    render(world.wrap(<SessionProvider services={world.services}><SettingsScreen onBack={() => {}} onOpenLinked={() => (opened += 1)} showPhoneNotice={false} /></SessionProvider>))
    const row = await screen.findByRole('button', { name: '연동된 소셜 계정 — 카카오, 네이버' })
    fireEvent.click(row)
    expect(opened).toBe(1)
  })
})
