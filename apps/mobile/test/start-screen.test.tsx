// 앱 시작 안내 (D-APPX-03 — 웹 WizardPage와 같은 단계·문구): 홈 줄은 실제 방송이 없고 처음·진행 중일 때만,
// 1단계는 바꾼 이름만 저장하고 다음으로, 단계를 옮기면 서버에 적는다, 라벨이 꺼져 있으면 프린터를 건너뛴다, 나중에 할게요는 닫음으로.
// 앱은 리허설 단계를 뺐다 (D-UX3-86): 웹 단계 중 앞 네 개만, 마지막 단계에서 "마치기".
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { STEP_TITLES as WEB_STEPS } from '@livejjim/web/src/components/WizardPage.tsx'
import { STEP_TITLES, StartScreen, showsStart } from '../src/screens/StartScreen.tsx'
import { makeWorld } from './screen-support.tsx'

function world(labels: boolean) {
  const w = makeWorld()
  const writes: { path: string; body: Record<string, unknown> | null }[] = []
  w.server.on('GET', /^\/api\/wizard$/, () => ({ body: { wizard: { status: 'NEW', step: null } } }))
  w.server.on('GET', /^\/api\/settings\/labels$/, () => ({ body: { enabled: labels } }))
  w.server.on('GET', /^\/api\/shop$/, () => ({ body: { shop: { name: '초록가게', bank: '', accountNumber: '', accountHolder: '', accountNote: '' } } }))
  w.server.on('PUT', /^\/api\/(wizard|shop)$/, (call) => {
    writes.push({ path: call.path, body: call.body })
    return { body: {} }
  })
  return { w, writes }
}

const nav = () => ({ onClose: vi.fn(), openShopSettings: vi.fn(), openLabels: vi.fn() })

describe('StartScreen (앱 시작 안내)', () => {
  it('단계 이름은 웹 앞 네 단계와 같고(리허설 없음, D-UX3-86), 홈 줄은 실제 방송이 없고 처음·진행 중일 때만', () => {
    expect(STEP_TITLES).toEqual(WEB_STEPS.slice(0, 4))
    expect(STEP_TITLES).not.toContain('리허설 해 보기')
    expect(showsStart({ status: 'NEW', step: null }, false)).toBe(true)
    expect(showsStart({ status: 'IN_PROGRESS', step: 2 }, false)).toBe(true)
    expect(showsStart({ status: 'DONE', step: null }, false)).toBe(false)
    expect(showsStart({ status: 'NEW', step: null }, true)).toBe(false)
    expect(showsStart(null, false)).toBe(false)
  })

  it('바꾼 이름만 저장 → 2단계 기록, 라벨이 꺼져 있으면 3단계가 마지막(D-UX3-86), 나중에 할게요는 닫음', async () => {
    const { w, writes } = world(false)
    const n = nav()
    render(w.wrap(<StartScreen nav={n} />))
    expect(await screen.findByText('1/3 가게 이름')).toBeTruthy()
    fireEvent.change(await screen.findByLabelText('가게 이름'), { target: { value: '다육한 집' } })
    fireEvent.click(screen.getAllByRole('button', { name: '다음' })[0]!)
    expect(await screen.findByText('2/3 판매 규칙 확인')).toBeTruthy()
    expect(writes.slice(0, 2)).toEqual([
      { path: '/api/shop', body: { name: '다육한 집' } },
      { path: '/api/wizard', body: { status: 'IN_PROGRESS', step: 2 } },
    ])
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('3/3 유튜브 연결')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull()
    expect(screen.getByRole('button', { name: '마치기' })).toBeTruthy()
    expect(screen.queryByText(/리허설/)).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '나중에 할게요' }).at(-1)!)
    await waitFor(() => expect(writes.at(-1)).toEqual({ path: '/api/wizard', body: { status: 'DISMISSED' } }))
    expect(n.onClose).toHaveBeenCalled()
  })

  it('라벨이 켜져 있으면 4단계 프린터가 마지막, 마치기는 마침으로 적고 닫는다 (D-UX3-86)', async () => {
    const { w, writes } = world(true)
    w.server.on('GET', /^\/api\/wizard$/, () => ({ body: { wizard: { status: 'IN_PROGRESS', step: 5 } } }))
    const n = nav()
    render(w.wrap(<StartScreen nav={n} />))
    expect(await screen.findByText('4/4 프린터 연결')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '마치기' }))
    await waitFor(() => expect(writes.at(-1)).toEqual({ path: '/api/wizard', body: { status: 'DONE' } }))
    expect(n.onClose).toHaveBeenCalled()
  })
})
