// MOB2 수정 라운드 4 — 저절로 다시 보낼 실패 문장(D-MOB2-18, SA-MOB2-07)·합치기 미리 보기의 보류 낱말(D-MOB2-15, RA-MOB2-07)
import { previewMerge } from '@livejjim/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import { ConsoleContext, type ConsoleApi } from '../src/components/console-context.ts'
import { WriteError, autoResendFailWords } from '../src/components/forms.tsx'
import { ProductDetail } from '../src/components/ProductDetail.tsx'
import { SmsPage } from '../src/components/SmsPage.tsx'
import { mergeWords } from '../src/lib/buyers.ts'
import { BuyerNames, PENDING_TIMED_OUT_WORD } from '../src/lib/derive.ts'
import { AUTO_RESEND_NOTE, ResendBoard } from '../src/lib/resend-board.ts'
import { fromFull, type ScopeData } from '../src/lib/scope-data.ts'
import { chat, dataOf, register, run, sms, viewOf } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, flush } from './support.ts'

const OLD_NETWORK = '저장하지 못했어요. 인터넷 연결을 확인하고 "다시 보내기"를 눌러 주세요.'
const OLD_SAVE = '저장하지 못했어요. "다시 보내기"를 눌러 주세요.'
const networkError = () => new ApiError({ status: 0, code: 'NETWORK', message: '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.', network: true })
const saveFailed = () => new ApiError({ status: 500, code: 'SAVE_FAILED', message: '저장하지 못했어요. 다시 시도해 주세요.' })

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('WriteError의 저절로 다시 보낼 실패 문장 (D-MOB2-18)', () => {
  it('autoResend: 네트워크면 "…인터넷 연결을 확인해 주세요.", 그 밖은 "저장하지 못했어요." — "눌러 주세요" 없음, "다시 보내기" 단추·"자세히"는 그대로', () => {
    expect(autoResendFailWords(networkError())).toBe('저장하지 못했어요. 인터넷 연결을 확인해 주세요.')
    expect(autoResendFailWords(saveFailed())).toBe('저장하지 못했어요.')
    const onRetry = vi.fn()
    const first = render(<WriteError error={networkError()} onRetry={onRetry} autoResend />)
    const alert = screen.getByRole('alert')
    expect(alert.querySelector('p')?.textContent).toBe('저장하지 못했어요. 인터넷 연결을 확인해 주세요.')
    expect(alert.textContent).not.toContain('눌러 주세요')
    fireEvent.click(within(alert).getByRole('button', { name: '다시 보내기' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(within(alert).getByText('자세히')).toBeDefined()
    first.unmount()
    render(<WriteError error={saveFailed()} onRetry={() => {}} autoResend />)
    expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe('저장하지 못했어요.')
    expect(screen.getByRole('alert').textContent).not.toContain('눌러 주세요')
  })

  it('autoResend가 없으면(다른 화면·저절로 보내지 않음) 지금 문장 그대로', () => {
    const first = render(<WriteError error={networkError()} onRetry={() => {}} />)
    expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(OLD_NETWORK)
    first.unmount()
    render(<WriteError error={saveFailed()} onRetry={() => {}} />)
    expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(OLD_SAVE)
  })
})

function apiOf(data: ScopeData): ConsoleApi {
  return {
    b: 'b1',
    date: DATE,
    rehearsal: false,
    ended: false,
    sealed: false,
    data,
    names: new BuyerNames(data.buyers, data.claims),
    waiting: { claims: new Set(), products: new Set() },
    delayMs: 5000,
    settingsOf: (id) => data.broadcasts.get(id)?.settings ?? null,
    openDialog: () => {},
    closeTop: () => {},
    closeAll: () => {},
    queueHost: () => {},
    command: () => Promise.reject(new Error('보내지 않는다')),
    write: () => Promise.reject(new Error('보내지 않는다')),
    fillQuick: () => {},
    select: () => {},
  }
}

describe('상품 관리: 저절로 다시 보낼 실패면 "눌러 주세요·다시 시도해 주세요"를 뺀 문장 (D-MOB2-18)', () => {
  const show = (error: () => ApiError, board: ResendBoard | undefined) => {
    const data = dataOf([register(15, '핑크프릴', 10000)])
    const api: ConsoleApi = { ...apiOf(data), ...(board === undefined ? {} : { resend: board }), latest: () => data, command: () => Promise.reject(error()) }
    render(
      <ConsoleContext.Provider value={api}>
        <ProductDetail productKey="b1/15" onClose={() => {}} onEdit={() => {}} />
      </ConsoleContext.Provider>,
    )
    return within(screen.getByRole('region', { name: '상품 관리' }))
  }

  it('네트워크 실패 + 저절로 보낼 목록: "저장하지 못했어요. 인터넷 연결을 확인해 주세요."와 안내, "다시 보내기" 단추 있음', async () => {
    const region = show(networkError, new ResendBoard())
    fireEvent.click(region.getByRole('button', { name: '일시 중지' }))
    await act(flush)
    const alert = region.getByRole('alert')
    expect(alert.querySelector('p')?.textContent).toBe('저장하지 못했어요. 인터넷 연결을 확인해 주세요.')
    expect(region.getByText(AUTO_RESEND_NOTE)).toBeDefined()
    expect(within(alert).getByRole('button', { name: '다시 보내기' })).toBeDefined()
    expect(alert.textContent).not.toContain('눌러 주세요')
  })

  it('SAVE_FAILED + 저절로 보낼 목록: "저장하지 못했어요." — 서버의 "다시 시도해 주세요"도 보이지 않는다', async () => {
    const region = show(saveFailed, new ResendBoard())
    fireEvent.click(region.getByRole('button', { name: '일시 중지' }))
    await act(flush)
    const alert = region.getByRole('alert')
    expect(alert.querySelector('p')?.textContent).toBe('저장하지 못했어요.')
    expect(alert.textContent).not.toContain('다시 시도해 주세요')
    expect(within(alert).getByRole('button', { name: '다시 보내기' })).toBeDefined()
  })

  it('저절로 보낼 목록이 없으면(안내 없음) 서버 문장 그대로', async () => {
    const region = show(saveFailed, undefined)
    fireEvent.click(region.getByRole('button', { name: '일시 중지' }))
    await act(flush)
    expect(region.getByRole('alert').querySelector('p')?.textContent).toBe('저장하지 못했어요. 다시 시도해 주세요.')
    expect(region.queryByText(AUTO_RESEND_NOTE)).toBeNull()
  })
})

describe('문자찜: 저절로 다시 보낼 실패 문장과 칸을 바꾼 뒤 (D-MOB2-18, AC-MOB2-40·43)', () => {
  let engine: EngineServer

  it('끊김 실패: "…인터넷 연결을 확인해 주세요."와 안내만, "눌러 주세요" 없음 — 칸을 바꾸면 옛 문장으로 돌아가고 안내는 내려간다', async () => {
    engine = new EngineServer([register(15, '핑크프릴', 10000, 'b2')])
    vi.stubGlobal('fetch', engine.server.fetch)
    render(<SmsPage navigate={() => {}} />)
    await flush(10)
    fireEvent.change(screen.getByLabelText('번호'), { target: { value: '15' } })
    engine.down = true
    fireEvent.submit((screen.getByLabelText('번호') as HTMLInputElement).form as HTMLFormElement)
    const alert = await screen.findByRole('alert', {}, { timeout: 6000 })
    await waitFor(() => expect(alert.querySelector('p')?.textContent).toBe('저장하지 못했어요. 인터넷 연결을 확인해 주세요.'), { timeout: 6000 })
    expect(screen.getByText(AUTO_RESEND_NOTE)).toBeDefined()
    expect(within(alert).getByRole('button', { name: '다시 보내기' })).toBeDefined()
    expect(document.body.textContent).not.toContain('눌러 주세요')
    // 판매자가 메모 칸을 바꿈 → 저절로 보내지 않는다(AC-MOB2-43) — 옛 문장·"다시 보내기" 그대로, 저절로 보낸다는 안내는 없다
    fireEvent.change(screen.getByLabelText(/메모/), { target: { value: '김씨' } })
    await waitFor(() => expect(screen.getByRole('alert').querySelector('p')?.textContent).toBe(OLD_NETWORK))
    expect(screen.queryByText(AUTO_RESEND_NOTE)).toBeNull()
    expect(within(screen.getByRole('alert')).getByRole('button', { name: '다시 보내기' })).toBeDefined()
  }, 15_000)
})

describe('합치기 미리 보기의 중복 찜 낱말은 지금 시각으로 (D-MOB2-15, RA-MOB2-07)', () => {
  it('시간이 지난 보류 찜은 다른 화면처럼 "보류 · 시간 지남", 시간 전이면 "보류"', () => {
    const events = [register(15, '핑크프릴', 10000), sms('r3', 20, { phoneKey: 'k'.repeat(64), phoneLast4: '1111' }), chat('m5', 'UC_kim5555', '김철수', '20')]
    const { state, seq } = run(events)
    const data = fromFull(viewOf(state, seq))
    const names = new BuyerNames(data.buyers, data.claims)
    const preview = previewMerge(state, 'sms:r3', 'UC_kim5555')
    expect(preview.duplicates.length).toBe(1)
    const claim = data.claims.get(preview.duplicates[0]?.claim ?? '')
    if (claim === undefined) throw new Error('중복 찜')
    expect(claim.status).toBe('PENDING')
    const at = Date.parse(claim.at)
    const label = (_b: string, no: number) => `${String(no)}번`
    expect(mergeWords(data, names, preview, label, at).duplicates.map((line) => line.text)).toEqual([`20번: ${names.name(claim.buyer)}의 보류 찜이 중복으로 정리돼요`])
    expect(mergeWords(data, names, preview, label, at + 30_001).duplicates.map((line) => line.text)).toEqual([`20번: ${names.name(claim.buyer)}의 ${PENDING_TIMED_OUT_WORD} 찜이 중복으로 정리돼요`])
  })
})
