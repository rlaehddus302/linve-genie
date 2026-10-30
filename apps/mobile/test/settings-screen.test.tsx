// 설정 화면(공통 디자인 바탕 본보기): 큰 질문 제목 · 켜고 끄기 + 되돌리기 · 로그아웃은 확인 판을 거친다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SettingsScreen } from '../src/screens/SettingsScreen.tsx'
import { SessionProvider } from '../src/services.tsx'
import { makeWorld } from './screen-support.tsx'

function setup() {
  const world = makeWorld()
  let enabled = true
  world.server.on('GET', /^\/api\/me$/, () => ({ body: { loginId: 'seller1', seller: { id: 's1', name: '김다육' } } }))
  world.server.on('GET', /^\/api\/settings\/labels$/, () => ({ body: { enabled, history: [], waiting: 0, rev: 1 } }))
  world.server.on('PUT', /^\/api\/settings\/labels$/, (call) => {
    enabled = call.body?.enabled === true
    return { body: { enabled, history: [], waiting: 0, rev: 2, changed: true } }
  })
  world.server.on('GET', /^\/api\/settings$/, () => ({ body: { settings: {} } }))
  let backed = 0
  const view = render(world.wrap(<SessionProvider services={world.services}><SettingsScreen onBack={() => (backed += 1)} /></SessionProvider>))
  return { world, backed: () => backed, view }
}

describe('SettingsScreen', () => {
  it('질문형 제목과 맨 아래 큰 버튼이 있다', async () => {
    const { backed } = setup()
    expect(await screen.findByRole('heading', { name: '무엇을 바꿀까요?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '방송 목록으로' }))
    expect(backed()).toBe(1)
  })

  it('라벨 기능을 끄면 알림이 뜨고 되돌리기로 다시 켠다', async () => {
    const { world } = setup()
    fireEvent.click(await screen.findByRole('switch', { name: '라벨 기능 — 켜짐' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('라벨 기능을 껐어요.'))
    expect(world.server.callsTo('PUT', /labels/)[0]?.body).toEqual({ enabled: false })
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: '라벨 기능 — 켜짐' })).toBeTruthy())
    expect(world.server.callsTo('PUT', /labels/)[1]?.body).toEqual({ enabled: true })
  })

  it('로그아웃은 확인 판을 거치고, 아니요를 누르면 그대로다', async () => {
    const { world } = setup()
    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }))
    expect(screen.getByRole('dialog', { name: '로그아웃할까요?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '아니요, 그대로 둘게요' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(world.server.callsTo('POST', /logout/)).toHaveLength(0)
  })

  it('개발용 견본 줄은 열 방법을 받았을 때만 보인다', async () => {
    setup()
    await screen.findByRole('heading', { name: '무엇을 바꿀까요?' })
    expect(screen.queryByText('디자인 견본 (개발용)')).toBeNull()
  })
})
