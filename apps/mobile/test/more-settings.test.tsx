// 전체 탭에 설정을 바로 보인다 (D-UX4-201, 사용자 지시 2026-11-16 "설정에 있는 걸 밖으로 빼서 전체 탭에 다 보여줘, 연관된 섹션끼리 묶고, 라벨 디자인 수정도 라벨 섹션에")
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MoreScreen, type MoreSettings } from '../src/screens/MoreScreen.tsx'
import { PHONE_NOTICE_TITLE } from '../src/screens/PhoneNoticeCard.tsx'
import { VARIETIES_TITLE } from '../src/screens/VarietiesScreen.tsx'
import { SessionProvider } from '../src/services.tsx'
import { makeWorld } from './screen-support.tsx'

function setup(extra: Partial<MoreSettings> = {}) {
  const world = makeWorld()
  let enabled = true
  world.server.on('GET', /^\/api\/me$/, () => ({ body: { loginId: 'seller1', seller: { id: 's1', name: '김다육' } } }))
  world.server.on('GET', /^\/api\/settings\/labels$/, () => ({ body: { enabled, history: [], waiting: 0, rev: 1 } }))
  world.server.on('PUT', /^\/api\/settings\/labels$/, (call) => {
    enabled = call.body?.enabled === true
    return { body: { enabled, history: [], waiting: 0, rev: 2, changed: true } }
  })
  world.server.on('GET', /^\/api\/settings$/, () => ({ body: { settings: {} } }))
  world.server.on('GET', /^\/api\/auth\/methods$/, () => ({ body: { loginId: 'seller1', providers: [{ provider: 'kakao', linked: true }], phone: null } }))
  const openApp = vi.fn()
  const settings: MoreSettings = { openVarieties: vi.fn(), openLinked: vi.fn(), policyUrl: 'http://test.local/privacy', showPhoneNotice: false, ...extra }
  render(world.wrap(<SessionProvider services={world.services}><MoreScreen nav={{ openApp }} settings={settings} account="김다육 · seller1" onLogout={() => {}} /></SessionProvider>))
  return { world, openApp, settings }
}

describe('전체 탭 — 설정을 바로 보인다 (D-UX4-201)', () => {
  it('설정 단추 없이 묶음 차례대로: 라이브 · 음성 인식 · 주문·입금 · 배송 · 라벨 · 가게 · 계정', async () => {
    setup()
    expect(screen.queryByRole('button', { name: '설정' })).toBeNull()
    const names = screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))
    expect(names).toEqual(['라이브', '음성 인식', '주문·입금', '배송', '라벨', '가게', '계정'])
  })

  it('음성 인식 묶음에 바로 등록 스위치와 품종 장부', async () => {
    const { settings } = setup()
    const voice = screen.getByRole('group', { name: '음성 인식' })
    expect(within(voice).getByRole('switch')).toBeTruthy()
    fireEvent.click(within(voice).getByRole('button', { name: VARIETIES_TITLE }))
    expect(settings.openVarieties).toHaveBeenCalled()
  })

  it('라벨 묶음에 라벨 프린터 · 라벨 디자인 · 라벨 기능 · 자동 출력이 함께 있고, 라벨 기능을 끄면 알림과 되돌리기', async () => {
    const { world, openApp } = setup()
    const label = screen.getByRole('group', { name: '라벨' })
    fireEvent.click(within(label).getByRole('button', { name: '라벨 디자인' }))
    expect(openApp).toHaveBeenCalledWith('/label-setup?step=design')
    expect(within(label).getByRole('button', { name: '라벨 프린터' })).toBeTruthy()
    await waitFor(() => expect(within(label).getByRole('switch', { name: /1등 확정 때 라벨 자동 출력/ })).toBeTruthy())
    fireEvent.click(await within(label).findByRole('switch', { name: '라벨 기능 — 켜짐' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('라벨 기능을 껐어요.'))
    expect(world.server.callsTo('PUT', /labels/)[0]?.body).toEqual({ enabled: false })
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(within(label).getByRole('switch', { name: '라벨 기능 — 켜짐' })).toBeTruthy())
  })

  it('계정 묶음에 연동된 계정 · 앱이 쓰는 권한 · 개인정보처리방침 · 로그아웃', async () => {
    const { settings } = setup()
    const account = screen.getByRole('group', { name: '계정' })
    fireEvent.click(await within(account).findByTestId('settings-linked'))
    expect(settings.openLinked).toHaveBeenCalled()
    expect(within(account).getByRole('button', { name: '앱이 쓰는 권한 열기' })).toBeTruthy()
    expect(within(account).getByRole('button', { name: '개인정보처리방침' })).toBeTruthy()
    expect(within(account).getByRole('button', { name: '로그아웃' })).toBeTruthy()
  })

  it('휴대폰 알림 받기는 알림 받기를 넣은 빌드에서만 보인다', async () => {
    setup({ showPhoneNotice: true })
    expect(await screen.findByText(PHONE_NOTICE_TITLE)).toBeTruthy()
  })
})
