// V2 적대 시험 (test-domain, AC-V2-29·AC-V2-30 device 쪽, D-V2-08): 음성 기록 상한·자르기, 받아쓴 글이 모듈 밖(콘솔·저장소·네트워크)으로 나가지 않음.
import { VOICE_LOG_MAX, addLogEntry, clearLog, clipLogText, createLogEntry, describeReading, readChunk, type VoiceLogEntry } from '@livejjim/voice'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DICT, simulate } from './sim.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('기록 상한·자르기 (AC-V2-29)', () => {
  it('51개 → 50개, 가장 오래된 것이 빠지고 새것이 맨 앞', () => {
    let log: VoiceLogEntry[] = []
    for (let i = 0; i < 51; i++) log = addLogEntry(log, createLogEntry({ at: i, pieces: [{ text: `말${String(i)}` }], action: 'discard' }))
    expect(log).toHaveLength(VOICE_LOG_MAX)
    expect(log[0]?.at).toBe(50)
    expect(log.at(-1)?.at).toBe(1)
    expect(clearLog()).toEqual([])
  })

  it('300글자는 그대로, 301글자는 300 + …, 이모지는 쪼개지지 않는다', () => {
    expect(clipLogText('가'.repeat(300))).toBe('가'.repeat(300))
    expect(clipLogText('가'.repeat(301))).toBe(`${'가'.repeat(300)}…`)
    const emoji = clipLogText('🌵'.repeat(301))
    expect([...emoji]).toHaveLength(301)
    expect(emoji.endsWith('🌵…')).toBe(true)
  })

  it('속성: 어떤 순서로 넣어도 50개 이하, 조각 글은 301 코드 포인트 이하, 넘긴 목록은 바뀌지 않는다', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ unit: 'grapheme', maxLength: 400 }), { maxLength: 80 }), (texts) => {
        let log: VoiceLogEntry[] = []
        for (const [i, text] of texts.entries()) {
          const prev = log
          const snapshot = JSON.stringify(prev)
          log = addLogEntry(prev, createLogEntry({ at: i, pieces: [{ text }], action: 'create' }))
          expect(JSON.stringify(prev)).toBe(snapshot)
        }
        expect(log.length).toBeLessThanOrEqual(50)
        for (const e of log) for (const p of e.pieces) expect([...p.text].length).toBeLessThanOrEqual(301)
      }),
      { numRuns: 100 },
    )
  })

  it('읽은 것 한 줄: 금액은 정수 원 표기, 빈 칸은 ?', () => {
    expect(describeReading({ no: 15, name: '엘레강스', price: 20_000 })).toBe('15번 · 엘레강스 · 20,000원')
    expect(describeReading({ no: null, name: null, price: null })).toBe('번호 ? · 품종 ? · 가격 ?')
  })
})

describe('받아쓴 글이 밖으로 나가지 않는다 (AC-V2-30 device 쪽)', () => {
  it('문자찜 끝자리·품종 말이 든 흐름 전체에서 콘솔·저장소·fetch 호출이 없다', () => {
    const calls: unknown[][] = []
    for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void calls.push(a))
    const storage = { setItem: vi.fn(), getItem: vi.fn(() => null), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', storage)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const r = simulate(
      [
        { text: '29번 핑크문 만원', at: 0 },
        { text: '165번 문자찜 끝자리 1234', at: 1000 },
        { text: '십오번', at: 3000 },
        { text: '엘레강스 이만원', at: 4000 },
        { text: '아니 만팔천', at: 9000 },
        { text: '가'.repeat(400), at: 15_000 },
      ],
      30_000,
    )
    readChunk('010-1234-5678 15번 만원', { dictionary: DICT })
    expect(r.log.length).toBeGreaterThan(0)
    expect(calls).toEqual([])
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('기록 항목에는 정해진 칸만 있다(at·pieces·read·action·reason) — 숨은 원문 칸 없음', () => {
    const e = createLogEntry({ at: 1, pieces: [{ text: '끝자리 1234', flushedAtEnd: true }], action: 'sms', ...({ raw: '010-1234-5678' } as object) } as never)
    expect(Object.keys(e).sort()).toEqual(['action', 'at', 'pieces', 'read', 'reason'])
    expect(JSON.stringify(e)).not.toContain('010-1234-5678')
  })
})
