import { describe, expect, it } from 'vitest'
import { STREAM_AUDIO_LATE, STREAM_AUDIO_LISTENING, STREAM_AUDIO_MIC, STREAM_AUDIO_RECONNECTING, STREAM_AUDIO_SERVER_FAULT, STREAM_AUDIO_STOPPED, STREAM_AUDIO_UNSUPPORTED, readStreamAudioStatus, streamAudioLine } from '../src/lib/stream-audio.ts'

describe('방송 소리 상태 줄 (LV1 VOC-08)', () => {
  it('듣는 중·늦음·끊김·멈춤·받을 수 없음 문장', () => {
    expect(streamAudioLine({ phase: 'listening', lagMs: 1000 }, false)).toMatchObject({ text: STREAM_AUDIO_LISTENING, late: null, useMic: false })
    expect(streamAudioLine({ phase: 'listening', lagMs: 30_001 }, false)).toMatchObject({ late: STREAM_AUDIO_LATE, useMic: true })
    expect(streamAudioLine({ phase: 'listening', lagMs: 30_000 }, false)?.late).toBeNull()
    expect(streamAudioLine({ phase: 'listening', lagMs: 29_000 }, false)?.late).toBeNull()
    expect(streamAudioLine({ phase: 'reconnecting' }, false)?.text).toBe(STREAM_AUDIO_RECONNECTING)
    expect(streamAudioLine({ phase: 'stopped' }, false)).toMatchObject({ text: STREAM_AUDIO_STOPPED, tone: 'danger', retry: true, useMic: true })
    expect(streamAudioLine({ phase: 'unsupported' }, false)?.text).toBe(STREAM_AUDIO_UNSUPPORTED)
  })
  it('D-LV1-17 서버 쪽 길이 끊김은 라이브 탓이 아니라고 말하고 [다시 켜기]를 보인다', () => {
    expect(streamAudioLine({ phase: 'unsupported', serverFault: true }, false)).toMatchObject({ text: STREAM_AUDIO_SERVER_FAULT, tone: 'warn', retry: true, useMic: true })
    expect(STREAM_AUDIO_SERVER_FAULT).not.toContain('이 라이브는')
    expect(streamAudioLine({ phase: 'unsupported' }, false)).toMatchObject({ text: STREAM_AUDIO_UNSUPPORTED, retry: false })
    // 서버 응답은 믿지 않고 읽는다: 참일 때만, 못 받음일 때만
    expect(readStreamAudioStatus({ phase: 'unsupported', serverFault: true })).toEqual({ phase: 'unsupported', serverFault: true })
    expect(readStreamAudioStatus({ phase: 'unsupported', serverFault: 'yes' })).toEqual({ phase: 'unsupported' })
    expect(readStreamAudioStatus({ phase: 'listening', serverFault: true, lagMs: 5 })).toEqual({ phase: 'listening', lagMs: 5 })
  })
  it('마이크를 켜면 마이크가 듣는 곳', () => {
    expect(streamAudioLine({ phase: 'listening' }, true)?.text).toBe(STREAM_AUDIO_MIC)
    expect(streamAudioLine({ phase: 'mic' }, false)?.text).toBe(STREAM_AUDIO_MIC)
  })
  it('운영자가 끄면 줄이 없다, 모르는 값도 숨김', () => {
    expect(streamAudioLine({ phase: 'hidden' }, false)).toBeNull()
    expect(streamAudioLine(readStreamAudioStatus({ phase: 'HLS_ERROR' }), false)).toBeNull()
    expect(readStreamAudioStatus({ phase: 'listening', lagMs: 5 })).toEqual({ phase: 'listening', lagMs: 5 })
  })
  it('문장에 영어·기술 이름이 없다', () => {
    for (const text of [STREAM_AUDIO_LATE, STREAM_AUDIO_LISTENING, STREAM_AUDIO_MIC, STREAM_AUDIO_RECONNECTING, STREAM_AUDIO_STOPPED, STREAM_AUDIO_UNSUPPORTED]) expect(text).not.toMatch(/[A-Za-z]/)
  })
})
