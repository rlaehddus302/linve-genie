// 페이지의 실시간 연결 하나 (lib/stream.ts)와 출력 낱말 (AC-I1-24·31·34·60·61).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { discardWord, historyWord, jobNumberWord, printErrorMessage, printerStatusWord } from '../src/lib/print-words.ts'
import { SharedStream } from '../src/lib/stream.ts'
import { device, job, queue } from './print-support.ts'
import { FakeEventSource, flush } from './support.ts'

beforeEach(() => FakeEventSource.reset())
afterEach(() => vi.unstubAllGlobals())

describe('공유 실시간 연결', () => {
  it('보는 쪽이 여럿이어도 연결은 하나, 늦게 붙은 쪽은 지금까지의 seq로 ready를 한 번 받는다', async () => {
    const shared = new SharedStream({ url: () => '/api/stream?device=dev-0001', create: (url) => new FakeEventSource(url) })
    const first = shared.open()
    const firstReady = vi.fn()
    first.addEventListener('ready', firstReady)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.last.url).toBe('/api/stream?device=dev-0001')
    FakeEventSource.last.emit('ready', { scopes: [{ date: '2026-10-19', rehearsal: false, seq: 5 }] })
    FakeEventSource.last.emit('change', { date: '2026-10-19', rehearsal: false, seq: 7, type: 'chat' })
    expect(firstReady).toHaveBeenCalledTimes(1)
    const second = shared.open()
    const late = vi.fn((event: MessageEvent) => JSON.parse(String(event.data)) as unknown)
    second.addEventListener('ready', late)
    await flush()
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(late.mock.results[0]?.value).toEqual({ scopes: [{ date: '2026-10-19', rehearsal: false, seq: 7 }] })
    const changes = vi.fn()
    second.addEventListener('print', changes)
    FakeEventSource.last.emit('print', { rev: 1 })
    expect(changes).toHaveBeenCalledTimes(1)
    // 마지막 보는 쪽이 닫히면 연결을 닫는다
    first.close()
    expect(FakeEventSource.last.closed).toBe(false)
    second.close()
    expect(FakeEventSource.last.closed).toBe(true)
  })

  it('닫힌 연결(다시 붙지 않음)은 보는 쪽에 닫힘으로 알리고, 다시 붙으면 새로 연다', () => {
    const shared = new SharedStream({ url: () => '/api/stream', create: (url) => new FakeEventSource(url) })
    const view = shared.open()
    const errors = vi.fn()
    view.onerror = errors
    FakeEventSource.last.fail(true)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(view.readyState).toBe(2)
    shared.ensure()
    expect(FakeEventSource.instances).toHaveLength(2)
  })
})

describe('출력 낱말', () => {
  it('프린터 상태 한 줄 (AC-I1-34)', () => {
    expect(printerStatusWord(null)).toBe('출력 기기 없음')
    expect(printerStatusWord(queue())).toBe('출력 기기 없음')
    expect(printerStatusWord(queue({ waiting: 3 }))).toBe('출력 기기 없음 · 대기 3장')
    expect(printerStatusWord(queue({ device: device('d-0000001', { name: '휴대폰' }), waiting: 2 }))).toBe('프린터 휴대폰 · 연결됨 · 대기 2장')
    expect(printerStatusWord(queue({ device: device('d-0000001', { name: '휴대폰', live: false }), waiting: 2 }))).toBe('프린터 휴대폰 · 끊김 · 대기 2장')
    expect(printerStatusWord(queue({ device: device('d-0000001'), waiting: 5, pause: { reason: 'PRINTER_ERROR', message: '프린터 오류로 멈췄어요.', backlog: false } }))).toBe('출력 멈춤 · 대기 5장')
  })

  it('이력·버릴 라벨·번호 (AC-I1-24·31) — 시각은 KST', () => {
    expect(historyWord({ printed: 2, history: [{ at: '2026-10-18T11:01:00.000Z', device: '휴대폰' }, { at: '2026-10-18T11:15:00.000Z', device: 'PC' }] })).toBe('2번 출력 · 20:01 휴대폰 · 20:15 PC')
    expect(discardWord(job('d1', { date: '2026-10-18' }))).toBe('15번 · 우주천사 · 26.10.18 라벨을 버려 주세요')
    expect(discardWord(job('d2', { date: '2026-10-18', label: { ...job('x').label, buyer: { kind: 'sms' } } }))).toBe('15번 · 문자찜 · 26.10.18 라벨을 버려 주세요')
    expect(jobNumberWord(job('p', { kind: 'packing', page: 1, pages: 2, data: null }))).toBe('포장 1/2쪽')
  })

  it('오류 문장 (AC-I1-61): L-7 표·라벨 패키지 문장, 코드는 보이지 않는다', () => {
    expect(printErrorMessage({ code: 'DISCONNECTED', item: null })).toBe('프린터 연결이 끊겼어요.')
    expect(printErrorMessage({ code: 'DOES_NOT_FIT', item: 'price' })).toBe('가격 칸이 좁아 라벨을 만들 수 없어요. 칸을 넓히거나 최소 글자 크기를 줄여 주세요.')
    expect(printErrorMessage({ code: 'INVALID_DATA', item: null })).toBe('라벨에 넣을 수 없는 값이 있어요: 라벨 데이터')
    expect(printErrorMessage({ code: 'WHAT', item: null })).not.toMatch(/[A-Z]/)
  })
})
