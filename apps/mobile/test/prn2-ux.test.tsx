// PRN2 사용성 검토 고침 — 휴대폰 앱 라벨 화면 (harness/sprints/PRN2/ux/review.md UX-PRN2-001·005·006·007·008, 웹과 같은 기준):
// - 001 테스트 인쇄 "아니요" 뒤 이은 프린터에 맞는 도움말(웹과 같은 목록), 실험 기종이면 제조사 앱으로 보내는 길
// - 005 실험 기종 "예" 기다림 멈춤 줄 아래 "테스트 인쇄"
// - 006 "예" 뒤 다른 까닭으로 다시 멈추면 "이어서 해요" 대신 지난 일
// - 007 두 보내기 단추의 보이는 글이 무엇을·어디로, 테스트 라벨 단추는 쓸 때만
// - 008 "실험" 꼬리표 18px, 실험 기다림 안내·작업 보내기 안내는 본문(18px)
import { BAUATO_PPA2L, B1_PROFILE, MARKLIFE_P12 } from '@livejjim/printer'
import { testHelp } from '@livejjim/web/src/lib/test-help.ts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LabelsScreen, fallbackAppName, jobShareLabel, testShareLabel } from '../src/screens/LabelsScreen.tsx'
import { Tag } from '../src/ui/parts.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

const printerCard = (): HTMLElement => screen.getByRole('group', { name: '프린터' })

/** 프린터 칸의 "테스트 인쇄"를 누를 수 있을 때 누른다 (연결 조작이 끝나기 전에는 잠겨 있다) */
async function pressTestPrint(): Promise<void> {
  await waitFor(() => expect(within(printerCard()).getByRole('button', { name: '테스트 인쇄' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(within(printerCard()).getByRole('button', { name: '테스트 인쇄' }))
}

async function connected(profile: typeof B1_PROFILE | typeof BAUATO_PPA2L | typeof MARKLIFE_P12) {
  const world = makeWorld()
  world.ble.profile = profile
  world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
  world.server.on('GET', /^\/api\/print\/test-bitmap\?size=[a-z0-9]+$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
  world.services.labels.start()
  render(world.wrap(<LabelsScreen onBack={() => {}} />))
  await waitFor(() => expect(screen.getByText('출력 기기 없음')).toBeTruthy())
  await flush()
  return world
}

describe('UX-PRN2-007 보내기 단추 글', () => {
  it('무엇을·어디로 — 앱 이름은 이은 프린터의 대체 경로 앱, 모르면 "제조사 앱"', () => {
    expect(fallbackAppName('BAUATO_PPA2L')).toBe('Luck Jingle 앱')
    expect(fallbackAppName('MARKLIFE_P50')).toBe('Marklife 앱')
    expect(fallbackAppName(null)).toBe('제조사 앱')
    expect(testShareLabel('Marklife 앱')).toBe('테스트 라벨을 Marklife 앱으로 보내기')
    expect(jobShareLabel({ kind: 'product', label: { no: 3 } }, 'NIIMBOT 앱')).toBe('이 라벨(3번)을 NIIMBOT 앱으로 보내기')
    expect(jobShareLabel({ kind: 'packing', label: { no: null } }, '제조사 앱')).toBe('이 라벨을 제조사 앱으로 보내기')
  })
})

describe('UX-PRN2-001 "아니요" 뒤 도움말 (웹과 같은 목록)', () => {
  it('바우아토: 맨 위에 Luck Jingle 앱으로 그림 파일, NIIMBOT 줄 없음 — 보내기 단추는 그 앱 이름', async () => {
    const world = await connected(BAUATO_PPA2L)
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    await waitFor(() => expect(screen.getByText('연결됨')).toBeTruthy())
    await pressTestPrint()
    const result = await screen.findByRole('group', { name: '테스트 인쇄 결과' })
    expect(screen.queryByRole('list', { name: '테스트 인쇄 도움말' })).toBeNull()
    fireEvent.click(within(result).getByRole('button', { name: '아니요' }))
    const help = await screen.findByRole('list', { name: '테스트 인쇄 도움말' })
    expect(within(help).getAllByRole('listitem').map((item) => item.textContent)).toEqual([...testHelp('BAUATO_PPA2L', '50x30').lines])
    expect(help.textContent).toContain('Luck Jingle 앱에서 인쇄해 주세요.')
    expect(help.textContent).not.toContain('NIIMBOT')
    expect(screen.getByRole('button', { name: '테스트 라벨을 Luck Jingle 앱으로 보내기' })).toBeTruthy()
    // 테스트를 다시 하면 도움말은 지난 일
    await pressTestPrint()
    await waitFor(() => expect(screen.queryByRole('list', { name: '테스트 인쇄 도움말' })).toBeNull())
    world.services.labels.stop()
  })

  it('B1(확인됨): 잘 찍는 동안 테스트 라벨 보내기가 없고, "아니요" 뒤에 B1 도움말과 함께 보인다', async () => {
    const world = await connected(B1_PROFILE)
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    await waitFor(() => expect(screen.getByText('연결됨')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^테스트 라벨을/ })).toBeNull()
    await pressTestPrint()
    const result = await screen.findByRole('group', { name: '테스트 인쇄 결과' })
    fireEvent.click(within(result).getByRole('button', { name: '아니요' }))
    const help = await screen.findByRole('list', { name: '테스트 인쇄 도움말' })
    expect(within(help).getAllByRole('listitem').map((item) => item.textContent)).toEqual([...testHelp('NIIMBOT_B1', '50x30').lines])
    expect(screen.getByRole('button', { name: '테스트 라벨을 NIIMBOT 앱으로 보내기' })).toBeTruthy()
    world.services.labels.stop()
  })
})

describe('UX-PRN2-005·006 출력 기기의 실험 기종', () => {
  function asDevice(world: ReturnType<typeof makeWorld>, state: { connected: boolean; labelError: boolean }) {
    world.server.on('GET', /^\/api\/print$/, () => ({
      body: {
        queue: {
          rev: 1,
          device: { id: 'app-test', name: '내 휴대폰', live: true, printerConnected: state.connected, releasing: false },
          pause: state.labelError
            ? { reason: 'LABEL_ERROR', message: '라벨을 만들지 못해 멈췄어요. 라벨 설정을 확인한 뒤 다시 시작해 주세요.', backlog: false }
            : state.connected
              ? null
              : { reason: 'DISCONNECTED', message: '프린터 연결이 끊겨 출력을 멈췄어요.', backlog: false },
          waiting: 0,
          printing: 0,
          discard: 0,
          labelsEnabled: true,
        },
        jobs: [],
        discard: [],
      },
    }))
    world.server.on('POST', /^\/api\/print\/device\/state$/, (call) => {
      state.connected = call.body?.['connected'] === true
      return { body: {} }
    })
    world.server.on('GET', /^\/api\/print\/test-bitmap\?size=[a-z0-9]+$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
  }

  it('"예" 기다림 멈춤 줄 아래 "테스트 인쇄"(주 단추)가 바로 테스트 인쇄 — "다시 시작"은 보통 단추', async () => {
    const world = makeWorld()
    world.ble.profile = MARKLIFE_P12
    const state = { connected: true, labelError: false }
    asDevice(world, state)
    world.services.labels.start()
    render(world.wrap(<LabelsScreen onBack={() => {}} />))
    await waitFor(() => expect(screen.getByText('이 기기가 출력 기기예요 · 내 휴대폰')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    await waitFor(() => expect(screen.getByText('연결됨')).toBeTruthy())
    await world.services.labels.reload()
    const queueCard = screen.getByRole('group', { name: '대기열' })
    await waitFor(() => expect(within(queueCard).getByText(/실험 중인 프린터라 출력을 잠시 멈췄어요/)).toBeTruthy())
    fireEvent.click(within(queueCard).getByRole('button', { name: '테스트 인쇄' }))
    await screen.findByRole('group', { name: '테스트 인쇄 결과' })
    expect(world.server.callsTo('GET', /test-bitmap/)).toHaveLength(1)
    world.services.labels.stop()
  })

  it('"예" 뒤 라벨 오류로 다시 멈추면 "테스트 인쇄가 잘 나온 것을 확인했어요."', async () => {
    const world = makeWorld()
    world.ble.profile = MARKLIFE_P12
    const state = { connected: true, labelError: false }
    asDevice(world, state)
    world.services.labels.start()
    render(world.wrap(<LabelsScreen onBack={() => {}} />))
    await waitFor(() => expect(screen.getByText('이 기기가 출력 기기예요 · 내 휴대폰')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    await waitFor(() => expect(screen.getByText('연결됨')).toBeTruthy())
    await pressTestPrint()
    fireEvent.click(within(await screen.findByRole('group', { name: '테스트 인쇄 결과' })).getByRole('button', { name: '예' }))
    await world.services.labels.reload()
    await waitFor(() => expect(screen.getByText('좋아요. 멈췄던 출력을 이어서 해요.')).toBeTruthy())
    state.labelError = true
    await world.services.labels.reload()
    await waitFor(() => expect(screen.getByText('테스트 인쇄가 잘 나온 것을 확인했어요.')).toBeTruthy())
    expect(screen.queryByText('좋아요. 멈췄던 출력을 이어서 해요.')).toBeNull()
    world.services.labels.stop()
  })
})

describe('UX-PRN2-008 글자 18px', () => {
  it('"실험" 꼬리표(big)는 18px, 기본 꼬리표는 16px 그대로', () => {
    render(
      <>
        <Tag tone="warning" big>
          실험
        </Tag>
        <Tag tone="info">보통</Tag>
      </>,
    )
    expect(getComputedStyle(screen.getByText('실험')).fontSize).toBe('18px')
    expect(getComputedStyle(screen.getByText('보통')).fontSize).toBe('16px')
  })

  it('실험 기다림 안내는 본문 크기(18px)', async () => {
    const world = await connected(BAUATO_PPA2L)
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    await waitFor(() => expect(screen.getByText('연결됨')).toBeTruthy())
    expect(getComputedStyle(screen.getByText('실험 중인 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 이 기기에서 출력할 수 있어요.')).fontSize).toBe('18px')
    world.services.labels.stop()
  })
})
